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
