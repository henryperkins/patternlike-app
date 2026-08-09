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
} from "./enqueue.js";
import { localDateIn } from "./local-day.js";
import type { CommandBuildFailure } from "./generation-command.js";

export type EnsureTodayFailureReason =
  | CommandBuildFailure
  | "unauthorized"
  | "reading_generation_failed"
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
    return state.readingStatus === "pending"
      ? preparing(localDate)
      : {
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
