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

import { contentHash } from "@patternlike/shared";
import {
  responsesUrlFor,
  type AiGatewayRoute,
  type ProviderCredentialMode,
} from "./reading-publisher.js";
import {
  readOpenAiIncompleteReason,
  readOpenAiResponseUsage,
} from "./openai-responses-envelope.js";

export {
  resolveAiGatewayRoute,
  responsesUrlFor,
  OPENAI_RESPONSES_URL,
  AI_GATEWAY_ORIGIN,
} from "./reading-publisher.js";
export type {
  AiGatewayRoute,
  AiGatewayOutcome,
} from "./reading-publisher.js";
export type { ProviderCredentialMode } from "./reading-publisher.js";
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

/** Details owned by the shared routed Responses transport, not daily reading. */
export type OpenAiResponsesSafeDetailCode =
  | PublisherSafeDetailCode
  | "gateway_cache_hit"
  | "gateway_dlp_match"
  | "provider_4xx"
  | "response_too_large";

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

// ---------------------------------------------------------------------------
// Reviewed one-fetch Responses transport
// ---------------------------------------------------------------------------

/**
 * Provider HTTP bytes are adversarial input. Output-token ceilings constrain a
 * conforming model response, not a peer that lies or streams forever.
 */
export const OPENAI_RESPONSES_MAX_BODY_BYTES = 1024 * 1024;

export type OpenAiResponsesOriginLayer = "provider" | "gateway" | "unknown";
export type OpenAiResponsesCacheObservation = "miss" | "missing" | "unrecognized";

export interface OpenAiResponsesMetadata {
  provider_request_id: string;
  input_tokens: number;
  output_tokens: number;
  provider_response_hash: string;
  cache_observation: OpenAiResponsesCacheObservation;
}

export type OpenAiResponsesRunResult =
  | {
      ok: true;
      parsed: unknown;
      raw: string;
      metadata: OpenAiResponsesMetadata;
    }
  | { ok: false; kind: "reservation_refused" }
  | {
      ok: false;
      kind: "failure";
      code: PublisherFailureCode;
      safe_detail_code: OpenAiResponsesSafeDetailCode;
      retry_after_seconds: number | null;
      origin_layer: OpenAiResponsesOriginLayer;
    };

export interface OpenAiResponsesRunOptions {
  credential: ProviderCredentialMode;
  route: AiGatewayRoute | null;
  timeoutMs: number;
  body: unknown;
  /** Awaited after all synchronous preparation and immediately before fetch. */
  reserve?: () => Promise<{ ok: boolean }>;
}

const CLOUDFLARE_ERROR_CODES: ReadonlySet<number> = new Set([2016, 2017, 2029, 2030]);

function transportFailure(
  code: PublisherFailureCode,
  safe_detail_code: OpenAiResponsesSafeDetailCode,
  origin_layer: OpenAiResponsesOriginLayer,
  retry_after_seconds: number | null = null,
): OpenAiResponsesRunResult {
  return {
    ok: false,
    kind: "failure",
    code,
    safe_detail_code,
    retry_after_seconds,
    origin_layer,
  };
}

function classifyOrigin(routed: boolean, body: string): OpenAiResponsesOriginLayer {
  if (!routed) return "provider";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "unknown";
  }
  const errors = (parsed as { errors?: unknown })?.errors;
  const candidates: unknown[] = Array.isArray(errors) ? errors : [parsed];
  for (const entry of candidates) {
    const code = (entry as { code?: unknown })?.code;
    if (typeof code === "number" && CLOUDFLARE_ERROR_CODES.has(code)) return "gateway";
  }
  return "unknown";
}

function readCacheObservation(
  response: Response,
): OpenAiResponsesCacheObservation | "hit" {
  const raw = response.headers.get("cf-aig-cache-status");
  if (raw === null) return "missing";
  const normalized = raw.trim().toUpperCase();
  if (normalized === "HIT") return "hit";
  if (normalized === "MISS") return "miss";
  return "unrecognized";
}

