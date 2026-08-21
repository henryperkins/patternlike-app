/** Thin ontology projection over the shared reviewed Responses transport. */

import {
  runOpenAiResponsesRequest,
  type AiGatewayRoute,
  type ProviderCredentialMode,
} from "./openai-responses-adapter.js";
import type {
  OntologyEvaluatorPacket,
  OntologyGeneratorPacket,
} from "./ontology-packet.js";
import {
  buildOntologyEvaluatorResponsesRequest,
  buildOntologyGeneratorResponsesRequest,
  isOntologyGenerationChunk,
  isOntologyRuleVerdict,
} from "./ontology-prompt.js";
import type {
  OntologyGenerationChunk,
  OntologyPassOptions,
  OntologyPassOutcome,
  OntologyPublisher,
  OntologyRuleVerdict,
} from "./ontology-publisher.js";

function budgetExhausted<T>(): OntologyPassOutcome<T> {
  return {
    ok: false,
    code: "publisher_budget_exhausted",
    safe_detail_code: "daily_call_limit_reached",
    retry_after_seconds: null,
    origin_layer: "none",
  };
}

function schemaMismatch<T>(): OntologyPassOutcome<T> {
  return {
    ok: false,
    code: "publisher_output_invalid",
    safe_detail_code: "schema_mismatch",
    retry_after_seconds: null,
    origin_layer: "provider",
  };
}

export function createOpenAiOntologyPublisher(
  credential: ProviderCredentialMode,
  route: AiGatewayRoute | null,
): OntologyPublisher {
  return {
    async generate(
      packet: OntologyGeneratorPacket,
      options: OntologyPassOptions,
    ): Promise<OntologyPassOutcome<OntologyGenerationChunk>> {
      const result = await runOpenAiResponsesRequest({
        credential,
        route,
        timeoutMs: options.timeoutMs,
        body: buildOntologyGeneratorResponsesRequest(
          packet.serialized,
          options.configuration,
        ),
        reserve: () => options.reserve("generator"),
      });
      if (!result.ok) {
        if (result.kind === "reservation_refused") {
          return budgetExhausted<OntologyGenerationChunk>();
        }
        return {
          ok: false,
          code: result.code,
          safe_detail_code: result.safe_detail_code,
          retry_after_seconds: result.retry_after_seconds,
          origin_layer: result.origin_layer,
        };
      }
      if (!isOntologyGenerationChunk(result.parsed)) {
        return schemaMismatch<OntologyGenerationChunk>();
      }
      return {
        ok: true,
        value: result.parsed,
        raw: result.raw,
        metadata: {
          provider: "openai",
          pass: "generator",
          model: options.configuration.generator_model,
          prompt_version: options.configuration.generator_prompt_version,
          provider_request_id: result.metadata.provider_request_id,
          input_tokens: result.metadata.input_tokens,
          output_tokens: result.metadata.output_tokens,
          provider_response_hash: result.metadata.provider_response_hash,
        },
      };
    },

    async evaluate(
      packet: OntologyEvaluatorPacket,
      options: OntologyPassOptions,
    ): Promise<OntologyPassOutcome<OntologyRuleVerdict>> {
      const result = await runOpenAiResponsesRequest({
        credential,
        route,
        timeoutMs: options.timeoutMs,
        body: buildOntologyEvaluatorResponsesRequest(
          packet.serialized,
          options.configuration,
        ),
        reserve: () => options.reserve("evaluator"),
      });
      if (!result.ok) {
        if (result.kind === "reservation_refused") {
          return budgetExhausted<OntologyRuleVerdict>();
        }
        return {
          ok: false,
          code: result.code,
          safe_detail_code: result.safe_detail_code,
          retry_after_seconds: result.retry_after_seconds,
          origin_layer: result.origin_layer,
        };
      }
      if (
        !isOntologyRuleVerdict(result.parsed) ||
        result.parsed.rule_id !== packet.document.rule.id
      ) {
        return schemaMismatch<OntologyRuleVerdict>();
      }
      return {
        ok: true,
        value: result.parsed,
        raw: result.raw,
        metadata: {
          provider: "openai",
          pass: "evaluator",
          model: options.configuration.evaluator_model,
          prompt_version: options.configuration.evaluator_prompt_version,
          provider_request_id: result.metadata.provider_request_id,
          input_tokens: result.metadata.input_tokens,
          output_tokens: result.metadata.output_tokens,
          provider_response_hash: result.metadata.provider_response_hash,
        },
      };
    },
  };
}
