import {
  canonicalJson,
  sha256Hex,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import { compileOntologyRelease } from "@patternlike/pattern-engine";
import type { Env } from "../env.js";
import { writePatternReplayIntent } from "../services/pattern-replay-ledger.js";
import { isDevEnvironment } from "../crypto.js";
import { hashesEqual } from "../services/content-release.js";
import {
  computeOntologyBundleHash,
  parseOntologyKeys,
  stripOntologySignature,
  verifyOntologySignature,
  type SignedOntologyRelease,
} from "../services/pattern-ontology-verify.js";
import type { VerifiedPatternOntologyEvidence } from "../services/pattern-ontology-evidence.js";

export const ONTOLOGY_OBJECT_PREFIX = "pattern-ontology/";

/**
 * Public vs internal is re-derived on every read from evidence + receipt
 * agreement, not from a stored flag. Both loaders interpolate this fragment
 * so enqueue and execute cannot drift onto different scopes.
 */
const ONTOLOGY_ACTIVATION_SCOPE_SQL = `CASE
              WHEN e.activation_scope = 'public'
               AND e.run_status = 'succeeded'
               AND e.evidence_status = 'committed'
               AND e.evaluation_artifact_status = 'committed'
               AND e.compiler_passed = 1
               AND e.evaluator_passed = 1
               AND e.unevaluated_fixture_count = 0
               AND e.corpus_license_class = 'licensed_excerpt'
               AND e.corpus_public_capable = 1
               AND e.corpus_release_hash = r.corpus_release_hash
               AND json_extract(
                 r.evaluation_json,
                 '$.evaluation_report_hash'
               ) = e.evaluation_report_hash
               AND length(e.evaluation_artifact_envelope_hash) = 71
               AND length(e.evaluation_artifact_ciphertext_hash) = 71
               AND (
                 e.evaluation_artifact_object_key =
                   'pattern-ontology/pipeline/' || e.run_id ||
                   '/evaluation-report.enc'
                 OR EXISTS (
                   SELECT 1
                   FROM pattern_ontology_pipeline_artifacts artifact
                   WHERE artifact.run_id = e.run_id
                     AND artifact.stage = 'evaluating'
                     AND artifact.stage_attempt > 0
                     AND artifact.artifact_class = 'evaluation_report'
                     AND artifact.object_key = e.evaluation_artifact_object_key
                     AND artifact.plaintext_sha256 = e.evaluation_report_hash
                     AND artifact.envelope_sha256 =
                       e.evaluation_artifact_envelope_hash
                     AND artifact.ciphertext_sha256 =
                       e.evaluation_artifact_ciphertext_hash
                     AND artifact.expires_at IS NULL
                     AND artifact.deleted_at IS NULL
                 )
               )
               AND EXISTS (
                 SELECT 1
                 FROM pattern_ontology_evaluation_runs receipt
                 WHERE receipt.ontology_version = r.version
                   AND receipt.verdict = 'pass'
                   AND json_valid(receipt.summary_json)
                   AND json_extract(
                     receipt.summary_json,
                     '$.run_id'
                   ) = e.run_id
                   AND json_extract(
                     receipt.summary_json,
                     '$.ontology_version'
                   ) = e.ontology_version
                   AND json_extract(
                     receipt.summary_json,
                     '$.activation_scope'
                   ) = e.activation_scope
                   AND json_extract(
                     receipt.summary_json,
                     '$.bundle_hash'
                   ) = e.bundle_hash
                   AND json_extract(
                     receipt.summary_json,
                     '$.corpus_release_id'
                   ) = e.corpus_release_id
                   AND json_extract(
                     receipt.summary_json,
                     '$.corpus_release_hash'
                   ) = e.corpus_release_hash
                   AND json_extract(
                     receipt.summary_json,
                     '$.corpus_license_class'
                   ) = e.corpus_license_class
                   AND json_extract(
                     receipt.summary_json,
                     '$.corpus_public_capable'
                   ) = e.corpus_public_capable
                   AND json_extract(
                     receipt.summary_json,
                     '$.evaluation_report_hash'
                   ) = e.evaluation_report_hash
                   AND json_extract(
                     receipt.summary_json,
                     '$.evaluation_artifact_object_key'
                   ) = e.evaluation_artifact_object_key
                   AND json_extract(
                     receipt.summary_json,
                     '$.evaluation_artifact_envelope_hash'
                   ) = e.evaluation_artifact_envelope_hash
                   AND json_extract(
                     receipt.summary_json,
                     '$.evaluation_artifact_ciphertext_hash'
                   ) = e.evaluation_artifact_ciphertext_hash
                   AND json_extract(
                     receipt.summary_json,
                     '$.signing_key_id'
                   ) = e.signing_key_id
                   AND json_extract(
                     receipt.summary_json,
                     '$.compiler_passed'
                   ) = e.compiler_passed
                   AND json_extract(
                     receipt.summary_json,
                     '$.evaluator_passed'
                   ) = e.evaluator_passed
                   AND json_extract(
                     receipt.summary_json,
                     '$.unevaluated_fixture_count'
                   ) = e.unevaluated_fixture_count
               )
              THEN 'public'
              ELSE 'internal'
            END AS activation_scope`;

export interface ActiveOntology {
  version: string;
  bundleHash: string;
  corpusReleaseHash: string;
  locale: string;
  /** Immutable R2 pointer verified against bundleHash before release bytes are returned. */
  objectKey: string;
  activationScope: "internal" | "public";
  release: PatternOntologyRelease;
}

/**
 * External readers may generate only from a public machine-pipeline
 * ontology. Internal accounts may still use Slice A / degraded-internal
 * releases. Enqueue, pattern-state, and GET /v1/pattern must share this
 * predicate so the client never offers a generate action the API then
 * refuses.
 */
export function ontologyServesAccount(
  ontology: ActiveOntology | null,
  internalAccount: boolean,
): ontology is ActiveOntology {
  if (!ontology) return false;
  if (
    ontology.release.provenance?.origin === "machine_pipeline" &&
    ontology.activationScope === "public"
  ) {
    return true;
  }
  return internalAccount;
}

function asSignedRelease(value: unknown): SignedOntologyRelease | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as SignedOntologyRelease;
}

