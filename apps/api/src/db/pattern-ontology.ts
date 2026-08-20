import {
  canonicalJson,
  sha256Hex,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import { compileOntologyRelease } from "@patternlike/pattern-engine";
import type { Env } from "../env.js";
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

export interface ActiveOntology {
  version: string;
  bundleHash: string;
  corpusReleaseHash: string;
  locale: string;
  activationScope: "internal" | "public";
  release: PatternOntologyRelease;
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
            CASE
              WHEN e.activation_scope = 'public'
               AND e.run_status = 'succeeded'
               AND e.evidence_status = 'committed'
               AND e.evaluation_artifact_status = 'committed'
              THEN 'public'
              ELSE 'internal'
            END AS activation_scope
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
            CASE
              WHEN e.activation_scope = 'public'
               AND e.run_status = 'succeeded'
               AND e.evidence_status = 'committed'
               AND e.evaluation_artifact_status = 'committed'
              THEN 'public'
              ELSE 'internal'
            END AS activation_scope
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
  const compiled = compileOntologyRelease(stripOntologySignature(release));
  if (!compiled.ok) {
    throw new Error(`ontology release refused: ${compiled.failures.map((f) => f.code).join(",")}`);
  }
  const computed = await computeOntologyBundleHash(release);
  if (release.bundle_hash && !hashesEqual(release.bundle_hash, computed)) {
    throw new Error("ontology_bundle_hash_mismatch");
  }
  const stored: SignedOntologyRelease = { ...release, bundle_hash: computed, status: "active" };
  const keys = parseOntologyKeys(env.PATTERN_ONTOLOGY_KEYS);
  if (keys.size > 0) {
    const failed = await verifyOntologySignature(stored, keys);
    if (failed) throw new Error("ontology_signature_invalid");
  } else if (!isDevEnvironment(env.ENVIRONMENT) && env.AUTH_STUB !== "1") {
    throw new Error("ontology_keys_not_configured");
  }
  if (!env.ARTIFACTS) throw new Error("ARTIFACTS binding missing");
  const isMachinePipeline =
    release.provenance?.origin === "machine_pipeline";
  if (isMachinePipeline && !evidence) {
    throw new Error("ontology_pipeline_evidence_missing");
  }
  if (!isMachinePipeline && evidence) {
    throw new Error("ontology_pipeline_evidence_unexpected");
  }

  const existing = await env.DB.prepare(
    `SELECT version, bundle_hash, status, object_key
     FROM pattern_ontology_releases WHERE version = ?`,
  )
    .bind(release.ontology_version)
    .first<{
      version: string;
      bundle_hash: string;
      status: string;
      object_key: string;
    }>();
  if (existing?.status === "recalled") {
    throw new Error("ontology_version_recalled");
  }
  if (existing && !hashesEqual(existing.bundle_hash, computed)) {
    throw new Error("ontology_version_immutable");
  }
  if (existing && existing.object_key !== objectKey) {
    throw new Error("ontology_version_immutable");
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
       SELECT 1, 'ontology version recalled'
       WHERE EXISTS (
         SELECT 1 FROM pattern_ontology_releases WHERE version = ? AND status = 'recalled'
       )`,
    ).bind(release.ontology_version),
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
             AND evaluation_report_hash = ?
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
        release.ontology_version,
        computed,
        evidence.corpusReleaseId,
        release.corpus_release_hash,
        evidence.evaluationReportHash,
        release.signature!.key_id,
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
  if (!existing) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO pattern_ontology_releases (
           version, bundle_hash, corpus_release_hash, locale, status, object_key,
           evaluation_json, created_at, recalled_at
         ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
      ).bind(
        release.ontology_version,
        computed,
        release.corpus_release_hash,
        release.locale,
        objectKey,
        JSON.stringify(release.evaluation),
        now,
      ),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `UPDATE pattern_ontology_releases SET status = 'active'
         WHERE version = ? AND status != 'recalled' AND bundle_hash = ?`,
      ).bind(release.ontology_version, existing.bundle_hash),
    );
  }
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
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE pattern_ontology_releases SET status = 'superseded'
       WHERE version != ? AND status = 'active'`,
    ).bind(release.ontology_version),
    env.DB.prepare(
      `UPDATE pattern_ontology_pointer SET active_version = ?, updated_at = ? WHERE id = 1`,
    ).bind(release.ontology_version, now),
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
           JOIN pattern_ontology_pointer p
             ON p.id = 1 AND p.active_version = r.version
           WHERE e.id = ?
             AND e.ontology_version = ?
             AND e.verdict = 'pass'
             AND e.summary_json = ?
             AND r.bundle_hash = ?
             AND r.status = 'active'
         )`,
      ).bind(
        evaluationRunId,
        release.ontology_version,
        evidence.evidenceSummary,
        computed,
      ),
    );
  }
  await env.DB.batch(statements);
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
  const now = new Date().toISOString();
  const updated = await env.DB.prepare(
    `UPDATE pattern_ontology_releases
     SET status = 'recalled', recalled_at = ?
     WHERE version = ? AND status IN ('active', 'superseded', 'candidate')`,
  )
    .bind(now, version)
    .run();
  if (!updated.meta.changes) return false;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE pattern_ontology_pointer SET active_version = NULL, updated_at = ?
       WHERE id = 1 AND active_version = ?`,
    ).bind(now, version),
    env.DB.prepare(
      `INSERT INTO pattern_ontology_recall_events (id, ontology_version, reason_class, created_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(`pre_${crypto.randomUUID().replaceAll("-", "").slice(0, 32)}`, version, reasonClass, now),
  ]);
  return true;
}
