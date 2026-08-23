import {
  M7_SCHEMA_VERSION,
  NATAL_FEATURE_POLICY_VERSION,
} from "@patternlike/shared";
import {
  PATTERN_SELECTION_POLICY_ID,
  PATTERN_SELECTION_POLICY_VERSION,
  PATTERN_VALIDATION_POLICY_ID,
  PATTERN_VALIDATION_POLICY_VERSION,
} from "@patternlike/pattern-engine";
import m4CommonSchema from "../../../../contracts/m4/common.schema.json";
import type { NatalFeatureClass } from "@patternlike/shared";

import type { Env } from "../env.js";
import {
  loadActiveOntology,
  loadOntologyByVersion,
  type ActiveOntology,
} from "../db/pattern-ontology.js";
import {
  resolveOntologyPipelineConfiguration,
} from "../middleware/config-guard.js";
import {
  readRegisteredOntologyCorpus,
  type OntologyCorpusLicenseClass,
} from "./ontology-corpus.js";
import {
  buildOntologyCoverageSourceHints,
  type OntologyCoverageSourceHint,
} from "./ontology-coverage-source-hints.js";
import type { OntologyCoverageTarget } from "./ontology-packet.js";

export const ONTOLOGY_PIPELINE_COMMAND_VERSION =
  "OntologyPipelineCommandV3" as const;
export const ONTOLOGY_COMPILER_POLICY_VERSION = "1.0.0" as const;
export const ONTOLOGY_REGRESSION_POLICY_VERSION = "1.0.0" as const;
export const ONTOLOGY_PROHIBITED_CLAIM_POLICY_VERSION = "1.0.0" as const;
export const ONTOLOGY_PROHIBITED_CLAIMS = [
  "diagnosis",
  "prediction",
  "fate",
  "biographical fact",
] as const;
export const ONTOLOGY_PIPELINE_LIMITS = {
  maximum_generation_chunks: 16,
  maximum_candidate_records: 64,
  maximum_evaluator_calls: 64,
  maximum_candidate_bytes: 262_144,
} as const;
export const ONTOLOGY_PIPELINE_FEATURE_VOCABULARY = [
  ...m4CommonSchema.$defs.featureClass.enum,
] as readonly NatalFeatureClass[];
export const ONTOLOGY_PIPELINE_COVERAGE_TARGETS =
  ONTOLOGY_PIPELINE_FEATURE_VOCABULARY.map((featureClass) => ({
    feature_class: featureClass,
    minimum_source_supported: 1,
    minimum_total: 1,
  })) satisfies readonly OntologyCoverageTarget[];

export interface OntologyPipelinePredecessorReference {
  ontology_version: string;
  bundle_hash: string;
  corpus_release_hash: string;
  locale: string;
  object_key: string;
}

export interface OntologyPipelineCommand {
  command_version: typeof ONTOLOGY_PIPELINE_COMMAND_VERSION;
  schema_version: typeof M7_SCHEMA_VERSION;
  provider: "openai";
  candidate_ontology_version: string;
  corpus: {
    corpus_release_id: string;
    corpus_hash: string;
    license_class: OntologyCorpusLicenseClass;
    public_capable: boolean;
    object_key: string;
  };
  generator: {
    model: string;
    reasoning: "high";
    prompt_version: string;
    timeout_ms: number;
    max_output_tokens: number;
  };
  evaluator: {
    model: string;
    reasoning: "high";
    prompt_version: string;
    timeout_ms: number;
    max_output_tokens: number;
  };
  generator_input: {
    feature_vocabulary: readonly NatalFeatureClass[];
    coverage_targets: readonly OntologyCoverageTarget[];
    coverage_source_hints: readonly OntologyCoverageSourceHint[];
    active_machine_predecessor: OntologyPipelinePredecessorReference | null;
  };
  input_max_bytes: number;
  limits: {
    maximum_generation_chunks:
      typeof ONTOLOGY_PIPELINE_LIMITS.maximum_generation_chunks;
    maximum_candidate_records:
      typeof ONTOLOGY_PIPELINE_LIMITS.maximum_candidate_records;
    maximum_evaluator_calls:
      typeof ONTOLOGY_PIPELINE_LIMITS.maximum_evaluator_calls;
    maximum_candidate_bytes:
      typeof ONTOLOGY_PIPELINE_LIMITS.maximum_candidate_bytes;
  };
  policy: {
    ontology_schema_version: typeof M7_SCHEMA_VERSION;
    feature_policy_version: typeof NATAL_FEATURE_POLICY_VERSION;
    compiler_policy_version: typeof ONTOLOGY_COMPILER_POLICY_VERSION;
    regression_policy_version: typeof ONTOLOGY_REGRESSION_POLICY_VERSION;
    prohibited_claim_policy_version:
      typeof ONTOLOGY_PROHIBITED_CLAIM_POLICY_VERSION;
    selection_policy_id: typeof PATTERN_SELECTION_POLICY_ID;
    selection_policy_version: typeof PATTERN_SELECTION_POLICY_VERSION;
    validation_policy_id: typeof PATTERN_VALIDATION_POLICY_ID;
    validation_policy_version: typeof PATTERN_VALIDATION_POLICY_VERSION;
    prohibited_claims: readonly (typeof ONTOLOGY_PROHIBITED_CLAIMS)[number][];
  };
  configuration_equal: boolean;
  regression: {
    fixture_count: 30;
    maximum_provider_calls_per_fixture: 11;
    minimum_pass_rate: number;
  };
  daily_provider_call_limit: number;
  failed_artifact_retention_days: 7;
}

export class OntologyPipelineCommandError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OntologyPipelineCommandError";
  }
}

