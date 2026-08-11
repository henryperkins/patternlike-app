/**
 * Wire types for `POST /v1/daily-sky` on the calculation service, plus the
 * local-day vocabulary the request identity is built from.
 *
 * These live in `@patternlike/shared` for the same reason the cycle types do:
 * `apps/calc-stub` has to deserialize them, and `packages/reading-engine` is
 * deliberately unreachable from the AGPL service. The widening is kept to the
 * wire shapes, the fact-id preimage, and two closed classification rules —
 * selection, ranking, prompt, and validation policy stay in reading-engine.
 *
 * The endpoint exists because the frozen M3 cycle contract permits an empty
 * result and states that most days have no cycle inside orb. Under M3 that day
 * published the reviewed universal fallback; with the fallback gone it would
 * have nothing calculated to say, and a publisher with a daily promise and no
 * facts invents a premise. A successful response therefore always carries anchor
 * positions and exactly one lunar phase: an empty EVENT list never means an
 * empty FACTUAL day.
 *
 * Normative definitions are `contracts/m5/daily-sky-request.schema.json` and
 * `contracts/m5/daily-sky-response.schema.json`. Wire format is snake_case even
 * though TypeScript is camelCase.
 */

import type { AspectType, BirthTimeAccuracy, CelestialBody } from "./types.js";
import type { PassDirection, SuppressedFeatureClass } from "./cycle-types.js";
import { M5_SCHEMA_VERSION, type M5SchemaVersion } from "./m5-reading-types.js";

/**
 * The normalized projection of a chart's `UncertaintyReport`, structurally the
 * frozen M3 `assemblyUncertaintyInput` and `reading-engine`'s
 * `AssemblyUncertaintyInput`.
 *
 * Restated here because `packages/reading-engine` is deliberately unreachable
 * from the AGPL calculation service, which has to deserialize this request. It
 * excludes `user_facing_summary` for the reason M3 gave: free-form prose that
 * never passes editorial review must not be able to alter an identity.
 */
export interface NormalizedUncertainty {
  accuracy: BirthTimeAccuracy;
  window_plus_minus_minutes: number | null;
  suppressed_features: Array<{
    feature_class: SuppressedFeatureClass;
    feature_id: string | null;
    reason: string;
  }>;
  qualified_features: Array<{ feature_id: string; qualification: string }>;
}

/**
 * The daily-sky policy the calculation service implements, and the only one it
 * will answer for. It refuses a request naming any other id or version rather
 * than quietly scanning under its own — a second hand-copied pair would turn a
 * policy bump into a silent refusal on every reading.
 *
 * The version must bump whenever the fact vocabulary, the root tolerances, the
 * phase bin boundaries, the suppression rules, or the rendered labels can alter
 * output for otherwise identical inputs. Labels are included on purpose: they
 * are inside the fact identity preimage.
 */
export const DAILY_SKY_POLICY_ID = "daily-sky-launch" as const;
export const DAILY_SKY_POLICY_VERSION = "1.0.0" as const;

/**
 * Version of the closed local-day resolution rule: local noon is the anchor; an
 * ambiguous nominal noon takes the EARLIER offset; a nonexistent noon shifts
 * forward to the first valid instant; a wholly unrepresentable local date is
 * skipped rather than approximated.
 *
 * Changing any of those four decisions changes reading inputs, so it changes
 * this version.
 */
export const LOCAL_DAY_RESOLUTION_POLICY_VERSION = "1.0.0" as const;

/** The domain-separation tag inside the `dsf_` hash preimage. */
export const DAILY_SKY_FACT_IDENTITY_PROFILE = "patternlike.daily-sky-fact-id.v1" as const;

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

export const ZODIAC_SIGNS = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
] as const;

export type ZodiacSignName = (typeof ZODIAC_SIGNS)[number];

/**
 * Eight closed 45-degree bins centred on 0, 45, 90, 135, 180, 225, 270, and 315
 * degrees of Sun-to-Moon elongation. Named bins rather than a raw angle because
 * the model may only state a phase that appears in a fact.
 */
export const LUNAR_PHASE_NAMES = [
  "new_moon",
  "waxing_crescent",
  "first_quarter",
  "waxing_gibbous",
  "full_moon",
  "waning_gibbous",
  "last_quarter",
  "waning_crescent",
] as const;

export type LunarPhaseName = (typeof LUNAR_PHASE_NAMES)[number];

/**
 * The declaration order is also the frozen ordering rank.
 *
 * Stations, eclipses, exact lunations, and seasonal points are deliberately
 * absent: an unimplemented event class silently inferred into a reading is a
 * fact the engine never calculated.
 */
