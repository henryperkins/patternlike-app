/**
 * Swiss Ephemeris calculation engine (AST-20 / SE-01 / SE-02).
 *
 * Authority: sweph 2.10.3 ≡ Swiss Ephemeris 2.10.03
 * Flags: SEFLG_SWIEPH | SEFLG_SPEED (geocentric tropical, apparent, with speed)
 * Houses: Placidus primary; Porphyry fallback when Placidus fails
 * Node: true lunar node
 *
 * Licensing: sweph is AGPL-3.0-or-later (or LGPL with commercial SE license).
 * Resolve Swiss Ephemeris dual-license before public activation.
 */

import { createHash } from "node:crypto";
import { DateTime, IANAZone } from "luxon";
import sweph from "sweph";
import {
  CALC_CONTRACT_ID,
  CALC_CONTRACT_VERSION,
  SCHEMA_VERSION,
  contentHash,
  canonicalJson,
  newId,
  type BirthTimeAccuracy,
  type CalcRequest,
  type CalcResponse,
  type ChartSnapshot,
  type CelestialBody,
  type LongitudePosition,
  type LocationQualifierCode,
  type NatalAspect,
  type AspectType,
  type UncertaintyReport,
} from "@patternlike/shared";
import { assertEphePresent, resolveEphePath } from "./ephe-path.js";

const C = sweph.constants;

export const SE_VERSION = "2.10.03";
export const SE_WRAPPER = "sweph@2.10.3-7";
export const ORB_POLICY_ID = "orb-launch-default";
export const ORB_POLICY_VERSION = "0.2.0";
export const STUB_TZDB_VERSION = "2026a";

/**
 * Pinned by commit and SHA-256 in `apps/calc-stub/ephemeris.lock.json`; the
 * range is the coverage of sepl_18.se1 / semo_18.se1. Echoed into every cycle
 * result and hashed into every cycle id, so a stored artifact can prove which
 * data produced it.
 */
export const EPHEMERIS_DATA_VERSION = "se-2.10.03-1800-2399";

/** Pinned OCI digest placeholder until image build pipeline stamps it. */
export const STUB_CONTAINER_DIGEST =
  process.env.CONTAINER_DIGEST ??
  `sha256:${createHash("sha256")
    .update(`patternlike-calc|${SE_VERSION}|${SE_WRAPPER}`)
    .digest("hex")}`;

const FLAGS = C.SEFLG_SWIEPH | C.SEFLG_SPEED;

