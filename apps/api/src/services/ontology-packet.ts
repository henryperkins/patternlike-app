/**
 * Minimal provider-visible documents for ontology generation and evaluation.
 *
 * The registered corpus is the only source seam. This module never reads R2,
 * revalidates licensing, or infers public capability. Every outbound object is
 * copied field by field, canonicalized once, scanned, and byte-counted over the
 * exact string later placed in the Responses input message.
 */

import {
  canonicalJson,
  type NatalFeatureClass,
  type PatternFeaturePredicate,
  type PatternOntologyRecord,
} from "@patternlike/shared";
import m4CommonSchema from "../../../../contracts/m4/common.schema.json";
import type { ActiveOntology } from "../db/pattern-ontology.js";
import type { OntologyPipelineConfigPin } from "../middleware/config-guard.js";
import type {
  OntologyCorpusFragment,
  RegisteredOntologyCorpus,
} from "./ontology-corpus.js";

export interface OntologyCoverageTarget {
  feature_class: NatalFeatureClass;
  minimum_source_supported: number;
  minimum_total: number;
}

export interface OntologyGenerationPolicy {
  ontology_schema_version: string;
  feature_policy_version: string;
  compiler_policy_version: string;
  regression_policy_version: string;
  prohibited_claim_policy_version: string;
  regression_minimum_pass_rate: number;
  prohibited_claims: readonly string[];
}

export interface OntologyCompilerSummary {
  rule_id: string;
  compiler_passed: boolean;
  /** Deterministic source-meaning closure, including transitive dependencies. */
  source_meaning_ids: readonly string[];
  finding_codes: readonly string[];
}

export interface OntologyGeneratorPacketInput {
  corpus: RegisteredOntologyCorpus;
  featureVocabulary: readonly NatalFeatureClass[];
  coverageTargets: readonly OntologyCoverageTarget[];
  policy: OntologyGenerationPolicy;
  /** A release already loaded through the verified active-ontology seam. */
  activeMachinePredecessor: ActiveOntology | null;
}

export interface OntologyEvaluatorPacketInput {
  corpus: RegisteredOntologyCorpus;
  rule: PatternOntologyRecord;
  citedMeanings: readonly PatternOntologyRecord[];
  compilerSummary: OntologyCompilerSummary;
}

interface ProviderCorpusFragment {
  id: string;
  corpus_release_id: string;
  locale: string;
  title?: string;
  author?: string;
  edition?: string;
  location?: string;
  exclusions?: string[];
  normalized_proposition: string;
  excerpt: string;
  license_class: "licensed_excerpt" | "internal_synthetic";
  allowed_transformations: string[];
}

interface ProviderCorpus {
  schema_version: "0.7.0";
  corpus_release_id: string;
  corpus_hash: string;
  locale: string;
  license_resolved: true;
  fragments: ProviderCorpusFragment[];
}

export interface OntologyGeneratorDocument {
  corpus: ProviderCorpus;
  feature_vocabulary: NatalFeatureClass[];
  coverage_targets: OntologyCoverageTarget[];
  policy: {
    ontology_schema_version: string;
    feature_policy_version: string;
    compiler_policy_version: string;
    regression_policy_version: string;
    prohibited_claim_policy_version: string;
    regression_minimum_pass_rate: number;
    prohibited_claims: string[];
  };
  active_machine_predecessor: {
    ontology_version: string;
    records: PatternOntologyRecord[];
  } | null;
}

export interface OntologyEvaluatorDocument {
  rule: PatternOntologyRecord;
  cited_meanings: PatternOntologyRecord[];
  permitted_fragments: Array<{
    id: string;
    normalized_proposition: string;
    excerpt: string;
    allowed_transformations: string[];
  }>;
  compiler_summary: {
    rule_id: string;
    compiler_passed: boolean;
    source_meaning_ids: string[];
    finding_codes: string[];
  };
}

export type OntologyPacketViolation =
  | { code: "ontology_input_forbidden_key"; key: string }
  | { code: "ontology_input_unexpected_key"; key: string }
  | {
      code: "ontology_input_forbidden_identifier";
      identifier_class: ForbiddenIdentifierClass;
    };

type ForbiddenIdentifierClass =
  | "user"
  | "account"
  | "chart"
  | "reading"
  | "session"
  | "consent"
  | "run";

