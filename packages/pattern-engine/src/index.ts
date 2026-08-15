/**
 * @patternlike/pattern-engine — deterministic Pattern selection and validation.
 *
 * Deliberately NOT part of @patternlike/shared. apps/calc-stub is
 * AGPL-3.0-or-later and imports shared. Ranking weights, eligibility, plan
 * validation, and candidate policy are the product and must not land inside a
 * package the AGPL service pulls in.
 *
 * Purity contract: no fetch, no D1, no Date.now(), no crypto. tsconfig omits
 * the DOM lib so `crypto` and `fetch` are not even in scope. Plan and candidate
 * hashes are computed by the Worker after this package returns canonical JSON.
 */

export {
  PATTERN_SELECTION_POLICY_ID,
  PATTERN_SELECTION_POLICY_VERSION,
  PATTERN_VALIDATION_POLICY_ID,
  PATTERN_VALIDATION_POLICY_VERSION,
  MAX_ELIGIBLE_ALIASES,
  MAX_MANDATORY_ALIASES,
  MAX_CLUSTER_SIZE,
} from "./policy.js";
export { compileOntologyRelease, ontologyRecordMatchesFeature } from "./ontology.js";
export { selectPatternEvidence, SelectionCapacityError } from "./selection.js";
export { validatePatternPlan } from "./plan-validate.js";
export { validatePatternCandidate } from "./candidate-validate.js";
export { projectPublicPattern, stripPrivateEvidence } from "./projection.js";
export { buildDeterministicPlan, buildDeterministicWriterOutput } from "./synthetic.js";
export { wordCount } from "./words.js";
export { syntheticOntologyRecords, syntheticOntologyRelease } from "./fixtures.js";
export type {
  OntologyCompileResult,
  PatternSelectionResult,
  PlanValidationResult,
  CandidateValidationResult,
  ValidationFailure,
} from "./types.js";
