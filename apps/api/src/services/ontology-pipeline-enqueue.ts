import { canonicalJson, contentHash } from "@patternlike/shared";

import type { Env } from "../env.js";
import { resolveOntologyPipelineConfiguration } from "../middleware/config-guard.js";
import {
  buildOntologyPipelineCommand,
  type OntologyPipelineCommand,
} from "./ontology-pipeline-command.js";

export interface EnqueueOntologyPipelineInput {
  idempotencyKey: string;
  corpusReleaseId: string;
  candidateOntologyVersion: string;
}

export interface EnqueueOntologyPipelineResult {
  status: "reserved" | "replay";
  runId: string;
  stageGeneration: number;
  configurationHash: string;
  dispatched: boolean;
}

interface ReservationRow {
  run_id: string;
  idempotency_key: string;
  corpus_release_id: string;
  corpus_hash: string;
  candidate_ontology_version: string;
  configuration_json: string;
  configuration_hash: string;
  stage_generation: number;
  dispatched_at: string | null;
}

interface OutboxRow {
  run_id: string;
  stage: string;
  stage_generation: number;
  stage_cursor: number;
  stage_attempt: number;
  available_at: string;
}

export const ONTOLOGY_PIPELINE_OUTBOX_LIMIT = 4;

export class OntologyPipelineEnqueueError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OntologyPipelineEnqueueError";
  }
}

function fail(code: string): never {
  throw new OntologyPipelineEnqueueError(code);
}

function isReservationIdentityConflict(cause: unknown): boolean {
  return cause instanceof Error && (
    cause.message.includes("ontology pipeline command identity cannot be reused") ||
    /UNIQUE constraint failed: pattern_ontology_pipeline_runs\.(?:run_id|idempotency_key|candidate_ontology_version)/.test(
      cause.message,
    )
  );
}

function inputIsValid(input: EnqueueOntologyPipelineInput): boolean {
  return (
    input.idempotencyKey.length > 0 &&
    input.idempotencyKey.length <= 256 &&
    input.corpusReleaseId.length > 0 &&
    input.corpusReleaseId.length <= 200 &&
    input.candidateOntologyVersion.length > 0 &&
    input.candidateOntologyVersion.length <= 200
  );
}

async function loadOccupiedReservation(
  env: Pick<Env, "DB">,
  input: EnqueueOntologyPipelineInput,
): Promise<ReservationRow | null> {
  return env.DB.prepare(
    `SELECT run_id, idempotency_key, corpus_release_id, corpus_hash,
            candidate_ontology_version, configuration_json,
            configuration_hash, stage_generation, dispatched_at
     FROM pattern_ontology_pipeline_runs
     WHERE idempotency_key = ? OR candidate_ontology_version = ?
     ORDER BY CASE WHEN idempotency_key = ? THEN 0 ELSE 1 END
     LIMIT 1`,
  ).bind(
    input.idempotencyKey,
    input.candidateOntologyVersion,
    input.idempotencyKey,
  ).first<ReservationRow>();
}

function reservationMatches(
  row: ReservationRow,
  input: EnqueueOntologyPipelineInput,
  command: OntologyPipelineCommand,
  configurationJson: string,
  configurationHash: string,
): boolean {
  return (
    row.idempotency_key === input.idempotencyKey &&
    row.corpus_release_id === command.corpus.corpus_release_id &&
    row.corpus_hash === command.corpus.corpus_hash &&
    row.candidate_ontology_version === command.candidate_ontology_version &&
    row.configuration_json === configurationJson &&
    row.configuration_hash === configurationHash
  );
}

