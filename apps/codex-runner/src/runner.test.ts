import assert from "node:assert/strict";
import test from "node:test";

import { CodexProviderClientError, type CodexProviderClient } from "./client.js";
import type { CodexInvocationOutcome } from "./codex-cli.js";
import type { CodexProviderClaim } from "./protocol.js";
import type { CodexPortraitClaim, CodexPortraitCompletion, CodexPortraitMeshClaim, CodexPortraitMeshCompletion } from "@patternlike/shared";
import { CodexPortraitClient } from "./portrait-client.js";
import {
  parseRunnerConfiguration,
  runCodexPollLoop,
  runOneCodexJob,
  runOnePortraitJob,
  runOnePortraitMeshJob,
  type CodexPollLoopOptions,
} from "./runner.js";

const CLAIM: CodexProviderClaim = {
  schema_version: "codex-provider-claim/v1",
  job_id: `cpjob_${"b".repeat(32)}`,
  lease_token: "lease_0123456789abcdefghijklmnopqrstuvwxyz",
  model: "gpt-5.6-sol",
  reasoning_effort: "high",
  prompt_version: "1.0.0",
  timeout_ms: 900_000,
  invocation: {
    schema_version: "codex-provider-invocation/v1",
    prompt: "secret prompt",
    output_schema: { type: "object" },
  },
};

function client(claim: CodexProviderClaim | null) {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const fake = {
    async claim() {
      calls.push({ operation: "claim" });
      return claim === null
        ? { status: "empty" as const }
        : { status: "claimed" as const, claim };
    },
    async complete(jobId: string, value: unknown) {
      calls.push({ operation: "complete", value: { jobId, value } });
    },
    async fail(jobId: string, value: unknown) {
      calls.push({ operation: "fail", value: { jobId, value } });
    },
  } satisfies Pick<CodexProviderClient, "claim" | "complete" | "fail">;
  return { fake, calls };
}

test("one claimed invocation produces exactly one completion", async () => {
  const { fake, calls } = client(CLAIM);
  const outcome: CodexInvocationOutcome = {
    ok: true,
    output: '{"ok":true}',
    providerRequestId: "thread_123",
    inputTokens: 11,
    outputTokens: 7,
  };
  assert.equal(await runOneCodexJob(fake, async () => outcome), "processed");
  assert.deepEqual(calls, [
    { operation: "claim" },
    {
      operation: "complete",
      value: {
        jobId: CLAIM.job_id,
        value: {
          lease_token: CLAIM.lease_token,
          output: '{"ok":true}',
          provider_request_id: "thread_123",
          input_tokens: 11,
          output_tokens: 7,
        },
      },
    },
  ]);
});

test("one failed invocation produces exactly one safe failure", async () => {
  const { fake, calls } = client(CLAIM);
  const outcome: CodexInvocationOutcome = {
    ok: false,
    code: "publisher_unavailable",
    safeDetailCode: "network_error",
    fatal: false,
  };
  assert.equal(await runOneCodexJob(fake, async () => outcome), "processed");
  assert.deepEqual(calls.map(({ operation }) => operation), ["claim", "fail"]);
  assert.deepEqual(calls[1]!.value, {
    jobId: CLAIM.job_id,
    value: {
      lease_token: CLAIM.lease_token,
      code: "publisher_unavailable",
      safe_detail_code: "network_error",
    },
  });
});

test("a fatal local failure is submitted once before the runner exits", async () => {
  const { fake, calls } = client(CLAIM);
  await assert.rejects(
    runOneCodexJob(fake, async () => ({
      ok: false,
      code: "publisher_auth_failed",
      safeDetailCode: "authentication_failed",
      fatal: true,
    })),
    /authentication or executable/i,
  );
  assert.deepEqual(calls.map(({ operation }) => operation), ["claim", "fail"]);
});

