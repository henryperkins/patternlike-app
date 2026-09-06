// One-off review evidence. No provider invocation. Paths refer only to private fictional runs.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const reviewRoot = "/tmp/patternlike-followup-eval-j0dmmnrt";
const root = join(reviewRoot, "repo");
const { captureSourceSnapshot, compareSourceSnapshots } = await import(join(root, "scripts/pattern-release/release-evidence.mjs"));
const { canonicalJson, sha256Hex } = await import(join(root, "scripts/pattern-release/candidates.mjs"));
const before = captureSourceSnapshot(root);
const { tsImport } = await import(join(root, "node_modules/tsx/dist/esm/api/index.mjs"));
const evaluation = await tsImport(join(root, "apps/api/src/services/reading-evaluation.ts"), import.meta.url);
const harness = await import(join(root, "scripts/pattern-release/fresh-reading-evaluation.mjs"));
const plan = await harness.prepareFreshReadingEvaluation();
const runs = [];
for (const id of ["daily-01", "daily-02", "daily-03"]) {
  const sourceReportBytes = readFileSync(join(reviewRoot, id, "report.json"));
  const sourceReport = JSON.parse(sourceReportBytes);
  if (sourceReport.execution_kind !== "codex_process" || !sourceReport.provider_samples_observed
    || sourceReport.planned !== 6 || sourceReport.transport_failures !== 0 || sourceReport.not_attempted !== 0) throw new Error("fresh source run incomplete");
  const samples = [];
  for (const sample of sourceReport.samples) {
    const bytes = readFileSync(join(reviewRoot, id, sample.sample_file));
    const saved = JSON.parse(bytes);
    const entry = plan.cases.find((item) => item.id === sample.profile);
    if (!entry || sha256Hex(saved.output) !== sample.output_sha256) throw new Error("saved output identity mismatch");
    const findings = evaluation.hardGateFindings(entry.prepared, JSON.parse(saved.output));
    samples.push({ id: sample.id, output_sha256: sample.output_sha256,
      private_sample_sha256: sha256Hex(bytes), originally_accepted: sample.status === "accepted",
      current_invocation_matches_original: sha256Hex(canonicalJson(entry.claim.invocation)) === sample.invocation_sha256,
      accepted_on_replay: findings.length === 0, findings });
  }
  runs.push({ id, original_report_sha256: sha256Hex(sourceReportBytes),
    originally_accepted: sourceReport.accepted, originally_rejected: sourceReport.rejected,
    original_source_snapshot_sha256: sourceReport.source_snapshot_sha256, samples });
}
const after = captureSourceSnapshot(root);
const comparison = compareSourceSnapshots(before, after);
const samples = runs.flatMap((run) => run.samples);
const report = { schema_version: "fresh-reading-replay-review.v1", observed_at: new Date().toISOString(),
  mode: "deterministic_replay_of_retained_fresh_provider_output", provider_invoked: false,
  independent_editorial_review: "unverified", source_snapshot_sha256: before.files_sha256,
  source_comparison: comparison, pin: plan.pin, runs, sample_count: samples.length,
  accepted_on_replay: samples.filter((sample) => sample.accepted_on_replay).length,
  current_invocations_all_match_original: samples.every((sample) => sample.current_invocation_matches_original),
  passed: comparison.ok && samples.length === 18 && samples.every((sample) => sample.accepted_on_replay && sample.current_invocation_matches_original) };
const outputRoot = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(outputRoot, "fresh-daily-replay-03.json"), JSON.stringify(report, null, 2) + "\n", {flag:"wx",mode:0o600});
writeFileSync(join(outputRoot, "fresh-daily-replay-03-source.json"), JSON.stringify(before, null, 2) + "\n", {flag:"wx",mode:0o600});
process.stdout.write(JSON.stringify({ passed: report.passed, samples: report.sample_count, accepted: report.accepted_on_replay,
  invocations_match: report.current_invocations_all_match_original, provider_invoked: false }) + "\n");
process.exitCode = report.passed ? 0 : 1;
