import {
  canonicalJson,
  contentHash,
  sha256Hex,
} from "@patternlike/shared";

import type { Env } from "../env.js";
import { CODEX_PROVIDER_LEASE_MS } from "../services/codex-provider-contract.js";
import type {
  PublisherFailureCode,
  PublisherSafeDetailCode,
} from "../services/openai-responses-adapter.js";

export type CodexProviderPipeline = "pattern" | "ontology" | "reading";
export type CodexProviderPass =
  | "planner"
  | "writer"
  | "verifier"
  | "generator"
  | "evaluator"
  | "publisher";

/**
 * The one legal-pair predicate, shared by enqueue and by the artifact layer.
 *
 * The two unions above are independent, so their product contains combinations
 * that name nothing: `reading`/`planner` has no owner loader, `ontology`/
 * `publisher` has no budget ledger, `pattern`/`publisher` has no stage. D1's
 * 0017 CHECK is the authority, but a row that only fails there has already had
 * an encrypted request object written to R2 with no job to reference it. This
 * runs first, before any R2 or D1 write, so an illegal coordinate costs
 * nothing and leaves nothing behind.
 */
export function validCodexProviderCoordinate(
  pipeline: CodexProviderPipeline,
  pass: CodexProviderPass,
): boolean {
  if (pipeline === "pattern") {
    return pass === "planner" || pass === "writer" || pass === "verifier";
  }
  if (pipeline === "ontology") {
    return pass === "planner" || pass === "writer" || pass === "verifier" ||
      pass === "generator" || pass === "evaluator";
  }
  return pipeline === "reading" && pass === "publisher";
}

/**
 * The second pre-write guard: who owns the work.
 *
 * Pattern and reading are user-owned so account erasure can find and delete
 * their encrypted exchange artifacts; ontology work is not user-owned and must
 * not acquire an owner by accident. Artifact coordinates carry no user
 * identity at all -- the encrypted envelope must not name a reader -- so the
 * artifact layer calls only the pair guard above.
 */
export function validCodexProviderOwnership(
  pipeline: CodexProviderPipeline,
  userId: string | null,
): boolean {
  return pipeline === "ontology" ? userId === null : userId !== null;
}
export type CodexProviderJobStatus =
  | "pending"
  | "leased"
  | "completed"
  | "failed"
  | "cancelled";
export type CodexProviderFailureCode =
  | PublisherFailureCode
  | "publisher_budget_exhausted";
export type CodexProviderSafeDetailCode =
  | PublisherSafeDetailCode
  | "daily_call_limit_reached";

export interface CodexProviderArtifactPointer {
  objectKey: string;
  plaintextHash: string;
  envelopeHash: string;
  ciphertextHash: string;
  keyId: string;
  nonce: string;
  byteLength: number;
}

export interface EnqueueCodexProviderJobInput {
  pipeline: CodexProviderPipeline;
  ownerId: string;
  userId: string | null;
  pass: CodexProviderPass;
  stageGeneration: number;
  stageAttempt: number;
  request: CodexProviderArtifactPointer;
  model: string;
  reasoningEffort: "high";
  promptVersion: string;
  timeoutMs: number;
  dailyCallLimit: number;
}

