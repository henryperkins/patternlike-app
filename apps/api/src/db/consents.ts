import {
  AI_CONSENT_DATA_CATEGORIES,
  newId,
  type AiConsentDataCategory,
} from "@patternlike/shared";
import type { ConstrainedContextSourceInput } from "@patternlike/reading-engine";
import type { Env } from "../env.js";
import { decryptPayload, encryptPayload, type UserIdentity } from "./users.js";

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

/**
 * Cursor hook for the grant/revoke primitives introduced with the product
 * routes in Task 13. Kept beside the consent owner so neither route can forget
 * the scheduling consequence of changing the current grant.
 */
export async function refreshReadingCursorAfterAiConsentChange(
  env: Env,
  userId: string,
  now = new Date(),
): Promise<string | null> {
  const { recomputeUserNextDueAt } = await import("./reading-scheduler.js");
  return recomputeUserNextDueAt(env, userId, now);
}

export interface AiSynthesisGrant {
  consentId: string;
  policyVersion: string;
  /** In the frozen display order. A packet section outside this cannot be sent. */
  categories: AiConsentDataCategory[];
  grantedAt: string;
}

export interface AiSynthesisConsentState {
  status: "granted" | "not_granted";
  grantedAt: string | null;
}

interface AiConsentRow {
  id: string;
  status: string;
  policy_version: string;
  granted_at: string | null;
  expires_at: string | null;
  version: number;
  created_at: string;
}

async function loadLatestAiConsent(env: Env, userId: string): Promise<AiConsentRow | null> {
  return env.DB.prepare(
    `SELECT id, status, policy_version, granted_at, expires_at, version, created_at
     FROM consents
     WHERE user_id = ? AND kind = 'ai_synthesis'
     ORDER BY version DESC, created_at DESC, id DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<AiConsentRow>();
}

function activeGrant(
  row: AiConsentRow | null,
  now = new Date(),
): AiSynthesisGrant | null {
  if (
    !row ||
    row.status !== "granted" ||
    !row.granted_at ||
    (row.expires_at !== null && row.expires_at <= now.toISOString())
  ) {
    return null;
  }
  const categories = AI_SYNTHESIS_CATEGORIES_BY_POLICY[row.policy_version];
  if (!categories) return null;
  return {
    consentId: row.id,
    policyVersion: row.policy_version,
    categories: [...categories],
    grantedAt: row.granted_at,
  };
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
  return activeGrant(await loadLatestAiConsent(env, userId));
}

const GRANT_JOB_TYPE = "ai_synthesis_consent_grant";
const REVOKE_JOB_TYPE = "ai_synthesis_consent_revoke";

interface StoredConsentMutation {
  operation: "grant" | "revoke";
  policyVersion: string;
  state: AiSynthesisConsentState;
  cursorRefresh?: {
    required: boolean;
    mutationAt: string;
  };
}

interface ConsentMutationJobRow {
  id: string;
  payload_enc: ArrayBuffer | null;
  payload_key_version: number | null;
  payload_nonce: string | null;
  result_class: string | null;
}

interface StoredConsentMutationRecord {
  jobId: string;
  resultClass: string | null;
  mutation: StoredConsentMutation;
}

export type AiConsentMutationOutcome =
  | { ok: true; state: AiSynthesisConsentState; changed: boolean }
  | { ok: false; reason: "idempotency_conflict" | "conflict" };

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isStoredConsentMutation(value: unknown): value is StoredConsentMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<StoredConsentMutation>;
  const cursorRefresh = record.cursorRefresh;
  const validCursorRefresh =
    cursorRefresh === undefined ||
    (!!cursorRefresh &&
      typeof cursorRefresh === "object" &&
      typeof cursorRefresh.required === "boolean" &&
      typeof cursorRefresh.mutationAt === "string" &&
      Number.isFinite(Date.parse(cursorRefresh.mutationAt)));
  return (
    (record.operation === "grant" || record.operation === "revoke") &&
    typeof record.policyVersion === "string" &&
    !!record.state &&
    (record.state.status === "granted" || record.state.status === "not_granted") &&
    (record.state.grantedAt === null || typeof record.state.grantedAt === "string") &&
    validCursorRefresh
  );
}

async function loadStoredConsentMutation(
  env: Env,
  identity: UserIdentity,
  jobType: string,
  idempotencyKey: string,
): Promise<StoredConsentMutationRecord | null> {
  const row = await env.DB.prepare(
    `SELECT id, payload_enc, payload_key_version, payload_nonce, result_class
     FROM jobs
     WHERE job_type = ? AND user_id = ? AND idempotency_key = ?
       AND status = 'succeeded'`,
  )
    .bind(jobType, identity.userId, idempotencyKey)
    .first<ConsentMutationJobRow>();
  if (!row) return null;
  if (!row.payload_enc || row.payload_key_version === null || !row.payload_nonce) {
    throw new Error("AI consent idempotency record is incomplete");
  }
  const stored = await decryptPayload<unknown>(
    env,
    identity,
    {
      ciphertext: bytesToBase64(row.payload_enc),
      key_version: row.payload_key_version,
      nonce: row.payload_nonce,
    },
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: row.id,
    },
  );
  if (!isStoredConsentMutation(stored)) {
    throw new Error("AI consent idempotency record is invalid");
  }
  return {
    jobId: row.id,
    resultClass: row.result_class,
    mutation: stored,
  };
}

async function mutationInsert(
  env: Env,
  identity: UserIdentity,
  jobType: string,
  idempotencyKey: string,
  stored: StoredConsentMutation,
  now: string,
): Promise<D1PreparedStatement> {
  const jobId = newId("job");
  const sealed = await encryptPayload(env, identity, stored, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: jobId,
  });
  const resultClass = stored.cursorRefresh?.required
    ? "consent_cursor_pending"
    : "consent_no_cursor_change";
  return env.DB.prepare(
    `INSERT INTO jobs
       (id, job_type, user_id, idempotency_key, status, payload_enc,
        payload_key_version, payload_nonce, result_class, attempts,
        finished_at, created_at)
     VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(
    jobId,
    jobType,
    identity.userId,
    idempotencyKey,
    Uint8Array.from(atob(sealed.ciphertext), (character) => character.charCodeAt(0)),
    sealed.keyVersion,
    sealed.nonce,
    resultClass,
    now,
    now,
  );
}

async function finishStoredCursorRefresh(
  env: Env,
  identity: UserIdentity,
  record: StoredConsentMutationRecord,
): Promise<void> {
  const refresh = record.mutation.cursorRefresh;
  if (!refresh?.required || record.resultClass !== "consent_cursor_pending") return;

  await refreshReadingCursorAfterAiConsentChange(
    env,
    identity.userId,
    new Date(refresh.mutationAt),
  );
  await env.DB.prepare(
    `UPDATE jobs SET result_class = 'consent_cursor_refreshed'
     WHERE id = ? AND user_id = ? AND status = 'succeeded'
       AND result_class = 'consent_cursor_pending'`,
  )
    .bind(record.jobId, identity.userId)
    .run();
}

function latestConsentAssertion(
  env: Env,
  userId: string,
  latest: AiConsentRow | null,
): D1PreparedStatement {
  return latest
    ? env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'AI consent state changed concurrently'
         WHERE NOT EXISTS (
           SELECT 1 FROM consents
           WHERE id = ? AND user_id = ? AND kind = 'ai_synthesis'
             AND version = ?
             AND NOT EXISTS (
               SELECT 1 FROM consents newer
               WHERE newer.user_id = consents.user_id
                 AND newer.kind = consents.kind
                 AND (
                   newer.version > consents.version OR
                   (newer.version = consents.version AND newer.created_at > consents.created_at) OR
                   (newer.version = consents.version AND newer.created_at = consents.created_at AND newer.id > consents.id)
                 )
             )
         )`,
      ).bind(latest.id, userId, latest.version)
    : env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'AI consent state appeared concurrently'
         WHERE EXISTS (
           SELECT 1 FROM consents WHERE user_id = ? AND kind = 'ai_synthesis'
         )`,
      ).bind(userId);
}

