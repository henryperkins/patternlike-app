import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CODEX_PROVIDER_MAX_RESPONSE_BYTES,
  runCodexInvocation,
} from "./codex-cli.js";
import type { CodexProviderClaim } from "./protocol.js";

const PROMPT = "private prompt that must only use stdin";
const OUTPUT = '{"answer":"private output"}';

function claim(overrides: Partial<CodexProviderClaim> = {}): CodexProviderClaim {
  return {
    schema_version: "codex-provider-claim/v1",
    job_id: `cpjob_${"a".repeat(32)}`,
    lease_token: "lease_0123456789abcdefghijklmnopqrstuvwxyz",
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
    prompt_version: "1.0.0",
    timeout_ms: 2_000,
    invocation: {
      schema_version: "codex-provider-invocation/v1",
      prompt: PROMPT,
      output_schema: {
        type: "object",
        additionalProperties: false,
        required: ["answer"],
        properties: { answer: { type: "string" } },
      },
    },
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-runner-test-"));
  const tempRoot = join(root, "attempts");
  const recordRoot = join(root, "record");
  await Promise.all([
    import("node:fs/promises").then(({ mkdir }) => mkdir(tempRoot, { mode: 0o700 })),
    import("node:fs/promises").then(({ mkdir }) => mkdir(recordRoot, { mode: 0o700 })),
  ]);
  const executable = join(root, "fake-codex.mjs");
  await writeFile(executable, `#!/usr/bin/env node
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const recordRoot = process.env.FAKE_CODEX_RECORD_ROOT;
const mode = process.env.FAKE_CODEX_MODE ?? "success";
let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;
await writeFile(join(recordRoot, "args.json"), JSON.stringify(args));
await writeFile(join(recordRoot, "stdin.txt"), prompt);
const schemaPath = args[args.indexOf("--output-schema") + 1];
const outputPath = args[args.indexOf("-o") + 1];
const modes = {
  directory: (await stat(dirname(schemaPath))).mode & 0o777,
  schema: (await stat(schemaPath)).mode & 0o777,
  output: (await stat(outputPath)).mode & 0o777,
};
await writeFile(join(recordRoot, "modes.json"), JSON.stringify(modes));
JSON.parse(await readFile(schemaPath, "utf8"));
if (mode === "hang") {
  await new Promise(() => setInterval(() => undefined, 1_000));
}
if (mode === "exit") process.exit(2);
if (mode === "oversized") {
  await writeFile(outputPath, "x".repeat(${CODEX_PROVIDER_MAX_RESPONSE_BYTES + 1}));
} else {
  await writeFile(outputPath, ${JSON.stringify(OUTPUT)});
  await chmod(outputPath, 0o600);
}
if (mode !== "missing-thread") {
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread_123" }) + "\\n");
}
if (mode !== "missing-usage") {
  process.stdout.write(JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 17, cached_input_tokens: 3, output_tokens: 9 },
  }) + "\\n");
}
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  return {
    executable,
    root,
    tempRoot,
    recordRoot,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("invokes Codex with the exact safe argument surface and stdin-only prompt", async () => {
  const f = await fixture();
  try {
    const result = await runCodexInvocation({
      claim: claim(),
      codexBin: f.executable,
      tempRoot: f.tempRoot,
      env: { ...process.env, FAKE_CODEX_RECORD_ROOT: f.recordRoot },
    });
    assert.deepEqual(result, {
      ok: true,
      output: OUTPUT,
      providerRequestId: "thread_123",
      inputTokens: 17,
      outputTokens: 9,
    });
    const args = JSON.parse(await readFile(join(f.recordRoot, "args.json"), "utf8"));
    assert.equal(args[0], "exec");
    assert.deepEqual(args.slice(1, 9), [
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--json",
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_reasoning_effort="high"',
    ]);
    assert.equal(args[9], "--output-schema");
    assert.equal(args[11], "-o");
    assert.equal(args[13], "-");
    assert.equal(args.length, 14);
    assert.equal(await readFile(join(f.recordRoot, "stdin.txt"), "utf8"), PROMPT);
    assert.deepEqual(
      JSON.parse(await readFile(join(f.recordRoot, "modes.json"), "utf8")),
      { directory: 0o700, schema: 0o600, output: 0o600 },
    );
    assert.deepEqual(await readdir(f.tempRoot), []);
  } finally {
    await f.cleanup();
  }
});

for (const mode of ["missing-thread", "missing-usage"] as const) {
  test(`fails closed for ${mode}`, async () => {
    const f = await fixture();
    try {
      const result = await runCodexInvocation({
        claim: claim(),
        codexBin: f.executable,
        tempRoot: f.tempRoot,
        env: {
          ...process.env,
          FAKE_CODEX_RECORD_ROOT: f.recordRoot,
          FAKE_CODEX_MODE: mode,
        },
      });
      assert.deepEqual(result, {
        ok: false,
        code: "publisher_output_invalid",
        safeDetailCode: "schema_mismatch",
        fatal: false,
      });
      assert.deepEqual(await readdir(f.tempRoot), []);
    } finally {
      await f.cleanup();
    }
  });
}

test("rejects output over the provider response ceiling and cleans up", async () => {
  const f = await fixture();
  try {
    const result = await runCodexInvocation({
      claim: claim(),
      codexBin: f.executable,
      tempRoot: f.tempRoot,
      env: {
        ...process.env,
        FAKE_CODEX_RECORD_ROOT: f.recordRoot,
        FAKE_CODEX_MODE: "oversized",
      },
    });
    assert.deepEqual(result, {
      ok: false,
      code: "publisher_output_invalid",
      safeDetailCode: "schema_mismatch",
      fatal: false,
    });
    assert.deepEqual(await readdir(f.tempRoot), []);
  } finally {
    await f.cleanup();
  }
});

test("terminates a timed-out child and cleans up", async () => {
  const f = await fixture();
  try {
    const result = await runCodexInvocation({
      claim: claim({ timeout_ms: 100 }),
      codexBin: f.executable,
      tempRoot: f.tempRoot,
      env: {
        ...process.env,
        FAKE_CODEX_RECORD_ROOT: f.recordRoot,
        FAKE_CODEX_MODE: "hang",
      },
    });
    assert.deepEqual(result, {
      ok: false,
      code: "publisher_unavailable",
      safeDetailCode: "request_timeout",
      fatal: false,
    });
    assert.deepEqual(await readdir(f.tempRoot), []);
  } finally {
    await f.cleanup();
  }
});