async function readVerifiedRelease(
  env: Env,
  objectKey: string,
  expectedHash: string,
): Promise<PatternOntologyRelease | null> {
  if (!env.ARTIFACTS) return null;
  const object = await env.ARTIFACTS.get(objectKey);
  if (!object) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await object.text());
  } catch {
    return null;
  }
  const signed = asSignedRelease(parsed);
  if (!signed) return null;
  const release = stripOntologySignature(signed);
  const computed = await computeOntologyBundleHash(release);
  if (!hashesEqual(computed, expectedHash) || !hashesEqual(computed, release.bundle_hash)) {
    return null;
  }
  const keys = parseOntologyKeys(env.PATTERN_ONTOLOGY_KEYS);
  if (keys.size > 0) {
    const failed = await verifyOntologySignature({ ...release, signature: signed.signature }, keys);
    if (failed) return null;
  } else if (!isDevEnvironment(env.ENVIRONMENT) && env.AUTH_STUB !== "1") {
    return null;
  }
  const compiled = compileOntologyRelease(release);
  if (!compiled.ok) return null;
  return release;
}

export async function loadActiveOntology(env: Env): Promise<ActiveOntology | null> {
  const pointer = await env.DB.prepare(
    `SELECT p.active_version AS version, r.bundle_hash, r.corpus_release_hash,
            r.locale, r.object_key, r.status,
            ${ONTOLOGY_ACTIVATION_SCOPE_SQL}
     FROM pattern_ontology_pointer p
     LEFT JOIN pattern_ontology_releases r ON r.version = p.active_version
     LEFT JOIN pattern_ontology_pipeline_evidence e
       ON e.ontology_version = r.version AND e.bundle_hash = r.bundle_hash
     WHERE p.id = 1`,
  ).first<{
    version: string | null;
    bundle_hash: string | null;
    corpus_release_hash: string | null;
    locale: string | null;
    object_key: string | null;
    status: string | null;
    activation_scope: "internal" | "public";
  }>();
  if (!pointer?.version || !pointer.object_key || !pointer.bundle_hash || pointer.status !== "active") {
    return null;
  }
  const release = await readVerifiedRelease(env, pointer.object_key, pointer.bundle_hash);
  if (!release) return null;
  return {
    version: pointer.version,
    bundleHash: pointer.bundle_hash,
    corpusReleaseHash: pointer.corpus_release_hash!,
    locale: pointer.locale!,
    objectKey: pointer.object_key,
    activationScope: pointer.activation_scope,
    release,
  };
}

