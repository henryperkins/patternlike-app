/**
 * The single TypeScript owner of the M7 Pattern wire types.
 *
 * `apps/api`, `packages/pattern-engine`, and `apps/web` import these shapes.
 * They do not redeclare local lookalikes. Encrypted command and storage types
 * stay in the API: those never cross a package boundary, and putting them here
 * would put a decrypted command inside the package the AGPL calculation service
 * imports.
 *
 * Normative definitions are `contracts/m7/*.schema.json`. Wire format is
 * snake_case throughout.
 */

import type { BirthTimeAccuracy } from "./types.js";
import type { NatalFeatureClass } from "./m4-types.js";

export const M7_SCHEMA_VERSION = "0.7.0" as const;
export type M7SchemaVersion = typeof M7_SCHEMA_VERSION;

export const PATTERN_GENERATION_CONSENT_POLICY_VERSION = "1.0.0" as const;

export const PATTERN_CONSENT_CATEGORIES = [
  "calculated_natal_features",
  "accuracy_and_suppression",
  "confirmed_content_locale",
  "activated_interpretation_ontology",
  "generated_pattern_plan_and_draft_for_validation",
] as const;

export type PatternConsentCategory = (typeof PATTERN_CONSENT_CATEGORIES)[number];

export const PATTERN_STATES = [
  "chart_required",
  "locale_confirmation_required",
  "consent_required",
  "ontology_unavailable",
  "available",
  "organizing_evidence",
  "writing",
  "checking_claims",
  "ready",
  "failed",
  "deleted",
  "withdrawn",
  "editorial_catalog",
] as const;

export type PatternState = (typeof PATTERN_STATES)[number];

export const PATTERN_PUBLIC_STAGES = [
  "organizing_evidence",
  "writing",
  "checking_claims",
] as const;

export type PatternPublicStage = (typeof PATTERN_PUBLIC_STAGES)[number];

export const PATTERN_GENERATION_REASONS = [
  "first_open",
  "first_open_retry",
  "failed_attempt_retry",
] as const;

export type PatternGenerationReason = (typeof PATTERN_GENERATION_REASONS)[number];

export type PatternCoverageClass =
  | "mandatory_core"
  | "mandatory_any"
  | "eligible"
  | "redundant"
  | "suppressed"
  | "ontology_unsupported"
  | "capacity_omitted";

export type PatternPacketCoverage = "mandatory_core" | "mandatory_any" | "eligible";

export type PatternOmissionReason =
  | "redundant_with_chapter"
  | "capacity_omitted"
  | "cluster_incompatible"
  | "sparse_document";

export type PatternClaimClass =
  | "reflective_interpretation"
  | "structural_description"
  | "tension"
  | "resource"
  | "counter_expression"
  | "uncertainty";

export type PatternMeaningClass =
  | "source_supported"
  | "derived_synthesis"
  | "expression_guidance";

export type PatternTransformationClass =
  | "intersection"
  | "contrast"
  | "tension"
  | "counterbalance"
  | "developmental_arc"
  | "expression_range"
  | "shared_motif";

export type PatternSalienceBand = "low" | "medium" | "high";

export interface PatternConsent {
  schema_version: typeof M7_SCHEMA_VERSION;
  kind: "pattern_generation";
  status: "granted" | "not_granted";
  provider: "OpenAI";
  purpose: "one_pattern_per_chart";
  policy_version: string;
  enabled_categories: PatternConsentCategory[];
  granted_at: string | null;
  revoked_at?: string | null;
  existing_pattern_retained?: boolean;
}

export interface PatternStateChart {
  chart_id: string;
  effective_accuracy: BirthTimeAccuracy;
  feature_policy_version: string;
}

export interface PatternStateGeneration {
  generation_id: string;
  stage: PatternPublicStage;
  status_updated_at: string;
  started_at: string;
  retryable: boolean;
  request_id: string | null;
}

export interface PatternStatePattern {
  pattern_id: string;
  generated_at: string;
  locale: string;
  effective_accuracy: BirthTimeAccuracy;
}

