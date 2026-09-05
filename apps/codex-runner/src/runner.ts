import { CodexProviderClientError, type CodexProviderClient } from "./client.js";
import type { CodexInvocationOutcome } from "./codex-cli.js";
import type { CodexProviderClaim } from "./protocol.js";
import type { CodexPortraitClient } from "./portrait-client.js";
import type { PortraitInvocationOutcome } from "./portrait-invocation.js";
import type { CodexPortraitClaim } from "@patternlike/shared";

export interface RunnerConfiguration {
  apiOrigin: string;
  runnerToken: string;
  codexBin: string;
  pollMs: number;
  concurrency: 1;
  portraitsEnabled?: true;
}

export type RunnerLogEvent = Readonly<{
  event:
    | "codex_runner_idle"
    | "codex_runner_job_processed"
    | "codex_runner_poll_failed";
}>;

type RunnerClient = Pick<CodexProviderClient, "claim" | "complete" | "fail">;
type ExecuteInvocation = (claim: CodexProviderClaim) => Promise<CodexInvocationOutcome>;

export class FatalCodexRunnerError extends Error {
  constructor() {
    super("Codex runner authentication or executable is unavailable");
    this.name = "FatalCodexRunnerError";
  }
}

function requiredInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return resolved;
}

export function parseRunnerConfiguration(env: NodeJS.ProcessEnv): RunnerConfiguration {
  const rawOrigin = env.PATTERNLIKE_API_ORIGIN?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new Error("PATTERNLIKE_API_ORIGIN is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("PATTERNLIKE_API_ORIGIN must be an HTTPS origin");
  }
  const runnerToken = env.CODEX_RUNNER_TOKEN?.trim() ?? "";
  if (!/^[A-Za-z0-9._-]{32,512}$/.test(runnerToken)) {
    throw new Error("CODEX_RUNNER_TOKEN is invalid");
  }
  const codexBin = env.CODEX_BIN?.trim() || "codex";
  if (codexBin.includes("\0") || codexBin.length > 4096) {
    throw new Error("CODEX_BIN is invalid");
  }
  const pollMs = requiredInteger(
    env.CODEX_RUNNER_POLL_MS,
    5_000,
    250,
    60_000,
    "CODEX_RUNNER_POLL_MS",
  );
  const concurrency = requiredInteger(
    env.CODEX_RUNNER_CONCURRENCY,
    1,
    1,
    1,
    "CODEX_RUNNER_CONCURRENCY",
  );
  if (env.CODEX_RUNNER_PORTRAITS !== undefined && !["0", "1"].includes(env.CODEX_RUNNER_PORTRAITS)) {
    throw new Error("CODEX_RUNNER_PORTRAITS is invalid");
  }
  return {
    apiOrigin: url.origin,
    runnerToken,
    codexBin,
    pollMs,
    concurrency: concurrency as 1,
    ...(env.CODEX_RUNNER_PORTRAITS === "1" ? { portraitsEnabled: true as const } : {}),
  };
}

export interface PortraitRunnerOptions {
  client: Pick<CodexPortraitClient, "claim" | "complete" | "fail">;
  execute: (claim: CodexPortraitClaim) => Promise<PortraitInvocationOutcome>;
}

export async function runOnePortraitJob(options: PortraitRunnerOptions): Promise<"empty" | "processed"> {
  const claimed = await options.client.claim();
  if (claimed.status === "empty") return "empty";
  let outcome: PortraitInvocationOutcome;
  try { outcome = await options.execute(claimed.claim); }
  catch { outcome = { ok: false, code: "generation_failed", fatal: false }; }
  if (outcome.ok) {
    try {
      await options.client.complete(claimed.claim.job_id, outcome.completion);
    } catch (error) {
      // A 400 rejects the image before acceptance. Other errors may hide a successful write.
      if (!(error instanceof CodexProviderClientError) || error.status !== 400) throw error;
      await options.client.fail(claimed.claim.job_id, { lease_token: claimed.claim.lease_token, code: "image_invalid" });
    }
  } else {
    try { await options.client.fail(claimed.claim.job_id, { lease_token: claimed.claim.lease_token, code: outcome.code }); }
    finally { if (outcome.fatal) throw new FatalCodexRunnerError(); }
  }
  return "processed";
}

export async function runOneCodexJob(
  client: RunnerClient,
  execute: ExecuteInvocation,
): Promise<"empty" | "processed"> {
  const claimed = await client.claim();
  if (claimed.status === "empty") return "empty";
  let outcome: CodexInvocationOutcome;
  try {
    outcome = await execute(claimed.claim);
  } catch {
    outcome = {
      ok: false,
      code: "publisher_unavailable",
      safeDetailCode: "network_error",
      fatal: false,
    };
  }
  if (outcome.ok) {
    await client.complete(claimed.claim.job_id, {
      lease_token: claimed.claim.lease_token,
      output: outcome.output,
      provider_request_id: outcome.providerRequestId,
      input_tokens: outcome.inputTokens,
      output_tokens: outcome.outputTokens,
    });
  } else {
    if (outcome.fatal) {
      try {
        await client.fail(claimed.claim.job_id, {
          lease_token: claimed.claim.lease_token,
          code: outcome.code,
          safe_detail_code: outcome.safeDetailCode,
        });
      } finally {
        throw new FatalCodexRunnerError();
      }
    }
    await client.fail(claimed.claim.job_id, {
      lease_token: claimed.claim.lease_token,
      code: outcome.code,
      safe_detail_code: outcome.safeDetailCode,
    });
  }
  return "processed";
}

function jitteredDelay(pollMs: number, random: () => number): number {
  const bounded = Math.max(0, Math.min(1, random()));
  return Math.round(pollMs * (0.8 + bounded * 0.4));
}

async function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

export interface CodexPollLoopOptions {
  client: RunnerClient;
  execute: ExecuteInvocation;
  pollMs: number;
  signal: AbortSignal;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  log?: (event: RunnerLogEvent) => void;
  portraits?: PortraitRunnerOptions;
}

export async function runCodexPollLoop(options: CodexPollLoopOptions): Promise<void> {
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((milliseconds: number) =>
    abortableSleep(milliseconds, options.signal));
  const log = options.log ?? (() => undefined);
  while (!options.signal.aborted) {
    let status: "empty" | "processed";
    try {
      status = await runOneCodexJob(options.client, options.execute);
      if (status === "empty" && options.portraits && !options.signal.aborted) {
        status = await runOnePortraitJob(options.portraits);
      }
    } catch (error) {
      if (error instanceof FatalCodexRunnerError) throw error;
      log({ event: "codex_runner_poll_failed" });
      await sleep(jitteredDelay(options.pollMs, random));
      continue;
    }
    if (status === "processed") {
      log({ event: "codex_runner_job_processed" });
      continue;
    }
    log({ event: "codex_runner_idle" });
    await sleep(jitteredDelay(options.pollMs, random));
  }
}
