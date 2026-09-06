#!/usr/bin/env node
// Offline record reconciliation only. No platform, provider, account, or database calls.
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalJson, sha256Hex } from "./candidates.mjs";
import { verifyReleaseEvidence } from "./release-evidence.mjs";

const EXCLUDED = ["docs/reviews/", "docs/superpowers/", "output/"];
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const digest = (value) => sha256Hex(canonicalJson(value));
const exact = (value, keys) => record(value) && same(Object.keys(value).sort(), [...keys].sort());
const safePath = (value) => typeof value === "string" && value.length > 0 && value.length < 512
  && !value.startsWith("/") && !/[\\\u0000-\u001f\u007f]/.test(value)
  && !value.split("/").some((part) => ["", ".", ".."].includes(part));
const validDate = (value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value && Date.parse(value) <= Date.now();
const common = { released_commit: null, worker_version_id: null, runner_files_sha256: null, exercise_id: null, authorization_sha256: null };
const DATA = {
  source_mapping: { released_commit: null, gate_source_snapshot_sha256: null, released_source_snapshot_sha256: null },
  worker: { released_commit: null, source_snapshot_sha256: null, version_id: null, allocation_complete: null, versions: [], artifact_files: null },
  runner: { released_commit: null, source_snapshot_sha256: null, inventory_complete: null, artifact_files: null, installed_files_sha256: null, node_version: null, dependency_lock_sha256: null, dependency_inventory: null, dependency_inventory_sha256: null },
  execution: { released_commit: null, worker_version_id: null, runner_files_sha256: null, repository_pins: null, tuples: null, image_provider_observed_model: null, image_provider_observation_status: null },
  migrations: { released_commit: null, inventory_complete: null, applied_files: null, applied_files_sha256: null, manifest_sha256: null, integrity_check: null, foreign_key_violations: null },
  authorization: { authorized: null, scope: null, exercise_id: null },
  completion: { ...common, state: null, saved_images: null, saved_models: null, reader_visible: null, complete_source_preserved: null, saved_assets: null },
  saved_reuse: { ...common, saved_assets: null, new_provider_requests: null, reader_visible: null },
  withdrawal: { ...common, unfinished_work_stopped: null, accepted_assets_preserved: null, late_completion_published: null, fresh_requests_blocked: null, saved_assets_sha256: null },
  deletion: { ...common, deletion_scope: null, deletion_completed: null, access_denied: null, jobs_invalidated: null, inventory_retained: null, encrypted_artifacts_remaining: null, saved_assets_sha256: null },
  late_upload: { ...common, late_upload_attempted: null, late_upload_published: null, cleanup_rerun_completed: null, late_object_absent: null, access_denied: null, inventory_retained: null, late_object_sha256: null },
};
const KINDS = Object.keys(DATA);

export function blankReconciliationTemplate() {
  return {
    schema_version: "offline-release-observations.v1",
    gate_receipt_sha256: null,
    expected: null,
    records: Object.fromEntries(KINDS.map((kind) => [kind, { path: null, sha256: null }])),
    record_templates: Object.fromEntries(KINDS.map((kind) => [kind, {
      schema_version: "offline-release-record.v1", kind, source_kind: "operator_record", recorded_at: null, data: structuredClone(DATA[kind]),
    }])),
  };
}

function requireEvidencePath(root, path, destination = false) {
  const local = relative(root, resolve(root, path));
  if (!safePath(local) || !EXCLUDED.some((prefix) => local.startsWith(prefix))) throw new Error("evidence_path_outside_scope");
  let current = root;
  for (const part of local.split("/")) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("evidence_path_symlink");
    } catch (error) {
      if (destination && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return resolve(root, local);
}

function readJson(root, path) {
  const fd = openSync(requireEvidencePath(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INPUT_BYTES) throw new Error("evidence_input_invalid");
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_INPUT_BYTES + 1));
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length !== stat.size) throw new Error("evidence_input_invalid");
    const bytes = buffer.subarray(0, length);
    return { value: JSON.parse(bytes.toString("utf8")), sha256: sha256Hex(bytes) };
  } finally { closeSync(fd); }
}

