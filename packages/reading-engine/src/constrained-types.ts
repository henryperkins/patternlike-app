/**
 * Types and policy constants for the constrained-model reading path.
 *
 * `prepareConstrainedReadingInput()` is the only place the product decides what
 * a model may see, so this file is deliberately explicit about the shape of that
 * decision. The wire types it produces — `ReadingGenerationRequest` and
 * friends — belong to `@patternlike/shared`; what lives here is the INPUT side
 * (what the Worker read out of D1 and the calculation service) and the closed
 * selection/validation vocabulary. Selection and validation are product policy
 * and must stay out of the package the AGPL calculation service imports.
 */

import type {
  AiConsentDataCategory,
  AnchorResolution,
  AspectType,
  BirthTimeAccuracy,
  CelestialBody,
  ContextRefV5,
  DailySkyFact,
  FactAttributes,
  FactScope,
  LaneRank,
  LifeDomain,
  M5AllowedUse,
  M5FactClass,
  ParagraphRoleV5,
  ReadingGenerationRequest,
  ValidationResultV5,
  ZodiacSignName,
} from "@patternlike/shared";

import type {
  AssemblyUncertaintyInput,
  EvidenceLane,
  NormalizedCycle,
  Rejection,
} from "./types.js";

// ---------------------------------------------------------------------------
// Policy identity
// ---------------------------------------------------------------------------

/**
 * Bump for ANY change to fact projection, lane assignment, label rendering,
 * context expansion, reservation, round-robin order, truncation, or budgeting.
 *
 * The value enters `identity_canonical`, so two builds that would select
 * different inputs for the same corpus must not be able to produce the same
 * `generation_input_id`.
 */
export const SELECTION_POLICY_ID = "constrained-context-selection" as const;
export const SELECTION_POLICY_VERSION = "1.0.0" as const;

/**
 * Bump for ANY change to what a candidate must satisfy. Stored in v5 evidence,
 * so a reader can tell which rule set a published reading actually passed.
 */
export const VALIDATION_POLICY_ID = "constrained-candidate-validation" as const;
export const VALIDATION_POLICY_VERSION = "1.0.0" as const;

/** Domain-separation tags. Two preimages over the same selection, two digests. */
export const GENERATION_INPUT_IDENTITY_PROFILE = "patternlike.generation-input-id.v1" as const;
export const GENERATION_INPUT_MANIFEST_PROFILE =
  "patternlike.generation-input-manifest.v1" as const;

// ---------------------------------------------------------------------------
// Selection policy constants
// ---------------------------------------------------------------------------

/** Repetition control needs recency, not history. */
export const MAX_PRIOR_READINGS = 7;

/** Enough structured feedback to learn framing, bounded enough to stay a packet. */
export const MAX_FEEDBACK_RECORDS = 20;

/**
 * One free-text excerpt, capped in BYTES rather than characters and cut on a
 * code-point boundary. Frozen at enqueue so an execution-time re-read cannot
 * silently truncate differently.
 */
export const MAX_CONTEXT_TEXT_BYTES = 2048;

/** `ctx_` handles are `ctx_[0-9]{1,3}`, so the packet cannot hold more. */
export const MAX_CONTEXT_ITEMS = 999;

/** Composition bounds. Reader-facing limits, not provider limits. */
export const HEADLINE_MAX_CHARS = 60;
export const LEAD_MAX_CHARS = 600;
export const PARAGRAPH_MAX_CHARS = 600;
export const REFLECTION_MAX_CHARS = 240;

// ---------------------------------------------------------------------------
// Compiler input
// ---------------------------------------------------------------------------

/** The identity of one frozen calculation exchange, as the command pins it. */
export interface ConstrainedCalculationPin {
  policy_id: string;
  policy_version: string;
  orb_policy_id: string | null;
  orb_policy_version: string | null;
  request_digest: string;
  response_digest: string;
  container_digest: string;
  ephemeris_data_version: string;
}

export interface ConstrainedDayWindow {
  day_start_at: string;
  day_end_at: string;
  /** Local noon. Every anchor-sampled sky fact was computed here. */
  anchor_at: string;
  anchor_resolution: AnchorResolution;
  tzdb_version: string;
  local_day_resolution_policy_version: string;
}

export interface ConstrainedChartInput {
  fingerprint: string;
  contract_id: string;
  contract_version: string;
  container_digest: string;
  /** The recomputed effective accuracy, never the label the caller supplied. */
  effective_accuracy: BirthTimeAccuracy;
  uncertainty: AssemblyUncertaintyInput;
}

/**
 * A stable natal fact.
 *
 * The handle is supplied rather than derived: `nat_` ids are content-addressed
 * and this package cannot hash — its purity contract has no crypto, which is
 * exactly what lets the whole engine run under `node:test` with no harness.
 */
export interface ConstrainedNatalFactInput {
  fact_id: string;
  fact_class: "natal_position" | "natal_aspect";
  body: CelestialBody;
  target: CelestialBody | null;
  aspect: AspectType | null;
  sign: ZodiacSignName | null;
  /** Sign degree for a position, orb for an aspect. */
  degree_deg: number | null;
  house: number | null;
}

export interface ConstrainedPriorReading {
  local_date: string;
  headline: string;
  lead: string;
  reflection_prompt: string;
}

export type ConstrainedContextContent =
  | { kind: "text"; text: string }
  | { kind: "structured"; value: Record<string, unknown> };

/**
 * One context source's permission row and the source consent behind it.
 *
 * Both sides are carried because both must agree. A permission that names a
 * different consent, a consent that names a different source, or two
 * disagreeing allowed-use arrays reject the WHOLE source: an intersection of
 * two records that do not describe the same grant is not a smaller grant, it is
 * an unresolved contradiction.
 */
