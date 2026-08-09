/**
 * Wire types for `POST /v1/cycles` on the calculation service.
 *
 * These live in `@patternlike/shared` and not in `@patternlike/reading-engine`
 * for one reason: `apps/calc-stub` has to deserialize them, and reading-engine
 * is deliberately unreachable from the AGPL service. The widening is kept to
 * the wire shapes and the id preimage — ranking, eligibility, phase, and
 * editorial assembly stay in reading-engine.
 *
 * Normative definitions are `contracts/m3/cycle-request.schema.json`,
 * `contracts/m3/cycle-response.schema.json`, and
 * `contracts/m3/cycle-identity.schema.json`. Wire format is snake_case even
 * though TypeScript is camelCase; these interfaces are the wire, so they are
 * snake_case throughout.
 */

import type { AspectType, BirthTimeAccuracy, CelestialBody } from "./types.js";

/** The M3 contract package version. M0 documents remain at 0.2.0 and frozen. */
export const M3_SCHEMA_VERSION = "0.3.0" as const;
export type M3SchemaVersion = typeof M3_SCHEMA_VERSION;

/**
 * The scan policy the calculation service implements, and the only one it will
 * answer for: `POST /v1/cycles` refuses a request naming any other id or
 * version rather than quietly scanning under its own.
 *
 * These four strings live here rather than in `apps/calc-stub/src/cycle-policy.ts`
 * (which re-exports them) because the Worker has to put the exact values in a
 * request and freeze them into a generation command, and a second hand-copied
 * pair would turn a policy bump into a silent scan refusal on every reading.
 * Only the identifiers are shared — the orb tables, lookaround bounds, and
 * unwrapping epoch stay in the calculation service.
 *
 * `cycle_policy_version` must bump whenever the ephemeris or container, the
 * unwrapping epoch, the scan grid, the station and root tolerances, or the
 * complete-encounter lookaround can alter output. `cycle_instances.horizon_version`
 * records this same value, so a threshold change re-scans into a new vintage
 * instead of mixing vintages in one table.
 */
export const CYCLE_POLICY_ID = "transit-scan-launch" as const;
export const CYCLE_POLICY_VERSION = "1.4.0" as const;
export const TRANSIT_ORB_POLICY_ID = "orb-launch" as const;
export const TRANSIT_ORB_POLICY_VERSION = "1.0.0" as const;

/** Closed set emitted by the chart engine's `buildUncertainty()`. */
export type SuppressedFeatureClass =
  | "houses"
  | "angles"
  | "angle_transits"
  | "moon_time_sensitive";

/** Sign of Swiss longitudinal speed at an exact pass. */
export type PassDirection = "direct" | "retrograde";

/**
 * Which oriented target longitude an encounter crosses.
 *
 * `targets(N, A) = unique(norm360(N + A), norm360(N - A))`. Conjunction and
 * opposition collapse to one target (`single`); every aspect strictly between
 * 0° and 180° has two distinct branches.
 */
export type OrientedBranch = "single" | "plus" | "minus";

export type CycleErrorClass =
  | "invalid_request"
  | "unsupported_body"
  | "ephemeris_range"
  | "cycle_window_incomplete"
  | "calculation_failed";

/**
 * A natal longitude, and nothing else.
 *
 * Transit-to-natal contacts need no birth instant, timezone, or coordinate, so
 * the calculation service never acquires a decryption path and the "birth stays
 * encrypted at rest" invariant survives this surface untouched.
 */
export interface NatalPositionInput {
  body: CelestialBody;
  longitude_deg: number;
}

/**
 * A SELECTION interval, not permission to clip an encounter.
 *
 * A cycle is returned when its complete orb envelope intersects `[from, to)`;
 * the scanner then evaluates beyond both boundaries until the first entry,
 * every exact pass, and the final exit are known.
 */
export interface CycleScanWindow {
  from: string;
  to: string;
}

