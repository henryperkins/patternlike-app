/**
 * One promptfoo test per synthetic profile in the Daily evaluation corpus.
 *
 * Metadata is content-free: pins, corpus version, and source identity, so a
 * results file can be reconciled against a commit later. No chart values,
 * packet text, or prose are placed here.
 */
import { loadDailyPlan } from "../lib/daily-plan.mjs";

export default async function dailyProfiles() {
  const plan = await loadDailyPlan();
  return [...plan.cases.values()].map((entry) => ({
    description: `${entry.id} (${entry.shape})`,
    vars: { profile: entry.id },
    metadata: {
      lane: "daily",
      shape: entry.shape,
      corpus_version: plan.corpus_version,
      provider: plan.pin.provider,
      model: plan.pin.model,
      reasoning_effort: plan.pin.reasoning_effort,
      prompt_version: plan.pin.prompt_version,
      selection_policy_version: plan.pin.selection_policy_version,
      validation_policy_version: plan.pin.validation_policy_version,
      git_sha: plan.source.sha,
      git_dirty: plan.source.dirty,
    },
  }));
}