test("204 polling waits with bounded jitter and logs no provider content", async () => {
  const { fake } = client(null);
  const abort = new AbortController();
  const waits: number[] = [];
  const logs: unknown[] = [];
  await runCodexPollLoop({
    client: fake,
    execute: async () => assert.fail("no invocation expected"),
    pollMs: 5_000,
    random: () => 1,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      abort.abort();
    },
    signal: abort.signal,
    log: (event) => logs.push(event),
  });
  assert.deepEqual(waits, [6_000]);
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes(CLAIM.invocation.prompt), false);
  assert.equal(serialized.includes("private output"), false);
  assert.equal(serialized.includes("stdout"), false);
  assert.equal(serialized.includes("stderr"), false);
});

test("runner configuration rejects concurrency above one", () => {
  assert.throws(() => parseRunnerConfiguration({
    PATTERNLIKE_API_ORIGIN: "https://api.example.test",
    CODEX_RUNNER_TOKEN: "runner_0123456789abcdefghijklmnopqrstuvwxyz",
    CODEX_RUNNER_CONCURRENCY: "2",
  }), /concurrency/i);
  assert.deepEqual(parseRunnerConfiguration({
    PATTERNLIKE_API_ORIGIN: "https://api.example.test",
    CODEX_RUNNER_TOKEN: "runner_0123456789abcdefghijklmnopqrstuvwxyz",
  }), {
    apiOrigin: "https://api.example.test",
    runnerToken: "runner_0123456789abcdefghijklmnopqrstuvwxyz",
    codexBin: "codex",
    pollMs: 5_000,
    concurrency: 1,
  });
});

test("portrait polling is opt-in and skips empty text slots within a pass", async () => {
  const env = { PATTERNLIKE_API_ORIGIN: "https://api.example.test", CODEX_RUNNER_TOKEN: "runner_0123456789abcdefghijklmnopqrstuvwxyz" };
  assert.equal(parseRunnerConfiguration(env).portraitsEnabled, undefined);
  assert.equal(parseRunnerConfiguration({ ...env, CODEX_RUNNER_PORTRAITS: "1" }).portraitsEnabled, true);
  assert.throws(() => parseRunnerConfiguration({ ...env, CODEX_RUNNER_PORTRAITS: "true" }), /CODEX_RUNNER_PORTRAITS/);
  const abort = new AbortController(); const order: string[] = []; let polls = 0;
  await runCodexPollLoop({
    client: {
      claim: async () => { order.push("text claim"); return ++polls === 1 ? { status: "claimed", claim: CLAIM } : { status: "empty" }; },
      complete: async () => { order.push("text complete"); }, fail: async () => assert.fail("text failure"),
    },
    execute: async () => ({ ok: true, output: "{}", providerRequestId: "thread", inputTokens: 0, outputTokens: 0 }),
    portraits: {
      client: { claim: async () => { order.push("portrait claim"); abort.abort(); return { status: "empty" }; }, complete: async () => assert.fail("no image"), fail: async () => assert.fail("no failure") },
      execute: async () => assert.fail("no portrait work"),
    },
    signal: abort.signal, pollMs: 250, sleep: async () => undefined,
  });
  assert.deepEqual(order, ["text claim", "text complete", "text claim", "portrait claim"]);
});


test("portrait failure is submitted once and fatal authentication stops polling", async () => {
  const claim = { job_id: `ppjob_${"a".repeat(32)}`, lease_token: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } as import("@patternlike/shared").CodexPortraitClaim;
  const calls: unknown[] = [];
  const client = {
    claim: async () => ({ status: "claimed" as const, claim }),
    complete: async () => assert.fail("no completion after failure"),
    fail: async (job: string, body: unknown) => { calls.push({ job, body }); },
  };
  await assert.rejects(runOnePortraitJob({ client, execute: async () => ({ ok: false, code: "authentication_failed", fatal: true }) }), /authentication or executable/);
  assert.deepEqual(calls, [{ job: claim.job_id, body: { lease_token: claim.lease_token, code: "authentication_failed" } }]);
});

