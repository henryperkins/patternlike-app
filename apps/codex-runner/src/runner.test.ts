import assert from "node:assert/strict";
import test from "node:test";

import type { CodexProviderClient } from "./client.js";
import type { CodexInvocationOutcome } from "./codex-cli.js";
import type { CodexProviderClaim } from "./protocol.js";
import {
  parseRunnerConfiguration,
  runCodexPollLoop,
  runOneCodexJob,
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
