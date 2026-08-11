import {
  AI_CONSENT_DATA_CATEGORIES,
  type AiConsentDataCategory,
} from "@patternlike/shared";
import type { ConstrainedContextSourceInput } from "@patternlike/reading-engine";
import type { Env } from "../env.js";

/**
 * The consent reads the publisher depends on.
 *
 * Two different things live here and must not be conflated. `ai_synthesis` is
 * the outer ACCOUNT-level purpose consent: it authorizes sending anything at all
 * to a model, and it is not an `allowed_use`. A source consent authorizes one
 * registered context source for specific uses. Granting the first can never make
 * a signal eligible; refusing it makes every signal ineligible.
 */

/**
 * The consent policy the product currently displays.
 *
 * The category list is SERVER-owned per policy version rather than stored on the
 * row: a user who agreed to seven categories has not agreed to an eighth, so
 * adding one has to be a new version and a fresh grant, and a stored list would
 * make that a data migration instead of a decision.
 */
export const AI_SYNTHESIS_POLICY_VERSION = "1.0.0";

export const AI_SYNTHESIS_CATEGORIES_BY_POLICY: Readonly<
  Record<string, readonly AiConsentDataCategory[]>
> = Object.freeze({
  [AI_SYNTHESIS_POLICY_VERSION]: AI_CONSENT_DATA_CATEGORIES,
});

export interface AiSynthesisGrant {
  consentId: string;
  policyVersion: string;
  /** In the frozen display order. A packet section outside this cannot be sent. */
  categories: AiConsentDataCategory[];
  grantedAt: string;
}

/**
 * The current `ai_synthesis` grant, or null.
 *
 * A grant under a policy version this deployment does not implement is treated
 * as absent rather than as a grant of unknown scope. That is the fail-closed
 * direction: the alternative is sending data under a category list nobody in
 * this code has ever seen.
 */
export async function loadAiSynthesisGrant(
  env: Env,
  userId: string,
): Promise<AiSynthesisGrant | null> {
  const row = await env.DB.prepare(
    `SELECT id, policy_version, granted_at
     FROM consents
     WHERE user_id = ? AND kind = 'ai_synthesis' AND status = 'granted'
     ORDER BY version DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<{ id: string; policy_version: string; granted_at: string | null }>();
  if (!row) return null;

  const categories = AI_SYNTHESIS_CATEGORIES_BY_POLICY[row.policy_version];
  if (!categories) return null;

  return {
    consentId: row.id,
    policyVersion: row.policy_version,
    categories: [...categories],
    grantedAt: row.granted_at ?? "",
  };
}

interface SourceGrantRow {
  source_id: string;
  enabled: number;
  permission_state: string;
  permission_allowed_uses_json: string;
  permission_consent_id: string | null;
  consent_id: string | null;
  consent_source_id: string | null;
  consent_status: string | null;
  consent_version: number | null;
  consent_allowed_uses_json: string | null;
}

function parseUses(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((use): use is string => typeof use === "string");
  } catch {
    return null;
  }
}

/**
 * Every context source this user has a permission row for, with the consent it
 * names.
 *
 * Both halves are returned unjudged. The compiler decides eligibility, including
 * the case where the two disagree — a permission naming a different consent, a
 * consent naming a different source, or two different allowed-use arrays. That
 * decision belongs in one place, and a loader that quietly filtered here would
 * be a second, invisible copy of it.
 *
 * A permission row with no consent at all is still returned, with the consent
 * half emptied, so the compiler rejects it for a reason rather than never seeing
 * it. `enabled = 0` is folded into the permission state for the same reason the
 * state exists: a disabled source is not active, whatever the column says.
 */
export async function loadContextSourceGrants(
  env: Env,
  userId: string,
): Promise<ConstrainedContextSourceInput[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.source_id,
            p.enabled,
            p.permission_state,
            p.allowed_uses_json AS permission_allowed_uses_json,
            p.consent_id AS permission_consent_id,
            c.id AS consent_id,
            c.source_id AS consent_source_id,
            c.status AS consent_status,
            c.version AS consent_version,
            c.allowed_uses_json AS consent_allowed_uses_json
     FROM context_source_permissions p
     LEFT JOIN consents c ON c.id = p.consent_id AND c.user_id = p.user_id
     WHERE p.user_id = ?
     ORDER BY p.source_id`,
  )
    .bind(userId)
    .all<SourceGrantRow>();

  return results.map((row) => {
    const permissionUses = parseUses(row.permission_allowed_uses_json) ?? [];
    const consentUses = parseUses(row.consent_allowed_uses_json) ?? [];
    const state = row.enabled === 1 ? row.permission_state : "paused";
    return {
      source_id: row.source_id,
      permission_state: state as ConstrainedContextSourceInput["permission_state"],
      permission_allowed_uses: permissionUses,
      permission_consent_id: row.permission_consent_id ?? "",
      consent_id: row.consent_id ?? "",
      consent_source_id: row.consent_source_id ?? "",
      consent_status: (row.consent_status ??
        "revoked") as ConstrainedContextSourceInput["consent_status"],
      consent_version: row.consent_version ?? 0,
      consent_allowed_uses: consentUses,
    };
  });
}
