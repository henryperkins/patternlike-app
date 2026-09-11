import { canonicalJson, contentHash } from "@patternlike/shared";
import type { ConstrainedContextSignalInput, ConstrainedContextSourceInput } from "@patternlike/reading-engine";
import type { ReadingFeedbackEventPayload } from "../db/reading-feedback-events.js";

export const READING_FEEDBACK_SIGNAL_VERSION = "reading-feedback-signal/v1" as const;

/** Stored notes never enter this projection. Admission still uses the ordinary packet limits. */
export async function compileReadingFeedbackEvent(
  event: ReadingFeedbackEventPayload,
  source: ConstrainedContextSourceInput | undefined,
  anchor: Date,
): Promise<ConstrainedContextSignalInput | null> {
  const receipt = event.receipt;
  if (receipt.category === "unclear" || !receipt.effect_expires_at) return null;
  const use = receipt.category === "repetitive" ? "repetition_control" : "theme_ranking";
  if (receipt.category !== "repetitive" && receipt.category !== "not_relevant_today") return null;
  const created = Date.parse(receipt.created_at);
  const expires = Date.parse(receipt.effect_expires_at);
  const retention = Date.parse(receipt.retention_expires_at);
  if (![created, expires, retention, anchor.getTime()].every(Number.isFinite) ||
    created > anchor.getTime() || expires <= anchor.getTime() || retention <= anchor.getTime() ||
    expires !== created + 7 * 24 * 60 * 60 * 1000) return null;
  if (!source || source.source_id !== "USR-12" || source.permission_state !== "active" ||
    source.permission_consent_id !== event.grant.consent_id || source.consent_id !== event.grant.consent_id ||
    source.consent_source_id !== "USR-12" || source.consent_status !== "granted" ||
    source.consent_version !== event.grant.consent_version || event.grant.policy_version !== "usr-12-v1" ||
    !source.permission_allowed_uses.includes(use) || !source.consent_allowed_uses.includes(use)) return null;
  const target = receipt.target;
  if (!target.reading_id || !Number.isSafeInteger(target.revision) || target.revision < 1 ||
    !/^sha256:[a-f0-9]{64}$/.test(target.content_hash)) return null;
  const facts = [...new Set(event.targets.fact_ids)].sort();
  const themes = [...new Set(event.targets.theme_ids)].sort();
  if (receipt.category === "not_relevant_today" && themes.length === 0) return null;
  const value = {
    schema_version: READING_FEEDBACK_SIGNAL_VERSION,
    category: receipt.category,
    target: { reading_id: target.reading_id, revision: target.revision, content_hash: target.content_hash, paragraph_id: target.paragraph_id },
    fact_ids: facts,
    theme_ids: themes,
  };
  return {
    signal_id: receipt.id,
    source_id: "USR-12",
    category: "reading_feedback",
    allowed_uses: [use],
    evidence_lane: "user_and_context",
    normalized_hash: await contentHash(canonicalJson({ event_id: receipt.id, value })),
    freshness_status: "fresh",
    observed_at: receipt.created_at,
    expires_at: receipt.effect_expires_at,
    content: { kind: "structured", value },
  };
}
