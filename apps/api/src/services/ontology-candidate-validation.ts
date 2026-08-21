import {
  canonicalJson,
  type PatternOntologyRecord,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import m0CommonSchema from "../../../../contracts/m0/common.schema.json";
import m7CommonSchema from "../../../../contracts/m7/common.schema.json";
import ontologyEvaluationSchema from "../../../../contracts/m7/pattern-ontology-evaluation.schema.json";
import ontologyRecordSchema from "../../../../contracts/m7/pattern-ontology-record.schema.json";
import ontologyReleaseSchema from "../../../../contracts/m7/pattern-ontology-release.schema.json";
import type { OntologyCoverageTarget } from "./ontology-packet.js";

export type OntologyCandidateValidationResult =
  | { ok: true; release: PatternOntologyRelease }
  | {
      ok: false;
      code:
        | "candidate_schema_invalid"
        | "candidate_limit_exceeded"
        | "candidate_policy_invalid";
    };

export interface OntologyCandidateValidationOptions {
  canonicalBytes: string;
  corpusLocale: string;
  permittedFragmentIds: ReadonlySet<string>;
  coverageTargets: readonly OntologyCoverageTarget[];
  maximumCandidateRecords: number;
  maximumCandidateBytes: number;
}

const schemaValidator = new Ajv2020({ strict: true });
addFormats(schemaValidator);
for (const schema of [
  m0CommonSchema,
  m7CommonSchema,
  ontologyRecordSchema,
  ontologyEvaluationSchema,
  ontologyReleaseSchema,
]) {
  schemaValidator.addSchema(schema);
}

function requiredValidator<T>(schemaId: string): ValidateFunction<T> {
  const validator = schemaValidator.getSchema<T>(schemaId);
  if (!validator) throw new Error("Frozen M7 ontology release schema is unavailable");
  return validator;
}

const validateFrozenRelease = requiredValidator<PatternOntologyRelease>(
  ontologyReleaseSchema.$id,
);
const textEncoder = new TextEncoder();
const CLOSED_PROHIBITED_ASSERTION =
  /\b(?:diagnos(?:is|e|ed|ing)|predict(?:ion|s|ed|ing|ive)?|caus(?:e|es|ed|ing|ation|al)|inevitab(?:le|ly|ility)|fate|biograph(?:y|ical|ic)|life event)\b/i;
const EXPRESSION_GUIDANCE_ASSERTION =
  /\b(?:sun|moon|mercury|venus|mars|jupiter|saturn|uranus|neptune|pluto|node|ascendant|midheaven|aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces|house|aspect|conjunction|sextile|square|trine|opposition|psycholog(?:y|ical|ically))\b/i;

function stringsAreNonempty(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => value.length > 0);
}

function recordText(record: PatternOntologyRecord): string {
  return [
    record.normalized_proposition,
    ...record.tensions,
    ...record.counter_expressions,
  ].join("\n");
}

function graphTerminatesInSources(
  records: readonly PatternOntologyRecord[],
): boolean {
  const byId = new Map<string, PatternOntologyRecord>();
  for (const record of records) {
    if (byId.has(record.id)) return false;
    byId.set(record.id, record);
  }
  const resolved = new Map<string, boolean>();
  const visiting = new Set<string>();
  const terminates = (record: PatternOntologyRecord): boolean => {
    const existing = resolved.get(record.id);
    if (existing !== undefined) return existing;
    if (visiting.has(record.id)) return false;
    if (record.meaning_class === "source_supported") {
      resolved.set(record.id, true);
      return true;
    }
    if (record.meaning_class !== "derived_synthesis") {
      resolved.set(record.id, false);
      return false;
    }
    if (record.input_meaning_ids.length === 0) return false;
    visiting.add(record.id);
    const result = record.input_meaning_ids.every((id) => {
      const input = byId.get(id);
      return input !== undefined && terminates(input);
    });
    visiting.delete(record.id);
    resolved.set(record.id, result);
    return result;
  };
  return records
    .filter((record) => record.meaning_class === "derived_synthesis")
    .every(terminates);
}

function recordPolicyIsValid(
  record: PatternOntologyRecord,
  options: OntologyCandidateValidationOptions,
): boolean {
  if (
    record.locale !== options.corpusLocale ||
    record.source_fragment_ids.some(
      (fragmentId) => !options.permittedFragmentIds.has(fragmentId),
    ) ||
    CLOSED_PROHIBITED_ASSERTION.test(recordText(record))
  ) {
    return false;
  }
  if (record.meaning_class === "source_supported") {
    return record.source_fragment_ids.length > 0 &&
      record.input_meaning_ids.length === 0 &&
      record.transformation_class === null &&
      stringsAreNonempty(record.tensions) &&
      stringsAreNonempty(record.counter_expressions) &&
      stringsAreNonempty(record.prohibited_claims);
  }
  if (record.meaning_class === "derived_synthesis") {
    return record.input_meaning_ids.length >= 2 &&
      record.transformation_class !== null;
  }
  return !EXPRESSION_GUIDANCE_ASSERTION.test(recordText(record));
}

function coverageIsComplete(
  records: readonly PatternOntologyRecord[],
  targets: readonly OntologyCoverageTarget[],
): boolean {
  return targets.every((target) => {
    const matching = records.filter(
      (record) => record.feature_predicate.type === target.feature_class,
    );
    const sourceSupported = matching.filter(
      (record) => record.meaning_class === "source_supported",
    );
    return matching.length >= target.minimum_total &&
      sourceSupported.length >= target.minimum_source_supported;
  });
}

/** Frozen JSON Schema is the structural authority; policy checks only add cross-record facts. */
export function validateOntologyCandidateRelease(
  value: unknown,
  options: OntologyCandidateValidationOptions,
): OntologyCandidateValidationResult {
  if (
    !validateFrozenRelease(value) ||
    canonicalJson(value) !== options.canonicalBytes
  ) {
    return { ok: false, code: "candidate_schema_invalid" };
  }
  if (
    value.records.length > options.maximumCandidateRecords ||
    textEncoder.encode(options.canonicalBytes).byteLength >
      options.maximumCandidateBytes
  ) {
    return { ok: false, code: "candidate_limit_exceeded" };
  }
  if (
    value.locale !== options.corpusLocale ||
    !value.records.every((record) => recordPolicyIsValid(record, options)) ||
    !graphTerminatesInSources(value.records) ||
    !coverageIsComplete(value.records, options.coverageTargets)
  ) {
    return { ok: false, code: "candidate_policy_invalid" };
  }
  return { ok: true, release: value };
}
