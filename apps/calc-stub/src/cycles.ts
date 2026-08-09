/**
 * Transit cycle scanning (AST-08) — `POST /v1/cycles`.
 *
 * The one thing to understand before reading this file: `angularSeparation` is
 * unsigned and lives in [0, 180], so it is *not* a root function. Bracketing a
 * sign change on `angularSeparation - aspectAngle` finds a crossing only at
 * conjunction and opposition and silently misses every ordinary one. The root
 * function here is oriented and continuous instead:
 *
 *     targets(N, A) = unique(norm360(N + A), norm360(N - A))
 *     fT(t)         = liftedLongitude(t) - T,      T = T0 + 360k
 *
 * `liftedLongitude` is longitude unwrapped from a FIXED epoch, never reset at a
 * request boundary. That is what makes the integer winding — and therefore the
 * cycle id — a property of the physical encounter rather than of whichever scan
 * window happened to observe it. Two overlapping windows return one identical
 * cycle because they compute the same `k` for it.
 *
 * The ephemeris is behind an injectable interface. Production passes Swiss
 * Ephemeris; the tests pass analytic longitude functions, which is the only way
 * to exercise a station-on-target tangent or a controlled 0°/360° unwrap
 * without waiting for the sky to produce one.
 */

import { createHash } from "node:crypto";
import {
  M3_SCHEMA_VERSION,
  jcsCanonicalize,
  renderCycleId,
  type AspectType,
  type CelestialBody,
  type CycleErrorClass,
  type CycleIdentityV1,
  type CyclePass,
  type CycleRequest,
  type CycleResponse,
  type NormalizedCycle,
  type OrientedBranch,
  type PassDirection,
  type SuppressedFeatureClass,
} from "@patternlike/shared";
import {
  ANGULAR_ZERO_TOLERANCE_DEG,
  BODY_SCAN_POLICY,
  BOUNDARY_PROBE_DAYS,
  CYCLE_POLICY_ID,
  CYCLE_POLICY_VERSION,
  EPHEMERIS_MAX_JD,
  EPHEMERIS_MIN_JD,
  MAX_WINDOW_DAYS,
  ROOT_DEDUPE_TOLERANCE_DAYS,
  ROOT_TIME_TOLERANCE_DAYS,
  STATION_TIME_TOLERANCE_DAYS,
  TRANSITING_BODIES,
  TRANSIT_ORB_POLICY_ID,
  TRANSIT_ORB_POLICY_VERSION,
  UNWRAPPING_EPOCH_JD,
  transitOrbDeg,
  type TransitingBody,
} from "./cycle-policy.js";
import {
  ASPECT_ANGLE_BY_TYPE,
  EPHEMERIS_DATA_VERSION,
  EPHEMERIS_MAX_YEAR,
  EPHEMERIS_MIN_YEAR,
  SE_ID_BY_BODY,
  STUB_CONTAINER_DIGEST,
  calcBody,
  norm360,
} from "./engine.js";

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const UNIX_EPOCH_JD = 2440587.5;
const MS_PER_DAY = 86_400_000;

/**
 * Julian day (UT) from a Unix millisecond instant.
 *
 * This is the same convention `calculateChart` already uses: it feeds civil UTC
 * straight into `swe_julday`, which is a pure calendar conversion with no
 * leap-second table. `cycles.test.ts` asserts this linear form agrees with
 * `swe_julday` to the last bit, so the two cannot drift apart unnoticed.
 */
export function jdFromUnixMs(ms: number): number {
  return UNIX_EPOCH_JD + ms / MS_PER_DAY;
}

/**
 * Whole-second ISO-8601 UTC, always with a `Z`.
 *
 * One normalized form is load-bearing, not cosmetic: `cycle_response_policy`
 * orders passes and cycles by comparing these as raw strings, so a `+02:00`
 * offset or a fractional part would sort wrongly against a `Z` sibling.
 */
export function jdToIso(jd: number): string {
  const ms = Math.round(((jd - UNIX_EPOCH_JD) * MS_PER_DAY) / 1000) * 1000;
  return new Date(ms).toISOString().replace(/\.000Z$/, "Z");
}

function yearOfJd(jd: number): number {
  return new Date(Math.round((jd - UNIX_EPOCH_JD) * MS_PER_DAY)).getUTCFullYear();
}

// ---------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------

/** The representative of `x` in [-180, 180). */
export function wrap180(x: number): number {
  return x - 360 * Math.floor((x + 180) / 360);
}

/**
 * The distinct oriented target longitudes for a natal longitude and an aspect.
 *
 * Conjunction has one target. Opposition also has one, because `N + 180` and
 * `N - 180` are the same longitude modulo 360 — deduplicating them is what
 * stops one opposition being emitted twice. Everything strictly between has two
 * genuinely different branches, and they are different encounters.
 */
export function orientedTargets(
  natalLongitudeDeg: number,
  aspectAngleDeg: number,
): Array<{ branch: OrientedBranch; target_deg: number }> {
  const plus = norm360(natalLongitudeDeg + aspectAngleDeg);
  const minus = norm360(natalLongitudeDeg - aspectAngleDeg);
  if (Math.abs(wrap180(plus - minus)) < 1e-9) {
    return [{ branch: "single", target_deg: plus }];
  }
  return [
    { branch: "plus", target_deg: plus },
    { branch: "minus", target_deg: minus },
  ];
}

// ---------------------------------------------------------------------------
// Ephemeris access
// ---------------------------------------------------------------------------

export interface BodyState {
  /** Tropical geocentric ecliptic longitude in [0, 360). */
  lon: number;
  /** Signed longitudinal speed, degrees per day. */
  speed: number;
}

export interface EphemerisSource {
  stateAt(body: TransitingBody, jd: number): BodyState;
}

export class UnsupportedBodyError extends Error {
  readonly code = "unsupported_body";
}

/**
 * Swiss Ephemeris, with the same flags and the same strictness as the chart
 * engine.
 *
 * `calcBody` refuses a result whose `error` is non-empty, and that refusal
 * matters more here than it does for a chart: Swiss Ephemeris answers an
 * out-of-range request by silently falling back to Moshier and returning
 * *valid-looking* data with `SEFLG_SWIEPH` dropped from the flags. A cycle
 * solved that way would carry `ephemeris_data_version: se-2.10.03-…` while
 * having been computed from a different theory.
 */
