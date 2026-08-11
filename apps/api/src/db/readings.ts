import type {
  DailyReading,
  ParagraphEvidence,
  ReadingEvidenceDraft,
  ReadingParagraph,
} from "@patternlike/reading-engine";
import type { ParagraphEvidenceV5, ReadingEvidenceV5 } from "@patternlike/shared";
import { M5_SCHEMA_VERSION, PARAGRAPH_ROLES_V5 } from "@patternlike/shared";
import type { Env } from "../env.js";
import { b64, decryptJson, type EncryptionContext } from "../crypto.js";
import { loadUserKey, type UserIdentity } from "./users.js";
import {
  claimsSchemaVersionV5,
  isStoredReadingV5,
  type StoredReading,
  type StoredReadingV3,
} from "../services/stored-reading.js";

/**
 * The read side of the daily-reading pipeline.
 *
 * `db/generation.ts` is the write side: it reserves, claims, and publishes. This
 * module only ever reads, and it is the only place that decrypts a published
 * reading back out of `daily_readings.reading_enc` or `reading_sources.evidence_enc`.
 *
 * Two properties are load-bearing here and are easy to lose in a refactor:
 *
 * 1. Ownership is a query predicate (`WHERE ... AND user_id = ?`), never a
 *    comparison after the fetch. A foreign id and an unknown id both return
 *    null, so the caller has no branch that could answer 403 or leak existence.
 * 2. The DEK is loaded once per request, not once per row. `decryptPayload`
 *    calls `loadUserKey` internally, which is a `user_keys` read plus a root-key
 *    resolve plus an unwrap — doing that per evidence paragraph is an N+1 on the
 *    key. `claimJob` establishes the pattern used here instead.
 */

