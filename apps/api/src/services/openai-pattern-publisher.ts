/**
 * Pattern-specific projection over the reviewed shared Responses transport.
 *
 * Request/header/deadline/body/envelope/error logic lives in
 * `openai-responses-adapter.ts`; this file owns only Pattern request building
 * and Pattern provenance. No retry is performed here or in the shared adapter.
 */

import {
  runOpenAiResponsesRequest,
  type AiGatewayRoute,
  type OpenAiResponsesCacheObservation,
  type OpenAiResponsesOriginLayer,
  type OpenAiResponsesSafeDetailCode,
  type ProviderCredentialMode,
  type PublisherFailureCode,
} from "./openai-responses-adapter.js";
import { buildPatternResponsesRequest, type PatternPass } from "./pattern-prompt.js";
import {
  PATTERN_PUBLISHER_OPENAI,
  type PatternPublisherPin,
} from "./pattern-publisher.js";

export type PatternSafeDetailCode = OpenAiResponsesSafeDetailCode;
export type PatternOriginLayer = OpenAiResponsesOriginLayer;
export type PatternCacheObservation = OpenAiResponsesCacheObservation;

export interface PatternPassMetadata {
  provider: typeof PATTERN_PUBLISHER_OPENAI;
  pass: PatternPass;
  model: string;
  prompt_version: string;
  provider_request_id: string;
  input_tokens: number;
  output_tokens: number;
  provider_response_hash: string;
  cache_observation: PatternCacheObservation;
}

export type PatternPassResult =
  | {
      ok: true;
      parsed: unknown;
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

function impossibleReservationFailure(): PatternPassResult {
  // Pattern reserves in its publisher factory and never passes a reservation
  // callback to the transport. This arm exists only because the shared helper
  // supports the ontology publisher's immediately-before-fetch seam.
  return {
    ok: false,
    code: "publisher_unavailable",
    safe_detail_code: "network_error",
    retry_after_seconds: null,
    origin_layer: "unknown",
  };
}

export function createOpenAiPatternTransport(
  credential: ProviderCredentialMode,
  route: AiGatewayRoute | null,
): OpenAiPatternTransport {
  return {
    async run(
      pass: PatternPass,
      document: unknown,
      options: PatternPassOptions,
      correction = false,
    ): Promise<PatternPassResult> {
      const result = await runOpenAiResponsesRequest({
        credential,
        route,
        timeoutMs: options.timeoutMs,
        body: buildPatternResponsesRequest(
          pass,
          document,
          options.configuration,
          { correction },
        ),
      });
      if (!result.ok) {
        if (result.kind === "reservation_refused") {
          return impossibleReservationFailure();
        }
        return {
          ok: false,
          code: result.code,
          safe_detail_code: result.safe_detail_code,
          retry_after_seconds: result.retry_after_seconds,
          origin_layer: result.origin_layer,
        };
      }
      return {
        ok: true,
        parsed: result.parsed,
        raw: result.raw,
        metadata: {
          provider: PATTERN_PUBLISHER_OPENAI,
          pass,
          model: options.configuration[`${pass}_model`],
          prompt_version: options.configuration[`${pass}_prompt_version`],
          provider_request_id: result.metadata.provider_request_id,
          input_tokens: result.metadata.input_tokens,
          output_tokens: result.metadata.output_tokens,
          provider_response_hash: result.metadata.provider_response_hash,
          cache_observation: result.metadata.cache_observation,
        },
      };
    },
  };
}
