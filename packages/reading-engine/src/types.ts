/**
 * Wire and engine types for M3 deterministic reading assembly.
 *
 * These mirror contracts/m3/*.schema.json. Wire format is snake_case even
 * though the rest of the TypeScript is camelCase, so an object here can be
 * serialized and validated without a translation layer in between.
 */

export type BirthTimeAccuracy = "exact" | "approximate" | "unknown";
export type AspectType =
  | "conjunction"
  | "sextile"
  | "square"
  | "trine"
  | "opposition";
export type CyclePhase =
  | "emerging"
  | "building"
  | "peak"
  | "reconsidering"
  | "integrating";
export type EvidenceLane = "celestial_facts" | "user_and_context" | "operational";
export type PassDirection = "direct" | "retrograde";
export type LifeDomain =
  | "self"
  | "relationships"
  | "work"
  | "creativity"
  | "home"
  | "body_energy"
  | "money_resources"
  | "learning"
  | "community"
  | "caregiving"
  | "spirituality_meaning"
  | "unspecified";

export type SuppressedFeatureClass =
  | "houses"
  | "angles"
  | "angle_transits"
  | "moon_time_sensitive";

export type ParagraphRole =
  | "primary_theme"
  | "supporting_theme"
  | "phase_context"
  | "timing"
  | "reflection"
  | "uncertainty_notice"
  | "context_label"
  | "safety_fallback";

export type RankingFactorName =
  | "exactness"
  | "body_importance"
  | "target_importance"
  | "rarity"
  | "angularity"
  | "phase"
  | "technique_weight"
  | "domain_match"
  | "continuity"
  | "repetition_penalty"
  | "uncertainty_filter"
  | "safety_filter"
  | "other";

export type FactClass =
  | "natal_position"
  | "natal_aspect"
  | "natal_pattern"
  | "cycle_instance"
  | "exact_pass"
  | "lunation"
  | "station_ingress"
  | "houses_angles"
  | "uncertainty_feature";

// ---------------------------------------------------------------------------
// Uncertainty
// ---------------------------------------------------------------------------

export interface AssemblyUncertaintyInput {
  accuracy: BirthTimeAccuracy;
  window_plus_minus_minutes: number | null;
  suppressed_features: Array<{
    feature_class: SuppressedFeatureClass;
    feature_id: string | null;
    reason: "unknown_birth_time" | "birthplace_unavailable";
  }>;
  qualified_features: Array<{
    feature_id: "moon" | "houses";
    qualification: "low_confidence_moon" | "approximate_only";
  }>;
}

// ---------------------------------------------------------------------------
// Calculated input
// ---------------------------------------------------------------------------

export interface CyclePass {
  pass_index: number;
  direction: PassDirection;
  exact_at: string;
  speed_deg_per_day: number;
}

export interface NormalizedCycle {
  id: string;
  technique: "transit";
  body: string;
  target: string;
  aspect: AspectType;
  start_at: string;
  exact_at: string;
  end_at: string;
  pass_count: number;
  passes: CyclePass[];
  orb_deg: number;
  importance_score?: number | null;
}

export interface NormalizedContextSignal {
  signal_id: string;
  source_id: string;
  allowed_use: string;
  evidence_lane: EvidenceLane;
  normalized_hash?: string;
  permission_state: "active" | "paused" | "revoked" | "expired" | "never_granted";
  freshness_status: "fresh" | "stale" | "expired" | "unknown";
  label?: string;
}

// ---------------------------------------------------------------------------
// Editorial release (the subset assembly reads)
// ---------------------------------------------------------------------------

export interface Eligibility {
  required_fact_classes?: FactClass[];
  required_bodies?: string[];
  required_aspects?: AspectType[];
  min_birth_time_accuracy?: BirthTimeAccuracy;
  requires_houses?: boolean;
  techniques?: string[];
}

export interface PhaseObject {
  id: string;
  content_type: "astrology_phase";
  content_version: string;
  locale: string;
  parent_cycle_id: string;
  phase: CyclePhase;
  summary: string;
  constructive_expression: string;
  shadow_expression: string;
  eligibility?: Eligibility;
  status?: "approved" | "deprecated";
}