/** The plaintext columns of a `daily_readings` row. Nothing here is encrypted. */
export interface ReadingRecord {
  id: string;
  userId: string;
  localDate: string;
  /** Null for a v5 reading: there is no editorial release behind one. */
  releaseVersion: string | null;
  /**
   * `user:<id>:<date>:<release>:r<n>` for v3, `reading-v5:<id>:<date>:r<n>` for
   * v5. Disjoint by namespace under the global UNIQUE, and neither ever goes on
   * the product wire.
   */
  readingKey: string;
  chartFingerprint: string;
  contractId: string;
  assemblyMode: "deterministic" | "constrained_model";
  status: "pending" | "published" | "failed" | "superseded" | "invalidated";
  revision: number;
  revisionReason:
    | "initial"
    | "chart_recalculated"
    | "consent_revoked"
    | "safety_correction"
    | "defect_repair";
  supersedesReadingId: string | null;
  /** Set exactly when the status is `invalidated`. */
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublishedReading {
  record: ReadingRecord;
  stored: StoredReading;
}

/**
 * The provenance graph, in whichever format the row was sealed with.
 *
 * Discriminated rather than merged: a v3 graph names an editorial release and a
 * deterministic assembly id, a v5 graph names a model and two hashes, and the
 * projection each needs shares almost nothing with the other.
 */
export type ReadingEvidence = ReadingEvidenceV3Result | ReadingEvidenceV5Result;

export interface ReadingEvidenceV3Result {
  schemaVersion: "0.3.0";
  record: ReadingRecord;
  header: Omit<ReadingEvidenceDraft, "paragraphs">;
  /** Ordered by `paragraph_order`, cross-checked against the row each came from. */
  paragraphs: ParagraphEvidence[];
}

export interface ReadingEvidenceV5Result {
  schemaVersion: typeof M5_SCHEMA_VERSION;
  record: ReadingRecord;
  header: Omit<ReadingEvidenceV5, "paragraphs">;
  paragraphs: ParagraphEvidenceV5[];
}

/**
 * A stored artifact that cannot be represented on the wire.
 *
 * `reading_enc` is written once and never rewritten, so a row sealed by one
 * version of the reading engine is read back under a later one. That is a code
 * path no test in this repo can author, which is exactly why it fails closed:
 * the route does not catch this, `app.onError` turns it into a 500 with a
 * request id, and the alternative — emitting whatever decrypted — would be a
 * 200 that violates a contract nobody notices until a strict client rejects it.
 *
 * The reading id is interpolated deliberately: it is an opaque per-row label,
 * not a user id, and `onError` logs only `err.message`.
 */
export class StoredReadingInvalidError extends Error {
  readonly code = "stored_reading_invalid";
  constructor(column: string, readingId: string, detail: string) {
    super(`${column} for ${readingId} is not readable: ${detail}`);
    this.name = "StoredReadingInvalidError";
  }
}

const PARAGRAPH_ROLES = new Set([
  "primary_theme",
  "supporting_theme",
  "phase_context",
  "timing",
  "reflection",
  "uncertainty_notice",
  "context_label",
  "safety_fallback",
]);

const EVIDENCE_LANES = new Set(["celestial_facts", "user_and_context", "operational"]);

const FACT_TYPES = new Set([
  "chart_snapshot",
  "natal_position",
  "natal_aspect",
  "natal_pattern",
  "cycle_instance",
  "exact_pass",
  "lunation",
  "station_ingress",
  "uncertainty_feature",
  "other_calculated",
]);

const RANKING_FACTORS = new Set([
  "exactness",
  "body_importance",
  "target_importance",
  "rarity",
  "angularity",
  "phase",
  "technique_weight",
  "domain_match",
  "continuity",
  "repetition_penalty",
  "uncertainty_filter",
  "safety_filter",
  "other",
]);

const ASSEMBLY_ID_PATTERN = /^asm_[a-f0-9]{32}$/;

interface ReadingRow {
  id: string;
  user_id: string;
  local_date: string;
  release_version: string | null;
  reading_key: string;
  chart_fingerprint: string;
  contract_id: string;
  assembly_mode: ReadingRecord["assemblyMode"];
  status: ReadingRecord["status"];
  revision: number;
  revision_reason: ReadingRecord["revisionReason"];
  supersedes_reading_id: string | null;
  invalidated_at: string | null;
  created_at: string;
  updated_at: string;
  reading_enc: ArrayBuffer | null;
  reading_key_version: number | null;
  reading_nonce: string | null;
}

const READING_COLUMNS = `id, user_id, local_date, release_version, reading_key,
       chart_fingerprint, contract_id, assembly_mode, status, revision,
       revision_reason, supersedes_reading_id, invalidated_at, created_at, updated_at,
       reading_enc, reading_key_version, reading_nonce`;

function recordFrom(row: ReadingRow): ReadingRecord {
  return {
    id: row.id,
    userId: row.user_id,
    localDate: row.local_date,
    releaseVersion: row.release_version,
    readingKey: row.reading_key,
    chartFingerprint: row.chart_fingerprint,
    contractId: row.contract_id,
    assemblyMode: row.assembly_mode,
    status: row.status,
    revision: row.revision,
    revisionReason: row.revision_reason,
    supersedesReadingId: row.supersedes_reading_id,
    invalidatedAt: row.invalidated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Absent and explicitly null are the same answer here.
 *
 * The projection reads each field by name and `JSON.stringify` drops an
 * `undefined`, so a missing optional and a null one produce the same wire bytes
 * — and the contract accepts both.
 */
function isAbsent(value: unknown): boolean {
  return value === null || value === undefined;
}

function isNullableString(value: unknown): boolean {
  return isAbsent(value) || typeof value === "string";
}

function isNullableNumber(value: unknown): boolean {
  return isAbsent(value) || (typeof value === "number" && Number.isFinite(value));
}

function isReadingParagraph(value: unknown): value is ReadingParagraph {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.paragraph_id) &&
    typeof value.role === "string" &&
    PARAGRAPH_ROLES.has(value.role) &&
    isRevision(value.order) &&
    isNonEmptyString(value.text)
  );
}

/**
 * The three `const`s are the whole point.
 *
 * `schema_version`, `output_schema`, and `assembly_mode` are fixed values in the
 * frozen contract, so a row written by a later engine that disagrees with any of
 * them cannot be served under this schema version. Pinning the response's
 * `schema_version` from a constant is only honest if a stored reading that
 * disagrees has already been rejected.
 */
function isDailyReading(value: unknown): value is DailyReading {
  if (!isObject(value)) return false;
  if (value.schema_version !== "0.3.0") return false;
  if (value.output_schema !== "daily-reading-v3") return false;
  if (value.assembly_mode !== "deterministic") return false;
  if (!isNonEmptyString(value.reading_id)) return false;
  if (!isNonEmptyString(value.local_date)) return false;
  if (!isNonEmptyString(value.generated_at)) return false;
  if (!isNonEmptyString(value.locale)) return false;
  if (!isRevision(value.revision)) return false;
  if (typeof value.fallback_used !== "boolean") return false;
  if (
    value.domain_preference !== null &&
    value.domain_preference !== undefined &&
    typeof value.domain_preference !== "string"
  ) {
    return false;
  }
  if (!Array.isArray(value.paragraphs) || value.paragraphs.length === 0) return false;
  return value.paragraphs.every(isReadingParagraph);
}

function isStoredReadingV3(value: unknown): value is StoredReadingV3 {
  return isObject(value) && isDailyReading(value.reading);
}

/**
 * One decrypted envelope, read as whichever format sealed it.
 *
 * The v5 branch is chosen by the `schema_version` the envelope CLAIMS, not by
 * trying each guard in turn: an envelope that says it is v5 and then fails the
 * v5 shape is a defect, and falling through to the v3 guard would answer 200
 * with something the reader never saw.
 */
function decodeStoredReading(value: unknown, readingId: string): StoredReading {
  if (claimsSchemaVersionV5(value)) {
    if (!isStoredReadingV5(value)) {
      throw new StoredReadingInvalidError(
        "daily_readings.reading_enc",
        readingId,
        "decrypted reading does not match daily-reading-v5",
      );
    }
    return value;
  }
  if (!isStoredReadingV3(value)) {
    throw new StoredReadingInvalidError(
      "daily_readings.reading_enc",
      readingId,
      "decrypted reading does not match daily-reading-v3",
    );
  }
  return value;
}

function isThemeRef(value: unknown): boolean {
  if (value === null) return true;
  return (
    isObject(value) &&
    isNonEmptyString(value.cycle_id) &&
    isNonEmptyString(value.phase) &&
    Array.isArray(value.fragment_ids)
  );
}

function isEvidenceHeader(
  value: unknown,
): value is Omit<ReadingEvidenceDraft, "paragraphs"> {
  if (!isObject(value)) return false;
  if (value.schema_version !== "0.3.0") return false;
  if (!isNonEmptyString(value.reading_id)) return false;
  if (!isNonEmptyString(value.local_date)) return false;
  if (!isNonEmptyString(value.release_version)) return false;
  if (!isNonEmptyString(value.chart_fingerprint)) return false;
  if (value.assembly_mode !== "deterministic" && value.assembly_mode !== "constrained_model") {
    return false;
  }
  if (typeof value.assembly_id !== "string" || !ASSEMBLY_ID_PATTERN.test(value.assembly_id)) {
    return false;
  }
  if (!isNonEmptyString(value.assembly_policy_version)) return false;
  if (!isRevision(value.revision)) return false;
  if (!isThemeRef(value.primary_theme)) return false;
  if (!isThemeRef(value.supporting_theme)) return false;
  if (!isNonEmptyString(value.created_at)) return false;
  const validation = value.validation;
  return (
    isObject(validation) &&
    typeof validation.passed === "boolean" &&
    typeof validation.fallback_used === "boolean" &&
    Array.isArray(validation.checks) &&
    validation.checks.length > 0
  );
}

/**
 * The four reference kinds, checked to the depth the projection exposes.
 *
 * `projectEvidence` copies each of these field by field into a response the
 * frozen schema validates with `additionalProperties: false` and per-item
 * `required` lists. Asserting only that `facts` is an *array* leaves that
 * projection able to emit `facts: [{}]` — every required key dropped as
 * `undefined` — as a 200 the route calls valid. So: every required field, its
 * type, and the closed enums this module already mirrors.
 *
 * Deliberately not the numeric bounds or the string patterns. Those would make
 * this a second, silently drifting copy of the schema; the contract's own
 * fixtures are what prove those, and `readings.integration.test.ts` validates a
 * real response against the schema itself.
 */
function isFactRef(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    typeof value.fact_type === "string" &&
    FACT_TYPES.has(value.fact_type) &&
    isNullableString(value.phase) &&
    isNullableNumber(value.orb_deg) &&
    isNullableString(value.chart_fingerprint) &&
    isNullableString(value.technique) &&
    (isAbsent(value.pass_index) ||
      (typeof value.pass_index === "number" &&
        Number.isInteger(value.pass_index) &&
        value.pass_index >= 1))
  );
}

