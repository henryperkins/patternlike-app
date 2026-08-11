/**
 * Deterministic validation of one model candidate.
 *
 * There is no human review and no second model behind this file: what it
 * accepts is published. It therefore answers one question per check, and every
 * check is mechanical — the accepted astrology vocabulary is the union of what
 * the supplied facts declare, not a judgement about whether a particular
 * sentence sounds plausible.
 *
 * A candidate that fails one check is rejected whole. It is never partially
 * published and never repaired with deterministic prose, because there is none.
 */

import {
  GENERATED_PARAGRAPH_ROLES,
  M5_OUTPUT_SCHEMA,
  M5_SCHEMA_VERSION,
  type ContextRefV5,
  type GeneratedParagraphRole,
  type GroundedUnit,
  type ParagraphRoleV5,
  type ReadingGenerationOutput,
} from "@patternlike/shared";

import {
  CANDIDATE_CHECKS,
  VALIDATION_POLICY_VERSION,
  type CandidateFailure,
  type CandidateValidationResult,
  type ConstrainedContextRef,
  type ConstrainedFact,
  type PreparedConstrainedReadingInput,
  type ValidatedReadingUnit,
} from "./constrained-types.js";
import {
  CONTEXT_ATTRIBUTION_RULES,
  CONTEXT_USE_UNITS,
  LEAKAGE_RULES,
  MARKUP_RULES,
  PERSONALIZATION_RULES,
  SAFETY_RULES,
  extractAspects,
  extractBodies,
  extractClockTimes,
  extractCyclePhases,
  extractDates,
  extractDegrees,
  extractHouses,
  extractLunarPhases,
  extractSigns,
  firstMatch,
  type UnitKind,
} from "./candidate-policy.js";

interface CandidateUnit {
  kind: UnitKind;
  role: ParagraphRoleV5;
  text: string;
  fact_ids: string[];
  context_refs: string[];
  max_chars: number;
}

/** Everything the supplied facts license, computed once per candidate. */
interface Vocabulary {
  bodies: ReadonlySet<string>;
  signs: ReadonlySet<string>;
  aspects: ReadonlySet<string>;
  houses: ReadonlySet<number>;
  lunarPhases: ReadonlySet<string>;
  cyclePhases: ReadonlySet<string>;
  degrees: readonly number[];
  dates: ReadonlySet<string>;
  monthDays: ReadonlySet<string>;
  clocks: ReadonlySet<string>;
}

const ROLE_ORDER: ReadonlyMap<GeneratedParagraphRole, number> = new Map(
  GENERATED_PARAGRAPH_ROLES.map((role, index) => [role, index]),
);

function isGroundedUnit(value: unknown): value is GroundedUnit {
  if (typeof value !== "object" || value === null) return false;
  const unit = value as Record<string, unknown>;
  return (
    typeof unit.text === "string" &&
    Array.isArray(unit.fact_ids) &&
    unit.fact_ids.every((id) => typeof id === "string") &&
    Array.isArray(unit.context_refs) &&
    unit.context_refs.every((ref) => typeof ref === "string")
  );
}

function shapeFailure(candidate: ReadingGenerationOutput): string | null {
  if (typeof candidate !== "object" || candidate === null) return "not_an_object";
  // The candidate arrives from a provider, so it is inspected as unknown data
  // rather than trusted at its declared type.
  const raw: Record<string, unknown> = candidate as unknown as Record<string, unknown>;
  for (const key of ["schema_version", "output_schema", "local_date", "locale", "headline"]) {
    if (typeof raw[key] !== "string") return "missing_scalar";
  }
  if (!isGroundedUnit(raw.lead)) return "malformed_lead";
  if (!isGroundedUnit(raw.reflection_prompt)) return "malformed_reflection";
  if (raw.uncertainty_note !== null && !isGroundedUnit(raw.uncertainty_note)) {
    return "malformed_uncertainty_note";
  }
  if (!Array.isArray(raw.paragraphs)) return "malformed_paragraphs";
  for (const paragraph of raw.paragraphs as unknown[]) {
    if (!isGroundedUnit(paragraph)) return "malformed_paragraph";
    const role = (paragraph as unknown as Record<string, unknown>).role;
    if (typeof role !== "string" || !ROLE_ORDER.has(role as GeneratedParagraphRole)) {
      return "unknown_paragraph_role";
    }
  }
  return null;
}

