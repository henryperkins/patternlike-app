import type { AspectType, BirthTimeAccuracy, CelestialBody } from "./types.js";
import type { NormalizedCycle } from "./cycle-types.js";

export const M4_SCHEMA_VERSION = "0.4.0" as const;
export const NATAL_FEATURE_POLICY_ID = "natal-feature-policy" as const;
export const NATAL_FEATURE_POLICY_VERSION = "1.0.0" as const;

export type NatalFeatureClass =
  | "position"
  | "aspect"
  | "pattern"
  | "angle"
  | "house_cusp"
  | "uncertainty";

interface NatalFeatureBase {
  feature_id: string;
  feature_class: NatalFeatureClass;
  policy_id: typeof NATAL_FEATURE_POLICY_ID;
  policy_version: typeof NATAL_FEATURE_POLICY_VERSION;
}

export interface PositionNatalFeature extends NatalFeatureBase {
  feature_class: "position";
  body: CelestialBody;
  longitude: number;
  sign: number;
  house: number | null;
}

export interface AspectNatalFeature extends NatalFeatureBase {
  feature_class: "aspect";
  body_a: CelestialBody;
  body_b: CelestialBody;
  aspect: AspectType;
  orb: number;
}

export interface PatternNatalFeature extends NatalFeatureBase {
  feature_class: "pattern";
  pattern: string;
  member_bodies: CelestialBody[];
}

export interface AngleNatalFeature extends NatalFeatureBase {
  feature_class: "angle";
  angle: "ascendant" | "midheaven";
  longitude: number;
  sign: number;
}

export interface HouseCuspNatalFeature extends NatalFeatureBase {
  feature_class: "house_cusp";
  house: number;
  longitude: number;
  sign: number;
}

export interface UncertaintyNatalFeature extends NatalFeatureBase {
  feature_class: "uncertainty";
  accuracy: BirthTimeAccuracy;
  suppressed_features: string[];
}

export type NatalFeature =
  | PositionNatalFeature
  | AspectNatalFeature
  | PatternNatalFeature
  | AngleNatalFeature
  | HouseCuspNatalFeature
  | UncertaintyNatalFeature;

export type NatalPredicate =
  | { type: "position"; body: CelestialBody; sign?: number; house?: number }
  | {
      type: "aspect";
      body_a: CelestialBody;
      body_b: CelestialBody;
      aspect: AspectType;
      max_orb?: number;
    }
  | { type: "pattern"; pattern: string; member_bodies?: CelestialBody[] }
  | { type: "angle"; angle: "ascendant" | "midheaven"; sign?: number }
  | { type: "house_cusp"; house: number; sign?: number }
  | {
      type: "uncertainty";
      accuracy: BirthTimeAccuracy;
      suppressed_feature?: string;
    };

export interface PatternMatch {
  all_of: NatalPredicate[];
  any_of: NatalPredicate[];
  none_of: NatalPredicate[];
}

/**
 * A type alias rather than an interface deliberately. The release bundle's
 * object collections are typed with an index signature, and TypeScript grants
 * an implicit index signature to object type aliases but never to interfaces —
 * so an interface here could not be handed back to the collection it came from
 * without an unchecked cast. The shape stays closed either way.
 */
export type PatternContentObject = {
  id: string;
  content_type: "pattern";
  content_version: string;
  object_hash: string;
  locale: string;
  status: "approved" | "deprecated";
  display_priority: number;
  title: string;
  summary: string;
  body: string;
  resources: string[];
  tensions: string[];
  counter_expression: string;
  prohibited_claims: string[];
  tags: string[];
  minimum_accuracy: BirthTimeAccuracy;
  requires_houses: boolean;
  required_bodies: CelestialBody[];
  required_aspects: AspectType[];
  match: PatternMatch;
}

export interface PatternEvidence {
  feature_id: string;
  feature_class: NatalFeatureClass;
  label: string;
}

export interface PatternChapter {
  content_id: string;
  content_version: string;
  title: string;
  summary: string;
  body: string;
  resources: string[];
  tensions: string[];
  counter_expression: string;
  evidence: PatternEvidence[];
}

export interface PatternResponse {
  schema_version: typeof M4_SCHEMA_VERSION;
  generated_at: string;
  chart_id: string;
  chart_fingerprint: string;
  effective_accuracy: BirthTimeAccuracy;
  feature_policy_version: typeof NATAL_FEATURE_POLICY_VERSION;
  feature_set_hash: string;
  release_version: string;
  bundle_hash: string;
  locale: string;
  items: PatternChapter[];
  next_cursor: string | null;
  omissions: {
    accuracy: number;
    houses_or_angles: number;
    locale: number;
    predicate_mismatch: number;
  };
}

export type LifeEventPrecision = "day" | "month" | "year" | "range";
export type LifeEventCategory =
  | "education"
  | "work"
  | "home"
  | "travel"
  | "relationship"
  | "family"
  | "creative"
  | "community"
  | "health_context"
  | "other";
export type LifeEventSignificance = "low" | "medium" | "high";

export interface LifeEventRequest {
  schema_version: typeof M4_SCHEMA_VERSION;
  start_date: string;
  end_date: string | null;
  precision: LifeEventPrecision;
  category: LifeEventCategory;
  significance: LifeEventSignificance;
  title: string;
  note: string | null;
  use_in_time_travel: boolean;
}

export interface LifeEvent extends LifeEventRequest {
  id: string;
  revision: number;
  observed_at: string;
  recorded_at: string;
  updated_at: string;
}

export interface ProjectedTimeTravelCycle {
  cycle: NormalizedCycle;
  phase: "emerging" | "building" | "peak" | "reconsidering" | "integrating" | null;
  rank: number;
  dominant: boolean;
}

export interface TimeTravelDateState {
  local_date: string;
  reference_at: string;
  provenance: "cache" | "on_demand";
  calculated_at: string;
  cycles: ProjectedTimeTravelCycle[];
}

export interface TimeTravelResponse {
  schema_version: typeof M4_SCHEMA_VERSION;
  generated_at: string;
  timezone: string;
  calculation_policy: {
    contract_id: string;
    contract_version: string;
    cycle_policy_id: string;
    cycle_policy_version: string;
    orb_policy_id: string;
    orb_policy_version: string;
    receipt_epoch: number;
  };
  selected: TimeTravelDateState;
  present: TimeTravelDateState;
  comparison: {
    continuing: string[];
    selected_only: string[];
    present_only: string[];
    phase_changed: string[];
  };
  saved_context: Array<{
    event: LifeEvent;
    recording_relation: "recorded_then" | "added_later";
  }>;
  unreadable_context_count: number;
  life_event_source_state: "active" | "paused" | "revoked" | "never_granted";
}
