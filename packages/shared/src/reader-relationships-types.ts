/** Exact reader coordinates. Server loaders establish ownership and current eligibility. */
export type ReaderTarget =
  | { kind: "daily"; reading_id: string; revision: number; content_hash: string; paragraph_id: string }
  | { kind: "pattern"; pattern_id: string; document_revision: string; content_hash: string; chapter_index: number; chapter_source_sha256: string }
  | { kind: "timing"; cycle_id: string; cycle_hash: string; pass_index: number; starts_at: string; ends_at: string; exact_at: string; local_date: string; time_zone: string; policy_version: string };

export interface CalculatedFeature {
  chart: string;
  policy: string;
  kind: "natal_position" | "natal_aspect" | "natal_house" | "transit_aspect";
  frame: "tropical_geocentric" | "sidereal_geocentric";
  participants: Array<{ body: string; role: "natal_subject" | "natal_object" | "transiting" | "natal_target" }>;
  coordinate: string;
  uncertainty_policy: string;
  requires_birth_time: boolean;
}

export interface NatalParticipant {
  chart: string;
  body: string;
  frame: CalculatedFeature["frame"];
  policy: string;
  role: "natal_interpretation" | "transit_target";
  requires_birth_time: boolean;
}

export interface AuthorizedReaderUnit {
  target: ReaderTarget;
  eligible: boolean;
  birth_time: "exact" | "approximate" | "unknown";
  features: CalculatedFeature[];
  participants: NatalParticipant[];
  /** Retained cycle references tied to this accepted unit; never provider-authored join keys. */
  cycle_refs?: Array<Extract<ReaderTarget, { kind: "timing" }>>;
  /** A retained Daily date and its original zone/day interval, not today's settings. */
  day?: { chart: string; local_date: string; time_zone: string; starts_at: string; ends_at: string };
  /** A retained occurrence in this exact timing pass. */
  occurrence?: { chart: string; exact_at: string };
}

export type RelationshipKind = "shared_calculated_feature" | "shared_natal_participant" | "dated_occurrence";
export const RELATIONSHIP_REASONS: Record<RelationshipKind, string> = {
  shared_calculated_feature: "Both passages refer to the same calculated feature.",
  shared_natal_participant: "Both involve the same natal participant. The transit and natal interpretation describe different facts.",
  dated_occurrence: "This event falls on the date of this saved reading. A shared date does not establish a cause.",
};

export interface ReaderRelationship {
  id: string;
  from: ReaderTarget;
  to: ReaderTarget;
  kind: RelationshipKind;
  reason_code: RelationshipKind;
  support_digest: string;
  evidence_identity: string;
}

export interface ReaderRelationships {
  source: ReaderTarget;
  status: "available" | "no_supported_connection" | "unavailable";
  items: ReaderRelationship[];
  truncated: boolean;
}

export type ReaderDailyTarget = Extract<ReaderTarget, { kind: "daily" }>;
export type ReaderPatternTarget = Extract<ReaderTarget, { kind: "pattern" }>;
export type ReaderTimingTarget = Extract<ReaderTarget, { kind: "timing" }>;

/** Encrypted per-document support. Eligibility is re-established on every read. */
export interface ReaderRelationshipSupport {
  schema_version: "reader-relationship-support/v1";
  units: AuthorizedReaderUnit[];
}

export interface ReaderRelationshipSourceResponse {
  schema_version: "reader-relationship-source/v1";
  status: "available" | "unavailable";
  source: ReaderDailyTarget | null;
}

export interface ReaderRelationshipsResponse extends ReaderRelationships {
  schema_version: "reader-relationships/v1";
}

export interface ReaderTimingDetail {
  target: ReaderTimingTarget;
  technique: "transit";
  body: string;
  natal_target: string;
  aspect: string;
  phase: string | null;
  orb_deg: number;
  passes: Array<{ pass_index: number; direction: "direct" | "retrograde"; exact_at: string }>;
}

export type ReaderRelationshipTargetResponse<Daily, Pattern> =
  | { schema_version: "reader-relationship-target/v1"; status: "unavailable" }
  | { schema_version: "reader-relationship-target/v1"; status: "available"; kind: "daily"; target: ReaderDailyTarget; reading: Daily; reading_status: "published" | "superseded" | "invalidated" }
  | { schema_version: "reader-relationship-target/v1"; status: "available"; kind: "pattern"; target: ReaderPatternTarget; pattern: Pattern }
  | { schema_version: "reader-relationship-target/v1"; status: "available"; kind: "timing"; target: ReaderTimingTarget; timing: ReaderTimingDetail };
