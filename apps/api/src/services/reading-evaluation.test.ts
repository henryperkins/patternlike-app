import { describe, expect, it } from "vitest";
import {
  EVALUATION_POLICY_VERSION,
  evaluateCase,
  hardGateFindings,
  loadEvaluationCorpus,
  prepareProfile,
  qualitativeFindings,
} from "./reading-evaluation.js";
import { READING_PROMPT_VERSION } from "./reading-prompt.js";
import {
  OPENAI_READING_MAX_OUTPUT_TOKENS,
  OPENAI_READING_MODEL,
  OPENAI_READING_REASONING,
} from "./reading-publisher.js";
import {
  SELECTION_POLICY_VERSION,
  VALIDATION_POLICY_VERSION,
} from "@patternlike/reading-engine";

/**
 * The quality gate a model, prompt, selection-policy, or validation-policy
 * change has to pass before it can be deployed.
 *
 * Entirely offline. Every candidate here is a frozen string that a real model
 * once could have produced; the point is not to ask a provider anything, it is
 * to pin exactly which candidates this deployment accepts and which it refuses,
 * so a policy change that quietly widens either is a failing test rather than a
 * discovery on a reader's reading. The live counterpart is a real generation
 * through the production Codex runner, which is a separately authorized
 * deployment gate rather than a script in this workspace.
 */

const corpus = loadEvaluationCorpus();

describe("the evaluation corpus", () => {
  it("pins the exact policy versions it was validated against", () => {
    // A corpus validated against another prompt proves nothing about this one.
    // Changing any of these six requires re-running the corpus, incrementing
    // its version, and updating this record — which is what makes the version
    // bump a decision rather than an afterthought.
    expect(corpus.gates).toEqual({
      model: OPENAI_READING_MODEL,
      reasoning_effort: OPENAI_READING_REASONING,
      max_output_tokens: OPENAI_READING_MAX_OUTPUT_TOKENS,
      prompt_version: READING_PROMPT_VERSION,
      selection_policy_version: SELECTION_POLICY_VERSION,
      validation_policy_version: VALIDATION_POLICY_VERSION,
      evaluation_policy_version: EVALUATION_POLICY_VERSION,
    });
    expect(corpus.corpus_version).toBe("1.0.2");
    expect(corpus.base.prompt_version).toBe("1.0.2");
  });

  it("covers every profile shape the design names", () => {
    const shapes = new Set(Object.values(corpus.profiles).map((p) => p.shape));

    expect(shapes).toEqual(
      new Set([
        "exact_time",
        "approximate_time",
        "unknown_time",
        "zero_cycle_day",
        "collective_only_day",
        "injected_user_text",
      ]),
    );
  });

  it("carries an accepted and a rejected candidate for every profile", () => {
    for (const profileId of Object.keys(corpus.profiles)) {
      const forProfile = corpus.cases.filter((entry) => entry.profile === profileId);

      expect(
        forProfile.some((entry) => entry.expect === "accept"),
        `profile ${profileId} has no accepted candidate`,
      ).toBe(true);
      expect(
        forProfile.some((entry) => entry.expect === "reject"),
        `profile ${profileId} has no rejected candidate`,
      ).toBe(true);
    }
  });

  it("compiles every profile through the real constrained-input compiler", () => {
    for (const profileId of Object.keys(corpus.profiles)) {
      const prepared = prepareProfile(corpus, profileId);

      // Never empty: the daily-sky layer guarantees an anchor and a phase, which
      // is the whole reason a zero-cycle day is still a factual day.
      expect(prepared.request.facts.length).toBeGreaterThan(0);
      expect(prepared.request.local_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("hard gates", () => {
  it.each(corpus.cases)("$id is $expect", (entry) => {
    const result = evaluateCase(corpus, entry);

    expect(result.actual, `${entry.id}: ${result.failures.map((f) => f.code).join(", ")}`).toBe(
      entry.expect,
    );
  });

  it("names the exact reason for every rejection the corpus predicts", () => {
    for (const entry of corpus.cases) {
      if (entry.expect !== "reject" || !entry.expect_detail) continue;

      const result = evaluateCase(corpus, entry);
      const codes = result.failures.map((failure) => `${failure.code}.${failure.detail_code}`);

      expect(codes, entry.id).toContain(entry.expect_detail);
    }
  });

  it("refuses a candidate that invents a body the facts never supplied", () => {
    const prepared = prepareProfile(corpus, "exact_saturn_square");
    const accepted = corpus.cases.find(
      (entry) => entry.profile === "exact_saturn_square" && entry.expect === "accept",
    )!;
    const tampered = structuredClone(accepted.candidate);
    tampered.lead.text = "Neptune is square your Sun today, and the pressure is real.";

    const failures = hardGateFindings(prepared, tampered);

    expect(failures.map((failure) => failure.code)).toContain("vocabulary");
  });

  it("refuses a candidate that cites a fact id it was never given", () => {
    const prepared = prepareProfile(corpus, "exact_saturn_square");
    const accepted = corpus.cases.find(
      (entry) => entry.profile === "exact_saturn_square" && entry.expect === "accept",
    )!;
    const tampered = structuredClone(accepted.candidate);
    tampered.lead.fact_ids = [`cyc_${"9".repeat(32)}`];

    const failures = hardGateFindings(prepared, tampered);

    expect(failures.map((failure) => failure.code)).toContain("known_references");
  });
});

describe("the privacy gate", () => {
  it("proves no profile can put birth data or an identifier on the wire", () => {
    const forbidden = [
      "1991-01-14",
      "17:42",
      "41.8781",
      "-87.6298",
      "America/Chicago",
      "usr_",
      "cs_",
      "rdg_",
      "job_",
      "cns_",
      "sk-",
    ];

    for (const profileId of Object.keys(corpus.profiles)) {
      const serialized = JSON.stringify(prepareProfile(corpus, profileId).request);

      for (const needle of forbidden) {
        expect(serialized, `${profileId} leaked ${needle}`).not.toContain(needle);
      }
    }
  });

  it("keeps the chart fingerprint and the scheduling zone out of the packet", () => {
    const prepared = prepareProfile(corpus, "exact_saturn_square");
    const serialized = JSON.stringify(prepared.request);

    expect(serialized).not.toContain(corpus.base.chart.fingerprint);
    expect(serialized).not.toContain(corpus.base.target_timezone);
    // The accuracy LABEL crosses; the birth data behind it never does.
    expect(prepared.request.birth_time_accuracy).toBe("exact");
  });
});

describe("bounded qualitative checks", () => {
  it.each(corpus.qualitative)("$id expects $expect", (entry) => {
    const prepared = prepareProfile(corpus, entry.profile);
    const findings = qualitativeFindings(prepared, entry.candidate);

    if (entry.expect === "clean") {
      expect(findings, entry.id).toEqual([]);
    } else {
      expect(findings, entry.id).toContain(entry.expect);
    }
  });

  it("does not let a qualitative finding block publication on its own", () => {
    // Deliberate: usefulness, personalization, repetition, and tone are aggregate
    // quality signals, not correctness. A reading that repeats yesterday's
    // framing is worse; it is not wrong, and refusing to publish it would mean
    // an honest unavailable state instead of a slightly dull reading.
    const flagged = corpus.qualitative.find((entry) => entry.expect !== "clean")!;
    const prepared = prepareProfile(corpus, flagged.profile);

    expect(qualitativeFindings(prepared, flagged.candidate).length).toBeGreaterThan(0);
    expect(hardGateFindings(prepared, flagged.candidate)).toEqual([]);
  });
});
