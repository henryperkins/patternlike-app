/**
 * One promptfoo test per authored case in the Daily evaluation corpus.
 *
 * These are the frozen candidate strings the corpus labels `accept` or
 * `reject`, with the exact `code.detail_code` a rejection is expected to
 * carry. They exercise the validator, not a model: the lane's provider is
 * `echo`. This duplicates the coverage of `reading-evaluation.test.ts` on
 * purpose; its value is the per-case view of validator behavior across
 * policy versions, including false rejections of authored acceptable prose.
 */
import { loadEvaluation } from "../lib/evaluation.mjs";
import { sourceIdentity } from "../lib/daily-plan.mjs";

export default async function dailyValidatorCases() {
  const evaluation = await loadEvaluation();
  const corpus = evaluation.loadEvaluationCorpus();
  const source = sourceIdentity();
  return corpus.cases.map((entry) => ({
    description: `${entry.id}: expect ${entry.expect}${entry.expect_detail ? ` (${entry.expect_detail})` : ""}`,
    vars: {
      profile: entry.profile,
      expect: entry.expect,
      expect_detail: entry.expect_detail ?? "",
      candidate: entry.candidate,
    },
    metadata: {
      lane: "validators",
      corpus_version: corpus.corpus_version,
      validation_policy_version: corpus.gates.validation_policy_version,
      evaluation_policy_version: evaluation.EVALUATION_POLICY_VERSION,
      git_sha: source.sha,
      git_dirty: source.dirty,
    },
  }));
}
