/**
 * promptfoo assertion for the Daily lane: the production hard gate.
 *
 * Passes only when `validateReadingCandidate` (reached through
 * `hardGateFindings`) accepts the output for the profile's prepared input.
 * The reason lists every `code.detail_code` on rejection and nothing else,
 * so a results file can be summarized without quoting prose.
 *
 * `qualitativeFindings` are reported as named scores, never as pass criteria:
 * the repository treats a dull reading as worse, not wrong.
 */
import { loadDailyPlan } from "../lib/daily-plan.mjs";
import { failureLabel, loadEvaluation, parseCandidate } from "../lib/evaluation.mjs";

export default async function dailyHardGate(output, context) {
  const profile = context?.vars?.profile;
  const plan = await loadDailyPlan();
  const entry = plan.cases.get(profile);
  if (!entry) return { pass: false, score: 0, reason: `unknown Daily evaluation profile: ${String(profile)}` };

  const candidate = parseCandidate(output);
  if (candidate === null) {
    return { pass: false, score: 0, reason: "schema_shape.not_json", namedScores: { hard_gate: 0, qualitative_clean: 0 } };
  }

  const evaluation = await loadEvaluation();
  const failures = evaluation.hardGateFindings(entry.prepared, candidate);
  if (failures.length > 0) {
    return {
      pass: false,
      score: 0,
      reason: failures.map(failureLabel).join(", "),
      namedScores: { hard_gate: 0, qualitative_clean: 0 },
    };
  }

  const findings = evaluation.qualitativeFindings(entry.prepared, candidate);
  return {
    pass: true,
    score: 1,
    reason: findings.length > 0 ? `accepted; qualitative: ${findings.join(", ")}` : "accepted; no qualitative findings",
    namedScores: { hard_gate: 1, qualitative_clean: findings.length === 0 ? 1 : 0 },
  };
}