export const swissEphemerisSource: EphemerisSource = {
  stateAt(body, jd) {
    const seId = SE_ID_BY_BODY[body];
    if (seId === undefined) {
      throw new UnsupportedBodyError(`no Swiss Ephemeris body id for ${body}`);
    }
    const r = calcBody(jd, seId);
    return { lon: norm360(r.lon), speed: r.speedLon };
  },
};

// ---------------------------------------------------------------------------
// Epoch-anchored lift
// ---------------------------------------------------------------------------

interface Checkpoint {
  jd: number;
  lon: number;
  lift: number;
}

interface Chain {
  points: Map<number, Checkpoint>;
  min: number;
  max: number;
}

/**
 * The verified checkpoint chain the design calls for: absolute lifted longitude
 * at fixed offsets from `UNWRAPPING_EPOCH_JD`, filled outward on demand and
 * memoised for the process.
 *
 * It is a performance cache, not an alternate source of identity. Its only
 * correctness requirement is that a body cannot travel 180° in one
 * `lift_step_days`, which makes each `wrap180` delta unambiguous; halving the
 * step must therefore reproduce every winding exactly, and `cycles.test.ts`
 * asserts precisely that.
 */
export class LiftChain {
  private readonly chains = new Map<TransitingBody, Chain>();

  constructor(
    private readonly source: EphemerisSource,
    private readonly stepOverride?: (body: TransitingBody) => number,
  ) {}

  private step(body: TransitingBody): number {
    return this.stepOverride?.(body) ?? BODY_SCAN_POLICY[body].lift_step_days;
  }

  private chain(body: TransitingBody): Chain {
    let chain = this.chains.get(body);
    if (!chain) {
      const lon = this.source.stateAt(body, UNWRAPPING_EPOCH_JD).lon;
      chain = {
        points: new Map([[0, { jd: UNWRAPPING_EPOCH_JD, lon, lift: norm360(lon) }]]),
        min: 0,
        max: 0,
      };
      this.chains.set(body, chain);
    }
    return chain;
  }

  private checkpoint(body: TransitingBody, index: number): Checkpoint {
    const chain = this.chain(body);
    const step = this.step(body);

    // The recurrence, and the reason the step must stay under half a
    // revolution: wrap180 of the delta is the true motion only when the true
    // motion is itself inside [-180, 180).
    const extend = (from: number, to: number, direction: 1 | -1): void => {
      let previous = chain.points.get(from)!;
      for (let cursor = from + direction; direction > 0 ? cursor <= to : cursor >= to; cursor += direction) {
        const jd = UNWRAPPING_EPOCH_JD + cursor * step;
        const lon = this.source.stateAt(body, jd).lon;
        const next: Checkpoint = { jd, lon, lift: previous.lift + wrap180(lon - previous.lon) };
        chain.points.set(cursor, next);
        previous = next;
      }
    };

    if (index > chain.max) {
      extend(chain.max, index, 1);
      chain.max = index;
    } else if (index < chain.min) {
      extend(chain.min, index, -1);
      chain.min = index;
    }
    return chain.points.get(index)!;
  }

