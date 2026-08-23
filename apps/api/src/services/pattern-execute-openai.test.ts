import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  SELF,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PatternPlan, PatternWriterOutput } from "@patternlike/shared";

import type { PatternGenerationMessage } from "../env.js";
import worker from "../index.js";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  disablePatternAi,
  enablePatternOpenAi,
  resetDb,
  seedActiveOntology,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  OPENAI_MOCK_PATTERN_INJECTED_DRIFT_KEY,
  OPENAI_MOCK_REFUSAL,
  OPENAI_MOCK_TIMEOUT,
} from "../../test/mock-calc-service.js";
import {
  generatePatternReplayTestKeys,
  installPatternReplayTestKeys,
} from "../../test/pattern-replay-fixtures.js";
import { getArtifactAt } from "./pattern-execute.js";
import { loadPatternJob } from "./pattern-stage-protocol.js";

const POLICY = "1.0.0";
const QUEUE = "patternlike-pattern-generation-dev";
const ADVANCE_FAILURE_TRIGGER = "fail_pattern_advance_integration";
const PRIVATE_TIMEOUT_ERROR = "PRIVATE_PATTERN_TIMEOUT_PROVIDER_ERROR";
const INJECTED_DRIFT_PREFIX = "Assigned feature";

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

interface FailureRow {
  job_status: string;
  result_class: string | null;
  stage: string;
  public_failure_stage: string | null;
  failure_class: string | null;
  claim_status: string;
}

let messageSequence = 0;