function isContentRef(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.fragment_id) &&
    isNonEmptyString(value.content_version) &&
    isNonEmptyString(value.release_version) &&
    isNullableString(value.content_type) &&
    isNullableString(value.bundle_hash)
  );
}

function isContextRef(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.signal_id) &&
    isNonEmptyString(value.source_id) &&
    isNonEmptyString(value.allowed_use) &&
    typeof value.evidence_lane === "string" &&
    EVIDENCE_LANES.has(value.evidence_lane) &&
    isNullableString(value.label)
  );
}

function isRankingFactor(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.factor === "string" &&
    RANKING_FACTORS.has(value.factor) &&
    isNonEmptyString(value.reason) &&
    isNullableNumber(value.weight)
  );
}

function isParagraphEvidence(value: unknown): value is ParagraphEvidence {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.paragraph_id) &&
    typeof value.role === "string" &&
    PARAGRAPH_ROLES.has(value.role) &&
    isRevision(value.order) &&
    typeof value.evidence_lane === "string" &&
    EVIDENCE_LANES.has(value.evidence_lane) &&
    isNullableString(value.text_hash) &&
    // The engine's own type says this column is `null`, and M3 has no route
    // that could write anything else. A row carrying one was written by an
    // engine this projection does not know how to represent.
    isAbsent(value.model_output) &&
    Array.isArray(value.facts) &&
    value.facts.every(isFactRef) &&
    Array.isArray(value.content) &&
    value.content.every(isContentRef) &&
    Array.isArray(value.context_signals) &&
    value.context_signals.every(isContextRef) &&
    (isAbsent(value.ranking_factors) ||
      (Array.isArray(value.ranking_factors) && value.ranking_factors.every(isRankingFactor)))
  );
}

