/**
 * The Cloudflare Workers AI Pattern publisher.
 *
 * Deliberately NOT routed through `openai-responses-adapter.ts`. That module is
 * the reviewed *Responses API* primitive — one fetch, gateway headers, an abort
 * deadline, exact-byte hashing. Workers AI is a binding, not an origin: there is
 * no URL, no credential on the request, and no gateway. Forcing it through the
 * Responses adapter would mean inventing a fake route and a fake credential to
 * satisfy a shape it does not have.
 *
 * What it does keep identical is everything downstream: the same
 * `PatternPublisher` interface, the same budget reservation immediately before
 * the call, the same closed failure codes, and provenance that names the model
 * that actually answered. The deterministic validators in
 * `@patternlike/pattern-engine` remain the only thing that decides whether an
 * answer is usable — nothing here repairs a malformed one.
 */

import type {
  PatternPlan,
  PatternSemanticVerdict,
  PatternWriterOutput,
} from "@patternlike/shared";
import {
  PATTERN_PUBLISHER_WORKERS_AI,
  type PatternPassOptions,
  type PatternPassOutcome,
  type PatternPublisher,
  type PatternPublisherPin,
  type PatternStageClass,
} from "./pattern-publisher.js";
import {
  PATTERN_STRICT_SCHEMA,
  PATTERN_SYSTEM_POLICY,
  PATTERN_WRITER_CORRECTION_POLICY,
  WORKERS_AI_PLANNER_POLICY,
  WORKERS_AI_WRITER_POLICY,
} from "./pattern-prompt.js";

/** The binding surface this publisher needs, narrowed to one method. */
export interface WorkersAiBinding {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

function failure<T>(
  code: PatternPassOutcome<T> extends { ok: false; code: infer C } ? C : never,
  safe_detail_code: "invalid_json" | "missing_output_text" | "schema_mismatch" |
    "network_error" | "provider_refusal" | "daily_call_limit_reached",
): PatternPassOutcome<T> {
  return {
    ok: false,
    code,
    safe_detail_code,
    retry_after_seconds: null,
    origin_layer: "provider",
  } as PatternPassOutcome<T>;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  const hex = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}

function readInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

/**
 * Pull the single assistant message out of a Workers AI chat completion.
 *
 * `reasoning` / `reasoning_content` are siblings of `content` on these models
 * and are deliberately ignored: the answer is the content field alone, and
 * concatenating the two would feed the model's scratchpad into a validator.
 */
function extractContent(
  raw: unknown,
): { ok: true; text: string } | { ok: false } {
  const result = (raw as { result?: unknown })?.result ?? raw;
  const choices = (result as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return { ok: false };
  const message = (choices[0] as { message?: unknown })?.message;
  const content = (message as { content?: unknown })?.content;
  if (typeof content !== "string" || content.trim() === "") return { ok: false };
  return { ok: true, text: content };
}

function readUsage(raw: unknown): { input: number; output: number } {
  const result = (raw as { result?: unknown })?.result ?? raw;
  const usage = (result as { usage?: unknown })?.usage as
    | Record<string, unknown>
    | undefined;
  return {
    input: readInteger(usage?.prompt_tokens),
    output: readInteger(usage?.completion_tokens),
  };
}

export function createWorkersAiPatternPublisher(ai: WorkersAiBinding): PatternPublisher {
  async function run<T>(
    pass: PatternStageClass,
    document: unknown,
    options: PatternPassOptions,
    correction = false,
  ): Promise<PatternPassOutcome<T>> {
    // Charged immediately before the call, exactly as the OpenAI path does: a
    // reservation taken at stage entry is spent by a delivery that may never
    // reach a provider, and nothing is refunded on failure.
    const reserved = await options.reserve(pass);
    if (!reserved.ok) {
      return {
        ok: false,
        code: "publisher_budget_exhausted",
        safe_detail_code: "daily_call_limit_reached",
        retry_after_seconds: null,
        origin_layer: "none",
      } as PatternPassOutcome<T>;
    }

    const pin: PatternPublisherPin = options.pin;
    const instructions =
      correction && pass === "writer"
        ? PATTERN_WRITER_CORRECTION_POLICY
        : pass === "planner"
          ? WORKERS_AI_PLANNER_POLICY
          : pass === "writer"
            ? WORKERS_AI_WRITER_POLICY
            : PATTERN_SYSTEM_POLICY[pass];

    let raw: unknown;
    try {
      raw = await ai.run(pin[`${pass}_model`], {
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: JSON.stringify(document) },
        ],
        // The same frozen strict schema the OpenAI path sends. The Worker's
        // deterministic validators still enforce every bound the strict
        // projection had to drop.
        response_format: {
          type: "json_schema",
          json_schema: PATTERN_STRICT_SCHEMA[pass],
        },
        max_tokens: pin[`${pass}_max_output_tokens`],
      });
    } catch {
      // The binding throws on transport and model errors alike; neither detail
      // is safe to surface, and both are worth another attempt.
      return failure<T>("publisher_unavailable" as never, "network_error");
    }

    const extracted = extractContent(raw);
    if (!extracted.ok) {
      return failure<T>("publisher_output_invalid" as never, "missing_output_text");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted.text);
    } catch {
      return failure<T>("publisher_output_invalid" as never, "invalid_json");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return failure<T>("publisher_output_invalid" as never, "schema_mismatch");
    }

    const usage = readUsage(raw);
    const serialized = JSON.stringify(raw);
    return {
      ok: true,
      value: parsed as T,
      raw: extracted.text,
      metadata: {
        provider: PATTERN_PUBLISHER_WORKERS_AI,
        pass,
        model: pin[`${pass}_model`],
        prompt_version: pin[`${pass}_prompt_version`],
        // The binding exposes no provider-side request id, so this is derived
        // from the response bytes rather than invented: it is stable, unique
        // per answer, and honestly not a provider identifier.
        provider_request_id: `wai_${(await sha256Hex(serialized)).slice(7, 39)}`,
        input_tokens: usage.input,
        output_tokens: usage.output,
        provider_response_hash: await sha256Hex(serialized),
        cache_observation: "missing",
      },
    } as PatternPassOutcome<T>;
  }

  return {
    plan: (input, options) => run<PatternPlan>("planner", input, options),
    write: (input, options) =>
      run<PatternWriterOutput>(
        "writer",
        input,
        options,
        !!input &&
          typeof input === "object" &&
          !Array.isArray(input) &&
          "correction" in input,
      ),
    verify: (input, options) =>
      run<PatternSemanticVerdict>("verifier", input, options),
  };
}
