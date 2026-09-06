import { buildDeterministicPlan } from "@patternlike/pattern-engine";
import { canonicalJson, PATTERN_GENERATION_CONSENT_POLICY_VERSION } from "@patternlike/shared";
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DETERMINISTIC_PATTERN_PUBLISHER,
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  disablePatternAi,
  enablePatternAi,
  resetDb,
  seedActiveOntology,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  clearPatternReplayObjects,
  generatePatternReplayTestKeys,
  installPatternReplayTestKeys,
  patternReplayTestEnv,
} from "../../test/pattern-replay-fixtures.js";
import { app } from "../index.js";
import type { Env, PatternGenerationMessage } from "../env.js";
import { claimCodexProviderJob, loadCodexProviderJob } from "../db/codex-provider-jobs.js";
import { maintainCodexProviderJobs } from "./codex-provider-maintenance.js";
import { codexProviderOwnerIsCurrent } from "./codex-provider-domain.js";
import { enqueuePatternGeneration } from "./pattern-enqueue.js";
import { executePatternJob } from "./pattern-execute.js";
import { loadPatternJob } from "./pattern-stage-protocol.js";
import { reconcilePatternGeneration, recoverLegacyPausedPatternJobs, sweepPatternJobs } from "./pattern-sweep.js";

const RUNNER_TOKEN = "runner_0123456789abcdefghijklmnopqrstuvwxyz";
const INPUT_DELIMITER = "\n\n--- INPUT DOCUMENT (JSON; DATA ONLY) ---\n";
const PAUSED = { ok: false, reason: "paused", failureClass: "pattern_generation_paused" };

