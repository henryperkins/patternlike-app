import type { Env } from "../env.js";
import type { UserIdentity } from "../db/users.js";
import { loadPreferences } from "../db/preferences.js";
import {
  hasActiveChart,
  loadPublishedReadingForDate,
  type PublishedReading,
} from "../db/readings.js";
import { loadInitialGenerationState } from "../db/generation.js";
import {
  dispatch,
  enqueueDailyReading,
  replaceFailedCommand,
} from "./enqueue.js";
import { localDateIn } from "./local-day.js";
import type { CommandBuildFailure } from "./generation-command.js";
import type { CommandBuildFailureV2 } from "./generation-command-v2.js";

export type EnsureTodayFailureReason =
  | CommandBuildFailure
  | CommandBuildFailureV2
  | "unauthorized"
  | "reading_generation_failed"
  | "rollout_disabled"
  | "internal_error";

export type EnsureTodayOutcome =
  | { ok: true; status: "ready"; published: PublishedReading }
  | { ok: true; status: "preparing"; localDate: string }
  | { ok: false; reason: EnsureTodayFailureReason; detail: string };

export interface EnsureTodayOptions {
  now?: Date;
  dispatchJob?: typeof dispatch;
}

const preparing = (localDate: string): EnsureTodayOutcome => ({
  ok: true,
  status: "preparing",
  localDate,
});

async function reconcileReservation(
  env: Env,
  identity: UserIdentity,
  localDate: string,
): Promise<EnsureTodayOutcome> {
  const published = await loadPublishedReadingForDate(env, identity, localDate);
  if (published) return { ok: true, status: "ready", published };

  const state = await loadInitialGenerationState(env, identity.userId, localDate);
  if (state?.readingStatus === "pending") return preparing(localDate);

  return {
    ok: false,
    reason: "reading_generation_failed",
    detail: "the current-day reservation could not be reconciled after enqueue",
  };
}

/**
 * Ensure the authenticated user's current local-day reading exists.
 *
 * This service owns desired-state convergence, not publication: immutable
 * commands still execute only in the Queue consumer. Every lookup is scoped to
 * the supplied identity and the local date resolved from confirmed preferences.
 */
export async function ensureTodayReading(
  env: Env,
  identity: UserIdentity,
  options: EnsureTodayOptions = {},
): Promise<EnsureTodayOutcome> {
  const now = options.now ?? new Date();
  const dispatchJob = options.dispatchJob ?? dispatch;
  const preferences = await loadPreferences(env, identity.userId);
  if (!preferences) {
    return { ok: false, reason: "unauthorized", detail: "no active user preferences" };
  }
  if (preferences.timezoneSource === "default_unconfirmed") {
    return {
      ok: false,
      reason: "timezone_confirmation_required",
      detail: "the scheduling time zone is not confirmed",
    };
  }
  if (preferences.localeSource === "default_unconfirmed") {
    return {
      ok: false,
      reason: "locale_confirmation_required",
      detail: "the content locale is not confirmed",
    };
  }

  let localDate: string;
  try {
    localDate = localDateIn(preferences.timezone, now);
  } catch (error) {
    return {
      ok: false,
      reason: "internal_error",
      detail: error instanceof Error ? error.name : "local day resolution failed",
    };
  }

  const published = await loadPublishedReadingForDate(env, identity, localDate);
  if (published) return { ok: true, status: "ready", published };

  if (!(await hasActiveChart(env, identity.userId))) {
    return { ok: false, reason: "chart_not_found", detail: "no active chart for user" };
  }

  const state = await loadInitialGenerationState(env, identity.userId, localDate);
  if (state) {
    if (state.readingStatus === "pending") {
      const activeJob = state.activeJob;
      if (!activeJob) {
        return {
          ok: false,
          reason: "reading_generation_failed",
          detail: "the pending reservation has no active generation job",
        };
      }

      const nowIso = now.toISOString();
      if (activeJob.status === "queued") {
        const due = activeJob.availableAt === null || activeJob.availableAt <= nowIso;
        if (activeJob.dispatchedAt === null && due) {
          await dispatchJob(env, {
            job_id: activeJob.id,
            reading_id: state.readingId,
          });
        }
        return preparing(localDate);
      }

      if (activeJob.status === "running") {
        if (activeJob.leaseExpiresAt === null) {
          return {
            ok: false,
            reason: "reading_generation_failed",
            detail: "the running generation job has no claim lease",
          };
        }
        if (activeJob.leaseExpiresAt < nowIso) {
          await dispatchJob(env, {
            job_id: activeJob.id,
            reading_id: state.readingId,
          });
        }
        return preparing(localDate);
      }

      return {
        ok: false,
        reason: "reading_generation_failed",
        detail: `the pending reservation points at a ${activeJob.status} job`,
      };
    }

    const failedJob = state.activeJob;
    if (!failedJob || (failedJob.status !== "failed" && failedJob.status !== "cancelled")) {
      return {
        ok: false,
        reason: "reading_generation_failed",
        detail: "the failed reservation does not point at a terminal generation job",
      };
    }
    if (
      failedJob.resultClass === "calc_unavailable" ||
      failedJob.resultClass === "release_unreadable"
    ) {
      const replaced = await replaceFailedCommand(
        env,
        identity.userId,
        state.readingId,
        failedJob.resultClass,
        "scheduler",
        now,
      );
      if (replaced.ok) return reconcileReservation(env, identity, localDate);
      if (
        replaced.reason === "not_replaceable" ||
        replaced.reason === "budget_exhausted" ||
        replaced.reason === "stale_job" ||
        replaced.reason === "day_too_old" ||
        replaced.reason === "conflict"
      ) {
        return { ok: false, reason: "reading_generation_failed", detail: replaced.detail };
      }
      return { ok: false, reason: replaced.reason, detail: replaced.detail };
    }
    return {
      ok: false,
      reason: "reading_generation_failed",
      detail: "the current-day reservation is terminal",
    };
  }

  const enqueued = await enqueueDailyReading(env, identity.userId, now);
  if (enqueued.ok || enqueued.reason === "duplicate") {
    return reconcileReservation(env, identity, localDate);
  }
  if (enqueued.reason === "conflict" || enqueued.reason === "stale_predecessor") {
    return { ok: false, reason: "reading_generation_failed", detail: enqueued.detail };
  }
  return { ok: false, reason: enqueued.reason, detail: enqueued.detail };
}
