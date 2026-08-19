/**
 * The Pattern provider boundary, for all three passes.
 *
 * One request per pass: headers, one `AbortController`, one fetch,
 * hash-before-parse, an ordered post-200 gauntlet, and a typed result. It
 * performs no retry of its own, on any status, because one queue delivery is one
 * provider call — the attempt ceilings live in the Worker, not here.
 *
 * The adapter decides nothing. Retry class, budget, artifact writes,
 * publication, and logging all belong to the caller. Nothing from the provider
 * crosses back except the parsed document, the exact bytes, and closed metadata:
 * no header, URL, error message, or exception string reaches a result or a log.
 *
 * Unlike the reading adapter the response bytes are NOT discarded here. Task 6
 * writes them to the encrypted response artifact and a redelivery may adopt
 * them, so `raw` travels with the parsed document and the caller drops it once
 * R2 has committed. It must never reach a failure detail.
 */

import { contentHash } from "@patternlike/shared";
import {
  extractOutputText,
  responsesUrlFor,
  retryAfterSeconds,
  type AiGatewayRoute,
  type PublisherFailureCode,
  type ProviderCredentialMode,
  type PublisherSafeDetailCode,
} from "./openai-responses-adapter.js";
import {
  readOpenAiIncompleteReason,
  readOpenAiResponseUsage,
} from "./openai-responses-envelope.js";
import { buildPatternResponsesRequest, type PatternPass } from "./pattern-prompt.js";
import { PATTERN_PUBLISHER_OPENAI, type PatternPublisherPin } from "./pattern-publisher.js";

/**
 * Two details the reading vocabulary has no member for, kept Pattern-local.
 *
 * Widening `PublisherSafeDetailCode` itself would change a union the live daily
 * reading path consumes, for two cases only a gateway can produce.
 */
export type PatternSafeDetailCode =
  | PublisherSafeDetailCode
  | "gateway_cache_hit"
  | "gateway_dlp_match";

/**
 * Which layer produced a non-2xx.
 *
 * Not decorative. With a gateway in the path a `429` is either an OpenAI rate
 * limit (transient, retry later) or a Cloudflare spend limit (futile until an
 * operator raises the budget), and a `401` is either a bad provider credential
 * or a bad `cf-aig-authorization` — different remedies behind identical statuses.
 * Cloudflare publishes no universal gateway-error body, so `unknown` is the
 * honest answer everywhere the evidence does not reach.
 */
export type PatternOriginLayer = "provider" | "gateway" | "unknown";

/** Whether the gateway served this from cache, as a closed observation. */
export type PatternCacheObservation = "miss" | "missing" | "unrecognized";

export interface PatternPassMetadata {
  provider: typeof PATTERN_PUBLISHER_OPENAI;
  pass: PatternPass;
  model: string;
  prompt_version: string;
  provider_request_id: string;
  input_tokens: number;
  output_tokens: number;
  /** Digest of the exact response bytes, taken before anything was parsed. */
  provider_response_hash: string;
  cache_observation: PatternCacheObservation;
}

export type PatternPassResult =
  | {
      ok: true;
      /** The document the model returned, parsed but not repaired. */
      parsed: unknown;
      /** The exact response bytes. Task 6 stores these; never log them. */
      raw: string;
      metadata: PatternPassMetadata;
    }
  | {
      ok: false;
      code: PublisherFailureCode;
      safe_detail_code: PatternSafeDetailCode;
      retry_after_seconds: number | null;
      origin_layer: PatternOriginLayer;
    };

export interface PatternPassOptions {
  /** The Worker's own correlation id. Never sent to the provider. */
  requestId: string;
  timeoutMs: number;
  configuration: PatternPublisherPin;
}

export interface OpenAiPatternTransport {
  run(
    pass: PatternPass,
    document: unknown,
    options: PatternPassOptions,
    correction?: boolean,
  ): Promise<PatternPassResult>;
}

/**
 * Cloudflare error codes with a documented meaning: Guardrails (2016, 2017) and
 * DLP (2029, 2030).
 *
 * A closed allowlist rather than "the response carried a numeric code": a
 * provider can return one too, and an undocumented future code has no reviewed
 * meaning, so treating numerics generically would manufacture a gateway
 * attribution out of nothing.
 */