async function writeAiConsentMutation(
  env: Env,
  identity: UserIdentity,
  input: {
    operation: "grant" | "revoke";
    policyVersion: string;
    idempotencyKey: string;
    now: Date;
  },
): Promise<AiConsentMutationOutcome> {
  const jobType = input.operation === "grant" ? GRANT_JOB_TYPE : REVOKE_JOB_TYPE;
  const replay = await loadStoredConsentMutation(env, identity, jobType, input.idempotencyKey);
  if (replay) {
    if (
      replay.mutation.operation !== input.operation ||
      replay.mutation.policyVersion !== input.policyVersion
    ) {
      return { ok: false, reason: "idempotency_conflict" };
    }
    await finishStoredCursorRefresh(env, identity, replay);
    return { ok: true, state: replay.mutation.state, changed: false };
  }

  const latest = await loadLatestAiConsent(env, identity.userId);
  const now = input.now.toISOString();
  const latestIsLiveGrant =
    latest?.status === "granted" &&
    !!latest.granted_at &&
    (latest.expires_at === null || latest.expires_at > now);
  const changed =
    input.operation === "grant"
      ? !latestIsLiveGrant || latest.policy_version !== input.policyVersion
      : latest?.status === "granted";
  const nextConsentId = changed ? newId("cns") : null;
  const state: AiSynthesisConsentState =
    input.operation === "grant"
      ? changed
        ? { status: "granted", grantedAt: now }
        : { status: "granted", grantedAt: latest!.granted_at }
      : { status: "not_granted", grantedAt: null };
  const stored: StoredConsentMutation = {
    operation: input.operation,
    policyVersion: input.policyVersion,
    state,
    cursorRefresh: {
      required: changed,
      mutationAt: now,
    },
  };
  const statements: D1PreparedStatement[] = [
    latestConsentAssertion(env, identity.userId, latest),
  ];
  if (changed && nextConsentId) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO consents
           (id, user_id, kind, status, provider, policy_version, ui_surface,
            granted_at, revoked_at, version, supersedes_consent_id,
            created_at, updated_at)
         VALUES (?, ?, 'ai_synthesis', ?, 'OpenAI', ?, 'context_privacy',
                 ?, ?, ?, ?, ?, ?)`,
      ).bind(
        nextConsentId,
        identity.userId,
        input.operation === "grant" ? "granted" : "revoked",
        input.policyVersion,
        input.operation === "grant" ? now : null,
        input.operation === "revoke" ? now : null,
        (latest?.version ?? 0) + 1,
        latest?.id ?? null,
        now,
        now,
      ),
    );
  }
  statements.push(
    await mutationInsert(
      env,
      identity,
      jobType,
      input.idempotencyKey,
      stored,
      now,
    ),
  );
  if (changed && nextConsentId) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO audit_events
           (id, actor_type, actor_id, action, resource_type, resource_id,
            result, detail_class, created_at)
         VALUES (?, 'user', ?, ?, 'consent', ?, 'success', 'ai_synthesis', ?)`,
      ).bind(
        newId("aud"),
        identity.userId,
        input.operation === "grant" ? "consent.granted" : "consent.revoked",
        nextConsentId,
        now,
      ),
    );
  }

  try {
    await env.DB.batch(statements);
  } catch {
    const raced = await loadStoredConsentMutation(env, identity, jobType, input.idempotencyKey);
    if (raced) {
      if (
        raced.mutation.operation !== input.operation ||
        raced.mutation.policyVersion !== input.policyVersion
      ) {
        return { ok: false, reason: "idempotency_conflict" };
      }
      await finishStoredCursorRefresh(env, identity, raced);
      return { ok: true, state: raced.mutation.state, changed: false };
    }
    return { ok: false, reason: "conflict" };
  }

  if (changed) {
    await refreshReadingCursorAfterAiConsentChange(env, identity.userId, input.now);
    const inserted = await loadStoredConsentMutation(
      env,
      identity,
      jobType,
      input.idempotencyKey,
    );
    if (!inserted) throw new Error("AI consent idempotency record disappeared");
    await env.DB.prepare(
      `UPDATE jobs SET result_class = 'consent_cursor_refreshed'
       WHERE id = ? AND user_id = ? AND status = 'succeeded'
         AND result_class = 'consent_cursor_pending'`,
    )
      .bind(inserted.jobId, identity.userId)
      .run();
  }
  return { ok: true, state, changed };
}

