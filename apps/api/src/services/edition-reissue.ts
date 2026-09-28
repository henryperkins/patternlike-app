import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import { asCryptoSubject } from "../crypto.js";
import {
  assertExactCurrentAccountProcessingGrant,
  loadLiveAccountProcessingGrant,
} from "../db/account-processing-consents.js";
import {
  assertExactCurrentAiSynthesisGrant,
  loadAiSynthesisGrant,
} from "../db/consents.js";
import { persistCycles } from "../db/cycles.js";
import {
  JOB_TYPE,
  generationIdempotencyKey,
  reserveReissue,
} from "../db/generation.js";
import { loadPreferences } from "../db/preferences.js";
import { loadReadableReadingById } from "../db/readings.js";
import { decryptPayload, type UserIdentity } from "../db/users.js";
import { dispatch, resolveV5TargetDate } from "./enqueue.js";
import {
  buildGenerationCommand,
  type CommandBuildFailure,
  type RevisionReason,
} from "./generation-command.js";
import {
  buildGenerationCommandV2,
  isCommandV2,
  type CommandBuildFailureV2,
  type GenerateDailyReadingCommand,
} from "./generation-command-v2.js";
import { nextLocalDate, resolveLocalDay } from "./local-day.js";
import { readReadingV5Rollout, rolloutAllows } from "./reading-rollout.js";
import { isStoredReadingV5 } from "./stored-reading.js";

/**
 * Family-aware reissue of one named, published Daily edition
 * (`contracts/daily-edition-reissue-v1`).
 *
 * The legacy `enqueueReissue` always freezes a deterministic V1 command, so it
 * cannot correct a constrained-model edition without silently changing what
 * wrote it. This operation derives the family from the edition's retained
 * evidence instead and freezes the successor with that family's own builder.
 * It is a successor, not a mode: the legacy operation, factual invalidation,
 * and failed-command replacement keep their own semantics and budgets.
 */

export const EDITION_REISSUE_SCHEMA_VERSION = "daily-edition-reissue/v1" as const;

export type GenerationFamily = "deterministic" | "constrained_model";

export type EditionReissueReason = Exclude<RevisionReason, "initial">;

/** The request body. Mirrors `$defs/request`; the route validates it with the generated validator. */
export interface DailyEditionReissueRequest {
  schema_version: typeof EDITION_REISSUE_SCHEMA_VERSION;
  user_id: string;
  target: {
    reading_id: string;
    revision: number;
    local_date: string;
    generation_family: GenerationFamily;
  };
  revision_reason: EditionReissueReason;
}

/**
 * Which reasons each family may reissue for.
 *
 * A deterministic reissue re-assembles reviewed prose and reaches no model, so
 * it keeps the legacy vocabulary. A constrained-model reissue is a new model
 * call, and only a correction the operator decided on can start one: a consent
 * revocation must never authorize processing by itself, and a chart correction
 * has to withdraw the stale edition immediately through invalidation and fact
 * repair rather than leave known-wrong facts published while a successor is
 * generated. The contract schema encodes the same matrix.
 */
export const EDITION_REISSUE_REASONS: Readonly<
  Record<GenerationFamily, readonly EditionReissueReason[]>
> = {
  deterministic: ["chart_recalculated", "consent_revoked", "safety_correction", "defect_repair"],
  constrained_model: ["safety_correction", "defect_repair"],
};

export type EditionReissueFailure =
  | "account_not_active"
  | "account_processing_required"
  | "target_not_found"
  | "target_mismatch"
  | "family_mismatch"
  | "target_evidence_invalid"
  | "stale_target"
  | "reissue_conflict"
  | "reason_not_supported"
  | "day_out_of_scope"
  | "rollout_disabled"
  | CommandBuildFailure
  | CommandBuildFailureV2
  | "conflict";

/** Every code the route can answer, which is exactly `$defs/operationErrorCode`. */
export type EditionReissueErrorCode = EditionReissueFailure | "invalid_body";

