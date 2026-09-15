import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import { canonicalJson, contentHash, type PatternPlan, type PatternWriterOutput } from "@patternlike/shared";
import { env } from "cloudflare:test";
import { IDENTITY_A, USER_A, seedUser } from "./helpers.js";
import { encryptPayload } from "../src/db/users.js";
import { claimCodexProviderJob, completeCodexProviderJob } from "../src/db/codex-provider-jobs.js";
import { putCodexProviderArtifact } from "../src/services/codex-provider-artifacts.js";
import { createCodexPatternPublisher } from "../src/services/codex-pattern-publisher.js";
import { loadOntologyRegressionCorpus } from "../src/services/ontology-regression.js";
import { artifactAad, b64, encryptUnderContentKey, randomKey, randomNonce, wrapContentKey } from "../src/services/pattern-crypto.js";
import { computeOntologyBundleHash } from "../src/services/pattern-ontology-verify.js";
import { buildCorrectionDocument, buildWriterInput, PATTERN_PACKET_LIMITS_DEFAULT } from "../src/services/pattern-packet.js";
import { patternArtifactId } from "../src/services/pattern-stage-protocol.js";
import { resolvePatternPublisherConfiguration } from "../src/services/pattern-publisher.js";

export const REVALIDATION_GENERATION_ID = `pgen_${"d".repeat(32)}`;
export const REVALIDATION_NOW = "2030-08-24T00:00:00.000Z";
const EXPIRES = "2030-09-24T00:00:00.000Z";
const JOB_ID = `job_${"d".repeat(32)}`;

