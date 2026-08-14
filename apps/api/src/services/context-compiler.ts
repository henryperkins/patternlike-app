import {
  MAX_FEEDBACK_RECORDS,
  MAX_PRIOR_READINGS,
  type ConstrainedContextSignalInput,
  type ConstrainedContextSourceInput,
  type ConstrainedPriorReading,
} from "@patternlike/reading-engine";
import type { Env } from "../env.js";
import { b64, decryptJson } from "../crypto.js";
import { loadUserKey, type UserIdentity } from "../db/users.js";
import { loadContextSourceGrants } from "../db/consents.js";
import { isStoredReadingV5 } from "./stored-reading.js";

/**
 * Read the complete eligible context corpus for one owner.
 *
 * This module LOADS; it does not decide. Every eligibility question — permission
 * state, consent agreement, freshness, the registry allowlist, the allowed-use
 * intersection, the packet budget — belongs to
 * `prepareConstrainedReadingInput()`, which is the one place that answers them.
 * A loader that filtered on its own would be a second copy of that policy, and
 * the two would drift in the direction nobody tests: quietly including something.
 *
 * Owner scoping is a query predicate throughout (`WHERE user_id = ?`), never a
 * comparison after the fetch, and the DEK is loaded once rather than per row.
 */

/** The registry source that describes `reading_feedback`. */
export const READING_FEEDBACK_SOURCE_ID = "USR-12";

export interface ConstrainedContextLoad {
  sources: ConstrainedContextSourceInput[];
  signals: ConstrainedContextSignalInput[];
  priorReadings: ConstrainedPriorReading[];
}

interface SignalRow {
  id: string;
  source_id: string;
  evidence_lane: string;
  allowed_uses_json: string;
  normalized_hash: string;
  freshness_status: string;
  observed_at: string;
  expires_at: string | null;
  is_current: number;
  value_encoding: string;
  value_json: string | null;
  value_enc: ArrayBuffer | null;
  value_key_version: number | null;
  value_nonce: string | null;
}

interface FeedbackRow {
  id: string;
  resonance: string | null;
  relevance_labels_json: string;
  created_at: string;
}

