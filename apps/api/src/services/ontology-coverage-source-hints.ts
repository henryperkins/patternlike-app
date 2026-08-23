import {
  canonicalJson,
  type NatalFeatureClass,
  type PatternFeaturePredicate,
} from "@patternlike/shared";

import type { RegisteredOntologyCorpus } from "./ontology-corpus.js";

export interface OntologyCoverageSourceHint {
  feature_class: NatalFeatureClass;
  source_fragment_id: string;
  feature_predicate: PatternFeaturePredicate;
}

interface OntologyCoverageHintCorpusIdentity {
  corpus_release_id: unknown;
  corpus_hash: unknown;
  license_class: unknown;
  public_capable: unknown;
}

type CoverageSourceHintResolution =
  | { ok: true; hints: OntologyCoverageSourceHint[] }
  | { ok: false };

const APPROVED_CORPUS_RELEASE_ID =
  "pattern-ontology-source-manual-en-us-0.1.0";
const APPROVED_CORPUS_HASH =
  "sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c";
const APPROVED_CORPUS_LOCALE = "en-US";
const APPROVED_HINTS = [
  {
    feature_class: "position",
    source_fragment_id: "srcf_32312edcef85aa77ffee8fa6b723e165",
    feature_predicate: { type: "position", body: "sun" },
  },
  {
    feature_class: "position",
    source_fragment_id: "srcf_78d2386c07e8152516a2a23aa54d7b0c",
    feature_predicate: { type: "position", body: "moon" },
  },
  {
    feature_class: "aspect",
    source_fragment_id: "srcf_73dbb8b5679edd15e4da92f778961c3b",
    feature_predicate: { type: "aspect", aspect: "conjunction" },
  },
  {
    feature_class: "aspect",
    source_fragment_id: "srcf_240e363f233eb6e45d14c724fc1f7761",
    feature_predicate: { type: "aspect", aspect: "square" },
  },
  {
    feature_class: "aspect",
    source_fragment_id: "srcf_69a4979a0e67ea57ba9ca26128adddaa",
    feature_predicate: { type: "aspect", aspect: "trine" },
  },
  {
    feature_class: "aspect",
    source_fragment_id: "srcf_505836d6affe1a481f59d42dfd80f78e",
    feature_predicate: { type: "aspect", aspect: "sextile" },
  },
  {
    feature_class: "pattern",
    source_fragment_id: "srcf_70a53d65d1e84c127bd1249147a880d9",
    feature_predicate: { type: "pattern", pattern: "stellium" },
  },
  {
    feature_class: "uncertainty",
    source_fragment_id: "srcf_c063ee9a41d23b5640ad360d5e4a265f",
    feature_predicate: { type: "uncertainty" },
  },
] as const satisfies readonly OntologyCoverageSourceHint[];

function copyPredicate(
  predicate: PatternFeaturePredicate,
): PatternFeaturePredicate {
  const copied: PatternFeaturePredicate = { type: predicate.type };
  if (predicate.body !== undefined) copied.body = predicate.body;
  if (predicate.body_a !== undefined) copied.body_a = predicate.body_a;
  if (predicate.body_b !== undefined) copied.body_b = predicate.body_b;
  if (predicate.aspect !== undefined) copied.aspect = predicate.aspect;
  if (predicate.pattern !== undefined) copied.pattern = predicate.pattern;
  if (predicate.angle !== undefined) copied.angle = predicate.angle;
  if (predicate.house !== undefined) copied.house = predicate.house;
  if (predicate.accuracy !== undefined) copied.accuracy = predicate.accuracy;
  return copied;
}

export function copyOntologyCoverageSourceHint(
  hint: OntologyCoverageSourceHint,
): OntologyCoverageSourceHint {
  return {
    feature_class: hint.feature_class,
    source_fragment_id: hint.source_fragment_id,
    feature_predicate: copyPredicate(hint.feature_predicate),
  };
}

function expectedHintsForIdentity(
  identity: OntologyCoverageHintCorpusIdentity,
): CoverageSourceHintResolution {
  const releaseMatches =
    identity.corpus_release_id === APPROVED_CORPUS_RELEASE_ID;
  const hashMatches = identity.corpus_hash === APPROVED_CORPUS_HASH;
  if (!releaseMatches && !hashMatches) return { ok: true, hints: [] };
  if (
    !releaseMatches ||
    !hashMatches ||
    identity.license_class !== "licensed_excerpt" ||
    identity.public_capable !== true
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    hints: APPROVED_HINTS.map(copyOntologyCoverageSourceHint),
  };
}

function mappedFragmentIsRegistered(
  corpus: RegisteredOntologyCorpus,
  fragmentId: string,
): boolean {
  if (corpus.release.locale !== APPROVED_CORPUS_LOCALE) return false;
  const matching = corpus.release.fragments.filter((fragment) =>
    fragment.id === fragmentId
  );
  const indexed = corpus.fragmentIndex.get(fragmentId);
  return matching.length === 1 &&
    indexed !== undefined &&
    matching[0]!.corpus_release_id === corpus.release.corpus_release_id &&
    matching[0]!.locale === corpus.release.locale &&
    matching[0]!.license_class === corpus.licenseClass &&
    canonicalJson(matching[0]) === canonicalJson(indexed);
}

/** Resolve the reviewed bridges while the registered corpus is in hand. */
export function buildOntologyCoverageSourceHints(
  corpus: RegisteredOntologyCorpus,
): CoverageSourceHintResolution {
  const resolved = expectedHintsForIdentity({
    corpus_release_id: corpus.release.corpus_release_id,
    corpus_hash: corpus.release.corpus_hash,
    license_class: corpus.licenseClass,
    public_capable: corpus.publicCapable,
  });
  if (!resolved.ok) return resolved;
  if (
    resolved.hints.some((hint) =>
      !mappedFragmentIsRegistered(corpus, hint.source_fragment_id)
    )
  ) {
    return { ok: false };
  }
  return resolved;
}

/** Validate command-frozen hints without re-deriving outbound semantics. */
export function frozenOntologyCoverageSourceHintsMatchIdentity(
  identity: OntologyCoverageHintCorpusIdentity,
  value: unknown,
): value is readonly OntologyCoverageSourceHint[] {
  const expected = expectedHintsForIdentity(identity);
  return expected.ok &&
    Array.isArray(value) &&
    canonicalJson(value) === canonicalJson(expected.hints);
}

/** Recheck both the frozen mapping and its source against loaded corpus bytes. */
export function frozenOntologyCoverageSourceHintsMatchCorpus(
  corpus: RegisteredOntologyCorpus,
  value: unknown,
): value is readonly OntologyCoverageSourceHint[] {
  const expected = buildOntologyCoverageSourceHints(corpus);
  return expected.ok &&
    Array.isArray(value) &&
    canonicalJson(value) === canonicalJson(expected.hints);
}
