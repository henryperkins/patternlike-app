import { TZDB_DATA_VERSION, hasZone, pinnedLocalDate, zoneOffsetMillisEast } from "./tzdb.js";
import {
  LOCAL_DAY_RESOLUTION_POLICY_VERSION,
  resolveLocalWallTime,
  type AnchorResolution,
  type CivilDateTime,
  type DailySkyWindow,
  type LocalDateResolution,
  type LocalDayWindow,
} from "@patternlike/shared";

export type { AnchorResolution, DailySkyWindow, LocalDateResolution, LocalDayWindow };

export class LocalDayError extends Error {
  readonly code = "local_day_unresolvable";
  constructor(message: string) {
    super(message);
    this.name = "LocalDayError";
  }
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `en-CA` because it renders `YYYY-MM-DD` natively; `formatToParts` is still
 * used to read the fields rather than trusting the joined string, since the
 * separator is a locale detail and the field values are not.
 */
function dateFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(zone, formatter);
  }
  return formatter;
}

/** The civil date `zone` was showing at `instant`. */
export function localDateIn(zone: string, instant: Date): string {
  const parts = dateFormatter(zone).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value;
  const year = field("year");
  const month = field("month");
  const day = field("day");
  if (!year || !month || !day) {
    throw new LocalDayError(`zone ${zone} did not yield a civil date`);
  }
  return `${year.padStart(4, "0")}-${month}-${day}`;
}

