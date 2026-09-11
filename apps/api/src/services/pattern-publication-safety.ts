import {
  canonicalJson,
  type NatalFeature,
  type PatternFactPacket,
  type PatternOntologyRecord,
  type PatternPlan,
  type PatternSelectionManifest,
  type PatternSemanticVerdict,
  type PatternWriterOutput,
} from "@patternlike/shared";
import { findSemanticVerdictProblem } from "./pattern-semantic.js";

/** Included in the creation-source fingerprint, which freezes in-flight commands. */
export const PATTERN_PUBLICATION_SAFETY_POLICY_VERSION = "1.0.1" as const;

export type PatternPublicationSafetyFailureCode =
  | "suppressed_feature_leak"
  | "uncited_astrological_claim"
  | "source_dependency_failure"
  | "prohibited_claim"
  | "mandatory_feature_omission"
  | "private_projection_leak"
  | "semantic_refusal";

export interface PatternPublicationSafetyInput {
  features: readonly NatalFeature[];
  selectionManifest: PatternSelectionManifest;
  packet: PatternFactPacket;
  plan: PatternPlan;
  writer: PatternWriterOutput;
  verdict: PatternSemanticVerdict;
  publicProjection: unknown;
  ontology: readonly PatternOntologyRecord[];
  /** IDs from the independently verified registered corpus, never the writer. */
  sourceFragmentIds: ReadonlySet<string>;
}

export interface PatternPublicationSafetyResult {
  policyVersion: typeof PATTERN_PUBLICATION_SAFETY_POLICY_VERSION;
  failures: Array<{ code: PatternPublicationSafetyFailureCode; targetKey: string | null }>;
}

interface WriterUnit {
  key: string | null;
  text: string;
  feature_aliases?: string[];
  ontology_rule_ids?: string[];
  derived_synthesis_ids?: string[];
  scopeAliases?: readonly string[];
  scopeRules?: readonly string[];
}

function writerUnits(writer: PatternWriterOutput, plan?: PatternPlan): WriterUnit[] {
  const units: WriterUnit[] = [{ key: null, text: writer.title }];
  for (const chapter of writer.chapters) {
    const planned = plan?.chapters.find((entry) => entry.chapter_key === chapter.chapter_key);
    const scope = {
      scopeAliases: planned?.feature_aliases,
      scopeRules: planned ? [...planned.ontology_rule_ids, ...planned.derived_synthesis_ids] : undefined,
    };
    units.push({ key: chapter.chapter_key, text: chapter.title });
    units.push({ key: chapter.chapter_key, text: chapter.summary });
    units.push(...chapter.sections.map((unit) => ({ ...unit, key: unit.section_key, ...scope })));
    units.push(...[...chapter.tensions, ...chapter.resources, chapter.counter_expression]
      .map((unit) => ({ ...unit, key: chapter.chapter_key, ...scope })));
  }
  for (const signature of writer.additional_signatures) {
    const planned = plan?.additional_signatures.find((entry) => entry.signature_key === signature.signature_key);
    units.push({ key: signature.signature_key, text: signature.title });
    units.push({
      ...signature,
      key: signature.signature_key,
      scopeAliases: planned?.feature_aliases,
      scopeRules: planned?.ontology_rule_ids,
    });
  }
  if (writer.uncertainty_note) units.push({ ...writer.uncertainty_note, key: null });
  return units;
}

const SIGNS = "aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces";
const BODIES = "sun|moon|mercury|venus|mars|jupiter|saturn|uranus|neptune|pluto|(?:north|true|lunar)[ _-]node|ascendant|rising sign|midheaven";
const ZODIAC_SIGN = new RegExp(`\\b(?:${SIGNS})\\b`, "i");
const ASTROLOGICAL_BODY = new RegExp(`\\b(?:${BODIES})\\b`, "i");
const FACTUAL_ASTROLOGY = new RegExp(
  `\\b(?:${BODIES})\\b[^.!?;\\n]{0,30}\\b(?:in|at|conjuncts?|opposes?|squares?|trines?|sextiles?|opposition|conjunction|square|trine|sextile)\\b` +
  `|\\b(?:${SIGNS})\\s+(?:${BODIES})\\b|\\b(?:house\\s*\\d|\\d+(?:st|nd|rd|th)\\s+house|degrees?|longitude)\\b`,
  "i",
);

