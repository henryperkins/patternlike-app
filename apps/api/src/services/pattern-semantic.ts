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
import { isPatternFindingCode } from "./pattern-prompt.js";

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

// ---------------------------------------------------------------------------
// Verdict validation
//
// Needed only since Task 6. Before it, the verdict came from the deterministic
// stand-in above and was well-formed by construction; now it is a model
// document, and `verdict.verdict !== "pass"` on its own would honour an
// incoherent `pass` and would misreport a malformed body as a semantic
// rejection -- the one failure class that tells an operator the verifier was
// the reason.
// ---------------------------------------------------------------------------

/** Why a verdict document cannot be honoured. Closed, and never a value. */
export type SemanticVerdictProblem =
  | "verdict_shape_invalid"
  | "verdict_finding_code_unknown"
  | "verdict_incoherent";

const VERDICT_SEVERITIES: ReadonlySet<string> = new Set(["error", "warning"]);
const FINDING_RATIONALE_MAX = 600;
const FINDING_CODE_MAX = 64;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * The three things the design says invalidate a verdict, beyond the adapter tier.
 *
 * `code` is a free-form bounded string in `contracts/m7`, so the closed
 * vocabulary is enforced here against `PATTERN_FINDING_CODES` rather than by the
 * schema: a finding citing a code outside that list is one the writer correction
 * path cannot act on. And a `pass` carrying an `error` finding is incoherent
 * rather than a pass -- honouring it would publish prose the verifier itself
 * said was wrong.
 */
export function findSemanticVerdictProblem(value: unknown): SemanticVerdictProblem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "verdict_shape_invalid";
  const document = value as Record<string, unknown>;
  if (document.schema_version !== "0.7.0") return "verdict_shape_invalid";
  if (document.verdict !== "pass" && document.verdict !== "reject") return "verdict_shape_invalid";
  if (!Array.isArray(document.findings)) return "verdict_shape_invalid";

  let anyError = false;
  for (const raw of document.findings) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "verdict_shape_invalid";
    const finding = raw as Record<string, unknown>;
    if (typeof finding.code !== "string") return "verdict_shape_invalid";
    if (finding.code.length < 1 || finding.code.length > FINDING_CODE_MAX) {
      return "verdict_shape_invalid";
    }
    if (typeof finding.severity !== "string" || !VERDICT_SEVERITIES.has(finding.severity)) {
      return "verdict_shape_invalid";
    }
    if (finding.target_key !== null && typeof finding.target_key !== "string") {
      return "verdict_shape_invalid";
    }
    if (!isStringArray(finding.feature_aliases)) return "verdict_shape_invalid";
    if (!isStringArray(finding.ontology_rule_ids)) return "verdict_shape_invalid";
    if (typeof finding.rationale !== "string" || finding.rationale.length > FINDING_RATIONALE_MAX) {
      return "verdict_shape_invalid";
    }
    if (!isPatternFindingCode(finding.code)) return "verdict_finding_code_unknown";
    if (finding.severity === "error") anyError = true;
  }

  if (document.verdict === "pass" && anyError) return "verdict_incoherent";
  return null;
}