const PORTRAIT_CLAIM: CodexPortraitClaim = {
  schema_version: "codex-portrait-claim/v1", job_id: `ppjob_${"a".repeat(32)}`, portrait_id: `ppor_${"b".repeat(32)}`,
  chapter_index: 0, lease_token: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", model: "gpt-5.6-sol", reasoning_effort: "xhigh",
  image_model: "gpt-image-2", prompt_version: "portrait-object-v1", timeout_ms: 900_000, prompt: "Fictional chapter.", source_sha256: "c".repeat(64),
};
const PORTRAIT_COMPLETION: CodexPortraitCompletion = {
  lease_token: PORTRAIT_CLAIM.lease_token, source_sha256: PORTRAIT_CLAIM.source_sha256,
  label: "Blank image", rationale: "The provider returned an unusable image.",
  image_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA6sAAAAASUVORK5CYII=",
  original_sha256: "d".repeat(64), pixels: { width: 128, height: 128, rgba_base64: Buffer.alloc(128 * 128 * 4, 255).toString("base64") },
  provider_request_id: "thread:turn", image_request_id: "native-image", image_model: "gpt-image-2",
};

test("a definitive portrait completion rejection reports image_invalid with the same lease", async () => {
  const requests: Array<{ operation: string; body: unknown }> = [];
  let state = "running";
  const client = new CodexPortraitClient({ apiOrigin: "https://api.example.test", runnerToken: "machine-token", fetchImpl: async (url, init) => {
    const operation = String(url).split("/").at(-1)!;
    requests.push({ operation, body: JSON.parse(String(init!.body)) });
    if (operation === "claim") return Response.json(PORTRAIT_CLAIM);
    if (operation === "complete") return Response.json({ error: "invalid_image" }, { status: 400 });
    assert.equal(operation, "fail");
    assert.equal(state, "running");
    state = "failed";
    return Response.json({ schema_version: "codex-portrait-terminal/v1", status: "accepted" });
  } });
  assert.equal(await runOnePortraitJob({ client, execute: async () => ({ ok: true, completion: PORTRAIT_COMPLETION }) }), "processed");
  assert.equal(state, "failed");
  assert.deepEqual(requests.map(({ operation }) => operation), ["claim", "complete", "fail"]);
  assert.deepEqual(requests[2]!.body, { lease_token: PORTRAIT_CLAIM.lease_token, code: "image_invalid" });
});

test("accepted or uncertain portrait completions are never overwritten with image failure", async () => {
  for (const completionError of [null, new CodexProviderClientError("server unavailable", 503), new CodexProviderClientError("transport failed"), new CodexProviderClientError("invalid acknowledgement", 200), new CodexProviderClientError("already terminal", 409)]) {
    const calls: string[] = [];
    const run = runOnePortraitJob({
      client: {
        claim: async () => ({ status: "claimed", claim: PORTRAIT_CLAIM }),
        complete: async () => { calls.push("complete"); if (completionError) throw completionError; },
        fail: async () => { calls.push("fail"); },
      },
      execute: async () => ({ ok: true, completion: PORTRAIT_COMPLETION }),
    });
    if (completionError) await assert.rejects(run, (error) => error === completionError);
    else assert.equal(await run, "processed");
    assert.deepEqual(calls, ["complete"]);
  }
});

test("mesh polling is separately opt-in and follows empty text and portrait slots", async () => {
  const env = { PATTERNLIKE_API_ORIGIN: "https://api.example.test", CODEX_RUNNER_TOKEN: "runner_0123456789abcdefghijklmnopqrstuvwxyz" };
  assert.equal(parseRunnerConfiguration(env).meshesEnabled, undefined);
  assert.equal(parseRunnerConfiguration({ ...env, CODEX_RUNNER_MESHES: "1" }).meshesEnabled, true);
  assert.throws(() => parseRunnerConfiguration({ ...env, CODEX_RUNNER_MESHES: "yes" }), /CODEX_RUNNER_MESHES/);
  const abort = new AbortController(); const order: string[] = []; let polls = 0;
  await runCodexPollLoop({
    client: { claim: async () => { order.push("text"); return ++polls === 1 ? { status: "claimed", claim: CLAIM } : { status: "empty" }; }, complete: async () => undefined, fail: async () => assert.fail("text failure") },
    execute: async () => ({ ok: true, output: "{}", providerRequestId: "thread", inputTokens: 0, outputTokens: 0 }),
    portraits: { client: { claim: async () => { order.push("image"); return { status: "empty" }; }, complete: async () => assert.fail(), fail: async () => assert.fail() }, execute: async () => assert.fail() },
    meshes: { client: { claim: async () => { order.push("mesh"); abort.abort(); return { status: "empty" }; }, complete: async () => assert.fail(), fail: async () => assert.fail() }, execute: async () => assert.fail() },
    signal: abort.signal, pollMs: 250, sleep: async () => undefined,
  });
  assert.deepEqual(order, ["text", "text", "image", "mesh"]);
});

