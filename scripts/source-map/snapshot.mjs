import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, readdirSync, realpathSync, openSync, closeSync, fstatSync, constants } from "node:fs";
import { canonicalJson } from "../pattern-release/candidates.mjs";
import { DEFINITION, SNAPSHOTS, TOOLING, MapError, fail, closed, utc, captureId, safePath, validateModel, render } from "./model.mjs";
export const SCOPE = "referenced_files_and_map_inputs_only";
const FILES = ["map-input.json", "patternlike-source-mindmap.md", "source-evidence.md", "source-snapshot.json"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const identity = (bytes, executable = false) => ({ sha256: hash(bytes), bytes: bytes.length, executable });
const problem = (code, path = null, evidence_id = null) => ({ code, path, evidence_id });
const parse = (bytes, code) => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail(code); } };
// Optional boundary callbacks make concurrent file/HEAD changes reproducible without
// production test flags. beforeRecheck runs before the final stability read;
// openFile receives fd-relative single-component paths, and readFile/writeFile
// receive already opened descriptors whose ownership remains with this module.
export function run(command, argument, { cwd = process.cwd(), beforeRecheck, openFile = openSync, readFile = readFileSync, writeFile = writeFileSync, now = () => new Date() } = {}) {
  let root; let rootFd; let snapshotPath = null; let snapshot; let head = null; let evidencePaths = new Set();
  const git = args => execFileSync("git", args, { cwd: root ?? cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const headNow = () => git(["rev-parse", "HEAD"]);
  // Linux procfs supplies descriptor-relative operations without a native addon.
  // Each supplied component is opened with NOFOLLOW; the only followed link is
  // the kernel-owned fd reference, which pins the previously validated inode.
  const fdPath = fd => `/proc/self/fd/${fd}`;
  const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  const ioError = (error, path, missing = "source_missing") => {
    if (error instanceof MapError) throw error;
    if (error.code === "ELOOP" || error.code === "ENOTDIR") fail("path_unsafe", path, null, 2);
    if (error.code === "ENOENT") fail(missing, path, null, missing === "io_failed" ? 2 : 1);
    fail("io_failed", path, null, 2);
  };
  const openWithin = (path, { directory = false, createParents = false, allowAbsent = false, missing = "source_missing" } = {}) => {
    safePath(path); let parent = rootFd; const opened = [];
    try {
      const parts = path.split("/");
      for (let n = 0; n < parts.length; n++) {
        const last = n === parts.length - 1;
        const target = `${fdPath(parent)}/${parts[n]}`;
        if (createParents) {
          try { mkdirSync(target); } catch (e) { if (e.code !== "EEXIST") throw e; }
        }
        const fd = openFile(target, last && !directory ? constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK : directoryFlags);
        opened.push(fd); parent = fd;
      }
      const result = opened.pop(); return result;
    } catch (e) {
      if (allowAbsent && e.code === "ENOENT") return null;
      ioError(e, path, missing);
    } finally { for (const fd of opened.reverse()) closeSync(fd); }
  };
  const checked = (path, options = {}) => {
    const fd = openWithin(path, options); if (fd === null) return null;
    closeSync(fd); return true;
  };
  const listing = path => {
    const fd = openWithin(path, { directory: true, missing: "manifest_incomplete" });
    try { return readdirSync(fdPath(fd)).sort(); } finally { closeSync(fd); }
  };
  const read = (path, options = {}) => {
    safePath(path, options.evidence);
    if (options.evidence) {
      try { git(["check-ignore", "--no-index", "--", path]); fail("path_unsafe", path, null, 2); }
      catch (e) { if (e instanceof MapError) throw e; if (e.status !== 1) fail("io_failed", path, null, 2); }
    }
    const fd = openWithin(path, options);
    try {
      const stat = fstatSync(fd); if (!stat.isFile()) fail("path_unsafe", path, null, 2);
      const bytes = readFile(fd); return { bytes, identity: identity(bytes, Boolean(stat.mode & 0o111)) };
    } catch (e) { ioError(e, path, options.missing); }
    finally { closeSync(fd); }
  };
  const collect = model => {
    evidencePaths = new Set(model.evidence.map(e => e.path));
    const paths = [...new Set([DEFINITION, ...TOOLING, ...evidencePaths])].sort();
    const files = Object.create(null); const problems = [];
    for (const p of paths) {
      try { files[p] = read(p, { evidence: evidencePaths.has(p), missing: p === DEFINITION ? "definition_changed" : TOOLING.includes(p) ? "tooling_changed" : "source_missing" }); }
      catch (e) { if (!(e instanceof MapError) || e.exitCode === 2) throw e; problems.push(...e.problems); }
    }
    return { files, problems };
  };
  const derive = (model, files) => {
    const anchors = Object.create(null); const problems = []; const decoded = Object.create(null);
    for (const e of model.evidence) {
      if (!files[e.path]) continue;
      if (!(e.path in decoded)) { try { decoded[e.path] = new TextDecoder("utf-8", { fatal: true }).decode(files[e.path].bytes).replace(/\r\n/g, "\n"); } catch { problems.push(problem("definition_invalid", e.path, e.id)); decoded[e.path] = null; } }
      const source = decoded[e.path]; if (source === null) continue;
      const text = e.selector.text.replace(/\r\n/g, "\n"); const start = source.indexOf(text);
      if (start < 0) { problems.push(problem("anchor_missing", e.path, e.id)); continue; }
      if (source.indexOf(text, start + 1) >= 0) { problems.push(problem("anchor_ambiguous", e.path, e.id)); continue; }
      const startLine = source.slice(0, start).split("\n").length;
      anchors[e.id] = { path: e.path, start_line: startLine, end_line: startLine + text.split("\n").length - 1, selector_sha256: hash(Buffer.from(e.selector.text)) };
    }
    return { anchors, problems };
  };
  const recheck = (files, originalHead, code) => {
    beforeRecheck?.({ root, command, snapshot_path: snapshotPath });
    try {
      if (headNow() !== originalHead) fail(code);
      if (command === "check" && !equal(listing(snapshotPath), [...FILES].sort())) fail(code, snapshotPath);
      for (const [p, f] of Object.entries(files)) if (!equal(read(p, { evidence: evidencePaths.has(p) }).identity, f.identity)) fail(code, p);
    } catch (e) { if (e instanceof MapError && e.problems[0].code === code) throw e; fail(code); }
  };
  const result = (problems, exitCode = problems.length ? 1 : 0) => ({ exitCode, result: {
    status: problems.length ? "failed" : command === "capture" ? "captured" : "verified", scope: SCOPE, snapshot_path: snapshotPath,
    content_sha256: snapshot?.content_sha256 ?? null, base_commit: snapshot?.repository?.base_commit ?? null, current_head: head,
    base_commit_matches: snapshot?.repository?.base_commit ? snapshot.repository.base_commit === head : null,
    node_version: process.version, counts: snapshot?.identity?.counts ?? null,
    problem_count: problems.length, problems_truncated: problems.length > 50, problems: problems.slice(0, 50),
  } });
  try {
    if (process.versions.node.split(".")[0] !== "22") fail("node_version_unsupported", null, null, 2);
    if (!["capture", "check"].includes(command) || typeof argument !== "string") fail("usage_invalid", null, null, 2);
    if (command === "capture") { if (!captureId(argument)) fail("usage_invalid", null, null, 2); snapshotPath = `${SNAPSHOTS}/${argument}`; }
    else { safePath(argument); if (!argument.startsWith(`${SNAPSHOTS}/`) || !captureId(argument.slice(SNAPSHOTS.length + 1))) fail("path_unsafe", null, null, 2); snapshotPath = argument; }
    try { root = realpathSync(git(["rev-parse", "--show-toplevel"])); head = headNow(); } catch { fail("repository_unavailable", null, null, 2); }
    // Fail closed on hosts without the exact descriptor-relative capability.
    if (process.platform !== "linux" || !constants.O_NOFOLLOW || !constants.O_DIRECTORY) fail("io_failed", null, null, 2);
    try {
      rootFd = openFile("/", directoryFlags);
      for (const component of root.split("/").filter(Boolean)) {
        const next = openFile(`${fdPath(rootFd)}/${component}`, directoryFlags);
        closeSync(rootFd); rootFd = next;
      }
      const probe = openFile(`${fdPath(rootFd)}/.`, directoryFlags);
      try { if (fstatSync(probe).ino !== fstatSync(rootFd).ino || fstatSync(probe).dev !== fstatSync(rootFd).dev) fail("io_failed", null, null, 2); }
      finally { closeSync(probe); }
    } catch (e) {
      if (e instanceof MapError) throw e;
      if (e.code === "ELOOP" || e.code === "ENOTDIR") fail("path_unsafe", null, null, 2);
      fail("io_failed", null, null, 2);
    }
    if (command === "capture") {
      if (checked(snapshotPath, { allowAbsent: true })) fail("output_exists", snapshotPath, null, 2);
      const definition = read(DEFINITION); const model = parse(definition.bytes, "definition_invalid"); const counts = validateModel(model);
      const { files, problems } = collect(model); if (problems.length) return result(problems);
      if (!equal(definition.identity, files[DEFINITION].identity)) fail("source_changed_during_capture", DEFINITION);
      const derived = derive(model, files); if (derived.problems.length) return result(derived.problems);
      const outputs = { "map-input.json": definition.bytes, ...render(model, derived.anchors) };
      const dirtyPaths = [];
      for (const [p, file] of Object.entries(files)) {
        let entry; try { entry = git(["ls-tree", "-z", head, "--", p]); } catch { fail("repository_unavailable", null, null, 2); }
        const match = /^(\d+) blob ([a-f0-9]+)\t/.exec(entry);
        if (!match) { dirtyPaths.push(p); continue; }
        let bytes; try { bytes = execFileSync("git", ["cat-file", "blob", match[2]], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }); } catch { fail("repository_unavailable", null, null, 2); }
        if (!equal(identity(bytes, match[1] === "100755"), file.identity)) dirtyPaths.push(p);
      }
      const manifest = {
        definition: { path: DEFINITION, ...definition.identity },
        tooling_files: Object.fromEntries(TOOLING.map(p => [p, files[p].identity])),
        referenced_files: Object.fromEntries([...new Set(model.evidence.map(e => e.path))].sort().map(p => [p, files[p].identity])),
        anchors: derived.anchors, outputs: Object.fromEntries(Object.entries(outputs).map(([p, bytes]) => [p, identity(bytes)])), counts,
      };
      let branch; try { branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]); } catch { branch = null; }
      snapshot = { schema_version: "patternlike-source-map-snapshot.v1", capture_id: argument, captured_at: now().toISOString(), scope: SCOPE, repository: { base_commit: head, branch, worktree_has_changes: dirtyPaths.length > 0, dirty_paths: dirtyPaths.sort() }, identity: manifest, content_sha256: hash(Buffer.from(canonicalJson(manifest))) };
      recheck(files, head, "source_changed_during_capture");
      const parentFd = openWithin(SNAPSHOTS, { directory: true, createParents: true, missing: "io_failed" });
      let outputFd;
      try {
        try { mkdirSync(`${fdPath(parentFd)}/${argument}`); }
        catch (e) { fail(e.code === "EEXIST" ? "output_exists" : "io_failed", snapshotPath, null, 2); }
        try { outputFd = openFile(`${fdPath(parentFd)}/${argument}`, directoryFlags); }
        catch (e) { ioError(e, snapshotPath, "io_failed"); }
        const assertOutput = () => {
          const current = openWithin(snapshotPath, { directory: true, missing: "io_failed" });
          try {
            const expected = fstatSync(outputFd); const actual = fstatSync(current);
            if (actual.ino !== expected.ino || actual.dev !== expected.dev) fail("path_unsafe", snapshotPath, null, 2);
          } finally { closeSync(current); }
        };
        for (const [p, bytes] of Object.entries({ ...outputs, "source-snapshot.json": Buffer.from(JSON.stringify(snapshot, null, 2) + "\n") })) {
          assertOutput(); let fd;
          try {
            fd = openFile(`${fdPath(outputFd)}/${p}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
            writeFile(fd, bytes);
          } catch (e) { ioError(e, `${snapshotPath}/${p}`, "io_failed"); }
          finally { if (fd !== undefined) closeSync(fd); }
          assertOutput();
        }
      } finally { if (outputFd !== undefined) closeSync(outputFd); closeSync(parentFd); }
      return result([]);
    }
    if (!equal(listing(snapshotPath), [...FILES].sort())) fail("manifest_incomplete", snapshotPath);
    const bundle = Object.fromEntries(FILES.map(p => [p, read(`${snapshotPath}/${p}`, { missing: "manifest_incomplete" })]));
    const receipt = parse(bundle["source-snapshot.json"].bytes, "snapshot_invalid");
    if (receipt?.schema_version !== "patternlike-source-map-snapshot.v1") fail("snapshot_version_unsupported", `${snapshotPath}/source-snapshot.json`);
    validateSnapshot(receipt, snapshotPath);
    snapshot = receipt;
    const model = parse(bundle["map-input.json"].bytes, "definition_invalid"); const counts = validateModel(model);
    const { files, problems } = collect(model); const derived = derive(model, files); problems.push(...derived.problems);
    const expectedSources = [...new Set(model.evidence.map(e => e.path))].sort();
    if (!equal(Object.keys(snapshot.identity.referenced_files).sort(), expectedSources) || !equal(Object.keys(snapshot.identity.tooling_files).sort(), [...TOOLING].sort()) || !equal(Object.keys(snapshot.identity.anchors).sort(), model.evidence.map(e => e.id).sort())) problems.push(problem("manifest_incomplete"));
    if (!equal(snapshot.identity.counts, counts) || hash(Buffer.from(canonicalJson(snapshot.identity))) !== snapshot.content_sha256) problems.push(problem("snapshot_invalid"));
    if (snapshot.identity.definition.sha256 !== bundle["map-input.json"].identity.sha256 || snapshot.identity.definition.bytes !== bundle["map-input.json"].identity.bytes) problems.push(problem("bundle_changed", `${snapshotPath}/map-input.json`));
    if (files[DEFINITION] && !equal({ path: DEFINITION, ...files[DEFINITION].identity }, snapshot.identity.definition)) problems.push(problem("definition_changed", DEFINITION));
    for (const p of TOOLING) if (files[p] && !equal(files[p].identity, snapshot.identity.tooling_files[p])) problems.push(problem("tooling_changed", p));
    for (const p of expectedSources) if (files[p] && !equal(files[p].identity, snapshot.identity.referenced_files[p])) problems.push(problem("source_changed", p));
    if (!equal(derived.anchors, snapshot.identity.anchors)) problems.push(problem("snapshot_invalid"));
    for (const p of FILES.slice(0, 3)) if (!equal(bundle[p].identity, snapshot.identity.outputs[p])) problems.push(problem("bundle_changed", `${snapshotPath}/${p}`));
    if (!derived.problems.length && Object.keys(derived.anchors).length === model.evidence.length) for (const [p, bytes] of Object.entries(render(model, derived.anchors))) if (!bytes.equals(bundle[p].bytes)) problems.push(problem("bundle_changed", `${snapshotPath}/${p}`));
    // Include bundle bytes in the final stability pass as well as consumed inputs.
    recheck({ ...files, ...Object.fromEntries(FILES.map(p => [`${snapshotPath}/${p}`, bundle[p]])) }, head, "source_changed_during_check");
    return result(problems);
  } catch (e) { return result(e instanceof MapError ? e.problems : [problem("io_failed")], e instanceof MapError ? e.exitCode : 2); }
  finally { if (rootFd !== undefined) closeSync(rootFd); }
}
function validateSnapshot(s, path) {
  const invalid = () => fail("snapshot_invalid", `${path}/source-snapshot.json`);
  const object = (v, keys) => { if (!closed(v, keys)) invalid(); };
  const digest = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const natural = v => Number.isSafeInteger(v) && v >= 0;
  const file = v => { object(v, ["sha256", "bytes", "executable"]); if (!digest(v.sha256) || !natural(v.bytes) || typeof v.executable !== "boolean") invalid(); };
  const dictionary = v => { if (!v || typeof v !== "object" || Array.isArray(v)) invalid(); };
  object(s, ["schema_version", "capture_id", "captured_at", "scope", "repository", "identity", "content_sha256"]);
  if (!captureId(s.capture_id) || path !== `${SNAPSHOTS}/${s.capture_id}` || !utc(s.captured_at) || s.scope !== SCOPE || !digest(s.content_sha256)) invalid();
  object(s.repository, ["base_commit", "branch", "worktree_has_changes", "dirty_paths"]);
  const r = s.repository;
  if (typeof r.base_commit !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(r.base_commit) || !(r.branch === null || typeof r.branch === "string" && r.branch.length > 0 && !/[\x00-\x1f\x7f]/.test(r.branch)) || typeof r.worktree_has_changes !== "boolean" || !Array.isArray(r.dirty_paths)) invalid();
  object(s.identity, ["definition", "tooling_files", "referenced_files", "anchors", "outputs", "counts"]); const i = s.identity;
  object(i.definition, ["path", "sha256", "bytes", "executable"]); if (i.definition.path !== DEFINITION) invalid(); const { path: _, ...d } = i.definition; file(d);
  for (const name of ["tooling_files", "referenced_files"]) { dictionary(i[name]); for (const [p, f] of Object.entries(i[name])) { safePath(p, name === "referenced_files"); file(f); } }
  dictionary(i.anchors); for (const [id, a] of Object.entries(i.anchors)) { if (!/^[a-z][a-z0-9-]*$/.test(id)) invalid(); object(a, ["path", "start_line", "end_line", "selector_sha256"]); safePath(a.path, true); if (!natural(a.start_line) || a.start_line < 1 || !natural(a.end_line) || a.end_line < a.start_line || !digest(a.selector_sha256)) invalid(); }
  object(i.outputs, FILES.slice(0, 3)); Object.values(i.outputs).forEach(file);
  object(i.counts, ["branches", "topics", "leaves", "evidence_entries", "referenced_files"]); if (Object.values(i.counts).some(v => !natural(v) || v < 1)) invalid();
  const consumed = new Set([DEFINITION, ...TOOLING, ...Object.keys(i.referenced_files)]);
  if (r.dirty_paths.some(p => typeof p !== "string" || !consumed.has(p)) || !equal(r.dirty_paths, [...new Set(r.dirty_paths)].sort()) || r.worktree_has_changes !== Boolean(r.dirty_paths.length)) invalid();
}