export interface CycleRequest {
  schema_version: M3SchemaVersion;
  request_id: string;
  chart_fingerprint: string;
  natal_positions: NatalPositionInput[];
  /** The EFFECTIVE accuracy the chart engine recomputed, not the caller's label. */
  natal_accuracy: BirthTimeAccuracy;
  suppressed_features?: SuppressedFeatureClass[];
  window: CycleScanWindow;
  techniques: ["transits"];
  cycle_policy_id: string;
  cycle_policy_version: string;
  orb_policy_id: string;
  orb_policy_version: string;
  contract_id: string;
  contract_version: string;
}

export interface CyclePass {
  /** 1-based and contiguous, in chronological order. */
  pass_index: number;
  direction: PassDirection;
  exact_at: string;
  /**
   * Signed Swiss longitudinal speed at the root. Zero only at a
   * station-on-target tangent, where the outgoing station direction supplies
   * the two-value `direction` field.
   */
  speed_deg_per_day: number;
}

export interface NormalizedCycle {
  id: string;
  technique: "transit";
  body: CelestialBody;
  /** A natal body id, or an angle id when angles are available. */
  target: string;
  aspect: AspectType;
  /** Earliest configured-orb entry before pass 1. A calculated root, never a sample. */
  start_at: string;
  /** Equals `passes[0].exact_at`. Stable and immutable across rescans. */
  exact_at: string;
  /** Latest configured-orb exit after the final pass. */
  end_at: string;
  /** Equals `passes.length`. Direct–retrograde–direct is one cycle, not three. */
  pass_count: number;
  passes: CyclePass[];
  /** The configured orb O this envelope was solved against. */
  orb_deg: number;
  importance_score?: number | null;
}

export interface CycleResponseSuccess {
  ok: true;
  schema_version: M3SchemaVersion;
  request_id: string;
  chart_fingerprint: string;
  cycle_policy_id: string;
  cycle_policy_version: string;
  orb_policy_id: string;
  orb_policy_version: string;
  contract_id: string;
  contract_version: string;
  container_digest: string;
  ephemeris_data_version: string;
  /** Ordered by `(exact_at, id)` with unique ids. Empty is an ordinary result. */
  cycles: NormalizedCycle[];
}

export interface CycleResponseFailure {
  ok: false;
  schema_version: M3SchemaVersion;
  request_id: string;
  error_class: CycleErrorClass;
  /**
   * Payload-free. Upstream Swiss Ephemeris messages have leaked absolute
   * filesystem paths, so nothing from the engine is echoed verbatim.
   */
  error_message: string;
}

export type CycleResponse = CycleResponseSuccess | CycleResponseFailure;

/**
 * The closed `cyc_` hash preimage.
 *
 * Private to the calculation service and the trusted plane: `oriented_branch`
 * and `winding` never appear on the wire, because they are what makes the id
 * reproducible rather than what a client needs. Pass timestamps are absent on
 * purpose — complete discovery may refine them, while the epoch-anchored
 * (branch, winding) pair names the same physical encounter across shifted scan
 * horizons. That is what lets two overlapping request windows return one
 * identical cycle instead of two.
 */
export interface CycleIdentityV1 {
  identity_profile: "patternlike.cycle-id.v1";
  chart_fingerprint: string;
  technique: "transit";
  /** The transiting body. */
  body: CelestialBody;
  /** The natal target: a celestial body id, or an angle id. */
  target: string;
  aspect: AspectType;
  oriented_branch: OrientedBranch;
  /**
   * Integer lift k for the unwrapped target `T = T0 + 360k`, measured from the
   * policy's fixed unwrapping epoch. A later full revolution crosses the next
   * winding and is a new cycle, so a body returning to the same aspect years
   * later does not collide with its earlier encounter.
   */
  winding: number;
  contract_id: string;
  contract_version: string;
  cycle_policy_id: string;
  cycle_policy_version: string;
  orb_policy_id: string;
  orb_policy_version: string;
  container_digest: string;
  ephemeris_data_version: string;
}

