/**
 * Versioned constants for the transit cycle scanner.
 *
 * Everything here is part of `cycle_policy_version`. The contract is explicit
 * about what that means: the version "must bump whenever the ephemeris or
 * container, the unwrapping epoch or its checkpoints, the scan grid, the
 * station and root tolerances, or the complete-encounter lookaround can alter
 * output." That is why these numbers live in one file rather than scattered
 * through the scanner — a diff here is a diff you must version.
 *
 * The persisted `cycle_instances.horizon_version` records this same value, so a
 * threshold change re-scans into a new vintage instead of mixing vintages in
 * one table.
 */

import type { AspectType, CelestialBody } from "@patternlike/shared";

export const CYCLE_POLICY_ID = "transit-scan-launch";
export const CYCLE_POLICY_VERSION = "1.4.0";

/**
 * The transit orb policy, which is deliberately NOT the natal `orb-launch-default`
 * table in engine.ts. Natal orbs describe how wide a chart aspect may be and
 * still be reported; transit orbs describe how long an encounter is claimed to
 * last, and a natal-width orb on Pluto is a decade-long "cycle" that means
 * nothing to a reader.
 */
export const TRANSIT_ORB_POLICY_ID = "orb-launch";
export const TRANSIT_ORB_POLICY_VERSION = "1.0.0";

/**
 * The Julian days the pinned data files actually cover, measured rather than
 * derived from the calendar-year labels: `sepl_18.se1` / `semo_18.se1` answer
 * from 1800-01-01T12:13Z to 2400-01-05T12:38Z, and one step outside that Swiss
 * Ephemeris silently substitutes Moshier.
 *
 * These bound where a *checkpoint* may be placed, which is a different question
 * from where a scan may run: the checkpoint chain anchors at the nearest
 * epoch-anchored index, so a scan legitimately inside 1800–2399 can still reach
 * for an anchor up to `lift_step_days / 2` — 600 days for Neptune and Pluto —
 * outside it. Clamping the anchor keeps the whole declared range answerable.
 * A clamped anchor is at most one full `lift_step_days` from the instant it
 * anchors, which the 180°-per-step rule already covers.
 */
export const EPHEMERIS_MIN_JD = 2378498;
export const EPHEMERIS_MAX_JD = 2597645;

/**
 * The fixed unwrapping epoch: J2000.0, 2000-01-01T12:00:00 UT.
 *
 * Lifted longitude is anchored here and never reset at a request boundary. That
 * is the whole reason two overlapping scan windows agree on the integer
 * winding, and therefore on the cycle id.
 */
export const UNWRAPPING_EPOCH_JD = 2451545.0;

/** Bisection stops when the time bracket is this small: 2 seconds, in days. */
export const ROOT_TIME_TOLERANCE_DAYS = 2 / 86400;

/**
 * A sample is treated as sitting exactly on a root when |fT| is below this.
 * One ulp of a longitude near 360° is about 6e-14°, so this is roughly a
 * thousand ulps — tight enough to be a real coincidence, loose enough that
 * float noise does not hide a grid-point root and then find it again by
 * bracketing.
 */
export const ANGULAR_ZERO_TOLERANCE_DEG = 1e-9;

/** Two roots closer together than this are the same root seen from two brackets. */
export const ROOT_DEDUPE_TOLERANCE_DAYS = 4 / 86400;

/**
 * How far either side of a solved orb boundary the inside-orb predicate is
 * evaluated to classify it as an entry, an exit, or a tangent touch.
 *
 * It must exceed the ±1 s uncertainty a 2-second bisection bracket leaves, or
 * the probe can land on the wrong side of its own root. Thirty seconds clears
 * that comfortably and is still negligible motion: the Moon, the fastest body,
 * covers 0.0046° in it, against orbs measured in whole degrees.
 */
export const BOUNDARY_PROBE_DAYS = 30 / 86400;

/** Station refinement stops when the speed-sign bracket is this small. */
export const STATION_TIME_TOLERANCE_DAYS = 1 / 86400;

