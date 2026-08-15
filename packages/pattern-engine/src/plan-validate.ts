import type {
  PatternFactPacket,
  PatternOntologyRecord,
  PatternPlannerOutput,
} from "@patternlike/shared";
import { TITLE_CHAR_MAX } from "./policy.js";
import type { PlanValidationResult, ValidationFailure } from "./types.js";

const OMISSION_REASONS = new Set([
  "redundant_with_chapter",
  "capacity_omitted",
  "cluster_incompatible",
  "sparse_document",
]);

function authorizedRules(
  packet: PatternFactPacket,
  ontology: readonly PatternOntologyRecord[],
  aliases: readonly string[],
): Set<string> {
  const byAlias = new Map(packet.features.map((feature) => [feature.alias, feature]));
  const ids = new Set<string>();
  for (const alias of aliases) {
    const feature = byAlias.get(alias);
    if (!feature) continue;
    for (const id of feature.ontology_rule_ids) ids.add(id);
  }
  for (const record of ontology) {
    if (record.meaning_class === "derived_synthesis" && record.input_meaning_ids.every((id) => ids.has(id))) {
      ids.add(record.id);
    }
  }
  return ids;
}

function tensionIdsFor(records: readonly PatternOntologyRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    if (record.tensions.length > 0) ids.add(`${record.id}#tension`);
    if (record.counter_expressions.length > 0) ids.add(`${record.id}#counter`);
    if (record.normalized_proposition.length > 0) ids.add(`${record.id}#resource`);
  }
  return ids;
}

/**
 * Deterministic plan validator. A valid plan is later hashed by the Worker;
 * this function never hashes and never invents a sparse_pattern flag.
 */
