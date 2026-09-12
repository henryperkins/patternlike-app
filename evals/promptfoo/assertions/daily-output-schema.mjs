/**
 * promptfoo assertion for the Daily lane, layer 1: the frozen m5 output
 * schema, checked by the same precompiled validator the Worker runs
 * (`apps/api/src/generated/reading-validators.js`, build output of
 * `npm run generate:validators -w @patternlike/api`).
 *
 * promptfoo's own `is-json` cannot be used for this: its Ajv does not know
 * the draft 2020-12 metaschema the contract declares, so every test errors
 * before scoring. The Worker's bundle is self-contained, draft-aware, and
 * byte-identical to what production applies to provider output.
 *
 * The reason lists instance paths and keywords only, never values.
 */
import { validateReadingOutput } from "../../../apps/api/src/generated/reading-validators.js";
import { parseCandidate } from "../lib/evaluation.mjs";

export default function dailyOutputSchema(output) {
  const candidate = parseCandidate(output);
  if (candidate === null) return { pass: false, score: 0, reason: "not_json", namedScores: { schema: 0 } };
  if (validateReadingOutput(candidate)) {
    return { pass: true, score: 1, reason: "valid against the frozen m5 output schema", namedScores: { schema: 1 } };
  }
  const problems = (validateReadingOutput.errors ?? []).slice(0, 8).map((error) => {
    const extra = error.params?.additionalProperty ? ` (${error.params.additionalProperty})` : "";
    return `${error.instancePath || "/"} ${error.keyword}${extra}`;
  });
  return { pass: false, score: 0, reason: problems.join("; ") || "schema violation", namedScores: { schema: 0 } };
}
