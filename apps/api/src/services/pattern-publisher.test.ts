import { describe, expect, it } from "vitest";

import {
  createOpenAiPatternPublisher,
  createSyntheticPatternPublisher,
} from "./pattern-publisher-factory.js";
import {
  OPENAI_PATTERN_VERIFIER_MODEL,
  OPENAI_PATTERN_VERIFIER_PROMPT_VERSION,
  OPENAI_PATTERN_WRITER_MODEL,
  OPENAI_PATTERN_WRITER_PROMPT_VERSION,
  resolvePatternPublisherConfiguration,
  verifierIndependenceProblem,
  type PatternPassOptions,
  type PatternPublisherPin,
} from "./pattern-publisher.js";
import { checkSecureConfig } from "../middleware/config-guard.js";

/** A fully configured OpenAI Pattern environment, for mutation in each case. */
function env(overrides: Record<string, string | undefined> = {}) {
  return {
    ENVIRONMENT: "production",
    PATTERN_AI_ROLLOUT: "internal",
    PATTERN_PUBLISHER: "openai",
    PATTERN_DAILY_PROVIDER_CALL_LIMIT: "100",
    PATTERN_INPUT_MAX_BYTES: "98304",
    PATTERN_ARTIFACT_RETENTION_DAYS: "30",
    OPENAI_API_KEY: "sk-test",
    OPENAI_CREDENTIAL_SOURCE: "worker",
    OPENAI_PATTERN_PLANNER_MODEL: "gpt-5.6-sol",
    OPENAI_PATTERN_PLANNER_REASONING: "high",
    OPENAI_PATTERN_PLANNER_PROMPT_VERSION: "1.0.0",
    OPENAI_PATTERN_PLANNER_TIMEOUT_MS: "120000",
    OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS: "32000",
    OPENAI_PATTERN_WRITER_MODEL: "gpt-5.6-sol",
    OPENAI_PATTERN_WRITER_REASONING: "high",
    OPENAI_PATTERN_WRITER_PROMPT_VERSION: "1.0.0",
    OPENAI_PATTERN_WRITER_TIMEOUT_MS: "120000",
    OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS: "32000",
    OPENAI_PATTERN_VERIFIER_MODEL: "gpt-5.6-sol",
    OPENAI_PATTERN_VERIFIER_REASONING: "high",
    OPENAI_PATTERN_VERIFIER_PROMPT_VERSION: "1.0.0-verifier",
    OPENAI_PATTERN_VERIFIER_TIMEOUT_MS: "120000",
    OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS: "32000",
    ...overrides,
  } as never;
}

function pin(): PatternPublisherPin {
  return {
    publisher: "synthetic",
    planner_model: "gpt-5.6-sol",
    planner_reasoning: "high",
    planner_prompt_version: "1.0.0",
    planner_max_output_tokens: 4000,
    writer_model: "gpt-5.6-sol",
    writer_reasoning: "high",
    writer_prompt_version: "1.0.0",
    writer_max_output_tokens: 8000,
    verifier_model: "gpt-5.6-sol",
    verifier_reasoning: "high",
    verifier_prompt_version: "1.0.0-verifier",
    verifier_max_output_tokens: 4000,
    input_max_bytes: 98_304,
    selection_policy_version: "1.0.0",
    validation_policy_version: "1.0.0",
  };
}

const PACKET = {
  schema_version: "0.7.0",
  locale: "en-US",
  effective_accuracy: "exact",
  uncertainty: { suppressed_classes: [], required_language_rule_ids: [] },
  features: [
    {
      alias: "f001",
      feature_class: "position",
      fact: { body: "sun", longitude: 1, sign: 1, house: 1 },
      coverage: "mandatory_core",
      ontology_rule_ids: ["ont.a"],
      cluster_ids: ["c1"],
    },
  ],
  clusters: [{ cluster_id: "c1", feature_aliases: ["f001"], compatible_with: [] }],
  selection_constraints: {
    core_chapters_min: 4,
    core_chapters_max: 6,
    additional_signatures_max: 8,
    sparse_pattern: false,
  },
};

const ONTOLOGY = [
  {
    id: "ont.a",
    meaning_class: "source_supported",
    locale: "en-US",
    feature_predicate: { type: "position", body: "sun" },
    normalized_proposition: "A directness.",
    source_fragment_ids: [],
    input_meaning_ids: [],
    transformation_class: null,
    tensions: [],
    counter_expressions: [],
    prohibited_claims: [],
    salience_band: "high",
    presentation_priority: 1,
    cluster_tags: [],
  },
];

function options(reserveOk = true): PatternPassOptions {
  return {
    requestId: "req-1",
    timeoutMs: 1000,
    pin: pin(),
    reserve: async () => ({ ok: reserveOk }),
  };
}