  /**
   * Lifted longitude at `jd`, anchored at the nearest checkpoint that the
   * ephemeris files can actually answer.
   *
   * The clamp is not defensive tidying. Rounding to the nearest index reaches up
   * to `lift_step_days / 2` past `jd` — 600 days for Neptune and Pluto — so a
   * scan span comfortably inside 1800–2399 can still ask for an anchor outside
   * the pinned data, where Swiss Ephemeris substitutes Moshier and `calcBody`
   * throws. That surfaces as `calculation_failed` on a request the service
   * declares it supports. Clamping costs nothing: the anchor is then at most one
   * whole `lift_step_days` away, which is exactly the distance the
   * 180°-per-step rule already covers.
   */
  liftedLongitude(body: TransitingBody, jd: number, lon: number): number {
    const step = this.step(body);
    const nearest = Math.round((jd - UNWRAPPING_EPOCH_JD) / step);
    const lowest = Math.ceil((EPHEMERIS_MIN_JD - UNWRAPPING_EPOCH_JD) / step);
    const highest = Math.floor((EPHEMERIS_MAX_JD - UNWRAPPING_EPOCH_JD) / step);
    const anchor = this.checkpoint(body, Math.min(Math.max(nearest, lowest), highest));
    return anchor.lift + wrap180(lon - anchor.lon);
  }
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

export interface Sample {
  jd: number;
  lon: number;
  speed: number;
  /** Lifted longitude: continuous across 0°/360°, anchored at the fixed epoch. */
  lift: number;
  /** True when this sample was spliced in at a refined station. */
  station: boolean;
  /** For a station sample, the direction the body leaves in. */
  stationDirection?: PassDirection;
}

/**
 * Lifted longitude inside a bracket, anchored at the bracket's own start
 * sample — `liftedLongitude(t) = L[i] + wrap180(λ(t) − λ[i])`, exactly as
 * specified. Anchoring per bracket rather than per evaluation is what keeps the
 * solver continuous; normalizing each evaluation independently would put a
 * false discontinuity at ±180° right inside the bisection.
 */
function liftedFrom(anchor: Sample, lon: number): number {
  return anchor.lift + wrap180(lon - anchor.lon);
}

/**
 * Sample the body across the span, then splice in every refined station.
 *
 * Splitting at stations is not an optimization: it is what exposes the two
 * crossings that otherwise hide inside one base interval when a body turns
 * around on top of a target and comes back. The grid is anchored to the
 * unwrapping epoch rather than to the request, so two overlapping windows
 * evaluate the identical instants wherever they overlap.
 */
export function sampleBody(
  source: EphemerisSource,
  lift: LiftChain,
  body: TransitingBody,
  spanStartJd: number,
  spanEndJd: number,
): Sample[] {
  const step = BODY_SCAN_POLICY[body].scan_step_days;

  const take = (jd: number, station: boolean): Sample => {
    const state = source.stateAt(body, jd);
    return {
      jd,
      lon: state.lon,
      speed: state.speed,
      lift: lift.liftedLongitude(body, jd, state.lon),
      station,
    };
  };

  const grid: Sample[] = [];
  const firstIndex = Math.floor((spanStartJd - UNWRAPPING_EPOCH_JD) / step);
  const lastIndex = Math.ceil((spanEndJd - UNWRAPPING_EPOCH_JD) / step);
  for (let i = firstIndex; i <= lastIndex; i++) {
    grid.push(take(UNWRAPPING_EPOCH_JD + i * step, false));
  }

  /** Refine one speed-sign change to a station sample. */
  const refineStation = (loJd: number, loSpeed: number, hiJd: number): Sample => {
    let lo = loJd;
    let hi = hiJd;
    let sign = Math.sign(loSpeed);
    while (hi - lo > STATION_TIME_TOLERANCE_DAYS) {
      const mid = (lo + hi) / 2;
      const midSpeed = source.stateAt(body, mid).speed;
      if (midSpeed === 0) return take(mid, true);
      if (Math.sign(midSpeed) === sign) {
        lo = mid;
        sign = Math.sign(midSpeed);
      } else {
        hi = mid;
      }
    }
    return take((lo + hi) / 2, true);
  };

  const { max_speed_slope_deg_per_day2: maxSlope, min_station_separation_days: minSeparation } =
    BODY_SCAN_POLICY[body];

  /**
   * Splice every station in `[a, b]` into `out`, in ascending order.
   *
   * Comparing the speed sign at the two endpoints cannot tell zero reversals
   * from two. The true node really does reverse twice inside one grid interval
   * — brief direct episodes, some only ten minutes long, about twice a year —
   * and each hidden pair leaves the bracket non-monotonic and silently drops
   * the exact roots inside it. A finer fixed grid does not fix that; the
   * episodes are shorter than any grid worth paying for.
   *
   * So the same-signed case is a *proof obligation*, not a shortcut. With a
   * measured bound on |d(speed)/dt|, speed cannot reach zero between two
   * same-signed endpoints while
   * `min(|v_a|, |v_b|) > maxSlope · width / 2`. That inequality holds for
   * essentially every interval, so completeness costs nothing away from a
   * station; where it fails, the interval is halved until it is narrower than
   * the shortest span that can hold two stations, and only then is a sign
   * change refined.
   */
  const spliceStations = (a: Sample, b: Sample, out: Sample[], depth: number): void => {
    const width = b.jd - a.jd;
    if (width <= STATION_TIME_TOLERANCE_DAYS) return;

    const sameSign = Math.sign(a.speed) === Math.sign(b.speed);
    const couldHoldZero =
      Math.min(Math.abs(a.speed), Math.abs(b.speed)) <= (maxSlope * width) / 2;
    // Same-signed endpoints too fast to reach zero in the time available: no
    // station can be hiding here, and this is the overwhelmingly common case.
    if (sameSign && !couldHoldZero) return;

    if (depth === 0 || width <= minSeparation) {
      if (!sameSign) {
        const station = refineStation(a.jd, a.speed, b.jd);
        // Speed is ~0 at the station, so the two-value direction field has to
        // come from the branch the body leaves along: retrograde for
        // direct→retrograde, direct for retrograde→direct.
        station.stationDirection = b.speed > 0 ? "direct" : "retrograde";
        out.push(station);
      }
      return;
    }

    const mid = take((a.jd + b.jd) / 2, false);
    spliceStations(a, mid, out, depth - 1);
    spliceStations(mid, b, out, depth - 1);
  };

  const samples: Sample[] = [];
  for (let i = 0; i < grid.length; i++) {
    const current = grid[i]!;
    // A grid sample that lands exactly on zero speed IS the station. Skipping
    // both of its intervals — which a plain sign comparison does, since
    // Math.sign(0) is 0 — would emit the tangent there with no direction, and
    // `passDirection` would then call a direct→retrograde station "direct".
    if (current.speed === 0) {
      current.station = true;
      const following = grid.slice(i + 1).find((s) => s.speed !== 0);
      if (following) current.stationDirection = following.speed > 0 ? "direct" : "retrograde";
      samples.push(current);
      continue;
    }
    samples.push(current);
    const next = grid[i + 1];
    if (!next || next.speed === 0) continue;
    spliceStations(current, next, samples, MAX_STATION_PROBE_DEPTH);
  }
  return samples;
}

/**
 * Backstop on the station descent. The slope bound and
 * `min_station_separation_days` already terminate it — the node needs about six
 * levels to get from a 6-hour interval to its 7-minute separation — so this only
 * catches a speed curve that touches zero without crossing, which would
 * otherwise descend forever.
 */
const MAX_STATION_PROBE_DEPTH = 14;

// ---------------------------------------------------------------------------
// Root finding
// ---------------------------------------------------------------------------

interface Root {
  jd: number;
  speed: number;
  /** Set only for a station-on-target tangent, where speed is ~0 at the root. */
  stationDirection?: PassDirection;
}

type LevelKind = "exact" | "lower" | "upper";

interface LevelRoots {
  exact: Root[];
  lower: Root[];
  upper: Root[];
}

function pushRoot(into: Root[], root: Root): void {
  // A root that sits on a shared bracket endpoint is found twice; it is one
  // physical event, so the second sighting is dropped rather than emitted as a
  // duplicate pass.
  if (into.some((r) => Math.abs(r.jd - root.jd) <= ROOT_DEDUPE_TOLERANCE_DAYS)) return;
  into.push(root);
}

/**
 * One pass over the prepared samples, solving all three level families at once.
 *
 * `exact` solves `fT = 0`; `lower` and `upper` solve `fT = -O` and `fT = +O`
 * with the same unwrapped scanner and refiner. Solving `abs(fT) - O` instead
 * would fold the two boundaries into one unsigned function and lose which side
 * was crossed — the same mistake as using `angularSeparation`, one level up.
 *
 * Results are keyed by integer winding `k`, which is the grouping key for
 * cycles: not temporal proximity, not orb overlap, not scan batch.
 */
export function scanTargetBranch(
  source: EphemerisSource,
  body: TransitingBody,
  samples: Sample[],
  targetDeg: number,
  orbDeg: number,
): Map<number, LevelRoots> {
  const byWinding = new Map<number, LevelRoots>();
  const bucket = (k: number, kind: LevelKind): Root[] => {
    let entry = byWinding.get(k);
    if (!entry) {
      entry = { exact: [], lower: [], upper: [] };
      byWinding.set(k, entry);
    }
    return entry[kind];
  };

  const families: Array<{ kind: LevelKind; base: number }> = [
    { kind: "exact", base: targetDeg },
    { kind: "lower", base: targetDeg - orbDeg },
    { kind: "upper", base: targetDeg + orbDeg },
  ];

  for (let i = 0; i < samples.length; i++) {
    const anchor = samples[i]!;
    const next = samples[i + 1];
    // Both bracket endpoints are measured from the SAME anchor. Reading
    // next.lift instead would mix two checkpoint anchors inside one bracket.
    const liftNext = next ? liftedFrom(anchor, next.lon) : null;

    for (const { kind, base } of families) {
      // A root the grid landed on exactly: recorded once, here, rather than
      // bracketed twice from either side.
      const nearestK = Math.round((anchor.lift - base) / 360);
      if (Math.abs(anchor.lift - (base + 360 * nearestK)) <= ANGULAR_ZERO_TOLERANCE_DEG) {
        const root: Root = { jd: anchor.jd, speed: anchor.speed };
        if (anchor.station && anchor.stationDirection) {
          root.stationDirection = anchor.stationDirection;
        }
        pushRoot(bucket(nearestK, kind), root);
      }

      if (liftNext === null || !next) continue;

      const ratioA = (anchor.lift - base) / 360;
      const ratioB = (liftNext - base) / 360;
      const kLow = Math.ceil(Math.min(ratioA, ratioB));
      const kHigh = Math.floor(Math.max(ratioA, ratioB));
      for (let k = kLow; k <= kHigh; k++) {
        const level = base + 360 * k;
        const fA = anchor.lift - level;
        const fB = liftNext - level;
        if (Math.abs(fA) <= ANGULAR_ZERO_TOLERANCE_DEG) continue; // recorded above
        if (Math.abs(fB) <= ANGULAR_ZERO_TOLERANCE_DEG) continue; // recorded next iteration
        if (Math.sign(fA) === Math.sign(fB)) continue;

        const jd = bisect(source, body, anchor, next.jd, level, Math.sign(fA));
        pushRoot(bucket(k, kind), { jd, speed: source.stateAt(body, jd).speed });
      }
    }
  }
  return byWinding;
}

/** Deterministic bisection to a ≤2 s bracket, which is a ±1 s timestamp. */
function bisect(
  source: EphemerisSource,
  body: TransitingBody,
  anchor: Sample,
  hiJd: number,
  level: number,
  loSignIn: number,
): number {
  let lo = anchor.jd;
  let hi = hiJd;
  let loSign = loSignIn;
  while (hi - lo > ROOT_TIME_TOLERANCE_DAYS) {
    const mid = (lo + hi) / 2;
    const f = liftedFrom(anchor, source.stateAt(body, mid).lon) - level;
    if (f === 0) return mid;
    if (Math.sign(f) === loSign) {
      lo = mid;
      loSign = Math.sign(f);
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface CycleIdentityInputs {
  chart_fingerprint: string;
  contract_id: string;
  contract_version: string;
  container_digest: string;
  ephemeris_data_version: string;
}

export function buildCycleIdentity(
  inputs: CycleIdentityInputs,
  body: CelestialBody,
  target: string,
  aspect: AspectType,
  orientedBranch: OrientedBranch,
  winding: number,
): CycleIdentityV1 {
  return {
    identity_profile: "patternlike.cycle-id.v1",
    chart_fingerprint: inputs.chart_fingerprint,
    technique: "transit",
    body,
    target,
    aspect,
    oriented_branch: orientedBranch,
    winding,
    contract_id: inputs.contract_id,
    contract_version: inputs.contract_version,
    cycle_policy_id: CYCLE_POLICY_ID,
    cycle_policy_version: CYCLE_POLICY_VERSION,
    orb_policy_id: TRANSIT_ORB_POLICY_ID,
    orb_policy_version: TRANSIT_ORB_POLICY_VERSION,
    container_digest: inputs.container_digest,
    ephemeris_data_version: inputs.ephemeris_data_version,
  };
}

export function cycleIdFromIdentity(identity: CycleIdentityV1): string {
  const digest = createHash("sha256")
    .update(jcsCanonicalize(identity), "utf8")
    .digest("hex");
  return renderCycleId(digest);
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

export class CycleRequestError extends Error {
  constructor(
    readonly errorClass: "invalid_request" | "unsupported_body" | "ephemeris_range",
    message: string,
  ) {
    super(message);
    this.name = "CycleRequestError";
  }
}

/** Thrown when an encounter's outer boundaries cannot be proven inside the lookaround. */
export class CycleWindowIncompleteError extends Error {
  readonly errorClass = "cycle_window_incomplete" as const;
  constructor(message = "encounter boundaries not proven within the policy lookaround limit") {
    super(message);
    this.name = "CycleWindowIncompleteError";
  }
}

const LAUNCH_BODY_SET: ReadonlySet<string> = new Set<CelestialBody>([
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
  "ascendant",
  "midheaven",
]);

const SUPPRESSED_FEATURE_SET: ReadonlySet<string> = new Set<SuppressedFeatureClass>([
  "houses",
  "angles",
  "angle_transits",
  "moon_time_sensitive",
]);

const ANGLE_TARGETS: ReadonlySet<string> = new Set<CelestialBody>(["ascendant", "midheaven"]);

const ASPECTS: readonly AspectType[] = [
  "conjunction",
  "sextile",
  "square",
  "trine",
  "opposition",
];

const OPAQUE_ID_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const CONTENT_HASH_RE = /^(sha256:)?[a-f0-9]{64}$/;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)([.-][0-9A-Za-z.-]+)?$/;

/**
 * RFC 3339 `date-time`, which is what the schema's `format` means and what
 * `Date.parse` emphatically is not.
 *
 * `Date.parse` accepts `2026-07-30`, `Aug 9, 2026`, and — worst of the three —
 * `2026-07-30T07:00:00` with no offset, which ECMAScript resolves in the *host*
 * timezone. That last one makes the selected window depend on the machine the
 * calculation service happens to be running on: the same request answered in
 * `America/Chicago` and in UTC returns different cycles. A designated offset is
 * therefore mandatory, not merely conventional.
 */
const RFC3339_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export interface ValidatedRequest {
  request: CycleRequest;
  windowFromJd: number;
  windowToJd: number;
  /** Natal targets after suppression. Suppressed targets are never computed. */
  targets: Array<{ body: CelestialBody; longitude_deg: number }>;
}

/**
 * A caller-supplied name, bounded and quoted, for use inside an error message.
 *
 * Object keys are attacker-controlled and unbounded. Echoing one raw lets the
 * caller decide how much of a 300-code-point message is their text rather than
 * ours, which makes the message useless exactly when it matters.
 */
function quoteName(value: string): string {
  const points = Array.from(value);
  const shown = points.length <= 40 ? value : points.slice(0, 40).join("") + "…";
  return JSON.stringify(shown);
}

function parseInstant(value: unknown, field: string): number {
  const match = typeof value === "string" ? RFC3339_RE.exec(value) : null;
  if (!match) {
    throw new CycleRequestError(
      "invalid_request",
      `${field} must be an RFC 3339 instant with a designated offset`,
    );
  }

  // The pattern proves the shape; the fields still have to name a real instant.
  // `Date.parse` will not tell us — it rolls 2026-02-30 forward into March and
  // returns a perfectly good number for a date the calendar does not have.
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const monthLength =
    month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthLength ||
    hour > 23 ||
    minute > 59 ||
    // 60 is RFC 3339's leap second, which the ephemeris has no notion of; it is
    // accepted here and lands on the following minute.
    second > 60 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new CycleRequestError("invalid_request", `${field} is not a real instant`);
  }

  const ms = Date.parse(match[0]);
  if (Number.isNaN(ms)) {
    throw new CycleRequestError("invalid_request", `${field} is not a real instant`);
  }
  return jdFromUnixMs(ms);
}

/**
 * Validate the closed `cycleRequest` shape.
 *
 * The schema is `additionalProperties: false` and that closure *is* the privacy
 * enforcement — a user id, birth instant, timezone, coordinate, profile id, or
 * storage id is rejected because it is not declared, not because a denylist
 * caught it. Repeating the closure here means the service refuses the same
 * things whether or not anything validated the body upstream.
 *
 * Three semantic rules the contract leaves to code are decided here, and each
 * is a decision rather than a reading: `window.from` must precede `window.to`;
 * a body may appear once in `natal_positions`; and an angle must not be sent at
 * all when angles are suppressed.
 */
export function validateCycleRequest(body: unknown): ValidatedRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new CycleRequestError("invalid_request", "request body must be an object");
  }
  const raw = body as Record<string, unknown>;

  const allowed = new Set([
    "schema_version",
    "request_id",
    "chart_fingerprint",
    "natal_positions",
    "natal_accuracy",
    "suppressed_features",
    "window",
    "techniques",
    "cycle_policy_id",
    "cycle_policy_version",
    "orb_policy_id",
    "orb_policy_version",
    "contract_id",
    "contract_version",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new CycleRequestError("invalid_request", `undeclared property ${quoteName(key)}`);
    }
  }

  if (raw.schema_version !== M3_SCHEMA_VERSION) {
    throw new CycleRequestError(
      "invalid_request",
      `schema_version must be ${M3_SCHEMA_VERSION}`,
    );
  }

  const requestId = raw.request_id;
  if (typeof requestId !== "string" || !OPAQUE_ID_RE.test(requestId)) {
    throw new CycleRequestError("invalid_request", "request_id is not an opaque id");
  }

  const fingerprint = raw.chart_fingerprint;
  if (typeof fingerprint !== "string" || !CONTENT_HASH_RE.test(fingerprint)) {
    throw new CycleRequestError("invalid_request", "chart_fingerprint is not a content hash");
  }

  const accuracy = raw.natal_accuracy;
  if (accuracy !== "exact" && accuracy !== "approximate" && accuracy !== "unknown") {
    throw new CycleRequestError("invalid_request", "natal_accuracy is not a birth-time accuracy");
  }

  const techniques = raw.techniques;
  if (!Array.isArray(techniques) || techniques.length !== 1 || techniques[0] !== "transits") {
    throw new CycleRequestError(
      "invalid_request",
      'techniques must be exactly ["transits"]; stations_ingresses and lunations_eclipses are declared but absent',
    );
  }

  const suppressed: SuppressedFeatureClass[] = [];
  if (raw.suppressed_features !== undefined) {
    if (!Array.isArray(raw.suppressed_features)) {
      throw new CycleRequestError("invalid_request", "suppressed_features must be an array");
    }
    for (const entry of raw.suppressed_features) {
      if (typeof entry !== "string" || !SUPPRESSED_FEATURE_SET.has(entry)) {
        throw new CycleRequestError(
          "invalid_request",
          "suppressed_features contains an undeclared feature class",
        );
      }
      if (suppressed.includes(entry as SuppressedFeatureClass)) {
        throw new CycleRequestError("invalid_request", "suppressed_features must be unique");
      }
      suppressed.push(entry as SuppressedFeatureClass);
    }
  }

  for (const field of ["cycle_policy_id", "orb_policy_id", "contract_id"] as const) {
    const value = raw[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new CycleRequestError("invalid_request", `${field} must be a non-empty string`);
    }
  }
  for (const field of ["cycle_policy_version", "orb_policy_version"] as const) {
    const value = raw[field];
    if (typeof value !== "string" || value.length === 0 || value.length > 64) {
      throw new CycleRequestError("invalid_request", `${field} is not a policy version`);
    }
  }
  if (typeof raw.contract_version !== "string" || !SEMVER_RE.test(raw.contract_version)) {
    throw new CycleRequestError("invalid_request", "contract_version is not a semantic version");
  }

  // A request naming a policy this build does not implement must fail rather
  // than be answered under a different one: the policy identifiers are echoed
  // into the response and hashed into every cycle id, so answering under a
  // substitute would mint ids claiming a vintage the scan did not use.
  if (
    raw.cycle_policy_id !== CYCLE_POLICY_ID ||
    raw.cycle_policy_version !== CYCLE_POLICY_VERSION
  ) {
    throw new CycleRequestError(
      "invalid_request",
      `unknown cycle policy; this build implements ${CYCLE_POLICY_ID}@${CYCLE_POLICY_VERSION}`,
    );
  }
  if (
    raw.orb_policy_id !== TRANSIT_ORB_POLICY_ID ||
    raw.orb_policy_version !== TRANSIT_ORB_POLICY_VERSION
  ) {
    throw new CycleRequestError(
      "invalid_request",
      `unknown orb policy; this build implements ${TRANSIT_ORB_POLICY_ID}@${TRANSIT_ORB_POLICY_VERSION}`,
    );
  }

  const window = raw.window;
  if (typeof window !== "object" || window === null || Array.isArray(window)) {
    throw new CycleRequestError("invalid_request", "window must be an object");
  }
  const windowRaw = window as Record<string, unknown>;
  for (const key of Object.keys(windowRaw)) {
    if (key !== "from" && key !== "to") {
      throw new CycleRequestError("invalid_request", `undeclared window property ${quoteName(key)}`);
    }
  }
  if (windowRaw.from === undefined || windowRaw.to === undefined) {
    throw new CycleRequestError("invalid_request", "window requires from and to");
  }
  const windowFromJd = parseInstant(windowRaw.from, "window.from");
  const windowToJd = parseInstant(windowRaw.to, "window.to");
  if (!(windowToJd > windowFromJd)) {
    throw new CycleRequestError("invalid_request", "window.to must be after window.from");
  }
  // The scan is synchronous and its cost grows with the window; an unbounded
  // one is a single-request denial of service rather than a load problem.
  if (windowToJd - windowFromJd > MAX_WINDOW_DAYS) {
    throw new CycleRequestError(
      "invalid_request",
      `window spans more than the ${MAX_WINDOW_DAYS}-day maximum this policy scans`,
    );
  }

  const positions = raw.natal_positions;
  if (!Array.isArray(positions) || positions.length === 0) {
    throw new CycleRequestError("invalid_request", "natal_positions must be a non-empty array");
  }

  const seen = new Set<string>();
  const targets: Array<{ body: CelestialBody; longitude_deg: number }> = [];
  for (const entry of positions) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new CycleRequestError("invalid_request", "natal_positions entries must be objects");
    }
    const position = entry as Record<string, unknown>;
    for (const key of Object.keys(position)) {
      if (key !== "body" && key !== "longitude_deg") {
        throw new CycleRequestError(
          "invalid_request",
          `undeclared natal_positions property ${quoteName(key)}`,
        );
      }
    }
    const positionBody = position.body;
    if (typeof positionBody !== "string" || !LAUNCH_BODY_SET.has(positionBody)) {
      throw new CycleRequestError("invalid_request", "natal_positions body is not a launch body");
    }
    const longitude = position.longitude_deg;
    if (typeof longitude !== "number" || !Number.isFinite(longitude)) {
      throw new CycleRequestError("invalid_request", "longitude_deg must be a finite number");
    }
    if (longitude < 0 || longitude >= 360) {
      throw new CycleRequestError("invalid_request", "longitude_deg must be in [0, 360)");
    }
    // Two entries for one body would mint two cycles with byte-identical
    // identities, and the response contract requires unique ids. Reject rather
    // than silently dedupe: a caller sending one body twice with different
    // longitudes has a bug that a silent dedupe would hide.
    if (seen.has(positionBody)) {
      throw new CycleRequestError(
        "invalid_request",
        `natal_positions contains ${positionBody} more than once`,
      );
    }
    seen.add(positionBody);
    targets.push({ body: positionBody as CelestialBody, longitude_deg: longitude });
  }

  // Angles are never computed and filtered. The contract states the caller
  // obligation for unknown accuracy; treating an explicit `angles` /
  // `angle_transits` suppression the same way is a decision, and it is the safe
  // direction — it can only ever suppress more, never less.
  const anglesSuppressed =
    accuracy === "unknown" ||
    suppressed.includes("angles") ||
    suppressed.includes("angle_transits");
  if (anglesSuppressed) {
    const angle = targets.find((t) => ANGLE_TARGETS.has(t.body));
    if (angle) {
      throw new CycleRequestError(
        "invalid_request",
        `${angle.body} must not appear when angles are suppressed`,
      );
    }
  }

  const request: CycleRequest = {
    schema_version: M3_SCHEMA_VERSION,
    request_id: requestId,
    chart_fingerprint: fingerprint,
    natal_positions: targets.map((t) => ({ body: t.body, longitude_deg: t.longitude_deg })),
    natal_accuracy: accuracy,
    suppressed_features: suppressed,
    window: { from: windowRaw.from as string, to: windowRaw.to as string },
    techniques: ["transits"],
    cycle_policy_id: raw.cycle_policy_id as string,
    cycle_policy_version: raw.cycle_policy_version as string,
    orb_policy_id: raw.orb_policy_id as string,
    orb_policy_version: raw.orb_policy_version as string,
    contract_id: raw.contract_id as string,
    contract_version: raw.contract_version as string,
  };

  // A natal Moon target is omitted rather than rejected — the contract phrases
  // it as service behaviour, not a caller obligation. The TRANSITING Moon stays
  // valid against stable natal targets, because the transit instant is known
  // even when the birth instant is not.
  const usableTargets = suppressed.includes("moon_time_sensitive")
    ? targets.filter((t) => t.body !== "moon")
    : targets;

  return { request, windowFromJd, windowToJd, targets: usableTargets };
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export interface ScanOptions {
  source?: EphemerisSource;
  containerDigest?: string;
  ephemerisDataVersion?: string;
  /** Test hook: shrink the lookaround to force `cycle_window_incomplete`. */
  lookaroundDaysOverride?: (body: TransitingBody) => number;
  /** Test hook: prove the checkpoint chain is a cache, not a source of identity. */
  liftStepDaysOverride?: (body: TransitingBody) => number;
  /** Test hook: the return-proof bound for an injected analytic body. */
  maxRetrogradeArcOverride?: (body: TransitingBody) => number;
  /** Restrict the transiting bodies scanned. Production scans all of them. */
  bodies?: readonly TransitingBody[];
}

