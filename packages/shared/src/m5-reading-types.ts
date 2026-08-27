/**
 * The single TypeScript owner of the M5 reading wire types.
 *
 * `apps/api`, `packages/reading-engine`, and `apps/web` all speak these shapes.
 * They import them; they do not redeclare local lookalikes. A structurally
 * identical duplicate is assignable, which is precisely why a drifted one is
 * invisible until a real reader gets a reading that does not match its evidence.
 *
 * API-internal encrypted command and storage types stay in their own API
 * modules: those never cross a package boundary, and putting them here would
 * put a decrypted command shape inside the package the AGPL calculation service
 * imports.
 *
 * Normative definitions are `contracts/m5/*.schema.json`. Wire format is
 * snake_case even though TypeScript is camelCase; these interfaces are the wire,
 * so they are snake_case throughout.
 */

import type {
  AspectType,
  BirthTimeAccuracy,
  CelestialBody,
  CyclePhase,
  LifeDomain,
} from "./types.js";
import type { SuppressedFeatureClass } from "./cycle-types.js";
// Daily-sky vocabulary the provider packet quotes back, not reading vocabulary
// in its own right — which is why it is named here rather than redefined.
import type { LunarPhaseName, ZodiacSignName } from "./daily-sky-types.js";

/** The M5 contract package version. M0 stays at 0.2.0 and M3 at 0.3.0, both frozen. */
export const M5_SCHEMA_VERSION = "0.5.0" as const;
export type M5SchemaVersion = typeof M5_SCHEMA_VERSION;

/** Pinned structured output schema for constrained-model publication. */
export const M5_OUTPUT_SCHEMA = "daily-reading-v5" as const;
export type M5OutputSchema = typeof M5_OUTPUT_SCHEMA;

export const M5_ASSEMBLY_MODE = "constrained_model" as const;

/**
 * The closed set of external publishers whose provenance M5 can describe.
 *
 * `openai` is the historical direct-API vintage and `codex` is the Codex CLI
 * runner that supersedes it. Both stay in the vocabulary because published
 * evidence is never rewritten: a reading generated in August must still name
 * the service that actually wrote it after the routing changed underneath.
 *
 * Widened from a `const` to an exact enum rather than to an open string. An
 * open string would let an unreviewed processor describe itself as the author
 * of a reader's prose, which is precisely the claim the evidence graph exists
 * to make checkable.
 *
 * `provider` here is the SERVICE that generated the prose. The consent surface
 * separately names OpenAI as the data processor, and that field is not this one.
 */
export const READING_PUBLISHER_PROVIDERS = ["openai", "codex"] as const;

export type ReadingPublisherProvider =
  (typeof READING_PUBLISHER_PROVIDERS)[number];

/**
 * The categories named on the AI-synthesis consent screen, in display order.
 *
 * Every personal section of a provider packet maps to exactly one of these, and
 * a section whose category is absent from the grant cannot be sent. Adding a
 * category needs a new consent policy version and a fresh grant: a user who
 * agreed to seven has not agreed to an eighth.
 *
 * Source-specific journal, check-in, and connector categories are deliberately
 * absent while M4 remains unimplemented. `enabled_personal_context` admits only
 * signals that already have an active source permission, so the list describes
 * what the product actually stores rather than what it plans to.
 */
export const AI_CONSENT_DATA_CATEGORIES = [
  "birth_accuracy_and_uncertainty",
  "calculated_natal_facts",
  "active_calculated_cycles",
  "calculated_daily_sky",
  "enabled_personal_context",
  "prior_reading_excerpts",
  "reading_feedback",
] as const;

export type AiConsentDataCategory = (typeof AI_CONSENT_DATA_CATEGORIES)[number];

/**
 * The frozen M0 `allowedUse` enum narrowed to the lanes M5 may act on.
 *
 * M5 adds no vocabulary. `ai_synthesis` is the outer account-level purpose
 * consent, not an allowed use, and it can never make an otherwise ineligible
 * signal eligible. Eligibility is the exact intersection of the signal's
 * allowed uses, the active source consent's allowed uses, and this set.
 */
export const M5_SUPPORTED_USES = [
  "annual_context",
  "environment_context",
  "life_domain_selection",
  "narrative_continuity",
  "optional_recommendations",
  "pattern_profile",
  "reflection_prompt",
  "relationship_interpretation",
  "repetition_control",
  "routine_context",
  "theme_eligibility",
  "theme_filtering",
  "theme_ranking",
  "tone",
  "travel_context",
  "user_memory",
  "workload_context",
] as const;

export type M5AllowedUse = (typeof M5_SUPPORTED_USES)[number];

const SUPPORTED_USE_SET: ReadonlySet<string> = new Set(M5_SUPPORTED_USES);

