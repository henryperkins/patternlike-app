import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./candidates.mjs";
import { prepareFreshReadingEvaluation, runFreshReadingEvaluation } from "./fresh-reading-evaluation.mjs";

test("fresh evaluation prepares every synthetic shape with the real prompt and frozen validator inputs", async () => {
  const plan = await prepareFreshReadingEvaluation();
  assert.equal(plan.cases.length, 6);
  assert.equal(plan.pin.prompt_version, "1.0.3");
  assert.equal(new Set(plan.cases.map((entry) => entry.shape)).size, 6);
  for (const entry of plan.cases) {
    assert(entry.claim.invocation.prompt.includes(JSON.stringify(entry.prepared.request)));
    assert(entry.claim.invocation.prompt.includes("INPUT DOCUMENT (JSON; DATA ONLY)"));
    assert(!Object.hasOwn(entry, "candidate"));
    assert.equal(entry.claim.model, plan.pin.model);
    assert.equal(entry.claim.reasoning_effort, plan.pin.reasoning_effort);
  }
});

test("rejected fresh output is retained and a test double cannot become fresh-provider evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "fresh-reading-eval-test-"));
  try {
    let calls = 0;
    const report = await runFreshReadingEvaluation({ destination: join(root, "run"), codexBin: "not-executed",
      invoke: async () => { calls += 1; return { ok: true, output: '{"invented":"private provider marker"}',
        providerRequestId: `synthetic-${calls}`, inputTokens: 17, outputTokens: 9 }; } });
    assert.equal(calls, 6); assert.equal(report.execution_kind, "test_double");
    assert.equal(report.provider_samples_observed, false); assert.equal(report.accepted, 0);
    assert.equal(report.rejected, 6); assert.equal(report.passed, false);
    assert.equal(report.independent_review.status, "unverified");
    assert(!JSON.stringify(report).includes("private provider marker"));
    assert.equal(report.samples.every((sample) => sample.output_sha256?.length === 64), true);
    const first = JSON.parse(readFileSync(join(root, "run", report.samples[0].sample_file), "utf8"));
    assert.equal(first.output, '{"invented":"private provider marker"}');
    assert(first.findings.length > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("fatal transport failure stops remaining calls, retains the failure and leaves evaluation incomplete", async () => {
  const root = mkdtempSync(join(tmpdir(), "fresh-reading-eval-failure-"));
  try {
    let calls = 0;
    const report = await runFreshReadingEvaluation({ destination: join(root, "run"), codexBin: "not-executed",
      invoke: async () => { calls += 1; return { ok: false, code: "publisher_auth_failed", safeDetailCode: "authentication_failed", fatal: true }; } });
    assert.equal(calls, 1); assert.equal(report.not_attempted, 5);
    assert.equal(report.transport_failures, 1); assert.equal(report.passed, false);
    assert.equal(report.provider_samples_observed, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sample budget is bounded before any invocation", async () => {
  for (const repetitions of [0, 4, NaN, 1.5]) {
    await assert.rejects(runFreshReadingEvaluation({ destination: "/unused", repetitions }), /sample_budget_invalid/);
  }
});

test("edits after application import cannot be attributed to cached code or invoke the provider", async () => {
  const root = mkdtempSync(join(tmpdir(), "fresh-reading-source-"));
  const marker = `scripts/pattern-release/.fresh-reading-source-${process.pid}.tmp`;
  const path = join(REPO_ROOT, marker);
  try {
    writeFileSync(path, "source changed after import\n", { flag: "wx", mode: 0o600 });
    let calls = 0;
    const report = await runFreshReadingEvaluation({ destination: join(root, "run"), invoke: async () => {
      calls += 1; throw new Error("must not invoke stale source");
    } });
    assert.equal(calls, 0);
    assert.equal(report.loaded_source_comparison.ok, false);
    assert(report.loaded_source_comparison.added.includes(marker));
    assert.equal(report.not_attempted, 6);
    assert.equal(report.passed, false);
  } finally { rmSync(path, { force: true }); rmSync(root, { recursive: true, force: true }); }
});
