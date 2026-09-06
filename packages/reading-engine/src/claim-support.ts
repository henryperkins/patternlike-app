/**
 * Support for explicit English factual claims, against individual calculated
 * records. One factual sentence describes one record. Reflection is still
 * generated interpretation: this is not an entailment claim about psychology.
 *
 * Vocabulary containment is necessary but insufficient. Record kind, roles,
 * degree kind, ingress direction, and the named event must also agree. We reject
 * ambiguous compound facts and unsupported factual syntax instead of repairing
 * the writer's text or trusting a separate model-authored ledger.
 */
import type { DailySkyFact, ZodiacSignName } from "@patternlike/shared";
import type { ConstrainedFact, PreparedConstrainedReadingInput } from "./constrained-types.js";
import {
  BODY_TERMS,
  PERSONALIZATION_RULES,
  extractAspects,
  extractBodies,
  extractCyclePhases,
  extractDates,
  extractDegrees,
  extractHouses,
  extractLunarPhases,
  extractSigns,
  firstMatch,
  type UnitKind,
} from "./candidate-policy.js";

type Frame = "natal" | "transiting";
interface Participant { body: string; frame: Frame }
interface Relationship {
  kind: "position" | "aspect" | "ingress" | "lunar_phase" | "house";
  participants: Participant[];
  sign?: string | null;
  from?: string;
  to?: string;
  house?: number | null;
  aspect?: string | null;
  degree?: { kind: "position" | "orb" | "orb_limit"; value: number };
  motion?: "direct" | "retrograde";
  start?: string;
  end?: string;
  exact: string[];
  sampled?: string;
}

function relationship(fact: ConstrainedFact): Relationship {
  const support = fact.support;
  if (support.kind === "cycle") {
    const value = support.value;
    return {
      kind: "aspect",
      participants: [{ body: value.body, frame: "transiting" }, { body: value.target, frame: "natal" }],
      aspect: value.aspect,
      // Cycle orb_deg is the configured envelope, not instantaneous separation.
      degree: { kind: "orb_limit", value: value.orb_deg },
      start: value.start_at,
      end: value.end_at,
      exact: value.passes.map((pass) => pass.exact_at),
    };
  }
  if (support.kind === "natal") {
    const value = support.value;
    const isAspect = value.fact_class === "natal_aspect";
    return {
      kind: isAspect ? "aspect" : "position",
      participants: [value.body, ...(value.target ? [value.target] : [])].map((body) => ({ body, frame: "natal" })),
      sign: value.sign,
      house: value.house,
      aspect: value.aspect,
      ...(value.degree_deg === null ? {} : { degree: { kind: isAspect ? "orb" as const : "position" as const, value: value.degree_deg } }),
      exact: [],
    };
  }
  const value = support.value;
  switch (value.kind) {
    case "anchor_position": {
      const detail = value.detail as Extract<DailySkyFact["detail"], { sign_degree_deg: number }>;
      return { kind: "position", participants: [{ body: detail.body, frame: "transiting" }], sign: detail.sign, degree: { kind: "position", value: detail.sign_degree_deg }, motion: detail.retrograde ? "retrograde" : "direct", exact: [], sampled: value.effective_at };
    }
    case "lunar_phase":
      return { kind: "lunar_phase", participants: [{ body: "moon", frame: "transiting" }], exact: [], sampled: value.effective_at };
    case "transit_natal_contact": {
      const detail = value.detail as Extract<DailySkyFact["detail"], { natal_target: string }>;
      return { kind: "aspect", participants: [{ body: detail.transiting_body, frame: "transiting" }, { body: detail.natal_target, frame: "natal" }], aspect: detail.aspect, exact: [value.effective_at] };
    }
    case "collective_exact_aspect": {
      const detail = value.detail as Extract<DailySkyFact["detail"], { other_body: string }>;
      return { kind: "aspect", participants: [{ body: detail.body, frame: "transiting" }, { body: detail.other_body, frame: "transiting" }], aspect: detail.aspect, exact: [value.effective_at] };
    }
    case "sign_ingress": {
      const detail = value.detail as Extract<DailySkyFact["detail"], { from_sign: string }>;
      return { kind: "ingress", participants: [{ body: detail.body, frame: "transiting" }], from: detail.from_sign, to: detail.to_sign, motion: detail.direction, exact: [value.effective_at] };
    }
    case "house_placement": {
      const detail = value.detail as Extract<DailySkyFact["detail"], { house: number }>;
      return { kind: "house", participants: [{ body: detail.body, frame: "transiting" }], house: detail.house, exact: [], sampled: value.effective_at };
    }
  }
}

