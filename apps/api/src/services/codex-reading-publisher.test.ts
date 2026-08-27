import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { canonicalJson, contentHash } from "@patternlike/shared";
import type { ReadingGenerationOutput, ReadingGenerationRequest } from "@patternlike/shared";

import {
  CODEX_TEST_ARTIFACT_KEYRING,
  IDENTITY_A,
  USER_A,
  resetDb,
  rows,
  seedUser,
} from "../../test/helpers.js";
import {
  codexProviderJobId,
  loadCodexProviderJob,
} from "../db/codex-provider-jobs.js";
import { putCodexProviderArtifact } from "./codex-provider-artifacts.js";
import {
  CODEX_PROVIDER_TIMEOUT_MS,
  invocationFromResponsesRequest,
} from "./codex-provider-contract.js";
import { createCodexReadingPublisher } from "./codex-reading-publisher.js";
import { buildResponsesRequest } from "./reading-prompt.js";
import {
  OPENAI_READING_MAX_OUTPUT_TOKENS,
  OPENAI_READING_MODEL,
  READING_CONTEXT_MAX_BYTES,
  READING_PROMPT_VERSION,
  type PublishOptions,
  type PublisherConfigPin,
} from "./reading-publisher.js";

const OWNER_JOB_ID = "job_codex_reading_fixture_1";

const pin: PublisherConfigPin = {
  provider: "codex",
  model: OPENAI_READING_MODEL,
  reasoning_effort: "high",
  prompt_version: READING_PROMPT_VERSION,
  output_schema: "daily-reading-v5",
  selection_policy_version: "1.0.0",
  validation_policy_version: "1.0.0",
  max_output_tokens: OPENAI_READING_MAX_OUTPUT_TOKENS,
  context_max_bytes: READING_CONTEXT_MAX_BYTES,
};

function options(overrides: Partial<PublishOptions> = {}): PublishOptions {
  return {
    requestId: "req_codex_reading_0001",
    timeoutMs: CODEX_PROVIDER_TIMEOUT_MS,
    configuration: pin,
    codexJob: {
      pipeline: "reading",
      ownerId: OWNER_JOB_ID,
      userId: USER_A,
      stageGeneration: 1,
      stageAttempt: 0,
      dailyCallLimit: 250,
    },
    ...overrides,
  };
}

const packet: ReadingGenerationRequest = {
  schema_version: "0.5.0",
  prompt_version: READING_PROMPT_VERSION,
  selection_policy_version: "1.0.0",
  output_schema: "daily-reading-v5",
  local_date: "2026-08-27",
  locale: "en-US",
  birth_time_accuracy: "exact",
  suppressed_features: [],
  domain_preference: null,
  facts: [
    {
      fact_id: `cyc_${"a".repeat(32)}`,
      fact_class: "cycle_instance",
      scope: "personalized",
      lane_rank: 1,
      label: "Saturn square your Sun, building",
      attributes: {
        bodies: ["saturn", "sun"],
        aspect: "square",
        signs: [],
        houses: [],
        phase: "building",
        lunar_phase: null,
        degrees: [],
        timestamps: [],
        dates: [],
      },
    },
  ],
  context: [],
  prior_readings: [],
  composition: {
    allowed_paragraph_roles: ["supporting_theme", "timing"],
    min_paragraphs: 1,
    max_paragraphs: 2,
    headline_max_chars: 60,
    lead_max_chars: 400,
    paragraph_max_chars: 400,
    reflection_max_chars: 200,
    uncertainty_note_required: false,
  },
};

const candidate: ReadingGenerationOutput = {
  schema_version: "0.5.0",
  output_schema: "daily-reading-v5",
  local_date: "2026-08-27",
  locale: "en-US",
  headline: "A narrower commitment",
  lead: {
    text: "The pressure is not asking for more effort, only for a smaller promise.",
    fact_ids: [packet.facts[0]!.fact_id],
    context_refs: [],
  },
  paragraphs: [],
  reflection_prompt: {
    text: "Which promise would you keep if nobody was watching?",
    fact_ids: [],
    context_refs: [],
  },
  uncertainty_note: null,
};

/** The exact request bytes the adapter derives, recomputed independently here. */
async function expectedRequest(): Promise<{ jobId: string; serialized: string }> {
  const converted = invocationFromResponsesRequest(
    buildResponsesRequest(packet, pin),
    { model: pin.model, reasoningEffort: "high" },
  );
  if (!converted.ok) throw new Error("the fixture packet must convert");
  const serialized = canonicalJson(converted.value);
  const jobId = await codexProviderJobId({
    pipeline: "reading",
    ownerId: OWNER_JOB_ID,
    pass: "publisher",
    stageGeneration: 1,
    stageAttempt: 0,
    requestHash: await contentHash(serialized),
  });
  return { jobId, serialized };
}

