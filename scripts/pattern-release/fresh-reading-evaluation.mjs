#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import { REPO_ROOT, canonicalJson, sha256Hex } from "./candidates.mjs";
import { captureSourceSnapshot, compareSourceSnapshots } from "./release-evidence.mjs";

// Bind imported code to its source bytes before the module cache can outlive an edit.
const loadedSource = captureSourceSnapshot(REPO_ROOT);
const evaluation = await tsImport("../../apps/api/src/services/reading-evaluation.ts", import.meta.url);
const prompt = await tsImport("../../apps/api/src/services/reading-prompt.ts", import.meta.url);
const publisher = await tsImport("../../apps/api/src/services/reading-publisher.ts", import.meta.url);
const contract = await tsImport("../../apps/api/src/services/codex-provider-contract.ts", import.meta.url);
const runner = await tsImport("../../apps/codex-runner/src/codex-cli.ts", import.meta.url);
const engine = await tsImport("../../packages/reading-engine/src/index.ts", import.meta.url);

/** Real preparation and prompt conversion; frozen synthetic candidate prose is never used. */
export async function prepareFreshReadingEvaluation() {
  const corpus = evaluation.loadEvaluationCorpus();
  const pin = {
    provider: publisher.READING_PUBLISHER_PROVIDER, model: publisher.OPENAI_READING_MODEL,
    reasoning_effort: publisher.OPENAI_READING_REASONING, prompt_version: publisher.READING_PROMPT_VERSION,
    output_schema: "daily-reading-v5", selection_policy_version: engine.SELECTION_POLICY_VERSION,
    validation_policy_version: engine.VALIDATION_POLICY_VERSION,
    max_output_tokens: publisher.OPENAI_READING_MAX_OUTPUT_TOKENS, context_max_bytes: publisher.READING_CONTEXT_MAX_BYTES,
  };
  const cases = Object.entries(corpus.profiles).map(([id, profile], index) => {
    const prepared = evaluation.prepareProfile(corpus, id);
    const converted = contract.invocationFromResponsesRequest(prompt.buildResponsesRequest(prepared.request, pin), {
      model: pin.model, reasoningEffort: pin.reasoning_effort,
    });
    if (!converted.ok) throw new Error("evaluation_invocation_invalid");
    return { id, shape: profile.shape, prepared,
      claim: { schema_version: "codex-provider-claim/v1", job_id: `cpjob_${index.toString(16).padStart(32, "0")}`,
        lease_token: "synthetic_evaluation_not_a_worker_lease", model: pin.model,
        reasoning_effort: pin.reasoning_effort, prompt_version: pin.prompt_version,
        timeout_ms: contract.CODEX_PROVIDER_TIMEOUT_MS, invocation: converted.value } };
  });
  return { pin, corpus_version: corpus.corpus_version, cases };
}

const hash = (value) => createHash("sha256").update(value).digest("hex");
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
function requireDestination(destination) {
  const path = resolve(destination);
  const fromRoot = relative(REPO_ROOT, path);
  if (fromRoot !== ".." && !fromRoot.startsWith("../")
    && !["docs/reviews/", "docs/superpowers/", "output/"].some((prefix) => fromRoot.startsWith(prefix))) throw new Error("evaluation_destination_in_source");
  return path;
}

