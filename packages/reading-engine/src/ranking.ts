/**
 * DER-02 ranking.
 *
 * Named factors only, every component recorded with its weight. There is no
 * engagement signal in this file and no parameter through which one could
 * arrive: the registry's requirement is "no hidden engagement-only ranking",
 * and the way to keep that true is to give the function nowhere to put one.
 * `resonance_feedback` was removed from the M3 ranking vocabulary for the same
 * reason — `reading_feedback.resonance` is the column that would otherwise feed
 * it.
 *
 * Tie-breaks are total and terminate on cycle id, so two runs over the same
 * fact set cannot disagree about which theme is primary.
 */

import { phaseWeight } from "./phase.js";
import type {
  AssemblyFactInput,
  LifeDomain,
  RankingFactor,
  CycleObject,
} from "./types.js";

export const RANKING_POLICY_VERSION = "1.0.0";

/**
 * Slower bodies carry more weight because their contacts are rarer and last
 * longer. Angles rank with the luminaries when they are available at all.
 */
const BODY_IMPORTANCE: Record<string, number> = {
  pluto: 1.0,
  neptune: 0.95,
  uranus: 0.9,
  saturn: 0.85,
  jupiter: 0.7,
  true_node: 0.6,
  mars: 0.5,
  sun: 0.45,
  venus: 0.35,
  mercury: 0.3,
  moon: 0.2,
  ascendant: 0.5,
  midheaven: 0.5,
};

const TARGET_IMPORTANCE: Record<string, number> = {
  sun: 1.0,
  moon: 0.95,
  ascendant: 0.9,
  midheaven: 0.85,
  saturn: 0.6,
  jupiter: 0.55,
  mars: 0.5,
  venus: 0.45,
  mercury: 0.4,
  true_node: 0.4,
  uranus: 0.35,
  neptune: 0.35,
  pluto: 0.35,
};

const ASPECT_WEIGHT: Record<string, number> = {
  conjunction: 1.0,
  opposition: 0.9,
  square: 0.85,
  trine: 0.7,
  sextile: 0.5,
};

const WEIGHTS = {
  exactness: 0.30,
  body_importance: 0.20,
  target_importance: 0.15,
  phase: 0.15,
  rarity: 0.10,
  technique_weight: 0.05,
  angularity: 0.05,
  domain_match: 0.10,
  repetition_penalty: -0.15,
  continuity: 0.05,
} as const;

export interface ScoredFact {
  fact: AssemblyFactInput;
  score: number;
  factors: RankingFactor[];
}

function round(value: number): number {
  // Four decimal places keeps the recorded weights byte-stable across
  // platforms without pretending to more precision than the inputs carry.
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Closeness of the calculated orb to exact, normalized against the configured
 * orb for that contact. 1 at exact, 0 at the orb boundary.
 */
function exactness(fact: AssemblyFactInput): number {
  if (fact.orb_deg === null || fact.orb_deg <= 0) return 1;
  const configured = 3; // configured orb ceiling for launch transit policy
  return Math.max(0, Math.min(1, 1 - fact.orb_deg / configured));
}

export function scoreFact(
  fact: AssemblyFactInput,
  options: {
    domainPreference: LifeDomain | null;
    matchingCycleObject: CycleObject | null;
    seenRecently: boolean;
  },
): ScoredFact {
  const factors: RankingFactor[] = [];
  let score = 0;

  const add = (
    factor: RankingFactor["factor"],
    raw: number,
    weight: number,
    reason: string,
  ) => {
    const contribution = round(raw * weight);
    score += contribution;
    factors.push({ factor, weight: contribution, reason });
  };

  add(
    "exactness",
    exactness(fact),
    WEIGHTS.exactness,
    fact.orb_deg === null ? "orb_unavailable_treated_as_exact" : `orb_${fact.orb_deg}`,
  );
  add(
    "body_importance",
    BODY_IMPORTANCE[fact.body ?? ""] ?? 0.25,
    WEIGHTS.body_importance,
    `transiting_${fact.body ?? "unknown"}`,
  );
  add(
    "target_importance",
    TARGET_IMPORTANCE[fact.target ?? ""] ?? 0.25,
    WEIGHTS.target_importance,
    `natal_${fact.target ?? "unknown"}`,
  );
  add("phase", phaseWeight(fact.phase), WEIGHTS.phase, `phase_${fact.phase ?? "none"}`);
  add(
    "rarity",
    ASPECT_WEIGHT[fact.aspect ?? ""] ?? 0.5,
    WEIGHTS.rarity,
    `aspect_${fact.aspect ?? "unknown"}`,
  );
  add(
    "technique_weight",
    fact.technique === "transit" ? 1 : 0.5,
    WEIGHTS.technique_weight,
    `technique_${fact.technique ?? "unknown"}`,
  );

  const target = (fact.target ?? "").toLowerCase();
  if (target === "ascendant" || target === "midheaven") {
    add("angularity", 1, WEIGHTS.angularity, `angular_target_${target}`);
  }

  if (options.domainPreference && options.matchingCycleObject) {
    // Domain match is the only user preference the launch ranker reads.
    add("domain_match", 1, WEIGHTS.domain_match, `preference_${options.domainPreference}`);
  }

  if ((fact.pass_count ?? 1) > 1) {
    add(
      "continuity",
      1,
      WEIGHTS.continuity,
      `multi_pass_${fact.pass_count}`,
    );
  }

  if (options.seenRecently) {
    add("repetition_penalty", 1, WEIGHTS.repetition_penalty, "primary_in_recent_reading");
  }

  return { fact, score: round(score), factors };
}

/**
 * Descending score, then a total tie-break chain that terminates on cycle id.
 * Two runs over the same fact set must not disagree about ordering.
 */
export function compareScored(a: ScoredFact, b: ScoredFact): number {
  if (a.score !== b.score) return b.score - a.score;
  const at = a.fact.first_exact_at ?? "";
  const bt = b.fact.first_exact_at ?? "";
  if (at !== bt) return at < bt ? -1 : 1;
  return a.fact.id < b.fact.id ? -1 : a.fact.id > b.fact.id ? 1 : 0;
}

/**
 * A supporting influence must be genuinely distinct from the primary — a
 * different (body, target, aspect) AND a different parent cycle — so the
 * reading cannot say the same thing twice in two paragraphs.
 */
export function isDistinctSupporting(
  primary: AssemblyFactInput,
  candidate: AssemblyFactInput,
): boolean {
  const sameContact =
    primary.body === candidate.body &&
    primary.target === candidate.target &&
    primary.aspect === candidate.aspect;
  return !sameContact && primary.id !== candidate.id;
}
