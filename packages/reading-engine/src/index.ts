/**
 * @patternlike/reading-engine — deterministic daily reading assembly.
 *
 * Deliberately NOT part of @patternlike/shared. apps/calc-stub is
 * AGPL-3.0-or-later and imports shared, and LICENSING.md records that boundary
 * as the open legal question: Corresponding Source for the AGPL service reaches
 * into whatever it imports. Ranking weights, eligibility rules, and editorial
 * assembly are the product, so they must not land inside a package the AGPL
 * service pulls in. Only the cycle request/response WIRE TYPES go in shared,
 * because calc-stub has to deserialize them, and that widening is unavoidable
 * and minimal.
 *
 * Purity contract: no fetch, no D1, no Date.now(), no crypto. tsconfig omits the
 * DOM lib so `crypto` and `fetch` are not even in scope.
 */

export { assembleReading, finalizeReading, resolveLocale, renderTimingTemplate, AssemblyError, ASSEMBLY_POLICY_ID } from "./assemble.js";
export {
  buildAssemblyIdentity,
  canonicalizeIdentity,
  localDayMidpoint,
  projectContext,
  projectCycle,
  projectUncertainty,
  renderAssemblyId,
  IdentityConsistencyError,
} from "./identity.js";
export { jcsCanonicalize, CanonicalizationError } from "./jcs.js";
export { computePhase, isActiveAt, phaseWeight, PHASE_POLICY_VERSION, PHASE_THRESHOLDS } from "./phase.js";
export {
  compareScored,
  isDistinctSupporting,
  scoreFact,
  RANKING_POLICY_VERSION,
  type ScoredFact,
} from "./ranking.js";
export {
  contextRejection,
  eligibilityRejection,
  factSuppressionReason,
  partitionContext,
  type EligibilityContext,
} from "./eligibility.js";
export {
  ConstrainedInputError,
  normalizeExcerpt,
  prepareConstrainedReadingInput,
  utf8ByteLength,
} from "./constrained-input.js";
export { validateReadingCandidate } from "./candidate-validation.js";
export {
  CANDIDATE_CHECKS,
  GENERATION_INPUT_IDENTITY_PROFILE,
  GENERATION_INPUT_MANIFEST_PROFILE,
  HEADLINE_MAX_CHARS,
  LEAD_MAX_CHARS,
  MAX_CONTEXT_ITEMS,
  MAX_CONTEXT_TEXT_BYTES,
  MAX_FEEDBACK_RECORDS,
  MAX_PRIOR_READINGS,
  PARAGRAPH_MAX_CHARS,
  REFLECTION_MAX_CHARS,
  SELECTION_POLICY_ID,
  SELECTION_POLICY_VERSION,
  VALIDATION_POLICY_ID,
  VALIDATION_POLICY_VERSION,
} from "./constrained-types.js";
export type * from "./constrained-types.js";
export {
  evaluateDeclaredFixtures,
  evaluateFixture,
  UnknownFixtureError,
  type AssemblyFixture,
  type FixtureEvaluation,
  type FixtureOutcome,
} from "./fixtures.js";
export {
  EXCLUDED_BUT_NOT_NO_PREFIXED,
  INGESTIBLE_SOURCES,
  INGESTIBLE_SOURCE_COUNT,
  REGISTRY_ALLOWED_USE_VOCABULARY,
  REGISTRY_SOURCE_COUNT,
} from "./source-allowlist.generated.js";

export type * from "./types.js";

/** The M3 contract package this engine implements. */
export const SCHEMA_VERSION = "0.3.0" as const;

/**
 * Bump for ANY ranking, selection, rendering, fallback, or validation change
 * that can alter output for otherwise identical inputs. This value enters the
 * assembly identity preimage: two builds that would produce different prose
 * must not be able to produce the same assembly_id.
 */
export const ASSEMBLY_POLICY_VERSION = "1.0.0" as const;