const PARAGRAPH_ROLES_V5_SET: ReadonlySet<string> = new Set(PARAGRAPH_ROLES_V5);
const FACT_SCOPES = new Set(["personalized", "collective"]);
const FACT_ID_PATTERN = /^(dsf|cyc|nat)_[a-f0-9]{32}$/;
const CONTEXT_REF_PATTERN = /^ctx_[0-9]{1,3}$/;

/**
 * The v5 paragraph graph, checked to the depth its projection exposes.
 *
 * Same reasoning as the v3 guard above: `projectEvidence` copies each field into
 * a response the frozen schema validates with `additionalProperties: false`, so
 * asserting only that `fact_refs` is an array leaves the projection able to emit
 * `[{}]` as a 200 the route calls valid.
 */
function isFactRefV5(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.fact_id === "string" &&
    FACT_ID_PATTERN.test(value.fact_id) &&
    isNonEmptyString(value.fact_class) &&
    isNonEmptyString(value.label) &&
    typeof value.scope === "string" &&
    FACT_SCOPES.has(value.scope)
  );
}

function isContextRefV5(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.private_ref === "string" &&
    CONTEXT_REF_PATTERN.test(value.private_ref) &&
    isNonEmptyString(value.category) &&
    isNonEmptyString(value.allowed_use)
  );
}

function isParagraphEvidenceV5(value: unknown): value is ParagraphEvidenceV5 {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.paragraph_id) &&
    typeof value.role === "string" &&
    PARAGRAPH_ROLES_V5_SET.has(value.role) &&
    isRevision(value.order) &&
    Array.isArray(value.fact_refs) &&
    value.fact_refs.every(isFactRefV5) &&
    Array.isArray(value.context_refs) &&
    value.context_refs.every(isContextRefV5)
  );
}

async function decryptColumn<T>(
  dek: Uint8Array,
  ciphertext: ArrayBuffer,
  keyVersion: number,
  nonce: string,
  ctx: EncryptionContext,
): Promise<T> {
  return decryptJson<T>({ key_version: keyVersion, nonce, ciphertext: b64(ciphertext) }, dek, ctx);
}

