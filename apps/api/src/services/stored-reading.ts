import type {
  DailyReadingV5,
  ReadingEvidenceV5,
  ReadingParagraphV5,
} from "@patternlike/shared";
import { M5_SCHEMA_VERSION, PARAGRAPH_ROLES_V5 } from "@patternlike/shared";
import type { DailyReading, ReadingEvidenceDraft } from "@patternlike/reading-engine";

/**
 * What `daily_readings.reading_enc` actually holds, in both formats.
 *
 * A stored artifact is written once and never rewritten. A v3 envelope sealed by
 * the M3 assembler is therefore read back by M5 code and must stay readable
 * exactly as it was — projecting it through a v5 reader, or "upgrading" it in
 * place, would be rewriting history to make it look like something it is not.
 * The two formats are separate types with separate guards for that reason.
 *
 * The discriminant is `schema_version`, which only the v5 envelope carries. That
 * asymmetry is not an oversight: the v3 envelope predates the union and no
 * stored row can be given a key it was not sealed with.
 */

/** The M3 envelope. Sealed by `assembleReading`; never written again. */
export interface StoredReadingV3 {
  reading: DailyReading;
  assembly_id: string;
  content_hash: string;
  primary_cycle_id: string | null;
  supporting_cycle_id: string | null;
  validation: ReadingEvidenceDraft["validation"];
  evidence_header: Omit<ReadingEvidenceDraft, "paragraphs">;
}

/**
 * The M5 envelope.
 *
 * `invalidation` lives INSIDE the ciphertext rather than in a clear column: the
 * reason a reading stopped being true is a statement about the reader's chart.
 * `daily_readings.invalidated_at` is the clear operational half, and it carries
 * only a timestamp.
 */
export interface StoredReadingV5 {
  schema_version: typeof M5_SCHEMA_VERSION;
  reading: DailyReadingV5;
  evidence_header: Omit<ReadingEvidenceV5, "paragraphs">;
  invalidation:
    | null
    | {
        reason: "chart_correction" | "calculation_defect";
        actor_class: "user_change" | "operator";
        invalidated_at: string;
      };
}

export type StoredReading = StoredReadingV3 | StoredReadingV5;

const ROLES_V5: ReadonlySet<string> = new Set(PARAGRAPH_ROLES_V5);

const REVISION_REASONS: ReadonlySet<string> = new Set([
  "initial",
  "chart_recalculated",
  "consent_revoked",
  "safety_correction",
  "defect_repair",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isParagraphV5(value: unknown): value is ReadingParagraphV5 {
  return (
    isObject(value) &&
    isNonEmptyString(value.paragraph_id) &&
    typeof value.role === "string" &&
    ROLES_V5.has(value.role) &&
    isPositiveInteger(value.order) &&
    isNonEmptyString(value.text)
  );
}

function isDailyReadingV5(value: unknown): value is DailyReadingV5 {
  if (!isObject(value)) return false;
  if (value.schema_version !== M5_SCHEMA_VERSION) return false;
  if (value.output_schema !== "daily-reading-v5") return false;
  if (value.assembly_mode !== "constrained_model") return false;
  if (!isNonEmptyString(value.reading_id)) return false;
  if (!isNonEmptyString(value.local_date)) return false;
  if (!isNonEmptyString(value.generated_at)) return false;
  if (!isPositiveInteger(value.revision)) return false;
  if (!isNonEmptyString(value.locale)) return false;
  if (!isNonEmptyString(value.headline)) return false;
  // Required rather than optional: a reader cannot consent to something the
  // product then declines to mention.
  if (!isNonEmptyString(value.disclosure)) return false;
  if (
    value.domain_preference !== undefined &&
    value.domain_preference !== null &&
    typeof value.domain_preference !== "string"
  ) {
    return false;
  }
  // Removed by the v5 contract. A row carrying either was written by something
  // that does not understand what it was writing.
  if ("fallback_used" in value || "release_version" in value) return false;
  if (!Array.isArray(value.paragraphs) || value.paragraphs.length === 0) return false;
  return value.paragraphs.every(isParagraphV5);
}

function isCalculationRecord(value: unknown): boolean {
  if (!isObject(value)) return false;
  return [
    "chart_contract_id",
    "cycle_policy_version",
    "daily_sky_policy_version",
    "ephemeris_data_version",
    "container_digest",
    "tzdb_version",
    "local_day_resolution_policy_version",
  ].every((key) => isNonEmptyString(value[key]));
}

function isModelRecord(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.provider !== "openai") return false;
  if (
    !["model", "prompt_version", "selection_policy_version", "validation_policy_version", "provider_request_id"].every(
      (key) => isNonEmptyString(value[key]),
    )
  ) {
    return false;
  }
  return (
    typeof value.input_tokens === "number" &&
    Number.isInteger(value.input_tokens) &&
    value.input_tokens >= 0 &&
    typeof value.output_tokens === "number" &&
    Number.isInteger(value.output_tokens) &&
    value.output_tokens >= 0
  );
}

function isEvidenceHeaderV5(
  value: unknown,
): value is Omit<ReadingEvidenceV5, "paragraphs"> {
  if (!isObject(value)) return false;
  if (value.schema_version !== M5_SCHEMA_VERSION) return false;
  if (!isNonEmptyString(value.reading_id)) return false;
  if (!isPositiveInteger(value.revision)) return false;
  if (typeof value.revision_reason !== "string" || !REVISION_REASONS.has(value.revision_reason)) {
    return false;
  }
  if (
    !["generated_at", "generation_input_id", "input_manifest_hash", "content_hash", "provider_response_hash"].every(
      (key) => isNonEmptyString(value[key]),
    )
  ) {
    return false;
  }
  if (!isCalculationRecord(value.calculation)) return false;
  // Required, not optional: a v5 artifact whose evidence cannot name the model
  // that wrote it is not auditable.
  if (!isModelRecord(value.model)) return false;
  const validation = value.validation;
  return (
    isObject(validation) &&
    validation.status === "passed" &&
    isNonEmptyString(validation.policy_version) &&
    Array.isArray(validation.checks) &&
    validation.checks.length > 0 &&
    validation.checks.every(
      (check) => isObject(check) && isNonEmptyString(check.code) && check.passed === true,
    )
  );
}

function isInvalidation(value: unknown): boolean {
  if (value === null) return true;
  if (!isObject(value)) return false;
  return (
    (value.reason === "chart_correction" || value.reason === "calculation_defect") &&
    (value.actor_class === "user_change" || value.actor_class === "operator") &&
    isNonEmptyString(value.invalidated_at)
  );
}

export function isStoredReadingV5(value: unknown): value is StoredReadingV5 {
  if (!isObject(value)) return false;
  if (value.schema_version !== M5_SCHEMA_VERSION) return false;
  return (
    isDailyReadingV5(value.reading) &&
    isEvidenceHeaderV5(value.evidence_header) &&
    "invalidation" in value &&
    isInvalidation(value.invalidation)
  );
}

/** Whether a decrypted envelope claims to be v5 at all, before it is validated. */
export function claimsSchemaVersionV5(value: unknown): boolean {
  return isObject(value) && value.schema_version === M5_SCHEMA_VERSION;
}
