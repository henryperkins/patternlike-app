#!/usr/bin/env node
// Offline evidence only. This command cannot deploy or certify a provider account.
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalJson, sha256Hex } from "./candidates.mjs";

const EXCLUDED_PREFIXES = ["docs/reviews/", "docs/superpowers/", "output/"];
const ARTIFACT_ROOTS = ["apps/api/dist", "apps/web/dist", "apps/codex-runner/dist"];
const IDENTITY_FILES = [
  "apps/api/src/services/reading-publisher.ts",
  "apps/api/src/services/pattern-publisher.ts",
  "packages/reading-engine/src/constrained-types.ts",
  "packages/pattern-engine/src/policy.ts",
  "apps/api/src/services/pattern-publication-safety.ts",
  "apps/codex-runner/src/codex-cli.ts",
];
const CI_LANES = [
  "contracts: npm run test:contracts",
  "monorepo: npm ci --dry-run (lockfile agrees with package.json)",
  "monorepo: ephemeris download",
  "monorepo: npm run typecheck",
  "monorepo: test @patternlike/shared",
  "monorepo: test @patternlike/reading-engine",
  "monorepo: test @patternlike/calc-stub",
  "monorepo: test @patternlike/ontology-signer",
  "monorepo: test @patternlike/api",
  "monorepo: test @patternlike/web",
  "monorepo: npm run build",
  "extra: test @patternlike/pattern-engine",
  "extra: test @patternlike/codex-runner",
  "extra: npm run test:content",
];
const DEPLOYMENT = { status: "unverified", release_git_sha: null, worker_version_id: null, traffic_percent: null, installed_runner_sha256: null };
const SHA256 = /^[a-f0-9]{64}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const safePath = (path) => typeof path === "string" && path !== "" && !path.startsWith("/")
  && !path.includes("\\") && !path.split("/").some((part) => ["", ".", ".."].includes(part)) && !/[\u0000-\u001f]/.test(path);
const hashFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export function captureSourceSnapshot(root) {
  const paths = [...new Set(git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean))].sort();
  const files = Object.create(null);
  for (const path of paths) {
    if (!safePath(path)) throw new Error("source_path_invalid");
    if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
    let stat;
    try { stat = lstatSync(join(root, path)); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("source_path_not_regular_file");
    files[path] = { sha256: hashFile(join(root, path)), executable: (stat.mode & 0o111) !== 0 };
  }
  return {
    schema_version: "repository-source-snapshot.v1",
    status: "observed",
    captured_at: new Date().toISOString(),
    base_commit: git(root, ["rev-parse", "HEAD"]).trim(),
    worktree_has_changes: git(root, ["status", "--porcelain"]).trim() !== "",
    excluded_prefixes: [...EXCLUDED_PREFIXES],
    file_count: Object.keys(files).length,
    files_sha256: sha256Hex(canonicalJson(files)),
    files,
  };
}

function snapshotProblems(snapshot) {
  if (!record(snapshot) || !record(snapshot.files)) return ["snapshot_invalid"];
  const problems = [];
  if (snapshot.schema_version !== "repository-source-snapshot.v1" || snapshot.status !== "observed"
    || !/^[a-f0-9]{40}$/.test(snapshot.base_commit ?? "")
    || typeof snapshot.worktree_has_changes !== "boolean"
    || !Number.isFinite(Date.parse(snapshot.captured_at))) problems.push("snapshot_identity_invalid");
  if (canonicalJson(snapshot.excluded_prefixes) !== canonicalJson(EXCLUDED_PREFIXES)) problems.push("snapshot_scope_invalid");
  const entries = Object.entries(snapshot.files);
  if (snapshot.file_count !== entries.length || entries.length === 0) problems.push("snapshot_count_invalid");
  if (snapshot.files_sha256 !== sha256Hex(canonicalJson(snapshot.files))) problems.push("snapshot_digest_invalid");
  if (entries.some(([path, value]) => !safePath(path) || !record(value) || !SHA256.test(value.sha256)
    || typeof value.executable !== "boolean" || Object.keys(value).length !== 2
    || EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)))) problems.push("snapshot_file_invalid");
  return problems;
}

export function compareSourceSnapshots(before, after) {
  const problems = [...snapshotProblems(before), ...snapshotProblems(after)];
  if (problems.length) return { ok: false, changed: [], missing: [], added: [], problems: [...new Set(problems)] };
  const changed = Object.keys(before.files).filter((path) => Object.hasOwn(after.files, path) && canonicalJson(before.files[path]) !== canonicalJson(after.files[path])).sort();
  const missing = Object.keys(before.files).filter((path) => !Object.hasOwn(after.files, path)).sort();
  const added = Object.keys(after.files).filter((path) => !Object.hasOwn(before.files, path)).sort();
  return { ok: !changed.length && !missing.length && !added.length, changed, missing, added, problems: [] };
}