interface BodyMention { body: string; frame: Frame | null; index: number }
function bodyMentions(text: string): BodyMention[] {
  const found: BodyMention[] = [];
  for (const [pattern, body] of BODY_TERMS) {
    for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
      const before = text.slice(0, match.index);
      const after = text.slice(match.index + match[0].length);
      const natal = /\b(?:your\s+(?:natal\s+)?|natal\s+|birth\s+)$/.test(before) ||
        /^\s+(?:in|of)\s+your\s+(?:natal\s+|birth\s+)?chart\b/.test(after);
      const transiting = /\b(?:transiting|transit|current|today's|sky's)\s+$/.test(before);
      found.push({ body, frame: natal ? "natal" : transiting ? "transiting" : null, index: match.index });
    }
  }
  return found.sort((left, right) => left.index - right.index);
}

const EVENT = /\b(?:exact(?:ly)?|begins?|starts?|ends?|ending|runs? out|ingress)\b/;
const RELATIVE_OTHER_DAY = /\b(?:tomorrow|yesterday|next (?:day|week|month|year)|last (?:week|month|year)|in \d+ days?)\b/;
const MOTION = /\b(?:retrograde|direct motion|moving direct)\b/;
const UNIMPLEMENTED = /\b(?:eclipses?|solstices?|equinox(?:es)?|solar return|lunar return|stations? (?:direct|retrograde))\b/;
const ORB = /\borb\b/;
const ANAPHORIC_FACT = /\b(?:it|this|that|the (?:contact|aspect|cycle|transit))\s+(?:begins?|began|starts?|started|ends?|ended|enters?|moves?|(?:is|was|will be)\s+(?:exact|retrograde|direct|untrue|false))\b/;

const DEGREE = String.raw`\d+(?:\.\d+)?\s*(?:degrees?|°)`;
const HOUSE = String.raw`(?:(?:the|your)\s+)?(?:[a-z0-9-]+\s+house|house\s+\d{1,2})`;
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const CLOCK = String.raw`\d{1,2}:\d{2}(?::\d{2})? utc`;
const INSTANT = `${DATE}t\\d{2}:\\d{2}(?::\\d{2})?z`;
const WHEN = `(?:today|tonight|on ${DATE}|at (?:${INSTANT}|${CLOCK})(?: on ${DATE}| today| tonight)?)`;
const TIMING = `(?:,? (?:${WHEN}|(?:exact|sampled) ${WHEN}))?`;
const ASPECT_FORMS: Record<string, string> = {
  conjunction: "(?:conjunct|in conjunction with)",
  sextile: "sextiles?",
  square: "(?:squares?|squaring)",
  trine: "(?:trines?|trining)",
  opposition: "(?:opposite|in opposition to)",
};

function participantPattern(participant: Participant): string {
  const term = BODY_TERMS.find(([, body]) => body === participant.body)?.[0].source;
  if (!term) return "(?!)";
  const prefix = participant.frame === "natal"
    ? "(?:your (?:natal )?|natal |birth )"
    : "(?:(?:the )?(?:transiting |current )?|today's )";
  return `${prefix}(?:${term})`;
}

/**
 * Consume the entire factual sentence with a closed grammar. There is no free
 * prose tail: a second relationship, a different quantity kind, a hidden
 * subject qualifier, or an unparsed timing modifier must not inherit support
 * merely because its nouns also occur in the record. Reflection has its own
 * sentences and is not parsed as a calculated assertion.
 */
