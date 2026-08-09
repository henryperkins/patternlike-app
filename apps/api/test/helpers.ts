import { env, SELF } from "cloudflare:test";
import {
  CALC_CONTRACT_ID,
  CALC_CONTRACT_VERSION,
  canonicalJson,
  type BirthProfileRequest,
  type BirthTimeAccuracy,
  type LongitudePosition,
} from "@patternlike/shared";
import { asCryptoSubject } from "../src/crypto.js";
import { buildUserKeyInsert, encryptPayload, type UserIdentity } from "../src/db/users.js";
import { activateRelease } from "../src/db/content-releases.js";
import type { ContentReleaseBundle } from "../src/services/content-release.js";
import { generateSigningKey, signedBundle, withoutFixtures } from "./content-release-fixtures.js";

/**
 * Tables the API writes, in foreign-key-safe delete order. Storage is not
 * isolated per test in this pool version, so tests clear explicitly rather than
 * relying on rollback. A table missing from this list leaks rows between suites
 * and makes tests pass for the wrong reason.
 */
const TABLES = [
  // M3, children first: reading_sources -> daily_readings -> jobs, and
  // cycle_passes -> cycle_instances -> chart_snapshots.
  "reading_sources",
  "reading_feedback",
  "daily_readings",
  "cycle_passes",
  "cycle_instances",
  "timezone_changes",
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
  // daily_readings.supersedes_reading_id self-references, so a bare DELETE can
  // hit a predecessor while its successor still points at it.
  //
  // Nulling the column first no longer works: 0002 added
  //   CHECK ((revision_reason = 'initial' AND revision = 1 AND supersedes IS NULL)
  //       OR (revision_reason != 'initial' AND revision > 1 AND supersedes IS NOT NULL))
  // so clearing the predecessor of a revision > 1 violates the constraint. The
  // chain is unwound leaf-first instead: repeatedly delete the rows nothing
  // supersedes. Bounded because a user-day's revision chain is short.
  await env.DB.prepare("DELETE FROM reading_sources").run();
  await env.DB.prepare("DELETE FROM reading_feedback").run();
  for (let pass = 0; pass < 16; pass++) {
    const { meta } = await env.DB.prepare(
      `DELETE FROM daily_readings
       WHERE id NOT IN (
         SELECT supersedes_reading_id FROM daily_readings
         WHERE supersedes_reading_id IS NOT NULL
       )`,
    ).run();
    if (!meta.changes) break;
  }

  await env.DB.batch([
    // A reading points at the job that generated it, so the link is broken
    // before jobs are deleted. Ordinarily a no-op by now.
    env.DB.prepare("UPDATE daily_readings SET active_generation_job_id = NULL"),
    ...TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  ]);
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

/**
 * Give a user a confirmed scheduling zone and locale.
 *
 * Generation is withheld while either source reads `default_unconfirmed`, so a
 * test that forgets this gets a correct refusal rather than a reading — which is
 * the behaviour, not a bug in the fixture.
 */
export async function confirmPreferences(
  userId: string,
  timezone = "America/Chicago",
  locale = "en-US",
): Promise<void> {
  const now = new Date().toISOString();
  // Idempotent: this sets the preference rather than appending a change, so a
  // test may call it twice to simulate a user moving zones without colliding on
  // timezone_changes' UNIQUE (user_id, revision).
  await env.DB.batch([
    env.DB.prepare("DELETE FROM timezone_changes WHERE user_id = ?").bind(userId),
    env.DB.prepare(
      `UPDATE users
       SET timezone = ?, timezone_source = 'user_confirmed', timezone_revision = 1,
           timezone_updated_at = ?, locale = ?, locale_source = 'user_confirmed',
           locale_updated_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(timezone, now, locale, now, now, userId),
    env.DB.prepare(
      `INSERT INTO timezone_changes
         (id, user_id, previous_zone, next_zone, source, revision, changed_at)
       VALUES (?, ?, 'UTC', ?, 'user_confirmed', 1, ?)`,
    ).bind(`tzc_seed_${userId}`, userId, timezone, now),
  ]);
}

/**
 * Sign the M3 contract bundle, store it where the loader looks, and activate it.
 *
 * Bypasses `POST /internal/content-releases` because generation tests care that
 * an active release exists, not how it got there — and going through ingestion
 * would couple every generation assertion to the release surface's own
 * failure modes.
 */
export async function seedActiveRelease(
  version = "release-12",
  mutate: (bundle: ContentReleaseBundle) => void = () => {},
): Promise<{ version: string; bundleHash: string }> {
  const key = await generateSigningKey("wp-release-key-1");
  const bundle = await signedBundle(key, (draft) => {
    draft.release.version = version;
    withoutFixtures(draft);
    mutate(draft);
  });

  // Canonical form, not the draft's key order: the loader re-hashes the stored
  // bytes, and the route stores exactly this.
  await env.ARTIFACTS!.put(`content-releases/${version}.json`, canonicalJson(bundle), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { release_version: version, bundle_hash: bundle.release.bundle_hash },
  });

  await activateRelease(
    env,
    {
      version,
      bundleHash: bundle.release.bundle_hash,
      r2Uri: `r2://artifacts/content-releases/${version}.json`,
      approverId: bundle.release.approver_id,
      lastAuthorId: bundle.release.last_author_id,
      changelog: bundle.release.changelog,
      calcContractId: bundle.release.calc_contract_id ?? null,
    },
    {
      action: "content_release.activated",
      resourceId: version,
      result: "success",
      detailClass: "seeded",
      actorId: key.keyId,
    },
  );

  return { version, bundleHash: bundle.release.bundle_hash };
}

const DEFAULT_POSITIONS: LongitudePosition[] = [
  { body: "sun", longitude_deg: 54.703, speed_longitude_deg_per_day: 0.963, retrograde: false },
  { body: "moon", longitude_deg: 128.44, speed_longitude_deg_per_day: 13.2, retrograde: false },
  { body: "saturn", longitude_deg: 324.61, speed_longitude_deg_per_day: 0.033, retrograde: false },
  { body: "mars", longitude_deg: 8.12, speed_longitude_deg_per_day: 0.61, retrograde: false },
];

export interface SeedChartOptions {
  chartId?: string;
  /** Set one of the CYCLE_FP_* sentinels to steer the mock cycle scan. */
  fingerprint?: string;
  accuracy?: BirthTimeAccuracy;
  profileVersion?: number;
  positions?: LongitudePosition[];
  suppressedFeatures?: Array<{ feature_class: string; feature_id?: string; reason: string }>;
}

/**
 * Seed an active chart directly, bypassing the calculation round trip.
 *
 * `POST /v1/birth-profiles` cannot be used where the fingerprint matters,
 * because it is derived from the birth inputs — and the cycle-scan sentinels are
 * fingerprints. The birth payload is really encrypted, with the same AAD
 * position the route uses, so key-rotation coverage stays honest.
 */
export async function seedChart(
  id: UserIdentity,
  options: SeedChartOptions = {},
): Promise<{ chartId: string; fingerprint: string; profileVersion: number }> {
  const now = new Date().toISOString();
  const chartId = options.chartId ?? `cht_seed_${id.userId.slice(-8)}`;
  const fingerprint = options.fingerprint ?? `sha256:${"1a".repeat(32)}`;
  const accuracy = options.accuracy ?? "exact";
  const profileVersion = options.profileVersion ?? 1;
  const suppressed = options.suppressedFeatures ?? [];

  const uncertainty = {
    accuracy,
    window: null,
    suppressed_features: suppressed,
    qualified_features: [],
    user_facing_summary: null,
  };

  const birth = {
    utc_instant: "1990-05-15T19:34:00.000Z",
    place_label: "Los Angeles",
    latitude: 34.05,
    longitude: -118.24,
  };
  // Two ciphertexts, not one reused. Every payload's AAD binds
  // (subject, table.column, recordId, key_version), and the two columns differ
  // in both the field and the record id — birth_profiles is keyed by `version`
  // and chart_snapshots by `id`. Sharing a blob would produce a fixture that
  // reads fine until DEK rotation tries to decrypt it in the position it claims
  // to occupy, which is exactly the failure the AAD exists to cause.
  const profileEnc = await encryptPayload(env, id, birth, {
    subject: id.cryptoSubject,
    field: "birth_profiles.payload_enc",
    recordId: String(profileVersion),
  });
  const birthEnc = await encryptPayload(env, id, birth, {
    subject: id.cryptoSubject,
    field: "chart_snapshots.birth_enc",
    recordId: chartId,
  });

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO birth_profiles
         (user_id, version, accuracy, status, timezone, payload_enc,
          payload_key_version, payload_nonce, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'America/Los_Angeles', ?, ?, ?, ?, ?)`,
    ).bind(
      id.userId,
      profileVersion,
      accuracy,
      Uint8Array.from(atob(profileEnc.ciphertext), (ch) => ch.charCodeAt(0)),
      profileEnc.keyVersion,
      profileEnc.nonce,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO chart_snapshots (
         id, user_id, profile_version, fingerprint, contract_id, contract_version,
         container_digest, tzdb_version, status, calculated_at, snapshot_json,
         birth_accuracy, birth_enc, birth_key_version, birth_nonce,
         r2_uri, uncertainty_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, '2026a', 'active', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).bind(
      chartId,
      id.userId,
      profileVersion,
      fingerprint,
      CALC_CONTRACT_ID,
      CALC_CONTRACT_VERSION,
      `sha256:${"c".repeat(64)}`,
      now,
      JSON.stringify({
        positions: options.positions ?? DEFAULT_POSITIONS,
        houses: null,
        angles: null,
        aspects: [],
        patterns: [],
        uncertainty,
      }),
      accuracy,
      Uint8Array.from(atob(birthEnc.ciphertext), (ch) => ch.charCodeAt(0)),
      birthEnc.keyVersion,
      birthEnc.nonce,
      JSON.stringify(uncertainty),
      now,
    ),
  ]);

  return { chartId, fingerprint, profileVersion };
}
