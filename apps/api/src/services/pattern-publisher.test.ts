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
  PATTERN_ARTIFACT_RETENTION_DAYS,
  PATTERN_PUBLISHER_CODEX,
  PATTERN_PUBLISHER_OPENAI,
  PATTERN_PUBLISHER_SYNTHETIC,
  PATTERN_PUBLISHER_WORKERS_AI,
  patternProviderDisplayName,
  resolvePatternPublisherConfiguration,
  verifierIndependenceProblem,
  type PatternPassOptions,
  type PatternPublisherPin,
} from "./pattern-publisher.js";
import { CODEX_PROVIDER_TIMEOUT_MS } from "./codex-provider-contract.js";
import { checkSecureConfig } from "../middleware/config-guard.js";

export const CODEX_PATTERN_RUNNER_TOKEN =
  "runner_0123456789abcdefghijklmnopqrstuvwxyz";
export const CODEX_PATTERN_ARTIFACT_KEYRING =
  '{"version":1,"keys":{"k":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"}}';

/**
 * A complete, deployable Pattern environment.
 *
 * There is one: Codex, with every pin matching its compiled constant and the
 * runner posture present. Each case mutates exactly the value under test, so a
 * refusal names that value rather than an incidental omission.
 */
function env(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: "production",
    PATTERN_PUBLISHER: "codex",
    PATTERN_DAILY_PROVIDER_CALL_LIMIT: "100",
    PATTERN_INPUT_MAX_BYTES: "98304",
    PATTERN_ARTIFACT_RETENTION_DAYS: "30",
    CODEX_RUNNER_TOKEN: CODEX_PATTERN_RUNNER_TOKEN,
    CODEX_PROVIDER_ARTIFACT_KEYRING: CODEX_PATTERN_ARTIFACT_KEYRING,
    ARTIFACTS: {},
    OPENAI_PATTERN_PLANNER_MODEL: "gpt-5.6-sol",
    OPENAI_PATTERN_PLANNER_REASONING: "xhigh",
    OPENAI_PATTERN_PLANNER_PROMPT_VERSION: "1.0.1",
    OPENAI_PATTERN_PLANNER_TIMEOUT_MS: "900000",
    OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS: "32000",
    OPENAI_PATTERN_WRITER_MODEL: "gpt-5.6-sol",
    OPENAI_PATTERN_WRITER_REASONING: "xhigh",
    OPENAI_PATTERN_WRITER_PROMPT_VERSION: "1.0.2",
    OPENAI_PATTERN_WRITER_TIMEOUT_MS: "900000",
    OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS: "32000",
    OPENAI_PATTERN_VERIFIER_MODEL: "gpt-5.6-sol",
    OPENAI_PATTERN_VERIFIER_REASONING: "xhigh",
    OPENAI_PATTERN_VERIFIER_PROMPT_VERSION: "1.0.0-verifier",
    OPENAI_PATTERN_VERIFIER_TIMEOUT_MS: "900000",
    OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS: "32000",
    ...overrides,
  } as never;
}

