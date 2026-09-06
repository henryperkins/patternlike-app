import { describe, expect, it } from "vitest";
import type { PatternWriterOutput } from "@patternlike/shared";
import { validatePatternCandidate } from "@patternlike/pattern-engine";
import { loadOntologyRegressionCorpus } from "./ontology-regression.js";
import { evaluatePatternPublicationSafety } from "./pattern-publication-safety.js";

function fixture(index = 20) {
  const corpus = loadOntologyRegressionCorpus();
  const original = structuredClone(corpus.fixtures[index]!);
  return {
    features: original.features,
    selectionManifest: original.chain.selection_manifest,
    packet: original.chain.fact_packet,
    plan: original.chain.plan,
    writer: original.chain.writer,
    verdict: original.chain.verdict,
    publicProjection: original.chain.public_projection,
    ontology: structuredClone(corpus.manifest.reference_ontology_records),
    sourceFragmentIds: new Set(corpus.source_fragment_ids),
  };
}

function expectStructurallyValid(input: ReturnType<typeof fixture>) {
  expect(validatePatternCandidate(input.writer, input.plan, input.packet, input.ontology))
    .toEqual({ ok: true, failures: [] });
}

describe("Pattern document safety policy", () => {
  it("preserves all 30 accepted fixture chains under the shared document policy", () => {
    for (let index = 0; index < 30; index++) {
      expect(evaluatePatternPublicationSafety(fixture(index)).failures, `fixture ${index}`).toEqual([]);
    }
  });

  it.each([
    "Houses and angles are withheld.",
    "Your birth time is unknown, so houses and angles are not calculated.",
    "The Moon's sign is withheld because your birth time is unknown.",
    "Birth-time accuracy limits what this Pattern can say about houses, angles, and time-sensitive claims.",
    "Your birth time is unknown, so this Pattern does not use houses or angles.",
    "Without an exact birth time, houses and angles cannot be calculated.",
    "Your birth time is approximate. This reading stays within those limits.",
    "House placements are unavailable because your birth time is unknown.",
  ])("permits a bounded uncertainty disclosure: %s", (text) => {
    const input = fixture(text.includes("approximate") ? 10 : 20);
    input.writer.uncertainty_note!.text = text;
    expect(evaluatePatternPublicationSafety(input).failures).toEqual([]);
  });

  it.each([
    "Houses and angles are withheld, but your Ascendant is in Leo.",
    "Your Moon's sign is withheld and your Moon is in Aries.",
    "Birth-time accuracy bounds what can be said about houses and angles, and the fifth house guarantees romance.",
  ])("does not let an uncertainty disclosure hide an asserted calculation: %s", (text) => {
    const input = fixture();
    input.writer.uncertainty_note!.text = text;
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code))
      .toContain("suppressed_feature_leak");
  });

  const suppressedFields: Array<[string, (writer: PatternWriterOutput) => void]> = [
    ["document title", (writer) => { writer.title = "Your Ascendant in Aries"; }],
    ["chapter title", (writer) => { writer.chapters[0]!.title = "Your Ascendant in Aries"; }],
    ["summary", (writer) => { writer.chapters[0]!.summary = "Your Ascendant in Aries shapes this theme."; }],
    ["section", (writer) => { writer.chapters[0]!.sections[0]!.text = "Your Ascendant in Aries shapes this theme."; }],
    ["tension", (writer) => { writer.chapters[0]!.tensions[0]!.text = "Your Ascendant in Aries shapes this theme."; }],
    ["resource", (writer) => { writer.chapters[0]!.resources[0]!.text = "Your Ascendant in Aries shapes this theme."; }],
    ["counter-expression", (writer) => { writer.chapters[0]!.counter_expression.text = "Your Ascendant in Aries shapes this theme."; }],
    ["signature title", (writer) => {
      writer.additional_signatures.push({ signature_key: "signature_01", title: "Your Ascendant in Aries", text: "Reflect on this tendency.", feature_aliases: ["f001"], ontology_rule_ids: [] });
    }],
    ["signature prose", (writer) => {
      writer.additional_signatures.push({ signature_key: "signature_01", title: "A reflection", text: "Your Ascendant in Aries shapes this theme.", feature_aliases: ["f001"], ontology_rule_ids: [] });
    }],
    ["uncertainty", (writer) => { writer.uncertainty_note!.text = "Your Ascendant in Aries shapes this theme."; }],
  ];
  it.each(suppressedFields)("checks withheld calculations in %s", (_label, mutate) => {
    const input = fixture();
    mutate(input.writer);
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code)).toContain("suppressed_feature_leak");
  });

  it.each([
    "Your Moon sits in Aries.",
    "Your natal Moon occupies Aries.",
    "Your Moon is placed in Aries.",
    "Your Moon is positioned within Aries.",
    "Aries is where your Moon sits.",
    "Your Moon: Aries.",
    "Your Moon's placement is unknown, but it sits in Aries.",
    "Your Ascen\u200bdant is in Aries.",
    "Your Ｍｏｏｎ occupies Ａｒｉｅｓ.",
  ])("rejects a withheld placement in otherwise valid ledger prose: %s", (text) => {
    const input = fixture();
    input.writer.chapters[0]!.sections[0]!.text = `${text} ${input.writer.chapters[0]!.sections[0]!.text}`;
    expectStructurallyValid(input);
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code))
      .toContain("suppressed_feature_leak");
  });

  const visibleTextFields: Array<[string, (writer: PatternWriterOutput, text: string) => void]> = [
    ["document title", (writer, text) => { writer.title = text; }],
    ["chapter title", (writer, text) => { writer.chapters[0]!.title = text; }],
    ["summary", (writer, text) => { writer.chapters[0]!.summary = `${text} ${writer.chapters[0]!.summary}`; }],
    ["section", (writer, text) => { writer.chapters[0]!.sections[0]!.text = `${text} ${writer.chapters[0]!.sections[0]!.text}`; }],
    ["tension", (writer, text) => { writer.chapters[0]!.tensions[0]!.text = `${text} ${writer.chapters[0]!.tensions[0]!.text}`; }],
    ["resource", (writer, text) => { writer.chapters[0]!.resources[0]!.text = `${text} ${writer.chapters[0]!.resources[0]!.text}`; }],
    ["counter-expression", (writer, text) => { writer.chapters[0]!.counter_expression.text = `${text} ${writer.chapters[0]!.counter_expression.text}`; }],
    ["signature title", (writer, text) => { writer.additional_signatures[0]!.title = text; }],
    ["signature prose", (writer, text) => { writer.additional_signatures[0]!.text = `${text} ${writer.additional_signatures[0]!.text}`; }],
    ["uncertainty", (writer, text) => { writer.uncertainty_note!.text = `${text} ${writer.uncertainty_note!.text}`; }],
  ];
  it.each(visibleTextFields)("checks ordinary Moon placements in valid %s", (_label, mutate) => {
    const input = fixture();
    const section = input.writer.chapters[0]!.sections[0]!;
    input.plan.additional_signatures.push({
      signature_key: "signature_01", working_title: "A reflection",
      feature_aliases: [...section.feature_aliases], ontology_rule_ids: [...section.ontology_rule_ids],
    });
    input.writer.additional_signatures.push({
      signature_key: "signature_01", title: "A reflection", text: `${section.text} ${section.text}`,
      feature_aliases: [...section.feature_aliases], ontology_rule_ids: [...section.ontology_rule_ids],
    });
    expect(evaluatePatternPublicationSafety(input).failures).toEqual([]);
    mutate(input.writer, "Your Moon sits in Aries.");
    expectStructurallyValid(input);
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code))
      .toContain("suppressed_feature_leak");
  });

  it("preserves qualified approximate-time Moon interpretation without a withheld placement", () => {
    const input = fixture(10);
    const section = input.writer.chapters[0]!.sections[0]!;
    section.text = `Your birth time is approximate. The Moon's sign is withheld because your birth time is approximate. ${section.text}`;
    expectStructurallyValid(input);
    expect(evaluatePatternPublicationSafety(input).failures).toEqual([]);
  });

  it.each([
    "Do not hesitate: your chart guarantees success.",
    "This is not a prediction, but your chart guarantees wealth.",
    "Your chart predicts success without doubt.",
    "You cannot avoid your fate.",
    "Your chart doesn't just predict success; it guarantees it.",
    "Your chart is not without a guarantee of success.",
    "The chart cannot not predict success.",
    "Your chart makes predictions about your future.",
    "Your chart is predicting wealth.",
    "Your chart guaran\u200btees wealth.",
  ])("rejects a prohibited claim despite unrelated negation: %s", (text) => {
    const input = fixture(0);
    input.writer.chapters[0]!.summary = text;
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code)).toContain("prohibited_claim");
  });

  it.each([
    "This reading makes no predictions about your future.",
    "This reading is not predicting wealth.",
  ])("preserves a direct denial of a prohibited claim: %s", (text) => {
    const input = fixture(0);
    input.writer.chapters[0]!.sections[0]!.text = `${text} ${input.writer.chapters[0]!.sections[0]!.text}`;
    expectStructurallyValid(input);
    expect(evaluatePatternPublicationSafety(input).failures).toEqual([]);
  });

  it("rejects an explicit astrological assertion in a summary without a citation ledger", () => {
    const input = fixture(0);
    input.writer.chapters[0]!.summary = "Your Mars is in Leo.";
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code)).toContain("uncited_astrological_claim");
  });

  it.each([
    "Your Sun: Aries.", "Your Sun — Aries.", "Your Sun occupies Aries.", "Your Su\u200bn is in Aries.",
    "Your North Node is in Aries.", "Your rising sign is in Leo.",
  ])(
    "rejects an unledgered placement in otherwise valid summary prose: %s", (text) => {
      const input = fixture(0);
      input.writer.chapters[0]!.summary = `${text} ${input.writer.chapters[0]!.summary}`;
      expectStructurallyValid(input);
      expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code))
        .toContain("uncited_astrological_claim");
    },
  );

  it("rejects an uncertainty citation that points to a non-packet alias", () => {
    const input = fixture();
    input.writer.uncertainty_note!.feature_aliases = ["f999"];
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code)).toContain("uncited_astrological_claim");
  });

  it("requires derived-synthesis dependencies even if only the derived ledger cites them", () => {
    const input = fixture();
    const derivedId = input.writer.chapters[0]!.sections[0]!.derived_synthesis_ids[0]!;
    const derived = input.ontology.find((record) => record.id === derivedId)!;
    derived.input_meaning_ids[0] = `ont_${"f".repeat(32)}`;
    for (const chapter of input.writer.chapters) {
      for (const unit of [...chapter.sections, ...chapter.tensions, ...chapter.resources, chapter.counter_expression]) {
        unit.ontology_rule_ids = unit.ontology_rule_ids.filter((rule) => rule !== derivedId);
      }
    }
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code)).toContain("source_dependency_failure");
  });

  it("classifies an invented writer reference as correctable instead of broken source authority", () => {
    const input = fixture(0);
    input.writer.chapters[0]!.sections[0]!.derived_synthesis_ids = [`ont_${"f".repeat(32)}`];
    expectStructurallyValid(input);
    expect(evaluatePatternPublicationSafety(input).failures).toEqual([
      { code: "uncited_astrological_claim", targetKey: input.writer.chapters[0]!.sections[0]!.section_key },
    ]);
  });

  it("requires mandatory features in the written document even when the manifest claims coverage", () => {
    const input = fixture(0);
    const mandatory = input.packet.features.find((entry) => entry.coverage === "mandatory_core")!.alias;
    for (const chapter of input.writer.chapters) {
      for (const unit of [...chapter.sections, ...chapter.tensions, ...chapter.resources, chapter.counter_expression]) {
        unit.feature_aliases = unit.feature_aliases.filter((alias) => alias !== mandatory);
      }
    }
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code)).toContain("mandatory_feature_omission");
  });

  it("rejects a manifest that assigns a mandatory Sun feature to the Moon packet fact", () => {
    const input = fixture(0);
    const sun = input.features.find((feature) => feature.feature_class === "position" && feature.body === "sun")!;
    const moonAlias = input.packet.features.find((feature) => feature.feature_class === "position" && feature.fact.body === "moon")!.alias;
    input.selectionManifest.accounting.find((entry) => entry.feature_id === sun.feature_id)!.alias = moonAlias;
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code))
      .toContain("mandatory_feature_omission");
  });

  it("requires the uncertainty note to disclose the birth-time limitation", () => {
    const input = fixture();
    input.writer.uncertainty_note!.text = "This note is reflective and contains no uncertainty disclosure.";
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code))
      .toContain("mandatory_feature_omission");
  });

  it.each(["usr_privateaccount", "cht_privatechart", "srcf_privatefragment", "f001", "u\u200bsr_privateaccount", "ｕｓｒ＿ｐｒｉｖａｔｅａｃｃｏｕｎｔ"])(
    "rejects a private identifier in the actual public projection: %s", (identifier) => {
      const input = fixture(0);
      input.publicProjection.core_chapters[0]!.summary = `Evidence ${identifier}`;
      expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code)).toContain("private_projection_leak");
    },
  );

  it("normalizes a private identifier in valid writer prose before checking it", () => {
    const input = fixture(0);
    const section = input.writer.chapters[0]!.sections[0]!;
    section.text = `Your private identifier is u\u200bsr_privateaccount. ${section.text}`;
    expectStructurallyValid(input);
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code))
      .toContain("private_projection_leak");
  });

  it("rejects a private projection key hidden by format characters", () => {
    const input = fixture(0);
    Object.assign(input.publicProjection, { "u\u200bser_id": "private account" });
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code))
      .toContain("private_projection_leak");
  });

  it("does not treat a contradictory passing semantic verdict as approval", () => {
    const input = fixture(0);
    input.verdict.findings = [{ code: "semantic_verification_failed", severity: "error", target_key: null, feature_aliases: [], ontology_rule_ids: [], rationale: "Rejected claim" }];
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code)).toContain("semantic_refusal");
  });

  it("rejects an explicitly prohibited ontology claim even without a generic trigger word", () => {
    const input = fixture(0);
    const rule = input.writer.chapters[0]!.sections[0]!.ontology_rule_ids[0]!;
    input.ontology.find((record) => record.id === rule)!.prohibited_claims.push("You must quit your job.");
    input.writer.chapters[0]!.sections[0]!.text = "You must quit your job.";
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code))
      .toContain("prohibited_claim");
  });

  it("normalizes explicitly prohibited ontology phrases and writer prose consistently", () => {
    const input = fixture(0);
    const section = input.writer.chapters[0]!.sections[0]!;
    input.ontology.find((record) => record.id === section.ontology_rule_ids[0])!
      .prohibited_claims.push("You must qu\u200bit your job.");
    section.text = `You must quit your j\u200bob. ${section.text}`;
    expectStructurallyValid(input);
    expect(evaluatePatternPublicationSafety(input).failures.map((failure) => failure.code))
      .toContain("prohibited_claim");
  });
});