export function validatePatternPlan(
  output: PatternPlannerOutput,
  packet: PatternFactPacket,
  ontology: readonly PatternOntologyRecord[],
): PlanValidationResult {
  const failures: ValidationFailure[] = [];
  const min = packet.selection_constraints.core_chapters_min;
  const max = packet.selection_constraints.core_chapters_max;
  if (output.schema_version !== "0.7.0") {
    failures.push({ code: "schema_version", message: "planner schema_version must be 0.7.0" });
  }
  if (output.chapters.length < min || output.chapters.length > max) {
    failures.push({
      code: "chapter_count",
      message: `expected ${min}-${max} chapters, received ${output.chapters.length}`,
    });
  }
  if (output.additional_signatures.length > packet.selection_constraints.additional_signatures_max) {
    failures.push({ code: "signature_count", message: "too many additional signatures" });
  }

  const packetAliases = new Set(packet.features.map((feature) => feature.alias));
  const mandatoryCore = new Set(
    packet.features.filter((feature) => feature.coverage === "mandatory_core").map((feature) => feature.alias),
  );
  const mandatoryAny = new Set(
    packet.features.filter((feature) => feature.coverage === "mandatory_any").map((feature) => feature.alias),
  );
  const eligible = new Set(
    packet.features.filter((feature) => feature.coverage === "eligible").map((feature) => feature.alias),
  );
  const assigned = new Map<string, string>();
  const omitted = new Map<string, string>();
  const chapterKeys = new Set<string>();
  const signatureKeys = new Set<string>();
  const ontologyById = new Map(ontology.map((record) => [record.id, record]));

  for (const chapter of output.chapters) {
    if (chapterKeys.has(chapter.chapter_key)) {
      failures.push({ code: "duplicate_chapter_key", message: chapter.chapter_key });
    }
    chapterKeys.add(chapter.chapter_key);
    if (chapter.working_title.length > TITLE_CHAR_MAX) {
      failures.push({ code: "title_too_long", message: chapter.chapter_key });
    }
    if (/nft_|usr_|cht_|pgen_|fingerprint/i.test(`${chapter.working_title} ${chapter.purpose}`)) {
      failures.push({ code: "identifier_in_title", message: chapter.chapter_key });
    }
    if (chapter.feature_aliases.length === 0) {
      failures.push({ code: "empty_chapter", message: chapter.chapter_key });
    }
    const onlyUncertainty = chapter.feature_aliases.every((alias) => {
      const feature = packet.features.find((row) => row.alias === alias);
      return feature?.feature_class === "uncertainty";
    });
    if (onlyUncertainty) {
      failures.push({ code: "uncertainty_only_chapter", message: chapter.chapter_key });
    }
    const allowed = authorizedRules(packet, ontology, chapter.feature_aliases);
    for (const alias of chapter.feature_aliases) {
      if (!packetAliases.has(alias)) {
        failures.push({ code: "unknown_alias", message: alias });
        continue;
      }
      if (omitted.has(alias)) {
        failures.push({ code: "assigned_and_omitted", message: alias });
      }
      const previous = assigned.get(alias);
      if (previous && previous !== chapter.chapter_key) {
        failures.push({ code: "duplicate_assignment", message: alias });
      }
      assigned.set(alias, chapter.chapter_key);
    }
    for (const ruleId of chapter.ontology_rule_ids) {
      if (!allowed.has(ruleId) && !ontologyById.has(ruleId)) {
        failures.push({ code: "unknown_rule", message: ruleId });
      } else if (!allowed.has(ruleId)) {
        failures.push({ code: "unauthorized_rule", message: `${chapter.chapter_key}:${ruleId}` });
      }
    }
    const records = chapter.ontology_rule_ids
      .map((id) => ontologyById.get(id))
      .filter((record): record is PatternOntologyRecord => !!record);
    const available = tensionIdsFor(records);
    if (chapter.required_tension_ids.length < 1) {
      failures.push({ code: "missing_tension", message: chapter.chapter_key });
    }
    if (chapter.required_counter_expression_ids.length < 1) {
      failures.push({ code: "missing_counter_expression", message: chapter.chapter_key });
    }
    for (const id of [
      ...chapter.required_tension_ids,
      ...chapter.required_counter_expression_ids,
      ...chapter.required_resource_ids,
    ]) {
      if (!available.has(id) && !ontologyById.has(id.split("#")[0] ?? "")) {
        failures.push({ code: "unknown_expression_id", message: id });
      }
    }
  }

  for (const signature of output.additional_signatures) {
    if (signatureKeys.has(signature.signature_key)) {
      failures.push({ code: "duplicate_signature_key", message: signature.signature_key });
    }
    signatureKeys.add(signature.signature_key);
    for (const alias of signature.feature_aliases) {
      if (!packetAliases.has(alias)) {
        failures.push({ code: "unknown_alias", message: alias });
        continue;
      }
      if (mandatoryCore.has(alias)) {
        failures.push({ code: "mandatory_core_in_signature", message: alias });
      }
      if (omitted.has(alias) || assigned.has(alias)) {
        failures.push({ code: "duplicate_assignment", message: alias });
      }
      assigned.set(alias, signature.signature_key);
    }
  }

  for (const omission of output.omissions) {
    if (!OMISSION_REASONS.has(omission.reason)) {
      failures.push({ code: "bad_omission_reason", message: omission.feature_alias });
    }
    if (!packetAliases.has(omission.feature_alias)) {
      failures.push({ code: "unknown_alias", message: omission.feature_alias });
      continue;
    }
    if (mandatoryCore.has(omission.feature_alias) || mandatoryAny.has(omission.feature_alias)) {
      failures.push({ code: "omitted_mandatory", message: omission.feature_alias });
    }
    if (assigned.has(omission.feature_alias)) {
      failures.push({ code: "assigned_and_omitted", message: omission.feature_alias });
    }
    if (omission.covered_by && !chapterKeys.has(omission.covered_by) && !signatureKeys.has(omission.covered_by)) {
      failures.push({ code: "omission_cover_missing", message: omission.feature_alias });
    }
    omitted.set(omission.feature_alias, omission.reason);
  }

  for (const alias of mandatoryCore) {
    const home = assigned.get(alias);
    if (!home || !chapterKeys.has(home)) {
      failures.push({ code: "mandatory_core_unassigned", message: alias });
    }
  }
  for (const alias of mandatoryAny) {
    if (!assigned.has(alias)) {
      failures.push({ code: "mandatory_any_unassigned", message: alias });
    }
  }
  for (const alias of eligible) {
    if (!assigned.has(alias) && !omitted.has(alias)) {
      failures.push({ code: "eligible_unaccounted", message: alias });
    }
  }

  return { ok: failures.length === 0, failures };
}
