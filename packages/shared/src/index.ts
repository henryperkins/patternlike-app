/** Shared M0/M1 constants and helpers for Pattern-Like. */

export * from "./types.js";
export * from "./chart-types.js";
export * from "./cycle-types.js";
export * from "./daily-sky-types.js";
export * from "./m5-reading-types.js";
export * from "./m4-types.js";
export * from "./m7-types.js";
export * from "./jcs.js";
export * from "./timezone.js";

export const SCHEMA_VERSION = "0.2.0" as const;

export const CALC_CONTRACT_ID = "calc-contract-launch" as const;
export const CALC_CONTRACT_VERSION = "0.2.0" as const;

import type { AspectType, BirthTimeAccuracy, CelestialBody, WorkflowName } from "./types.js";
import type { ResolvedLocalTime } from "./timezone.js";
import type { NormalizedCycle } from "./cycle-types.js";
import {
  buildCycleHashPreimage,
  buildCyclePassIdentity,
  renderCyclePassId,
} from "./cycle-types.js";
import type { DailySkyFact, DailySkyFactCore } from "./daily-sky-types.js";
import { buildDailySkyFactIdentity, renderDailySkyFactId } from "./daily-sky-types.js";
import { jcsCanonicalize } from "./jcs.js";

export const LAUNCH_BODIES: readonly CelestialBody[] = [
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
] as const;

/**
 * Canonical order for the two bodies of an aspect: `LAUNCH_BODIES` rank, not
 * alphabetical.
 *
 * The frozen M4 contract settles this — `contracts/m4/fixtures/invalid/
 * natal-feature.aspect-noncanonical.json` is `{body_a: "moon", body_b: "sun"}`,
 * so a Sun–Moon aspect is canonically `sun` then `moon`. Alphabetical sorting
 * produces exactly that rejected shape, which is why this lives here as one
 * definition rather than as `[a, b].sort()` at each call site: the derivation
 * that writes features and the matcher that reads predicates have to agree with
 * the contract and with each other, and a second hand-rolled ordering is how
 * they stop agreeing.
 */
export function canonicalAspectPair<T extends CelestialBody>(a: T, b: T): [T, T] {
  const rank = (body: CelestialBody): number => {
    const index = LAUNCH_BODIES.indexOf(body);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return rank(a) <= rank(b) ? [a, b] : [b, a];
}

/** Whether an authored pair is already in canonical order. */
export function isCanonicalAspectPair(a: string, b: string): boolean {
  const rank = (body: string): number => {
    const index = (LAUNCH_BODIES as readonly string[]).indexOf(body);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return rank(a) < rank(b);
}

export const LAUNCH_ASPECTS: readonly AspectType[] = [
  "conjunction",
  "sextile",
  "square",
  "trine",
  "opposition",
] as const;

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    request_id?: string;
    details?: Record<string, unknown>;
  };
}

export interface WorkflowAccepted {
  schema_version: typeof SCHEMA_VERSION;
  workflow: WorkflowName;
  status: "queued" | "running" | "succeeded" | "duplicate";
  idempotency_key: string;
  job_id: string | null;
  resource_id: string | null;
}