const ZODIAC = [
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

/** Launch body set → Swiss Ephemeris body ids (angles handled separately). */
const PLANET_SE_IDS: Array<{ body: CelestialBody; seId: number }> = [
  { body: "sun", seId: C.SE_SUN },
  { body: "moon", seId: C.SE_MOON },
  { body: "mercury", seId: C.SE_MERCURY },
  { body: "venus", seId: C.SE_VENUS },
  { body: "mars", seId: C.SE_MARS },
  { body: "jupiter", seId: C.SE_JUPITER },
  { body: "saturn", seId: C.SE_SATURN },
  { body: "uranus", seId: C.SE_URANUS },
  { body: "neptune", seId: C.SE_NEPTUNE },
  { body: "pluto", seId: C.SE_PLUTO },
  { body: "true_node", seId: C.SE_TRUE_NODE },
];

/** Swiss Ephemeris body id by launch body. Angles are not here: they come from swe_houses. */
export const SE_ID_BY_BODY: Readonly<Partial<Record<CelestialBody, number>>> =
  Object.fromEntries(PLANET_SE_IDS.map(({ body, seId }) => [body, seId]));

const ORB_DEFAULTS: Record<AspectType, number> = {
  conjunction: 8,
  sextile: 4,
  square: 6,
  trine: 6,
  opposition: 8,
};

const ASPECT_ANGLES: Array<{ aspect: AspectType; angle: number }> = [
  { aspect: "conjunction", angle: 0 },
  { aspect: "sextile", angle: 60 },
  { aspect: "square", angle: 90 },
  { aspect: "trine", angle: 120 },
  { aspect: "opposition", angle: 180 },
];

export const ASPECT_ANGLE_BY_TYPE: Record<AspectType, number> = Object.fromEntries(
  ASPECT_ANGLES.map(({ aspect, angle }) => [aspect, angle]),
) as Record<AspectType, number>;

let epheInitialized = false;

export function initSwissEphemeris(ephePath = resolveEphePath()): string {
  assertEphePresent(ephePath);
  sweph.set_ephe_path(ephePath);
  epheInitialized = true;
  return ephePath;
}

function ensureInit(): void {
  if (!epheInitialized) initSwissEphemeris();
}

/**
 * Exported for the daily-sky scanner, which renders the same sign names into
 * factual labels. A second copy of the boundary arithmetic would be a second
 * place for an off-by-one at 0 degrees Aries to hide.
 */
export function signOf(longitude: number): (typeof ZODIAC)[number] {
  const idx = Math.floor((((longitude % 360) + 360) % 360) / 30) % 12;
  return ZODIAC[idx]!;
}

export function norm360(x: number): number {
  let v = x % 360;
  if (v < 0) v += 360;
  return v;
}

/** Smallest angle between two ecliptic longitudes, in [0, 180]. */
export function angularSeparation(a: number, b: number): number {
  let d = Math.abs(norm360(a) - norm360(b)) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * Coverage of the pinned data files (sepl_18.se1 / semo_18.se1 are the
 * 1800–2400 series). Outside this range swe_calc_ut fails with an error that
 * embeds the ephemeris directory path, so reject the input before calling it.
 */
export const EPHEMERIS_MIN_YEAR = 1800;
export const EPHEMERIS_MAX_YEAR = 2399;

/**
 * The Julian days at which every launch body resolves from the pinned files
 * *regardless of what this process calculated before*.
 *
 * Two measured facts make this narrower than the 1800–2399 label:
 *
 * 1. The data does not begin at the calendar boundary. At 1800-01-01T00:00Z
 *    only the Moon and the true node answer from `semo_18.se1`; the Sun and the
 *    inner planets appear within the first hour, Saturn by 02:00Z, Uranus by
 *    03:00Z, Neptune by 05:00Z, and Pluto — the last — at 05:45Z. Before each
 *    of those, that body is Moshier.
 * 2. Coverage at the two edges is *order-dependent*. Swiss Ephemeris remembers
 *    that a neighbouring file (`sepl_12.se1`, `sepl_24.se1`) was missing, so an
 *    instant in an edge segment that resolves in a fresh process falls back to
 *    Moshier once the same process has served any out-of-range request.
 *    2399-12-31T23:59Z answers from `sepl_18.se1` on a cold container and from
 *    Moshier on a warm one. The interior is unaffected — the golden fixture is
 *    bit-identical either way — but "which ephemeris answered" is not a
 *    property of the instant alone near the edges, and this service stamps
 *    every artifact with `ephemeris_data_version`.
 *
 * The measured order-independent window is 1800-01-01T06:00Z … 2399-12-31T23:00Z.
 * The constants below sit at least six hours inside it, and `validation.test.ts`
 * re-measures that margin — including after deliberately poisoning the process —
 * so a change to `ephemeris.lock.json` cannot quietly invalidate it.
 *
 * `EPHEMERIS_MIN_YEAR`/`MAX_YEAR` stay the label the product declares and the
 * range a caller is told about. These bound the instant that actually reaches
 * `swe_calc_ut`, which the year of a *local* date does not determine: a
 * 1800-01-01 birth in Asia/Tokyo is 1799-12-31 in UT.
 */
export const EPHEMERIS_COVERAGE_MIN_JD = 2378497.0; // 1800-01-01T12:00Z
export const EPHEMERIS_COVERAGE_MAX_JD = 2597641.0; // 2399-12-31T12:00Z

/**
 * True when `jdUt` lies inside that window.
 *
 * A predicate rather than a throw, because the daily-sky validator raises its
 * own contract error class for the same fact.
 */
export function isWithinEphemerisCoverage(jdUt: number): boolean {
  return (
    Number.isFinite(jdUt) &&
    jdUt >= EPHEMERIS_COVERAGE_MIN_JD &&
    jdUt <= EPHEMERIS_COVERAGE_MAX_JD
  );
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Thrown for anything the caller supplied that cannot describe a real birth. */
export class InvalidBirthProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBirthProfileError";
  }
}

function assertFiniteInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number") {
    throw new InvalidBirthProfileError(
      `${label} must be a number, received ${typeof value}`,
    );
  }
  if (!Number.isFinite(value)) {
    throw new InvalidBirthProfileError(`${label} must be finite`);
  }
  if (value < min || value > max) {
    throw new InvalidBirthProfileError(
      `${label} out of range: ${value} (expected ${min}..${max})`,
    );
  }
  return value;
}

/**
 * Validate birthplace coordinates. Returns null when both are absent, which is
 * a legitimate state (no birthplace supplied) rather than an error.
 */