export const DAILY_SKY_FACT_KINDS = [
  "anchor_position",
  "lunar_phase",
  "transit_natal_contact",
  "sign_ingress",
  "collective_exact_aspect",
  "house_placement",
] as const;

export type DailySkyFactKind = (typeof DAILY_SKY_FACT_KINDS)[number];

export const DAILY_SKY_FACT_KIND_RANK: Readonly<Record<DailySkyFactKind, number>> =
  Object.freeze(
    Object.fromEntries(DAILY_SKY_FACT_KINDS.map((kind, index) => [kind, index])) as Record<
      DailySkyFactKind,
      number
    >,
  );

/** Facts sampled AT the anchor rather than solved inside the interval. */
export const ANCHOR_SAMPLED_KINDS: ReadonlySet<DailySkyFactKind> = new Set<DailySkyFactKind>([
  "anchor_position",
  "lunar_phase",
  "house_placement",
]);

export const PERSONALIZED_KINDS: ReadonlySet<DailySkyFactKind> = new Set<DailySkyFactKind>([
  "transit_natal_contact",
  "house_placement",
]);

/**
 * No `cycle_window_incomplete`: a daily-sky scan solves a bounded interval and
 * never has to prove the outer boundaries of an encounter.
 */
export type DailySkyErrorClass =
  | "invalid_request"
  | "unsupported_body"
  | "ephemeris_range"
  | "calculation_failed";

/** How the local-noon anchor was resolved against the pinned IANA database. */
export type AnchorResolution =
  | "unique"
  | "ambiguous_earlier"
  | "nonexistent_shift_forward";

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface DailySkyNatalPosition {
  body: CelestialBody;
  longitude_deg: number;
}

/**
 * Supplied ONLY when the effective birth-time accuracy permits houses. Absent is
 * the normal case, not a degraded one: with no cusps the response carries no
 * house fact at all, rather than a house computed from a noon epoch and then
 * labelled uncertain.
 */
export interface NatalHouseCusps {
  house_system: string;
  /** Twelve cusp longitudes in house order starting at the first house. */
  cusps_deg: number[];
}