export async function grantAiSynthesisConsent(
  env: Env,
  identity: UserIdentity,
  policyVersion: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<AiConsentMutationOutcome> {
  return writeAiConsentMutation(env, identity, {
    operation: "grant",
    policyVersion,
    idempotencyKey,
    now,
  });
}

export async function revokeAiSynthesisConsent(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
  now = new Date(),
): Promise<AiConsentMutationOutcome> {
  return writeAiConsentMutation(env, identity, {
    operation: "revoke",
    policyVersion: AI_SYNTHESIS_POLICY_VERSION,
    idempotencyKey,
    now,
  });
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

export class ContextSourceInvariantError extends Error {
  constructor() {
    super("Context-source permission state is inconsistent");
    this.name = "ContextSourceInvariantError";
  }
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
 * it. The stored permission state is preserved. An active/disabled mismatch is
 * an invariant failure, not silently re-labelled as a pause.
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
    if (
      !["active", "paused", "revoked", "expired", "never_granted"].includes(
        row.permission_state,
      ) ||
      (row.enabled === 1) !== (row.permission_state === "active") ||
      row.consent_status === "denied" ||
      row.consent_status === "pending"
    ) {
      throw new ContextSourceInvariantError();
    }
    const consentStatus =
      row.consent_status === "granted"
        ? "granted"
        : row.consent_status === "expired"
          ? "expired"
          : "revoked";
    return {
      source_id: row.source_id,
      permission_state:
        row.permission_state as ConstrainedContextSourceInput["permission_state"],
      permission_allowed_uses: permissionUses,
      permission_consent_id: row.permission_consent_id ?? "",
      consent_id: row.consent_id ?? "",
      consent_source_id: row.consent_source_id ?? "",
      consent_status: consentStatus,
      consent_version: row.consent_version ?? 0,
      consent_allowed_uses: consentUses,
    };
  });
}