test("mesh visual failure reports once; fatal authentication reports before exit", async () => {
  const claim = { job_id: `ppmesh_${"a".repeat(32)}`, lease_token: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } as import("@patternlike/shared").CodexPortraitMeshClaim;
  for (const fatal of [false, true]) {
    const calls: unknown[] = [];
    const code = fatal ? "authentication_failed" as const : "visual_check_failed" as const;
    const run = runOnePortraitMeshJob({ client: { claim: async () => ({ status: "claimed", claim }), complete: async () => assert.fail("no completion"), fail: async (job, body) => { calls.push({ job, body }); } }, execute: async () => ({ ok: false, code, fatal }) });
    if (fatal) await assert.rejects(run, /authentication or executable/); else assert.equal(await run, "processed");
    assert.deepEqual(calls, [{ job: claim.job_id, body: { lease_token: claim.lease_token, code } }]);
  }
});

test("mesh definitive rejection fails same lease and uncertain completion never overwrites acceptance", async () => {
  const claim = { job_id: `ppmesh_${"a".repeat(32)}`, lease_token: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } as import("@patternlike/shared").CodexPortraitMeshClaim;
  for (const status of [200, 400, 409, 503, undefined]) {
    const error = new CodexProviderClientError("safe transport error", status); const calls: unknown[] = [];
    const run = runOnePortraitMeshJob({ client: { claim: async () => ({ status: "claimed", claim }), complete: async () => { calls.push("complete"); throw error; }, fail: async (job, body) => { calls.push({ job, body }); } }, execute: async () => ({ ok: true, completion: {} as import("@patternlike/shared").CodexPortraitMeshCompletion }) });
    if (status === 400) {
      assert.equal(await run, "processed");
      assert.deepEqual(calls, ["complete", { job: claim.job_id, body: { lease_token: claim.lease_token, code: "model_invalid" } }]);
    } else { await assert.rejects(run, (cause) => cause === error); assert.deepEqual(calls, ["complete"]); }
  }
});

const MESH_CLAIM: CodexPortraitMeshClaim = {
  schema_version: "codex-portrait-mesh-claim/v1", job_id: `ppmesh_${"a".repeat(32)}`,
  portrait_id: PORTRAIT_CLAIM.portrait_id, chapter_index: 0, chapter_id: "chapter-1",
  lease_token: PORTRAIT_CLAIM.lease_token, model: "gpt-5.6-sol", reasoning_effort: "xhigh",
  prompt_version: "portrait-mesh/v1", timeout_ms: 900_000,
  source_text: "Fictional chapter.", source_text_sha256: "a".repeat(64), source_image_sha256: "b".repeat(64),
  document_revision: "revision-1", image_base64: PORTRAIT_COMPLETION.image_base64,
  compiler_version: "portrait-mesh-compiler/v1",
};
const MESH_COMPLETION: CodexPortraitMeshCompletion = {
  lease_token: MESH_CLAIM.lease_token,
  program: {
    version: "portrait-mesh-program/v1",
    materials: [{ id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 }],
    parts: [{ name: "body", material: "oak", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null, geometry: { kind: "box", size: [1, 1, 1], bevel: 0.04 } }],
  },
  program_sha256: "c".repeat(64), glb_base64: Buffer.from("synthetic mesh").toString("base64"),
  glb_sha256: "d".repeat(64), compiler_version: MESH_CLAIM.compiler_version,
  audit: { schema_version: "portrait-mesh-audit/v1", accepted: true, recognizable: true, substantial: true, source_correspondence: true, no_severe_intersections: true, view_count: 4, notes: "Fictional block." },
  provider_request_id: "mesh-author", audit_request_id: "mesh-audit",
};