/**
 * The live artifact for one plaintext `(user_id, local_date)`.
 *
 * `status = 'published'` is in the predicate rather than a filter applied after
 * the fact, because that is the exact predicate of `uq_daily_readings_live`.
 * The active-chart EXISTS is a second fail-closed predicate for constrained-
 * model readings: chart activation commits before encrypted invalidation, so a
 * process death between them must still return no V5 prose. Frozen V3 readings
 * remain readable and immutable under the compatibility policy. At most one
 * row can match, enforced by the schema, so there is no `ORDER BY ... LIMIT 1`
 * here that a later reader has to trust.
 */
export async function loadPublishedReadingForDate(
  env: Env,
  identity: UserIdentity,
  localDate: string,
): Promise<PublishedReading | null> {
  const row = await env.DB.prepare(
    `SELECT ${READING_COLUMNS}
     FROM daily_readings r
     WHERE r.user_id = ? AND r.local_date = ? AND r.status = 'published'
       AND (
         r.assembly_mode != 'constrained_model'
         OR EXISTS (
           SELECT 1 FROM chart_snapshots c
           WHERE c.user_id = r.user_id AND c.status = 'active'
             AND c.fingerprint = r.chart_fingerprint
             AND c.contract_id = r.contract_id
         )
       )`,
  )
    .bind(identity.userId, localDate)
    .first<ReadingRow>();

  if (!row) return null;
  if (row.reading_enc === null || row.reading_key_version === null || row.reading_nonce === null) {
    throw new StoredReadingInvalidError(
      "daily_readings.reading_enc",
      row.id,
      "published row carries no ciphertext",
    );
  }

  const { dek } = await loadUserKey(env, identity);
  const stored = await decryptColumn<unknown>(
    dek,
    row.reading_enc,
    row.reading_key_version,
    row.reading_nonce,
    {
      subject: identity.cryptoSubject,
      field: "daily_readings.reading_enc",
      recordId: row.id,
    },
  );

  return { record: recordFrom(row), stored: decodeStoredReading(stored, row.id) };
}

/**
 * The discriminator between the route's two 404s, and nothing more.
 *
 * Deliberately only consulted when no authoritative reading was found. The
 * published loader itself checks the active chart pin, so the crash window
 * between chart activation and invalidation is indistinguishable from an
 * invalidated miss on the product wire.
 */
