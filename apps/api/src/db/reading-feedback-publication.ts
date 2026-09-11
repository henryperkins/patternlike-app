import type { Env } from "../env.js";
import type { UserIdentity } from "./users.js";
import type { ContextPinV2 } from "../services/generation-command-v2.js";
import { canonicalJson } from "@patternlike/shared";
import { loadReadingFeedbackEvent } from "./reading-feedback-events.js";
import { loadCurrentCategoricalFeedbackGrant } from "../services/reading-feedback-grant.js";
import { compileReadingFeedbackEvent, READING_FEEDBACK_SIGNAL_VERSION } from "../services/reading-feedback-compiler.js";

interface Snapshot {
  reading_id: string;
  event_enc: ArrayBuffer;
  event_key_version: number;
  event_nonce: string;
  reading_enc: ArrayBuffer;
  reading_key_version: number;
  reading_nonce: string;
}

/** Bind the final readable inputs to the caller's atomic publication batch. */
export async function buildReadingFeedbackPublicationGuards(env: Env, identity: UserIdentity, pins: readonly ContextPinV2[], now: Date): Promise<D1PreparedStatement[] | null> {
  const selected = pins.filter((pin) => pin.snapshot.kind === "structured" && pin.snapshot.value.schema_version === READING_FEEDBACK_SIGNAL_VERSION);
  if (selected.length === 0) return [];
  const grant = await loadCurrentCategoricalFeedbackGrant(env, identity.userId, now);
  if (!grant) return null;
  const statements: D1PreparedStatement[] = [];
  const nowIso = now.toISOString();
  for (const pin of selected) {
    // Capture first, validate second. Replacing either ciphertext during the
    // reads cannot leave a newer row protected by an older validation result.
    const row = await env.DB.prepare(`SELECT f.reading_id,f.event_enc,f.event_key_version,f.event_nonce,
      r.reading_enc,r.reading_key_version,r.reading_nonce FROM reading_feedback_events f
      JOIN daily_readings r ON r.id=f.reading_id AND r.user_id=f.user_id
      WHERE f.user_id=? AND f.id=? AND r.reading_enc IS NOT NULL
        AND r.status IN ('published','superseded','invalidated')`)
      .bind(identity.userId, pin.signal_id).first<Snapshot>();
    if (!row) return null;
    const event = await loadReadingFeedbackEvent(env, identity, pin.signal_id, now);
    const signal = event ? await compileReadingFeedbackEvent(event, grant, now) : null;
    if (!event || !signal || pin.source_id !== signal.source_id || pin.category !== signal.category ||
      pin.evidence_lane !== signal.evidence_lane || pin.normalized_hash !== signal.normalized_hash ||
      pin.observed_at !== signal.observed_at || pin.expires_at !== signal.expires_at ||
      pin.freshness_status !== signal.freshness_status || pin.permission_state !== "active" ||
      pin.consent_id !== event.grant.consent_id || pin.consent_version !== event.grant.consent_version ||
      !signal.allowed_uses.includes(pin.allowed_use) || canonicalJson(pin.snapshot) !== canonicalJson(signal.content)) return null;
    statements.push(env.DB.prepare(`INSERT INTO assertion_probe (id,reason)
      SELECT 1,'categorical feedback publication input changed' WHERE NOT EXISTS (
        SELECT 1 FROM reading_feedback_events f
        JOIN daily_readings r ON r.id=f.reading_id AND r.user_id=f.user_id
        JOIN context_source_permissions p ON p.user_id=f.user_id AND p.source_id='USR-12'
        JOIN consents c ON c.id=p.consent_id AND c.user_id=p.user_id
        WHERE f.user_id=? AND f.id=? AND f.reading_id=? AND r.revision=?
          AND f.event_enc=? AND f.event_key_version=? AND f.event_nonce=?
          AND r.reading_enc=? AND r.reading_key_version=? AND r.reading_nonce=?
          AND r.status IN ('published','superseded','invalidated')
          AND f.created_at=? AND f.effect_expires_at=? AND f.effect_expires_at>? AND f.retention_expires_at=? AND f.retention_expires_at>?
          AND p.enabled=1 AND p.permission_state='active' AND p.permission_tier=1 AND p.consent_id=?
          AND c.kind='product_source' AND c.source_id='USR-12' AND c.status='granted' AND c.permission_tier=1 AND c.version=? AND c.policy_version=?
          AND (c.expires_at IS NULL OR julianday(c.expires_at)>julianday(?))
          AND EXISTS(SELECT 1 FROM json_each(p.allowed_uses_json) WHERE value=?)
          AND EXISTS(SELECT 1 FROM json_each(c.allowed_uses_json) WHERE value=?))`)
      .bind(identity.userId, pin.signal_id, event.receipt.target.reading_id, event.receipt.target.revision,
        row.event_enc, row.event_key_version, row.event_nonce, row.reading_enc, row.reading_key_version, row.reading_nonce,
        event.receipt.created_at, event.receipt.effect_expires_at, nowIso, event.receipt.retention_expires_at, nowIso,
        event.grant.consent_id, event.grant.consent_version, event.grant.policy_version, nowIso, pin.allowed_use, pin.allowed_use));
  }
  return statements;
}
