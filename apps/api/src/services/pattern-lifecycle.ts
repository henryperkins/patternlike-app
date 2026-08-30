import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { UserIdentity } from "../db/users.js";
import { loadPatternGenerationGrant, insertPatternConsentRevoke, loadLatestPatternConsent } from "../db/pattern-consents.js";
import { hashChartFingerprint, loadClaimForFingerprint, loadAnyClaim } from "../db/pattern-claims.js";
import {
  deleteAcceptedPatternClaim,
  releaseUnconsumedPatternClaim,
  releaseUserPatternClaims,
  releaseUserPatternRegenerations,
  supersedeAcceptedPatternClaim,
  withdrawAcceptedPatternClaim,
} from "../db/pattern-claim-transitions.js";
import { loadActiveChart, loadActivePatternDocument, loadAnyPatternDocument } from "./pattern-state.js";
import { enqueuePatternGeneration } from "./pattern-enqueue.js";
import { PATTERN_JOB_TYPE } from "./pattern-command.js";
import { isOntologyRecalled, recallOntologyVersion } from "../db/pattern-ontology.js";
import { safeLog } from "./safe-log.js";
import {
  patternReplayEventId,
  writePatternReplayIntent,
} from "./pattern-replay-ledger.js";

export async function deleteGenerationObjects(env: Env, generationId: string): Promise<void> {
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
      releaseUserPatternClaims(env, { userId: identity.userId, now: nowIso }),
      releaseUserPatternRegenerations(env, {
        userId: identity.userId,
        now: nowIso,
      }),
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
  idempotencyKey: string,
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
  const replay = await writePatternReplayIntent(env, {
    eventClass: "pattern_deleted",
    semanticOperationKey: `${identity.userId}:${idempotencyKey}`,
    targetUserId: identity.userId,
    chartFingerprintHash: document.chart_fingerprint_hash,
    claimId: document.claim_id,
    generationId: document.generation_id,
    patternId: document.id,
    ontologyVersion: document.ontology_version,
    priorClaimStatus: "accepted",
    nextClaimStatus: "deleted",
  }, now);

  await env.DB.batch([
    ...replay.receiptStatements(env),
    env.DB.prepare(`DELETE FROM pattern_documents WHERE user_id = ? AND id = ?`).bind(identity.userId, document.id),
    env.DB.prepare(
      `UPDATE pattern_generation_jobs
       SET stage = 'cancelled', cancellation_reason = 'pattern_deleted',
           updated_at = ?, finished_at = ?
       WHERE user_id = ? AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
    ).bind(nowIso, nowIso, identity.userId),
    env.DB.prepare(
      `UPDATE jobs
       SET status = 'cancelled', claim_token = NULL, lease_expires_at = NULL,
           finished_at = ?, result_class = 'pattern_deleted'
       WHERE user_id = ? AND job_type = ? AND status IN ('queued', 'running')`,
    ).bind(nowIso, identity.userId, PATTERN_JOB_TYPE),
    releaseUserPatternRegenerations(env, {
      userId: identity.userId,
      now: nowIso,
    }),
    env.DB.prepare(
      `UPDATE pattern_generation_artifact_keys
       SET wrapped_key_enc = NULL, wrapped_key_version = NULL, wrapped_key_nonce = NULL, erased_at = ?
       WHERE user_id = ? AND erased_at IS NULL`,
    ).bind(nowIso, identity.userId),
    deleteAcceptedPatternClaim(env, {
      claimId: document.claim_id,
      userId: identity.userId,
      now: nowIso,
    }),
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
  newlyActiveChartId: string,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  const document = await loadAnyPatternDocument(env, identity.userId);
  const { results: generations } = await env.DB.prepare(
    `SELECT generation_id FROM pattern_generation_jobs WHERE user_id = ?`,
  )
    .bind(identity.userId)
    .all<{ generation_id: string }>();
  const replay = document
    ? await writePatternReplayIntent(env, {
        eventClass: "chart_correction_erased",
        semanticOperationKey: newlyActiveChartId,
        targetUserId: identity.userId,
        chartFingerprintHash: document.chart_fingerprint_hash,
        claimId: document.claim_id,
        generationId: document.generation_id,
        patternId: document.id,
        ontologyVersion: document.ontology_version,
        priorClaimStatus: "accepted",
        nextClaimStatus: "superseded",
      }, now)
    : null;

  await env.DB.batch([
    ...(replay?.receiptStatements(env) ?? []),
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
    releaseUserPatternRegenerations(env, {
      userId: identity.userId,
      now: nowIso,
    }),
    document
      ? supersedeAcceptedPatternClaim(env, {
          claimId: document.claim_id,
          userId: identity.userId,
          now: nowIso,
        })
      : releaseUserPatternClaims(env, { userId: identity.userId, now: nowIso }),
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
    const chart = await loadActiveChart(env, identity.userId);
    await reconcilePatternAfterChartCorrection(
      env,
      identity,
      chart?.id ?? `chart_absent:${identity.userId}`,
      now,
    );
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
  const flipped = await recallOntologyVersion(env, version, reasonClass);
  if (!flipped && !(await isOntologyRecalled(env, version))) return 0;
  const now = new Date().toISOString();
  const { results: jobs } = await env.DB.prepare(
    `SELECT generation.generation_id, generation.user_id,
            generation.claim_id, generation.chart_fingerprint_hash,
            claim.status AS claim_status, document.id AS pattern_id
     FROM pattern_generation_jobs generation
     JOIN pattern_generation_claims claim ON claim.id = generation.claim_id
     LEFT JOIN pattern_documents document
       ON document.generation_id = generation.generation_id
     WHERE generation.ontology_version = ?
     ORDER BY generation.generation_id`,
  )
    .bind(version)
    .all<{
      generation_id: string;
      user_id: string;
      claim_id: string;
      chart_fingerprint_hash: string;
      claim_status: string;
      pattern_id: string | null;
    }>();
  const recallEventId = await patternReplayEventId(
    "ontology_recalled",
    version,
  );
  let withdrawnDocuments = 0;
  for (const row of jobs) {
    const withdrawal = row.pattern_id && row.claim_status === "accepted"
      ? await writePatternReplayIntent(env, {
          eventClass: "pattern_withdrawn",
          semanticOperationKey: `${recallEventId}:${row.claim_id}`,
          targetUserId: row.user_id,
          chartFingerprintHash: row.chart_fingerprint_hash,
          claimId: row.claim_id,
          generationId: row.generation_id,
          patternId: row.pattern_id,
          ontologyVersion: version,
          priorClaimStatus: "accepted",
          nextClaimStatus: "withdrawn",
        }, new Date(now))
      : null;
    await env.DB.batch([
      ...(withdrawal?.receiptStatements(env) ?? []),
      env.DB.prepare(`DELETE FROM pattern_documents WHERE generation_id = ?`).bind(row.generation_id),
      env.DB.prepare(
        `UPDATE pattern_generation_jobs
         SET stage = 'cancelled', cancellation_reason = 'ontology_recalled',
             updated_at = ?, finished_at = ?
         WHERE claim_id = ? AND user_id = ?
           AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
      ).bind(now, now, row.claim_id, row.user_id),
      env.DB.prepare(
        `UPDATE jobs
         SET status = 'cancelled', claim_token = NULL, lease_expires_at = NULL,
             finished_at = ?, result_class = 'ontology_recalled'
         WHERE user_id = ? AND job_type = ? AND status IN ('queued', 'running')
           AND id IN (
             SELECT job_id FROM pattern_generation_jobs
             WHERE claim_id = ? AND user_id = ?
           )`,
      ).bind(now, row.user_id, PATTERN_JOB_TYPE, row.claim_id, row.user_id),
      releaseUserPatternRegenerations(env, {
        userId: row.user_id,
        now,
      }),
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
      withdrawal
        ? withdrawAcceptedPatternClaim(env, {
            claimId: row.claim_id,
            userId: row.user_id,
            now,
          })
        : releaseUnconsumedPatternClaim(env, {
            claimId: row.claim_id,
            userId: row.user_id,
            generationId: row.generation_id,
            now,
          }),
      env.DB.prepare(
        `UPDATE pattern_generation_artifact_keys
         SET wrapped_key_enc = NULL, wrapped_key_version = NULL, wrapped_key_nonce = NULL, erased_at = ?
         WHERE generation_id = ? AND user_id = ?`,
      ).bind(now, row.generation_id, row.user_id),
    ]);
    if (row.pattern_id) withdrawnDocuments += 1;
    await deleteGenerationObjects(env, row.generation_id);
  }
  return withdrawnDocuments;
}

