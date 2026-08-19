/**
 * The parts of the OpenAI Responses boundary that carry no product semantics.
 *
 * Extracted from `openai-reading-publisher.ts` so the Pattern adapter can reuse
 * them without importing the reading module. Copying instead would let the two
 * drift on the one behaviour that is expensive to rediscover: a refusal part
 * accompanied by text, two text parts, reasoning items ahead of the message.
 *
 * Nothing here decides anything. It maps one envelope to text or to one typed
 * failure; retry class, budget, publication, and logging belong to the Worker.
 * No provider header, URL, message, or exception string crosses this boundary.
 */

import type { AiGatewayRoute } from "./reading-publisher.js";

export {
  resolveAiGatewayRoute,
  responsesUrlFor,
  OPENAI_RESPONSES_URL,
  AI_GATEWAY_ORIGIN,
} from "./reading-publisher.js";
export type {
  AiGatewayRoute,
  AiGatewayOutcome,
  ProviderCredentialMode,
} from "./reading-publisher.js";
export { resolveProviderCredentialMode } from "./reading-publisher.js";

export type PublisherFailureCode =
  | "publisher_unavailable"
  | "publisher_output_invalid"
  | "publisher_refused"
  | "publisher_auth_failed"
  | "publisher_model_unavailable";

/**
 * The closed vocabulary a failure may carry.
 *
 * No provider response text, header, URL, or exception message is ever copied
 * into a result or a log line. A metric needs to distinguish a timeout from a
 * refusal; it does not need the sentence the provider used to say so.
 */
export type PublisherSafeDetailCode =
  | "request_timeout"
  | "network_error"
  | "rate_limited"
  | "provider_5xx"
  | "authentication_failed"
  | "model_not_available"
  | "provider_refusal"
  | "max_output_tokens_exhausted"
  | "missing_output_text"
  | "multiple_output_text"
  | "invalid_json"
  | "schema_mismatch";

/**
 * The failure arm every publisher shares.
 *
 * Deliberately not generic. The success arm is what differs between readings
 * and Patterns; the failure arm is identical, and a `PublisherFailure` is
 * assignable to any result union that includes it, so callers keep their own
 * success types without threading a type parameter through this module.
 */
export interface PublisherFailure {
  ok: false;
  code: PublisherFailureCode;
  safe_detail_code: PublisherSafeDetailCode;
  retry_after_seconds: number | null;
}

export function failure(
  code: PublisherFailureCode,
  safe_detail_code: PublisherSafeDetailCode,
  retry_after_seconds: number | null = null,
): PublisherFailure {
  return { ok: false, code, safe_detail_code, retry_after_seconds };
}

/** A whole number of seconds, or nothing. A date-formatted value is discarded. */
export function retryAfterSeconds(response: Response): number | null {
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

export type ExtractedOutputText =
  | { ok: true; text: string }
  | { ok: false; result: PublisherFailure };

/**
 * The one message item, and the one text inside it.
 *
 * `output` also carries reasoning items, which is why this walks the array
 * rather than reading `output[0]`. Two message items or two text parts are
 * treated as a defect rather than concatenated: a candidate assembled from
 * fragments is not the candidate the schema described.
 *
 * A refusal wins over any text that accompanies it. The provider declining and
 * then emitting prose anyway is the provider declining; treating the prose as a
 * candidate would publish text the model attached a refusal to, and the retry
 * policy for a refusal differs from the one for a malformed answer.
 */
export function extractOutputText(body: unknown): ExtractedOutputText {
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
  if (refused) {
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

/** Narrow a route to the direct endpoint when a deployment configures none. */
export type ResolvedRoute = AiGatewayRoute | null;
