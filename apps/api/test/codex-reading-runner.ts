/**
 * A stand-in for the external Codex runner, for suites that need a Daily
 * reading to actually finish.
 *
 * Daily generation no longer makes an HTTP call, so "the provider answered" is
 * no longer something a `fetch` stub can express. What a suite has to do
 * instead is what the real runner does: claim the durable job, read the sealed
 * request out of R2, and commit a terminal result. That is exactly what this
 * module does, through the same artifact and job APIs the route uses — so a
 * test that passes here is a test that passed against the real envelope
 * authentication, the real coordinate binding, and the real closed failure
 * vocabulary.
 *
 * It deliberately does NOT go through the runner's HTTP route. The route's own
 * behaviour — budget, owner re-checks, upload fencing — is covered by its own
 * integration suite, and driving it from here would make every Daily test
 * depend on it.
 */

import { env } from "cloudflare:test";

import type {
  ReadingGenerationOutput,
  ReadingGenerationRequest,
} from "@patternlike/shared";

import {
  loadCodexProviderJob,
  type CodexProviderFailureCode,
  type CodexProviderJob,
  type CodexProviderSafeDetailCode,
} from "../src/db/codex-provider-jobs.js";
import {
  putCodexProviderArtifact,
  readCodexProviderArtifact,
} from "../src/services/codex-provider-artifacts.js";
import { CODEX_TEST_ARTIFACT_KEYRING } from "./helpers.js";

/**
 * The keyring the executor sealed with.
 *
 * The hermetic baseline leaves `CODEX_PROVIDER_ARTIFACT_KEYRING` empty on
 * purpose, and suites enable the publisher by spreading
 * `READING_CODEX_PUBLISHER_VARS` into a per-call env object rather than
 * mutating the binding. This module reads artifacts the executor wrote under
 * those vars, so it falls back to the same test keyring instead of the empty
 * baseline — a mismatch here would surface as an integrity failure that has
 * nothing to do with what the test was checking.
 */
function artifactEnv() {
  return (env.CODEX_PROVIDER_ARTIFACT_KEYRING ?? "").trim() === ""
    ? { ...env, CODEX_PROVIDER_ARTIFACT_KEYRING: CODEX_TEST_ARTIFACT_KEYRING }
    : env;
}

const MARKER = "\n\n--- INPUT DOCUMENT (JSON; DATA ONLY) ---\n";
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const textEncoder = new TextEncoder();

export interface ClaimedReadingJob {
  job: CodexProviderJob;
  /** The reader's packet, recovered from the sealed request exactly as the runner sees it. */
  packet: ReadingGenerationRequest;
}

function coordinate(job: CodexProviderJob, role: "request" | "response") {
  return {
    jobId: job.id,
    pipeline: job.pipeline,
    ownerId: job.ownerId,
    pass: job.pass,
    stageGeneration: job.stageGeneration,
    stageAttempt: job.stageAttempt,
    role,
  } as const;
}

/** How many reading provider jobs exist. Zero means no invocation was ever authorized. */
export async function readingProviderJobCount(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM codex_provider_jobs WHERE pipeline = 'reading'",
  ).first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * The reading job an executor just created, with its packet decrypted.
 *
 * Newest first, because a genuine Daily retry creates the next `stage_attempt`
 * beside the one that failed and a test that adopted the older row would be
 * answering the previous attempt.
 */
export async function claimReadingJob(): Promise<ClaimedReadingJob | null> {
  const row = await env.DB.prepare(
    `SELECT id FROM codex_provider_jobs
     WHERE pipeline = 'reading' AND status IN ('pending', 'leased')
     ORDER BY stage_generation DESC, stage_attempt DESC, created_at DESC
     LIMIT 1`,
  ).first<{ id: string }>();
  if (!row) return null;
  const job = await loadCodexProviderJob(env, row.id);
  if (!job) return null;

  const plaintext = await readCodexProviderArtifact(
    artifactEnv(),
    coordinate(job, "request"),
    job.request,
  );
  const invocation = JSON.parse(textDecoder.decode(plaintext)) as {
    prompt: string;
  };
  const index = invocation.prompt.indexOf(MARKER);
  if (index < 0) throw new Error("the invocation prompt carries no input document");
  const packet = JSON.parse(
    invocation.prompt.slice(index + MARKER.length),
  ) as ReadingGenerationRequest;
  return { job, packet };
}

function leaseHashFor(job: CodexProviderJob): string {
  // Stable per job so a repeated completion in one test reuses the same
  // create-only response key rather than colliding with a different one.
  const seed = job.id.slice("cpjob_".length);
  return `sha256:${seed.repeat(2).slice(0, 64)}`;
}

