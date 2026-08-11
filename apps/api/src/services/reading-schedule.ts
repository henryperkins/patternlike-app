import { sha256Hex } from "@patternlike/shared";

import {
  nextLocalDate,
  resolveDailySkyWindow,
  type DailySkyWindow,
} from "./local-day.js";
import { pinnedLocalDate } from "./tzdb.js";

export interface ReadingSchedulePolicy {
  leadMinutes: 30;
  spreadMinutes: 45;
}

export const DEFAULT_READING_SCHEDULE_POLICY: ReadingSchedulePolicy = Object.freeze({
  leadMinutes: 30,
  spreadMinutes: 45,
});

export type ScheduleResolution =
  | {
      ok: true;
      window: DailySkyWindow;
      dueAt: string;
      bucket: 0 | 1 | 2 | 3;
    }
  | {
      ok: false;
      reason: "skipped_local_date";
      nextRepresentableDate: string;
    };

export interface ReadingCursor {
  targetLocalDate: string;
  dueAt: string;
  bucket: 0 | 1 | 2 | 3;
  window: DailySkyWindow;
  skippedLocalDates: string[];
}

export interface ReadingScheduleTarget extends ReadingCursor {
  nextCursor: ReadingCursor;
}

/**
 * The stable two-field preimage for the scheduler bucket.
 *
 * User ids cannot contain `:` and local dates have a fixed grammar, so the
 * delimiter makes the pair unambiguous without introducing a second policy
 * object. The complete SHA-256 value is reduced modulo four; reading only its
 * final byte is mathematically equivalent and avoids a BigInt conversion.
 */
async function scheduleBucket(
  userId: string,
  targetLocalDate: string,
): Promise<0 | 1 | 2 | 3> {
  const digest = await sha256Hex(`${userId}:${targetLocalDate}`);
  return (Number.parseInt(digest.slice(-2), 16) % 4) as 0 | 1 | 2 | 3;
}

export async function readingDueAt(
  userId: string,
  targetLocalDate: string,
  zone: string,
  policy: ReadingSchedulePolicy,
): Promise<ScheduleResolution> {
  const resolution = resolveDailySkyWindow(zone, targetLocalDate);
  if (!resolution.ok) return resolution;

  const bucket = await scheduleBucket(userId, targetLocalDate);
  const bucketMinutes = policy.spreadMinutes / 3;
  const elapsedMinutes = policy.leadMinutes + bucketMinutes * bucket;
  const dueAt = new Date(
    Date.parse(resolution.window.dayStartAt) - elapsedMinutes * 60_000,
  ).toISOString();
  return { ok: true, window: resolution.window, dueAt, bucket };
}

/** The first representable daily cursor strictly after an evaluated local day. */
export async function nextReadingCursor(
  userId: string,
  evaluatedLocalDate: string,
  zone: string,
  policy: ReadingSchedulePolicy,
): Promise<ReadingCursor> {
  const skippedLocalDates: string[] = [];
  let candidate = nextLocalDate(evaluatedLocalDate);
  for (let attempts = 0; attempts < 8; attempts += 1) {
    const schedule = await readingDueAt(userId, candidate, zone, policy);
    if (schedule.ok) {
      return {
        targetLocalDate: candidate,
        dueAt: schedule.dueAt,
        bucket: schedule.bucket,
        window: schedule.window,
        skippedLocalDates,
      };
    }
    skippedLocalDates.push(candidate);
    candidate = schedule.nextRepresentableDate;
  }
  throw new Error("reading schedule could not find a representable date");
}

/**
 * Choose only the reader's current day or the next pre-generation target.
 *
 * A stale stored cursor is intentionally not an input: it is only the index
 * signal that made the user due. Reconstructing a target from it would backfill
 * historical prose after a cron gap. The trusted invocation time and pinned
 * zone decide which of the two live targets is relevant now.
 */
export async function selectReadingScheduleTarget(
  userId: string,
  zone: string,
  scheduledAt: Date,
  policy: ReadingSchedulePolicy,
): Promise<ReadingScheduleTarget> {
  const currentLocalDate = pinnedLocalDate(zone, scheduledAt.getTime());
  const current = await readingDueAt(userId, currentLocalDate, zone, policy);
  if (!current.ok) {
    throw new Error("an invocation instant resolved to an unrepresentable local date");
  }

  const next = await nextReadingCursor(
    userId,
    currentLocalDate,
    zone,
    policy,
  );
  const selected = Date.parse(next.dueAt) <= scheduledAt.getTime()
    ? next
    : {
        targetLocalDate: currentLocalDate,
        dueAt: current.dueAt,
        bucket: current.bucket,
        window: current.window,
        skippedLocalDates: [] as string[],
      };
  const nextCursor = await nextReadingCursor(
    userId,
    selected.targetLocalDate,
    zone,
    policy,
  );
  return { ...selected, nextCursor };
}