function matchesFactualGrammar(text: string, record: Relationship, fact: ConstrainedFact): boolean {
  const participants = record.participants.map(participantPattern);
  const body = participants[0]!;
  const forms: string[] = [];
  switch (record.kind) {
    case "aspect": {
      const aspect = ASPECT_FORMS[record.aspect ?? ""];
      if (!aspect || participants.length !== 2) return false;
      for (const [left, right] of [participants, [...participants].reverse()]) {
        const pair = `${left}(?: is)? (?:exactly )?${aspect} ${right}`;
        const orb = fact.support.kind === "cycle" ? "a configured orb limit" : "an orb";
        forms.push(`${pair}(?:,? with ${orb} of ${DEGREE})?${TIMING}`);
        forms.push(`${left}'s ${record.aspect} (?:to|with) ${right} (?:begins|starts|ends|runs out) ${WHEN}`);
        if (fact.support.kind === "cycle" && fact.attributes.phase) {
          forms.push(`${pair} in the ${fact.attributes.phase} phase(?: today| tonight)?`);
          forms.push(`${pair},? ${fact.attributes.phase}(?: today| tonight)?`);
        }
      }
      break;
    }
    case "position": {
      if (record.sign) {
        const placement = `(?:in (?:the sign of )?${record.sign}|at ${DEGREE} (?:of )?${record.sign})`;
        forms.push(`${body} (?:is|sits) ${placement}(?: in ${HOUSE})?${TIMING}`);
      }
      if (record.house) forms.push(`${body} (?:is|sits) in ${HOUSE}${TIMING}`);
      if (record.motion) forms.push(`${body} is (?:retrograde|moving direct)${TIMING}`);
      break;
    }
    case "house":
      forms.push(`${body} (?:is|sits) in ${HOUSE}${TIMING}`);
      break;
    case "ingress":
      forms.push(`${body} (?:enters|is entering) ${record.to}(?: from ${record.from})?${TIMING}`);
      forms.push(`${body} (?:moves|is moving) from ${record.from} (?:to|into) ${record.to}${TIMING}`);
      break;
    case "lunar_phase": {
      const phase = fact.attributes.lunar_phase?.replace(/_/g, " ");
      if (!phase) return false;
      const predicate = phase.replace(/ moon$/, "");
      forms.push(`${body} is ${predicate}${TIMING}`);
      forms.push(`(?:a|the) ${phase}${phase.endsWith("moon") ? "" : " moon"}${TIMING}`);
      break;
    }
  }
  const collectivePrefix = fact.scope === "collective"
    ? "(?:in (?:today's|the) (?:shared|collective) sky, )?"
    : "";
  return forms.some((form) => new RegExp(`^${collectivePrefix}(?:${form})$`).test(text));
}

function clocks(text: string): string[] {
  return [...text.matchAll(/(?:\b|t)(\d{1,2}):(\d{2})(?::(\d{2}))?/g)]
    .map((match) => `${match[1]!.padStart(2, "0")}:${match[2]}${match[3] ? `:${match[3]}` : ""}`);
}

function factual(text: string): boolean {
  return extractBodies(text).length > 0 || extractSigns(text).length > 0 ||
    extractAspects(text).length > 0 || extractDegrees(text).length > 0 ||
    extractHouses(text).length > 0 || extractLunarPhases(text).length > 0 ||
    extractCyclePhases(text).length > 0 || MOTION.test(text) || ORB.test(text) ||
    UNIMPLEMENTED.test(text) || ANAPHORIC_FACT.test(text) || /\b(?:exact|sampled)\b/.test(text) ||
    (EVENT.test(text) && /\b(?:contact|aspect|cycle|transit|ingress|pass|event)\b/.test(text));
}

function negatesFact(text: string): boolean {
  for (const match of text.matchAll(/\b(?:not|never|no longer|isn't|aren't|wasn't|weren't|doesn't|don't|won't|cannot|can't)\b/g)) {
    const rest = text.slice(match.index + match[0].length);
    if (factual(rest) || EVENT.test(rest)) return true;
    // A negative subject follows the aspect: "Saturn squares no natal Sun".
  }
  return /\bno\s+(?:natal|transiting|sun|moon|mercury|venus|mars|jupiter|saturn)\b/.test(text);
}

function validFrames(mentions: BodyMention[], record: Relationship, hasAspect: boolean): boolean {
  if (mentions.some((mention) => !record.participants.some((participant) =>
    participant.body === mention.body && (mention.frame === null || participant.frame === mention.frame)))) return false;
  if (hasAspect) {
    if (mentions.length < 2 || record.participants.some((participant) =>
      !mentions.some((mention) => mention.body === participant.body))) return false;
    if (record.participants.some((participant) => participant.frame === "natal") &&
        record.participants.some((participant) => participant.frame === "transiting")) {
      // A mixed-frame aspect must say which participant is natal. Unqualified
      // remaining participants occupy the transit role; they cannot reverse it.
      if (!mentions.some((mention) => mention.frame === "natal")) return false;
      if (!mentions.some((mention) => mention.frame !== "natal")) return false;
      if (mentions.some((mention) => !record.participants.some((participant) =>
        participant.body === mention.body && participant.frame === (mention.frame ?? "transiting")))) return false;
    }
  }
  return true;
}

