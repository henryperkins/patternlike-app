/**
 * The two `PatternPublisher` implementations.
 *
 * Separate from `pattern-publisher.ts` on purpose. That module is imported at
 * runtime by both `openai-pattern-publisher.ts` (for the pin) and
 * `pattern-prompt.ts` (for the compiled prompt versions), so a factory living
 * there would have to import them back and close a cycle. This module sits
 * downstream of all three and imports in one direction only.
 *
 * Budget is charged here rather than at the call site, immediately before the
 * fetch: a reservation taken at stage entry is spent by a delivery that may
 * never reach a provider. The synthetic publisher is constructed with a reserve
 * that always succeeds and never charges, because the ledger counts provider
 * calls and there is no provider.
 */

import type {
  PatternPlan,
  PatternPlannerOutput,
  PatternSemanticVerdict,
  PatternWriterOutput,
} from "@patternlike/shared";
import { contentHash } from "@patternlike/shared";
import { buildDeterministicPlan, buildDeterministicWriterOutput } from "@patternlike/pattern-engine";
import type {
  AiGatewayRoute,
  ProviderCredentialMode,
} from "./openai-responses-adapter.js";
import { createOpenAiPatternTransport } from "./openai-pattern-publisher.js";
import { evaluateSemanticVerdict } from "./pattern-semantic.js";
import {
  PATTERN_PUBLISHER_OPENAI,
  PATTERN_PUBLISHER_SYNTHETIC,
  type PatternPassOptions,
  type PatternPassOutcome,
  type PatternPublisher,
  type PatternStageClass,
} from "./pattern-publisher.js";

/** The refusal returned when the day's approved provider ceiling is spent. */
function budgetExhausted<T>(): PatternPassOutcome<T> {
  return {
    ok: false,
    code: "publisher_budget_exhausted",
    safe_detail_code: "daily_call_limit_reached",
    retry_after_seconds: null,
    origin_layer: "none",
  };
}

/**
 * The OpenAI publisher.
 *
 * One provider call per pass, charged immediately before it. A reserve refusal
 * returns before any request is built, so a spent ceiling costs nothing.
 */
export function createOpenAiPatternPublisher(
  credential: ProviderCredentialMode,
  route: AiGatewayRoute | null,
): PatternPublisher {
  const transport = createOpenAiPatternTransport(credential, route);

  async function run<T>(
    pass: PatternStageClass,
    input: unknown,
    options: PatternPassOptions,
    correction = false,
  ): Promise<PatternPassOutcome<T>> {
    const reserved = await options.reserve(pass);
    if (!reserved.ok) return budgetExhausted<T>();

    const result = await transport.run(
      pass,
      input,
      { requestId: options.requestId, timeoutMs: options.timeoutMs, configuration: options.pin },
      correction,
    );
    if (!result.ok) {
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
      // Returned exactly as parsed. The deterministic validators are what
      // decide whether it is usable; an adapter that repaired it would hide the
      // defect they exist to catch.
      value: result.parsed as T,
      raw: result.raw,
      metadata: {
        provider: PATTERN_PUBLISHER_OPENAI,
        pass,
        model: result.metadata.model,
        prompt_version: result.metadata.prompt_version,
        provider_request_id: result.metadata.provider_request_id,
        input_tokens: result.metadata.input_tokens,
        output_tokens: result.metadata.output_tokens,
        provider_response_hash: result.metadata.provider_response_hash,
      },
    };
  }

  return {
    plan: (input, options) => run<PatternPlan>("planner", input, options),
    write: (input, options) => run<PatternWriterOutput>("writer", input, options),
    verify: (input, options) => run<PatternSemanticVerdict>("verifier", input, options),
  };
}

/**
 * The deterministic stand-ins, behind the same interface.
 *
 * Q3 recorded: a document these author carries `assembly_mode:
 * "constrained_model"`, which is a `const` in both
 * `pattern-document-internal.schema.json` and `pattern-response.schema.json`.
 * Adding a `deterministic_stand_in` value would turn that `const` into an
 * `enum` and bump `schema_version` across every 0.7.0 literal in the package.
 *
 * That is not needed, because the defect cannot reach a reader:
 * `resolvePatternPublisherConfiguration` refuses `PATTERN_PUBLISHER=synthetic`
 * outside development, and `checkSecureConfig` runs it on every product request
 * and inside `queue()`. A synthetic-authored document is structurally
 * impossible in any environment serving real readers. Revisit only if the
 * synthetic publisher is ever proposed for a non-development environment --
 * which would itself be the defect.
 */
export function createSyntheticPatternPublisher(options: {
  forceReject: boolean;
  packet: unknown;
  ontology: unknown;
}): PatternPublisher {
  const provenance = (pass: PatternStageClass, pin: PatternPassOptions["pin"]) => ({
    provider: PATTERN_PUBLISHER_SYNTHETIC,
    pass,
    model: pin[`${pass}_model`],
    prompt_version: pin[`${pass}_prompt_version`],
    // No provider spoke, so there is no request id, no token count, and no
    // response to hash. Null rather than a zero or an empty string: a reader of
    // this record must be able to tell "not applicable" from "measured as none".
    provider_request_id: null,
    input_tokens: null,
    output_tokens: null,
    provider_response_hash: null,
  });

  return {
    async plan(_input, passOptions) {
      const planner = buildDeterministicPlan(
        options.packet as never,
        options.ontology as never,
      ) as PatternPlannerOutput;
      const plan: PatternPlan = {
        ...planner,
        plan_hash: await contentHash(JSON.stringify(planner)),
        sparse_pattern: false,
      };
      return {
        ok: true,
        value: plan,
        raw: null,
        metadata: provenance("planner", passOptions.pin),
      };
    },

    async write(input, passOptions) {
      const plan = (input as { plan?: PatternPlan }).plan ?? (input as PatternPlan);
      const writer = buildDeterministicWriterOutput(
        plan as never,
        options.packet as never,
        options.ontology as never,
      ) as PatternWriterOutput;
      return {
        ok: true,
        value: writer,
        raw: null,
        metadata: provenance("writer", passOptions.pin),
      };
    },

    async verify(input, passOptions) {
      const candidate =
        (input as { candidate?: PatternWriterOutput }).candidate ?? (input as PatternWriterOutput);
      return {
        ok: true,
        value: evaluateSemanticVerdict(candidate, { forceReject: options.forceReject }),
        raw: null,
        metadata: provenance("verifier", passOptions.pin),
      };
    },
  };
}