/**
 * Finish the first machine-pipeline activation by retiring every earlier
 * internal-only ontology lineage. Machine identity is proven by the committed
 * evidence row that `storeOntologyRelease` requires, not by trusting mutable
 * status or an unverified provenance field.
 *
 * Recalled internal releases stay in the scan deliberately. If a Worker dies
 * after the D1 withdrawal batch but before an R2 delete finishes, the next
 * ingestion delivery repeats the idempotent cleanup instead of losing the only
 * durable reference to that release.
 */
export async function reconcileMachineOntologyActivation(
  env: Env,
  activeMachineVersion: string,
): Promise<number> {
  const active = await env.DB.prepare(
    `SELECT 1 AS present
     FROM pattern_ontology_pointer pointer
     JOIN pattern_ontology_releases release
       ON release.version = pointer.active_version
     JOIN pattern_ontology_pipeline_evidence evidence
       ON evidence.ontology_version = release.version
      AND evidence.bundle_hash = release.bundle_hash
     WHERE pointer.id = 1
       AND pointer.active_version = ?
       AND release.status = 'active'
       AND evidence.run_status = 'succeeded'
       AND evidence.evidence_status = 'committed'
       AND evidence.evaluation_artifact_status = 'committed'
       AND evidence.compiler_passed = 1
       AND evidence.evaluator_passed = 1
       AND evidence.unevaluated_fixture_count = 0`,
  ).bind(activeMachineVersion).first<{ present: number }>();
  if (!active) {
    throw new Error("machine_ontology_activation_not_committed");
  }

  const { results } = await env.DB.prepare(
    `SELECT release.version
     FROM pattern_ontology_releases release
     WHERE release.version != ?
       AND release.status IN ('superseded', 'recalled')
       AND NOT EXISTS (
         SELECT 1
         FROM pattern_ontology_pipeline_evidence evidence
         WHERE evidence.ontology_version = release.version
           AND evidence.bundle_hash = release.bundle_hash
           AND evidence.run_status = 'succeeded'
           AND evidence.evidence_status = 'committed'
       )
     ORDER BY release.version`,
  ).bind(activeMachineVersion).all<{ version: string }>();

  let withdrawn = 0;
  for (const row of results) {
    withdrawn += await recallOntologyAndWithdraw(
      env,
      row.version,
      "machine_pipeline_activation",
    );
  }
  return withdrawn;
}

export { loadAnyClaim, hashChartFingerprint, loadClaimForFingerprint };
