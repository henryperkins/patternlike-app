import {
  M7_SCHEMA_VERSION,
  PATTERN_CONSENT_CATEGORIES,
  PATTERN_GENERATION_CONSENT_POLICY_VERSION,
  type PatternConsent,
  type PatternConsentCategory,
} from "@patternlike/shared";
import type { Env } from "../env.js";

export const PATTERN_GENERATION_KIND = "pattern_generation" as const;

export interface PatternGenerationGrant {
  consentId: string;
  policyVersion: string;
  categories: readonly PatternConsentCategory[];
  grantedAt: string;
}

interface ConsentRow {
  id: string;
  status: string;
  policy_version: string;
  granted_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  version: number;
}

async function loadLatest(env: Env, userId: string): Promise<ConsentRow | null> {
  return env.DB.prepare(
    `SELECT id, status, policy_version, granted_at, revoked_at, expires_at, version
     FROM consents
     WHERE user_id = ? AND kind = 'pattern_generation'
     ORDER BY version DESC, created_at DESC, id DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<ConsentRow>();
}

export async function loadPatternGenerationGrant(
  env: Env,
  userId: string,
  now = new Date(),
): Promise<PatternGenerationGrant | null> {
  const row = await loadLatest(env, userId);
  if (
    !row ||
    row.status !== "granted" ||
    !row.granted_at ||
    (row.expires_at !== null && row.expires_at <= now.toISOString())
  ) {
    return null;
  }
  if (row.policy_version !== PATTERN_GENERATION_CONSENT_POLICY_VERSION) return null;
  return {
    consentId: row.id,
    policyVersion: row.policy_version,
    categories: PATTERN_CONSENT_CATEGORIES,
    grantedAt: row.granted_at,
  };
}

export function patternConsentDocument(
  grant: PatternGenerationGrant | null,
  extras: Partial<PatternConsent> = {},
): PatternConsent {
  return {
    schema_version: M7_SCHEMA_VERSION,
    kind: "pattern_generation",
    status: grant ? "granted" : "not_granted",
    provider: "OpenAI",
    purpose: "one_pattern_per_chart",
    policy_version: PATTERN_GENERATION_CONSENT_POLICY_VERSION,
    enabled_categories: [...PATTERN_CONSENT_CATEGORIES],
    granted_at: grant?.grantedAt ?? null,
    ...extras,
  };
}

export async function latestPatternConsentVersion(env: Env, userId: string): Promise<number> {
  const row = await loadLatest(env, userId);
  return row?.version ?? 0;
}

export function insertPatternConsentGrant(
  env: Env,
  userId: string,
  consentId: string,
  version: number,
  supersedes: string | null,
  now: string,
) {
  return env.DB.prepare(
    `INSERT INTO consents (
       id, user_id, kind, status, source_id, permission_tier, allowed_uses_json,
       scopes_json, provider, policy_version, ui_surface, granted_at, version,
       supersedes_consent_id, created_at, updated_at
     ) VALUES (?, ?, 'pattern_generation', 'granted', NULL, 0, '[]', '[]',
               'OpenAI', ?, 'pattern_first_open', ?, ?, ?, ?, ?)`,
  ).bind(
    consentId,
    userId,
    PATTERN_GENERATION_CONSENT_POLICY_VERSION,
    now,
    version,
    supersedes,
    now,
    now,
  );
}

export function insertPatternConsentRevoke(
  env: Env,
  userId: string,
  consentId: string,
  version: number,
  supersedes: string,
  now: string,
) {
  return env.DB.prepare(
    `INSERT INTO consents (
       id, user_id, kind, status, source_id, permission_tier, allowed_uses_json,
       scopes_json, provider, policy_version, ui_surface, granted_at, revoked_at,
       version, supersedes_consent_id, created_at, updated_at
     ) VALUES (?, ?, 'pattern_generation', 'revoked', NULL, 0, '[]', '[]',
               'OpenAI', ?, 'pattern_privacy', NULL, ?, ?, ?, ?, ?)`,
  ).bind(
    consentId,
    userId,
    PATTERN_GENERATION_CONSENT_POLICY_VERSION,
    now,
    version,
    supersedes,
    now,
    now,
  );
}

export { loadLatest as loadLatestPatternConsent };