/**
 * The widest selection window this service will scan, in days.
 *
 * The contract does not bound `window`, and the ephemeris range permits a span
 * of nearly six centuries. It has to be bounded here instead, because
 * `handleCycleScan` is a synchronous call inside a single-threaded
 * `node:http` handler: a ten-year window measures at ~17 s of blocked event
 * loop — past the 5 s Fly health-check timeout, so the machine leaves rotation
 * while it works — and a century-scale one reaches ~450 MB against a 256 MB VM
 * and is OOM-killed. Neither is a load problem; one contract-valid request does
 * it.
 *
 * A quarter is far more than the daily reading needs — one local day — and it
 * holds the worst case near the ~2 s the lookaround sampling costs anyway. The
 * fixed cost is not the window; it is proving completeness for Pluto, which
 * takes a seventeen-year span at its slowest. Raising this is a policy-version
 * bump and should come with making the handler yield, not just with moving the
 * number.
 */
export const MAX_WINDOW_DAYS = 92;

/**
 * Scan geometry per transiting body.
 *
 * `scan_step_days` is the base grid the root brackets are cut from: it must be
 * fine enough that no two crossings of the same oriented target hide inside one
 * interval once stations have been spliced in. The design's "6 h for fast
 * bodies, 1 d for slow" is exactly this column.
 *
 * `lift_step_days` is the epoch-anchored checkpoint chain's step — the coarse
 * walk that supplies absolute lifted longitude at the first evaluation sample.
 * It is a *performance cache* whose values must match epoch recomputation, so
 * the only correctness requirement is that the body cannot move 180° in one
 * step; `cycles.test.ts` halves it and asserts the winding is unchanged.
 *
 * `lookaround_days` is how far past each window boundary the scanner will go to
 * prove an encounter's first entry and final exit. Reaching it without both
 * boundaries returns `cycle_window_incomplete` for the whole request rather
 * than a partial cycle.
 *
 * `max_retrograde_arc_deg` is what makes "proven" mean something. Merely being
 * outside orb at the edge of the span does NOT prove an encounter has ended: a
 * body can exit through +O, station a degree later, and come straight back in.
 * The bound is that a body's excursion against its own net motion is limited by
 * its retrograde arc, so once `|fT| > O + max_retrograde_arc_deg` it cannot
 * return to within O of that lifted target. That inequality — not the span edge
 * — is the completeness proof, and it is what sets every `lookaround_days`
 * above: each is the time the body needs to cover `2(O + arc)` of net motion at
 * its widest orb, plus margin. Both columns are measured against the pinned
 * 1800-2399 ephemeris rather than derived from mean motion, because mean motion
 * is the wrong number twice over: Pluto near aphelion needs almost twice the
 * lookaround its mean rate suggests, and Mercury's real retrograde arc is 16.3°
 * where a textbook figure would say 12°. An UNDERESTIMATED arc is the dangerous
 * direction — it makes the scanner declare an encounter over while the body can
 * still come back, dropping cycles and truncating envelopes silently.
 *
 * `max_speed_slope_deg_per_day2` and `min_station_separation_days` are what let
 * the station search be *complete* rather than merely usual. Comparing the speed
 * sign at two grid endpoints cannot tell zero reversals from two, and the true
 * node really does reverse twice inside one interval — it has motion episodes
 * as short as ten minutes, roughly twice a year, and each hidden pair silently
 * drops the exact passes it contains. The slope is a measured bound on
 * |d(speed)/dt|, so `min(|v_a|, |v_b|) > slope * width / 2` PROVES no zero lies
 * between two same-signed endpoints; that inequality holds for essentially every
 * interval, which is why the completeness costs nothing away from a station.
 * Where it fails, the interval is halved until it is narrower than
 * `min_station_separation_days` — the shortest span that can hold more than one
 * station for that body — and only then is a sign change refined.
 */
export interface BodyScanPolicy {
  scan_step_days: number;
  lift_step_days: number;
  lookaround_days: number;
  max_retrograde_arc_deg: number;
  max_speed_slope_deg_per_day2: number;
  min_station_separation_days: number;
}

/**
 * Angles are not transiting bodies — they are a property of the observer's
 * frame, not something with an ephemeris — so they appear only as natal
 * targets, never as keys here.
 */
export type TransitingBody = Exclude<CelestialBody, "ascendant" | "midheaven">;

export const TRANSITING_BODIES: readonly TransitingBody[] = [
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
  "true_node",
] as const;

