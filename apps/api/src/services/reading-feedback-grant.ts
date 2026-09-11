import type { ConstrainedContextSourceInput } from "@patternlike/reading-engine";
import type { Env } from "../env.js";
import { USR12_ALLOWED_USES, USR12_PERMISSION_TIER, USR12_POLICY_VERSION } from "../db/first-party-sources.js";

interface FeedbackGrantRow {
  enabled: number;
  permission_state: string;
  permission_tier: number;
  permission_allowed_uses_json: string;
  consent_id: string;
  consent_kind: string;
  consent_source_id: string;
  consent_status: string;
  consent_version: number;
  consent_tier: number;
  consent_policy: string;
  consent_expires_at: string | null;
  consent_allowed_uses_json: string;
}

function feedbackUses(raw: string): string[] | null {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((use) => typeof use === "string" && USR12_ALLOWED_USES.includes(use as never))
      ? value : null;
  } catch { return null; }
}

/** New categorical semantics validate the live grant without changing legacy pin loading. */
export async function loadCurrentCategoricalFeedbackGrant(
  env: Env, userId: string, now: Date,
): Promise<ConstrainedContextSourceInput | null> {
  if (!Number.isFinite(now.getTime())) return null;
  const row = await env.DB.prepare(`SELECT p.enabled,p.permission_state,p.permission_tier,
      p.allowed_uses_json AS permission_allowed_uses_json,c.id AS consent_id,c.kind AS consent_kind,
      c.source_id AS consent_source_id,c.status AS consent_status,c.version AS consent_version,
      c.permission_tier AS consent_tier,c.policy_version AS consent_policy,c.expires_at AS consent_expires_at,
      c.allowed_uses_json AS consent_allowed_uses_json
    FROM context_source_permissions p JOIN consents c ON c.id = p.consent_id AND c.user_id = p.user_id
    WHERE p.user_id = ? AND p.source_id = 'USR-12'`).bind(userId).first<FeedbackGrantRow>();
  if (!row || row.enabled !== 1 || row.permission_state !== "active" ||
    row.permission_tier !== USR12_PERMISSION_TIER || row.consent_tier !== USR12_PERMISSION_TIER ||
    row.consent_kind !== "product_source" || row.consent_source_id !== "USR-12" || row.consent_status !== "granted" ||
    row.consent_policy !== USR12_POLICY_VERSION || !Number.isSafeInteger(row.consent_version) || row.consent_version < 1 ||
    (row.consent_expires_at !== null && !(Date.parse(row.consent_expires_at) > now.getTime()))) return null;
  const permissionUses = feedbackUses(row.permission_allowed_uses_json);
  const consentUses = feedbackUses(row.consent_allowed_uses_json);
  if (!permissionUses || !consentUses) return null;
  return {
    source_id: "USR-12", permission_state: "active", permission_allowed_uses: permissionUses,
    permission_consent_id: row.consent_id, consent_id: row.consent_id, consent_source_id: "USR-12",
    consent_status: "granted", consent_version: row.consent_version, consent_allowed_uses: consentUses,
  };
}
