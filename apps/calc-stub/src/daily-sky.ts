/**
 * `POST /v1/daily-sky` — the calculated facts for one resolved local day.
 *
 * This exists because the frozen M3 cycle contract permits an empty result and
 * says most days contain no cycle inside orb. Under M3 that day published the
 * locale's reviewed universal fallback. With the fallback gone, the same day
 * would have nothing calculated to say — and a publisher with a daily promise
 * and no facts invents a premise. Anchor positions and one lunar phase are
 * therefore always present when calculation succeeds, so an empty EVENT list
 * never means an empty FACTUAL day.
 *
 * The scan is bounded in a way `POST /v1/cycles` is not: one local day, at most
 * 25 hours, with both ends supplied by the caller. There is no lift chain, no
 * unwrapping epoch, and no lookaround, because nothing here has to prove the
 * outer boundaries of an encounter — which is also why this endpoint's error
 * vocabulary has no `cycle_window_incomplete`. `handleCycleScan` is neither
 * called nor modified.
 *
 * Purity: `calculateDailySky` takes an `EphemerisSource`, so the whole policy is
 * testable against an analytic ephemeris with no data files and no network.
 */

import { createHash } from "node:crypto";
import {
  ANCHOR_SAMPLED_KINDS,
  DAILY_SKY_POLICY_ID,
  DAILY_SKY_POLICY_VERSION,
  M5_SCHEMA_VERSION,
  buildDailySkyFactIdentity,
  jcsCanonicalize,
  lunarPhaseOf,
  orderDailySkyFacts,
  renderDailySkyFactId,
  type AspectType,
  type CelestialBody,
  type DailySkyFact,
  type DailySkyFactCore,
  type DailySkyRequest,
  type DailySkyResponse,
  type NormalizedUncertainty,
  type SuppressedFeatureClass,
  type ZodiacSignName,
} from "@patternlike/shared";
import {
  ASPECT_ANGLE_BY_TYPE,
  EPHEMERIS_DATA_VERSION,
  EPHEMERIS_MAX_YEAR,
  EPHEMERIS_MIN_YEAR,
  SE_ID_BY_BODY,
  STUB_CONTAINER_DIGEST,
  houseNumber,
  isWithinEphemerisCoverage,
  norm360,
  signOf,
} from "./engine.js";
import {
  UnsupportedBodyError,
  jdFromUnixMs,
  jdToIso,
  orientedTargets,
  swissEphemerisSource,
  wrap180,
  type EphemerisSource,
} from "./cycles.js";
import { TRANSITING_BODIES, type TransitingBody } from "./cycle-policy.js";
import {
  ANGULAR_ZERO_TOLERANCE_DEG,
  COLLECTIVE_ASPECTS,
  COLLECTIVE_ASPECT_BODIES,
  DAILY_SKY_BODIES,
  INSTANT_RESOLUTION_SECONDS,
  LONGITUDE_DECIMALS,
  ROOT_DEDUPE_TOLERANCE_DAYS,
  ROOT_TIME_TOLERANCE_DAYS,
  SCAN_STEP_DAYS,
} from "./daily-sky-policy.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type DailySkyErrorClass =
  | "invalid_request"
  | "unsupported_body"
  | "ephemeris_range"
  | "calculation_failed";

export class DailySkyRequestError extends Error {
  constructor(
    readonly errorClass: DailySkyErrorClass,
    message: string,
  ) {
    super(message);
    this.name = "DailySkyRequestError";
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidatedDailySkyRequest {
  request: DailySkyRequest;
  dayStartJd: number;
  dayEndJd: number;
  anchorJd: number;
}

export interface DailySkyOptions {
  source?: EphemerisSource;
  containerDigest?: string;
  ephemerisDataVersion?: string;
  bodies?: readonly TransitingBody[];
}

const OPAQUE_ID_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const SUPPRESSED_CLASSES: readonly SuppressedFeatureClass[] = [
  "houses",
  "angles",
  "angle_transits",
  "moon_time_sensitive",
];

function fail(errorClass: DailySkyErrorClass, message: string): never {
  throw new DailySkyRequestError(errorClass, message);
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid_request", `${key} must be a non-empty string`);
  }
  return value;
}

function requireInstant(body: Record<string, unknown>, key: string): number {
  const value = requireString(body, key);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail("invalid_request", `${key} is not an instant`);
  return ms;
}

function requireLongitude(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 360) {
    fail("invalid_request", `${label} must be a longitude in [0, 360)`);
  }
  return value;
}

