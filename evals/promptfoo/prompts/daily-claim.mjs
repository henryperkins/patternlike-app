/**
 * promptfoo prompt function for the Daily lane.
 *
 * The "prompt" handed to the provider is the complete codex-provider claim
 * for one synthetic profile, serialized. Everything inside it comes from the
 * shared plan, so the instructions, packet, schema, model, effort, and
 * timeout are the compiled pin's, not values typed into this directory.
 */
import { loadDailyPlan } from "../lib/daily-plan.mjs";

export async function buildDailyClaim({ vars }) {
  const plan = await loadDailyPlan();
  const entry = plan.cases.get(vars?.profile);
  if (!entry) throw new Error(`unknown Daily evaluation profile: ${String(vars?.profile)}`);
  return JSON.stringify(entry.claim);
}
