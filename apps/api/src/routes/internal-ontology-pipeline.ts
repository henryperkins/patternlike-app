import { Hono } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  OntologyCorpusError,
  registerOntologyCorpus,
} from "../services/ontology-corpus.js";
import {
  enqueueOntologyPipelineRun,
  OntologyPipelineEnqueueError,
} from "../services/ontology-pipeline-enqueue.js";
import { OntologyPipelineCommandError } from "../services/ontology-pipeline-command.js";

export const internalOntologyPipelineRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

interface OntologyPipelineRunRequest {
  idempotency_key: string;
  corpus_release_id: string;
  candidate_ontology_version: string;
}

const ONTOLOGY_PIPELINE_RUN_KEYS = [
  "candidate_ontology_version",
  "corpus_release_id",
  "idempotency_key",
] as const;

function ontologyPipelineRunRequest(
  value: unknown,
): OntologyPipelineRunRequest | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== ONTOLOGY_PIPELINE_RUN_KEYS.length ||
    keys.some((key, index) => key !== ONTOLOGY_PIPELINE_RUN_KEYS[index]) ||
    typeof record.idempotency_key !== "string" ||
    typeof record.corpus_release_id !== "string" ||
    typeof record.candidate_ontology_version !== "string"
  ) {
    return null;
  }
  return record as unknown as OntologyPipelineRunRequest;
}

function error(requestId: string, code: string, message: string) {
  return { error: { code, message, request_id: requestId } };
}

function refusedCorpus(
  cause: OntologyCorpusError,
): { status: 400 | 409 | 503; code: string; message: string } {
  switch (cause.code) {
    case "ontology_corpus_manifest_invalid":
    case "ontology_corpus_manifest_noncanonical":
    case "ontology_corpus_manifest_hash_mismatch":
      return {
        status: 400,
        code: "ontology_corpus_invalid",
        message: "Corpus release did not meet the immutable source-corpus contract",
      };
    case "ontology_corpus_immutable":
      return {
        status: 409,
        code: "ontology_corpus_immutable",
        message: "Corpus release identity is already occupied",
      };
    default:
      return {
        status: 503,
        code: "ontology_corpus_unavailable",
        message: "Corpus registration is unavailable",
      };
  }
}

internalOntologyPipelineRoutes.post("/ontology-corpora", async (c) => {
  const requestId = c.get("requestId");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      error(requestId, "invalid_json", "Request body must be valid JSON"),
      400,
    );
  }
  try {
    const result = await registerOntologyCorpus(c.env, body);
    const { release } = result.corpus;
    return c.json(
      {
        status: result.status === "registered" ? "registered" : "duplicate",
        corpus_release_id: release.corpus_release_id,
        corpus_hash: release.corpus_hash,
        locale: release.locale,
        fragment_count: release.fragments.length,
        license_class: result.corpus.licenseClass,
        public_capable: result.corpus.publicCapable,
        object_key: result.corpus.objectKey,
      },
      result.status === "registered" ? 201 : 200,
    );
  } catch (cause) {
    if (cause instanceof OntologyCorpusError) {
      const response = refusedCorpus(cause);
      return c.json(
        error(requestId, response.code, response.message),
        response.status,
      );
    }
    throw cause;
  }
});

internalOntologyPipelineRoutes.post("/ontology-pipeline-runs", async (c) => {
  const requestId = c.get("requestId");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      error(requestId, "invalid_json", "Request body must be valid JSON"),
      400,
    );
  }
  const command = ontologyPipelineRunRequest(body);
  if (!command) {
    return c.json(
      error(
        requestId,
        "ontology_pipeline_command_invalid",
        "Pipeline run command is invalid",
      ),
      400,
    );
  }
  let result;
  try {
    result = await enqueueOntologyPipelineRun(c.env, {
      idempotencyKey: command.idempotency_key,
      corpusReleaseId: command.corpus_release_id,
      candidateOntologyVersion: command.candidate_ontology_version,
    });
  } catch (cause) {
    if (
      cause instanceof OntologyPipelineEnqueueError &&
      cause.code === "ontology_pipeline_command_invalid"
    ) {
      return c.json(
        error(
          requestId,
          "ontology_pipeline_command_invalid",
          "Pipeline run command is invalid",
        ),
        400,
      );
    }
    if (
      cause instanceof OntologyPipelineEnqueueError &&
      cause.code === "ontology_pipeline_command_conflict"
    ) {
      return c.json(
        error(
          requestId,
          "ontology_pipeline_command_conflict",
          "Pipeline run command identity is already occupied",
        ),
        409,
      );
    }
    if (
      cause instanceof OntologyCorpusError &&
      cause.code === "ontology_corpus_not_registered"
    ) {
      return c.json(
        error(
          requestId,
          "ontology_corpus_not_registered",
          "Corpus release is not registered",
        ),
        409,
      );
    }
    if (
      cause instanceof OntologyPipelineCommandError &&
      cause.code === "ontology_pipeline_not_enabled"
    ) {
      return c.json(
        error(
          requestId,
          "ontology_pipeline_not_enabled",
          "Ontology pipeline rollout is not enabled",
        ),
        503,
      );
    }
    throw cause;
  }
  return c.json(
    {
      status: result.status,
      run_id: result.runId,
      stage_generation: result.stageGeneration,
      configuration_hash: result.configurationHash,
      dispatched: result.dispatched,
    },
    result.status === "reserved" ? 202 : 200,
  );
});
