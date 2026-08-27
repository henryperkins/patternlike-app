import { env, SELF } from "cloudflare:test";
import {
  CALC_CONTRACT_ID,
  CALC_CONTRACT_VERSION,
  canonicalJson,
  sha256Hex,
  type BirthProfileRequest,
  type BirthTimeAccuracy,
  type LongitudePosition,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import { asCryptoSubject } from "../src/crypto.js";
import { buildUserKeyInsert, encryptPayload, type UserIdentity } from "../src/db/users.js";
import { activateRelease } from "../src/db/content-releases.js";
import type { ContentReleaseBundle } from "../src/services/content-release.js";
import { generateSigningKey, signedBundle, withoutFixtures } from "./content-release-fixtures.js";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import { storeOntologyRelease } from "../src/db/pattern-ontology.js";
import { computeOntologyBundleHash } from "../src/services/pattern-ontology-verify.js";
import {
  OPENAI_READING_MODEL,
  READING_PROMPT_VERSION,
} from "../src/services/reading-publisher.js";

/**
 * The Codex posture every suite that enables Daily generation needs.
 *
 * One declaration rather than a copy per suite: these are the exact values
 * `resolvePublisherConfiguration` pins, and a suite carrying its own stale copy
 * would fail configuration for a reason unrelated to what it was testing.
 * `ARTIFACTS` is already bound by the test Wrangler config.
 */
export const CODEX_TEST_RUNNER_TOKEN =
  "runner_0123456789abcdefghijklmnopqrstuvwxyz";
export const CODEX_TEST_ARTIFACT_KEYRING = JSON.stringify({
  version: 1,
  keys: { "codex-test-key": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc" },
});

export const READING_CODEX_PUBLISHER_VARS = {
  READING_PUBLISHER: "codex",
  OPENAI_READING_MODEL,
  OPENAI_READING_REASONING: "high",
  OPENAI_READING_PROMPT_VERSION: READING_PROMPT_VERSION,
  OPENAI_READING_TIMEOUT_MS: "900000",
  OPENAI_READING_MAX_OUTPUT_TOKENS: "4000",
  READING_CONTEXT_MAX_BYTES: "98304",
  READING_PREGEN_ACTIVE_DAYS: "30",
  READING_PREGEN_LEAD_MINUTES: "30",
  READING_PREGEN_SPREAD_MINUTES: "45",
  READING_SCHEDULER_BATCH_LIMIT: "100",
  READING_DAILY_PROVIDER_CALL_LIMIT: "250",
  CODEX_RUNNER_TOKEN: CODEX_TEST_RUNNER_TOKEN,
  CODEX_PROVIDER_ARTIFACT_KEYRING: CODEX_TEST_ARTIFACT_KEYRING,
} as const;

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
  // 0003. Not user-scoped, so it is not caught by any per-user cleanup: a
  // leaked row makes the next suite's first provider call look like the
  // hundredth.
  "reading_provider_daily_usage",
  "cycle_passes",
  "cycle_instances",
  "cycle_scan_receipts",
  "time_travel_daily_usage",
  "timezone_changes",
  "natal_feature_sets",
  "natal_features",
  "codex_provider_response_uploads",
  "codex_provider_jobs",
  "pattern_generation_artifacts",
  "pattern_generation_artifact_keys",
  "pattern_documents",
  "pattern_generation_jobs",
  "pattern_generation_claims",
  "pattern_admin_access_events",
  "pattern_erasure_replay_events",
  // 0012 control plane, children first. Its production no-delete triggers are
  // suspended only around the test reset batch and restored immediately.
  "pattern_ontology_pipeline_artifacts",
  "pattern_ontology_pipeline_evidence",
  "pattern_ontology_pipeline_runs",
  "pattern_source_corpus_releases",
  "pattern_ontology_evaluation_runs",
  "pattern_ontology_recall_events",
  "pattern_ontology_pointer",
  "pattern_ontology_releases",
  "pattern_provider_daily_usage",
  "pattern_ontology_provider_daily_usage",
  // 0016 owner-scoped operational state. All three point directly at users,
  // so they must be cleared before the user fixture is removed.
  "birth_calc_reservations",
  "birth_calc_daily_usage",
  "birth_profile_version_counters",
  "chart_snapshots",
  "birth_profiles",
  "context_signals",
  "context_source_permissions",
  "device_tokens",
  "connector_accounts",
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

const ONTOLOGY_PIPELINE_NO_DELETE_TRIGGERS = [
  {
    name: "pattern_ontology_pipeline_evidence_no_delete",
    create: `CREATE TRIGGER pattern_ontology_pipeline_evidence_no_delete
      BEFORE DELETE ON pattern_ontology_pipeline_evidence
      FOR EACH ROW
      WHEN OLD.evidence_status = 'committed'
      BEGIN
        SELECT RAISE(ABORT, 'committed ontology pipeline evidence cannot be deleted');
      END`,
  },
  {
    name: "pattern_ontology_pipeline_artifacts_no_delete",
    create: `CREATE TRIGGER pattern_ontology_pipeline_artifacts_no_delete
      BEFORE DELETE ON pattern_ontology_pipeline_artifacts
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'ontology pipeline artifact tombstone cannot be deleted');
      END`,
  },
  {
    name: "pattern_ontology_pipeline_runs_no_delete",
    create: `CREATE TRIGGER pattern_ontology_pipeline_runs_no_delete
      BEFORE DELETE ON pattern_ontology_pipeline_runs
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'ontology pipeline run cannot be deleted');
      END`,
  },
  {
    name: "pattern_source_corpus_releases_no_delete",
    create: `CREATE TRIGGER pattern_source_corpus_releases_no_delete
      BEFORE DELETE ON pattern_source_corpus_releases
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'registered ontology source corpus cannot be deleted');
      END`,
  },
] as const;

export async function resetDb(): Promise<void> {
  await env.DB.prepare("DROP TRIGGER IF EXISTS fail_pattern_correction_reconcile").run();
  await env.DB.prepare("DROP TRIGGER IF EXISTS fail_machine_ontology_evaluation_receipt").run();
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

  await env.DB.batch(
    ONTOLOGY_PIPELINE_NO_DELETE_TRIGGERS.map(({ name }) =>
      env.DB.prepare(`DROP TRIGGER IF EXISTS ${name}`)
    ),
  );
  try {
    await env.DB.batch([
      // A reading points at the job that generated it, so the link is broken
      // before jobs are deleted. Ordinarily a no-op by now.
      env.DB.prepare("UPDATE daily_readings SET active_generation_job_id = NULL"),
      ...TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    ]);
  } finally {
    await env.DB.batch(
      ONTOLOGY_PIPELINE_NO_DELETE_TRIGGERS.map(({ create }) =>
        env.DB.prepare(create)
      ),
    );
  }

  // Export artifacts share ARTIFACTS with immutable editorial releases. Keep
  // cleanup prefix-scoped and paginate so a suite can never erase the release
  // fixtures another suite intentionally installed.
  if (env.ARTIFACTS) {
    let cursor: string | undefined;
    do {
      const page = await env.ARTIFACTS.list({ prefix: "exports/", cursor });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) await env.ARTIFACTS.delete(keys);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    cursor = undefined;
    do {
      const page = await env.ARTIFACTS.list({ prefix: "pattern-generations/", cursor });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) await env.ARTIFACTS.delete(keys);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    cursor = undefined;
    do {
      const page = await env.ARTIFACTS.list({ prefix: "pattern-ontology/", cursor });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) await env.ARTIFACTS.delete(keys);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    cursor = undefined;
    do {
      const page = await env.ARTIFACTS.list({
        prefix: "codex-provider-jobs/",
        cursor,
      });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) await env.ARTIFACTS.delete(keys);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    cursor = undefined;
    do {
      const page = await env.ARTIFACTS.list({
        prefix: "pattern-ontology-corpora/",
        cursor,
      });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) await env.ARTIFACTS.delete(keys);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  if (env.PATTERN_REPLAY_LEDGER) {
    let cursor: string | undefined;
    do {
      const page = await env.PATTERN_REPLAY_LEDGER.list({
        prefix: "pattern-erasure-replay/",
        cursor,
      });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) await env.PATTERN_REPLAY_LEDGER.delete(keys);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  await env.DB.prepare(
    `INSERT INTO pattern_ontology_pointer (id, active_version, updated_at)
     VALUES (1, NULL, '1970-01-01T00:00:00Z')`,
  ).run();
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
  const legacyProfile = {
    birth_date: "1990-05-15",
    birth_time_local: "12:34:00",
    birthplace: {
      label: "Los Angeles",
      latitude: 34.05,
      longitude: -118.24,
    },
    approximate_window_minutes: null,
    consent_id: "cns_seed_birth_profile_0001",
  };
  // Two ciphertexts, not one reused. Every payload's AAD binds
  // (subject, table.column, recordId, key_version), and the two columns differ
  // in both the field and the record id — birth_profiles is keyed by `version`
  // and chart_snapshots by `id`. Sharing a blob would produce a fixture that
  // reads fine until DEK rotation tries to decrypt it in the position it claims
  // to occupy, which is exactly the failure the AAD exists to cause.
  const profileEnc = await encryptPayload(env, id, legacyProfile, {
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

export interface SeedTimingReceiptOptions {
  id: string;
  userId: string;
  localDate: string;
  releaseVersion: string;
  status?: "pending" | "failed" | "superseded";
  revision?: number;
  revisionReason?: "initial" | "defect_repair";
  supersedesReadingId?: string | null;
  createdAt: string;
}

/** Insert a clear, non-published scan receipt for Timing read-model tests. */
export async function seedTimingReceipt(
  options: SeedTimingReceiptOptions,
): Promise<void> {
  const revision = options.revision ?? 1;
  const revisionReason =
    options.revisionReason ?? (revision === 1 ? "initial" : undefined);
  const supersedesReadingId = options.supersedesReadingId ?? null;

  if (revision === 1) {
    if (revisionReason !== "initial" || supersedesReadingId !== null) {
      throw new Error("revision 1 Timing receipts must be initial without a predecessor");
    }
  } else if (
    revisionReason === undefined ||
    revisionReason === "initial" ||
    !supersedesReadingId
  ) {
    throw new Error("later Timing receipts require a non-initial reason and predecessor");
  }

  await env.DB.prepare(
    `INSERT INTO daily_readings
       (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
        contract_id, assembly_mode, status, revision, revision_reason,
        supersedes_reading_id, command_generation, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'deterministic', ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(
      options.id,
      options.userId,
      options.localDate,
      options.releaseVersion,
      `user:${options.userId}:${options.localDate}:${options.releaseVersion}:r${revision}:${options.id}`,
      `sha256:${"1a".repeat(32)}`,
      CALC_CONTRACT_ID,
      options.status ?? "pending",
      revision,
      revisionReason,
      supersedesReadingId,
      options.createdAt,
      options.createdAt,
    )
    .run();
}

/**
 * Demote an ontology's pipeline evidence so it reads as a pre-evidence legacy
 * release, without unwinding a Pattern already generated from it.
 *
 * A release can no longer be activated without committed evidence, so a fixture
 * that needs the legacy shape AND a Pattern based on it has to reach that state
 * in this order. Committed evidence is immutable and undeletable in production;
 * this suspends exactly those two triggers and restores them.
 */
export async function stripOntologyPipelineEvidence(version: string): Promise<void> {
  await env.DB.prepare(
    "DROP TRIGGER IF EXISTS pattern_ontology_pipeline_evidence_no_delete",
  ).run();
  try {
    await env.DB.prepare(
      "DELETE FROM pattern_ontology_pipeline_evidence WHERE ontology_version = ?",
    ).bind(version).run();
  } finally {
    const trigger = ONTOLOGY_PIPELINE_NO_DELETE_TRIGGERS.find(
      (candidate) => candidate.name === "pattern_ontology_pipeline_evidence_no_delete",
    )!;
    await env.DB.prepare(trigger.create).run();
  }
}

export interface SeedOntologyOptions {
  /**
   * `public` writes the whole machine-pipeline evidence chain, so
   * `ONTOLOGY_ACTIVATION_SCOPE_SQL` re-derives `public` on every read. This is
   * the default because it is the only scope a reader-serving deployment can
   * generate from: an internal release is not a fixture most suites want.
   */
  activationScope?: "internal" | "public";
}

/** 64 lower-case hex characters, stable per seed. */
async function testDigest(seed: string): Promise<string> {
  return `sha256:${await sha256Hex(seed)}`;
}

/**
 * Activate the ontology used by Pattern generation tests.
 *
 * The public path writes the evidence the activation-scope SQL actually reads —
 * a corpus release, a pipeline run, the regression artifact row, the committed
 * evidence receipt, and the atomic evaluation receipt whose summary must agree
 * with all of it — rather than a flag. A fixture that skipped any one of them
 * would activate an ontology production would refuse.
 */
export async function seedActiveOntology(
  version = "ont-test-1",
  options: SeedOntologyOptions = {},
): Promise<void> {
  if ((options.activationScope ?? "public") === "internal") {
    const internal = syntheticOntologyRelease(version);
    const internalHash = await computeOntologyBundleHash(internal);
    await storeOntologyRelease(
      env,
      { ...internal, bundle_hash: internalHash },
      `pattern-ontology/${version}.json`,
    );
    return;
  }

  const runId = `oprun_${version}`;
  const corpusReleaseId = `corpus-${version}`;
  const signingKeyId = "ontology-test-signing-key";
  const evaluationReportHash = await testDigest(`evaluation:${version}`);
  const regressionReportHash = await testDigest(`regression:${version}`);
  const evaluationEnvelopeHash = await testDigest(`evaluation-envelope:${version}`);
  const evaluationCiphertextHash = await testDigest(`evaluation-ciphertext:${version}`);
  const regressionEnvelopeHash = await testDigest(`regression-envelope:${version}`);
  const regressionCiphertextHash = await testDigest(`regression-ciphertext:${version}`);
  const evaluationArtifactObjectKey =
    `pattern-ontology/pipeline/${runId}/evaluation-report.enc`;
  const regressionArtifactObjectKey =
    `pattern-ontology/pipeline/${runId}/regression-report.enc`;
  const regressionStageGeneration = 5;
  const regressionStageAttempt = 0;

  const release = syntheticOntologyRelease(version) as PatternOntologyRelease & {
    provenance?: { origin: string };
  };
  release.provenance = { origin: "machine_pipeline" };
  release.status = "candidate";
  release.evaluation = {
    ...release.evaluation,
    evaluation_report_hash: evaluationReportHash,
    regression_report_hash: regressionReportHash,
  };
  const bundleHash = await computeOntologyBundleHash(release);
  const stored = { ...release, bundle_hash: bundleHash };
  await env.ARTIFACTS!.put(
    `pattern-ontology/${version}.json`,
    canonicalJson(stored),
    { httpMetadata: { contentType: "application/json" } },
  );

  const now = new Date();
  const nowIso = now.toISOString();
  const earlierIso = new Date(now.getTime() - 1_000).toISOString();
  const configuration = canonicalJson({ candidate_ontology_version: version });
  const evaluationSummary = {
    run_id: runId,
    ontology_version: version,
    activation_scope: "public",
    bundle_hash: bundleHash,
    corpus_release_id: corpusReleaseId,
    corpus_release_hash: release.corpus_release_hash,
    corpus_license_class: "licensed_excerpt",
    corpus_public_capable: 1,
    evaluation_report_hash: evaluationReportHash,
    evaluation_artifact_object_key: evaluationArtifactObjectKey,
    evaluation_artifact_envelope_hash: evaluationEnvelopeHash,
    evaluation_artifact_ciphertext_hash: evaluationCiphertextHash,
    regression_passed: 1,
    regression_report_hash: regressionReportHash,
    regression_artifact_object_key: regressionArtifactObjectKey,
    regression_artifact_envelope_hash: regressionEnvelopeHash,
    regression_artifact_ciphertext_hash: regressionCiphertextHash,
    regression_artifact_stage_generation: regressionStageGeneration,
    regression_artifact_stage_attempt: regressionStageAttempt,
    signing_key_id: signingKeyId,
    compiler_passed: 1,
    evaluator_passed: 1,
    unevaluated_fixture_count: 0,
  };

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE pattern_ontology_releases SET status = 'superseded' WHERE status = 'active'`,
    ),
    env.DB.prepare(
      `INSERT INTO pattern_source_corpus_releases (
         corpus_release_id, corpus_hash, locale, object_key, fragment_count,
         license_class, public_capable, created_at, registered_at
       ) VALUES (?, ?, ?, ?, 12, 'licensed_excerpt', 1, ?, ?)`,
    ).bind(
      corpusReleaseId,
      release.corpus_release_hash,
      release.locale,
      `pattern-corpus/${corpusReleaseId}.json`,
      earlierIso,
      earlierIso,
    ),
    // A run may only be inserted `reserved` at generation 0 and may only walk
    // its stages one at a time, so the fixture takes the same path the pipeline
    // does. The artifact row below is refused unless its owner is standing at
    // exactly `regressing` / generation 5 / attempt 0.
    env.DB.prepare(
      `INSERT INTO pattern_ontology_pipeline_runs (
         run_id, idempotency_key, corpus_release_id, corpus_hash,
         candidate_ontology_version, configuration_json, configuration_hash,
         stage, stage_generation, stage_cursor, stage_attempt, available_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', 0, 0, 0, ?, ?, ?)`,
    ).bind(
      runId,
      `seed-${runId}`,
      corpusReleaseId,
      release.corpus_release_hash,
      version,
      configuration,
      await testDigest(`configuration:${version}`),
      earlierIso,
      earlierIso,
      earlierIso,
    ),
    // One stage at a time, each carrying the hash the next stage's CHECK
    // requires. Skipping a stage or a hash is refused by the same constraints
    // the real pipeline runs under.
    env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'corpus_reading', stage_generation = 1, stage_cursor = 0,
           stage_attempt = 0, updated_at = ? WHERE run_id = ?`,
    ).bind(earlierIso, runId),
    env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'generating', stage_generation = 2, stage_cursor = 0,
           stage_attempt = 0, updated_at = ? WHERE run_id = ?`,
    ).bind(earlierIso, runId),
    env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'compiling', stage_generation = 3, stage_cursor = 0,
           stage_attempt = 0, candidate_hash = ?, updated_at = ? WHERE run_id = ?`,
    ).bind(await testDigest(`candidate:${version}`), earlierIso, runId),
    env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'evaluating', stage_generation = 4, stage_cursor = 0,
           stage_attempt = 0, compilation_report_hash = ?, updated_at = ?
       WHERE run_id = ?`,
    ).bind(await testDigest(`compilation:${version}`), earlierIso, runId),
    env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'regressing', stage_generation = 5, stage_cursor = 0,
           stage_attempt = 0, evaluation_report_hash = ?, updated_at = ?
       WHERE run_id = ?`,
    ).bind(evaluationReportHash, earlierIso, runId),
    env.DB.prepare(
      `INSERT INTO pattern_ontology_pipeline_artifacts (
         id, run_id, stage, stage_generation, stage_attempt, artifact_class,
         object_key, plaintext_sha256, envelope_sha256, ciphertext_sha256,
         envelope_key_id, envelope_nonce, byte_length, created_at,
         expires_at, deleted_at
       ) VALUES (?, ?, 'regressing', ?, ?, 'regression_report', ?, ?, ?, ?,
         'codex-test-key', ?, 1024, ?, NULL, NULL)`,
    ).bind(
      `opart_regression_${version}`,
      runId,
      regressionStageGeneration,
      regressionStageAttempt,
      regressionArtifactObjectKey,
      regressionReportHash,
      regressionEnvelopeHash,
      regressionCiphertextHash,
      `nonce-regression-${version}-000000`,
      earlierIso,
    ),
    env.DB.prepare(
      `INSERT INTO pattern_ontology_releases (
         version, bundle_hash, corpus_release_hash, locale, status, object_key,
         evaluation_json, created_at, recalled_at
       ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
    ).bind(
      version,
      bundleHash,
      release.corpus_release_hash,
      release.locale,
      `pattern-ontology/${version}.json`,
      JSON.stringify({
        evaluation_report_hash: evaluationReportHash,
        regression_passed: 1,
        regression_report_hash: regressionReportHash,
        compiler_passed: 1,
        evaluator_passed: 1,
        unevaluated_fixture_count: 0,
      }),
      nowIso,
    ),
    env.DB.prepare(
      `INSERT INTO pattern_ontology_pipeline_evidence (
         run_id, ontology_version, corpus_release_id, corpus_release_hash,
         corpus_license_class, corpus_public_capable, activation_scope,
         bundle_hash, evaluation_report_hash, evaluation_artifact_object_key,
         evaluation_artifact_envelope_hash, evaluation_artifact_ciphertext_hash,
         evaluation_artifact_status, signing_key_id, run_status, evidence_status,
         compiler_passed, evaluator_passed, unevaluated_fixture_count,
         regression_report_hash, regression_artifact_object_key,
         regression_artifact_envelope_hash, regression_artifact_ciphertext_hash,
         regression_artifact_stage_generation, regression_artifact_stage_attempt,
         created_at, committed_at
       ) VALUES (?, ?, ?, ?, 'licensed_excerpt', 1, 'public', ?, ?, ?, ?, ?,
         'committed', ?, 'succeeded', 'committed', 1, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      runId,
      version,
      corpusReleaseId,
      release.corpus_release_hash,
      bundleHash,
      evaluationReportHash,
      evaluationArtifactObjectKey,
      evaluationEnvelopeHash,
      evaluationCiphertextHash,
      signingKeyId,
      regressionReportHash,
      regressionArtifactObjectKey,
      regressionEnvelopeHash,
      regressionCiphertextHash,
      regressionStageGeneration,
      regressionStageAttempt,
      earlierIso,
      nowIso,
    ),
    env.DB.prepare(
      `INSERT INTO pattern_ontology_evaluation_runs (id, ontology_version, verdict, summary_json, created_at)
       VALUES (?, ?, 'pass', ?, ?)`,
    ).bind(
      `poer_${version}`,
      version,
      JSON.stringify(evaluationSummary),
      nowIso,
    ),
    env.DB.prepare(
      `UPDATE pattern_ontology_pointer SET active_version = ?, updated_at = ? WHERE id = 1`,
    ).bind(version, nowIso),
  ]);
}

/**
 * Configure a runnable Pattern publisher on the in-isolate binding.
 *
 * There is no rollout or allowlist to turn on any more: every authenticated
 * account is in the generated flow, and what this helper supplies is the
 * deployment's provider configuration. Callers must restore the hermetic
 * defaults afterwards — env mutations persist across tests in this pool.
 */
export function enablePatternAi(): void {
  env.PATTERN_PUBLISHER = "synthetic";
  env.PATTERN_DAILY_PROVIDER_CALL_LIMIT = "100";
  env.PATTERN_ARTIFACT_RETENTION_DAYS = "30";
}

/**
 * The same rollout, pinned to the live OpenAI publisher.
 *
 * Every pin `resolvePatternPublisherConfiguration` requires for the `openai`
 * name has to be set explicitly: the hermetic baseline leaves all of them empty
 * on purpose, so no suite reaches a provider by forgetting something.
 * `mockCalcService` intercepts the request, so this exercises the adapter
 * without leaving the isolate.
 */
export function enablePatternOpenAi(): void {
  enablePatternAi();
  env.PATTERN_PUBLISHER = "openai";
  env.OPENAI_CREDENTIAL_SOURCE = "worker";
  env.OPENAI_API_KEY = "sk-test-pattern";
  env.OPENAI_PATTERN_PLANNER_MODEL = "gpt-5.6-sol";
  env.OPENAI_PATTERN_PLANNER_PROMPT_VERSION = "1.0.1";
  env.OPENAI_PATTERN_WRITER_MODEL = "gpt-5.6-sol";
  env.OPENAI_PATTERN_WRITER_PROMPT_VERSION = "1.0.1";
  env.OPENAI_PATTERN_VERIFIER_MODEL = "gpt-5.6-sol";
  env.OPENAI_PATTERN_VERIFIER_PROMPT_VERSION = "1.0.0-verifier";
}

export function enablePatternCodex(): void {
  enablePatternAi();
  env.PATTERN_PUBLISHER = "codex";
  env.CODEX_RUNNER_TOKEN = "runner_0123456789abcdefghijklmnopqrstuvwxyz";
  env.CODEX_PROVIDER_ARTIFACT_KEYRING = JSON.stringify({
    version: 1,
    keys: {
      "codex-test-key": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
    },
  });
  env.OPENAI_PATTERN_PLANNER_MODEL = "gpt-5.6-sol";
  env.OPENAI_PATTERN_PLANNER_PROMPT_VERSION = "1.0.1";
  env.OPENAI_PATTERN_PLANNER_TIMEOUT_MS = "900000";
  env.OPENAI_PATTERN_WRITER_MODEL = "gpt-5.6-sol";
  env.OPENAI_PATTERN_WRITER_PROMPT_VERSION = "1.0.1";
  env.OPENAI_PATTERN_WRITER_TIMEOUT_MS = "900000";
  env.OPENAI_PATTERN_VERIFIER_MODEL = "gpt-5.6-sol";
  env.OPENAI_PATTERN_VERIFIER_PROMPT_VERSION = "1.0.0-verifier";
  env.OPENAI_PATTERN_VERIFIER_TIMEOUT_MS = "900000";
}

/**
 * Turn on Codex Daily generation on the in-isolate binding.
 *
 * Needed by any suite that drives the Worker through `SELF.fetch` or `queue()`:
 * those read the real binding rather than a per-call env object, and the
 * hermetic baseline deliberately leaves every publisher value empty. Callers
 * must restore the baseline with `disableReadingCodex` — env mutations persist
 * across tests in this pool.
 */
/**
 * A `READING_QUEUE` that swallows sends.
 *
 * Miniflare simulates queues for real, and its consumer runs CONCURRENTLY with
 * the test body. A fixture that reserves a reading and then drives the executor
 * itself does not want the extra delivery: it races `resetDb`, and a claim that
 * commits either side of that boundary leaves a provider job whose owner no
 * longer exists — which the next test then picks up as the oldest claimable
 * work and cancels, for reasons that have nothing to do with what it was
 * testing.
 */
export const SILENT_READING_QUEUE = {
  send: async () => {},
  sendBatch: async () => {},
} as unknown as typeof env.READING_QUEUE;

export function enableReadingCodex(rollout = "hybrid"): void {
  env.READING_V5_ROLLOUT = rollout;
  for (const [key, value] of Object.entries(READING_CODEX_PUBLISHER_VARS)) {
    (env as unknown as Record<string, string>)[key] = value;
  }
}

/**
 * Restore the hermetic baseline for Daily only.
 *
 * `CODEX_RUNNER_TOKEN` and `CODEX_PROVIDER_ARTIFACT_KEYRING` are shared with
 * Pattern and the ontology pipeline, so clearing them here would silently
 * disarm whichever of those a suite had already enabled.
 */
export function disableReadingCodex(): void {
  env.READING_V5_ROLLOUT = "off";
  for (const key of Object.keys(READING_CODEX_PUBLISHER_VARS)) {
    if (key === "CODEX_RUNNER_TOKEN" || key === "CODEX_PROVIDER_ARTIFACT_KEYRING") {
      continue;
    }
    (env as unknown as Record<string, string>)[key] = "";
  }
}

export function disablePatternAi(): void {
  env.PATTERN_PUBLISHER = "";
  env.PATTERN_DAILY_PROVIDER_CALL_LIMIT = "";
  env.PATTERN_ARTIFACT_RETENTION_DAYS = "";
  env.PATTERN_SEMANTIC_FORCE_REJECT = "";
  // The provider credentials too. `OPENAI_API_KEY` is shared with the daily
  // reading publisher, so a Pattern suite that left it set would hand a
  // capability to every suite that ran after it.
  env.OPENAI_CREDENTIAL_SOURCE = "";
  env.OPENAI_API_KEY = "";
  env.OPENAI_PATTERN_PLANNER_MODEL = "";
  env.OPENAI_PATTERN_PLANNER_PROMPT_VERSION = "";
  env.OPENAI_PATTERN_WRITER_MODEL = "";
  env.OPENAI_PATTERN_WRITER_PROMPT_VERSION = "";
  env.OPENAI_PATTERN_VERIFIER_MODEL = "";
  env.OPENAI_PATTERN_VERIFIER_PROMPT_VERSION = "";
  env.OPENAI_PATTERN_PLANNER_TIMEOUT_MS = "";
  env.OPENAI_PATTERN_WRITER_TIMEOUT_MS = "";
  env.OPENAI_PATTERN_VERIFIER_TIMEOUT_MS = "";
  env.CODEX_RUNNER_TOKEN = "";
  env.CODEX_PROVIDER_ARTIFACT_KEYRING = "";
}