export const EDITION_REISSUE_STATUS: Readonly<
  Record<EditionReissueErrorCode, 400 | 409 | 424 | 503>
> = {
  invalid_body: 400,
  account_not_active: 409,
  account_processing_required: 409,
  target_not_found: 409,
  target_mismatch: 409,
  family_mismatch: 409,
  stale_target: 409,
  reissue_conflict: 409,
  reason_not_supported: 409,
  day_out_of_scope: 409,
  timezone_confirmation_required: 409,
  locale_confirmation_required: 409,
  chart_not_found: 409,
  release_not_active: 409,
  ai_synthesis_consent_required: 409,
  skipped_local_date: 409,
  target_evidence_invalid: 424,
  release_hash_mismatch: 424,
  cycle_scan_refused: 424,
  assembly_failed: 424,
  policy_unsupported: 424,
  context_ineligible: 424,
  conflict: 424,
  rollout_disabled: 503,
  publisher_not_configured: 503,
  release_unreadable: 503,
  calc_unavailable: 503,
  daily_sky_unavailable: 503,
};

/** Fixed operator messages. A builder or D1 detail never reaches the response. */
export const EDITION_REISSUE_MESSAGES: Readonly<Record<EditionReissueErrorCode, string>> = {
  invalid_body: "The body does not match the daily-edition-reissue/v1 request contract",
  account_not_active: "The named account is not active",
  account_processing_required: "The account has no current account-processing grant",
  target_not_found: "The named edition does not exist for this account",
  target_mismatch: "The stated revision or local date differs from the stored edition",
  family_mismatch: "The stated generation family differs from the edition's retained evidence",
  target_evidence_invalid: "The edition's retained evidence does not establish its generation family",
  stale_target: "The named edition is no longer the published reading for its day",
  reissue_conflict: "The named edition already has a different successor",
  reason_not_supported: "This revision reason is not supported for the edition's generation family",
  day_out_of_scope: "The edition's local day is outside this family's reissue window",
  rollout_disabled: "Constrained-model generation is not enabled for internal reservations",
  publisher_not_configured: "The reading publisher is not configured",
  timezone_confirmation_required: "The account's scheduling time zone is not confirmed",
  locale_confirmation_required: "The account's content locale is not confirmed",
  chart_not_found: "The account has no usable active chart",
  release_not_active: "No content release is active",
  release_unreadable: "The active content release is unavailable",
  release_hash_mismatch: "The active content release failed verification",
  calc_unavailable: "The calculation service is unavailable",
  daily_sky_unavailable: "The daily-sky calculation is unavailable",
  cycle_scan_refused: "The calculation service refused the cycle scan",
  assembly_failed: "The reading command could not be assembled",
  ai_synthesis_consent_required: "The account has no current ai_synthesis grant",
  policy_unsupported: "A calculation or validation policy is not supported",
  context_ineligible: "The generation input is not eligible",
  skipped_local_date: "The edition's local date does not exist in the account's time zone",
  conflict: "The reading operation could not be committed",
};

export type SuccessorStatus = "pending" | "published" | "failed" | "superseded" | "invalidated";

export interface EditionReissueSuccessor {
  readingId: string;
  revision: number;
  revisionReason: EditionReissueReason;
  status: SuccessorStatus;
  jobId: string;
}

export type EditionReissueOutcome =
  | {
      ok: true;
      /** `reserved`: this call reserved it. `replayed`: it already existed; nothing new was frozen. */
      status: "reserved" | "replayed";
      successor: EditionReissueSuccessor;
      dispatched: boolean;
    }
  | { ok: false; reason: EditionReissueFailure; detail: string };

interface TargetRow {
  id: string;
  status: string;
  revision: number;
  local_date: string;
  assembly_mode: GenerationFamily;
  reading_key_version: number | null;
  reading_nonce: string | null;
}

