import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { REPO_ROOT } from "./candidates.mjs";
import * as evidence from "./release-evidence.mjs";

const executable = join(REPO_ROOT, "scripts/pattern-release/release-evidence.mjs");
const lanes = [
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
const summary = ["════ SUMMARY ════", "node    v22.23.2   npm 10.9.4   python 3.12.3", ...lanes.map((lane) => `  pass   ${lane}`), "ALL STEPS PASSED — safe to merge on local evidence."].join("\n");

function repository() {
  const root = mkdtempSync(join(tmpdir(), "release-evidence-test-"));
  for (const [path, value] of Object.entries({
    ".gitignore": "**/dist/\n",
    ".nvmrc": "22\n",
    "source.ts": "export const value = 1;\n",
    "docs/reviews/notes.md": "This evidence-only path is explicitly excluded.\n",
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Synthetic fixture"]]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  return root;
}

test("snapshot captures tracked and new source paths without copying their contents", () => {
  const root = repository();
  try {
    writeFileSync(join(root, "new.ts"), "Private test marker that must never appear in evidence.\n");
    const result = spawnSync(process.execPath, [executable, "snapshot", "docs/reviews/snapshot.json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const raw = readFileSync(join(root, "docs/reviews/snapshot.json"), "utf8");
    const snapshot = JSON.parse(raw);
    assert.deepEqual(Object.keys(snapshot.files), [".gitignore", ".nvmrc", "new.ts", "source.ts"]);
    assert.equal(snapshot.worktree_has_changes, true);
    assert.doesNotMatch(raw, /Private test marker/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source comparison rejects changed, missing, and newly added paths", () => {
  assert.equal(typeof evidence.compareSourceSnapshots, "function");
  const root = repository();
  try {
    const before = evidence.captureSourceSnapshot(root);
    writeFileSync(join(root, "source.ts"), "export const value = 2;\n");
    rmSync(join(root, ".nvmrc"));
    writeFileSync(join(root, "new.ts"), "new source\n");
    assert.deepEqual(evidence.compareSourceSnapshots(before, evidence.captureSourceSnapshot(root)), {
      ok: false, changed: ["source.ts"], missing: [".nvmrc"], added: ["new.ts"], problems: [],
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("source inventories preserve ordinary filenames that shadow object properties", () => {
  const root = repository();
  try {
    writeFileSync(join(root, "__proto__"), "source bytes\n");
    const before = evidence.captureSourceSnapshot(root);
    assert.equal(Object.hasOwn(before.files, "__proto__"), true);
    rmSync(join(root, "__proto__"));
    assert.deepEqual(evidence.compareSourceSnapshots(before, evidence.captureSourceSnapshot(root)).missing, ["__proto__"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("source comparison rejects a forged partial or malformed source manifest", () => {
  assert.equal(typeof evidence.compareSourceSnapshots, "function");
  const root = repository();
  try {
    const observed = evidence.captureSourceSnapshot(root);
    for (const change of [
      (value) => { value.file_count -= 1; },
      (value) => { delete value.files["source.ts"]; },
      (value) => { value.excluded_prefixes.push("source.ts"); },
      (value) => { value.files["../escape"] = value.files["source.ts"]; },
    ]) {
      const value = structuredClone(observed);
      change(value);
      assert.equal(evidence.compareSourceSnapshots(value, observed).ok, false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the gate parser requires the complete final summary and all fourteen distinct passing lanes", () => {
  assert.equal(typeof evidence.parseCiSummary, "function");
  const parsed = evidence.parseCiSummary("Private test output must not be copied.\n" + summary);
  assert.equal(parsed.passed, true);
  assert.equal(parsed.lanes.length, 14);
  assert.doesNotMatch(JSON.stringify(parsed), /Private test output/);
  for (const log of [
    summary.replace(`  pass   ${lanes[13]}\n`, ""),
    summary.replace(`  pass   ${lanes[13]}`, `  pass   ${lanes[0]}`),
    summary.replace(`  pass   ${lanes[8]}`, `  FAIL   ${lanes[8]}`),
    summary.replace("ALL STEPS PASSED — safe to merge on local evidence.", ""),
    "ALL STEPS PASSED — safe to merge on local evidence.",
  ]) assert.equal(evidence.parseCiSummary(log).passed, false);
});

function prepareGate(root, { mutate = false, partial = false, exit = 0 } = {}) {
  const files = {
    "package.json": JSON.stringify({ scripts: { "ci:local": "node fixture-gate.cjs" } }),
    "db/d1/MIGRATIONS.json": JSON.stringify({ migrations: [{ file: "0001_fixture.sql" }] }),
    "db/d1/0001_fixture.sql": "-- synthetic migration\n",
    "apps/api/src/services/reading-publisher.ts": 'export const READING_PROMPT_VERSION = "1.2.3";\nexport const OPENAI_READING_MODEL = "fixture-model";\n',
    "apps/api/src/services/pattern-publisher.ts": 'export const OPENAI_PATTERN_WRITER_MODEL = "fixture-model";\n',
    "packages/reading-engine/src/constrained-types.ts": 'export const VALIDATION_POLICY_VERSION = "1.2.3";\n',
    "packages/pattern-engine/src/policy.ts": 'export const PATTERN_VALIDATION_POLICY_VERSION = "1.2.3";\n',
    "apps/api/src/services/pattern-publication-safety.ts": 'export const PATTERN_PUBLICATION_SAFETY_POLICY_VERSION = "1.2.3";\n',
    "apps/codex-runner/src/codex-cli.ts": 'export const CODEX_TEXT_ISOLATION_VERSION = "1.0.0";\n',
    "fixture-gate.cjs": `const fs = require("node:fs");
      for (const path of ["apps/api/dist", "apps/web/dist", "apps/codex-runner/dist"]) {
        fs.mkdirSync(path, { recursive: true }); fs.writeFileSync(path + "/index.js", "synthetic build bytes");
      }
      ${mutate ? 'fs.writeFileSync("source.ts", "changed after the gate started");' : ""}
      console.log("Private gate output marker");
      console.log(${JSON.stringify(partial ? summary.replace(`  pass   ${lanes[13]}\n`, "") : summary)});
      process.exitCode = ${exit};\n`,
  };
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
}

test("a real child gate binds source, process exit, summary, build artifacts, and repository pins", () => {
  const root = repository();
  try {
    prepareGate(root);
    const result = spawnSync(process.execPath, [executable, "gate", "docs/reviews/gate.json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const raw = readFileSync(join(root, "docs/reviews/gate.json"), "utf8");
    const receipt = JSON.parse(raw);
    assert.equal(receipt.gate.exit_code, 0);
    assert.equal(receipt.gate.summary.lanes.length, 14);
    assert.equal(receipt.source_unchanged, true);
    assert.equal(receipt.artifacts.status, "observed");
    assert.equal(receipt.repository_identity.pins[0].values.OPENAI_READING_MODEL, "fixture-model");
    assert.equal(receipt.repository_identity.migrations.applied_status, "unverified");
    assert.equal(receipt.deployment.status, "unverified");
    assert.doesNotMatch(raw, /Private gate output marker|synthetic build bytes/);
    const verification = spawnSync(process.execPath, [executable, "verify", "docs/reviews/gate.json"], { cwd: root, encoding: "utf8" });
    assert.equal(verification.status, 0, verification.stdout + verification.stderr);

    const partial = structuredClone(receipt);
    delete partial.source_comparison;
    assert.equal(evidence.verifyReleaseEvidence(root, partial).passed, false);

    receipt.deployment = { status: "observed", worker_version_id: "partial-worker-observation" };
    writeFileSync(join(root, "docs/reviews/gate.json"), JSON.stringify(receipt));
    const forged = spawnSync(process.execPath, [executable, "verify", "docs/reviews/gate.json"], { cwd: root, encoding: "utf8" });
    assert.equal(forged.status, 1);
    assert.match(forged.stdout, /deployment_unverified/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("gate refuses source drift, incomplete totals, and a nonzero process exit", () => {
  for (const options of [{ mutate: true }, { partial: true }, { exit: 7 }]) {
    const root = repository();
    try {
      prepareGate(root, options);
      const result = spawnSync(process.execPath, [executable, "gate", "docs/reviews/gate.json"], { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 1);
      const receipt = JSON.parse(readFileSync(join(root, "docs/reviews/gate.json"), "utf8"));
      assert.equal(receipt.passed, false);
      if (options.mutate) assert.deepEqual(receipt.source_comparison?.changed, ["source.ts"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("gate cannot write its own receipt into the source being measured", () => {
  const root = repository();
  try {
    prepareGate(root);
    const result = spawnSync(process.execPath, [executable, "gate", "included-source-receipt.json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /evidence_destination_in_source/);
    assert.doesNotMatch(result.stdout, /Private gate output marker/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("malformed imported evidence is rejected without echoing its contents", () => {
  const root = repository();
  try {
    writeFileSync(join(root, "docs/reviews/invalid.json"), "PRIVATE_SECRET_SOURCE_MARKER");
    const result = spawnSync(process.execPath, [executable, "verify", "docs/reviews/invalid.json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SE/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("fresh verification detects artifact replacement after an otherwise passing gate", () => {
  const root = repository();
  try {
    prepareGate(root);
    const run = spawnSync(process.execPath, [executable, "gate", "docs/reviews/gate.json"], { cwd: root, encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    writeFileSync(join(root, "apps/api/dist/index.js"), "different uploaded bytes");
    const result = spawnSync(process.execPath, [executable, "verify", "docs/reviews/gate.json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /current_artifact_mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
