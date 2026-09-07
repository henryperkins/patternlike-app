#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { tsImport } from "tsx/esm/api";
import { REPO_ROOT, canonicalJson, sha256Hex } from "./candidates.mjs";
import { captureSourceSnapshot, compareSourceSnapshots } from "./release-evidence.mjs";

const loadedSource = captureSourceSnapshot(REPO_ROOT);
const regression = await tsImport("../../apps/api/src/services/ontology-regression.ts", import.meta.url);
const packet = await tsImport("../../apps/api/src/services/pattern-packet.ts", import.meta.url);
const prompt = await tsImport("../../apps/api/src/services/pattern-prompt.ts", import.meta.url);
const semantic = await tsImport("../../apps/api/src/services/pattern-semantic.ts", import.meta.url);
const safety = await tsImport("../../apps/api/src/services/pattern-publication-safety.ts", import.meta.url);
const contract = await tsImport("../../apps/api/src/services/codex-provider-contract.ts", import.meta.url);
const runner = await tsImport("../../apps/codex-runner/src/codex-cli.ts", import.meta.url);
const engine = await tsImport("../../packages/pattern-engine/src/index.ts", import.meta.url);
const ajv = new Ajv2020({ strict: false, allErrors: true });
const valid = Object.fromEntries(["planner", "writer", "verifier"].map((pass) => [pass, ajv.compile(JSON.parse(readFileSync(
  join(REPO_ROOT, "contracts/m7", pass === "verifier" ? "pattern-semantic-verdict.schema.json" : "pattern-" + pass + "-output.schema.json"), "utf8")))]));
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });

function destinationPath(destination) {
  if (typeof destination !== "string" || !destination.trim()) throw new Error("evaluation_destination_invalid");
  const path = resolve(destination), rel = relative(REPO_ROOT, path);
  if (rel !== ".." && !rel.startsWith("../") && !["output/", "docs/reviews/", "docs/superpowers/"].some((prefix) => rel.startsWith(prefix))) {
    throw new Error("evaluation_destination_in_source");
  }
  return path;
}

