/**
 * The OpenAI Responses adapter.
 *
 * Direct `fetch`, deliberately. The SDK would add a dependency whose retry,
 * timeout, and telemetry behaviour this Worker would then have to disable one
 * option at a time, and the convenience it offers — `response.output_text` —
 * papers over exactly the case that has to be caught: a response with no text
 * item, or with two.
 *
 * The adapter decides nothing. It maps one request to one candidate or one typed
 * failure and returns; retry class, command replacement, budget, publication,
 * and logging all belong to the Worker. It performs no retry of its own, on any
 * status, because one queue delivery is one provider call.
 *
 * Nothing from the provider crosses back except the parsed candidate and closed
 * metadata. The response bytes are hashed and dropped; no header, URL, error
 * message, or exception string reaches a result or a log.
 */

import { contentHash, type ReadingGenerationOutput } from "@patternlike/shared";
import type { Env } from "../env.js";
import { buildResponsesRequest, OPENAI_RESPONSES_URL } from "./reading-prompt.js";
import {
  READING_PUBLISHER_PROVIDER,
  type PublishOptions,
  type PublisherFailureCode,
  type PublisherResult,
  type PublisherSafeDetailCode,
  type ReadingPublisher,
} from "./reading-publisher.js";
import type { ReadingGenerationRequest } from "@patternlike/shared";

function failure(
  code: PublisherFailureCode,
  safe_detail_code: PublisherSafeDetailCode,
  retry_after_seconds: number | null = null,
): PublisherResult {
  return { ok: false, code, safe_detail_code, retry_after_seconds };
}

/** A whole number of seconds, or nothing. A date-formatted value is discarded. */
function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

interface ResponsesContentItem {
  type?: unknown;
  text?: unknown;
}

interface ResponsesOutputItem {
  type?: unknown;
  content?: unknown;
}

/**
 * The one message item, and the one text inside it.
 *
 * `output` also carries reasoning items, which is why this walks the array
 * rather than reading `output[0]`. Two message items or two text parts are
 * treated as a defect rather than concatenated: a candidate assembled from
 * fragments is not the candidate the schema described.
 */
function extractOutputText(
  body: unknown,
): { ok: true; text: string } | { ok: false; result: PublisherResult } {
  const output = (body as { output?: unknown })?.output;
  if (!Array.isArray(output)) {
    return { ok: false, result: failure("publisher_output_invalid", "missing_output_text") };
  }

  const texts: string[] = [];
  let refused = false;
  for (const item of output as ResponsesOutputItem[]) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content as ResponsesContentItem[]) {
      if (!part) continue;
      if (part.type === "refusal") refused = true;
      if (part.type === "output_text" && typeof part.text === "string") texts.push(part.text);
    }
  }

  // A refusal is the provider declining, not a malformed answer. It gets its own
  // failure class because the retry policy for the two is different.
  if (refused && texts.length === 0) {
    return { ok: false, result: failure("publisher_refused", "provider_refusal") };
  }
  if (texts.length === 0) {
    return { ok: false, result: failure("publisher_output_invalid", "missing_output_text") };
  }
  if (texts.length > 1) {
    return { ok: false, result: failure("publisher_output_invalid", "multiple_output_text") };
  }
  return { ok: true, text: texts[0]! };
}

/** The top-level keys the strict schema requires. Depth is the validator's job. */
const REQUIRED_CANDIDATE_KEYS = [
  "schema_version",
  "output_schema",
  "local_date",
  "locale",
  "headline",
  "lead",
  "paragraphs",
  "reflection_prompt",
  "uncertainty_note",
] as const;

function readUsage(body: unknown, key: "input_tokens" | "output_tokens"): number {
  const usage = (body as { usage?: Record<string, unknown> })?.usage;
  const value = usage?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function createOpenAiReadingPublisher(
  env: Pick<Env, "OPENAI_API_KEY">,
): ReadingPublisher {
  return {
    async publish(
      request: ReadingGenerationRequest,
      options: PublishOptions,
    ): Promise<PublisherResult> {
      const apiKey = env.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        // Refused here rather than sent as an empty Authorization header: a
        // 401 from the provider costs a round trip to learn what this Worker
        // already knows.
        return failure("publisher_auth_failed", "authentication_failed");
      }

      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), options.timeoutMs);

      let response: Response;
      try {
        response = await fetch(OPENAI_RESPONSES_URL, {
          method: "POST",
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(buildResponsesRequest(request, options.configuration)),
        });
      } catch (err) {
        // The distinction that matters to an operator: a deadline this Worker
        // set, or a network that did not carry the request.
        const aborted = controller.signal.aborted || (err as { name?: string })?.name === "AbortError";
        return failure(
          "publisher_unavailable",
          aborted ? "request_timeout" : "network_error",
        );
      } finally {
        clearTimeout(deadline);
      }

      if (!response.ok) {
        const retryAfter = retryAfterSeconds(response);
        if (response.status === 401 || response.status === 403) {
          return failure("publisher_auth_failed", "authentication_failed");
        }
        if (response.status === 404) {
          // The configured model is gone or the project cannot reach it. Not
          // retryable: the frozen command names this model and no other.
          return failure("publisher_model_unavailable", "model_not_available");
        }
        if (response.status === 429) {
          return failure("publisher_unavailable", "rate_limited", retryAfter);
        }
        if (response.status >= 500) {
          return failure("publisher_unavailable", "provider_5xx", retryAfter);
        }
        // Any other 4xx is a request this adapter built wrong, which a retry
        // reproduces exactly.
        return failure("publisher_output_invalid", "schema_mismatch");
      }

      let raw: string;
      try {
        raw = await response.text();
      } catch {
        return failure("publisher_unavailable", "network_error");
      }

      // Hashed BEFORE anything is parsed out of it, and the bytes are not kept.
      // The digest is what lets stored evidence name the exact response that
      // won publication without storing a word of it.
      const provider_response_hash = await contentHash(raw);

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return failure("publisher_output_invalid", "invalid_json");
      }

      const extracted = extractOutputText(body);
      if (!extracted.ok) return extracted.result;

      let candidate: unknown;
      try {
        candidate = JSON.parse(extracted.text);
      } catch {
        return failure("publisher_output_invalid", "invalid_json");
      }
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        return failure("publisher_output_invalid", "schema_mismatch");
      }
      const keys = new Set(Object.keys(candidate as Record<string, unknown>));
      if (!REQUIRED_CANDIDATE_KEYS.every((key) => keys.has(key))) {
        return failure("publisher_output_invalid", "schema_mismatch");
      }

      const responseId = (body as { id?: unknown })?.id;
      return {
        ok: true,
        // Returned exactly as sent. An adapter that repaired an echoed date
        // would hide the defect the validator exists to catch.
        candidate: candidate as ReadingGenerationOutput,
        metadata: {
          provider: READING_PUBLISHER_PROVIDER,
          model: options.configuration.model,
          provider_request_id: typeof responseId === "string" ? responseId : "",
          input_tokens: readUsage(body, "input_tokens"),
          output_tokens: readUsage(body, "output_tokens"),
          provider_response_hash,
        },
      };
    },
  };
}
