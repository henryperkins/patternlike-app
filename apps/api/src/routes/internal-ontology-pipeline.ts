import { Hono } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  OntologyCorpusError,
  registerOntologyCorpus,
} from "../services/ontology-corpus.js";

export const internalOntologyPipelineRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

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