async function markOntologyPipelineDispatched(
  env: Pick<Env, "DB">,
  row: OutboxRow,
  now: Date,
): Promise<boolean> {
  const at = now.toISOString();
  const result = await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET dispatched_at = ?, updated_at = ?
     WHERE run_id = ? AND stage = ? AND stage_generation = ?
       AND stage_cursor = ? AND stage_attempt = ?
       AND claim_token IS NULL AND lease_expires_at IS NULL
       AND dispatched_at IS NULL
       AND unixepoch(available_at) <= unixepoch(?)`,
  ).bind(
    at,
    at,
    row.run_id,
    row.stage,
    row.stage_generation,
    row.stage_cursor,
    row.stage_attempt,
    at,
  ).run();
  return result.meta.changes === 1;
}

async function markOntologyPipelineDispatchedBatch(
  env: Pick<Env, "DB">,
  rows: readonly OutboxRow[],
  now: Date,
): Promise<number> {
  if (rows.length === 0) return 0;
  const at = now.toISOString();
  const coordinates = rows.map(() => (
    `(run_id = ? AND stage = ? AND stage_generation = ?
      AND stage_cursor = ? AND stage_attempt = ?)`
  )).join(" OR ");
  const bindings: unknown[] = [at, at];
  for (const row of rows) {
    bindings.push(
      row.run_id,
      row.stage,
      row.stage_generation,
      row.stage_cursor,
      row.stage_attempt,
    );
  }
  bindings.push(at);
  const result = await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET dispatched_at = ?, updated_at = ?
     WHERE (${coordinates})
       AND stage NOT IN ('succeeded', 'failed')
       AND claim_token IS NULL AND lease_expires_at IS NULL
       AND dispatched_at IS NULL
       AND unixepoch(available_at) <= unixepoch(?)`,
  ).bind(...bindings).run();
  return result.meta.changes ?? 0;
}

async function dispatchOne(
  env: Pick<Env, "DB" | "ONTOLOGY_PIPELINE_QUEUE">,
  row: OutboxRow,
  now: Date,
): Promise<boolean> {
  await env.ONTOLOGY_PIPELINE_QUEUE.send({
    run_id: row.run_id,
    stage_generation: row.stage_generation,
  });
  return markOntologyPipelineDispatched(env, row, now);
}

async function loadOutboxRow(
  env: Pick<Env, "DB">,
  runId: string,
  now: Date,
): Promise<OutboxRow | null> {
  const at = now.toISOString();
  return env.DB.prepare(
    `SELECT run_id, stage, stage_generation, stage_cursor, stage_attempt,
            available_at
     FROM pattern_ontology_pipeline_runs
     WHERE run_id = ? AND stage NOT IN ('succeeded', 'failed')
       AND claim_token IS NULL AND lease_expires_at IS NULL
       AND dispatched_at IS NULL
       AND unixepoch(available_at) <= unixepoch(?)`,
  ).bind(runId, at).first<OutboxRow>();
}

/**
 * Reserve first, then nudge Queue. A send failure leaves the committed outbox
 * marker null so replay or cron can repair it without changing command bytes.
 */