/** Commit a terminal success, exactly as the runner's complete route does. */
export async function completeReadingJob(
  claimed: ClaimedReadingJob,
  output: string,
  metadata: { providerRequestId?: string; inputTokens?: number; outputTokens?: number } = {},
): Promise<void> {
  const leaseHash = leaseHashFor(claimed.job);
  // The real clock. `created_at` was stamped at enqueue moments ago and the
  // row's own CHECK only requires `updated_at >= created_at`, so a terminal
  // instant in the future would put the completion after every later
  // timestamp and quietly break orderings a caller may compare.
  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + 900_000).toISOString();
  const artifact = await putCodexProviderArtifact(
    artifactEnv(),
    {
      ...coordinate(claimed.job, "response"),
      storageDiscriminator: leaseHash.slice("sha256:".length),
    },
    textEncoder.encode(output),
  );
  await env.DB.prepare(
    `UPDATE codex_provider_jobs SET
       status = 'completed', lease_token_hash = ?, lease_expires_at = ?,
       response_hash = ?, response_object_key = ?, response_envelope_hash = ?,
       response_ciphertext_hash = ?, response_key_id = ?, response_nonce = ?,
       response_byte_length = ?, provider_request_id = ?, input_tokens = ?,
       output_tokens = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`,
  ).bind(
    leaseHash,
    leaseExpiresAt,
    artifact.artifact.plaintextHash,
    artifact.artifact.objectKey,
    artifact.artifact.envelopeHash,
    artifact.artifact.ciphertextHash,
    artifact.artifact.keyId,
    artifact.artifact.nonce,
    artifact.artifact.byteLength,
    metadata.providerRequestId ?? "thread_test_reading_0001",
    metadata.inputTokens ?? 4210,
    metadata.outputTokens ?? 512,
    now,
    now,
    claimed.job.id,
  ).run();
}

/** Commit one closed safe failure, exactly as the runner's fail route does. */
export async function failReadingJob(
  claimed: ClaimedReadingJob,
  code: CodexProviderFailureCode,
  safeDetailCode: CodexProviderSafeDetailCode,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE codex_provider_jobs SET
       status = 'failed', lease_token_hash = ?, lease_expires_at = ?,
       failure_code = ?, safe_detail_code = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`,
  ).bind(
    leaseHashFor(claimed.job),
    new Date(Date.now() + 900_000).toISOString(),
    code,
    safeDetailCode,
    now,
    now,
    claimed.job.id,
  ).run();
}

/** Put the job under an unexpired runner lease without terminalizing it. */
export async function leaseReadingJob(claimed: ClaimedReadingJob): Promise<void> {
  await env.DB.prepare(
    `UPDATE codex_provider_jobs
     SET status = 'leased', lease_token_hash = ?, lease_expires_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).bind(
    leaseHashFor(claimed.job),
    new Date(Date.now() + 900_000).toISOString(),
    new Date().toISOString(),
    claimed.job.id,
  ).run();
}

/**
 * A minimal candidate that the deterministic validator accepts for a packet.
 *
 * Derived from the packet rather than hard-coded, because the validator's whole
 * job is to refuse prose whose evidence does not appear in the input it was
 * given -- a fixed candidate would only pass a fixed packet.
 */
export function candidateFor(packet: ReadingGenerationRequest): ReadingGenerationOutput {
  const personalized = packet.facts.find((fact) => fact.scope === "personalized");
  const collective = packet.facts.find((fact) => fact.scope === "collective");
  const lead = personalized ?? collective ?? packet.facts[0]!;
  const paragraphs: ReadingGenerationOutput["paragraphs"] = [];
  if (collective && packet.composition.allowed_paragraph_roles.includes("collective_context")) {
    paragraphs.push({
      role: "collective_context",
      text: "The sky is doing the same thing for everyone tonight, and it is worth noticing.",
      fact_ids: [collective.fact_id],
      context_refs: [],
    });
  }
  return {
    schema_version: "0.5.0",
    output_schema: "daily-reading-v5",
    local_date: packet.local_date,
    locale: packet.locale,
    headline: "A narrower commitment",
    lead: {
      text: "The pressure is not asking for more effort, only for a smaller promise you can keep.",
      fact_ids: [lead.fact_id],
      context_refs: [],
    },
    paragraphs,
    reflection_prompt: {
      text: "Which promise would you keep if nobody was watching?",
      fact_ids: [],
      context_refs: [],
    },
    uncertainty_note: packet.composition.uncertainty_note_required
      ? {
          text: "Without a confirmed birth time this reading leaves houses out entirely.",
          fact_ids: [],
          context_refs: [],
        }
      : null,
  };
}