/**
 * Validate the request, and refuse anything this build cannot answer honestly.
 *
 * The object is closed by contract, and the checks below are the half a JSON
 * schema cannot express: that the day and the anchor agree, that the two copies
 * of the accuracy decision agree, and that no suppressed feature arrived as an
 * input. That last one is why suppression is enforced here and not later —
 * a natal Moon longitude that reached the scanner would come back as a contact
 * the uncertainty report says is unavailable.
 */
/** Truncated for the error message; an undeclared key is caller-supplied text. */
function quoteKey(value: string): string {
  const points = Array.from(value);
  const shown = points.length <= 40 ? value : points.slice(0, 40).join("") + "\u2026";
  return JSON.stringify(shown);
}

/**
 * Refuse a property the contract does not declare.
 *
 * The closure IS the enforcement, and repeating it at the service is the point:
 * it refuses the same things whether or not anything validated the body
 * upstream. This request is the one document that must never carry a user id, a
 * birth instant, a coordinate, or a zone name into a service with no decryption
 * path, and the M5 schema and the calc OpenAPI both say the closed object is
 * what keeps them out. `/v1/cycles` has done this since M3; this endpoint was
 * shipped without it, so the guarantee was a comment rather than a check.
 */
function closeObject(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  const permitted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!permitted.has(key)) {
      fail("invalid_request", `undeclared property ${quoteKey(key)} in ${where}`);
    }
  }
}

const REQUEST_KEYS = [
  "schema_version",
  "request_id",
  "day_start_at",
  "day_end_at",
  "anchor_at",
  "anchor_resolution",
  "natal_positions",
  "natal_house_cusps",
  "effective_accuracy",
  "uncertainty",
  "suppressed_features",
  "zodiac",
  "node",
  "ephemeris_data_version",
  "tzdb_version",
  "local_day_resolution_policy_version",
  "daily_sky_policy_id",
  "daily_sky_policy_version",
  "calculation_policy_id",
  "calculation_policy_version",
  "contract_id",
  "contract_version",
] as const;

const NATAL_POSITION_KEYS = ["body", "longitude_deg"] as const;
const HOUSE_CUSPS_KEYS = ["house_system", "cusps_deg"] as const;
const UNCERTAINTY_KEYS = [
  "accuracy",
  "window_plus_minus_minutes",
  "suppressed_features",
  "qualified_features",
] as const;