export interface ConstrainedContextSourceInput {
  source_id: string;
  permission_state: "active" | "paused" | "revoked" | "expired" | "never_granted";
  permission_allowed_uses: string[];
  permission_consent_id: string;
  consent_id: string;
  consent_source_id: string;
  consent_status: "granted" | "revoked" | "expired";
  consent_version: number;
  consent_allowed_uses: string[];
}

export interface ConstrainedContextSignalInput {
  signal_id: string;
  source_id: string;
  /** Which AI-synthesis consent category this signal is disclosed under. */
  category: Extract<
    AiConsentDataCategory,
    "enabled_personal_context" | "reading_feedback"
  >;
  allowed_uses: string[];
  evidence_lane: EvidenceLane;
  normalized_hash: string;
  freshness_status: "fresh" | "stale" | "expired" | "unknown";
  observed_at: string;
  /** Absolute raw-signal expiry; null for source families without one. */
  expires_at: string | null;
  content: ConstrainedContextContent;
}

export interface ConstrainedReadingInput {
  schema_version: "0.5.0";
  prompt_version: string;
  output_schema: "daily-reading-v5";
  selection_policy_version: string;
  validation_policy_version: string;
  /** Hard ceiling on the serialized provider packet, in UTF-8 bytes. */
  context_max_bytes: number;
  target_local_date: string;
  /** Scheduling zone. Enters the identity; never enters the packet. */
  target_timezone: string;
  locale: string;
  /** The freeze instant, not the attempt time. */
  generation_anchor: string;
  revision: number;
  domain_preference: LifeDomain | null;
  /** The categories the AI-synthesis grant actually names, in display order. */
  consent_categories: AiConsentDataCategory[];
  day: ConstrainedDayWindow;
  chart: ConstrainedChartInput;
  cycle_scan: ConstrainedCalculationPin;
  cycles: NormalizedCycle[];
  daily_sky: ConstrainedCalculationPin;
  daily_sky_facts: DailySkyFact[];
  natal_facts: ConstrainedNatalFactInput[];
  context_sources: ConstrainedContextSourceInput[];
  context_signals: ConstrainedContextSignalInput[];
  prior_readings: ConstrainedPriorReading[];
}

// ---------------------------------------------------------------------------
// Compiler output
// ---------------------------------------------------------------------------

export type ConstrainedFactOrigin = "cycle_scan" | "daily_sky" | "natal";

export interface ConstrainedFact {
  fact_id: string;
  fact_class: M5FactClass;
  scope: FactScope;
  lane_rank: LaneRank;
  label: string;
  attributes: FactAttributes;
  origin: ConstrainedFactOrigin;
  /** The calculation service's digest when it supplied one. */
  content_digest: string | null;
  /** Which consent category disclosed this fact. */
  category: AiConsentDataCategory;
}

/**
 * One selected signal/use pair.
 *
 * Structurally the command's `contextPinV2` minus the frozen snapshot, which
 * the caller adds when it encrypts the command. A signal eligible for two lanes
 * appears here twice, because each lane is separately checked at execution.
 */
export interface ConstrainedContextRef {
  context_ref: string;
  signal_id: string;
  source_id: string;
  category: AiConsentDataCategory;
  allowed_use: M5AllowedUse;
  evidence_lane: EvidenceLane;
  normalized_hash: string;
  consent_id: string;
  consent_version: number;
  permission_state: "active";
  freshness_status: "fresh";
  observed_at: string;
  expires_at: string | null;
  /** Normalized and truncated exactly as the packet carries it. */
  snapshot: ConstrainedContextContent;
}

export interface PreparedConstrainedReadingInput {
  selected_facts: ConstrainedFact[];
  selected_context: ConstrainedContextRef[];
  /** Which prior readings survived the packet ceiling, newest first. */
  selected_prior_readings: ConstrainedPriorReading[];
  rejections: Rejection[];
  request: ReadingGenerationRequest;
  /** UTF-8 length of the canonical packet. Never exceeds `context_max_bytes`. */
  packet_bytes: number;
  input_manifest_canonical: string;
  identity_canonical: string;
}

// ---------------------------------------------------------------------------
// Candidate validation
// ---------------------------------------------------------------------------

/**
 * The closed check vocabulary. Each value is a `code` in the stored v5
 * validation record, so adding or renaming one is a validation-policy bump.
 */
export const CANDIDATE_CHECKS = [
  "schema_shape",
  "echo",
  "role_order",
  "length_bounds",
  "known_references",
  "context_lane",
  "grounding",
  "vocabulary",
  "uncertainty",
  "collective_scope",
  "context_not_evidence",
  "markup",
  "instruction_leakage",
  "safety",
  "evidence_counts",
] as const;

export type CandidateCheckCode = (typeof CANDIDATE_CHECKS)[number];

/**
 * Why one check failed.
 *
 * `detail_code` is a closed lowercase token, never candidate prose: a failure
 * is logged and counted, and a validator that quoted the text it rejected would
 * put model output into the one surface guaranteed to be recorded.
 */
export interface CandidateFailure {
  code: CandidateCheckCode;
  detail_code: string;
}

/** One published prose unit, resolved against the frozen input. */
export interface ValidatedReadingUnit {
  role: ParagraphRoleV5;
  /** 1-based, contiguous. */
  order: number;
  text: string;
  fact_refs: Array<{
    fact_id: string;
    fact_class: string;
    label: string;
    scope: FactScope;
  }>;
  context_refs: ContextRefV5[];
}

export type CandidateValidationResult =
  | {
      ok: true;
      validation: ValidationResultV5;
      /** Ordered exactly as `daily-reading-v5` will publish them. */
      units: ValidatedReadingUnit[];
    }
  | {
      ok: false;
      policy_version: string;
      failures: CandidateFailure[];
    };
