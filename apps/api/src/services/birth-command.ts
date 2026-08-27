import {
  isValidIanaZone,
  type BirthProfileRequest,
  type BirthTimeAccuracy,
  type TimezoneConfidence,
  type TimezoneQualifier,
} from "@patternlike/shared";

export const BIRTH_CALC_COMMAND_SCHEMA_VERSION =
  "birth-calc-command/v1" as const;

const ACCURACIES = new Set<BirthTimeAccuracy>([
  "exact",
  "approximate",
  "unknown",
]);
const CONFIDENCES = new Set<TimezoneConfidence>([
  "high",
  "medium",
  "low",
  "none",
]);
const QUALIFIER_CODES = new Set<BirthLocationQualifierCode>([
  "pre_1970_zone_boundary",
  "near_zone_boundary",
  "hint_replaced",
  "no_coordinates",
  "nautical_zone",
  "local_time_ambiguous",
  "local_time_nonexistent",
  "approximate_match",
  "region_level_match",
]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/;

export type BirthLocationQualifierCode =
  | TimezoneQualifier["code"]
  | "approximate_match"
  | "region_level_match";

export interface NormalizedBirthplace {
  place_id: string | null;
  label: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface BirthCalcSubmitted {
  accuracy: BirthTimeAccuracy;
  consent_id: string;
  birth_date: string | null;
  birth_time_local: string | null;
  approximate_window_minutes: number | null;
  timezone_hint: string | null;
  birthplace: NormalizedBirthplace | null;
}

export interface BirthCalcCommandV1 {
  schema_version: typeof BIRTH_CALC_COMMAND_SCHEMA_VERSION;
  submitted: BirthCalcSubmitted;
  effective: {
    accuracy: BirthTimeAccuracy;
    birth_date: string | null;
    birth_time_local: string | null;
    approximate_window_minutes: number | null;
    timezone: string;
    birthplace: NormalizedBirthplace;
    location_confidence: TimezoneConfidence;
    location_qualifier_codes: BirthLocationQualifierCode[];
  };
}

export interface BirthCommandResolution {
  timezone: string;
  confidence: TimezoneConfidence;
  qualifiers: Array<Pick<TimezoneQualifier, "code">>;
}

export interface LegacyBirthPayload {
  birth_date: string | null;
  birth_time_local: string | null;
  birthplace: BirthProfileRequest["birthplace"] | null;
  approximate_window_minutes: number | null;
  consent_id: string;
}

export type DecodedBirthProfilePayload =
  | { kind: "legacy"; birth: LegacyBirthPayload }
  | { kind: "v1"; command: BirthCalcCommandV1 }
  | { kind: "unknown_version"; schemaVersion: string | null }
  | { kind: "malformed_v1" };

function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function normalizedBirthplace(
  birthplace: BirthProfileRequest["birthplace"] | null | undefined,
): NormalizedBirthplace | null {
  if (birthplace === null || birthplace === undefined) return null;
  return {
    place_id: normalizeText(birthplace.place_id),
    label: normalizeText(birthplace.label),
    latitude: birthplace.latitude ?? null,
    longitude: birthplace.longitude ?? null,
  };
}

export function normalizeBirthCalcSubmission(
  request: BirthProfileRequest,
): BirthCalcSubmitted {
  return {
    accuracy: request.accuracy,
    consent_id: request.consent_id,
    birth_date: request.birth_date ?? null,
    birth_time_local: request.birth_time_local ?? null,
    approximate_window_minutes:
      request.approximate_window_minutes ?? null,
    timezone_hint: normalizeText(request.timezone_hint),
    birthplace: normalizedBirthplace(request.birthplace),
  };
}

function emptyBirthplace(): NormalizedBirthplace {
  return {
    place_id: null,
    label: null,
    latitude: null,
    longitude: null,
  };
}

export function buildBirthCalcCommand(
  request: BirthProfileRequest,
  resolution: BirthCommandResolution,
): BirthCalcCommandV1 {
  const submitted = normalizeBirthCalcSubmission(request);
  return {
    schema_version: BIRTH_CALC_COMMAND_SCHEMA_VERSION,
    submitted,
    effective: {
      accuracy: submitted.accuracy,
      birth_date: submitted.birth_date,
      birth_time_local: submitted.birth_time_local,
      approximate_window_minutes:
        submitted.approximate_window_minutes,
      timezone: resolution.timezone,
      birthplace: submitted.birthplace ?? emptyBirthplace(),
      location_confidence: resolution.confidence,
      location_qualifier_codes: resolution.qualifiers.map(
        (qualifier) => qualifier.code,
      ),
    },
  };
}

function sameBirthplace(
  left: NormalizedBirthplace | null,
  right: NormalizedBirthplace | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.place_id === right.place_id &&
    left.label === right.label &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  );
}

export function birthCalcCommandMatchesRequest(
  command: BirthCalcCommandV1,
  request: BirthProfileRequest,
): boolean {
  const candidate = normalizeBirthCalcSubmission(request);
  const stored = command.submitted;
  return (
    stored.accuracy === candidate.accuracy &&
    stored.consent_id === candidate.consent_id &&
    stored.birth_date === candidate.birth_date &&
    stored.birth_time_local === candidate.birth_time_local &&
    stored.approximate_window_minutes ===
      candidate.approximate_window_minutes &&
    stored.timezone_hint === candidate.timezone_hint &&
    sameBirthplace(stored.birthplace, candidate.birthplace)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isAccuracy(value: unknown): value is BirthTimeAccuracy {
  return typeof value === "string" &&
    ACCURACIES.has(value as BirthTimeAccuracy);
}

function isNullableDate(value: unknown): value is string | null {
  return value === null ||
    (typeof value === "string" && ISO_DATE_RE.test(value));
}

function isNullableTime(value: unknown): value is string | null {
  return value === null ||
    (typeof value === "string" && LOCAL_TIME_RE.test(value));
}

function isNullableWindow(value: unknown): value is number | null {
  return value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 1440);
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCoordinate(
  value: unknown,
  limit: number,
): value is number | null {
  return value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= -limit &&
      value <= limit);
}

function isNormalizedBirthplace(
  value: unknown,
): value is NormalizedBirthplace {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, [
    "place_id",
    "label",
    "latitude",
    "longitude",
  ])) {
    return false;
  }
  return (
    isNullableText(value.place_id) &&
    isNullableText(value.label) &&
    isCoordinate(value.latitude, 90) &&
    isCoordinate(value.longitude, 180) &&
    ((value.latitude === null && value.longitude === null) ||
      (value.latitude !== null && value.longitude !== null))
  );
}