export interface CycleObject {
  id: string;
  content_type: "astrology_cycle";
  content_version: string;
  locale: string;
  technique: string;
  bodies: string[];
  targets: string[];
  aspect: AspectType | null;
  phase_ids: string[];
  eligibility?: Eligibility;
  status?: "approved" | "deprecated";
}

export interface PromptObject {
  id: string;
  content_type: "astrology_prompt";
  content_version: string;
  locale: string;
  prompt_text: string;
  life_domains: LifeDomain[];
  eligibility?: Eligibility;
  status?: "approved" | "deprecated";
}

export interface ModifierObject {
  id: string;
  content_type: "astrology_modifier";
  content_version: string;
  locale: string;
  modifier_kind: string;
  body: string;
  precedence: number;
  eligibility?: Eligibility;
  status?: "approved" | "deprecated";
}

export interface TimingTemplateObject {
  id: string;
  content_type: "timing_template";
  content_version: string;
  locale: string;
  template_text: string;
  placeholders: Array<"start_date" | "exact_date" | "end_date" | "orb" | "phase">;
  is_locale_default: boolean;
  status?: "approved" | "deprecated";
}

export interface FallbackCopyObject {
  id: string;
  content_type: "daily_fallback";
  content_version: string;
  locale: string;
  body: string;
  eligibility_mode: "universal";
  status?: "approved" | "deprecated";
}

export interface VerifiedBundle {
  release: {
    version: string;
    bundle_hash: string;
    supported_locales: string[];
    locale_default: string;
    language_fallbacks?: Record<string, string>;
  };
  objects: {
    cycles: CycleObject[];
    phases: PhaseObject[];
    prompts: PromptObject[];
    modifiers: ModifierObject[];
    timing_templates: TimingTemplateObject[];
    daily_fallbacks: FallbackCopyObject[];
  };
}

// ---------------------------------------------------------------------------
// Engine input and output
// ---------------------------------------------------------------------------

export interface AssemblyInput {
  identity_profile: "patternlike.assembly-id.v1";
  schema_version: "0.3.0";
  output_schema: "daily-reading-v3";
  assembly_policy_id: "daily-reading-deterministic";
  assembly_policy_version: string;
  reading_id: string;
  revision: number;
  local_date: string;
  target_timezone: string;
  /** Frozen at enqueue. Never a clock read — that is what makes a retry reproducible. */
  generation_anchor: string;
  /** Half-open UTC interval for the target local day, computed once at enqueue. */
  day_start_at: string;
  day_end_at: string;
  chart: {
    fingerprint: string;
    /** The recomputed effective accuracy, never the label the caller supplied. */
    effective_accuracy: BirthTimeAccuracy;
    uncertainty: AssemblyUncertaintyInput;
  };
  cycles: NormalizedCycle[];
  release: VerifiedBundle;
  context: NormalizedContextSignal[];
  locale: string;
  domain_preference: LifeDomain | null;
}

export interface AssemblyFactInput {
  id: string;
  fact_class: FactClass;
  technique: string | null;
  body: string | null;
  target: string | null;
  aspect: AspectType | null;
  phase: CyclePhase | null;
  orb_deg: number | null;
  first_exact_at: string | null;
  pass_count: number | null;
}

export interface AssemblyContextInput {
  signal_id: string;
  source_id: string;
  allowed_use: string;
  evidence_lane: EvidenceLane;
  normalized_hash?: string;
}

export interface AssemblyIdentityInputV1 {
  identity_profile: "patternlike.assembly-id.v1";
  schema_version: "0.3.0";
  assembly_policy_id: "daily-reading-deterministic";
  assembly_policy_version: string;
  output_schema: "daily-reading-v3";
  local_date: string;
  target_timezone: string;
  generation_anchor: string;
  chart_fingerprint: string;
  effective_accuracy: BirthTimeAccuracy;
  uncertainty: AssemblyUncertaintyInput;
  facts: AssemblyFactInput[];
  release_version: string;
  release_bundle_hash: string;
  context: AssemblyContextInput[];
  locale: string;
  domain_preference: LifeDomain | null;
  revision: number;
}

