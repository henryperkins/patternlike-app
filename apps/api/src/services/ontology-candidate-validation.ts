import {
  canonicalJson,
  type PatternOntologyRecord,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import m0ChartContractSchema from "../../../../contracts/m0/chart-contract.schema.json";
import m0CommonSchema from "../../../../contracts/m0/common.schema.json";
import m3CommonSchema from "../../../../contracts/m3/common.schema.json";
import m4CommonSchema from "../../../../contracts/m4/common.schema.json";
import m4NatalFeatureSchema from "../../../../contracts/m4/natal-feature.schema.json";
import m7CommonSchema from "../../../../contracts/m7/common.schema.json";
import ontologyEvaluationSchema from "../../../../contracts/m7/pattern-ontology-evaluation.schema.json";
import ontologyRecordSchema from "../../../../contracts/m7/pattern-ontology-record.schema.json";
import ontologyReleaseSchema from "../../../../contracts/m7/pattern-ontology-release.schema.json";
import type { OntologyCorpusFragment } from "./ontology-corpus.js";
import type { OntologyCoverageSourceHint } from "./ontology-coverage-source-hints.js";
import type { OntologyCoverageTarget } from "./ontology-packet.js";

export type OntologyCandidateSafeDetailCode =
  | "schema_invalid"
  | "limit_exceeded"
  | "locale_invalid"
  | "predicate_invalid"
  | "record_policy_invalid"
  | "coverage_source_hint_invalid"
  | "coverage_incomplete";

export type OntologyCandidateValidationResult =
  | { ok: true; release: PatternOntologyRelease }
  | {
      ok: false;
      code:
        | "candidate_schema_invalid"
        | "candidate_limit_exceeded"
        | "candidate_policy_invalid";
      safe_detail_code: OntologyCandidateSafeDetailCode;
    };

export interface OntologyCandidateValidationOptions {
  canonicalBytes: string;
  corpusLocale: string;
  permittedFragmentIds: ReadonlySet<string>;
  fragments: ReadonlyMap<string, OntologyCorpusFragment>;
  coverageTargets: readonly OntologyCoverageTarget[];
  coverageSourceHints: readonly OntologyCoverageSourceHint[];
  maximumCandidateRecords: number;
  maximumCandidateBytes: number;
}

const schemaValidator = new Ajv2020({ strict: true });
addFormats(schemaValidator);
for (const schema of [
  m0CommonSchema,
  m3CommonSchema,
  m4CommonSchema,
  m4NatalFeatureSchema,
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
const validateFrozenPredicate = requiredValidator<
  PatternOntologyRecord["feature_predicate"]
>(`${m4NatalFeatureSchema.$id}#/$defs/natalPredicate`);
const FROZEN_PATTERN_TYPES: ReadonlySet<string> = new Set(
  m0ChartContractSchema.$defs.chartSnapshot.properties.patterns.items
    .properties.pattern_type.enum,
);
const textEncoder = new TextEncoder();
const CLOSED_PROHIBITED_ASSERTION =
  /\b(?:diagnos(?:is|e|ed|ing)|predict(?:ion|s|ed|ing|ive)?|caus(?:e|es|ed|ing|ation|al)|inevitab(?:le|ly|ility)|fate|biograph(?:y|ical|ic)|life[\s_-]*events?)\b/i;

function regexToken(value: string): string {
  return value
    .split(/[_\s-]+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s_-]*");
}

const frozenAstrologicalTerms = [
  ...m0CommonSchema.$defs.celestialBody.enum,
  ...m0CommonSchema.$defs.aspectType.enum,
  ...m0ChartContractSchema.$defs.chartSnapshot.properties.patterns.items
    .properties.pattern_type.enum.filter((value) => value !== "other"),
  "body",
  "sign",
  "house",
  "aspect",
  "ascendant",
  "midheaven",
];
const EXPRESSION_GUIDANCE_ASSERTION = new RegExp(
  `\\b(?:${frozenAstrologicalTerms.map(regexToken).join("|")}|` +
    "diagnos(?:is|e|ed|ing)|predict(?:ion|s|ed|ing|ive)?|" +
    "psycholog(?:y|ical|ically)?|temperament|personality|traits?|" +
    "life[\\s_-]*events?)\\b",
  "i",
);

function stringsAreNonempty(
  values: readonly string[],
  requireOne = true,
): boolean {
  return (!requireOne || values.length > 0) &&
    values.every((value) => value.trim().length > 0);
}

function assertionText(record: PatternOntologyRecord): string {
  return [
    record.normalized_proposition,
    ...record.tensions,
    ...record.counter_expressions,
  ].join("\n");
}

function completeRecordText(record: PatternOntologyRecord): string {
  return [
    assertionText(record),
    ...record.prohibited_claims,
    ...record.cluster_tags,
  ].join("\n");
}

function fragmentIsPermitted(
  fragmentId: string,
  options: OntologyCandidateValidationOptions,
): OntologyCorpusFragment | null {
  const fragment = options.fragments.get(fragmentId);
  return options.permittedFragmentIds.has(fragmentId) &&
      fragment?.id === fragmentId &&
      fragment.locale === options.corpusLocale
    ? fragment
    : null;
}

function exclusionsAllow(
  record: PatternOntologyRecord,
  fragments: Iterable<OntologyCorpusFragment>,
): boolean {
  const text = completeRecordText(record).toLocaleLowerCase("en-US");
  for (const fragment of fragments) {
    for (const exclusion of fragment.exclusions ?? []) {
      const normalized = exclusion.trim().toLocaleLowerCase("en-US");
      if (normalized.length === 0 || text.includes(normalized)) return false;
    }
  }
  return true;
}

function candidatePolicyIsValid(
  records: readonly PatternOntologyRecord[],
  options: OntologyCandidateValidationOptions,
): boolean {
  const byId = new Map<string, PatternOntologyRecord>();
  for (const record of records) {
    if (byId.has(record.id)) return false;
    byId.set(record.id, record);
  }

  const terminalFragments = new Map<string, ReadonlyMap<string, OntologyCorpusFragment>>();
  const visiting = new Set<string>();
  const resolve = (
    record: PatternOntologyRecord,
  ): ReadonlyMap<string, OntologyCorpusFragment> | null => {
    const cached = terminalFragments.get(record.id);
    if (cached) return cached;
    if (visiting.has(record.id)) return null;
    if (record.meaning_class === "source_supported") {
      if (
        record.source_fragment_ids.length === 0 ||
        new Set(record.source_fragment_ids).size !== record.source_fragment_ids.length
      ) {
        return null;
      }
      const fragments = new Map<string, OntologyCorpusFragment>();
      for (const fragmentId of record.source_fragment_ids) {
        const fragment = fragmentIsPermitted(fragmentId, options);
        if (!fragment) return null;
        fragments.set(fragmentId, fragment);
      }
      terminalFragments.set(record.id, fragments);
      return fragments;
    }
    if (record.meaning_class !== "derived_synthesis") return null;
    if (
      record.input_meaning_ids.length < 2 ||
      new Set(record.input_meaning_ids).size !== record.input_meaning_ids.length
    ) {
      return null;
    }
    visiting.add(record.id);
    const fragments = new Map<string, OntologyCorpusFragment>();
    for (const inputId of record.input_meaning_ids) {
      const input = byId.get(inputId);
      if (!input) {
        visiting.delete(record.id);
        return null;
      }
      const resolved = resolve(input);
      if (!resolved) {
        visiting.delete(record.id);
        return null;
      }
      for (const [fragmentId, fragment] of resolved) {
        fragments.set(fragmentId, fragment);
      }
    }
    visiting.delete(record.id);
    terminalFragments.set(record.id, fragments);
    return fragments;
  };

  for (const record of records) {
    if (
      record.locale !== options.corpusLocale ||
      !stringsAreNonempty(record.tensions, record.meaning_class === "source_supported") ||
      !stringsAreNonempty(
        record.counter_expressions,
        record.meaning_class === "source_supported",
      ) ||
      !stringsAreNonempty(
        record.prohibited_claims,
        record.meaning_class === "source_supported",
      ) ||
      CLOSED_PROHIBITED_ASSERTION.test(assertionText(record))
    ) {
      return false;
    }

    if (record.meaning_class === "source_supported") {
      const fragments = resolve(record);
      if (
        !fragments ||
        record.input_meaning_ids.length !== 0 ||
        record.transformation_class !== null ||
        !exclusionsAllow(record, fragments.values())
      ) {
        return false;
      }
      continue;
    }

    if (record.meaning_class === "derived_synthesis") {
      const fragments = resolve(record);
      if (
        !fragments ||
        record.source_fragment_ids.length !== 0 ||
        record.transformation_class === null ||
        [...fragments.values()].some(
          (fragment) => !fragment.allowed_transformations.includes(
            record.transformation_class!,
          ),
        ) ||
        !exclusionsAllow(record, fragments.values())
      ) {
        return false;
      }
      continue;
    }

    if (
      record.source_fragment_ids.length !== 0 ||
      record.input_meaning_ids.length !== 0 ||
      record.transformation_class !== null ||
      EXPRESSION_GUIDANCE_ASSERTION.test(assertionText(record))
    ) {
      return false;
    }
  }
  return true;
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

function predicateMatchesHint(
  predicate: PatternOntologyRecord["feature_predicate"],
  hint: OntologyCoverageSourceHint,
): boolean {
  return predicate.type === hint.feature_class &&
    canonicalJson(predicate) === canonicalJson(hint.feature_predicate);
}

function coverageSourceHintsAreSatisfied(
  records: readonly PatternOntologyRecord[],
  hints: readonly OntologyCoverageSourceHint[],
): boolean {
  const identities = new Set<string>();
  for (const hint of hints) {
    const identity = canonicalJson(hint);
    if (identities.has(identity)) return false;
    identities.add(identity);
    const matchingRecords = records.filter((record) =>
      predicateMatchesHint(record.feature_predicate, hint)
    );
    if (
      matchingRecords.length !== 1 ||
      matchingRecords[0]!.meaning_class !== "source_supported" ||
      !matchingRecords[0]!.source_fragment_ids.includes(
        hint.source_fragment_id,
      )
    ) {
      return false;
    }
  }
  return true;
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
    return {
      ok: false,
      code: "candidate_schema_invalid",
      safe_detail_code: "schema_invalid",
    };
  }
  if (
    value.records.length > options.maximumCandidateRecords ||
    textEncoder.encode(options.canonicalBytes).byteLength >
      options.maximumCandidateBytes
  ) {
    return {
      ok: false,
      code: "candidate_limit_exceeded",
      safe_detail_code: "limit_exceeded",
    };
  }
  if (value.locale !== options.corpusLocale) {
    return {
      ok: false,
      code: "candidate_policy_invalid",
      safe_detail_code: "locale_invalid",
    };
  }
  if (
    !value.records.every((record) => {
      if (!validateFrozenPredicate(record.feature_predicate)) {
        return options.coverageSourceHints.some((hint) =>
          predicateMatchesHint(record.feature_predicate, hint)
        );
      }
      return record.feature_predicate.type !== "pattern" ||
        (typeof record.feature_predicate.pattern === "string" &&
          FROZEN_PATTERN_TYPES.has(record.feature_predicate.pattern));
    })
  ) {
    return {
      ok: false,
      code: "candidate_policy_invalid",
      safe_detail_code: "predicate_invalid",
    };
  }
  if (!candidatePolicyIsValid(value.records, options)) {
    return {
      ok: false,
      code: "candidate_policy_invalid",
      safe_detail_code: "record_policy_invalid",
    };
  }
  if (!coverageSourceHintsAreSatisfied(
    value.records,
    options.coverageSourceHints,
  )) {
    return {
      ok: false,
      code: "candidate_policy_invalid",
      safe_detail_code: "coverage_source_hint_invalid",
    };
  }
  if (!coverageIsComplete(value.records, options.coverageTargets)) {
    return {
      ok: false,
      code: "candidate_policy_invalid",
      safe_detail_code: "coverage_incomplete",
    };
  }
  return { ok: true, release: value };
}