export function resolveCoordinates(
  req: CalcRequest,
): { latitude: number; longitude: number } | null {
  const hasLat = req.latitude !== null && req.latitude !== undefined;
  const hasLon = req.longitude !== null && req.longitude !== undefined;
  if (!hasLat && !hasLon) return null;
  if (hasLat !== hasLon) {
    throw new InvalidBirthProfileError(
      "latitude and longitude must be supplied together",
    );
  }
  return {
    latitude: assertFiniteInRange(req.latitude, "latitude", -90, 90),
    longitude: assertFiniteInRange(req.longitude, "longitude", -180, 180),
  };
}

export interface UtcInstantParts {
  year: number;
  month: number;
  day: number;
  hourDecimal: number;
  iso: string;
  zone: string;
  /** True when local wall time was synthesized for unknown accuracy (calc only). */
  synthetic_local_noon: boolean;
}

/**
 * Convert civil birth date/time + IANA zone to UTC for Julian day.
 * Unknown accuracy: use local noon for planetary computation only; never claim
 * utc_instant as user fact (caller stores null).
 */
export function resolveUtcInstant(req: CalcRequest): UtcInstantParts {
  if (!req.birth_date) {
    throw new InvalidBirthProfileError(
      "birth_date required for Swiss Ephemeris calculation",
    );
  }

  const dateMatch = ISO_DATE_RE.exec(req.birth_date);
  if (!dateMatch) {
    throw new InvalidBirthProfileError(
      `invalid birth_date: ${req.birth_date} (expected YYYY-MM-DD)`,
    );
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);

  // Prove the date exists before any zone handling. The previous implementation
  // treated an invalid DateTime as "bad timezone" and retried in UTC, which is
  // equally invalid for a date that never existed — 2023-02-30 became NaN parts,
  // then a NaN Julian day, which corrupts sweph's ephemeris cache for the whole
  // process and fails every subsequent request from every user.
  const calendarProbe = DateTime.fromObject({ year, month, day }, { zone: "UTC" });
  if (!calendarProbe.isValid) {
    throw new InvalidBirthProfileError(
      `invalid birth_date: ${req.birth_date} (${calendarProbe.invalidReason ?? "not a real calendar date"})`,
    );
  }

  if (year < EPHEMERIS_MIN_YEAR || year > EPHEMERIS_MAX_YEAR) {
    throw new InvalidBirthProfileError(
      `birth_date outside supported ephemeris range: ${req.birth_date} ` +
        `(supported ${EPHEMERIS_MIN_YEAR}-01-01 through ${EPHEMERIS_MAX_YEAR}-12-31)`,
    );
  }

  const zone = req.timezone || "UTC";
  if (!IANAZone.isValidZone(zone)) {
    throw new InvalidBirthProfileError(
      `invalid timezone: ${zone} (expected an IANA zone id)`,
    );
  }

  let hour = 12;
  let minute = 0;
  let second = 0;
  const hasRealTime =
    req.accuracy !== "unknown" && typeof req.birth_time_local === "string";

  if (hasRealTime) {
    const timeMatch = LOCAL_TIME_RE.exec(req.birth_time_local!);
    if (!timeMatch) {
      throw new InvalidBirthProfileError(
        `invalid birth_time_local: ${req.birth_time_local} (expected HH:MM or HH:MM:SS)`,
      );
    }
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    second = timeMatch[3] === undefined ? 0 : Number(timeMatch[3]);
    if (hour > 23 || minute > 59 || second > 59) {
      throw new InvalidBirthProfileError(
        `invalid birth_time_local: ${req.birth_time_local} (out of range)`,
      );
    }
  }

  const synthetic = !hasRealTime;

  const dt = DateTime.fromObject(
    { year, month, day, hour, minute, second },
    { zone },
  );
  if (!dt.isValid) {
    // Backstop only. Luxon resolves DST spring-forward gaps by shifting forward
    // and stays valid, so with the date and zone already proven this is not
    // expected to be reachable — fail closed rather than fabricate an instant.
    throw new InvalidBirthProfileError(
      `birth date/time cannot be resolved in ${zone}: ${dt.invalidReason ?? "invalid local time"}`,
    );
  }

  const utc = dt.toUTC();
  const hourDecimal =
    utc.hour + utc.minute / 60 + utc.second / 3600 + utc.millisecond / 3_600_000;
  const iso = utc.toISO();
  if (iso === null) {
    throw new InvalidBirthProfileError(
      `birth date/time did not resolve to an instant: ${req.birth_date}`,
    );
  }

  return {
    year: utc.year,
    month: utc.month,
    day: utc.day,
    hourDecimal,
    iso,
    zone: dt.zoneName ?? zone,
    synthetic_local_noon: synthetic,
  };
}