export function isM5SupportedUse(value: string): value is M5AllowedUse {
  return SUPPORTED_USE_SET.has(value);
}

/** Whether a fact involves the reader's own chart. */
export type FactScope = "personalized" | "collective";

/**
 * Deterministic reading priority.
 *
 * 1 active personalized cycles, 2 exact daily transit-to-natal contacts,
 * 3 collective daily-sky facts and events, 4 stable natal context. Personal
 * context may choose emphasis among eligible facts; it can never promote a
 * non-fact into an astrological claim.
 */
export type LaneRank = 1 | 2 | 3 | 4;

export type M5FactClass =
  | "cycle_instance"
  | "anchor_position"
  | "lunar_phase"
  | "transit_natal_contact"
  | "sign_ingress"
  | "collective_exact_aspect"
  | "house_placement"
  | "natal_position"
  | "natal_aspect";

// ---------------------------------------------------------------------------
// Provider request
// ---------------------------------------------------------------------------

/**
 * The COMPLETE astrology vocabulary one fact licenses.
 *
 * Candidate validation freezes its accepted vocabulary from the union of these
 * arrays across the selected facts, which is what turns "the model stated a
 * degree nobody calculated" into a mechanical check rather than an editorial
 * judgement.
 */
export interface FactAttributes {
  bodies: CelestialBody[];
  aspect?: AspectType | null;
  signs: ZodiacSignName[];
  houses: number[];
  phase?: CyclePhase | null;
  lunar_phase?: LunarPhaseName | null;
  degrees: number[];
  timestamps: string[];
  dates: string[];
}

export interface RequestFact {
  /** `dsf_`, `cyc_`, or `nat_`. Content-addressed; never a storage row id. */
  fact_id: string;
  fact_class: M5FactClass;
  scope: FactScope;
  lane_rank: LaneRank;
  label: string;
  attributes: FactAttributes;
}

export type RequestContextContent =
  | { kind: "untrusted_text"; text: string }
  | { kind: "structured"; value: Record<string, unknown> };

export interface RequestContext {
  /** Positional handle valid only inside one packet. */
  context_ref: string;
  category: AiConsentDataCategory;
  allowed_use: M5AllowedUse;
  /**
   * A calendar date, not an instant: the exact minute a journal entry was
   * written is more identifying than it is useful for a reading.
   */
  observed_on: string;
  content: RequestContextContent;
}

export interface PriorReadingExcerpt {
  /** Relative offset rather than a date, so repetition control gets recency without another calendar the model could restate as fact. */
  days_ago: number;
  headline: string;
  lead: string;
  reflection_prompt: string;
}

export interface ReadingComposition {
  allowed_paragraph_roles: GeneratedParagraphRole[];
  min_paragraphs: number;
  max_paragraphs: number;
  headline_max_chars: number;
  lead_max_chars: number;
  paragraph_max_chars: number;
  reflection_max_chars: number;
  /** True when a surviving qualified feature or a suppressed class must be named. */
  uncertainty_note_required: boolean;
}

/**
 * The closed projection of a frozen V2 command that crosses the provider
 * boundary.
 *
 * Carries no reading key, user id, chart fingerprint, storage key, queue id,
 * consent record id, birth instant, coordinate, or timezone name. The accuracy
 * LABEL and its consequences cross; the birth data never does.
 */
export interface ReadingGenerationRequest {
  schema_version: M5SchemaVersion;
  prompt_version: string;
  selection_policy_version: string;
  output_schema: M5OutputSchema;
  local_date: string;
  locale: string;
  birth_time_accuracy: BirthTimeAccuracy;
  suppressed_features: SuppressedFeatureClass[];
  domain_preference?: LifeDomain | null;
  /** Ordered by (lane_rank, fact_id). Never empty: the daily-sky layer guarantees an anchor and a phase. */
  facts: RequestFact[];
  context: RequestContext[];
  prior_readings: PriorReadingExcerpt[];
  composition: ReadingComposition;
}

// ---------------------------------------------------------------------------
// Provider output
// ---------------------------------------------------------------------------

/** The declaration order is the frozen paragraph order. */
export const GENERATED_PARAGRAPH_ROLES = [
  "supporting_theme",
  "phase_context",
  "timing",
  "collective_context",
] as const;

export type GeneratedParagraphRole = (typeof GENERATED_PARAGRAPH_ROLES)[number];

/**
 * One prose unit and the exact evidence behind it.
 *
 * Both arrays are always present. An ungrounded unit sends empty arrays and is
 * rejected by validation rather than by omission, because a missing key and an
 * empty list are the same claim and only one of them is checkable.
 */