async function json(path: string, init: RequestInit = {}): Promise<JsonResponse> {
  const response = await SELF.fetch(`http://api.test${path}`, {
    ...init,
    headers: {
      "x-user-id": USER_A,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function reserve(idempotencyKey: string): Promise<string> {
  const response = await json("/v1/pattern-generations", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify({
      schema_version: "0.7.0",
      consent_policy_version: POLICY,
      confirm: "GENERATE MY PATTERN",
      reason: "first_open",
    }),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  return (response.body.generation as { generation_id: string }).generation_id;
}

async function currentMessage(generationId: string): Promise<PatternGenerationMessage> {
  const job = await loadPatternJob(env, generationId);
  if (!job) throw new Error("pattern job missing");
  return {
    kind: "pattern_generation",
    job_id: job.job_id,
    generation_id: generationId,
    stage_generation: job.stage_generation,
  };
}

/** Drive the exported Worker queue boundary exactly as workerd does. */
async function deliver(message: PatternGenerationMessage, attempts = 1) {
  messageSequence += 1;
  const batch = createMessageBatch<PatternGenerationMessage>(QUEUE, [
    {
      id: `msg-pattern-openai-${messageSequence}`,
      timestamp: new Date(0),
      attempts,
      body: message,
    },
  ]);
  const context = createExecutionContext();
  await worker.queue(batch, env);
  return getQueueResult(batch, context);
}

async function clearBackoff(generationId: string): Promise<void> {
  const job = await loadPatternJob(env, generationId);
  if (!job) throw new Error("pattern job missing");
  await env.DB.prepare("UPDATE jobs SET available_at = NULL WHERE id = ?")
    .bind(job.job_id)
    .run();
}

async function failureRow(generationId: string): Promise<FailureRow | null> {
  return env.DB.prepare(
    `SELECT j.status AS job_status, j.result_class,
            p.stage, p.public_failure_stage, p.failure_class,
            c.status AS claim_status
     FROM pattern_generation_jobs p
     JOIN jobs j ON j.id = p.job_id
     JOIN pattern_generation_claims c ON c.id = p.claim_id
     WHERE p.generation_id = ?`,
  )
    .bind(generationId)
    .first<FailureRow>();
}

async function providerUsage(): Promise<{
  used_calls: number;
  planner_calls: number;
  writer_calls: number;
  verifier_calls: number;
} | null> {
  return env.DB.prepare(
    `SELECT used_calls, planner_calls, writer_calls, verifier_calls
     FROM pattern_provider_daily_usage`,
  ).first<{
    used_calls: number;
    planner_calls: number;
    writer_calls: number;
    verifier_calls: number;
  }>();
}

async function assertPublicFailure(
  generationId: string,
  publicStage: "organizing_evidence" | "writing" | "checking_claims",
  internalFailureClass: string,
  options: {
    forbiddenProviderProse?: readonly string[];
    retryable?: boolean;
  } = {},
): Promise<void> {
  const retryable = options.retryable ?? true;
  const status = await json(`/v1/pattern-generations/${generationId}`);
  expect(status.status, JSON.stringify(status.body)).toBe(200);
  expect(status.body).toEqual({
    schema_version: "0.7.0",
    generation_id: generationId,
    stage: publicStage,
    status_updated_at: expect.any(String),
    started_at: expect.any(String),
    retryable,
    finished_at: expect.any(String),
  });

  const state = await json("/v1/pattern-state");
  expect(state.status).toBe(200);
  expect(state.body).toEqual(
    expect.objectContaining({
      state: "failed",
      generation: expect.objectContaining({
        generation_id: generationId,
        stage: publicStage,
        retryable,
      }),
      pattern: null,
    }),
  );

  const pattern = await json("/v1/pattern");
  expect(pattern.status).toBe(409);
  expect(pattern.body).toEqual({
    error: {
      code: "pattern_generation_failed",
      message: "The last Pattern generation did not finish",
      request_id: expect.any(String),
      details: {
        retryable,
        stage: publicStage,
      },
    },
  });

  const publicBytes = JSON.stringify([status.body, state.body, pattern.body]);
  expect(publicBytes).not.toContain(internalFailureClass);
  expect(publicBytes).not.toContain("failure_class");
  for (const prose of options.forbiddenProviderProse ?? []) {
    expect(publicBytes).not.toContain(prose);
  }
}

describe("OpenAI Pattern queue integration", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DROP TRIGGER IF EXISTS ${ADVANCE_FAILURE_TRIGGER}`).run();
    await resetDb();
    installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
    disablePatternAi();
    messageSequence = 0;
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
  });

  afterEach(async () => {
    await env.DB.prepare(`DROP TRIGGER IF EXISTS ${ADVANCE_FAILURE_TRIGGER}`).run();
    disablePatternAi();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("publishes once across duplicate delivery, an expired lease, and a failed D1 advance", async () => {
    enablePatternOpenAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-openai-pattern-idempotent-publication");
    const initial = await currentMessage(generationId);

    await env.DB.prepare(
      `CREATE TRIGGER ${ADVANCE_FAILURE_TRIGGER}
       BEFORE UPDATE OF stage ON pattern_generation_jobs
       WHEN NEW.stage = 'writing'
       BEGIN
         SELECT RAISE(ABORT, 'injected Pattern advance failure');
       END`,
    ).run();

    const providerSucceeded = await deliver(initial);
    expect(providerSucceeded.retryMessages).toEqual([]);
    expect(await providerUsage()).toEqual({
      used_calls: 1,
      planner_calls: 1,
      writer_calls: 0,
      verifier_calls: 0,
    });
    const stranded = await loadPatternJob(env, generationId);
    expect(stranded).toEqual(
      expect.objectContaining({
        stage: "reserved",
        stage_generation: initial.stage_generation,
        planner_attempts: 0,
        plan_hash: null,
      }),
    );
    expect(
      await getArtifactAt(
        env,
        IDENTITY_A,
        generationId,
        "planner_response",
        initial.stage_generation,
        0,
      ),
    ).not.toBeNull();

    // A duplicate while the first claim still owns a live lease is bounded and
    // cannot purchase another provider answer.
    const liveLeaseDuplicate = await deliver(initial);
    expect(liveLeaseDuplicate.retryMessages).toEqual([]);
    expect((await providerUsage())?.used_calls).toBe(1);

    await env.DB.prepare(`DROP TRIGGER ${ADVANCE_FAILURE_TRIGGER}`).run();
    await env.DB.prepare(
      `UPDATE jobs SET lease_expires_at = '1970-01-01T00:00:00.000Z'
       WHERE id = ? AND status = 'running'`,
    )
      .bind(stranded!.job_id)
      .run();

    // The expired-lease recovery adopts attempt zero's stored response and
    // advances without a second planner call.
    const recovered = await deliver(initial);
    expect(recovered.retryMessages).toEqual([]);
    expect(await loadPatternJob(env, generationId)).toEqual(
      expect.objectContaining({
        stage: "writing",
        stage_generation: initial.stage_generation + 1,
        planner_attempts: 0,
      }),
    );
    expect((await providerUsage())?.used_calls).toBe(1);

    const stalePlanner = await deliver(initial);
    expect(stalePlanner.retryMessages).toEqual([]);
    expect((await providerUsage())?.used_calls).toBe(1);

    const writerMessage = await currentMessage(generationId);
    const wrote = await deliver(writerMessage);
    expect(wrote.retryMessages).toEqual([]);
    expect((await providerUsage())?.used_calls).toBe(2);

    const staleWriter = await deliver(writerMessage);
    expect(staleWriter.retryMessages).toEqual([]);
    expect((await providerUsage())?.used_calls).toBe(2);

    const verifierMessage = await currentMessage(generationId);
    const published = await deliver(verifierMessage);
    expect(published.retryMessages).toEqual([]);
    expect(await loadPatternJob(env, generationId)).toEqual(
      expect.objectContaining({ stage: "succeeded" }),
    );

    const staleVerifier = await deliver(verifierMessage);
    expect(staleVerifier.retryMessages).toEqual([]);
    expect(await providerUsage()).toEqual({
      used_calls: 3,
      planner_calls: 1,
      writer_calls: 1,
      verifier_calls: 1,
    });

    const documents = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_documents
       WHERE user_id = ? AND generation_id = ?`,
    )
      .bind(USER_A, generationId)
      .first<{ n: number }>();
    expect(documents?.n).toBe(1);
    const accepted = await env.DB.prepare(
      `SELECT status, active_generation_id, consumed_at, accepted_at
       FROM pattern_generation_claims WHERE user_id = ?`,
    )
      .bind(USER_A)
      .first<{
        status: string;
        active_generation_id: string | null;
        consumed_at: string | null;
        accepted_at: string | null;
      }>();
    expect(accepted).toEqual({
      status: "accepted",
      active_generation_id: null,
      consumed_at: expect.any(String),
      accepted_at: expect.any(String),
    });

    const state = await json("/v1/pattern-state");
    expect(state.body).toEqual(
      expect.objectContaining({ state: "ready", generation: null }),
    );
  });

  it("rejects a genuinely drifted candidate because the verifier receives the full frozen plan", async () => {
    enablePatternOpenAi();
    env.OPENAI_API_KEY = OPENAI_MOCK_PATTERN_INJECTED_DRIFT_KEY;
    await seedActiveOntology();
    const generationId = await reserve("idem-openai-pattern-injected-drift");

    const plannerMessage = await currentMessage(generationId);
    expect((await deliver(plannerMessage)).retryMessages).toEqual([]);
    const planArtifact = await getArtifactAt<PatternPlan>(
      env,
      IDENTITY_A,
      generationId,
      "validated_plan",
      plannerMessage.stage_generation,
      0,
    );
    expect(planArtifact).not.toBeNull();
    const plan = planArtifact!.value;
    expect(plan.chapters.length).toBeGreaterThanOrEqual(2);

    const writerMessage = await currentMessage(generationId);
    expect((await deliver(writerMessage)).retryMessages).toEqual([]);
    const candidateArtifact = await getArtifactAt<PatternWriterOutput>(
      env,
      IDENTITY_A,
      generationId,
      "writer_response",
      writerMessage.stage_generation,
      0,
    );
    expect(candidateArtifact).not.toBeNull();
    const candidate = candidateArtifact!.value;
    const firstPlanChapter = plan.chapters[0]!;
    const foreignAlias = plan.chapters
      .slice(1)
      .flatMap((chapter) => chapter.feature_aliases)
      .find((alias) => !firstPlanChapter.feature_aliases.includes(alias));
    expect(foreignAlias).toEqual(expect.any(String));
    const driftedSection = candidate.chapters[0]!.sections[0]!;
    expect(driftedSection.text).toContain(
      `${INJECTED_DRIFT_PREFIX} ${foreignAlias}`,
    );
    // The machine ledger still cites only the first chapter's assignment, so
    // deterministic validation accepts the shape and the semantic verifier is
    // the component that must catch what the prose actually claims.
    expect(driftedSection.feature_aliases).toEqual(firstPlanChapter.feature_aliases);

    const verifierMessage = await currentMessage(generationId);
    expect((await deliver(verifierMessage)).retryMessages).toEqual([]);
    const verifierRequest = await getArtifactAt<{
      candidate: PatternWriterOutput;
      plan: PatternPlan;
    }>(
      env,
      IDENTITY_A,
      generationId,
      "verifier_request",
      verifierMessage.stage_generation,
      0,
    );
    expect(verifierRequest).not.toBeNull();
    expect(verifierRequest!.value.plan).toEqual(plan);
    expect(verifierRequest!.value.candidate).toEqual(candidate);

    const returned = await loadPatternJob(env, generationId);
    expect(returned).toEqual(
      expect.objectContaining({
        stage: "writing",
        writer_attempts: 1,
        verifier_attempts: 0,
      }),
    );
    expect(await providerUsage()).toEqual({
      used_calls: 3,
      planner_calls: 1,
      writer_calls: 1,
      verifier_calls: 1,
    });
    const documents = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM pattern_documents WHERE generation_id = ?",
    )
      .bind(generationId)
      .first<{ n: number }>();
    expect(documents?.n).toBe(0);

    const correction = await getArtifactAt<{
      schema_version: string;
      attempt: number;
      items: unknown[];
      preserve: Record<string, unknown>;
    }>(
      env,
      IDENTITY_A,
      generationId,
      "correction_document",
      returned!.stage_generation,
      1,
    );
    expect(correction?.value).toEqual({
      schema_version: "0.7.0",
      attempt: 1,
      items: [
        {
          code: "claim_not_entailed",
          origin: "semantic",
          target_key: driftedSection.section_key,
          feature_aliases: [],
          ontology_rule_ids: [],
        },
      ],
      preserve: {
        plan_hash: plan.plan_hash,
        chapter_keys: plan.chapters.map((chapter) => chapter.chapter_key),
        signature_keys: plan.additional_signatures.map((signature) => signature.signature_key),
        omitted_feature_aliases: plan.omissions.map((omission) => omission.feature_alias),
        authorized_ontology_rule_ids: [
          ...new Set([
            ...plan.chapters.flatMap((chapter) => chapter.ontology_rule_ids),
            ...plan.additional_signatures.flatMap((signature) => signature.ontology_rule_ids),
          ]),
        ],
      },
    });
    expect(JSON.stringify(correction?.value)).not.toContain(INJECTED_DRIFT_PREFIX);
    expect(JSON.stringify(correction?.value)).not.toContain("rationale");
  });

  it("fails closed after bounded planner timeouts without exposing provider prose", async () => {
    enablePatternOpenAi();
    env.OPENAI_API_KEY = OPENAI_MOCK_TIMEOUT;
    await seedActiveOntology();
    const generationId = await reserve("idem-openai-pattern-timeout");
    const logs = [
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];

    const first = await deliver(await currentMessage(generationId));
    expect(first.retryMessages).toEqual([]);
    expect(await loadPatternJob(env, generationId)).toEqual(
      expect.objectContaining({ stage: "reserved", planner_attempts: 1 }),
    );

    await clearBackoff(generationId);
    const second = await deliver(await currentMessage(generationId));
    expect(second.retryMessages).toEqual([]);
    expect(await failureRow(generationId)).toEqual({
      job_status: "failed",
      result_class: "publisher_unavailable",
      stage: "failed",
      public_failure_stage: "organizing_evidence",
      failure_class: "publisher_unavailable",
      claim_status: "available",
    });

    await assertPublicFailure(
      generationId,
      "organizing_evidence",
      "publisher_unavailable",
      { forbiddenProviderProse: [PRIVATE_TIMEOUT_ERROR] },
    );
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(
      PRIVATE_TIMEOUT_ERROR,
    );
  });

  it("fails closed on a provider refusal without exposing refusal prose", async () => {
    enablePatternOpenAi();
    env.OPENAI_API_KEY = OPENAI_MOCK_REFUSAL;
    await seedActiveOntology();
    const generationId = await reserve("idem-openai-pattern-refusal");
    const logs = [
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];

    const delivery = await deliver(await currentMessage(generationId));
    expect(delivery.retryMessages).toEqual([]);
    expect(await failureRow(generationId)).toEqual({
      job_status: "failed",
      result_class: "publisher_refused",
      stage: "failed",
      public_failure_stage: "organizing_evidence",
      failure_class: "publisher_refused",
      claim_status: "available",
    });

    const refusalProse = "I cannot help with that.";
    await assertPublicFailure(
      generationId,
      "organizing_evidence",
      "publisher_refused",
      { forbiddenProviderProse: [refusalProse] },
    );
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(
      refusalProse,
    );

    // The column is plain TEXT. Even if it is corrupted with provider prose,
    // the public error may project only a member of the frozen stage enum.
    await env.DB.prepare(
      `UPDATE pattern_generation_jobs SET public_failure_stage = ?
       WHERE generation_id = ?`,
    )
      .bind(refusalProse, generationId)
      .run();
    const corruptedStatus = await json(
      `/v1/pattern-generations/${generationId}`,
    );
    expect(corruptedStatus.status).toBe(404);
    expect(corruptedStatus.body).toEqual({
      error: {
        code: "not_found",
        message: "Generation not found",
        request_id: expect.any(String),
      },
    });
    const corruptedState = await json("/v1/pattern-state");
    expect(corruptedState.status).toBe(200);
    expect(corruptedState.body).toEqual(
      expect.objectContaining({
        state: "failed",
        generation: expect.objectContaining({
          generation_id: generationId,
          stage: "organizing_evidence",
          retryable: true,
        }),
        pattern: null,
      }),
    );
    const corrupted = await json("/v1/pattern");
    expect(corrupted.status).toBe(409);
    expect(corrupted.body).toEqual({
      error: {
        code: "pattern_generation_failed",
        message: "The last Pattern generation did not finish",
        request_id: expect.any(String),
        details: { retryable: true },
      },
    });
    expect(JSON.stringify(corruptedStatus.body)).not.toContain(refusalProse);
    expect(JSON.stringify(corruptedState.body)).not.toContain(refusalProse);
    expect(JSON.stringify(corrupted.body)).not.toContain(refusalProse);
  });

  it("fails closed without a provider call when the UTC-day budget is exhausted", async () => {
    enablePatternOpenAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-openai-pattern-daily-budget");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO pattern_provider_daily_usage
         (utc_date, used_calls, planner_calls, writer_calls, verifier_calls, created_at, updated_at)
       VALUES (?, 100, 0, 0, 0, ?, ?)`,
    )
      .bind(now.slice(0, 10), now, now)
      .run();

    const delivery = await deliver(await currentMessage(generationId));
    expect(delivery.retryMessages).toEqual([]);
    expect(await failureRow(generationId)).toEqual({
      job_status: "failed",
      result_class: "publisher_budget_exhausted",
      stage: "failed",
      public_failure_stage: "organizing_evidence",
      failure_class: "publisher_budget_exhausted",
      claim_status: "available",
    });
    expect(await providerUsage()).toEqual({
      used_calls: 100,
      planner_calls: 0,
      writer_calls: 0,
      verifier_calls: 0,
    });
    await assertPublicFailure(
      generationId,
      "organizing_evidence",
      "publisher_budget_exhausted",
      { retryable: false },
    );

    // The failed-job timestamp is not the budget ledger. Backdating it cannot
    // advertise a retry while the current UTC day's shared budget is full.
    await env.DB.prepare(
      `UPDATE pattern_generation_jobs
       SET finished_at = '1970-01-01T00:00:00.000Z'
       WHERE generation_id = ?`,
    )
      .bind(generationId)
      .run();
    await assertPublicFailure(
      generationId,
      "organizing_evidence",
      "publisher_budget_exhausted",
      { retryable: false },
    );

    // Capacity is authoritative for the current date. Tomorrow initially has
    // no row, then becomes non-retryable as soon as its shared ledger is full.
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(tomorrow);
    await assertPublicFailure(
      generationId,
      "organizing_evidence",
      "publisher_budget_exhausted",
      { retryable: true },
    );
    const tomorrowIso = tomorrow.toISOString();
    await env.DB.prepare(
      `INSERT INTO pattern_provider_daily_usage
         (utc_date, used_calls, planner_calls, writer_calls, verifier_calls, created_at, updated_at)
       VALUES (?, 100, 0, 0, 0, ?, ?)`,
    )
      .bind(tomorrowIso.slice(0, 10), tomorrowIso, tomorrowIso)
      .run();
    await assertPublicFailure(
      generationId,
      "organizing_evidence",
      "publisher_budget_exhausted",
      { retryable: false },
    );
  });

  it("fails at checking claims without another call when verifier attempts are exhausted", async () => {
    enablePatternOpenAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-openai-pattern-verifier-attempts");

    for (let step = 0; step < 2; step += 1) {
      const delivery = await deliver(await currentMessage(generationId));
      expect(delivery.retryMessages).toEqual([]);
    }
    expect(await loadPatternJob(env, generationId)).toEqual(
      expect.objectContaining({
        stage: "semantic_verifying",
        planner_attempts: 0,
        writer_attempts: 0,
        verifier_attempts: 0,
      }),
    );
    expect(await providerUsage()).toEqual({
      used_calls: 2,
      planner_calls: 1,
      writer_calls: 1,
      verifier_calls: 0,
    });

    await env.DB.prepare(
      "UPDATE pattern_generation_jobs SET verifier_attempts = 2 WHERE generation_id = ?",
    )
      .bind(generationId)
      .run();
    const delivery = await deliver(await currentMessage(generationId));
    expect(delivery.retryMessages).toEqual([]);
    expect(await failureRow(generationId)).toEqual({
      job_status: "failed",
      result_class: "verifier_attempts_exhausted",
      stage: "failed",
      public_failure_stage: "checking_claims",
      failure_class: "verifier_attempts_exhausted",
      claim_status: "available",
    });
    expect(await providerUsage()).toEqual({
      used_calls: 2,
      planner_calls: 1,
      writer_calls: 1,
      verifier_calls: 0,
    });
    await assertPublicFailure(
      generationId,
      "checking_claims",
      "verifier_attempts_exhausted",
    );
  });
});