function writeJson(root, path, value) {
  const destination = requireEvidencePath(root, path, true);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

function repositoryTuples(root, receipt) {
  const tuples = [];
  const sources = receipt.source_before.files;
  const add = (lane, sourcePath, model, reasoning, promptVersion, extra = {}) => {
    if (![model, reasoning, promptVersion].every((value) => typeof value === "string" && /^[A-Za-z0-9._/-]{1,100}$/.test(value)) || !sources[sourcePath]) throw new Error("repository_tuple_unavailable");
    tuples.push({ lane, model, reasoning, prompt_version: promptVersion, source_path: sourcePath, source_sha256: sources[sourcePath].sha256, ...extra });
  };
  for (const pin of receipt.repository_identity.pins) {
    const p = pin.values;
    if (pin.source_path === "apps/api/src/services/reading-publisher.ts") add("daily", pin.source_path, p.OPENAI_READING_MODEL, p.OPENAI_READING_REASONING, p.READING_PROMPT_VERSION);
    if (pin.source_path === "apps/api/src/services/pattern-publisher.ts") {
      for (const role of ["PLANNER", "WRITER", "VERIFIER"]) add(`pattern_${role.toLowerCase()}`, pin.source_path, p[`OPENAI_PATTERN_${role}_MODEL`], p[`OPENAI_PATTERN_${role}_REASONING`], p[`OPENAI_PATTERN_${role}_PROMPT_VERSION`]);
    }
  }
  // These claims use literal inline pins. Fail closed if their source shape changes;
  // reading the reviewed claim source does not attest an executed provider identity.
  const matchSource = (path, pattern) => {
    if (!sources[path]) throw new Error("repository_tuple_unavailable");
    const bytes = readFileSync(join(root, path));
    if (sha256Hex(bytes) !== sources[path].sha256) throw new Error("repository_tuple_unavailable");
    const matches = [...bytes.toString("utf8").matchAll(pattern)];
    if (matches.length !== 1) throw new Error("repository_tuple_unavailable");
    return matches[0];
  };
  const imagePath = "apps/api/src/services/pattern-portrait.ts";
  const image = matchSource(imagePath, /schema_version:\s*"codex-portrait-claim\/v1"[^\n]*?model:\s*"([A-Za-z0-9._-]+)",\s*reasoning_effort:\s*"([a-z]+)",\s*image_model:\s*"([A-Za-z0-9._-]+)",\s*prompt_version:\s*"([A-Za-z0-9._/-]+)"/g);
  const cliPath = "apps/codex-runner/src/portrait-invocation.ts";
  const cli = matchSource(cliPath, /^export const PORTRAIT_CODEX_CLI_VERSION\s*=\s*"([0-9.]+)";/gm);
  add("portrait_image", imagePath, image[1], image[2], image[4], { requested_image_model: image[3], codex_cli_version: cli[1], cli_source_sha256: sources[cliPath].sha256 });
  const meshPath = "apps/api/src/services/pattern-portrait-mesh.ts";
  const mesh = matchSource(meshPath, /model:\s*"([A-Za-z0-9._-]+)",\s*reasoning_effort:\s*"([a-z]+)",\s*prompt_version:\s*PORTRAIT_MESH_PROMPT_VERSION/g);
  const promptPath = "packages/shared/src/portrait-mesh-protocol.ts";
  const meshPrompt = matchSource(promptPath, /^export const PORTRAIT_MESH_PROMPT_VERSION\s*=\s*"([A-Za-z0-9._/-]+)"\s*as const;/gm);
  for (const lane of ["portrait_mesh_author", "portrait_mesh_review"]) add(lane, meshPath, mesh[1], mesh[2], meshPrompt[1], { prompt_source_sha256: sources[promptPath].sha256, codex_cli_version: cli[1], cli_source_sha256: sources[cliPath].sha256 });
  if (tuples.length !== 7) throw new Error("repository_tuple_unavailable");
  return tuples;
}

function loadGate(root, path) {
  const gate = readJson(root, path);
  if (!verifyReleaseEvidence(root, gate.value).passed || !validDate(gate.value.captured_at)
    || !SHA256.test(gate.value.source_before.files["package-lock.json"]?.sha256 ?? "")) throw new Error("local_gate_invalid");
  const receipt = gate.value;
  const workerFiles = Object.fromEntries(Object.entries(receipt.artifacts.files).filter(([path]) => path.startsWith("apps/api/dist/") || path.startsWith("apps/web/dist/")));
  const runnerFiles = Object.fromEntries(Object.entries(receipt.artifacts.files).filter(([path]) => path.startsWith("apps/codex-runner/dist/")));
  const migrationFiles = Object.fromEntries(Object.entries(receipt.repository_identity.migrations.files).filter(([path]) => path.endsWith(".sql")));
  gate.expected = {
    gate_completed_at: receipt.captured_at,
    gate_source_snapshot_sha256: receipt.source_before.files_sha256,
    gate_base_commit: receipt.source_before.base_commit,
    worker_artifact_files: workerFiles,
    runner_artifact_files: runnerFiles,
    runner_files_sha256: digest(runnerFiles),
    node_version: receipt.gate.summary.toolchain.node,
    dependency_lock_sha256: receipt.source_before.files["package-lock.json"].sha256,
    repository_pins: receipt.repository_identity.pins,
    tuples: repositoryTuples(root, receipt),
    migration_files: migrationFiles,
    migration_files_sha256: digest(migrationFiles),
    migration_manifest_sha256: receipt.repository_identity.migrations.files["db/d1/MIGRATIONS.json"],
  };
  return gate;
}

function validFileInventory(files) {
  return record(files) && Object.keys(files).length > 0 && Object.keys(files).length <= 20000
    && Object.entries(files).every(([path, file]) => safePath(path) && exact(file, ["sha256", "bytes"])
      && SHA256.test(file.sha256 ?? "") && Number.isSafeInteger(file.bytes) && file.bytes >= 0);
}

function validAssets(value) {
  return exact(value, ["reading_sha256", "graph_sha256", "chapters"])
    && SHA256.test(value.reading_sha256 ?? "") && SHA256.test(value.graph_sha256 ?? "")
    && Array.isArray(value.chapters) && value.chapters.length === 4
    && value.chapters.every((chapter, index) => exact(chapter, ["index", "chapter_sha256", "image_sha256", "model_sha256"])
      && chapter.index === index && [chapter.chapter_sha256, chapter.image_sha256, chapter.model_sha256].every((hash) => SHA256.test(hash ?? "")));
}

function reconcileRecords(root, gate, input) {
  const document = input.value;
  if (!exact(document, ["schema_version", "gate_receipt_sha256", "expected", "records", "record_templates"])
    || document.schema_version !== "offline-release-observations.v1" || !exact(document.records, KINDS)
    || !same(document.record_templates, blankReconciliationTemplate().record_templates)) throw new Error("evidence_input_invalid");
  const expected = gate.expected;
  const gaps = [];
  const components = {};
  const records = {};
  const add = (kind, code) => {
    gaps.push(`${kind}_${code}`);
    if (components[kind]) components[kind].status = "unverified";
  };
  if (document.gate_receipt_sha256 !== gate.sha256) add("gate", "receipt_hash_mismatch");
  if (!same(document.expected, expected)) add("gate", "requirements_mismatch");
  for (const kind of KINDS) {
    components[kind] = { status: "unverified", evidence_sha256: null, recorded_at: null, source_kind: null };
    const reference = document.records[kind];
    if (!exact(reference, ["path", "sha256"])) { add(kind, "record_invalid"); continue; }
    if (reference.path === null && reference.sha256 === null) { add(kind, "record_missing"); continue; }
    if (!safePath(reference.path) || !SHA256.test(reference.sha256 ?? "")) { add(kind, "record_invalid"); continue; }
    let source;
    try { source = readJson(root, reference.path); } catch { add(kind, "evidence_unreadable"); continue; }
    components[kind].evidence_sha256 = source.sha256;
    if (source.sha256 !== reference.sha256) { add(kind, "evidence_hash_mismatch"); continue; }
    const wrapper = source.value;
    if (!exact(wrapper, ["schema_version", "kind", "source_kind", "recorded_at", "data"])
      || wrapper.schema_version !== "offline-release-record.v1" || wrapper.kind !== kind
      || !["operator_record", "platform_export", "runner_inventory"].includes(wrapper.source_kind)
      || !validDate(wrapper.recorded_at) || !exact(wrapper.data, Object.keys(DATA[kind]))) { add(kind, "record_invalid"); continue; }
    records[kind] = wrapper;
    components[kind] = { status: "recorded_consistent", evidence_sha256: source.sha256, recorded_at: wrapper.recorded_at, source_kind: wrapper.source_kind };
    if (kind !== "authorization" && wrapper.recorded_at < expected.gate_completed_at) add(kind, "chronology_invalid");
  }
  const data = (kind) => records[kind]?.data;
  const mapping = data("source_mapping");
  if (mapping) {
    if (!SHA40.test(mapping.released_commit ?? "")) add("source_mapping", "commit_invalid");
    if (mapping.gate_source_snapshot_sha256 !== expected.gate_source_snapshot_sha256 || mapping.released_source_snapshot_sha256 !== expected.gate_source_snapshot_sha256) add("source_mapping", "snapshot_mismatch");
  }
  for (const kind of KINDS.filter((kind) => !["source_mapping", "authorization"].includes(kind))) {
    if (data(kind) && (!mapping || data(kind).released_commit !== mapping.released_commit)) add(kind, "commit_mismatch");
  }
  const worker = data("worker");
  if (worker) {
    if (worker.source_snapshot_sha256 !== expected.gate_source_snapshot_sha256) add("worker", "snapshot_mismatch");
    if (!UUID.test(worker.version_id ?? "") || worker.allocation_complete !== true || !Array.isArray(worker.versions)
      || worker.versions.length !== 1 || !exact(worker.versions[0], ["version_id", "percentage"])
      || worker.versions[0].version_id !== worker.version_id || worker.versions[0].percentage !== 100) add("worker", "traffic_incomplete");
    if (!same(worker.artifact_files, expected.worker_artifact_files)) add("worker", "artifacts_mismatch");
  }
  const runner = data("runner");
  if (runner) {
    if (runner.source_snapshot_sha256 !== expected.gate_source_snapshot_sha256) add("runner", "snapshot_mismatch");
    if (runner.inventory_complete !== true || !same(runner.artifact_files, expected.runner_artifact_files) || runner.installed_files_sha256 !== expected.runner_files_sha256) add("runner", "artifacts_mismatch");
    if (runner.node_version !== expected.node_version || runner.dependency_lock_sha256 !== expected.dependency_lock_sha256
      || !validFileInventory(runner.dependency_inventory) || runner.dependency_inventory_sha256 !== digest(runner.dependency_inventory)) add("runner", "dependencies_invalid");
  }
  const execution = data("execution");
  if (execution) {
    if (!worker || !runner || execution.worker_version_id !== worker.version_id || execution.runner_files_sha256 !== expected.runner_files_sha256) add("execution", "runtime_binding_mismatch");
    if (!same(execution.repository_pins, expected.repository_pins)) add("execution", "pins_mismatch");
    if (!same(execution.tuples, expected.tuples)) add("execution", "tuples_mismatch");
    if (execution.image_provider_observed_model !== null || execution.image_provider_observation_status !== "not_exposed") add("execution", "image_identity_unsupported");
  }
  const migrations = data("migrations");
  if (migrations) {
    if (migrations.inventory_complete !== true || !same(migrations.applied_files, expected.migration_files)
      || migrations.applied_files_sha256 !== expected.migration_files_sha256 || migrations.manifest_sha256 !== expected.migration_manifest_sha256) add("migrations", "files_mismatch");
    if (migrations.integrity_check !== "ok" || migrations.foreign_key_violations !== 0) add("migrations", "integrity_incomplete");
  }
  const authorization = data("authorization");
  if (authorization && (authorization.authorized !== true || authorization.scope !== "portrait_lifecycle" || !UUID.test(authorization.exercise_id ?? ""))) add("authorization", "missing_authority");
  const lifecycle = ["completion", "saved_reuse", "withdrawal", "deletion", "late_upload"];
  let previous = null;
  for (const kind of lifecycle) {
    const item = data(kind);
    if (item) {
      if (!worker || !runner || !authorization || authorization.authorized !== true || authorization.scope !== "portrait_lifecycle"
        || item.worker_version_id !== worker.version_id || item.runner_files_sha256 !== expected.runner_files_sha256
        || item.exercise_id !== authorization.exercise_id || item.authorization_sha256 !== components.authorization.evidence_sha256) add(kind, "lifecycle_binding_mismatch");
      if (!records.authorization || records[kind].recorded_at < records.authorization.recorded_at
        || (previous && records[kind].recorded_at < previous)) add(kind, "chronology_invalid");
      previous = records[kind].recorded_at;
    }
  }
  const completion = data("completion");
  const assets = completion?.saved_assets;
  if (completion && (completion.state !== "ready" || completion.saved_images !== 4 || completion.saved_models !== 4
    || completion.reader_visible !== true || completion.complete_source_preserved !== true || !validAssets(assets))) add("completion", "outcome_incomplete");
  const reuse = data("saved_reuse");
  if (reuse) {
    if (!validAssets(assets) || !same(reuse.saved_assets, assets)) add("saved_reuse", "assets_mismatch");
    if (reuse.new_provider_requests !== 0) add("saved_reuse", "regenerated");
    if (reuse.reader_visible !== true) add("saved_reuse", "reader_unverified");
  }
  const withdrawal = data("withdrawal");
  if (withdrawal && (withdrawal.unfinished_work_stopped !== true || withdrawal.accepted_assets_preserved !== true
    || withdrawal.late_completion_published !== false || withdrawal.fresh_requests_blocked !== true
    || !validAssets(assets) || withdrawal.saved_assets_sha256 !== digest(assets))) add("withdrawal", "outcome_incomplete");
  const deletion = data("deletion");
  if (deletion && (deletion.deletion_scope !== "account" || deletion.deletion_completed !== true || deletion.access_denied !== true || deletion.jobs_invalidated !== true
    || deletion.inventory_retained !== true || deletion.encrypted_artifacts_remaining !== 0
    || !validAssets(assets) || deletion.saved_assets_sha256 !== digest(assets))) add("deletion", "outcome_incomplete");
  const late = data("late_upload");
  if (late && (late.late_upload_attempted !== true || late.late_upload_published !== false || late.cleanup_rerun_completed !== true
    || late.late_object_absent !== true || late.access_denied !== true || late.inventory_retained !== true
    || !SHA256.test(late.late_object_sha256 ?? ""))) add("late_upload", "outcome_incomplete");
  return {
    schema_version: "offline-release-reconciliation.v1", captured_at: new Date().toISOString(),
    status: gaps.length ? "incomplete_recorded_chain" : "consistent_recorded_chain",
    deployment_status: "unverified", independent_live_observation: false, image_provider_identity_status: "unverified",
    local_gate_receipt_sha256: gate.sha256, records_document_sha256: input.sha256,
    gate_source_snapshot_sha256: expected.gate_source_snapshot_sha256,
    required_artifacts_sha256: digest(gate.value.artifacts.files), required_repository_identity_sha256: digest(gate.value.repository_identity),
    required_execution_tuples_sha256: digest(expected.tuples), components, gaps: [...new Set(gaps)],
    limitations: ["operator_records_not_authenticated", "live_state_not_queried", "dependency_inventory_recorded_only", "lifecycle_outcomes_recorded_only", "provider_image_identity_not_exposed"],
  };
}

async function main() {
  const root = process.cwd();
  const [command, ...args] = process.argv.slice(2);
  if (command === "template" && args.length === 1) {
    writeJson(root, args[0], blankReconciliationTemplate());
    process.stdout.write("Blank records prepared; deployment unverified.\n");
    return;
  }
  if (command === "prepare" && args.length === 2) {
    requireEvidencePath(root, args[1], true);
    const gate = loadGate(root, args[0]);
    const template = blankReconciliationTemplate();
    template.gate_receipt_sha256 = gate.sha256;
    template.expected = gate.expected;
    writeJson(root, args[1], template);
    process.stdout.write("Gate requirements prepared; external records absent; deployment unverified.\n");
    return;
  }
  if (command === "reconcile" && args.length === 3) {
    requireEvidencePath(root, args[2], true);
    const gate = loadGate(root, args[0]);
    const result = reconcileRecords(root, gate, readJson(root, args[1]));
    writeJson(root, args[2], result);
    process.stdout.write(JSON.stringify({ status: result.status, deployment_status: "unverified", gaps: result.gaps }) + "\n");
    if (result.gaps.length) process.exitCode = 1;
    return;
  }
  throw new Error("reconciliation_usage_invalid");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const known = new Set(["evidence_path_outside_scope", "evidence_path_symlink", "evidence_input_invalid", "reconciliation_usage_invalid", "local_gate_invalid", "repository_tuple_unavailable"]);
    process.stderr.write((error.code === "EEXIST" ? "evidence_destination_exists" : known.has(error.message) ? error.message : "reconciliation_operation_failed") + "\n");
    process.exitCode = 1;
  });
}