export interface PatternStateDocument {
  schema_version: typeof M7_SCHEMA_VERSION;
  state: PatternState;
  chart: PatternStateChart | null;
  consent: PatternConsent | null;
  generation: PatternStateGeneration | null;
  pattern: PatternStatePattern | null;
}

export interface PatternGenerationRequest {
  schema_version: typeof M7_SCHEMA_VERSION;
  consent_policy_version: string;
  confirm: "GENERATE MY PATTERN";
  reason: PatternGenerationReason;
}

export interface PatternGenerationAccepted {
  schema_version: typeof M7_SCHEMA_VERSION;
  consent: PatternConsent;
  generation: {
    generation_id: string;
    stage: PatternPublicStage | "ready";
  };
}

export interface PatternGenerationStatus {
  schema_version: typeof M7_SCHEMA_VERSION;
  generation_id: string;
  stage: PatternPublicStage;
  status_updated_at: string;
  started_at: string;
  retryable: boolean;
  finished_at?: string | null;
}

export interface PatternDeleteRequest {
  confirm: "DELETE PATTERN";
}

export interface PatternFeaturePredicate {
  type: NatalFeatureClass;
  body?: string;
  body_a?: string;
  body_b?: string;
  aspect?: string;
  pattern?: string;
  angle?: string;
  house?: number;
  accuracy?: string;
}

export interface PatternOntologyRecord {
  id: string;
  meaning_class: PatternMeaningClass;
  locale: string;
  feature_predicate: PatternFeaturePredicate;
  normalized_proposition: string;
  source_fragment_ids: string[];
  input_meaning_ids: string[];
  transformation_class: PatternTransformationClass | null;
  tensions: string[];
  counter_expressions: string[];
  prohibited_claims: string[];
  salience_band: PatternSalienceBand;
  presentation_priority: number;
  cluster_tags: string[];
}

export interface PatternOntologyEvaluation {
  schema_version: typeof M7_SCHEMA_VERSION;
  ontology_version: string;
  verdict: "pass" | "reject";
  compiler_passed: boolean;
  evaluator_passed: boolean;
  regression_passed: boolean;
  unevaluated_fixture_count: number;
}

export interface PatternOntologyRelease {
  schema_version: typeof M7_SCHEMA_VERSION;
  ontology_version: string;
  bundle_hash: string;
  corpus_release_hash: string;
  locale: string;
  status: "candidate" | "active" | "superseded" | "recalled";
  records: PatternOntologyRecord[];
  evaluation: PatternOntologyEvaluation;
}

export interface PatternFactPacketFeature {
  alias: string;
  feature_class: NatalFeatureClass;
  fact: Record<string, unknown>;
  coverage: PatternPacketCoverage;
  ontology_rule_ids: string[];
  cluster_ids: string[];
}

export interface PatternFactPacketCluster {
  cluster_id: string;
  feature_aliases: string[];
  compatible_with: string[];
}

export interface PatternFactPacket {
  schema_version: typeof M7_SCHEMA_VERSION;
  locale: string;
  effective_accuracy: BirthTimeAccuracy;
  uncertainty: {
    suppressed_classes: string[];
    required_language_rule_ids: string[];
  };
  features: PatternFactPacketFeature[];
  clusters?: PatternFactPacketCluster[];
  selection_constraints: {
    core_chapters_min: number;
    core_chapters_max: number;
    additional_signatures_max: number;
    sparse_pattern: boolean;
  };
}

export interface PatternFeatureAccounting {
  feature_id: string;
  alias: string | null;
  coverage: PatternCoverageClass;
  reason: string | null;
}

export interface PatternSelectionManifest {
  schema_version: typeof M7_SCHEMA_VERSION;
  policy_id: "pattern-selection-policy";
  policy_version: "1.0.0";
  feature_set_hash: string;
  sparse_pattern: boolean;
  accounting: PatternFeatureAccounting[];
}