export interface CodexProviderJob {
  id: string;
  pipeline: CodexProviderPipeline;
  ownerId: string;
  userId: string | null;
  pass: CodexProviderPass;
  stageGeneration: number;
  stageAttempt: number;
  request: CodexProviderArtifactPointer;
  response: CodexProviderArtifactPointer | null;
  model: string;
  reasoningEffort: "high";
  promptVersion: string;
  timeoutMs: number;
  dailyCallLimit: number;
  status: CodexProviderJobStatus;
  leaseExpiresAt: string | null;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  failureCode: CodexProviderFailureCode | null;
  safeDetailCode: CodexProviderSafeDetailCode | null;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface CodexProviderJobRow {
  id: string;
  pipeline: CodexProviderPipeline;
  owner_id: string;
  user_id: string | null;
  pass: CodexProviderPass;
  stage_generation: number;
  stage_attempt: number;
  request_hash: string;
  request_object_key: string;
  request_envelope_hash: string;
  request_ciphertext_hash: string;
  request_key_id: string;
  request_nonce: string;
  request_byte_length: number;
  response_hash: string | null;
  response_object_key: string | null;
  response_envelope_hash: string | null;
  response_ciphertext_hash: string | null;
  response_key_id: string | null;
  response_nonce: string | null;
  response_byte_length: number | null;
  model: string;
  reasoning_effort: "high";
  prompt_version: string;
  timeout_ms: number;
  daily_call_limit: number;
  status: CodexProviderJobStatus;
  lease_token_hash: string | null;
  lease_expires_at: string | null;
  provider_request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  failure_code: CodexProviderFailureCode | null;
  safe_detail_code: CodexProviderSafeDetailCode | null;
  available_at: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const SELECT_COLUMNS = `
  id, pipeline, owner_id, user_id, pass, stage_generation, stage_attempt,
  request_hash, request_object_key, request_envelope_hash,
  request_ciphertext_hash, request_key_id, request_nonce, request_byte_length,
  response_hash, response_object_key, response_envelope_hash,
  response_ciphertext_hash, response_key_id, response_nonce,
  response_byte_length, model, reasoning_effort, prompt_version, timeout_ms,
  daily_call_limit, status, lease_token_hash, lease_expires_at,
  provider_request_id, input_tokens, output_tokens, failure_code,
  safe_detail_code, available_at, created_at, updated_at, completed_at
`;
const TERMINAL_UPLOAD_LEASE_EXTENSION_MS = 5 * 60 * 1000;

function artifactFromRow(
  row: CodexProviderJobRow,
  role: "request" | "response",
): CodexProviderArtifactPointer | null {
  const objectKey = row[`${role}_object_key`];
  const plaintextHash = row[`${role}_hash`];
  const envelopeHash = row[`${role}_envelope_hash`];
  const ciphertextHash = row[`${role}_ciphertext_hash`];
  const keyId = row[`${role}_key_id`];
  const nonce = row[`${role}_nonce`];
  const byteLength = row[`${role}_byte_length`];
  if (
    objectKey === null ||
    plaintextHash === null ||
    envelopeHash === null ||
    ciphertextHash === null ||
    keyId === null ||
    nonce === null ||
    byteLength === null
  ) {
    return null;
  }
  return {
    objectKey,
    plaintextHash,
    envelopeHash,
    ciphertextHash,
    keyId,
    nonce,
    byteLength,
  };
}

function jobFromRow(row: CodexProviderJobRow): CodexProviderJob {
  const request = artifactFromRow(row, "request");
  if (!request) throw new Error("codex provider request artifact missing");
  return {
    id: row.id,
    pipeline: row.pipeline,
    ownerId: row.owner_id,
    userId: row.user_id,
    pass: row.pass,
    stageGeneration: row.stage_generation,
    stageAttempt: row.stage_attempt,
    request,
    response: artifactFromRow(row, "response"),
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    promptVersion: row.prompt_version,
    timeoutMs: row.timeout_ms,
    dailyCallLimit: row.daily_call_limit,
    status: row.status,
    leaseExpiresAt: row.lease_expires_at,
    providerRequestId: row.provider_request_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    failureCode: row.failure_code,
    safeDetailCode: row.safe_detail_code,
    availableAt: row.available_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

async function loadById(
  env: Pick<Env, "DB">,
  id: string,
): Promise<CodexProviderJobRow | null> {
  return await env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} FROM codex_provider_jobs WHERE id = ?`,
  ).bind(id).first<CodexProviderJobRow>();
}

export async function loadCodexProviderJob(
  env: Pick<Env, "DB">,
  id: string,
): Promise<CodexProviderJob | null> {
  const row = await loadById(env, id);
  return row ? jobFromRow(row) : null;
}

/**
 * Authorizes a terminal write before any response artifact is created. A
 * byte-identical replay may inspect its matching terminal row after lease
 * expiry, but a different terminal state or token is always rejected.
 */
export async function authorizeCodexProviderTerminalWrite(
  env: Pick<Env, "DB">,
  input: {
    jobId: string;
    leaseToken: string;
    terminalStatus: "completed" | "failed";
  },
  now: Date,
): Promise<CodexProviderJob | null> {
  const row = await loadById(env, input.jobId);
  if (!row || row.lease_token_hash !== await contentHash(input.leaseToken)) {
    return null;
  }
  if (row.status === input.terminalStatus) return jobFromRow(row);
  if (
    row.status !== "leased" ||
    row.lease_expires_at === null ||
    row.lease_expires_at <= now.toISOString()
  ) {
    return null;
  }
  return jobFromRow(row);
}

async function loadByCoordinate(
  env: Pick<Env, "DB">,
  input: EnqueueCodexProviderJobInput,
): Promise<CodexProviderJobRow | null> {
  return await env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} FROM codex_provider_jobs
     WHERE pipeline = ? AND owner_id = ? AND pass = ?
       AND stage_generation = ? AND stage_attempt = ?`,
  ).bind(
    input.pipeline,
    input.ownerId,
    input.pass,
    input.stageGeneration,
    input.stageAttempt,
  ).first<CodexProviderJobRow>();
}

function immutableJobMatches(
  row: CodexProviderJobRow,
  input: EnqueueCodexProviderJobInput,
): boolean {
  const request = artifactFromRow(row, "request");
  return row.pipeline === input.pipeline &&
    row.owner_id === input.ownerId &&
    row.user_id === input.userId &&
    row.pass === input.pass &&
    row.stage_generation === input.stageGeneration &&
    row.stage_attempt === input.stageAttempt &&
    request !== null &&
    canonicalJson(request) === canonicalJson(input.request) &&
    row.model === input.model &&
    row.reasoning_effort === input.reasoningEffort &&
    row.prompt_version === input.promptVersion &&
    row.timeout_ms === input.timeoutMs &&
    row.daily_call_limit === input.dailyCallLimit;
}

export async function codexProviderJobId(
  input: Pick<
    EnqueueCodexProviderJobInput,
    | "pipeline"
    | "ownerId"
    | "pass"
    | "stageGeneration"
    | "stageAttempt"
  > & { requestHash: string },
): Promise<string> {
  const digest = await sha256Hex(canonicalJson({
    pipeline: input.pipeline,
    owner_id: input.ownerId,
    pass: input.pass,
    stage_generation: input.stageGeneration,
    stage_attempt: input.stageAttempt,
    request_hash: input.requestHash,
  }));
  return `cpjob_${digest.slice(0, 32)}`;
}

export async function enqueueCodexProviderJob(
  env: Pick<Env, "DB">,
  input: EnqueueCodexProviderJobInput,
  now: Date,
): Promise<{ status: "created" | "adopted"; job: CodexProviderJob }> {
  if (!validCodexProviderCoordinate(input.pipeline, input.pass)) {
    throw new Error("codex provider coordinate names no pipeline pass");
  }
  if (!validCodexProviderOwnership(input.pipeline, input.userId)) {
    throw new Error("codex provider ownership is illegal for this pipeline");
  }
  const nowIso = now.toISOString();
  const id = await codexProviderJobId({
    pipeline: input.pipeline,
    ownerId: input.ownerId,
    pass: input.pass,
    stageGeneration: input.stageGeneration,
    stageAttempt: input.stageAttempt,
    requestHash: input.request.plaintextHash,
  });
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO codex_provider_jobs (
       id, pipeline, owner_id, user_id, pass, stage_generation, stage_attempt,
       request_hash, request_object_key, request_envelope_hash,
       request_ciphertext_hash, request_key_id, request_nonce,
       request_byte_length, model, reasoning_effort, prompt_version,
       timeout_ms, daily_call_limit, status, available_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'pending', ?, ?, ?)`,
  ).bind(
    id,
    input.pipeline,
    input.ownerId,
    input.userId,
    input.pass,
    input.stageGeneration,
    input.stageAttempt,
    input.request.plaintextHash,
    input.request.objectKey,
    input.request.envelopeHash,
    input.request.ciphertextHash,
    input.request.keyId,
    input.request.nonce,
    input.request.byteLength,
    input.model,
    input.reasoningEffort,
    input.promptVersion,
    input.timeoutMs,
    input.dailyCallLimit,
    nowIso,
    nowIso,
    nowIso,
  ).run();

  const row = await loadByCoordinate(env, input);
  if (!row || !immutableJobMatches(row, input)) {
    throw new Error("codex provider job identity conflict");
  }
  return {
    status: result.meta.changes === 1 ? "created" : "adopted",
    job: jobFromRow(row),
  };
}

function newLeaseToken(): string {
  return `cplease_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function claimCodexProviderJob(
  env: Pick<Env, "DB">,
  now: Date,
): Promise<
  | { status: "claimed"; job: CodexProviderJob; leaseToken: string }
  | { status: "empty" }
> {
  const nowIso = now.toISOString();
  for (let conflict = 0; conflict < 4; conflict += 1) {
    const candidate = await env.DB.prepare(
      `SELECT id FROM codex_provider_jobs
       WHERE (
         status = 'pending' AND available_at <= ?
       ) OR (
         status = 'leased' AND lease_expires_at <= ?
       )
       ORDER BY available_at, created_at, id
       LIMIT 1`,
    ).bind(nowIso, nowIso).first<{ id: string }>();
    if (!candidate) return { status: "empty" };

    const leaseToken = newLeaseToken();
    const leaseTokenHash = await contentHash(leaseToken);
    const leaseExpiresAt = new Date(
      now.getTime() + CODEX_PROVIDER_LEASE_MS,
    ).toISOString();
    const updated = await env.DB.prepare(
      `UPDATE codex_provider_jobs
       SET status = 'leased', lease_token_hash = ?, lease_expires_at = ?,
           updated_at = ?
       WHERE id = ? AND (
         (status = 'pending' AND available_at <= ?)
         OR (status = 'leased' AND lease_expires_at <= ?)
       )`,
    ).bind(
      leaseTokenHash,
      leaseExpiresAt,
      nowIso,
      candidate.id,
      nowIso,
      nowIso,
    ).run();
    if (updated.meta.changes !== 1) continue;
    const row = await loadById(env, candidate.id);
    if (!row) throw new Error("codex provider claimed job missing");
    return { status: "claimed", job: jobFromRow(row), leaseToken };
  }
  return { status: "empty" };
}

export async function reserveCodexProviderResponseUpload(
  env: Pick<Env, "DB">,
  input: { jobId: string; leaseToken: string },
  now: Date,
): Promise<
  | { status: "reserved"; objectKey: string }
  | { status: "conflict" }
> {
  const leaseTokenHash = await contentHash(input.leaseToken);
  const discriminator = leaseTokenHash.slice("sha256:".length);
  const objectKey =
    `codex-provider-jobs/${input.jobId}/responses/${discriminator}.json.enc`;
  const nowIso = now.toISOString();
  const extendedUntil = new Date(
    now.getTime() + TERMINAL_UPLOAD_LEASE_EXTENSION_MS,
  ).toISOString();
  const [lease, inventory] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE codex_provider_jobs
       SET lease_expires_at = CASE
             WHEN lease_expires_at < ? THEN ? ELSE lease_expires_at
           END,
           updated_at = ?
       WHERE id = ? AND status = 'leased' AND lease_token_hash = ?
         AND lease_expires_at > ?
         AND (
           pipeline = 'ontology'
           OR EXISTS (
             SELECT 1 FROM users
             WHERE users.id = codex_provider_jobs.user_id
               AND users.status = 'active'
           )
         )`,
    ).bind(
      extendedUntil,
      extendedUntil,
      nowIso,
      input.jobId,
      leaseTokenHash,
      nowIso,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO codex_provider_response_uploads (
         job_id, lease_token_hash, object_key, created_at
       )
       SELECT id, ?, ?, ? FROM codex_provider_jobs
       WHERE id = ? AND status = 'leased' AND lease_token_hash = ?
         AND lease_expires_at > ?`,
    ).bind(
      leaseTokenHash,
      objectKey,
      nowIso,
      input.jobId,
      leaseTokenHash,
      nowIso,
    ),
  ]);
  if (lease.meta.changes !== 1) return { status: "conflict" };
  if (inventory.meta.changes === 1) {
    return { status: "reserved", objectKey };
  }
  const existing = await env.DB.prepare(
    `SELECT object_key FROM codex_provider_response_uploads
     WHERE job_id = ? AND lease_token_hash = ?`,
  ).bind(input.jobId, leaseTokenHash).first<{ object_key: string }>();
  return existing?.object_key === objectKey
    ? { status: "reserved", objectKey }
    : { status: "conflict" };
}

