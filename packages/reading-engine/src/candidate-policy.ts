/**
 * The closed vocabulary and pattern tables candidate validation runs on.
 *
 * Split out from the validator so the rules are readable as data. Every table
 * here is versioned by `VALIDATION_POLICY_VERSION`: changing a term, a pattern,
 * or a lane changes which prose the product will publish for identical inputs,
 * which is exactly what a stored policy version exists to record.
 *
 * The extraction functions are deliberately conservative in one direction only.
 * A term the facts do not license is rejected even when a fluent reader would
 * call it harmless, because the alternative — deciding case by case whether an
 * uncalculated degree matters — is the editorial judgement this product replaced
 * with a mechanical check.
 */

import type { AspectType, CyclePhase, M5AllowedUse } from "@patternlike/shared";
import type { CelestialBody, LunarPhaseName, ZodiacSignName } from "@patternlike/shared";

/** Which prose unit a context lane is allowed to shape. */
export type UnitKind = "lead" | "paragraph" | "reflection" | "uncertainty_note";

/**
 * Theme and profile tokens frame relevance in the body of the reading;
 * `reflection_prompt` shapes only the question; `optional_recommendations` may
 * suggest; `tone` may colour anything a reader reads as voice. Nothing may
 * shape the uncertainty note, which states what the calculation could not say
 * and has no room for personal framing.
 */
const BODY_UNITS: ReadonlySet<UnitKind> = new Set<UnitKind>(["lead", "paragraph"]);

export const CONTEXT_USE_UNITS: Readonly<Record<M5AllowedUse, ReadonlySet<UnitKind>>> = {
  annual_context: BODY_UNITS,
  environment_context: BODY_UNITS,
  life_domain_selection: BODY_UNITS,
  narrative_continuity: BODY_UNITS,
  optional_recommendations: new Set<UnitKind>(["paragraph", "reflection"]),
  pattern_profile: BODY_UNITS,
  reflection_prompt: new Set<UnitKind>(["reflection"]),
  relationship_interpretation: BODY_UNITS,
  repetition_control: BODY_UNITS,
  routine_context: BODY_UNITS,
  theme_eligibility: BODY_UNITS,
  theme_filtering: BODY_UNITS,
  theme_ranking: BODY_UNITS,
  tone: new Set<UnitKind>(["lead", "paragraph", "reflection"]),
  travel_context: BODY_UNITS,
  user_memory: BODY_UNITS,
  workload_context: BODY_UNITS,
};

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The locales this validator can actually judge.
 *
 * Every mechanical rule below is English: the body, sign, aspect, phase, and
 * house vocabularies, the month names, the safety rules, the personalization
 * rules, the context-attribution rules, and the uncertainty terms. Against a
 * reading written in another language the validator is simultaneously too lax
 * and impossible to satisfy — `/\bsaturn\b/` does not match "Saturno", so
 * `hasAstrologyClaim` is false and the grounding demand never fires, while
 * `uncertaintyTerms` matches nothing so a required note can never pass. The
 * first failure mode publishes an ungrounded claim with no human review behind
 * it; the second spends the whole retry and replacement budget and leaves the
 * reader with nothing.
 *
 * So the supported set is declared rather than implied, and a locale outside it
 * is refused before a command is frozen. Adding one means translating the rule
 * tables, not widening this list.
 */
export const SUPPORTED_READING_LOCALES: readonly string[] = ["en-US", "en-GB", "en"];

/** Whether the deterministic rules can judge a reading written for `locale`. */
export function isSupportedReadingLocale(locale: string): boolean {
  const tag = locale.trim();
  if (SUPPORTED_READING_LOCALES.includes(tag)) return true;
  // A regional English the list does not name still reads as English.
  return /^en([-_]|$)/i.test(tag);
}

export const BODY_TERMS: ReadonlyArray<[RegExp, CelestialBody]> = [
  [/\bsun\b/gi, "sun"],
  [/\bmoon\b/gi, "moon"],
  [/\bmercury\b/gi, "mercury"],
  [/\bvenus\b/gi, "venus"],
  [/\bmars\b/gi, "mars"],
  [/\bjupiter\b/gi, "jupiter"],
  [/\bsaturn\b/gi, "saturn"],
  [/\buranus\b/gi, "uranus"],
  [/\bneptune\b/gi, "neptune"],
  [/\bpluto\b/gi, "pluto"],
  [/\b(?:true\s+node|north\s+node|lunar\s+node)\b/gi, "true_node"],
  [/\b(?:ascendant|rising\s+sign)\b/gi, "ascendant"],
  [/\b(?:midheaven|mc)\b/gi, "midheaven"],
];

