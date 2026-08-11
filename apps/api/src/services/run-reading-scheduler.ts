import type { Env } from "../env.js";
import { asCryptoSubject } from "../crypto.js";
import {
  advanceUserNextDueAt,
  backoffIneligibleInvalidatedOrphan,
  findDueSchedulerCandidates,
  findExpiredSchedulerCandidates,
  findFailedSchedulerCandidates,
  findInvalidatedOrphanCandidates,
  findNullCursorCandidates,
  findStalePublishedCandidates,
  findUndispatchedSchedulerCandidates,
  loadSchedulerEligibility,
  recomputeUserNextDueAt,
  seedUserNextDueAt,
} from "../db/reading-scheduler.js";
import {
  isAutomaticReplacementFailure,
  isGenerationFailureCode,
  type GenerationReplacementReason,
} from "./generation-failures.js";
import {
  dispatch,
  enqueueConstrainedReading,
  replaceFailedCommand,
  resolveV5TargetDate,
} from "./enqueue.js";
import {
  invalidatePublishedReading,
  reconcileCurrentFactRepair,
  reserveFactRepair,
} from "./reading-invalidation.js";
import { resolvePublisherConfiguration } from "./reading-publisher.js";
import { selectReadingScheduleTarget } from "./reading-schedule.js";
import { DEFAULT_READING_SCHEDULE_POLICY } from "./reading-schedule.js";

export interface SchedulerSummary {
  status: "disabled" | "completed";
  usersExamined: number;
  batchLimit: number;
  repairQuotaExhausted: boolean;
  repair: {
    failedReplacements: number;
    factRepairs: number;
    ineligibleOrphansBackedOff: number;
    expiredLeaseRedispatched: number;
    undispatchedOutboxRedispatched: number;
  };
  due: {
    evaluated: number;
    reserved: number;
  };
  nullSeed: {
    evaluated: number;
    seeded: number;
  };
}

function emptySummary(status: SchedulerSummary["status"], batchLimit = 100): SchedulerSummary {
  return {
    status,
    usersExamined: 0,
    batchLimit,
    repairQuotaExhausted: false,
    repair: {
      failedReplacements: 0,
      factRepairs: 0,
      ineligibleOrphansBackedOff: 0,
      expiredLeaseRedispatched: 0,
      undispatchedOutboxRedispatched: 0,
    },
    due: { evaluated: 0, reserved: 0 },
    nullSeed: { evaluated: 0, seeded: 0 },
  };
}

/**
 * One bounded scheduler invocation.
 *
 * The `seen` set is the quota: every lane receives only the diminishing
 * remaining limit and excludes users already evaluated by an earlier lane.
 * That preserves the approved priority without adding a second budget or a
 * fairness algorithm that could let new work jump recovery.
 */
