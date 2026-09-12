/**
 * promptfoo assertion for the validators lane: does the current validator
 * agree with the corpus label for an authored candidate?
 *
 * `accept` must produce no failures. `reject` must produce at least one, and
 * when the corpus predicts an exact `code.detail_code`, that code must be
 * among them. A mismatch in either direction is a validator change worth a
 * look: a widened gate publishes what the corpus says it should not, and a
 * narrowed one is a false rejection of authored acceptable prose.
 */
import { failureLabel, loadEvaluation, parseCandidate } from "../lib/evaluation.mjs";

export default async function expectedVerdict(output, context) {
  const vars = context?.vars ?? {};
  const expected = vars.expect;
  const expectedDetail = typeof vars.expect_detail === "string" && vars.expect_detail.length > 0 ? vars.expect_detail : null;
  if (expected !== "accept" && expected !== "reject") {
    return { pass: false, score: 0, reason: `corpus case has no usable expectation: ${String(expected)}` };
  }

  const evaluation = await loadEvaluation();
  const corpus = evaluation.loadEvaluationCorpus();
  const prepared = evaluation.prepareProfile(corpus, vars.profile);

  const candidate = parseCandidate(output);
  const failures = candidate === null
    ? [{ code: "schema_shape", detail_code: "not_json" }]
    : evaluation.hardGateFindings(prepared, candidate);
  const actual = failures.length === 0 ? "accept" : "reject";
  const labels = failures.map(failureLabel);

  if (actual !== expected) {
    return {
      pass: false,
      score: 0,
      reason: `expected ${expected}, got ${actual}${labels.length > 0 ? ` (${labels.join(", ")})` : ""}`,
    };
  }
  if (expected === "reject" && expectedDetail !== null && !labels.includes(expectedDetail)) {
    return { pass: false, score: 0, reason: `rejected, but not for ${expectedDetail}: ${labels.join(", ")}` };
  }
  return {
    pass: true,
    score: 1,
    reason: actual === "accept" ? "accepted as the corpus expects" : `rejected as the corpus expects: ${labels.join(", ")}`,
  };
}
