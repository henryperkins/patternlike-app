import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { UserIdentity } from "./users.js";

/**
 * First-party sources that are not on GET/PUT /v1/context-sources.
 *
 * USR-06 and USR-09 are explicit source consents the reader toggles. USR-05
 * (topic exclusions) and USR-12 (reading feedback) are also registry sources
 * and therefore still need a permission + consent row so the constrained
 * compiler's ordinary gate can admit them. They are not added to the
 * context-sources document: that document is a closed pair, and submitting
 * feedback or saving an exclusion is itself the grant.
 */

export const USR05_SOURCE_ID = "USR-05" as const;
export const USR12_SOURCE_ID = "USR-12" as const;

export const USR05_POLICY_VERSION = "usr-05-v1";
export const USR12_POLICY_VERSION = "usr-12-v1";

export const USR05_PERMISSION_TIER = 1 as const;
export const USR12_PERMISSION_TIER = 1 as const;

export const USR05_ALLOWED_USES = [
  "theme_filtering",
  "notification_timing",
] as const;

export const USR12_ALLOWED_USES = [
  "content_quality",
  "repetition_control",
  "theme_ranking",
] as const;

export type FirstPartySourceId = typeof USR05_SOURCE_ID | typeof USR12_SOURCE_ID;

export interface FirstPartyGrant {
  sourceId: FirstPartySourceId;
  consentId: string;
  consentVersion: number;
  allowedUses: readonly string[];
}

interface GrantRow {
  permission_state: string;
  enabled: number;
  permission_allowed_uses_json: string;
  permission_consent_id: string | null;
  consent_id: string | null;
  consent_source_id: string | null;
  consent_status: string | null;
  consent_version: number | null;
  consent_allowed_uses_json: string | null;
}

function config(sourceId: FirstPartySourceId) {
  return sourceId === USR05_SOURCE_ID
    ? {
        uses: USR05_ALLOWED_USES,
        tier: USR05_PERMISSION_TIER,
        policy: USR05_POLICY_VERSION,
        surface: "privacy_center",
      }
    : {
        uses: USR12_ALLOWED_USES,
        tier: USR12_PERMISSION_TIER,
        policy: USR12_POLICY_VERSION,
        surface: "today_reading",
      };
}

function parseUses(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function sameUses(value: readonly string[], wanted: readonly string[]): boolean {
  return value.length === wanted.length && value.every((item, index) => item === wanted[index]);
}

/**
 * The active grant for a first-party source, created on first write.
 *
 * Reuses the current consent when it is already an active, matching grant so
 * a second piece of feedback does not mint a new consent id — execute-time
 * eligibility pins that id, and rotating it on every POST would fail closed
 * a command that was still in flight.
 */
export async function ensureFirstPartyGrant(
  env: Env,
  identity: UserIdentity,
  sourceId: FirstPartySourceId,
  now = new Date(),
): Promise<FirstPartyGrant> {
  const wanted = config(sourceId);
  const row = await env.DB.prepare(
    `SELECT p.permission_state, p.enabled,
            p.allowed_uses_json AS permission_allowed_uses_json,
            p.consent_id AS permission_consent_id,
            c.id AS consent_id,
            c.source_id AS consent_source_id,
            c.status AS consent_status,
            c.version AS consent_version,
            c.allowed_uses_json AS consent_allowed_uses_json
     FROM context_source_permissions p
     LEFT JOIN consents c ON c.id = p.consent_id AND c.user_id = p.user_id
     WHERE p.user_id = ? AND p.source_id = ?`,
  )
    .bind(identity.userId, sourceId)
    .first<GrantRow>();

  const permissionUses = parseUses(row?.permission_allowed_uses_json ?? null);
  const consentUses = parseUses(row?.consent_allowed_uses_json ?? null);
  if (
    row &&
    row.permission_state === "active" &&
    row.enabled === 1 &&
    row.permission_consent_id &&
    row.consent_id === row.permission_consent_id &&
    row.consent_source_id === sourceId &&
    row.consent_status === "granted" &&
    row.consent_version !== null &&
    permissionUses !== null &&
    consentUses !== null &&
    sameUses(permissionUses, wanted.uses) &&
    sameUses(consentUses, wanted.uses)
  ) {
    return {
      sourceId,
      consentId: row.consent_id,
      consentVersion: row.consent_version,
      allowedUses: wanted.uses,
    };
  }

  const latest = await env.DB.prepare(
    `SELECT id, version FROM consents
     WHERE user_id = ? AND kind = 'product_source' AND source_id = ?
     ORDER BY version DESC, created_at DESC, id DESC LIMIT 1`,
  )
    .bind(identity.userId, sourceId)
    .first<{ id: string; version: number }>();

  const consentId = newId("cns");
  const version = (latest?.version ?? 0) + 1;
  const nowIso = now.toISOString();
  const usesJson = JSON.stringify(wanted.uses);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO consents (
         id, user_id, kind, status, source_id, permission_tier,
         allowed_uses_json, scopes_json, policy_version, ui_surface,
         granted_at, version, supersedes_consent_id, created_at, updated_at
       ) VALUES (?, ?, 'product_source', 'granted', ?, ?, ?, '[]', ?,
                 ?, ?, ?, ?, ?, ?)`,
    ).bind(
      consentId,
      identity.userId,
      sourceId,
      wanted.tier,
      usesJson,
      wanted.policy,
      wanted.surface,
      nowIso,
      version,
      latest?.id ?? null,
      nowIso,
      nowIso,
    ),
    env.DB.prepare(
      `INSERT INTO context_source_permissions (
         user_id, source_id, enabled, permission_state, allowed_uses_json,
         permission_tier, consent_id, scopes_json, connector_status,
         last_signal_id, updated_at
       ) VALUES (?, ?, 1, 'active', ?, ?, ?, '[]', 'not_applicable', NULL, ?)
       ON CONFLICT(user_id, source_id) DO UPDATE SET
         enabled = 1, permission_state = 'active',
         allowed_uses_json = excluded.allowed_uses_json,
         permission_tier = excluded.permission_tier,
         consent_id = excluded.consent_id,
         scopes_json = excluded.scopes_json,
         connector_status = excluded.connector_status,
         updated_at = excluded.updated_at`,
    ).bind(
      identity.userId,
      sourceId,
      usesJson,
      wanted.tier,
      consentId,
      nowIso,
    ),
  ]);

  return {
    sourceId,
    consentId,
    consentVersion: version,
    allowedUses: wanted.uses,
  };
}