export function validateDailySkyRequest(body: unknown): ValidatedDailySkyRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("invalid_request", "request body must be an object");
  }
  const raw = body as Record<string, unknown>;
  closeObject(raw, REQUEST_KEYS, "the request");

  const declaredPositions = raw.natal_positions;
  if (Array.isArray(declaredPositions)) {
    for (const entry of declaredPositions) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        closeObject(entry as Record<string, unknown>, NATAL_POSITION_KEYS, "natal_positions");
      }
    }
  }
  const declaredCusps = raw.natal_house_cusps;
  if (declaredCusps && typeof declaredCusps === "object" && !Array.isArray(declaredCusps)) {
    closeObject(declaredCusps as Record<string, unknown>, HOUSE_CUSPS_KEYS, "natal_house_cusps");
  }
  const declaredUncertainty = raw.uncertainty;
  if (declaredUncertainty && typeof declaredUncertainty === "object" && !Array.isArray(declaredUncertainty)) {
    closeObject(declaredUncertainty as Record<string, unknown>, UNCERTAINTY_KEYS, "uncertainty");
  }

  if (raw.schema_version !== M5_SCHEMA_VERSION) {
    fail("invalid_request", `schema_version must be ${M5_SCHEMA_VERSION}`);
  }
  const requestId = requireString(raw, "request_id");
  if (!OPAQUE_ID_RE.test(requestId)) fail("invalid_request", "request_id is not an opaque id");

  const dayStartMs = requireInstant(raw, "day_start_at");
  const dayEndMs = requireInstant(raw, "day_end_at");
  const anchorMs = requireInstant(raw, "anchor_at");
  if (dayStartMs >= dayEndMs) fail("invalid_request", "day_start_at is not before day_end_at");
  if (anchorMs < dayStartMs || anchorMs >= dayEndMs) {
    fail("invalid_request", "anchor_at lies outside the half-open local day");
  }
  if (dayEndMs - dayStartMs > 26 * 3_600_000) {
    fail("invalid_request", "a local day cannot exceed 26 hours");
  }

  const anchorResolution = requireString(raw, "anchor_resolution");
  if (!["unique", "ambiguous_earlier", "nonexistent_shift_forward"].includes(anchorResolution)) {
    fail("invalid_request", "anchor_resolution is not a known resolution");
  }

  if (raw.zodiac !== "tropical") fail("invalid_request", "only the tropical zodiac is implemented");
  if (raw.node !== "true") fail("invalid_request", "only the true node is implemented");

  if (raw.daily_sky_policy_id !== DAILY_SKY_POLICY_ID) {
    fail("invalid_request", "this build does not implement the requested daily-sky policy");
  }
  if (raw.daily_sky_policy_version !== DAILY_SKY_POLICY_VERSION) {
    // A version this build does not implement is refused rather than answered
    // under the one it has. Answering would put a policy label on facts the
    // policy never produced.
    fail("invalid_request", "this build does not implement the requested daily-sky policy version");
  }
  requireString(raw, "calculation_policy_id");
  requireString(raw, "calculation_policy_version");
  requireString(raw, "contract_id");
  requireString(raw, "contract_version");
  requireString(raw, "ephemeris_data_version");
  requireString(raw, "tzdb_version");
  if (raw.local_day_resolution_policy_version !== "1.0.0") {
    fail("invalid_request", "this build does not implement the requested local-day policy version");
  }

  const accuracy = requireString(raw, "effective_accuracy");
  if (!["exact", "approximate", "unknown"].includes(accuracy)) {
    fail("invalid_request", "effective_accuracy is not a known accuracy");
  }

  const uncertainty = raw.uncertainty as NormalizedUncertainty | undefined;
  if (!uncertainty || typeof uncertainty !== "object") {
    fail("invalid_request", "uncertainty is required");
  }
  if (uncertainty.accuracy !== accuracy) {
    fail("invalid_request", "effective_accuracy disagrees with uncertainty.accuracy");
  }

  const declared = raw.suppressed_features;
  if (!Array.isArray(declared) || declared.some((v) => typeof v !== "string")) {
    fail("invalid_request", "suppressed_features must be an array of strings");
  }
  for (const value of declared as string[]) {
    if (!SUPPRESSED_CLASSES.includes(value as SuppressedFeatureClass)) {
      fail("invalid_request", `unknown suppressed feature class ${value}`);
    }
  }
  const suppressed = new Set(declared as SuppressedFeatureClass[]);
  const projected = new Set(
    (uncertainty.suppressed_features ?? []).map((f) => f.feature_class),
  );
  if (
    suppressed.size !== projected.size ||
    [...suppressed].some((value) => !projected.has(value))
  ) {
    fail("invalid_request", "suppressed_features disagrees with the uncertainty report");
  }

  const positions = raw.natal_positions;
  if (!Array.isArray(positions) || positions.length === 0) {
    fail("invalid_request", "natal_positions must be a non-empty array");
  }
  const natal: Array<{ body: CelestialBody; longitude_deg: number }> = [];
  const seen = new Set<string>();
  for (const entry of positions) {
    if (!entry || typeof entry !== "object") fail("invalid_request", "natal position must be an object");
    const position = entry as Record<string, unknown>;
    const bodyName = requireString(position, "body") as CelestialBody;
    if (!(bodyName in SE_ID_BY_BODY) && bodyName !== "ascendant" && bodyName !== "midheaven") {
      fail("unsupported_body", `unsupported natal target ${bodyName}`);
    }
    if (seen.has(bodyName)) fail("invalid_request", `duplicate natal target ${bodyName}`);
    seen.add(bodyName);
    natal.push({
      body: bodyName,
      longitude_deg: requireLongitude(position.longitude_deg, `natal ${bodyName} longitude`),
    });
  }

  const anglesSuppressed = suppressed.has("angles") || suppressed.has("angle_transits");
  if (anglesSuppressed && natal.some((p) => p.body === "ascendant" || p.body === "midheaven")) {
    fail("invalid_request", "angle targets supplied while angles are suppressed");
  }
  if (suppressed.has("moon_time_sensitive") && natal.some((p) => p.body === "moon")) {
    fail("invalid_request", "natal moon supplied while moon_time_sensitive is suppressed");
  }

  let cusps: { house_system: string; cusps_deg: number[] } | null = null;
  const rawCusps = raw.natal_house_cusps;
  if (rawCusps !== undefined && rawCusps !== null) {
    if (typeof rawCusps !== "object" || Array.isArray(rawCusps)) {
      fail("invalid_request", "natal_house_cusps must be an object");
    }
    const houses = rawCusps as Record<string, unknown>;
    const system = requireString(houses, "house_system");
    const values = houses.cusps_deg;
    if (!Array.isArray(values) || values.length !== 12) {
      fail("invalid_request", "natal_house_cusps.cusps_deg must hold twelve longitudes");
    }
    cusps = {
      house_system: system,
      cusps_deg: values.map((v, i) => requireLongitude(v, `house cusp ${i + 1}`)),
    };
  }
  if (cusps && suppressed.has("houses")) {
    fail("invalid_request", "house cusps supplied while houses are suppressed");
  }

  const startYear = new Date(dayStartMs).getUTCFullYear();
  const endYear = new Date(dayEndMs).getUTCFullYear();
  if (
    startYear < EPHEMERIS_MIN_YEAR ||
    endYear < EPHEMERIS_MIN_YEAR ||
    startYear > EPHEMERIS_MAX_YEAR ||
    endYear > EPHEMERIS_MAX_YEAR
  ) {
    // Refused before reaching the engine: outside the pinned data range Swiss
    // Ephemeris silently substitutes Moshier and its failure message embeds the
    // ephemeris directory path.
    fail("ephemeris_range", "the local day lies outside the pinned ephemeris range");
  }

  const dayStartJd = jdFromUnixMs(dayStartMs);
  const dayEndJd = jdFromUnixMs(dayEndMs);
  // The year test above cannot see the sliver at each end of the range that the
  // pinned files do not answer for every body — a local day starting
  // 1800-01-01T05:00Z is inside year 1800 and still ahead of Pluto's first
  // segment. Refusing it here names the reason; letting it through would reach
  // calcBody's Moshier refusal and come back as `calculation_failed`.
  if (!isWithinEphemerisCoverage(dayStartJd) || !isWithinEphemerisCoverage(dayEndJd)) {
    fail("ephemeris_range", "the local day lies outside the pinned ephemeris range");
  }

  return {
    request: raw as unknown as DailySkyRequest,
    dayStartJd,
    dayEndJd,
    anchorJd: jdFromUnixMs(anchorMs),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const BODY_LABEL: Record<CelestialBody, string> = {
  sun: "Sun",
  moon: "Moon",
  mercury: "Mercury",
  venus: "Venus",
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
  uranus: "Uranus",
  neptune: "Neptune",
  pluto: "Pluto",
  true_node: "True Node",
  ascendant: "Ascendant",
  midheaven: "Midheaven",
};

const SIGN_LABEL: Record<ZodiacSignName, string> = {
  aries: "Aries",
  taurus: "Taurus",
  gemini: "Gemini",
  cancer: "Cancer",
  leo: "Leo",
  virgo: "Virgo",
  libra: "Libra",
  scorpio: "Scorpio",
  sagittarius: "Sagittarius",
  capricorn: "Capricorn",
  aquarius: "Aquarius",
  pisces: "Pisces",
};

const ASPECT_LABEL: Record<AspectType, string> = {
  conjunction: "conjunct",
  sextile: "sextile",
  square: "square",
  trine: "trine",
  opposition: "opposite",
};

const HOUSE_LABEL = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
];

