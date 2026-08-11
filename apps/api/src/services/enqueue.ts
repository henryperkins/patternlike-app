import { newId } from "@patternlike/shared";
import type { Env, GenerationMessage } from "../env.js";
import { asCryptoSubject } from "../crypto.js";
import type { UserIdentity } from "../db/users.js";
import { persistCycles } from "../db/cycles.js";
import {
  markDispatched,
  replaceCommand,
  reserveInitial,
  reserveReissue,
  type ReserveOutcome,
} from "../db/generation.js";
import {
  buildGenerationCommand,
  type CommandBuildFailure,
  type RevisionReason,
} from "./generation-command.js";
import { isCurrentOrPreviousLocalDay } from "./local-day.js";
import { pinnedLocalDate } from "./tzdb.js";
import { loadPreferences } from "../db/preferences.js";
import { readReadingV5Rollout, rolloutAllows, type RolloutEntry } from "./reading-rollout.js";
import {
  buildGenerationCommandV2,
  type CommandBuildFailureV2,
  type ReservationReason,
  type RevisionReasonV2,
} from "./generation-command-v2.js";
import {
  MAX_COMMAND_GENERATION,
  type CommandReplacementReason,
  isAutomaticReplacementFailure,
  isGenerationFailureCode,
  isV1ReplacementReason,
  isV5ReplacementReason,
  type GenerationReplacementReason,
  type V5ReplacementReason,
} from "./generation-failures.js";

export type { GenerationMessage } from "../env.js";

export type EnqueueOutcome =
  | { ok: true; readingId: string; jobId: string; dispatched: boolean }
  | {
      ok: false;
      reason:
        | CommandBuildFailure
        | CommandBuildFailureV2
        | "duplicate"
        | "stale_predecessor"
        | "conflict"
        | "rollout_disabled";
      detail: string;
    };

async function loadIdentity(env: Env, userId: string): Promise<UserIdentity | null> {
  const row = await env.DB.prepare(
    `SELECT id, crypto_subject FROM users WHERE id = ? AND status = 'active'`,
  )
    .bind(userId)
    .first<{ id: string; crypto_subject: string }>();
  if (!row) return null;
  return { userId: row.id, cryptoSubject: asCryptoSubject(row.crypto_subject) };
}

/**
 * Hand the reserved job to the queue.
 *
 * D1 and queue delivery cannot share a transaction, so the job row IS the
 * outbox: only after the reservation batch commits does anything get sent.
 * `dispatched_at` is advisory — a crash before the send is recovered by the
 * undispatched sweeper and a crash after it may send twice. Both converge
 * through the claim CAS, and nothing here treats a successful send as proof that
 * generation completed.
 */
