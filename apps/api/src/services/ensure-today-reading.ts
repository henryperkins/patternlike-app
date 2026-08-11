import type { Env } from "../env.js";
import type { UserIdentity } from "../db/users.js";
import { loadPreferences } from "../db/preferences.js";
import { loadAiSynthesisGrant } from "../db/consents.js";
import {
  hasActiveChart,
  loadPublishedReadingForDate,
  type PublishedReading,
} from "../db/readings.js";
import { loadCurrentGenerationState } from "../db/generation.js";
import {
  dispatch,
  enqueueConstrainedReading,
  enqueueDailyReading,
  replaceFailedCommand,
  resolveV5TargetDate,
} from "./enqueue.js";
import { localDateIn } from "./local-day.js";
import type { CommandBuildFailure } from "./generation-command.js";
import type { CommandBuildFailureV2 } from "./generation-command-v2.js";
import {
  isAutomaticReplacementFailure,
  isGenerationFailureCode,
  type GenerationReplacementReason,
} from "./generation-failures.js";
import { reconcileCurrentFactRepair } from "./reading-invalidation.js";
import {
  readReadingV5Rollout,
  rolloutAllows,
  type RolloutEntry,
} from "./reading-rollout.js";

export type EnsureTodayFailureReason =
  | CommandBuildFailure
  | CommandBuildFailureV2
  | "unauthorized"
  | "reading_generation_failed"
  | "rollout_disabled"
  | "publisher_budget_exhausted"
  | "internal_error";

export type EnsureTodayOutcome =
  | { ok: true; status: "ready"; published: PublishedReading }
  | {
      ok: true;
      status: "preparing";
      localDate: string;
      schemaVersion?: "0.3.0" | "0.5.0";
    }
  | { ok: false; reason: EnsureTodayFailureReason; detail: string };

export interface EnsureTodayOptions {
  now?: Date;
  dispatchJob?: typeof dispatch;
  /** Product routes select V5 explicitly; omitted preserves the M3 service API. */
  generationMode?: "legacy" | "v5";
  /** The trusted caller surface used by the staged V5 rollout. */
  rolloutEntry?: RolloutEntry;
}

const preparing = (
  localDate: string,
  schemaVersion?: "0.3.0" | "0.5.0",
): EnsureTodayOutcome => ({
  ok: true,
  status: "preparing",
  localDate,
  ...(schemaVersion ? { schemaVersion } : {}),
});