function buildUnits(
  candidate: ReadingGenerationOutput,
  maxParagraphChars: number,
  maxLeadChars: number,
  maxReflectionChars: number,
): CandidateUnit[] {
  const units: CandidateUnit[] = [
    {
      kind: "lead",
      role: "primary_theme",
      text: candidate.lead.text,
      fact_ids: candidate.lead.fact_ids,
      context_refs: candidate.lead.context_refs,
      max_chars: maxLeadChars,
    },
  ];
  for (const paragraph of candidate.paragraphs) {
    units.push({
      kind: "paragraph",
      role: paragraph.role,
      text: paragraph.text,
      fact_ids: paragraph.fact_ids,
      context_refs: paragraph.context_refs,
      max_chars: maxParagraphChars,
    });
  }
  units.push({
    kind: "reflection",
    role: "reflection",
    text: candidate.reflection_prompt.text,
    fact_ids: candidate.reflection_prompt.fact_ids,
    context_refs: candidate.reflection_prompt.context_refs,
    max_chars: maxReflectionChars,
  });
  if (candidate.uncertainty_note) {
    units.push({
      kind: "uncertainty_note",
      role: "uncertainty_notice",
      text: candidate.uncertainty_note.text,
      fact_ids: candidate.uncertainty_note.fact_ids,
      context_refs: candidate.uncertainty_note.context_refs,
      max_chars: maxParagraphChars,
    });
  }
  return units;
}

function buildVocabulary(
  facts: readonly ConstrainedFact[],
  localDate: string,
): Vocabulary {
  const bodies = new Set<string>();
  const signs = new Set<string>();
  const aspects = new Set<string>();
  const houses = new Set<number>();
  const lunarPhases = new Set<string>();
  const cyclePhases = new Set<string>();
  const degrees: number[] = [];
  const dates = new Set<string>([localDate]);
  const clocks = new Set<string>();

  for (const fact of facts) {
    const a = fact.attributes;
    for (const body of a.bodies) bodies.add(body);
    for (const sign of a.signs) signs.add(sign);
    for (const house of a.houses) houses.add(house);
    for (const degree of a.degrees) degrees.push(degree);
    for (const date of a.dates) dates.add(date);
    for (const timestamp of a.timestamps) {
      dates.add(timestamp.slice(0, 10));
      clocks.add(timestamp.slice(11, 16));
    }
    if (a.aspect) aspects.add(a.aspect);
    if (a.phase) cyclePhases.add(a.phase);
    if (a.lunar_phase) lunarPhases.add(a.lunar_phase);
  }

  const monthDays = new Set<string>([...dates].map((date) => date.slice(5)));
  return {
    bodies,
    signs,
    aspects,
    houses,
    lunarPhases,
    cyclePhases,
    degrees,
    dates,
    monthDays,
    clocks,
  };
}

/**
 * A stated degree is licensed when some calculated degree rounds to it.
 *
 * The tolerance is half of the last place the candidate itself chose, so
 * "1.77" is accepted for a fact of 1.774002 while "1.8" is accepted only if
 * nothing more precise contradicts it. The model may round; it may not invent.
 */
function degreeLicensed(mention: { value: number; decimals: number }, degrees: readonly number[]): boolean {
  const tolerance = 0.5 * Math.pow(10, -mention.decimals);
  return degrees.some((degree) => Math.abs(degree - mention.value) <= tolerance + 1e-9);
}

/**
 * Whether a unit makes an astrological claim and therefore needs evidence.
 *
 * Dates are deliberately absent. The candidate is required to echo the reader's
 * local date, so a date alone does not distinguish "the sky does this on the
 * 2nd" from "today is the 30th"; an uncalculated date is caught by the
 * vocabulary check instead, where the distinction does not matter.
 */
function hasAstrologyClaim(text: string): boolean {
  return (
    extractBodies(text).length > 0 ||
    extractSigns(text).length > 0 ||
    extractAspects(text).length > 0 ||
    extractLunarPhases(text).length > 0 ||
    extractCyclePhases(text).length > 0 ||
    extractHouses(text).length > 0 ||
    extractDegrees(text).length > 0
  );
}

