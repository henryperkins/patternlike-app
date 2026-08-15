import {
  canonicalAspectPair,
  isCanonicalAspectPair,
  type NatalFeature,
} from "@patternlike/shared";
import type { PatternOntologyRecord, PatternOntologyRelease } from "@patternlike/shared";
import type { OntologyCompileResult, ValidationFailure } from "./types.js";

function predicateBodies(record: PatternOntologyRecord): string[] {
  const pred = record.feature_predicate;
  const bodies: string[] = [];
  if (pred.body) bodies.push(pred.body);
  if (pred.body_a) bodies.push(pred.body_a);
  if (pred.body_b) bodies.push(pred.body_b);
  if (pred.angle) bodies.push(pred.angle);
  return bodies;
}

/**
 * Partial predicates are allowed: `{type:"aspect", aspect:"square"}` matches
 * any square. When both bodies are named, they must already be in LAUNCH_BODIES
 * rank order — the same rule M4 uses. Alphabetical sorting is the rejected shape.
 */
export function ontologyRecordMatchesFeature(
  record: PatternOntologyRecord,
  feature: NatalFeature,
): boolean {
  const pred = record.feature_predicate;
  if (pred.type !== feature.feature_class) return false;
  switch (feature.feature_class) {
    case "position":
      return !pred.body || feature.body === pred.body;
    case "aspect": {
      if (pred.aspect && feature.aspect !== pred.aspect) return false;
      if (pred.body_a && pred.body_b) {
        const [a, b] = canonicalAspectPair(pred.body_a as typeof feature.body_a, pred.body_b as typeof feature.body_b);
        return feature.body_a === a && feature.body_b === b;
      }
      if (pred.body_a && feature.body_a !== pred.body_a && feature.body_b !== pred.body_a) return false;
      if (pred.body_b && feature.body_a !== pred.body_b && feature.body_b !== pred.body_b) return false;
      return true;
    }
    case "pattern":
      return !pred.pattern || feature.pattern === pred.pattern;
    case "angle":
      return !pred.angle || feature.angle === pred.angle;
    case "house_cusp":
      return pred.house === undefined || feature.house === pred.house;
    case "uncertainty":
      return !pred.accuracy || feature.accuracy === pred.accuracy;
  }
}

