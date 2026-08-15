import type { PatternOntologyRecord, PatternOntologyRelease } from "@patternlike/shared";
import { M7_SCHEMA_VERSION } from "@patternlike/shared";

function hex32(label: string): string {
  let out = "";
  for (let i = 0; i < label.length; i++) {
    out += label.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return out.padEnd(32, "0").slice(0, 32);
}

export function ontologyId(label: string): string {
  return `ont_${hex32(label)}`;
}

export function sourceFragmentId(label: string): string {
  return `srcf_${hex32(label)}`;
}

function record(
  label: string,
  predicate: PatternOntologyRecord["feature_predicate"],
  proposition: string,
  extras: Partial<PatternOntologyRecord> = {},
): PatternOntologyRecord {
  return {
    id: ontologyId(label),
    meaning_class: "source_supported",
    locale: "en-US",
    feature_predicate: predicate,
    normalized_proposition: proposition,
    source_fragment_ids: [sourceFragmentId(label)],
    input_meaning_ids: [],
    transformation_class: null,
    tensions: [`${label} can harden into overuse.`],
    counter_expressions: [`${label} can also read as a quieter strength.`],
    prohibited_claims: ["This is a medical diagnosis."],
    salience_band: "medium",
    presentation_priority: 50,
    cluster_tags: [predicate.type],
    ...extras,
  };
}

/** Launch-shaped synthetic ontology: class-level predicates, not per-chart facts. */
export function syntheticOntologyRecords(): PatternOntologyRecord[] {
  const bodies = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "true_node"];
  const aspects = ["conjunction", "sextile", "square", "trine", "opposition"];
  const records: PatternOntologyRecord[] = [
    record("uncertainty", { type: "uncertainty" }, "Birth-time accuracy bounds what can be said about houses and angles.", {
      salience_band: "high",
      presentation_priority: 90,
    }),
    record("angle-asc", { type: "angle", angle: "ascendant" }, "The rising point describes how the chart meets the world."),
    record("angle-mc", { type: "angle", angle: "midheaven" }, "The midheaven describes public direction when birth time supports it."),
    record("house", { type: "house_cusp" }, "House cusps locate topics when birth time is known."),
    record("pattern", { type: "pattern" }, "A calculated multi-body pattern binds several facts into one structure."),
  ];
  for (const body of bodies) {
    records.push(record(`pos-${body}`, { type: "position", body }, `The ${body} position describes a standing emphasis.`));
  }
  for (const aspect of aspects) {
    records.push(record(`asp-${aspect}`, { type: "aspect", aspect }, `A ${aspect} describes a repeating negotiation between two bodies.`));
  }
  return records;
}

function hash64(label: string): string {
  // Encode last-character-first so version suffixes survive the 64-hex cap.
  // hex32() of "bundle:ont-test-1" and "...-2" collided after slice(0, 32).
  let out = "";
  for (let i = label.length - 1; i >= 0; i--) {
    out += label.charCodeAt(i)!.toString(16).padStart(2, "0");
  }
  return out.padEnd(64, "0").slice(0, 64);
}

export function syntheticOntologyRelease(version = "ont-test-1"): PatternOntologyRelease {
  const records = syntheticOntologyRecords();
  return {
    schema_version: M7_SCHEMA_VERSION,
    ontology_version: version,
    // UNIQUE(bundle_hash) on pattern_ontology_releases: two versions of the
    // synthetic corpus must not collide, or ingest/reactivation of the second
    // release fails closed before any Pattern job can be reserved.
    bundle_hash: `sha256:${hash64(`bundle:${version}`)}`,
    corpus_release_hash: `sha256:${hash64(`corpus:${version}`)}`,
    locale: "en-US",
    status: "active",
    records,
    evaluation: {
      schema_version: M7_SCHEMA_VERSION,
      ontology_version: version,
      verdict: "pass",
      compiler_passed: true,
      evaluator_passed: true,
      regression_passed: true,
      unevaluated_fixture_count: 0,
    },
  };
}