export const DEFAULT_APPROXIMATE_WINDOW_MINUTES = 30;

export interface UncertaintyInputs {
  /** Accuracy as it will be stored on the chart, after any downgrade. */
  accuracy: BirthTimeAccuracy;
  /** True when no real birth time was supplied and noon was used as an epoch. */
  syntheticNoon: boolean;
  /** True only when houses and angles were actually computed and returned. */
  anglesIncluded: boolean;
  approximateWindowMinutes: number | null;
  locationConfidence: CalcRequest["location_confidence"] | null;
  locationQualifierCodes: LocationQualifierCode[];
}

/**
 * Describe what the calculation actually produced.
 *
 * The previous implementation keyed entirely off the caller-declared accuracy,
 * so a request with accuracy "exact" and no birth time computed Placidus houses
 * from synthetic noon and simultaneously reported them as suppressed — the same
 * payload told a user with no known birth time both that they were a Leo rising
 * and that angles were unavailable.
 */
function buildUncertainty(input: UncertaintyInputs): UncertaintyReport {
  const {
    accuracy,
    syntheticNoon,
    anglesIncluded,
    approximateWindowMinutes,
    locationConfidence,
    locationQualifierCodes,
  } = input;

  const suppressed_features: UncertaintyReport["suppressed_features"] = [];
  if (!anglesIncluded) {
    const reason = syntheticNoon ? "unknown_birth_time" : "birthplace_unavailable";
    suppressed_features.push(
      { feature_class: "houses", reason },
      { feature_class: "angles", reason },
      { feature_class: "angle_transits", reason },
    );
  }
  if (syntheticNoon) {
    suppressed_features.push({
      feature_class: "moon_time_sensitive",
      reason: "unknown_birth_time",
    });
  }

  const qualified_features: UncertaintyReport["qualified_features"] = [];
  let window: UncertaintyReport["window"] = null;

  if (accuracy === "approximate") {
    window = {
      plus_minus_minutes:
        approximateWindowMinutes ?? DEFAULT_APPROXIMATE_WINDOW_MINUTES,
      earliest_local: null,
      latest_local: null,
    };
    qualified_features.push({
      feature_id: "moon",
      qualification: "low_confidence_moon",
    });
    if (anglesIncluded) {
      qualified_features.push({
        feature_id: "houses",
        qualification: "approximate_only",
      });
    }
  }

  if (
    locationConfidence === "medium" ||
    locationConfidence === "low" ||
    locationConfidence === "none"
  ) {
    qualified_features.push({
      feature_id: "birthplace",
      qualification: "technique_specific",
    });
  }
  const civilTimeQualificationCodes = new Set<LocationQualifierCode>([
    "pre_1970_zone_boundary",
    "near_zone_boundary",
    "local_time_ambiguous",
    "local_time_nonexistent",
  ]);
  if (locationQualifierCodes.some((code) => civilTimeQualificationCodes.has(code))) {
    qualified_features.push({
      feature_id: "birth_instant",
      qualification: "technique_specific",
    });
  }

  const baseSummary = (() => {
    if (syntheticNoon) {
      return (
        "Birth time is unknown; houses, angles, and time-sensitive Moon claims are suppressed. " +
        "Noon is used only as a technical epoch for planetary longitudes and is never stored as the birth instant."
      );
    }
    if (accuracy === "approximate") {
      const pm = window?.plus_minus_minutes ?? DEFAULT_APPROXIMATE_WINDOW_MINUTES;
      return (
        `Birth time is approximate (±${pm} minutes); Moon` +
        (anglesIncluded ? " and house" : "") +
        " claims are qualified across the uncertainty window."
      );
    }
    if (!anglesIncluded) {
      return "Birth time is exact, but no birthplace was supplied; houses and angles are suppressed.";
    }
    return "Birth time is exact; houses and angles are included (Swiss Ephemeris).";
  })();
  const locationSummary = qualified_features.some(
    (feature) =>
      feature.feature_id === "birthplace" ||
      feature.feature_id === "birth_instant",
  )
    ? " Location details need confirmation; affected chart facts are qualified."
    : "";
  const user_facing_summary = `${baseSummary}${locationSummary}`;

  return {
    accuracy,
    window,
    suppressed_features,
    qualified_features,
    user_facing_summary,
  };
}

