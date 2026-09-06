import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { REPO_ROOT, canonicalJson, sha256Hex } from "./candidates.mjs";

const executable = join(REPO_ROOT, "scripts/pattern-release/release-reconciliation.mjs");
const gateExecutable = join(REPO_ROOT, "scripts/pattern-release/release-evidence.mjs");
const hash = (value) => sha256Hex(typeof value === "string" ? value : canonicalJson(value));
const write = (root, path, value) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
};
const cli = (root, ...args) => spawnSync(process.execPath, [executable, ...args], { cwd: root, encoding: "utf8" });
const read = (root, path) => JSON.parse(readFileSync(join(root, path), "utf8"));

test("a blank template represents every release and authorized lifecycle gap", () => {
  const root = mkdtempSync(join(tmpdir(), "release-reconciliation-test-"));
  try {
    assert.equal(existsSync(executable), true, "offline reconciliation command must exist");
    const result = cli(root, "template", "docs/reviews/template.json");
    assert.equal(result.status, 0, result.stderr);
    const value = read(root, "docs/reviews/template.json");
    assert.equal(value.gate_receipt_sha256, null);
    assert.equal(value.expected, null);
    assert.deepEqual(Object.keys(value.records), ["source_mapping", "worker", "runner", "execution", "migrations", "authorization", "completion", "saved_reuse", "withdrawal", "deletion", "late_upload"]);
    assert.equal(Object.values(value.records).every((item) => item.path === null && item.sha256 === null), true);
    assert.equal(value.record_templates.completion.data.reader_visible, null);
    assert.equal(value.record_templates.authorization.data.authorized, null);
    assert.match(result.stdout, /deployment unverified/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), "release-reconciliation-test-"));
  const lanes = ["contracts: npm run test:contracts", "monorepo: npm ci --dry-run (lockfile agrees with package.json)", "monorepo: ephemeris download", "monorepo: npm run typecheck", ...["shared", "reading-engine", "calc-stub", "ontology-signer", "api", "web"].map((name) => `monorepo: test @patternlike/${name}`), "monorepo: npm run build", "extra: test @patternlike/pattern-engine", "extra: test @patternlike/codex-runner", "extra: npm run test:content"];
  const summary = ["════ SUMMARY ════", "node    v22.23.2   npm 10.9.4   python 3.12.3", ...lanes.map((lane) => `  pass   ${lane}`), "ALL STEPS PASSED — safe to merge on local evidence."].join("\n");
  const pattern = ["PLANNER", "WRITER", "VERIFIER"].flatMap((role) => [
    `export const OPENAI_PATTERN_${role}_MODEL = "fixture-model";`,
    `export const OPENAI_PATTERN_${role}_REASONING = "xhigh";`,
    `export const OPENAI_PATTERN_${role}_PROMPT_VERSION = "1.0.0";`,
  ]).join("\n");
  const sources = {
    ".gitignore": "**/dist/\n", ".nvmrc": "22\n", "package-lock.json": "{}\n",
    "package.json": JSON.stringify({ scripts: { "ci:local": "node fixture-gate.cjs" } }),
    "db/d1/MIGRATIONS.json": '{"migrations":[{"file":"0001_fixture.sql"}]}',
    "db/d1/0001_fixture.sql": "-- Synthetic migration\n",
    "apps/api/src/services/reading-publisher.ts": 'export const OPENAI_READING_MODEL = "fixture-model";\nexport const OPENAI_READING_REASONING = "xhigh";\nexport const READING_PROMPT_VERSION = "1.0.0";\n',
    "apps/api/src/services/pattern-publisher.ts": pattern,
    "packages/reading-engine/src/constrained-types.ts": 'export const VALIDATION_POLICY_VERSION = "1.0.0";\n',
    "packages/pattern-engine/src/policy.ts": 'export const PATTERN_VALIDATION_POLICY_VERSION = "1.0.0";\n',
    "apps/api/src/services/pattern-publication-safety.ts": 'export const PATTERN_PUBLICATION_SAFETY_POLICY_VERSION = "1.0.0";\n',
    "apps/codex-runner/src/codex-cli.ts": 'export const CODEX_TEXT_ISOLATION_VERSION = "1.0.0";\n',
    "apps/api/src/services/pattern-portrait.ts": 'const claim = { schema_version: "codex-portrait-claim/v1", model: "fixture-model", reasoning_effort: "xhigh", image_model: "fixture-image", prompt_version: "portrait-object-v1" };\n',
    "apps/api/src/services/pattern-portrait-mesh.ts": 'const claim = { model: "fixture-model", reasoning_effort: "xhigh", prompt_version: PORTRAIT_MESH_PROMPT_VERSION };\n',
    "packages/shared/src/portrait-mesh-protocol.ts": 'export const PORTRAIT_MESH_PROMPT_VERSION = "portrait-mesh/v1" as const;\n',
    "apps/codex-runner/src/portrait-invocation.ts": 'export const PORTRAIT_CODEX_CLI_VERSION = "0.153.3";\n',
    "fixture-gate.cjs": `const fs = require("node:fs");
      for (const path of ["apps/api/dist", "apps/web/dist", "apps/codex-runner/dist"]) {
        fs.mkdirSync(path, { recursive: true }); fs.writeFileSync(path + "/index.js", "synthetic build bytes");
      }
      console.log(${JSON.stringify(summary)});\n`,
  };
  for (const [path, value] of Object.entries(sources)) write(root, path, value);
  for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Synthetic fixture"]]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const gate = spawnSync(process.execPath, [gateExecutable, "gate", "docs/reviews/gate.json"], { cwd: root, encoding: "utf8" });
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  return root;
}

