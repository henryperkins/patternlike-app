import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import type { ValidateFunction } from "ajv";
import { generateWorkerValidators } from "./generate-worker-validators.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractsRoot = resolve(apiRoot, "../../contracts");

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(contractsRoot, name), "utf8"));
}

test("checked-in validators match the current contracts and generator", async () => {
  for (const [name, generated] of await generateWorkerValidators()) {
    const stored = await readFile(resolve(apiRoot, "src/generated", name), "utf8");
    assert.ok(stored.replace(/\r\n/g, "\n") === generated, `Stale validator: ${name}`);
  }
});

test("bundled validators work with string code generation forbidden even during import", async () => {
  const built = await build({
    absWorkingDir: apiRoot,
    stdin: {
      contents: `
        export * from "./src/generated/reading-validators.js";
        export * from "./src/generated/strict-validators.js";
        export * from "./src/generated/ontology-output-validators.js";
      `,
      resolveDir: apiRoot,
    },
    bundle: true,
    format: "iife",
    globalName: "validators",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  // A fresh realm cannot reuse validators warmed by another test, so this
  // catches a bundle that only works once something else has already
  // evaluated it. It proves the absence of eval, not of CPU spend: nothing
  // here measures startup cost, which is the separate 10021 deploy failure
  // that moving compilation to build time also removes.
  const validators = runInNewContext(
    `${built.outputFiles[0]!.text}\nvalidators;`,
    {},
    { contextCodeGeneration: { strings: false, wasm: false }, timeout: 5_000 },
  ) as Record<string, ValidateFunction>;

  const validFixtures: Record<string, string> = {
    validateReadingOutput: "m5/fixtures/valid/reading-generation-output.json",
    validateEvidenceGraphV5: "m5/fixtures/valid/reading-evidence.daily.json",
    validateSourceCorpusRelease: "m7/fixtures/valid/pattern-source-corpus-release.synthetic.json",
    validateOntologyRelease: "m7/fixtures/valid/pattern-ontology-release.active.json",
    validateReplayEvent: "m7/fixtures/valid/pattern-erasure-replay-event.deleted.json",
    validateRegenerationReplayEvent: "m9/fixtures/valid/pattern-regeneration-replay-event.replaced.json",
  };
  for (const [name, filename] of Object.entries(validFixtures)) {
    assert.equal(validators[name]!(await fixture(filename)), true, name);
  }
  assert.equal(validators.validateTodayResponseV5!({
    schema_version: "0.5.0",
    reading: await fixture("m5/fixtures/valid/daily-reading.published.json"),
    evidence_url: "/v1/readings/rdg_01JAMPLEREADING00001/evidence",
  }), true);
  const bundle = await fixture("m3/fixtures/valid/content-release.bundle.json") as Record<string, unknown>;
  for (const [name, version] of [
    ["validateContentReleaseV3", "0.3.0"],
    ["validateContentReleaseV4", "0.4.0"],
  ] as const) {
    assert.equal(validators[name]!({
      schema_version: version,
      bundle: { ...bundle, schema_version: version },
      idempotency_key: "validator-regression-release-0001",
    }), true, name);
  }
  assert.equal(validators.validateNatalPredicate!({ type: "position", body: "sun", house: 1 }), true);
  assert.equal(validators.validateOntologyGenerationChunk!({
    schema_version: "0.7.0", records: [], complete: false,
  }), true);
  assert.equal(validators.validateOntologyRuleVerdict!({
    schema_version: "0.7.0",
    rule_id: "ont_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    verdict: "pass",
    dimensions: {
      source_support: "pass", entailment: "pass", contradiction: "pass",
      unsupported_expansion: "pass", diagnostic_or_predictive_drift: "pass",
      one_sided_or_essentialist_framing: "pass", tension_counter_expression_balance: "pass",
      uncertainty_compatibility: "pass", cross_record_conflict: "pass",
    },
  }), true);

  for (const [name, validate] of Object.entries(validators)) {
    assert.equal(validate(null), false, `${name} must still reject invalid input`);
    assert.ok(validate.errors?.length, `${name} must retain validation errors`);
  }
  const output = await fixture("m5/fixtures/valid/reading-generation-output.json") as Record<string, unknown>;
  assert.equal(validators.validateReadingOutput!({ ...output, unexpected: true }), false);
  const reading = await fixture("m5/fixtures/valid/daily-reading.published.json") as Record<string, unknown>;
  assert.equal(validators.validateTodayResponseV5!({
    schema_version: "0.5.0",
    reading: { ...reading, generated_at: "not-a-date" },
    evidence_url: null,
  }), false);
  assert.equal(validators.validateReadingOutput!(output), true);
  assert.equal(validators.validateReadingOutput!.errors, null);
});