function parseLocalDate(localDate: string): { year: number; month: number; day: number } {
  const match = ISO_DATE_RE.exec(localDate);
  if (!match) throw new LocalDayError(`not an ISO calendar date: ${localDate}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    throw new LocalDayError(`not a real ISO calendar date: ${localDate}`);
  }
  return { year, month, day };
}

function shiftLocalDate(localDate: string, days: number): string {
  const { year, month, day } = parseLocalDate(localDate);
  // UTC arithmetic on a civil date is safe because no zone is involved: this
  // walks the proleptic Gregorian calendar, not the timeline.
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export const nextLocalDate = (localDate: string): string => shiftLocalDate(localDate, 1);
export const previousLocalDate = (localDate: string): string => shiftLocalDate(localDate, -1);

/** Whole seconds. Day boundaries never carry milliseconds, so nor should they read as if they might. */
function toSecondPrecision(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z");
}

function midnight(localDate: string): CivilDateTime {
  const { year, month, day } = parseLocalDate(localDate);
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}

/**
 * The UTC instant a local day begins.
 *
 * Local midnight is not always a real instant, and both irregular cases are
 * resolved here rather than discovered in production:
 *
 * - **nonexistent** (a zone that springs forward at 00:00, such as Havana or
 *   Santiago) — the day begins at the first instant after the gap, which is
 *   what `resolveLocalWallTime` returns and what luxon, and therefore the
 *   calculation service, agrees on.
 * - **ambiguous** (a zone whose clock falls back through midnight) — the day
 *   begins at the FIRST occurrence, making it a 25-hour day rather than one
 *   that silently starts an hour late.
 *
 * Taking the same rule for both ends is what keeps the interval contiguous:
 * one day's end is the next day's start, so no instant falls in a crack and
 * none is claimed twice.
 */
function startOfLocalDay(zone: string, localDate: string): string {
  return toSecondPrecision(resolveLocalWallTime(zone, midnight(localDate)).utc_instant);
}

export function localDayWindow(zone: string, localDate: string): LocalDayWindow {
  const dayStartAt = startOfLocalDay(zone, localDate);
  const dayEndAt = startOfLocalDay(zone, nextLocalDate(localDate));
  if (Date.parse(dayEndAt) <= Date.parse(dayStartAt)) {
    throw new LocalDayError(
      `local day ${localDate} in ${zone} is empty or inverted: ${dayStartAt} .. ${dayEndAt}`,
    );
  }
  return { targetLocalDate: localDate, dayStartAt, dayEndAt };
}

/** The window for whichever local day `zone` is in at `instant`. */
export function resolveLocalDay(zone: string, instant: Date): LocalDayWindow {
  return localDayWindow(zone, localDateIn(zone, instant));
}

/**
 * Whether `localDate` is still current enough for the scheduler to regenerate
 * unattended.
 *
 * A failure from three weeks ago is history: silently regenerating it would
 * publish a reading dated to a day the reader has already moved past. Today and
 * yesterday are the only days where re-freezing is a repair rather than a
 * rewrite of the past.
 */
export function isCurrentOrPreviousLocalDay(
  zone: string,
  localDate: string,
  now: Date,
): boolean {
  const today = localDateIn(zone, now);
  return localDate === today || localDate === previousLocalDate(today);
}

// ---------------------------------------------------------------------------
// M5 daily-sky resolution
// ---------------------------------------------------------------------------

/**
 * The tz database version that resolved every V5 day boundary and anchor.
 *
 * Pinned through `moment-timezone` in `package-lock.json` rather than read from
 * the runtime's `Intl`. A Worker deployment carries whatever tz database the
 * platform shipped that week; if that moved a reader's day boundaries, nothing
 * in the frozen command would record that anything had changed. Recording the
 * version is what turns a silent change of inputs into a visible one, and an
 * unversioned source has no version to record.
 */
export const TZDB_VERSION: string = TZDB_DATA_VERSION;

/** Widest offset any zone has ever observed, rounded up. */
const MAX_OFFSET_MS = 18 * 3_600 * 1000;

/**
 * Offset in milliseconds EAST of UTC that `zone` observed at `utcMillis`.
 *
 * `Zone.utcOffset` reports minutes WEST, and pre-1900 local mean times are not
 * whole minutes — Chicago was UTC-05:50:36 until 1883 — so the sign flip is kept
 * here and the fractional part is kept intact. Rounding before the round-trip
 * below would make a valid wall time look nonexistent.
 */
function offsetEastMillis(zone: string, utcMillis: number): number {
  if (!hasZone(zone)) throw new LocalDayError(`unknown IANA zone: ${zone}`);
  return zoneOffsetMillisEast(zone, utcMillis);
}

/** Every instant whose local wall time in `zone` is exactly `civil`, earliest first. */
function wallTimeCandidates(zone: string, civil: CivilDateTime): number[] {
  const naive = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second);
  const early = offsetEastMillis(zone, naive - MAX_OFFSET_MS);
  const late = offsetEastMillis(zone, naive + MAX_OFFSET_MS);
  const candidates: number[] = [];
  for (const offset of early === late ? [early] : [early, late]) {
    const instant = naive - offset;
    if (offsetEastMillis(zone, instant) === offset) candidates.push(instant);
  }
  return candidates.sort((a, b) => a - b);
}

/**
 * Resolve one civil wall time under the closed M5 policy.
 *
 * Two occurrences take the EARLIER; none shifts forward across the gap to its
 * first valid instant, which is the transition itself. Both choices are frozen
 * in `LOCAL_DAY_RESOLUTION_POLICY_VERSION` because either one can change which
 * facts a reading is built from.
 */
function resolveWallTime(
  zone: string,
  civil: CivilDateTime,
): { instant: number; resolution: AnchorResolution } {
  const candidates = wallTimeCandidates(zone, civil);
  if (candidates.length === 1) return { instant: candidates[0]!, resolution: "unique" };
  if (candidates.length > 1) {
    return { instant: candidates[0]!, resolution: "ambiguous_earlier" };
  }
  const naive = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second);
  const early = offsetEastMillis(zone, naive - MAX_OFFSET_MS);
  const late = offsetEastMillis(zone, naive + MAX_OFFSET_MS);
  // Clocks only ever jump forward into a gap, so the pre-transition offset is
  // the smaller of the two and lands exactly on the first instant after it.
  return { instant: naive - Math.min(early, late), resolution: "nonexistent_shift_forward" };
}

function isoSecond(instant: number): string {
  return new Date(Math.round(instant / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function noon(localDate: string): CivilDateTime {
  const { year, month, day } = parseLocalDate(localDate);
  return { year, month, day, hour: 12, minute: 0, second: 0 };
}

/**
 * A date-line change can delete an entire local date, so "the next day" is not
 * always `date + 1`. Bounded because an unbounded walk over a malformed zone
 * would spin rather than fail.
 */
const MAX_SKIPPED_DAYS = 7;

/**
 * The local day a V5 command is for, its anchor, and the exact versions that
 * resolved them.
 *
 * The anchor is local NOON, not the instant the scheduler happened to run.
 * Noon exists on ordinary DST transition days, and a reading whose factual
 * anchor moved because a cron fired late would be a reading about the
 * infrastructure.
 *
 * A whole local date can be missing — Pacific/Apia never had a 2011-12-30 — and
 * there is no defensible reading for a day that did not happen. That case is
 * reported rather than approximated, and it is detected by the one check that
 * catches it in every form: resolve nominal noon, then ask the zone which date
 * that instant actually falls on. A gap inside a real day still lands on the
 * right date; a deleted day cannot.
 */
export function resolveDailySkyWindow(zone: string, localDate: string): LocalDateResolution {
  parseLocalDate(localDate);
  if (!hasZone(zone)) throw new LocalDayError(`unknown IANA zone: ${zone}`);

  const anchor = resolveWallTime(zone, noon(localDate));
  if (pinnedLocalDate(zone, anchor.instant) !== localDate) {
    return {
      ok: false,
      reason: "skipped_local_date",
      nextRepresentableDate: nextRepresentableLocalDate(zone, localDate),
    };
  }

  const dayStartAt = isoSecond(resolveWallTime(zone, midnight(localDate)).instant);
  const dayEndAt = isoSecond(resolveWallTime(zone, midnight(nextLocalDate(localDate))).instant);
  if (Date.parse(dayEndAt) <= Date.parse(dayStartAt)) {
    throw new LocalDayError(
      `local day ${localDate} in ${zone} is empty or inverted: ${dayStartAt} .. ${dayEndAt}`,
    );
  }

  return {
    ok: true,
    window: {
      targetLocalDate: localDate,
      dayStartAt,
      dayEndAt,
      anchorAt: isoSecond(anchor.instant),
      anchorResolution: anchor.resolution,
      tzdbVersion: TZDB_VERSION,
      localDayResolutionPolicyVersion: LOCAL_DAY_RESOLUTION_POLICY_VERSION,
    },
  };
}

function nextRepresentableLocalDate(zone: string, localDate: string): string {
  let candidate = localDate;
  for (let step = 0; step < MAX_SKIPPED_DAYS; step += 1) {
    candidate = nextLocalDate(candidate);
    const anchor = resolveWallTime(zone, noon(candidate));
    if (pinnedLocalDate(zone, anchor.instant) === candidate) return candidate;
  }
  throw new LocalDayError(
    `zone ${zone} has no representable local date within ${MAX_SKIPPED_DAYS} days of ${localDate}`,
  );
}