export async function dispatch(
  env: Env,
  message: GenerationMessage,
): Promise<boolean> {
  try {
    await env.READING_QUEUE.send(message);
  } catch (err) {
    console.error("generation_dispatch_failed", {
      job_id: message.job_id,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  await markDispatched(env, message.job_id);
  return true;
}

function reserveFailure(outcome: ReserveOutcome & { ok: false }): EnqueueOutcome {
  if (outcome.reason === "duplicate") {
    return {
      ok: false,
      reason: "duplicate",
      detail: `a reading is already reserved for this user-day (${outcome.readingId ?? "unknown"})`,
    };
  }
  if (outcome.reason === "stale_predecessor") {
    return {
      ok: false,
      reason: "stale_predecessor",
      detail: "the expected live reading is no longer the live row",
    };
  }
  return { ok: false, reason: "conflict", detail: outcome.detail };
}

/**
 * Reserve today's reading for one user and hand it to the queue.
 *
 * Cycles are persisted BEFORE the reservation on purpose. A crash between the
 * two leaves content-addressed cycle rows that the next attempt reuses; the
 * reverse order would leave a reservation whose pinned cycles were never stored,
 * and the executor would fail it closed for a reason that is really this
 * function's fault.
 */
export async function enqueueDailyReading(
  env: Env,
  userId: string,
  now = new Date(),
): Promise<EnqueueOutcome> {
  const identity = await loadIdentity(env, userId);
  if (!identity) {
    return { ok: false, reason: "chart_not_found", detail: "no active user" };
  }

  const readingId = newId("rdg");
  const build = await buildGenerationCommand(env, userId, {
    readingId,
    revision: 1,
    revisionReason: "initial",
    supersedesReadingId: null,
    commandGeneration: 1,
    replacesJobId: null,
    commandReplacementReason: null,
    now,
  });
  if (!build.ok) return { ok: false, reason: build.reason, detail: build.detail };

  await persistCycles(env, userId, build.chartId, build.cycles);

  const reserved = await reserveInitial(env, identity, build.command);
  if (!reserved.ok) return reserveFailure(reserved);

  const dispatched = await dispatch(env, {
    job_id: reserved.jobId,
    reading_id: reserved.readingId,
  });
  return { ok: true, readingId: reserved.readingId, jobId: reserved.jobId, dispatched };
}

/**
 * Reserve a successor to a specific published reading.
 *
 * `expectedLiveReadingId` is required rather than resolved: a reissue that
 * looked up "whatever is live now" would supersede a row the caller never saw.
 */
export async function enqueueReissue(
  env: Env,
  userId: string,
  expectedLiveReadingId: string,
  revisionReason: Exclude<RevisionReason, "initial">,
  now = new Date(),
): Promise<EnqueueOutcome> {
  const identity = await loadIdentity(env, userId);
  if (!identity) {
    return { ok: false, reason: "chart_not_found", detail: "no active user" };
  }

  const predecessor = await env.DB.prepare(
    `SELECT id, revision, status FROM daily_readings WHERE id = ? AND user_id = ?`,
  )
    .bind(expectedLiveReadingId, userId)
    .first<{ id: string; revision: number; status: string }>();
  if (!predecessor || predecessor.status !== "published") {
    return {
      ok: false,
      reason: "stale_predecessor",
      detail: "the expected live reading is not published",
    };
  }

  const readingId = newId("rdg");
  const build = await buildGenerationCommand(env, userId, {
    readingId,
    revision: predecessor.revision + 1,
    revisionReason,
    supersedesReadingId: expectedLiveReadingId,
    commandGeneration: 1,
    replacesJobId: null,
    commandReplacementReason: null,
    now,
  });
  if (!build.ok) return { ok: false, reason: build.reason, detail: build.detail };

  await persistCycles(env, userId, build.chartId, build.cycles);

  const reserved = await reserveReissue(env, identity, build.command, expectedLiveReadingId);
  if (!reserved.ok) return reserveFailure(reserved);

  const dispatched = await dispatch(env, {
    job_id: reserved.jobId,
    reading_id: reserved.readingId,
  });
  return { ok: true, readingId: reserved.readingId, jobId: reserved.jobId, dispatched };
}

export type ReplaceEnqueueOutcome =
  | { ok: true; readingId: string; jobId: string; dispatched: boolean }
  | {
      ok: false;
      reason:
        | CommandBuildFailure
        | CommandBuildFailureV2
        | "not_replaceable"
        | "budget_exhausted"
        | "stale_job"
        | "day_too_old"
        | "conflict";
      detail: string;
    };

/**
 * Re-freeze a terminally failed day against working dependencies.
 *
 * Scoped three ways, and each bound is deliberate. Only infrastructural reasons
 * may be applied by `actor: "scheduler"` — deciding that a reading should be
 * re-frozen with less context, under a new policy vintage, or because someone
 * diagnosed a defect are all judgements about a specific person or a specific
 * editorial decision, so they stay operator-only. The budget is
 * `command_generation < MAX_COMMAND_GENERATION`, giving at most two automatic
 * attempts with the launch policy, because each
 * replacement re-freezes a NEW command and a wider budget turns a persistent
 * outage into per-user amplification against the thing that is already failing.
 * And the day must still be current: silently regenerating a failure from three
 * weeks ago would publish a reading dated to a day the reader has moved past.
 */
export async function replaceFailedCommand(
  env: Env,
  userId: string,
  readingId: string,
  reason: GenerationReplacementReason,
  actor: "scheduler" | "operator",
  now = new Date(),
): Promise<ReplaceEnqueueOutcome> {
  const identity = await loadIdentity(env, userId);
  if (!identity) {
    return { ok: false, reason: "chart_not_found", detail: "no active user" };
  }
  const reservation = await env.DB.prepare(
    `SELECT id, local_date, status, revision, revision_reason, supersedes_reading_id,
            command_generation, active_generation_job_id, assembly_mode
     FROM daily_readings WHERE id = ? AND user_id = ?`,
  )
    .bind(readingId, userId)
    .first<{
      id: string;
      local_date: string;
      status: string;
      revision: number;
      revision_reason: RevisionReason;
      supersedes_reading_id: string | null;
      command_generation: number;
      active_generation_job_id: string | null;
      assembly_mode: "deterministic" | "constrained_model";
    }>();
  if (!reservation || reservation.status !== "failed" || !reservation.active_generation_job_id) {
    return {
      ok: false,
      reason: "stale_job",
      detail: "reservation is not a failed reading with an active terminal job",
    };
  }

  const commandVersion = reservation.assembly_mode === "constrained_model" ? "v2" : "v1";
  if (
    (commandVersion === "v1" && !isV1ReplacementReason(reason)) ||
    (commandVersion === "v2" && !isV5ReplacementReason(reason)) ||
    (actor === "scheduler" &&
      (!isGenerationFailureCode(reason) || !isAutomaticReplacementFailure(commandVersion, reason)))
  ) {
    return {
      ok: false,
      reason: "not_replaceable",
      detail: `${reason} is an operator decision, not an automatic repair`,
    };
  }

  const nextGeneration = reservation.command_generation + 1;
  if (nextGeneration > MAX_COMMAND_GENERATION) {
    return {
      ok: false,
      reason: "budget_exhausted",
      detail: "the automatic replacement budget for this day is spent",
    };
  }

  if (actor === "scheduler") {
    const preferences = await loadPreferences(env, userId);
    if (
      !preferences ||
      !isCurrentOrPreviousLocalDay(preferences.timezone, reservation.local_date, now)
    ) {
      return {
        ok: false,
        reason: "day_too_old",
        detail: `${reservation.local_date} is no longer the current or preceding local day`,
      };
    }
  }

  const build =
    commandVersion === "v1"
      ? await buildGenerationCommand(env, userId, {
          readingId,
          revision: reservation.revision,
          revisionReason: reservation.revision_reason,
          supersedesReadingId: reservation.supersedes_reading_id,
          commandGeneration: nextGeneration,
          replacesJobId: reservation.active_generation_job_id,
          commandReplacementReason: reason as CommandReplacementReason,
          now,
        })
      : await buildGenerationCommandV2(env, identity, {
          readingId,
          revision: reservation.revision,
          revisionReason: reservation.revision_reason as RevisionReasonV2,
          supersedesReadingId: reservation.supersedes_reading_id,
          reservationReason: actor === "scheduler" ? "automatic_replacement" : "manual_reissue",
          commandGeneration: nextGeneration,
          replacesJobId: reservation.active_generation_job_id,
          commandReplacementReason: reason as V5ReplacementReason,
          targetLocalDate: reservation.local_date,
          now,
        });
  if (!build.ok) return { ok: false, reason: build.reason, detail: build.detail };

  // The replacement must land on the same local day the reservation reserved.
  // A midnight rollover between the failure and the repair would otherwise
  // rewrite which day this reading is for.
  const command = build.command;
  if (command.target_local_date !== reservation.local_date) {
    return {
      ok: false,
      reason: "day_too_old",
      detail: `command resolved ${command.target_local_date} but the reservation is for ${reservation.local_date}`,
    };
  }

  await persistCycles(env, userId, build.chartId, build.cycles);

  const replaced = await replaceCommand(
    env,
    identity,
    command,
    reservation.active_generation_job_id,
    reason,
  );
  if (!replaced.ok) {
    return { ok: false, reason: replaced.reason, detail: replaced.detail };
  }

  const dispatched = await dispatch(env, { job_id: replaced.jobId, reading_id: readingId });
  return { ok: true, readingId, jobId: replaced.jobId, dispatched };
}


// ---------------------------------------------------------------------------
// Constrained-model reservations
// ---------------------------------------------------------------------------

export interface EnqueueV5Options {
  /** Which surface is asking. Checked against the rollout before anything else. */
  entry: RolloutEntry;
  reservationReason: ReservationReason;
  /**
   * The local day to reserve, resolved by the SERVER.
   *
   * Explicit because the scheduler reserves tomorrow's edition before its local
   * day begins. The public first-open path passes what `resolveV5TargetDate`
   * returns, which is today in the reader's confirmed zone — never a client
   * value.
   */
  targetLocalDate: string;
  revision?: number;
  revisionReason?: RevisionReasonV2;
  supersedesReadingId?: string | null;
  now?: Date;
}

/**
 * Today, in the reader's confirmed scheduling zone, under the pinned tz
 * database.
 *
 * `Intl` carries whatever database the platform shipped; a Worker deployment
 * that silently updated it would move a reader's day boundary without changing
 * any value the command records. Returns null when the account has no usable
 * zone, which the caller reports as the ordinary confirmation gate.
 */
export function resolveV5TargetDate(zone: string, now: Date): string | null {
  try {
    return pinnedLocalDate(zone, now.getTime());
  } catch {
    return null;
  }
}

/**
 * Reserve a constrained-model reading for one user and local day.
 *
 * The rollout gate runs FIRST, before the command is built and therefore before
 * any calculation call, any context decryption, and any consent read. `off` must
 * cost nothing at all — not a scan, not a DEK load — or the kill switch is only
 * a switch for the provider rather than for the feature.
 */
export async function enqueueConstrainedReading(
  env: Env,
  userId: string,
  options: EnqueueV5Options,
): Promise<EnqueueOutcome> {
  const rollout = readReadingV5Rollout(env);
  if (rollout === null || !rolloutAllows(rollout, options.entry)) {
    return {
      ok: false,
      reason: "rollout_disabled",
      detail: `constrained-model generation is not enabled for the ${options.entry} entry point`,
    };
  }

  const identity = await loadIdentity(env, userId);
  if (!identity) {
    return { ok: false, reason: "chart_not_found", detail: "no active user" };
  }

  const now = options.now ?? new Date();
  const revision = options.revision ?? 1;
  const build = await buildGenerationCommandV2(env, identity, {
    readingId: newId("rdg"),
    revision,
    revisionReason: options.revisionReason ?? "initial",
    supersedesReadingId: options.supersedesReadingId ?? null,
    reservationReason: options.reservationReason,
    commandGeneration: 1,
    replacesJobId: null,
    commandReplacementReason: null,
    targetLocalDate: options.targetLocalDate,
    now,
  });
  if (!build.ok) return { ok: false, reason: build.reason, detail: build.detail };

  // Cycles are persisted BEFORE the reservation, for the same reason the V1 path
  // does it: a crash between the two leaves content-addressed rows the next
  // attempt reuses, while the reverse order would leave a reservation whose
  // pinned cycles were never stored.
  await persistCycles(env, userId, build.chartId, build.cycles);

  const reserved = build.command.supersedes_reading_id
    ? await reserveReissue(
        env,
        identity,
        build.command,
        build.command.supersedes_reading_id,
      )
    : await reserveInitial(env, identity, build.command);
  if (!reserved.ok) return reserveFailure(reserved);

  const dispatched = await dispatch(env, {
    job_id: reserved.jobId,
    reading_id: reserved.readingId,
  });
  return { ok: true, readingId: reserved.readingId, jobId: reserved.jobId, dispatched };
}
