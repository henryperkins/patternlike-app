import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tsImport } from "tsx/esm/api";
import { REPO_ROOT, sha256Hex } from "./candidates.mjs";

const subject = await import("./fresh-pattern-evaluation.mjs").catch(() => null);
const requireSubject = () => assert(subject, "Complete planner/writer/verifier evaluation is missing");

async function validProcessFixture() {
  const regression = await tsImport("../../apps/api/src/services/ontology-regression.ts", import.meta.url);
  const executor = await tsImport("../../apps/api/src/services/pattern-execute.ts", import.meta.url);
  const runnerFixture = await tsImport("../../apps/codex-runner/src/portrait-mesh-test-fixture.ts", import.meta.url);
  const outputs = ["m7-exact-01", "m7-unknown-01"].flatMap((id) => {
    const chain = regression.loadOntologyRegressionCorpus().fixtures.find((entry) => entry.fixture_id === id).chain;
    return [executor.narrowPlannerOutput(chain.plan), chain.writer,
      { schema_version: "0.7.0", verdict: "pass", findings: [] }];
  });
  return runnerFixture.jsonFixture("success", outputs);
}

async function withProcessEnv(values, run) {
  const original = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    return await run();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("caller-controlled executable or environment cannot attest provider observation even when every chain validates", async () => {
  requireSubject();
  const root = mkdtempSync(join(tmpdir(), "fresh-pattern-provenance-"));
  let binaryFixture, envFixture;
  try {
    binaryFixture = await validProcessFixture();
    const binaryReport = await withProcessEnv({ HOME: binaryFixture.options.env.HOME,
      CODEX_HOME: binaryFixture.options.env.CODEX_HOME, PATH: binaryFixture.options.env.PATH }, () =>
      subject.runFreshPatternEvaluation({ destination: join(root, "binary"), codexBin: binaryFixture.executable }));

    envFixture = await validProcessFixture();
    copyFileSync(envFixture.executable, join(envFixture.root, "codex"), 0);
    const envReport = await subject.runFreshPatternEvaluation({ destination: join(root, "env"), env: {
      ...envFixture.options.env, PATH: `${envFixture.root}:${dirname(process.execPath)}`,
    } });

    for (const report of [binaryReport, envReport]) {
      assert.equal(report.accepted, 2);
      assert.equal(report.execution_kind, "unverified_process");
      assert.equal(report.provider_samples_observed, false);
      assert.equal(report.fresh_generation_chains, false);
      assert.equal(report.passed, false);
      assert(report.cases.every((entry) => entry.status === "accepted"));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    for (const fixture of [binaryFixture, envFixture]) {
      if (fixture) rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("invalid fresh planners stop their chain and retained failures cannot become provider evidence", async () => {
  requireSubject();
  const root = mkdtempSync(join(tmpdir(), "fresh-pattern-invalid-"));
  try {
    let calls = 0;
    const report = await subject.runFreshPatternEvaluation({ destination: join(root, "run"),
      invoke: async () => { calls++; return { ok: true, output: '{"private_marker":"invalid plan"}',
        providerRequestId: "fixture-request", inputTokens: 10, outputTokens: 5 }; } });
    assert.equal(calls, 2);
    assert.equal(report.accepted, 0);
    assert.equal(report.provider_samples_observed, false);
    assert.equal(report.passed, false);
    assert(report.cases.every((entry) => entry.status === "planner_rejected"));
    assert(!JSON.stringify(report).includes("private_marker"));
    assert(JSON.parse(readFileSync(join(root, "run", report.cases[0].stages[0].sample_file), "utf8")).output.includes("private_marker"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("each writer and verifier consumes the output of its own preceding real application stage", async () => {
  requireSubject();
  const regression = await tsImport("../../apps/api/src/services/ontology-regression.ts", import.meta.url);
  const executor = await tsImport("../../apps/api/src/services/pattern-execute.ts", import.meta.url);
  const fixtures = regression.loadOntologyRegressionCorpus().fixtures;
  const root = mkdtempSync(join(tmpdir(), "fresh-pattern-chain-"));
  try {
    const seen = [];
    const report = await subject.runFreshPatternEvaluation({ destination: join(root, "run"), codexBin: "not-executed",
      env: { PATH: "not-executed" },
      invoke: async ({ claim }) => {
        const fixtureId = ["m7-exact-01", "m7-unknown-01"][Math.floor(seen.length / 3)];
        const pass = ["planner", "writer", "verifier"][seen.length % 3];
        const fixture = structuredClone(fixtures.find((entry) => entry.fixture_id === fixtureId).chain);
        fixture.plan.chapters[0].working_title += " review sample";
        fixture.writer.chapters[0].title += " review sample";
        seen.push(pass);
        if (pass === "writer") assert(claim.invocation.prompt.includes(fixture.plan.chapters[0].working_title));
        if (pass === "verifier") assert(claim.invocation.prompt.includes(fixture.writer.chapters[0].title));
        const output = pass === "planner" ? executor.narrowPlannerOutput(fixture.plan) : pass === "writer" ? fixture.writer :
          { schema_version: "0.7.0", verdict: "pass", findings: [] };
        return { ok: true, output: JSON.stringify(output), providerRequestId: "fixture-request", inputTokens: 10, outputTokens: 5 };
      } });
    assert.deepEqual(seen, ["planner", "writer", "verifier", "planner", "writer", "verifier"]);
    assert.equal(report.accepted, 2);
    assert.equal(report.execution_kind, "test_double");
    assert.equal(report.fresh_end_to_end_patterns, false);
    assert.equal(report.production_account_exercised, false);
    assert.equal(report.independent_review.status, "unverified");
    assert.equal(report.passed, false);
    assert(report.cases.every((entry) => entry.stages.length === 3));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("unexpected verifier codes stay private and incoherent verdicts and refusals cannot pass", async () => {
  requireSubject();
  const regression = await tsImport("../../apps/api/src/services/ontology-regression.ts", import.meta.url);
  const executor = await tsImport("../../apps/api/src/services/pattern-execute.ts", import.meta.url);
  const fixtures = regression.loadOntologyRegressionCorpus().fixtures;
  const root = mkdtempSync(join(tmpdir(), "fresh-pattern-semantic-"));
  const finding = { code: "private_verifier_marker", severity: "error", target_key: null,
    feature_aliases: [], ontology_rule_ids: [], rationale: "private rationale" };
  try {
    for (const [name, verdict, expected] of [
      ["unknown", { verdict: "reject", findings: [finding] }, "verdict_finding_code_unknown"],
      ["incoherent", { verdict: "pass", findings: [{ ...finding, code: "claim_not_entailed" }] }, "verdict_incoherent"],
      ["refusal", { verdict: "reject", findings: [] }, "semantic_refusal"],
    ]) {
      let calls = 0;
      const report = await subject.runFreshPatternEvaluation({ destination: join(root, name), invoke: async () => {
        const fixture = fixtures.find((entry) => entry.fixture_id === ["m7-exact-01", "m7-unknown-01"][Math.floor(calls / 3)]).chain;
        const pass = calls++ % 3;
        const output = pass === 0 ? executor.narrowPlannerOutput(fixture.plan) : pass === 1 ? fixture.writer :
          { schema_version: "0.7.0", ...verdict };
        return { ok: true, output: JSON.stringify(output), providerRequestId: "fixture-request", inputTokens: 10, outputTokens: 5 };
      } });
      assert.equal(calls, 6);
      assert.equal(report.accepted, 0);
      assert(report.cases.every((entry) => entry.status === "verifier_rejected" && entry.stages[2].finding_codes.includes(expected)));
      assert(!JSON.stringify(report).includes("private_verifier_marker"));
      assert(!JSON.stringify(report).includes("private rationale"));
      const sample = join(root, name, report.cases[0].stages[2].sample_file);
      if (name === "unknown") assert(JSON.parse(readFileSync(sample, "utf8")).output.includes("private_verifier_marker"));
      assert.equal(statSync(sample).mode & 0o777, 0o600);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("malformed completion metadata retains bounded output privately with its original hash", async () => {
  requireSubject();
  const root = mkdtempSync(join(tmpdir(), "fresh-pattern-metadata-"));
  const output = "private malformed completion " + "🌙".repeat(300_000);
  try {
    const report = await subject.runFreshPatternEvaluation({ destination: join(root, "run"), invoke: async () => ({
      ok: true, output, providerRequestId: "", inputTokens: 10, outputTokens: 5,
    }) });
    const stage = report.cases[0].stages[0];
    const saved = JSON.parse(readFileSync(join(root, "run", stage.sample_file), "utf8"));
    assert.equal(report.transport_failures, 1);
    assert.equal(report.cases[1].status, "not_attempted");
    assert.equal(saved.output_sha256, sha256Hex(output));
    assert.equal(saved.output_bytes, Buffer.byteLength(output));
    assert.equal(saved.output_truncated, true);
    assert(Buffer.byteLength(saved.output) <= 1024 * 1024);
    assert(output.startsWith(saved.output));
    assert(!JSON.stringify(report).includes("private malformed completion"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("source drift prevents another stage from spending a provider call", async () => {
  requireSubject();
  const regression = await tsImport("../../apps/api/src/services/ontology-regression.ts", import.meta.url);
  const executor = await tsImport("../../apps/api/src/services/pattern-execute.ts", import.meta.url);
  const fixture = regression.loadOntologyRegressionCorpus().fixtures.find((entry) => entry.fixture_id === "m7-exact-01");
  const root = mkdtempSync(join(tmpdir(), "fresh-pattern-drift-"));
  const marker = `scripts/pattern-release/.fresh-pattern-drift-${process.pid}.tmp`;
  const path = join(REPO_ROOT, marker);
  try {
    let calls = 0;
    const report = await subject.runFreshPatternEvaluation({ destination: join(root, "run"), invoke: async () => {
      calls++;
      writeFileSync(path, "changed during the provider call\n", { flag: "wx", mode: 0o600 });
      return { ok: true, output: JSON.stringify(executor.narrowPlannerOutput(fixture.chain.plan)),
        providerRequestId: "fixture-request", inputTokens: 10, outputTokens: 5 };
    } });
    assert.equal(calls, 1);
    assert.equal(report.cases[0].status, "source_changed");
    assert.equal(report.cases[1].status, "not_attempted");
    assert.equal(report.source_comparison.ok, false);
    assert(report.source_comparison.added.includes(marker));
    assert.equal(report.passed, false);
  } finally { rmSync(path, { force: true }); rmSync(root, { recursive: true, force: true }); }
});

test("fatal transport failure prevents further claims and cancellation spends no calls", async () => {
  requireSubject();
  const root = mkdtempSync(join(tmpdir(), "fresh-pattern-abort-"));
  try {
    let calls = 0;
    const failed = await subject.runFreshPatternEvaluation({ destination: join(root, "failed"), invoke: async () => {
      calls++; return { ok: false, code: "publisher_auth_failed", safeDetailCode: "authentication_failed", fatal: true };
    } });
    assert.equal(calls, 1);
    assert.equal(failed.transport_failures, 1);
    assert.equal(failed.cases[1].status, "not_attempted");
    const cancelled = await subject.runFreshPatternEvaluation({ destination: join(root, "cancelled"),
      signal: AbortSignal.abort(), invoke: async () => { throw new Error("Must not run"); } });
    assert(cancelled.cases.every((entry) => entry.status === "not_attempted"));
    assert.equal(cancelled.passed, false);
    await assert.rejects(subject.runFreshPatternEvaluation({ destination: join(root, "failed") }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
