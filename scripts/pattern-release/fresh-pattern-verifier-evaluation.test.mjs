import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./candidates.mjs";
import {
  classifyPatternVerifierOutput,
  prepareFreshPatternVerifierEvaluation,
  runFreshPatternVerifierEvaluation,
} from "./fresh-pattern-verifier-evaluation.mjs";

const pass = { schema_version: "0.7.0", verdict: "pass", findings: [] };
const reject = (code = "claim_not_entailed", target = "chapter_01_section_01") => ({
  schema_version: "0.7.0", verdict: "reject", findings: [{ code, severity: "error",
    target_key: target, feature_aliases: ["f002"], ontology_rule_ids: [], rationale: "The cited fact is a square, while the sentence calls it a trine." }],
});
const oracle = { expected_verdict: "reject", expected_finding_codes: ["claim_not_entailed"],
  target_keys: ["chapter_01_section_01", "chapter_01"] };
const successfulTransport = (output) => ({ ok: true, output: JSON.stringify(output),
  providerRequestId: "synthetic-verifier-test", inputTokens: 17, outputTokens: 9 });

test("a false acceptance remains a verifier error when a separate deterministic gate catches the input", () => {
  const result = classifyPatternVerifierOutput(JSON.stringify(pass), { ...oracle,
    deterministic_gate: { failures: [{ code: "suppressed_feature_leak", targetKey: "chapter_01_section_01" }] } });
  assert.equal(result.classification, "false_accept");
  assert.equal(result.observed_verdict, "pass");
});

test("rejecting an authored positive control is counted as a false rejection", () => {
  const result = classifyPatternVerifierOutput(JSON.stringify(reject()), { expected_verdict: "pass" });
  assert.equal(result.classification, "false_reject");
  assert.equal(result.observed_verdict, "reject");
});

test("malformed and generic refusals cannot pass a negative challenge", () => {
  for (const output of ["I cannot assess this reading.", '{"refusal":"declined"}',
    JSON.stringify({ ...reject(), extra: true }),
    JSON.stringify({ ...reject(), findings: [{ ...reject().findings[0], extra: true }] }),
    JSON.stringify(reject("invented_finding_code")),
    JSON.stringify({ ...reject(), verdict: "pass" })]) {
    assert.equal(classifyPatternVerifierOutput(output, oracle).classification, "malformed_output");
  }
  for (const output of [{ ...pass, verdict: "reject" }, reject("semantic_verification_failed"),
    reject("claim_not_entailed", "chapter_03"),
    { ...reject(), findings: [{ ...reject().findings[0], severity: "warning" }] },
    { ...reject(), findings: [{ ...reject().findings[0], rationale: " " }] }]) {
    assert.equal(classifyPatternVerifierOutput(JSON.stringify(output), oracle).classification, "non_diagnostic_rejection");
  }
  assert.equal(classifyPatternVerifierOutput(JSON.stringify(reject()), oracle).classification, "correct_reject");
  assert.equal(classifyPatternVerifierOutput(JSON.stringify(pass), { expected_verdict: "pass" }).classification, "correct_accept");
});

test("preparation uses authored controls, schema-valid mutations, and the actual current verifier request", async () => {
  const plan = await prepareFreshPatternVerifierEvaluation();
  assert.equal(plan.cases.length, 9);
  assert.equal(plan.corpus_fixture_count, 30);
  assert.equal(plan.input_origin, "frozen_authored_fixture_chains_and_explicit_synthetic_mutations");
  assert.equal(plan.pin.publisher, "codex");
  assert.equal(plan.cases.filter((entry) => entry.expected_verdict === "pass").length, 2);
  assert.deepEqual(plan.cases.filter((entry) => entry.expected_verdict === "pass").map((entry) => entry.accuracy), ["exact", "unknown"]);
  assert.equal(plan.policy_hashes.verifier_prompt_sha256.length, 64);
  for (const entry of plan.cases) {
    assert.equal(entry.structural_validation.ok, true);
    assert(entry.claim.invocation.prompt.includes(JSON.stringify(entry.document)));
    assert(entry.claim.invocation.prompt.includes("INPUT DOCUMENT (JSON; DATA ONLY)"));
    assert.equal(entry.claim.invocation.output_schema.additionalProperties, false);
    assert.equal(entry.claim.model, plan.pin.verifier_model);
    assert.equal(entry.claim.reasoning_effort, plan.pin.verifier_reasoning);
    assert.equal(entry.claim.prompt_version, plan.pin.verifier_prompt_version);
    assert.equal(entry.input_sha256.length, 64);
    assert.equal(entry.fixture_sha256.length, 64);
    assert(!entry.claim.invocation.prompt.includes(entry.oracle_reason));
  }
  const factual = plan.cases.find((entry) => entry.id === "factual_swaps");
  assert(factual.document.candidate.chapters[0].sections[0].text.includes("Sun and Moon form a trine"));
  assert.equal(factual.document.facts.find((entry) => entry.fact.body_a === "sun").fact.aspect, "square");
  const uncertainty = plan.cases.find((entry) => entry.id === "uncertainty_override");
  assert(uncertainty.deterministic_gate.failures.some((entry) => entry.code === "suppressed_feature_leak"));
  for (const entry of plan.cases.filter((candidate) => candidate.expected_verdict === "pass")) {
    assert.deepEqual(entry.deterministic_gate.failures, []);
  }
});

