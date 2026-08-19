/**
 * The deterministic stand-in for semantic verification.
 *
 * Extracted from `pattern-execute.ts` so a publisher factory can wrap it. Two
 * things forced the extraction rather than a direct import: `pattern-execute.ts`
 * already imports `pattern-publisher.js`, so importing the evaluator back would
 * be a genuine circular import; and `PatternPublisher.verify` carries no `Env`,
 * so a function taking the whole environment could not be wrapped as-is.
 *
 * It therefore takes the one flag it actually needs. The escape keeps its
 * `AUTH_STUB=1` condition — only where that condition is read has moved.
 *
 * This is a stand-in, not a verifier. It checks that the writer produced
 * chapters at all. The real check is a separate model pass; until that is wired,
 * a `pass` from here means only "not empty".
 */

import type { PatternSemanticVerdict, PatternWriterOutput } from "@patternlike/shared";

export function evaluateSemanticVerdict(
  writer: PatternWriterOutput,
  opts: { forceReject: boolean },
): PatternSemanticVerdict {
  const empty = writer.chapters.length === 0;
  if (!opts.forceReject && !empty) {
    return { schema_version: "0.7.0", verdict: "pass", findings: [] };
  }
  return {
    schema_version: "0.7.0",
    verdict: "reject",
    findings: [
      {
        code: "semantic_verification_failed",
        severity: "error",
        target_key: null,
        feature_aliases: [],
        ontology_rule_ids: [],
        rationale: opts.forceReject ? "Forced semantic rejection" : "Writer produced no chapters",
      },
    ],
  };
}

/**
 * The forced-rejection escape, resolved from the environment in one place.
 *
 * Both conditions are required, and `AUTH_STUB=1` is itself refused outside
 * development by `checkSecureConfig`, so this can only ever be true in a
 * development-shaped deployment.
 */
export function resolveSemanticForceReject(
  env: Partial<{ AUTH_STUB: string; PATTERN_SEMANTIC_FORCE_REJECT: string }>,
): boolean {
  return env.AUTH_STUB === "1" && env.PATTERN_SEMANTIC_FORCE_REJECT === "1";
}