type WorkClass = "text" | "portrait" | "mesh";
type QueueMode = "claimed" | "empty" | "error";

function pollHarness() {
  const abort = new AbortController();
  const state = {
    abort,
    now: 0,
    limit: 12,
    stopAt: Infinity,
    modes: { text: "claimed", portrait: "claimed", mesh: "claimed" } as Record<WorkClass, QueueMode>,
    durations: { text: 10, portrait: 30, mesh: 50 },
    trace: [] as Array<{ workClass: WorkClass; event: string; at: number }>,
    terminals: [] as Array<{ workClass: WorkClass; operation: string; job: string; body: unknown }>,
    executions: [] as Array<{ workClass: WorkClass; claim: unknown }>,
    waits: [] as number[],
    logs: [] as unknown[],
    onClaim: (_workClass: WorkClass) => undefined as void,
    onExecute: async (_workClass: WorkClass) => undefined as void,
    onComplete: async (_workClass: WorkClass) => undefined as void,
    onSleep: () => abort.abort(),
  };
  async function claim<T>(workClass: WorkClass, value: T) {
    state.trace.push({ workClass, event: "claim", at: state.now });
    if (state.trace.length > 600) { abort.abort(); throw new Error("fixture observation bound exceeded"); }
    state.onClaim(workClass);
    if (state.modes[workClass] === "error") throw new Error("private provider error");
    if (state.modes[workClass] === "empty") return { status: "empty" as const };
    return { status: "claimed" as const, claim: value };
  }
  async function execute(workClass: WorkClass, value: unknown) {
    state.executions.push({ workClass, claim: value });
    state.trace.push({ workClass, event: "execute", at: state.now });
    await state.onExecute(workClass);
    state.now += state.durations[workClass];
  }
  async function terminal(workClass: WorkClass, operation: string, job: string, body: unknown) {
    state.terminals.push({ workClass, operation, job, body });
    state.trace.push({ workClass, event: operation, at: state.now });
    if (state.terminals.length >= state.limit || state.now >= state.stopAt) abort.abort();
    if (operation === "complete") await state.onComplete(workClass);
  }
  const options: CodexPollLoopOptions = {
    client: {
      claim: () => claim("text", CLAIM),
      complete: (job, body) => terminal("text", "complete", job, body),
      fail: (job, body) => terminal("text", "fail", job, body),
    },
    execute: async (value) => {
      await execute("text", value);
      return { ok: true, output: "{}", providerRequestId: "thread", inputTokens: 11, outputTokens: 7 };
    },
    portraits: {
      client: {
        claim: () => claim("portrait", PORTRAIT_CLAIM),
        complete: (job, body) => terminal("portrait", "complete", job, body),
        fail: (job, body) => terminal("portrait", "fail", job, body),
      },
      execute: async (value) => { await execute("portrait", value); return { ok: true, completion: PORTRAIT_COMPLETION }; },
    },
    meshes: {
      client: {
        claim: () => claim("mesh", MESH_CLAIM),
        complete: (job, body) => terminal("mesh", "complete", job, body),
        fail: (job, body) => terminal("mesh", "fail", job, body),
      },
      execute: async (value) => { await execute("mesh", value); return { ok: true, completion: MESH_COMPLETION }; },
    },
    signal: abort.signal,
    pollMs: 1_000,
    now: () => state.now,
    random: () => 0.5,
    sleep: async (milliseconds) => { state.waits.push(milliseconds); state.now += milliseconds; state.onSleep(); },
    log: (event) => state.logs.push(event),
  };
  return { state, options };
}

