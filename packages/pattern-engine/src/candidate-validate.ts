import type {
  PatternFactPacket,
  PatternOntologyRecord,
  PatternPlan,
  PatternWriterOutput,
  PatternWriterProseUnit,
} from "@patternlike/shared";
import {
  CHAPTER_WORD_MAX,
  CHAPTER_WORD_MIN,
  LIST_ITEM_MAX,
  PARAGRAPH_WORD_MAX,
  SECTIONS_MAX,
  SECTIONS_MIN,
  SIGNATURE_WORD_MAX,
  SIGNATURE_WORD_MIN,
  SPARSE_CHAPTER_WORD_MIN,
  SPARSE_TOTAL_WORD_MIN,
  TITLE_CHAR_MAX,
  TOTAL_WORD_MAX,
  TOTAL_WORD_MIN,
  UNCERTAINTY_WORD_MAX,
  UNCERTAINTY_WORD_MIN,
} from "./policy.js";
import type { CandidateValidationResult, ValidationFailure } from "./types.js";
import { wordCount } from "./words.js";

function unitWords(unit: { text: string } | null | undefined): number {
  return unit ? wordCount(unit.text) : 0;
}

function chapterWords(chapter: PatternWriterOutput["chapters"][number]): number {
  return (
    wordCount(chapter.summary) +
    chapter.sections.reduce((sum, section) => sum + wordCount(section.text), 0) +
    chapter.tensions.reduce((sum, unit) => sum + wordCount(unit.text), 0) +
    chapter.resources.reduce((sum, unit) => sum + wordCount(unit.text), 0) +
    wordCount(chapter.counter_expression.text)
  );
}

function collectUnits(output: PatternWriterOutput): Array<{ key: string; unit: PatternWriterProseUnit | PatternWriterOutput["chapters"][number]["sections"][number] }> {
  const units: Array<{ key: string; unit: PatternWriterProseUnit | PatternWriterOutput["chapters"][number]["sections"][number] }> = [];
  for (const chapter of output.chapters) {
    for (const section of chapter.sections) units.push({ key: section.section_key, unit: section });
    chapter.tensions.forEach((unit, index) => units.push({ key: `${chapter.chapter_key}:tension:${index}`, unit }));
    chapter.resources.forEach((unit, index) => units.push({ key: `${chapter.chapter_key}:resource:${index}`, unit }));
    units.push({ key: `${chapter.chapter_key}:counter`, unit: chapter.counter_expression });
  }
  if (output.uncertainty_note) {
    units.push({ key: "uncertainty", unit: output.uncertainty_note });
  }
  return units;
}

