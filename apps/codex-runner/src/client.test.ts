import assert from "node:assert/strict";
import test from "node:test";

import { CodexProviderClient } from "./client.js";

const TOKEN = "runner_0123456789abcdefghijklmnopqrstuvwxyz";
const CLAIM = {
  schema_version: "codex-provider-claim/v1",
  job_id: `cpjob_${"c".repeat(32)}`,
  lease_token: "lease_0123456789abcdefghijklmnopqrstuvwxyz",
  model: "gpt-5.6-sol",
  reasoning_effort: "high",
  prompt_version: "1.0.0",
  timeout_ms: 900_000,
  invocation: {
    schema_version: "codex-provider-invocation/v1",
    prompt: "prompt",
    output_schema: { type: "object" },
  },
};

test("claims with dedicated bearer auth and strictly parses the response", async () => {
  const requests: Request[] = [];
  const client = new CodexProviderClient({
    apiOrigin: "https://api.example.test",
    runnerToken: TOKEN,
    fetchImpl: async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify(CLAIM), {
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
      });
    },
  });
  assert.deepEqual(await client.claim(), { status: "claimed", claim: CLAIM });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "https://api.example.test/codex-provider/v1/jobs/claim");
  assert.equal(requests[0]!.headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(requests[0]!.headers.get("content-type"), "application/json");
  assert.equal(await requests[0]!.text(), "{}");
});

test("treats an exact empty 204 as no work", async () => {
  const client = new CodexProviderClient({
    apiOrigin: "https://api.example.test",
    runnerToken: TOKEN,
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  assert.deepEqual(await client.claim(), { status: "empty" });
});

test("rejects claim documents with unknown fields", async () => {
  const client = new CodexProviderClient({
    apiOrigin: "https://api.example.test",
    runnerToken: TOKEN,
    fetchImpl: async () => new Response(JSON.stringify({ ...CLAIM, prompt: "leak" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  await assert.rejects(client.claim(), /invalid claim response/i);
});

test("accepts only the exact terminal acknowledgement", async () => {
  const requests: Request[] = [];
  const client = new CodexProviderClient({
    apiOrigin: "https://api.example.test",
    runnerToken: TOKEN,
    fetchImpl: async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({
        schema_version: "codex-provider-terminal/v1",
        status: "accepted",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await client.fail(CLAIM.job_id, {
    lease_token: CLAIM.lease_token,
    code: "publisher_unavailable",
    safe_detail_code: "network_error",
  });
  assert.equal(
    requests[0]!.url,
    `https://api.example.test/codex-provider/v1/jobs/${CLAIM.job_id}/fail`,
  );
  assert.deepEqual(JSON.parse(await requests[0]!.text()), {
    lease_token: CLAIM.lease_token,
    code: "publisher_unavailable",
    safe_detail_code: "network_error",
  });
});