/** Real D1 rows and encrypted R2 objects for a failed final writer attempt. */
export async function seedPatternRevalidationFixture(options: {
  validCandidate?: boolean;
  missingUncertainty?: boolean;
  mutateWriter?: (writer: PatternWriterOutput) => void;
  validationPolicy?: string;
  correctionAttempt?: number;
  inputMaxBytes?: number;
  response?: unknown;
} = {}) {
  if (!await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(USER_A).first()) {
    await seedUser(IDENTITY_A);
  }
  const corpus = loadOntologyRegressionCorpus();
  const chain = structuredClone(corpus.fixtures[20]!.chain);
  const { plan_hash: _oldHash, sparse_pattern, ...planner } = chain.plan;
  const plan: PatternPlan = { ...planner, plan_hash: await contentHash(JSON.stringify(planner)), sparse_pattern };
  const packet = chain.fact_packet;
  const writer = chain.writer;
  if (!options.validCandidate) writer.chapters[0]!.sections[0]!.text = Array(181).fill("privateword").join(" ");
  if (options.missingUncertainty) writer.uncertainty_note = null;
  options.mutateWriter?.(writer);
  const release = syntheticOntologyRelease("ontology-revalidation-fixture");
  release.records = structuredClone(corpus.manifest.reference_ontology_records);
  release.bundle_hash = await computeOntologyBundleHash(release);
  const ontologyKey = "pattern-ontology/ontology-revalidation-fixture.json";
  await env.ARTIFACTS!.put(ontologyKey, canonicalJson(release));
  await env.DB.prepare(`INSERT INTO pattern_ontology_releases
    (version,bundle_hash,corpus_release_hash,locale,status,object_key,evaluation_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(release.ontology_version, release.bundle_hash,
    release.corpus_release_hash, release.locale, release.status, ontologyKey,
    JSON.stringify(release.evaluation), REVALIDATION_NOW).run();
  const resolved = resolvePatternPublisherConfiguration(env);
  if (!resolved.ok) throw new Error("fixture publisher configuration missing");
  const pin = {
    ...resolved.config.pin,
    input_max_bytes: options.inputMaxBytes ?? resolved.config.pin.input_max_bytes,
  };
  const command = {
    command_version: "GeneratePatternCommandV2", schema_version: "0.9.0",
    generation_id: REVALIDATION_GENERATION_ID, job_id: JOB_ID, user_id: USER_A,
    ontology_version: release.ontology_version, ontology_bundle_hash: release.bundle_hash,
    corpus_release_hash: release.corpus_release_hash, locale: packet.locale,
    publisher: { ...pin, validation_policy_version: options.validationPolicy ?? pin.validation_policy_version },
    planner_attempts_max: 2, writer_attempts_max: 3, verifier_attempts_max: 2,
    pattern_source_hash: `sha256:${"9".repeat(64)}`,
  };
  const commandEnc = await encryptPayload(env, IDENTITY_A, command, {
    subject: IDENTITY_A.cryptoSubject, field: "jobs.payload_enc", recordId: JOB_ID,
  });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO pattern_generation_claims
      (id,user_id,chart_fingerprint_hash,status,created_at,updated_at)
      VALUES (?,?,?,'available',?,?)`).bind("pgc_revalidation", USER_A,
      `sha256:${"1".repeat(64)}`, REVALIDATION_NOW, REVALIDATION_NOW),
    env.DB.prepare(`INSERT INTO jobs (id,job_type,user_id,idempotency_key,status,
      payload_enc,payload_key_version,payload_nonce,created_at,finished_at)
      VALUES (?,'generate_pattern',?,'revalidation-fixture','failed',?,?,?,?,?)`)
      .bind(JOB_ID, USER_A, Uint8Array.from(atob(commandEnc.ciphertext), (ch) => ch.charCodeAt(0)),
        commandEnc.key_version, commandEnc.nonce, REVALIDATION_NOW, REVALIDATION_NOW),
    env.DB.prepare(`INSERT INTO pattern_generation_jobs
      (generation_id,job_id,user_id,claim_id,chart_id,chart_fingerprint_hash,
      feature_set_id,feature_set_hash,feature_policy_version,selection_policy_version,
      locale,locale_revision,consent_id,consent_policy_version,ontology_version,
      ontology_bundle_hash,corpus_release_hash,pattern_source_hash,reservation_reason,
      stage,stage_generation,writer_attempts,plan_hash,failure_class,retention_expires_at,
      created_at,updated_at,finished_at)
      VALUES (?,?,?,'pgc_revalidation','cht_fixture',?,'nfs_fixture',?,'1.0.0','1.0.0',
      ?,1,'cns_fixture','1.0.0',?,?,?,?,'first_open','failed',4,2,?,'candidate_invalid',?,?,?,?)`)
      .bind(REVALIDATION_GENERATION_ID, JOB_ID, USER_A, `sha256:${"1".repeat(64)}`,
        `sha256:${"2".repeat(64)}`, packet.locale, release.ontology_version, release.bundle_hash,
        release.corpus_release_hash, command.pattern_source_hash, plan.plan_hash,
        EXPIRES, REVALIDATION_NOW, REVALIDATION_NOW, REVALIDATION_NOW),
  ]);
  const contentKey = randomKey();
  const wrapped = await wrapContentKey(env, IDENTITY_A, REVALIDATION_GENERATION_ID,
    "pattern_generation_artifact_keys.wrapped_key_enc", contentKey,
    { generation_id: REVALIDATION_GENERATION_ID });
  await env.DB.prepare(`INSERT INTO pattern_generation_artifact_keys
    (generation_id,user_id,wrapped_key_enc,wrapped_key_version,wrapped_key_nonce,created_at)
    VALUES (?,?,?,?,?,?)`).bind(REVALIDATION_GENERATION_ID, USER_A,
      Uint8Array.from(atob(wrapped.ciphertext), (ch) => ch.charCodeAt(0)), wrapped.keyVersion,
      wrapped.nonce, REVALIDATION_NOW).run();
  async function storeArtifact(artifactClass: string, value: unknown, stage = 0, attempt = 0) {
    const id = await patternArtifactId(REVALIDATION_GENERATION_ID, artifactClass, stage, attempt);
    const objectKey = `pattern-generations/${REVALIDATION_GENERATION_ID}/${id}.json.enc`;
    const nonce = randomNonce();
    const ciphertext = await encryptUnderContentKey(value, contentKey, nonce,
      artifactAad(REVALIDATION_GENERATION_ID, id, artifactClass));
    const stored = new Uint8Array(nonce.length + ciphertext.length);
    stored.set(nonce); stored.set(ciphertext, nonce.length);
    await env.ARTIFACTS!.put(objectKey, stored);
    await env.DB.prepare(`INSERT INTO pattern_generation_artifacts
      (id,generation_id,user_id,artifact_class,object_key,ciphertext_sha256,plaintext_sha256,
      byte_length,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET ciphertext_sha256=excluded.ciphertext_sha256,
        plaintext_sha256=excluded.plaintext_sha256,byte_length=excluded.byte_length`)
      .bind(id, REVALIDATION_GENERATION_ID, USER_A, artifactClass, objectKey,
        await contentHash(b64(stored)), await contentHash(JSON.stringify(value)),
        stored.byteLength, REVALIDATION_NOW, EXPIRES).run();
    return id;
  }
  const packetId = await storeArtifact("fact_packet", packet);
  const planId = await storeArtifact("validated_plan", plan);
  const correction = buildCorrectionDocument(plan, { deterministic: [{ code: "total_word_count", message: "1000" }] }, options.correctionAttempt ?? 2);
  const built = buildWriterInput(plan, packet, release.records, {
    maxBytes: pin.input_max_bytes,
    bounds: PATTERN_PACKET_LIMITS_DEFAULT.bounds,
  }, correction);
  if (!built.ok) throw new Error("fixture writer input invalid");
  const requestId = await storeArtifact("writer_request", built.document, 3, 2);
  const publisher = createCodexPatternPublisher(env);
  const pending = await publisher.write(built.document, {
    requestId: "req_revalidation", timeoutMs: 900_000, pin,
    reserve: async () => ({ ok: true }),
    codexJob: { pipeline: "pattern", ownerId: REVALIDATION_GENERATION_ID, userId: USER_A,
      stageGeneration: 3, stageAttempt: 2, dailyCallLimit: 100 },
  });
  if (pending.ok || pending.code !== "publisher_pending") throw new Error("fixture provider missing");
  const claimed = await claimCodexProviderJob(env, new Date(REVALIDATION_NOW));
  if (claimed.status !== "claimed") throw new Error("fixture provider claim missing");
  const response = await putCodexProviderArtifact(env, {
    jobId: pending.job_id, pipeline: "pattern", ownerId: REVALIDATION_GENERATION_ID,
    pass: "writer", stageGeneration: 3, stageAttempt: 2, role: "response",
  }, new TextEncoder().encode(JSON.stringify("response" in options ? options.response : writer)));
  await completeCodexProviderJob(env, { jobId: pending.job_id, leaseToken: claimed.leaseToken,
    response: response.artifact, providerRequestId: "thread_revalidation", inputTokens: 100, outputTokens: 200 },
  new Date(REVALIDATION_NOW));
  return { providerJobId: pending.job_id, packetId, planId, requestId, packet, plan, writer,
    command, commandEnc, storeArtifact, responseHash: response.artifact.plaintextHash };
}
