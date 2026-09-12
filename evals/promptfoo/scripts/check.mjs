#!/usr/bin/env node
/**
 * Offline self-check of the promptfoo glue. Calls no provider and does not
 * need promptfoo itself: it invokes the prompt functions, test generators,
 * and assertions exactly as promptfoo would, against the repository's own
 * plan and corpus.
 *
 *   1. The Daily prompt function yields a parseable claim for every profile
 *      the test generator emits, carrying the compiled pin.
 *   2. The validators lane agrees with the corpus on every authored case.
 *
 * Output is content-free: ids, pins, counts, and invocation hashes. Exit 1
 * on any disagreement, so an operator can run this before spending a turn.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dailyHardGate from "../assertions/daily-hard-gate.mjs";
import dailyOutputSchema from "../assertions/daily-output-schema.mjs";
import expectedVerdict from "../assertions/expected-verdict.mjs";
import { loadDailyPlan } from "../lib/daily-plan.mjs";
import { authoredCandidate } from "../prompts/authored-candidate.mjs";
import { buildDailyClaim } from "../prompts/daily-claim.mjs";
import dailyProfiles from "../tests/daily-profiles.mjs";
import dailyValidatorCases from "../tests/daily-validator-cases.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
let failed = false;
const report = (line) => process.stdout.write(`${line}\n`);

// Removing database writing disables promptfoo's graceful abort handler.
// --help makes a regression safe: even if the wrapper accepts the flag, no
// provider runs. A correct refusal happens before promptfoo is loaded.
report("wrapper: cancellation guard");
for (const lane of ["daily", "validators"]) {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("./promptfoo.mjs", import.meta.url)),
    "eval", lane, "--no-write", "--help",
  ], { encoding: "utf8", timeout: 15_000 });
  const ok = result.status === 2 && result.stderr.includes("promptfoo.mjs: --no-write");
  if (!ok) failed = true;
  report(`  ${ok ? "ok  " : "FAIL"} ${lane} refuses --no-write before loading promptfoo`);
}
report("");

const plan = await loadDailyPlan();
report(`source ${plan.source.sha ?? "unknown"}${plan.source.dirty ? " (dirty)" : ""}`);
report(`pin ${JSON.stringify(plan.pin)}`);
report(`corpus ${plan.corpus_version}`);

report("");
report("daily lane: prompt function");
const profiles = await dailyProfiles();
for (const test of profiles) {
  try {
    const claim = JSON.parse(await buildDailyClaim({ vars: test.vars }));
    const ok = claim.schema_version === "codex-provider-claim/v1"
      && claim.model === plan.pin.model
      && claim.reasoning_effort === plan.pin.reasoning_effort
      && claim.prompt_version === plan.pin.prompt_version
      && typeof claim.invocation?.prompt === "string"
      && typeof claim.invocation?.output_schema === "object";
    if (!ok) failed = true;
    report(`  ${ok ? "ok  " : "FAIL"} ${test.vars.profile.padEnd(22)} ${test.metadata.shape.padEnd(20)} invocation sha256:${sha256(JSON.stringify(claim.invocation)).slice(0, 16)}`);
  } catch (error) {
    failed = true;
    report(`  FAIL ${test.vars.profile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
// The hard gate must reject a non-JSON output without throwing.
const notJson = await dailyHardGate("not json", { vars: profiles[0].vars });
if (notJson.pass !== false) failed = true;
report(`  ${notJson.pass === false ? "ok  " : "FAIL"} hard gate rejects non-JSON output (${notJson.reason})`);

report("");
report("validators lane: corpus agreement");
const cases = await dailyValidatorCases();
let agreed = 0;
for (const test of cases) {
  const output = await authoredCandidate({ vars: test.vars });
  const verdict = await expectedVerdict(output, { vars: test.vars });
  if (verdict.pass) agreed += 1;
  else {
    failed = true;
    report(`  FAIL ${test.description}: ${verdict.reason}`);
  }
}
report(`  ${agreed}/${cases.length} cases agree with the corpus`);

report("");
report("daily lane: output schema assertion (Worker validator)");
// Every corpus candidate the validator accepts is, by construction, schema-valid.
let schemaValidAccepted = 0;
let schemaInvalidRejected = 0;
for (const test of cases) {
  const verdict = dailyOutputSchema(await authoredCandidate({ vars: test.vars }));
  if (test.vars.expect === "accept") {
    if (verdict.pass) schemaValidAccepted += 1;
    else {
      failed = true;
      report(`  FAIL ${test.description}: accepted by the corpus but schema-invalid (${verdict.reason})`);
    }
  } else if (!verdict.pass) schemaInvalidRejected += 1;
}
const acceptCount = cases.filter((test) => test.vars.expect === "accept").length;
report(`  ${schemaValidAccepted}/${acceptCount} accept cases are schema-valid; ${schemaInvalidRejected} reject cases fail at the schema layer`);
const schemaNotJson = dailyOutputSchema("not json");
if (schemaNotJson.pass !== false) failed = true;
report(`  ${schemaNotJson.pass === false ? "ok  " : "FAIL"} schema assertion rejects non-JSON output (${schemaNotJson.reason})`);

report("");
report(failed ? "CHECK FAILED" : "CHECK PASSED (no provider invoked)");
process.exitCode = failed ? 1 : 0;