interface SuccessorRow {
  id: string;
  user_id: string;
  status: SuccessorStatus;
  revision: number;
  revision_reason: string;
  local_date: string;
  assembly_mode: GenerationFamily;
  job_id: string | null;
  dispatched_at: string | null;
}

function refuse(reason: EditionReissueFailure, detail: string): EditionReissueOutcome {
  return { ok: false, reason, detail };
}

async function loadActiveIdentity(env: Env, userId: string): Promise<UserIdentity | null> {
  const row = await env.DB.prepare(
    `SELECT id, crypto_subject FROM users WHERE id = ? AND status = 'active'`,
  )
    .bind(userId)
    .first<{ id: string; crypto_subject: string }>();
  if (!row) return null;
  return { userId: row.id, cryptoSubject: asCryptoSubject(row.crypto_subject) };
}

async function loadTargetRow(
  env: Env,
  userId: string,
  readingId: string,
): Promise<TargetRow | null> {
  return env.DB.prepare(
    `SELECT id, status, revision, local_date, assembly_mode,
            reading_key_version, reading_nonce
     FROM daily_readings WHERE id = ? AND user_id = ?`,
  )
    .bind(readingId, userId)
    .first<TargetRow>();
}

/**
 * Whether the decrypted edition says what its row says.
 *
 * The clear `assembly_mode` column is where the family is read from, but it is
 * not trusted alone: the sealed envelope names its own format, identity, and
 * evidence, and a row whose artifact disagrees with it cannot tell anyone
 * which builder may speak for it. An unreadable or malformed envelope is the
 * same refusal.
 */
async function retainedEvidenceAgrees(
  env: Env,
  identity: UserIdentity,
  row: TargetRow,
): Promise<boolean> {
  let published;
  try {
    published = await loadReadableReadingById(env, identity, row.id);
  } catch {
    return false;
  }
  if (!published) return false;
  const { record, stored } = published;
  if (
    record.status !== "published" ||
    record.revision !== row.revision ||
    record.localDate !== row.local_date ||
    record.assemblyMode !== row.assembly_mode ||
    stored.reading.reading_id !== row.id ||
    stored.reading.revision !== row.revision ||
    stored.reading.local_date !== row.local_date ||
    stored.evidence_header.reading_id !== row.id ||
    stored.evidence_header.revision !== row.revision
  ) {
    return false;
  }
  if (isStoredReadingV5(stored)) {
    return (
      row.assembly_mode === "constrained_model" &&
      record.releaseVersion === null &&
      stored.invalidation === null
    );
  }
  return (
    row.assembly_mode === "deterministic" &&
    record.releaseVersion !== null &&
    stored.evidence_header.assembly_mode === "deterministic" &&
    stored.evidence_header.release_version === record.releaseVersion &&
    stored.evidence_header.local_date === row.local_date
  );
}

/**
 * The family's reissue window, resolved the way that family's builder resolves
 * days.
 *
 * The deterministic builder always freezes "today", so any other day could
 * only fail later as a stale predecessor. Constrained-model commands take an
 * explicit day, and the window is today or tomorrow because the scheduler
 * pre-generates tomorrow's edition before its local day begins; an older day
 * would rewrite an edition the reader has already moved past.
 */
function withinDateScope(
  family: GenerationFamily,
  zone: string,
  localDate: string,
  now: Date,
): boolean | null {
  if (family === "deterministic") {
    try {
      return resolveLocalDay(zone, now).targetLocalDate === localDate;
    } catch {
      return null;
    }
  }
  const today = resolveV5TargetDate(zone, now);
  if (today === null) return null;
  return localDate === today || localDate === nextLocalDate(today);
}

/**
 * The first command frozen for a successor, read from its generation-1 job.
 *
 * Not the active job: a failed successor that was later replaced carries the
 * replacement's reservation reason, and the identity of the successor is what
 * it was reserved as, not what recovered it.
 */