describe("Pattern publisher configuration", () => {
  it("accepts a fully configured OpenAI deployment", () => {
    const outcome = resolvePatternPublisherConfiguration(env());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.config?.pin.publisher).toBe("openai");
  });

  it("refuses the experimental Workers AI publisher outside development", () => {
    const outcome = resolvePatternPublisherConfiguration(
      env({ PATTERN_PUBLISHER: "workers_ai" }),
    );
    expect(outcome).toEqual({
      ok: false,
      code: "pattern_publisher_misconfigured",
      message: "PATTERN_PUBLISHER=workers_ai is refused outside development",
    });
  });

  describe("verifier independence (section 14.2)", () => {
    it("refuses a verifier whose model AND prompt version both match the writer's", () => {
      // Checked against the compiled constants, not the environment: the env
      // values are already pinned to these constants for equality, so an
      // operator cannot make them collide. What was unguarded was a source edit
      // making the two literals equal, after which one model configuration is
      // sole author and judge with every pin check still passing.
      expect(
        verifierIndependenceProblem("gpt-5.6-sol", "1.0.0", "gpt-5.6-sol", "1.0.0"),
      ).toContain("must differ from the writer");
    });

    it("accepts a difference in either the model or the prompt version", () => {
      expect(verifierIndependenceProblem("gpt-5.6-sol", "1.0.0", "gpt-5.6-sol", "1.0.0-v")).toBeNull();
      expect(verifierIndependenceProblem("gpt-5.6-sol", "1.0.0", "other-model", "1.0.0")).toBeNull();
    });

    it("holds for the constants this build actually ships", () => {
      // The invariant, asserted against the real values rather than a fixture.
      expect(
        verifierIndependenceProblem(
          OPENAI_PATTERN_WRITER_MODEL,
          OPENAI_PATTERN_WRITER_PROMPT_VERSION,
          OPENAI_PATTERN_VERIFIER_MODEL,
          OPENAI_PATTERN_VERIFIER_PROMPT_VERSION,
        ),
      ).toBeNull();
      expect(resolvePatternPublisherConfiguration(env()).ok).toBe(true);
    });
  });

  describe("gateway configuration", () => {
    it("refuses a half-configured gateway pair rather than falling back to the direct origin", () => {
      const outcome = resolvePatternPublisherConfiguration(
        env({ AI_GATEWAY_ACCOUNT_ID: "a".repeat(32) }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.message).toContain("must be set together");
    });

    it("refuses a malformed account id", () => {
      const outcome = resolvePatternPublisherConfiguration(
        env({ AI_GATEWAY_ACCOUNT_ID: "NOT-HEX", AI_GATEWAY_ID: "patternlike" }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.message).toContain("32 lowercase hexadecimal");
    });

    it("accepts a complete pair", () => {
      const outcome = resolvePatternPublisherConfiguration(
        env({ AI_GATEWAY_ACCOUNT_ID: "a".repeat(32), AI_GATEWAY_ID: "patternlike" }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      // Carried on the config, not re-resolved at the call site: the adapter is
      // handed a route explicitly rather than defaulting to the direct origin.
      expect(outcome.config?.gatewayRoute).toEqual({
        accountId: "a".repeat(32),
        gatewayId: "patternlike",
        token: null,
      });
    });
  });

  describe("provider credential mode", () => {
    it("refuses an openai pin with no credential source rather than inferring one", () => {
      const outcome = resolvePatternPublisherConfiguration(
        env({ OPENAI_CREDENTIAL_SOURCE: undefined }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.message).toContain("OPENAI_CREDENTIAL_SOURCE is required");
    });

    it("carries the worker credential on the config", () => {
      const outcome = resolvePatternPublisherConfiguration(env());
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.config?.credential).toEqual({ source: "worker", apiKey: "sk-test" });
    });

    it("resolves gateway_stored, which requires the key to be ABSENT", () => {
      // The regression this pins: requiring OPENAI_API_KEY for the openai pin
      // made BYOK unreachable, because a key on the request wins over the
      // gateway-stored one and `resolveProviderCredentialMode` refuses both.
      const outcome = resolvePatternPublisherConfiguration(
        env({
          OPENAI_CREDENTIAL_SOURCE: "gateway_stored",
          OPENAI_API_KEY: undefined,
          OPENAI_GATEWAY_KEY_ALIAS: "pattern-key",
          AI_GATEWAY_ACCOUNT_ID: "a".repeat(32),
          AI_GATEWAY_ID: "patternlike",
          AI_GATEWAY_TOKEN: "aig-token",
        }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.config?.credential).toEqual({
        source: "gateway_stored",
        alias: "pattern-key",
      });
    });

    it("refuses gateway_stored while a worker key is still set", () => {
      const outcome = resolvePatternPublisherConfiguration(
        env({
          OPENAI_CREDENTIAL_SOURCE: "gateway_stored",
          OPENAI_GATEWAY_KEY_ALIAS: "pattern-key",
          AI_GATEWAY_ACCOUNT_ID: "a".repeat(32),
          AI_GATEWAY_ID: "patternlike",
          AI_GATEWAY_TOKEN: "aig-token",
        }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.message).toContain("OPENAI_API_KEY must not be set");
    });

    it("leaves the synthetic pin with no credential at all", () => {
      const outcome = resolvePatternPublisherConfiguration(
        env({ ENVIRONMENT: "development", PATTERN_PUBLISHER: "synthetic" }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.config?.credential).toBeNull();
      expect(outcome.config?.gatewayRoute).toBeNull();
    });
  });

  describe("Q3: the synthetic publisher cannot serve a reader", () => {
    it("refuses PATTERN_PUBLISHER=synthetic outside development", () => {
      // The enforcement boundary that makes the assembly_mode const safe: a
      // stand-in-authored document is structurally impossible where readers are.
      const outcome = resolvePatternPublisherConfiguration(
        env({ PATTERN_PUBLISHER: "synthetic" }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.message).toContain("refused outside development");
    });

    it("is reached by checkSecureConfig, so every request refuses", () => {
      const failure = checkSecureConfig(
        env({
          PATTERN_PUBLISHER: "synthetic",
          AUTH_STUB: "0",
          ROOT_KEK: "x".repeat(48),
          OIDC_ISSUER: "https://real.example.com/",
          OIDC_AUDIENCE: "aud",
          OIDC_JWKS_URL: "https://real.example.com/.well-known/jwks.json",
        }),
      );
      expect(failure).not.toBeNull();
    });

    it("allows it in development", () => {
      const outcome = resolvePatternPublisherConfiguration(
        env({ PATTERN_PUBLISHER: "synthetic", ENVIRONMENT: "development" }),
      );
      expect(outcome.ok).toBe(true);
    });
  });
});

describe("Pattern publisher factories", () => {
  describe("budget", () => {
    it("charges before the request and makes no call when the ceiling is spent", async () => {
      let fetched = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        fetched += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;
      try {
        const publisher = createOpenAiPatternPublisher({ source: "worker" as const, apiKey: "sk-test" }, null);
        const result = await publisher.plan({}, options(false));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("publisher_budget_exhausted");
        // A spent ceiling costs nothing: no request is built at all.
        expect(fetched).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("charges the stage class of the pass being run", async () => {
      const charged: string[] = [];
      const publisher = createSyntheticPatternPublisher({
        forceReject: false,
        packet: PACKET,
        ontology: ONTOLOGY,
      });
      const opts: PatternPassOptions = {
        ...options(),
        reserve: async (stageClass) => {
          charged.push(stageClass);
          return { ok: true };
        },
      };
      // The synthetic publisher never charges: the ledger counts provider
      // calls, and there is no provider.
      await publisher.plan({}, opts);
      await publisher.verify({ candidate: { chapters: [{}] } }, opts);
      expect(charged).toEqual([]);
    });
  });

  describe("synthetic publisher", () => {
    it("produces a plan with a hash and a writer document behind the interface", async () => {
      const publisher = createSyntheticPatternPublisher({
        forceReject: false,
        packet: PACKET,
        ontology: ONTOLOGY,
      });
      const planned = await publisher.plan({}, options());
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      expect(planned.value.plan_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      // No provider spoke, so provenance says so rather than reporting zeros.
      expect(planned.raw).toBeNull();
      expect(planned.metadata.provider).toBe("synthetic");
      expect(planned.metadata.provider_request_id).toBeNull();
      expect(planned.metadata.input_tokens).toBeNull();

      const written = await publisher.write({ plan: planned.value }, options());
      expect(written.ok).toBe(true);
      if (!written.ok) return;
      expect(written.value.schema_version).toBe("0.7.0");
    });

    it("honours the forced-rejection escape it was constructed with", async () => {
      const candidate = { chapters: [{ chapter_key: "chapter_01" }] } as never;
      const passing = createSyntheticPatternPublisher({
        forceReject: false,
        packet: PACKET,
        ontology: ONTOLOGY,
      });
      const rejecting = createSyntheticPatternPublisher({
        forceReject: true,
        packet: PACKET,
        ontology: ONTOLOGY,
      });

      const a = await passing.verify({ candidate }, options());
      const b = await rejecting.verify({ candidate }, options());
      expect(a.ok && a.value.verdict).toBe("pass");
      expect(b.ok && b.value.verdict).toBe("reject");
      if (b.ok) expect(b.value.findings[0]?.code).toBe("semantic_verification_failed");
    });

    it("rejects an empty candidate without the escape", async () => {
      const publisher = createSyntheticPatternPublisher({
        forceReject: false,
        packet: PACKET,
        ontology: ONTOLOGY,
      });
      const result = await publisher.verify({ candidate: { chapters: [] } }, options());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.verdict).toBe("reject");
    });
  });
});
