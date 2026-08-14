import {
  canonicalJson,
  contentHash,
  EXCLUDABLE_LIFE_DOMAINS,
  newId,
  type ExcludableLifeDomain,
} from "@patternlike/shared";
import { b64 } from "../crypto.js";
import type { Env } from "../env.js";
import {
  USR05_ALLOWED_USES,
  USR05_SOURCE_ID,
  ensureFirstPartyGrant,
  type FirstPartyGrant,
} from "./first-party-sources.js";
import { decryptPayload, encryptPayload, type UserIdentity } from "./users.js";

const JOB_TYPE = "store_topic_exclusions";
const SOURCE_WINDOW = "standing";
const M0_SCHEMA_VERSION = "0.2.0" as const;
const EXCLUDABLE = new Set<string>(EXCLUDABLE_LIFE_DOMAINS);

export interface TopicExclusionsResponse {
  schema_version: "0.2.0";
  excluded_topics: ExcludableLifeDomain[];
  updated_at: string | null;
}

export type StoreTopicExclusionsOutcome =
  | { ok: true; response: TopicExclusionsResponse; changed: boolean }
  | { ok: false; reason: "idempotency_conflict" | "conflict" };

interface StoredExclusionMutation {
  excluded_topics: ExcludableLifeDomain[];
  response: TopicExclusionsResponse;
}

interface CurrentRow {
  id: string;
  source_revision: number;
  value_enc: ArrayBuffer | null;
  value_key_version: number | null;
  value_nonce: string | null;
  updated_at: string;
}

function bytes(value: ArrayBuffer | readonly number[]): Uint8Array {
  return value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : Uint8Array.from(value);
}

function randomSalt(): string {
  const value = new Uint8Array(16);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseExcludedTopics(value: unknown): ExcludableLifeDomain[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const topics: ExcludableLifeDomain[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !EXCLUDABLE.has(item) || seen.has(item)) {
      return null;
    }
    seen.add(item);
    topics.push(item as ExcludableLifeDomain);
  }
  topics.sort(
    (a, b) => EXCLUDABLE_LIFE_DOMAINS.indexOf(a) - EXCLUDABLE_LIFE_DOMAINS.indexOf(b),
  );
  return topics;
}

async function loadStoredMutation(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
): Promise<StoredExclusionMutation | null> {
  const row = await env.DB.prepare(
    `SELECT id, payload_enc, payload_key_version, payload_nonce
     FROM jobs WHERE job_type = ? AND user_id = ? AND idempotency_key = ?
       AND status = 'succeeded'`,
  )
    .bind(JOB_TYPE, identity.userId, idempotencyKey)
    .first<{
      id: string;
      payload_enc: ArrayBuffer | readonly number[];
      payload_key_version: number;
      payload_nonce: string;
    }>();
  if (!row) return null;
  return decryptPayload<StoredExclusionMutation>(
    env,
    identity,
    {
      key_version: row.payload_key_version,
      nonce: row.payload_nonce,
      ciphertext: b64(bytes(row.payload_enc)),
    },
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: row.id,
    },
  );
}

async function loadCurrentRow(
  env: Env,
  userId: string,
): Promise<CurrentRow | null> {
  return env.DB.prepare(
    `SELECT id, source_revision, value_enc, value_key_version, value_nonce, updated_at
     FROM context_signals
     WHERE user_id = ? AND source_id = ? AND source_window = ? AND is_current = 1`,
  )
    .bind(userId, USR05_SOURCE_ID, SOURCE_WINDOW)
    .first<CurrentRow>();
}

/**
 * Clearing supersedes the current row without inserting a tombstone, so the
 * next write has no predecessor. Revision identity is still unique across the
 * whole USR-05 chain, including superseded rows.
 */
async function nextRevision(
  env: Env,
  userId: string,
  predecessor: CurrentRow | null,
): Promise<number> {
  if (predecessor) return predecessor.source_revision + 1;
  const row = await env.DB.prepare(
    `SELECT MAX(source_revision) AS max_rev FROM context_signals
     WHERE user_id = ? AND source_id = ? AND source_window = ?`,
  )
    .bind(userId, USR05_SOURCE_ID, SOURCE_WINDOW)
    .first<{ max_rev: number | null }>();
  return (row?.max_rev ?? 0) + 1;
}

async function decryptTopics(
  env: Env,
  identity: UserIdentity,
  row: CurrentRow,
): Promise<ExcludableLifeDomain[] | null> {
  if (!row.value_enc || row.value_key_version === null || !row.value_nonce) {
    return null;
  }
  const plain = await decryptPayload<{ value?: { excluded_topics?: unknown } }>(
    env,
    identity,
    {
      key_version: row.value_key_version,
      nonce: row.value_nonce,
      ciphertext: b64(bytes(row.value_enc)),
    },
    {
      subject: identity.cryptoSubject,
      field: "context_signals.value_enc",
      recordId: row.id,
    },
  );
  const topics = parseExcludedTopics(plain?.value?.excluded_topics);
  return topics;
}

