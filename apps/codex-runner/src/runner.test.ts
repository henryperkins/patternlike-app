import assert from "node:assert/strict";
import test from "node:test";

import { CodexProviderClientError, type CodexProviderClient } from "./client.js";
import type { CodexInvocationOutcome } from "./codex-cli.js";
import type { CodexProviderClaim } from "./protocol.js";
import type { CodexPortraitClaim, CodexPortraitCompletion } from "@patternlike/shared";
import { CodexPortraitClient } from "./portrait-client.js";
import {
  parseRunnerConfiguration,
  runCodexPollLoop,
  runOneCodexJob,
  runOnePortraitJob,
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

test("portrait polling is opt-in and waits for the text queue to become idle", async () => {
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
