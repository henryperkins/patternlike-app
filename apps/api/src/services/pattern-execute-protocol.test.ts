/**
 * The Task 6 stage protocol: artifact-first, attempt-scoped, conflict-fatal.
 *
 * These drive `executePatternJob` directly rather than through the queue, for
 * the same reason the M7 integration suite does: a delivery is the unit under
 * test, and the queue would hide which delivery did what.
 *
 * Budget is the fetch counter. `consumePatternProviderCallBudget` is charged
 * immediately before each provider call and never refunded, so
 * `pattern_provider_daily_usage.used_calls` counts provider calls exactly --
 * which is the quantity every one of these assertions is actually about.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env, SELF } from "cloudflare:test";
import { contentHash } from "@patternlike/shared";

import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  disablePatternAi,
  enablePatternAi,
  enablePatternOpenAi,
  resetDb,
  seedActiveOntology,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import { OPENAI_MOCK_PATTERN_PLAN_INVALID_KEY } from "../../test/mock-calc-service.js";
import { findSemanticVerdictProblem } from "./pattern-semantic.js";
import {
  executePatternJob,
  getArtifactAt,
  loadPatternJob,
  patternArtifactId,
  retryStage,
} from "./pattern-execute.js";

const POLICY = "1.0.0";

async function json(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await SELF.fetch(`http://api.test${path}`, {
    ...init,
    headers: {
      "x-user-id": USER_A,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** Reserve one generation and return its id. */
