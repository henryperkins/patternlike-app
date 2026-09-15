import { canonicalJson, contentHash, type PatternFactPacket, type PatternPlan,
  type PatternWriterOutput, type PatternWriterProseUnit } from "@patternlike/shared";
import { PATTERN_VALIDATION_POLICY_VERSION, validatePatternCandidate } from "@patternlike/pattern-engine";
import type { Env } from "../env.js";
import { b64 } from "../crypto.js";
import { decryptPayload, loadUserIdentity, NoUserKeyError, UserKeyDestroyedError, type UserIdentity } from "../db/users.js";
import { loadCodexProviderJob } from "../db/codex-provider-jobs.js";
import { loadOntologyByVersion } from "../db/pattern-ontology.js";
import { CodexProviderArtifactError, readCodexProviderArtifact } from "./codex-provider-artifacts.js";
import { parseCodexProviderInvocation } from "./codex-provider-contract.js";
import { getArtifactById } from "./pattern-execute.js";
import { buildWriterInput, PATTERN_PACKET_LIMITS_DEFAULT, type PatternCorrectionDocument } from "./pattern-packet.js";
import { patternArtifactId } from "./pattern-stage-protocol.js";

type RevalidationErrorCode = "artifact_unavailable" | "integrity_conflict"
  | "unsupported_validation_policy" | "generation_not_revalidatable";

export class PatternCandidateRevalidationError extends Error {
  constructor(readonly code: RevalidationErrorCode) {
    super(code);
    this.name = "PatternCandidateRevalidationError";
  }
}

export interface PatternCandidateRevalidationTarget {
  generationId: string;
  userId: string;
  providerJobId: string;
  stageGeneration: number;
  stageAttempt: number;
  jobId: string;
  planHash: string;
  ontologyVersion: string;
  ontologyBundleHash: string;
  corpusReleaseHash: string;
  locale: string;
}

const FAILURE_CODES = [
  "schema_version", "title_too_long", "chapter_mismatch", "unknown_chapter_key",
  "section_count", "tension_count", "resource_count", "empty_claim_ledger",
  "unassigned_alias", "unknown_rule", "unauthorized_rule", "paragraph_too_long",
  "counter_class", "chapter_word_count", "missing_planned_alias", "signature_mismatch",
  "unknown_signature_key", "signature_word_count", "missing_uncertainty_note",
  "uncertainty_word_count", "uncertainty_class", "total_word_count", "schema_invalid",
] as const;
type FailureCode = typeof FAILURE_CODES[number];
interface RevalidationFailure { code: FailureCode; path: string; actual_count?: number }
export interface PatternCandidateRevalidationResult {
  schema_version: "pattern-candidate-revalidation/v1";
  generation_id: string;
  provider_job_id: string;
  stage_generation: number;
  stage_attempt: number;
  hashes: { provider_response: string; provider_request: string; writer_request: string;
    validated_plan: string; fact_packet: string; frozen_plan: string; ontology_bundle: string };
  validation_policy_version: "1.0.0";
  ok: boolean;
  failures: RevalidationFailure[];
}

function fail(code: RevalidationErrorCode): never { throw new PatternCandidateRevalidationError(code); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function hash(value: unknown): value is string { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value); }
function unexpired(value: string | null, nowIso: string): boolean {
  return value !== null && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.parse(nowIso);
}