function isSubmitted(value: unknown): value is BirthCalcSubmitted {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, [
    "accuracy",
    "consent_id",
    "birth_date",
    "birth_time_local",
    "approximate_window_minutes",
    "timezone_hint",
    "birthplace",
  ])) {
    return false;
  }
  return (
    isAccuracy(value.accuracy) &&
    typeof value.consent_id === "string" &&
    value.consent_id.length > 0 &&
    isNullableDate(value.birth_date) &&
    isNullableTime(value.birth_time_local) &&
    isNullableWindow(value.approximate_window_minutes) &&
    (value.timezone_hint === null ||
      (typeof value.timezone_hint === "string" &&
        isValidIanaZone(value.timezone_hint))) &&
    (value.birthplace === null ||
      isNormalizedBirthplace(value.birthplace))
  );
}

function sameEffectiveSubmitted(
  submitted: BirthCalcSubmitted,
  effective: Pick<
    BirthCalcCommandV1["effective"],
    | "accuracy"
    | "birth_date"
    | "birth_time_local"
    | "approximate_window_minutes"
    | "birthplace"
  >,
): boolean {
  const submittedBirthplace = submitted.birthplace ?? emptyBirthplace();
  return (
    effective.accuracy === submitted.accuracy &&
    effective.birth_date === submitted.birth_date &&
    effective.birth_time_local === submitted.birth_time_local &&
    effective.approximate_window_minutes ===
      submitted.approximate_window_minutes &&
    sameBirthplace(effective.birthplace, submittedBirthplace)
  );
}

function isBirthCalcCommandV1(
  value: Record<string, unknown>,
): value is Record<string, unknown> & BirthCalcCommandV1 {
  if (!hasExactKeys(value, [
    "schema_version",
    "submitted",
    "effective",
  ])) {
    return false;
  }
  if (
    value.schema_version !== BIRTH_CALC_COMMAND_SCHEMA_VERSION ||
    !isSubmitted(value.submitted) ||
    !isRecord(value.effective)
  ) {
    return false;
  }
  const effective = value.effective;
  if (!hasExactKeys(effective, [
    "accuracy",
    "birth_date",
    "birth_time_local",
    "approximate_window_minutes",
    "timezone",
    "birthplace",
    "location_confidence",
    "location_qualifier_codes",
  ])) {
    return false;
  }
  if (
    !isAccuracy(effective.accuracy) ||
    !isNullableDate(effective.birth_date) ||
    !isNullableTime(effective.birth_time_local) ||
    !isNullableWindow(effective.approximate_window_minutes) ||
    typeof effective.timezone !== "string" ||
    !isValidIanaZone(effective.timezone) ||
    !isNormalizedBirthplace(effective.birthplace) ||
    typeof effective.location_confidence !== "string" ||
    !CONFIDENCES.has(
      effective.location_confidence as TimezoneConfidence,
    ) ||
    !Array.isArray(effective.location_qualifier_codes) ||
    !effective.location_qualifier_codes.every(
      (code) =>
        typeof code === "string" &&
        QUALIFIER_CODES.has(code as BirthLocationQualifierCode),
    ) ||
    new Set(effective.location_qualifier_codes).size !==
      effective.location_qualifier_codes.length
  ) {
    return false;
  }
  return sameEffectiveSubmitted(value.submitted, {
    accuracy: effective.accuracy,
    birth_date: effective.birth_date,
    birth_time_local: effective.birth_time_local,
    approximate_window_minutes: effective.approximate_window_minutes,
    birthplace: effective.birthplace,
  });
}

