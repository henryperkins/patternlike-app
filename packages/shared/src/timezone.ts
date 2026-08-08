/**
 * Timezone primitives shared by the API, the web client, and the calculation
 * service.
 *
 * These read the IANA tz database that every modern JavaScript runtime already
 * carries through `Intl` (Workers, Node, browsers) rather than bundling a
 * second copy. That keeps a zone resolved in the Worker in agreement with the
 * offsets luxon computes in the calculation service, which remains the
 * authority: `tzdb_version` on a chart snapshot is the calculation service's
 * release, not this runtime's.
 *
 * Nothing here decides *which* zone a place is in — that needs a spatial
 * dataset and lives in the API (`services/timezone.ts`). This module answers
 * the second half: given a zone and a civil date and time, what offset was
 * actually in force, and is that local wall time even unambiguous?
 */

/**
 * tzdb's own guarantee: two locations share a zone id when their clocks have
 * agreed since 1970-01-01. Before that date a zone id derived from a modern
 * boundary can disagree with what the clock on the wall actually read, so a
 * pre-1970 birth is qualified rather than silently trusted.
 */
export const TZDB_STABLE_FROM_YEAR = 1970;

/**
 * `Intl.DateTimeFormat` also accepts offset strings such as "+05:00", which are
 * not zones and carry no history. Requiring a leading letter rejects those
 * while still allowing "UTC", "Etc/GMT+5", and "America/Argentina/Ushuaia".
 */
const IANA_ZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Widest offset any zone has ever observed, rounded up. */
const MAX_OFFSET_SECONDS = 18 * 3600;

export interface CivilDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * How a civil wall time maps onto the timeline in a given zone.
 *
 * - `unique` — the ordinary case: exactly one instant.
 * - `ambiguous` — the clock ran through this wall time twice (DST fall-back).
 * - `nonexistent` — the clock skipped it (DST spring-forward, or a zone that
 *   jumped the date line). No instant has this local time.
 */
export type LocalTimeResolution = "unique" | "ambiguous" | "nonexistent";

export interface ResolvedLocalTime {
  /** ISO-8601 UTC instant the wall time resolves to. */
  utc_instant: string;
  utc_offset_minutes: number;
  /** Human-facing rendering of the offset, e.g. "UTC-07:00". */
  utc_offset_label: string;
  resolution: LocalTimeResolution;
  /**
   * The second instant, when the wall time occurs twice. `utc_instant` is the
   * first (pre-transition) occurrence, matching luxon, so the calculation
   * service and this preview agree on which one a chart is built from.
   */
  alternate_utc_instant: string | null;
  alternate_utc_offset_minutes: number | null;
}

export function isValidIanaZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !IANA_ZONE_RE.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      era: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/**
 * `Date.UTC` folds years 0-99 into the 1900s. Charts start at 1800 so this is
 * defensive, but a silently shifted century is exactly the kind of error that
 * survives review.
 */
function utcMillisFromCivil(civil: CivilDateTime): number {
  const ms = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  );
  if (civil.year >= 0 && civil.year <= 99) {
    const shifted = new Date(ms);
    shifted.setUTCFullYear(civil.year);
    return shifted.getTime();
  }
  return ms;
}

/**
 * Offset in seconds east of UTC that `zone` observed at `utcMillis`.
 *
 * Seconds rather than minutes because pre-1900 local mean times are not whole
 * minutes — Los Angeles was UTC-07:52:58 until 1883 — and rounding before the
 * round trip below would make a valid wall time look nonexistent.
 */
function zoneOffsetSecondsAt(zone: string, utcMillis: number): number {
  const parts = zoneFormatter(zone).formatToParts(new Date(utcMillis));
  const field: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") field[part.type] = part.value;
  }

  let year = Number(field.year);
  // "BC"/"B" depending on ICU version; astronomical year numbering has no zero.
  if (field.era && /^b/i.test(field.era)) year = 1 - year;
  let hour = Number(field.hour);
  // h23 should never produce 24, but some ICU builds have.
  if (hour === 24) hour = 0;

  const asIfUtc = utcMillisFromCivil({
    year,
    month: Number(field.month),
    day: Number(field.day),
    hour,
    minute: Number(field.minute),
    second: Number(field.second),
  });

  // formatToParts truncates to whole seconds, so compare against a truncated
  // instant rather than letting sub-second input show up as offset drift.
  const truncated = Math.floor(utcMillis / 1000) * 1000;
  return Math.round((asIfUtc - truncated) / 1000);
}