/** Metadata only. Authorization and its durable audit must precede the replay call. */
export async function loadPatternCandidateRevalidationTarget(
  env: Env, generationId: string, nowIso: string,
): Promise<PatternCandidateRevalidationTarget | null> {
  const parent = await env.DB.prepare(`SELECT generation_id,job_id,user_id,stage,stage_generation,
    writer_attempts,plan_hash,ontology_version,ontology_bundle_hash,corpus_release_hash,locale,
    failure_class,finished_at,retention_expires_at FROM pattern_generation_jobs WHERE generation_id = ?`)
    .bind(generationId).first<{
      generation_id: string; job_id: string; user_id: string; stage: string; stage_generation: number;
      writer_attempts: number; plan_hash: string | null; ontology_version: string;
      ontology_bundle_hash: string; corpus_release_hash: string; locale: string;
      failure_class: string | null; finished_at: string | null; retention_expires_at: string | null;
    }>();
  if (!parent) return null;
  if (parent.stage !== "failed" || parent.failure_class !== "candidate_invalid" || !parent.finished_at) {
    fail("generation_not_revalidatable");
  }
  if (!unexpired(parent.retention_expires_at, nowIso)) fail("artifact_unavailable");
  if (!integer(parent.stage_generation) || parent.stage_generation < 1 || !integer(parent.writer_attempts)
    || !hash(parent.plan_hash) || !hash(parent.ontology_bundle_hash) || !hash(parent.corpus_release_hash)) {
    fail("integrity_conflict");
  }
  // Never prefer a nearby attempt or the newest timestamp. Multiple rows for
  // this coordinate are ambiguous even when only one is marked completed.
  const rows = await env.DB.prepare(`SELECT id,user_id,status FROM codex_provider_jobs
    WHERE pipeline = 'pattern' AND owner_id = ? AND pass = 'writer'
      AND stage_generation = ? AND stage_attempt = ? LIMIT 2`)
    .bind(generationId, parent.stage_generation - 1, parent.writer_attempts)
    .all<{ id: string; user_id: string | null; status: string }>();
  if (rows.results.length === 0) fail("artifact_unavailable");
  if (rows.results.length !== 1 || rows.results[0]!.user_id !== parent.user_id) fail("integrity_conflict");
  if (rows.results[0]!.status !== "completed") fail("generation_not_revalidatable");
  return { generationId, userId: parent.user_id, providerJobId: rows.results[0]!.id,
    stageGeneration: parent.stage_generation - 1, stageAttempt: parent.writer_attempts,
    jobId: parent.job_id, planHash: parent.plan_hash, ontologyVersion: parent.ontology_version,
    ontologyBundleHash: parent.ontology_bundle_hash, corpusReleaseHash: parent.corpus_release_hash,
    locale: parent.locale };
}

function isPlan(value: unknown): value is PatternPlan {
  if (!record(value) || value.schema_version !== "0.7.0" || !hash(value.plan_hash)
    || typeof value.sparse_pattern !== "boolean" || !Array.isArray(value.chapters)
    || !Array.isArray(value.additional_signatures) || !Array.isArray(value.omissions)) return false;
  return value.chapters.every((chapter) => record(chapter) && typeof chapter.chapter_key === "string"
    && typeof chapter.working_title === "string" && typeof chapter.purpose === "string"
    && strings(chapter.feature_aliases) && strings(chapter.ontology_rule_ids)
    && strings(chapter.derived_synthesis_ids) && strings(chapter.required_tension_ids)
    && strings(chapter.required_resource_ids) && strings(chapter.required_counter_expression_ids))
    && value.additional_signatures.every((signature) => record(signature)
      && typeof signature.signature_key === "string" && typeof signature.working_title === "string"
      && strings(signature.feature_aliases) && strings(signature.ontology_rule_ids))
    && value.omissions.every((omission) => record(omission) && typeof omission.feature_alias === "string"
      && (omission.covered_by === null || typeof omission.covered_by === "string")
      && ["redundant_with_chapter", "capacity_omitted", "cluster_incompatible", "sparse_document"].includes(String(omission.reason)));
}