export async function loadOntologyByVersion(
  env: Env,
  version: string,
): Promise<ActiveOntology | null> {
  const row = await env.DB.prepare(
    `SELECT r.version, r.bundle_hash, r.corpus_release_hash, r.locale,
            r.object_key, r.status,
            ${ONTOLOGY_ACTIVATION_SCOPE_SQL}
     FROM pattern_ontology_releases r
     LEFT JOIN pattern_ontology_pipeline_evidence e
       ON e.ontology_version = r.version AND e.bundle_hash = r.bundle_hash
     WHERE r.version = ?`,
  )
    .bind(version)
    .first<{
      version: string;
      bundle_hash: string;
      corpus_release_hash: string;
      locale: string;
      object_key: string;
      status: string;
      activation_scope: "internal" | "public";
    }>();
  if (!row || row.status === "recalled" || !env.ARTIFACTS) return null;
  const release = await readVerifiedRelease(env, row.object_key, row.bundle_hash);
  if (!release) return null;
  return {
    version: row.version,
    bundleHash: row.bundle_hash,
    corpusReleaseHash: row.corpus_release_hash,
    locale: row.locale,
    objectKey: row.object_key,
    activationScope: row.activation_scope,
    release,
  };
}

export async function storeOntologyRelease(
  env: Env,
  release: SignedOntologyRelease,
  objectKey: string,
  evidence?: VerifiedPatternOntologyEvidence,
): Promise<void> {
  const unsigned = stripOntologySignature(release);
  const compiled = compileOntologyRelease(unsigned);
  if (!compiled.ok) {
    throw new Error(`ontology release refused: ${compiled.failures.map((f) => f.code).join(",")}`);
  }
  const computed = await computeOntologyBundleHash(release);
  if (release.bundle_hash && !hashesEqual(release.bundle_hash, computed)) {
    throw new Error("ontology_bundle_hash_mismatch");
  }
  const stored: SignedOntologyRelease = { ...release, bundle_hash: computed };
  const isMachinePipeline =
    unsigned.provenance?.origin === "machine_pipeline";
  if (isMachinePipeline && unsigned.status !== "candidate") {
    throw new Error("ontology_status_not_candidate");
  }
  const keys = parseOntologyKeys(env.PATTERN_ONTOLOGY_KEYS);
  if (keys.size > 0) {
    const failed = await verifyOntologySignature(stored, keys);
    if (failed) throw new Error("ontology_signature_invalid");
  } else if (!isDevEnvironment(env.ENVIRONMENT) && env.AUTH_STUB !== "1") {
    throw new Error("ontology_keys_not_configured");
  }
  if (!env.ARTIFACTS) throw new Error("ARTIFACTS binding missing");
  if (isMachinePipeline && !evidence) {
    throw new Error("ontology_pipeline_evidence_missing");
  }
  if (!isMachinePipeline && evidence) {
    throw new Error("ontology_pipeline_evidence_unexpected");
  }

  const serialized = canonicalJson(stored);
  const put = await env.ARTIFACTS.put(objectKey, serialized, {
    onlyIf: new Headers({ "if-none-match": "*" }),
    httpMetadata: { contentType: "application/json" },
  });
  if (!put) {
    const already = await env.ARTIFACTS.get(objectKey);
    if (!already || (await already.text()) !== serialized) {
      throw new Error("ontology_version_immutable");
    }
  }

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'ontology version recalled or immutable'
       WHERE EXISTS (
         SELECT 1 FROM pattern_erasure_replay_events
         WHERE event_class = 'ontology_recalled'
           AND ontology_version = ?
       ) OR EXISTS (
         SELECT 1
         FROM pattern_ontology_releases
         WHERE version = ?
           AND (
             status = 'recalled'
             OR bundle_hash != ?
             OR corpus_release_hash != ?
             OR locale != ?
             OR object_key != ?
           )
       )`,
    ).bind(
      release.ontology_version,
      release.ontology_version,
      computed,
      release.corpus_release_hash,
      release.locale,
      objectKey,
    ),
  ];
  let evaluationRunId: string | null = null;
  if (evidence) {
    evaluationRunId = `poer_${(
      await sha256Hex(
        `${evidence.runId}:${release.ontology_version}:${computed}`,
      )
    ).slice(0, 32)}`;
    statements.push(
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'machine ontology evidence changed before activation'
         WHERE NOT EXISTS (
           SELECT 1
           FROM pattern_ontology_pipeline_evidence
           WHERE run_id = ?
             AND ontology_version = ?
             AND bundle_hash = ?
             AND corpus_release_id = ?
             AND corpus_release_hash = ?
             AND corpus_license_class = ?
             AND corpus_public_capable = ?
             AND evaluation_report_hash = ?
             AND evaluation_artifact_object_key = ?
             AND evaluation_artifact_envelope_hash = ?
             AND evaluation_artifact_ciphertext_hash = ?
             AND signing_key_id = ?
             AND activation_scope = ?
             AND run_status = 'succeeded'
             AND evidence_status = 'committed'
             AND evaluation_artifact_status = 'committed'
             AND compiler_passed = 1
             AND evaluator_passed = 1
             AND unevaluated_fixture_count = 0
         )`,
      ).bind(
        evidence.runId,
        evidence.ontologyVersion,
        evidence.bundleHash,
        evidence.corpusReleaseId,
        evidence.corpusReleaseHash,
        evidence.corpusLicenseClass,
        evidence.corpusPublicCapable ? 1 : 0,
        evidence.evaluationReportHash,
        evidence.evaluationArtifactObjectKey,
        evidence.evaluationArtifactEnvelopeHash,
        evidence.evaluationArtifactCiphertextHash,
        evidence.signingKeyId,
        evidence.activationScope,
      ),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'machine ontology evaluation receipt identity collision'
         WHERE EXISTS (
           SELECT 1 FROM pattern_ontology_evaluation_runs
           WHERE id = ?
             AND (
               ontology_version != ?
               OR verdict != 'pass'
               OR summary_json != ?
             )
         )`,
      ).bind(
        evaluationRunId,
        release.ontology_version,
        evidence.evidenceSummary,
      ),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO pattern_ontology_releases (
         version, bundle_hash, corpus_release_hash, locale, status, object_key,
         evaluation_json, created_at, recalled_at
       ) VALUES (?, ?, ?, ?, 'candidate', ?, ?, ?, NULL)`,
    ).bind(
      release.ontology_version,
      computed,
      release.corpus_release_hash,
      release.locale,
      objectKey,
      JSON.stringify(release.evaluation),
      now,
    ),
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'ontology release insert did not converge'
       WHERE NOT EXISTS (
         SELECT 1
         FROM pattern_ontology_releases
         WHERE version = ?
           AND bundle_hash = ?
           AND corpus_release_hash = ?
           AND locale = ?
           AND object_key = ?
           AND status IN ('candidate', 'active', 'superseded')
       )`,
    ).bind(
      release.ontology_version,
      computed,
      release.corpus_release_hash,
      release.locale,
      objectKey,
    ),
  );
  if (evidence && evaluationRunId) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO pattern_ontology_evaluation_runs (
           id, ontology_version, verdict, summary_json, created_at
         ) VALUES (?, ?, 'pass', ?, ?)`,
      ).bind(
        evaluationRunId,
        release.ontology_version,
        evidence.evidenceSummary,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'machine ontology evaluation receipt did not converge'
         WHERE NOT EXISTS (
           SELECT 1
           FROM pattern_ontology_evaluation_runs
           WHERE id = ?
             AND ontology_version = ?
             AND verdict = 'pass'
             AND summary_json = ?
         )`,
      ).bind(
        evaluationRunId,
        release.ontology_version,
        evidence.evidenceSummary,
      ),
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE pattern_ontology_releases SET status = 'superseded'
       WHERE version != ?
         AND status = 'active'
         AND EXISTS (
           SELECT 1 FROM pattern_ontology_releases
           WHERE version = ? AND bundle_hash = ? AND status = 'candidate'
         )`,
    ).bind(
      release.ontology_version,
      release.ontology_version,
      computed,
    ),
    env.DB.prepare(
      `UPDATE pattern_ontology_pointer
       SET active_version = ?, updated_at = ?
       WHERE id = 1
         AND EXISTS (
           SELECT 1 FROM pattern_ontology_releases
           WHERE version = ? AND bundle_hash = ? AND status = 'candidate'
         )`,
    ).bind(
      release.ontology_version,
      now,
      release.ontology_version,
      computed,
    ),
    env.DB.prepare(
      `UPDATE pattern_ontology_releases
       SET status = 'active'
       WHERE version = ? AND bundle_hash = ? AND status = 'candidate'`,
    ).bind(release.ontology_version, computed),
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'ontology activation did not converge'
       WHERE NOT EXISTS (
         SELECT 1
         FROM pattern_ontology_releases target
         JOIN pattern_ontology_pointer pointer ON pointer.id = 1
         WHERE target.version = ?
           AND target.bundle_hash = ?
           AND (
             (
               target.status = 'active'
               AND pointer.active_version = target.version
             )
             OR
             (
               -- Matching superseded bytes are an unconditional replay no-op.
               -- The pointer assertion above applies only to a newly activated
               -- target, so recalling the newer release cannot turn a stale
               -- replay into a 500.
               target.status = 'superseded'
             )
           )
       )`,
    ).bind(release.ontology_version, computed),
  );
  if (evidence && evaluationRunId) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'machine ontology activation receipt missing'
         WHERE NOT EXISTS (
           SELECT 1
           FROM pattern_ontology_evaluation_runs e
           JOIN pattern_ontology_releases r
             ON r.version = e.ontology_version
           WHERE e.id = ?
             AND e.ontology_version = ?
             AND e.verdict = 'pass'
             AND e.summary_json = ?
             AND r.bundle_hash = ?
             AND r.status IN ('active', 'superseded')
         )`,
      ).bind(
        evaluationRunId,
        release.ontology_version,
        evidence.evidenceSummary,
        computed,
      ),
    );
  }
  try {
    await env.DB.batch(statements);
  } catch (cause) {
    const recallTombstone = await env.DB.prepare(
      `SELECT 1 AS present FROM pattern_erasure_replay_events
       WHERE event_class = 'ontology_recalled' AND ontology_version = ?
       LIMIT 1`,
    ).bind(release.ontology_version).first<{ present: number }>();
    const raced = await env.DB.prepare(
      `SELECT bundle_hash, corpus_release_hash, locale, object_key, status
       FROM pattern_ontology_releases WHERE version = ?`,
    )
      .bind(release.ontology_version)
      .first<{
        bundle_hash: string;
        corpus_release_hash: string;
        locale: string;
        object_key: string;
        status: string;
      }>();
    if (recallTombstone || raced?.status === "recalled") {
      throw new Error("ontology_version_recalled");
    }
    if (
      raced &&
      (!hashesEqual(raced.bundle_hash, computed) ||
        !hashesEqual(
          raced.corpus_release_hash,
          release.corpus_release_hash,
        ) ||
        raced.locale !== release.locale ||
        raced.object_key !== objectKey)
    ) {
      throw new Error("ontology_version_immutable");
    }
    throw cause;
  }
}

