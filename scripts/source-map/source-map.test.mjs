import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const definition = "docs/architecture/source-map/map.json";
const fixed = ["scripts/source-map/model.mjs", "scripts/source-map/snapshot.mjs", "scripts/source-map/cli.mjs", "scripts/pattern-release/candidates.mjs", "package.json", ".nvmrc"];
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "source map "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (p, bytes) => { mkdirSync(dirname(resolve(root, p)), { recursive: true }); writeFileSync(resolve(root, p), bytes); };
  for (const p of fixed) if (existsSync(resolve(checkout, p))) put(p, readFileSync(resolve(checkout, p)));
  const model = { schema_version: "patternlike-source-map.v1", title: "Map <test> [plain]", branches: [{ id: "branch", title: "Branch", topics: [{ id: "topic", title: "Topic", leaves: [{ id: "leaf", text: "Answer", evidence_ids: ["answer"] }] }] }], evidence: [{ id: "answer", kind: "source", path: "src/answer [one].js", selector: { text: "export const answer =" }, observed_at: null }] };
  const save = () => put(definition, JSON.stringify(model));
  put(model.evidence[0].path, "// fixture\r\nexport const answer = 42;\r\n"); save();
  const git = (...args) => { const r = spawnSync("git", args, { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git("init", "-q"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Fixture"); git("add", "."); git("commit", "-qm", "fixture");
  const invoke = (...args) => { const r = spawnSync(process.execPath, [resolve(checkout, "scripts/source-map/cli.mjs"), ...args], { cwd: root, encoding: "utf8" }); let result; try { result = JSON.parse(r.stdout); } catch { result = { missing_result: true }; } return { exitCode: r.status, result, stderr: r.stderr }; };
  return { root, put, model, save, git, invoke, capture: (id = "2026-09-09-fixture") => invoke("capture", id) };
}
test("captures deterministic siblings and detects dirty referenced bytes", (t) => {
  const f = fixture(t); const a = f.capture(); assert.equal(a.exitCode, 0, JSON.stringify(a));
  const b = f.capture("2026-09-10-fixture"); assert.equal(b.exitCode, 0); assert.equal(a.result.content_sha256, b.result.content_sha256);
  const p = a.result.snapshot_path; assert.equal(f.invoke("check", p).result.status, "verified");
  f.put(f.model.evidence[0].path, "export const answer = 43;\n");
  const changed = f.invoke("check", p); assert.equal(changed.exitCode, 1); assert.ok(changed.result.problems.some(p => p.code === "source_changed"));
});
function fails(result, code, exit = 1) { assert.equal(result.exitCode, exit, JSON.stringify(result)); assert.ok(result.result.problems.some(p => p.code === code), JSON.stringify(result)); }
for (const [name, change] of [
  ["unknown field", m => { m.extra = true; }], ["duplicate IDs", m => { m.evidence[0].id = "leaf"; }],
  ["dangling evidence", m => { m.branches[0].topics[0].leaves[0].evidence_ids = ["missing"]; }],
  ["unused evidence", m => { m.evidence.push({ ...m.evidence[0], id: "unused" }); }],
  ["mixed kinds", m => { m.evidence.push({ ...m.evidence[0], id: "past", kind: "recorded_observation", observed_at: "2026-09-09T00:00:00.000Z" }); m.branches[0].topics[0].leaves[0].evidence_ids.push("past"); }],
  ["invalid date", m => { m.evidence[0].kind = "recorded_observation"; m.evidence[0].observed_at = "2026-02-30T00:00:00.000Z"; }],
  ["multiline prose", m => { m.title = "one\ntwo"; }], ["oversized selector", m => { m.evidence[0].selector.text = "a".repeat(2049); }],
]) test(`rejects ${name}`, t => { const f = fixture(t); change(f.model); f.save(); fails(f.capture(), "definition_invalid"); });
for (const path of ["../outside", "/etc/passwd", "C:/secret", "src\\secret", "src/./answer", "src//answer", ".git/config", "node_modules/x", ".env.local", "output/test", "docs/architecture/source-map/map.json"]) test(`refuses unsafe evidence ${path}`, t => { const f = fixture(t); f.model.evidence[0].path = path; f.save(); fails(f.capture(), "path_unsafe", 2); });
for (const [name, source, code] of [["missing", "nothing\n", "anchor_missing"], ["ambiguous", "export const answer = 1;\nexport const answer = 2;", "anchor_ambiguous"]]) test(`rejects ${name} anchors`, t => { const f = fixture(t); f.put(f.model.evidence[0].path, source); fails(f.capture(), code); });
test("source deletion, moved lines, byte modes, and input whitespace invalidate receipts", t => {
  const f = fixture(t); const a = f.capture(); assert.equal(a.exitCode, 0); const p = a.result.snapshot_path;
  const original = readFileSync(resolve(f.root, f.model.evidence[0].path));
  rmSync(resolve(f.root, f.model.evidence[0].path)); fails(f.invoke("check", p), "source_missing");
  f.put(f.model.evidence[0].path, Buffer.concat([Buffer.from("\n"), original])); fails(f.invoke("check", p), "source_changed");
  const b = f.capture("2026-09-10-moved"); assert.equal(b.exitCode, 0); assert.equal(JSON.parse(readFileSync(resolve(f.root, b.result.snapshot_path, "source-snapshot.json"))).identity.anchors.answer.start_line, 3);
  f.put(f.model.evidence[0].path, original); chmodSync(resolve(f.root, f.model.evidence[0].path), 0o755); fails(f.invoke("check", p), "source_changed");
  chmodSync(resolve(f.root, f.model.evidence[0].path), 0o644); f.put(definition, JSON.stringify(f.model) + "\n"); fails(f.invoke("check", p), "definition_changed");
});
for (const path of fixed) test(`tracks tooling ${path}`, t => { const f = fixture(t); const a = f.capture(); assert.equal(a.exitCode, 0); f.put(path, readFileSync(resolve(f.root, path)) + "\n"); fails(f.invoke("check", a.result.snapshot_path), "tooling_changed"); });
test("scoped dirty context, unrelated changes, later commits, and relocated clone verify", t => {
  const f = fixture(t); f.put(f.model.evidence[0].path, "export const answer = 43;\n"); f.put("unrelated-secret-name", "private");
  const a = f.capture(); assert.equal(a.exitCode, 0); const p = a.result.snapshot_path; const snapshot = JSON.parse(readFileSync(resolve(f.root, p, "source-snapshot.json")));
  assert.equal(snapshot.repository.worktree_has_changes, true); assert.deepEqual(snapshot.repository.dirty_paths, [f.model.evidence[0].path]);
  assert.equal(f.invoke("check", p).exitCode, 0); f.git("add", "."); f.git("commit", "-qm", "later"); const b = f.invoke("check", p); assert.equal(b.exitCode, 0); assert.equal(b.result.base_commit_matches, false);
  const clone = resolve(f.root, "../", `${f.root.split("/").at(-1)}-clone`); t.after(() => rmSync(clone, { recursive: true, force: true })); cpSync(f.root, clone, { recursive: true });
  const r = spawnSync(process.execPath, [resolve(checkout, "scripts/source-map/cli.mjs"), "check", p], { cwd: clone, encoding: "utf8" }); assert.equal(r.status, 0, r.stdout);
});
test("exclusive output and incomplete bundles are preserved and rejected", t => {
  const f = fixture(t); const a = f.capture(); assert.equal(a.exitCode, 0); const p = a.result.snapshot_path;
  fails(f.capture(), "output_exists", 2); rmSync(resolve(f.root, p, "source-snapshot.json")); fails(f.invoke("check", p), "manifest_incomplete"); fails(f.capture(), "output_exists", 2);
});
test("closed bundle membership and generated bytes", t => {
  const f = fixture(t); const a = f.capture(); assert.equal(a.exitCode, 0); const p = a.result.snapshot_path;
  f.put(`${p}/extra`, "x"); fails(f.invoke("check", p), "manifest_incomplete"); rmSync(resolve(f.root, p, "extra")); f.put(`${p}/source-evidence.md`, "edited"); fails(f.invoke("check", p), "bundle_changed");
});
test("symlinks and ignored evidence cannot be read", t => {
  const f = fixture(t); const p = f.model.evidence[0].path; rmSync(resolve(f.root, p)); symlinkSync("/etc/passwd", resolve(f.root, p)); fails(f.capture(), "path_unsafe", 2);
  rmSync(resolve(f.root, p)); f.put(p, "export const answer = 42;\n"); f.git("rm", "--cached", p); f.put(".gitignore", "src/\n"); fails(f.capture(), "path_unsafe", 2);
});
test("closed usage and historical schema return bounded safe JSON", t => {
  const f = fixture(t); fails(f.invoke("capture", "2026-02-30-bad"), "usage_invalid", 2); fails(f.invoke("check", "../private-secret"), "path_unsafe", 2);
  const a = f.capture(); assert.equal(a.exitCode, 0); f.put(`${a.result.snapshot_path}/source-snapshot.json`, JSON.stringify({ schema_version: "historical" })); fails(f.invoke("check", a.result.snapshot_path), "snapshot_version_unsupported");
});
const { run } = await import("./snapshot.mjs");
const { createHash } = await import("node:crypto");
const { canonicalJson } = await import("../pattern-release/candidates.mjs");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
for (const change of [s => { delete s.identity.referenced_files[Object.keys(s.identity.referenced_files)[0]]; s.repository.dirty_paths = []; s.repository.worktree_has_changes = false; }, s => { delete s.identity.tooling_files[".nvmrc"]; }, s => { delete s.identity.anchors.answer; }, s => { s.identity.counts.leaves++; }, s => { s.identity.anchors.answer.start_line++; s.identity.anchors.answer.end_line++; }]) test("recomputed digests cannot hide incomplete or false manifests", t => {
  const f = fixture(t); const a = f.capture(); assert.equal(a.exitCode, 0); const path = `${a.result.snapshot_path}/source-snapshot.json`; const s = JSON.parse(readFileSync(resolve(f.root, path))); change(s); s.content_sha256 = sha(canonicalJson(s.identity)); f.put(path, JSON.stringify(s)); assert.equal(f.invoke("check", a.result.snapshot_path).exitCode, 1);
});
for (const command of ["capture", "check"]) for (const boundary of ["source", "definition", "head"]) test(`${command} rejects concurrent ${boundary} drift`, t => {
  const f = fixture(t); const arg = command === "capture" ? "2026-09-10-drift" : f.capture().result.snapshot_path;
  const result = run(command, arg, { cwd: f.root, beforeRecheck: () => {
    if (boundary === "source") f.put(f.model.evidence[0].path, "export const answer = 99;\n");
    if (boundary === "definition") f.put(definition, JSON.stringify(f.model) + "\n");
    if (boundary === "head") f.git("commit", "--allow-empty", "-qm", "concurrent");
  } });
  fails(result, `source_changed_during_${command}`); if (command === "capture") assert.equal(existsSync(resolve(f.root, "docs/architecture/source-map/snapshots", arg, "source-snapshot.json")), false);
});
test("interrupted exclusive writes leave an unusable partial bundle", t => {
  const f = fixture(t); let writes = 0;
  const result = run("capture", "2026-09-10-interrupted", { cwd: f.root, writeFile: (...args) => { if (++writes === 3) throw Error("DO NOT PRINT PRIVATE PAYLOAD"); writeFileSync(...args); } });
  fails(result, "io_failed", 2); assert.equal(JSON.stringify(result).includes("PRIVATE PAYLOAD"), false); const p = "docs/architecture/source-map/snapshots/2026-09-10-interrupted";
  assert.equal(existsSync(resolve(f.root, p, "map-input.json")), true); assert.equal(existsSync(resolve(f.root, p, "source-snapshot.json")), false); fails(f.invoke("check", p), "manifest_incomplete"); fails(f.capture("2026-09-10-interrupted"), "output_exists", 2);
});
test("concurrent captures admit one exclusive owner", async t => {
  const f = fixture(t); const { spawn } = await import("node:child_process");
  const invoke = () => new Promise(resolveResult => { const child = spawn(process.execPath, [resolve(checkout, "scripts/source-map/cli.mjs"), "capture", "2026-09-10-race"], { cwd: f.root }); let output = ""; child.stdout.on("data", x => { output += x; }); child.on("close", code => resolveResult({ exitCode: code, result: JSON.parse(output) })); });
  const results = await Promise.all([invoke(), invoke()]); assert.deepEqual(results.map(x => x.exitCode).sort(), [0, 2]); fails(results.find(x => x.exitCode === 2), "output_exists", 2);
});
test("bounds diagnostics at fifty without hiding failures or source payloads", t => {
  const f = fixture(t); const leaf = f.model.branches[0].topics[0].leaves[0]; f.model.evidence = []; leaf.evidence_ids = [];
  for (let n = 0; n < 60; n++) { const id = `e-${n}`; const p = `src/file-${n}.js`; f.put(p, "const UNIQUE_PRIVATE_SELECTOR = 1;\n"); f.model.evidence.push({ id, kind: "source", path: p, selector: { text: "UNIQUE_PRIVATE_SELECTOR" }, observed_at: null }); leaf.evidence_ids.push(id); }
  f.save(); const a = f.capture(); assert.equal(a.exitCode, 0); for (const e of f.model.evidence) f.put(e.path, "const UNIQUE_PRIVATE_SELECTOR = 2;\n");
  const result = f.invoke("check", a.result.snapshot_path); assert.equal(result.exitCode, 1); assert.equal(result.result.problem_count, 60); assert.equal(result.result.problems.length, 50); assert.equal(result.result.problems_truncated, true); assert.equal(JSON.stringify(result).includes("UNIQUE_PRIVATE_SELECTOR"), false);
});
test("prototype property names and Markdown punctuation preserve safe identities and links", t => {
  const f = fixture(t); f.model.evidence[0].id = "constructor"; f.model.evidence[0].path = "__proto__"; f.model.branches[0].topics[0].leaves[0].evidence_ids = ["constructor"]; f.put("__proto__", "export const answer = 1;\n"); f.save(); const a = f.capture(); assert.equal(a.exitCode, 0); assert.equal(f.invoke("check", a.result.snapshot_path).exitCode, 0);
  const md = readFileSync(resolve(f.root, a.result.snapshot_path, "patternlike-source-mindmap.md"), "utf8"); assert.ok(md.includes("&lt;test&gt; \\[plain\\]")); assert.ok(!md.includes(f.root));
});
test("invalid UTF-8 evidence and symlinked output parents are refused", t => {
  const f = fixture(t); f.put(f.model.evidence[0].path, Buffer.from([0xff])); fails(f.capture(), "definition_invalid"); f.put(f.model.evidence[0].path, "export const answer = 1;\n");
  symlinkSync(tmpdir(), resolve(f.root, "docs/architecture/source-map/snapshots")); fails(f.capture(), "path_unsafe", 2);
});
test("initial executable definition remains verifiable independently of copied bundle mode", t => {
  const f = fixture(t); chmodSync(resolve(f.root, definition), 0o755); const a = f.capture(); assert.equal(a.exitCode, 0); assert.equal(f.invoke("check", a.result.snapshot_path).exitCode, 0);
});
test("bundle entries added during checking invalidate the stability pass", t => {
  const f = fixture(t); const a = f.capture(); assert.equal(a.exitCode, 0); fails(run("check", a.result.snapshot_path, { cwd: f.root, beforeRecheck: () => f.put(`${a.result.snapshot_path}/extra`, "private") }), "source_changed_during_check");
});
test("committed punctuation paths have no fabricated dirtiness and encoded source links", t => {
  const f = fixture(t); const a = f.capture(); assert.equal(a.exitCode, 0); const s = JSON.parse(readFileSync(resolve(f.root, a.result.snapshot_path, "source-snapshot.json"))); assert.deepEqual(s.repository.dirty_paths, []);
  const md = readFileSync(resolve(f.root, a.result.snapshot_path, "source-evidence.md"), "utf8"); assert.ok(md.includes("../../../../../src/answer%20%5Bone%5D.js#L2"));
});
for (const p of [".envrc", ".npmrc", "secrets/key.pem", ".ssh/id_rsa"]) test(`refuses local credential evidence ${p}`, t => {
  const f = fixture(t); f.put(p, "export const answer = SECRET;\n"); f.model.evidence[0].path = p; f.save(); fails(f.capture(), "path_unsafe", 2);
});
test("a swapped output parent never redirects a write outside the repository", async t => {
  const { renameSync } = await import("node:fs"); const f = fixture(t); const outside = mkdtempSync(resolve(tmpdir(), "map-outside-")); t.after(() => rmSync(outside, { recursive: true, force: true }));
  const p = "docs/architecture/source-map/snapshots/2026-09-10-parent-race"; let swapped = false;
  const result = run("capture", "2026-09-10-parent-race", { cwd: f.root, writeFile: (...args) => {
    if (!swapped) { swapped = true; renameSync(resolve(f.root, p), resolve(f.root, `${p}-moved`)); symlinkSync(outside, resolve(f.root, p)); }
    writeFileSync(...args);
  } });
  assert.equal(existsSync(resolve(outside, "map-input.json")), false); assert.equal(result.exitCode, 2);
});
test("an ignored cited tooling file is refused before publication", t => {
  const f = fixture(t); f.model.evidence[0].path = "package.json"; f.model.evidence[0].selector.text = '"name"'; f.save(); f.put(".gitignore", "package.json\n"); fails(f.capture(), "path_unsafe", 2);
});
test("a replaced source parent cannot redirect a buffered evidence read", async t => {
  const { renameSync, readlinkSync } = await import("node:fs"); const f = fixture(t); const outside = mkdtempSync(resolve(tmpdir(), "map-read-outside-")); t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(resolve(outside, "answer [one].js"), "OUTSIDE_PRIVATE_PAYLOAD"); let sawOutside = false; let swapped = false; let called = false;
  const result = run("capture", "2026-09-10-read-race", { cwd: f.root, readFile: (handle, options) => {
    const target = typeof handle === "number" ? readlinkSync(`/proc/self/fd/${handle}`) : handle;
    if (target.endsWith("answer [one].js")) called = true;
    if (called && !swapped) { swapped = true; renameSync(resolve(f.root, "src"), resolve(f.root, "src-moved")); symlinkSync(outside, resolve(f.root, "src")); }
    const bytes = readFileSync(handle, options); if (bytes.includes("OUTSIDE_PRIVATE_PAYLOAD")) sawOutside = true; return bytes;
  } });
  assert.equal(called, true); assert.equal(sawOutside, false); assert.notEqual(result.exitCode, 0);
});
test("cited tooling newly ignored during the final read fails closed", t => {
  const f = fixture(t); f.model.evidence[0].path = "package.json"; f.model.evidence[0].selector.text = '"name"'; f.save();
  fails(run("capture", "2026-09-10-ignore-race", { cwd: f.root, beforeRecheck: () => f.put(".gitignore", "package.json\n") }), "source_changed_during_capture");
});
test("descriptor ownership is released on success and failed publication", async t => {
  const { readdirSync } = await import("node:fs"); const f = fixture(t); assert.equal(f.capture().exitCode, 0);
  const before = readdirSync("/proc/self/fd").length;
  for (let n = 0; n < 3; n++) {
    assert.equal(run("check", "docs/architecture/source-map/snapshots/2026-09-09-fixture", { cwd: f.root }).exitCode, 0);
    fails(run("capture", `2026-09-10-leak-${n}`, { cwd: f.root, writeFile: () => { throw Error("interrupted"); } }), "io_failed", 2);
  }
  assert.equal(readdirSync("/proc/self/fd").length, before);
});
test("unsupported platform fails closed before source reads or publication", t => {
  const f = fixture(t); const original = Object.getOwnPropertyDescriptor(process, "platform");
  try { Object.defineProperty(process, "platform", { value: "darwin" }); fails(run("capture", "2026-09-10-platform", { cwd: f.root }), "io_failed", 2); }
  finally { Object.defineProperty(process, "platform", original); }
});
test("unavailable procfs is an environment failure with no publication", async t => {
  const { openSync } = await import("node:fs"); const f = fixture(t);
  fails(run("capture", "2026-09-10-no-proc", { cwd: f.root, openFile: (path, ...args) => { if (path.startsWith("/proc/self/fd/")) { const error = Error("unavailable"); error.code = "ENOENT"; throw error; } return openSync(path, ...args); } }), "io_failed", 2);
  assert.equal(existsSync(resolve(f.root, "docs/architecture/source-map/snapshots/2026-09-10-no-proc")), false);
});
test("source parent replacement immediately before file open cannot reach outside bytes", async t => {
  const { renameSync, openSync } = await import("node:fs"); const f = fixture(t); const outside = mkdtempSync(resolve(tmpdir(), "map-open-outside-")); t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(resolve(outside, "answer [one].js"), "OUTSIDE_PRIVATE_PAYLOAD"); let swapped = false; let sawOutside = false;
  const result = run("capture", "2026-09-10-open-race", { cwd: f.root,
    openFile: (path, ...args) => { if (!swapped && path.endsWith("/answer [one].js")) { swapped = true; renameSync(resolve(f.root, "src"), resolve(f.root, "src-moved")); symlinkSync(outside, resolve(f.root, "src")); } return openSync(path, ...args); },
    readFile: fd => { const bytes = readFileSync(fd); if (bytes.includes("OUTSIDE_PRIVATE_PAYLOAD")) sawOutside = true; return bytes; },
  });
  assert.equal(swapped, true); assert.equal(sawOutside, false); assert.notEqual(result.exitCode, 0);
});
test("missing output during writing is an output I/O failure", t => {
  const f = fixture(t);
  fails(run("capture", "2026-09-10-output-missing", { cwd: f.root, writeFile: () => { throw Object.assign(new Error("private output detail"), { code: "ENOENT" }); } }), "io_failed", 2);
});
for (const phase of ["parent", "directory", "observation"]) test(`missing output ${phase} is an output I/O failure`, async t => {
  const { openSync } = await import("node:fs"); const f = fixture(t); let directoryOpens = 0;
  fails(run("capture", "2026-09-10-output-race", { cwd: f.root, openFile: (path, ...args) => {
    const parent = path.endsWith("/snapshots") && existsSync(path);
    const directory = path.endsWith("/2026-09-10-output-race") && existsSync(path);
    if (directory) directoryOpens++;
    if ((phase === "parent" && parent) || (phase === "directory" && directory && directoryOpens === 1) || (phase === "observation" && directory && directoryOpens === 2)) throw Object.assign(new Error("private output detail"), { code: "ENOENT" });
    return openSync(path, ...args);
  } }), "io_failed", 2);
});
