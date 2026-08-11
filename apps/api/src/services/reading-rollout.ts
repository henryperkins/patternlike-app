/**
 * The staged rollout switch for constrained-model reading generation.
 *
 * One closed value governs three separate entry points, and each mode admits a
 * prefix of them. That shape is deliberate: it makes "enable first open" unable
 * to also enable the scheduler, and it makes `off` a real kill switch rather
 * than a flag that several call sites interpret for themselves.
 *
 * `off` also pauses work that is ALREADY queued. `queue.ts` joins the opaque
 * message ids to `daily_readings.assembly_mode` before the claim and durably
 * defers a constrained-model job in D1, so flipping the switch does not spend
 * the platform's retry budget or reach a provider.
 */

import type { Env } from "../env.js";

export const READING_V5_ROLLOUT_MODES = [
  "off",
  "internal",
  "first_open",
  "hybrid",
] as const;

export type ReadingV5Rollout = (typeof READING_V5_ROLLOUT_MODES)[number];

/** Which surface is asking to reserve a V2 command. */
export type RolloutEntry = "internal" | "first_open" | "scheduled";

const MODES: ReadonlySet<string> = new Set(READING_V5_ROLLOUT_MODES);

export function isReadingV5Rollout(value: string): value is ReadingV5Rollout {
  return MODES.has(value);
}

/**
 * The configured mode, or `null` when the value is present and unrecognised.
 *
 * Absent is `off`. Every wrangler block declares the var explicitly, for the
 * same reason `AUTH_STUB = "0"` is written out rather than omitted, so absence
 * means a hand-built environment — and refusing every request over a var whose
 * absence means "feature disabled" would be a worse outage than the feature
 * staying off. A value that IS present and unrecognised is a different thing:
 * "of" is one keystroke from "off" and must never resolve to anything.
 */
export function readReadingV5Rollout(
  env: Partial<Pick<Env, "READING_V5_ROLLOUT">>,
): ReadingV5Rollout | null {
  const raw = env.READING_V5_ROLLOUT?.trim();
  if (!raw) return "off";
  return isReadingV5Rollout(raw) ? raw : null;
}

const ADMITS: Readonly<Record<ReadingV5Rollout, ReadonlySet<RolloutEntry>>> = {
  off: new Set<RolloutEntry>(),
  internal: new Set<RolloutEntry>(["internal"]),
  first_open: new Set<RolloutEntry>(["internal", "first_open"]),
  hybrid: new Set<RolloutEntry>(["internal", "first_open", "scheduled"]),
};

export function rolloutAllows(mode: ReadingV5Rollout, entry: RolloutEntry): boolean {
  return ADMITS[mode].has(entry);
}