async function reconcileReservation(
  env: Env,
  identity: UserIdentity,
  localDate: string,
  exposeSchemaVersion: boolean,
): Promise<EnsureTodayOutcome> {
  const published = await loadPublishedReadingForDate(env, identity, localDate);
  if (published) return { ok: true, status: "ready", published };

  const state = await loadCurrentGenerationState(env, identity.userId, localDate);
  if (state?.readingStatus === "pending") {
    return preparing(
      localDate,
      exposeSchemaVersion
        ? state.assemblyMode === "constrained_model"
          ? "0.5.0"
          : "0.3.0"
        : undefined,
    );
  }

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
  const generationMode = options.generationMode ?? "legacy";
  const rolloutEntry = options.rolloutEntry ?? "internal";
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

  const rollout = readReadingV5Rollout(env);
  const v5Enabled = rollout !== null && rolloutAllows(rollout, rolloutEntry);
  const state = await loadCurrentGenerationState(env, identity.userId, localDate);
  if (state) {
    // Historical deterministic reservations remain immutable, but the product
    // route no longer advances or replaces V1 commands. Only a published V3
    // artifact is readable through this surface.
    if (generationMode === "v5" && state.assemblyMode !== "constrained_model") {
      return {
        ok: false,
        reason: "reading_generation_failed",
        detail: "the historical deterministic reservation is terminal on this path",
      };
    }
    if (state.readingStatus === "pending") {
      if (state.assemblyMode === "constrained_model" && !v5Enabled) {
        return {
          ok: false,
          reason: "rollout_disabled",
          detail: `constrained-model generation is not enabled for ${rolloutEntry}`,
        };
      }
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
        return preparing(
          localDate,
          generationMode === "v5"
            ? state.assemblyMode === "constrained_model"
              ? "0.5.0"
              : "0.3.0"
            : undefined,
        );
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
        return preparing(
          localDate,
          generationMode === "v5"
            ? state.assemblyMode === "constrained_model"
              ? "0.5.0"
              : "0.3.0"
            : undefined,
        );
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
    if (failedJob.resultClass === "publisher_budget_exhausted") {
      return {
        ok: false,
        reason: "publisher_budget_exhausted",
        detail: "the UTC provider call budget is exhausted",
      };
    }
    if (state.assemblyMode === "constrained_model" && !v5Enabled) {
      return {
        ok: false,
        reason: "rollout_disabled",
        detail: `constrained-model generation is not enabled for ${rolloutEntry}`,
      };
    }
    if (
      state.assemblyMode === "constrained_model" &&
      failedJob.resultClass === "ai_synthesis_consent_required"
    ) {
      if (!(await loadAiSynthesisGrant(env, identity.userId))) {
        return {
          ok: false,
          reason: "ai_synthesis_consent_required",
          detail: "AI synthesis consent is not active",
        };
      }
      const replaced = await replaceFailedCommand(
        env,
        identity.userId,
        state.readingId,
        "consent_regranted",
        "first_open",
        now,
      );
      if (replaced.ok) {
        return reconcileReservation(env, identity, localDate, generationMode === "v5");
      }
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
    if (
      failedJob.resultClass &&
      isGenerationFailureCode(failedJob.resultClass) &&
      isAutomaticReplacementFailure(
        state.assemblyMode === "constrained_model" ? "v2" : "v1",
        failedJob.resultClass,
      )
    ) {
      const replaced = await replaceFailedCommand(
        env,
        identity.userId,
        state.readingId,
        failedJob.resultClass as GenerationReplacementReason,
        "scheduler",
        now,
      );
      if (replaced.ok) {
        return reconcileReservation(env, identity, localDate, generationMode === "v5");
      }
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

  if (generationMode === "legacy") {
    const enqueued = await enqueueDailyReading(env, identity.userId, now);
    if (enqueued.ok || enqueued.reason === "duplicate") {
      return reconcileReservation(env, identity, localDate, false);
    }
    if (enqueued.reason === "conflict" || enqueued.reason === "stale_predecessor") {
      return { ok: false, reason: "reading_generation_failed", detail: enqueued.detail };
    }
    return { ok: false, reason: enqueued.reason, detail: enqueued.detail };
  }

  if (!v5Enabled) {
    return {
      ok: false,
      reason: "rollout_disabled",
      detail: `constrained-model generation is not enabled for ${rolloutEntry}`,
    };
  }

  const repaired = await reconcileCurrentFactRepair(
    env,
    identity,
    "chart_correction",
    now,
  );
  if (!repaired.ok) {
    return { ok: false, reason: repaired.reason as EnsureTodayFailureReason, detail: repaired.detail };
  }
  if (repaired.status === "repair_reserved") {
    return reconcileReservation(env, identity, localDate, true);
  }

  const targetLocalDate = resolveV5TargetDate(preferences.timezone, now);
  if (!targetLocalDate) {
    return {
      ok: false,
      reason: "timezone_confirmation_required",
      detail: "the scheduling time zone cannot resolve a local date",
    };
  }
  const enqueued = await enqueueConstrainedReading(env, identity.userId, {
    entry: rolloutEntry,
    reservationReason: "first_open",
    targetLocalDate,
    now,
  });
  if (enqueued.ok || enqueued.reason === "duplicate") {
    return reconcileReservation(env, identity, localDate, true);
  }
  if (enqueued.reason === "conflict" || enqueued.reason === "stale_predecessor") {
    return { ok: false, reason: "reading_generation_failed", detail: enqueued.detail };
  }
  return { ok: false, reason: enqueued.reason, detail: enqueued.detail };
}