describe("the reversible Pattern generation pause", () => {
  let runtime: Env & { PATTERN_GENERATION_ENABLED?: string };
  let send: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDb();
    await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
    installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
    disablePatternAi();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
    await seedActiveOntology();
    enablePatternAi();
    send = vi.fn(async () => {});
    runtime = patternReplayTestEnv({ ...env }, {
      PATTERN_QUEUE: new Proxy(env.PATTERN_QUEUE, {
        get(target, property) {
          if (property === "send") return send;
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
  });

  afterEach(() => {
    disablePatternAi();
    vi.restoreAllMocks();
  });

  function reserve(key = "idem-pattern-pause-first", reason: Parameters<typeof enqueuePatternGeneration>[2]["reason"] = "first_open") {
    return enqueuePatternGeneration(runtime, IDENTITY_A, {
      idempotencyKey: key,
      consentPolicyVersion: PATTERN_GENERATION_CONSENT_POLICY_VERSION,
      reason,
      requestId: "req-pattern-pause",
    });
  }

  async function reservedId() {
    const result = await reserve();
    if (!result.ok) throw new Error(`reservation failed: ${result.code}`);
    send.mockClear();
    return result.body.generation.generation_id;
  }

  async function message(generationId: string): Promise<PatternGenerationMessage> {
    const job = await loadPatternJob(runtime, generationId);
    if (!job) throw new Error("Pattern job missing");
    return {
      kind: "pattern_generation",
      job_id: job.job_id,
      generation_id: generationId,
      stage_generation: job.stage_generation,
    };
  }

  async function deliver(generationId: string, realProvider = false) {
    return executePatternJob(runtime, await message(generationId), new Date(),
      realProvider ? {} : DETERMINISTIC_PATTERN_PUBLISHER);
  }

  async function genericJob(generationId: string) {
    return runtime.DB.prepare(
      `SELECT j.status, j.attempts, j.result_class, j.dispatched_at, j.claim_token
       FROM jobs j JOIN pattern_generation_jobs p ON p.job_id = j.id
       WHERE p.generation_id = ?`,
    ).bind(generationId).first();
  }

  async function count(table: string) {
    return (await runtime.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .first<{ n: number }>())!.n;
  }

  function request(path: string, init: RequestInit = {}) {
    return app.fetch(new Request(`https://worker.test${path}`, {
      ...init,
      headers: {
        "x-user-id": USER_A,
        "content-type": "application/json",
        "idempotency-key": "idem-pattern-pause-lifecycle",
        ...init.headers,
      },
    }), runtime);
  }

  function runner(path: string, body: unknown) {
    return request(`/codex-provider${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${RUNNER_TOKEN}` },
      body: JSON.stringify(body),
    });
  }

  async function providerId(generationId: string) {
    const row = await runtime.DB.prepare("SELECT id FROM codex_provider_jobs WHERE owner_id = ?")
      .bind(generationId).first<{ id: string }>();
    if (!row) throw new Error("Provider job missing");
    return row.id;
  }

  async function claimProvider() {
    const response = await runner("/v1/jobs/claim", {});
    expect(response.status).toBe(200);
    return response.json<{
      job_id: string;
      lease_token: string;
      invocation: { prompt: string };
    }>();
  }

  function completion(claim: Awaited<ReturnType<typeof claimProvider>>) {
    const input = JSON.parse(claim.invocation.prompt.split(INPUT_DELIMITER)[1]!) as {
      packet: Parameters<typeof buildDeterministicPlan>[0];
      ontology_records: Parameters<typeof buildDeterministicPlan>[1];
    };
    return {
      lease_token: claim.lease_token,
      output: canonicalJson(buildDeterministicPlan(input.packet, input.ontology_records)),
      provider_request_id: "thread-pattern-pause",
      input_tokens: 800,
      output_tokens: 200,
    };
  }

  it.each(["first_open", "first_open_retry", "failed_attempt_retry", "chart_correction", "source_update"] as const)(
    "refuses new %s work before any reservation, grant, or artifact write",
    async (reason) => {
      runtime.PATTERN_GENERATION_ENABLED = "0";
      expect(await reserve("idem-pattern-paused-new", reason)).toMatchObject({
        ok: false, status: 503, code: "pattern_generation_paused",
      });
      for (const table of ["jobs", "pattern_generation_jobs", "pattern_generation_claims", "pattern_generation_artifact_keys"]) {
        expect(await count(table), table).toBe(0);
      }
      expect(await runtime.DB.prepare("SELECT COUNT(*) AS n FROM consents WHERE kind = 'pattern_generation'").first()).toEqual({ n: 0 });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("replays an existing reservation but parks delivery without consuming any attempt", async () => {
    const id = await reservedId();
    const before = await loadPatternJob(runtime, id);
    runtime.PATTERN_GENERATION_ENABLED = "0";
    expect(await reserve()).toMatchObject({ ok: true, replay: true });
    for (let attempt = 0; attempt < 20; attempt++) expect(await deliver(id)).toEqual(PAUSED);
    expect(await loadPatternJob(runtime, id)).toEqual(before);
    expect(await genericJob(id)).toMatchObject({
      status: "queued", attempts: 0, result_class: "pattern_generation_paused",
      dispatched_at: null, claim_token: null,
    });
    expect(await count("codex_provider_jobs")).toBe(0);
    expect(await count("pattern_generation_artifacts")).toBe(0);
    expect((await request(`/v1/pattern-generations/${id}`)).status).toBe(200);
    await sweepPatternJobs(runtime);
    expect(await reconcilePatternGeneration(runtime, id)).toMatchObject({
      ok: false, status: 503, code: "pattern_generation_paused",
    });
    const reconcile = await request(`/internal/pattern-generations/${id}/reconcile`, { method: "POST" });
    expect(reconcile.status).toBe(503);
    expect(await reconcile.json()).toMatchObject({ error: {
      code: "pattern_generation_paused", message: "Pattern generation is temporarily paused",
    } });
    expect(send).not.toHaveBeenCalled();

    runtime.PATTERN_GENERATION_ENABLED = "1";
    await sweepPatternJobs(runtime);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await genericJob(id)).toMatchObject({ status: "queued", result_class: null, attempts: 0 });
    expect(await deliver(id)).toEqual({ ok: true, terminal: false });
    expect((await loadPatternJob(runtime, id))!.stage).toBe("writing");
  });

  it("leaves a live executor lease untouched when a duplicate delivery sees the pause", async () => {
    const id = await reservedId();
    await runtime.DB.prepare(
      `UPDATE jobs SET status = 'running', claim_token = 'live-owner',
         lease_expires_at = ?, attempts = 1 WHERE id = ?`,
    ).bind(new Date(Date.now() + 60_000).toISOString(), (await message(id)).job_id).run();
    runtime.PATTERN_GENERATION_ENABLED = "0";
    await deliver(id);
    expect(await genericJob(id)).toMatchObject({ status: "running", claim_token: "live-owner", attempts: 1 });
  });

  it("clears the pause marker when an operator resumes before the maintenance sweep", async () => {
    const id = await reservedId();
    runtime.PATTERN_GENERATION_ENABLED = "0";
    await deliver(id);
    runtime.PATTERN_GENERATION_ENABLED = "1";
    expect(await reconcilePatternGeneration(runtime, id)).toMatchObject({ ok: true });
    await deliver(id, true);
    expect(await genericJob(id)).toMatchObject({ status: "queued", result_class: null });
    send.mockClear();
    await sweepPatternJobs(runtime);
    expect(send).not.toHaveBeenCalled();
  });

  it("cannot reset an exhausted expired executor lease into the queued lane on resume", async () => {
    const id = await reservedId();
    await runtime.DB.prepare(
      `UPDATE jobs SET status = 'running', claim_token = 'expired-owner',
         lease_expires_at = ?, attempts = 16 WHERE id = ?`,
    ).bind(new Date(0).toISOString(), (await message(id)).job_id).run();
    runtime.PATTERN_GENERATION_ENABLED = "0";
    expect(await deliver(id)).toEqual(PAUSED);
    await sweepPatternJobs(runtime);
    expect(await genericJob(id)).toMatchObject({ status: "running", attempts: 16 });
    expect(send).not.toHaveBeenCalled();
    runtime.PATTERN_GENERATION_ENABLED = "1";
    await sweepPatternJobs(runtime);
    expect(await genericJob(id)).toMatchObject({ status: "failed", attempts: 16, result_class: "stage_attempts_exhausted" });
    expect((await loadPatternJob(runtime, id))!.stage).toBe("failed");
    expect(await count("codex_provider_jobs")).toBe(0);
  });

  it("holds pending and expired provider leases through a long pause without cancelling eligible work", async () => {
    const id = await reservedId();
    await deliver(id, true);
    const provider = await providerId(id);
    runtime.PATTERN_GENERATION_ENABLED = "0";
    expect((await runner("/v1/jobs/claim", {})).status).toBe(204);
    const later = new Date(Date.now() + 2 * 86_400_000);
    expect(await maintainCodexProviderJobs(runtime, later)).toMatchObject({ cancelled: 0, repaired: 0 });
    expect((await loadCodexProviderJob(runtime, provider))!.status).toBe("pending");
    expect(await count("pattern_provider_daily_usage")).toBe(0);

    runtime.PATTERN_GENERATION_ENABLED = "1";
    const first = await claimProvider();
    runtime.PATTERN_GENERATION_ENABLED = "0";
    await runtime.DB.prepare("UPDATE codex_provider_jobs SET lease_expires_at = ? WHERE id = ?")
      .bind(new Date(0).toISOString(), provider).run();
    expect(await claimCodexProviderJob(runtime, later)).toEqual({ status: "empty" });
    expect(await maintainCodexProviderJobs(runtime, later)).toMatchObject({ cancelled: 0, repaired: 0 });
    expect((await loadCodexProviderJob(runtime, provider))!.status).toBe("leased");

    runtime.PATTERN_GENERATION_ENABLED = "1";
    const second = await claimProvider();
    expect(second.job_id).toBe(first.job_id);
    expect(second.lease_token).not.toBe(first.lease_token);
    expect((await runner(`/v1/jobs/${provider}/complete`, completion(first))).status).toBe(409);
    expect((await runner(`/v1/jobs/${provider}/complete`, completion(second))).status).toBe(200);
    expect(await runtime.DB.prepare("SELECT used_calls FROM pattern_provider_daily_usage").first()).toEqual({ used_calls: 2 });
  });

  it("retains a leased completion during the pause and adopts it exactly once after resume", async () => {
    const id = await reservedId();
    await deliver(id, true);
    const claim = await claimProvider();
    const before = await loadPatternJob(runtime, id);
    runtime.PATTERN_GENERATION_ENABLED = "0";
    send.mockClear();
    expect((await runner(`/v1/jobs/${claim.job_id}/complete`, completion(claim))).status).toBe(200);
    const saved = await loadCodexProviderJob(runtime, claim.job_id);
    expect(saved).toMatchObject({ status: "completed", response: { plaintextHash: expect.any(String) } });
    expect(await codexProviderOwnerIsCurrent(runtime, saved!)).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(await loadPatternJob(runtime, id)).toEqual(before);
    expect(await deliver(id, true)).toEqual(PAUSED);
    await maintainCodexProviderJobs(runtime, new Date(Date.now() + 31 * 86_400_000));
    expect((await loadCodexProviderJob(runtime, claim.job_id))!.response).toEqual(saved!.response);
    expect(await runtime.ARTIFACTS!.head(saved!.response!.objectKey)).not.toBeNull();
    expect(send).not.toHaveBeenCalled();

    runtime.PATTERN_GENERATION_ENABLED = "1";
    await maintainCodexProviderJobs(runtime);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await deliver(id, true)).toEqual({ ok: true, terminal: false });
    expect((await loadPatternJob(runtime, id))!.stage).toBe("writing");
    expect(await count("codex_provider_jobs")).toBe(1);
    expect(await runtime.DB.prepare("SELECT used_calls FROM pattern_provider_daily_usage").first()).toEqual({ used_calls: 1 });
  });

  it("keeps an unfinished publication parked, then publishes its verified artifacts on resume", async () => {
    const id = await reservedId();
    await deliver(id);
    await deliver(id);
    const bucket = runtime.PATTERN_REPLAY_LEDGER;
    runtime.PATTERN_REPLAY_LEDGER = new Proxy(bucket!, {
      get(target, property) {
        if (property === "get") return async () => null;
        if (property === "put") return async () => { throw new Error("injected ledger outage"); };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await deliver(id)).toMatchObject({ ok: false, reason: "retry" });
    runtime.PATTERN_REPLAY_LEDGER = bucket;
    const before = await loadPatternJob(runtime, id);
    expect(before!.stage).toBe("publishing");
    await runtime.DB.prepare("UPDATE jobs SET available_at = NULL WHERE id = ?")
      .bind(before!.job_id).run();
    runtime.PATTERN_GENERATION_ENABLED = "0";
    expect(await deliver(id)).toEqual(PAUSED);
    expect(await count("pattern_documents")).toBe(0);
    expect(await count("pattern_erasure_replay_events")).toBe(0);
    expect(await loadPatternJob(runtime, id)).toEqual(before);
    runtime.PATTERN_GENERATION_ENABLED = "1";
    await sweepPatternJobs(runtime);
    expect(await deliver(id)).toEqual({ ok: true, terminal: true });
    expect(await count("pattern_documents")).toBe(1);
  });

  it("preserves accepted reads, consent withdrawal, deletion and cleanup while paused", async () => {
    const id = await reservedId();
    for (let step = 0; step < 3; step++) await deliver(id);
    const before = await (await request("/v1/pattern")).json();
    await runtime.DB.prepare("UPDATE pattern_documents SET pattern_source_hash = ? WHERE generation_id = ?")
      .bind(`sha256:${"b".repeat(64)}`, id).run();
    expect(await (await request("/v1/pattern-state")).json()).toMatchObject({ regeneration: { eligible: true } });
    runtime.PATTERN_GENERATION_ENABLED = "0";
    expect(await (await request("/v1/pattern-state")).json()).toMatchObject({ regeneration: { eligible: false } });
    runtime.PATTERN_GENERATION_ENABLED = "1";
    const regeneration = await reserve("idem-pattern-pause-regeneration", "source_update");
    if (!regeneration.ok) throw new Error(`regeneration failed: ${regeneration.code}`);
    const replacementId = regeneration.body.generation.generation_id;
    runtime.PATTERN_GENERATION_ENABLED = "0";
    expect(await deliver(replacementId)).toEqual(PAUSED);
    const read = await request("/v1/pattern");
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(before);
    expect((await request("/v1/consents/pattern-generation", { method: "DELETE" })).status).toBe(200);
    expect((await request("/v1/pattern")).status).toBe(200);
    expect((await request("/v1/pattern", {
      method: "DELETE", body: JSON.stringify({ confirm: "DELETE PATTERN" }),
    })).status).toBe(202);
    await sweepPatternJobs(runtime, new Date(Date.now() + 31 * 86_400_000));
    expect(await count("pattern_documents")).toBe(0);
    expect(await runtime.DB.prepare("SELECT status FROM pattern_generation_claims").first()).toEqual({ status: "deleted" });
    runtime.PATTERN_GENERATION_ENABLED = "1";
    await sweepPatternJobs(runtime);
    expect(await deliver(id)).toMatchObject({ ok: false, reason: "duplicate" });
    expect(await deliver(replacementId)).toMatchObject({ ok: false, reason: "duplicate" });
    expect((await loadPatternJob(runtime, replacementId))!.stage).toBe("cancelled");
    expect(await reserve("idem-pattern-deleted-resume")).toMatchObject({ ok: false, code: "pattern_already_consumed" });
  });

  it("rechecks the pause after writing the publication intent and before committing the reading", async () => {
    const id = await reservedId();
    await deliver(id);
    await deliver(id);
    const bucket = runtime.PATTERN_REPLAY_LEDGER!;
    runtime.PATTERN_REPLAY_LEDGER = new Proxy(bucket, {
      get(target, property) {
        if (property === "put") return async (...args: Parameters<R2Bucket["put"]>) => {
          const written = await target.put(...args);
          runtime.PATTERN_GENERATION_ENABLED = "0";
          return written;
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await deliver(id)).toEqual(PAUSED);
    expect(await count("pattern_documents")).toBe(0);
    expect(await count("pattern_erasure_replay_events")).toBe(0);
    runtime.PATTERN_REPLAY_LEDGER = bucket;
    runtime.PATTERN_GENERATION_ENABLED = "1";
    await sweepPatternJobs(runtime);
    expect(await deliver(id)).toEqual({ ok: true, terminal: true });
    expect(await count("pattern_documents")).toBe(1);
  });

  it("cleans expired stage artifacts while paused and fails safely if resume needs erased material", async () => {
    const id = await reservedId();
    await deliver(id);
    const { results: artifacts } = await runtime.DB.prepare(
      "SELECT object_key FROM pattern_generation_artifacts WHERE generation_id = ?",
    ).bind(id).all<{ object_key: string }>();
    expect(artifacts.length).toBeGreaterThan(0);
    await runtime.DB.prepare("UPDATE pattern_generation_artifacts SET expires_at = ? WHERE generation_id = ?")
      .bind(new Date(0).toISOString(), id).run();
    runtime.PATTERN_GENERATION_ENABLED = "0";
    await deliver(id);
    send.mockClear();
    await sweepPatternJobs(runtime);
    for (const artifact of artifacts) expect(await runtime.ARTIFACTS!.head(artifact.object_key)).toBeNull();
    expect(send).not.toHaveBeenCalled();
    runtime.PATTERN_GENERATION_ENABLED = "1";
    await sweepPatternJobs(runtime);
    expect(await deliver(id)).toMatchObject({ ok: false, reason: "terminal" });
    expect(await count("pattern_documents")).toBe(0);
    runtime.PATTERN_GENERATION_ENABLED = "0";
    expect(await (await request("/v1/pattern-state")).json()).toMatchObject({
      state: "failed", generation: { retryable: false },
    });
    runtime.PATTERN_GENERATION_ENABLED = "1";
    expect(await (await request("/v1/pattern-state")).json()).toMatchObject({
      state: "failed", generation: { retryable: true },
    });
  });

  it.each(["consent", "source", "claim"] as const)(
    "does not resurrect paused provider work after its %s becomes invalid",
    async (change) => {
      const id = await reservedId();
      await deliver(id, true);
      const provider = await providerId(id);
      runtime.PATTERN_GENERATION_ENABLED = "0";
      await deliver(id, true);
      if (change === "consent") {
        expect((await request("/v1/consents/pattern-generation", { method: "DELETE" })).status).toBe(200);
      } else if (change === "source") {
        await runtime.DB.prepare("UPDATE pattern_generation_jobs SET pattern_source_hash = ? WHERE generation_id = ?")
          .bind(`sha256:${"a".repeat(64)}`, id).run();
      } else {
        await runtime.DB.prepare("UPDATE pattern_generation_claims SET status = 'available', active_generation_id = NULL WHERE active_generation_id = ?")
          .bind(id).run();
      }
      expect(await maintainCodexProviderJobs(runtime)).toMatchObject({ cancelled: 1 });
      expect((await loadCodexProviderJob(runtime, provider))!.status).toBe("cancelled");
      runtime.PATTERN_GENERATION_ENABLED = "1";
      await sweepPatternJobs(runtime);
      await deliver(id, true);
      expect((await loadPatternJob(runtime, id))!.stage).toBe("cancelled");
      expect((await runner("/v1/jobs/claim", {})).status).toBe(204);
      expect(await count("pattern_documents")).toBe(0);
    },
  );

  it("does not let legacy pause repair bypass the current switch", async () => {
    const id = await reservedId();
    await runtime.DB.prepare("UPDATE jobs SET result_class = 'rollout_paused', dispatched_at = NULL WHERE id = ?")
      .bind((await message(id)).job_id).run();
    runtime.PATTERN_GENERATION_ENABLED = "0";
    expect(await recoverLegacyPausedPatternJobs(runtime)).toBe(0);
    await sweepPatternJobs(runtime);
    expect(send).not.toHaveBeenCalled();
    expect(await genericJob(id)).toMatchObject({ result_class: "rollout_paused" });
  });
});