function isPacket(value: unknown): value is PatternFactPacket {
  if (!record(value) || value.schema_version !== "0.7.0" || typeof value.locale !== "string"
    || !["exact", "approximate", "unknown"].includes(String(value.effective_accuracy))
    || !record(value.uncertainty) || !strings(value.uncertainty.suppressed_classes)
    || !strings(value.uncertainty.required_language_rule_ids) || !Array.isArray(value.features)
    || !record(value.selection_constraints)) return false;
  const bounds = value.selection_constraints;
  return integer(bounds.core_chapters_min) && integer(bounds.core_chapters_max)
    && integer(bounds.additional_signatures_max) && typeof bounds.sparse_pattern === "boolean"
    && value.features.every((feature) => record(feature) && typeof feature.alias === "string"
      && ["position", "aspect", "pattern", "angle", "house_cusp", "uncertainty"].includes(String(feature.feature_class))
      && record(feature.fact) && ["mandatory_core", "mandatory_any", "eligible"].includes(String(feature.coverage))
      && strings(feature.ontology_rule_ids) && strings(feature.cluster_ids))
    && (value.clusters === undefined || (Array.isArray(value.clusters) && value.clusters.every((cluster) =>
      record(cluster) && typeof cluster.cluster_id === "string" && strings(cluster.feature_aliases)
      && strings(cluster.compatible_with))));
}

function isUnit(value: unknown): value is PatternWriterProseUnit {
  return record(value) && typeof value.text === "string" && strings(value.feature_aliases)
    && strings(value.ontology_rule_ids) && strings(value.derived_synthesis_ids)
    && ["reflective_interpretation", "structural_description", "tension", "resource", "counter_expression", "uncertainty"].includes(String(value.claim_class));
}

// Shape checks protect the validator's typed boundary; word/count/reference
// policy remains exclusively in validatePatternCandidate.
function isWriter(value: unknown): value is PatternWriterOutput {
  return record(value) && value.schema_version === "0.7.0" && typeof value.title === "string"
    && Array.isArray(value.chapters) && value.chapters.every((chapter) => record(chapter)
      && typeof chapter.chapter_key === "string" && typeof chapter.title === "string"
      && typeof chapter.summary === "string" && Array.isArray(chapter.sections)
      && chapter.sections.every((section) => isUnit(section) && "section_key" in section
        && typeof section.section_key === "string"
        && (section.claim_class === "reflective_interpretation" || section.claim_class === "structural_description"))
      && Array.isArray(chapter.tensions) && chapter.tensions.every(isUnit)
      && Array.isArray(chapter.resources) && chapter.resources.every(isUnit)
      && isUnit(chapter.counter_expression))
    && Array.isArray(value.additional_signatures) && value.additional_signatures.every((signature) => record(signature)
      && typeof signature.signature_key === "string" && typeof signature.title === "string"
      && typeof signature.text === "string" && strings(signature.feature_aliases) && strings(signature.ontology_rule_ids))
    && (value.uncertainty_note === null || isUnit(value.uncertainty_note));
}

function isCorrection(value: unknown): value is PatternCorrectionDocument {
  return record(value) && value.schema_version === "0.7.0" && integer(value.attempt)
    && Array.isArray(value.items) && value.items.every((item) => record(item) && typeof item.code === "string"
      && (item.origin === "deterministic" || item.origin === "semantic")
      && (item.target_key === null || typeof item.target_key === "string")
      && strings(item.feature_aliases) && strings(item.ontology_rule_ids))
    && record(value.preserve) && hash(value.preserve.plan_hash) && strings(value.preserve.chapter_keys)
    && strings(value.preserve.signature_keys) && strings(value.preserve.omitted_feature_aliases)
    && strings(value.preserve.authorized_ontology_rule_ids);
}

interface ArtifactInventory {
  id: string;
  object_key: string;
  ciphertext_sha256: string;
  plaintext_sha256: string;
  byte_length: number;
  expires_at: string;
  deleted_at: string | null;
}
const ARTIFACT_METADATA = "id,object_key,ciphertext_sha256,plaintext_sha256,byte_length,expires_at,deleted_at";