export interface CompleteCodexProviderJobInput {
  jobId: string;
  leaseToken: string;
  response: CodexProviderArtifactPointer;
  providerRequestId: string;
  inputTokens: number;
  outputTokens: number;
}

function completedJobMatches(
  row: CodexProviderJobRow,
  input: CompleteCodexProviderJobInput,
  leaseTokenHash: string,
): boolean {
  return row.status === "completed" &&
    row.lease_token_hash === leaseTokenHash &&
    canonicalJson(artifactFromRow(row, "response")) ===
      canonicalJson(input.response) &&
    row.provider_request_id === input.providerRequestId &&
    row.input_tokens === input.inputTokens &&
    row.output_tokens === input.outputTokens;
}

export async function completeCodexProviderJob(
  env: Pick<Env, "DB">,
  input: CompleteCodexProviderJobInput,
  now: Date,
): Promise<{ status: "completed" | "adopted" | "conflict" | "stale" }> {
  const leaseTokenHash = await contentHash(input.leaseToken);
  const existing = await loadById(env, input.jobId);
  if (!existing) return { status: "stale" };
  if (existing.status === "completed") {
    return {
      status: completedJobMatches(existing, input, leaseTokenHash)
        ? "adopted"
        : "conflict",
    };
  }
  if (existing.status !== "leased") return { status: "stale" };

  const nowIso = now.toISOString();
  const updated = await env.DB.prepare(
    `UPDATE codex_provider_jobs SET
       status = 'completed', response_hash = ?, response_object_key = ?,
       response_envelope_hash = ?, response_ciphertext_hash = ?,
       response_key_id = ?, response_nonce = ?, response_byte_length = ?,
       provider_request_id = ?, input_tokens = ?, output_tokens = ?,
       updated_at = ?, completed_at = ?
     WHERE id = ? AND status = 'leased' AND lease_token_hash = ?
       AND lease_expires_at > ?`,
  ).bind(
    input.response.plaintextHash,
    input.response.objectKey,
    input.response.envelopeHash,
    input.response.ciphertextHash,
    input.response.keyId,
    input.response.nonce,
    input.response.byteLength,
    input.providerRequestId,
    input.inputTokens,
    input.outputTokens,
    nowIso,
    nowIso,
    input.jobId,
    leaseTokenHash,
    nowIso,
  ).run();
  if (updated.meta.changes === 1) return { status: "completed" };
  const winner = await loadById(env, input.jobId);
  if (winner?.status === "completed") {
    return {
      status: completedJobMatches(winner, input, leaseTokenHash)
        ? "adopted"
        : "conflict",
    };
  }
  return { status: "stale" };
}

