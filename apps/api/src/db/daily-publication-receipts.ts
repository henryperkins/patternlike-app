/**
 * Content-free operational metadata for a validated Daily provider/job exchange
 * and its publication release. It survives removal of the encrypted provider
 * artifacts and control row. This record alone cannot certify a live provider
 * call, the runner installation, or account configuration.
 *
 * Only technical coordinates, pins, hashes, counts, and timestamps belong here.
 * No prose, user id, crypto subject, chart facts, local date, locale, or consent.
 */

import { newId } from "@patternlike/shared";

import type { Env } from "../env.js";

export const DAILY_PUBLICATION_RECEIPT_PROVIDER = "codex" as const;

export interface DailyPublicationReceiptInput {
  /** `daily_readings.id` of the reading this batch is publishing. */
  readingId: string;
  /** The generic Daily `jobs.id` that owned the generation. */
  jobId: string;
  /** The frozen `command.command_generation` that authorized it. */
  commandGeneration: number;
  /** `codex_provider_jobs.id`, recorded after that row is gone. */
  providerJobId: string;
  stageGeneration: number;
  stageAttempt: number;
  model: string;
  reasoningEffort: "high" | "xhigh";
  promptVersion: string;
  /** sha256 of the exact request bytes handed to the runner. */
  requestHash: string;
  /** sha256 of the exact response bytes it returned. */
  responseHash: string;
  inputTokens: number;
  outputTokens: number;
  /** `codex_provider_jobs.completed_at` — when the control plane accepted completion. */
  providerCompletedAt: string;
  /** The Cloudflare Worker version that ran the publication. */
  workerVersionId: string;
  /** The commit that version was built from. */
  releaseGitSha: string;
}

/**
 * One statement, for the publication batch and nowhere else.
 *
 * It is a builder rather than a writer on purpose: a receipt written outside
 * `completeReading`'s batch could exist without a publication, or a publication
 * could commit without one, and either would make the receipt a claim instead
 * of evidence.
 */
export function buildDailyPublicationReceiptInsert(
  env: Pick<Env, "DB">,
  receipt: DailyPublicationReceiptInput,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO daily_publication_receipts (
       receipt_id, reading_id, job_id, command_generation,
       provider, provider_job_id, stage_generation, stage_attempt,
       model, reasoning_effort, prompt_version,
       request_hash, response_hash, input_tokens, output_tokens,
       provider_completed_at, worker_version_id, release_git_sha, published_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    newId("dpr"),
    receipt.readingId,
    receipt.jobId,
    receipt.commandGeneration,
    DAILY_PUBLICATION_RECEIPT_PROVIDER,
    receipt.providerJobId,
    receipt.stageGeneration,
    receipt.stageAttempt,
    receipt.model,
    receipt.reasoningEffort,
    receipt.promptVersion,
    receipt.requestHash,
    receipt.responseHash,
    receipt.inputTokens,
    receipt.outputTokens,
    receipt.providerCompletedAt,
    receipt.workerVersionId,
    receipt.releaseGitSha,
    now,
  );
}

export interface DailyPublicationProof {
  receipt_id: string;
  reading_id: string;
  job_id: string;
  provider_job_id: string;
  model: string;
  prompt_version: string;
  request_hash: string;
  response_hash: string;
  input_tokens: number;
  output_tokens: number;
  provider_completed_at: string;
  worker_version_id: string;
  release_git_sha: string;
  published_at: string;
}

/**
 * The chain the receipt exists to make walkable: receipt -> succeeded job ->
 * published reading.
 *
 * Every link is asserted rather than assumed. A receipt beside a job that
 * failed, a reading that never reached `published`, or a reading whose active
 * job is a different one answers null — those are the shapes that would make
 * the receipt a story rather than a proof.
 */
export async function proveDailyPublication(
  env: Pick<Env, "DB">,
  readingId: string,
): Promise<DailyPublicationProof | null> {
  return await env.DB.prepare(
    `SELECT receipt.receipt_id, receipt.reading_id, receipt.job_id,
            receipt.provider_job_id, receipt.model, receipt.prompt_version,
            receipt.request_hash, receipt.response_hash,
            receipt.input_tokens, receipt.output_tokens,
            receipt.provider_completed_at, receipt.worker_version_id,
            receipt.release_git_sha, receipt.published_at
     FROM daily_publication_receipts receipt
     JOIN jobs job ON job.id = receipt.job_id
     JOIN daily_readings reading ON reading.id = receipt.reading_id
     WHERE receipt.reading_id = ?
       AND job.status = 'succeeded'
       AND job.result_class = 'published'
       AND reading.status = 'published'
       AND reading.reading_enc IS NOT NULL
       AND reading.active_generation_job_id = job.id
       AND reading.user_id = job.user_id
       AND reading.assembly_mode = 'constrained_model'
       AND reading.command_generation = receipt.command_generation
       AND receipt.stage_generation = receipt.command_generation`,
  )
    .bind(readingId)
    .first<DailyPublicationProof>();
}
