import { resolveLocalWallTime, type CivilDateTime } from "@patternlike/shared";

/**
 * Which local day a generation command is for, and the exact UTC interval that
 * day occupies.
 *
 * Resolved ONCE at enqueue from the trusted enqueue instant in the user's stored
 * scheduling zone, never from a client-supplied date and never from a worker's
 * later attempt time. That is what makes a retry reproducible across a midnight
 * rollover: the frozen command already names the day, so an attempt at 00:04 the
 * next morning still generates yesterday's reading rather than silently becoming
 * a different one.
 */
export interface LocalDayWindow {
  /** Civil date in the scheduling zone, YYYY-MM-DD. */
  targetLocalDate: string;
  /** Half-open: the local day is [dayStartAt, dayEndAt). */
  dayStartAt: string;
  dayEndAt: string;
}

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
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new LocalDayError(`not an ISO calendar date: ${localDate}`);
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
