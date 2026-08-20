import type { PatternOntologyRelease } from "@patternlike/shared";
import { compileOntologyRelease } from "@patternlike/pattern-engine";
import { hashesEqual, type SignatureAlgorithm } from "./content-release.js";
import {
  computeOntologyBundleHash,
  ontologySigningPayload,
  type OntologyBundleSignature,
} from "./pattern-ontology-verify.js";

const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface OntologySigningRequest {
  payload: string;
  payload_hash: string;
  key_id: string;
}

export type OntologySigningServiceResult =
  | {
      ok: true;
      signature: {
        alg: SignatureAlgorithm;
        key_id: string;
        signature: string;
        signed_payload_hash: string;
      };
    }
  | { ok: false; error: { code: string } };

export interface OntologySignerBinding {
  signOntology(request: OntologySigningRequest): Promise<OntologySigningServiceResult>;
}

export class OntologySigningClientError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OntologySigningClientError";
  }
}

function fail(code: string): never {
  throw new OntologySigningClientError(code);
}

function validateResponse(
  value: OntologySigningServiceResult,
  keyId: string,
  payloadHash: string,
): OntologyBundleSignature {
  if (!value.ok) fail(`ontology_signer_${value.error.code}`);
  const signature = value.signature;
  if (
    (signature.alg !== "Ed25519" && signature.alg !== "ES256") ||
    signature.key_id !== keyId ||
    !BASE64URL.test(signature.signature) ||
    !hashesEqual(signature.signed_payload_hash, payloadHash)
  ) {
    fail("ontology_signer_response_invalid");
  }
  return signature;
}

/**
 * Narrow handoff used by the future durable executor after compilation and
 * independent evaluation. Regression fields are signed bytes but deliberately
 * are not an admission input.
 */
export async function signOntologyCandidate(
  signer: OntologySignerBinding,
  release: PatternOntologyRelease,
  keyId: string,
): Promise<OntologyBundleSignature> {
  if (!KEY_ID.test(keyId)) fail("ontology_signing_key_invalid");
  if (release.provenance?.origin !== "machine_pipeline") {
    fail("ontology_origin_not_machine_pipeline");
  }

  const compiled = compileOntologyRelease(release);
  if (!compiled.ok || release.evaluation.compiler_passed !== true) {
    fail("ontology_compiler_failed");
  }
  if (release.evaluation.evaluator_passed !== true) {
    fail("ontology_evaluator_failed");
  }
  if (
    typeof release.evaluation.evaluation_report_hash !== "string" ||
    !CONTENT_HASH.test(release.evaluation.evaluation_report_hash)
  ) {
    fail("ontology_evaluation_report_uncommitted");
  }

  const computedHash = await computeOntologyBundleHash(release);
  if (!hashesEqual(computedHash, release.bundle_hash)) {
    fail("ontology_bundle_hash_mismatch");
  }
  const request: OntologySigningRequest = {
    payload: ontologySigningPayload(release),
    payload_hash: computedHash,
    key_id: keyId,
  };
  return validateResponse(await signer.signOntology(request), keyId, computedHash);
}