interface PriorReadingRow {
  id: string;
  local_date: string;
  reading_enc: ArrayBuffer;
  reading_key_version: number;
  reading_nonce: string;
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function loadConstrainedContext(
  env: Env,
  identity: UserIdentity,
  targetLocalDate: string,
): Promise<ConstrainedContextLoad> {
  const sources = await loadContextSourceGrants(env, identity.userId);
  const { dek } = await loadUserKey(env, identity);

  // Every signal the account holds, unfiltered except for the two states that
  // are not eligibility decisions but data faults: a superseded or conflicted
  // row is not a smaller grant, it is a row the ingestion layer has already
  // said should not be read.
  const { results: signalRows } = await env.DB.prepare(
    `SELECT id, source_id, evidence_lane, allowed_uses_json, normalized_hash,
            freshness_status, observed_at, expires_at, is_current,
            value_encoding, value_json,
            value_enc, value_key_version, value_nonce
     FROM context_signals
     WHERE user_id = ? AND conflict_status = 'none' AND is_current = 1
     ORDER BY observed_at DESC, id`,
  )
    .bind(identity.userId)
    .all<SignalRow>();

  const signals: ConstrainedContextSignalInput[] = [];
  for (const row of signalRows) {
    let content: ConstrainedContextSignalInput["content"] | null = null;
    if (row.value_encoding === "encrypted") {
      if (row.value_enc === null || row.value_key_version === null || row.value_nonce === null) {
        continue;
      }
      const plain = await decryptJson<unknown>(
        {
          key_version: row.value_key_version,
          nonce: row.value_nonce,
          ciphertext: b64(new Uint8Array(row.value_enc)),
        },
        dek,
        {
          subject: identity.cryptoSubject,
          field: "context_signals.value_enc",
          recordId: row.id,
        },
      );
      // A stored value is either prose or structure. Anything else is a row this
      // compiler does not know how to describe, and describing it wrongly is
      // worse than leaving it out. First-party writers that salt the evidence
      // hash wrap `{ hash_salt, value }`; the salt is not a context value.
      if (
        isPlainObject(plain) &&
        typeof plain.hash_salt === "string" &&
        isPlainObject(plain.value)
      ) {
        content = { kind: "structured", value: plain.value };
      } else if (isPlainObject(plain) && typeof plain.text === "string") {
        content = { kind: "text", text: plain.text };
      } else if (isPlainObject(plain)) {
        content = { kind: "structured", value: plain };
      } else {
        continue;
      }
    } else if (row.value_json !== null) {
      try {
        const parsed = JSON.parse(row.value_json) as unknown;
        if (!isPlainObject(parsed)) continue;
        content = { kind: "structured", value: parsed };
      } catch {
        continue;
      }
    }
    if (!content) continue;

    signals.push({
      signal_id: row.id,
      source_id: row.source_id,
      category: "enabled_personal_context",
      allowed_uses: parseStringArray(row.allowed_uses_json),
      evidence_lane: row.evidence_lane as ConstrainedContextSignalInput["evidence_lane"],
      normalized_hash: row.normalized_hash,
      freshness_status:
        row.freshness_status as ConstrainedContextSignalInput["freshness_status"],
      observed_at: row.observed_at,
      expires_at: row.expires_at,
      content,
    });
  }

  // Structured reading feedback, offered as ordinary signals under the registry
  // source that describes it. It reaches a packet through exactly the same
  // permission, consent, and allowed-use gate as any other source. The writer
  // creates the USR-12 grant on first submit; this loader still does not
  // synthesize one. Bounded at the selection cap so the query is bounded too.
  const { results: feedbackRows } = await env.DB.prepare(
    `SELECT id, resonance, relevance_labels_json, created_at
     FROM reading_feedback
     WHERE user_id = ?
     ORDER BY created_at DESC, id
     LIMIT ?`,
  )
    .bind(identity.userId, MAX_FEEDBACK_RECORDS)
    .all<FeedbackRow>();

  for (const row of feedbackRows) {
    signals.push({
      signal_id: row.id,
      source_id: READING_FEEDBACK_SOURCE_ID,
      category: "reading_feedback",
      allowed_uses: ["repetition_control", "theme_ranking"],
      evidence_lane: "user_and_context",
      // Feedback carries no ingestion hash of its own; the row id is stable and
      // the value is derived from columns that never change after insert.
      normalized_hash: row.id,
      freshness_status: "fresh",
      observed_at: row.created_at,
      expires_at: null,
      content: {
        kind: "structured",
        value: {
          resonance: row.resonance,
          relevance_labels: parseStringArray(row.relevance_labels_json),
        },
      },
    });
  }

  // Repetition control reads the reader's own recent editions. Only v5 artifacts
  // qualify: a v3 reading has no headline, and manufacturing one from its prose
  // would invent a repetition signal rather than record one.
  const { results: priorRows } = await env.DB.prepare(
    `SELECT id, local_date, reading_enc, reading_key_version, reading_nonce
     FROM daily_readings
     WHERE user_id = ? AND status = 'published' AND local_date < ?
       AND reading_enc IS NOT NULL
     ORDER BY local_date DESC
     LIMIT ?`,
  )
    .bind(identity.userId, targetLocalDate, MAX_PRIOR_READINGS)
    .all<PriorReadingRow>();

  const priorReadings: ConstrainedPriorReading[] = [];
  for (const row of priorRows) {
    const stored = await decryptJson<unknown>(
      {
        key_version: row.reading_key_version,
        nonce: row.reading_nonce,
        ciphertext: b64(new Uint8Array(row.reading_enc)),
      },
      dek,
      {
        subject: identity.cryptoSubject,
        field: "daily_readings.reading_enc",
        recordId: row.id,
      },
    );
    if (!isStoredReadingV5(stored)) continue;

    const lead = stored.reading.paragraphs.find((p) => p.role === "primary_theme");
    const reflection = stored.reading.paragraphs.find((p) => p.role === "reflection");
    if (!lead || !reflection) continue;
    priorReadings.push({
      local_date: row.local_date,
      headline: stored.reading.headline,
      lead: lead.text,
      reflection_prompt: reflection.text,
    });
  }

  return { sources, signals, priorReadings };
}