const CLOUDFLARE_ERROR_CODES: ReadonlySet<number> = new Set([2016, 2017, 2029, 2030]);

function fail(
  code: PublisherFailureCode,
  safe_detail_code: PatternSafeDetailCode,
  origin_layer: PatternOriginLayer,
  retry_after_seconds: number | null = null,
): PatternPassResult {
  return { ok: false, code, safe_detail_code, retry_after_seconds, origin_layer };
}

/**
 * Classify a non-2xx by layer, reading only a numeric code out of the body.
 *
 * The body is parsed and discarded. No message text is retained, compared, or
 * returned — the only value that survives this function is a boolean about
 * membership in the allowlist above.
 */
function classifyOrigin(routed: boolean, body: string): PatternOriginLayer {
  // A direct response has no gateway in the path, so the provider is the only
  // thing that could have produced it.
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

function readCacheObservation(response: Response): PatternCacheObservation | "hit" {
  const raw = response.headers.get("cf-aig-cache-status");
  if (raw === null) return "missing";
  const normalized = raw.trim().toUpperCase();
  if (normalized === "HIT") return "hit";
  if (normalized === "MISS") return "miss";
  return "unrecognized";
}

/**
 * @param route The resolved AI Gateway route, or `null` for the direct
 * endpoint. Required rather than defaulted, and resolved by the caller: whether
 * a deployment proxies its provider traffic is a configuration decision, and a
 * default would let a new call site route around the gateway — and the spend and
 * log records it exists to produce — by saying nothing at all.
 */
export function createOpenAiPatternTransport(
  credential: ProviderCredentialMode,
  route: AiGatewayRoute | null,
): OpenAiPatternTransport {
  const url = responsesUrlFor(route);

  return {
    async run(
      pass: PatternPass,
      document: unknown,
      options: PatternPassOptions,
      correction = false,
    ): Promise<PatternPassResult> {
      // An allowlist by construction. Every name here is one of seven; a header
      // added later has to be added here too, which is the point.
      if (credential.source === "worker" && credential.apiKey.trim() === "") {
        // Refused here rather than sent as an empty Authorization header: a 401
        // costs a round trip to learn what this Worker already knows. The
        // configuration layer refuses this too, so reaching here means a caller
        // constructed the mode by hand.
        return fail("publisher_auth_failed", "authentication_failed", "provider");
      }

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (credential.source === "worker") {
        headers.authorization = `Bearer ${credential.apiKey}`;
      }
      if (route) {
        // Gateway logs are on by default and store the prompt and the model
        // response verbatim — here, a reader's calculated pattern going in and
        // their Pattern prose coming out, persisted outside this Worker's
        // encryption boundary. `collect-log`, not `collect-log-payload`: the
        // latter keeps a metadata-only entry, and metadata recording is already
        // this Worker's job.
        headers["cf-aig-collect-log"] = "false";
        // A gateway retry turns one queue delivery into up to five provider
        // calls that the usage ledger counts as one.
        headers["cf-aig-max-attempts"] = "1";
        // A cache hit would give two Patterns one provider_request_id and one
        // provider_response_hash — stored evidence naming a generation that did
        // not happen.
        headers["cf-aig-skip-cache"] = "true";
        if (route.token) headers["cf-aig-authorization"] = `Bearer ${route.token}`;
        // Sent ONLY in stored mode. The absence of a provider Authorization
        // header above is what lets the stored key win under credential
        // precedence; the alias names which stored key, rather than leaving it
        // to the implicit `default`.
        if (credential.source === "gateway_stored") {
          headers["cf-aig-byok-alias"] = credential.alias;
        }
      }

      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), options.timeoutMs);
      const routed = route !== null;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers,
          body: JSON.stringify(
            buildPatternResponsesRequest(pass, document, options.configuration, { correction }),
          ),
        });
      } catch (err) {
        clearTimeout(deadline);
        const aborted =
          controller.signal.aborted || (err as { name?: string })?.name === "AbortError";
        return fail(
          "publisher_unavailable",
          aborted ? "request_timeout" : "network_error",
          routed ? "unknown" : "provider",
        );
      }

      if (!response.ok) {
        const retryAfter = retryAfterSeconds(response);
        // Read once, for the numeric code only. Nothing else survives.
        //
        // The deadline stays ARMED across this read and is cleared in `finally`.
        // Clearing it first disarms the only `controller.abort()` in the
        // function, and a peer that sends non-2xx headers and then stalls the
        // body — a chunked response with no terminating chunk, a common proxy
        // failure — would park this await forever: no timer left to fire, no
        // other cancellation source, so `run()` never yields its typed failure
        // and the claimed job holds its lease and its already-spent budget until
        // the queue consumer is killed.
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch {
          // Aborted by the deadline, or the body never arrived. The status is
          // already known and still classifies the failure; only the origin
          // degrades, because the Cloudflare code was in the bytes we did not get.
          errorBody = "";
        } finally {
          clearTimeout(deadline);
        }
        const origin = classifyOrigin(routed, errorBody);

        if (response.status === 401 || response.status === 403) {
          return fail("publisher_auth_failed", "authentication_failed", origin);
        }
        if (response.status === 404) {
          // The configured model is gone, or the path is wrong. Not retryable:
          // the frozen command names this model and no other.
          return fail("publisher_model_unavailable", "model_not_available", origin);
        }
        if (response.status === 429) {
          return fail("publisher_unavailable", "rate_limited", origin, retryAfter);
        }
        if (response.status >= 500) {
          return fail("publisher_unavailable", "provider_5xx", origin, retryAfter);
        }
        // Any other 4xx is a request this adapter built wrong, which a retry
        // reproduces exactly.
        return fail("publisher_output_invalid", "schema_mismatch", origin);
      }

      // A DLP match proves an undisclosed inspector processed this request or
      // response. Its absence does not prove DLP is off, which is why the
      // dashboard gate stays mandatory — but its presence is decisive.
      if (response.headers.get("cf-aig-dlp") !== null) {
        clearTimeout(deadline);
        return fail("publisher_output_invalid", "gateway_dlp_match", "gateway");
      }

      const cache = readCacheObservation(response);
      if (cache === "hit") {
        clearTimeout(deadline);
        return fail("publisher_output_invalid", "gateway_cache_hit", "gateway");
      }

      let raw: string;
      try {
        raw = await response.text();
      } catch (err) {
        const aborted =
          controller.signal.aborted || (err as { name?: string })?.name === "AbortError";
        return fail(
          "publisher_unavailable",
          aborted ? "request_timeout" : "network_error",
          routed ? "unknown" : "provider",
        );
      } finally {
        clearTimeout(deadline);
      }

      // Hashed BEFORE anything is parsed out of it. The digest is what lets
      // stored evidence name the exact response that won publication.
      const provider_response_hash = await contentHash(raw);

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return fail("publisher_output_invalid", "invalid_json", "provider");
      }

      const incompleteReason = readOpenAiIncompleteReason(body);
      if (incompleteReason === "max_output_tokens") {
        // Output tokens include reasoning tokens, so a high-effort pass can
        // exhaust the ceiling before the JSON document closes. Classify the
        // provider's stop, not the truncated text beneath it.
        return fail("publisher_output_invalid", "max_output_tokens_exhausted", "provider");
      }
      if (incompleteReason === "content_filter") {
        return fail("publisher_refused", "provider_refusal", "provider");
      }
      if (incompleteReason === "unknown") {
        return fail("publisher_output_invalid", "schema_mismatch", "provider");
      }

      const extracted = extractOutputText(body);
      if (!extracted.ok) {
        return fail(
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
        return fail("publisher_output_invalid", "invalid_json", "provider");
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return fail("publisher_output_invalid", "schema_mismatch", "provider");
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
        return fail("publisher_output_invalid", "schema_mismatch", "provider");
      }

      return {
        ok: true,
        // Returned exactly as sent. An adapter that repaired a malformed
        // document would hide the defect the validators exist to catch.
        parsed,
        raw,
        metadata: {
          provider: PATTERN_PUBLISHER_OPENAI,
          pass,
          model: options.configuration[`${pass}_model`],
          prompt_version: options.configuration[`${pass}_prompt_version`],
          provider_request_id: responseId,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          provider_response_hash,
          cache_observation: cache,
        },
      };
    },
  };
}