export type OntologyPacketFailureCode =
  | "ontology_input_predecessor_invalid"
  | "ontology_input_feature_vocabulary_invalid"
  | "ontology_input_compiler_summary_mismatch"
  | "ontology_input_cited_meaning_missing"
  | "ontology_input_fragment_missing"
  | "ontology_input_forbidden_key"
  | "ontology_input_unexpected_key"
  | "ontology_input_forbidden_identifier"
  | "ontology_input_too_large";

export type OntologyPacketBuildResult<
  Kind extends "generator" | "evaluator",
  Document,
> =
  | {
      ok: true;
      kind: Kind;
      document: Document;
      serialized: string;
      bytes: number;
    }
  | { ok: false; code: OntologyPacketFailureCode };

export type OntologyGeneratorPacket = OntologyPacketBuildResult<
  "generator",
  OntologyGeneratorDocument
> & { ok: true };

export type OntologyEvaluatorPacket = OntologyPacketBuildResult<
  "evaluator",
  OntologyEvaluatorDocument
> & { ok: true };

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "user_id",
  "account_id",
  "chart_id",
  "chart_fingerprint",
  "chart_fingerprint_hash",
  "birth_date",
  "birth_time",
  "birth_time_local",
  "birthplace",
  "latitude",
  "longitude",
  "reading",
  "readings",
  "daily_reading",
  "session_id",
  "private_context",
  "check_in",
  "check_ins",
  "journal",
  "life_event",
  "life_events",
  "consent_id",
  "request_id",
  "run_id",
  "stage_generation",
  "object_key",
  "source_url",
  "api_key",
  "authorization",
]);

const M4_FEATURE_VOCABULARY: readonly string[] =
  m4CommonSchema.$defs.featureClass.enum;

function isNatalFeatureClass(value: string): value is NatalFeatureClass {
  return M4_FEATURE_VOCABULARY.includes(value);
}

function hasExactM4FeatureVocabulary(
  values: readonly NatalFeatureClass[],
): boolean {
  const distinct = new Set<string>(values);
  return distinct.size === M4_FEATURE_VOCABULARY.length &&
    M4_FEATURE_VOCABULARY.every((value) => distinct.has(value));
}