function fail(code: string): never {
  throw new OntologyPipelineCommandError(code);
}

function machinePredecessorReference(
  ontology: ActiveOntology | null,
): OntologyPipelinePredecessorReference | null {
  if (
    ontology === null ||
    ontology.release.provenance?.origin !== "machine_pipeline"
  ) {
    return null;
  }
  return {
    ontology_version: ontology.version,
    bundle_hash: ontology.bundleHash,
    corpus_release_hash: ontology.corpusReleaseHash,
    locale: ontology.locale,
    object_key: ontology.objectKey,
  };
}

/** Reload exactly the content-addressed predecessor frozen at reservation. */
export async function loadOntologyPipelinePredecessor(
  env: Env,
  reference: OntologyPipelinePredecessorReference | null,
): Promise<ActiveOntology | null> {
  if (reference === null) return null;
  const ontology = await loadOntologyByVersion(env, reference.ontology_version);
  if (
    !ontology ||
    ontology.version !== reference.ontology_version ||
    ontology.bundleHash !== reference.bundle_hash ||
    ontology.corpusReleaseHash !== reference.corpus_release_hash ||
    ontology.locale !== reference.locale ||
    ontology.objectKey !== reference.object_key ||
    ontology.release.provenance?.origin !== "machine_pipeline"
  ) {
    fail("ontology_pipeline_predecessor_unavailable");
  }
  return {
    ...ontology,
    // Machine bundles are content-addressed while still candidates; the D1
    // pointer proved this reference was active at reservation. Project that
    // frozen eligibility without mutating the authenticated stored bytes.
    release: { ...ontology.release, status: "active" },
  };
}

/**
 * Resolve all executable pins and re-verify the registered corpus before a
 * reservation is allowed. Corpus bytes are used only for verification and are
 * deliberately absent from the returned immutable command.
 */
export async function buildOntologyPipelineCommand(
  env: Env,
  corpusReleaseId: string,
  candidateOntologyVersion: string,
): Promise<OntologyPipelineCommand> {
  if (
    candidateOntologyVersion.length === 0 ||
    candidateOntologyVersion.length > 200
  ) {
    fail("ontology_pipeline_command_invalid");
  }
  const outcome = resolveOntologyPipelineConfiguration(env);
  if (!outcome.ok || outcome.rollout !== "internal" || !outcome.config) {
    fail("ontology_pipeline_not_enabled");
  }
  const corpus = await readRegisteredOntologyCorpus(env, corpusReleaseId);
  const coverageSourceHints = buildOntologyCoverageSourceHints(corpus);
  if (!coverageSourceHints.ok) {
    fail("ontology_pipeline_coverage_source_hint_invalid");
  }
  const activeMachinePredecessor = machinePredecessorReference(
    await loadActiveOntology(env),
  );
  const { pin } = outcome.config;
  return {
    command_version: ONTOLOGY_PIPELINE_COMMAND_VERSION,
    schema_version: M7_SCHEMA_VERSION,
    provider: "openai",
    candidate_ontology_version: candidateOntologyVersion,
    corpus: {
      corpus_release_id: corpus.release.corpus_release_id,
      corpus_hash: corpus.release.corpus_hash,
      license_class: corpus.licenseClass,
      public_capable: corpus.publicCapable,
      object_key: corpus.objectKey,
    },
    generator: {
      model: pin.generator_model,
      reasoning: pin.generator_reasoning,
      prompt_version: pin.generator_prompt_version,
      timeout_ms: outcome.config.generatorTimeoutMs,
      max_output_tokens: pin.generator_max_output_tokens,
    },
    evaluator: {
      model: pin.evaluator_model,
      reasoning: pin.evaluator_reasoning,
      prompt_version: pin.evaluator_prompt_version,
      timeout_ms: outcome.config.evaluatorTimeoutMs,
      max_output_tokens: pin.evaluator_max_output_tokens,
    },
    generator_input: {
      feature_vocabulary: [...ONTOLOGY_PIPELINE_FEATURE_VOCABULARY],
      coverage_targets: ONTOLOGY_PIPELINE_COVERAGE_TARGETS.map((target) => ({
        feature_class: target.feature_class,
        minimum_source_supported: target.minimum_source_supported,
        minimum_total: target.minimum_total,
      })),
      coverage_source_hints: coverageSourceHints.hints,
      active_machine_predecessor: activeMachinePredecessor,
    },
    input_max_bytes: pin.input_max_bytes,
    limits: { ...ONTOLOGY_PIPELINE_LIMITS },
    policy: {
      ontology_schema_version: M7_SCHEMA_VERSION,
      feature_policy_version: NATAL_FEATURE_POLICY_VERSION,
      compiler_policy_version: ONTOLOGY_COMPILER_POLICY_VERSION,
      regression_policy_version: ONTOLOGY_REGRESSION_POLICY_VERSION,
      prohibited_claim_policy_version:
        ONTOLOGY_PROHIBITED_CLAIM_POLICY_VERSION,
      selection_policy_id: PATTERN_SELECTION_POLICY_ID,
      selection_policy_version: PATTERN_SELECTION_POLICY_VERSION,
      validation_policy_id: PATTERN_VALIDATION_POLICY_ID,
      validation_policy_version: PATTERN_VALIDATION_POLICY_VERSION,
      prohibited_claims: [...ONTOLOGY_PROHIBITED_CLAIMS],
    },
    configuration_equal: outcome.config.configurationEqual,
    regression: {
      fixture_count: 30,
      maximum_provider_calls_per_fixture: 11,
      minimum_pass_rate: outcome.config.regressionMinimumPassRate,
    },
    daily_provider_call_limit: outcome.config.dailyProviderCallLimit,
    failed_artifact_retention_days: 7,
  };
}