export async function enqueueOntologyPipelineRun(
  env: Env,
  input: EnqueueOntologyPipelineInput,
  now = new Date(),
): Promise<EnqueueOntologyPipelineResult> {
  if (!inputIsValid(input)) fail("ontology_pipeline_command_invalid");
  const command = await buildOntologyPipelineCommand(
    env,
    input.corpusReleaseId,
    input.candidateOntologyVersion,
  );
  const configurationJson = canonicalJson(command);
  const configurationHash = await contentHash(configurationJson);
  let row = await loadOccupiedReservation(env, input);
  let status: "reserved" | "replay" = "replay";
  if (row) {
    if (!reservationMatches(
      row,
      input,
      command,
      configurationJson,
      configurationHash,
    )) {
      fail("ontology_pipeline_command_conflict");
    }
  } else {
    const runId = `oprun_${crypto.randomUUID()}`;
    const at = now.toISOString();
    try {
      await env.DB.prepare(
        `INSERT INTO pattern_ontology_pipeline_runs (
           run_id, idempotency_key, corpus_release_id, corpus_hash,
           candidate_ontology_version, configuration_json, configuration_hash,
           stage, stage_generation, stage_cursor, stage_attempt,
           claim_token, lease_expires_at, available_at, dispatched_at,
           failure_class, candidate_hash, compilation_report_hash,
           evaluation_report_hash, regression_report_hash, bundle_hash,
           failed_artifact_expires_at, created_at, updated_at,
           finished_at, succeeded_at, failed_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, 'reserved', 0, 0, 0,
           NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           NULL, ?, ?, NULL, NULL, NULL
         )`,
      ).bind(
        runId,
        input.idempotencyKey,
        command.corpus.corpus_release_id,
        command.corpus.corpus_hash,
        command.candidate_ontology_version,
        configurationJson,
        configurationHash,
        at,
        at,
        at,
      ).run();
      status = "reserved";
      row = await loadOccupiedReservation(env, input);
    } catch (cause) {
      if (!isReservationIdentityConflict(cause)) throw cause;
      row = await loadOccupiedReservation(env, input);
      if (!row) throw cause;
      if (!reservationMatches(
        row,
        input,
        command,
        configurationJson,
        configurationHash,
      )) {
        fail("ontology_pipeline_command_conflict");
      }
    }
  }
  if (!row) fail("ontology_pipeline_reservation_unavailable");

  let dispatched = row.dispatched_at !== null;
  if (!dispatched) {
    const outbox = await loadOutboxRow(env, row.run_id, now);
    if (outbox) {
      try {
        dispatched = await dispatchOne(env, outbox, now);
        if (!dispatched) {
          const refreshed = await loadOccupiedReservation(env, input);
          dispatched = refreshed?.dispatched_at !== null;
        }
      } catch {
        dispatched = false;
      }
    }
  }
  return {
    status,
    runId: row.run_id,
    stageGeneration: row.stage_generation,
    configurationHash,
    dispatched,
  };
}

export async function dispatchUndispatchedOntologyPipelineRuns(
  env: Env,
  now = new Date(),
  limit = ONTOLOGY_PIPELINE_OUTBOX_LIMIT,
): Promise<{ dispatched: number; failed: number }> {
  const configuration = resolveOntologyPipelineConfiguration(env);
  if (!configuration.ok || configuration.rollout === "off") {
    return { dispatched: 0, failed: 0 };
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { dispatched: 0, failed: 0 };
  }
  const at = now.toISOString();
  const { results } = await env.DB.prepare(
    `SELECT run_id, stage, stage_generation, stage_cursor, stage_attempt,
            available_at
     FROM pattern_ontology_pipeline_runs
     WHERE stage NOT IN ('succeeded', 'failed')
       AND claim_token IS NULL AND lease_expires_at IS NULL
       AND dispatched_at IS NULL
       AND unixepoch(available_at) <= unixepoch(?)
     ORDER BY available_at, run_id LIMIT ?`,
  ).bind(at, limit).all<OutboxRow>();
  const sent: OutboxRow[] = [];
  let failed = 0;
  for (const row of results) {
    try {
      await env.ONTOLOGY_PIPELINE_QUEUE.send({
        run_id: row.run_id,
        stage_generation: row.stage_generation,
      });
      sent.push(row);
    } catch {
      failed += 1;
    }
  }
  try {
    return {
      dispatched: await markOntologyPipelineDispatchedBatch(env, sent, now),
      failed,
    };
  } catch {
    return { dispatched: 0, failed: failed + sent.length };
  }
}

/** Rollout-off acknowledgement puts this generation back in the outbox lane. */
export async function pauseOntologyPipelineDelivery(
  env: Pick<Env, "DB">,
  message: { run_id: string; stage_generation: number },
  now = new Date(),
): Promise<boolean> {
  const at = now.toISOString();
  const result = await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET dispatched_at = NULL, available_at = ?, updated_at = ?
     WHERE run_id = ? AND stage_generation = ?
       AND stage NOT IN ('succeeded', 'failed')
       AND claim_token IS NULL AND lease_expires_at IS NULL`,
  ).bind(at, at, message.run_id, message.stage_generation).run();
  return result.meta.changes === 1;
}