async function readArtifact(env: Env, identity: UserIdentity, target: PatternCandidateRevalidationTarget,
  artifactClass: string, nowIso: string, artifactId?: string): Promise<{ value: unknown; inventory: ArtifactInventory }> {
  const rows = await env.DB.prepare(`SELECT ${ARTIFACT_METADATA} FROM pattern_generation_artifacts
    WHERE generation_id = ? AND user_id = ? AND artifact_class = ? ${artifactId ? "AND id = ?" : ""} LIMIT 2`)
    .bind(...[target.generationId, target.userId, artifactClass, ...(artifactId ? [artifactId] : [])])
    .all<ArtifactInventory>();
  if (rows.results.length === 0) fail("artifact_unavailable");
  if (rows.results.length !== 1) fail("integrity_conflict");
  const row = rows.results[0]!;
  if (row.deleted_at || !unexpired(row.expires_at, nowIso)) fail("artifact_unavailable");
  const value = await getArtifactById<unknown>(env, identity, target.generationId, row.id, artifactClass);
  if (value === null) fail("artifact_unavailable");
  return { value, inventory: row };
}

function safeFailures(output: PatternWriterOutput, plan: PatternPlan,
  failures: Array<{ code: string; message: string }>): RevalidationFailure[] {
  const paths = new Map<string, Set<string>>();
  const register = (key: string, path: string) => {
    const values = paths.get(key) ?? new Set<string>(); values.add(path); paths.set(key, values);
  };
  const refs = (key: string, path: string, unit: { feature_aliases: string[]; ontology_rule_ids: string[] }) => {
    register(key, path);
    unit.feature_aliases.forEach((alias, i) => register(`${key}:${alias}`, `${path}/feature_aliases/${i}`));
    unit.ontology_rule_ids.forEach((rule, i) => register(`${key}:${rule}`, `${path}/ontology_rule_ids/${i}`));
  };
  output.chapters.forEach((chapter, i) => {
    const path = `/chapters/${i}`; register(chapter.chapter_key, path);
    chapter.sections.forEach((section, j) => refs(section.section_key, `${path}/sections/${j}`, section));
    chapter.tensions.forEach((unit, j) => {
      refs(`${chapter.chapter_key}:t${j}`, `${path}/tensions/${j}`, unit);
      register(`${chapter.chapter_key}:tension:${j}`, `${path}/tensions/${j}`);
    });
    chapter.resources.forEach((unit, j) => {
      refs(`${chapter.chapter_key}:r${j}`, `${path}/resources/${j}`, unit);
      register(`${chapter.chapter_key}:resource:${j}`, `${path}/resources/${j}`);
    });
    refs(`${chapter.chapter_key}:counter`, `${path}/counter_expression`, chapter.counter_expression);
  });
  output.additional_signatures.forEach((signature, i) => refs(signature.signature_key, `/additional_signatures/${i}`, signature));
  register("uncertainty", "/uncertainty_note"); register("uncertainty_note", "/uncertainty_note");
  return failures.map((failure) => {
    const code = FAILURE_CODES.find((value) => value === failure.code);
    if (!code) fail("unsupported_validation_policy");
    let key = failure.message;
    let count: number | undefined;
    if (code === "chapter_word_count") {
      const match = /^(.*):([0-9]+)$/.exec(key);
      if (match) { key = match[1]!; count = Number(match[2]); }
    }
    if (code === "total_word_count" || code === "uncertainty_word_count") {
      count = /^[0-9]+$/.test(key) ? Number(key) : undefined;
    }
    const candidates = paths.get(key);
    let path = candidates?.size === 1 ? [...candidates][0]! : "";
    if (code === "paragraph_too_long" && path) path += "/text";
    if (code === "title_too_long") path = key === "document title" ? "/title" : path ? `${path}/title` : "";
    if (code === "chapter_mismatch") path = "/chapters";
    if (code === "signature_mismatch") path = "/additional_signatures";
    if (code === "missing_uncertainty_note" || code === "uncertainty_word_count") path = "/uncertainty_note";
    if (code === "schema_version") path = "/schema_version";
    if (code === "missing_planned_alias") {
      const plannedPaths: string[] = [];
      plan.chapters.forEach((chapter, i) => chapter.feature_aliases.forEach((alias, j) => {
        if (`${chapter.chapter_key}:${alias}` === failure.message) plannedPaths.push(`/plan/chapters/${i}/feature_aliases/${j}`);
      }));
      path = plannedPaths.length === 1 ? plannedPaths[0]! : "";
    }
    return { code, path, ...(count !== undefined && integer(count) ? { actual_count: count } : {}) };
  });
}