function responsesHeaders(
  credential: ProviderCredentialMode,
  route: AiGatewayRoute | null,
): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (credential.source === "worker") {
    headers.authorization = `Bearer ${credential.apiKey}`;
  }
  if (route) {
    headers["cf-aig-collect-log"] = "false";
    headers["cf-aig-max-attempts"] = "1";
    headers["cf-aig-skip-cache"] = "true";
    if (route.token) headers["cf-aig-authorization"] = `Bearer ${route.token}`;
    if (credential.source === "gateway_stored") {
      headers["cf-aig-byok-alias"] = credential.alias;
    }
  }
  return headers;
}

type BoundedBody =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "invalid_utf8" | "read_error"; aborted: boolean };

async function cancelResponseBody(
  response: Response,
  abort: () => void,
): Promise<void> {
  abort();
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Cancellation is best-effort after the response has already been refused.
  }
}

async function readBoundedBody(
  response: Response,
  signal: AbortSignal,
  abort: () => void,
): Promise<BoundedBody> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared)) {
    const parsed = Number(declared);
    if (Number.isSafeInteger(parsed) && parsed > OPENAI_RESPONSES_MAX_BODY_BYTES) {
      await cancelResponseBody(response, abort);
      return { ok: false, reason: "too_large", aborted: false };
    }
  }

  if (!response.body) return { ok: true, text: "" };
  const reader = response.body.getReader();
  // A fixed buffer bounds both byte storage and per-chunk bookkeeping. Keeping
  // every tiny chunk in an array would let a one-byte-chunk peer consume far
  // more heap than the advertised byte ceiling.
  const bytes = new Uint8Array(OPENAI_RESPONSES_MAX_BODY_BYTES);
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      if (next.value.byteLength > OPENAI_RESPONSES_MAX_BODY_BYTES - total) {
        abort();
        try {
          await reader.cancel();
        } catch {
          // The response has already been refused. No error prose survives.
        }
        return { ok: false, reason: "too_large", aborted: false };
      }
      bytes.set(next.value, total);
      total += next.value.byteLength;
    }
  } catch (error) {
    const aborted =
      signal.aborted || (error as { name?: string })?.name === "AbortError";
    return { ok: false, reason: "read_error", aborted };
  } finally {
    reader.releaseLock();
  }

  try {
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        bytes.subarray(0, total),
      ),
    };
  } catch {
    return { ok: false, reason: "invalid_utf8", aborted: false };
  }
}

/**
 * The single reviewed OpenAI Responses delivery primitive.
 *
 * It owns exact gateway headers, one fetch, one abort deadline held through
 * bounded body consumption, envelope extraction, exact-byte hashing, and safe
 * failure classification. It performs no retry.
 */
