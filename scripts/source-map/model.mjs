// Closed authored model and pure deterministic Markdown rendering.
export const DEFINITION = "docs/architecture/source-map/map.json";
export const SNAPSHOTS = "docs/architecture/source-map/snapshots";
export const TOOLING = Object.freeze([".nvmrc", "package.json", "scripts/pattern-release/candidates.mjs", "scripts/source-map/cli.mjs", "scripts/source-map/model.mjs", "scripts/source-map/snapshot.mjs"]);
export class MapError extends Error {
  constructor(code, path = null, evidenceId = null, exitCode = 1) {
    super(code); this.problems = [{ code, path, evidence_id: evidenceId }]; this.exitCode = exitCode;
  }
}
export function fail(code, path = null, evidenceId = null, exitCode = 1) { throw new MapError(code, path, evidenceId, exitCode); }
export function closed(value, keys) { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"); }
export function utc(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
export function captureId(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:-[a-z0-9]+)+$/.test(value) && utc(`${value.slice(0, 10)}T00:00:00.000Z`); }
export function safePath(path, evidence = false) {
  if (typeof path !== "string" || !path || /^[A-Za-z]:/.test(path) || /[\\\x00-\x1f\x7f]/.test(path) || path.split("/").some(p => !p || p === "." || p === "..")) fail("path_unsafe", null, null, 2);
  if (path.split("/").some(p => p === ".git" || p === "node_modules" || p === "dist" || p === "build" || p === "coverage" || p === ".venv" || p === ".wrangler" || p === ".env" || p === ".envrc" || p === ".npmrc" || p === ".ssh" || p === ".aws" || /\.(?:pem|key|p12|pfx)$/.test(p) || p.startsWith(".env.") || p === ".dev.vars" || p.startsWith(".dev.vars.")) || (evidence && (path === "output" || path.startsWith("output/") || path === "docs/architecture/source-map" || path.startsWith("docs/architecture/source-map/")))) fail("path_unsafe", null, null, 2);
  return path;
}
export function validateModel(model) {
  const invalid = () => fail("definition_invalid");
  const object = (v, k) => { if (!closed(v, k)) invalid(); };
  const prose = v => { if (typeof v !== "string" || !v.trim() || /[\x00-\x1f\x7f\u2028\u2029]/.test(v)) invalid(); };
  const array = v => { if (!Array.isArray(v) || !v.length) invalid(); };
  const ids = new Set(); const id = v => { if (typeof v !== "string" || !/^[a-z][a-z0-9-]*$/.test(v) || ids.has(v)) invalid(); ids.add(v); };
  object(model, ["schema_version", "title", "branches", "evidence"]); if (model.schema_version !== "patternlike-source-map.v1") invalid(); prose(model.title); array(model.branches); array(model.evidence);
  const evidence = new Map();
  for (const e of model.evidence) {
    object(e, ["id", "kind", "path", "selector", "observed_at"]); id(e.id); safePath(e.path, true); object(e.selector, ["text"]);
    if (typeof e.selector.text !== "string" || !e.selector.text.trim() || Buffer.byteLength(e.selector.text) > 2048 || (e.kind !== "source" && e.kind !== "recorded_observation") || (e.kind === "source" ? e.observed_at !== null : !utc(e.observed_at))) invalid(); evidence.set(e.id, e);
  }
  const used = new Set(); let topics = 0; let leaves = 0;
  for (const b of model.branches) {
    object(b, ["id", "title", "topics"]); id(b.id); prose(b.title); array(b.topics); topics += b.topics.length;
    for (const t of b.topics) {
      object(t, ["id", "title", "leaves"]); id(t.id); prose(t.title); array(t.leaves); leaves += t.leaves.length;
      for (const l of t.leaves) {
        object(l, ["id", "text", "evidence_ids"]); id(l.id); prose(l.text); array(l.evidence_ids);
        if (new Set(l.evidence_ids).size !== l.evidence_ids.length || l.evidence_ids.some(x => !evidence.has(x)) || new Set(l.evidence_ids.map(x => evidence.get(x).kind)).size !== 1) invalid();
        l.evidence_ids.forEach(x => used.add(x));
      }
    }
  }
  if (used.size !== evidence.size) invalid();
  return { branches: model.branches.length, topics, leaves, evidence_entries: evidence.size, referenced_files: new Set(model.evidence.map(e => e.path)).size };
}
const escape = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]()#+.!|~-]/g, "\\$&");
const notice = "Scope: referenced files and map inputs only. This is not repository, release, editorial, or production certification. See [capture context and complete file identities](source-snapshot.json).";
export function render(model, anchors) {
  const map = [`# ${escape(model.title)}`, "", notice, ""]; const evidence = ["# Source evidence", "", notice, ""];
  const byId = new Map(model.evidence.map(e => [e.id, e]));
  for (const b of model.branches) {
    map.push(`## ${escape(b.title)}`, "");
    for (const t of b.topics) {
      map.push(`### ${escape(t.title)}`, "");
      for (const l of t.leaves) {
        const observed = byId.get(l.evidence_ids[0]); const label = observed.kind === "recorded_observation" ? ` (Recorded observation: ${observed.observed_at})` : "";
        map.push(`<a id="claim-${l.id}"></a>`, `- ${escape(l.text)}${label} ${l.evidence_ids.map(id => `[${id}](source-evidence.md#evidence-${id})`).join(" ")}`, "");
        evidence.push(`<a id="claim-${l.id}"></a>`, `- [${escape(l.text)}](patternlike-source-mindmap.md#claim-${l.id}) — ${l.evidence_ids.map(id => `[${id}](#evidence-${id})`).join(" ")}`, "");
      }
    }
  }
  for (const e of model.evidence) {
    const a = anchors[e.id]; const path = e.path.split("/").map(p => encodeURIComponent(p).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
    evidence.push(`<a id="evidence-${e.id}"></a>`, `## ${e.id}`, "", `${e.kind === "source" ? "Current source" : `Recorded observation: ${e.observed_at}`} — [${escape(e.path)}](../../../../../${path}#L${a.start_line}), lines ${a.start_line}–${a.end_line}.`, "");
  }
  return { "patternlike-source-mindmap.md": Buffer.from(map.join("\n")), "source-evidence.md": Buffer.from(evidence.join("\n")) };
}
