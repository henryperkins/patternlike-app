/**
 * Hash and signature verification for Pattern ontology releases.
 *
 * Mirrors editorial content-release verification: nothing is trusted because
 * the caller asserted it. Recompute the hash of the canonical signing payload,
 * verify the signature against PATTERN_ONTOLOGY_KEYS, and only then persist or
 * execute. Recalled identities are refused by the store layer, not here.
 */

import { canonicalJson, contentHash, type PatternOntologyRelease } from "@patternlike/shared";
import {
  hashesEqual,
  parseReleaseKeys,
  verifyRawSignature,
  type RejectionReason,
  type SignatureAlgorithm,
} from "./content-release.js";

export interface OntologyBundleSignature {
  alg: SignatureAlgorithm;
  key_id: string;
  signature: string;
  signed_payload_hash: string;
}

export type SignedOntologyRelease = PatternOntologyRelease & {
  signature?: OntologyBundleSignature;
};

export function ontologySigningPayload(release: PatternOntologyRelease): string {
  const record = release as PatternOntologyRelease & { signature?: unknown };
  const { bundle_hash: _bundleHash, signature: _signature, ...body } = record;
  return canonicalJson(body);
}

export async function computeOntologyBundleHash(release: PatternOntologyRelease): Promise<string> {
  return contentHash(ontologySigningPayload(release));
}

export function parseOntologyKeys(raw: string | undefined) {
  return parseReleaseKeys(raw);
}

export async function verifyOntologySignature(
  release: SignedOntologyRelease,
  keys: ReturnType<typeof parseReleaseKeys>,
): Promise<RejectionReason | null> {
  const signature = release.signature;
  if (!signature) {
    return { class: "signature_missing", message: "Ontology release is not signed" };
  }
  const payload = ontologySigningPayload(release);
  const computed = await computeOntologyBundleHash(release);
  if (!hashesEqual(computed, signature.signed_payload_hash) || !hashesEqual(computed, release.bundle_hash)) {
    return {
      class: "signature_hash_mismatch",
      message: "signed_payload_hash must equal the recomputed ontology bundle hash",
    };
  }
  return verifyRawSignature(signature.alg, signature.key_id, signature.signature, payload, keys);
}

export function stripOntologySignature(release: SignedOntologyRelease): PatternOntologyRelease {
  const { signature: _signature, ...rest } = release;
  return rest;
}
