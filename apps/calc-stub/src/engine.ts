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
import { DateTime } from "luxon";
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

function signOf(longitude: number): (typeof ZODIAC)[number] {
  const idx = Math.floor((((longitude % 360) + 360) % 360) / 30) % 12;
  return ZODIAC[idx]!;
}

function norm360(x: number): number {
  let v = x % 360;
  if (v < 0) v += 360;
  return v;
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(norm360(a) - norm360(b)) % 360;
  if (d > 180) d = 360 - d;
  return d;
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
    throw new Error("birth_date required for Swiss Ephemeris calculation");
  }
  const [ys, ms, ds] = req.birth_date.split("-");
  const year = Number(ys);
  const month = Number(ms);
  const day = Number(ds);
  if (!year || !month || !day) {
    throw new Error(`invalid birth_date: ${req.birth_date}`);
  }

  let hour = 12;
  let minute = 0;
  let second = 0;
  let synthetic = false;

  if (req.accuracy === "unknown" || !req.birth_time_local) {
    synthetic = req.accuracy === "unknown" || !req.birth_time_local;
    hour = 12;
    minute = 0;
    second = 0;
  } else {
    const parts = req.birth_time_local.split(":").map(Number);
    hour = parts[0] ?? 0;
    minute = parts[1] ?? 0;
    second = parts[2] ?? 0;
  }

  const zone = req.timezone || "UTC";
  let dt = DateTime.fromObject(
    { year, month, day, hour, minute, second },
    { zone },
  );
  if (!dt.isValid) {
    // Fallback: treat as UTC if zone invalid
    dt = DateTime.fromObject(
      { year, month, day, hour, minute, second },
      { zone: "UTC" },
    );
  }
  const utc = dt.toUTC();
  const hourDecimal =
    utc.hour + utc.minute / 60 + utc.second / 3600 + utc.millisecond / 3_600_000;

  return {
    year: utc.year,
    month: utc.month,
    day: utc.day,
    hourDecimal,
    iso: utc.toISO() ?? `${utc.toISODate()}T${utc.toFormat("HH:mm:ss")}Z`,
    zone: dt.zoneName ?? zone,
    synthetic_local_noon: synthetic,
  };
}

function buildUncertainty(
  accuracy: BirthTimeAccuracy,
  syntheticNoon: boolean,
): UncertaintyReport {
  if (accuracy === "exact" && !syntheticNoon) {
    return {
      accuracy,
      window: null,
      suppressed_features: [],
      qualified_features: [],
      user_facing_summary:
        "Birth time is exact; houses and angles are included (Swiss Ephemeris).",
    };
  }
  if (accuracy === "approximate") {
    return {
      accuracy,
      window: {
        plus_minus_minutes: 30,
        earliest_local: null,
        latest_local: null,
      },
      suppressed_features: [],
      qualified_features: [
        { feature_id: "moon", qualification: "low_confidence_moon" },
        {
          feature_id: "houses",
          qualification: "approximate_only",
        },
      ],
      user_facing_summary:
        "Birth time is approximate; Moon and house claims are qualified across the uncertainty window.",
    };
  }
  return {
    accuracy: "unknown",
    window: null,
    suppressed_features: [
      { feature_class: "houses", reason: "unknown_birth_time" },
      { feature_class: "angles", reason: "unknown_birth_time" },
      { feature_class: "angle_transits", reason: "unknown_birth_time" },
      { feature_class: "moon_time_sensitive", reason: "unknown_birth_time" },
    ],
    qualified_features: [],
    user_facing_summary:
      "Birth time is unknown; houses, angles, and time-sensitive Moon claims are suppressed. Noon is used only as a technical epoch for planetary longitudes and is never stored as the birth instant.",
  };
}

function calcBody(jdUt: number, seId: number): {
  lon: number;
  lat: number;
  dist: number;
  speedLon: number;
  retrograde: boolean;
} {
  const r = sweph.calc_ut(jdUt, seId, FLAGS);
  if (r.flag < 0 || r.error) {
    throw new Error(
      `swe_calc_ut failed for body ${seId}: ${r.error || "flag " + r.flag}`,
    );
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

/** Whole-sign-like house number from longitude vs Asc when cusps available: Placidus house via cusp walk. */
function houseNumber(lon: number, cusps: number[]): number {
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

function buildAspects(positions: LongitudePosition[]): NatalAspect[] {
  const aspectable = positions.filter(
    (p) => p.body !== "ascendant" && p.body !== "midheaven",
  );
  const out: NatalAspect[] = [];
  for (let i = 0; i < aspectable.length; i++) {
    for (let j = i + 1; j < aspectable.length; j++) {
      const a = aspectable[i]!;
      const b = aspectable[j]!;
      const diff = angleDiff(a.longitude_deg, b.longitude_deg);
      for (const { aspect, angle } of ASPECT_ANGLES) {
        const orb = Math.abs(diff - angle);
        const maxOrb = ORB_DEFAULTS[aspect];
        if (orb <= maxOrb) {
          // applying: if faster body approaches aspect — approximate via speed sign
          const sa = a.speed_longitude_deg_per_day ?? 0;
          const sb = b.speed_longitude_deg_per_day ?? 0;
          const closing =
            (norm360(a.longitude_deg - b.longitude_deg) < 180 && sa < sb) ||
            (norm360(b.longitude_deg - a.longitude_deg) < 180 && sb < sa);
          out.push({
            id: newId("asp"),
            body_a: a.body,
            body_b: b.body,
            aspect,
            orb_deg: Number(orb.toFixed(4)),
            applying: closing,
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

    const includeAngles =
      req.accuracy !== "unknown" &&
      req.latitude != null &&
      req.longitude != null &&
      !Number.isNaN(req.latitude) &&
      !Number.isNaN(req.longitude);

    let housesMeta: ReturnType<typeof computeHouses> | null = null;
    if (includeAngles) {
      try {
        housesMeta = computeHouses(jdUt, req.latitude!, req.longitude!);
      } catch {
        housesMeta = null;
      }
    }

    // Unknown time: still compute planets at technical noon, suppress angles/houses/Moon claims
    const suppressAngles = req.accuracy === "unknown" || !includeAngles;
    const suppressMoon = req.accuracy === "unknown";

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

    const uncertainty = buildUncertainty(
      req.accuracy,
      utc.synthetic_local_noon,
    );

    const chartId = newId("cht");
    const calculated_at = new Date().toISOString();

    const fingerprintPayload = {
      engine: "swiss_ephemeris",
      se_version: SE_VERSION,
      wrapper: SE_WRAPPER,
      flags: ["SEFLG_SWIEPH", "SEFLG_SPEED"],
      contract_id: req.contract_id || CALC_CONTRACT_ID,
      contract_version: req.contract_version || CALC_CONTRACT_VERSION,
      accuracy: req.accuracy,
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
        accuracy: req.accuracy,
        // Never store synthetic noon as birth UTC authority
        utc_instant:
          req.accuracy === "unknown" || utc.synthetic_local_noon
            ? null
            : utc.iso,
        timezone: req.timezone,
        place_label: req.place_label,
        latitude: req.latitude,
        longitude: req.longitude,
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

export function engineMeta() {
  ensureInit();
  return {
    engine: "swiss_ephemeris",
    se_version: SE_VERSION,
    library_version: typeof sweph.version === "function" ? sweph.version() : SE_VERSION,
    wrapper: SE_WRAPPER,
    ephe_path: resolveEphePath(),
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