export async function isOntologyRecalled(env: Env, version: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT status FROM pattern_ontology_releases WHERE version = ?`,
  )
    .bind(version)
    .first<{ status: string }>();
  return row?.status === "recalled";
}

export async function recallOntologyVersion(env: Env, version: string, reasonClass: string): Promise<boolean> {
  const existing = await env.DB.prepare(
    `SELECT status FROM pattern_ontology_releases WHERE version = ?`,
  ).bind(version).first<{ status: string }>();
  if (!existing) return false;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const replay = await writePatternReplayIntent(env, {
    eventClass: "ontology_recalled",
    semanticOperationKey: version,
    targetUserId: null,
    chartFingerprintHash: null,
    claimId: null,
    generationId: null,
    patternId: null,
    ontologyVersion: version,
    priorClaimStatus: null,
    nextClaimStatus: null,
  }, nowDate);
  await env.DB.batch([
    ...replay.receiptStatements(env),
    env.DB.prepare(
      `UPDATE pattern_ontology_releases
       SET status = 'recalled', recalled_at = COALESCE(recalled_at, ?)
       WHERE version = ? AND status IN ('active', 'superseded', 'candidate', 'recalled')`,
    ).bind(now, version),
    env.DB.prepare(
      `UPDATE pattern_ontology_pointer SET active_version = NULL, updated_at = ?
       WHERE id = 1 AND active_version = ?`,
    ).bind(now, version),
    env.DB.prepare(
      `INSERT OR IGNORE INTO pattern_ontology_recall_events (id, ontology_version, reason_class, created_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(`pre_${replay.event.event_id.slice(5)}`, version, reasonClass, now),
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'ontology recall did not converge'
       WHERE NOT EXISTS (
         SELECT 1 FROM pattern_ontology_releases
         WHERE version = ? AND status = 'recalled'
       )`,
    ).bind(version),
  ]);
  return existing.status !== "recalled";
}
