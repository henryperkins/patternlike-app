import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { REPO_ROOT } from "./candidates.mjs";
import { provenanceProblems } from "../../pattern-corpus/provenance.mjs";

const original = readFileSync(join(REPO_ROOT, "pattern-corpus/fragments.json"), "utf8");
const validator = join(REPO_ROOT, "pattern-corpus/validate-fragments.mjs");
const recorded = JSON.parse(readFileSync(join(REPO_ROOT, "pattern-corpus/provenance.json"), "utf8"));

function run(fragments, provenance) {
  const directory = mkdtempSync(join(tmpdir(), "corpus-provenance-test-"));
  try {
    writeFileSync(join(directory, "fragments.json"), fragments);
    if (provenance !== undefined) writeFileSync(join(directory, "provenance.json"), JSON.stringify(provenance));
    return spawnSync(process.execPath, [validator, join(directory, "fragments.json")], { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("fragment validation refuses a missing provenance record", () => {
  const result = run(original);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /provenance.*missing/i);
});

test("fragment validation refuses content whose hash no longer matches the record", () => {
  const fragments = JSON.parse(original);
  fragments[0].excerpt += " Another reflective sentence.";
  const result = run(JSON.stringify(fragments), {
    schema_version: "pattern-corpus-provenance.v1",
    content_sha256: createHash("sha256").update(original).digest("hex"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /content.*hash.*mismatch/i);
});

test("the recorded corpus passes integrity without claiming human certification", () => {
  const result = run(original, recorded);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /human editorial certification incomplete/);
});

test("each fragment must occur exactly once with its own content hash", () => {
  for (const change of [
    (value) => { value.fragments.pop(); },
    (value) => { value.fragments[1] = value.fragments[0]; },
    (value) => { value.fragments[0].sha256 = "0".repeat(64); },
    (value) => { value.fragment_count -= 1; },
  ]) {
    const value = structuredClone(recorded);
    change(value);
    assert.notDeepEqual(provenanceProblems(original, value), []);
  }
});

test("the record cannot silently relabel the corpus or invent a human certification", () => {
  for (const change of [
    (value) => { value.origin = "human_authored"; },
    (value) => { value.generation.model = { status: "recorded", value: "a-current-runtime-model" }; },
    (value) => { delete value.generation.account_context; },
    (value) => { value.human_review = { status: "complete", certified_fragment_count: 60, certifications: [] }; },
    (value) => { value.public_activation.status = "observed"; },
  ]) {
    const value = structuredClone(recorded);
    change(value);
    assert.notDeepEqual(provenanceProblems(original, value), []);
  }
});

test("declared corpus metadata must agree with the hashed fragment metadata", () => {
  for (const key of ["edition", "corpus_release_id", "content_path"]) {
    const value = structuredClone(recorded);
    value[key] = "a different edition";
    assert.match(provenanceProblems(original, value).join("\n"), /metadata.*mismatch/);
  }
});

test("the origin record must bind the rights decision bytes without claiming unresolved review", () => {
  for (const change of [
    (value) => { value.origin_evidence_sha256 = "0".repeat(64); },
    (value) => { value.origin_evidence_path = "a-different-decision.md"; },
    (value) => { value.license.counsel_review_status = "observed"; },
    (value) => { value.source_material_review.no_unpublished_third_party_source_supplied = true; },
  ]) {
    const value = structuredClone(recorded);
    change(value);
    assert.notDeepEqual(provenanceProblems(original, value), []);
  }
});