export async function runReadingScheduler(
  env: Env,
  scheduledAt: Date,
): Promise<SchedulerSummary> {
  const publisher = resolvePublisherConfiguration(env);
  if (!publisher.ok || publisher.rollout !== "hybrid" || publisher.config === null) {
    return emptySummary("disabled");
  }

  const limit = publisher.config.schedulerBatchLimit;
  const summary = emptySummary("completed", limit);
  const seen = new Set<string>();
  const remaining = () => Math.max(0, limit - seen.size);
  const claimUser = (userId: string): boolean => {
    if (seen.has(userId) || remaining() <= 0) return false;
    seen.add(userId);
    return true;
  };

  // Repair 1: terminal command replacement. The exact centralized predicate,
  // not a scheduler-local string set, decides whether a failure is eligible.
  const failed = await findFailedSchedulerCandidates(
    env,
    scheduledAt,
    remaining(),
    seen,
  );
  for (const candidate of failed) {
    const commandVersion = candidate.assemblyMode === "constrained_model" ? "v2" : "v1";
    if (
      !isGenerationFailureCode(candidate.resultClass) ||
      !isAutomaticReplacementFailure(commandVersion, candidate.resultClass)
    ) {
      continue;
    }
    if (!claimUser(candidate.userId)) continue;
    const eligibility = await loadSchedulerEligibility(
      env,
      candidate.userId,
      scheduledAt,
      publisher.config.pregenActiveDays,
      commandVersion === "v2",
    );
    if (
      !eligibility?.eligible
    ) {
      continue;
    }
    const replaced = await replaceFailedCommand(
      env,
      candidate.userId,
      candidate.readingId,
      candidate.resultClass as GenerationReplacementReason,
      "scheduler",
      scheduledAt,
    );
    if (replaced.ok) summary.repair.failedReplacements += 1;
  }

  // Repair 2a: a chart activation committed before its stale published V5 row
  // was invalidated. The owner-scoped primitive both invalidates and reserves.
  const stale = await findStalePublishedCandidates(
    env,
    scheduledAt,
    remaining(),
    seen,
  );
  for (const candidate of stale) {
    const eligibility = await loadSchedulerEligibility(
      env,
      candidate.userId,
      scheduledAt,
      publisher.config.pregenActiveDays,
    );
    if (
      !eligibility ||
      candidate.localDate !== resolveV5TargetDate(eligibility.timezone, scheduledAt)
    ) {
      continue;
    }
    if (!claimUser(candidate.userId)) continue;
    const identity = {
      userId: candidate.userId,
      cryptoSubject: await cryptoSubjectFor(env, candidate.userId),
    };
    if (!eligibility.eligible) {
      const invalidated = await invalidatePublishedReading(env, {
        identity,
        readingId: candidate.readingId,
        reason: "chart_correction",
        now: scheduledAt,
      });
      if (
        invalidated.ok &&
        await backoffIneligibleInvalidatedOrphan(
          env,
          candidate.readingId,
          candidate.userId,
          scheduledAt,
        )
      ) {
        summary.repair.ineligibleOrphansBackedOff += 1;
      }
      if (invalidated.ok) {
        await recomputeUserNextDueAt(env, candidate.userId, scheduledAt);
      }
      continue;
    }
    const repaired = await reconcileCurrentFactRepair(
      env,
      identity,
      "chart_correction",
      scheduledAt,
    );
    if (repaired.ok && repaired.status === "repair_reserved") {
      summary.repair.factRepairs += 1;
    }
  }

  // Repair 2b: invalidation committed before its r+1 reservation. Rows that
  // are still ineligible are touched, then the indexed six-hour threshold
  // keeps them from consuming every invocation.
  const orphans = await findInvalidatedOrphanCandidates(
    env,
    scheduledAt,
    remaining(),
    seen,
  );
  for (const candidate of orphans) {
    const eligibility = await loadSchedulerEligibility(
      env,
      candidate.userId,
      scheduledAt,
      publisher.config.pregenActiveDays,
    );
    if (
      !eligibility ||
      candidate.localDate !== resolveV5TargetDate(eligibility.timezone, scheduledAt)
    ) {
      continue;
    }
    if (!claimUser(candidate.userId)) continue;
    if (!eligibility?.eligible) {
      if (
        await backoffIneligibleInvalidatedOrphan(
          env,
          candidate.readingId,
          candidate.userId,
          scheduledAt,
        )
      ) {
        summary.repair.ineligibleOrphansBackedOff += 1;
      }
      await recomputeUserNextDueAt(env, candidate.userId, scheduledAt);
      continue;
    }
    const repaired = await reserveFactRepair(env, candidate.readingId, scheduledAt);
    if (repaired.ok) summary.repair.factRepairs += 1;
  }

  // Repair 3: a consumer died while holding a claim. Re-offering the opaque
  // nudge lets claimJob's lease CAS recover it; no manual sweep route is needed.
  const expired = await findExpiredSchedulerCandidates(
    env,
    scheduledAt,
    remaining(),
    seen,
  );
  for (const candidate of expired) {
    if (!claimUser(candidate.userId)) continue;
    if (
      await dispatch(env, {
        job_id: candidate.jobId,
        reading_id: candidate.readingId,
      })
    ) {
      summary.repair.expiredLeaseRedispatched += 1;
    }
  }

  // Repair 4: D1 committed before Queue send. This remains after expired
  // leases exactly as approved and shares the same distinct-user ceiling.
  const undispatched = await findUndispatchedSchedulerCandidates(
    env,
    scheduledAt,
    remaining(),
    seen,
  );
  for (const candidate of undispatched) {
    if (!claimUser(candidate.userId)) continue;
    if (
      await dispatch(env, {
        job_id: candidate.jobId,
        reading_id: candidate.readingId,
      })
    ) {
      summary.repair.undispatchedOutboxRedispatched += 1;
    }
  }

  summary.repairQuotaExhausted = remaining() === 0;

  // New due reservations may use only what repair left behind.
  const due = await findDueSchedulerCandidates(env, scheduledAt, remaining(), seen);
  for (const candidate of due) {
    if (!claimUser(candidate.userId)) continue;
    summary.due.evaluated += 1;
    const target = await selectReadingScheduleTarget(
      candidate.userId,
      candidate.timezone,
      scheduledAt,
      DEFAULT_READING_SCHEDULE_POLICY,
    );
    const eligibility = await loadSchedulerEligibility(
      env,
      candidate.userId,
      scheduledAt,
      publisher.config.pregenActiveDays,
    );
    if (eligibility?.eligible) {
      const reserved = await enqueueConstrainedReading(env, candidate.userId, {
        entry: "scheduled",
        reservationReason: "scheduled",
        targetLocalDate: target.targetLocalDate,
        now: scheduledAt,
      });
      if (reserved.ok) summary.due.reserved += 1;
    }
    await advanceUserNextDueAt(env, {
      userId: candidate.userId,
      timezone: candidate.timezone,
      evaluatedLocalDate: target.targetLocalDate,
      expectedDueAt: candidate.nextDueAt,
      scheduledAt,
    });
  }

  // NULL is only "not seeded". It never means "never eligible" and seeding
  // does not reserve prose during the same invocation.
  const unseeded = await findNullCursorCandidates(env, remaining(), seen);
  for (const candidate of unseeded) {
    if (!claimUser(candidate.userId)) continue;
    summary.nullSeed.evaluated += 1;
    if (
      await seedUserNextDueAt(
        env,
        candidate.userId,
        candidate.timezone,
        scheduledAt,
      )
    ) {
      summary.nullSeed.seeded += 1;
    }
  }

  summary.usersExamined = seen.size;
  return summary;
}

async function cryptoSubjectFor(env: Env, userId: string) {
  const row = await env.DB.prepare(
    "SELECT crypto_subject FROM users WHERE id = ? AND status = 'active'",
  )
    .bind(userId)
    .first<{ crypto_subject: string }>();
  if (!row) throw new Error("scheduler candidate lost its active account");
  return asCryptoSubject(row.crypto_subject);
}