export interface ReadingParagraph {
  paragraph_id: string;
  role: ParagraphRole;
  order: number;
  text: string;
}

export interface DailyReading {
  schema_version: "0.3.0";
  output_schema: "daily-reading-v3";
  reading_id: string;
  local_date: string;
  generated_at: string;
  assembly_mode: "deterministic";
  revision: number;
  locale: string;
  domain_preference: LifeDomain | null;
  paragraphs: ReadingParagraph[];
  fallback_used: boolean;
}

export interface FactRef {
  id: string;
  fact_type: string;
  phase: CyclePhase | null;
  orb_deg: number | null;
  chart_fingerprint: string | null;
  technique: string | null;
  pass_index: number | null;
}

export interface ContentRef {
  fragment_id: string;
  content_version: string;
  release_version: string;
  content_type: string;
  bundle_hash: string | null;
}

export interface ContextRef {
  signal_id: string;
  source_id: string;
  allowed_use: string;
  evidence_lane: EvidenceLane;
  label?: string;
}

export interface RankingFactor {
  factor: RankingFactorName;
  weight: number | null;
  reason: string;
}

export interface ParagraphEvidence {
  paragraph_id: string;
  role: ParagraphRole;
  order: number;
  evidence_lane: EvidenceLane;
  text_hash: string | null;
  facts: FactRef[];
  content: ContentRef[];
  context_signals: ContextRef[];
  ranking_factors: RankingFactor[];
  model_output: null;
}

export type ValidationCheckName =
  | "schema"
  | "provenance"
  | "dates"
  | "unsupported_facts"
  | "fatalism"
  | "diagnosis"
  | "source_laundering"
  | "eligibility_allowlist"
  | "uncertainty_constraints"
  | "consent_freshness"
  | "repetition"
  | "other";

export interface ValidationCheck {
  check: ValidationCheckName;
  result: "pass" | "fail" | "skip";
  detail_code: string | null;
}

export interface ValidationResult {
  passed: boolean;
  fallback_used: boolean;
  checks: ValidationCheck[];
}

/** A candidate that did not make it, and why. The evidence drawer is the reason. */
export interface Rejection {
  subject_kind: "cycle" | "content" | "context";
  subject_id: string;
  reason_code: string;
  detail: string;
}

export interface AssemblyOutcome {
  identity: AssemblyIdentityInputV1;
  /** RFC 8785 canonical UTF-8 bytes of `identity`. The caller SHA-256s this. */
  identity_canonical: string;
  reading: DailyReading;
  /**
   * Evidence with `assembly_id` and every `text_hash` still unset. Hashing is
   * deliberately outside the engine: SHA-256 in Workers is async WebCrypto, and
   * making the core async to accommodate it would cost the property that matters
   * most — that the whole thing runs under node:test with no mocks and no
   * harness. Call finalizeReading() once the digests exist.
   */
  evidence: Omit<ReadingEvidenceDraft, "assembly_id">;
  rejections: Rejection[];
}

export interface ReadingEvidenceDraft {
  schema_version: "0.3.0";
  reading_id: string;
  local_date: string;
  release_version: string;
  chart_fingerprint: string;
  assembly_mode: "deterministic";
  assembly_id: string;
  assembly_policy_version: string;
  revision: number;
  primary_theme: { cycle_id: string; phase: CyclePhase; fragment_ids: string[] } | null;
  supporting_theme: {
    cycle_id: string;
    phase: CyclePhase;
    fragment_ids: string[];
  } | null;
  paragraphs: ParagraphEvidence[];
  validation: ValidationResult;
  created_at: string;
}

export interface AssemblyHashes {
  assembly_id: string;
  /** paragraph_id -> hash of that paragraph's published text. */
  paragraph_text_hashes: Record<string, string>;
}