/** Every legal name at any depth of either provider document. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "corpus",
  "feature_vocabulary",
  "coverage_targets",
  "policy",
  "active_machine_predecessor",
  "schema_version",
  "corpus_release_id",
  "corpus_hash",
  "locale",
  "license_resolved",
  "fragments",
  "id",
  "title",
  "author",
  "edition",
  "location",
  "exclusions",
  "normalized_proposition",
  "excerpt",
  "license_class",
  "allowed_transformations",
  "feature_class",
  "minimum_source_supported",
  "minimum_total",
  "ontology_schema_version",
  "feature_policy_version",
  "compiler_policy_version",
  "regression_policy_version",
  "prohibited_claim_policy_version",
  "regression_minimum_pass_rate",
  "prohibited_claims",
  "ontology_version",
  "records",
  "rule",
  "cited_meanings",
  "permitted_fragments",
  "compiler_summary",
  "rule_id",
  "compiler_passed",
  "source_meaning_ids",
  "finding_codes",
  "meaning_class",
  "feature_predicate",
  "source_fragment_ids",
  "input_meaning_ids",
  "transformation_class",
  "tensions",
  "counter_expressions",
  "salience_band",
  "presentation_priority",
  "cluster_tags",
  "type",
  "body",
  "body_a",
  "body_b",
  "aspect",
  "pattern",
  "angle",
  "house",
  "accuracy",
]);

const FORBIDDEN_IDENTIFIERS: ReadonlyArray<{
  identifier_class: ForbiddenIdentifierClass;
  pattern: RegExp;
}> = [
  { identifier_class: "user", pattern: /usr_[0-9a-f]{32}/i },
  { identifier_class: "account", pattern: /acc_[0-9a-f]{32}/i },
  { identifier_class: "chart", pattern: /cht_[0-9a-f]{32}/i },
  { identifier_class: "reading", pattern: /rdg_[0-9a-f]{32}/i },
  { identifier_class: "session", pattern: /ses_[0-9a-f]{32}/i },
  { identifier_class: "consent", pattern: /cns_[0-9a-f]{32}/i },
  { identifier_class: "run", pattern: /oprun_[A-Za-z0-9._:-]+/ },
];

export function findOntologyPacketViolation(value: unknown): OntologyPacketViolation | null {
  const visit = (node: unknown): OntologyPacketViolation | null => {
    if (typeof node === "string") {
      for (const candidate of FORBIDDEN_IDENTIFIERS) {
        if (candidate.pattern.test(node)) {
          return {
            code: "ontology_input_forbidden_identifier",
            identifier_class: candidate.identifier_class,
          };
        }
      }
      return null;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const problem = visit(item);
        if (problem) return problem;
      }
      return null;
    }
    if (!node || typeof node !== "object") return null;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) {
        return { code: "ontology_input_forbidden_key", key };
      }
      if (!ALLOWED_KEYS.has(key)) {
        return { code: "ontology_input_unexpected_key", key };
      }
      const problem = visit(child);
      if (problem) return problem;
    }
    return null;
  };
  return visit(value);
}

function copyStrings(values: readonly string[]): string[] {
  return values.map((value) => value);
}

function copyPredicate(predicate: PatternFeaturePredicate): PatternFeaturePredicate {
  const copied: PatternFeaturePredicate = { type: predicate.type };
  if (predicate.body !== undefined) copied.body = predicate.body;
  if (predicate.body_a !== undefined) copied.body_a = predicate.body_a;
  if (predicate.body_b !== undefined) copied.body_b = predicate.body_b;
  if (predicate.aspect !== undefined) copied.aspect = predicate.aspect;
  if (predicate.pattern !== undefined) copied.pattern = predicate.pattern;
  if (predicate.angle !== undefined) copied.angle = predicate.angle;
  if (predicate.house !== undefined) copied.house = predicate.house;
  if (predicate.accuracy !== undefined) copied.accuracy = predicate.accuracy;
  return copied;
}

function copyRecord(record: PatternOntologyRecord): PatternOntologyRecord {
  return {
    id: record.id,
    meaning_class: record.meaning_class,
    locale: record.locale,
    feature_predicate: copyPredicate(record.feature_predicate),
    normalized_proposition: record.normalized_proposition,
    source_fragment_ids: copyStrings(record.source_fragment_ids),
    input_meaning_ids: copyStrings(record.input_meaning_ids),
    transformation_class: record.transformation_class,
    tensions: copyStrings(record.tensions),
    counter_expressions: copyStrings(record.counter_expressions),
    prohibited_claims: copyStrings(record.prohibited_claims),
    salience_band: record.salience_band,
    presentation_priority: record.presentation_priority,
    cluster_tags: copyStrings(record.cluster_tags),
  };
}

function copyCorpusFragment(fragment: OntologyCorpusFragment): ProviderCorpusFragment {
  const copied: ProviderCorpusFragment = {
    id: fragment.id,
    corpus_release_id: fragment.corpus_release_id,
    locale: fragment.locale,
    normalized_proposition: fragment.normalized_proposition,
    excerpt: fragment.excerpt,
    license_class: fragment.license_class,
    allowed_transformations: copyStrings(fragment.allowed_transformations),
  };
  if (fragment.title !== undefined) copied.title = fragment.title;
  if (fragment.author !== undefined) copied.author = fragment.author;
  if (fragment.edition !== undefined) copied.edition = fragment.edition;
  if (fragment.location !== undefined) copied.location = fragment.location;
  if (fragment.exclusions !== undefined) copied.exclusions = copyStrings(fragment.exclusions);
  return copied;
}

function serialize<Kind extends "generator" | "evaluator", Document>(
  kind: Kind,
  document: Document,
  pin: OntologyPipelineConfigPin,
): OntologyPacketBuildResult<Kind, Document> {
  const violation = findOntologyPacketViolation(document);
  if (violation) return { ok: false, code: violation.code };
  const serialized = canonicalJson(document);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > pin.input_max_bytes) {
    return { ok: false, code: "ontology_input_too_large" };
  }
  return { ok: true, kind, document, serialized, bytes };
}

function validMachinePredecessor(predecessor: ActiveOntology): boolean {
  const release = predecessor.release;
  return predecessor.version === release.ontology_version &&
    predecessor.bundleHash === release.bundle_hash &&
    predecessor.corpusReleaseHash === release.corpus_release_hash &&
    predecessor.locale === release.locale &&
    release.status === "active" &&
    release.provenance?.origin === "machine_pipeline";
}

export function buildOntologyGeneratorPacket(
  input: OntologyGeneratorPacketInput,
  pin: OntologyPipelineConfigPin,
): OntologyPacketBuildResult<"generator", OntologyGeneratorDocument> {
  if (!hasExactM4FeatureVocabulary(input.featureVocabulary)) {
    return { ok: false, code: "ontology_input_feature_vocabulary_invalid" };
  }
  if (
    input.activeMachinePredecessor !== null &&
    !validMachinePredecessor(input.activeMachinePredecessor)
  ) {
    return { ok: false, code: "ontology_input_predecessor_invalid" };
  }

  const release = input.corpus.release;
  const predecessor = input.activeMachinePredecessor?.release ?? null;
  const document: OntologyGeneratorDocument = {
    corpus: {
      schema_version: release.schema_version,
      corpus_release_id: release.corpus_release_id,
      corpus_hash: release.corpus_hash,
      locale: release.locale,
      license_resolved: release.license_resolved,
      fragments: release.fragments.map(copyCorpusFragment),
    },
    feature_vocabulary: M4_FEATURE_VOCABULARY.filter(isNatalFeatureClass),
    coverage_targets: input.coverageTargets.map((target) => ({
      feature_class: target.feature_class,
      minimum_source_supported: target.minimum_source_supported,
      minimum_total: target.minimum_total,
    })),
    policy: {
      ontology_schema_version: input.policy.ontology_schema_version,
      feature_policy_version: input.policy.feature_policy_version,
      compiler_policy_version: input.policy.compiler_policy_version,
      regression_policy_version: input.policy.regression_policy_version,
      prohibited_claim_policy_version: input.policy.prohibited_claim_policy_version,
      regression_minimum_pass_rate: input.policy.regression_minimum_pass_rate,
      prohibited_claims: copyStrings(input.policy.prohibited_claims),
    },
    active_machine_predecessor: predecessor === null
      ? null
      : {
          ontology_version: predecessor.ontology_version,
          records: predecessor.records.map(copyRecord),
        },
  };
  return serialize("generator", document, pin);
}

function permittedFragment(
  fragment: OntologyCorpusFragment,
): OntologyEvaluatorDocument["permitted_fragments"][number] {
  return {
    id: fragment.id,
    normalized_proposition: fragment.normalized_proposition,
    excerpt: fragment.excerpt,
    allowed_transformations: copyStrings(fragment.allowed_transformations),
  };
}

export function buildOntologyEvaluatorPacket(
  input: OntologyEvaluatorPacketInput,
  pin: OntologyPipelineConfigPin,
): OntologyPacketBuildResult<"evaluator", OntologyEvaluatorDocument> {
  if (input.compilerSummary.rule_id !== input.rule.id) {
    return { ok: false, code: "ontology_input_compiler_summary_mismatch" };
  }

  const requiredMeaningIds = new Set(input.compilerSummary.source_meaning_ids);
  if (requiredMeaningIds.size !== input.compilerSummary.source_meaning_ids.length) {
    return { ok: false, code: "ontology_input_compiler_summary_mismatch" };
  }
  const citedById = new Map<string, PatternOntologyRecord>();
  for (const meaning of input.citedMeanings) {
    if (
      meaning.meaning_class === "source_supported" &&
      requiredMeaningIds.has(meaning.id) &&
      !citedById.has(meaning.id)
    ) {
      citedById.set(meaning.id, meaning);
    }
  }
  const citedMeanings: PatternOntologyRecord[] = [];
  for (const meaningId of input.compilerSummary.source_meaning_ids) {
    const meaning = citedById.get(meaningId);
    if (!meaning) {
      return { ok: false, code: "ontology_input_cited_meaning_missing" };
    }
    citedMeanings.push(meaning);
  }

  const permittedIds = new Set(input.rule.source_fragment_ids);
  for (const meaning of citedMeanings) {
    for (const fragmentId of meaning.source_fragment_ids) permittedIds.add(fragmentId);
  }
  const permittedFragments: OntologyEvaluatorDocument["permitted_fragments"] = [];
  for (const fragmentId of permittedIds) {
    const fragment = input.corpus.fragmentIndex.get(fragmentId);
    if (!fragment) return { ok: false, code: "ontology_input_fragment_missing" };
    permittedFragments.push(permittedFragment(fragment));
  }

  const document: OntologyEvaluatorDocument = {
    rule: copyRecord(input.rule),
    cited_meanings: citedMeanings.map(copyRecord),
    permitted_fragments: permittedFragments,
    compiler_summary: {
      rule_id: input.compilerSummary.rule_id,
      compiler_passed: input.compilerSummary.compiler_passed,
      source_meaning_ids: copyStrings(input.compilerSummary.source_meaning_ids),
      finding_codes: copyStrings(input.compilerSummary.finding_codes),
    },
  };
  return serialize("evaluator", document, pin);
}
