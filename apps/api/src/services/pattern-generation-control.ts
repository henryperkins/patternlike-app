import type { Env } from "../env.js";

type PatternGenerationControlEnv = Pick<Env, "PATTERN_GENERATION_ENABLED">;

/** Missing preserves deployments predating this switch; configured typos fail closed. */
export function resolvePatternGenerationControl(env: PatternGenerationControlEnv):
  | { ok: true; enabled: boolean }
  | { ok: false; code: "pattern_generation_control_invalid"; message: string } {
  const value = env.PATTERN_GENERATION_ENABLED;
  if (value === undefined) return { ok: true, enabled: true };
  const raw = typeof value === "string" ? value.trim() : null;
  if (raw === "1") return { ok: true, enabled: true };
  if (raw === "0") return { ok: true, enabled: false };
  return {
    ok: false,
    code: "pattern_generation_control_invalid",
    message: "PATTERN_GENERATION_ENABLED must be 0 or 1",
  };
}

export function patternGenerationIsEnabled(env: PatternGenerationControlEnv): boolean {
  const control = resolvePatternGenerationControl(env);
  return control.ok && control.enabled;
}