export const BODY_SCAN_POLICY: Record<TransitingBody, BodyScanPolicy> = {
  // ~13.2°/day: 180° in 13.6 days, so a 4-day lift step has ~3x headroom.
  // Never retrograde, so leaving orb is already proof the encounter is over.
  moon: { scan_step_days: 0.25, lift_step_days: 4, lookaround_days: 6, max_retrograde_arc_deg: 0, max_speed_slope_deg_per_day2: 0.7, min_station_separation_days: 10 },
  sun: { scan_step_days: 0.25, lift_step_days: 60, lookaround_days: 60, max_retrograde_arc_deg: 0, max_speed_slope_deg_per_day2: 0.001, min_station_separation_days: 10 },
  // Mercury reaches 2.2°/day: 180° in 82 days. Geocentric net motion tracks the
  // Sun's ~360°/yr, which is what the lookaround is sized against.
  mercury: { scan_step_days: 0.25, lift_step_days: 30, lookaround_days: 220, max_retrograde_arc_deg: 17, max_speed_slope_deg_per_day2: 0.26, min_station_separation_days: 3 },
  venus: { scan_step_days: 0.25, lift_step_days: 45, lookaround_days: 300, max_retrograde_arc_deg: 17, max_speed_slope_deg_per_day2: 0.06, min_station_separation_days: 3 },
  mars: { scan_step_days: 0.25, lift_step_days: 90, lookaround_days: 500, max_retrograde_arc_deg: 21, max_speed_slope_deg_per_day2: 0.02, min_station_separation_days: 10 },
  jupiter: { scan_step_days: 1, lift_step_days: 200, lookaround_days: 900, max_retrograde_arc_deg: 11, max_speed_slope_deg_per_day2: 0.04, min_station_separation_days: 10 },
  saturn: { scan_step_days: 1, lift_step_days: 400, lookaround_days: 1400, max_retrograde_arc_deg: 8, max_speed_slope_deg_per_day2: 0.025, min_station_separation_days: 10 },
  uranus: { scan_step_days: 1, lift_step_days: 800, lookaround_days: 2400, max_retrograde_arc_deg: 5, max_speed_slope_deg_per_day2: 0.13, min_station_separation_days: 10 },
  neptune: { scan_step_days: 1, lift_step_days: 1200, lookaround_days: 3200, max_retrograde_arc_deg: 3, max_speed_slope_deg_per_day2: 0.06, min_station_separation_days: 10 },
  // 1.45°/yr of net motion at perihelion and far less at aphelion is why this is
  // the widest lookaround in the table: clearing 2(3 + 3)° takes fourteen years
  // in the slowest stretch of the pinned range.
  pluto: { scan_step_days: 1, lift_step_days: 1200, lookaround_days: 6200, max_retrograde_arc_deg: 3, max_speed_slope_deg_per_day2: 0.021, min_station_separation_days: 10 },
  // The true node is the one body that is net RETROGRADE, and the one whose
  // speed grazes zero often enough to reverse twice inside a coarse interval.
  // 6 h, not 1 d, and the only body that pays for the hidden-station probe.
  true_node: { scan_step_days: 0.25, lift_step_days: 400, lookaround_days: 250, max_retrograde_arc_deg: 2, max_speed_slope_deg_per_day2: 2.5, min_station_separation_days: 0.005 },
};

/** Motion speed class, used only to pick the transit orb row. */
type OrbClass = "luminary" | "personal" | "social" | "outer" | "node";

const ORB_CLASS: Record<TransitingBody, OrbClass> = {
  moon: "luminary",
  sun: "luminary",
  mercury: "personal",
  venus: "personal",
  mars: "personal",
  jupiter: "social",
  saturn: "social",
  uranus: "outer",
  neptune: "outer",
  pluto: "outer",
  true_node: "node",
};

/**
 * Transit orbs in degrees, by transiting-body speed class and aspect.
 *
 * The slower the body, the tighter the orb — otherwise the envelope stops being
 * an encounter and becomes a season. Every value is at or below the 12° ceiling
 * the response schema imposes on `orb_deg`.
 */
const TRANSIT_ORBS: Record<OrbClass, Record<AspectType, number>> = {
  luminary: { conjunction: 6, sextile: 3, square: 5, trine: 5, opposition: 6 },
  personal: { conjunction: 5, sextile: 2.5, square: 4, trine: 4, opposition: 5 },
  social: { conjunction: 4, sextile: 2, square: 3, trine: 3, opposition: 4 },
  outer: { conjunction: 3, sextile: 1.5, square: 2, trine: 2, opposition: 3 },
  node: { conjunction: 3, sextile: 1.5, square: 2, trine: 2, opposition: 3 },
};

export function transitOrbDeg(body: TransitingBody, aspect: AspectType): number {
  return TRANSIT_ORBS[ORB_CLASS[body]][aspect];
}
