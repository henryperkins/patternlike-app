import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CODEX_PROVIDER_MAX_RESPONSE_BYTES,
  type CodexProviderClaim,
  type CodexProviderFailureCode,
  type CodexProviderSafeDetailCode,
} from "./protocol.js";

export { CODEX_PROVIDER_MAX_RESPONSE_BYTES } from "./protocol.js";

const CODEX_CLI_MAX_EVENT_BYTES = 256 * 1024;
const PROVIDER_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const CODEX_CHILD_ENVIRONMENT_KEYS = [
  "HOME",
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

/** Keep the runner bearer and application credentials out of Codex children. */
export function buildCodexChildEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const key of CODEX_CHILD_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value !== undefined) child[key] = value;
  }
  return child;
}

export type CodexInvocationOutcome =
  | {
    ok: true;
    output: string;
    providerRequestId: string;
    inputTokens: number;
    outputTokens: number;
  }
  | {
    ok: false;
    code: CodexProviderFailureCode;
    safeDetailCode: CodexProviderSafeDetailCode;
    fatal: boolean;
  };

export interface RunCodexInvocationOptions {
  claim: CodexProviderClaim;
  codexBin: string;
  tempRoot?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  authenticationCheck?: () => Promise<boolean>;
}

interface ProcessOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Uint8Array;
  timedOut: boolean;
  overflowed: boolean;
  spawnFailed: boolean;
}

function failure(
  code: CodexProviderFailureCode,
  safeDetailCode: CodexProviderSafeDetailCode,
  fatal = false,
): CodexInvocationOutcome {
  return { ok: false, code, safeDetailCode, fatal };
}

async function runProcess(
  binary: string,
  args: string[],
  prompt: string,
  options: {
    timeoutMs: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: buildCodexChildEnvironment(options.env ?? process.env),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let timedOut = false;
    let overflowed = false;
    let spawnFailed = false;
    let settled = false;
    let forceKill: NodeJS.Timeout | undefined;

    const stop = () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        forceKill = setTimeout(() => child.kill("SIGKILL"), 1_000);
        forceKill.unref();
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    timeout.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.byteLength;
      if (length > CODEX_CLI_MAX_EVENT_BYTES) {
        overflowed = true;
        stop();
        return;
      }
      chunks.push(chunk);
    });
    child.stdin.on("error", () => undefined);
    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill !== undefined) clearTimeout(forceKill);
      resolve({
        code,
        signal,
        stdout: new Uint8Array(Buffer.concat(chunks)),
        timedOut,
        overflowed,
        spawnFailed,
      });
    });
    child.stdin.end(prompt);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseEvents(bytes: Uint8Array): {
  threadId: string;
  inputTokens: number;
  outputTokens: number;
} | null {
  let serialized: string;
  try {
    serialized = textDecoder.decode(bytes);
  } catch {
    return null;
  }
  let threadId: string | null = null;
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  for (const line of serialized.split("\n")) {
    if (line.trim() === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isRecord(event) || typeof event.type !== "string") return null;
    if (event.type === "thread.started") {
      if (
        threadId !== null ||
        typeof event.thread_id !== "string" ||
        !PROVIDER_REQUEST_ID.test(event.thread_id)
      ) {
        return null;
      }
      threadId = event.thread_id;
    }
    if (event.type === "turn.completed") {
      if (usage !== null || !isRecord(event.usage)) return null;
      const inputTokens = event.usage.input_tokens;
      const outputTokens = event.usage.output_tokens;
      if (
        !Number.isSafeInteger(inputTokens) ||
        (inputTokens as number) < 0 ||
        !Number.isSafeInteger(outputTokens) ||
        (outputTokens as number) < 0
      ) {
        return null;
      }
      usage = {
        inputTokens: inputTokens as number,
        outputTokens: outputTokens as number,
      };
    }
  }
  return threadId !== null && usage !== null
    ? { threadId, ...usage }
    : null;
}

export async function checkCodexAuthentication(
  codexBin: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(codexBin, ["login", "status"], {
      cwd: options.cwd,
      env: buildCodexChildEnvironment(options.env ?? process.env),
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, options.timeoutMs ?? 10_000);
    timer.unref();
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
  });
}

export async function runCodexInvocation(
  options: RunCodexInvocationOptions,
): Promise<CodexInvocationOutcome> {
  const parent = options.tempRoot ?? tmpdir();
  if (options.tempRoot !== undefined) {
    await mkdir(parent, { recursive: true, mode: 0o700 });
  }
  const directory = await mkdtemp(join(parent, "patternlike-codex-"));
  await chmod(directory, 0o700);
  const schemaPath = join(directory, "output-schema.json");
  const outputPath = join(directory, "output.json");
  try {
    await Promise.all([
      writeFile(schemaPath, JSON.stringify(options.claim.invocation.output_schema), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      }),
      open(outputPath, "wx", 0o600).then((handle) => handle.close()),
    ]);
    const result = await runProcess(
      options.codexBin,
      [
        "exec",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--json",
        "--model",
        options.claim.model,
        "--config",
        `model_reasoning_effort="${options.claim.reasoning_effort}"`,
        "--output-schema",
        schemaPath,
        "-o",
        outputPath,
        "-",
      ],
      options.claim.invocation.prompt,
      {
        timeoutMs: options.claim.timeout_ms,
        cwd: options.cwd,
        env: options.env,
      },
    );
    if (result.timedOut) {
      return failure("publisher_unavailable", "request_timeout");
    }
    if (result.overflowed) {
      return failure("publisher_output_invalid", "schema_mismatch");
    }
    if (result.spawnFailed) {
      return failure("publisher_unavailable", "network_error", true);
    }
    if (result.code !== 0 || result.signal !== null) {
      const authenticated = await (options.authenticationCheck?.() ??
        checkCodexAuthentication(options.codexBin, {
          cwd: options.cwd,
          env: options.env,
        }));
      return authenticated
        ? failure("publisher_unavailable", "network_error")
        : failure("publisher_auth_failed", "authentication_failed", true);
    }
    const events = parseEvents(result.stdout);
    if (events === null) {
      return failure("publisher_output_invalid", "schema_mismatch");
    }
    const outputStat = await lstat(outputPath);
    if (
      !outputStat.isFile() ||
      outputStat.isSymbolicLink() ||
      outputStat.size > CODEX_PROVIDER_MAX_RESPONSE_BYTES ||
      (outputStat.mode & 0o077) !== 0
    ) {
      return failure("publisher_output_invalid", "schema_mismatch");
    }
    const bytes = await readFile(outputPath);
    if (bytes.byteLength === 0) {
      return failure("publisher_output_invalid", "missing_output_text");
    }
    let output: string;
    try {
      output = textDecoder.decode(bytes);
      JSON.parse(output);
    } catch {
      return failure("publisher_output_invalid", "invalid_json");
    }
    return {
      ok: true,
      output,
      providerRequestId: events.threadId,
      inputTokens: events.inputTokens,
      outputTokens: events.outputTokens,
    };
  } catch {
    return failure("publisher_unavailable", "network_error");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
