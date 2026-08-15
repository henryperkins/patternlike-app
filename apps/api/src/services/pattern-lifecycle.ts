import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { UserIdentity } from "../db/users.js";
import { loadPatternGenerationGrant, insertPatternConsentRevoke, loadLatestPatternConsent } from "../db/pattern-consents.js";
import { hashChartFingerprint, loadClaimForFingerprint, loadAnyClaim } from "../db/pattern-claims.js";
import { loadActiveChart, loadActivePatternDocument, loadAnyPatternDocument } from "./pattern-state.js";
import { enqueuePatternGeneration } from "./pattern-enqueue.js";
import { PATTERN_JOB_TYPE } from "./pattern-command.js";
import { isOntologyRecalled, recallOntologyVersion } from "../db/pattern-ontology.js";
import { safeLog } from "./safe-log.js";

async function deleteGenerationObjects(env: Env, generationId: string): Promise<void> {
  if (!env.ARTIFACTS) return;
  let cursor: string | undefined;
  do {
    const page = await env.ARTIFACTS.list({ prefix: `pattern-generations/${generationId}/`, cursor });
    const keys = page.objects.map((object) => object.key);
    if (keys.length > 0) await env.ARTIFACTS.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function revokePatternGenerationConsent(
  env: Env,
  identity: UserIdentity,
  now = new Date(),
): Promise<{ retained: boolean }> {
  const latest = await loadLatestPatternConsent(env, identity.userId);
  const nowIso = now.toISOString();
  // Driven by the stored row, not by loadPatternGenerationGrant. That helper
  // returns null once the consent policy version moves, which is the normal
  // mechanism for forcing re-consent -- gating the revoke on it made this a
  // silent no-op for exactly the users whose consent was still recorded as
  // granted, and the account export would then show it as granted after they
  // had revoked it.
  if (latest && latest.status === "granted") {
    const consentId = newId("cns");
    await env.DB.batch([
      insertPatternConsentRevoke(env, identity.userId, consentId, latest.version + 1, latest.id, nowIso),
      env.DB.prepare(
        `UPDATE pattern_generation_jobs
         SET stage = 'cancelled', cancellation_reason = 'consent_revoked', updated_at = ?, finished_at = ?
         WHERE user_id = ? AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
      ).bind(nowIso, nowIso, identity.userId),
      env.DB.prepare(
        `UPDATE jobs SET status = 'cancelled', claim_token = NULL, lease_expires_at = NULL,
                finished_at = ?, result_class = 'consent_revoked'
         WHERE user_id = ? AND job_type = ? AND status IN ('queued', 'running')`,
      ).bind(nowIso, identity.userId, PATTERN_JOB_TYPE),
      env.DB.prepare(
        `UPDATE pattern_generation_claims
         SET status = 'available', active_generation_id = NULL, updated_at = ?
         WHERE user_id = ? AND status = 'reserved' AND consumed_at IS NULL`,
      ).bind(nowIso, identity.userId),
    ]);
  }
  const chart = await loadActiveChart(env, identity.userId);
  const fingerprintHash = chart ? await hashChartFingerprint(chart.fingerprint) : null;
  const document = fingerprintHash
    ? await loadActivePatternDocument(env, identity.userId, fingerprintHash)
    : await loadAnyPatternDocument(env, identity.userId);
  return { retained: !!document };
}

export async function deleteCurrentPattern(
  env: Env,
  identity: UserIdentity,
  now = new Date(),
): Promise<"gone" | "accepted"> {
  const chart = await loadActiveChart(env, identity.userId);
  if (!chart) return "gone";
  const fingerprintHash = await hashChartFingerprint(chart.fingerprint);
  const document = await loadActivePatternDocument(env, identity.userId, fingerprintHash);
  if (!document) return "gone";
  const nowIso = now.toISOString();
  // Every attempt gets its own content key, and a generation that failed
  // verification keeps both its key row and its R2 objects until the retention
  // sweep reaches them. Scoping erasure to the accepted generation would leave
  // the earlier attempts' fact packets and rejected drafts decryptable for the
  // rest of that window, which is not what "permanently erased" says. The
  // reconcile and ontology-recall paths already erase user-wide; this matches.
  const { results: generations } = await env.DB.prepare(
    `SELECT generation_id FROM pattern_generation_jobs WHERE user_id = ?`,
  )
    .bind(identity.userId)
    .all<{ generation_id: string }>();

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM pattern_documents WHERE user_id = ? AND id = ?`).bind(identity.userId, document.id),
    env.DB.prepare(
      `UPDATE pattern_generation_artifact_keys
       SET wrapped_key_enc = NULL, wrapped_key_version = NULL, wrapped_key_nonce = NULL, erased_at = ?
       WHERE user_id = ? AND erased_at IS NULL`,
    ).bind(nowIso, identity.userId),
    env.DB.prepare(
      `UPDATE pattern_generation_claims
       SET status = 'deleted', consumed_at = COALESCE(consumed_at, ?), deleted_at = ?,
           active_generation_id = NULL, updated_at = ?
       WHERE user_id = ? AND id = (
         SELECT claim_id FROM pattern_generation_jobs WHERE generation_id = ?
       )`,
    ).bind(nowIso, nowIso, nowIso, identity.userId, document.generation_id),
    env.DB.prepare(
      `UPDATE jobs SET payload_enc = NULL, payload_key_version = NULL, payload_nonce = NULL
       WHERE user_id = ? AND job_type = ?`,
    ).bind(identity.userId, PATTERN_JOB_TYPE),
    env.DB.prepare(
      `INSERT INTO audit_events
         (id, actor_type, actor_id, action, resource_type, resource_id, result, detail_class, created_at)
       VALUES (?, 'user', ?, 'pattern.deleted', 'pattern', ?, 'success', 'deleted', ?)`,
    ).bind(newId("aud"), identity.userId, document.id, nowIso),
  ]);
  for (const row of generations) {
    await deleteGenerationObjects(env, row.generation_id);
  }
  return "accepted";
}

export async function reconcilePatternAfterChartCorrection(
  env: Env,
  identity: UserIdentity,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  const document = await loadAnyPatternDocument(env, identity.userId);
  const { results: generations } = await env.DB.prepare(
    `SELECT generation_id FROM pattern_generation_jobs WHERE user_id = ?`,
  )
    .bind(identity.userId)
    .all<{ generation_id: string }>();

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM pattern_documents WHERE user_id = ?`).bind(identity.userId),
    env.DB.prepare(
      `UPDATE pattern_generation_jobs
       SET stage = 'cancelled', cancellation_reason = 'chart_correction', updated_at = ?, finished_at = ?
       WHERE user_id = ? AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
    ).bind(nowIso, nowIso, identity.userId),
    env.DB.prepare(
      `UPDATE jobs SET status = 'cancelled', claim_token = NULL, lease_expires_at = NULL,
              finished_at = ?, result_class = 'chart_correction'
       WHERE user_id = ? AND job_type = ? AND status IN ('queued', 'running')`,
    ).bind(nowIso, identity.userId, PATTERN_JOB_TYPE),
    env.DB.prepare(
      `UPDATE jobs SET payload_enc = NULL, payload_key_version = NULL, payload_nonce = NULL
       WHERE user_id = ? AND job_type = ?`,
    ).bind(identity.userId, PATTERN_JOB_TYPE),
    env.DB.prepare(
      `UPDATE pattern_generation_artifact_keys
       SET wrapped_key_enc = NULL, wrapped_key_version = NULL, wrapped_key_nonce = NULL, erased_at = ?
       WHERE user_id = ? AND erased_at IS NULL`,
    ).bind(nowIso, identity.userId),
    document
      ? env.DB.prepare(
          `UPDATE pattern_generation_claims
           SET status = 'superseded', consumed_at = COALESCE(consumed_at, ?), superseded_at = ?,
               active_generation_id = NULL, updated_at = ?
           WHERE user_id = ? AND chart_fingerprint_hash = ?`,
        ).bind(nowIso, nowIso, nowIso, identity.userId, document.chart_fingerprint_hash)
      : env.DB.prepare(
          `UPDATE pattern_generation_claims
           SET status = 'available', active_generation_id = NULL, updated_at = ?
           WHERE user_id = ? AND status = 'reserved' AND consumed_at IS NULL`,
        ).bind(nowIso, identity.userId),
  ]);

  for (const row of generations) {
    await deleteGenerationObjects(env, row.generation_id);
  }

  const grant = await loadPatternGenerationGrant(env, identity.userId, now);
  if (!grant) return;
  try {
    const reserved = await enqueuePatternGeneration(
      env,
      identity,
      {
        idempotencyKey: `chart_correction:${nowIso}:${identity.userId}`,
        consentPolicyVersion: grant.policyVersion,
        reason: "chart_correction",
        requestId: "chart_correction",
      },
      now,
    );
    if (!reserved.ok) {
      safeLog({ event: "pattern_dispatch_failed" });
    }
  } catch {
    safeLog({ event: "pattern_dispatch_failed" });
  }
}

