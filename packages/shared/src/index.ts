/** Shared M0/M1 constants and helpers for Pattern-Like. */

export * from "./types.js";
export * from "./chart-types.js";

export const SCHEMA_VERSION = "0.2.0" as const;

export const CALC_CONTRACT_ID = "calc-contract-launch" as const;
export const CALC_CONTRACT_VERSION = "0.2.0" as const;

import type { AspectType, BirthTimeAccuracy, CelestialBody, WorkflowName } from "./types.js";

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
