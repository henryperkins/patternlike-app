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
const SIGNER_ERROR_CODES = new Set([
  "request_malformed",
  "payload_too_large",
  "payload_malformed",
  "payload_noncanonical",
  "forbidden_field",
  "payload_hash_mismatch",
  "signer_configuration_invalid",
  "signing_key_unknown",
]);

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
  signOntology(request: OntologySigningRequest): Promise<unknown>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function validateResponse(
  value: unknown,
  keyId: string,
  payloadHash: string,
): OntologyBundleSignature {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    fail("ontology_signer_response_invalid");
  }
  if (value.ok === false) {
    if (
      !hasExactFields(value, new Set(["ok", "error"])) ||
      !isRecord(value.error) ||
      !hasExactFields(value.error, new Set(["code"])) ||
      typeof value.error.code !== "string" ||
      !SIGNER_ERROR_CODES.has(value.error.code)
    ) {
      fail("ontology_signer_response_invalid");
    }
    fail(`ontology_signer_${value.error.code}`);
  }
  if (
    !hasExactFields(value, new Set(["ok", "signature"])) ||
    !isRecord(value.signature) ||
    !hasExactFields(
      value.signature,
      new Set(["alg", "key_id", "signature", "signed_payload_hash"]),
    )
  ) {
    fail("ontology_signer_response_invalid");
  }
  const signature = value.signature;
  if (
    (signature.alg !== "Ed25519" && signature.alg !== "ES256") ||
    typeof signature.key_id !== "string" ||
    signature.key_id !== keyId ||
    typeof signature.signature !== "string" ||
    !BASE64URL.test(signature.signature) ||
    typeof signature.signed_payload_hash !== "string" ||
    !hashesEqual(signature.signed_payload_hash, payloadHash)
  ) {
    fail("ontology_signer_response_invalid");
  }
  return {
    alg: signature.alg,
    key_id: signature.key_id,
    signature: signature.signature,
    signed_payload_hash: signature.signed_payload_hash,
  };
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
  if (release.status !== "candidate") {
    fail("ontology_status_not_candidate");
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
