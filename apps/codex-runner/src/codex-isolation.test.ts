import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { checkCodexAuthentication, runCodexInvocation } from "./codex-cli.js";
import { jsonFixture } from "./portrait-mesh-test-fixture.js";
import { CODEX_PROVIDER_MAX_RESPONSE_BYTES, type CodexProviderClaim } from "./protocol.js";

const PROMPT = "Private minimized reading input. Return the requested JSON.";
function claim(effort: "high" | "xhigh" = "xhigh"): CodexProviderClaim {
  return {
    schema_version: "codex-provider-claim/v1", job_id: `cpjob_${"a".repeat(32)}`,
    lease_token: "lease_0123456789abcdefghijklmnopqrstuvwxyz", model: "gpt-5.6-sol",
    reasoning_effort: effort, prompt_version: "1.0.3", timeout_ms: 5_000,
    invocation: { schema_version: "codex-provider-invocation/v1", prompt: PROMPT,
      output_schema: { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } } },
  };
}

for (const effort of ["high", "xhigh"] as const) {
  test(`ordinary text uses an isolated fresh ${effort} turn with exact prompt/schema and observed usage`, async () => {
    const f = await jsonFixture();
    try {
      const result = await runCodexInvocation({ claim: claim(effort), codexBin: f.executable, tempRoot: f.options.tempRoot, env: f.options.env });
      assert.deepEqual(result, { ok: true, output: '{"answer":"complete"}',
        providerRequestId: "11111111-2222-4333-8444-555555555555:turn-1", inputTokens: 17, outputTokens: 9 });
      const turn = JSON.parse(await readFile(join(f.root, "turn-0.json"), "utf8"));
      assert.deepEqual(turn.input, [{ type: "text", text: PROMPT, text_elements: [] }]);
      assert.deepEqual(turn.outputSchema, claim().invocation.output_schema);
      assert.equal(turn.effort, effort); assert.equal(turn.serviceTier, "priority");
      const thread = JSON.parse(await readFile(join(f.root, "thread-0.json"), "utf8"));
      assert.equal(thread.ephemeral, true); assert.deepEqual(thread.environments, []);
      assert.equal(thread.approvalPolicy, "never"); assert.equal(thread.sandbox, "read-only");
      assert.equal(thread.config.model_reasoning_effort, effort);
      assert.deepEqual(thread.config.mcp_servers, { inherited: { enabled: false, required: false } });
      const record = JSON.parse(await readFile(join(f.root, "record-0.json"), "utf8"));
      assert.equal(record.args[0], "app-server"); assert(!JSON.stringify(record.args).includes(PROMPT));
      assert.deepEqual(await readdir(f.options.tempRoot), []);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
}

for (const mode of ["auth", "version", "notify", "tooloverride", "mcpavailable", "managedinstructions", "tier", "effort",
  "tool", "imagegen", "approval", "missing-usage", "usage-invalid", "usage-turn", "rerouted", "malformed", "missing", "duplicate", "failed"]) {
  test(`ordinary text refuses ${mode} and never returns provider content`, async () => {
    const f = await jsonFixture(mode);
    try {
      const result = await runCodexInvocation({ claim: claim(), codexBin: f.executable, tempRoot: f.options.tempRoot, env: f.options.env });
      assert.equal(result.ok, false); assert(!JSON.stringify(result).includes("private"));
      if (["auth", "version", "notify", "tooloverride", "mcpavailable", "managedinstructions", "tier", "effort"].includes(mode)) {
        assert.equal(result.ok ? null : result.fatal, true);
        await assert.rejects(readFile(join(f.root, "turn-0.json")), { code: "ENOENT" });
      }
      assert.deepEqual(await readdir(f.options.tempRoot).catch((e) => { if (e.code === "ENOENT") return []; throw e; }), []);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
}

test("text response ceiling is 1 MiB and includes multibyte output bytes", async () => {
  const f = await jsonFixture("success", [{ answer: "é".repeat(CODEX_PROVIDER_MAX_RESPONSE_BYTES / 2) }]);
  try {
    const result = await runCodexInvocation({ claim: claim(), codexBin: f.executable, tempRoot: f.options.tempRoot, env: f.options.env });
    assert.equal(result.ok, false); assert.deepEqual(await readdir(f.options.tempRoot), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("ordinary text refuses inherited host instructions before a provider turn", async () => {
  const f = await jsonFixture();
  try {
    await writeFile(join(f.home, "AGENTS.md"), "Leaked host instruction");
    const result = await runCodexInvocation({ claim: claim(), codexBin: f.executable, env: f.options.env });
    assert.equal(result.ok, false); assert.equal(result.ok ? null : result.fatal, true);
    await assert.rejects(readFile(join(f.root, "launched")), { code: "ENOENT" });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("authentication requires ChatGPT status, not just a zero exit code", async () => {
  for (const mode of ["success", "auth"]) {
    const f = await jsonFixture(mode);
    try { assert.equal(await checkCodexAuthentication(f.executable, { env: f.options.env }), mode === "success"); }
    finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("timeout is bounded and removes private attempt files", async () => {
  const f = await jsonFixture("timeout");
  try {
    const result = await runCodexInvocation({ claim: { ...claim(), timeout_ms: 500 }, codexBin: f.executable, tempRoot: f.options.tempRoot, env: f.options.env });
    assert.deepEqual(result, { ok: false, code: "publisher_unavailable", safeDetailCode: "request_timeout", fatal: false });
    assert.deepEqual(await readdir(f.options.tempRoot), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