export const SIGN_TERMS: ReadonlyArray<[RegExp, ZodiacSignName]> = [
  [/\baries\b/gi, "aries"],
  [/\btaurus\b/gi, "taurus"],
  [/\bgemini\b/gi, "gemini"],
  [/\bcancer\b/gi, "cancer"],
  [/\bleo\b/gi, "leo"],
  [/\bvirgo\b/gi, "virgo"],
  [/\blibra\b/gi, "libra"],
  [/\bscorpio\b/gi, "scorpio"],
  [/\bsagittarius\b/gi, "sagittarius"],
  [/\bcapricorn\b/gi, "capricorn"],
  [/\baquarius\b/gi, "aquarius"],
  [/\bpisces\b/gi, "pisces"],
];

export const ASPECT_TERMS: ReadonlyArray<[RegExp, AspectType]> = [
  [/\bconjunct(?:ion|ions)?\b/gi, "conjunction"],
  [/\bsextiles?\b/gi, "sextile"],
  [/\bsquar(?:e|es|ing)\b/gi, "square"],
  [/\btrin(?:e|es|ing)\b/gi, "trine"],
  [/\boppos(?:ite|ition|itions)\b/gi, "opposition"],
];

export const LUNAR_PHASE_TERMS: ReadonlyArray<[RegExp, LunarPhaseName]> = [
  [/\bnew\s+moon\b/gi, "new_moon"],
  [/\bwaxing\s+crescent\b/gi, "waxing_crescent"],
  [/\bfirst\s+quarter\b/gi, "first_quarter"],
  [/\bwaxing\s+gibbous\b/gi, "waxing_gibbous"],
  [/\bfull\s+moon\b/gi, "full_moon"],
  [/\bwaning\s+gibbous\b/gi, "waning_gibbous"],
  [/\blast\s+quarter\b/gi, "last_quarter"],
  [/\bwaning\s+crescent\b/gi, "waning_crescent"],
];

/**
 * Cycle phase names are ordinary English words — "building", "peak" — so they
 * are only read as a claim inside an explicit phase construction. Scanning for
 * the bare words would reject a sentence about a building or a peak.
 */
export const CYCLE_PHASE_TERMS: ReadonlyArray<[RegExp, CyclePhase]> = [
  [/\b(?:the|its|this)\s+emerging\s+phase\b|\bemerging\s+phase\b/gi, "emerging"],
  [/\bbuilding\s+phase\b/gi, "building"],
  [/\bpeak\s+phase\b/gi, "peak"],
  [/\breconsidering\s+phase\b/gi, "reconsidering"],
  [/\bintegrating\s+phase\b/gi, "integrating"],
];

const HOUSE_ORDINALS: Readonly<Record<string, number>> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  "1st": 1,
  "2nd": 2,
  "3rd": 3,
  "4th": 4,
  "5th": 5,
  "6th": 6,
  "7th": 7,
  "8th": 8,
  "9th": 9,
  "10th": 10,
  "11th": 11,
  "12th": 12,
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function matchTerms<T>(text: string, terms: ReadonlyArray<[RegExp, T]>): T[] {
  const found: T[] = [];
  for (const [pattern, value] of terms) {
    // Each pattern is global, so reset lastIndex: a shared RegExp that keeps
    // state between calls silently skips the second sentence it is used on.
    pattern.lastIndex = 0;
    if (pattern.test(text)) found.push(value);
  }
  return found;
}

export function extractBodies(text: string): CelestialBody[] {
  return matchTerms(text, BODY_TERMS);
}

export function extractSigns(text: string): ZodiacSignName[] {
  return matchTerms(text, SIGN_TERMS);
}

export function extractAspects(text: string): AspectType[] {
  return matchTerms(text, ASPECT_TERMS);
}

export function extractLunarPhases(text: string): LunarPhaseName[] {
  return matchTerms(text, LUNAR_PHASE_TERMS);
}

