/**
 * DER-18 eligibility, uncertainty constraints, and the DER-15 consent gate.
 *
 * Rejections are retained with reason codes rather than silently dropped: the
 * registry requires storing "selected and rejected reason codes", and the
 * evidence drawer is the reason.
 */

import {
  INGESTIBLE_SOURCES,
} from "./source-allowlist.generated.js";
import type {
  AssemblyFactInput,
  BirthTimeAccuracy,
  Eligibility,
  NormalizedContextSignal,
  Rejection,
} from "./types.js";

const ACCURACY_RANK: Record<BirthTimeAccuracy, number> = {
  unknown: 0,
  approximate: 1,
  exact: 2,
};

const ANGLE_TARGETS = new Set(["ascendant", "midheaven"]);

export interface EligibilityContext {
  effectiveAccuracy: BirthTimeAccuracy;
  suppressedClasses: ReadonlySet<string>;
  facts: readonly AssemblyFactInput[];
}

/**
 * Whether a calculated fact survives the chart's uncertainty constraints.
 *
 * Suppression happens at the source in the calculation service — angle and
 * natal-Moon targets are never computed under unknown time rather than computed
 * and filtered — so reaching a suppressed fact here means something upstream
 * leaked. It is still checked, because "the other layer handles it" is how the
 * unknown-birth-time invariant gets reintroduced one layer up.
 */
export function factSuppressionReason(
  fact: AssemblyFactInput,
  suppressed: ReadonlySet<string>,
): string | null {
  const target = (fact.target ?? "").toLowerCase();
  if (ANGLE_TARGETS.has(target)) {
    if (suppressed.has("angles")) return "uncertainty_angles_suppressed";
    if (suppressed.has("angle_transits")) return "uncertainty_angle_transits_suppressed";
  }
  if (target === "moon" && suppressed.has("moon_time_sensitive")) {
    return "uncertainty_moon_time_sensitive_suppressed";
  }
  return null;
}

/** Reason code if `eligibility` is not satisfied, else null. */
export function eligibilityRejection(
  eligibility: Eligibility | undefined,
  ctx: EligibilityContext,
  candidate: AssemblyFactInput | null,
): string | null {
  if (!eligibility) return null;

  const {
    required_fact_classes,
    required_bodies,
    required_aspects,
    min_birth_time_accuracy,
    requires_houses,
    techniques,
  } = eligibility;

  if (min_birth_time_accuracy) {
    if (ACCURACY_RANK[ctx.effectiveAccuracy] < ACCURACY_RANK[min_birth_time_accuracy]) {
      return "eligibility_birth_time_accuracy";
    }
  }

  if (requires_houses && ctx.suppressedClasses.has("houses")) {
    return "eligibility_requires_houses_suppressed";
  }

  if (required_fact_classes?.length) {
    const present = new Set(ctx.facts.map((f) => f.fact_class));
    if (!required_fact_classes.every((c) => present.has(c))) {
      return "eligibility_missing_fact_class";
    }
  }

  if (required_bodies?.length) {
    // Bodies may be satisfied by the candidate's own body/target pair or by any
    // fact in the day's set — an object about "Saturn and the Sun" is eligible
    // when the day contains that contact.
    const present = new Set<string>();
    for (const fact of ctx.facts) {
      if (fact.body) present.add(fact.body);
      if (fact.target) present.add(fact.target);
    }
    if (!required_bodies.every((b) => present.has(b))) {
      return "eligibility_missing_body";
    }
  }

  if (required_aspects?.length) {
    const present = new Set(ctx.facts.map((f) => f.aspect).filter(Boolean) as string[]);
    if (!required_aspects.some((a) => present.has(a))) {
      return "eligibility_missing_aspect";
    }
  }

  if (techniques?.length && candidate?.technique) {
    if (!techniques.includes(candidate.technique)) {
      return "eligibility_technique_mismatch";
    }
  }

  return null;
}

/**
 * DER-15 consent, permission, and freshness, plus the registry source gate.
 *
 * The source gate is an explicit generated allowlist, not an id-prefix rule.
 * The schema pattern and the three D1 CHECKs both use `NOT GLOB 'NO-*'`, and
 * AMB-12 ("Major news and world events") is excluded by STATUS while carrying an
 * ingestible prefix — so a signal citing it passes both gates. "No source
 * outside the registry can enter reading assembly" is a launch acceptance
 * criterion, and this is the first code that could violate it.
 */
export function contextRejection(signal: NormalizedContextSignal): string | null {
  if (signal.permission_state !== "active") return "context_permission_inactive";
  if (signal.freshness_status !== "fresh") return "context_not_fresh";

  const registered = INGESTIBLE_SOURCES.get(signal.source_id);
  if (!registered) return "context_source_not_in_registry_allowlist";
  if (!registered.includes(signal.allowed_use)) {
    return "context_use_not_permitted_for_source";
  }
  return null;
}

export function partitionContext(
  signals: readonly NormalizedContextSignal[],
): { eligible: NormalizedContextSignal[]; rejections: Rejection[] } {
  const eligible: NormalizedContextSignal[] = [];
  const rejections: Rejection[] = [];
  for (const signal of signals) {
    const reason = contextRejection(signal);
    if (reason) {
      rejections.push({
        subject_kind: "context",
        subject_id: signal.signal_id,
        reason_code: reason,
        detail: `source ${signal.source_id} for ${signal.allowed_use}`,
      });
    } else {
      eligible.push(signal);
    }
  }
  return { eligible, rejections };
}