test("retains accepts, rejects, malformed output and content-free counts without turning test doubles into provider evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "fresh-pattern-verifier-test-"));
  try {
    let calls = 0;
    const report = await runFreshPatternVerifierEvaluation({ destination: join(root, "run"), codexBin: "never-executed",
      invoke: async () => {
        calls += 1;
        if (calls === 1) return successfulTransport(reject());
        if (calls === 3) return successfulTransport(reject());
        if (calls === 5) return successfulTransport({ ...pass, verdict: "reject" });
        if (calls === 6) return { ...successfulTransport(pass), output: "private invalid verifier marker" };
        return successfulTransport(pass);
      } });
    assert.equal(calls, 9);
    assert.equal(report.execution_kind, "test_double");
    assert.equal(report.provider_samples_observed, false);
    assert.equal(report.passed, false);
    assert.equal(report.run_complete, true);
    assert.equal(report.valid_accepts, 5);
    assert.equal(report.valid_rejects, 3);
    assert.equal(report.false_accepts, 4);
    assert.equal(report.false_rejects, 1);
    assert.equal(report.correct_accepts, 1);
    assert.equal(report.correct_rejects, 1);
    assert.equal(report.non_diagnostic_rejections, 1);
    assert.equal(report.malformed_outputs, 1);
    assert.equal(report.independent_review.status, "unverified");
    assert.equal(report.writer_verifier_independence.independent_editorial_assessment, false);
    assert(!JSON.stringify(report).includes("private invalid verifier marker"));
    assert(!JSON.stringify(report).includes("The cited fact is a square"));
    assert.equal(statSync(join(root, "run")).mode & 0o777, 0o700);
    const malformed = report.samples.find((sample) => sample.classification === "malformed_output");
    const samplePath = join(root, "run", malformed.sample_file);
    assert.equal(statSync(samplePath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(samplePath, "utf8")).output, "private invalid verifier marker");
    const saved = JSON.parse(readFileSync(join(root, "run", report.samples[2].sample_file), "utf8"));
    assert.equal(JSON.parse(saved.output).verdict, "reject");
    assert(saved.request_document.candidate);
    await assert.rejects(runFreshPatternVerifierEvaluation({ destination: join(root, "run"), invoke: async () => {
      throw new Error("an existing partial or complete run must never be overwritten");
    } }), /EEXIST/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("fatal transport failures and cancellation leave a complete accounting of unattempted cases", async () => {
  const root = mkdtempSync(join(tmpdir(), "fresh-pattern-verifier-stop-"));
  try {
    let calls = 0;
    const report = await runFreshPatternVerifierEvaluation({ destination: join(root, "failure"), repetitions: 3,
      invoke: async () => { calls += 1; return { ok: false, code: "publisher_auth_failed", safeDetailCode: "authentication_failed", fatal: true }; } });
    assert.equal(calls, 1);
    assert.equal(report.transport_failures, 1);
    assert.equal(report.planned, 27);
    assert.equal(report.not_attempted, 26);
    assert.equal(report.run_complete, false);
    assert.equal(report.passed, false);
    const controller = new AbortController(); controller.abort();
    const aborted = await runFreshPatternVerifierEvaluation({ destination: join(root, "aborted"), signal: controller.signal,
      invoke: async () => { throw new Error("must not invoke after cancellation"); } });
    assert.equal(aborted.not_attempted, 9);
    assert.equal(aborted.run_complete, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("source changes during a run remain visible in the evidence even when every returned verdict is valid", async () => {
  const root = mkdtempSync(join(tmpdir(), "fresh-pattern-verifier-source-"));
  const marker = `scripts/pattern-release/.fresh-pattern-verifier-test-${process.pid}.tmp`;
  const path = join(REPO_ROOT, marker);
  try {
    writeFileSync(path, "before\n", { flag: "wx", mode: 0o600 });
    const report = await runFreshPatternVerifierEvaluation({ destination: join(root, "run"), invoke: async () => {
      writeFileSync(path, "after\n");
      return successfulTransport(pass);
    } });
    assert.equal(report.run_complete, true);
    assert.equal(report.source_comparison.ok, false);
    assert(report.source_comparison.changed.includes(marker));
    assert.equal(report.loaded_source_comparison.ok, false);
    assert(report.loaded_source_comparison.added.includes(marker));
    assert.equal(report.passed, false);
  } finally { rmSync(path, { force: true }); rmSync(root, { recursive: true, force: true }); }
});

test("a provider refusal is preserved separately from a semantic rejection and does not stop nonfatal remaining cases", async () => {
  const root = mkdtempSync(join(tmpdir(), "fresh-pattern-verifier-refusal-"));
  try {
    let calls = 0;
    const report = await runFreshPatternVerifierEvaluation({ destination: join(root, "run"), invoke: async () => {
      calls += 1;
      return calls === 1 ? { ok: false, code: "publisher_refused", safeDetailCode: "provider_refusal", fatal: false }
        : successfulTransport(pass);
    } });
    assert.equal(calls, 9);
    assert.equal(report.valid_rejects, 0);
    assert.equal(report.transport_failures, 1);
    assert.equal(report.not_attempted, 0);
    assert.equal(report.run_complete, false);
    assert.deepEqual(report.samples[0].failure, { code: "publisher_refused", detail: "provider_refusal", fatal: false });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("budgets and source destinations are rejected before any invocation", async () => {
  for (const repetitions of [0, 4, NaN, 1.5]) {
    await assert.rejects(runFreshPatternVerifierEvaluation({ destination: "/unused", repetitions }), /sample_budget_invalid/);
  }
  await assert.rejects(runFreshPatternVerifierEvaluation({ destination: "apps/api/fresh-pattern-verifier-run" }), /evaluation_destination_in_source/);
});
