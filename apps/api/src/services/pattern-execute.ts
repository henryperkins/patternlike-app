import {
  contentHash,
  newId,
  sha256Hex,
  type PatternPlan,
  type PatternPlannerOutput,
  type PatternSemanticVerdict,
  type PatternWriterOutput,
} from "@patternlike/shared";
import {
  selectPatternEvidence,
  validatePatternCandidate,
  validatePatternPlan,
} from "@patternlike/pattern-engine";
import type { Env, PatternGenerationMessage } from "../env.js";
import { b64 } from "../crypto.js";
import { decryptPayload, loadUserIdentity, type UserIdentity } from "../db/users.js";
import { loadPreferences } from "../db/preferences.js";
import { ensureNatalFeatureSet } from "../db/natal-features.js";
import { loadActiveOntology, loadOntologyByVersion } from "../db/pattern-ontology.js";
import { loadPatternGenerationGrant } from "../db/pattern-consents.js";
import { isConsumedStatus, loadClaimForFingerprint } from "../db/pattern-claims.js";
import { consumePatternProviderCallBudget, utcDateFor } from "../db/pattern-provider-usage.js";
import { loadCodexProviderJob } from "../db/codex-provider-jobs.js";
import {
  PATTERN_JOB_TYPE,
  isPatternCommand,
  type GeneratePatternCommandV1,
} from "./pattern-command.js";
import {
  buildPatternTransitionStatements,
  commitPatternTransition,
  loadPatternJob,
  patternArtifactId,
  patternAttemptCoordinate,
  patternDeliveryIsCurrent,
  patternPassProtocol,
  patternStageOwner,
  planPatternTransition,
  publicStageFor,
  type PatternAttemptCoordinate,
  type PatternJobRow,
  type PatternTransition,
} from "./pattern-stage-protocol.js";
import { hashesEqual } from "./content-release.js";
import {
  OPENAI_PATTERN_WRITER_MODEL,
  PATTERN_PUBLISHER_CODEX,
  PATTERN_PUBLISHER_OPENAI,
  PATTERN_PUBLISHER_WORKERS_AI,
  WORKERS_AI_PATTERN_WRITER_MODEL,
  resolvePatternPublisherConfiguration,
  type PatternPassOutcome,
  type PatternPassOptions,
  type PatternPublisher,
  type PatternPublisherConfig,
  type PatternPublisherPin,
  type PatternStageClass,
} from "./pattern-publisher.js";
import {
  createOpenAiPatternPublisher,
  createSyntheticPatternPublisher,
} from "./pattern-publisher-factory.js";
import { createWorkersAiPatternPublisher } from "./workers-ai-pattern-publisher.js";
import { createCodexPatternPublisher } from "./codex-pattern-publisher.js";
import { nudgeCodexProviderOwner } from "./codex-provider-domain.js";
import {
  PATTERN_PACKET_LIMITS_DEFAULT,
  buildCorrectionDocument,
  buildPlannerInput,
  buildVerifierInput,
  buildWriterInput,
  type PatternCorrectionDocument,
  type PatternPacketLimits,
} from "./pattern-packet.js";
import { readPatternAiRollout } from "./pattern-rollout.js";
import { findSemanticVerdictProblem, resolveSemanticForceReject } from "./pattern-semantic.js";
import {
  artifactAad,
  decryptUnderContentKey,
  encryptUnderContentKey,
  randomNonce,
  unwrapContentKey,
  wrapContentKey,
  randomKey,
} from "./pattern-crypto.js";
import { safeLog } from "./safe-log.js";
import {
  PatternReplayLedgerError,
  writePatternReplayIntent,
} from "./pattern-replay-ledger.js";

const CLAIM_LEASE_MS = 5 * 60 * 1000;

/**
 * Coarse public families for the exact writer-model pins this build can run.
 *
 * The exact model id stays in the encrypted provider artifact metadata. The
 * clear compact provenance carries only this compiled family label, and an
 * unknown OpenAI model fails closed rather than being guessed from its name.
 */
const MODEL_FAMILY_BY_WRITER_MODEL: Readonly<Record<string, string>> = {
  [OPENAI_PATTERN_WRITER_MODEL]: "gpt",
  [WORKERS_AI_PATTERN_WRITER_MODEL]: "gpt-oss",
};

function provenanceFromExecutedPin(pin: PatternPublisherPin): {
  provider: string;
  model_family: string;
} {
  if (pin.publisher === PATTERN_PUBLISHER_WORKERS_AI) {
    const family = MODEL_FAMILY_BY_WRITER_MODEL[pin.writer_model];
    if (!family) throw new Error("unsupported Pattern writer model family");
    return { provider: "Cloudflare Workers AI", model_family: family };
  }
  if (
    pin.publisher !== PATTERN_PUBLISHER_OPENAI &&
    pin.publisher !== PATTERN_PUBLISHER_CODEX
  ) {
    return { provider: "synthetic", model_family: "synthetic" };
  }
  const modelFamily = MODEL_FAMILY_BY_WRITER_MODEL[pin.writer_model];
  if (!modelFamily) throw new Error("unsupported Pattern writer model family");
  // The document says who actually wrote it. Reporting "OpenAI" for a Codex
  // pass would put a false provenance record in front of a reader, which is the
  // exact failure the executed-pin check and the closed model-family allowlist
  // exist to prevent -- the reader-facing `provider` is a plain string in the
  // frozen contract precisely so a second honest value costs no schema bump.
  return {
    provider: pin.publisher === PATTERN_PUBLISHER_CODEX ? "Codex" : "OpenAI",
    model_family: modelFamily,
  };
}

/**
 * Emit cost/failure telemetry at the executor boundary, before deterministic
 * validation. A model answer rejected by validation still consumed the call.
 * Adopted response artifacts bypass this helper and therefore emit no second
 * provider event.
 */
async function runPublisherPass<T>(
  pin: PatternPublisherPin,
  pass: PatternStageClass,
  attempt: number,
  invoke: () => Promise<PatternPassOutcome<T>>,
): Promise<PatternPassOutcome<T>> {
  const startedAt = Date.now();
  const outcome = await invoke();
  if (!outcome.ok && outcome.code === "publisher_pending") return outcome;
  // Both real providers are measured and provenance-checked. Only the
  // deterministic stand-in is exempt, because it never spoke to anyone.
  if (
    pin.publisher !== PATTERN_PUBLISHER_OPENAI &&
    pin.publisher !== PATTERN_PUBLISHER_CODEX &&
    pin.publisher !== PATTERN_PUBLISHER_WORKERS_AI
  ) {
    return outcome;
  }

  const latencyMs = Math.max(0, Date.now() - startedAt);
  if (!outcome.ok) {
    safeLog({
      event: "pattern_publisher_attempt_failed",
      provider: pin.publisher,
      pass,
      model: pin[`${pass}_model`],
      prompt_version: pin[`${pass}_prompt_version`],
      latency_ms: latencyMs,
      attempt,
      failure_class: outcome.code,
      safe_detail_code: outcome.safe_detail_code,
    });
    return outcome;
  }

  const metadata = outcome.metadata;
  if (
    // Still exact, just no longer hardcoded to one provider: a pass that
    // answered from a different transport than the frozen pin names is
    // inconsistent provenance, whichever of the two it was.
    metadata.provider !== pin.publisher ||
    metadata.pass !== pass ||
    metadata.model !== pin[`${pass}_model`] ||
    metadata.prompt_version !== pin[`${pass}_prompt_version`] ||
    metadata.input_tokens === null ||
    metadata.output_tokens === null ||
    metadata.provider_response_hash === null
  ) {
    throw new Error("Pattern publisher returned inconsistent provenance");
  }
  safeLog({
    event: "pattern_publisher_call_completed",
    provider: metadata.provider,
    pass: metadata.pass,
    model: metadata.model,
    prompt_version: metadata.prompt_version,
    latency_ms: latencyMs,
    input_tokens: metadata.input_tokens,
    output_tokens: metadata.output_tokens,
    provider_response_hash: metadata.provider_response_hash,
  });
  return outcome;
}

