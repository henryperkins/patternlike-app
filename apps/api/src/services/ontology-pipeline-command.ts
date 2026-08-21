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

import type { Env } from "../env.js";
import {
  resolveOntologyPipelineConfiguration,
} from "../middleware/config-guard.js";
import {
  readRegisteredOntologyCorpus,
  type OntologyCorpusLicenseClass,
} from "./ontology-corpus.js";

export const ONTOLOGY_PIPELINE_COMMAND_VERSION =
  "OntologyPipelineCommandV1" as const;
export const ONTOLOGY_COMPILER_POLICY_VERSION = "1.0.0" as const;
export const ONTOLOGY_REGRESSION_POLICY_VERSION = "1.0.0" as const;
export const ONTOLOGY_PROHIBITED_CLAIM_POLICY_VERSION = "1.0.0" as const;
export const ONTOLOGY_PROHIBITED_CLAIMS = [
  "diagnosis",
  "prediction",
  "fate",
  "biographical fact",
] as const;

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
  input_max_bytes: number;
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
    input_max_bytes: pin.input_max_bytes,
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