/** Inspect equivalent visible text consistently without changing the bound artifact bytes. */
function normalizeSafetyText(text: string): string {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/[’‘]/g, "'");
}

function sentences(text: string): string[] {
  return normalizeSafetyText(text)
    .split(/(?<=[.!?;])\s+|\n+/).map((sentence) => sentence.trim());
}

function hasAstrologicalClaim(sentence: string): boolean {
  // Compact placements ("Sun: Aries") and ordinary placement verbs need the
  // same ledger. A verb allowlist cannot cover how a body/sign fact is phrased.
  return FACTUAL_ASTROLOGY.test(sentence) ||
    (ASTROLOGICAL_BODY.test(sentence) && ZODIAC_SIGN.test(sentence));
}

/** Entire known limitation clauses only; another clause cannot borrow their negation. */
function isUncertaintyDisclosure(sentence: string): boolean {
  const text = sentence.replace(/[.!?]$/, "");
  return /^(?:(?:This chapter holds|The calculated evidence points to)\s+)?birth[- ]time accuracy (?:bounds what can be said about houses and angles|limits what this Pattern can say about houses, angles, and time-sensitive claims)$/i.test(text) ||
    /^(?:your |the )?birth time is (?:unknown|uncertain|approximate)$/i.test(text) ||
    /^(?:your |the )?birth time is (?:unknown|uncertain|approximate),? so (?:this pattern|this reading) (?:does not|doesn't|cannot) (?:use|interpret|include) (?:houses?(?: (?:and|or) angles?)?|angles?|house placements)$/i.test(text) ||
    /^without an exact birth time, (?:houses?(?: (?:and|or) angles?)?|angles?|house placements) cannot be (?:calculated|used|interpreted)$/i.test(text) ||
    /^(?:(?:your |the )?birth time is (?:unknown|uncertain|approximate),?\s+(?:so |and )?)?(?:houses?(?: and angles?)?|angles?|house (?:cusps|placements)|ascendant|midheaven|angle transits?|time-sensitive moon (?:positions?|details?)|(?:the )?moon(?:'s)? (?:sign|degree|longitude|house)) (?:are|is) (?:withheld|suppressed|unavailable|not calculated|not used)(?: (?:because (?:the |your )?birth time is (?:unknown|uncertain|approximate)|due to (?:the |your )?(?:unknown|uncertain|approximate) birth time))?$/i.test(text);
}

export function hasSuppressedPacketFeatureLeak(packet: PatternFactPacket): boolean {
  const suppressed = new Set(packet.uncertainty.suppressed_classes);
  return packet.features.some((feature) =>
    (suppressed.has("houses") && (feature.feature_class === "house_cusp" ||
      (feature.feature_class === "position" && feature.fact.house !== null))) ||
    (suppressed.has("angles") && feature.feature_class === "angle"));
}

function suppressedUnitLeaks(suppressed: ReadonlySet<string>, text: string): boolean {
  return sentences(text).some((sentence) => {
    if (isUncertaintyDisclosure(sentence)) return false;
    return (suppressed.has("houses") && /\b(?:houses?|house[ _-]?cusps?)\b/i.test(sentence)) ||
      (suppressed.has("angles") && /\b(?:ascendant|midheaven|rising (?:sign|point)|chart angles?)\b/i.test(sentence)) ||
      (suppressed.has("angle_transits") && (
        /\b(?:angle|angular)[ _-]?transits?\b/i.test(sentence) ||
        /\btransits?\b[^.!?\n]{0,80}\b(?:ascendant|midheaven|chart angles?)\b/i.test(sentence) ||
        /\b(?:ascendant|midheaven|chart angles?)\b[^.!?\n]{0,80}\btransits?\b/i.test(sentence))) ||
      (suppressed.has("moon_time_sensitive") && (
        /\bmoon(?:'s)?\s+(?:degree|longitude|house|sign)\b|\btime[ -]?sensitive\s+moon\b/i.test(sentence) ||
        /\bmoon\s+(?:is\s+)?(?:in|at)\s+\d/i.test(sentence) ||
        (/\bmoon\b/i.test(sentence) && ZODIAC_SIGN.test(sentence))));
  });
}

export function findSuppressedWriterLeak(packet: PatternFactPacket, writer: PatternWriterOutput): WriterUnit | null {
  const suppressed = new Set(packet.uncertainty.suppressed_classes);
  return writerUnits(writer).find((unit) => suppressedUnitLeaks(suppressed, unit.text)) ?? null;
}

export function hasSuppressedWriterLeak(packet: PatternFactPacket, writer: PatternWriterOutput): boolean {
  return findSuppressedWriterLeak(packet, writer) !== null;
}

const PROHIBITED_TRIGGER = /\b(?:diagnos(?:is|es|e[sd]?|ing|tic(?:ally|s)?)|predict(?:ions?|ed|s|ing|ive(?:ly|ness)?)?|fate(?:d|s)?|biograph(?:y|ies|ical(?:ly)?)|guarantee(?:s|d|ing)?|inevitab(?:le|ly|ility))\b/ig;

function prohibitedClaim(text: string): boolean {
  return sentences(text).some((sentence) => {
    // A qualifier belongs to one claim, never to the rest of a compound sentence.
    const clauses = sentence.split(/[,;:]|\b(?:but|yet|although|however|and)\b/i);
    return clauses.some((clause) => {
      const triggers = [...clause.matchAll(PROHIBITED_TRIGGER)];
      return triggers.some((trigger) => {
        const prefix = clause.slice(0, trigger.index);
        if (/\b(?:not|never|cannot|can't|doesn't|isn't)\s+(?:not|without)\b/i.test(prefix)) return true;
        // Reader optionality is not an asserted prediction. Keep this tied to
        // the bare verb and an open question, never a general negation bypass.
        // Other triggers in this clause and all companion clauses still run.
        if (trigger[0].toLowerCase() === "predict" && !sentence.includes("?") &&
          /^\s*you\s+(?:do\s+not|don't)\s+have\s+to\s+$/i.test(prefix) &&
          /^\s+what\b/i.test(clause.slice(trigger.index + trigger[0].length))) return false;
        // Only direct denials of the claim are safe. In particular, "without
        // doubt", "not only", and "cannot avoid your fate" are assertions.
        return !(
          /\b(?:not|never|no|neither|nor|cannot|can't|doesn't|don't|won't|isn't|aren't)\s+(?:(?:a|an|the|any|your|of|as|is|are|be|become|make|provide|offer|constitute|represent|imply)\s+){0,4}$/i.test(prefix) ||
          /\b(?:nothing(?: here)?|none of this|neither outcome)\s+(?:is|are)\s*$/i.test(prefix) ||
          /\b(?:rather than|without)\s+(?:(?:a|an|the|any)\s+)?$/i.test(prefix) ||
          /^\s*(?:avoid reading this as|you won't find)\s+(?:a|an)\s*$/i.test(prefix)
        );
      });
    });
  });
}

export function findUnqualifiedProhibitedClaim(writer: PatternWriterOutput): WriterUnit | null {
  return writerUnits(writer).find((unit) => prohibitedClaim(unit.text)) ?? null;
}

function sourceDependencyResolver(ontology: readonly PatternOntologyRecord[], sources: ReadonlySet<string>) {
  const byId = new Map(ontology.map((record) => [record.id, record]));
  const visiting = new Set<string>();
  const resolved = new Map<string, boolean>();
  const visit = (id: string): boolean => {
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;
    const record = byId.get(id);
    if (!record || visiting.has(id)) return false;
    visiting.add(id);
    const valid = record.meaning_class === "source_supported"
      ? record.source_fragment_ids.length > 0 && record.source_fragment_ids.every((source) => sources.has(source))
      : record.meaning_class === "derived_synthesis" && record.input_meaning_ids.length >= 2 &&
        record.input_meaning_ids.every(visit);
    visiting.delete(id);
    resolved.set(id, valid);
    return valid;
  };
  return visit;
}

function isMandatory(feature: NatalFeature): boolean {
  return feature.feature_class === "uncertainty" ||
    (feature.feature_class === "position" && (feature.body === "sun" || feature.body === "moon")) ||
    (feature.feature_class === "aspect" && feature.orb <= 6 &&
      [feature.body_a, feature.body_b].some((body) => body === "sun" || body === "moon"));
}

function mandatoryCoverageFails(input: PatternPublicationSafetyInput): boolean {
  const coreUnits = input.writer.chapters.flatMap((chapter) =>
    [...chapter.sections, ...chapter.tensions, ...chapter.resources, chapter.counter_expression]);
  const allUnits = [...coreUnits, ...input.writer.additional_signatures,
    ...(input.writer.uncertainty_note ? [input.writer.uncertainty_note] : [])];
  return input.features.some((feature) => {
    if (!isMandatory(feature)) return false;
    const rows = input.selectionManifest.accounting.filter((entry) => entry.feature_id === feature.feature_id);
    const accounting = rows[0];
    const coverage = feature.feature_class === "uncertainty" ? "mandatory_any" : "mandatory_core";
    const packet = input.packet.features.find((entry) => entry.alias === accounting?.alias);
    const { feature_id: _id, feature_class: _class, policy_id: _policy, policy_version: _version, ...fact } = feature;
    if (rows.length !== 1 || !accounting?.alias || accounting.coverage !== coverage ||
      input.selectionManifest.accounting.filter((entry) => entry.alias === accounting.alias).length !== 1 ||
      packet?.coverage !== coverage || packet.feature_class !== feature.feature_class) return true;
    if (canonicalJson(packet.fact) !== canonicalJson(fact)) return true;
    const alias = accounting.alias;
    const planned = coverage === "mandatory_core" ? input.plan.chapters :
      [...input.plan.chapters, ...input.plan.additional_signatures];
    const units = coverage === "mandatory_core" ? coreUnits : allUnits;
    return !planned.some((entry) => entry.feature_aliases.includes(alias)) ||
      !units.some((unit) => unit.feature_aliases.includes(alias));
  }) || (input.packet.uncertainty.required_language_rule_ids.length > 0 &&
    (!input.writer.uncertainty_note ||
      !sentences(input.writer.uncertainty_note.text).some(isUncertaintyDisclosure) ||
      input.packet.uncertainty.required_language_rule_ids.some((rule) =>
      !input.writer.uncertainty_note!.ontology_rule_ids.includes(rule))));
}

const PRIVATE_KEYS = new Set([
  "feature_aliases", "ontology_rule_ids", "derived_synthesis_ids", "claim_class",
  "plan_hash", "candidate_hash", "semantic_verdict_hash", "feature_id", "feature_set_hash",
  "chart_fingerprint", "chart_fingerprint_hash", "user_id", "chart_id", "generation_id",
  "claim_id", "consent_id", "crypto_subject", "birth_date", "birth_time_local",
  "utc_instant", "birthplace", "latitude", "longitude",
]);

function privateTextLeaks(text: string): boolean {
  return /\b(?:nft|ont|pgen|usr|cht|srcf|cns|pgc|clu)_[a-z0-9_-]+\b|\bf\d{3}\b|\bsha256:[a-f0-9]{64}\b/i
    .test(normalizeSafetyText(text));
}

function publicProjectionLeaks(value: unknown): boolean {
  if (typeof value === "string") return privateTextLeaks(value);
  if (Array.isArray(value)) return value.some(publicProjectionLeaks);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    PRIVATE_KEYS.has(normalizeSafetyText(key).toLowerCase()) || publicProjectionLeaks(child));
}

/** Deterministic safety over the exact bound candidate; it is not a semantic entailment claim. */
export function evaluatePatternPublicationSafety(input: PatternPublicationSafetyInput): PatternPublicationSafetyResult {
  const failures = new Map<PatternPublicationSafetyFailureCode, string | null>();
  const add = (code: PatternPublicationSafetyFailureCode, key: string | null = null) => {
    if (!failures.has(code)) failures.set(code, key);
  };
  const units = writerUnits(input.writer, input.plan);
  const suppressed = findSuppressedWriterLeak(input.packet, input.writer);
  if (hasSuppressedPacketFeatureLeak(input.packet) || suppressed) add("suppressed_feature_leak", suppressed?.key);
  const prohibited = findUnqualifiedProhibitedClaim(input.writer);
  if (prohibited) add("prohibited_claim", prohibited.key);

  const normalizedClaim = (text: string) => normalizeSafetyText(text).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const prohibitedPhrases = input.ontology.flatMap((record) => record.prohibited_claims)
    .map(normalizedClaim).filter((claim) => claim.split(" ").length >= 3);
  for (const unit of units) {
    const text = ` ${normalizedClaim(unit.text)} `;
    if (prohibitedPhrases.some((claim) => text.includes(` ${claim} `))) add("prohibited_claim", unit.key);
  }

  const packet = new Map(input.packet.features.map((feature) => [feature.alias, feature]));
  const ontology = new Map(input.ontology.map((record) => [record.id, record]));
  const dependencyValid = sourceDependencyResolver(input.ontology, input.sourceFragmentIds);
  for (const unit of units) {
    if (!unit.feature_aliases) {
      if (sentences(unit.text).some((sentence) => !isUncertaintyDisclosure(sentence) && hasAstrologicalClaim(sentence))) {
        add("uncited_astrological_claim", unit.key);
      }
      continue;
    }
    const aliases = unit.feature_aliases;
    const rules = [...(unit.ontology_rule_ids ?? []), ...(unit.derived_synthesis_ids ?? [])];
    if (aliases.length === 0 || !unit.ontology_rule_ids?.length ||
      aliases.some((alias) => !packet.has(alias) || (unit.scopeAliases && !unit.scopeAliases.includes(alias))) ||
      rules.some((rule) => unit.scopeRules && !unit.scopeRules.includes(rule))) {
      add("uncited_astrological_claim", unit.key);
    }
    const available = new Set(aliases.flatMap((alias) => packet.get(alias)?.ontology_rule_ids ?? []));
    const authorized = (id: string, visiting = new Set<string>()): boolean => {
      if (available.has(id)) return true;
      const record = ontology.get(id);
      if (!record || record.meaning_class !== "derived_synthesis" || visiting.has(id)) return false;
      return record.input_meaning_ids.length >= 2 &&
        record.input_meaning_ids.every((child) => authorized(child, new Set([...visiting, id])));
    };
    const authorizedRules = rules.filter((rule) => authorized(rule) &&
      (!unit.scopeRules || unit.scopeRules.includes(rule)));
    if (authorizedRules.length !== rules.length) add("uncited_astrological_claim", unit.key);
    // An invented or out-of-plan writer reference can be corrected. Only a
    // reference authorized by the bound packet/plan can expose broken authority.
    if (authorizedRules.some((rule) => !dependencyValid(rule))) add("source_dependency_failure", unit.key);
  }
  if (mandatoryCoverageFails(input)) add("mandatory_feature_omission");
  if (publicProjectionLeaks(input.publicProjection) || units.some((unit) => privateTextLeaks(unit.text))) {
    add("private_projection_leak");
  }
  if (findSemanticVerdictProblem(input.verdict) || input.verdict.verdict !== "pass") add("semantic_refusal");
  return {
    policyVersion: PATTERN_PUBLICATION_SAFETY_POLICY_VERSION,
    failures: [...failures].sort(([left], [right]) => left.localeCompare(right))
      .map(([code, targetKey]) => ({ code, targetKey })),
  };
}