export class CycleIdentityError extends Error {
  readonly code = "cycle_identity_error";
  constructor(message: string) {
    super(message);
    this.name = "CycleIdentityError";
  }
}

/** `cyc_` + the first 32 lowercase hex characters of the SHA-256 digest. */
export function renderCycleId(fullDigestHex: string): string {
  if (!/^[a-f0-9]{64}$/.test(fullDigestHex)) {
    throw new CycleIdentityError(
      "cycle id must be rendered from a 64-character lowercase hex SHA-256 digest",
    );
  }
  return "cyc_" + fullDigestHex.slice(0, 32);
}

/** `cyp_` + the first 32 lowercase hex characters of the SHA-256 digest. */
export function renderCyclePassId(fullDigestHex: string): string {
  if (!/^[a-f0-9]{64}$/.test(fullDigestHex)) {
    throw new CycleIdentityError(
      "cycle pass id must be rendered from a 64-character lowercase hex SHA-256 digest",
    );
  }
  return "cyp_" + fullDigestHex.slice(0, 32);
}

/**
 * The closed `cyp_` hash preimage.
 *
 * Keyed on the parent `cyc_` rather than on `CycleIdentityV1`, and that is not a
 * shortcut. `oriented_branch` and `winding` never leave the calculation service,
 * so the trusted plane that persists a pass cannot rebuild the parent preimage —
 * and does not need to, because `cyc_` is already a collision-resistant function
 * of it, so `(cycle_id, pass_index)` inherits the parent's uniqueness.
 *
 * The pass timestamp is deliberately absent: refinement may move `exact_at` by
 * fractions of a second across rescans, while the index does not move.
 *
 * Normative definition: `contracts/m3/cycle-derivation.schema.json`.
 */
export interface CyclePassIdentityV1 {
  identity_profile: "patternlike.cycle-pass-id.v1";
  cycle_id: string;
  pass_index: number;
}

/**
 * The closed `cyclePin.cycle_hash` preimage: the normalized cycle exactly as
 * scanned, minus `importance_score`.
 *
 * That exclusion is the substantive decision. `importance_score` is optional and
 * advisory on the wire and cannot change assembly output, so including it would
 * fail a claimed job closed over a value that does not affect the reading.
 * Everything retained can change the envelope or the pass list, which is exactly
 * what a frozen command must refuse to have changed under it.
 */
export type CycleHashPreimageV1 = Omit<NormalizedCycle, "importance_score">;

export function buildCyclePassIdentity(
  cycleId: string,
  passIndex: number,
): CyclePassIdentityV1 {
  if (!cycleId.startsWith("cyc_")) {
    throw new CycleIdentityError(`not a cycle id: ${cycleId}`);
  }
  if (!Number.isInteger(passIndex) || passIndex < 1) {
    throw new CycleIdentityError(
      `pass_index must be a 1-based integer, received ${passIndex}`,
    );
  }
  return {
    identity_profile: "patternlike.cycle-pass-id.v1",
    cycle_id: cycleId,
    pass_index: passIndex,
  };
}

/**
 * Project a scanned cycle into its hash preimage.
 *
 * Fields are copied explicitly rather than spread-and-deleted so that a new
 * optional wire field cannot silently enter the hash and start failing claimed
 * jobs; adding one to the preimage has to be a decision.
 */
export function buildCycleHashPreimage(cycle: NormalizedCycle): CycleHashPreimageV1 {
  return {
    id: cycle.id,
    technique: cycle.technique,
    body: cycle.body,
    target: cycle.target,
    aspect: cycle.aspect,
    start_at: cycle.start_at,
    exact_at: cycle.exact_at,
    end_at: cycle.end_at,
    pass_count: cycle.pass_count,
    passes: cycle.passes.map((p) => ({
      pass_index: p.pass_index,
      direction: p.direction,
      exact_at: p.exact_at,
      speed_deg_per_day: p.speed_deg_per_day,
    })),
    orb_deg: cycle.orb_deg,
  };
}