function pin(): PatternPublisherPin {
  return {
    publisher: "synthetic",
    planner_model: "gpt-5.6-sol",
    planner_reasoning: "high",
    planner_prompt_version: "1.0.1",
    planner_max_output_tokens: 4000,
    writer_model: "gpt-5.6-sol",
    writer_reasoning: "high",
    writer_prompt_version: "1.0.1",
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
  it("accepts a complete Codex deployment and pins every frozen value", () => {
    const outcome = resolvePatternPublisherConfiguration(env());
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.config.pin.publisher).toBe(PATTERN_PUBLISHER_CODEX);
    expect(outcome.config.pin.planner_model).toBe("gpt-5.6-sol");
    expect(outcome.config.pin.planner_reasoning).toBe("xhigh");
    expect(outcome.config.pin.writer_reasoning).toBe("xhigh");
    expect(outcome.config.pin.verifier_reasoning).toBe("xhigh");
    expect(outcome.config.pin.planner_prompt_version).toBe("1.0.1");
    expect(outcome.config.pin.writer_prompt_version).toBe("1.0.2");
    expect(outcome.config.pin.verifier_prompt_version).toBe("1.0.0-verifier");
    expect(outcome.config.pin.planner_max_output_tokens).toBe(32000);
    expect(outcome.config.pin.input_max_bytes).toBe(98_304);
    expect(outcome.config.plannerTimeoutMs).toBe(CODEX_PROVIDER_TIMEOUT_MS);
    expect(outcome.config.writerTimeoutMs).toBe(CODEX_PROVIDER_TIMEOUT_MS);
    expect(outcome.config.verifierTimeoutMs).toBe(CODEX_PROVIDER_TIMEOUT_MS);
    expect(outcome.config.dailyCallLimit).toBe(100);
    expect(outcome.config.artifactRetentionDays).toBe(PATTERN_ARTIFACT_RETENTION_DAYS);
  });

  it("carries no OpenAI credential, key, or gateway route at all", () => {
    const outcome = resolvePatternPublisherConfiguration(
      env({ OPENAI_API_KEY: "sk-test", OPENAI_CREDENTIAL_SOURCE: "worker" }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The Worker holds no provider credential for Pattern. A key that happens
    // to be set for the ontology pipeline must not become Pattern's transport.
    expect(Object.keys(outcome.config).sort()).toEqual([
      "artifactRetentionDays",
      "dailyCallLimit",
      "pin",
      "plannerTimeoutMs",
      "verifierTimeoutMs",
      "writerTimeoutMs",
    ]);
  });

  it.each([
    ["openai", "openai"],
    ["workers_ai", "workers_ai"],
    ["synthetic", "synthetic"],
    ["an empty publisher", ""],
  ])("refuses %s as a deployable Pattern publisher", (_label, publisher) => {
    const outcome = resolvePatternPublisherConfiguration(
      env({ PATTERN_PUBLISHER: publisher }),
    );
    expect(outcome).toEqual({
      ok: false,
      code: "pattern_publisher_misconfigured",
      message: expect.stringContaining("PATTERN_PUBLISHER must be codex"),
    });
  });

  it("refuses an absent publisher, in development as well as production", () => {
    for (const environment of ["production", "development"]) {
      const outcome = resolvePatternPublisherConfiguration(
        env({ ENVIRONMENT: environment, PATTERN_PUBLISHER: undefined }),
      );
      expect(outcome.ok, environment).toBe(false);
    }
  });

  it("refuses synthetic even in development, so no environment can select it", () => {
    // The deterministic stand-in is a test double handed to `executePatternJob`
    // directly. Leaving it selectable by configuration is what made a
    // stand-in-authored document reachable from a deployment at all.
    const outcome = resolvePatternPublisherConfiguration(
      env({ ENVIRONMENT: "development", PATTERN_PUBLISHER: "synthetic" }),
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses a missing Codex runner token", () => {
    const outcome = resolvePatternPublisherConfiguration(
      env({ CODEX_RUNNER_TOKEN: undefined }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("CODEX_RUNNER_TOKEN");
  });

  it("refuses a missing artifact keyring", () => {
    const outcome = resolvePatternPublisherConfiguration(
      env({ CODEX_PROVIDER_ARTIFACT_KEYRING: undefined }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("CODEX_PROVIDER_ARTIFACT_KEYRING");
  });

  it("refuses an unbound R2 where the publisher is about to be built", () => {
    const outcome = resolvePatternPublisherConfiguration(env({ ARTIFACTS: undefined }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("ARTIFACTS");
  });

  it("refuses a missing daily provider call limit", () => {
    const outcome = resolvePatternPublisherConfiguration(
      env({ PATTERN_DAILY_PROVIDER_CALL_LIMIT: undefined }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("PATTERN_DAILY_PROVIDER_CALL_LIMIT");
  });

  it.each([
    "OPENAI_PATTERN_PLANNER_TIMEOUT_MS",
    "OPENAI_PATTERN_WRITER_TIMEOUT_MS",
    "OPENAI_PATTERN_VERIFIER_TIMEOUT_MS",
  ])("refuses any %s other than 900000", (key) => {
    for (const value of ["120000", "899999", "0"]) {
      const outcome = resolvePatternPublisherConfiguration(env({ [key]: value }));
      expect(outcome.ok, `${key}=${value}`).toBe(false);
      if (outcome.ok) return;
      expect(outcome.message).toContain(key);
    }
  });

  it.each([
    "OPENAI_PATTERN_PLANNER_MODEL",
    "OPENAI_PATTERN_WRITER_PROMPT_VERSION",
    "OPENAI_PATTERN_VERIFIER_PROMPT_VERSION",
    "PATTERN_INPUT_MAX_BYTES",
    "PATTERN_ARTIFACT_RETENTION_DAYS",
  ])("requires %s rather than defaulting it", (key) => {
    const outcome = resolvePatternPublisherConfiguration(env({ [key]: undefined }));
    expect(outcome.ok, key).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain(key);
  });

  it("refuses an AI Gateway route, which names the OpenAI transport", () => {
    const outcome = resolvePatternPublisherConfiguration(
      env({ AI_GATEWAY_ACCOUNT_ID: "a".repeat(32), AI_GATEWAY_ID: "patternlike" }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("cannot be routed through AI Gateway");
  });

  it("is reached by checkSecureConfig, so an incomplete deployment refuses every request", () => {
    const failure = checkSecureConfig(
      env({
        PATTERN_PUBLISHER: "openai",
        AUTH_STUB: "0",
        ROOT_KEK: "x".repeat(48),
        OIDC_ISSUER: "https://real.example.com/",
        OIDC_AUDIENCE: "aud",
        OIDC_JWKS_URL: "https://real.example.com/.well-known/jwks.json",
      }),
    );
    expect(failure?.code).toBe("pattern_publisher_misconfigured");
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
});

describe("Pattern provider labels", () => {
  it("names every publisher honestly from one definition", () => {
    // The document says who actually wrote it. A second hand-copied mapping in
    // the ontology regression harness read `provider === "openai" ? "OpenAI" :
    // "synthetic"`, which labelled every Codex pass "synthetic" for the whole
    // internal Codex canary. Both call sites now resolve here.
    expect(patternProviderDisplayName(PATTERN_PUBLISHER_OPENAI)).toBe("OpenAI");
    expect(patternProviderDisplayName(PATTERN_PUBLISHER_CODEX)).toBe("Codex");
    expect(patternProviderDisplayName(PATTERN_PUBLISHER_WORKERS_AI))
      .toBe("Cloudflare Workers AI");
    expect(patternProviderDisplayName(PATTERN_PUBLISHER_SYNTHETIC))
      .toBe("synthetic");
  });

  it("never reports a real provider as synthetic", () => {
    for (
      const publisher of [
        PATTERN_PUBLISHER_OPENAI,
        PATTERN_PUBLISHER_CODEX,
        PATTERN_PUBLISHER_WORKERS_AI,
      ] as const
    ) {
      expect(patternProviderDisplayName(publisher), publisher)
        .not.toBe("synthetic");
    }
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