/**
 * Exported for the cycle scanner, which needs the same body call with the same
 * flags and the same refusal to accept a silent Moshier fallback: `r.error` is
 * non-empty when Swiss Ephemeris could not read its data files, and a cycle
 * solved against a different ephemeris would be a different vintage wearing
 * this one's `ephemeris_data_version`.
 */
export function calcBody(jdUt: number, seId: number): {
  lon: number;
  lat: number;
  dist: number;
  speedLon: number;
  retrograde: boolean;
} {
  const r = sweph.calc_ut(jdUt, seId, FLAGS);
  // The returned flag — not the return code — is what says which ephemeris
  // answered. Swiss Ephemeris reports a missing data file by *succeeding*
  // against Moshier with SEFLG_SWIEPH cleared (flag 260, never negative), so
  // `flag < 0` alone never fires for the case that matters here. Requiring the
  // exact requested flags back also catches a dropped SEFLG_SPEED, which does
  // not fail — it returns every speed as 0, which would silently turn every
  // applying/separating and retrograde claim into a coin flip.
  if (r.flag !== FLAGS || r.error) {
    // `r.error` is deliberately not echoed: it embeds the absolute ephemeris
    // directory, and this message reaches the response body as `calc_error`.
    // The flag is the diagnosable part — 260 is "Moshier substituted".
    throw new Error(`swe_calc_ut refused body ${seId}: flag ${r.flag}`);
  }
  const [lon, lat, dist, speedLon] = r.data;
  return {
    lon: lon!,
    lat: lat!,
    dist: dist!,
    speedLon: speedLon!,
    retrograde: (speedLon ?? 0) < 0,
  };
}

function computeHouses(
  jdUt: number,
  lat: number,
  lon: number,
): {
  system_used: "placidus" | "porphyry";
  fallback_applied: boolean;
  cusps_deg: number[];
  ascendant_deg: number;
  midheaven_deg: number;
} {
  let system: "placidus" | "porphyry" = "placidus";
  let fallback = false;
  let h = sweph.houses(jdUt, lat, lon, "P");
  if (h.flag < 0 || !h.data?.houses?.length) {
    h = sweph.houses(jdUt, lat, lon, "O"); // Porphyrius
    system = "porphyry";
    fallback = true;
  }
  if (h.flag < 0 || !h.data?.houses?.length) {
    const errMsg =
      "error" in h && typeof (h as { error?: string }).error === "string"
        ? (h as { error: string }).error
        : "unknown";
    throw new Error(`swe_houses failed: ${errMsg}`);
  }
  const cusps = h.data.houses.slice(0, 12).map((x) => norm360(x));
  // points: [Asc, MC, ARMC, Vertex, EquatorialAsc, CoAsc1, CoAsc2, PolarAsc]
  const asc = norm360(h.data.points[0]!);
  const mc = norm360(h.data.points[1]!);
  return {
    system_used: system,
    fallback_applied: fallback,
    cusps_deg: cusps,
    ascendant_deg: asc,
    midheaven_deg: mc,
  };
}

/**
 * Whole-sign-like house number from longitude vs Asc when cusps available:
 * Placidus house via cusp walk.
 *
 * Exported for the daily-sky scanner, which places a TRANSITING body in the
 * reader's natal houses. Same walk, same wrap handling — a transit house and a
 * natal house that disagreed about which cusp owns a longitude would be a
 * defect no reader could see.
 */
export function houseNumber(lon: number, cusps: number[]): number {
  const L = norm360(lon);
  for (let i = 0; i < 12; i++) {
    const a = cusps[i]!;
    const b = cusps[(i + 1) % 12]!;
    if (a <= b) {
      if (L >= a && L < b) return i + 1;
    } else {
      // wraps 360
      if (L >= a || L < b) return i + 1;
    }
  }
  return 1;
}

/**
 * An aspect is applying when the orb to exactness is shrinking:
 * d|separation − aspect_angle| / dt < 0.
 *
 * Let d = norm360(lonA − lonB) ∈ [0, 360). The separation reported by
 * angularSeparation is d when d ≤ 180 and 360 − d otherwise, so
 *
 *   d(separation)/dt = (speedA − speedB)   when d ≤ 180
 *                    = (speedB − speedA)   otherwise
 *
 * and, since orb = |separation − angle|,
 *
 *   d(orb)/dt = sign(separation − angle) · d(separation)/dt
 *
 * The previous heuristic tested only whether the raw separation was shrinking.
 * That is the rule for a conjunction; for a sextile, square, trine, or
 * opposition it inverts the answer whenever the separation sits on the near
 * side of the aspect angle — 8 of 15 aspects on the golden chart were wrong.
 *
 * Exactly on the aspect the orb is at a minimum and the derivative is
 * undefined; the aspect is neither applying nor separating, so this returns
 * false. Retrograde motion needs no special case — it is a negative speed.
 */