export interface DailySkyRequest {
  schema_version: M5SchemaVersion;
  request_id: string;
  day_start_at: string;
  /** Half-open. An event exactly here belongs to the NEXT local day. */
  day_end_at: string;
  /** Local noon. Exists on ordinary DST transition days; a cron's firing instant is not a fact. */
  anchor_at: string;
  anchor_resolution: AnchorResolution;
  natal_positions: DailySkyNatalPosition[];
  natal_house_cusps?: NatalHouseCusps | null;
  effective_accuracy: BirthTimeAccuracy;
  uncertainty: NormalizedUncertainty;
  /** Must equal the feature_class set inside `uncertainty.suppressed_features`. */
  suppressed_features: SuppressedFeatureClass[];
  zodiac: "tropical";
  node: "true";
  ephemeris_data_version: string;
  tzdb_version: string;
  local_day_resolution_policy_version: typeof LOCAL_DAY_RESOLUTION_POLICY_VERSION;
  daily_sky_policy_id: typeof DAILY_SKY_POLICY_ID;
  daily_sky_policy_version: string;
  calculation_policy_id: string;
  calculation_policy_version: string;
  contract_id: string;
  contract_version: string;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/** The precision the caller may rely on, stated rather than implied. */
export interface FactPrecision {
  longitude_decimals: number | null;
  instant_resolution_seconds: number | null;
}

export interface AnchorPositionDetail {
  body: CelestialBody;
  longitude_deg: number;
  sign: ZodiacSignName;
  sign_degree_deg: number;
  speed_deg_per_day: number;
  retrograde: boolean;
}

export interface LunarPhaseDetail {
  phase: LunarPhaseName;
  /** Moon longitude minus Sun longitude, normalized. */
  elongation_deg: number;
  illuminated_fraction: number;
}

/**
 * An EXACT contact whose solved root lies inside the half-open local day. Not an
 * in-orb contact: an approaching aspect is the M3 cycle layer's business, and
 * describing one as exact today is the day-specific premise the publisher must
 * not invent.
 */
export interface TransitNatalContactDetail {
  transiting_body: CelestialBody;
  natal_target: CelestialBody;
  aspect: AspectType;
  direction: PassDirection;
  speed_deg_per_day: number;
}

export interface SignIngressDetail {
  body: CelestialBody;
  from_sign: ZodiacSignName;
  to_sign: ZodiacSignName;
  direction: PassDirection;
}

export interface CollectiveExactAspectDetail {
  body: CelestialBody;
  other_body: CelestialBody;
  aspect: AspectType;
  direction: PassDirection;
}

export interface HousePlacementDetail {
  body: CelestialBody;
  house: number;
  house_system: string;
  longitude_deg: number;
}

export type DailySkyFactDetail =
  | AnchorPositionDetail
  | LunarPhaseDetail
  | TransitNatalContactDetail
  | SignIngressDetail
  | CollectiveExactAspectDetail
  | HousePlacementDetail;

/**
 * Everything that defines a fact.
 *
 * Both the wire fact and its hash preimage compose this, so the digest cannot
 * cover a different member set than the wire does.
 */
export interface DailySkyFactCore {
  kind: DailySkyFactKind;
  scope: "personalized" | "collective";
  effective_at: string;
  /** Pre-rendered factual label. Renders a calculated value; states no interpretation. */
  label: string;
  precision: FactPrecision;
  detail: DailySkyFactDetail;
  daily_sky_policy_id: typeof DAILY_SKY_POLICY_ID;
  daily_sky_policy_version: string;
  calculation_policy_id: string;
  calculation_policy_version: string;
  ephemeris_data_version: string;
  container_digest: string;
}

export interface DailySkyFact extends DailySkyFactCore {
  fact_id: string;
  /** SHA-256 over the canonical preimage. `fact_id` is its first 32 hex characters. */
  content_digest: string;
}

/**
 * The closed `dsf_` hash preimage.
 *
 * Deliberately carries no `request_id`: the digest names the FACT, not the
 * request that happened to ask for it, so the same sky produces the same handle
 * in every reading that contains it. The label is inside on purpose — the
 * calculation policy version has to bump for any rendering change anyway, so
 * excluding it would leave that bump with nothing to prove.
 */
export interface DailySkyFactIdentityV1 extends DailySkyFactCore {
  identity_profile: typeof DAILY_SKY_FACT_IDENTITY_PROFILE;
  schema_version: M5SchemaVersion;
}

export interface DailySkyResponseSuccess {
  ok: true;
  schema_version: M5SchemaVersion;
  request_id: string;
  day_start_at: string;
  day_end_at: string;
  anchor_at: string;
  anchor_resolution: AnchorResolution;
  effective_accuracy: BirthTimeAccuracy;
  /** Echoed so the response is self-verifying without holding the request. */
  suppressed_features: SuppressedFeatureClass[];
  daily_sky_policy_id: typeof DAILY_SKY_POLICY_ID;
  daily_sky_policy_version: string;
  calculation_policy_id: string;
  calculation_policy_version: string;
  contract_id: string;
  contract_version: string;
  container_digest: string;
  ephemeris_data_version: string;
  tzdb_version: string;
  /** Ordered by (kind rank, effective_at, fact_id) with unique ids. */
  facts: DailySkyFact[];
}

export interface DailySkyResponseFailure {
  ok: false;
  schema_version: M5SchemaVersion;
  request_id: string;
  error_class: DailySkyErrorClass;
  /** Payload-free. No upstream engine text is echoed verbatim. */
  error_message: string;
}

export type DailySkyResponse = DailySkyResponseSuccess | DailySkyResponseFailure;

// ---------------------------------------------------------------------------
// Identity and ordering
// ---------------------------------------------------------------------------

export class DailySkyIdentityError extends Error {
  readonly code = "daily_sky_identity_error";
  constructor(message: string) {
    super(message);
    this.name = "DailySkyIdentityError";
  }
}

/** `dsf_` + the first 32 lowercase hex characters of the SHA-256 digest. */
export function renderDailySkyFactId(fullDigestHex: string): string {
  if (!/^[a-f0-9]{64}$/.test(fullDigestHex)) {
    throw new DailySkyIdentityError(
      "daily-sky fact id must be rendered from a 64-character lowercase hex SHA-256 digest",
    );
  }
  return "dsf_" + fullDigestHex.slice(0, 32);
}

/**
 * Project a calculated fact into its hash preimage.
 *
 * Fields are copied explicitly rather than spread-and-deleted so a new optional
 * wire field cannot silently enter the identity; adding one has to be a
 * decision.
 */
export function buildDailySkyFactIdentity(core: DailySkyFactCore): DailySkyFactIdentityV1 {
  return {
    identity_profile: DAILY_SKY_FACT_IDENTITY_PROFILE,
    schema_version: M5_SCHEMA_VERSION,
    kind: core.kind,
    scope: core.scope,
    effective_at: core.effective_at,
    label: core.label,
    precision: {
      longitude_decimals: core.precision.longitude_decimals,
      instant_resolution_seconds: core.precision.instant_resolution_seconds,
    },
    detail: core.detail,
    daily_sky_policy_id: core.daily_sky_policy_id,
    daily_sky_policy_version: core.daily_sky_policy_version,
    calculation_policy_id: core.calculation_policy_id,
    calculation_policy_version: core.calculation_policy_version,
    ephemeris_data_version: core.ephemeris_data_version,
    container_digest: core.container_digest,
  };
}

/**
 * The contractual total order, applied BEFORE canonicalization because JCS
 * deliberately preserves array order — an unsorted array is a different input
 * manifest for the same sky.
 */
export function orderDailySkyFacts<T extends { kind: DailySkyFactKind; effective_at: string; fact_id: string }>(
  facts: readonly T[],
): T[] {
  return [...facts].sort((a, b) => {
    const rank = DAILY_SKY_FACT_KIND_RANK[a.kind] - DAILY_SKY_FACT_KIND_RANK[b.kind];
    if (rank !== 0) return rank;
    if (a.effective_at !== b.effective_at) return a.effective_at < b.effective_at ? -1 : 1;
    return a.fact_id < b.fact_id ? -1 : a.fact_id > b.fact_id ? 1 : 0;
  });
}

/** Which sign a normalized ecliptic longitude falls in. */
export function zodiacSignOf(longitudeDeg: number): ZodiacSignName {
  const normalized = ((longitudeDeg % 360) + 360) % 360;
  return ZODIAC_SIGNS[Math.floor(normalized / 30)]!;
}

/**
 * The bin a Sun-to-Moon elongation falls in.
 *
 * Bins are centred on multiples of 45 degrees and are 45 degrees wide, so the
 * boundaries sit at 22.5 degrees either side of each centre. Rounding rather
 * than flooring is what puts 359 degrees back in `new_moon` instead of inventing
 * a ninth bin.
 */
export function lunarPhaseOf(elongationDeg: number): LunarPhaseName {
  const normalized = ((elongationDeg % 360) + 360) % 360;
  const bin = Math.round(normalized / 45) % 8;
  return LUNAR_PHASE_NAMES[bin]!;
}

// ---------------------------------------------------------------------------
// Local day
// ---------------------------------------------------------------------------

/**
 * Which local day a generation command is for, and the exact UTC interval that
 * day occupies.
 *
 * Resolved ONCE at enqueue from the trusted enqueue instant in the user's stored
 * scheduling zone, never from a client-supplied date and never from a worker's
 * later attempt time. That is what makes a retry reproducible across a midnight
 * rollover: the frozen command already names the day, so an attempt at 00:04 the
 * next morning still generates yesterday's reading rather than silently becoming
 * a different one.
 */
export interface LocalDayWindow {
  /** Civil date in the scheduling zone, YYYY-MM-DD. */
  targetLocalDate: string;
  /** Half-open: the local day is [dayStartAt, dayEndAt). */
  dayStartAt: string;
  dayEndAt: string;
}

/**
 * A local day plus the anchor and the exact database versions that resolved it.
 *
 * `tzdbVersion` is pinned rather than inherited from the runtime: `Intl` carries
 * whatever tz database the platform shipped, and a Worker deployment that
 * silently updated it would move a reader's day boundaries without changing any
 * value the command records.
 */
export interface DailySkyWindow extends LocalDayWindow {
  anchorAt: string;
  anchorResolution: AnchorResolution;
  tzdbVersion: string;
  localDayResolutionPolicyVersion: typeof LOCAL_DAY_RESOLUTION_POLICY_VERSION;
}

/**
 * A date-line change can delete an entire local date — Pacific/Apia never had a
 * 2011-12-30. There is no defensible reading for a day that did not happen, so
 * the scheduler records the skip and advances rather than approximating one.
 */
export type LocalDateResolution =
  | { ok: true; window: DailySkyWindow }
  | { ok: false; reason: "skipped_local_date"; nextRepresentableDate: string };

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export type V5CalculationErrorClass =
  | "invalid_request"
  | "unsupported_body"
  | "ephemeris_range"
  | "cycle_window_incomplete"
  | "calculation_failed";

export type V5CalculationFailure =
  | "calc_unavailable"
  | "daily_sky_unavailable"
  | "policy_unsupported";

/**
 * Which generation failure an engine refusal becomes.
 *
 * Only `calculation_failed` is worth another delivery: it says the engine tried
 * and something transient went wrong. The other four are deterministic refusals
 * of the exact frozen request, so a retry reproduces them byte for byte —
 * treating those as retryable would spend the whole job budget re-asking a
 * question that already has its final answer.
 *
 * The two unavailable classes are kept apart because they name different
 * dependencies, and an operator reading a failure count needs to know which
 * endpoint is down.
 */
export function classifyV5CalculationFailure(
  endpoint: "cycles" | "daily_sky",
  errorClass: V5CalculationErrorClass,
): V5CalculationFailure {
  if (errorClass === "calculation_failed") {
    return endpoint === "cycles" ? "calc_unavailable" : "daily_sky_unavailable";
  }
  return "policy_unsupported";
}