async function reserve(key: string): Promise<string> {
  const response = await json("/v1/pattern-generations", {
    method: "POST",
    headers: { "idempotency-key": key },
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

/** Deliver the message the durable row currently names. */
async function deliver(generationId: string) {
  const job = await loadPatternJob(env, generationId);
  if (!job) throw new Error("pattern job missing");
  return executePatternJob(env, {
    kind: "pattern_generation",
    job_id: job.job_id,
    generation_id: generationId,
    stage_generation: job.stage_generation,
  });
}

async function providerCalls(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(used_calls), 0) AS n FROM pattern_provider_daily_usage`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

async function stageOf(generationId: string): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT stage FROM pattern_generation_jobs WHERE generation_id = ?`,
  )
    .bind(generationId)
    .first<{ stage: string }>();
  return row?.stage ?? "missing";
}

describe("Pattern stage protocol", () => {
  beforeEach(async () => {
    await resetDb();
    disablePatternAi();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
  });

  afterEach(() => {
    disablePatternAi();
    vi.restoreAllMocks();
  });

  it("reaches the OpenAI adapter instead of failing closed on a non-synthetic pin", async () => {
    enablePatternOpenAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-openai-reached");
    const job = await loadPatternJob(env, generationId);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const outcome = await deliver(generationId);

    // Before Task 6 an `openai` pin failed `publisher_unavailable` before a
    // request was ever built. Three independent traces show the adapter ran.
    expect(outcome).toEqual({ ok: true, terminal: false });
    expect(await stageOf(generationId)).toBe("writing");
    // Charged immediately before the fetch, so this counts the fetch.
    expect(await providerCalls()).toBe(1);
    // Steps 5 and 6: the exact bytes sent, committed before the call.
    const request = await getArtifactAt(
      env,
      IDENTITY_A,
      generationId,
      "planner_request",
      job!.stage_generation,
      0,
    );
    expect(request).not.toBeNull();
    expect(info).toHaveBeenCalledWith(
      "pattern_publisher_call_completed",
      expect.objectContaining({
        provider: "openai",
        pass: "planner",
        model: "gpt-5.6-sol",
        prompt_version: "1.0.0",
      }),
    );
  });

  it("fails closed when OpenAI returns a schema-valid plan the packet cannot support", async () => {
    enablePatternOpenAi();
    env.OPENAI_API_KEY = OPENAI_MOCK_PATTERN_PLAN_INVALID_KEY;
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-openai-plan-invalid");

    expect(await deliver(generationId)).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "plan_invalid",
    });
    expect(await stageOf(generationId)).toBe("failed");
    expect(await providerCalls()).toBe(1);
  });

  it("logs a closed failed-attempt event with its pass and durable attempt", async () => {
    enablePatternOpenAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-openai-budget-log");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO pattern_provider_daily_usage (utc_date, used_calls, created_at, updated_at)
       VALUES (?, 100, ?, ?)`,
    )
      .bind(now.slice(0, 10), now, now)
      .run();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await deliver(generationId)).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "publisher_budget_exhausted",
    });
    expect(warn).toHaveBeenCalledWith(
      "pattern_publisher_attempt_failed",
      expect.objectContaining({
        provider: "openai",
        pass: "planner",
        attempt: 0,
        failure_class: "publisher_budget_exhausted",
        safe_detail_code: "daily_call_limit_reached",
      }),
    );
  });

  it("still produces the deterministic document under a synthetic pin", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-synthetic");

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    expect(await stageOf(generationId)).toBe("writing");
    // The ledger counts provider calls, and a stand-in is not a provider.
    expect(await providerCalls()).toBe(0);
  });

  it("keeps the frozen synthetic author and stores honest provenance after a live pin change", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-frozen-synthetic-provenance");

    // The command froze the synthetic publisher. Changing live configuration
    // while the job is in flight must not silently replace its author.
    enablePatternOpenAi();
    for (const expectedStage of ["writing", "semantic_verifying", "succeeded"]) {
      expect(await deliver(generationId)).toEqual({ ok: true, terminal: expectedStage === "succeeded" });
      expect(await stageOf(generationId)).toBe(expectedStage);
    }

    const stored = await env.DB.prepare(
      `SELECT compact_provenance_json FROM pattern_documents WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ compact_provenance_json: string }>();
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!.compact_provenance_json)).toEqual(
      expect.objectContaining({
        provider: "synthetic",
        model_family: "synthetic",
      }),
    );
    expect(await providerCalls()).toBe(0);
  });

  it("stores OpenAI writer provenance from the frozen pin that ran", async () => {
    enablePatternOpenAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-openai-provenance");

    for (const expectedStage of ["writing", "semantic_verifying", "succeeded"]) {
      expect(await deliver(generationId)).toEqual({ ok: true, terminal: expectedStage === "succeeded" });
      expect(await stageOf(generationId)).toBe(expectedStage);
    }

    const stored = await env.DB.prepare(
      `SELECT compact_provenance_json FROM pattern_documents WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ compact_provenance_json: string }>();
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!.compact_provenance_json)).toEqual(
      expect.objectContaining({
        provider: "OpenAI",
        model_family: "gpt",
      }),
    );
    expect(await providerCalls()).toBe(3);
    const usage = await env.DB.prepare(
      `SELECT used_calls, planner_calls, writer_calls, verifier_calls
       FROM pattern_provider_daily_usage`,
    ).first<{
      used_calls: number;
      planner_calls: number;
      writer_calls: number;
      verifier_calls: number;
    }>();
    expect(usage).toEqual({
      used_calls: 3,
      planner_calls: 1,
      writer_calls: 1,
      verifier_calls: 1,
    });
  });

  it("does not replace a frozen OpenAI author with the live synthetic publisher", async () => {
    enablePatternOpenAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-frozen-openai-author");

    // The live synthetic configuration has no provider credential. The frozen
    // OpenAI command must therefore fail closed rather than publish stand-in
    // prose under OpenAI provenance.
    enablePatternAi();
    expect(await deliver(generationId)).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "publisher_not_configured",
    });
    expect(await stageOf(generationId)).toBe("failed");
    const documents = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_documents WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ n: number }>();
    expect(documents?.n).toBe(0);
    expect(await providerCalls()).toBe(0);
  });

  it("spends no budget on a delivery whose ontology recheck fails", async () => {
    enablePatternOpenAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-ontology-recheck");

    // Recall the release the command froze. `eligibility` sees the active
    // pointer no longer resolves and the frozen version is recalled, and cancels
    // before the publisher is ever constructed.
    await env.DB.prepare(`UPDATE pattern_ontology_releases SET status = 'recalled'`).run();
    await env.DB.prepare(`UPDATE pattern_ontology_pointer SET active_version = NULL WHERE id = 1`).run();

    const outcome = await deliver(generationId);
    expect(outcome).toEqual({ ok: true, terminal: true });
    expect(await stageOf(generationId)).toBe("cancelled");
    expect(await providerCalls()).toBe(0);
  });

  it("adopts the stored response on a redelivery, spending no second call", async () => {
    // The planner pass runs once under the stand-in, which commits a
    // `planner_response` at (stage_generation, attempt 0). Before redelivery we
    // remove the request artifact. If the response probe misses, rerunning the
    // publisher must rebuild that request; adoption leaves it absent. This
    // keeps the assertion meaningful now that the frozen command pin wins over
    // a live publisher change.
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-adoption");

    const before = await loadPatternJob(env, generationId);
    expect(before).not.toBeNull();
    const stageGeneration = before!.stage_generation;

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    const advanced = await loadPatternJob(env, generationId);
    const firstPlanHash = advanced!.plan_hash;
    expect(firstPlanHash).toEqual(expect.any(String));

    // The hash advanced into D1 names bytes that exist in R2.
    const stored = await getArtifactAt<{ schema_version: string }>(
      env,
      IDENTITY_A,
      generationId,
      "planner_response",
      stageGeneration,
      0,
    );
    expect(stored).not.toBeNull();
    expect(stored!.plaintextHash).toBe(firstPlanHash);

    const requestRow = await env.DB.prepare(
      `SELECT object_key FROM pattern_generation_artifacts
       WHERE generation_id = ? AND artifact_class = 'planner_request'`,
    )
      .bind(generationId)
      .first<{ object_key: string }>();
    expect(requestRow).not.toBeNull();
    expect(env.ARTIFACTS).toBeDefined();
    await env.ARTIFACTS!.delete(requestRow!.object_key);
    await env.DB.prepare(
      `DELETE FROM pattern_generation_artifacts
       WHERE generation_id = ? AND artifact_class = 'planner_request'`,
    )
      .bind(generationId)
      .run();

    // Rewind exactly what a lost `advance` leaves behind: the artifact is on
    // disk, the durable row never moved.
    await env.DB.prepare(
      `UPDATE pattern_generation_jobs
       SET stage = 'planning', stage_generation = ?, plan_hash = NULL WHERE generation_id = ?`,
    )
      .bind(stageGeneration, generationId)
      .run();
    await env.DB.prepare(
      `UPDATE jobs SET status = 'queued', claim_token = NULL, lease_expires_at = NULL,
              dispatched_at = NULL WHERE id = ?`,
    )
      .bind(before!.job_id)
      .run();

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });

    // Same attempt index, no publisher rerun, and the same committed response
    // bytes named again.
    expect(await providerCalls()).toBe(0);
    expect(
      await getArtifactAt(
        env,
        IDENTITY_A,
        generationId,
        "planner_request",
        stageGeneration,
        0,
      ),
    ).toBeNull();
    const redelivered = await loadPatternJob(env, generationId);
    expect(redelivered!.plan_hash).toBe(firstPlanHash);
    expect(await stageOf(generationId)).toBe("writing");
  });

  it("writes a genuine retry at k+1 rather than colliding with attempt k", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-retry-k-plus-one");

    const job = await loadPatternJob(env, generationId);
    const stageGeneration = job!.stage_generation;

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    const atZero = await getArtifactAt(
      env,
      IDENTITY_A,
      generationId,
      "planner_response",
      stageGeneration,
      0,
    );
    expect(atZero).not.toBeNull();

    // Rewind and hand the same stage back through `retryStage`, which holds the
    // stage generation and moves the durable attempt index.
    await env.DB.prepare(
      `UPDATE pattern_generation_jobs
       SET stage = 'planning', stage_generation = ?, plan_hash = NULL WHERE generation_id = ?`,
    )
      .bind(stageGeneration, generationId)
      .run();
    await env.DB.prepare(
      `UPDATE jobs SET status = 'running', claim_token = 'clm_test_retry',
              lease_expires_at = ?, dispatched_at = NULL WHERE id = ?`,
    )
      .bind(new Date(Date.now() + 300_000).toISOString(), job!.job_id)
      .run();

    const rewound = await loadPatternJob(env, generationId);
    expect(await retryStage(env, rewound!, "clm_test_retry", "planner", null)).toBe(true);

    const retried = await loadPatternJob(env, generationId);
    expect(retried!.planner_attempts).toBe(1);
    expect(retried!.stage_generation).toBe(stageGeneration);
    expect(retried!.stage).toBe("planning");

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });

    const atOne = await getArtifactAt(
      env,
      IDENTITY_A,
      generationId,
      "planner_response",
      stageGeneration,
      1,
    );
    expect(atOne).not.toBeNull();
    // Two coordinates, two artifacts: the second attempt is allowed to differ
    // and the three-component identity would have discarded it.
    expect(await patternArtifactId(generationId, "planner_response", stageGeneration, 0)).not.toBe(
      await patternArtifactId(generationId, "planner_response", stageGeneration, 1),
    );
  });

  it("fails terminally rather than overwriting a reserved identity holding other bytes", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-identity-conflict");

    const job = await loadPatternJob(env, generationId);
    const artifactId = await patternArtifactId(
      generationId,
      "planner_request",
      job!.stage_generation,
      0,
    );
    const objectKey = `pattern-generations/${generationId}/${artifactId}.json.enc`;

    // Somebody else's bytes under the coordinate this delivery is about to
    // reserve. `head()` used to return silently here.
    await env.ARTIFACTS!.put(objectKey, new Uint8Array(64));
    await env.DB.prepare(
      `INSERT INTO pattern_generation_artifacts (
         id, generation_id, user_id, artifact_class, object_key, ciphertext_sha256,
         plaintext_sha256, byte_length, created_at, expires_at, deleted_at
       ) VALUES (?, ?, ?, 'planner_request', ?, ?, ?, 64, ?, ?, NULL)`,
    )
      .bind(
        artifactId,
        generationId,
        USER_A,
        objectKey,
        `sha256:${"ab".repeat(32)}`,
        `sha256:${"cd".repeat(32)}`,
        new Date().toISOString(),
        new Date(Date.now() + 86400_000).toISOString(),
      )
      .run();

    const outcome = await deliver(generationId);
    expect(outcome).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "execution_error",
    });
    expect(await stageOf(generationId)).toBe("failed");
  });

  it("fails terminally without a provider call when the pass attempt index is spent", async () => {
    enablePatternOpenAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-attempts-exhausted");

    await env.DB.prepare(
      `UPDATE pattern_generation_jobs SET planner_attempts = 2 WHERE generation_id = ?`,
    )
      .bind(generationId)
      .run();

    const outcome = await deliver(generationId);
    expect(outcome).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "planner_attempts_exhausted",
    });
    expect(await providerCalls()).toBe(0);
    expect(await stageOf(generationId)).toBe("failed");
  });

  it("refuses to verify a candidate the job row does not name", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-candidate-binding");

    // Planner, then writer. The job now sits at semantic_verifying with a
    // candidate_hash naming the committed writer_response.
    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    expect(await stageOf(generationId)).toBe("semantic_verifying");

    // `getArtifact` selects the NEWEST writer_response, which on a tie or a
    // second writer attempt need not be the one the writer stage advanced with.
    // The binding is what stops a different candidate reaching the verifier and
    // then publication.
    await env.DB.prepare(
      `UPDATE pattern_generation_jobs SET candidate_hash = ? WHERE generation_id = ?`,
    )
      .bind(`sha256:${"ef".repeat(32)}`, generationId)
      .run();

    expect(await deliver(generationId)).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "candidate_missing",
    });
    expect(await stageOf(generationId)).toBe("failed");
  });

  it("hashes the committed artifact bytes rather than the in-memory response", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-committed-bytes");
    const job = await loadPatternJob(env, generationId);

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });

    const advanced = await loadPatternJob(env, generationId);
    const row = await env.DB.prepare(
      `SELECT plaintext_sha256 FROM pattern_generation_artifacts
       WHERE generation_id = ? AND artifact_class = 'planner_response'`,
    )
      .bind(generationId)
      .first<{ plaintext_sha256: string }>();

    expect(advanced!.plan_hash).toBe(row?.plaintext_sha256);

    const stored = await getArtifactAt<unknown>(
      env,
      IDENTITY_A,
      generationId,
      "planner_response",
      job!.stage_generation,
      0,
    );
    expect(await contentHash(JSON.stringify(stored!.value))).toBe(advanced!.plan_hash);
  });
});

/**
 * The verdict is a model document now, so `verdict !== "pass"` is no longer a
 * sufficient read of it. These pin the three ways one can be unhonourable.
 */
describe("semantic verdict validation", () => {
  const finding = (over: Record<string, unknown> = {}) => ({
    code: "claim_not_entailed",
    severity: "error",
    target_key: null,
    feature_aliases: [],
    ontology_rule_ids: [],
    rationale: "",
    ...over,
  });

  it("accepts the shapes the contract and the closed vocabulary allow", () => {
    expect(
      findSemanticVerdictProblem({ schema_version: "0.7.0", verdict: "pass", findings: [] }),
    ).toBeNull();
    expect(
      findSemanticVerdictProblem({
        schema_version: "0.7.0",
        verdict: "reject",
        findings: [finding()],
      }),
    ).toBeNull();
    // A warning does not make a pass incoherent -- only an error does.
    expect(
      findSemanticVerdictProblem({
        schema_version: "0.7.0",
        verdict: "pass",
        findings: [finding({ severity: "warning" })],
      }),
    ).toBeNull();
  });

  it("refuses a pass that carries an error finding as incoherent", () => {
    expect(
      findSemanticVerdictProblem({
        schema_version: "0.7.0",
        verdict: "pass",
        findings: [finding()],
      }),
    ).toBe("verdict_incoherent");
  });

  it("refuses a code outside the closed vocabulary", () => {
    // Free-form in `contracts/m7` on purpose; the vocabulary is enforced here,
    // because the writer correction path cannot act on a code it has no rule for.
    expect(
      findSemanticVerdictProblem({
        schema_version: "0.7.0",
        verdict: "reject",
        findings: [finding({ code: "vibes_were_off" })],
      }),
    ).toBe("verdict_finding_code_unknown");
  });

  it.each([
    ["a body that is not an object", "not a verdict"],
    ["a missing verdict", { schema_version: "0.7.0", findings: [] }],
    ["pass_with_changes, which the contract has no member for", {
      schema_version: "0.7.0",
      verdict: "pass_with_changes",
      findings: [],
    }],
    ["a wrong schema version", { schema_version: "0.6.0", verdict: "pass", findings: [] }],
    ["findings that are not an array", { schema_version: "0.7.0", verdict: "pass", findings: {} }],
  ])("refuses %s", (_name, document) => {
    expect(findSemanticVerdictProblem(document)).toBe("verdict_shape_invalid");
  });

  it("refuses a finding whose required members are the wrong type", () => {
    for (const broken of [
      finding({ severity: "fatal" }),
      finding({ target_key: 7 }),
      finding({ feature_aliases: "alias_1" }),
      finding({ ontology_rule_ids: [1] }),
      finding({ rationale: "x".repeat(601) }),
      finding({ code: "" }),
    ]) {
      expect(
        findSemanticVerdictProblem({
          schema_version: "0.7.0",
          verdict: "reject",
          findings: [broken],
        }),
      ).toBe("verdict_shape_invalid");
    }
  });
});
