/**
 * The assembly identity preimage (D3).
 *
 * Content-addressed, not user-addressed. Three properties fall out and each is
 * load-bearing:
 *
 *  1. No user identifier, crypto subject, session, job id, storage row id, or
 *     attempt count crosses the boundary — because none is declared here.
 *  2. It is not a stable pseudonym. The fact set changes daily, so the same user
 *     gets an unrelated id each day. A hash *of* the user id would not have this
 *     property, which is why the input is the closed identity preimage rather
 *     than the account identity.
 *  3. Identical versioned inputs produce an identical id, while an uncertainty
 *     or engine-policy change that can alter output necessarily produces a
 *     different one. That is reproducibility without pretending code version is
 *     not part of the input.
 */

import { jcsCanonicalize } from "./jcs.js";
import type {
  AssemblyContextInput,
  AssemblyFactInput,
  AssemblyIdentityInputV1,
  AssemblyInput,
  AssemblyUncertaintyInput,
  NormalizedContextSignal,
  NormalizedCycle,
} from "./types.js";
import { computePhase } from "./phase.js";

export class IdentityConsistencyError extends Error {
  readonly code = "identity_inconsistent";
  constructor(message: string) {
    super(message);
    this.name = "IdentityConsistencyError";
  }
}

/** Total order on facts: (first_exact_at, id). Applied before canonicalization. */
function compareFacts(a: AssemblyFactInput, b: AssemblyFactInput): number {
  const at = a.first_exact_at ?? "";
  const bt = b.first_exact_at ?? "";
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Total order on context: (source_id, signal_id). */
function compareContext(a: AssemblyContextInput, b: AssemblyContextInput): number {
  if (a.source_id !== b.source_id) return a.source_id < b.source_id ? -1 : 1;
  return a.signal_id < b.signal_id ? -1 : a.signal_id > b.signal_id ? 1 : 0;
}

/**
 * Normalize the uncertainty report into the projection that enters the hash.
 *
 * `user_facing_summary` is deliberately dropped: it is free-form prose that
 * never passes editorial review, so it must not be able to change a reviewed
 * artifact's identity.
 */
export function projectUncertainty(
  uncertainty: AssemblyUncertaintyInput,
): AssemblyUncertaintyInput {
  return {
    accuracy: uncertainty.accuracy,
    window_plus_minus_minutes: uncertainty.window_plus_minus_minutes ?? null,
    suppressed_features: [...uncertainty.suppressed_features]
      .map((f) => ({
        feature_class: f.feature_class,
        feature_id: f.feature_id ?? null,
        reason: f.reason,
      }))
      .sort((a, b) => {
        if (a.feature_class !== b.feature_class)
          return a.feature_class < b.feature_class ? -1 : 1;
        const ai = a.feature_id ?? "";
        const bi = b.feature_id ?? "";
        if (ai !== bi) return ai < bi ? -1 : 1;
        return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
      }),
    qualified_features: [...uncertainty.qualified_features]
      .map((f) => ({ feature_id: f.feature_id, qualification: f.qualification }))
      .sort((a, b) => {
        if (a.feature_id !== b.feature_id) return a.feature_id < b.feature_id ? -1 : 1;
        return a.qualification < b.qualification
          ? -1
          : a.qualification > b.qualification
            ? 1
            : 0;
      }),
  };
}

/** Project one calculated cycle into its identity-preimage form. */
export function projectCycle(cycle: NormalizedCycle, localDayMidpoint: string): AssemblyFactInput {
  return {
    id: cycle.id,
    fact_class: "cycle_instance",
    technique: cycle.technique,
    body: cycle.body,
    target: cycle.target,
    aspect: cycle.aspect,
    phase: computePhase(cycle, localDayMidpoint),
    orb_deg: cycle.orb_deg,
    first_exact_at: cycle.passes[0]?.exact_at ?? cycle.exact_at,
    pass_count: cycle.pass_count,
  };
}

/** Project one eligible context signal into its minimized preimage form. */
export function projectContext(signal: NormalizedContextSignal): AssemblyContextInput {
  const projected: AssemblyContextInput = {
    signal_id: signal.signal_id,
    source_id: signal.source_id,
    allowed_use: signal.allowed_use,
    evidence_lane: signal.evidence_lane,
  };
  if (signal.normalized_hash !== undefined) {
    projected.normalized_hash = signal.normalized_hash;
  }
  return projected;
}

/** The UTC midpoint of the frozen local day, used to evaluate cycle phase. */
export function localDayMidpoint(dayStartAt: string, dayEndAt: string): string {
  const start = Date.parse(dayStartAt);
  const end = Date.parse(dayEndAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new IdentityConsistencyError(
      `day_start_at/day_end_at are not parseable instants: ${dayStartAt} .. ${dayEndAt}`,
    );
  }
  if (end <= start) {
    throw new IdentityConsistencyError(
      `day_end_at ${dayEndAt} must be after day_start_at ${dayStartAt}`,
    );
  }
  return new Date(start + Math.floor((end - start) / 2)).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function buildAssemblyIdentity(
  input: AssemblyInput,
  eligibleFacts: AssemblyFactInput[],
  eligibleContext: AssemblyContextInput[],
): AssemblyIdentityInputV1 {
  const uncertainty = projectUncertainty(input.chart.uncertainty);

  // Two disagreeing copies of one decision is how an unknown-time chart
  // acquires an exact-time reading.
  if (input.chart.effective_accuracy !== uncertainty.accuracy) {
    throw new IdentityConsistencyError(
      `effective_accuracy ${input.chart.effective_accuracy} disagrees with ` +
        `uncertainty.accuracy ${uncertainty.accuracy}`,
    );
  }

  return {
    identity_profile: input.identity_profile,
    schema_version: input.schema_version,
    assembly_policy_id: input.assembly_policy_id,
    assembly_policy_version: input.assembly_policy_version,
    output_schema: input.output_schema,
    local_date: input.local_date,
    target_timezone: input.target_timezone,
    generation_anchor: input.generation_anchor,
    chart_fingerprint: input.chart.fingerprint,
    effective_accuracy: input.chart.effective_accuracy,
    uncertainty,
    facts: [...eligibleFacts].sort(compareFacts),
    release_version: input.release.release.version,
    release_bundle_hash: input.release.release.bundle_hash,
    context: [...eligibleContext].sort(compareContext),
    locale: input.locale,
    domain_preference: input.domain_preference,
    revision: input.revision,
  };
}

/**
 * Canonical bytes for an identity preimage.
 *
 * Returns text rather than a digest on purpose: SHA-256 in Workers is async
 * WebCrypto, and the engine's whole value is that it is synchronous and pure.
 * The caller hashes these bytes and calls finalizeReading().
 */
export function canonicalizeIdentity(identity: AssemblyIdentityInputV1): string {
  return jcsCanonicalize(identity);
}

/** `asm_` + the first 32 lowercase hex characters of the SHA-256 digest. */
export function renderAssemblyId(fullDigestHex: string): string {
  if (!/^[a-f0-9]{64}$/.test(fullDigestHex)) {
    throw new IdentityConsistencyError(
      "assembly id must be rendered from a 64-character lowercase hex SHA-256 digest",
    );
  }
  return "asm_" + fullDigestHex.slice(0, 32);
}