export interface GroundedUnit {
  text: string;
  fact_ids: string[];
  context_refs: string[];
}

export interface GeneratedParagraph extends GroundedUnit {
  role: GeneratedParagraphRole;
}

export interface ReadingGenerationOutput {
  schema_version: M5SchemaVersion;
  output_schema: M5OutputSchema;
  local_date: string;
  locale: string;
  headline: string;
  lead: GroundedUnit;
  paragraphs: GeneratedParagraph[];
  reflection_prompt: GroundedUnit;
  uncertainty_note: GroundedUnit | null;
}

// ---------------------------------------------------------------------------
// Published artifact
// ---------------------------------------------------------------------------

/**
 * Fixed order, always opening with `primary_theme`.
 *
 * `safety_fallback` is absent by design: v5 has no reviewed copy to fall back
 * to, and an unavailable reading says so honestly instead.
 */
export const PARAGRAPH_ROLES_V5 = [
  "primary_theme",
  "supporting_theme",
  "phase_context",
  "timing",
  "collective_context",
  "reflection",
  "uncertainty_notice",
] as const;

export type ParagraphRoleV5 = (typeof PARAGRAPH_ROLES_V5)[number];

export interface ReadingParagraphV5 {
  paragraph_id: string;
  role: ParagraphRoleV5;
  /** 1-based, contiguous, strictly increasing. */
  order: number;
  text: string;
}

export interface DailyReadingV5 {
  schema_version: M5SchemaVersion;
  output_schema: M5OutputSchema;
  reading_id: string;
  local_date: string;
  /**
   * The command's frozen `generation_anchor`, not the attempt time. A
   * pre-generated edition therefore reports the instant it was frozen, which is
   * before its own local day starts.
   */
  generated_at: string;
  assembly_mode: typeof M5_ASSEMBLY_MODE;
  revision: number;
  locale: string;
  domain_preference?: LifeDomain | null;
  /** Rendered as the quiet primary-theme kicker so the lead stays the focal point. */
  headline: string;
  /** Required, not optional: a reader cannot consent to something the product then declines to mention. */
  disclosure: string;
  paragraphs: ReadingParagraphV5[];
}

export interface DailyReadingResponseV5 {
  schema_version: M5SchemaVersion;
  reading: DailyReadingV5;
  evidence_url: string | null;
}

export interface DailyReadingPreparationV5 {
  schema_version: M5SchemaVersion;
  status: "preparing";
  local_date: string;
}

// ---------------------------------------------------------------------------
// Evidence graph
// ---------------------------------------------------------------------------

export type RevisionReason =
  | "initial"
  | "chart_recalculated"
  | "consent_revoked"
  | "safety_correction"
  | "defect_repair";

export interface FactRefV5 {
  fact_id: string;
  fact_class: string;
  /** The readable label the drawer shows; opaque ids stay technical detail. */
  label: string;
  scope: FactScope;
}

/** What was used and in which lane — never the value. */
export interface ContextRefV5 {
  private_ref: string;
  category: AiConsentDataCategory;
  allowed_use: M5AllowedUse;
}

export interface ParagraphEvidenceV5 {
  paragraph_id: string;
  role: ParagraphRoleV5;
  order: number;
  fact_refs: FactRefV5[];
  context_refs: ContextRefV5[];
}

export interface CalculationRecordV5 {
  chart_contract_id: string;
  cycle_policy_version: string;
  daily_sky_policy_version: string;
  ephemeris_data_version: string;
  container_digest: string;
  tzdb_version: string;
  local_day_resolution_policy_version: string;
}

/**
 * Required, not optional.
 *
 * Token counts and the provider request id are safe operational values; the
 * prompt packet, the response bytes, and the reasoning are not stored anywhere
 * and are not recoverable from this record.
 */
export interface ModelRecordV5 {
  provider: ReadingPublisherProvider;
  model: string;
  prompt_version: string;
  selection_policy_version: string;
  validation_policy_version: string;
  provider_request_id: string;
  input_tokens: number;
  output_tokens: number;
}

export interface ValidationResultV5 {
  status: "passed";
  policy_version: string;
  checks: Array<{ code: string; passed: true }>;
}

export interface ReadingEvidenceV5 {
  schema_version: M5SchemaVersion;
  reading_id: string;
  revision: number;
  revision_reason: RevisionReason;
  generated_at: string;
  /** Names the frozen eligible INPUT and policy, never the prose. */
  generation_input_id: string;
  input_manifest_hash: string;
  /** Names the candidate that WON publication. */
  content_hash: string;
  provider_response_hash: string;
  calculation: CalculationRecordV5;
  model: ModelRecordV5;
  paragraphs: ParagraphEvidenceV5[];
  validation: ValidationResultV5;
}