/** The M7 stage-aware backoff, with `retry_after_seconds` acting as a floor. */
const PASS_RETRY_BACKOFF_SECONDS = [30, 120, 600] as const;

function retryAvailableAt(now: Date, attempt: number, floorSeconds: number | null): Date {
  const index = Math.min(Math.max(attempt, 0), PASS_RETRY_BACKOFF_SECONDS.length - 1);
  const seconds = Math.max(PASS_RETRY_BACKOFF_SECONDS[index]!, floorSeconds ?? 0);
  return new Date(now.getTime() + seconds * 1000);
}

/**
 * The `publisher_output_invalid` details another sample can fix.
 *
 * Deliberately not the whole code. `provider_4xx` is a request this Worker built
 * wrong and a retry reproduces it exactly; `gateway_cache_hit` and
 * `gateway_dlp_match` are gateway configuration and will reproduce too. Retrying
 * any of the three spends the pass ceiling on a call that cannot succeed.
 */
const RETRYABLE_OUTPUT_DETAILS: ReadonlySet<string> = new Set([
  "invalid_json",
  "missing_output_text",
  "multiple_output_text",
  "schema_mismatch",
  "max_output_tokens_exhausted",
]);

function passFailureIsRetryable(code: string, detail: string): boolean {
  // Timeout, network throw, 429 and 5xx all arrive as publisher_unavailable.
  if (code === "publisher_unavailable") return true;
  if (code === "publisher_output_invalid") return RETRYABLE_OUTPUT_DETAILS.has(detail);
  // publisher_auth_failed, publisher_model_unavailable, publisher_refused and
  // publisher_budget_exhausted are terminal by design: the credential, the
  // model name, the refusal and the day's ceiling are identical next time.
  return false;
}

/** The failure class recorded for a provider refusal. */
function passFailureClass(code: string, detail: string): string {
  return code === "publisher_output_invalid" && detail === "provider_4xx"
    ? "publisher_request_invalid"
    : code;
}

async function nudgeNextStage(
  env: Env,
  job: PatternJobRow,
  nextStageGeneration: number,
): Promise<void> {
  try {
    await env.PATTERN_QUEUE.send({
      kind: "pattern_generation",
      job_id: job.job_id,
      generation_id: job.generation_id,
      stage_generation: nextStageGeneration,
    });
  } catch {
    safeLog({ event: "pattern_dispatch_failed" });
  }
}

type QueuedPatternTransition = Extract<
  PatternTransition,
  { kind: "advance" | "retry" | "return_to_writer" }
>;

async function commitAndNudgePatternTransition(
  env: Env,
  job: PatternJobRow,
  token: string,
  transition: QueuedPatternTransition,
): Promise<boolean> {
  const effect = await commitPatternTransition(env, job, token, transition);
  if (!effect?.nextQueueCoordinate) return false;
  await nudgeNextStage(env, job, effect.nextQueueCoordinate.stageGeneration);
  return true;
}

export type PatternExecuteOutcome =
  | { ok: true; terminal: boolean }
  | { ok: false; reason: "duplicate" | "retry" | "terminal"; failureClass: string };

/**
 * Did this message name a stage the job has already moved past?
 *
 * Read from durable state rather than from the thrown error: the abort the
 * assertion probe raises and a transient D1 failure both surface as a rejected
 * batch, and only the job row can tell them apart. Anything this cannot prove
 * is a duplicate is treated as retryable.
 */
async function stageMovedOn(env: Env, message: PatternGenerationMessage): Promise<boolean> {
  try {
    const job = await loadPatternJob(env, message.generation_id);
    if (!job) return true;
    return !patternDeliveryIsCurrent(job, {
      generationId: message.generation_id,
      stageGeneration: message.stage_generation,
    });
  } catch {
    return false;
  }
}

type StageClaim =
  | { status: "claimed"; token: string; job: PatternJobRow }
  | { status: "duplicate" }
  | { status: "retry" };

async function claimStage(
  env: Env,
  message: PatternGenerationMessage,
  now: Date,
): Promise<StageClaim> {
  const token = newId("clm");
  const nowIso = now.toISOString();
  const lease = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();
  let result: D1Result[];
  try {
    result = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'pattern stage generation mismatch'
       WHERE NOT EXISTS (
         SELECT 1 FROM pattern_generation_jobs
         WHERE generation_id = ? AND job_id = ? AND stage_generation = ?
           AND stage NOT IN ('succeeded', 'failed', 'cancelled')
       )`,
    ).bind(message.generation_id, message.job_id, message.stage_generation),
    env.DB.prepare(
      `UPDATE jobs
       SET status = 'running', claim_token = ?, lease_expires_at = ?,
           available_at = NULL, started_at = COALESCE(started_at, ?),
           attempts = attempts + 1, dispatched_at = COALESCE(dispatched_at, ?)
       WHERE id = ? AND job_type = ?
         AND (available_at IS NULL OR available_at <= ?)
         AND (status = 'queued' OR (status = 'running' AND lease_expires_at < ?))
         AND EXISTS (SELECT 1 FROM users WHERE users.id = jobs.user_id AND users.status = 'active')
         AND EXISTS (
           SELECT 1 FROM pattern_generation_jobs
           WHERE generation_id = ? AND job_id = ? AND stage_generation = ?
             AND stage NOT IN ('succeeded', 'failed', 'cancelled')
         )`,
    ).bind(
      token,
      lease,
      nowIso,
      nowIso,
      message.job_id,
      PATTERN_JOB_TYPE,
      nowIso,
      nowIso,
      message.generation_id,
      message.job_id,
      message.stage_generation,
    ),
    env.DB.prepare(
      `UPDATE pattern_generation_jobs
       SET updated_at = ?
       WHERE generation_id = ? AND job_id = ? AND stage_generation = ?
         AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
    ).bind(nowIso, message.generation_id, message.job_id, message.stage_generation),
  ]);
  } catch {
    // The probe at the head of this batch aborts on purpose when the message
    // names a stage generation the job has moved past -- that is a duplicate
    // delivery and acking it is correct. Every other reason the batch can
    // throw is transient, and reporting those as duplicates acked the message
    // away with nothing committed: enqueue leaves the row status='queued' with
    // dispatched_at set, which the undispatched sweep (dispatched_at IS NULL)
    // and the expired-lease sweep (status='running') both miss. The durable
    // outbox that exists to catch exactly this cannot see the row, and the
    // reader sits on organizing_evidence indefinitely.
    return (await stageMovedOn(env, message)) ? { status: "duplicate" } : { status: "retry" };
  }
  const jobUpdate = result[1];
  // Zero rows means someone else holds the lease, the account is not active, or
  // the job is parked or terminal. All of those are handled elsewhere, so the
  // message is done here.
  if (!jobUpdate?.meta.changes) return { status: "duplicate" };
  const job = await loadPatternJob(env, message.generation_id);
  if (!job || job.stage_generation !== message.stage_generation) return { status: "duplicate" };
  return { status: "claimed", token, job };
}

async function loadCommand(
  env: Env,
  identity: UserIdentity,
  jobId: string,
): Promise<GeneratePatternCommandV1> {
  const row = await env.DB.prepare(
    `SELECT payload_enc, payload_key_version, payload_nonce FROM jobs WHERE id = ? AND user_id = ?`,
  )
    .bind(jobId, identity.userId)
    .first<{ payload_enc: ArrayBuffer; payload_key_version: number; payload_nonce: string }>();
  if (!row?.payload_enc) throw new Error("pattern command missing");
  const command = await decryptPayload<unknown>(
    env,
    identity,
    {
      ciphertext: b64(row.payload_enc),
      key_version: row.payload_key_version,
      nonce: row.payload_nonce,
    },
    { subject: identity.cryptoSubject, field: "jobs.payload_enc", recordId: jobId },
  );
  if (!isPatternCommand(command)) throw new Error("pattern command invalid");
  return command;
}