function prepare(root) {
  const result = cli(root, "prepare", "docs/reviews/gate.json", "docs/reviews/input.json");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return read(root, "docs/reviews/input.json");
}

function completeRecords(root, input) {
  const expected = input.expected;
  const commit = "a".repeat(40);
  const worker = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const exercise = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";
  const inventory = { "node_modules/fixture/index.js": { sha256: "b".repeat(64), bytes: 10 } };
  const assets = { reading_sha256: "c".repeat(64), graph_sha256: "d".repeat(64), chapters: [0, 1, 2, 3].map((index) => ({ index, chapter_sha256: "e".repeat(64), image_sha256: "f".repeat(64), model_sha256: "1".repeat(64) })) };
  const values = {
    source_mapping: { released_commit: commit, gate_source_snapshot_sha256: expected.gate_source_snapshot_sha256, released_source_snapshot_sha256: expected.gate_source_snapshot_sha256 },
    worker: { released_commit: commit, source_snapshot_sha256: expected.gate_source_snapshot_sha256, version_id: worker, allocation_complete: true, versions: [{ version_id: worker, percentage: 100 }], artifact_files: expected.worker_artifact_files },
    runner: { released_commit: commit, source_snapshot_sha256: expected.gate_source_snapshot_sha256, inventory_complete: true, artifact_files: expected.runner_artifact_files, installed_files_sha256: expected.runner_files_sha256, node_version: expected.node_version, dependency_lock_sha256: expected.dependency_lock_sha256, dependency_inventory: inventory, dependency_inventory_sha256: hash(inventory) },
    execution: { released_commit: commit, worker_version_id: worker, runner_files_sha256: expected.runner_files_sha256, repository_pins: expected.repository_pins, tuples: expected.tuples, image_provider_observed_model: null, image_provider_observation_status: "not_exposed" },
    migrations: { released_commit: commit, inventory_complete: true, applied_files: expected.migration_files, applied_files_sha256: expected.migration_files_sha256, manifest_sha256: expected.migration_manifest_sha256, integrity_check: "ok", foreign_key_violations: 0 },
    authorization: { authorized: true, scope: "portrait_lifecycle", exercise_id: exercise },
    completion: { state: "ready", saved_images: 4, saved_models: 4, reader_visible: true, complete_source_preserved: true, saved_assets: assets },
    saved_reuse: { saved_assets: assets, new_provider_requests: 0, reader_visible: true },
    withdrawal: { unfinished_work_stopped: true, accepted_assets_preserved: true, late_completion_published: false, fresh_requests_blocked: true, saved_assets_sha256: hash(assets) },
    deletion: { deletion_scope: "account", deletion_completed: true, access_denied: true, jobs_invalidated: true, inventory_retained: true, encrypted_artifacts_remaining: 0, saved_assets_sha256: hash(assets) },
    late_upload: { late_upload_attempted: true, late_upload_published: false, cleanup_rerun_completed: true, late_object_absent: true, access_denied: true, inventory_retained: true, late_object_sha256: "2".repeat(64) },
  };
  const date = new Date().toISOString();
  for (const kind of ["authorization", ...Object.keys(values).filter((kind) => kind !== "authorization")]) {
    const wrapper = structuredClone(input.record_templates[kind]);
    wrapper.recorded_at = date;
    wrapper.data = values[kind];
    if (["completion", "saved_reuse", "withdrawal", "deletion", "late_upload"].includes(kind)) {
      Object.assign(wrapper.data, { released_commit: commit, worker_version_id: worker, runner_files_sha256: expected.runner_files_sha256, exercise_id: exercise, authorization_sha256: input.records.authorization.sha256 });
    }
    const path = `docs/reviews/records/${kind}.json`;
    write(root, path, wrapper);
    input.records[kind] = { path, sha256: sha256Hex(readFileSync(join(root, path))) };
  }
  write(root, "docs/reviews/input.json", input);
  return values;
}

