import assert from "node:assert/strict";
import test from "node:test";
import type { NatalFeature } from "@patternlike/shared";
import { compileOntologyRelease } from "./ontology.js";
import { selectPatternEvidence } from "./selection.js";
import { validatePatternPlan } from "./plan-validate.js";
import { validatePatternCandidate } from "./candidate-validate.js";
import { buildDeterministicPlan, buildDeterministicWriterOutput } from "./synthetic.js";
import { stripPrivateEvidence } from "./projection.js";
import { syntheticOntologyRelease } from "./fixtures.js";
import { PATTERN_SELECTION_POLICY_ID } from "./policy.js";

function feature(partial: NatalFeature): NatalFeature {
  return partial;
}

const FEATURES: NatalFeature[] = [
  feature({
    feature_id: "nft_sun_pos",
    feature_class: "position",
    policy_id: "natal-feature-policy",
    policy_version: "1.0.0",
    body: "sun",
    longitude: 54.7,
    sign: 1,
    house: 10,
  }),
  feature({
    feature_id: "nft_moon_pos",
    feature_class: "position",
    policy_id: "natal-feature-policy",
    policy_version: "1.0.0",
    body: "moon",
    longitude: 128.4,
    sign: 4,
    house: 1,
  }),
  feature({
    feature_id: "nft_sun_mars",
    feature_class: "aspect",
    policy_id: "natal-feature-policy",
    policy_version: "1.0.0",
    body_a: "sun",
    body_b: "mars",
    aspect: "square",
    orb: 2.3,
  }),
  feature({
    feature_id: "nft_mercury_pos",
    feature_class: "position",
    policy_id: "natal-feature-policy",
    policy_version: "1.0.0",
    body: "mercury",
    longitude: 40,
    sign: 1,
    house: 9,
  }),
  feature({
    feature_id: "nft_unc",
    feature_class: "uncertainty",
    policy_id: "natal-feature-policy",
    policy_version: "1.0.0",
    accuracy: "exact",
    suppressed_features: [],
  }),
];

test("synthetic ontology compiles", () => {
  const release = syntheticOntologyRelease();
  const compiled = compileOntologyRelease(release);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.failures));
});

test("synthetic ontology versions do not share a bundle hash", () => {
  const a = syntheticOntologyRelease("ont-test-1");
  const b = syntheticOntologyRelease("ont-test-2");
  assert.notEqual(a.bundle_hash, b.bundle_hash);
  assert.notEqual(a.corpus_release_hash, b.corpus_release_hash);
});

test("selection assigns luminary facts as mandatory_core and never sends nft_ ids", () => {
  const release = syntheticOntologyRelease();
  const selected = selectPatternEvidence({
    locale: "en-US",
    effectiveAccuracy: "exact",
    featureSetHash: `sha256:${"11".repeat(32)}`,
    features: FEATURES,
    ontology: release.records,
  });
  assert.equal(selected.manifest.policy_id, PATTERN_SELECTION_POLICY_ID);
  const sun = selected.packet.features.find((row) => row.fact.body === "sun");
  assert.ok(sun);
  assert.equal(sun.coverage, "mandatory_core");
  assert.match(sun.alias, /^f\d{3}$/);
  assert.equal(JSON.stringify(selected.packet).includes("nft_"), false);
  assert.equal(JSON.stringify(selected.packet).includes("usr_"), false);
  assert.ok(selected.packet.features.every((row) => row.ontology_rule_ids.length >= 1));
});

test("selection carries every calculated suppression class into the closed uncertainty block", () => {
  const release = syntheticOntologyRelease();
  const features = FEATURES.map((item) =>
    item.feature_class === "uncertainty"
      ? {
          ...item,
          accuracy: "unknown" as const,
          suppressed_features: [
            "houses",
            "angles",
            "angle_transits",
            "moon_time_sensitive",
          ],
        }
      : item,
  );
  const selected = selectPatternEvidence({
    locale: "en-US",
    effectiveAccuracy: "unknown",
    featureSetHash: `sha256:${"33".repeat(32)}`,
    features,
    ontology: release.records,
  });

  assert.deepEqual(selected.packet.uncertainty.suppressed_classes, [
    "angle_transits",
    "angles",
    "houses",
    "moon_time_sensitive",
  ]);
});

test("selection normalizes the persisted M4 digest to the M7 content-hash form", () => {
  const release = syntheticOntologyRelease();
  const selected = selectPatternEvidence({
    locale: "en-US",
    effectiveAccuracy: "exact",
    featureSetHash: "44".repeat(32),
    features: FEATURES,
    ontology: release.records,
  });

  assert.equal(selected.manifest.feature_set_hash, `sha256:${"44".repeat(32)}`);
});

test("deterministic plan and writer pass validators and strip private ledgers", () => {
  const release = syntheticOntologyRelease();
  const selected = selectPatternEvidence({
    locale: "en-US",
    effectiveAccuracy: "exact",
    featureSetHash: `sha256:${"11".repeat(32)}`,
    features: FEATURES,
    ontology: release.records,
  });
  const planner = buildDeterministicPlan(selected.packet, release.records);
  const planCheck = validatePatternPlan(planner, selected.packet, release.records);
  assert.equal(planCheck.ok, true, JSON.stringify(planCheck.failures));
  const plan = { ...planner, plan_hash: `sha256:${"22".repeat(32)}`, sparse_pattern: selected.packet.selection_constraints.sparse_pattern };
  const writer = buildDeterministicWriterOutput(plan, selected.packet, release.records);
  const candidate = validatePatternCandidate(writer, plan, selected.packet, release.records);
  assert.equal(candidate.ok, true, JSON.stringify(candidate.failures));
  const publicDoc = stripPrivateEvidence(writer);
  assert.equal(JSON.stringify(publicDoc).includes("feature_aliases"), false);
  assert.equal(JSON.stringify(publicDoc).includes("ontology_rule_ids"), false);
  assert.equal(JSON.stringify(publicDoc).includes("claim_class"), false);
  assert.ok(publicDoc.core_chapters.length >= 3);
});

test("compiler refuses a non-canonical aspect pair", () => {
  const release = syntheticOntologyRelease();
  release.records.push({
    ...release.records[0]!,
    id: "ont_ffffffffffffffffffffffffffffffff",
    feature_predicate: { type: "aspect", body_a: "moon", body_b: "sun", aspect: "square" },
  });
  const compiled = compileOntologyRelease(release);
  assert.equal(compiled.ok, false);
  assert.ok(compiled.failures.some((failure) => failure.code === "noncanonical_aspect"));
});