/**
 * Write one artifact at its attempt-scoped coordinate, and return the plaintext
 * hash actually committed.
 *
 * The return value is what `plan_hash`, `candidate_hash` and
 * `semantic_verdict_hash` are taken from -- never the in-memory response. Under
 * artifact-first that is belt and braces, but it is the property that makes the
 * invariant checkable: a hash in `pattern_generation_jobs` always names bytes
 * that exist in R2.
 */
async function putArtifact(
  env: Env,
  identity: UserIdentity,
  job: PatternJobRow,
  artifactClass: string,
  value: unknown,
  expiresAt: string,
  attempt: number,
  stageGeneration = job.stage_generation,
): Promise<string> {
  if (!env.ARTIFACTS) throw new Error("ARTIFACTS binding missing");
  const key = await unwrapArtifactKey(env, identity, job.generation_id);
  const artifactId = await patternArtifactId(
    job.generation_id,
    artifactClass,
    stageGeneration,
    attempt,
  );
  const objectKey = `pattern-generations/${job.generation_id}/${artifactId}.json.enc`;
  const aad = artifactAad(job.generation_id, artifactId, artifactClass);
  const plainHash = await contentHash(JSON.stringify(value));

  const nonce = randomNonce();
  const ciphertext = await encryptUnderContentKey(value, key, nonce, aad);
  // Nonce is prepended so writer/verifier retries can decrypt the frozen
  // artifact without a schema column for it.
  const stored = new Uint8Array(nonce.length + ciphertext.length);
  stored.set(nonce, 0);
  stored.set(ciphertext, nonce.length);

  const put = await env.ARTIFACTS.put(objectKey, stored, {
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (!put) {
    return adoptReservedArtifact(env, identity, job, {
      artifactClass,
      artifactId,
      objectKey,
      aad,
      key,
      plainHash,
      expiresAt,
    });
  }

  await insertArtifactRow(
    env,
    identity,
    job,
    {
      artifactId,
      artifactClass,
      objectKey,
      cipherHash: await contentHash(b64(stored)),
      plainHash,
      byteLength: stored.byteLength,
      expiresAt,
    },
    true,
  );
  return plainHash;
}

async function insertArtifactRow(
  env: Env,
  identity: UserIdentity,
  job: PatternJobRow,
  row: {
    artifactId: string;
    artifactClass: string;
    objectKey: string;
    cipherHash: string;
    plainHash: string;
    byteLength: number;
    expiresAt: string;
  },
  /**
   * Whether a dropped insert is a defect.
   *
   * True on the fresh-write path: the create-only put just proved no object
   * existed at this key, so a surviving inventory row for it describes bytes
   * that are gone, and `ON CONFLICT DO NOTHING` would leave that stale row
   * paired with the object we just wrote while this function returned the hash
   * of the NEW bytes -- exactly the divergence the conflict check exists to
   * catch. False on the torn-write repair path, where a concurrent repair
   * winning the race is the expected outcome and not an error.
   */
  required: boolean,
): Promise<void> {
  const result = await env.DB.prepare(
    `INSERT INTO pattern_generation_artifacts (
       id, generation_id, user_id, artifact_class, object_key, ciphertext_sha256,
       plaintext_sha256, byte_length, created_at, expires_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(object_key) DO NOTHING`,
  )
    .bind(
      row.artifactId,
      job.generation_id,
      identity.userId,
      row.artifactClass,
      row.objectKey,
      row.cipherHash,
      row.plainHash,
      row.byteLength,
      new Date().toISOString(),
      row.expiresAt,
    )
    .run();
  if (required && !result.meta.changes) {
    throw new Error("pattern artifact identity conflict");
  }
}

/**
 * The create-only put lost. Adopt the reserved identity, or fail closed.
 *
 * Section 18.3 permits reuse only when class, object key, both hashes, envelope
 * metadata and stage ownership all match; a different artifact under an
 * already-reserved identity is an integrity conflict that is never overwritten.
 * The previous code returned silently as soon as `head()` found *an* object,
 * regardless of what was in it, which is how a discarded second response could
 * still have its hash advanced into D1.
 *
 * The throw lands in the outer catch as a terminal `execution_error` -- the same
 * reasoning that makes `persistCycles` fail the claimed job closed on a pinned
 * hash mismatch. A silent divergence becomes a state an operator can see.
 */
async function adoptReservedArtifact(
  env: Env,
  identity: UserIdentity,
  job: PatternJobRow,
  ctx: {
    artifactClass: string;
    artifactId: string;
    objectKey: string;
    aad: Uint8Array;
    key: Uint8Array;
    plainHash: string;
    expiresAt: string;
  },
): Promise<string> {
  const object = await env.ARTIFACTS!.get(ctx.objectKey);
  // The put failed and nothing is there: not a conflict, a broken write.
  if (!object) throw new Error("pattern artifact create failed");
  const storedBytes = new Uint8Array(await object.arrayBuffer());
  const storedCipherHash = await contentHash(b64(storedBytes));

  const row = await env.DB.prepare(
    `SELECT id, generation_id, user_id, artifact_class, object_key,
            ciphertext_sha256, plaintext_sha256, byte_length, deleted_at
     FROM pattern_generation_artifacts WHERE id = ?`,
  )
    .bind(ctx.artifactId)
    .first<{
      id: string;
      generation_id: string;
      user_id: string;
      artifact_class: string;
      object_key: string;
      ciphertext_sha256: string;
      plaintext_sha256: string;
      byte_length: number;
      deleted_at: string | null;
    }>();

  if (row) {
    // Every component, not just the plaintext hash. Equal plaintext hashes
    // alone prove nothing about the stored object, its ciphertext, its envelope
    // or its owner -- and the ciphertext comparison is row against OBJECT, not
    // against a fresh encryption, because the nonce is random and a second
    // encryption of identical plaintext never reproduces the same bytes.
    const identical =
      row.generation_id === job.generation_id &&
      row.user_id === identity.userId &&
      row.artifact_class === ctx.artifactClass &&
      row.object_key === ctx.objectKey &&
      row.deleted_at === null &&
      row.byte_length === storedBytes.byteLength &&
      row.ciphertext_sha256 === storedCipherHash &&
      row.plaintext_sha256 === ctx.plainHash;
    if (!identical) throw new Error("pattern artifact identity conflict");
    return row.plaintext_sha256;
  }

  // No inventory row: the object committed and the row did not. Repaired rather
  // than thrown, but only on cryptographic proof that these are our bytes under
  // our identity -- the AAD binds (generation, artifact id, class), so a
  // successful decrypt is the envelope check, and the plaintext hash is the
  // content check. Without the row the object is invisible to `getArtifact` and
  // to the retention sweep, so leaving it unrepaired leaks it forever.
  if (storedBytes.byteLength <= 12) throw new Error("pattern artifact identity conflict");
  let decrypted: unknown;
  try {
    decrypted = await decryptUnderContentKey<unknown>(
      storedBytes.slice(12),
      ctx.key,
      storedBytes.slice(0, 12),
      ctx.aad,
    );
  } catch {
    throw new Error("pattern artifact identity conflict");
  }
  if ((await contentHash(JSON.stringify(decrypted))) !== ctx.plainHash) {
    throw new Error("pattern artifact identity conflict");
  }
  await insertArtifactRow(
    env,
    identity,
    job,
    {
      artifactId: ctx.artifactId,
      artifactClass: ctx.artifactClass,
      objectKey: ctx.objectKey,
      cipherHash: storedCipherHash,
      plainHash: ctx.plainHash,
      byteLength: storedBytes.byteLength,
      expiresAt: ctx.expiresAt,
    },
    false,
  );
  return ctx.plainHash;
}

async function unwrapArtifactKey(
  env: Env,
  identity: UserIdentity,
  generationId: string,
): Promise<Uint8Array> {
  const wrapped = await env.DB.prepare(
    `SELECT wrapped_key_enc, wrapped_key_version, wrapped_key_nonce
     FROM pattern_generation_artifact_keys
     WHERE generation_id = ? AND user_id = ? AND erased_at IS NULL`,
  )
    .bind(generationId, identity.userId)
    .first<{ wrapped_key_enc: ArrayBuffer; wrapped_key_version: number; wrapped_key_nonce: string }>();
  if (!wrapped) throw new Error("pattern artifact key missing");
  return unwrapContentKey(
    env,
    identity,
    generationId,
    "pattern_generation_artifact_keys.wrapped_key_enc",
    {
      key_version: wrapped.wrapped_key_version,
      nonce: wrapped.wrapped_key_nonce,
      ciphertext: b64(wrapped.wrapped_key_enc),
    },
  );
}

export async function getArtifact<T>(
  env: Env,
  identity: UserIdentity,
  generationId: string,
  artifactClass: string,
): Promise<T | null> {
  if (!env.ARTIFACTS) return null;
  const row = await env.DB.prepare(
    `SELECT id, object_key FROM pattern_generation_artifacts
     WHERE generation_id = ? AND user_id = ? AND artifact_class = ? AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(generationId, identity.userId, artifactClass)
    .first<{ id: string; object_key: string }>();
  if (!row) return null;
  const object = await env.ARTIFACTS.get(row.object_key);
  if (!object) return null;
  const stored = new Uint8Array(await object.arrayBuffer());
  if (stored.byteLength <= 12) return null;
  const nonce = stored.slice(0, 12);
  const ciphertext = stored.slice(12);
  const key = await unwrapArtifactKey(env, identity, generationId);
  const aad = artifactAad(generationId, row.id, artifactClass);
  return decryptUnderContentKey<T>(ciphertext, key, nonce, aad);
}

/**
 * The artifact this exact pass attempt wrote, if it wrote one.
 *
 * Beside `getArtifact`, not instead of it. `getArtifact` selects the NEWEST
 * artifact of a class and stays the right tool for reading `validated_plan`
 * across a stage boundary, where the reader knows the class but not the
 * coordinate that produced it. This one answers the artifact-first probe, which
 * needs the exact coordinate and nothing near it.
 */
export async function getArtifactAt<T>(
  env: Env,
  identity: UserIdentity,
  generationId: string,
  artifactClass: string,
  stageGeneration: number,
  attempt: number,
): Promise<{ value: T; plaintextHash: string } | null> {
  if (!env.ARTIFACTS) return null;
  const artifactId = await patternArtifactId(
    generationId,
    artifactClass,
    stageGeneration,
    attempt,
  );
  const row = await env.DB.prepare(
    `SELECT id, object_key, plaintext_sha256 FROM pattern_generation_artifacts
     WHERE id = ? AND generation_id = ? AND user_id = ? AND artifact_class = ?
       AND deleted_at IS NULL`,
  )
    .bind(artifactId, generationId, identity.userId, artifactClass)
    .first<{ id: string; object_key: string; plaintext_sha256: string }>();
  if (!row) return null;
  const object = await env.ARTIFACTS.get(row.object_key);
  if (!object) return null;
  const stored = new Uint8Array(await object.arrayBuffer());
  if (stored.byteLength <= 12) return null;
  const key = await unwrapArtifactKey(env, identity, generationId);
  const value = await decryptUnderContentKey<T>(
    stored.slice(12),
    key,
    stored.slice(0, 12),
    artifactAad(generationId, row.id, artifactClass),
  );
  // Taken over the bytes just decrypted, not read off the inventory row. The
  // row's column is D1's CLAIM about the object; this value becomes `plan_hash`,
  // `candidate_hash` or `semantic_verdict_hash` on every adopting redelivery, so
  // trusting the claim would let a row that no longer describes its object put a
  // hash into `pattern_generation_jobs` naming bytes nobody stored. A
  // disagreement is an integrity conflict, never a silent preference for one.
  const plaintextHash = await contentHash(JSON.stringify(value));
  if (plaintextHash !== row.plaintext_sha256) {
    throw new Error("pattern artifact identity conflict");
  }
  return { value, plaintextHash };
}

async function eligibility(
  env: Env,
  identity: UserIdentity,
  command: GeneratePatternCommandV1,
  now: Date,
): Promise<"ok" | "cancel_consent" | "cancel_stale" | "cancel_ontology"> {
  const grant = await loadPatternGenerationGrant(env, identity.userId, now);
  if (!grant || grant.consentId !== command.consent_id) return "cancel_consent";
  const chart = await env.DB.prepare(
    `SELECT id, fingerprint FROM chart_snapshots WHERE user_id = ? AND status = 'active' ORDER BY calculated_at DESC LIMIT 1`,
  )
    .bind(identity.userId)
    .first<{ id: string; fingerprint: string }>();
  if (!chart || chart.id !== command.chart_id || chart.fingerprint !== command.chart_fingerprint) {
    return "cancel_stale";
  }
  const prefs = await loadPreferences(env, identity.userId);
  const localeRevision = prefs?.localeUpdatedAt ? Date.parse(prefs.localeUpdatedAt) || 1 : 1;
  if (!prefs || prefs.locale !== command.locale || localeRevision !== command.locale_revision) {
    return "cancel_stale";
  }
  const ontology = await loadActiveOntology(env);
  if (!ontology || ontology.version !== command.ontology_version) {
    const frozen = await env.DB.prepare(
      `SELECT status FROM pattern_ontology_releases WHERE version = ?`,
    )
      .bind(command.ontology_version)
      .first<{ status: string }>();
    if (!frozen || frozen.status === "recalled") return "cancel_ontology";
  }
  const claim = await loadClaimForFingerprint(env, identity.userId, command.chart_fingerprint_hash);
  if (!claim || (isConsumedStatus(claim.status) && claim.status !== "accepted")) return "cancel_stale";
  return "ok";
}

/**
 * The document the contract defines, rebuilt from an explicit allowlist.
 *
 * `PatternPublisher.plan` is typed as returning a `PatternPlan`, but the
 * contract the provider answers under is `pattern-planner-output.schema.json`,
 * which has exactly these four properties -- no `plan_hash` and no
 * `sparse_pattern`. Whatever a publisher hands back, those two are derived here:
 * the hash from the bytes this Worker commits, and the sparse flag from the
 * packet the selector produced. A publisher-supplied `plan_hash` would be a hash
 * of something nobody stored.
 */
export function narrowPlannerOutput(value: PatternPlan | PatternPlannerOutput): PatternPlannerOutput {
  return {
    schema_version: value.schema_version,
    chapters: value.chapters,
    additional_signatures: value.additional_signatures,
    omissions: value.omissions,
  };
}

/** One pass's provider refusal, mapped onto a delivery outcome. */
async function handlePassFailure(
  env: Env,
  job: PatternJobRow,
  token: string,
  pass: PatternStageClass,
  attempt: number,
  attemptsMax: number,
  failure: { code: string; safe_detail_code: string; retry_after_seconds: number | null },
): Promise<PatternExecuteOutcome> {
  const failureClass = passFailureClass(failure.code, failure.safe_detail_code);
  const retryable =
    passFailureIsRetryable(failure.code, failure.safe_detail_code) && attempt + 1 < attemptsMax;
  if (retryable) {
    // Measured from NOW, not from the delivery's `now`. The three timeouts are
    // 120s each, so a pass that times out at attempt 0 would otherwise be told
    // to wait 30 seconds from a moment ninety seconds in the past -- no backoff
    // at all, and `retry_after_seconds` from a 429 silently ignored with it.
    const availableAt = retryAvailableAt(new Date(), attempt, failure.retry_after_seconds);
    if (!(await commitAndNudgePatternTransition(env, job, token, {
      kind: "retry",
      pass,
      availableAt,
    }))) {
      return { ok: false, reason: "duplicate", failureClass: "duplicate" };
    }
    return { ok: true, terminal: false };
  }
  await commitPatternTransition(env, job, token, {
    kind: "fail",
    failureClass,
    publicStage: patternPassProtocol(pass).publicFailureStage,
  });
  return { ok: false, reason: "terminal", failureClass };
}

async function awaitPatternProvider(
  env: Env,
  job: PatternJobRow,
  token: string,
  providerJobId: string,
): Promise<PatternExecuteOutcome> {
  const effect = await commitPatternTransition(
    env,
    job,
    token,
    { kind: "await_provider" },
  );
  if (!effect) {
    return { ok: false, reason: "duplicate", failureClass: "duplicate" };
  }
  // Close the enqueue/defer race: an unusually fast runner may finish while
  // this delivery still owns the domain claim. Once ownership is released,
  // repair the nudge immediately instead of waiting for maintenance.
  const providerJob = await loadCodexProviderJob(env, providerJobId);
  if (
    providerJob &&
    (providerJob.status === "completed" || providerJob.status === "failed")
  ) {
    await nudgeCodexProviderOwner(env, providerJob);
  }
  return { ok: true, terminal: false };
}

// Durable delivery orchestration lives here: claim, snapshot checks, artifact
// adoption, provider call, deterministic validation, and queue nudge.
// pattern-stage-protocol.ts is the sole owner of domain-stage legality,
// attempt arithmetic, stage-generation effects, hash effects, public-stage
// mapping, and guarded job transition statements.
export async function executePatternJob(
  env: Env,
  message: PatternGenerationMessage,
  now = new Date(),
): Promise<PatternExecuteOutcome> {
  const rollout = readPatternAiRollout(env);
  if (rollout === "off") {
    await env.DB.prepare(
      `UPDATE jobs SET available_at = ?, dispatched_at = NULL, result_class = 'rollout_paused'
       WHERE id = ? AND job_type = ? AND status IN ('queued', 'running')`,
    )
      .bind(new Date(now.getTime() + 3600_000).toISOString(), message.job_id, PATTERN_JOB_TYPE)
      .run();
    return { ok: true, terminal: false };
  }

  const claim = await claimStage(env, message, now);
  if (claim.status === "retry") {
    return { ok: false, reason: "retry", failureClass: "claim_failed" };
  }
  if (claim.status !== "claimed") return { ok: false, reason: "duplicate", failureClass: "duplicate" };
  const claimed = claim;
  const stage = claimed.job.stage;
  const stageOwner = patternStageOwner(stage);

  const identityRow = await loadUserIdentity(env, (await loadPatternJob(env, message.generation_id))!.user_id);
  if (!identityRow) {
    await commitPatternTransition(env, claimed.job, claimed.token, {
      kind: "fail",
      failureClass: "account_inactive",
      publicStage: "organizing_evidence",
    });
    return { ok: false, reason: "terminal", failureClass: "account_inactive" };
  }
  const identity: UserIdentity = { userId: identityRow.userId, cryptoSubject: identityRow.cryptoSubject };
  let command: GeneratePatternCommandV1;
  try {
    command = await loadCommand(env, identity, claimed.job.job_id);
  } catch {
    await commitPatternTransition(env, claimed.job, claimed.token, {
      kind: "fail",
      failureClass: "payload_undecryptable",
      publicStage: "organizing_evidence",
    });
    return { ok: false, reason: "terminal", failureClass: "payload_undecryptable" };
  }

  const gate = await eligibility(env, identity, command, now);
  if (gate !== "ok") {
    await commitPatternTransition(env, claimed.job, claimed.token, {
      kind: "cancel",
      reason: gate,
    });
    return { ok: true, terminal: true };
  }

  // The try opens here rather than below the selection call. selectPatternEvidence
  // throws SelectionCapacityError deterministically for a chart whose mandatory
  // set exceeds the packet cap, and the chart-accuracy read and expiry
  // computation can throw too. Outside the try nothing marks the job failed:
  // the queue retried, the message reached the DLQ after max_retries, and the
  // job stayed mid-pipeline with its claim still reserved -- the reader's one
  // Pattern opportunity held by a job that can neither finish nor fail.
  try {
    const resolved = resolvePatternPublisherConfiguration(env);
    if (!resolved.ok || !resolved.config) {
      // A half-configured gateway, a missing credential, or a pin that does not
      // match its compiled constant. None of the three improves on a retry.
      await commitPatternTransition(env, claimed.job, claimed.token, {
        kind: "fail",
        failureClass: "publisher_not_configured",
        publicStage: publicStageFor(stage) ?? "organizing_evidence",
      });
      return { ok: false, reason: "terminal", failureClass: "publisher_not_configured" };
    }
    const config: PatternPublisherConfig = resolved.config;
    // The command pin is the author frozen at reservation. Live configuration
    // supplies credentials, routing, timeouts and the daily ceiling; it must not
    // silently replace the publisher or model while a generation is in flight.
    const pin = command.publisher;

    const ontology = await loadOntologyByVersion(env, command.ontology_version);
    if (!ontology || !hashesEqual(ontology.bundleHash, command.ontology_bundle_hash)) {
      await commitPatternTransition(env, claimed.job, claimed.token, {
        kind: "cancel",
        reason: "cancel_ontology",
      });
      return { ok: true, terminal: true };
    }
    const frozenOntology = ontology;

    const features = await ensureNatalFeatureSet(env, identity.userId, command.chart_id, now);
    if (features.featureSetHash !== command.feature_set_hash) {
      await commitPatternTransition(env, claimed.job, claimed.token, {
        kind: "cancel",
        reason: "cancel_stale",
      });
      return { ok: true, terminal: true };
    }

    const selected = selectPatternEvidence({
      locale: command.locale,
      effectiveAccuracy: (await env.DB.prepare(
        `SELECT birth_accuracy FROM chart_snapshots WHERE id = ? AND user_id = ?`,
      )
        .bind(command.chart_id, identity.userId)
        .first<{ birth_accuracy: "exact" | "approximate" | "unknown" }>())?.birth_accuracy ?? "exact",
      featureSetHash: features.featureSetHash,
      features: features.features,
      ontology: frozenOntology.release.records,
    });

    const expiresAt = new Date(now.getTime() + config.artifactRetentionDays * 86400_000).toISOString();
    const records = frozenOntology.release.records;
    const limits: PatternPacketLimits = {
      // The pin, not the module default. A drift between the deployed variable
      // and the compiled constant is already a configuration refusal, so the two
      // agree -- but the bound a document is measured against should be the one
      // the frozen configuration names.
      maxBytes: pin.input_max_bytes,
      bounds: PATTERN_PACKET_LIMITS_DEFAULT.bounds,
    };

    const workersAi = pin.publisher === PATTERN_PUBLISHER_WORKERS_AI;
    const remoteProvider =
      pin.publisher === PATTERN_PUBLISHER_OPENAI ||
      pin.publisher === PATTERN_PUBLISHER_CODEX ||
      workersAi;
    // Workers AI carries no credential; its binding is the thing that must
    // exist, and a deployment naming it without one fails the same way.
    if (workersAi && !env.AI) {
      await commitPatternTransition(env, claimed.job, claimed.token, {
        kind: "fail",
        failureClass: "publisher_not_configured",
        publicStage: publicStageFor(stage) ?? "organizing_evidence",
      });
      return { ok: false, reason: "terminal", failureClass: "publisher_not_configured" };
    }
    if (pin.publisher === PATTERN_PUBLISHER_OPENAI && !config.credential) {
      await commitPatternTransition(env, claimed.job, claimed.token, {
        kind: "fail",
        failureClass: "publisher_not_configured",
        publicStage: publicStageFor(stage) ?? "organizing_evidence",
      });
      return { ok: false, reason: "terminal", failureClass: "publisher_not_configured" };
    }

    // Section 25.3's "consumed immediately before each provider call".
    //
    // Handed to the publisher rather than called here: the fetch is inside the
    // adapter, and a unit consumed at stage entry is spent by a delivery that
    // may never reach a provider -- a `plan_missing` delivery makes no call and
    // used to charge for one anyway. Failed, timed-out and refused calls each
    // consume a unit, and nothing is refunded: the bound is on spend, not on
    // success. A synthetic pass gets a reserve that never charges, because the
    // ledger counts provider calls and there is no provider.
    const reserve = remoteProvider && pin.publisher !== PATTERN_PUBLISHER_CODEX
      ? async (stageClass: PatternStageClass) => {
          const budget = await consumePatternProviderCallBudget(
            env,
            utcDateFor(now),
            config.dailyCallLimit,
            stageClass,
          );
          return { ok: budget.ok };
        }
      : async (_stageClass: PatternStageClass) => ({ ok: true });

    // One transport serves both remote providers: the credential it is handed
    // selects the endpoint, the header set, and the request shape. A second
    // near-identical publisher would be a second place for the pass ceilings
    // and the provenance metadata to drift.
    const publisherImpl: PatternPublisher = workersAi
      ? createWorkersAiPatternPublisher(env.AI as never)
      : pin.publisher === PATTERN_PUBLISHER_CODEX
      ? createCodexPatternPublisher(env)
      : remoteProvider
      ? createOpenAiPatternPublisher(config.credential!, config.gatewayRoute)
      : createSyntheticPatternPublisher({
          forceReject: resolveSemanticForceReject(env),
          packet: selected.packet,
          ontology: records,
        });

    const passTimeoutMs: Record<PatternStageClass, number> = {
      planner: config.plannerTimeoutMs,
      writer: config.writerTimeoutMs,
      verifier: config.verifierTimeoutMs,
    };
    const passOptions = (pass: PatternStageClass): PatternPassOptions => ({
      // The Worker's own correlation id. Never sent to the provider.
      requestId: newId("req"),
      timeoutMs: passTimeoutMs[pass],
      pin,
      reserve,
      ...(pin.publisher === PATTERN_PUBLISHER_CODEX
        ? {
            codexJob: {
              pipeline: "pattern" as const,
              ownerId: command.generation_id,
              userId: identity.userId,
              stageGeneration: claimed.job.stage_generation,
              stageAttempt: claimed.job[patternPassProtocol(pass).attemptColumn],
              dailyCallLimit: config.dailyCallLimit,
            },
          }
        : {}),
    });

    // Step 6: the exact bytes sent, written before the call that sends them, so
    // a call that never answers is still recoverable.
    const writeRequestArtifact = async (
      coordinate: PatternAttemptCoordinate,
      document: unknown,
    ): Promise<void> => {
      await putArtifact(
        env,
        identity,
        claimed.job,
        coordinate.requestArtifactClass,
        document,
        expiresAt,
        coordinate.attempt,
        coordinate.stageGeneration,
      );
    };

    // Step 5's refusal: terminal, before any fetch and before any budget.
    const refuseInput = async (
      pass: PatternStageClass,
      result: { ok: false; code: string },
    ): Promise<PatternExecuteOutcome> => {
      await commitPatternTransition(env, claimed.job, claimed.token, {
        kind: "fail",
        failureClass: result.code,
        publicStage: patternPassProtocol(pass).publicFailureStage,
      });
      return { ok: false, reason: "terminal", failureClass: result.code };
    };

    if (stageOwner === "planner") {
      const coordinate = patternAttemptCoordinate(claimed.job, "planner");
      if (coordinate.attempt >= command.planner_attempts_max) {
        await commitPatternTransition(env, claimed.job, claimed.token, {
          kind: "fail",
          failureClass: "planner_attempts_exhausted",
          publicStage: "organizing_evidence",
        });
        return { ok: false, reason: "terminal", failureClass: "planner_attempts_exhausted" };
      }

      const adopted = await getArtifactAt<PatternPlannerOutput>(
        env,
        identity,
        coordinate.generationId,
        coordinate.responseArtifactClass,
        coordinate.stageGeneration,
        coordinate.attempt,
      );

      let plannerOutput: PatternPlannerOutput;
      if (adopted) {
        plannerOutput = adopted.value;
      } else {
        const input = buildPlannerInput(selected.packet, records, limits);
        if (!input.ok) return refuseInput("planner", input);
        await writeRequestArtifact(coordinate, input.document);
        const outcome = await runPublisherPass(pin, "planner", coordinate.attempt, () =>
          publisherImpl.plan(input.document, passOptions("planner")),
        );
        if (!outcome.ok) {
          if (outcome.code === "publisher_pending") {
            return awaitPatternProvider(
              env,
              claimed.job,
              claimed.token,
              outcome.job_id,
            );
          }
          return handlePassFailure(
            env,
            claimed.job,
            claimed.token,
            "planner",
            coordinate.attempt,
            command.planner_attempts_max,
            outcome,
          );
        }
        plannerOutput = narrowPlannerOutput(outcome.value);
      }

      // The deterministic validators dereference the document's shape directly
      // (`output.chapters.length`, `output.title.length`), which was safe while
      // every document came from a deterministic builder and is not safe now
      // that one can come from a model. A throw here is a malformed provider
      // output, not an internal defect: classify it as one, so it retries within
      // the pass ceiling instead of dying terminally as `execution_error` with
      // the remaining attempt unspent.
      let planCheck: ReturnType<typeof validatePatternPlan>;
      try {
        planCheck = validatePatternPlan(plannerOutput, selected.packet, records);
      } catch {
        return handlePassFailure(env, claimed.job, claimed.token, "planner", coordinate.attempt, command.planner_attempts_max, {
          code: "publisher_output_invalid",
          safe_detail_code: "schema_mismatch",
          retry_after_seconds: null,
        });
      }
      if (!planCheck.ok) {
        if (coordinate.attempt + 1 < command.planner_attempts_max) {
          if (!(await commitAndNudgePatternTransition(env, claimed.job, claimed.token, {
            kind: "retry",
            pass: "planner",
            availableAt: null,
          }))) {
            return { ok: false, reason: "duplicate", failureClass: "duplicate" };
          }
          return { ok: true, terminal: false };
        }
        await commitPatternTransition(env, claimed.job, claimed.token, {
          kind: "fail",
          failureClass: "plan_invalid",
          publicStage: "organizing_evidence",
        });
        return { ok: false, reason: "terminal", failureClass: "plan_invalid" };
      }

      const planHash = adopted
        ? adopted.plaintextHash
        : await putArtifact(
            env,
            identity,
            claimed.job,
            coordinate.responseArtifactClass,
            plannerOutput,
            expiresAt,
            coordinate.attempt,
            coordinate.stageGeneration,
          );
      const plan: PatternPlan = {
        ...plannerOutput,
        plan_hash: planHash,
        sparse_pattern: selected.packet.selection_constraints.sparse_pattern,
      };
      await putArtifact(env, identity, claimed.job, "fact_packet", selected.packet, expiresAt, coordinate.attempt, coordinate.stageGeneration);
      await putArtifact(env, identity, claimed.job, "validated_plan", plan, expiresAt, coordinate.attempt, coordinate.stageGeneration);
      if (!(await commitAndNudgePatternTransition(env, claimed.job, claimed.token, {
        kind: "advance",
        nextStage: "writing",
        hashes: { planHash },
      }))) {
        return { ok: false, reason: "duplicate", failureClass: "duplicate" };
      }
      return { ok: true, terminal: false };
    }

    if (stageOwner === "writer") {
      const coordinate = patternAttemptCoordinate(claimed.job, "writer");
      if (coordinate.attempt >= command.writer_attempts_max) {
        await commitPatternTransition(env, claimed.job, claimed.token, {
          kind: "fail",
          failureClass: "writer_attempts_exhausted",
          publicStage: "writing",
        });
        return { ok: false, reason: "terminal", failureClass: "writer_attempts_exhausted" };
      }
      const planHash = claimed.job.plan_hash;
      if (!planHash) {
        await commitPatternTransition(env, claimed.job, claimed.token, {
          kind: "fail",
          failureClass: "plan_missing",
          publicStage: "writing",
        });
        return { ok: false, reason: "terminal", failureClass: "plan_missing" };
      }
      const plan = await getArtifact<PatternPlan>(env, identity, command.generation_id, "validated_plan");
      if (!plan || plan.plan_hash !== planHash) {
        await commitPatternTransition(env, claimed.job, claimed.token, {
          kind: "fail",
          failureClass: "plan_missing",
          publicStage: "writing",
        });
        return { ok: false, reason: "terminal", failureClass: "plan_missing" };
      }

      const adopted = await getArtifactAt<PatternWriterOutput>(
        env,
        identity,
        coordinate.generationId,
        coordinate.responseArtifactClass,
        coordinate.stageGeneration,
        coordinate.attempt,
      );

      let writer: PatternWriterOutput;
      if (adopted) {
        writer = adopted.value;
      } else {
        // A provider/shape retry during a correction attempt advances the
        // writer index without producing a new rejection. Keep carrying the
        // most recent correction at this writing coordinate instead of
        // silently falling back to the base prompt. The command ceiling is at
        // most three, so this bounded reverse probe reads at most two objects.
        let correction: { value: PatternCorrectionDocument } | null = null;
        for (let correctionAttempt = coordinate.attempt; correctionAttempt > 0; correctionAttempt -= 1) {
          correction = await getArtifactAt<PatternCorrectionDocument>(
            env,
            identity,
            coordinate.generationId,
            "correction_document",
            coordinate.stageGeneration,
            correctionAttempt,
          );
          if (correction) break;
        }
        const input = buildWriterInput(
          plan,
          selected.packet,
          records,
          limits,
          correction?.value,
        );
        if (!input.ok) return refuseInput("writer", input);
        await writeRequestArtifact(coordinate, input.document);
        const outcome = await runPublisherPass(pin, "writer", coordinate.attempt, () =>
          publisherImpl.write(input.document, passOptions("writer")),
        );
        if (!outcome.ok) {
          if (outcome.code === "publisher_pending") {
            return awaitPatternProvider(
              env,
              claimed.job,
              claimed.token,
              outcome.job_id,
            );
          }
          return handlePassFailure(
            env,
            claimed.job,
            claimed.token,
            "writer",
            coordinate.attempt,
            command.writer_attempts_max,
            outcome,
          );
        }
        writer = outcome.value;
      }

      let candidate: ReturnType<typeof validatePatternCandidate>;
      try {
        candidate = validatePatternCandidate(writer, plan, selected.packet, records);
      } catch {
        return handlePassFailure(env, claimed.job, claimed.token, "writer", coordinate.attempt, command.writer_attempts_max, {
          code: "publisher_output_invalid",
          safe_detail_code: "schema_mismatch",
          retry_after_seconds: null,
        });
      }
      if (!candidate.ok) {
        const transition = {
          kind: "retry",
          pass: "writer",
          availableAt: null,
        } as const satisfies PatternTransition;
        const planned = planPatternTransition(claimed.job, transition);
        if (planned.next.writer_attempts < command.writer_attempts_max) {
          const correction = buildCorrectionDocument(
            plan,
            { deterministic: candidate.failures },
            planned.next.writer_attempts,
          );
          await putArtifact(
            env,
            identity,
            claimed.job,
            "correction_document",
            correction,
            expiresAt,
            planned.next.writer_attempts,
            planned.next.stage_generation,
          );
          if (!(await commitAndNudgePatternTransition(env, claimed.job, claimed.token, transition))) {
            return { ok: false, reason: "duplicate", failureClass: "duplicate" };
          }
          return { ok: true, terminal: false };
        }
        await commitPatternTransition(env, claimed.job, claimed.token, {
          kind: "fail",
          failureClass: "candidate_invalid",
          publicStage: "writing",
        });
        return { ok: false, reason: "terminal", failureClass: "candidate_invalid" };
      }
      const candidateHash = adopted
        ? adopted.plaintextHash
        : await putArtifact(
            env,
            identity,
            claimed.job,
            coordinate.responseArtifactClass,
            writer,
            expiresAt,
            coordinate.attempt,
            coordinate.stageGeneration,
          );
      if (!(await commitAndNudgePatternTransition(env, claimed.job, claimed.token, {
        kind: "advance",
        nextStage: "semantic_verifying",
        hashes: { candidateHash },
      }))) {
        return { ok: false, reason: "duplicate", failureClass: "duplicate" };
      }
      return { ok: true, terminal: false };
    }

    if (stageOwner === "verifier" || stageOwner === "publication") {
      const coordinate = patternAttemptCoordinate(claimed.job, "verifier");
      if (coordinate.attempt >= command.verifier_attempts_max) {
        await commitPatternTransition(env, claimed.job, claimed.token, {
          kind: "fail",
          failureClass: "verifier_attempts_exhausted",
          publicStage: "checking_claims",
        });
        return { ok: false, reason: "terminal", failureClass: "verifier_attempts_exhausted" };
      }
      const plan = await getArtifact<PatternPlan>(env, identity, command.generation_id, "validated_plan");
      const writer = await getArtifact<PatternWriterOutput>(
        env,
        identity,
        command.generation_id,
        patternPassProtocol("writer").responseArtifactClass,
      );
      if (!plan || !writer) {
        await commitPatternTransition(env, claimed.job, claimed.token, {
          kind: "fail",
          failureClass: "plan_missing",
          publicStage: "checking_claims",
        });
        return { ok: false, reason: "terminal", failureClass: "plan_missing" };
      }

      // Bind the candidate before the verifier ever sees it. `getArtifact`
      // selects the NEWEST `writer_response`, and the job row names the exact
      // one the writer stage advanced with -- so a tie on `created_at`, or any
      // second writer attempt, could otherwise put one candidate in front of the
      // verifier and a different one into `pattern_documents`. This is also the
      // hash publication uses, taken from the committed artifact rather than
      // recomputed over whatever was read back.
      const candidateHash = await contentHash(JSON.stringify(writer));
      if (!claimed.job.candidate_hash || candidateHash !== claimed.job.candidate_hash) {
        await commitPatternTransition(env, claimed.job, claimed.token, {
          kind: "fail",
          failureClass: "candidate_missing",
          publicStage: "checking_claims",
        });
        return { ok: false, reason: "terminal", failureClass: "candidate_missing" };
      }

      const adopted = await getArtifactAt<PatternSemanticVerdict>(
        env,
        identity,
        coordinate.generationId,
        coordinate.responseArtifactClass,
        coordinate.stageGeneration,
        coordinate.attempt,
      );

      let verdict: PatternSemanticVerdict;
      if (adopted) {
        verdict = adopted.value;
      } else {
        const input = buildVerifierInput(writer, plan, selected.packet, records, limits);
        if (!input.ok) return refuseInput("verifier", input);
        await writeRequestArtifact(coordinate, input.document);
        const outcome = await runPublisherPass(pin, "verifier", coordinate.attempt, () =>
          publisherImpl.verify(input.document, passOptions("verifier")),
        );
        if (!outcome.ok) {
          if (outcome.code === "publisher_pending") {
            return awaitPatternProvider(
              env,
              claimed.job,
              claimed.token,
              outcome.job_id,
            );
          }
          return handlePassFailure(
            env,
            claimed.job,
            claimed.token,
            "verifier",
            coordinate.attempt,
            command.verifier_attempts_max,
            outcome,
          );
        }
        verdict = outcome.value;
      }

      // Step 9 for this pass. Before Task 6 the verdict came from the
      // deterministic stand-in and was well-formed by construction; a bare
      // `verdict !== "pass"` now honours an incoherent `pass` carrying an
      // `error` finding, and records a malformed body as
      // `semantic_verification_failed` -- the one class that tells an operator
      // the verifier was the reason. Both are provider-output problems.
      const verdictProblem = findSemanticVerdictProblem(verdict);
      if (verdictProblem) {
        return handlePassFailure(env, claimed.job, claimed.token, "verifier", coordinate.attempt, command.verifier_attempts_max, {
          code: "publisher_output_invalid",
          safe_detail_code: "schema_mismatch",
          retry_after_seconds: null,
        });
      }

      const verdictHash = adopted
        ? adopted.plaintextHash
        : await putArtifact(
            env,
            identity,
            claimed.job,
            coordinate.responseArtifactClass,
            verdict,
            expiresAt,
            coordinate.attempt,
            coordinate.stageGeneration,
          );
      // The verdict of record, under the class an operator and the retention
      // sweep look for. The same bytes as the response artifact; a different
      // role, and the response coordinate is what the artifact-first probe needs.
      await putArtifact(
        env,
        identity,
        claimed.job,
        "semantic_verdict",
        verdict,
        expiresAt,
        coordinate.attempt,
        coordinate.stageGeneration,
      );

      if (verdict.verdict !== "pass") {
        const transition = {
          kind: "return_to_writer",
          availableAt: null,
        } as const satisfies PatternTransition;
        const planned = planPatternTransition(claimed.job, transition);
        if (planned.next.writer_attempts < command.writer_attempts_max) {
          const correction = buildCorrectionDocument(
            plan,
            { semantic: verdict.findings },
            planned.next.writer_attempts,
          );
          await putArtifact(
            env,
            identity,
            claimed.job,
            "correction_document",
            correction,
            expiresAt,
            planned.next.writer_attempts,
            planned.next.stage_generation,
          );
          if (!(await commitAndNudgePatternTransition(env, claimed.job, claimed.token, transition))) {
            return { ok: false, reason: "duplicate", failureClass: "duplicate" };
          }
          return { ok: true, terminal: false };
        }
        await commitPatternTransition(env, claimed.job, claimed.token, {
          kind: "fail",
          failureClass: "semantic_verification_failed",
          publicStage: "checking_claims",
        });
        return { ok: false, reason: "terminal", failureClass: "semantic_verification_failed" };
      }
      const publication = await publishPattern(
        env,
        identity,
        command,
        pin,
        claimed,
        writer,
        plan,
        candidateHash,
        verdictHash,
        now,
      );
      if (publication.status === "retry") {
        await commitPatternTransition(env, claimed.job, claimed.token, {
          kind: "publication_retry",
          availableAt: new Date(now.getTime() + 60_000),
        }, now);
        return {
          ok: false,
          reason: "retry",
          failureClass: publication.failureClass,
        };
      }
      return { ok: true, terminal: true };
    }

    await commitPatternTransition(env, claimed.job, claimed.token, {
      kind: "fail",
      failureClass: "unknown_stage",
      publicStage: publicStageFor(stage) ?? "organizing_evidence",
    });
    return { ok: false, reason: "terminal", failureClass: "unknown_stage" };
  } catch (error) {
    safeLog({ event: "pattern_stage_failed" });
    await commitPatternTransition(env, claimed.job, claimed.token, {
      kind: "fail",
      failureClass: "execution_error",
      publicStage: publicStageFor(stage) ?? "organizing_evidence",
    });
    return { ok: false, reason: "terminal", failureClass: "execution_error" };
  }
}

async function publishPattern(
  env: Env,
  identity: UserIdentity,
  command: GeneratePatternCommandV1,
  executedPin: PatternPublisherPin,
  claimed: { token: string; job: PatternJobRow },
  writer: PatternWriterOutput,
  plan: PatternPlan,
  candidateHash: string,
  verdictHash: string,
  now: Date,
): Promise<
  | { status: "published" }
  | { status: "retry"; failureClass: string }
> {
  const patternId = `pat_${(await sha256Hex(
    `pattern-document-v1:${command.generation_id}`,
  )).slice(0, 32)}`;
  const generatedAt = now.toISOString();
  const documentKey = randomKey();
  const nonce = randomNonce();
  const publisherProvenance = provenanceFromExecutedPin(executedPin);
  const internal = {
    schema_version: "0.7.0" as const,
    pattern_id: patternId,
    generation_id: command.generation_id,
    locale: command.locale,
    effective_accuracy: (await env.DB.prepare(
      `SELECT birth_accuracy FROM chart_snapshots WHERE id = ? AND user_id = ?`,
    )
      .bind(command.chart_id, identity.userId)
      .first<{ birth_accuracy: "exact" | "approximate" | "unknown" }>())?.birth_accuracy ?? "exact",
    plan_hash: plan.plan_hash,
    candidate_hash: candidateHash,
    semantic_verdict_hash: verdictHash,
    artifact: writer,
    compact_provenance: {
      assembly_mode: "constrained_model" as const,
      provider: publisherProvenance.provider,
      model_family: publisherProvenance.model_family,
      raw_birth_details_sent: false as const,
      ontology_version: command.ontology_version,
      selection_policy_version: command.selection_policy_version,
    },
  };
  const aad = new TextEncoder().encode(
    JSON.stringify(["patternlike.pattern-document", 1, patternId, command.generation_id]),
  );
  const documentEnc = await encryptUnderContentKey(internal, documentKey, nonce, aad);
  const wrapped = await wrapContentKey(
    env,
    identity,
    patternId,
    "pattern_documents.wrapped_document_key_enc",
    documentKey,
    { claim_id: command.claim_id, generation_id: command.generation_id },
  );
  const content = await contentHash(JSON.stringify(internal));
  const accuracy = internal.effective_accuracy;
  let replay;
  try {
    replay = await writePatternReplayIntent(env, {
      eventClass: "claim_consumed",
      semanticOperationKey: command.generation_id,
      targetUserId: identity.userId,
      chartFingerprintHash: command.chart_fingerprint_hash,
      claimId: command.claim_id,
      generationId: command.generation_id,
      patternId,
      ontologyVersion: command.ontology_version,
      priorClaimStatus: "reserved",
      nextClaimStatus: "accepted",
    }, now);
  } catch (error) {
    return {
      status: "retry",
      failureClass: error instanceof PatternReplayLedgerError
        ? error.code
        : "replay_replica_unavailable",
    };
  }
  try {
    const publicationTransition = buildPatternTransitionStatements(
      env,
      claimed.job,
      claimed.token,
      {
        kind: "publish",
        candidateHash,
        semanticVerdictHash: verdictHash,
      },
      now,
    );
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'pattern claim no longer reserved'
         WHERE NOT EXISTS (
           SELECT 1 FROM pattern_generation_claims
           WHERE id = ? AND status = 'reserved' AND active_generation_id = ? AND consumed_at IS NULL
         )`,
      ).bind(command.claim_id, command.generation_id),
      ...publicationTransition.guards,
      ...replay.receiptStatements(env),
      env.DB.prepare(
        `DELETE FROM pattern_documents WHERE user_id = ? AND chart_fingerprint_hash != ?`,
      ).bind(identity.userId, command.chart_fingerprint_hash),
      env.DB.prepare(
        `INSERT INTO pattern_documents (
           id, user_id, claim_id, generation_id, chart_fingerprint_hash, ontology_version,
           ontology_bundle_hash, locale, effective_accuracy, document_enc, document_nonce,
           wrapped_document_key_enc, wrapped_document_key_version, wrapped_document_key_nonce,
           content_hash, compact_provenance_json, generated_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        patternId,
        identity.userId,
        command.claim_id,
        command.generation_id,
        command.chart_fingerprint_hash,
        command.ontology_version,
        command.ontology_bundle_hash,
        command.locale,
        accuracy,
        documentEnc,
        b64(nonce),
        Uint8Array.from(atob(wrapped.ciphertext), (ch) => ch.charCodeAt(0)),
        wrapped.keyVersion,
        wrapped.nonce,
        content,
        JSON.stringify(internal.compact_provenance),
        generatedAt,
        generatedAt,
      ),
      env.DB.prepare(
        `UPDATE pattern_generation_claims
         SET status = 'accepted', active_generation_id = NULL, consumed_at = ?, accepted_at = ?, updated_at = ?
         WHERE id = ? AND status = 'reserved'`,
      ).bind(generatedAt, generatedAt, generatedAt, command.claim_id),
      ...publicationTransition.mutations,
      env.DB.prepare(
        `INSERT INTO audit_events
           (id, actor_type, actor_id, action, resource_type, resource_id, result, detail_class, created_at)
         VALUES (?, 'system', ?, 'pattern_generation.published', 'pattern', ?, 'success', 'accepted', ?)`,
      ).bind(newId("aud"), identity.userId, patternId, generatedAt),
    ]);
    return { status: "published" };
  } catch {
    return { status: "retry", failureClass: "publication_commit_failed" };
  }
}