export async function loadTopicExclusions(
  env: Env,
  identity: UserIdentity,
): Promise<TopicExclusionsResponse> {
  const row = await loadCurrentRow(env, identity.userId);
  if (!row) {
    return { schema_version: M0_SCHEMA_VERSION, excluded_topics: [], updated_at: null };
  }
  const topics = await decryptTopics(env, identity, row);
  return {
    schema_version: M0_SCHEMA_VERSION,
    excluded_topics: topics ?? [],
    updated_at: row.updated_at,
  };
}

export async function storeTopicExclusions(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
  excludedTopics: ExcludableLifeDomain[],
  now = new Date(),
): Promise<StoreTopicExclusionsOutcome> {
  const replay = await loadStoredMutation(env, identity, idempotencyKey);
  if (replay) {
    return canonicalJson(replay.excluded_topics) === canonicalJson(excludedTopics)
      ? { ok: true, response: replay.response, changed: false }
      : { ok: false, reason: "idempotency_conflict" };
  }

  const current = await loadTopicExclusions(env, identity);
  if (canonicalJson(current.excluded_topics) === canonicalJson(excludedTopics)) {
    return { ok: true, response: current, changed: false };
  }

  const grant = await ensureFirstPartyGrant(env, identity, USR05_SOURCE_ID, now);
  const predecessor = await loadCurrentRow(env, identity.userId);
  const observedAt = now.toISOString();
  const response: TopicExclusionsResponse = {
    schema_version: M0_SCHEMA_VERSION,
    excluded_topics: excludedTopics,
    updated_at: observedAt,
  };

  try {
    if (excludedTopics.length === 0) {
      await persistEmpty(
        env,
        identity,
        idempotencyKey,
        grant,
        predecessor,
        excludedTopics,
        response,
        observedAt,
      );
    } else {
      await persistTopics(
        env,
        identity,
        idempotencyKey,
        grant,
        predecessor,
        excludedTopics,
        response,
        observedAt,
      );
    }
  } catch {
    const raced = await loadStoredMutation(env, identity, idempotencyKey);
    if (raced) {
      return canonicalJson(raced.excluded_topics) === canonicalJson(excludedTopics)
        ? { ok: true, response: raced.response, changed: false }
        : { ok: false, reason: "idempotency_conflict" };
    }
    return { ok: false, reason: "conflict" };
  }
  return { ok: true, response, changed: true };
}

async function persistEmpty(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
  grant: FirstPartyGrant,
  predecessor: CurrentRow | null,
  excludedTopics: ExcludableLifeDomain[],
  response: TopicExclusionsResponse,
  observedAt: string,
): Promise<void> {
  const jobId = newId("job");
  const sealedJob = await encryptPayload(
    env,
    identity,
    { excluded_topics: excludedTopics, response } satisfies StoredExclusionMutation,
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: jobId,
    },
  );
  const statements = [
    grantAssertion(env, identity.userId, grant.consentId),
    predecessorAssertion(env, identity.userId, predecessor),
  ];
  if (predecessor) {
    statements.push(
      env.DB.prepare(
        `UPDATE context_signals
         SET conflict_status = 'superseded', is_current = 0, updated_at = ?
         WHERE id = ? AND user_id = ? AND is_current = 1`,
      ).bind(observedAt, predecessor.id, identity.userId),
    );
  }
  statements.push(jobInsert(env, identity.userId, jobId, idempotencyKey, sealedJob, observedAt));
  await env.DB.batch(statements);
}