function hasPlacementSyntax(text: string, sign: string): boolean {
  return new RegExp(`\\b(?:in|through)\\s+(?:the\\s+sign\\s+of\\s+)?${sign}\\b|(?:degrees?|°)\\s+(?:of\\s+)?${sign}\\b|\\b${sign}\\s+(?:natal\\s+)?(?:${extractBodies(text).join("|")})\\b`).test(text);
}

function ingressSupported(text: string, record: Relationship, signs: ZodiacSignName[]): boolean {
  if (record.kind !== "ingress") return false;
  const destination = /\b(?:enters?|entering|into|to|for)\s+(?:the sign of\s+)?([a-z]+)\b/g;
  const source = /\b(?:from|leaves?|leaving)\s+(?:the sign of\s+)?([a-z]+)\b/g;
  const targets = [...text.matchAll(destination)].map((match) => match[1]!);
  const origins = [...text.matchAll(source)].map((match) => match[1]!);
  return targets.length > 0 && targets.every((sign) => sign === record.to) &&
    origins.every((sign) => sign === record.from) &&
    signs.every((sign) => sign === record.to || (origins.length > 0 && sign === record.from));
}

function timeSupported(text: string, record: Relationship, prepared: PreparedConstrainedReadingInput): boolean {
  const dates = extractDates(text);
  const times = clocks(text);
  const starts = /\b(?:begins?|starts?)\b/.test(text);
  const ends = /\b(?:ends?|ending|runs? out)\b/.test(text);
  const exact = /\bexact(?:ly)?\b/.test(text);
  const sampled = /\bsampled\b/.test(text);
  const today = /\b(?:today|tonight)\b/.test(text);
  if (Number(starts) + Number(ends) + Number(exact) + Number(sampled) > 1) return false;
  if (sampled && !record.sampled) return false;
  if (RELATIVE_OTHER_DAY.test(text)) return false;
  if (!dates.length && !times.length && !starts && !ends && !exact) {
    if (record.start && record.end) {
      return Date.parse(record.start) < Date.parse(prepared.day_window.end_at) &&
        Date.parse(record.end) >= Date.parse(prepared.day_window.start_at);
    }
    // Present-tense sky claims refer to this day even without an explicit
    // "today". Natal placements/aspects are timeless within this birth chart.
    if (!record.sampled && !record.exact.length) return true;
  }
  // No conversion from an unprovided timezone or 12-hour clock is inferred.
  if (times.length && (!/\butc\b|t\d{2}:\d{2}(?::\d{2})?z\b/.test(text) ||
      /\b(?:am|pm|a\.m\.|p\.m\.|gmt|est|edt|pst|pdt|local time)\b/.test(text))) return false;
  const instants = starts ? (record.start ? [record.start] : [])
    : ends ? (record.end ? [record.end] : [])
      : exact || record.exact.length ? record.exact
        : record.sampled ? [record.sampled] : [];
  // The date, time, and event role must all belong to one instant. Matching
  // date and clock independently would borrow across different exact passes.
  return instants.some((rawInstant) => {
    const millis = Date.parse(rawInstant);
    if (!Number.isFinite(millis)) return false;
    const instant = new Date(millis).toISOString();
    const date = instant.slice(0, 10);
    return dates.every((mention) => (mention.hasYear ? date : date.slice(5)) === mention.key) &&
      times.every((time) => instant.slice(11, 11 + time.length) === time) &&
      (!(today || (!dates.length && (exact || times.length > 0 || record.sampled || record.exact.length))) ||
        (millis >= Date.parse(prepared.day_window.start_at) && millis < Date.parse(prepared.day_window.end_at)));
  });
}