/** Two fixed fictional packets; all planner/writer/verifier outputs are newly requested. */
export async function runFreshPatternEvaluation({ destination, codexBin, env, invoke, signal } = {}) {
  const executionKind = invoke ? "test_double" : codexBin !== undefined || env !== undefined ? "unverified_process" : "codex_process";
  codexBin ??= "codex";
  const directory = destinationPath(destination);
  const source = captureSourceSnapshot(REPO_ROOT);
  const loadedComparison = compareSourceSnapshots(loadedSource, source);
  const corpus = regression.loadOntologyRegressionCorpus();
  const ontology = corpus.manifest.reference_ontology_records;
  const pin = { ...regression.ONTOLOGY_REGRESSION_PATTERN_PIN, publisher: "codex" };
  const fixtures = ["m7-exact-01", "m7-unknown-01"].map((id) => corpus.fixtures.find((entry) => entry.fixture_id === id));
  if (fixtures.some((fixture) => !fixture || fixture.declared_outcome !== "accepted")) throw new Error("evaluation_fixture_invalid");
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  await write(join(directory, "source-snapshot.json"), source);
  await write(join(directory, "loaded-source-snapshot.json"), loadedSource);
  const startedAt = new Date().toISOString(), cases = [];
  const execute = invoke ?? runner.runCodexInvocation;
  let stopped = !loadedComparison.ok, received = 0, transportFailures = 0;
  for (const fixture of fixtures) {
    const entry = { fixture_id: fixture.fixture_id, input_sha256: sha256Hex(canonicalJson(fixture.chain.fact_packet)),
      status: "not_attempted", stages: [] };
    cases.push(entry);
    if (stopped || signal?.aborted) continue;
    let plan, writer;
    for (const pass of ["planner", "writer", "verifier"]) {
      if (signal?.aborted) { entry.status = "cancelled"; stopped = true; break; }
      const beforeCall = compareSourceSnapshots(source, captureSourceSnapshot(REPO_ROOT));
      if (!beforeCall.ok) { entry.status = "source_changed"; stopped = true; break; }
      const facts = fixture.chain.fact_packet, limits = packet.PATTERN_PACKET_LIMITS_DEFAULT;
      const built = pass === "planner" ? packet.buildPlannerInput(facts, ontology, limits) : pass === "writer" ?
        packet.buildWriterInput(plan, facts, ontology, limits) : packet.buildVerifierInput(writer, plan, facts, ontology, limits);
      if (!built.ok) { entry.status = pass + "_input_rejected"; break; }
      const converted = contract.invocationFromResponsesRequest(prompt.buildPatternResponsesRequest(pass, built.document, pin), {
        model: pin[pass + "_model"], reasoningEffort: pin[pass + "_reasoning"],
      });
      if (!converted.ok) { entry.status = pass + "_input_rejected"; break; }
      const claim = { schema_version: "codex-provider-claim/v1", job_id: "cpjob_" + sha256Hex(fixture.fixture_id + pass).slice(0, 32),
        lease_token: "fictional_pattern_evaluation_not_a_worker_lease", model: pin[pass + "_model"],
        reasoning_effort: pin[pass + "_reasoning"], prompt_version: pin[pass + "_prompt_version"],
        timeout_ms: contract.CODEX_PROVIDER_TIMEOUT_MS, invocation: converted.value };
      const stage = { pass, started_at: new Date().toISOString(), invocation_sha256: sha256Hex(canonicalJson(claim.invocation)),
        sample_file: fixture.fixture_id + "-" + pass + ".json" };
      entry.stages.push(stage);
      let result;
      try { result = await execute({ claim, codexBin, env, signal }); } catch { result = { ok: false, fatal: true }; }
      stage.completed_at = new Date().toISOString();
      const completion = result?.ok ? contract.parseCodexProviderCompletion({ lease_token: claim.lease_token, output: result.output,
        provider_request_id: result.providerRequestId, input_tokens: result.inputTokens, output_tokens: result.outputTokens }) : null;
      if (!completion?.ok) {
        transportFailures++;
        const failure = contract.parseCodexProviderFailure({ lease_token: claim.lease_token, code: result?.code, safe_detail_code: result?.safeDetailCode });
        stage.status = "transport_failed";
        stage.failure = failure.ok ? { code: failure.value.code, detail: failure.value.safe_detail_code } : { code: "publisher_output_invalid", detail: "schema_mismatch" };
        let output = null;
        if (typeof result?.output === "string") {
          const bytes = Buffer.from(result.output, "utf8");
          // Streaming decode omits an incomplete final code point at the byte limit.
          output = new TextDecoder().decode(bytes.subarray(0, contract.CODEX_PROVIDER_MAX_RESPONSE_BYTES), { stream: true });
          Object.assign(stage, { output_sha256: sha256Hex(result.output), output_bytes: bytes.length,
            output_truncated: bytes.length > contract.CODEX_PROVIDER_MAX_RESPONSE_BYTES });
        }
        await write(join(directory, stage.sample_file), { ...stage, request_document: built.document, output });
        entry.status = "transport_failed"; stopped = result?.fatal === true || result?.ok === true; break;
      }
      received++;
      Object.assign(stage, { output_sha256: sha256Hex(result.output), provider_request_sha256: sha256Hex(result.providerRequestId),
        input_tokens: result.inputTokens, output_tokens: result.outputTokens });
      await write(join(directory, stage.sample_file), { ...stage, request_document: built.document, output: result.output });
      let value;
      try { value = JSON.parse(result.output); } catch { value = null; }
      if (!valid[pass](value)) { stage.status = "schema_rejected"; entry.status = pass + "_rejected"; break; }
      if (pass === "planner") {
        const checked = engine.validatePatternPlan(value, facts, ontology);
        if (!checked.ok) { stage.status = "rejected"; stage.finding_codes = [...new Set(checked.failures.map((item) => item.code))]; entry.status = "planner_rejected"; break; }
        plan = { ...value, plan_hash: "sha256:" + sha256Hex(JSON.stringify(value)), sparse_pattern: facts.selection_constraints.sparse_pattern };
      } else if (pass === "writer") {
        const checked = engine.validatePatternCandidate(value, plan, facts, ontology);
        if (!checked.ok) { stage.status = "rejected"; stage.finding_codes = [...new Set(checked.failures.map((item) => item.code))]; entry.status = "writer_rejected"; break; }
        writer = value;
      } else {
        const problem = semantic.findSemanticVerdictProblem(value);
        const checked = safety.evaluatePatternPublicationSafety({ features: fixture.features, selectionManifest: fixture.chain.selection_manifest,
          packet: facts, plan, writer, verdict: value, publicProjection: { ...fixture.chain.public_projection, ...engine.stripPrivateEvidence(writer) },
          ontology, sourceFragmentIds: corpus.source_fragment_ids });
        stage.finding_codes = [...new Set([...value.findings.map((item) => item.code).filter(prompt.isPatternFindingCode),
          ...checked.failures.map((item) => item.code), ...(problem ? [problem] : [])])];
        if (problem || value.verdict !== "pass" || checked.failures.length) { stage.status = "rejected"; entry.status = "verifier_rejected"; break; }
        entry.status = "accepted";
      }
      stage.status = "accepted";
    }
  }
  const comparison = compareSourceSnapshots(source, captureSourceSnapshot(REPO_ROOT));
  const accepted = cases.filter((entry) => entry.status === "accepted").length;
  const providerEvidence = executionKind === "codex_process";
  const report = { schema_version: "fresh-pattern-generation-evaluation.v1", execution_kind: executionKind,
    provider_samples_observed: providerEvidence && received > 0, fresh_generation_chains: providerEvidence && accepted > 0,
    fresh_end_to_end_patterns: false, production_account_exercised: false,
    input_origin: "fixed_fictional_fact_packets_and_reference_ontology", corpus_manifest_hash: corpus.manifest_hash,
    started_at: startedAt, completed_at: new Date().toISOString(), base_commit: source.base_commit,
    source_snapshot_sha256: source.files_sha256, loaded_source_comparison: loadedComparison, source_comparison: comparison,
    pin, text_isolation_version: runner.CODEX_TEXT_ISOLATION_VERSION, planned_cases: 2, provider_call_ceiling: 6,
    accepted, transport_failures: transportFailures, cases,
    independent_review: { status: "unverified", note: "Generated chains do not establish independent editorial quality or durable production publication." },
    passed: providerEvidence && loadedComparison.ok && comparison.ok && accepted === 2 };
  await write(join(directory, "report.json"), report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, destination, codexBin, ...extra] = process.argv.slice(2);
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    if (mode !== "run" || !destination || extra.length) throw new Error("evaluation_arguments_invalid");
    const result = await runFreshPatternEvaluation({ destination, codexBin, signal: controller.signal });
    process.stdout.write(JSON.stringify({ passed: result.passed, accepted: result.accepted, transport_failures: result.transport_failures,
      cases: result.cases.map((entry) => ({ fixture_id: entry.fixture_id, status: entry.status })) }) + "\n");
    process.exitCode = result.passed ? 0 : 1;
  } catch { process.stderr.write("Fresh Pattern evaluation failed; no provider content logged.\n"); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