async function persistTopics(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
  grant: FirstPartyGrant,
  predecessor: CurrentRow | null,
  excludedTopics: ExcludableLifeDomain[],
  response: TopicExclusionsResponse,
  observedAt: string,
): Promise<void> {
  const revision = await nextRevision(env, identity.userId, predecessor);
  const signalId = newId("sig");
  const value = { excluded_topics: excludedTopics };
  const hashSalt = randomSalt();
  const normalizedHash = await contentHash(
    canonicalJson({
      hash_salt: hashSalt,
      schema_version: M0_SCHEMA_VERSION,
      source_id: USR05_SOURCE_ID,
      source_window: SOURCE_WINDOW,
      source_revision: revision,
      observed_at: observedAt,
      ...value,
    }),
  );
  const sealedValue = await encryptPayload(
    env,
    identity,
    { hash_salt: hashSalt, value },
    {
      subject: identity.cryptoSubject,
      field: "context_signals.value_enc",
      recordId: signalId,
    },
  );
  const jobId = newId("job");
  const sealedJob = await encryptPayload(
    env,
    identity,
    { excluded_topics: excludedTopics, response } satisfies StoredExclusionMutation,
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: jobId,
    },
  );
  const usesJson = JSON.stringify(USR05_ALLOWED_USES);
  const statements = [
    grantAssertion(env, identity.userId, grant.consentId),
    predecessorAssertion(env, identity.userId, predecessor),
  ];
  if (predecessor) {
    statements.push(
      env.DB.prepare(
        `UPDATE context_signals
         SET conflict_status = 'superseded', is_current = 0, updated_at = ?
         WHERE id = ? AND user_id = ? AND is_current = 1`,
      ).bind(observedAt, predecessor.id, identity.userId),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO context_signals
         (id, user_id, source_id, source_window, evidence_lane,
          allowed_uses_json, confidence, sensitivity, permission_state,
          conflict_status, consent_id, freshness_status, observed_at,
          ingested_at, expires_at, value_encoding, value_json, value_enc,
          value_key_version, value_nonce, labels_json, provenance_json,
          supersedes_signal_id, normalized_hash, created_at, updated_at,
          source_revision, is_current, retention_expires_at)
       VALUES (?, ?, ?, ?, 'user_and_context', ?, 'user_confirmed',
               'sensitive', 'active', 'none', ?, 'fresh', ?, ?, NULL,
               'encrypted', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
    ).bind(
      signalId,
      identity.userId,
      USR05_SOURCE_ID,
      SOURCE_WINDOW,
      usesJson,
      grant.consentId,
      observedAt,
      observedAt,
      Uint8Array.from(atob(sealedValue.ciphertext), (char) => char.charCodeAt(0)),
      sealedValue.keyVersion,
      sealedValue.nonce,
      JSON.stringify(["user_confirmed", "negative_preference"]),
      JSON.stringify({
        ingestion_owner: "first-party-context-service",
        primary_runtime: "cloudflare-api-worker",
        connector_account_id: null,
        provider: null,
        acquisition: "explicit_topic_exclusion",
      }),
      predecessor?.id ?? null,
      normalizedHash,
      observedAt,
      observedAt,
      revision,
    ),
    env.DB.prepare(
      `UPDATE context_source_permissions SET last_signal_id = ?, updated_at = ?
       WHERE user_id = ? AND source_id = ? AND consent_id = ?`,
    ).bind(signalId, observedAt, identity.userId, USR05_SOURCE_ID, grant.consentId),
    jobInsert(env, identity.userId, jobId, idempotencyKey, sealedJob, observedAt),
  );
  await env.DB.batch(statements);
}

function grantAssertion(env: Env, userId: string, consentId: string) {
  return env.DB.prepare(
    `INSERT INTO assertion_probe (id, reason)
     SELECT 1, 'USR-05 grant changed concurrently'
     WHERE NOT EXISTS (
       SELECT 1 FROM context_source_permissions p
       JOIN consents c ON c.id = p.consent_id AND c.user_id = p.user_id
       WHERE p.user_id = ? AND p.source_id = ? AND p.enabled = 1
         AND p.permission_state = 'active' AND p.consent_id = ?
         AND c.status = 'granted'
     )`,
  ).bind(userId, USR05_SOURCE_ID, consentId);
}

function predecessorAssertion(
  env: Env,
  userId: string,
  predecessor: CurrentRow | null,
) {
  return predecessor
    ? env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'topic exclusion predecessor changed concurrently'
         WHERE NOT EXISTS (
           SELECT 1 FROM context_signals
           WHERE id = ? AND user_id = ? AND source_id = ?
             AND source_window = ? AND source_revision = ? AND is_current = 1
         )`,
      ).bind(
        predecessor.id,
        userId,
        USR05_SOURCE_ID,
        SOURCE_WINDOW,
        predecessor.source_revision,
      )
    : env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'topic exclusion appeared concurrently'
         WHERE EXISTS (
           SELECT 1 FROM context_signals
           WHERE user_id = ? AND source_id = ? AND source_window = ?
             AND is_current = 1
         )`,
      ).bind(userId, USR05_SOURCE_ID, SOURCE_WINDOW);
}

function jobInsert(
  env: Env,
  userId: string,
  jobId: string,
  idempotencyKey: string,
  sealed: { ciphertext: string; keyVersion: number; nonce: string },
  nowIso: string,
) {
  return env.DB.prepare(
    `INSERT INTO jobs (
       id, job_type, user_id, idempotency_key, status, payload_enc,
       payload_key_version, payload_nonce, result_class, attempts,
       finished_at, created_at
     ) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, 'topic_exclusions_stored', 1, ?, ?)`,
  ).bind(
    jobId,
    JOB_TYPE,
    userId,
    idempotencyKey,
    Uint8Array.from(atob(sealed.ciphertext), (char) => char.charCodeAt(0)),
    sealed.keyVersion,
    sealed.nonce,
    nowIso,
    nowIso,
  );
}