export function validatePatternCandidate(
  output: PatternWriterOutput,
  plan: PatternPlan,
  packet: PatternFactPacket,
  ontology: readonly PatternOntologyRecord[],
): CandidateValidationResult {
  const failures: ValidationFailure[] = [];
  if (output.schema_version !== "0.7.0") {
    failures.push({ code: "schema_version", message: "writer schema_version must be 0.7.0" });
  }
  if (output.title.length > TITLE_CHAR_MAX) {
    failures.push({ code: "title_too_long", message: "document title" });
  }
  if (output.chapters.length !== plan.chapters.length) {
    failures.push({ code: "chapter_mismatch", message: "writer chapters must match the frozen plan" });
  }

  const planChapters = new Map(plan.chapters.map((chapter) => [chapter.chapter_key, chapter]));
  const planSignatures = new Map(plan.additional_signatures.map((signature) => [signature.signature_key, signature]));
  const ontologyIds = new Set(ontology.map((record) => record.id));
  const packetByAlias = new Map(packet.features.map((feature) => [feature.alias, feature]));
  const sparse = packet.selection_constraints.sparse_pattern;
  const chapterMin = sparse ? SPARSE_CHAPTER_WORD_MIN : CHAPTER_WORD_MIN;
  let total = wordCount(output.title);

  for (const chapter of output.chapters) {
    const planned = planChapters.get(chapter.chapter_key);
    if (!planned) {
      failures.push({ code: "unknown_chapter_key", message: chapter.chapter_key });
      continue;
    }
    if (chapter.title.length > TITLE_CHAR_MAX) {
      failures.push({ code: "title_too_long", message: chapter.chapter_key });
    }
    if (chapter.sections.length < SECTIONS_MIN || chapter.sections.length > SECTIONS_MAX) {
      failures.push({ code: "section_count", message: chapter.chapter_key });
    }
    if (chapter.tensions.length < 1 || chapter.tensions.length > LIST_ITEM_MAX) {
      failures.push({ code: "tension_count", message: chapter.chapter_key });
    }
    if (chapter.resources.length > LIST_ITEM_MAX) {
      failures.push({ code: "resource_count", message: chapter.chapter_key });
    }
    const allowed = new Set(planned.feature_aliases);
    const allowedRules = new Set(planned.ontology_rule_ids);
    const checkRefs = (key: string, aliases: readonly string[], rules: readonly string[]) => {
      if (aliases.length < 1) failures.push({ code: "empty_claim_ledger", message: key });
      for (const alias of aliases) {
        if (!allowed.has(alias) || !packetByAlias.has(alias)) {
          failures.push({ code: "unassigned_alias", message: `${key}:${alias}` });
        }
      }
      for (const rule of rules) {
        if (!ontologyIds.has(rule)) failures.push({ code: "unknown_rule", message: `${key}:${rule}` });
        else if (!allowedRules.has(rule) && !planned.derived_synthesis_ids.includes(rule)) {
          failures.push({ code: "unauthorized_rule", message: `${key}:${rule}` });
        }
      }
    };
    for (const section of chapter.sections) {
      if (wordCount(section.text) > PARAGRAPH_WORD_MAX) {
        failures.push({ code: "paragraph_too_long", message: section.section_key });
      }
      checkRefs(section.section_key, section.feature_aliases, section.ontology_rule_ids);
    }
    chapter.tensions.forEach((unit, index) => checkRefs(`${chapter.chapter_key}:t${index}`, unit.feature_aliases, unit.ontology_rule_ids));
    chapter.resources.forEach((unit, index) => checkRefs(`${chapter.chapter_key}:r${index}`, unit.feature_aliases, unit.ontology_rule_ids));
    checkRefs(`${chapter.chapter_key}:counter`, chapter.counter_expression.feature_aliases, chapter.counter_expression.ontology_rule_ids);
    if (chapter.counter_expression.claim_class !== "counter_expression") {
      failures.push({ code: "counter_class", message: chapter.chapter_key });
    }
    const words = chapterWords(chapter);
    total += words;
    if (words < chapterMin || words > CHAPTER_WORD_MAX) {
      failures.push({ code: "chapter_word_count", message: `${chapter.chapter_key}:${words}` });
    }
    for (const alias of planned.feature_aliases) {
      const used = chapter.sections.some((section) => section.feature_aliases.includes(alias))
        || chapter.tensions.some((unit) => unit.feature_aliases.includes(alias))
        || chapter.resources.some((unit) => unit.feature_aliases.includes(alias))
        || chapter.counter_expression.feature_aliases.includes(alias);
      if (!used) failures.push({ code: "missing_planned_alias", message: `${chapter.chapter_key}:${alias}` });
    }
  }

  if (output.additional_signatures.length !== plan.additional_signatures.length) {
    failures.push({ code: "signature_mismatch", message: "writer signatures must match the frozen plan" });
  }
  for (const signature of output.additional_signatures) {
    const planned = planSignatures.get(signature.signature_key);
    if (!planned) {
      failures.push({ code: "unknown_signature_key", message: signature.signature_key });
      continue;
    }
    const words = wordCount(signature.text);
    total += words;
    if (words < SIGNATURE_WORD_MIN || words > SIGNATURE_WORD_MAX) {
      failures.push({ code: "signature_word_count", message: signature.signature_key });
    }
    for (const alias of signature.feature_aliases) {
      if (!planned.feature_aliases.includes(alias)) {
        failures.push({ code: "unassigned_alias", message: `${signature.signature_key}:${alias}` });
      }
    }
  }

  const uncertaintyRequired = packet.uncertainty.required_language_rule_ids.length > 0;
  if (uncertaintyRequired && !output.uncertainty_note) {
    failures.push({ code: "missing_uncertainty_note", message: "uncertainty is required" });
  }
  if (output.uncertainty_note) {
    const words = unitWords(output.uncertainty_note);
    total += words;
    if (words < UNCERTAINTY_WORD_MIN || words > UNCERTAINTY_WORD_MAX) {
      failures.push({ code: "uncertainty_word_count", message: String(words) });
    }
    if (output.uncertainty_note.claim_class !== "uncertainty") {
      failures.push({ code: "uncertainty_class", message: "uncertainty_note" });
    }
  }

  const minTotal = sparse ? SPARSE_TOTAL_WORD_MIN : TOTAL_WORD_MIN;
  if (total < minTotal || total > TOTAL_WORD_MAX) {
    failures.push({ code: "total_word_count", message: String(total) });
  }

  for (const { key, unit } of collectUnits(output)) {
    if (!("feature_aliases" in unit) || unit.feature_aliases.length < 1) {
      failures.push({ code: "empty_claim_ledger", message: key });
    }
  }

  return { ok: failures.length === 0, failures };
}
