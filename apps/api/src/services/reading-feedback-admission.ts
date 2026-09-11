import { canonicalJson } from "@patternlike/shared";
import { asCryptoSubject } from "../crypto.js";
import type { Env } from "../env.js";
import { loadReadingFeedbackEvent } from "../db/reading-feedback-events.js";
import type { ContextPinV2 } from "./generation-command-v2.js";
import { compileReadingFeedbackEvent, READING_FEEDBACK_SIGNAL_VERSION } from "./reading-feedback-compiler.js";
import { CATEGORIZED_FEEDBACK_SELECTION_VERSION } from "./reading-feedback-policy.js";
import { loadCurrentCategoricalFeedbackGrant } from "./reading-feedback-grant.js";

export function isCategoricalFeedbackPin(pin: ContextPinV2): boolean {
  return pin.snapshot.kind === "structured" && pin.snapshot.value.schema_version === READING_FEEDBACK_SIGNAL_VERSION;
}

/** Rechecked by execution and runner admission; a frozen response cannot renew a grant. */
export async function currentCategoricalFeedbackMatches(
  env: Env, userId: string, pins: readonly ContextPinV2[], selectionVersion: string, now = new Date(),
): Promise<boolean> {
  const categorical = pins.filter(isCategoricalFeedbackPin);
  if (categorical.length === 0) return true;
  if (selectionVersion !== CATEGORIZED_FEEDBACK_SELECTION_VERSION) return false;
  const row = await env.DB.prepare("SELECT crypto_subject FROM users WHERE id = ? AND status = 'active'")
    .bind(userId).first<{ crypto_subject: string }>();
  if (!row) return false;
  const identity = { userId, cryptoSubject: asCryptoSubject(row.crypto_subject) };
  const grant = await loadCurrentCategoricalFeedbackGrant(env, userId, now);
  if (!grant) return false;
  for (const pin of categorical) {
    const event = await loadReadingFeedbackEvent(env, identity, pin.signal_id, now);
    const signal = event ? await compileReadingFeedbackEvent(event, grant, now) : null;
    if (!signal || pin.source_id !== signal.source_id || pin.category !== signal.category ||
      pin.consent_id !== event!.grant.consent_id || pin.consent_version !== event!.grant.consent_version ||
      pin.permission_state !== "active" || pin.evidence_lane !== signal.evidence_lane ||
      pin.normalized_hash !== signal.normalized_hash || pin.observed_at !== signal.observed_at ||
      pin.expires_at !== signal.expires_at || pin.freshness_status !== signal.freshness_status ||
      !signal.allowed_uses.includes(pin.allowed_use) || canonicalJson(pin.snapshot) !== canonicalJson(signal.content)) return false;
  }
  return true;
}