test("continuous demand reaches portrait and mesh within six dispatches from every cursor", async (t) => {
  const { state, options } = pollHarness();
  state.limit = Infinity;
  state.stopAt = 240;
  await runCodexPollLoop(options);
  const progress = state.terminals.map(({ workClass }) => workClass);
  t.diagnostic(JSON.stringify({ offered: state.trace.filter(({ event }) => event === "claim"), processed: progress, elapsedMs: state.now }));
  assert.deepEqual(progress, ["text", "text", "text", "text", "portrait", "mesh", "text", "text", "text", "text", "portrait", "mesh"]);
  for (let cursor = 0; cursor < 6; cursor++) {
    const window = progress.slice(cursor, cursor + 6);
    assert.equal(window.filter((workClass) => workClass === "text").length, 4);
    assert.equal(window.filter((workClass) => workClass === "portrait").length, 1);
    assert.equal(window.filter((workClass) => workClass === "mesh").length, 1);
  }
  assert.deepEqual(state.waits, []);
  assert.equal(state.now, 240);
  for (const execution of state.executions) {
    assert.equal(execution.claim, { text: CLAIM, portrait: PORTRAIT_CLAIM, mesh: MESH_CLAIM }[execution.workClass]);
  }
  for (const terminal of state.terminals) {
    assert.equal(terminal.operation, "complete");
    const expected = {
      text: { job: CLAIM.job_id, body: { lease_token: CLAIM.lease_token, output: "{}", provider_request_id: "thread", input_tokens: 11, output_tokens: 7 } },
      portrait: { job: PORTRAIT_CLAIM.job_id, body: PORTRAIT_COMPLETION },
      mesh: { job: MESH_CLAIM.job_id, body: MESH_COMPLETION },
    }[terminal.workClass];
    assert.deepEqual({ job: terminal.job, body: terminal.body }, expected);
  }
});

for (const optional of ["portrait", "mesh", "neither"] as const) {
  test(`disabled slots preserve bounded progress with ${optional} enabled`, async () => {
    const { state, options } = pollHarness();
    if (optional !== "portrait") delete options.portraits;
    if (optional !== "mesh") delete options.meshes;
    state.limit = 10;
    await runCodexPollLoop(options);
    assert.deepEqual(state.terminals.map(({ workClass }) => workClass), optional === "neither"
      ? Array(10).fill("text")
      : ["text", "text", "text", "text", optional, "text", "text", "text", "text", optional]);
    assert.deepEqual(state.waits, []);
  });
}

test("all-empty passes poll each class once and sleep before newly available work", async () => {
  const { state, options } = pollHarness();
  state.modes = { text: "empty", portrait: "empty", mesh: "empty" };
  state.onSleep = () => { state.modes.mesh = "claimed"; };
  state.limit = 1;
  await runCodexPollLoop(options);
  assert.deepEqual(state.trace.filter(({ event }) => event === "claim").map(({ workClass, at }) => [workClass, at]), [
    ["text", 0], ["portrait", 0], ["mesh", 0], ["text", 1_000], ["portrait", 1_000], ["mesh", 1_000],
  ]);
  assert.deepEqual(state.waits, [1_000]);
  assert.deepEqual(state.terminals.map(({ workClass }) => workClass), ["mesh"]);
});

test("an idle pass retains the cursor after a processed text job", async () => {
  const { state, options } = pollHarness();
  state.limit = 7;
  state.onComplete = async () => {
    if (state.terminals.length === 1) state.modes = { text: "empty", portrait: "empty", mesh: "empty" };
  };
  state.onSleep = () => { state.modes = { text: "claimed", portrait: "claimed", mesh: "claimed" }; };
  await runCodexPollLoop(options);
  assert.deepEqual(state.terminals.map(({ workClass }) => workClass), ["text", "text", "text", "text", "portrait", "mesh", "text"]);
  assert.deepEqual(state.waits, [1_000]);
});

