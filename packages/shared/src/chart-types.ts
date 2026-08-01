import type { AspectType, BirthTimeAccuracy, CelestialBody } from "./types.js";

export interface UncertaintyReport {
  accuracy: BirthTimeAccuracy;
  window: {
    plus_minus_minutes?: number;
    earliest_local?: string | null;
    latest_local?: string | null;
  } | null;
  suppressed_features: Array<{
    feature_class: string;
    feature_id?: string | null;
    reason: string;
  }>;
  qualified_features: Array<{
    feature_id: string;
    qualification: string;
  }>;
  user_facing_summary: string | null;
}

export interface LongitudePosition {
  body: CelestialBody;
  longitude_deg: number;
  latitude_deg?: number | null;
  distance_au?: number | null;
  speed_longitude_deg_per_day?: number | null;
  retrograde?: boolean | null;
  sign?: string | null;
  house?: number | null;
}

export interface NatalAspect {
  id: string;
  body_a: CelestialBody;
  body_b: CelestialBody;
  aspect: AspectType;
  orb_deg: number;
  applying?: boolean | null;
  orb_policy_id: string;
  orb_policy_version: string;
}

export interface ChartSnapshot {
  schema_version: "0.2.0";
  id: string;
  user_id: string;
  profile_version: number;
  fingerprint: string;
  contract_id: string;
  contract_version: string;
  container_digest: string;
  tzdb_version?: string;
  birth: {
    accuracy: BirthTimeAccuracy;
    utc_instant: string | null;
    timezone: string;
    place_label?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    sensitive_profile?: unknown;
  };
  positions: LongitudePosition[];
  houses: {
    system_used: "placidus" | "porphyry";
    fallback_applied: boolean;
    cusps_deg: number[];
  } | null;
  angles: {
    ascendant_deg: number;
    midheaven_deg: number;
  } | null;
  aspects: NatalAspect[];
  patterns?: unknown[];
  uncertainty: UncertaintyReport;
  calculated_at: string;
  status: "active" | "superseded" | "invalid";
  r2_uri?: string | null;
}

export interface CalcRequest {
  request_id: string;
  user_id: string;
  profile_version: number;
  accuracy: BirthTimeAccuracy;
  /** ISO date YYYY-MM-DD */
  birth_date: string | null;
  /** Local civil time HH:MM or HH:MM:SS */
  birth_time_local: string | null;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  place_label: string | null;
  approximate_window_minutes?: number | null;
  contract_id: string;
  contract_version: string;
}

export interface CalcResponse {
  ok: boolean;
  chart: ChartSnapshot | null;
  error_class?: string;
  error_message?: string;
}