/** Drive a leased job to `completed` with the given response bytes. */
async function completeWith(jobId: string, output: string): Promise<void> {
  const leaseHash = `sha256:${"c".repeat(64)}`;
  // After the row's own created_at, which enqueue stamps with the real clock.
  const now = new Date(Date.now() + 60_000).toISOString();
  const leaseExpiresAt = new Date(Date.now() + 900_000).toISOString();
  const artifact = await putCodexProviderArtifact(
    env,
    {
      jobId,
      pipeline: "reading",
      ownerId: OWNER_JOB_ID,
      pass: "publisher",
      stageGeneration: 1,
      stageAttempt: 0,
      role: "response",
      storageDiscriminator: leaseHash.slice("sha256:".length),
    },
    new TextEncoder().encode(output),
  );
  await rows(
    `UPDATE codex_provider_jobs SET
       status = 'completed', lease_token_hash = ?, lease_expires_at = ?,
       response_hash = ?, response_object_key = ?, response_envelope_hash = ?,
       response_ciphertext_hash = ?, response_key_id = ?, response_nonce = ?,
       response_byte_length = ?, provider_request_id = ?, input_tokens = 4127,
       output_tokens = 612, updated_at = ?, completed_at = ?
     WHERE id = ?`,
    leaseHash,
    leaseExpiresAt,
    artifact.artifact.plaintextHash,
    artifact.artifact.objectKey,
    artifact.artifact.envelopeHash,
    artifact.artifact.ciphertextHash,
    artifact.artifact.keyId,
    artifact.artifact.nonce,
    artifact.artifact.byteLength,
    "thread_codex_reading_0001",
    now,
    now,
    jobId,
  );
}