for (const unavailable of ["text", "portrait", "mesh"] as const) {
  test(`repeated empty ${unavailable} responses leave other queues progressing`, async () => {
    const { state, options } = pollHarness();
    state.modes[unavailable] = "empty";
    state.limit = 10;
    await runCodexPollLoop(options);
    const progress = state.terminals.map(({ workClass }) => workClass);
    assert.deepEqual(progress, unavailable === "text"
      ? ["portrait", "mesh", "portrait", "mesh", "portrait", "mesh", "portrait", "mesh", "portrait", "mesh"]
      : ["text", "text", "text", "text", unavailable === "portrait" ? "mesh" : "portrait", "text", "text", "text", "text", unavailable === "portrait" ? "mesh" : "portrait"]);
    assert.deepEqual(state.waits, []);
  });

  test(`a failing ${unavailable} class cools down without delaying healthy queues`, async () => {
    const { state, options } = pollHarness();
    state.modes[unavailable] = "error";
    state.limit = 10;
    await runCodexPollLoop(options);
    assert.equal(state.terminals.length, 10);
    assert(state.terminals.every(({ workClass }) => workClass !== unavailable));
    for (const workClass of ["text", "portrait", "mesh"] as const) {
      if (workClass !== unavailable) assert(state.terminals.some((terminal) => terminal.workClass === workClass));
    }
    assert.equal(state.trace.filter(({ event, workClass }) => event === "claim" && workClass === unavailable).length, 1);
    assert.deepEqual(state.waits, []);
    assert.deepEqual(state.logs.filter((event) => (event as { event: string }).event === "codex_runner_poll_failed"), [
      { event: "codex_runner_poll_failed", work_class: unavailable, policy: "weighted-work-classes/v1" },
    ]);
    assert.equal(JSON.stringify(state.logs).includes("private provider error"), false);
  });

  test(`${unavailable} cooldown expiry shortens idle sleep and permits the next claim`, async () => {
    const { state, options } = pollHarness();
    state.modes = { text: "empty", portrait: "empty", mesh: "empty" };
    state.modes[unavailable] = "error";
    let samples = 0;
    options.random = () => samples++ === 0 ? 0 : 1;
    state.onSleep = () => { state.modes[unavailable] = "claimed"; };
    state.limit = 1;
    await runCodexPollLoop(options);
    assert.deepEqual(state.waits, [800]);
    assert.deepEqual(state.trace.filter(({ event, workClass }) => event === "claim" && workClass === unavailable).map(({ at }) => at), [0, 800]);
    assert.deepEqual(state.terminals.map(({ workClass }) => workClass), [unavailable]);
  });
}

test("repeated errors in all classes wait positively between bounded retry passes", async () => {
  const { state, options } = pollHarness();
  state.modes = { text: "error", portrait: "error", mesh: "error" };
  state.onSleep = () => { if (state.waits.length === 3) state.abort.abort(); };
  await runCodexPollLoop(options);
  assert.deepEqual(state.waits, [1_000, 1_000, 1_000]);
  assert.deepEqual(state.trace.map(({ workClass, at }) => [workClass, at]), [
    ["text", 0], ["portrait", 0], ["mesh", 0],
    ["text", 1_000], ["portrait", 1_000], ["mesh", 1_000],
    ["text", 2_000], ["portrait", 2_000], ["mesh", 2_000],
  ]);
});

test("shutdown before polling makes no claim", async () => {
  const { state, options } = pollHarness();
  state.abort.abort();
  await runCodexPollLoop(options);
  assert.deepEqual(state.trace, []);
  assert.deepEqual(state.waits, []);
});

test("shutdown after an empty claim prevents the next enabled class claim", async () => {
  const { state, options } = pollHarness();
  state.modes.text = "empty";
  state.onClaim = () => state.abort.abort();
  await runCodexPollLoop(options);
  assert.deepEqual(state.trace, [{ workClass: "text", event: "claim", at: 0 }]);
  assert.deepEqual(state.waits, []);
});

test("the default idle sleep wakes on shutdown", async () => {
  const { state, options } = pollHarness();
  state.modes = { text: "empty", portrait: "empty", mesh: "empty" };
  delete options.sleep;
  options.pollMs = 60_000;
  options.log = (event) => {
    if (event.event === "codex_runner_idle") queueMicrotask(() => state.abort.abort());
  };
  await runCodexPollLoop(options);
  assert.equal(state.trace.length, 3);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => { resolve = finish; });
  return { promise, resolve };
}

