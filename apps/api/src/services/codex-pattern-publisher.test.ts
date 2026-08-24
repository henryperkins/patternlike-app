import { canonicalJson } from "@patternlike/shared";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  IDENTITY_A,
  USER_A,
  resetDb,
  seedUser,
} from "../../test/helpers.js";
import {
  claimCodexProviderJob,
  completeCodexProviderJob,
  failCodexProviderJob,
} from "../db/codex-provider-jobs.js";
import { putCodexProviderArtifact } from "./codex-provider-artifacts.js";
import { createCodexPatternPublisher } from "./codex-pattern-publisher.js";
import {
  OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS,
  OPENAI_PATTERN_PLANNER_MODEL,
  OPENAI_PATTERN_PLANNER_PROMPT_VERSION,
  OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS,
  OPENAI_PATTERN_VERIFIER_MODEL,
  OPENAI_PATTERN_VERIFIER_PROMPT_VERSION,
  OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS,
  OPENAI_PATTERN_WRITER_MODEL,
  OPENAI_PATTERN_WRITER_PROMPT_VERSION,
  PATTERN_INPUT_MAX_BYTES,
  type PatternPassOptions,
  type PatternPublisherPin,
} from "./pattern-publisher.js";

const textEncoder = new TextEncoder();
const NOW = new Date("2030-08-24T00:00:00.000Z");

const pin: PatternPublisherPin = {
  publisher: "codex",
  planner_model: OPENAI_PATTERN_PLANNER_MODEL,
  planner_reasoning: "high",
  planner_prompt_version: OPENAI_PATTERN_PLANNER_PROMPT_VERSION,
  planner_max_output_tokens: OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS,
  writer_model: OPENAI_PATTERN_WRITER_MODEL,
  writer_reasoning: "high",
  writer_prompt_version: OPENAI_PATTERN_WRITER_PROMPT_VERSION,
  writer_max_output_tokens: OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS,
  verifier_model: OPENAI_PATTERN_VERIFIER_MODEL,
  verifier_reasoning: "high",
  verifier_prompt_version: OPENAI_PATTERN_VERIFIER_PROMPT_VERSION,
  verifier_max_output_tokens: OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS,
  input_max_bytes: PATTERN_INPUT_MAX_BYTES,
  selection_policy_version: "1.0.0",
  validation_policy_version: "1.0.0",
};

function options(reserve = vi.fn(async () => ({ ok: true }))): PatternPassOptions {
  return {
    requestId: "req_codex_pattern_fixture",
    timeoutMs: 900_000,
    pin,
    reserve,
    codexJob: {
      pipeline: "pattern",
      ownerId: "pgen_codex_pattern_fixture",
      userId: USER_A,
      stageGeneration: 0,
      stageAttempt: 0,
      dailyCallLimit: 100,
    },
  };
}

describe("Codex Pattern publisher", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    env.CODEX_PROVIDER_ARTIFACT_KEYRING = JSON.stringify({
      version: 1,
      keys: {
        "codex-test-key": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
      },
    });
  });

  it("waits without charging, then adopts an exact completed result", async () => {
    const reserve = vi.fn(async () => ({ ok: true }));
    const publisher = createCodexPatternPublisher(env);
    const input = { packet: "synthetic fixture" };

    const pending = await publisher.plan(input, options(reserve));
    expect(pending).toEqual({
      ok: false,
      code: "publisher_pending",
      job_id: expect.stringMatching(/^cpjob_[a-f0-9]{32}$/),
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM pattern_provider_daily_usage",
    ).first()).toEqual({ count: 0 });

    const claimed = await claimCodexProviderJob(env, NOW);
    expect(claimed.status).toBe("claimed");
    if (claimed.status !== "claimed") throw new Error("claim missing");
    const output = canonicalJson({
      schema_version: "0.7.0",
      chapters: [],
      additional_signatures: [],
      omissions: [],
    });
    const response = await putCodexProviderArtifact(
      env,
      {
        jobId: claimed.job.id,
        pipeline: "pattern",
        ownerId: claimed.job.ownerId,
        pass: "planner",
        stageGeneration: 0,
        stageAttempt: 0,
        role: "response",
      },
      textEncoder.encode(output),
    );
    expect(await completeCodexProviderJob(
      env,
      {
        jobId: claimed.job.id,
        leaseToken: claimed.leaseToken,
        response: response.artifact,
        providerRequestId: "thread_codex_pattern_1",
        inputTokens: 321,
        outputTokens: 45,
      },
      new Date("2030-08-24T00:01:00.000Z"),
    )).toEqual({ status: "completed" });

    const adopted = await publisher.plan(input, options(reserve));
    expect(adopted).toEqual({
      ok: true,
      value: JSON.parse(output),
      raw: output,
      metadata: {
        provider: "codex",
        pass: "planner",
        model: OPENAI_PATTERN_PLANNER_MODEL,
        prompt_version: OPENAI_PATTERN_PLANNER_PROMPT_VERSION,
        provider_request_id: "thread_codex_pattern_1",
        input_tokens: 321,
        output_tokens: 45,
        provider_response_hash: response.artifact.plaintextHash,
      },
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("adopts a closed provider failure without creating another job", async () => {
    const publisher = createCodexPatternPublisher(env);
    const input = { packet: "failure fixture" };
    const pending = await publisher.plan(input, options());
    if (pending.ok || pending.code !== "publisher_pending") {
      throw new Error("pending job missing");
    }
    const claimed = await claimCodexProviderJob(env, NOW);
    if (claimed.status !== "claimed") throw new Error("claim missing");
    await failCodexProviderJob(
      env,
      {
        jobId: claimed.job.id,
        leaseToken: claimed.leaseToken,
        code: "publisher_unavailable",
        safeDetailCode: "request_timeout",
      },
      new Date("2030-08-24T00:01:00.000Z"),
    );

    expect(await publisher.plan(input, options())).toEqual({
      ok: false,
      code: "publisher_unavailable",
      safe_detail_code: "request_timeout",
      retry_after_seconds: null,
      origin_layer: "none",
    });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM codex_provider_jobs",
    ).first()).toEqual({ count: 1 });
  });
});