describe("the Codex Daily publisher adapter", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    env.CODEX_PROVIDER_ARTIFACT_KEYRING = CODEX_TEST_ARTIFACT_KEYRING;
  });

  it("creates one durable job from deterministic request bytes and waits", async () => {
    const publisher = createCodexReadingPublisher(env);
    const result = await publisher.publish(packet, options());
    const expected = await expectedRequest();

    expect(result).toEqual({
      ok: false,
      code: "publisher_pending",
      job_id: expected.jobId,
    });

    const job = await loadCodexProviderJob(env, expected.jobId);
    expect(job).not.toBeNull();
    expect(job!.pipeline).toBe("reading");
    expect(job!.pass).toBe("publisher");
    expect(job!.ownerId).toBe(OWNER_JOB_ID);
    expect(job!.userId).toBe(USER_A);
    expect(job!.stageGeneration).toBe(1);
    expect(job!.stageAttempt).toBe(0);
    expect(job!.model).toBe(OPENAI_READING_MODEL);
    expect(job!.promptVersion).toBe(READING_PROMPT_VERSION);
    expect(job!.timeoutMs).toBe(CODEX_PROVIDER_TIMEOUT_MS);
    expect(job!.dailyCallLimit).toBe(250);
    expect(job!.request.plaintextHash).toBe(await contentHash(expected.serialized));

    // The reader's packet is in R2 only, and only sealed. The envelope carries
    // the coordinate in the clear on purpose -- it is the AAD, and binding it
    // is what makes moving ciphertext between owners or attempts fail
    // authentication -- but it names no reader and quotes no packet content.
    const stored = await env.ARTIFACTS!.get(job!.request.objectKey);
    expect(stored).not.toBeNull();
    const bytes = await stored!.text();
    expect(bytes).not.toContain("Saturn");
    expect(bytes).not.toContain("smaller promise");
    expect(bytes).not.toContain(USER_A);
    const envelope = JSON.parse(bytes) as Record<string, unknown>;
    expect(envelope.owner_id).toBe(OWNER_JOB_ID);
    expect(envelope).not.toHaveProperty("user_id");
  });

  it("adopts the same coordinate on a duplicate delivery and creates nothing new", async () => {
    const publisher = createCodexReadingPublisher(env);
    const first = await publisher.publish(packet, options());
    const second = await publisher.publish(packet, options());

    expect(second).toEqual(first);
    const [count] = await rows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM codex_provider_jobs",
    );
    expect(count!.count).toBe(1);
  });

  it("keeps waiting while the runner holds the lease", async () => {
    const publisher = createCodexReadingPublisher(env);
    const pending = await publisher.publish(packet, options());
    if (pending.ok || pending.code !== "publisher_pending") {
      throw new Error("expected a pending result");
    }
    await rows(
      `UPDATE codex_provider_jobs
       SET status = 'leased', lease_token_hash = ?, lease_expires_at = ?
       WHERE id = ?`,
      `sha256:${"d".repeat(64)}`,
      new Date(Date.now() + 900_000).toISOString(),
      pending.job_id,
    );

    expect(await publisher.publish(packet, options())).toEqual(pending);
  });

  it("adopts a completed candidate with safe Codex metadata", async () => {
    const publisher = createCodexReadingPublisher(env);
    const pending = await publisher.publish(packet, options());
    if (pending.ok || pending.code !== "publisher_pending") {
      throw new Error("expected a pending result");
    }
    const output = JSON.stringify(candidate);
    await completeWith(pending.job_id, output);

    const result = await publisher.publish(packet, options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate).toEqual(candidate);
    expect(result.metadata.provider).toBe("codex");
    expect(result.metadata.model).toBe(OPENAI_READING_MODEL);
    expect(result.metadata.input_tokens).toBe(4127);
    expect(result.metadata.output_tokens).toBe(612);
    expect(result.metadata.provider_response_hash).toBe(await contentHash(output));
    // The provider-side thread handle, never the internal control id.
    expect(result.metadata.provider_request_id).toBe("thread_codex_reading_0001");
    expect(result.metadata.provider_request_id).not.toBe(pending.job_id);
    expect(result.metadata.provider_request_id).not.toMatch(/^cpjob_/);
  });

  it("returns the runner's own closed failure rather than a second opinion", async () => {
    const publisher = createCodexReadingPublisher(env);
    const pending = await publisher.publish(packet, options());
    if (pending.ok || pending.code !== "publisher_pending") {
      throw new Error("expected a pending result");
    }

    for (
      const [code, detail] of [
        ["publisher_unavailable", "request_timeout"],
        ["publisher_output_invalid", "max_output_tokens_exhausted"],
        ["publisher_refused", "provider_refusal"],
        ["publisher_auth_failed", "authentication_failed"],
        ["publisher_model_unavailable", "model_not_available"],
        ["publisher_budget_exhausted", "daily_call_limit_reached"],
      ] as const
    ) {
      await rows(
        `UPDATE codex_provider_jobs SET
           status = 'failed', lease_token_hash = ?, lease_expires_at = ?,
           failure_code = ?, safe_detail_code = ?, completed_at = ?
         WHERE id = ?`,
        `sha256:${"e".repeat(64)}`,
        new Date(Date.now() + 900_000).toISOString(),
        code,
        detail,
        new Date(Date.now() + 60_000).toISOString(),
        pending.job_id,
      );
      expect(await publisher.publish(packet, options())).toEqual({
        ok: false,
        code,
        safe_detail_code: detail,
        retry_after_seconds: null,
      });
    }
  });

  it("classifies malformed and schema-invalid output without repairing it", async () => {
    const publisher = createCodexReadingPublisher(env);

    for (
      const [output, expected] of [
        ["not json at all", "invalid_json"],
        ["[]", "schema_mismatch"],
        ["null", "schema_mismatch"],
        [JSON.stringify({ headline: "only one field" }), "schema_mismatch"],
      ] as const
    ) {
      await resetDb();
      await seedUser(IDENTITY_A);
      const pending = await publisher.publish(packet, options());
      if (pending.ok || pending.code !== "publisher_pending") {
        throw new Error("expected a pending result");
      }
      await completeWith(pending.job_id, output);
      expect(await publisher.publish(packet, options())).toEqual({
        ok: false,
        code: "publisher_output_invalid",
        safe_detail_code: expected,
        retry_after_seconds: null,
      });
    }
  });

  it("refuses a coordinate, deadline, or reasoning pin it cannot execute", async () => {
    const publisher = createCodexReadingPublisher(env);
    const refusals: PublishOptions[] = [
      options({ codexJob: undefined }),
      options({ timeoutMs: 90_000 }),
      options({ configuration: { ...pin, reasoning_effort: "medium" } }),
    ];
    for (const value of refusals) {
      expect(await publisher.publish(packet, value)).toEqual({
        ok: false,
        code: "publisher_unavailable",
        safe_detail_code: "network_error",
        retry_after_seconds: null,
      });
    }
    // Nothing was created for any of them.
    const [count] = await rows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM codex_provider_jobs",
    );
    expect(count!.count).toBe(0);
  });

  it("fails closed when the artifact keyring cannot seal the packet", async () => {
    env.CODEX_PROVIDER_ARTIFACT_KEYRING = "";
    const publisher = createCodexReadingPublisher(env);
    expect(await publisher.publish(packet, options())).toEqual({
      ok: false,
      code: "publisher_unavailable",
      safe_detail_code: "network_error",
      retry_after_seconds: null,
    });
    const [count] = await rows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM codex_provider_jobs",
    );
    expect(count!.count).toBe(0);
  });

  it("refuses to reuse a coordinate for different request bytes", async () => {
    const publisher = createCodexReadingPublisher(env);
    await publisher.publish(packet, options());

    // Same owner, generation, and attempt; different packet. The immutable
    // coordinate belongs to the bytes that claimed it, so this must not quietly
    // adopt a job describing a different reading.
    const different: ReadingGenerationRequest = {
      ...packet,
      locale: "en-GB",
    };
    const result = await publisher.publish(different, options());
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.code).toBe("publisher_unavailable");
  });
});