const PHASE_LABEL: Record<string, string> = {
  new_moon: "New Moon",
  waxing_crescent: "Waxing crescent Moon",
  first_quarter: "First quarter Moon",
  waxing_gibbous: "Waxing gibbous Moon",
  full_moon: "Full Moon",
  waning_gibbous: "Waning gibbous Moon",
  last_quarter: "Last quarter Moon",
  waning_crescent: "Waning crescent Moon",
};

/**
 * Round to the declared precision BEFORE the value enters a label or an
 * identity preimage.
 *
 * An unrounded double carries bisection noise in its last bits, so two runs
 * that agree to a microdegree would otherwise mint two different `dsf_` handles
 * for one fact.
 */
function round6(value: number): number {
  const rounded = Number(value.toFixed(LONGITUDE_DECIMALS));
  // -0 and 0 canonicalize differently under JCS; a longitude has no sign.
  return rounded === 0 ? 0 : rounded;
}

const DEGREE_PRECISION = {
  longitude_decimals: LONGITUDE_DECIMALS,
  instant_resolution_seconds: null,
} as const;

const ROOT_PRECISION = {
  longitude_decimals: null,
  instant_resolution_seconds: INSTANT_RESOLUTION_SECONDS,
} as const;

// ---------------------------------------------------------------------------
// Root finding
// ---------------------------------------------------------------------------