export function extractCyclePhases(text: string): CyclePhase[] {
  return matchTerms(text, CYCLE_PHASE_TERMS);
}

export function extractHouses(text: string): number[] {
  const found = new Set<number>();
  const ordinal = /\b([a-z0-9]+)[\s-]house\b/gi;
  for (const match of text.matchAll(ordinal)) {
    const key = match[1]!.toLowerCase();
    const value = HOUSE_ORDINALS[key] ?? (/^\d{1,2}$/.test(key) ? Number(key) : undefined);
    if (value !== undefined) found.add(value);
  }
  const numeric = /\bhouse\s+(\d{1,2})\b/gi;
  for (const match of text.matchAll(numeric)) {
    found.add(Number(match[1]));
  }
  return [...found];
}

/** A number stated as a degree, with the precision the candidate chose. */
export interface DegreeMention {
  value: number;
  decimals: number;
}

export function extractDegrees(text: string): DegreeMention[] {
  const found: DegreeMention[] = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(?:°|degrees?\b)/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = match[1]!;
    const dot = raw.indexOf(".");
    found.push({ value: Number(raw), decimals: dot === -1 ? 0 : raw.length - dot - 1 });
  }
  return found;
}

/** An ISO date, a month-name date, or a bare month/day with no year. */
export interface DateMention {
  /** `YYYY-MM-DD` when a year was stated, else `MM-DD`. */
  key: string;
  hasYear: boolean;
}

export function extractDates(text: string): DateMention[] {
  const found: DateMention[] = [];
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    found.push({ key: `${match[1]}-${match[2]}-${match[3]}`, hasYear: true });
  }
  const monthFirst = new RegExp(
    `\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(\\d{4}))?\\b`,
    "gi",
  );
  for (const match of text.matchAll(monthFirst)) {
    found.push(monthDay(match[1]!, match[2]!, match[3]));
  }
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})(?:\\s+(\\d{4}))?\\b`,
    "gi",
  );
  for (const match of text.matchAll(dayFirst)) {
    found.push(monthDay(match[2]!, match[1]!, match[3]));
  }
  return found;
}

function monthDay(month: string, day: string, year: string | undefined): DateMention {
  const mm = String(MONTHS.indexOf(month.toLowerCase()) + 1).padStart(2, "0");
  const dd = day.padStart(2, "0");
  return year
    ? { key: `${year}-${mm}-${dd}`, hasYear: true }
    : { key: `${mm}-${dd}`, hasYear: false };
}

/** A clock time, normalized to zero-padded `HH:MM`. */
export function extractClockTimes(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    found.push(`${match[1]!.padStart(2, "0")}:${match[2]}`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Pattern tables
// ---------------------------------------------------------------------------

export interface PatternRule {
  detail_code: string;
  pattern: RegExp;
}

export const MARKUP_RULES: readonly PatternRule[] = [
  { detail_code: "html_tag", pattern: /<\s*\/?\s*[a-z!][^>]*>/i },
  { detail_code: "html_entity", pattern: /&(?:#\d+|[a-z]+);/i },
  { detail_code: "markdown_link", pattern: /\[[^\]]*\]\([^)]*\)/ },
  { detail_code: "url", pattern: /\b(?:https?:\/\/|www\.)\S+/i },
  { detail_code: "code_fence", pattern: /```|~~~/ },
  { detail_code: "markdown_heading", pattern: /^\s*#{1,6}\s/m },
];

export const LEAKAGE_RULES: readonly PatternRule[] = [
  {
    detail_code: "model_self_reference",
    pattern: /\b(?:as an? (?:ai|language model)|i am an? (?:ai|assistant|language model)|large language model)\b/i,
  },
  {
    detail_code: "prompt_reference",
    pattern: /\b(?:system prompt|these instructions|previous instructions|your instructions|the prompt above)\b/i,
  },
  {
    detail_code: "schema_reference",
    pattern: /\b(?:output_schema|json[_\s]schema|fact_ids|context_refs|schema_version|reflection_prompt|uncertainty_note|allowed_paragraph_roles)\b/i,
  },
  { detail_code: "opaque_fact_id", pattern: /\b(?:dsf|cyc|nat)_[a-f0-9]{8,}\b/i },
  { detail_code: "opaque_context_ref", pattern: /\bctx_\d{1,3}\b/i },
  {
    detail_code: "injection_echo",
    pattern: /\b(?:ignore (?:all )?(?:previous|prior|above)|disregard the above|override the)\b/i,
  },
];