async function loadOriginalCommand(
  env: Env,
  identity: UserIdentity,
  family: GenerationFamily,
  localDate: string,
  revision: number,
): Promise<GenerateDailyReadingCommand | null> {
  const job = await env.DB.prepare(
    `SELECT id, payload_enc, payload_key_version, payload_nonce
     FROM jobs WHERE job_type = ? AND user_id = ? AND idempotency_key = ?`,
  )
    .bind(JOB_TYPE, identity.userId, generationIdempotencyKey(family, localDate, revision, 1))
    .first<{
      id: string;
      payload_enc: ArrayBuffer | null;
      payload_key_version: number | null;
      payload_nonce: string | null;
    }>();
  if (
    !job ||
    job.payload_enc === null ||
    job.payload_key_version === null ||
    job.payload_nonce === null
  ) {
    return null;
  }
  try {
    let binary = "";
    for (const byte of new Uint8Array(job.payload_enc)) binary += String.fromCharCode(byte);
    return await decryptPayload<GenerateDailyReadingCommand>(
      env,
      identity,
      {
        key_version: job.payload_key_version,
        nonce: job.payload_nonce,
        ciphertext: btoa(binary),
      },
      { subject: identity.cryptoSubject, field: "jobs.payload_enc", recordId: job.id },
    );
  } catch {
    return null;
  }
}

/**
 * Replay, conflict, or nothing, for the one successor this edition may have.
 *
 * `uq_daily_readings_successor` admits one successor per predecessor, ever, so
 * the edition itself is the idempotency identity. A successor that was
 * reserved as exactly this request answers as a replay whatever has happened
 * to it since; anything else occupying the slot is a conflict. A replay never
 * freezes, replaces, or re-reserves: recovering a failed successor is
 * `/internal/readings/replace`'s job and budget.
 */
async function existingSuccessor(
  env: Env,
  identity: UserIdentity,
  target: TargetRow,
  reason: EditionReissueReason,
): Promise<EditionReissueOutcome | null> {
  const row = await env.DB.prepare(
    `SELECT r.id, r.user_id, r.status, r.revision, r.revision_reason, r.local_date,
            r.assembly_mode, r.active_generation_job_id AS job_id, j.dispatched_at
     FROM daily_readings r
     LEFT JOIN jobs j
       ON j.id = r.active_generation_job_id AND j.user_id = r.user_id AND j.job_type = ?
     WHERE r.supersedes_reading_id = ?`,
  )
    .bind(JOB_TYPE, target.id)
    .first<SuccessorRow>();
  if (!row) return null;

  const conflict = refuse("reissue_conflict", "the edition already has a different successor");
  if (
    row.user_id !== identity.userId ||
    row.revision !== target.revision + 1 ||
    row.local_date !== target.local_date ||
    row.assembly_mode !== target.assembly_mode ||
    row.revision_reason !== reason ||
    row.job_id === null
  ) {
    return conflict;
  }
  const original = await loadOriginalCommand(
    env,
    identity,
    target.assembly_mode,
    target.local_date,
    row.revision,
  );
  const sameReservation =
    original !== null &&
    original.reading_id === row.id &&
    original.revision === row.revision &&
    original.revision_reason === reason &&
    original.supersedes_reading_id === target.id &&
    original.target_local_date === target.local_date &&
    original.command_generation === 1 &&
    (target.assembly_mode === "constrained_model"
      ? isCommandV2(original) && original.reservation_reason === "manual_reissue"
      : !isCommandV2(original));
  if (!sameReservation) return conflict;

  const dispatched =
    row.dispatched_at !== null ||
    (await dispatch(env, { job_id: row.job_id, reading_id: row.id }));
  return {
    ok: true,
    status: "replayed",
    successor: {
      readingId: row.id,
      revision: row.revision,
      revisionReason: reason,
      status: row.status,
      jobId: row.job_id,
    },
    dispatched,
  };
}

