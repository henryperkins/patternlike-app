/**
 * Production preflight for the pinned Pattern model and strict-schema subset.
 *
 * This is an operator-run rollout gate, not a CI test. It performs one model
 * lookup and one minimal Responses request for every distinct compiled Pattern
 * model. Output is limited to model ids, response identity/hash, timestamps,
 * and verdicts; provider prose and credentials are never printed.
 *
 *   OPENAI_API_KEY=sk-... npm run publisher:pattern:model:verify -w @patternlike/api
 */

import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  OPENAI_PATTERN_PLANNER_MODEL,
  OPENAI_PATTERN_PLANNER_TIMEOUT_MS,
  OPENAI_PATTERN_VERIFIER_MODEL,
  OPENAI_PATTERN_VERIFIER_TIMEOUT_MS,
  OPENAI_PATTERN_WRITER_MODEL,
  OPENAI_PATTERN_WRITER_TIMEOUT_MS,
} from "../src/services/pattern-publisher.js";
import { OPENAI_RESPONSES_MAX_BODY_BYTES } from "../src/services/openai-responses-adapter.js";

const MODELS_URL = "https://api.openai.com/v1/models";
const RESPONSES_URL = "https://api.openai.com/v1/responses";
const CHAPTER_KEY = /^chapter_[0-9]{2}$/;
const DEFAULT_TIMEOUT_MS = Math.max(
  OPENAI_PATTERN_PLANNER_TIMEOUT_MS,
  OPENAI_PATTERN_WRITER_TIMEOUT_MS,
  OPENAI_PATTERN_VERIFIER_TIMEOUT_MS,
);

const MODEL_PINS = [
  ["OPENAI_PATTERN_PLANNER_MODEL", OPENAI_PATTERN_PLANNER_MODEL],
  ["OPENAI_PATTERN_WRITER_MODEL", OPENAI_PATTERN_WRITER_MODEL],
  ["OPENAI_PATTERN_VERIFIER_MODEL", OPENAI_PATTERN_VERIFIER_MODEL],
] as const;

interface VerificationEnvironment {
  OPENAI_API_KEY?: string;
  OPENAI_PATTERN_PLANNER_MODEL?: string;
  OPENAI_PATTERN_WRITER_MODEL?: string;
  OPENAI_PATTERN_VERIFIER_MODEL?: string;
}

export interface PatternModelVerificationOptions {
  env?: VerificationEnvironment;
  fetchFn?: typeof fetch;
  now?: () => Date;
  /** Hermetic-test override; production uses the longest compiled pass timeout. */
  timeoutMs?: number;
  /** Hermetic-test override; production uses the shared Responses byte ceiling. */
  maxBodyBytes?: number;
}

export interface PatternModelVerificationResult {
  exitCode: 0 | 1 | 2;
  stdout: string[];
  stderr: string[];
}

function result(
  exitCode: 0 | 1 | 2,
  stdout: string[],
  stderr: string[],
): PatternModelVerificationResult {
  return { exitCode, stdout, stderr };
}

function pinnedModels(
  env: VerificationEnvironment,
): { ok: true; models: string[] } | { ok: false; message: string } {
  const models = new Set<string>();
  for (const [key, compiled] of MODEL_PINS) {
    const configured = env[key]?.trim() || compiled;
    if (configured !== compiled) {
      return {
        ok: false,
        message: `FAIL  ${key} differs from the compiled pin ${compiled}`,
      };
    }
    models.add(compiled);
  }
  return { ok: true, models: [...models] };
}

function probeRequest(model: string): object {
  return {
    model,
    store: false,
    instructions: "Return the requested object. Do not add fields.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: 'Return {"k":"chapter_17"}.',
          },
        ],
      },
    ],
    reasoning: { effort: "low" },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "patternlike_pattern_keyword_probe",
        strict: true,
        schema: {
          type: "object",
          properties: {
            k: {
              type: "string",
              pattern: "^chapter_[0-9]{2}$",
            },
          },
          required: ["k"],
          additionalProperties: false,
        },
      },
    },
    max_output_tokens: 256,
  };
}

function probeOutput(body: unknown): { responseId: string; value: string } | null {
  const responseId = (body as { id?: unknown })?.id;
  if (
    typeof responseId !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(responseId)
  ) {
    return null;
  }

  const output = (body as { output?: unknown })?.output;
  if (!Array.isArray(output)) return null;
  const texts: string[] = [];
  for (const item of output) {
    if ((item as { type?: unknown })?.type !== "message") continue;
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) return null;
      if ((part as { type?: unknown })?.type === "refusal") return null;
      const text = (part as { type?: unknown; text?: unknown });
      if (text.type === "output_text" && typeof text.text === "string") {
        texts.push(text.text);
      }
    }
  }
  if (texts.length !== 1) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(texts[0]!);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  const value = (parsed as { k?: unknown }).k;
  if (keys.length !== 1 || keys[0] !== "k" || typeof value !== "string") {
    return null;
  }
  if (!CHAPTER_KEY.test(value)) return null;
  return { responseId, value };
}

type BoundedRequestResult =
  | { ok: true; response: Response; raw: string; bytes: Uint8Array }
  | {
      ok: false;
      reason: "timeout" | "unreachable" | "too_large" | "unreadable";
    };

async function cancelResponse(
  response: Response,
  controller: AbortController,
): Promise<void> {
  controller.abort();
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Best effort after the response has already been refused.
  }
}