export function isApplying(
  lonA: number,
  lonB: number,
  speedA: number,
  speedB: number,
  aspectAngle: number,
): boolean {
  const d = norm360(lonA - lonB);
  const separation = d <= 180 ? d : 360 - d;
  const separationRate = d <= 180 ? speedA - speedB : speedB - speedA;
  const offset = separation - aspectAngle;
  if (offset === 0) return false;
  return Math.sign(offset) * separationRate < 0;
}

function buildAspects(positions: LongitudePosition[]): NatalAspect[] {
  const aspectable = positions.filter(
    (p) => p.body !== "ascendant" && p.body !== "midheaven",
  );
  const out: NatalAspect[] = [];
  for (let i = 0; i < aspectable.length; i++) {
    for (let j = i + 1; j < aspectable.length; j++) {
      const a = aspectable[i]!;
      const b = aspectable[j]!;
      const diff = angularSeparation(a.longitude_deg, b.longitude_deg);
      for (const { aspect, angle } of ASPECT_ANGLES) {
        const orb = Math.abs(diff - angle);
        const maxOrb = ORB_DEFAULTS[aspect];
        if (orb <= maxOrb) {
          const applying = isApplying(
            a.longitude_deg,
            b.longitude_deg,
            a.speed_longitude_deg_per_day ?? 0,
            b.speed_longitude_deg_per_day ?? 0,
            angle,
          );
          out.push({
            id: newId("asp"),
            body_a: a.body,
            body_b: b.body,
            aspect,
            orb_deg: Number(orb.toFixed(4)),
            applying,
            orb_policy_id: ORB_POLICY_ID,
            orb_policy_version: ORB_POLICY_VERSION,
          });
          break;
        }
      }
    }
  }
  return out;
}

