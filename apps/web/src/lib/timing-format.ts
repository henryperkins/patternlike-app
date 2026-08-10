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

export function formatTimingDuration(days: number): string {
  return `${days.toFixed(1)} days`;
}

export function formatTimingOrb(degrees: number): string {
  return `${degrees.toFixed(1)}°`;
}