export const SAFETY_RULES: readonly PatternRule[] = [
  {
    detail_code: "diagnosis",
    pattern:
      /\b(?:diagnos(?:is|e|ed|es|ing|tic)|depression|bipolar|schizophreni\w*|psychosis|ptsd|adhd|ocd|autis\w*|anxiety disorder|eating disorder|personality disorder)\b/i,
  },
  {
    // `cancer` is the one term in this list that is also licensed
    // astrological vocabulary: it is a sign, and the packet renders natal
    // facts as "... degrees Cancer", so the model is handed the word. Bare,
    // it matched any ordinary verb from the first alternation within eighty
    // characters — rejecting compliant readings for roughly one reader in
    // twelve per body, and recording a safety violation that never happened.
    // Disambiguated the way the cycle-phase collision already was: the
    // disease sense needs a medical construction around it, which the
    // astrological sense never produces. Every other term here is
    // unambiguous and stays bare. The lookaround rejects the astrological
    // constructions the packet actually produces (in / through / enters /
    // degrees Cancer, and Cancer part / placement / season) and keeps every
    // disease sense, including the bare "cure your cancer".
    detail_code: "medical_causation",
    pattern:
      /\b(?:caus(?:e|es|ed|ing)|cur(?:e|es|ed|ing)|heal(?:s|ed|ing)?|treat(?:s|ed|ing|ment)?|prevent(?:s|ed|ing)?|trigger(?:s|ed|ing)?)\b[^.!?]{0,80}\b(?:illness|disease|(?<!\b(?:in|into|through|entering|enters|degrees?|sign)\s)cancers?\b(?!\s+(?:part|placement|placements|season|sign|rising|moon|sun|energy|chart|stellium))|insomnia|migraine|symptoms?|infection|fever|allerg\w+|injur\w+|pregnancy|fertility|medication)\b/i,
  },
  {
    detail_code: "guarantee",
    pattern:
      /\b(?:guarantee[sd]?|guaranteed to|is certain to|will certainly|without fail|100%\s*(?:certain|sure)|assured of)\b/i,
  },
  {
    detail_code: "fatalism",
    pattern:
      /\b(?:fated|destined|your destiny|predetermined|inevitable|unavoidable|doomed|written in the stars|nothing you can do|cannot be changed|no escape)\b/i,
  },
  {
    detail_code: "advice_replacement",
    pattern:
      /\b(?:skip|cancel|postpone|avoid|stop taking|do not take)\b[^.!?]{0,60}\b(?:appointment|doctor|physician|therapist|therapy|lawyer|attorney|accountant|medication|prescription|treatment)\b|\binstead of (?:seeing|consulting|calling|asking)\b/i,
  },
];

/** A collective sky described as if it belonged to one reader. */
export const PERSONALIZATION_RULES: readonly PatternRule[] = [
  {
    detail_code: "possessive_placement",
    pattern:
      /\byour\s+(?:sun|moon|mercury|venus|mars|jupiter|saturn|uranus|neptune|pluto|true node|ascendant|midheaven|chart|natal|birth chart|houses?|sign)\b/i,
  },
  {
    detail_code: "claimed_unique",
    pattern: /\b(?:unique to you|only you|yours alone|personal to you|specific to your chart)\b/i,
  },
];

/** Personal context presented as if the calculation had discovered it. */
export const CONTEXT_ATTRIBUTION_RULES: readonly PatternRule[] = [
  {
    detail_code: "context_as_evidence",
    pattern:
      /\b(?:your journal|your entry|your entries|your note|your notes|your check-?in|your log|your feedback|you wrote|you logged|you recorded)\b[^.!?]{0,80}\b(?:show|shows|reveal|reveals|indicate|indicates|confirm|confirms|prove|proves|mean|means|tell|tells|suggest|suggests)\b/i,
  },
];

export function firstMatch(rules: readonly PatternRule[], text: string): string | null {
  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule.detail_code;
  }
  return null;
}
