import assert from "node:assert/strict";
import { writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { jsonFixture } from "./portrait-mesh-test-fixture.js";
import { runIsolatedCodexJson } from "./isolated-codex-json.js";


test("isolated JSON turns preserve multimodal input/schema and enforce ChatGPT-only tool-free configuration", async () => {
  const f = await jsonFixture();
  try {
    const out = await runIsolatedCodexJson(f.options);
    assert.deepEqual(out.value, { answer: "complete" });
    assert.equal(out.providerRequestId, "11111111-2222-4333-8444-555555555555:turn-1");
    const turn = JSON.parse(await readFile(join(f.root, "turn-0.json"), "utf8"));
    assert.deepEqual(turn.input, f.options.input); assert.deepEqual(turn.outputSchema, f.options.outputSchema);
    const thread = JSON.parse(await readFile(join(f.root, "thread-0.json"), "utf8"));
    assert.equal(thread.ephemeral, true); assert.equal(thread.sandbox, "read-only"); assert.equal(thread.approvalPolicy, "never");
    assert.deepEqual(thread.environments, []);
    assert.deepEqual(thread.config.mcp_servers, { inherited: { enabled: false, required: false } });
    const record = JSON.parse(await readFile(join(f.root, "record-0.json"), "utf8"));
    for (const name of ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_RUNNER_TOKEN", "OPENAI_BASE_URL"]) assert.equal(record.env[name], undefined);
    assert(record.args.some((arg: string, index: number) => arg === "--disable" && record.args[index + 1] === "image_generation"));
    for (const feature of ["view_image", "sleep_tool", "code_mode_host", "goals", "skill_search", "request_permissions_tool"]) assert(record.args.some((arg: string, index: number) => arg === "--disable" && record.args[index + 1] === feature));
    assert(record.args.includes("tools.update_plan.enabled=false"));
    assert(record.args.includes("tools.experimental_request_user_input.enabled=false"));
    assert.deepEqual(await readdir(join(f.root, "attempts")).catch((error) => { if (error.code === "ENOENT") return []; throw error; }), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("accepts a newer Codex CLI when the runtime isolation contract passes", async () => {
  const f = await jsonFixture("newversion");
  try {
    const out = await runIsolatedCodexJson(f.options);
    assert.deepEqual(out.value, { answer: "complete" });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const mode of ["tooloverride", "missinglayers", "toolorigin", "version", "auth", "wronghome", "notify", "managedinstructions", "imageenabled", "mcpavailable", "sandbox", "approvalpolicy", "approval", "tool", "imagegen", "malformed", "oversized", "missing", "duplicate", "wrongturn", "failed", "timeout"]) {
  test(`isolated JSON rejects ${mode} without exposing provider content`, async () => {
    const f = await jsonFixture(mode);
    try {
      await assert.rejects(runIsolatedCodexJson({ ...f.options, timeoutMs: mode === "timeout" ? 250 : 5_000 }), (error: Error) => !error.message.includes("private"));
      assert.deepEqual(await readdir(join(f.root, "attempts")).catch((error) => { if (error.code === "ENOENT") return []; throw error; }), []);
      if (["tooloverride", "missinglayers", "toolorigin", "version", "auth", "wronghome", "notify", "managedinstructions", "imageenabled", "mcpavailable", "sandbox", "approvalpolicy"].includes(mode)) await assert.rejects(readFile(join(f.root, "turn-0.json")), { code: "ENOENT" });
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
}

test("global instructions and already aborted JSON turns do not launch a child", async () => {
  const f = await jsonFixture();
  try {
    await assert.rejects(runIsolatedCodexJson({ ...f.options, signal: AbortSignal.abort() }));
    await writeFile(join(f.home, "AGENTS.md"), "Do not consume these host instructions.");
    await assert.rejects(runIsolatedCodexJson(f.options));
    await assert.rejects(readFile(join(f.root, "launched")), { code: "ENOENT" });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