/**
 * Run the scan and return the normalized cycles the window selects.
 *
 * Throws `CycleWindowIncompleteError` when a selected encounter's outer
 * boundaries are not both proven inside the body's lookaround. The failure is
 * for the whole request on purpose: a half-discovered encounter that is later
 * completed would be stored twice under two different identities.
 */
export function scanCycles(
  validated: ValidatedRequest,
  options: ScanOptions = {},
): NormalizedCycle[] {
  const source = options.source ?? swissEphemerisSource;
  const lift = new LiftChain(source, options.liftStepDaysOverride);
  const identityInputs: CycleIdentityInputs = {
    chart_fingerprint: validated.request.chart_fingerprint,
    contract_id: validated.request.contract_id,
    contract_version: validated.request.contract_version,
    container_digest: options.containerDigest ?? STUB_CONTAINER_DIGEST,
    ephemeris_data_version: options.ephemerisDataVersion ?? EPHEMERIS_DATA_VERSION,
  };

  const bodies = options.bodies ?? TRANSITING_BODIES;
  const spans = new Map<TransitingBody, { start: number; end: number }>();
  for (const body of bodies) {
    const lookaround =
      options.lookaroundDaysOverride?.(body) ?? BODY_SCAN_POLICY[body].lookaround_days;
    spans.set(body, {
      start: validated.windowFromJd - lookaround,
      end: validated.windowToJd + lookaround,
    });
  }

  // Checked for every body before any scanning, so the failure does not depend
  // on how far the loop happened to get.
  for (const span of spans.values()) assertEphemerisRange(span.start, span.end);

  const out: NormalizedCycle[] = [];
  for (const body of bodies) {
    const span = spans.get(body)!;
    let samples: Sample[] | null = null;

    for (const target of validated.targets) {
      for (const aspect of ASPECTS) {
        const orbDeg = transitOrbDeg(body, aspect);
        for (const { branch, target_deg } of orientedTargets(
          target.longitude_deg,
          ASPECT_ANGLE_BY_TYPE[aspect],
        )) {
          samples ??= sampleBody(source, lift, body, span.start, span.end);
          const byWinding = scanTargetBranch(source, body, samples, target_deg, orbDeg);

          for (const [winding, levels] of byWinding) {
            if (levels.exact.length === 0) continue;
            const envelope = solveEnvelope(
              source,
              body,
              samples,
              levels,
              target_deg,
              orbDeg,
              winding,
              options.maxRetrogradeArcOverride?.(body) ??
                BODY_SCAN_POLICY[body].max_retrograde_arc_deg,
            );

            // Selection, not clipping: the window decides which complete
            // encounters are returned, never where one starts or stops.
            //
            // The order matters. An encounter near the edge of the scan span is
            // routinely unprovable and routinely irrelevant — it ends long
            // before the window opens, or begins long after it closes. Failing
            // the request for one of those would make every scan fail. So the
            // cheap bound is applied first, and only an encounter that could
            // actually touch the window has to be proven.
            if (envelope.provenRightJd !== null && envelope.provenRightJd < validated.windowFromJd) {
              continue;
            }
            if (envelope.provenLeftJd !== null && envelope.provenLeftJd >= validated.windowToJd) {
              continue;
            }
            if (envelope.startJd === null || envelope.endJd === null) {
              throw new CycleWindowIncompleteError();
            }
            if (envelope.endJd < validated.windowFromJd) continue;
            if (envelope.startJd >= validated.windowToJd) continue;

            out.push(
              finalizeCycle(identityInputs, {
                body,
                target: target.body,
                aspect,
                branch,
                winding,
                orbDeg,
                passes: [...levels.exact].sort((a, b) => a.jd - b.jd),
                startJd: envelope.startJd,
                endJd: envelope.endJd,
              }),
            );
          }
        }
      }
    }
  }

  out.sort((a, b) =>
    a.exact_at !== b.exact_at
      ? a.exact_at < b.exact_at
        ? -1
        : 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0,
  );
  return out;
}