for (const [workClass, phase] of [["text", "claim"], ["portrait", "execute"], ["mesh", "complete"]] as const) {
  test(`a delayed ${workClass} ${phase} holds the only in-flight job and finishes its lease on shutdown`, async () => {
    const { state, options } = pollHarness();
    const entered = deferred();
    const release = deferred();
    const pause = async (selected: WorkClass) => {
      if (selected === workClass) { entered.resolve(); await release.promise; }
    };
    if (phase === "claim") {
      const original = options.client.claim;
      options.client.claim = async () => { const claimed = await original(); await pause("text"); return claimed; };
    } else if (phase === "execute") state.onExecute = pause;
    else state.onComplete = pause;
    const run = runCodexPollLoop(options);
    try {
      await entered.promise;
      const atPause = state.trace.slice();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(state.trace, atPause, "no further domain operation starts while a lease operation is pending");
      state.abort.abort();
    } finally { release.resolve(); }
    await run;
    assert.deepEqual(state.trace.slice(-3).map(({ workClass: lane, event }) => [lane, event]), [
      [workClass, "claim"], [workClass, "execute"], [workClass, "complete"],
    ]);
    assert(state.terminals.every(({ operation }) => operation === "complete"));
    assert.deepEqual(state.waits, []);
  });
}

for (const workClass of ["text", "portrait", "mesh"] as const) {
  test(`fatal ${workClass} authentication submits failure once and exits without another claim`, async () => {
    const { state, options } = pollHarness();
    if (workClass === "text") options.execute = async () => ({ ok: false, code: "publisher_auth_failed", safeDetailCode: "authentication_failed", fatal: true });
    else if (workClass === "portrait") options.portraits!.execute = async () => ({ ok: false, code: "authentication_failed", fatal: true });
    else options.meshes!.execute = async () => ({ ok: false, code: "authentication_failed", fatal: true });
    await assert.rejects(runCodexPollLoop(options), /authentication or executable/);
    assert.deepEqual(state.trace.slice(-2).map(({ workClass: lane, event }) => [lane, event]), [[workClass, "claim"], [workClass, "fail"]]);
    assert.equal(state.terminals.filter(({ operation }) => operation === "fail").length, 1);
    assert.deepEqual(state.waits, []);
  });

  test(`an ambiguous ${workClass} completion preserves acceptance and rotates to other queues`, async () => {
    const { state, options } = pollHarness();
    state.limit = 10;
    state.onComplete = async (completed) => {
      if (completed === workClass) throw new CodexProviderClientError("private completion result", 503);
    };
    await runCodexPollLoop(options);
    assert(state.terminals.every(({ operation }) => operation === "complete"), "a transport error cannot manufacture a conflicting failure");
    assert.equal(state.terminals.filter((terminal) => terminal.workClass === workClass).length, 1);
    assert.deepEqual(state.waits, []);
    for (const other of ["text", "portrait", "mesh"] as const) {
      if (other !== workClass) assert(state.terminals.some((terminal) => terminal.workClass === other));
    }
    assert.equal(JSON.stringify(state.logs).includes("private completion result"), false);
  });
}

test("an error after one text completion consumes its slot before idle sleep", async () => {
  const { state, options } = pollHarness();
  state.limit = 6;
  state.onComplete = async () => {
    if (state.terminals.length === 1) state.modes = { text: "error", portrait: "empty", mesh: "empty" };
  };
  state.onSleep = () => { state.modes = { text: "claimed", portrait: "claimed", mesh: "claimed" }; };
  await runCodexPollLoop(options);
  assert.deepEqual(state.terminals.map(({ workClass }) => workClass), ["text", "text", "text", "text", "portrait", "mesh"]);
  assert.deepEqual(state.waits, [1_000]);
});

test("handled execution failures log processed with fixed policy and class only", async () => {
  const { state, options } = pollHarness();
  state.limit = 1;
  options.execute = async () => { throw Object.defineProperty({}, "message", { get() { assert.fail("must not inspect private error fields"); } }); };
  await runCodexPollLoop(options);
  assert.deepEqual(state.logs, [{ event: "codex_runner_job_processed", work_class: "text", policy: "weighted-work-classes/v1" }]);
  assert.equal(state.terminals[0]!.operation, "fail");
});
