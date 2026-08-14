import { canonicalAspectPair } from "@patternlike/shared";
import type {
  AspectNatalFeature,
  BirthTimeAccuracy,
  NatalFeature,
  NatalPredicate,
  PatternContentObject,
} from "@patternlike/shared";

export type PatternOmission =
  | "deprecated"
  | "accuracy"
  | "houses_or_angles"
  | "predicate_mismatch";

export interface PatternMatchResult {
  eligible: boolean;
  evidence: NatalFeature[];
  omission: PatternOmission | null;
}

const ACCURACY_RANK: Record<BirthTimeAccuracy, number> = {
  unknown: 0,
  approximate: 1,
  exact: 2,
};

function featureMatches(predicate: NatalPredicate, feature: NatalFeature): boolean {
  switch (predicate.type) {
    case "position":
      return feature.feature_class === "position" && feature.body === predicate.body &&
        (predicate.sign === undefined || feature.sign === predicate.sign) &&
        (predicate.house === undefined || feature.house === predicate.house);
    case "aspect": {
      if (feature.feature_class !== "aspect") return false;
      // Canonicalised here rather than trusted: the contract fixes the order,
      // and a predicate that arrived reversed would otherwise silently never
      // match instead of matching the same fact.
      const [wantedA, wantedB] = canonicalAspectPair(predicate.body_a, predicate.body_b);
      const typed = feature as AspectNatalFeature;
      return typed.body_a === wantedA && typed.body_b === wantedB &&
        typed.aspect === predicate.aspect &&
        (predicate.max_orb === undefined || typed.orb <= predicate.max_orb);
    }
    case "pattern": {
      if (feature.feature_class !== "pattern" || feature.pattern !== predicate.pattern) return false;
      if (!predicate.member_bodies) return true;
      const actual = [...feature.member_bodies].sort();
      const expected = [...predicate.member_bodies].sort();
      return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
    }
    case "angle":
      return feature.feature_class === "angle" && feature.angle === predicate.angle &&
        (predicate.sign === undefined || feature.sign === predicate.sign);
    case "house_cusp":
      return feature.feature_class === "house_cusp" && feature.house === predicate.house &&
        (predicate.sign === undefined || feature.sign === predicate.sign);
    case "uncertainty":
      return feature.feature_class === "uncertainty" && feature.accuracy === predicate.accuracy &&
        (predicate.suppressed_feature === undefined ||
          feature.suppressed_features.includes(predicate.suppressed_feature));
  }
}

function matches(predicate: NatalPredicate, features: readonly NatalFeature[]): NatalFeature[] {
  return features.filter((feature) => featureMatches(predicate, feature));
}

export function matchPatternObject(
  pattern: PatternContentObject,
  features: readonly NatalFeature[],
  effectiveAccuracy: BirthTimeAccuracy,
): PatternMatchResult {
  if (pattern.status !== "approved") return { eligible: false, evidence: [], omission: "deprecated" };
  if (ACCURACY_RANK[effectiveAccuracy] < ACCURACY_RANK[pattern.minimum_accuracy]) {
    return { eligible: false, evidence: [], omission: "accuracy" };
  }
  const hasHouses = features.some((feature) =>
    feature.feature_class === "house_cusp" || feature.feature_class === "angle" ||
    (feature.feature_class === "position" && feature.house !== null));
  if (pattern.requires_houses && !hasHouses) {
    return { eligible: false, evidence: [], omission: "houses_or_angles" };
  }
  for (const required of pattern.required_bodies) {
    if (!features.some((feature) =>
      (feature.feature_class === "position" && feature.body === required) ||
      (feature.feature_class === "angle" && feature.angle === required))) {
      return { eligible: false, evidence: [], omission: "predicate_mismatch" };
    }
  }
  for (const required of pattern.required_aspects) {
    if (!features.some((feature) => feature.feature_class === "aspect" && feature.aspect === required)) {
      return { eligible: false, evidence: [], omission: "predicate_mismatch" };
    }
  }

  const positive: NatalFeature[] = [];
  for (const predicate of pattern.match.all_of) {
    const found = matches(predicate, features);
    if (found.length === 0) return { eligible: false, evidence: [], omission: "predicate_mismatch" };
    positive.push(...found);
  }
  if (pattern.match.any_of.length > 0) {
    const alternatives = pattern.match.any_of.flatMap((predicate) => matches(predicate, features));
    if (alternatives.length === 0) return { eligible: false, evidence: [], omission: "predicate_mismatch" };
    positive.push(...alternatives);
  }
  if (pattern.match.none_of.some((predicate) => matches(predicate, features).length > 0)) {
    return { eligible: false, evidence: [], omission: "predicate_mismatch" };
  }

  const evidence = [...new Map(positive.map((feature) => [feature.feature_id, feature])).values()]
    .sort((a, b) => a.feature_id < b.feature_id ? -1 : a.feature_id > b.feature_id ? 1 : 0);
  return { eligible: true, evidence, omission: null };
}