function assertEphemerisRange(spanStartJd: number, spanEndJd: number): void {
  // A day of margin at each end: the sampling grid is epoch-anchored, so it
  // rounds outward past the span by up to one scan step.
  const first = yearOfJd(spanStartJd - 1);
  const last = yearOfJd(spanEndJd + 1);
  if (first < EPHEMERIS_MIN_YEAR || last > EPHEMERIS_MAX_YEAR) {
    throw new CycleRequestError(
      "ephemeris_range",
      `scan span ${first}-${last} leaves the supported ${EPHEMERIS_MIN_YEAR}-${EPHEMERIS_MAX_YEAR} range`,
    );
  }
}

/**
 * Solve one winding's orb envelope: earliest outside→inside event before the
 * first pass, latest inside→outside event after the last. Intervening exits and
 * re-entries stay inside the same cycle — temporarily leaving orb does not
 * split a multi-pass encounter.
 *
 * A `null` boundary means the encounter was not *proven* over on that side.
 * Being outside orb at the edge of the span is not that proof: a body can exit
 * through +O, station a degree later, and come straight back in, which is
 * exactly the multi-pass case. What does prove it is
 * `|fT| > O + max_retrograde_arc_deg` — past that the body cannot return to
 * within O of this lifted target, because doing so would take more motion
 * against its net direction than it has. So the search for the earliest entry
 * is bounded on the left by the last such point before the first pass, and the
 * search for the latest exit on the right by the first one after the last pass.
 */
