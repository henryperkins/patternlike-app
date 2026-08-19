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
import { buildResponsesRequest } from "./reading-prompt.js";
import {
  readOpenAiIncompleteReason,
  readOpenAiResponseUsage,
} from "./openai-responses-envelope.js";
import {
  READING_PUBLISHER_PROVIDER,
  type PublishOptions,
  type PublisherResult,
  type ReadingPublisher,
} from "./reading-publisher.js";
import {
  extractOutputText,
  failure,
  responsesUrlFor,
  retryAfterSeconds,
  type AiGatewayRoute,
} from "./openai-responses-adapter.js";
import type { ReadingGenerationRequest } from "@patternlike/shared";

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

/**
 * @param route The resolved AI Gateway route, or `null` for the direct
 * endpoint. Required rather than defaulted, and resolved by the caller rather
 * than read from `env` here: whether a deployment proxies its provider traffic
 * is a configuration decision, and this adapter decides nothing. A default
 * would also mean a new call site could route around the gateway — and the
 * spend and log records it exists to produce — by saying nothing at all.
 */
export function createOpenAiReadingPublisher(
  env: Pick<Env, "OPENAI_API_KEY">,
  route: AiGatewayRoute | null,
): ReadingPublisher {
  const url = responsesUrlFor(route);
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

      const headers: Record<string, string> = {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      };
      if (route) {
        // Platform spec v0.2 §10: "AI Gateway logging is disabled for private
        // synthesis requests. The application records only provider/model ID,
        // latency, token counts, route version, validation result, and response
        // hash." The registry's llm_boundary says the same. Gateway logs are ON
        // by default and store the prompt and the model response verbatim —
        // which here is the reader's private context going in and their reading
        // coming out, persisted outside this Worker's encryption boundary.
        //
        // `collect-log`, not `collect-log-payload`: the latter keeps a
        // metadata-only entry, and the spec assigns that recording to the
        // application, which safeLog and ProviderMetadata already do. Turning
        // the whole entry off is what the sentence says, and it is the side to
        // err on — the gateway dashboard showing nothing is recoverable, a
        // stored reading is not.
        headers["cf-aig-collect-log"] = "false";
        // Request-level headers beat gateway settings, and that is the whole
        // point of sending all of these: they are dashboard toggles that
        // someone can turn on later, and each would quietly falsify something
        // this Worker states.
        //
        // A gateway retry turns one queue delivery into up to five provider
        // calls that reading_provider_daily_usage counts as one, which is the
        // ledger the approved daily ceiling is computed from.
        headers["cf-aig-max-attempts"] = "1";
        // A cache hit gives two readings the same provider_request_id and the
        // same provider_response_hash — stored evidence naming a generation
        // that did not happen. It costs nothing to refuse: the packet carries
        // this reader's facts and this local date, so an exact-match hit
        // between two real readings is not a case that arises.
        headers["cf-aig-skip-cache"] = "true";
        if (route.token) headers["cf-aig-authorization"] = `Bearer ${route.token}`;
      }

      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), options.timeoutMs);

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers,
          body: JSON.stringify(buildResponsesRequest(request, options.configuration)),
        });
      } catch (err) {
        clearTimeout(deadline);
        // The distinction that matters to an operator: a deadline this Worker
        // set, or a network that did not carry the request.
        const aborted = controller.signal.aborted || (err as { name?: string })?.name === "AbortError";
        return failure(
          "publisher_unavailable",
          aborted ? "request_timeout" : "network_error",
        );
      }

      if (!response.ok) {
        clearTimeout(deadline);
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
      } catch (err) {
        const aborted = controller.signal.aborted || (err as { name?: string })?.name === "AbortError";
        return failure(
          "publisher_unavailable",
          aborted ? "request_timeout" : "network_error",
        );
      } finally {
        clearTimeout(deadline);
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

      const incompleteReason = readOpenAiIncompleteReason(body);
      if (incompleteReason === "max_output_tokens") {
        // Output tokens include reasoning tokens. A high-effort reasoning pass
        // can therefore exhaust the response ceiling before the JSON document
        // closes; classify the provider stop, not the truncated text beneath it.
        return failure("publisher_output_invalid", "max_output_tokens_exhausted");
      }
      if (incompleteReason === "content_filter") {
        return failure("publisher_refused", "provider_refusal");
      }
      if (incompleteReason === "unknown") {
        return failure("publisher_output_invalid", "schema_mismatch");
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
      const responseUsage = readOpenAiResponseUsage(body);
      const inputTokens = responseUsage.input_tokens;
      const outputTokens = responseUsage.output_tokens;
      if (
        typeof responseId !== "string" ||
        responseId.length === 0 ||
        responseId.length > 200 ||
        inputTokens === null ||
        outputTokens === null
      ) {
        return failure("publisher_output_invalid", "schema_mismatch");
      }
      return {
        ok: true,
        // Returned exactly as sent. An adapter that repaired an echoed date
        // would hide the defect the validator exists to catch.
        candidate: candidate as ReadingGenerationOutput,
        metadata: {
          provider: READING_PUBLISHER_PROVIDER,
          model: options.configuration.model,
          provider_request_id: responseId,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          provider_response_hash,
        },
      };
    },
  };
}
