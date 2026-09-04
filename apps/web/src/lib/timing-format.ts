import type {
  TimingAspect,
  TimingBody,
  TimingDurationFilter,
  TimingPhase,
  TimingPhaseFilter,
} from "./api-client.js";

export const PHASE_OPTIONS = [
  { value: "", label: "All phases" },
  { value: "emerging", label: "Emerging" },
  { value: "building", label: "Building" },
  { value: "peak", label: "Peak" },
  { value: "reconsidering", label: "Reconsidering" },
  { value: "integrating", label: "Integrating" },
  { value: "upcoming", label: "Upcoming" },
] as const satisfies ReadonlyArray<{
  value: "" | TimingPhaseFilter;
  label: string;
}>;

export const DURATION_OPTIONS = [
  { value: "", label: "All durations" },
  { value: "short", label: "Under 3 months" },
  { value: "medium", label: "3–12 months" },
  { value: "long", label: "1 year or longer" },
] as const satisfies ReadonlyArray<{
  value: "" | TimingDurationFilter;
  label: string;
}>;

const BODY_LABELS: Record<TimingBody, string> = {
  sun: "Sun",
  moon: "Moon",
  mercury: "Mercury",
  venus: "Venus",
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
  uranus: "Uranus",
  neptune: "Neptune",
  pluto: "Pluto",
  true_node: "True Node",
  ascendant: "Ascendant",
  midheaven: "Midheaven",
};

const ASPECT_LABELS: Record<TimingAspect, string> = {
  conjunction: "conjunction",
  sextile: "sextile",
  square: "square",
  trine: "trine",
  opposition: "opposition",
};

const PHASE_LABELS: Record<TimingPhase, string> = {
  emerging: "Emerging",
  building: "Building",
  peak: "Peak",
  reconsidering: "Reconsidering",
  integrating: "Integrating",
};

const DIRECTION_LABELS: Record<"direct" | "retrograde", string> = {
  direct: "Direct",
  retrograde: "Retrograde",
};

/**
 * The words the Timing screen uses, defined once, mechanically.
 *
 * Each entry describes what the calculation does, not what a cycle means for
 * the reader: the phase text follows `computePhase` in the reading engine
 * (approach split in two, a window around any exact pass, the interval between
 * first and last pass, and the separation after the last), and the rest names
 * a date's role. Interpretation stays where the product puts it — in a reading
 * written under consent — and never in this file.
 */
export const TIMING_GLOSSARY: ReadonlyArray<{ term: string; definition: string }> = [
  {
    term: "In range",
    definition:
      "The dates between which the angle is within its allowed margin, called the orb. A cycle is active while it is in range.",
  },
  {
    term: "Exact pass",
    definition:
      "A moment when the angle is exact. A planet that turns retrograde can reach the same angle two or three times, so a cycle may have several passes.",
  },
  {
    term: "Direct, retrograde",
    definition:
      "The planet's apparent motion at that pass: forward, or briefly backward as seen from Earth.",
  },
  {
    term: "Phase",
    definition:
      "Where today falls in the cycle. Emerging and building are the approach to the first exact pass, early and late. Peak is the day or so around an exact pass. Reconsidering is between the first and last pass. Integrating is after the last pass, while still in range.",
  },
  {
    term: "Upcoming",
    definition: "Already calculated, and not yet in range.",
  },
];

function slugWords(value: string): string {
  return value.replace(/[_.-]+/g, " ").trim().toLowerCase();
}

function sentenceCase(value: string): string {
  const words = slugWords(value);
  if (!words) return value;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function bodyLabel(value: string): string {
  return BODY_LABELS[value as TimingBody] ?? sentenceCase(value);
}

function aspectLabel(value: string): string {
  const fallback = slugWords(value);
  return ASPECT_LABELS[value as TimingAspect] ?? (fallback || value);
}

export function timingCycleTitle(
  body: string,
  aspect: string,
  target: string,
): string {
  return `${bodyLabel(body)} ${aspectLabel(aspect)} your ${bodyLabel(target)}`;
}

export function timingPhaseLabel(
  phase: TimingPhase | null,
  status: "active" | "upcoming",
): string {
  if (status === "upcoming") return "Upcoming";
  return phase ? PHASE_LABELS[phase] : "Active";
}

export function timingDirectionLabel(
  direction: "direct" | "retrograde",
): string {
  return DIRECTION_LABELS[direction];
}

export function formatTimingInstant(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(instant);
}

/**
 * A calendar day in the reader's zone, with the year only when it is not the
 * year of `relativeTo` (the response's `as_of` instant).
 *
 * A six-month cycle is read as a run of days, not a set of minutes, and the
 * repeated year is the noise a phone screen can least afford. The exact instant
 * still travels in the `<time dateTime>` attribute for anyone who needs it.
 */
export function formatTimingDate(value: string, relativeTo?: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) return value;
  const reference = relativeTo === undefined ? new Date() : new Date(relativeTo);
  const sameYear =
    !Number.isNaN(reference.valueOf()) &&
    reference.getFullYear() === instant.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(instant);
}

export function formatTimingTime(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
    instant,
  );
}

/**
 * A bare `YYYY-MM-DD` local date, formatted as the day it names.
 *
 * The scan receipt records the reader's *local* day, which is authoritative in
 * a way the receipt instant rendered in the browser's zone is not. Built in UTC
 * so the string alone decides the day.
 */
export function formatTimingLocalDate(
  isoDate: string,
  relativeTo?: string,
): string {
  const parts = isoDate.split("-").map(Number);
  const [year, month, day] = parts;
  if (
    parts.length !== 3 ||
    year === undefined ||
    month === undefined ||
    day === undefined ||
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return isoDate;
  }
  const reference = relativeTo === undefined ? new Date() : new Date(relativeTo);
  const sameYear =
    !Number.isNaN(reference.valueOf()) && reference.getFullYear() === year;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatTimingDuration(days: number): string {
  return `${days.toFixed(1)} days`;
}

/**
 * How long a cycle stays in range, at the resolution a reader plans in.
 *
 * "About 6 months" is what a run of 191.6 days is for; the one-decimal figure
 * remains in the calculation details. Rounding down precision is the honest
 * direction here — the envelope edges are orb crossings, not appointments.
 */
export function formatTimingLength(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "";
  if (days < 1.5) return "about a day";
  if (days < 14) return `about ${Math.round(days)} days`;
  if (days < 56) return `about ${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30.4375);
  if (months < 12) return `about ${months} months`;
  const years = Math.round((days / 365.25) * 2) / 2;
  return years === 1 ? "about a year" : `about ${years} years`;
}

export function formatTimingOrb(degrees: number): string {
  return `${degrees.toFixed(1)}°`;
}

/**
 * The position of the first pass that has not happened yet, or -1 once every
 * pass is behind `asOf`. The same inclusive comparison the route uses to sort
 * active cycles, so "next" here is the "next" the list is ordered by.
 */
export function nextPassIndex(
  passes: ReadonlyArray<{ exact_at: string }>,
  asOf: string,
): number {
  const at = Date.parse(asOf);
  if (Number.isNaN(at)) return -1;
  return passes.findIndex((pass) => Date.parse(pass.exact_at) >= at);
}