function solveEnvelope(
  source: EphemerisSource,
  body: TransitingBody,
  samples: Sample[],
  levels: LevelRoots,
  targetDeg: number,
  orbDeg: number,
  winding: number,
  arcDeg: number,
): Envelope {
  const level = targetDeg + 360 * winding;
  const passes = [...levels.exact].sort((a, b) => a.jd - b.jd);
  const firstPassJd = passes[0]!.jd;
  const lastPassJd = passes[passes.length - 1]!.jd;
  const beyondReturn = orbDeg + arcDeg;

  let provenLeftJd: number | null = null;
  let provenRightJd: number | null = null;
  for (const sample of samples) {
    if (Math.abs(sample.lift - level) <= beyondReturn) continue;
    if (sample.jd < firstPassJd) provenLeftJd = sample.jd;
    else if (sample.jd > lastPassJd && provenRightJd === null) provenRightJd = sample.jd;
  }
  if (provenLeftJd === null || provenRightJd === null) {
    return { startJd: null, endJd: null, provenLeftJd, provenRightJd };
  }

  const entries: number[] = [];
  const exits: number[] = [];
  for (const boundary of [...levels.lower, ...levels.upper].sort((a, b) => a.jd - b.jd)) {
    // Classify by the inside-orb predicate on both sides. A tangent touch that
    // leaves the predicate unchanged is neither an entry nor an exit.
    const before = insideOrb(source, body, samples, boundary.jd - BOUNDARY_PROBE_DAYS, level, orbDeg);
    const after = insideOrb(source, body, samples, boundary.jd + BOUNDARY_PROBE_DAYS, level, orbDeg);
    if (!before && after) entries.push(boundary.jd);
    else if (before && !after) exits.push(boundary.jd);
  }

  const startJd =
    entries.filter((jd) => jd >= provenLeftJd && jd <= firstPassJd).sort((a, b) => a - b)[0] ?? null;
  const endJd =
    exits.filter((jd) => jd >= lastPassJd && jd <= provenRightJd).sort((a, b) => b - a)[0] ?? null;
  return { startJd, endJd, provenLeftJd, provenRightJd };
}