function acyclic(records: readonly PatternOntologyRecord[]): ValidationFailure | null {
  const byId = new Map(records.map((record) => [record.id, record]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visited.has(id)) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    const record = byId.get(id);
    if (record) {
      for (const parent of record.input_meaning_ids) {
        if (!visit(parent)) return false;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const record of records) {
    if (!visit(record.id)) {
      return { code: "ontology_cycle", message: `derived_synthesis graph cycles at ${record.id}` };
    }
  }
  return null;
}

const ONTOLOGY_RULE_ID = /^ont_[0-9a-f]{32}$/;
const SOURCE_FRAGMENT_ID = /^srcf_[0-9a-f]{32}$/;
const LOCALE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const MEANING_CLASSES: ReadonlySet<string> = new Set([
  "source_supported",
  "derived_synthesis",
  "expression_guidance",
]);
const RELEASE_STATUSES: ReadonlySet<string> = new Set([
  "candidate",
  "active",
  "superseded",
  "recalled",
]);
const PREDICATE_TYPES: ReadonlySet<string> = new Set([
  "position",
  "aspect",
  "pattern",
  "angle",
  "house_cusp",
  "uncertainty",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Shape gate ahead of the semantic checks.
 *
 * The ingest route hands this whatever JSON arrived. Reaching
 * `release.records.length` on a body that has no `records` is a TypeError and a
 * 500 where the OpenAPI declares 400, and the semantic pass below never looked
 * at the record id grammar, locale, or release status -- so a release the
 * frozen contract rejects could still become the active interpretation basis.
 *
 * These mirror contracts/m7/pattern-ontology-release.schema.json and its
 * record schema. Everything reports as a failure rather than a throw, so one
 * malformed release is a 400 with a closed code like any other refusal.
 */
function structuralFailures(value: unknown): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  if (!isRecord(value)) {
    return [{ code: "release_malformed", message: "ontology release must be a JSON object" }];
  }
  if (typeof value.schema_version !== "string") {
    failures.push({ code: "release_malformed", message: "schema_version must be a string" });
  }
  if (typeof value.ontology_version !== "string" || value.ontology_version.length === 0) {
    failures.push({ code: "release_malformed", message: "ontology_version must be a non-empty string" });
  }
  for (const field of ["bundle_hash", "corpus_release_hash"] as const) {
    if (typeof value[field] !== "string" || !CONTENT_HASH.test(value[field] as string)) {
      failures.push({ code: "release_malformed", message: `${field} must be a sha256 content hash` });
    }
  }
  if (typeof value.locale !== "string" || !LOCALE_TAG.test(value.locale)) {
    failures.push({ code: "release_malformed", message: "release locale must be a BCP 47 tag" });
  }
  if (typeof value.status !== "string" || !RELEASE_STATUSES.has(value.status)) {
    failures.push({ code: "release_malformed", message: "release status is not a known value" });
  }
  if (!isRecord(value.evaluation)) {
    failures.push({ code: "release_malformed", message: "evaluation must be an object" });
  } else {
    if (typeof value.evaluation.unevaluated_fixture_count !== "number") {
      failures.push({ code: "release_malformed", message: "evaluation.unevaluated_fixture_count must be a number" });
    }
    if (typeof value.evaluation.verdict !== "string") {
      failures.push({ code: "release_malformed", message: "evaluation.verdict must be a string" });
    }
  }
  if (!Array.isArray(value.records)) {
    failures.push({ code: "release_malformed", message: "records must be an array" });
    return failures;
  }
  for (const [index, entry] of value.records.entries()) {
    const where = `record ${index}`;
    if (!isRecord(entry)) {
      failures.push({ code: "record_malformed", message: `${where} is not an object` });
      continue;
    }
    if (typeof entry.id !== "string" || !ONTOLOGY_RULE_ID.test(entry.id)) {
      failures.push({ code: "record_id_invalid", message: `${where} id is not an ont_ rule id` });
    }
    if (typeof entry.locale !== "string" || !LOCALE_TAG.test(entry.locale)) {
      failures.push({ code: "record_locale_invalid", message: `${where} locale is not a BCP 47 tag` });
    }
    if (typeof entry.meaning_class !== "string" || !MEANING_CLASSES.has(entry.meaning_class)) {
      failures.push({ code: "record_meaning_class_invalid", message: `${where} meaning_class is not a known value` });
    }
    if (typeof entry.normalized_proposition !== "string" || entry.normalized_proposition.length === 0) {
      failures.push({ code: "record_malformed", message: `${where} normalized_proposition must be non-empty` });
    }
    if (!isRecord(entry.feature_predicate) || typeof entry.feature_predicate.type !== "string" ||
        !PREDICATE_TYPES.has(entry.feature_predicate.type)) {
      failures.push({ code: "record_predicate_invalid", message: `${where} feature_predicate.type is not a known value` });
    }
    for (const [field, pattern] of [
      ["source_fragment_ids", SOURCE_FRAGMENT_ID],
      ["input_meaning_ids", ONTOLOGY_RULE_ID],
    ] as const) {
      const list = entry[field];
      if (!Array.isArray(list)) {
        failures.push({ code: "record_malformed", message: `${where} ${field} must be an array` });
        continue;
      }
      if (list.some((id) => typeof id !== "string" || !pattern.test(id))) {
        failures.push({ code: "record_malformed", message: `${where} ${field} holds a malformed id` });
      }
    }
    for (const field of ["tensions", "counter_expressions", "prohibited_claims", "cluster_tags"] as const) {
      if (!Array.isArray(entry[field])) {
        failures.push({ code: "record_malformed", message: `${where} ${field} must be an array` });
      }
    }
  }
  return failures;
}

/**
 * Fail closed on the first structural defect. One bad record refuses the
 * whole release rather than dropping a predicate and matching a wrong chapter.
 */
export function compileOntologyRelease(release: PatternOntologyRelease | unknown): OntologyCompileResult {
  const structural = structuralFailures(release);
  if (structural.length > 0) return { ok: false, failures: structural };
  const typed = release as PatternOntologyRelease;
  return compileValidatedRelease(typed);
}

function compileValidatedRelease(release: PatternOntologyRelease): OntologyCompileResult {
  const failures: ValidationFailure[] = [];
  if (release.schema_version !== "0.7.0") {
    failures.push({ code: "schema_version", message: "ontology release schema_version must be 0.7.0" });
  }
  if (release.records.length === 0) {
    failures.push({ code: "empty_records", message: "ontology release has no records" });
  }
  if (release.evaluation.unevaluated_fixture_count !== 0) {
    failures.push({ code: "unevaluated_fixtures", message: "ontology release has unevaluated regression fixtures" });
  }
  if (release.evaluation.verdict !== "pass") {
    failures.push({ code: "evaluation_reject", message: "ontology evaluation verdict is not pass" });
  }
  const ids = new Set<string>();
  for (const record of release.records) {
    if (ids.has(record.id)) {
      failures.push({ code: "duplicate_id", message: `duplicate ontology record ${record.id}` });
      continue;
    }
    ids.add(record.id);
    const pred = record.feature_predicate;
    if (pred.type === "aspect" && pred.body_a && pred.body_b && !isCanonicalAspectPair(pred.body_a, pred.body_b)) {
      failures.push({
        code: "noncanonical_aspect",
        message: `ontology record ${record.id} names a non-canonical aspect pair`,
      });
    }
    if (record.meaning_class === "source_supported" && record.source_fragment_ids.length === 0) {
      failures.push({
        code: "source_unterminated",
        message: `source_supported record ${record.id} has no source fragments`,
      });
    }
    if (record.meaning_class === "derived_synthesis") {
      if (record.input_meaning_ids.length < 2) {
        failures.push({
          code: "derived_inputs",
          message: `derived_synthesis ${record.id} needs at least two input meanings`,
        });
      }
      if (!record.transformation_class) {
        failures.push({
          code: "derived_transformation",
          message: `derived_synthesis ${record.id} is missing transformation_class`,
        });
      }
    }
    if (record.meaning_class === "expression_guidance" && record.normalized_proposition.length === 0) {
      failures.push({
        code: "empty_guidance",
        message: `expression_guidance ${record.id} has an empty proposition`,
      });
    }
    void predicateBodies;
  }
  const cycle = acyclic(release.records);
  if (cycle) failures.push(cycle);
  for (const record of release.records) {
    for (const parent of record.input_meaning_ids) {
      if (!ids.has(parent)) {
        failures.push({
          code: "missing_input_meaning",
          message: `record ${record.id} cites unknown input ${parent}`,
        });
      }
    }
  }
  return { ok: failures.length === 0, failures };
}
