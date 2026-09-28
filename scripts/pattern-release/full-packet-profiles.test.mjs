import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { tsImport } from "tsx/esm/api";
import { REPO_ROOT } from "./candidates.mjs";

const evaluation = await tsImport("../../apps/api/src/services/reading-evaluation.ts", import.meta.url);
const original = JSON.parse(readFileSync(join(REPO_ROOT, "apps/api/test/fixtures/reading-evaluation-corpus.json"), "utf8"));

function withGenerator(input, run) {
  const directory = mkdtempSync(join(tmpdir(), "full-packet-profiles-test-"));
  try {
    const script = join(directory, "scripts/pattern-release/full-packet-profiles.mjs");
    const fixture = join(directory, "apps/api/test/fixtures/reading-evaluation-corpus.json");
    mkdirSync(dirname(script), { recursive: true });
    mkdirSync(dirname(fixture), { recursive: true });
    copyFileSync(join(REPO_ROOT, "scripts/pattern-release/full-packet-profiles.mjs"), script);
    writeFileSync(fixture, `${JSON.stringify(input, null, 2)}\n`);
    const generate = () => {
      const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      generate.summary = JSON.parse(result.stdout);
      return readFileSync(fixture, "utf8");
    };
    run(generate);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the real profile generator preserves the evaluated corpus policy, history, and every existing candidate", () => {
  const input = structuredClone(original);
  input["//"].push("A later review note must survive profile regeneration.");
  withGenerator(input, (generate) => {
    const firstBytes = generate();
    const generated = JSON.parse(firstBytes);
    assert.deepEqual(generate.summary.new_cases, []);
    assert.equal(generated.corpus_version, input.corpus_version);
    assert.deepEqual(generated.gates, input.gates);
    assert.deepEqual(generated.base, input.base);
    assert.deepEqual(generated["//"], input["//"]);
    for (const previous of input.cases) {
      assert.deepEqual(generated.cases.find((entry) => entry.id === previous.id), previous, previous.id);
    }
    for (const id of Object.keys(generated.profiles)) {
      assert(evaluation.prepareProfile(generated, id).request.facts.length > 0, id);
    }
    for (const entry of generated.cases) {
      assert.equal(evaluation.evaluateCase(generated, entry).actual, entry.expect, entry.id);
    }
    assert.equal(generate(), firstBytes, "a second real run must be byte-idempotent");
  });
});

test("the real generator rebuilds missing full-packet controls with an accepted complete disclosure", () => {
  const input = structuredClone(original);
  for (const id of ["exact_full_packet", "unknown_full_packet"]) delete input.profiles[id];
  input.cases = input.cases.filter((entry) => !["exact_full_packet", "unknown_full_packet"].includes(entry.profile));
  withGenerator(input, (generate) => {
    const generated = JSON.parse(generate());
    assert.deepEqual(generate.summary.new_cases, [
      "fullpacket.accept.relational", "fullpacket.reject.ungrounded", "unknown_full.accept.relational",
      "unknown_full.reject.ungrounded", "unknown_full.accept.disclosure",
    ]);
    for (const id of ["exact_full_packet", "unknown_full_packet"]) {
      const prepared = evaluation.prepareProfile(generated, id);
      assert(prepared.request.facts.length > 50, id);
      const cases = generated.cases.filter((entry) => entry.profile === id);
      assert(cases.some((entry) => entry.expect === "accept"), id);
      assert(cases.some((entry) => entry.expect === "reject"), id);
      for (const entry of cases) {
        const result = evaluation.evaluateCase(generated, entry);
        assert.equal(result.actual, entry.expect, `${entry.id}: ${JSON.stringify(result.failures)}`);
      }
    }
    const historical = generated.cases.find((entry) => entry.id === "unknown_full.accept.relational");
    assert.equal(historical.expect, "reject");
    assert.deepEqual(historical.candidate, original.cases.find((entry) => entry.id === historical.id).candidate);
    const current = generated.cases.find((entry) => entry.id === "unknown_full.accept.disclosure");
    assert.equal(current.expect, "accept");
    assert.equal(current.candidate.uncertainty_note.text,
      "Your birth time is unknown. Angles are omitted because your birth time is unknown. Houses are omitted because your birth time is unknown. Time-sensitive Moon details are omitted because your birth time is unknown.");
  });
});