interface Envelope {
  /** The solved first entry, or null when this side was not proven. */
  startJd: number | null;
  /** The solved final exit, or null when this side was not proven. */
  endJd: number | null;
  /**
   * Bounds on where the true envelope can reach, used to decide whether an
   * unproven encounter is even capable of touching the window. `null` means
   * unbounded on that side, which is the only case that has to fail the request.
   */
  provenLeftJd: number | null;
  provenRightJd: number | null;
}

function insideOrb(
  source: EphemerisSource,
  body: TransitingBody,
  samples: Sample[],
  jd: number,
  level: number,
  orbDeg: number,
): boolean {
  const anchor = nearestSample(samples, jd);
  return Math.abs(liftedFrom(anchor, source.stateAt(body, jd).lon) - level) <= orbDeg;
}

/** Binary search: samples are produced in ascending `jd` order. */
function nearestSample(samples: Sample[], jd: number): Sample {
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.jd < jd) lo = mid + 1;
    else hi = mid;
  }
  const at = samples[lo]!;
  const before = samples[lo - 1];
  if (before && Math.abs(before.jd - jd) < Math.abs(at.jd - jd)) return before;
  return at;
}

interface PendingCycle {
  body: TransitingBody;
  target: string;
  aspect: AspectType;
  branch: OrientedBranch;
  winding: number;
  orbDeg: number;
  passes: Root[];
  startJd: number;
  endJd: number;
}

