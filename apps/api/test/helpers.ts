import { env, SELF } from "cloudflare:test";
import type { BirthProfileRequest } from "@patternlike/shared";
import { asCryptoSubject } from "../src/crypto.js";
import { buildUserKeyInsert, type UserIdentity } from "../src/db/users.js";

/**
 * Tables the API writes, in foreign-key-safe delete order. Storage is not
 * isolated per test in this pool version, so tests clear explicitly rather than
 * relying on rollback. A table missing from this list leaks rows between suites
 * and makes tests pass for the wrong reason.
 */
const TABLES = [
  "natal_features",
  "chart_snapshots",
  "birth_profiles",
  // Pointer before releases: content_release_pointer.active_version is a
  // foreign key into content_releases.
  "content_release_pointer",
  "content_releases",
  "audit_events",
  "sessions",
  "identities",
  "export_requests",
  "deletion_requests",
  "consents",
  "user_keys",
  "jobs",
  "users",
];

export async function resetDb(): Promise<void> {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  contentType: string | null;
  body: T;
}

export async function postBirthProfile(
  userId: string,
  idempotencyKey: string,
  body: Partial<BirthProfileRequest> | string,
): Promise<ApiResponse> {
  const res = await SELF.fetch("http://api.test/v1/birth-profiles", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
      "idempotency-key": idempotencyKey,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    body: (await res.json()) as Record<string, unknown>,
  };
}

export async function getChart(userId: string): Promise<ApiResponse> {
  const res = await SELF.fetch("http://api.test/v1/chart", {
    headers: { "x-user-id": userId },
  });
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    body: (await res.json()) as Record<string, unknown>,
  };
}

export async function rows<T = Record<string, unknown>>(
  sql: string,
  ...binds: unknown[]
): Promise<T[]> {
  const stmt = env.DB.prepare(sql);
  const result = await (binds.length ? stmt.bind(...binds) : stmt).all<T>();
  return result.results;
}

export const ALICE: Partial<BirthProfileRequest> = {
  accuracy: "exact",
  consent_id: "cns_alice_0001",
  birth_date: "1990-05-15",
  birth_time_local: "12:34:00",
  timezone_hint: "America/Los_Angeles",
  birthplace: { label: "Los Angeles", latitude: 34.05, longitude: -118.24 },
};

export const BOB: Partial<BirthProfileRequest> = {
  accuracy: "exact",
  consent_id: "cns_bob_0001",
  birth_date: "1985-11-02",
  birth_time_local: "03:15:00",
  timezone_hint: "America/New_York",
  birthplace: { label: "New York", latitude: 40.71, longitude: -74.01 },
};

export const USER_A = "usr_test_alice_00001";
export const USER_B = "usr_test_bob_000001";
/** A third party, used to prove per-user isolation in the rotation tests. */
export const USER_OTHER = "usr_test_other_00001";

export const SUBJECT_A = asCryptoSubject("cs_test_alice_00001");
export const SUBJECT_B = asCryptoSubject("cs_test_bob_000001");
export const SUBJECT_OTHER = asCryptoSubject("cs_test_other_00001");

export const IDENTITY_A: UserIdentity = { userId: USER_A, cryptoSubject: SUBJECT_A };
export const IDENTITY_B: UserIdentity = { userId: USER_B, cryptoSubject: SUBJECT_B };
export const IDENTITY_OTHER: UserIdentity = {
  userId: USER_OTHER,
  cryptoSubject: SUBJECT_OTHER,
};

/**
 * Create a user the way identity linking does — row plus key, one batch — so
 * integration tests exercise the same shape production does. Not idempotent:
 * seed in exactly one place per suite or the users.id PRIMARY KEY collides.
 */
export async function seedUser(id: UserIdentity): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, crypto_subject, status, locale, timezone,
                          entitlement_tier, created_at, updated_at)
       VALUES (?, ?, 'active', 'en-US', 'UTC', 'free', ?, ?)`,
    ).bind(id.userId, id.cryptoSubject, now, now),
    await buildUserKeyInsert(env, id),
  ]);
}
