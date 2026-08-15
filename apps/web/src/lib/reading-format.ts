import type { ParagraphRole, ParagraphRoleV5 } from "./api-client.js";

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
 * The same table for a v5 reading, and a separate `Record` for the same reason
 * the v3 one is one: a role added to the v5 contract must be a compile error
 * here rather than a paragraph that renders with no label.
 *
 * `primary_theme` still has no static kicker — v5 supplies its own headline into
 * that slot, so a fixed word there would displace the model's own.
 * `collective_context` names the collective in the label itself, because a fact
 * true for everyone must not be read as a private discovery.
 */
export const ROLE_PRESENTATION_V5: Record<ParagraphRoleV5, RolePresentation> = {
  primary_theme: { kicker: null, tone: "lede" },
  supporting_theme: { kicker: "Supporting influence", tone: "body" },
  phase_context: { kicker: "Where this is in its cycle", tone: "body" },
  timing: { kicker: "Timing", tone: "body" },
  collective_context: { kicker: "The sky everyone shares", tone: "body" },
  reflection: { kicker: "A question to sit with", tone: "aside" },
  uncertainty_notice: { kicker: "What this reading cannot say", tone: "notice" },
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

/**
 * Reader words for the seven server-owned consent categories.
 *
 * A map with a `humanize` fallback, not a closed `Record`: the list is owned by
 * the consent policy version the server displays, so a category added by a later
 * policy shows its own name rather than disappearing from a screen whose whole
 * job is to be complete about what may be sent.
 */
const AI_CONSENT_CATEGORY_LABELS: Record<string, string> = {
  birth_accuracy_and_uncertainty: "Birth-time accuracy and what it rules out",
  calculated_natal_facts: "Calculated facts from your natal chart",
  active_calculated_cycles: "Your active calculated cycles",
  calculated_daily_sky: "The calculated sky for your day",
  enabled_personal_context: "Personal context you have enabled",
  prior_reading_excerpts: "Recent readings, so today does not repeat them",
  reading_feedback: "Feedback you have given on readings",
};

const PATTERN_CONSENT_CATEGORY_LABELS: Record<string, string> = {
  calculated_natal_features: "Calculated facts from your natal chart",
  accuracy_and_suppression: "Birth-time accuracy and what it rules out",
  confirmed_content_locale: "The language you confirmed for content",
  activated_interpretation_ontology: "The activated interpretation meanings",
  generated_pattern_plan_and_draft_for_validation: "The Pattern plan and draft, so they can be checked",
};

export function aiConsentCategoryLabel(category: string): string {
  return AI_CONSENT_CATEGORY_LABELS[category] ?? humanize(category);
}

export function patternConsentCategoryLabel(category: string): string {
  return PATTERN_CONSENT_CATEGORY_LABELS[category] ?? humanize(category);
}

/** What a permitted lane means in reader words, with the same open fallback. */
const ALLOWED_USE_LABELS: Record<string, string> = {
  annual_context: "Yearly framing",
  environment_context: "Surroundings",
  life_domain_selection: "Which area of life",
  narrative_continuity: "Continuity with earlier readings",
  optional_recommendations: "Optional suggestions",
  pattern_profile: "Long-run pattern",
  reflection_prompt: "The reflection question",
  relationship_interpretation: "Relationship framing",
  repetition_control: "Avoiding repetition",
  routine_context: "Routine",
  theme_eligibility: "Which themes are eligible",
  theme_filtering: "Which themes are set aside",
  theme_ranking: "Which theme leads",
  tone: "Tone",
  travel_context: "Travel",
  user_memory: "What the product remembers",
  workload_context: "Workload",
};

export function allowedUseLabel(use: string): string {
  return ALLOWED_USE_LABELS[use] ?? humanize(use);
}

/** Personalized or collective, said in words rather than left as a code. */
export function factScopeLabel(scope: string): string {
  if (scope === "collective") return "Everyone's sky";
  if (scope === "personalized") return "Your chart";
  return humanize(scope);
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