async function boundedRequest(
  fetchFn: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  maxBodyBytes: number,
): Promise<BoundedRequestResult> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchFn(input, { ...init, signal: controller.signal });
  } catch (error) {
    clearTimeout(deadline);
    const timedOut =
      controller.signal.aborted ||
      (error as { name?: string } | null)?.name === "AbortError";
    return { ok: false, reason: timedOut ? "timeout" : "unreachable" };
  }

  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared)) {
    const parsed = Number(declared);
    if (Number.isSafeInteger(parsed) && parsed > maxBodyBytes) {
      try {
        await cancelResponse(response, controller);
      } finally {
        clearTimeout(deadline);
      }
      return { ok: false, reason: "too_large" };
    }
  }

  if (!response.body) {
    clearTimeout(deadline);
    return {
      ok: true,
      response,
      raw: "",
      bytes: new Uint8Array(0),
    };
  }

  const reader = response.body.getReader();
  const bytes = new Uint8Array(maxBodyBytes);
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      if (next.value.byteLength > maxBodyBytes - total) {
        controller.abort();
        try {
          await reader.cancel();
        } catch {
          // Best effort after the response has already been refused.
        }
        return { ok: false, reason: "too_large" };
      }
      bytes.set(next.value, total);
      total += next.value.byteLength;
    }
  } catch (error) {
    const timedOut =
      controller.signal.aborted ||
      (error as { name?: string } | null)?.name === "AbortError";
    return { ok: false, reason: timedOut ? "timeout" : "unreadable" };
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }

  const received = bytes.subarray(0, total);
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      received,
    );
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  return { ok: true, response, raw, bytes: received };
}

function requestFailure(
  model: string,
  subject: "the model endpoint" | "the strict pattern probe",
  reason: Exclude<BoundedRequestResult, { ok: true }>["reason"],
): string {
  if (reason === "timeout") return `FAIL  ${model} — ${subject} timed out`;
  if (reason === "unreachable") {
    return `FAIL  ${model} — ${subject} could not be reached`;
  }
  if (reason === "too_large") {
    return `FAIL  ${model} — ${subject} answer exceeded the safe size`;
  }
  return `FAIL  ${model} — ${subject} answer was unreadable`;
}

export async function runPatternModelVerification(
  options: PatternModelVerificationOptions = {},
): Promise<PatternModelVerificationResult> {
  const env = options.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return result(2, [], ["FAIL  OPENAI_API_KEY is not set"]);
  }

  const resolved = pinnedModels(env);
  if (!resolved.ok) return result(2, [], [resolved.message]);

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? OPENAI_RESPONSES_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return result(2, [], ["FAIL  verification timeout is invalid"]);
  }
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    return result(2, [], ["FAIL  verification response-size limit is invalid"]);
  }
  const stdout: string[] = [];
  for (const model of resolved.models) {
    const lookupResult = await boundedRequest(
      fetchFn,
      `${MODELS_URL}/${encodeURIComponent(model)}`,
      {
        headers: { authorization: `Bearer ${apiKey}` },
      },
      timeoutMs,
      maxBodyBytes,
    );
    if (!lookupResult.ok) {
      return result(1, stdout, [
        requestFailure(model, "the model endpoint", lookupResult.reason),
      ]);
    }
    const lookup = lookupResult.response;
    if (lookup.status === 401 || lookup.status === 403) {
      return result(1, stdout, [
        `FAIL  ${model} — the key is not authorized for this account`,
      ]);
    }
    if (!lookup.ok) {
      return result(1, stdout, [
        `FAIL  ${model} — the model endpoint answered ${lookup.status}`,
      ]);
    }

    let lookupId: unknown;
    try {
      lookupId = (JSON.parse(lookupResult.raw) as { id?: unknown }).id;
    } catch {
      return result(1, stdout, [
        `FAIL  ${model} — the model endpoint answer was unreadable`,
      ]);
    }
    if (lookupId !== model) {
      return result(1, stdout, [
        `FAIL  ${model} — the account resolved it to a different id`,
      ]);
    }
    stdout.push(`PASS  ${model} model_lookup`);

    const requestBody = JSON.stringify(probeRequest(model));
    const probeResult = await boundedRequest(
      fetchFn,
      RESPONSES_URL,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: requestBody,
      },
      timeoutMs,
      maxBodyBytes,
    );
    if (!probeResult.ok) {
      return result(1, stdout, [
        requestFailure(model, "the strict pattern probe", probeResult.reason),
      ]);
    }
    const probe = probeResult.response;
    if (!probe.ok) {
      return result(1, stdout, [
        `FAIL  ${model} — the strict pattern probe answered ${probe.status}`,
      ]);
    }

    let raw: string;
    let body: unknown;
    try {
      raw = probeResult.raw;
      body = JSON.parse(raw);
    } catch {
      return result(1, stdout, [
        `FAIL  ${model} — the strict pattern probe answer was unreadable`,
      ]);
    }
    if ((body as { status?: unknown })?.status !== "completed") {
      return result(1, stdout, [
        `FAIL  ${model} — the strict pattern probe did not complete with one pattern-conformant object`,
      ]);
    }
    const output = probeOutput(body);
    if (!output) {
      return result(1, stdout, [
        `FAIL  ${model} — the strict pattern probe did not return one pattern-conformant object`,
      ]);
    }
    const responseHash = createHash("sha256")
      .update(probeResult.bytes)
      .digest("hex");
    const completedAt = (options.now ?? (() => new Date()))().toISOString();
    stdout.push(
      `PASS  ${model} strict_pattern response_id=${output.responseId} response_sha256=sha256:${responseHash} completed_at=${completedAt}`,
    );
  }

  return result(0, stdout, []);
}

async function main(): Promise<number> {
  const verification = await runPatternModelVerification();
  for (const line of verification.stdout) console.log(line);
  for (const line of verification.stderr) console.error(line);
  return verification.exitCode;
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  process.exitCode = await main();
}
