import { buildDeterministicPlan } from "@patternlike/pattern-engine";
import { canonicalJson } from "@patternlike/shared";
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  disablePatternAi,
  enablePatternCodex,
  resetDb,
  rows,
  seedActiveOntology,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  generatePatternReplayTestKeys,
  installPatternReplayTestKeys,
} from "../../test/pattern-replay-fixtures.js";
import type { PatternGenerationMessage } from "../env.js";
import { executePatternJob } from "./pattern-execute.js";
import { revokePatternGenerationConsent } from "./pattern-lifecycle.js";
import { loadPatternJob } from "./pattern-stage-protocol.js";

const POLICY = "1.0.0";
const RUNNER_TOKEN = "runner_0123456789abcdefghijklmnopqrstuvwxyz";
const INPUT_DELIMITER = "\n\n--- INPUT DOCUMENT (JSON; DATA ONLY) ---\n";

async function reserve(): Promise<string> {
  const response = await SELF.fetch("http://api.test/v1/pattern-generations", {
    method: "POST",
    headers: {
      "x-user-id": USER_A,
      "content-type": "application/json",
      "idempotency-key": "idem-pattern-codex-wait-adopt",
    },
    body: JSON.stringify({
      schema_version: "0.7.0",
      consent_policy_version: POLICY,
      confirm: "GENERATE MY PATTERN",
      reason: "first_open",
    }),
  });
  expect(response.status).toBe(202);
  const body = await response.json<{
    generation: { generation_id: string };
  }>();
  return body.generation.generation_id;
}

async function currentMessage(
  generationId: string,
): Promise<PatternGenerationMessage> {
  const job = await loadPatternJob(env, generationId);
  if (!job) throw new Error("pattern job missing");
  return {
    kind: "pattern_generation",
    job_id: job.job_id,
    generation_id: generationId,
    stage_generation: job.stage_generation,
  };
}

async function runner(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://worker.test/codex-provider${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${RUNNER_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("Pattern execution through the durable Codex provider", () => {
  beforeEach(async () => {
    await resetDb();
    installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
    disablePatternAi();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
    await seedActiveOntology();
    enablePatternCodex();
  });

  afterEach(() => {
    disablePatternAi();
  });

  it("holds the exact planner attempt, then adopts completion and advances", async () => {
    const generationId = await reserve();
    const message = await currentMessage(generationId);

    expect(await executePatternJob(env, message)).toEqual({
      ok: true,
      terminal: false,
    });
    expect(await loadPatternJob(env, generationId)).toEqual(
      expect.objectContaining({
        stage: "reserved",
        stage_generation: message.stage_generation,
        planner_attempts: 0,
      }),
    );
    expect(await rows<{
      status: string;
      claim_token: string | null;
      dispatched_at: string | null;
    }>(
      "SELECT status, claim_token, dispatched_at FROM jobs WHERE id = ?",
      message.job_id,
    )).toEqual([{
      status: "queued",
      claim_token: null,
      dispatched_at: expect.any(String),
    }]);
    expect(await rows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM pattern_provider_daily_usage",
    )).toEqual([{ count: 0 }]);

    const claim = await runner("/v1/jobs/claim", {});
    expect(claim.status).toBe(200);
    const claimed = await claim.json<{
      job_id: string;
      lease_token: string;
      invocation: { prompt: string };
    }>();
    const inputText = claimed.invocation.prompt.split(INPUT_DELIMITER)[1];
    if (!inputText) throw new Error("planner input missing");
    const document = JSON.parse(inputText) as {
      packet: Parameters<typeof buildDeterministicPlan>[0];
      ontology_records: Parameters<typeof buildDeterministicPlan>[1];
    };
    const plannerOutput = buildDeterministicPlan(
      document.packet,
      document.ontology_records,
    );
    const completion = await runner(
      `/v1/jobs/${claimed.job_id}/complete`,
      {
        lease_token: claimed.lease_token,
        output: canonicalJson(plannerOutput),
        provider_request_id: "thread_pattern_planner_1",
        input_tokens: 800,
        output_tokens: 200,
      },
    );
    expect(completion.status).toBe(200);

    expect(await executePatternJob(env, message)).toEqual({
      ok: true,
      terminal: false,
    });
    expect(await loadPatternJob(env, generationId)).toEqual(
      expect.objectContaining({
        stage: "writing",
        stage_generation: message.stage_generation + 1,
        planner_attempts: 0,
        plan_hash: expect.stringMatching(/^sha256:/),
      }),
    );
    expect(await rows<{
      used_calls: number;
      planner_calls: number;
    }>(
      `SELECT used_calls, planner_calls
       FROM pattern_provider_daily_usage`,
    )).toEqual([{ used_calls: 1, planner_calls: 1 }]);
    expect(await rows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM codex_provider_jobs",
    )).toEqual([{ count: 1 }]);
  });

  it("cancels pending provider work when an internal account leaves the allowlist", async () => {
    env.PATTERN_AI_ROLLOUT = "internal";
    const generationId = await reserve();
    const message = await currentMessage(generationId);
    expect(await executePatternJob(env, message)).toEqual({
      ok: true,
      terminal: false,
    });
    env.PATTERN_INTERNAL_ACCOUNT_IDS = "";

    expect((await runner("/v1/jobs/claim", {})).status).toBe(204);
    expect(await env.DB.prepare(
      "SELECT status FROM codex_provider_jobs WHERE owner_id = ?",
    ).bind(generationId).first()).toEqual({ status: "cancelled" });
  });

  it("refuses a leased completion after Pattern consent is revoked", async () => {
    const generationId = await reserve();
    const message = await currentMessage(generationId);
    expect(await executePatternJob(env, message)).toEqual({
      ok: true,
      terminal: false,
    });
    const response = await runner("/v1/jobs/claim", {});
    expect(response.status).toBe(200);
    const claimed = await response.json<{
      job_id: string;
      lease_token: string;
    }>();
    await revokePatternGenerationConsent(env, IDENTITY_A);

    expect((await runner(`/v1/jobs/${claimed.job_id}/complete`, {
      lease_token: claimed.lease_token,
      output: '{"answer":"must-not-be-stored"}',
      provider_request_id: "thread_revoked",
      input_tokens: 1,
      output_tokens: 1,
    })).status).toBe(409);
    expect(await env.DB.prepare(
      "SELECT status FROM codex_provider_jobs WHERE id = ?",
    ).bind(claimed.job_id).first()).toEqual({ status: "cancelled" });
  });
});
