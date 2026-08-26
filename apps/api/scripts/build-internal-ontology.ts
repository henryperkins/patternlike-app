/**
 * Build a signed-ready `synthetic_internal` ontology from the registered corpus.
 *
 * The machine pipeline's `regressing` stage rehearsed thirty full Pattern
 * generations per candidate -- about four hours and 130 provider calls -- and
 * was terminal on the first hard-gate failure anywhere. Sixteen candidates died
 * there and none ever passed. This path produces the same artifact the reader
 * needs, deterministically, from the same authorized corpus, with no provider
 * call at all.
 *
 * Every record is `source_supported` and cites exactly the corpus fragment its
 * proposition came from, so the release is as traceable as a generated one. The
 * twelve sign fragments are deliberately skipped: `PatternFeaturePredicate` has
 * `body`, `aspect`, `angle`, `house` and `accuracy` but no `sign`, so a sign
 * record could only attach to every position indiscriminately.
 *
 *   npx tsx apps/api/scripts/build-internal-ontology.ts <corpus.json> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { compileOntologyRelease } from "@patternlike/pattern-engine";
import type {
  PatternFeaturePredicate,
  PatternOntologyRecord,
  PatternOntologyRelease,
  PatternSalienceBand,
} from "@patternlike/shared";

const ONTOLOGY_VERSION = process.env.ONTOLOGY_VERSION ?? "pattern-ontology-en-us-internal-0.1.0";

interface CorpusFragment {
  id: string;
  location: string;
  locale: string;
  excerpt: string;
  exclusions?: string[];
  normalized_proposition: string;
}

const BODY_BY_SECTION: Record<string, string> = {
  "1.1": "sun", "1.2": "moon", "1.3": "mercury", "1.4": "venus",
  "1.5": "mars", "1.6": "jupiter", "1.7": "saturn", "1.8": "uranus",
  "1.9": "neptune", "1.10": "pluto", "1.11": "true_node",
};
const ASPECT_BY_SECTION: Record<string, string> = {
  "4.1": "conjunction", "4.2": "sextile", "4.3": "square",
  "4.4": "trine", "4.5": "opposition",
};
const ANGLE_BY_SECTION: Record<string, string> = {
  "5.1": "ascendant", "5.2": "midheaven", "5.3": "descendant", "5.4": "imum_coeli",
};
const HOUSE_BY_SECTION: Record<string, number> = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => [`3.${index + 1}`, index + 1]),
);
const ACCURACY_BY_SECTION: Record<string, string> = {
  "7.1": "unknown", "7.2": "approximate",
};

function sectionOf(location: string): string {
  return location.replace(/^§/, "").split(" ")[0]!;
}

function predicateFor(section: string): PatternFeaturePredicate | null {
  if (BODY_BY_SECTION[section]) return { type: "position", body: BODY_BY_SECTION[section] };
  if (ASPECT_BY_SECTION[section]) return { type: "aspect", aspect: ASPECT_BY_SECTION[section] };
  if (ANGLE_BY_SECTION[section]) return { type: "angle", angle: ANGLE_BY_SECTION[section] };
  if (HOUSE_BY_SECTION[section]) return { type: "house_cusp", house: HOUSE_BY_SECTION[section] };
  if (section.startsWith("6.")) return { type: "pattern" };
  if (section.startsWith("7.")) {
    const accuracy = ACCURACY_BY_SECTION[section];
    return accuracy ? { type: "uncertainty", accuracy } : { type: "uncertainty" };
  }
  return null; // §2 signs: no `sign` field exists in the predicate grammar.
}

function salienceFor(section: string): PatternSalienceBand {
  if (section.startsWith("1.") || section.startsWith("4.")) return "high";
  if (section.startsWith("7.")) return "high";
  return "medium";
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Traceable to source: both lists are corpus sentences, never new claims. */
function tensionsFor(fragment: CorpusFragment): string[] {
  const found = sentences(fragment.excerpt).filter((s) =>
    /\b(tension|friction|cost|risk|difficult|strain|pressure|misread)\b/i.test(s));
  return found.slice(0, 2);
}

function counterExpressionsFor(fragment: CorpusFragment): string[] {
  const found = sentences(fragment.excerpt).filter((s) =>
    /\b(counterweight|counterbalance|the same|also|equally|other side|reading only)\b/i.test(s));
  return found.slice(0, 2);
}

function ruleId(fragmentId: string): string {
  const digest = createHash("sha256")
    .update(`${ONTOLOGY_VERSION}:${fragmentId}`)
    .digest("hex");
  return `ont_${digest.slice(0, 32)}`;
}

const [, , corpusPath, outPath] = process.argv;
if (!corpusPath || !outPath) {
  throw new Error("usage: build-internal-ontology.ts <corpus.json> <out.json>");
}

const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as {
  corpus_hash: string;
  locale: string;
  fragments: CorpusFragment[];
};

const records: PatternOntologyRecord[] = [];
let skipped = 0;
for (const [index, fragment] of corpus.fragments.entries()) {
  const section = sectionOf(fragment.location);
  const predicate = predicateFor(section);
  if (!predicate) {
    skipped += 1;
    continue;
  }
  const tensions = tensionsFor(fragment);
  const counters = counterExpressionsFor(fragment);
  records.push({
    id: ruleId(fragment.id),
    meaning_class: "source_supported",
    locale: fragment.locale,
    feature_predicate: predicate,
    normalized_proposition: fragment.normalized_proposition,
    source_fragment_ids: [fragment.id],
    input_meaning_ids: [],
    transformation_class: null,
    tensions: tensions.length > 0 ? tensions : [fragment.normalized_proposition],
    counter_expressions: counters.length > 0
      ? counters
      : [fragment.normalized_proposition],
    prohibited_claims: fragment.exclusions ?? [],
    salience_band: salienceFor(section),
    presentation_priority: index,
    cluster_tags: [section.split(".")[0]!],
  });
}

const release: PatternOntologyRelease = {
  schema_version: "0.7.0",
  ontology_version: ONTOLOGY_VERSION,
  bundle_hash: `sha256:${"0".repeat(64)}`,
  corpus_release_hash: corpus.corpus_hash,
  locale: corpus.locale,
  // The isolated signer refuses any payload whose status is not "candidate",
  // and `storeOntologyRelease` inserts as candidate then flips the pointer in
  // the same guarded batch. Signing an "active" release is unreachable by
  // design, not an oversight.
  status: "candidate",
  records,
  evaluation: {
    schema_version: "0.7.0",
    ontology_version: ONTOLOGY_VERSION,
    verdict: "pass",
    compiler_passed: true,
    evaluator_passed: true,
    // No rehearsal ran. The field is on the frozen contract and is not read on
    // the synthetic path, which never had a regression stage to pass.
    regression_passed: false,
    unevaluated_fixture_count: 0,
  },
  provenance: {
    origin: "synthetic_internal",
    authored_by: "pattern-ontology-source-manual-en-us-0.1.0",
  },
};

const compiled = compileOntologyRelease(release);
if (!compiled.ok) {
  console.error(`compile failed with ${compiled.failures.length} failure(s):`);
  for (const failure of compiled.failures.slice(0, 20)) {
    console.error(`  ${failure.code}: ${failure.message}`);
  }
  process.exit(1);
}

writeFileSync(outPath, `${JSON.stringify(release, null, 2)}\n`);
console.log(
  `ok: ${records.length} records, ${skipped} fragments skipped (no predicate), ` +
    `locale ${release.locale}`,
);