export interface FailCodexProviderJobInput {
  jobId: string;
  leaseToken: string;
  code: CodexProviderFailureCode;
  safeDetailCode: CodexProviderSafeDetailCode;
}

export async function failCodexProviderJob(
  env: Pick<Env, "DB">,
  input: FailCodexProviderJobInput,
  now: Date,
): Promise<{ status: "failed" | "adopted" | "conflict" | "stale" }> {
  const leaseTokenHash = await contentHash(input.leaseToken);
  const existing = await loadById(env, input.jobId);
  if (!existing) return { status: "stale" };
  if (existing.status === "failed") {
    return {
      status:
        existing.lease_token_hash === leaseTokenHash &&
        existing.failure_code === input.code &&
        existing.safe_detail_code === input.safeDetailCode
          ? "adopted"
          : "conflict",
    };
  }
  if (existing.status !== "leased") return { status: "stale" };

  const nowIso = now.toISOString();
  const updated = await env.DB.prepare(
    `UPDATE codex_provider_jobs
     SET status = 'failed', failure_code = ?, safe_detail_code = ?,
         updated_at = ?, completed_at = ?
     WHERE id = ? AND status = 'leased' AND lease_token_hash = ?
       AND lease_expires_at > ?`,
  ).bind(
    input.code,
    input.safeDetailCode,
    nowIso,
    nowIso,
    input.jobId,
    leaseTokenHash,
    nowIso,
  ).run();
  if (updated.meta.changes === 1) return { status: "failed" };
  const winner = await loadById(env, input.jobId);
  if (winner?.status === "failed") {
    return {
      status:
        winner.lease_token_hash === leaseTokenHash &&
        winner.failure_code === input.code &&
        winner.safe_detail_code === input.safeDetailCode
          ? "adopted"
          : "conflict",
    };
  }
  return { status: "stale" };
}