function vocabularyFailure(text: string, vocabulary: Vocabulary): string | null {
  for (const body of extractBodies(text)) {
    if (!vocabulary.bodies.has(body)) return "unsupported_body";
  }
  for (const sign of extractSigns(text)) {
    if (!vocabulary.signs.has(sign)) return "unsupported_sign";
  }
  for (const aspect of extractAspects(text)) {
    if (!vocabulary.aspects.has(aspect)) return "unsupported_aspect";
  }
  for (const phase of extractLunarPhases(text)) {
    if (!vocabulary.lunarPhases.has(phase)) return "unsupported_lunar_phase";
  }
  for (const phase of extractCyclePhases(text)) {
    if (!vocabulary.cyclePhases.has(phase)) return "unsupported_phase";
  }
  for (const house of extractHouses(text)) {
    if (!vocabulary.houses.has(house)) return "unsupported_house";
  }
  for (const degree of extractDegrees(text)) {
    if (!degreeLicensed(degree, vocabulary.degrees)) return "unsupported_degree";
  }
  for (const date of extractDates(text)) {
    const known = date.hasYear
      ? vocabulary.dates.has(date.key)
      : vocabulary.monthDays.has(date.key);
    if (!known) return "unsupported_date";
  }
  for (const clock of extractClockTimes(text)) {
    if (!vocabulary.clocks.has(clock)) return "unsupported_timestamp";
  }
  return null;
}

/** The words a required uncertainty note has to actually use. */
function uncertaintyTerms(prepared: PreparedConstrainedReadingInput): RegExp[] {
  const terms: RegExp[] = [/\bbirth time\b/i];
  for (const feature of prepared.request.suppressed_features) {
    if (feature === "houses") terms.push(/\bhouses?\b/i);
    if (feature === "angles" || feature === "angle_transits") {
      terms.push(/\bangles?\b|\bascendant\b|\bmidheaven\b|\brising\b/i);
    }
    if (feature === "moon_time_sensitive") terms.push(/\bmoon\b/i);
  }
  return terms;
}