/** No Worker/account calls. Only fixed fictional inputs reach the selected Codex process. */
export async function runFreshReadingEvaluation({ destination, codexBin = "codex", env,
  repetitions = 1, invoke, signal } = {}) {
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 3) throw new Error("sample_budget_invalid");
  const directory = requireDestination(destination);
  const plan = await prepareFreshReadingEvaluation();
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory, { mode: 0o700 }); // Refuse existing runs, including partial ones.
  const source = captureSourceSnapshot(REPO_ROOT);
  const loadedComparison = compareSourceSnapshots(loadedSource, source);
  const startedAt = new Date().toISOString();
  const samples = [];
  let stopped = !loadedComparison.ok;
  const execute = invoke ?? runner.runCodexInvocation;
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const entry of plan.cases) {
      const id = `${entry.id}-${repetition}`;
      if (stopped || signal?.aborted) { samples.push({ id, profile: entry.id, status: "not_attempted" }); continue; }
      const started = new Date().toISOString();
      const result = await execute({ claim: entry.claim, codexBin, env, signal });
      const sampleFile = `${id}.json`;
      const identity = { id, profile: entry.id, shape: entry.shape, started_at: started,
        completed_at: new Date().toISOString(), invocation_sha256: hash(canonicalJson(entry.claim.invocation)), sample_file: sampleFile };
      if (!result.ok) {
        const failure = { code: result.code, detail: result.safeDetailCode, fatal: result.fatal };
        samples.push({ ...identity, status: "transport_failed", failure });
        await write(join(directory, sampleFile), { ...identity, failure });
        stopped = result.fatal;
        continue;
      }
      let candidate; let findings;
      try { candidate = JSON.parse(result.output); findings = evaluation.hardGateFindings(entry.prepared, candidate); }
      catch { findings = [{ code: "schema", detail_code: "invalid_candidate" }]; }
      // Quality helpers expect the accepted shape. A malformed candidate already failed.
      const qualitative = findings.length ? [] : evaluation.qualitativeFindings(entry.prepared, candidate);
      const metadata = { ...identity, status: findings.length ? "rejected" : "accepted",
        output_sha256: hash(result.output), provider_request_sha256: hash(result.providerRequestId),
        input_tokens: result.inputTokens, output_tokens: result.outputTokens, findings, qualitative };
      samples.push(metadata);
      await write(join(directory, sampleFile), { ...metadata, request: entry.prepared.request, output: result.output });
    }
  }
  const comparison = compareSourceSnapshots(source, captureSourceSnapshot(REPO_ROOT));
  const count = (status) => samples.filter((entry) => entry.status === status).length;
  const accepted = count("accepted"), rejected = count("rejected"), transportFailures = count("transport_failed");
  const report = {
    schema_version: "fresh-reading-evaluation.v1", execution_kind: invoke ? "test_double" : "codex_process",
    provider_samples_observed: !invoke && accepted + rejected > 0,
    input_origin: "fixed_fictional_profiles", production_account_exercised: false,
    started_at: startedAt, completed_at: new Date().toISOString(),
    source_snapshot_sha256: source.files_sha256, base_commit: source.base_commit,
    worktree_has_changes: source.worktree_has_changes, source_comparison: comparison,
    loaded_source_comparison: loadedComparison,
    pin: plan.pin, corpus_version: plan.corpus_version, text_isolation_version: runner.CODEX_TEXT_ISOLATION_VERSION,
    planned: plan.cases.length * repetitions, accepted, rejected, transport_failures: transportFailures,
    not_attempted: count("not_attempted"), samples,
    independent_review: { status: "unverified", criteria: ["fact_to_sentence_support", "uncertainty", "safety", "context_attribution", "usefulness"],
      note: "Automatic acceptance does not establish psychological truth or independent editorial approval." },
    passed: !invoke && loadedComparison.ok && comparison.ok && accepted === plan.cases.length * repetitions,
  };
  await write(join(directory, "loaded-source-snapshot.json"), loadedSource);
  await write(join(directory, "source-snapshot.json"), source);
  await write(join(directory, "report.json"), report);
  return report;
}

async function main() {
  const [mode, destination, codexBin, repeats, ...extra] = process.argv.slice(2);
  if (extra.length || !destination || !["prepare", "run"].includes(mode)) throw new Error("evaluation_arguments_invalid");
  if (mode === "prepare") {
    if (codexBin || repeats) throw new Error("evaluation_arguments_invalid");
    const plan = await prepareFreshReadingEvaluation();
    const path = requireDestination(destination);
    await mkdir(dirname(path), { recursive: true });
    await write(path, { schema_version: "fresh-reading-evaluation-plan.v1", provider_invoked: false, pin: plan.pin,
      source_snapshot_sha256: loadedSource.files_sha256,
      corpus_version: plan.corpus_version, cases: plan.cases.map(({ id, shape, claim }) => ({ id, shape, invocation_sha256: sha256Hex(canonicalJson(claim.invocation)) })) });
    process.stdout.write("Prepared six fictional profiles; no provider invoked.\n");
  } else {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    try {
      const report = await runFreshReadingEvaluation({ destination, codexBin, repetitions: repeats === undefined ? 1 : Number(repeats), signal: controller.signal });
      process.stdout.write(JSON.stringify({ passed: report.passed, accepted: report.accepted, rejected: report.rejected,
        transport_failures: report.transport_failures, not_attempted: report.not_attempted, independent_review: "unverified" }) + "\n");
      process.exitCode = report.passed ? 0 : 1;
    } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch { process.stderr.write("Fresh evaluation failed; no provider content logged.\n"); process.exitCode = 1; }
}