export async function releaseCodexProviderJobLease(
  env: Pick<Env, "DB">,
  input: { jobId: string; leaseToken: string; availableAt: Date },
  now: Date,
): Promise<boolean> {
  const leaseTokenHash = await contentHash(input.leaseToken);
  const result = await env.DB.prepare(
    `UPDATE codex_provider_jobs
     SET status = 'pending', lease_token_hash = NULL,
         lease_expires_at = NULL, available_at = ?, updated_at = ?
     WHERE id = ? AND status = 'leased' AND lease_token_hash = ?
       AND lease_expires_at > ?`,
  ).bind(
    input.availableAt.toISOString(),
    now.toISOString(),
    input.jobId,
    leaseTokenHash,
    now.toISOString(),
  ).run();
  return result.meta.changes === 1;
}

export async function cancelCodexProviderJob(
  env: Pick<Env, "DB">,
  input: { jobId: string; leaseToken: string },
  now: Date,
): Promise<boolean> {
  const leaseTokenHash = await contentHash(input.leaseToken);
  const nowIso = now.toISOString();
  const result = await env.DB.prepare(
    `UPDATE codex_provider_jobs
     SET status = 'cancelled', lease_token_hash = NULL,
         lease_expires_at = NULL, updated_at = ?, completed_at = ?
     WHERE id = ? AND status = 'leased' AND lease_token_hash = ?
       AND lease_expires_at > ?`,
  ).bind(
    nowIso,
    nowIso,
    input.jobId,
    leaseTokenHash,
    nowIso,
  ).run();
  return result.meta.changes === 1;
}

/** Maintenance cancellation for work whose domain coordinate no longer exists. */
export async function cancelStaleCodexProviderJob(
  env: Pick<Env, "DB">,
  jobId: string,
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString();
  const result = await env.DB.prepare(
    `UPDATE codex_provider_jobs
     SET status = 'cancelled', lease_token_hash = NULL,
         lease_expires_at = NULL, updated_at = ?, completed_at = ?
     WHERE id = ? AND (
       status = 'pending'
       OR (status = 'leased' AND lease_expires_at <= ?)
     )`,
  ).bind(nowIso, nowIso, jobId, nowIso).run();
  return result.meta.changes === 1;
}
