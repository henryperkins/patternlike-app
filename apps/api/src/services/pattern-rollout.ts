/**
 * Staged rollout for AI-generated Pattern.
 *
 * `off` is a real kill switch: queued Pattern jobs pause without provider
 * calls. Spec name: PATTERN_AI_ROLLOUT, values off | internal | first_open |
 * enabled (design spec 25.5). The runbook advances to `enabled` once the
 * rollout gates pass, so it has to be an accepted value: a mode this set does
 * not carry makes readPatternAiRollout return null, which configGuard turns
 * into 503 configuration_error on every path including POST /v1/sessions.
 *
 * `internal` admits designated staff accounts listed in
 * PATTERN_INTERNAL_ACCOUNT_IDS (JSON array or comma-separated user ids).
 * A missing or malformed allowlist is empty: nobody matches.
 *
 * `first_open` and `enabled` admit the same entry points here; they differ in
 * who is placed in the AI cohort, which is decided by isPatternAiCohort in
 * pattern-state.ts rather than by this table.
 */

import type { Env } from "../env.js";

export const PATTERN_AI_ROLLOUT_MODES = ["off", "internal", "first_open", "enabled"] as const;
export type PatternAiRollout = (typeof PATTERN_AI_ROLLOUT_MODES)[number];
export type PatternRolloutEntry = "internal" | "first_open" | "chart_correction";

const MODES: ReadonlySet<string> = new Set(PATTERN_AI_ROLLOUT_MODES);

export function isPatternAiRollout(value: string): value is PatternAiRollout {
  return MODES.has(value);
}

export function readPatternAiRollout(
  env: Partial<Pick<Env, "PATTERN_AI_ROLLOUT">>,
): PatternAiRollout | null {
  const raw = env.PATTERN_AI_ROLLOUT?.trim();
  if (!raw) return "off";
  return isPatternAiRollout(raw) ? raw : null;
}

const ADMITS: Readonly<Record<PatternAiRollout, ReadonlySet<PatternRolloutEntry>>> = {
  off: new Set<PatternRolloutEntry>(),
  internal: new Set<PatternRolloutEntry>(["internal", "chart_correction"]),
  first_open: new Set<PatternRolloutEntry>(["internal", "first_open", "chart_correction"]),
  enabled: new Set<PatternRolloutEntry>(["internal", "first_open", "chart_correction"]),
};

export function patternRolloutAllows(mode: PatternAiRollout, entry: PatternRolloutEntry): boolean {
  return ADMITS[mode].has(entry);
}

/**
 * Fail-closed staff allowlist. Malformed JSON is not "everyone"; it is nobody.
 */
export function readInternalAccountIds(
  env: Partial<Pick<Env, "PATTERN_INTERNAL_ACCOUNT_IDS">>,
): Set<string> {
  const raw = env.PATTERN_INTERNAL_ACCOUNT_IDS?.trim();
  if (!raw) return new Set();
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
        return new Set();
      }
      return new Set(parsed.map((item) => item.trim()).filter(Boolean));
    } catch {
      return new Set();
    }
  }
  return new Set(raw.split(",").map((item) => item.trim()).filter(Boolean));
}

export function isInternalPatternAccount(
  env: Partial<Pick<Env, "PATTERN_INTERNAL_ACCOUNT_IDS">>,
  userId: string,
): boolean {
  return readInternalAccountIds(env).has(userId);
}

/** Consumer grant/reserve maps to `internal` only for allowlisted accounts. */
export function consumerAdmissionEntry(
  env: Partial<Pick<Env, "PATTERN_INTERNAL_ACCOUNT_IDS">>,
  userId: string,
  reason: "chart_correction" | string,
): PatternRolloutEntry {
  if (reason === "chart_correction") return "chart_correction";
  if (isInternalPatternAccount(env, userId)) return "internal";
  return "first_open";
}