export async function hasActiveChart(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS present FROM chart_snapshots
     WHERE user_id = ? AND status = 'active' LIMIT 1`,
  )
    .bind(userId)
    .first<{ present: number }>();
  return row !== null;
}

interface EvidenceSourceRow {
  id: string;
  paragraph_id: string;
  paragraph_order: number;
  evidence_enc: ArrayBuffer;
  evidence_key_version: number;
  evidence_nonce: string;
}

/**
 * The provenance graph for one reading the caller owns.
 *
 * A `superseded` reading still answers. A client holding a `reading_id` from
 * Today can have it superseded mid-session by a `safety_correction` reissue, and
 * 404ing the drawer for the reading on screen is a race rather than user error —
 * the graph's `revision`/`revision_reason`/`supersedes_reading_id` are precisely
 * how the client learns to refresh. The predicate is therefore "has an
 * artifact", not a status allowlist: that excludes `pending` and `failed`, which
 * have no ciphertext, without enumerating the ones that do.
 */
export async function loadReadingEvidence(
  env: Env,
  identity: UserIdentity,
  readingId: string,
): Promise<ReadingEvidence | null> {
  const row = await env.DB.prepare(
    `SELECT ${READING_COLUMNS}
     FROM daily_readings
     WHERE id = ? AND user_id = ?`,
  )
    .bind(readingId, identity.userId)
    .first<ReadingRow>();

  if (!row) return null;
  if (row.reading_enc === null || row.reading_key_version === null || row.reading_nonce === null) {
    return null;
  }

  const { dek } = await loadUserKey(env, identity);
  const stored = await decryptColumn<unknown>(
    dek,
    row.reading_enc,
    row.reading_key_version,
    row.reading_nonce,
    {
      subject: identity.cryptoSubject,
      field: "daily_readings.reading_enc",
      recordId: row.id,
    },
  );

  const decoded = decodeStoredReading(stored, row.id);
  const isV5 = isStoredReadingV5(decoded);
  if (!isV5 && !isEvidenceHeader(decoded.evidence_header)) {
    throw new StoredReadingInvalidError(
      "daily_readings.reading_enc",
      row.id,
      "decrypted evidence header does not match the evidence graph",
    );
  }
  const header = decoded.evidence_header;

  // The ciphertext is AAD-bound to the reading id, so it cannot be lifted from
  // another row. The plaintext columns are not — a disagreement between the two
  // is corruption, and a graph whose identity fields contradict each other is
  // worse than no graph.
  if (header.reading_id !== row.id || header.revision !== row.revision) {
    throw new StoredReadingInvalidError(
      "daily_readings.reading_enc",
      row.id,
      "sealed header disagrees with the row it was read from",
    );
  }

  const sources = await env.DB.prepare(
    `SELECT id, paragraph_id, paragraph_order, evidence_enc,
            evidence_key_version, evidence_nonce
     FROM reading_sources
     WHERE reading_id = ? AND user_id = ?
     ORDER BY paragraph_order`,
  )
    .bind(row.id, identity.userId)
    .all<EvidenceSourceRow>();

  const sourceRows = sources.results ?? [];
  if (sourceRows.length === 0) {
    // `completeReading` closes its batch by asserting the row count, so a
    // published reading with no sources cannot commit. Answering 404 here would
    // hide a broken invariant behind a state the client treats as normal.
    throw new StoredReadingInvalidError(
      "reading_sources.evidence_enc",
      row.id,
      "reading has an artifact but no evidence rows",
    );
  }

  const decrypted: unknown[] = [];
  for (const source of sourceRows) {
    const paragraph = await decryptColumn<unknown>(
      dek,
      source.evidence_enc,
      source.evidence_key_version,
      source.evidence_nonce,
      {
        subject: identity.cryptoSubject,
        field: "reading_sources.evidence_enc",
        // The AAD binds the reading_sources row id, not the reading id.
        recordId: source.id,
      },
    );

    const valid = isV5 ? isParagraphEvidenceV5(paragraph) : isParagraphEvidence(paragraph);
    if (!valid) {
      throw new StoredReadingInvalidError(
        "reading_sources.evidence_enc",
        row.id,
        "decrypted paragraph evidence is not readable",
      );
    }

    // `evidence_enc`'s AAD binds only its own row id, so re-pointing a row's
    // `reading_id` would splice one of this user's other readings into this
    // graph and it would decrypt cleanly. This is what catches that.
    const sealed = paragraph as { paragraph_id: string; order: number };
    if (
      sealed.paragraph_id !== source.paragraph_id ||
      sealed.order !== source.paragraph_order
    ) {
      throw new StoredReadingInvalidError(
        "reading_sources.evidence_enc",
        row.id,
        "sealed paragraph disagrees with the row it was read from",
      );
    }

    decrypted.push(paragraph);
  }

  // The graph must cover the reading it claims to explain.
  //
  // Both publishers write the reading and its evidence rows from one call site,
  // so a published reading has exactly one `reading_sources` row per paragraph,
  // in the same order — and `completeReading` refuses to commit a batch where
  // the count disagrees. Nothing keeps that true *afterwards*: a row deleted by
  // a retention sweep or by hand leaves a graph that still decrypts, still
  // passes every per-row check above, and answers 200 while silently omitting
  // the paragraph a reader opened the drawer to ask about. Comparing against the
  // sealed reading is what turns that into the 500 an operator can see.
  const expected = [...decoded.reading.paragraphs]
    .sort((a, b) => a.order - b.order)
    .map((paragraph) => paragraph.paragraph_id);
  const actual = decrypted.map((paragraph) => (paragraph as { paragraph_id: string }).paragraph_id);
  if (
    expected.length !== actual.length ||
    expected.some((paragraphId, index) => paragraphId !== actual[index])
  ) {
    throw new StoredReadingInvalidError(
      "reading_sources.evidence_enc",
      row.id,
      "evidence rows do not cover the reading's paragraphs",
    );
  }

  const record = recordFrom(row);
  if (isV5) {
    return {
      schemaVersion: M5_SCHEMA_VERSION,
      record,
      header: decoded.evidence_header,
      paragraphs: decrypted as ParagraphEvidenceV5[],
    };
  }
  return {
    schemaVersion: "0.3.0",
    record,
    header: (decoded as StoredReadingV3).evidence_header,
    paragraphs: decrypted as ParagraphEvidence[],
  };
}