/** Read-only replay. The route owns authorization and a completed durable audit. */
export async function revalidatePatternCandidate(env: Env, target: PatternCandidateRevalidationTarget,
  nowIso: string): Promise<PatternCandidateRevalidationResult> {
  try {
    const current = await loadPatternCandidateRevalidationTarget(env, target.generationId, nowIso);
    if (!current) fail("artifact_unavailable");
    if (canonicalJson(current) !== canonicalJson(target)) fail("integrity_conflict");
    const identity = await loadUserIdentity(env, target.userId);
    if (!identity || (identity.status !== "active" && identity.status !== "frozen")) fail("artifact_unavailable");
    const key = await env.DB.prepare(`SELECT erased_at FROM pattern_generation_artifact_keys
      WHERE generation_id = ? AND user_id = ?`).bind(target.generationId, target.userId)
      .first<{ erased_at: string | null }>();
    if (!key || key.erased_at) fail("artifact_unavailable");
    const job = await env.DB.prepare(`SELECT payload_enc,payload_key_version,payload_nonce,status
      FROM jobs WHERE id = ? AND user_id = ? AND job_type = 'generate_pattern'`)
      .bind(target.jobId, target.userId).first<{ payload_enc: ArrayBuffer | null;
        payload_key_version: number; payload_nonce: string; status: string }>();
    if (!job?.payload_enc) fail("artifact_unavailable");
    if (job.status !== "failed") fail("integrity_conflict");
    const command = await decryptPayload<unknown>(env, identity, {
      ciphertext: b64(job.payload_enc), key_version: job.payload_key_version, nonce: job.payload_nonce,
    }, { subject: identity.cryptoSubject, field: "jobs.payload_enc", recordId: target.jobId });
    if (!record(command) || !record(command.publisher)) fail("integrity_conflict");
    if (command.publisher.validation_policy_version !== "1.0.0"
      || command.publisher.validation_policy_version !== PATTERN_VALIDATION_POLICY_VERSION) fail("unsupported_validation_policy");
    const inputMaxBytes = command.publisher.input_max_bytes;
    if (!integer(inputMaxBytes) || inputMaxBytes < 1) fail("integrity_conflict");
    if (command.generation_id !== target.generationId || command.user_id !== target.userId
      || command.job_id !== target.jobId || command.ontology_version !== target.ontologyVersion
      || command.ontology_bundle_hash !== target.ontologyBundleHash || command.corpus_release_hash !== target.corpusReleaseHash
      || command.locale !== target.locale || command.publisher.publisher !== "codex") fail("integrity_conflict");
    const planRead = await readArtifact(env, identity, target, "validated_plan", nowIso);
    const packetRead = await readArtifact(env, identity, target, "fact_packet", nowIso);
    const plan = planRead.value;
    const packet = packetRead.value;
    if (!isPlan(plan) || !isPacket(packet)) fail("integrity_conflict");
    const { plan_hash: frozenHash, sparse_pattern: _sparse, ...planner } = plan;
    if (frozenHash !== target.planHash || await contentHash(JSON.stringify(planner)) !== target.planHash
      || plan.sparse_pattern !== packet.selection_constraints.sparse_pattern || packet.locale !== target.locale) fail("integrity_conflict");
    const ontology = await loadOntologyByVersion(env, target.ontologyVersion);
    if (!ontology) fail("artifact_unavailable");
    if (ontology.bundleHash !== target.ontologyBundleHash || ontology.corpusReleaseHash !== target.corpusReleaseHash
      || ontology.locale !== target.locale || ontology.release.ontology_version !== target.ontologyVersion) fail("integrity_conflict");
    const requestId = await patternArtifactId(target.generationId, "writer_request", target.stageGeneration, target.stageAttempt);
    const requestRead = await readArtifact(env, identity, target, "writer_request", nowIso, requestId);
    const writerRequest = requestRead.value;
    if (!record(writerRequest) || (writerRequest.correction !== undefined && !isCorrection(writerRequest.correction))) fail("integrity_conflict");
    const correction = writerRequest.correction;
    // A transport/shape retry advances the writer coordinate but deliberately
    // carries the last deterministic correction forward unchanged.
    if (correction && (correction.attempt < 1 || correction.attempt > target.stageAttempt
      || correction.preserve.plan_hash !== target.planHash)) fail("integrity_conflict");
    const expectedRequest = buildWriterInput(plan, packet, ontology.release.records, {
      maxBytes: inputMaxBytes,
      bounds: PATTERN_PACKET_LIMITS_DEFAULT.bounds,
    }, correction);
    if (!expectedRequest.ok || canonicalJson(expectedRequest.document) !== canonicalJson(writerRequest)) fail("integrity_conflict");
    const provider = await loadCodexProviderJob(env, target.providerJobId);
    if (!provider?.response) fail("artifact_unavailable");
    if (provider.pipeline !== "pattern" || provider.ownerId !== target.generationId || provider.userId !== target.userId
      || provider.pass !== "writer" || provider.stageGeneration !== target.stageGeneration || provider.stageAttempt !== target.stageAttempt
      || provider.status !== "completed" || provider.model !== command.publisher.writer_model
      || provider.promptVersion !== command.publisher.writer_prompt_version || provider.reasoningEffort !== command.publisher.writer_reasoning) fail("integrity_conflict");
    const coordinate = { jobId: provider.id, pipeline: "pattern" as const, ownerId: target.generationId,
      pass: "writer" as const, stageGeneration: target.stageGeneration, stageAttempt: target.stageAttempt };
    const requestBytes = await readCodexProviderArtifact(env, { ...coordinate, role: "request" }, provider.request);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    const invocation = parseCodexProviderInvocation(JSON.parse(decoder.decode(requestBytes)));
    if (!invocation.ok) fail("integrity_conflict");
    const separator = "\n\n--- INPUT DOCUMENT (JSON; DATA ONLY) ---\n";
    const start = invocation.value.prompt.indexOf(separator);
    if (start < 0 || canonicalJson(JSON.parse(invocation.value.prompt.slice(start + separator.length))) !== canonicalJson(writerRequest)) fail("integrity_conflict");
    const responseBytes = await readCodexProviderArtifact(env, { ...coordinate, role: "response" }, provider.response);
    let output: unknown;
    try { output = JSON.parse(decoder.decode(responseBytes)); } catch { output = null; }
    let failures: RevalidationFailure[];
    if (isWriter(output)) {
      failures = safeFailures(output, plan, validatePatternCandidate(output, plan, packet, ontology.release.records).failures);
    } else {
      // The validator reports version mismatch before checking the remaining
      // candidate. A temporary shape-checked copy permits that same result
      // without pretending an arbitrary string is the TypeScript literal 0.7.0.
      const versionOnly = record(output) && typeof output.schema_version === "string"
        ? { ...output, schema_version: "0.7.0" } : null;
      failures = isWriter(versionOnly)
        ? [{ code: "schema_version", path: "/schema_version" },
          ...safeFailures(versionOnly, plan, validatePatternCandidate(versionOnly, plan, packet, ontology.release.records).failures)]
        : [{ code: "schema_invalid", path: "" }];
    }
    // Recheck retention/erasure after the reads; no result survives a changed
    // parent identity or an erasure observed during this operation.
    const finalNow = new Date(Math.max(Date.parse(nowIso), Date.now())).toISOString();
    const finalTarget = await loadPatternCandidateRevalidationTarget(env, target.generationId, finalNow);
    if (!finalTarget || canonicalJson(finalTarget) !== canonicalJson(target)) fail("integrity_conflict");
    const consumed = [planRead.inventory, packetRead.inventory, requestRead.inventory];
    const finalArtifacts = await env.DB.prepare(`SELECT ${ARTIFACT_METADATA} FROM pattern_generation_artifacts
      WHERE generation_id = ? AND user_id = ? AND id IN (?,?,?)`)
      .bind(target.generationId, target.userId, ...consumed.map((artifact) => artifact.id)).all<ArtifactInventory>();
    for (const artifact of consumed) {
      const currentArtifact = finalArtifacts.results.find((row) => row.id === artifact.id);
      if (!currentArtifact || currentArtifact.deleted_at || !unexpired(currentArtifact.expires_at, finalNow)) fail("artifact_unavailable");
      if (canonicalJson(currentArtifact) !== canonicalJson(artifact)) fail("integrity_conflict");
    }
    const finalProvider = await loadCodexProviderJob(env, target.providerJobId);
    if (!finalProvider?.response || finalProvider.status !== "completed") fail("artifact_unavailable");
    if (canonicalJson(finalProvider) !== canonicalJson(provider)) fail("integrity_conflict");
    const stillPresent = await env.DB.prepare(`SELECT j.payload_enc,j.payload_key_version,j.payload_nonce
      FROM jobs j JOIN users u ON u.id = j.user_id
      JOIN pattern_generation_artifact_keys k ON k.user_id = u.id AND k.generation_id = ?
      WHERE j.id = ? AND j.user_id = ? AND j.status = 'failed'
        AND u.status IN ('active','frozen') AND k.erased_at IS NULL AND j.payload_enc IS NOT NULL`)
      .bind(target.generationId, target.jobId, target.userId)
      .first<{ payload_enc: ArrayBuffer; payload_key_version: number; payload_nonce: string }>();
    if (!stillPresent) fail("artifact_unavailable");
    if (stillPresent.payload_key_version !== job.payload_key_version || stillPresent.payload_nonce !== job.payload_nonce
      || b64(stillPresent.payload_enc) !== b64(job.payload_enc)) fail("integrity_conflict");
    return { schema_version: "pattern-candidate-revalidation/v1", generation_id: target.generationId,
      provider_job_id: provider.id, stage_generation: target.stageGeneration, stage_attempt: target.stageAttempt,
      hashes: { provider_response: provider.response.plaintextHash, provider_request: provider.request.plaintextHash,
        writer_request: await contentHash(JSON.stringify(writerRequest)), validated_plan: await contentHash(JSON.stringify(plan)),
        fact_packet: await contentHash(JSON.stringify(packet)), frozen_plan: target.planHash, ontology_bundle: ontology.bundleHash },
      validation_policy_version: "1.0.0", ok: failures.length === 0, failures };
  } catch (error) {
    if (error instanceof PatternCandidateRevalidationError) throw error;
    if (error instanceof UserKeyDestroyedError || error instanceof NoUserKeyError) fail("artifact_unavailable");
    if (error instanceof CodexProviderArtifactError) {
      if (error.code === "codex_provider_artifact_unavailable"
        || error.code === "codex_provider_artifact_keyring_invalid") fail("artifact_unavailable");
      fail("integrity_conflict");
    }
    if (error instanceof Error && error.message === "pattern artifact identity conflict") fail("integrity_conflict");
    throw error;
  }
}