export interface BirthProfileRequest {
  accuracy: BirthTimeAccuracy;
  consent_id: string;
  birth_date?: string;
  birth_time_local?: string | null;
  approximate_window_minutes?: number | null;
  birthplace?: {
    label?: string;
    place_id?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  timezone_hint?: string | null;
}

/**
 * Where the zone a chart is calculated in came from.
 *
 * `coordinates` is a lookup against timezone boundaries; `hint` is the value
 * the client supplied, used only when no coordinates were given; `default` is
 * the UTC fallback when there is neither.
 */
export type TimezoneSource = "coordinates" | "hint" | "default";

/**
 * How much the resolution can be relied on. Stored on `birth_profiles.
 * geocode_confidence` so a weak match can be qualified in the uncertainty
 * report instead of being presented as fact. `none` means nothing was
 * geocoded — the zone is whatever the client said.
 */
export type TimezoneConfidence = "high" | "medium" | "low" | "none";

export interface TimezoneQualifier {
  /** Stable machine class; safe for logs and audit `detail_class` values. */
  code:
    | "pre_1970_zone_boundary"
    | "near_zone_boundary"
    | "hint_replaced"
    | "no_coordinates"
    | "nautical_zone"
    | "local_time_ambiguous"
    | "local_time_nonexistent";
  message: string;
}

export interface TimezoneLookupRequest {
  latitude?: number | null;
  longitude?: number | null;
  birth_date?: string | null;
  birth_time_local?: string | null;
  timezone_hint?: string | null;
}

export interface TimezoneLookupResponse {
  schema_version: typeof SCHEMA_VERSION;
  timezone: string;
  source: TimezoneSource;
  confidence: TimezoneConfidence;
  /** True when a point roughly 11 km away resolves to a different zone. */
  boundary_nearby: boolean;
  /** The client's `timezone_hint`, when coordinates overruled it. */
  hint_overridden: string | null;
  /** First year tzdb guarantees this zone matches the location's clocks. */
  tzdb_stable_from_year: number;
  /** Null when no usable birth date was supplied. */
  local: ResolvedLocalTime | null;
  qualifiers: TimezoneQualifier[];
}

/** Opaque ids safe for app data plane (not LLM prompts). */
export function newId(prefix: string): string {
  const rand = cryptoRandom(16);
  return `${prefix}_${rand}`;
}

type SubtleCryptoLike = {
  digest: (
    algorithm: string,
    data: ArrayBufferView | ArrayBuffer,
  ) => Promise<ArrayBuffer>;
};

type CryptoLike = {
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
  subtle?: SubtleCryptoLike;
};

function webCrypto(): CryptoLike {
  const c = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  if (!c?.subtle) {
    throw new Error("Web Crypto API unavailable");
  }
  return c;
}

function cryptoRandom(bytes: number): string {
  const arr = new Uint8Array(bytes);
  const c = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  if (!c?.getRandomValues) {
    // These ids become primary keys and AEAD subjects. A Math.random fallback
    // would be predictable and is never an acceptable substitute here.
    throw new Error("Web Crypto getRandomValues unavailable; cannot mint an id");
  }
  c.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex for Workers / Node (Web Crypto). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await webCrypto().subtle!.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function contentHash(input: string): Promise<string> {
  return `sha256:${await sha256Hex(input)}`;
}

/**
 * `cyp_` for one pass of a scanned cycle.
 *
 * Async because SHA-256 is WebCrypto on both runtimes; the preimage builders in
 * cycle-types.ts stay pure and synchronous, matching how the reading engine
 * separates canonicalization from hashing.
 */
export async function cyclePassId(
  cycleId: string,
  passIndex: number,
): Promise<string> {
  const preimage = buildCyclePassIdentity(cycleId, passIndex);
  return renderCyclePassId(await sha256Hex(jcsCanonicalize(preimage)));
}

/**
 * The full 64-character digest stored in `generation-command.cyclePin.cycle_hash`.
 *
 * Unrendered on purpose: it names a scan result rather than a physical
 * encounter, so it gets no opaque prefix and no truncation — a rescan that
 * would change the envelope or the pass list has to fail the claimed job, and
 * that comparison deserves the whole digest.
 */
export async function cycleHash(cycle: NormalizedCycle): Promise<string> {
  return sha256Hex(jcsCanonicalize(buildCycleHashPreimage(cycle)));
}

/**
 * Seal a calculated daily-sky fact with its content-addressed identity.
 *
 * `fact_id` and `content_digest` are two views of one SHA-256 over the fact's
 * canonical preimage, so their agreement is checkable without recomputing the
 * preimage — which is what lets a contract fixture, a Worker replay, and the
 * calculation service each verify the pairing independently.
 */
export async function sealDailySkyFact(core: DailySkyFactCore): Promise<DailySkyFact> {
  const digest = await sha256Hex(jcsCanonicalize(buildDailySkyFactIdentity(core)));
  return { ...core, fact_id: renderDailySkyFactId(digest), content_digest: `sha256:${digest}` };
}

/** Canonical JSON for stable fingerprints (sorted object keys). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export function requireIdempotencyKey(
  header: string | null | undefined,
): string | null {
  if (!header || header.length < 8 || header.length > 256) return null;
  return header;
}
