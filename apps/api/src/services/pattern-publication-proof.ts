import {
  contentHash,
  type PatternPlan,
  type PatternSemanticVerdict,
  type PatternWriterOutput,
} from "@patternlike/shared";

import type {
  GeneratePatternCommand,
  PatternReservationReason,
} from "./pattern-command.js";
import type { PatternPublisherPin } from "./pattern-publisher.js";
import type { PatternJobRow } from "./pattern-stage-protocol.js";
import type { Env } from "../env.js";

export interface PatternPublicationProof {
  generationId: string;
  jobId: string;
  claimId: string;
  chartFingerprintHash: string;
  featureSetHash: string;
  locale: string;
  localeRevision: number;
  consentId: string;
  ontologyVersion: string;
  ontologyBundleHash: string;
  planHash: string;
  candidateHash: string;
  semanticVerdictHash: string;
  semanticVerdict: "pass";
  executedWriterPin: PatternPublisherPin;
  patternSourceHash: string;
  reservationReason: PatternReservationReason;
}

export interface PatternPublicationBundle {
  proof: PatternPublicationProof;
  plan: PatternPlan;
  writer: PatternWriterOutput;
}

export type PatternPublicationArtifactClass =
  | "planner_response"
  | "validated_plan"
  | "writer_response"
  | "semantic_verdict";

export type PatternPublicationProofErrorCode =
  | "publication_coordinate_mismatch"
  | "writer_pin_mismatch"
  | "publication_artifact_missing"
  | "plan_hash_mismatch"
  | "candidate_hash_mismatch"
  | "semantic_verdict_hash_mismatch"
  | "semantic_verdict_not_pass";

export class PatternPublicationProofError extends Error {
  constructor(readonly code: PatternPublicationProofErrorCode) {
    super(code);
    this.name = "PatternPublicationProofError";
  }
}

function pinsEqual(left: PatternPublisherPin, right: PatternPublisherPin): boolean {
  const leftRecord = left as unknown as Record<string, unknown>;
  const rightRecord = right as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  return [...keys].every((key) => leftRecord[key] === rightRecord[key]);
}

/**
 * Build the only object publication may trust.
 *
 * The reader is invoked here, by artifact class, and no hash is accepted from
 * it. Every hash is recomputed over the stored plaintext value and compared
 * with the durable job coordinate before the proof is returned.
 */
export async function buildPatternPublicationProof(input: {
  command: GeneratePatternCommand;
  job: PatternJobRow;
  executedWriterPin: PatternPublisherPin;
  readArtifact: (artifactClass: PatternPublicationArtifactClass) => Promise<unknown | null>;
}): Promise<PatternPublicationBundle> {
  const { command, job, executedWriterPin } = input;
  if (
    command.generation_id !== job.generation_id ||
    command.job_id !== job.job_id ||
    command.claim_id !== job.claim_id ||
    command.user_id !== job.user_id ||
    command.locale !== job.locale ||
    command.locale_revision !== job.locale_revision ||
    command.reservation_reason !== job.reservation_reason ||
    !("pattern_source_hash" in command) ||
    command.pattern_source_hash !== job.pattern_source_hash
  ) {
    throw new PatternPublicationProofError("publication_coordinate_mismatch");
  }
  if (!pinsEqual(command.publisher, executedWriterPin)) {
    throw new PatternPublicationProofError("writer_pin_mismatch");
  }

  const [plannerValue, planValue, writerValue, verdictValue] = await Promise.all([
    input.readArtifact("planner_response"),
    input.readArtifact("validated_plan"),
    input.readArtifact("writer_response"),
    input.readArtifact("semantic_verdict"),
  ]);
  if (!plannerValue || !planValue || !writerValue || !verdictValue) {
    throw new PatternPublicationProofError("publication_artifact_missing");
  }

  const plan = planValue as PatternPlan;
  const writer = writerValue as PatternWriterOutput;
  const verdict = verdictValue as PatternSemanticVerdict;
  const planHash = await contentHash(JSON.stringify(plannerValue));
  if (job.plan_hash !== planHash || plan.plan_hash !== planHash) {
    throw new PatternPublicationProofError("plan_hash_mismatch");
  }
  const candidateHash = await contentHash(JSON.stringify(writerValue));
  if (job.candidate_hash !== candidateHash) {
    throw new PatternPublicationProofError("candidate_hash_mismatch");
  }
  const semanticVerdictHash = await contentHash(JSON.stringify(verdictValue));
  if (
    job.semantic_verdict_hash !== null &&
    job.semantic_verdict_hash !== semanticVerdictHash
  ) {
    throw new PatternPublicationProofError("semantic_verdict_hash_mismatch");
  }
  if (verdict.verdict !== "pass") {
    throw new PatternPublicationProofError("semantic_verdict_not_pass");
  }

  return {
    proof: {
      generationId: command.generation_id,
      jobId: command.job_id,
      claimId: command.claim_id,
      chartFingerprintHash: command.chart_fingerprint_hash,
      featureSetHash: command.feature_set_hash,
      locale: command.locale,
      localeRevision: command.locale_revision,
      consentId: command.consent_id,
      ontologyVersion: command.ontology_version,
      ontologyBundleHash: command.ontology_bundle_hash,
      planHash,
      candidateHash,
      semanticVerdictHash,
      semanticVerdict: "pass",
      executedWriterPin,
      patternSourceHash: command.pattern_source_hash,
      reservationReason: command.reservation_reason,
    },
    plan,
    writer,
  };
}