function sentenceSupported(text: string, fact: ConstrainedFact, prepared: PreparedConstrainedReadingInput): boolean {
  if (!fact.support) return false;
  const record = relationship(fact);
  if (!matchesFactualGrammar(text, record, fact)) return false;
  const mentions = bodyMentions(text);
  const signs = extractSigns(text);
  const aspects = extractAspects(text);
  const houses = extractHouses(text);
  const degrees = extractDegrees(text);
  if (!validFrames(mentions, record, aspects.length > 0)) return false;
  if (fact.scope === "collective" && firstMatch(PERSONALIZATION_RULES, text)) return false;
  if (UNIMPLEMENTED.test(text) || negatesFact(text)) return false;
  if (aspects.some((aspect) => record.kind !== "aspect" || record.aspect !== aspect)) return false;
  if (extractLunarPhases(text).some((phase) => record.kind !== "lunar_phase" || fact.attributes.lunar_phase !== phase)) return false;
  if (extractCyclePhases(text).some((phase) => fact.support.kind !== "cycle" || fact.attributes.phase !== phase)) return false;
  if (signs.length) {
    if (mentions.length === 0) return false;
    if (record.kind === "ingress") {
      if (!ingressSupported(text, record, signs)) return false;
    } else if (record.kind !== "position" || signs.length !== 1 || signs[0] !== record.sign ||
      !hasPlacementSyntax(text, signs[0]!)) return false;
  }
  if (/\b(?:enters?|entering|leaves?|leaving|ingress)\b/.test(text) && mentions.length && record.kind !== "ingress") return false;
  if (/\b(?:moves?|moving|transiting)\b/.test(text) && record.participants.every((participant) => participant.frame === "natal")) return false;
  if (houses.length && (mentions.length === 0 || houses.some((house) => house !== record.house))) return false;
  if (/\bhouse\b/.test(text) && houses.length === 0) return false;
  if (/\b(?:degree|degrees|orb)\b|°/.test(text) && degrees.length === 0) return false;
  if (degrees.length) {
    const kind = /\bconfigured orb limit\b/.test(text) ? "orb_limit" : ORB.test(text) ? "orb" : "position";
    if (!mentions.length || !record.degree || record.degree.kind !== kind) return false;
    if (kind !== "position" && (record.kind !== "aspect" || aspects.length === 0)) return false;
    if (/-\s*\d+(?:\.\d+)?\s*(?:°|degrees?)|°\s*\d|\b(?:arcminutes?|arcseconds?)\b/.test(text)) return false;
    if (degrees.some((mention) => Math.abs(mention.value - record.degree!.value) > 0.5 * 10 ** -mention.decimals + 1e-9)) return false;
  }
  if (MOTION.test(text)) {
    if (!record.motion || record.motion !== (/\bretrograde\b/.test(text) ? "retrograde" : "direct")) return false;
  }
  return timeSupported(text, record, prepared);
}

function uncertaintyDisclosure(text: string, prepared: PreparedConstrainedReadingInput): boolean {
  const suppressed = new Set(prepared.request.suppressed_features);
  const accuracy = prepared.request.birth_time_accuracy;
  if (accuracy === "approximate" && text === "your birth time is approximate, so time-sensitive details remain uncertain") return true;
  const feature = "(?:houses|angles|angle transits|time-sensitive moon details)";
  const scope = `${feature}(?:(?:, (?:and |or )?| and | or )${feature})*`;
  const patterns = [
    new RegExp(`^without a confirmed birth time this reading leaves ${scope} out(?: entirely)?$`),
    new RegExp(`^your birth time is ${accuracy}, so this reading (?:omits|claims nothing about) ${scope}$`),
    new RegExp(`^this reading omits ${scope} because those facts are unavailable$`),
  ];
  if (!patterns.some((pattern) => pattern.test(text))) return false;
  return (!text.includes("houses") || suppressed.has("houses")) &&
    (!text.includes("angles") || suppressed.has("angles")) &&
    (!text.includes("angle transits") || suppressed.has("angle_transits")) &&
    (!text.includes("moon") || suppressed.has("moon_time_sensitive"));
}

export function validateFactSupport(
  text: string,
  cited: readonly ConstrainedFact[],
  prepared: PreparedConstrainedReadingInput,
  kind: UnitKind | "headline",
): string | null {
  const normalized = text.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/[’‘]/g, "'").toLowerCase();
  for (const sentence of normalized.split(/[.!?](?:["']+)?(?=\s|$)|\n+/).map((part) => part.trim()).filter(Boolean)) {
    if (kind === "uncertainty_note") {
      if (!uncertaintyDisclosure(sentence, prepared)) return "unsupported_uncertainty_disclosure";
      continue;
    }
    if (!factual(sentence)) {
      // Merely naming today's date is not an astrological claim. Other dates
      // and all clock times require an identifiable, supported event.
      if (clocks(sentence).length || extractDates(sentence).some((mention) =>
        mention.key !== (mention.hasYear ? prepared.request.local_date : prepared.request.local_date.slice(5)))) {
        return "unbound_temporal_claim";
      }
      continue;
    }
    if (kind === "headline") return "uncited_headline_claim";
    if (!cited.some((fact) => sentenceSupported(sentence, fact, prepared))) return "unsupported_fact_relationship";
  }
  return null;
}
