import { canonicalJson, newId, requireIdempotencyKey } from "@patternlike/shared";
import { b64 } from "../crypto.js";
import type { Env } from "../env.js";
import { USR12_SOURCE_ID, ensureFirstPartyGrant } from "./first-party-sources.js";
import {
  buildCryptoWriteFence,
  requireSingleCryptoWriteVersion,
} from "./crypto-write-fence.js";
import { decryptPayload, encryptPayload, type UserIdentity } from "./users.js";

const JOB_TYPE = "store_reading_feedback";
const RESONANCE = new Set(["helpful", "neutral", "not_helpful", "off"]);
const MAX_NOTE_CHARS = 2000;
const MAX_LABELS = 12;
const MAX_LABEL_CHARS = 64;

export type FeedbackResonance = "helpful" | "neutral" | "not_helpful" | "off";

export interface ReadingFeedbackRequest {
  resonance: FeedbackResonance;
  relevance_labels: string[];
  note: string | null;
}

export interface ReadingFeedbackResponse {
  id: string;
  reading_id: string;
  created_at: string;
}

export interface ReadingFeedbackRecord extends ReadingFeedbackResponse {
  resonance: FeedbackResonance;
  relevance_labels: string[];
}

export type StoreFeedbackOutcome =
  | { ok: true; response: ReadingFeedbackResponse }
  | {
      ok: false;
      reason:
        | "missing_idempotency_key"
        | "invalid_body"
        | "reading_not_found"
        | "idempotency_conflict";
    };

interface StoredFeedbackMutation {
  request: ReadingFeedbackRequest;
  response: ReadingFeedbackResponse;
}

function bytes(value: ArrayBuffer | readonly number[]): Uint8Array {
  return value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : Uint8Array.from(value);
}

function parseLabels(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LABELS) return null;
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const label = item.trim();
    if (!label || label.length > MAX_LABEL_CHARS) return null;
    labels.push(label);
  }
  return labels;
}

export function parseFeedbackRequest(value: unknown): ReadingFeedbackRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!RESONANCE.has(body.resonance as string)) return null;
  const labels = parseLabels(body.relevance_labels);
  if (labels === null) return null;
  const rawNote = body.note ?? body.notes ?? null;
  if (rawNote !== null && typeof rawNote !== "string") return null;
  if (typeof rawNote === "string" && rawNote.length > MAX_NOTE_CHARS) return null;
  const extra = Object.keys(body).filter(
    (key) => !["resonance", "relevance_labels", "note", "notes"].includes(key),
  );
  if (extra.length > 0) return null;
  const note = typeof rawNote === "string" ? rawNote.trim() || null : null;
  return {
    resonance: body.resonance as FeedbackResonance,
    relevance_labels: labels,
    note,
  };
}

async function loadStoredMutation(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
): Promise<StoredFeedbackMutation | null> {
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
  if (!row || row.payload_key_version === undefined || !row.payload_nonce) {
    return null;
  }
  return decryptPayload<StoredFeedbackMutation>(
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

/**
 * Whether this account owns a reading that actually existed as an artifact.
 *
 * Pending and failed rows have nothing to give feedback on. Superseded and
 * invalidated still do — the reader may be looking at the edition that was
 * on screen when they pressed the control.
 */
async function ownedReadableReading(
  env: Env,
  userId: string,
  readingId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id FROM daily_readings
     WHERE id = ? AND user_id = ? AND reading_enc IS NOT NULL`,
  )
    .bind(readingId, userId)
    .first<{ id: string }>();
  return row !== null;
}

export async function loadLatestFeedback(
  env: Env,
  identity: UserIdentity,
  readingId: string,
): Promise<ReadingFeedbackRecord | null> {
  const row = await env.DB.prepare(
    `SELECT id, reading_id, resonance, relevance_labels_json, created_at
     FROM reading_feedback
     WHERE reading_id = ? AND user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
  )
    .bind(readingId, identity.userId)
    .first<{
      id: string;
      reading_id: string;
      resonance: string | null;
      relevance_labels_json: string;
      created_at: string;
    }>();
  if (!row || !row.resonance || !RESONANCE.has(row.resonance)) return null;
  let labels: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.relevance_labels_json);
    if (Array.isArray(parsed)) {
      labels = parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    labels = [];
  }
  return {
    id: row.id,
    reading_id: row.reading_id,
    resonance: row.resonance as FeedbackResonance,
    relevance_labels: labels,
    created_at: row.created_at,
  };
}