function finalizeCycle(
  identityInputs: CycleIdentityInputs,
  pending: PendingCycle,
): NormalizedCycle {
  const id = cycleIdFromIdentity(
    buildCycleIdentity(
      identityInputs,
      pending.body,
      pending.target,
      pending.aspect,
      pending.branch,
      pending.winding,
    ),
  );

  const passes: CyclePass[] = pending.passes.map((root, index) => ({
    pass_index: index + 1,
    direction: passDirection(root),
    exact_at: jdToIso(root.jd),
    // Zero only at a station-on-target tangent, which is exactly what the
    // contract says the value means.
    speed_deg_per_day: root.stationDirection ? 0 : roundSpeed(root.speed),
  }));

  return {
    id,
    technique: "transit",
    body: pending.body,
    target: pending.target,
    aspect: pending.aspect,
    start_at: jdToIso(pending.startJd),
    exact_at: passes[0]!.exact_at,
    end_at: jdToIso(pending.endJd),
    pass_count: passes.length,
    passes,
    orb_deg: pending.orbDeg,
  };
}

function passDirection(root: Root): PassDirection {
  if (root.stationDirection) return root.stationDirection;
  return root.speed < 0 ? "retrograde" : "direct";
}

/**
 * Six decimals is well inside the ephemeris's own accuracy and keeps two
 * identical scans byte-identical: an unrounded double carries bisection noise
 * in its last bits, which would change a downstream content hash for the same
 * sky. A non-zero speed never rounds to zero, because zero is reserved for the
 * tangent case above.
 */
function roundSpeed(speed: number): number {
  const rounded = Number(speed.toFixed(6));
  if (rounded === 0 && speed !== 0) return speed > 0 ? 1e-6 : -1e-6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

/**
 * The `POST /v1/cycles` body handler.
 *
 * Every engine-level refusal returns the discriminated `ok: false` envelope
 * with a payload-free message. Upstream Swiss Ephemeris text has leaked
 * absolute filesystem paths, so an engine message is logged and replaced, never
 * echoed. Only the transport-level failures — unparseable JSON, bad
 * credentials, missing configuration — become an HTTP status, because those
 * never reached the engine.
 */
export function handleCycleScan(
  body: unknown,
  options: ScanOptions & { requestIdFallback?: string } = {},
): CycleResponse {
  const fallbackId = options.requestIdFallback ?? "req_unknown_0";
  let validated: ValidatedRequest;
  try {
    validated = validateCycleRequest(body);
  } catch (err) {
    if (err instanceof CycleRequestError) {
      return failure(readRequestId(body) ?? fallbackId, err.errorClass, err.message);
    }
    throw err;
  }

  try {
    return {
      ok: true,
      schema_version: M3_SCHEMA_VERSION,
      request_id: validated.request.request_id,
      chart_fingerprint: validated.request.chart_fingerprint,
      cycle_policy_id: validated.request.cycle_policy_id,
      cycle_policy_version: validated.request.cycle_policy_version,
      orb_policy_id: validated.request.orb_policy_id,
      orb_policy_version: validated.request.orb_policy_version,
      contract_id: validated.request.contract_id,
      contract_version: validated.request.contract_version,
      container_digest: options.containerDigest ?? STUB_CONTAINER_DIGEST,
      ephemeris_data_version: options.ephemerisDataVersion ?? EPHEMERIS_DATA_VERSION,
      cycles: scanCycles(validated, options),
    };
  } catch (err) {
    if (err instanceof CycleWindowIncompleteError) {
      return failure(validated.request.request_id, "cycle_window_incomplete", err.message);
    }
    if (err instanceof CycleRequestError) {
      return failure(validated.request.request_id, err.errorClass, err.message);
    }
    if (err instanceof UnsupportedBodyError) {
      return failure(
        validated.request.request_id,
        "unsupported_body",
        "a requested body is not supported by this engine",
      );
    }
    console.error("cycle_scan_failed", {
      request_id: validated.request.request_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return failure(
      validated.request.request_id,
      "calculation_failed",
      "the calculation engine could not complete this scan",
    );
  }
}

function readRequestId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const id = (body as Record<string, unknown>).request_id;
  return typeof id === "string" && OPAQUE_ID_RE.test(id) ? id : null;
}

/**
 * Truncate to `max` Unicode code points without splitting one.
 *
 * `String.prototype.slice` indexes UTF-16 code units, so cutting at 300 can land
 * between a surrogate pair and leave a lone surrogate. That is not cosmetic:
 * `jcsCanonicalize` rejects a lone surrogate outright rather than replacing it,
 * so a truncated message could make a downstream canonicalization throw. JSON
 * Schema counts `maxLength` in code points too, which is exactly what
 * `Array.from` iterates.
 */
function truncateCodePoints(value: string, max: number): string {
  const points = Array.from(value);
  return points.length <= max ? value : points.slice(0, max).join("");
}

function failure(
  requestId: string,
  errorClass: CycleErrorClass,
  message: string,
): CycleResponse {
  return {
    ok: false,
    schema_version: M3_SCHEMA_VERSION,
    request_id: requestId,
    error_class: errorClass,
    // The contract caps this at 300 code points and requires at least one;
    // truncate rather than let a long internal message decide whether the
    // response validates.
    error_message: truncateCodePoints(message || "cycle scan failed", 300),
  };
}