export function validateReadingCandidate(
  candidate: ReadingGenerationOutput,
  prepared: PreparedConstrainedReadingInput,
): CandidateValidationResult {
  const failures: CandidateFailure[] = [];
  const fail = (code: CandidateFailure["code"], detail_code: string): void => {
    if (!failures.some((f) => f.code === code)) failures.push({ code, detail_code });
  };

  const shape = shapeFailure(candidate);
  if (shape) {
    return {
      ok: false,
      policy_version: VALIDATION_POLICY_VERSION,
      failures: [{ code: "schema_shape", detail_code: shape }],
    };
  }

  const composition = prepared.request.composition;
  const units = buildUnits(
    candidate,
    composition.paragraph_max_chars,
    composition.lead_max_chars,
    composition.reflection_max_chars,
  );
  const factIndex = new Map<string, ConstrainedFact>(
    prepared.selected_facts.map((fact) => [fact.fact_id, fact]),
  );
  const contextIndex = new Map<string, ConstrainedContextRef>(
    prepared.selected_context.map((ref) => [ref.context_ref, ref]),
  );
  const vocabulary = buildVocabulary(prepared.selected_facts, prepared.request.local_date);

  // Echo -------------------------------------------------------------------
  if (candidate.schema_version !== M5_SCHEMA_VERSION) fail("echo", "schema_version_mismatch");
  if (candidate.output_schema !== M5_OUTPUT_SCHEMA) fail("echo", "output_schema_mismatch");
  if (candidate.local_date !== prepared.request.local_date) fail("echo", "local_date_mismatch");
  if (candidate.locale !== prepared.request.locale) fail("echo", "locale_mismatch");

  // Role order -------------------------------------------------------------
  const allowedRoles = new Set(composition.allowed_paragraph_roles);
  const seenRoles = new Set<GeneratedParagraphRole>();
  let previousIndex = -1;
  for (const paragraph of candidate.paragraphs) {
    if (!allowedRoles.has(paragraph.role)) fail("role_order", "role_not_allowed");
    if (seenRoles.has(paragraph.role)) fail("role_order", "duplicate_role");
    seenRoles.add(paragraph.role);
    const index = ROLE_ORDER.get(paragraph.role)!;
    if (index <= previousIndex) fail("role_order", "role_out_of_order");
    previousIndex = index;
  }
  if (
    candidate.paragraphs.length < composition.min_paragraphs ||
    candidate.paragraphs.length > composition.max_paragraphs
  ) {
    fail("role_order", "paragraph_count_out_of_bounds");
  }

  // Length -----------------------------------------------------------------
  if (
    candidate.headline.trim().length === 0 ||
    candidate.headline.length > composition.headline_max_chars
  ) {
    fail("length_bounds", "headline_out_of_bounds");
  }
  for (const unit of units) {
    if (unit.text.trim().length === 0) fail("length_bounds", "empty_unit");
    else if (unit.text.length > unit.max_chars) fail("length_bounds", "unit_too_long");
  }

  // References, lanes, grounding, and evidence agreement -------------------
  for (const unit of units) {
    if (new Set(unit.fact_ids).size !== unit.fact_ids.length) {
      fail("evidence_counts", "duplicate_fact_reference");
    }
    if (new Set(unit.context_refs).size !== unit.context_refs.length) {
      fail("evidence_counts", "duplicate_context_reference");
    }
    for (const factId of unit.fact_ids) {
      if (!factIndex.has(factId)) fail("known_references", "unknown_fact_reference");
    }
    for (const contextRef of unit.context_refs) {
      const pin = contextIndex.get(contextRef);
      if (!pin) {
        fail("known_references", "unknown_context_reference");
        continue;
      }
      if (!CONTEXT_USE_UNITS[pin.allowed_use].has(unit.kind)) {
        fail("context_lane", "context_use_not_permitted_here");
      }
    }
    const substantive = hasAstrologyClaim(unit.text);
    if ((substantive || unit.kind === "lead") && unit.fact_ids.length === 0) {
      fail("grounding", "astrology_without_fact");
    }
  }

  // Vocabulary --------------------------------------------------------------
  for (const text of [candidate.headline, ...units.map((u) => u.text)]) {
    const reason = vocabularyFailure(text, vocabulary);
    if (reason) fail("vocabulary", reason);
  }

  // Uncertainty -------------------------------------------------------------
  if (composition.uncertainty_note_required) {
    const note = candidate.uncertainty_note;
    if (!note || note.text.trim().length === 0) {
      fail("uncertainty", "required_note_missing");
    } else if (!uncertaintyTerms(prepared).some((term) => term.test(note.text))) {
      fail("uncertainty", "note_names_nothing");
    }
  } else if (candidate.uncertainty_note !== null) {
    fail("uncertainty", "unrequested_note");
  }

  // Scope, laundering, markup, leakage, safety ------------------------------
  for (const unit of units) {
    const cited = unit.fact_ids.map((id) => factIndex.get(id)).filter((f): f is ConstrainedFact => !!f);
    if (cited.length > 0 && cited.every((fact) => fact.scope === "collective")) {
      const reason = firstMatch(PERSONALIZATION_RULES, unit.text);
      if (reason) fail("collective_scope", reason);
    }
  }
  for (const text of [candidate.headline, ...units.map((u) => u.text)]) {
    const attribution = firstMatch(CONTEXT_ATTRIBUTION_RULES, text);
    if (attribution) fail("context_not_evidence", attribution);
    const markup = firstMatch(MARKUP_RULES, text);
    if (markup) fail("markup", markup);
    const leakage = firstMatch(LEAKAGE_RULES, text);
    if (leakage) fail("instruction_leakage", leakage);
    const safety = firstMatch(SAFETY_RULES, text);
    if (safety) fail("safety", safety);
  }

  if (failures.length > 0) {
    return { ok: false, policy_version: VALIDATION_POLICY_VERSION, failures };
  }

  const resolved: ValidatedReadingUnit[] = units.map((unit, index) => ({
    role: unit.role,
    order: index + 1,
    text: unit.text,
    fact_refs: unit.fact_ids.map((id) => {
      const fact = factIndex.get(id)!;
      return {
        fact_id: fact.fact_id,
        fact_class: fact.fact_class,
        label: fact.label,
        scope: fact.scope,
      };
    }),
    context_refs: unit.context_refs.map((ref): ContextRefV5 => {
      const pin = contextIndex.get(ref)!;
      return {
        private_ref: pin.context_ref,
        category: pin.category,
        allowed_use: pin.allowed_use,
      };
    }),
  }));

  return {
    ok: true,
    validation: {
      status: "passed",
      policy_version: VALIDATION_POLICY_VERSION,
      checks: CANDIDATE_CHECKS.map((code) => ({ code, passed: true as const })),
    },
    units: resolved,
  };
}