/** Offset in minutes east of UTC that `zone` observed at `utcMillis`. */
export function zoneOffsetMinutesAt(zone: string, utcMillis: number): number {
  return Math.round(zoneOffsetSecondsAt(zone, utcMillis) / 60);
}

export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

function describe(zone: string, utcMillis: number): {
  utc_instant: string;
  utc_offset_minutes: number;
  utc_offset_label: string;
} {
  const minutes = zoneOffsetMinutesAt(zone, utcMillis);
  return {
    utc_instant: new Date(utcMillis).toISOString(),
    utc_offset_minutes: minutes,
    utc_offset_label: formatUtcOffset(minutes),
  };
}

/**
 * Map a civil wall time in `zone` onto the timeline.
 *
 * Probes the offset well before and well after the naive instant, then keeps
 * whichever candidates round-trip. Two survivors mean the wall time happened
 * twice; none means it never happened, and the result shifts forward across the
 * gap the way luxon's `DateTime.fromObject` does — the calculation service is
 * built on luxon, so a preview that resolved a gap differently would show the
 * user an instant their chart was not computed from.
 *
 * Caller must have validated `zone`; an unknown zone throws from `Intl`.
 */
export function resolveLocalWallTime(
  zone: string,
  civil: CivilDateTime,
): ResolvedLocalTime {
  const naive = utcMillisFromCivil(civil);
  const early = zoneOffsetSecondsAt(zone, naive - MAX_OFFSET_SECONDS * 1000);
  const late = zoneOffsetSecondsAt(zone, naive + MAX_OFFSET_SECONDS * 1000);

  const candidates: number[] = [];
  for (const offset of early === late ? [early] : [early, late]) {
    const instant = naive - offset * 1000;
    if (zoneOffsetSecondsAt(zone, instant) === offset) candidates.push(instant);
  }
  candidates.sort((a, b) => a - b);

  if (candidates.length === 0) {
    // A gap. Clocks only ever jump forward into one, so the pre-transition
    // offset is the smaller of the two and produces luxon's shifted instant.
    return {
      ...describe(zone, naive - Math.min(early, late) * 1000),
      resolution: "nonexistent",
      alternate_utc_instant: null,
      alternate_utc_offset_minutes: null,
    };
  }

  if (candidates.length > 1) {
    const second = describe(zone, candidates[1]!);
    return {
      ...describe(zone, candidates[0]!),
      resolution: "ambiguous",
      alternate_utc_instant: second.utc_instant,
      alternate_utc_offset_minutes: second.utc_offset_minutes,
    };
  }

  return {
    ...describe(zone, candidates[0]!),
    resolution: "unique",
    alternate_utc_instant: null,
    alternate_utc_offset_minutes: null,
  };
}

/**
 * Parse the wire format the birth profile uses. Returns null rather than
 * throwing so callers can fold a bad date into their own validation envelope.
 * A missing time is read as local noon, mirroring the calculation service's
 * epoch for an unknown birth time.
 */
export function parseCivilDateTime(
  date: string,
  time?: string | null,
): CivilDateTime | null {
  const dateMatch = ISO_DATE_RE.exec(date ?? "");
  if (!dateMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Reject dates the calendar does not have (2023-02-30) before they become a
  // silently rolled-over instant.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (year >= 0 && year <= 99) probe.setUTCFullYear(year);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  let hour = 12;
  let minute = 0;
  let second = 0;
  if (time) {
    const timeMatch = LOCAL_TIME_RE.exec(time);
    if (!timeMatch) return null;
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    second = timeMatch[3] === undefined ? 0 : Number(timeMatch[3]);
    if (hour > 23 || minute > 59 || second > 59) return null;
  }

  return { year, month, day, hour, minute, second };
}
