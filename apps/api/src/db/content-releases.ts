import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";

/**
 * Release metadata and the single-row activation pointer.
 *
 * The bundle itself is an immutable object in R2; D1 holds only what has to be
 * queryable and what has to change — status and which version is live. The
 * launch criterion is that "WordPress release activation and rollback are
 * atomic and auditable", so every write that moves the pointer goes through
 * {@link activateRelease} as one `batch()` (a single D1 transaction) that also
 * writes the audit row. A pointer moved without its audit event, or a release
 * marked active while the pointer still names its predecessor, are both states
 * this module refuses to make reachable.
 */

export interface ContentReleaseRow {
  version: string;
  bundle_hash: string;
  status: string;
  r2_uri: string | null;
  approver_id: string;
  last_author_id: string;
  changelog: string;
  calc_contract_id: string | null;
  activated_at: string | null;
  created_at: string;
}

export interface ReleaseRecord {
  version: string;
  bundleHash: string;
  r2Uri: string | null;
  approverId: string;
  lastAuthorId: string;
  changelog: string;
  calcContractId: string | null;
}

export interface AuditEntry {
  action: string;
  resourceId: string | null;
  result: "success" | "failure" | "denied";
  detailClass: string | null;
  /** The signing key that presented the bundle, when one was resolved. */
  actorId: string | null;
}

const SELECT_COLUMNS = `version, bundle_hash, status, r2_uri, approver_id,
       last_author_id, changelog, calc_contract_id, activated_at, created_at`;

export async function findReleaseByVersion(
  env: Env,
  version: string,
): Promise<ContentReleaseRow | null> {
  return env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} FROM content_releases WHERE version = ?`,
  )
    .bind(version)
    .first<ContentReleaseRow>();
}

/**
 * `bundle_hash` is UNIQUE, so this is what catches the same bytes arriving
 * under a second version name — a release that would otherwise be servable
 * twice under two identities, with two different `reading_key`s citing it.
 */
export async function findReleaseByBundleHash(
  env: Env,
  bundleHash: string,
): Promise<ContentReleaseRow | null> {
  return env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} FROM content_releases WHERE bundle_hash = ?`,
  )
    .bind(bundleHash)
    .first<ContentReleaseRow>();
}

export async function getActiveVersion(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT active_version FROM content_release_pointer WHERE id = 1`,
  ).first<{ active_version: string }>();
  return row?.active_version ?? null;
}

/** The active release row, for the milestone that assembles readings from it. */
export async function getActiveRelease(env: Env): Promise<ContentReleaseRow | null> {
  return env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} FROM content_releases
     WHERE version = (SELECT active_version FROM content_release_pointer WHERE id = 1)`,
  ).first<ContentReleaseRow>();
}

function auditStatement(env: Env, entry: AuditEntry, now: string) {
  return env.DB.prepare(
    `INSERT INTO audit_events
       (id, actor_type, actor_id, action, resource_type, resource_id, result, detail_class, created_at)
     VALUES (?, 'service', ?, ?, 'content_release', ?, ?, ?, ?)`,
  ).bind(
    newId("aud"),
    entry.actorId,
    entry.action,
    entry.resourceId,
    entry.result,
    entry.detailClass,
    now,
  );
}

/** Record a refusal. Opaque class only — never bundle content. */
export async function recordAudit(
  env: Env,
  entry: AuditEntry,
  now = new Date().toISOString(),
): Promise<void> {
  await auditStatement(env, entry, now).run();
}

function insertReleaseStatement(
  env: Env,
  record: ReleaseRecord,
  status: "submitted" | "active",
  now: string,
) {
  // ON CONFLICT targets `version` specifically: a bundle_hash collision under a
  // different version must still raise rather than be quietly absorbed. The
  // update list is deliberately short — created_at, approver_id, and
  // last_author_id belong to the release as first seen, and a bundle whose
  // hash matched cannot have changed them anyway.
  return env.DB.prepare(
    `INSERT INTO content_releases
       (version, bundle_hash, status, r2_uri, approver_id, last_author_id,
        changelog, calc_contract_id, activated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(version) DO UPDATE SET
       status = excluded.status,
       r2_uri = COALESCE(excluded.r2_uri, content_releases.r2_uri),
       activated_at = COALESCE(excluded.activated_at, content_releases.activated_at)`,
  ).bind(
    record.version,
    record.bundleHash,
    status,
    record.r2Uri,
    record.approverId,
    record.lastAuthorId,
    record.changelog,
    record.calcContractId,
    status === "active" ? now : null,
    now,
  );
}

/**
 * Store a release without making it live.
 *
 * Used when the caller passed `activate: false`, and when the bundle declares
 * smoke-test fixtures this milestone cannot run.
 */
export async function storeRelease(
  env: Env,
  record: ReleaseRecord,
  audit: AuditEntry,
  now = new Date().toISOString(),
): Promise<void> {
  await env.DB.batch([
    insertReleaseStatement(env, record, "submitted", now),
    auditStatement(env, audit, now),
  ]);
}

/**
 * Store and activate in one transaction.
 *
 * Statement order is load-bearing: the previous active release is superseded
 * first (guarded by `version <> ?` so a re-activation of the same version does
 * not supersede itself), the release row must exist before the pointer can
 * reference it (`content_release_pointer.active_version` is a foreign key), and
 * the audit row lands inside the same transaction as the change it describes.
 *
 * This is also the rollback path. Re-posting a previously stored bundle moves
 * the pointer back to it, which is exactly the spec's "rollback changes the
 * active release pointer; it does not require editing previously published
 * readings".
 */
export async function activateRelease(
  env: Env,
  record: ReleaseRecord,
  audit: AuditEntry,
  now = new Date().toISOString(),
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE content_releases SET status = 'superseded'
       WHERE status = 'active' AND version <> ?`,
    ).bind(record.version),
    insertReleaseStatement(env, record, "active", now),
    env.DB.prepare(
      `INSERT INTO content_release_pointer (id, active_version, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         active_version = excluded.active_version,
         updated_at = excluded.updated_at`,
    ).bind(record.version, now),
    auditStatement(env, audit, now),
  ]);
}