export async function patternHasStaleCorrectionLeftover(
  env: Env,
  userId: string,
): Promise<boolean> {
  const chart = await loadActiveChart(env, userId);
  const activeHash = chart ? await hashChartFingerprint(chart.fingerprint) : null;
  const document = await loadAnyPatternDocument(env, userId);
  if (document && (!activeHash || document.chart_fingerprint_hash !== activeHash)) {
    return true;
  }
  const leftoverJob = await env.DB.prepare(
    `SELECT 1 AS present
     FROM pattern_generation_jobs p
     JOIN jobs j ON j.id = p.job_id
     WHERE p.user_id = ?
       AND (? IS NULL OR p.chart_fingerprint_hash != ?)
       AND j.payload_enc IS NOT NULL
     LIMIT 1`,
  )
    .bind(userId, activeHash, activeHash)
    .first<{ present: number }>();
  return !!leftoverJob;
}

export async function retryPatternReconcileIfStale(
  env: Env,
  identity: UserIdentity,
  now = new Date(),
): Promise<void> {
  if (await patternHasStaleCorrectionLeftover(env, identity.userId)) {
    await reconcilePatternAfterChartCorrection(env, identity, now);
  }
}

export async function recallOntologyAndWithdraw(
  env: Env,
  version: string,
  reasonClass: string,
): Promise<number> {
  const existing = await env.DB.prepare(
    `SELECT status FROM pattern_ontology_releases WHERE version = ?`,
  )
    .bind(version)
    .first<{ status: string }>();
  if (!existing) return 0;
  if (existing.status !== "recalled") {
    const flipped = await recallOntologyVersion(env, version, reasonClass);
    if (!flipped && !(await isOntologyRecalled(env, version))) return 0;
  }
  const now = new Date().toISOString();
  const { results: jobs } = await env.DB.prepare(
    `SELECT generation_id, user_id FROM pattern_generation_jobs WHERE ontology_version = ?`,
  )
    .bind(version)
    .all<{ generation_id: string; user_id: string }>();
  const { results: documents } = await env.DB.prepare(
    `SELECT id, user_id, generation_id FROM pattern_documents WHERE ontology_version = ?`,
  )
    .bind(version)
    .all<{ id: string; user_id: string; generation_id: string }>();

  const seen = new Set<string>();
  const generations: Array<{ generation_id: string; user_id: string }> = [];
  for (const row of [...jobs, ...documents]) {
    if (seen.has(row.generation_id)) continue;
    seen.add(row.generation_id);
    generations.push({ generation_id: row.generation_id, user_id: row.user_id });
  }

  for (const row of generations) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM pattern_documents WHERE generation_id = ?`).bind(row.generation_id),
      env.DB.prepare(
        `UPDATE pattern_generation_jobs
         SET stage = 'cancelled', cancellation_reason = 'ontology_recalled', updated_at = ?, finished_at = ?
         WHERE generation_id = ? AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
      ).bind(now, now, row.generation_id),
      env.DB.prepare(
        `UPDATE jobs SET status = 'cancelled', claim_token = NULL, lease_expires_at = NULL,
                finished_at = ?, result_class = 'ontology_recalled',
                payload_enc = NULL, payload_key_version = NULL, payload_nonce = NULL
         WHERE id = (SELECT job_id FROM pattern_generation_jobs WHERE generation_id = ?)
           AND status IN ('queued', 'running')`,
      ).bind(now, row.generation_id),
      env.DB.prepare(
        `UPDATE jobs SET payload_enc = NULL, payload_key_version = NULL, payload_nonce = NULL
         WHERE id = (SELECT job_id FROM pattern_generation_jobs WHERE generation_id = ?)`,
      ).bind(row.generation_id),
      env.DB.prepare(
        `UPDATE pattern_generation_claims
         SET status = 'withdrawn', consumed_at = COALESCE(consumed_at, ?), withdrawn_at = ?,
             active_generation_id = NULL, updated_at = ?
         WHERE user_id = ? AND id = (
           SELECT claim_id FROM pattern_generation_jobs WHERE generation_id = ?
         ) AND status = 'accepted'`,
      ).bind(now, now, now, row.user_id, row.generation_id),
      env.DB.prepare(
        `UPDATE pattern_generation_claims
         SET status = 'available', active_generation_id = NULL, updated_at = ?
         WHERE user_id = ? AND id = (
           SELECT claim_id FROM pattern_generation_jobs WHERE generation_id = ?
         ) AND status = 'reserved' AND consumed_at IS NULL`,
      ).bind(now, row.user_id, row.generation_id),
      env.DB.prepare(
        `UPDATE pattern_generation_artifact_keys
         SET wrapped_key_enc = NULL, wrapped_key_version = NULL, wrapped_key_nonce = NULL, erased_at = ?
         WHERE generation_id = ? AND user_id = ?`,
      ).bind(now, row.generation_id, row.user_id),
    ]);
    await deleteGenerationObjects(env, row.generation_id);
  }
  return documents.length;
}

export { loadAnyClaim, hashChartFingerprint, loadClaimForFingerprint };