export async function storeReadingFeedback(
  env: Env,
  identity: UserIdentity,
  readingId: string,
  idempotencyKey: string | null,
  request: ReadingFeedbackRequest,
  now = new Date(),
): Promise<StoreFeedbackOutcome> {
  if (!idempotencyKey || !requireIdempotencyKey(idempotencyKey)) {
    return { ok: false, reason: "missing_idempotency_key" };
  }

  const replay = await loadStoredMutation(env, identity, idempotencyKey);
  if (replay) {
    return canonicalJson(replay.request) === canonicalJson(request)
      ? { ok: true, response: replay.response }
      : { ok: false, reason: "idempotency_conflict" };
  }

  if (!(await ownedReadableReading(env, identity.userId, readingId))) {
    return { ok: false, reason: "reading_not_found" };
  }

  const grant = await ensureFirstPartyGrant(env, identity, USR12_SOURCE_ID, now);
  const createdAt = now.toISOString();
  const feedbackId = newId("rfb");
  const response: ReadingFeedbackResponse = {
    id: feedbackId,
    reading_id: readingId,
    created_at: createdAt,
  };

  let notesEnc: Uint8Array | null = null;
  let notesKeyVersion: number | null = null;
  let notesNonce: string | null = null;
  if (request.note !== null) {
    const sealed = await encryptPayload(env, identity, { note: request.note }, {
      subject: identity.cryptoSubject,
      field: "reading_feedback.notes_enc",
      recordId: feedbackId,
    });
    notesEnc = Uint8Array.from(atob(sealed.ciphertext), (char) => char.charCodeAt(0));
    notesKeyVersion = sealed.keyVersion;
    notesNonce = sealed.nonce;
  }

  const jobId = newId("job");
  const sealedJob = await encryptPayload(
    env,
    identity,
    { request, response } satisfies StoredFeedbackMutation,
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: jobId,
    },
  );

  try {
    await env.DB.batch([
      buildCryptoWriteFence(env, {
        userId: identity.userId,
        keyVersion: requireSingleCryptoWriteVersion([
          sealedJob.keyVersion,
          ...(notesKeyVersion === null ? [] : [notesKeyVersion]),
        ]),
        allowedStatuses: ["active"],
      }),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'reading feedback target missing'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings
           WHERE id = ? AND user_id = ? AND reading_enc IS NOT NULL
         )`,
      ).bind(readingId, identity.userId),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'USR-12 grant changed concurrently'
         WHERE NOT EXISTS (
           SELECT 1 FROM context_source_permissions p
           JOIN consents c ON c.id = p.consent_id AND c.user_id = p.user_id
           WHERE p.user_id = ? AND p.source_id = ? AND p.enabled = 1
             AND p.permission_state = 'active' AND p.consent_id = ?
             AND c.status = 'granted'
         )`,
      ).bind(identity.userId, USR12_SOURCE_ID, grant.consentId),
      env.DB.prepare(
        `INSERT INTO reading_feedback (
           id, reading_id, user_id, resonance, relevance_labels_json,
           notes_enc, notes_key_version, notes_nonce, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        feedbackId,
        readingId,
        identity.userId,
        request.resonance,
        JSON.stringify(request.relevance_labels),
        notesEnc,
        notesKeyVersion,
        notesNonce,
        createdAt,
      ),
      env.DB.prepare(
        `UPDATE context_source_permissions SET last_signal_id = ?, updated_at = ?
         WHERE user_id = ? AND source_id = ? AND consent_id = ?`,
      ).bind(
        feedbackId,
        createdAt,
        identity.userId,
        USR12_SOURCE_ID,
        grant.consentId,
      ),
      env.DB.prepare(
        `INSERT INTO jobs (
           id, job_type, user_id, idempotency_key, status, payload_enc,
           payload_key_version, payload_nonce, result_class, attempts,
           finished_at, created_at
         ) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, 'reading_feedback_stored', 1, ?, ?)`,
      ).bind(
        jobId,
        JOB_TYPE,
        identity.userId,
        idempotencyKey,
        Uint8Array.from(atob(sealedJob.ciphertext), (char) => char.charCodeAt(0)),
        sealedJob.keyVersion,
        sealedJob.nonce,
        createdAt,
        createdAt,
      ),
    ]);
  } catch {
    const raced = await loadStoredMutation(env, identity, idempotencyKey);
    if (raced) {
      return canonicalJson(raced.request) === canonicalJson(request)
        ? { ok: true, response: raced.response }
        : { ok: false, reason: "idempotency_conflict" };
    }
    throw new Error("reading feedback write failed");
  }

  return { ok: true, response };
}