export async function calculateChart(req: CalcRequest): Promise<CalcResponse> {
  try {
    ensureInit();

    const locationConfidences = new Set(["high", "medium", "low", "none"]);
    const locationQualifierCodes = new Set<LocationQualifierCode>([
      "approximate_match",
      "region_level_match",
      "pre_1970_zone_boundary",
      "near_zone_boundary",
      "hint_replaced",
      "no_coordinates",
      "nautical_zone",
      "local_time_ambiguous",
      "local_time_nonexistent",
    ]);
    if (
      req.location_confidence !== undefined &&
      !locationConfidences.has(req.location_confidence)
    ) {
      return {
        ok: false,
        chart: null,
        error_class: "invalid_birth_profile",
        error_message: "location_confidence is invalid",
      };
    }
    if (
      req.location_qualifier_codes !== undefined &&
      (!Array.isArray(req.location_qualifier_codes) ||
        req.location_qualifier_codes.some(
          (code) => !locationQualifierCodes.has(code),
        ) ||
        new Set(req.location_qualifier_codes).size !==
          req.location_qualifier_codes.length)
    ) {
      return {
        ok: false,
        chart: null,
        error_class: "invalid_birth_profile",
        error_message: "location_qualifier_codes are invalid",
      };
    }

    if (req.accuracy !== "unknown" && !req.birth_date) {
      return {
        ok: false,
        chart: null,
        error_class: "invalid_birth_profile",
        error_message: "birth_date required when accuracy is exact or approximate",
      };
    }
    if (!req.birth_date) {
      return {
        ok: false,
        chart: null,
        error_class: "invalid_birth_profile",
        error_message: "birth_date required for chart calculation",
      };
    }

    const utc = resolveUtcInstant(req);
    const jdUt = sweph.julday(
      utc.year,
      utc.month,
      utc.day,
      utc.hourDecimal,
      C.SE_GREG_CAL,
    );

    // Last line of defence. A non-finite Julian day does not merely produce a
    // bad chart: it corrupts sweph's internal ephemeris file cache for the life
    // of the process, so every subsequent request from every user fails until
    // the container restarts. Nothing may reach calc_ut unchecked.
    if (!Number.isFinite(jdUt)) {
      throw new InvalidBirthProfileError(
        `birth date did not resolve to a Julian day: ${req.birth_date}`,
      );
    }

    // The year check in resolveUtcInstant reads the LOCAL date; this reads the
    // instant that actually reaches swe_calc_ut. Without it a 1800-01-01 birth
    // east of Greenwich resolves to 1799-12-31 UT, Swiss Ephemeris substitutes
    // Moshier, and calcBody's refusal surfaces as an opaque calc_error — which
    // the Worker turns into a generic calc_failed — rather than as the range
    // message this validation exists to produce.
    if (!isWithinEphemerisCoverage(jdUt)) {
      throw new InvalidBirthProfileError(
        `birth instant outside the pinned ephemeris coverage: ${req.birth_date} ` +
          `${utc.iso} (supported ${EPHEMERIS_MIN_YEAR}-01-01 through ` +
          `${EPHEMERIS_MAX_YEAR}-12-31, less the first and last hours in UT)`,
      );
    }

    const coordinates = resolveCoordinates(req);

    let housesMeta: ReturnType<typeof computeHouses> | null = null;
    if (coordinates && req.accuracy !== "unknown" && !utc.synthetic_local_noon) {
      try {
        housesMeta = computeHouses(jdUt, coordinates.latitude, coordinates.longitude);
      } catch {
        housesMeta = null;
      }
    }

    // Angles and houses require a real birth time AND a birthplace. Accuracy is
    // a label the caller supplies; it is not evidence that a time was given.
    const suppressAngles = housesMeta === null;
    const suppressMoon = utc.synthetic_local_noon;

    const positions: LongitudePosition[] = [];
    for (const { body, seId } of PLANET_SE_IDS) {
      if (suppressMoon && body === "moon") {
        // Include Moon longitude for completeness but mark house null; uncertainty suppresses claims
      }
      const p = calcBody(jdUt, seId);
      positions.push({
        body,
        longitude_deg: Number(norm360(p.lon).toFixed(6)),
        latitude_deg: Number(p.lat.toFixed(6)),
        distance_au: Number(p.dist.toFixed(8)),
        speed_longitude_deg_per_day: Number(p.speedLon.toFixed(6)),
        retrograde: p.retrograde,
        sign: signOf(p.lon),
        house:
          housesMeta && !suppressAngles
            ? houseNumber(p.lon, housesMeta.cusps_deg)
            : null,
      });
    }

    if (housesMeta && !suppressAngles) {
      positions.push(
        {
          body: "ascendant",
          longitude_deg: Number(housesMeta.ascendant_deg.toFixed(6)),
          sign: signOf(housesMeta.ascendant_deg),
          house: 1,
        },
        {
          body: "midheaven",
          longitude_deg: Number(housesMeta.midheaven_deg.toFixed(6)),
          sign: signOf(housesMeta.midheaven_deg),
          house: 10,
        },
      );
    }

    // Aspects: for unknown time exclude Moon from aspect graph (time-sensitive)
    const aspectPositions = suppressMoon
      ? positions.filter((p) => p.body !== "moon")
      : positions;
    const aspects = buildAspects(aspectPositions);

    // A declared accuracy of exact/approximate is not evidence a time was given.
    // When noon was synthesized the effective accuracy is unknown; storing that
    // keeps chart.birth.accuracy and chart.uncertainty.accuracy from disagreeing.
    // The API rejects this combination up front, so this is a backstop.
    const effectiveAccuracy: BirthTimeAccuracy = utc.synthetic_local_noon
      ? "unknown"
      : req.accuracy;

    const uncertainty = buildUncertainty({
      accuracy: effectiveAccuracy,
      syntheticNoon: utc.synthetic_local_noon,
      anglesIncluded: !suppressAngles,
      approximateWindowMinutes: req.approximate_window_minutes ?? null,
      locationConfidence: req.location_confidence ?? null,
      locationQualifierCodes: req.location_qualifier_codes ?? [],
    });

    const chartId = newId("cht");
    const calculated_at = new Date().toISOString();

    const fingerprintPayload = {
      engine: "swiss_ephemeris",
      se_version: SE_VERSION,
      wrapper: SE_WRAPPER,
      flags: ["SEFLG_SWIEPH", "SEFLG_SPEED"],
      contract_id: req.contract_id || CALC_CONTRACT_ID,
      contract_version: req.contract_version || CALC_CONTRACT_VERSION,
      accuracy: effectiveAccuracy,
      jd_ut: Number(jdUt.toFixed(8)),
      positions: positions.map((p) => ({
        body: p.body,
        longitude_deg: p.longitude_deg,
      })),
      aspects: aspects.map((a) => ({
        body_a: a.body_a,
        body_b: a.body_b,
        aspect: a.aspect,
        orb_deg: a.orb_deg,
      })),
      houses: suppressAngles ? null : housesMeta?.cusps_deg ?? null,
      angles: suppressAngles
        ? null
        : {
            asc: housesMeta?.ascendant_deg ?? null,
            mc: housesMeta?.midheaven_deg ?? null,
          },
    };

    const fingerprint = await contentHash(canonicalJson(fingerprintPayload));

    const chart: ChartSnapshot = {
      schema_version: SCHEMA_VERSION,
      id: chartId,
      user_id: req.user_id,
      profile_version: req.profile_version,
      fingerprint,
      contract_id: req.contract_id || CALC_CONTRACT_ID,
      contract_version: req.contract_version || CALC_CONTRACT_VERSION,
      container_digest: STUB_CONTAINER_DIGEST,
      tzdb_version: STUB_TZDB_VERSION,
      birth: {
        accuracy: effectiveAccuracy,
        // Never store synthetic noon as birth UTC authority
        utc_instant: utc.synthetic_local_noon ? null : utc.iso,
        timezone: req.timezone,
        place_label: req.place_label,
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
        sensitive_profile: null,
      },
      positions,
      houses:
        housesMeta && !suppressAngles
          ? {
              system_used: housesMeta.system_used,
              fallback_applied: housesMeta.fallback_applied,
              cusps_deg: housesMeta.cusps_deg.map((x) =>
                Number(x.toFixed(6)),
              ),
            }
          : null,
      angles:
        housesMeta && !suppressAngles
          ? {
              ascendant_deg: Number(housesMeta.ascendant_deg.toFixed(6)),
              midheaven_deg: Number(housesMeta.midheaven_deg.toFixed(6)),
            }
          : null,
      aspects,
      patterns: [],
      uncertainty,
      calculated_at,
      status: "active",
      r2_uri: null,
    };

    return { ok: true, chart };
  } catch (err) {
    if (err instanceof InvalidBirthProfileError) {
      return {
        ok: false,
        chart: null,
        error_class: "invalid_birth_profile",
        error_message: err.message,
      };
    }
    return {
      ok: false,
      chart: null,
      error_class: "calc_error",
      error_message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Golden fixture: 1990-05-15 12:34 America/Los_Angeles, Los Angeles. */
export async function goldenExactFixture(): Promise<ChartSnapshot> {
  const res = await calculateChart({
    request_id: "golden_exact_1",
    user_id: "usr_golden_fixture_0001",
    profile_version: 1,
    accuracy: "exact",
    birth_date: "1990-05-15",
    birth_time_local: "12:34:00",
    timezone: "America/Los_Angeles",
    latitude: 34.0522,
    longitude: -118.2437,
    place_label: "Los Angeles, CA, US",
    contract_id: CALC_CONTRACT_ID,
    contract_version: CALC_CONTRACT_VERSION,
  });
  if (!res.ok || !res.chart) {
    throw new Error(res.error_message ?? "golden fixture failed");
  }
  return res.chart;
}

/**
 * Engine identity for `/health` and `/v1/engine`, both of which are deliberately
 * unauthenticated so Fly's health checks work before the shared secret is set.
 *
 * That is exactly why the absolute ephemeris directory is not in here. It used
 * to be, as `ephe_path`, and it is the same disclosure the error-envelope rule
 * exists to prevent — "upstream calc messages have leaked absolute filesystem
 * paths" — except served deliberately, to anyone, on a public route. Whether the
 * data files resolved is the operationally useful fact; where they live on the
 * container's disk is not.
 */
export function engineMeta() {
  ensureInit();
  return {
    engine: "swiss_ephemeris",
    se_version: SE_VERSION,
    library_version: typeof sweph.version === "function" ? sweph.version() : SE_VERSION,
    wrapper: SE_WRAPPER,
    ephemeris_data_version: EPHEMERIS_DATA_VERSION,
    container_digest: STUB_CONTAINER_DIGEST,
    contract_id: CALC_CONTRACT_ID,
    contract_version: CALC_CONTRACT_VERSION,
    flags: ["SEFLG_SWIEPH", "SEFLG_SPEED"],
    houses_primary: "placidus",
    houses_fallback: "porphyry",
    node: "true",
    zodiac: "tropical",
    coordinates: "geocentric",
    license_note:
      "Swiss Ephemeris dual-license (AGPL or commercial). sweph binding: AGPL-3.0-or-later unless commercial SE license (LGPL).",
  };
}

// Initialize on load when ephe present (tests / server)
try {
  initSwissEphemeris();
} catch {
  // Defer until first calculate; server health reports missing ephe
}