function reconcile(root, name = "result") {
  const result = cli(root, "reconcile", "docs/reviews/gate.json", "docs/reviews/input.json", `docs/reviews/${name}.json`);
  return { result, value: read(root, `docs/reviews/${name}.json`) };
}

function changeRecord(root, input, kind, edit) {
  const reference = input.records[kind];
  const wrapper = read(root, reference.path);
  edit(wrapper);
  write(root, reference.path, wrapper);
  reference.sha256 = sha256Hex(readFileSync(join(root, reference.path)));
  write(root, "docs/reviews/input.json", input);
}

test("prepare validates the existing local gate and leaves all external observations blank", () => {
  const root = repository();
  try {
    const input = prepare(root);
    const receipt = read(root, "docs/reviews/gate.json");
    assert.equal(input.gate_receipt_sha256, sha256Hex(readFileSync(join(root, "docs/reviews/gate.json"))));
    assert.equal(input.expected.gate_source_snapshot_sha256, receipt.source_before.files_sha256);
    assert.equal(input.expected.tuples.length, 7);
    assert.equal(Object.hasOwn(input.expected.migration_files, "db/d1/MIGRATIONS.json"), false);
    assert.equal(input.expected.migration_manifest_sha256, receipt.repository_identity.migrations.files["db/d1/MIGRATIONS.json"]);
    assert.equal(input.records.worker.path, null);
    const { result, value } = reconcile(root);
    assert.equal(result.status, 1);
    assert.equal(value.status, "incomplete_recorded_chain");
    assert.equal(value.deployment_status, "unverified");
    assert.ok(value.gaps.includes("worker_record_missing"));
    assert.ok(value.gaps.includes("late_upload_record_missing"));
    assert.equal(receipt.deployment.status, "unverified");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a complete hash-matched offline record stays recorded and never proves deployment", () => {
  const root = repository();
  try {
    const input = prepare(root);
    completeRecords(root, input);
    const { result, value } = reconcile(root);
    assert.equal(result.status, 0, result.stdout + result.stderr + JSON.stringify(value.gaps));
    assert.equal(value.status, "consistent_recorded_chain");
    assert.equal(value.deployment_status, "unverified");
    assert.equal(value.independent_live_observation, false);
    assert.equal(value.image_provider_identity_status, "unverified");
    assert.deepEqual(value.gaps, []);
    assert.equal(value.components.completion.status, "recorded_consistent");
    assert.equal(value.components.completion.evidence_sha256, input.records.completion.sha256);
    assert.equal(value.components.completion.recorded_at, read(root, input.records.completion.path).recorded_at);
    assert.doesNotMatch(readFileSync(join(root, "docs/reviews/result.json"), "utf8"), /synthetic build bytes|fixture-model|node_modules\/fixture/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("reconciliation rejects incomplete traffic, artifacts, pins, migrations and lifecycle claims", () => {
  const mutations = [
    ["source_mapping", (v) => { v.data.released_source_snapshot_sha256 = "0".repeat(64); }, "source_mapping_snapshot_mismatch"],
    ["worker", (v) => { v.data.versions[0].percentage = 99; }, "worker_traffic_incomplete"],
    ["worker", (v) => { v.data.versions.push({ version_id: "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee", percentage: 1 }); }, "worker_traffic_incomplete"],
    ["worker", (v) => { delete v.data.artifact_files[Object.keys(v.data.artifact_files)[0]]; }, "worker_artifacts_mismatch"],
    ["runner", (v) => { Object.values(v.data.artifact_files)[0].sha256 = "0".repeat(64); }, "runner_artifacts_mismatch"],
    ["runner", (v) => { v.data.dependency_inventory_sha256 = "0".repeat(64); }, "runner_dependencies_invalid"],
    ["execution", (v) => { v.data.tuples.pop(); }, "execution_tuples_mismatch"],
    ["execution", (v) => { v.data.tuples[0].model = "incorrect-model"; }, "execution_tuples_mismatch"],
    ["execution", (v) => { v.data.repository_pins[0].source_sha256 = "0".repeat(64); }, "execution_pins_mismatch"],
    ["execution", (v) => { v.data.image_provider_observed_model = "invented"; }, "execution_image_identity_unsupported"],
    ["migrations", (v) => { delete v.data.applied_files[Object.keys(v.data.applied_files)[0]]; }, "migrations_files_mismatch"],
    ["migrations", (v) => { v.data.applied_files["db/d1/9999_extra.sql"] = "0".repeat(64); }, "migrations_files_mismatch"],
    ["migrations", (v) => { v.data.manifest_sha256 = "0".repeat(64); }, "migrations_files_mismatch"],
    ["migrations", (v) => { v.data.foreign_key_violations = 1; }, "migrations_integrity_incomplete"],
    ["authorization", (v) => { v.data.authorized = false; }, "authorization_missing_authority"],
    ["completion", (v) => { v.data.saved_models = 3; }, "completion_outcome_incomplete"],
    ["saved_reuse", (v) => { v.data.saved_assets.graph_sha256 = "0".repeat(64); }, "saved_reuse_assets_mismatch"],
    ["saved_reuse", (v) => { v.data.new_provider_requests = 1; }, "saved_reuse_regenerated"],
    ["saved_reuse", (v) => { v.data.reader_visible = false; }, "saved_reuse_reader_unverified"],
    ["withdrawal", (v) => { v.data.late_completion_published = true; }, "withdrawal_outcome_incomplete"],
    ["deletion", (v) => { v.data.encrypted_artifacts_remaining = 1; }, "deletion_outcome_incomplete"],
    ["deletion", (v) => { v.data.deletion_scope = "one_file"; }, "deletion_outcome_incomplete"],
    ["late_upload", (v) => { v.data.late_object_absent = false; }, "late_upload_outcome_incomplete"],
    ["late_upload", (v) => { v.data.exercise_id = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee"; }, "late_upload_lifecycle_binding_mismatch"],
    ["late_upload", (v) => { v.recorded_at = "2000-01-01T00:00:00.000Z"; }, "late_upload_chronology_invalid"],
  ];
  const root = repository();
  try {
    const original = prepare(root);
    for (const [index, [kind, mutate, gap]] of mutations.entries()) {
      const input = structuredClone(original);
      completeRecords(root, input);
      changeRecord(root, input, kind, mutate);
      const { result, value } = reconcile(root, `failure-${index}`);
      assert.equal(result.status, 1, `${kind}: ${result.stderr}`);
      assert.equal(value.status, "incomplete_recorded_chain");
      assert.equal(value.deployment_status, "unverified");
      assert.ok(value.gaps.includes(gap), `${gap}: ${value.gaps}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("record-file hashing, strict input, bounded reads, safe paths and exclusive writes fail without leaking contents", () => {
  const root = repository();
  try {
    const input = prepare(root);
    completeRecords(root, input);
    const original = readFileSync(join(root, input.records.worker.path), "utf8");
    write(root, input.records.worker.path, original + " ");
    let value = reconcile(root, "hash-mismatch").value;
    assert.ok(value.gaps.includes("worker_evidence_hash_mismatch"));
    write(root, input.records.worker.path, original);
    changeRecord(root, input, "worker", (v) => { v.data.account_id = "PRIVATE_SECRET_MARKER"; });
    value = reconcile(root, "extra-fields").value;
    assert.ok(value.gaps.includes("worker_record_invalid"));
    assert.equal(value.components.worker.evidence_sha256, input.records.worker.sha256);
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE_SECRET_MARKER/);
    for (const [index, bytes] of ["PRIVATE_SECRET_MARKER", " ".repeat(8 * 1024 * 1024 + 1), '{"records":"PRIVATE_SECRET_MARKER"}'].entries()) {
      write(root, "docs/reviews/bad.json", bytes);
      const result = cli(root, "reconcile", "docs/reviews/gate.json", "docs/reviews/bad.json", `docs/reviews/bad-result-${index}.json`);
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SECRET_MARKER/);
    }
    assert.equal(cli(root, "template", "docs/reviews/input.json").status, 1);
    assert.equal(cli(root, "template", "source.json").status, 1);
    assert.equal(cli(root, "template", "../outside.json").status, 1);
    symlinkSync(join(root, "apps"), join(root, "docs/reviews/linked"));
    assert.equal(cli(root, "template", "docs/reviews/linked/source.json").status, 1);
    assert.equal(existsSync(join(root, "apps/source.json")), false);
    write(root, "apps/api/dist/index.js", "changed local artifact bytes");
    const stale = cli(root, "prepare", "docs/reviews/gate.json", "docs/reviews/stale.json");
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /local_gate_invalid/);
    assert.equal(existsSync(join(root, "docs/reviews/stale.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing evidence, receipt replacement and stale source cannot close the record chain", () => {
  const root = repository();
  try {
    const original = prepare(root);
    for (const [index, edit, gap] of [
      [0, (input) => { input.records.runner.path = "docs/reviews/missing.json"; }, "runner_evidence_unreadable"],
      [1, (input) => { input.gate_receipt_sha256 = "0".repeat(64); }, "gate_receipt_hash_mismatch"],
      [2, (input) => { input.expected.tuples[0].reasoning = "low"; }, "gate_requirements_mismatch"],
      [3, (input) => { input.records.authorization = { path: null, sha256: null }; }, "authorization_record_missing"],
    ]) {
      const input = structuredClone(original);
      completeRecords(root, input);
      edit(input);
      write(root, "docs/reviews/input.json", input);
      const { result, value } = reconcile(root, `missing-${index}`);
      assert.equal(result.status, 1);
      assert.ok(value.gaps.includes(gap), value.gaps.join(","));
      assert.equal(value.deployment_status, "unverified");
    }
    const receipt = read(root, "docs/reviews/gate.json");
    receipt.deployment = { status: "observed", worker_version_id: "PRIVATE_SECRET_MARKER" };
    write(root, "docs/reviews/forged-gate.json", receipt);
    const forged = cli(root, "prepare", "docs/reviews/forged-gate.json", "docs/reviews/forged-input.json");
    assert.equal(forged.status, 1);
    assert.match(forged.stderr, /local_gate_invalid/);
    assert.doesNotMatch(forged.stdout + forged.stderr, /PRIVATE_SECRET_MARKER/);
    write(root, "changed-source.ts", "new source bytes");
    const stale = cli(root, "reconcile", "docs/reviews/gate.json", "docs/reviews/input.json", "docs/reviews/stale-result.json");
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /local_gate_invalid/);
    assert.equal(existsSync(join(root, "docs/reviews/stale-result.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