function isLegacyBirthplace(
  value: unknown,
): value is NonNullable<BirthProfileRequest["birthplace"]> {
  if (!isRecord(value)) return false;
  const allowed = new Set([
    "place_id",
    "label",
    "latitude",
    "longitude",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  const latitude = value.latitude ?? null;
  const longitude = value.longitude ?? null;
  return (
    (value.place_id === undefined ||
      value.place_id === null ||
      typeof value.place_id === "string") &&
    (value.label === undefined || typeof value.label === "string") &&
    isCoordinate(latitude, 90) &&
    isCoordinate(longitude, 180) &&
    ((latitude === null && longitude === null) ||
      (latitude !== null && longitude !== null))
  );
}

function isLegacyBirthPayload(
  value: Record<string, unknown>,
): value is Record<string, unknown> & LegacyBirthPayload {
  if (!hasExactKeys(value, [
    "birth_date",
    "birth_time_local",
    "birthplace",
    "approximate_window_minutes",
    "consent_id",
  ])) {
    return false;
  }
  return (
    isNullableDate(value.birth_date) &&
    isNullableTime(value.birth_time_local) &&
    isNullableWindow(value.approximate_window_minutes) &&
    typeof value.consent_id === "string" &&
    value.consent_id.length > 0 &&
    (value.birthplace === null || isLegacyBirthplace(value.birthplace))
  );
}

export function decodeBirthProfilePayload(
  value: unknown,
): DecodedBirthProfilePayload {
  if (!isRecord(value)) {
    return { kind: "unknown_version", schemaVersion: null };
  }
  if (Object.prototype.hasOwnProperty.call(value, "schema_version")) {
    if (value.schema_version !== BIRTH_CALC_COMMAND_SCHEMA_VERSION) {
      return {
        kind: "unknown_version",
        schemaVersion:
          typeof value.schema_version === "string"
            ? value.schema_version
            : null,
      };
    }
    return isBirthCalcCommandV1(value)
      ? { kind: "v1", command: value }
      : { kind: "malformed_v1" };
  }
  return isLegacyBirthPayload(value)
    ? { kind: "legacy", birth: value }
    : { kind: "unknown_version", schemaVersion: null };
}

function projectBirthplace(
  birthplace: BirthProfileRequest["birthplace"] | null,
): BirthProfileRequest["birthplace"] | null {
  if (birthplace === null || birthplace === undefined) return null;
  const projected: NonNullable<BirthProfileRequest["birthplace"]> = {};
  if (birthplace.place_id !== undefined) {
    projected.place_id = birthplace.place_id;
  }
  if (birthplace.label !== undefined) projected.label = birthplace.label;
  if (birthplace.latitude !== undefined) {
    projected.latitude = birthplace.latitude;
  }
  if (birthplace.longitude !== undefined) {
    projected.longitude = birthplace.longitude;
  }
  return projected;
}

export function projectBirthPayloadForExport(
  value: unknown,
): Record<string, unknown> {
  const decoded = decodeBirthProfilePayload(value);
  if (decoded.kind === "v1") {
    const submitted = decoded.command.submitted;
    return {
      accuracy: submitted.accuracy,
      consent_id: submitted.consent_id,
      birth_date: submitted.birth_date,
      birth_time_local: submitted.birth_time_local,
      approximate_window_minutes:
        submitted.approximate_window_minutes,
      timezone_hint: submitted.timezone_hint,
      birthplace: submitted.birthplace === null
        ? null
        : { ...submitted.birthplace },
    };
  }
  if (decoded.kind === "legacy") {
    return {
      birth_date: decoded.birth.birth_date,
      birth_time_local: decoded.birth.birth_time_local,
      birthplace: projectBirthplace(decoded.birth.birthplace),
      approximate_window_minutes:
        decoded.birth.approximate_window_minutes,
      consent_id: decoded.birth.consent_id,
    };
  }
  throw new Error("birth profile payload is not exportable");
}
