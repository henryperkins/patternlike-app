import type { ParagraphRole } from "./api-client.js";

/**
 * Presentation for a machine-assigned paragraph role.
 *
 * A `Record` over the union rather than a lookup with a default, so a role added
 * to the contract is a compile error here instead of a paragraph that renders
 * with no label. Same reasoning as `BODY_NAMES` in ChartView.
 *
 * `kicker` is rendered as a `<p className="kicker">`, never a heading: it labels
 * a machine role, not a document section, and eight engine-chosen headings would
 * flood a screen reader's heading list on a page whose real structure is one
 * article with one title.
 */
export interface RolePresentation {
  kicker: string | null;
  tone: "lede" | "body" | "aside" | "notice";
}

export const ROLE_PRESENTATION: Record<ParagraphRole, RolePresentation> = {
  primary_theme: { kicker: null, tone: "lede" },
  supporting_theme: { kicker: "Supporting influence", tone: "body" },
  phase_context: { kicker: "Where this is in its cycle", tone: "body" },
  timing: { kicker: "Timing", tone: "body" },
  reflection: { kicker: "A question to sit with", tone: "aside" },
  uncertainty_notice: { kicker: "What this reading cannot say", tone: "notice" },
  context_label: { kicker: "Context, not astrology", tone: "notice" },
  safety_fallback: { kicker: "Reviewed standing guidance", tone: "lede" },
};

/**
 * Render a bare `YYYY-MM-DD` as the day it names, in any browser zone.
 *
 * `new Date("2026-08-09")` parses as UTC midnight, and `Intl` then renders that
 * instant in the *browser's* zone — a day early for every reader west of UTC.
 * Constructing from `Date.UTC` and formatting with `timeZone: "UTC"` is the pair
 * that makes the output depend only on the string. The reading's date is already
 * resolved in the reader's scheduling zone server-side; this must not re-zone it.
 */
export function formatLocalDate(isoDate: string): string {
  const parts = isoDate.split("-").map(Number);
  const [year, month, day] = parts;
  if (parts.length !== 3 || year === undefined || month === undefined || day === undefined) {
    return isoDate;
  }
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return isoDate;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** A real instant, so ordinary local formatting is correct here. */
export function formatInstant(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(instant);
}

/**
 * Turn a contract slug into words, falling back to the slug itself.
 *
 * The fallback is deliberate: `fact_type`, `evidence_lane`, and the ranking
 * factors are open enums in the schema, so a release that adds a member should
 * show its code rather than render nothing.
 */
function humanize(value: string): string {
  const words = value.replace(/[_.-]+/g, " ").trim();
  if (!words) return value;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const FACT_TYPE_LABELS: Record<string, string> = {
  chart_snapshot: "Chart snapshot",
  natal_position: "Natal position",
  natal_aspect: "Natal aspect",
  natal_pattern: "Natal pattern",
  cycle_instance: "Cycle",
  exact_pass: "Exact pass",
  lunation: "Lunation",
  station_ingress: "Station or ingress",
  uncertainty_feature: "Uncertainty",
  other_calculated: "Calculated fact",
};

const LANE_LABELS: Record<string, string> = {
  celestial_facts: "Celestial facts",
  user_and_context: "User and context",
  operational: "Operational",
};

export function humanFactType(value: string): string {
  return FACT_TYPE_LABELS[value] ?? humanize(value);
}

export function humanLane(value: string): string {
  return LANE_LABELS[value] ?? humanize(value);
}

/**
 * Reader-facing copy for a ranking factor.
 *
 * The factor is the readable half of a `rankingFactor`. Its sibling `reason` is
 * described by the frozen schema as "machine-readable short reason" and the
 * ranker fills it accordingly — `orb_0.42`, `transiting_saturn`,
 * `preference_work` — so a drawer that printed it would be showing a reader the
 * ranker's own notes. Written out here in the ranker's own terms: each line says
 * what was weighed, not that the reading is about it.
 *
 * `humanize` still backs this, because the enum is open at `other` and a factor
 * added in a later release should degrade to its slug rather than vanish.
 */
const RANKING_FACTOR_LABELS: Record<string, string> = {
  exactness: "How close the contact is to exact",
  body_importance: "The weight of the moving body",
  target_importance: "The weight of the point it touches",
  rarity: "How rare a contact of this kind is",
  angularity: "It lands on an angle of your chart",
  phase: "Where the cycle has reached in its arc",
  technique_weight: "The technique it was found by",
  domain_match: "It matches the area you asked to hear about",
  continuity: "It returns over more than one pass",
  repetition_penalty: "Ranked down for appearing recently",
  uncertainty_filter: "Held back by what your birth data supports",
  safety_filter: "Held back by a safety rule",
  other: "Another recorded ranking input",
};

export function rankingFactorLabel(value: string): string {
  return RANKING_FACTOR_LABELS[value] ?? humanize(value);
}

export function humanPhase(value: string): string {
  return humanize(value);
}

/** Orb to one decimal, the precision the ranker actually distinguishes. */
export function formatOrb(degrees: number): string {
  return `${degrees.toFixed(1)}°`;
}

/**
 * `domain_preference` phrased as what it did, not as a label.
 *
 * It is the only reader preference the launch ranker consults, and all it can do
 * is break a tie — `user_priority` was removed from the ranking vocabulary as a
 * duplicate of `domain_match`. Saying "Ranked toward work" is true; presenting
 * it as a category would imply the reading was chosen for being about work.
 */
export function domainPreferenceLabel(domain: string): string {
  return `Ranked toward ${domain.replace(/_/g, " ")}`;
}