export function parseCiSummary(output) {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, "");
  const index = clean.lastIndexOf(" SUMMARY ");
  const tail = index < 0 ? "" : clean.slice(index);
  const parsed = [...tail.matchAll(/^\s*(pass|FAIL)\s+(.+?)\s*$/gm)].map((match) => ({ name: match[2], result: match[1] }));
  const toolchainMatch = tail.match(/^node\s+(v\d+\.\d+\.\d+)\s+npm\s+(\d+\.\d+\.\d+)\s+python\s+(\d+\.\d+\.\d+)\s*$/m);
  const toolchain = toolchainMatch ? { node: toolchainMatch[1], npm: toolchainMatch[2], python: toolchainMatch[3] } : null;
  const lanes = parsed.filter((item) => CI_LANES.includes(item.name));
  const finalSuccess = /^ALL STEPS PASSED — safe to merge on local evidence\.\s*$/m.test(tail);
  const passed = finalSuccess && toolchain !== null && parsed.length === CI_LANES.length
    && parsed.every((item, index) => item.name === CI_LANES[index] && item.result === "pass");
  return { passed, final_success: finalSuccess, toolchain, lanes };
}

function captureArtifacts(root) {
  const files = {};
  const walk = (path) => {
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink()) throw new Error("artifact_path_not_regular_file");
    if (stat.isDirectory()) {
      for (const name of readdirSync(join(root, path)).sort()) walk(`${path}/${name}`);
    } else if (stat.isFile()) files[path] = { sha256: hashFile(join(root, path)), bytes: stat.size };
    else throw new Error("artifact_path_not_regular_file");
  };
  for (const path of ARTIFACT_ROOTS) {
    try { walk(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return {
    status: ARTIFACT_ROOTS.every((root) => Object.keys(files).some((path) => path.startsWith(root + "/"))) ? "observed" : "unverified",
    roots: [...ARTIFACT_ROOTS],
    files_sha256: sha256Hex(canonicalJson(files)),
    files,
  };
}

function captureRepositoryIdentity(root, snapshot) {
  // Read literal exported pins only. Prompt bodies, config values, and environment are never serialized.
  const pins = [];
  for (const path of IDENTITY_FILES) {
    if (!snapshot.files[path]) continue;
    const source = readFileSync(join(root, path), "utf8");
    const values = {};
    const pattern = /^export const ([A-Z][A-Z0-9_]*(?:MODEL|REASONING|PROVIDER|VERSION))\s*=\s*"([A-Za-z0-9._-]{1,100})"\s*(?:as const)?\s*;/gm;
    for (const match of source.matchAll(pattern)) values[match[1]] = match[2];
    if (Object.keys(values).length) pins.push({ source_path: path, source_sha256: snapshot.files[path].sha256, values });
  }
  const files = Object.fromEntries(Object.entries(snapshot.files).filter(([path]) => /^db\/d1\/(?:[^/]+\.sql|MIGRATIONS\.json)$/.test(path)).map(([path, value]) => [path, value.sha256]));
  return {
    status: pins.length === IDENTITY_FILES.length && files["db/d1/MIGRATIONS.json"] && Object.keys(files).length > 1 ? "observed" : "unverified",
    scope: "repository_configuration_only",
    pins,
    migrations: { applied_status: "unverified", files, files_sha256: sha256Hex(canonicalJson(files)) },
  };
}

function receiptProblems(receipt) {
  if (!record(receipt)) return ["receipt_invalid"];
  const problems = [];
  if (receipt.schema_version !== "local-release-evidence.v1" || receipt.status !== "observed") problems.push("receipt_identity_invalid");
  problems.push(...snapshotProblems(receipt.source_before));
  if (receipt.source_unchanged !== true || receipt.source_after_sha256 !== receipt.source_before?.files_sha256) problems.push("source_changed_during_gate");
  if (canonicalJson(receipt.source_comparison) !== canonicalJson({ ok: true, changed: [], missing: [], added: [], problems: [] })) problems.push("source_comparison_incomplete");
  if (receipt.gate?.command !== "npm run ci:local" || receipt.gate?.status !== "observed" || receipt.gate?.exit_code !== 0
    || !SHA256.test(receipt.gate?.output_sha256 ?? "")) problems.push("gate_execution_invalid");
  const summary = receipt.gate?.summary;
  if (!summary?.passed || !summary.final_success || !summary.toolchain || summary.toolchain.node?.split(".")[0] !== "v22"
    || !Array.isArray(summary.lanes) || summary.lanes.length !== CI_LANES.length
    || summary.lanes.some((item, index) => item.name !== CI_LANES[index] || item.result !== "pass")) problems.push("gate_summary_incomplete");
  if (receipt.artifacts?.status !== "observed") problems.push("build_artifacts_unverified");
  if (receipt.repository_identity?.status !== "observed" || receipt.repository_identity?.migrations?.applied_status !== "unverified") problems.push("repository_identity_unverified");
  if (canonicalJson(receipt.deployment) !== canonicalJson(DEPLOYMENT)) problems.push("deployment_unverified");
  return [...new Set(problems)];
}

export function verifyReleaseEvidence(root, receipt) {
  const problems = receiptProblems(receipt);
  if (record(receipt?.source_before)) {
    const current = captureSourceSnapshot(root);
    if (!compareSourceSnapshots(receipt.source_before, current).ok) problems.push("current_source_mismatch");
    if (canonicalJson(receipt.artifacts) !== canonicalJson(captureArtifacts(root))) problems.push("current_artifact_mismatch");
    if (canonicalJson(receipt.repository_identity) !== canonicalJson(captureRepositoryIdentity(root, current))) problems.push("current_repository_identity_mismatch");
  }
  return { passed: problems.length === 0, problems: [...new Set(problems)], deployment_status: "unverified" };
}

async function captureGate(root) {
  const sourceBefore = captureSourceSnapshot(root);
  const startedAt = new Date().toISOString();
  const outputHash = createHash("sha256");
  let outputTail = "";
  const exitCode = await new Promise((done) => {
    const child = spawn("npm", ["run", "ci:local"], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const consume = (chunk) => {
      outputHash.update(chunk);
      outputTail = (outputTail + chunk.toString("utf8")).slice(-131072);
      process.stdout.write(chunk);
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", () => done(null));
    child.on("close", (code) => done(code));
  });
  const sourceAfter = captureSourceSnapshot(root);
  const sourceComparison = compareSourceSnapshots(sourceBefore, sourceAfter);
  const receipt = {
    schema_version: "local-release-evidence.v1",
    status: "observed",
    captured_at: new Date().toISOString(),
    source_before: sourceBefore,
    source_after_sha256: sourceAfter.files_sha256,
    source_unchanged: sourceComparison.ok,
    source_comparison: sourceComparison,
    gate: {
      status: "observed", command: "npm run ci:local", started_at: startedAt,
      exit_code: exitCode, output_sha256: outputHash.digest("hex"), summary: parseCiSummary(outputTail),
    },
    repository_identity: captureRepositoryIdentity(root, sourceAfter),
    artifacts: captureArtifacts(root),
    deployment: { ...DEPLOYMENT },
  };
  const problems = receiptProblems(receipt);
  return { ...receipt, passed: problems.length === 0, problems };
}

function writeEvidence(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

function requireEvidenceDestination(path) {
  const fromRoot = relative(process.cwd(), path);
  if (!fromRoot.startsWith("../") && fromRoot !== ".." && !EXCLUDED_PREFIXES.some((prefix) => fromRoot.startsWith(prefix))) {
    throw new Error("evidence_destination_in_source");
  }
}

async function main() {
  const [command, path, ...rest] = process.argv.slice(2);
  if (!path || rest.length !== 0) throw new Error("usage: release-evidence.mjs snapshot|gate|verify <evidence.json>");
  if (command === "snapshot") {
    requireEvidenceDestination(resolve(path));
    writeEvidence(resolve(path), captureSourceSnapshot(process.cwd()));
    process.stdout.write("Source snapshot recorded; deployment unverified.\n");
    return;
  }
  if (command === "gate") {
    // Reserve the destination before spending a full gate on a path that cannot be written.
    const destination = resolve(path);
    requireEvidenceDestination(destination);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, "", { flag: "wx", mode: 0o600 });
    const receipt = await captureGate(process.cwd());
    writeFileSync(destination, JSON.stringify(receipt, null, 2) + "\n");
    process.stdout.write(JSON.stringify({ passed: receipt.passed, problems: receipt.problems, deployment_status: "unverified" }) + "\n");
    if (!receipt.passed) process.exitCode = 1;
    return;
  }
  if (command === "verify") {
    const result = verifyReleaseEvidence(process.cwd(), JSON.parse(readFileSync(resolve(path), "utf8")));
    process.stdout.write(JSON.stringify(result) + "\n");
    if (!result.passed) process.exitCode = 1;
    return;
  }
  throw new Error("unknown_evidence_command");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const known = new Set(["source_path_invalid", "source_path_not_regular_file", "artifact_path_not_regular_file", "evidence_destination_in_source", "unknown_evidence_command"]);
    const code = error.code === "EEXIST" ? "evidence_destination_exists"
      : known.has(error.message) ? error.message : "evidence_operation_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