type AngleFn = (jd: number) => number;

/**
 * Deterministic bisection to a two-second bracket, which is a one-second
 * timestamp after rounding.
 *
 * Identical to the cycle scanner's stopping rule, for the same reason: the root
 * instant enters an identity preimage, so "close enough" has to be a fixed
 * number rather than an iteration count that could vary with the compiler.
 */
function bisect(f: AngleFn, lo: number, hi: number, signAtLo: number): number {
  let low = lo;
  let high = hi;
  while (high - low > ROOT_TIME_TOLERANCE_DAYS) {
    const mid = (low + high) / 2;
    if (Math.sign(f(mid)) === signAtLo) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Every root of `f` inside `[from, to)`.
 *
 * A `wrap180` angle jumps by ~360 when the pair passes the antipode, and that
 * jump is a sign change that is not a root. The 180-degree guard is what
 * separates the two: at a 15-minute grid step the fastest body moves 0.14
 * degrees, so a genuine bracket can never look like an antipodal jump.
 */
/** One second, in the days that Julian-day arithmetic uses. */
const ONE_SECOND_DAYS = 1 / 86_400;

function rootsIn(f: AngleFn, from: number, to: number): number[] {
  const roots: number[] = [];
  const toIso = jdToIso(to);
  const push = (raw: number) => {
    if (raw < from || raw >= to) return;
    // Bound the RENDERED instant, not only the raw root. jdToIso rounds to the
    // nearest second, so a true root in the final half-second of the interval
    // rendered as exactly day_end_at — which the response contract, the calc
    // OpenAPI, and the end-boundary invalid fixture all declare belongs to the
    // NEXT local day. Clamping back to the last second still inside the
    // interval keeps the fact on the day it actually happened; dropping it
    // would lose it entirely, because the next day's scan starts at this same
    // instant and requires jd >= from. The shift is at most one second, which
    // is the resolution this fact class already declares.
    const jd = jdToIso(raw) >= toIso ? to - ONE_SECOND_DAYS : raw;
    if (roots.some((existing) => Math.abs(existing - jd) <= ROOT_DEDUPE_TOLERANCE_DAYS)) return;
    roots.push(jd);
  };

  let previousJd = from;
  let previous = f(previousJd);
  if (Math.abs(previous) <= ANGULAR_ZERO_TOLERANCE_DEG) push(previousJd);

  // Grid points are `from + i * step`, never an accumulating sum. Accumulation
  // drifts, and drifted grid points would be different floats for different
  // functions — which defeats the per-body sample cache and, worse, would let
  // two runs bracket the same root from slightly different places.
  const steps = Math.ceil((to - from) / SCAN_STEP_DAYS);
  for (let i = 1; i <= steps; i += 1) {
    const current = Math.min(from + i * SCAN_STEP_DAYS, to);
    const value = f(current);
    if (Math.abs(value) <= ANGULAR_ZERO_TOLERANCE_DEG) {
      push(current);
    } else if (
      Math.abs(previous) > ANGULAR_ZERO_TOLERANCE_DEG &&
      Math.sign(previous) !== Math.sign(value) &&
      Math.abs(previous - value) < 180
    ) {
      push(bisect(f, previousJd, current, Math.sign(previous)));
    }
    if (current >= to) break;
    previousJd = current;
    previous = value;
  }
  return roots.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

interface FactContext {
  containerDigest: string;
  ephemerisDataVersion: string;
  calculationPolicyId: string;
  calculationPolicyVersion: string;
}

function core(
  ctx: FactContext,
  kind: DailySkyFactCore["kind"],
  effectiveAt: string,
  label: string,
  detail: DailySkyFactCore["detail"],
): DailySkyFactCore {
  return {
    kind,
    scope:
      kind === "transit_natal_contact" || kind === "house_placement"
        ? "personalized"
        : "collective",
    effective_at: effectiveAt,
    label,
    precision: ANCHOR_SAMPLED_KINDS.has(kind) ? { ...DEGREE_PRECISION } : { ...ROOT_PRECISION },
    detail,
    daily_sky_policy_id: DAILY_SKY_POLICY_ID,
    daily_sky_policy_version: DAILY_SKY_POLICY_VERSION,
    calculation_policy_id: ctx.calculationPolicyId,
    calculation_policy_version: ctx.calculationPolicyVersion,
    ephemeris_data_version: ctx.ephemerisDataVersion,
    container_digest: ctx.containerDigest,
  };
}

/**
 * Seal a fact with its content-addressed identity.
 *
 * The preimage builder and the canonicalizer come from `@patternlike/shared`,
 * so this and the Worker's async `sealDailySkyFact` differ only in which SHA-256
 * they call. The golden vectors in `contracts/m5` pin both.
 */
function seal(factCore: DailySkyFactCore): DailySkyFact {
  const digest = createHash("sha256")
    .update(jcsCanonicalize(buildDailySkyFactIdentity(factCore)), "utf8")
    .digest("hex");
  return { ...factCore, fact_id: renderDailySkyFactId(digest), content_digest: `sha256:${digest}` };
}

export function calculateDailySky(
  validated: ValidatedDailySkyRequest,
  options: DailySkyOptions = {},
): DailySkyFact[] {
  const source = options.source ?? swissEphemerisSource;
  const { request, dayStartJd, dayEndJd, anchorJd } = validated;
  const bodies = options.bodies ?? DAILY_SKY_BODIES;
  const ctx: FactContext = {
    containerDigest: options.containerDigest ?? STUB_CONTAINER_DIGEST,
    ephemerisDataVersion: options.ephemerisDataVersion ?? EPHEMERIS_DATA_VERSION,
    calculationPolicyId: request.calculation_policy_id,
    calculationPolicyVersion: request.calculation_policy_version,
  };
  const anchorAt = jdToIso(anchorJd);

  /**
   * Memoised body state, cleared with every call.
   *
   * Without this the scan is quadratic in the wrong direction: every
   * (body, natal target, aspect branch) pair walks the same 96-point grid, and
   * every (body pair, aspect branch) walks it twice, so a ten-body day with ten
   * natal targets asks Swiss Ephemeris for the same longitude roughly two
   * hundred thousand times. The grid points are identical floats across all of
   * those functions by construction, so one sample per (body, instant) answers
   * all of them — about sixteen hundred calls instead.
   */
  const stateCache = new Map<string, { lon: number; speed: number }>();
  const stateAt = (body: TransitingBody, jd: number) => {
    const key = `${body}|${jd}`;
    let cached = stateCache.get(key);
    if (!cached) {
      const state = source.stateAt(body, jd);
      cached = { lon: norm360(state.lon), speed: state.speed };
      stateCache.set(key, cached);
    }
    return cached;
  };
  const lonAt = (body: TransitingBody, jd: number) => stateAt(body, jd).lon;

  const facts: DailySkyFactCore[] = [];

  // --- anchor positions -----------------------------------------------------
  const anchorState = new Map<TransitingBody, { lon: number; speed: number }>();
  for (const body of bodies) {
    const state = stateAt(body, anchorJd);
    const lon = round6(state.lon);
    const speed = round6(state.speed);
    anchorState.set(body, { lon, speed });
    const sign = signOf(lon);
    const signDegree = round6(lon - Math.floor(lon / 30) * 30);
    facts.push(
      core(
        ctx,
        "anchor_position",
        anchorAt,
        `${BODY_LABEL[body]} at ${signDegree.toFixed(2)} degrees ${SIGN_LABEL[sign]}${
          speed < 0 ? ", retrograde" : ""
        }`,
        {
          body,
          longitude_deg: lon,
          sign,
          sign_degree_deg: signDegree,
          speed_deg_per_day: speed,
          retrograde: speed < 0,
        },
      ),
    );
  }

  // --- lunar phase ----------------------------------------------------------
  const sun = anchorState.get("sun");
  const moon = anchorState.get("moon");
  if (sun && moon) {
    const elongation = round6(norm360(moon.lon - sun.lon));
    const phase = lunarPhaseOf(elongation);
    const illuminated = round6((1 - Math.cos((elongation * Math.PI) / 180)) / 2);
    facts.push(
      core(ctx, "lunar_phase", anchorAt, PHASE_LABEL[phase]!, {
        phase,
        elongation_deg: elongation,
        illuminated_fraction: illuminated,
      }),
    );
  }

  // --- exact transit-to-natal contacts --------------------------------------
  for (const body of bodies) {
    for (const natal of request.natal_positions) {
      for (const aspect of COLLECTIVE_ASPECTS) {
        const angle = ASPECT_ANGLE_BY_TYPE[aspect];
        for (const target of orientedTargets(natal.longitude_deg, angle)) {
          const f: AngleFn = (jd) => wrap180(lonAt(body, jd) - target.target_deg);
          for (const jd of rootsIn(f, dayStartJd, dayEndJd)) {
            const speed = round6(stateAt(body, jd).speed);
            facts.push(
              core(
                ctx,
                "transit_natal_contact",
                jdToIso(jd),
                `Transiting ${BODY_LABEL[body]} exactly ${ASPECT_LABEL[aspect]} natal ${BODY_LABEL[natal.body]}`,
                {
                  transiting_body: body,
                  natal_target: natal.body,
                  aspect,
                  direction: speed < 0 ? "retrograde" : "direct",
                  speed_deg_per_day: speed,
                },
              ),
            );
          }
        }
      }
    }
  }

  // --- sign ingresses -------------------------------------------------------
  for (const body of bodies) {
    for (let boundary = 0; boundary < 360; boundary += 30) {
      const f: AngleFn = (jd) => wrap180(lonAt(body, jd) - boundary);
      for (const jd of rootsIn(f, dayStartJd, dayEndJd)) {
        const speed = round6(stateAt(body, jd).speed);
        // Direct motion enters the sign the boundary opens; retrograde motion
        // leaves it. Reading the direction off the speed is what keeps a
        // retrograde re-entry from being labelled as the same ingress twice.
        const forward = speed >= 0;
        const fromSign = signOf(forward ? boundary - 15 : boundary + 15);
        const toSign = signOf(forward ? boundary + 15 : boundary - 15);
        facts.push(
          core(
            ctx,
            "sign_ingress",
            jdToIso(jd),
            `${BODY_LABEL[body]} enters ${SIGN_LABEL[toSign]}`,
            {
              body,
              from_sign: fromSign,
              to_sign: toSign,
              direction: forward ? "direct" : "retrograde",
            },
          ),
        );
      }
    }
  }

  // --- exact collective aspects ---------------------------------------------
  const collective = bodies.filter((body) => COLLECTIVE_ASPECT_BODIES.includes(body));
  for (let i = 0; i < collective.length; i += 1) {
    for (let j = i + 1; j < collective.length; j += 1) {
      const a = collective[i]!;
      const b = collective[j]!;
      for (const aspect of COLLECTIVE_ASPECTS) {
        const angle = ASPECT_ANGLE_BY_TYPE[aspect];
        for (const target of orientedTargets(0, angle)) {
          const f: AngleFn = (jd) => wrap180(lonAt(a, jd) - lonAt(b, jd) - target.target_deg);
          for (const jd of rootsIn(f, dayStartJd, dayEndJd)) {
            const relativeSpeed = stateAt(a, jd).speed - stateAt(b, jd).speed;
            facts.push(
              core(
                ctx,
                "collective_exact_aspect",
                jdToIso(jd),
                `${BODY_LABEL[a]} exactly ${ASPECT_LABEL[aspect]} ${BODY_LABEL[b]}`,
                {
                  body: a,
                  other_body: b,
                  aspect,
                  direction: relativeSpeed < 0 ? "retrograde" : "direct",
                },
              ),
            );
          }
        }
      }
    }
  }

  // --- transit house placements ---------------------------------------------
  const cusps = request.natal_house_cusps;
  if (cusps) {
    for (const body of bodies) {
      const state = anchorState.get(body);
      if (!state) continue;
      const house = houseNumber(state.lon, cusps.cusps_deg);
      facts.push(
        core(
          ctx,
          "house_placement",
          anchorAt,
          `Transiting ${BODY_LABEL[body]} in the ${HOUSE_LABEL[house - 1]} house`,
          {
            body,
            house,
            house_system: cusps.house_system,
            longitude_deg: state.lon,
          },
        ),
      );
    }
  }

  return orderDailySkyFacts(facts.map(seal));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * One `dailySkyResponse`, always as an HTTP 200 at the route.
 *
 * An engine refusal is a discriminated body rather than a status for the same
 * reason `/v1/cycles` does it: the caller must distinguish "the engine ran and
 * refused" from "the request never arrived", because only one of those is worth
 * retrying.
 */
export function handleDailySky(
  body: unknown,
  options: DailySkyOptions & { requestIdFallback?: string } = {},
): DailySkyResponse {
  const fallbackId = options.requestIdFallback ?? "req_unknown_daily_sky";
  let validated: ValidatedDailySkyRequest;
  try {
    validated = validateDailySkyRequest(body);
  } catch (err) {
    const requestId =
      body && typeof body === "object" && typeof (body as { request_id?: unknown }).request_id === "string"
        ? ((body as { request_id: string }).request_id)
        : fallbackId;
    const errorClass =
      err instanceof DailySkyRequestError
        ? err.errorClass
        : err instanceof UnsupportedBodyError
          ? "unsupported_body"
          : "invalid_request";
    return {
      ok: false,
      schema_version: M5_SCHEMA_VERSION,
      request_id: requestId,
      error_class: errorClass,
      error_message: err instanceof DailySkyRequestError ? err.message : "request rejected",
    };
  }

  const { request } = validated;
  try {
    const facts = calculateDailySky(validated, options);
    return {
      ok: true,
      schema_version: M5_SCHEMA_VERSION,
      request_id: request.request_id,
      day_start_at: request.day_start_at,
      day_end_at: request.day_end_at,
      anchor_at: request.anchor_at,
      anchor_resolution: request.anchor_resolution,
      effective_accuracy: request.effective_accuracy,
      suppressed_features: [...request.suppressed_features].sort(),
      daily_sky_policy_id: DAILY_SKY_POLICY_ID,
      daily_sky_policy_version: DAILY_SKY_POLICY_VERSION,
      calculation_policy_id: request.calculation_policy_id,
      calculation_policy_version: request.calculation_policy_version,
      contract_id: request.contract_id,
      contract_version: request.contract_version,
      container_digest: options.containerDigest ?? STUB_CONTAINER_DIGEST,
      ephemeris_data_version: options.ephemerisDataVersion ?? EPHEMERIS_DATA_VERSION,
      tzdb_version: request.tzdb_version,
      facts,
    };
  } catch (err) {
    // Nothing from the engine is echoed verbatim: upstream Swiss Ephemeris
    // messages have leaked absolute filesystem paths.
    return {
      ok: false,
      schema_version: M5_SCHEMA_VERSION,
      request_id: request.request_id,
      error_class: err instanceof UnsupportedBodyError ? "unsupported_body" : "calculation_failed",
      error_message:
        err instanceof UnsupportedBodyError
          ? "a requested body has no ephemeris id"
          : "the daily-sky scan did not complete",
    };
  }
}

/** Re-exported so tests and the server can name the transiting body set. */
export { TRANSITING_BODIES };