/** The target, still exactly the edition that was checked, inside the reservation batch. */
function assertExactPublishedEdition(
  env: Env,
  userId: string,
  target: TargetRow,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO assertion_probe (id, reason)
     SELECT 1, 'edition reissue target is no longer the exact published edition'
     WHERE NOT EXISTS (
       SELECT 1 FROM daily_readings
       WHERE id = ? AND user_id = ? AND status = 'published'
         AND revision = ? AND local_date = ? AND assembly_mode = ?
         AND reading_key_version = ? AND reading_nonce = ?
     )`,
  ).bind(
    target.id,
    userId,
    target.revision,
    target.local_date,
    target.assembly_mode,
    target.reading_key_version,
    target.reading_nonce,
  );
}

/**
 * Name what changed when the reservation batch refused.
 *
 * The batch's guards abort as one generic failure, so the cause is re-read
 * here in the order a caller can act on. Nothing is retried.
 */
async function diagnoseRefusal(
  env: Env,
  identity: UserIdentity,
  target: TargetRow,
  command: GenerateDailyReadingCommand,
  accountConsentId: string,
  now: Date,
  detail: string,
): Promise<EditionReissueOutcome> {
  if (!(await loadActiveIdentity(env, identity.userId))) {
    return refuse("account_not_active", "the account stopped being active");
  }
  const current = await loadTargetRow(env, identity.userId, target.id);
  if (
    !current ||
    current.status !== "published" ||
    current.reading_nonce !== target.reading_nonce ||
    current.reading_key_version !== target.reading_key_version
  ) {
    return refuse("stale_target", "the edition changed before the reservation committed");
  }
  const accountGrant = await loadLiveAccountProcessingGrant(env, identity.userId, now);
  if (!accountGrant || accountGrant.consentId !== accountConsentId) {
    return refuse("account_processing_required", "the account-processing grant changed");
  }
  if (isCommandV2(command)) {
    const grant = await loadAiSynthesisGrant(env, identity.userId);
    if (
      !grant ||
      grant.consentId !== command.ai_consent.consent_id ||
      grant.policyVersion !== command.ai_consent.policy_version
    ) {
      return refuse("ai_synthesis_consent_required", "the ai_synthesis grant changed");
    }
  }
  const pending = await env.DB.prepare(
    `SELECT 1 AS present FROM daily_readings
     WHERE user_id = ? AND local_date = ? AND status = 'pending' LIMIT 1`,
  )
    .bind(identity.userId, target.local_date)
    .first<{ present: number }>();
  if (pending) {
    return refuse("reissue_conflict", "another reservation is pending for the edition's day");
  }
  return refuse("conflict", detail);
}

/**
 * Reserve one successor to one named published edition, in its own family.
 *
 * Checks run cheapest and least revealing first. The kill switch is read from
 * the clear family column before any key is loaded, so an `off` rollout costs
 * a constrained-model request nothing, and the date window is checked before
 * any calculation is paid for. The command is frozen with the family's own
 * builder and reserved through the ordinary reissue batch, which keeps the
 * target published until the successor's own publication supersedes it.
 */
export async function reissuePublishedEdition(
  env: Env,
  request: DailyEditionReissueRequest,
  now = new Date(),
): Promise<EditionReissueOutcome> {
  const { target: named, revision_reason: reason } = request;

  const identity = await loadActiveIdentity(env, request.user_id);
  if (!identity) return refuse("account_not_active", "no active account");
  const accountGrant = await loadLiveAccountProcessingGrant(env, identity.userId, now);
  if (!accountGrant) {
    return refuse("account_processing_required", "no current account-processing grant");
  }

  const target = await loadTargetRow(env, identity.userId, named.reading_id);
  if (!target) return refuse("target_not_found", "no such edition for this account");
  if (target.revision !== named.revision || target.local_date !== named.local_date) {
    return refuse("target_mismatch", "revision or local date differs from the stored edition");
  }
  if (target.assembly_mode !== named.generation_family) {
    return refuse("family_mismatch", "stated family differs from the stored assembly mode");
  }
  const family = target.assembly_mode;
  if (!EDITION_REISSUE_REASONS[family].includes(reason)) {
    return refuse("reason_not_supported", `${reason} cannot reissue a ${family} edition`);
  }
  if (family === "constrained_model") {
    const rollout = readReadingV5Rollout(env);
    if (rollout === null || !rolloutAllows(rollout, "internal")) {
      return refuse("rollout_disabled", "the internal entry point is not admitted");
    }
  }

  const existing = await existingSuccessor(env, identity, target, reason);
  if (existing) return existing;

  if (target.status !== "published") {
    return refuse("stale_target", "the edition is not published");
  }
  if (!(await retainedEvidenceAgrees(env, identity, target))) {
    return refuse("target_evidence_invalid", "the stored edition does not match its row");
  }

  const preferences = await loadPreferences(env, identity.userId);
  if (!preferences || preferences.timezoneSource === "default_unconfirmed") {
    return refuse("timezone_confirmation_required", "the scheduling zone is not confirmed");
  }
  if (preferences.localeSource === "default_unconfirmed") {
    return refuse("locale_confirmation_required", "the content locale is not confirmed");
  }
  const inScope = withinDateScope(family, preferences.timezone, target.local_date, now);
  if (inScope === null) {
    return refuse("timezone_confirmation_required", "the scheduling zone does not resolve");
  }
  if (!inScope) {
    return refuse("day_out_of_scope", `${target.local_date} is outside the ${family} window`);
  }

  const readingId = newId("rdg");
  const build =
    family === "constrained_model"
      ? await buildGenerationCommandV2(env, identity, {
          readingId,
          revision: target.revision + 1,
          revisionReason: reason,
          supersedesReadingId: target.id,
          reservationReason: "manual_reissue",
          commandGeneration: 1,
          replacesJobId: null,
          commandReplacementReason: null,
          targetLocalDate: target.local_date,
          now,
        })
      : await buildGenerationCommand(env, identity.userId, {
          readingId,
          revision: target.revision + 1,
          revisionReason: reason,
          supersedesReadingId: target.id,
          commandGeneration: 1,
          replacesJobId: null,
          commandReplacementReason: null,
          now,
        });
  if (!build.ok) return refuse(build.reason, build.detail);
  const command = build.command;
  // A zone change between the window check and the builder's own read would
  // freeze a different day than the edition it claims to succeed.
  if (command.target_local_date !== target.local_date) {
    return refuse(
      "day_out_of_scope",
      `command resolved ${command.target_local_date} for an edition dated ${target.local_date}`,
    );
  }

  await persistCycles(env, identity.userId, build.chartId, build.cycles);

  const guards = [
    assertExactPublishedEdition(env, identity.userId, target),
    assertExactCurrentAccountProcessingGrant(env, identity.userId, accountGrant.consentId, now),
    ...(isCommandV2(command)
      ? [
          assertExactCurrentAiSynthesisGrant(
            env,
            identity.userId,
            command.ai_consent.consent_id,
            command.ai_consent.policy_version,
            now,
          ),
        ]
      : []),
  ];
  const reserved = await reserveReissue(env, identity, command, target.id, guards);
  if (!reserved.ok) {
    // An identical request that won the race owns the one successor slot.
    const raced = await existingSuccessor(env, identity, target, reason);
    if (raced) return raced;
    return diagnoseRefusal(
      env,
      identity,
      target,
      command,
      accountGrant.consentId,
      now,
      reserved.reason === "conflict" ? reserved.detail : reserved.reason,
    );
  }

  const dispatched = await dispatch(env, {
    job_id: reserved.jobId,
    reading_id: reserved.readingId,
  });
  return {
    ok: true,
    status: "reserved",
    successor: {
      readingId: reserved.readingId,
      revision: command.revision,
      revisionReason: reason,
      status: "pending",
      jobId: reserved.jobId,
    },
    dispatched,
  };
}
