import { describe, expect, it } from "vitest";
import {
  buildDeterministicPlan,
  buildDeterministicWriterOutput,
  projectPublicPattern,
  selectPatternEvidence,
  validatePatternCandidate,
  validatePatternPlan,
} from "@patternlike/pattern-engine";
import {
  contentHash,
  type PatternDocumentInternal,
  type PatternSemanticVerdict,
} from "@patternlike/shared";

import {
  ONTOLOGY_REGRESSION_MAXIMUM_BILLABLE_TOKEN_UNITS,
  ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS,
  ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS,
  ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS,
  applyOntologyRegressionPass,
  createCanonicalOntologyRegressionReport,
  createOntologyRegressionFixtureState,
  evaluateOntologyRegressionHardGates,
  evaluateOntologyRegressionThresholds,
  loadOntologyRegressionCorpus,
  prepareOntologyRegressionPass,
} from "./ontology-regression.js";
import { deriveNatalFeatureSet } from "./natal-features.js";
import { evaluateSemanticVerdict } from "./pattern-semantic.js";

describe("M7 ontology activation regression", () => {
  it("loads exactly the authored 10/10/10 corpus and every required axis", () => {
    const corpus = loadOntologyRegressionCorpus();

    expect(corpus.fixtures.map((fixture) => fixture.fixture_id)).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `m7-exact-${String(index + 1).padStart(2, "0")}`),
      ...Array.from({ length: 10 }, (_, index) => `m7-approximate-${String(index + 1).padStart(2, "0")}`),
      ...Array.from({ length: 10 }, (_, index) => `m7-unknown-${String(index + 1).padStart(2, "0")}`),
    ]);
    expect(new Set(corpus.fixtures.flatMap((fixture) => fixture.axes)))
      .toEqual(new Set(corpus.manifest.required_axes));
    expect(corpus.manifest.authored_chains).toHaveLength(30);
    expect(corpus.source_fragment_ids.size).toBeGreaterThan(0);
  });

  it("replays all 30 checked-in chart-to-public chains through the landed seams", async () => {
    const corpus = loadOntologyRegressionCorpus();

    for (const fixture of corpus.fixtures) {
      const derived = await deriveNatalFeatureSet({
        chartId: fixture.chart_snapshot.id,
        userId: fixture.chart_snapshot.user_id,
        chartFingerprint: fixture.chart_snapshot.fingerprint,
        effectiveAccuracy: fixture.effective_accuracy,
        snapshot: fixture.chart_snapshot,
        uncertainty: fixture.chart_snapshot.uncertainty,
      });
      expect(derived.features, fixture.fixture_id).toEqual(fixture.features);
      const selected = selectPatternEvidence({
        locale: fixture.locale,
        effectiveAccuracy: fixture.effective_accuracy,
        featureSetHash: derived.featureSetHash,
        features: derived.features,
        ontology: corpus.manifest.reference_ontology_records,
      });
      expect(selected.manifest, fixture.fixture_id)
        .toEqual(fixture.chain.selection_manifest);
      expect(selected.packet, fixture.fixture_id)
        .toEqual(fixture.chain.fact_packet);

      const planner = buildDeterministicPlan(
        selected.packet,
        corpus.manifest.reference_ontology_records,
      );
      const plan = {
        ...planner,
        plan_hash: await contentHash(JSON.stringify(planner)),
        sparse_pattern: selected.packet.selection_constraints.sparse_pattern,
      };
      expect(plan, fixture.fixture_id).toEqual(fixture.chain.plan);
      expect(validatePatternPlan(
        plan,
        selected.packet,
        corpus.manifest.reference_ontology_records,
      ), fixture.fixture_id).toMatchObject({ ok: true });

      const writer = buildDeterministicWriterOutput(
        plan,
        selected.packet,
        corpus.manifest.reference_ontology_records,
      );
      expect(writer, fixture.fixture_id).toEqual(fixture.chain.writer);
      expect(validatePatternCandidate(
        writer,
        plan,
        selected.packet,
        corpus.manifest.reference_ontology_records,
      ), fixture.fixture_id).toMatchObject({ ok: true });

      const verdict = evaluateSemanticVerdict(writer, { forceReject: false });
      expect(verdict, fixture.fixture_id).toEqual(fixture.chain.verdict);
      const internal: PatternDocumentInternal = {
        schema_version: "0.7.0",
        pattern_id: fixture.chain.public_projection.pattern_id,
        generation_id: `pgen_${"0".repeat(32)}`,
        locale: fixture.locale,
        effective_accuracy: fixture.effective_accuracy,
        plan_hash: plan.plan_hash,
        candidate_hash: await contentHash(JSON.stringify(writer)),
        semantic_verdict_hash: await contentHash(JSON.stringify(verdict)),
        artifact: writer,
        compact_provenance: {
          assembly_mode: "constrained_model",
          provider: "Hermetic",
          model_family: "m7-corpus-deterministic-v1",
          raw_birth_details_sent: false,
          ontology_version: "m7-corpus-reference-1",
          selection_policy_version: "1.0.0",
        },
      };
      expect(projectPublicPattern(
        internal,
        fixture.chain.public_projection.generated_at,
      ), fixture.fixture_id).toEqual(fixture.chain.public_projection);
    }
  });

  it("passes every hard gate for every authored accepted chain", () => {
    const corpus = loadOntologyRegressionCorpus();
    for (const fixture of corpus.fixtures) {
      expect(evaluateOntologyRegressionHardGates({
        fixture,
        selectionManifest: fixture.chain.selection_manifest,
        packet: fixture.chain.fact_packet,
        plan: fixture.chain.plan,
        writer: fixture.chain.writer,
        verdict: fixture.chain.verdict,
        publicProjection: fixture.chain.public_projection,
        ontology: corpus.manifest.reference_ontology_records,
        sourceFragmentIds: corpus.source_fragment_ids,
      }), fixture.fixture_id).toEqual([]);
    }
  });

  it("makes each zero-tolerance gate independently fatal", () => {
    const corpus = loadOntologyRegressionCorpus();
    const unknown = structuredClone(corpus.fixtures[20]!);
    unknown.chain.writer.chapters[0]!.sections[0]!.text =
      "The Ascendant degree guarantees a future diagnosis.";
    unknown.chain.writer.chapters[0]!.sections[0]!.feature_aliases = [];
    unknown.chain.public_projection.core_chapters[0]!.sections[0] = {
      text: unknown.chain.writer.chapters[0]!.sections[0]!.text,
    };
    (unknown.chain.public_projection as unknown as Record<string, unknown>).ontology_rule_ids = [];
    const brokenOntology = corpus.manifest.reference_ontology_records.map((record, index) =>
      index === 0
        ? { ...record, source_fragment_ids: ["srcf_ffffffffffffffffffffffffffffffff"] }
        : record);

    const failures = evaluateOntologyRegressionHardGates({
      fixture: unknown,
      selectionManifest: {
        ...unknown.chain.selection_manifest,
        accounting: unknown.chain.selection_manifest.accounting.filter((entry) =>
          entry.coverage !== "mandatory_core"),
      },
      packet: unknown.chain.fact_packet,
      plan: unknown.chain.plan,
      writer: unknown.chain.writer,
      verdict: unknown.chain.verdict,
      publicProjection: unknown.chain.public_projection,
      ontology: brokenOntology,
      sourceFragmentIds: corpus.source_fragment_ids,
    });

    expect(failures).toEqual(expect.arrayContaining([
      "suppressed_feature_leak",
      "uncited_astrological_claim",
      "source_dependency_failure",
      "prohibited_claim",
      "mandatory_feature_omission",
      "private_projection_leak",
    ]));
  });

  it("treats indirect angle-transit and Moon-sign wording as suppressed leaks", () => {
    const corpus = loadOntologyRegressionCorpus();
    const cases = [
      {
        fixture: structuredClone(corpus.fixtures[10]!),
        text: "A transit to the Ascendant fixes the timing of this theme.",
      },
      {
        fixture: structuredClone(corpus.fixtures[20]!),
        text: "The Moon in Aries fixes the emotional tone of this theme.",
      },
    ];

    for (const { fixture, text } of cases) {
      fixture.chain.writer.chapters[0]!.sections[0]!.text = text;
      fixture.chain.public_projection.core_chapters[0]!.sections[0] = { text };
      expect(evaluateOntologyRegressionHardGates({
        fixture,
        selectionManifest: fixture.chain.selection_manifest,
        packet: fixture.chain.fact_packet,
        plan: fixture.chain.plan,
        writer: fixture.chain.writer,
        verdict: fixture.chain.verdict,
        publicProjection: fixture.chain.public_projection,
        ontology: corpus.manifest.reference_ontology_records,
        sourceFragmentIds: corpus.source_fragment_ids,
      }), fixture.fixture_id).toContain("suppressed_feature_leak");
    }
  });

  it("uses independent cohort thresholds and raises equal models to 10/10", () => {
    const nineOfTen = [
      ...Array.from({ length: 10 }, (_, index) => ({ accuracy: "exact" as const, accepted: index > 0 })),
      ...Array.from({ length: 10 }, (_, index) => ({ accuracy: "approximate" as const, accepted: index > 0 })),
      ...Array.from({ length: 10 }, (_, index) => ({ accuracy: "unknown" as const, accepted: index > 0 })),
    ];

    expect(evaluateOntologyRegressionThresholds(nineOfTen, false)).toMatchObject({
      passed: true,
      required_per_cohort: 9,
    });
    expect(evaluateOntologyRegressionThresholds(nineOfTen, true)).toMatchObject({
      passed: false,
      required_per_cohort: 10,
    });
  });

  it("binds report evidence and refuses call or token arithmetic above the ceiling", async () => {
    const corpus = loadOntologyRegressionCorpus();
    const results = corpus.fixtures.map((fixture) => ({
      fixture_id: fixture.fixture_id,
      accuracy: fixture.effective_accuracy,
      accepted: true,
      declared_outcome: fixture.declared_outcome,
      result_hash: `sha256:${"a".repeat(64)}`,
      provider_calls: 3,
      input_tokens: 10,
      output_tokens: 10,
      hard_gate_failures: [],
    }));
    const base = {
      ontologyVersion: "ontology-regression-test",
      commandHash: `sha256:${"1".repeat(64)}`,
      configurationHash: `sha256:${"2".repeat(64)}`,
      corpusReleaseId: "corpus-regression-test",
      corpusHash: `sha256:${"3".repeat(64)}`,
      corpusManifestHash: corpus.manifest_hash,
      candidateHash: `sha256:${"4".repeat(64)}`,
      evaluationReportHash: `sha256:${"5".repeat(64)}`,
      configurationEqual: true,
      results,
      requestArtifactCount: 90,
      responseArtifactCount: 90,
      inputTokens: 300,
      outputTokens: 300,
    };

    const report = await createCanonicalOntologyRegressionReport(base);
    expect(report.document).toMatchObject({
      passed: true,
      threshold: { required_per_cohort: 10 },
      provider_usage: {
        maximum_provider_calls: ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS,
        maximum_billable_token_units:
          ONTOLOGY_REGRESSION_MAXIMUM_BILLABLE_TOKEN_UNITS,
      },
    });
    expect(JSON.stringify(report.document)).toContain(base.commandHash);
    expect(JSON.stringify(report.document)).toContain(base.evaluationReportHash);

    await expect(createCanonicalOntologyRegressionReport({
      ...base,
      requestArtifactCount: ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS + 1,
    })).rejects.toMatchObject({ code: "regression_budget_exceeded" });
    await expect(createCanonicalOntologyRegressionReport({
      ...base,
      inputTokens: ONTOLOGY_REGRESSION_MAXIMUM_BILLABLE_TOKEN_UNITS,
      outputTokens: 1,
    })).rejects.toMatchObject({ code: "regression_budget_exceeded" });
    await expect(createCanonicalOntologyRegressionReport({
      ...base,
      inputTokens: ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS + 1,
      outputTokens: 0,
    })).rejects.toMatchObject({ code: "regression_budget_exceeded" });
    await expect(createCanonicalOntologyRegressionReport({
      ...base,
      inputTokens: 0,
      outputTokens: ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS + 1,
    })).rejects.toMatchObject({ code: "regression_budget_exceeded" });
    await expect(createCanonicalOntologyRegressionReport({
      ...base,
      requestArtifactCount: -1,
    })).rejects.toMatchObject({ code: "regression_budget_exceeded" });
    await expect(createCanonicalOntologyRegressionReport({
      ...base,
      outputTokens: 0.5,
    })).rejects.toMatchObject({ code: "regression_budget_exceeded" });
  });

  it("runs an accepted fixture through the production pass documents in three calls", async () => {
    const corpus = loadOntologyRegressionCorpus();
    const fixture = corpus.fixtures[0]!;
    const ontology = corpus.manifest.reference_ontology_records;
    let state = createOntologyRegressionFixtureState(0, fixture);

    while (!state.complete) {
      const prepared = prepareOntologyRegressionPass({
        state,
        fixture,
        ontology,
        inputMaxBytes: 98_304,
      });
      const value = prepared.pass === "planner"
        ? buildDeterministicPlan(prepared.selection.packet, ontology)
        : prepared.pass === "writer"
          ? buildDeterministicWriterOutput(
              state.plan!,
              prepared.selection.packet,
              ontology,
            )
          : evaluateSemanticVerdict(state.candidate!, { forceReject: false });
      state = await applyOntologyRegressionPass({
        state,
        fixture,
        ontology,
        sourceFragmentIds: corpus.source_fragment_ids,
        pass: prepared.pass,
        value,
        deliveryAttempt: 0,
        metadata: {
          provider: "openai",
          pass: prepared.pass,
          model: "gpt-5.6-sol",
          prompt_version: prepared.pass === "verifier" ? "1.0.0-verifier" : "1.0.0",
          provider_request_id: `response-${prepared.pass}`,
          input_tokens: 10,
          output_tokens: 20,
          provider_response_hash: `sha256:${"6".repeat(64)}`,
        },
        ontologyVersion: "ontology-regression-test",
      });
    }

    expect(state.result).toMatchObject({
      accepted: true,
      provider_calls: 3,
      input_tokens: 30,
      output_tokens: 60,
      hard_gate_failures: [],
    });
  });

  it("enforces 2 planner + 3 writer + 3×2 verifier and resets verifier scope", async () => {
    const corpus = loadOntologyRegressionCorpus();
    const fixture = corpus.fixtures[0]!;
    const ontology = corpus.manifest.reference_ontology_records;
    let state = createOntologyRegressionFixtureState(0, fixture);

    const first = prepareOntologyRegressionPass({
      state,
      fixture,
      ontology,
      inputMaxBytes: 98_304,
    });
    state = await applyOntologyRegressionPass({
      state,
      fixture,
      ontology,
      sourceFragmentIds: corpus.source_fragment_ids,
      pass: "planner",
      value: {
        schema_version: "0.7.0",
        chapters: [],
        additional_signatures: [],
        omissions: [],
      },
      deliveryAttempt: 0,
      metadata: {
        provider: "openai",
        pass: "planner",
        model: "gpt-5.6-sol",
        prompt_version: "1.0.0",
        provider_request_id: "planner-invalid",
        input_tokens: 1,
        output_tokens: 1,
        provider_response_hash: `sha256:${"7".repeat(64)}`,
      },
      ontologyVersion: "ontology-regression-test",
    });
    expect(first.pass).toBe("planner");
    expect(state.phase).toBe("planner");

    const validPlan = buildDeterministicPlan(
      prepareOntologyRegressionPass({ state, fixture, ontology, inputMaxBytes: 98_304 }).selection.packet,
      ontology,
    );
    state = await applyOntologyRegressionPass({
      state,
      fixture,
      ontology,
      sourceFragmentIds: corpus.source_fragment_ids,
      pass: "planner",
      value: validPlan,
      deliveryAttempt: 0,
      metadata: {
        provider: "openai",
        pass: "planner",
        model: "gpt-5.6-sol",
        prompt_version: "1.0.0",
        provider_request_id: "planner-valid",
        input_tokens: 1,
        output_tokens: 1,
        provider_response_hash: `sha256:${"8".repeat(64)}`,
      },
      ontologyVersion: "ontology-regression-test",
    });

    for (let candidate = 0; candidate < 3; candidate += 1) {
      const prepared = prepareOntologyRegressionPass({ state, fixture, ontology, inputMaxBytes: 98_304 });
      const writer = buildDeterministicWriterOutput(
        state.plan!,
        prepared.selection.packet,
        ontology,
      );
      state = await applyOntologyRegressionPass({
        state,
        fixture,
        ontology,
        sourceFragmentIds: corpus.source_fragment_ids,
        pass: "writer",
        value: writer,
        deliveryAttempt: 0,
        metadata: {
          provider: "openai",
          pass: "writer",
          model: "gpt-5.6-sol",
          prompt_version: "1.0.0",
          provider_request_id: `writer-${candidate}`,
          input_tokens: 1,
          output_tokens: 1,
          provider_response_hash: `sha256:${"9".repeat(64)}`,
        },
        ontologyVersion: "ontology-regression-test",
      });
      const reject: PatternSemanticVerdict = {
        schema_version: "0.7.0",
        verdict: "reject",
        findings: [{
          code: "semantic_verification_failed",
          severity: "error",
          target_key: null,
          feature_aliases: [],
          ontology_rule_ids: [],
          rationale: "Hermetic rejection",
        }],
      };
      state = await applyOntologyRegressionPass({
        state,
        fixture,
        ontology,
        sourceFragmentIds: corpus.source_fragment_ids,
        pass: "verifier",
        value: reject,
        // One failed transport call followed by this successful verdict.
        deliveryAttempt: 1,
        metadata: {
          provider: "openai",
          pass: "verifier",
          model: "gpt-5.6-sol",
          prompt_version: "1.0.0-verifier",
          provider_request_id: `verifier-${candidate}`,
          input_tokens: 1,
          output_tokens: 1,
          provider_response_hash: `sha256:${"a".repeat(64)}`,
        },
        ontologyVersion: "ontology-regression-test",
      });
      if (candidate < 2) {
        expect(state.phase).toBe("writer");
        expect(state.verifier_calls_for_candidate).toBe(0);
      }
    }

    expect(state.complete).toBe(true);
    expect(state.result).toMatchObject({ accepted: false, provider_calls: 11 });
  });
});
