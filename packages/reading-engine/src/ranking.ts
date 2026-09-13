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
 * No scale on the fact means no exactness claim. The middle of the range, not
 * the top of it: returning 1 would hand the table's largest weight to every
 * fact whose exactness is simply unknown.
 */
const NEUTRAL_EXACTNESS = 0.5;

/**
 * Closeness to exact, normalized against the contact's own scale.
 *
 * Exactness is a ratio, so it needs a denominator, and only some facts carry
 * one:
 *
 *  - A cycle carries an envelope. Its `orb_deg` is the configured envelope
 *    width rather than today's separation, and the measured angular separation
 *    never reaches ranking, so the measure is temporal: distance from the
 *    evaluation instant to the nearest exact pass, normalized against the room
 *    that pass has on the side the instant actually falls — up to the next
 *    boundary in that direction, which is the neighbouring pass when there is
 *    one and the envelope edge otherwise. 1 at every pass, 0 at orb entry and
 *    at orb exit — for a pass anywhere in the envelope, not only one sitting at
 *    its centre — and the neutral 0.5 midway between two passes of one
 *    envelope, never lower inside the passes. Normalizing against half the
 *    envelope instead would put the zero at `pass ± half`, which for an
 *    off-centre pass is partway across the envelope: near-maximum at orb entry
 *    on the short side, and pinned flat at 0 across the long one. Normalizing
 *    against the envelope edge even when a neighbouring pass sits in between
 *    would change the denominator the instant the nearest pass changes hands,
 *    so the score would jump on a day nothing about the contact changed.
 *  - A natal aspect carries a measured orb but no ceiling to divide it by. The
 *    ceiling is the calculation contract's orb policy (`defaults`/`by_body`,
 *    where conjunction and opposition are wider than sextile), which does not
 *    cross into this package; `orb_deg` is kept on the fact because it is the
 *    honest measurement, not because ranking can consume it. Inventing a scale
 *    is what the old hardcoded `configured = 3` did, and it sat below every
 *    real ceiling, so ordinary orbs scored as though they were near-boundary.
 *  - Daily-sky facts have no orb concept at all.
 *
 * The last two score NEUTRAL_EXACTNESS.
 *
 * Value and reason are returned together so the recorded factor cannot
 * describe a branch the arithmetic did not take.
 */
function exactness(
  fact: AssemblyFactInput,
  at: string | null,
): { value: number; reason: string } {
  if (fact.orb_deg !== null && fact.orb_deg <= 0) {
    return { value: 1, reason: "orb_zero_is_exact" };
  }
  if (fact.orb_deg === null) {
    return { value: NEUTRAL_EXACTNESS, reason: "no_orb_scale_treated_as_neutral" };
  }
  if (at === null || fact.start_at === null || fact.end_at === null) {
    return { value: NEUTRAL_EXACTNESS, reason: "no_orb_ceiling_treated_as_neutral" };
  }
  const passes = fact.pass_exact_ats?.length
    ? fact.pass_exact_ats
    : fact.first_exact_at
      ? [fact.first_exact_at]
      : [];
  if (passes.length === 0) {
    return { value: NEUTRAL_EXACTNESS, reason: "envelope_without_pass_treated_as_neutral" };
  }
  const t = Date.parse(at);
  const start = Date.parse(fact.start_at);
  const end = Date.parse(fact.end_at);
  const passTimes = passes.map((pass) => Date.parse(pass));
  // `Number.isNaN` is passed the (value, index, array) triple by `some`, which
  // it ignores — but spelling the call out keeps that from reading as a bug.
  if ([t, start, end, ...passTimes].some((value) => Number.isNaN(value))) {
    return { value: NEUTRAL_EXACTNESS, reason: "unparseable_envelope_treated_as_neutral" };
  }
  if (end <= start) {
    return { value: NEUTRAL_EXACTNESS, reason: "degenerate_envelope_treated_as_neutral" };
  }
  // Sorted and deduplicated, so "the neighbouring pass" is well defined.
  const sorted = [...new Set(passTimes)].sort((a, b) => a - b);
  // First strictly-closer wins, so a tie keeps the earlier pass and the result
  // does not depend on iteration luck.
  let nearestIndex = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    if (Math.abs(t - sorted[index]!) < Math.abs(t - sorted[nearestIndex]!)) {
      nearestIndex = index;
    }
  }
  const nearest = sorted[nearestIndex]!;
  const distance = Math.abs(t - nearest);
  // Per side: the pass's room to the next boundary in the direction the
  // instant lies — the neighbouring pass if there is one that way, otherwise
  // the envelope edge. Between two passes the instant is by construction no
  // further than half the gap from the nearer one, so the value never falls
  // below 0.5 there and the two sides agree exactly at the midpoint.
  const room =
    t >= nearest
      ? (sorted[nearestIndex + 1] ?? end) - nearest
      : nearest - (sorted[nearestIndex - 1] ?? start);
  if (room <= 0) {
    // The pass sits on the very boundary, so the instant is at or past it.
    return {
      value: distance === 0 ? 1 : 0,
      reason: "temporal_distance_to_nearest_pass",
    };
  }
  return {
    value: Math.max(0, Math.min(1, 1 - distance / room)),
    reason: "temporal_distance_to_nearest_pass",
  };
}

export function scoreFact(
  fact: AssemblyFactInput,
  options: {
    domainPreference: LifeDomain | null;
    matchingCycleObject: CycleObject | null;
    seenRecently: boolean;
    /** The evaluation instant exactness is measured at; null treats it as unavailable. */
    at: string | null;
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

  const exact = exactness(fact, options.at);
  add("exactness", exact.value, WEIGHTS.exactness, exact.reason);
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