export interface PatternPlannerChapter {
  chapter_key: string;
  working_title: string;
  purpose: string;
  feature_aliases: string[];
  ontology_rule_ids: string[];
  derived_synthesis_ids: string[];
  required_tension_ids: string[];
  required_resource_ids: string[];
  required_counter_expression_ids: string[];
}

export interface PatternPlannerSignature {
  signature_key: string;
  working_title: string;
  feature_aliases: string[];
  ontology_rule_ids: string[];
}

export interface PatternPlannerOmission {
  feature_alias: string;
  reason: PatternOmissionReason;
  covered_by: string | null;
}

export interface PatternPlannerOutput {
  schema_version: typeof M7_SCHEMA_VERSION;
  chapters: PatternPlannerChapter[];
  additional_signatures: PatternPlannerSignature[];
  omissions: PatternPlannerOmission[];
}

export interface PatternPlan extends PatternPlannerOutput {
  plan_hash: string;
  sparse_pattern: boolean;
}

export interface PatternWriterProseUnit {
  text: string;
  claim_class: PatternClaimClass;
  feature_aliases: string[];
  ontology_rule_ids: string[];
  derived_synthesis_ids: string[];
}

export interface PatternWriterSection {
  section_key: string;
  text: string;
  claim_class: "reflective_interpretation" | "structural_description";
  feature_aliases: string[];
  ontology_rule_ids: string[];
  derived_synthesis_ids: string[];
}

export interface PatternWriterChapter {
  chapter_key: string;
  title: string;
  summary: string;
  sections: PatternWriterSection[];
  tensions: PatternWriterProseUnit[];
  resources: PatternWriterProseUnit[];
  counter_expression: PatternWriterProseUnit;
}

export interface PatternWriterSignature {
  signature_key: string;
  title: string;
  text: string;
  feature_aliases: string[];
  ontology_rule_ids: string[];
}

export interface PatternWriterOutput {
  schema_version: typeof M7_SCHEMA_VERSION;
  title: string;
  chapters: PatternWriterChapter[];
  additional_signatures: PatternWriterSignature[];
  uncertainty_note: PatternWriterProseUnit | null;
}

export interface PatternSemanticFinding {
  code: string;
  severity: "error" | "warning";
  target_key: string | null;
  feature_aliases: string[];
  ontology_rule_ids: string[];
  rationale: string;
}

export interface PatternSemanticVerdict {
  schema_version: typeof M7_SCHEMA_VERSION;
  verdict: "pass" | "reject";
  findings: PatternSemanticFinding[];
}

export interface PatternPublicProseUnit {
  text: string;
}

export interface PatternPublicChapter {
  title: string;
  summary: string;
  sections: Array<{ text: string }>;
  tensions: PatternPublicProseUnit[];
  resources: PatternPublicProseUnit[];
  counter_expression: PatternPublicProseUnit;
}

export interface PatternPublicSignature {
  title: string;
  text: string;
}

export interface PatternResponseV7 {
  schema_version: typeof M7_SCHEMA_VERSION;
  pattern_id: string;
  generated_at: string;
  locale: string;
  effective_accuracy: BirthTimeAccuracy;
  provenance: {
    assembly_mode: "constrained_model";
    provider: string;
    model_family: string;
    raw_birth_details_sent: false;
  };
  core_chapters: PatternPublicChapter[];
  additional_signatures: PatternPublicSignature[];
  uncertainty: PatternPublicProseUnit | null;
}

export interface PatternCompactProvenance {
  assembly_mode: "constrained_model";
  provider: string;
  model_family: string;
  raw_birth_details_sent: false;
  ontology_version: string;
  selection_policy_version: string;
}

export interface PatternDocumentInternal {
  schema_version: typeof M7_SCHEMA_VERSION;
  pattern_id: string;
  generation_id: string;
  locale: string;
  effective_accuracy: BirthTimeAccuracy;
  plan_hash: string;
  candidate_hash: string;
  semantic_verdict_hash: string;
  artifact: PatternWriterOutput;
  compact_provenance: PatternCompactProvenance;
}
