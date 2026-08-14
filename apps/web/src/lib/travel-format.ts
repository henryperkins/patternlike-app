import type {
  LifeEvent,
  LifeEventCategory,
  LifeEventPrecision,
  LifeEventSignificance,
  ProjectedTimeTravelCycle,
} from "@patternlike/shared";
import { formatLocalDate } from "./reading-format.js";

/**
 * The reader's calendar date, not the UTC one.
 *
 * The route interprets the date in the confirmed scheduling zone, which this
 * client does not know. The browser's own calendar day is the closest honest
 * default for "today"; the response echoes the zone it actually used, and the
 * screen shows that rather than implying this guess was authoritative.
 */
export function todayIsoDate(now = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Step a bare `YYYY-MM-DD` by whole days.
 *
 * Built through `Date.UTC` so the arithmetic depends only on the string. Doing
 * it with a local-zone `Date` lands on the same calendar day twice across a
 * daylight-saving fall-back, which would make the "previous day" button appear
 * to do nothing once a year.
 */
export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return isoDate;
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  if (Number.isNaN(shifted.valueOf())) return isoDate;
  return shifted.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

const PHASE_LABELS: Record<
  NonNullable<ProjectedTimeTravelCycle["phase"]>,
  string
> = {
  emerging: "Emerging",
  building: "Building",
  peak: "Peak",
  reconsidering: "Reconsidering",
  integrating: "Integrating",
};

/**
 * Phase is nullable by contract: a cycle can be inside its envelope at a
 * reference instant the phase policy does not classify. "Unclassified" says so
 * rather than borrowing a neighbouring phase's word.
 */
export function travelPhaseLabel(phase: ProjectedTimeTravelCycle["phase"]): string {
  return phase ? PHASE_LABELS[phase] : "Unclassified";
}

export const LIFE_EVENT_PRECISIONS: ReadonlyArray<{
  value: LifeEventPrecision;
  label: string;
  hint: string;
}> = [
  { value: "day", label: "A single day", hint: "One date." },
  { value: "month", label: "A month", hint: "The whole month of the date you give." },
  { value: "year", label: "A year", hint: "The whole year of the date you give." },
  { value: "range", label: "A range of dates", hint: "A start and an end date." },
];

export const LIFE_EVENT_CATEGORIES: ReadonlyArray<{
  value: LifeEventCategory;
  label: string;
}> = [
  { value: "education", label: "Education" },
  { value: "work", label: "Work" },
  { value: "home", label: "Home" },
  { value: "travel", label: "Travel" },
  { value: "relationship", label: "Relationship" },
  { value: "family", label: "Family" },
  { value: "creative", label: "Creative" },
  { value: "community", label: "Community" },
  { value: "health_context", label: "Health context" },
  { value: "other", label: "Other" },
];

export const LIFE_EVENT_SIGNIFICANCE: ReadonlyArray<{
  value: LifeEventSignificance;
  label: string;
}> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function lifeEventCategoryLabel(category: string): string {
  return LIFE_EVENT_CATEGORIES.find((item) => item.value === category)?.label ?? category;
}

export function lifeEventSignificanceLabel(significance: string): string {
  return (
    LIFE_EVENT_SIGNIFICANCE.find((item) => item.value === significance)?.label ??
    significance
  );
}

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * The window the reader described, in their own precision.
 *
 * A `month` event is stored as the first and last day of that month, but saying
 * "1 June to 30 June" back to someone who wrote "June" invents a precision they
 * declined to claim.
 */
export function lifeEventWindowLabel(event: LifeEvent): string {
  const [year, month, day] = event.start_date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return event.start_date;
  }
  switch (event.precision) {
    case "year":
      return String(year);
    case "month":
      return MONTH_FORMAT.format(new Date(Date.UTC(year, month - 1, 1)));
    case "range":
      return event.end_date
        ? `${formatLocalDate(event.start_date)} to ${formatLocalDate(event.end_date)}`
        : formatLocalDate(event.start_date);
    case "day":
    default:
      return formatLocalDate(event.start_date);
  }
}

/**
 * The last calendar day the declared precision actually covers.
 *
 * A `month` or `year` event is stored as its whole window, so "this month"
 * describes a window that has not finished. USR-09 records completed events, so
 * the server refuses that — and the client should say why before spending the
 * request rather than relaying `invalid_life_event`.
 */
export function lifeEventWindowEnd(
  startDate: string,
  precision: LifeEventPrecision,
  endDate: string,
): string | null {
  if (!isIsoDate(startDate)) return null;
  const [year, month] = startDate.split("-").map(Number);
  if (year === undefined || month === undefined) return null;
  switch (precision) {
    case "day":
      return startDate;
    case "month":
      return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    case "year":
      return `${startDate.slice(0, 4)}-12-31`;
    case "range":
      return isIsoDate(endDate) ? endDate : null;
    default:
      return null;
  }
}

export function recordingRelationLabel(
  relation: "recorded_then" | "added_later",
): string {
  return relation === "recorded_then" ? "Recorded at the time" : "Added later";
}