/**
 * Recheck every mutable publication authority inside the commit batch.
 *
 * Provider work may take minutes. A check at delivery start therefore cannot
 * authorize the later commit: account, chart, locale, consent, ontology, and
 * claim state all remain independently mutable during the call.
 */
export function patternPublicationAuthorizationGuard(
  env: Pick<Env, "DB">,
  proof: PatternPublicationProof,
  now: Date,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO assertion_probe (id, reason)
     SELECT 1, 'pattern publication authorization changed'
     WHERE NOT EXISTS (
       SELECT 1
       FROM pattern_generation_jobs generation
       JOIN jobs job ON job.id = generation.job_id
       JOIN users account ON account.id = generation.user_id
       JOIN chart_snapshots chart
         ON chart.id = generation.chart_id
        AND chart.user_id = generation.user_id
       JOIN consents consent
         ON consent.id = generation.consent_id
        AND consent.user_id = generation.user_id
        AND consent.kind = 'pattern_generation'
       JOIN pattern_ontology_releases ontology
         ON ontology.version = generation.ontology_version
       JOIN pattern_generation_claims claim
         ON claim.id = generation.claim_id
        AND claim.user_id = generation.user_id
       WHERE generation.generation_id = ?
         AND generation.job_id = ?
         AND generation.claim_id = ?
         AND generation.chart_fingerprint_hash = ?
         AND generation.feature_set_hash = ?
         AND generation.locale = ?
         AND generation.locale_revision = ?
         AND generation.consent_id = ?
         AND generation.ontology_version = ?
         AND generation.ontology_bundle_hash = ?
         AND generation.pattern_source_hash = ?
         AND account.status = 'active'
         AND chart.status = 'active'
         AND account.locale = ?
         AND account.locale_source = 'user_confirmed'
         AND (
           CASE
             WHEN account.locale_updated_at IS NULL THEN 1
             ELSE CAST(strftime('%s', account.locale_updated_at) AS INTEGER) * 1000
               + CASE
                   WHEN instr(account.locale_updated_at, '.') > 0
                   THEN CAST(substr(
                     account.locale_updated_at,
                     instr(account.locale_updated_at, '.') + 1,
                     3
                   ) AS INTEGER)
                   ELSE 0
                 END
           END
         ) = ?
         AND consent.status = 'granted'
         AND consent.policy_version = generation.consent_policy_version
         AND consent.granted_at IS NOT NULL
         AND (consent.expires_at IS NULL OR consent.expires_at > ?)
         AND NOT EXISTS (
           SELECT 1 FROM consents newer
           WHERE newer.user_id = generation.user_id
             AND newer.kind = 'pattern_generation'
             AND newer.version > consent.version
         )
         AND ontology.bundle_hash = ?
         AND ontology.status != 'recalled'
         AND (
           (
             generation.reservation_reason != 'source_update'
             AND claim.status = 'reserved'
             AND claim.consumed_at IS NULL
             AND claim.active_generation_id = generation.generation_id
           )
           OR (
             generation.reservation_reason = 'source_update'
             AND claim.status = 'accepted'
             AND claim.consumed_at IS NOT NULL
             AND claim.pending_regeneration_id = generation.generation_id
             AND EXISTS (
               SELECT 1 FROM pattern_documents current_document
               WHERE current_document.user_id = generation.user_id
                 AND current_document.claim_id = generation.claim_id
                 AND current_document.chart_fingerprint_hash = generation.chart_fingerprint_hash
             )
           )
         )
         AND job.status = 'running'
     )`,
  ).bind(
    proof.generationId,
    proof.jobId,
    proof.claimId,
    proof.chartFingerprintHash,
    proof.featureSetHash,
    proof.locale,
    proof.localeRevision,
    proof.consentId,
    proof.ontologyVersion,
    proof.ontologyBundleHash,
    proof.patternSourceHash,
    proof.locale,
    proof.localeRevision,
    now.toISOString(),
    proof.ontologyBundleHash,
  );
}