export async function runOpenAiResponsesRequest(
  options: OpenAiResponsesRunOptions,
): Promise<OpenAiResponsesRunResult> {
  if (options.credential.source === "worker" && options.credential.apiKey.trim() === "") {
    return transportFailure(
      "publisher_auth_failed",
      "authentication_failed",
      "provider",
    );
  }

  const url = responsesUrlFor(options.route);
  const headers = responsesHeaders(options.credential, options.route);
  const requestBody = JSON.stringify(options.body);

  if (options.reserve) {
    let reserved: { ok: boolean };
    try {
      reserved = await options.reserve();
    } catch {
      return { ok: false, kind: "reservation_refused" };
    }
    if (!reserved.ok) return { ok: false, kind: "reservation_refused" };
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), options.timeoutMs);
  const routed = options.route !== null;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: requestBody,
    });
  } catch (error) {
    clearTimeout(deadline);
    const aborted =
      controller.signal.aborted || (error as { name?: string })?.name === "AbortError";
    return transportFailure(
      "publisher_unavailable",
      aborted ? "request_timeout" : "network_error",
      routed ? "unknown" : "provider",
    );
  }

  if (!response.ok) {
    const retryAfter = retryAfterSeconds(response);
    let errorBody = "";
    try {
      const read = await readBoundedBody(
        response,
        controller.signal,
        () => controller.abort(),
      );
      if (read.ok) errorBody = read.text;
    } finally {
      clearTimeout(deadline);
    }
    const origin = classifyOrigin(routed, errorBody);
    if (response.status === 401 || response.status === 403) {
      return transportFailure("publisher_auth_failed", "authentication_failed", origin);
    }
    if (response.status === 404) {
      return transportFailure("publisher_model_unavailable", "model_not_available", origin);
    }
    if (response.status === 429) {
      return transportFailure("publisher_unavailable", "rate_limited", origin, retryAfter);
    }
    if (response.status >= 500) {
      return transportFailure("publisher_unavailable", "provider_5xx", origin, retryAfter);
    }
    return transportFailure("publisher_output_invalid", "provider_4xx", origin);
  }

  if (response.headers.get("cf-aig-dlp") !== null) {
    try {
      await cancelResponseBody(response, () => controller.abort());
    } finally {
      clearTimeout(deadline);
    }
    return transportFailure(
      "publisher_output_invalid",
      "gateway_dlp_match",
      "gateway",
    );
  }
  const cache = readCacheObservation(response);
  if (cache === "hit") {
    try {
      await cancelResponseBody(response, () => controller.abort());
    } finally {
      clearTimeout(deadline);
    }
    return transportFailure(
      "publisher_output_invalid",
      "gateway_cache_hit",
      "gateway",
    );
  }

  let bodyRead: BoundedBody;
  try {
    bodyRead = await readBoundedBody(
      response,
      controller.signal,
      () => controller.abort(),
    );
  } finally {
    clearTimeout(deadline);
  }
  if (!bodyRead.ok) {
    if (bodyRead.reason === "too_large") {
      return transportFailure(
        "publisher_output_invalid",
        "response_too_large",
        routed ? "unknown" : "provider",
      );
    }
    if (bodyRead.reason === "invalid_utf8") {
      return transportFailure(
        "publisher_output_invalid",
        "invalid_json",
        routed ? "unknown" : "provider",
      );
    }
    return transportFailure(
      "publisher_unavailable",
      bodyRead.aborted ? "request_timeout" : "network_error",
      routed ? "unknown" : "provider",
    );
  }

  const raw = bodyRead.text;
  const provider_response_hash = await contentHash(raw);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return transportFailure("publisher_output_invalid", "invalid_json", "provider");
  }

  const incompleteReason = readOpenAiIncompleteReason(body);
  if (incompleteReason === "max_output_tokens") {
    return transportFailure(
      "publisher_output_invalid",
      "max_output_tokens_exhausted",
      "provider",
    );
  }
  if (incompleteReason === "content_filter") {
    return transportFailure("publisher_refused", "provider_refusal", "provider");
  }
  if (incompleteReason === "unknown") {
    return transportFailure("publisher_output_invalid", "schema_mismatch", "provider");
  }

  const extracted = extractOutputText(body);
  if (!extracted.ok) {
    return transportFailure(
      extracted.result.code,
      extracted.result.safe_detail_code,
      "provider",
      extracted.result.retry_after_seconds,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.text);
  } catch {
    return transportFailure("publisher_output_invalid", "invalid_json", "provider");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return transportFailure("publisher_output_invalid", "schema_mismatch", "provider");
  }

  const responseId = (body as { id?: unknown })?.id;
  const usage = readOpenAiResponseUsage(body);
  if (
    typeof responseId !== "string" ||
    responseId.length === 0 ||
    responseId.length > 200 ||
    usage.input_tokens === null ||
    usage.output_tokens === null
  ) {
    return transportFailure("publisher_output_invalid", "schema_mismatch", "provider");
  }

  return {
    ok: true,
    parsed,
    raw,
    metadata: {
      provider_request_id: responseId,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      provider_response_hash,
      cache_observation: cache,
    },
  };
}
