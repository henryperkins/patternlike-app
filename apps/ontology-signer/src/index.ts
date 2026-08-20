import { canonicalJson, contentHash } from "@patternlike/shared";
import { WorkerEntrypoint } from "cloudflare:workers";

const MAX_SIGNING_PAYLOAD_BYTES = 256 * 1024;

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CONFIGURED_KEYS = 8;

const REQUEST_FIELDS = new Set(["payload", "payload_hash", "key_id"]);
const PAYLOAD_FIELDS = new Set([
  "schema_version",
  "ontology_version",
  "corpus_release_hash",
  "locale",
  "status",
  "records",
  "evaluation",
  "provenance",
]);
const REQUIRED_PAYLOAD_FIELDS = [
  "schema_version",
  "ontology_version",
  "corpus_release_hash",
  "locale",
  "status",
  "records",
  "evaluation",
] as const;
const FORBIDDEN_FIELD_MARKERS = [
  "prompt",
  "provider",
  "model",
  "message",
  "instruction",
] as const;

export type OntologySigningAlgorithm = "Ed25519" | "ES256";

export interface OntologySigningRequest {
  payload: string;
  payload_hash: string;
  key_id: string;
}

export interface OntologySignature {
  alg: OntologySigningAlgorithm;
  key_id: string;
  signature: string;
  signed_payload_hash: string;
}

export type OntologySigningErrorCode =
  | "request_malformed"
  | "payload_too_large"
  | "payload_malformed"
  | "payload_noncanonical"
  | "forbidden_field"
  | "payload_hash_mismatch"
  | "signer_configuration_invalid"
  | "signing_key_unknown";

export type OntologySigningResult =
  | { ok: true; signature: OntologySignature }
  | { ok: false; error: { code: OntologySigningErrorCode } };

export interface SignerEnv {
  /**
   * Versioned, closed JSON keyring documented in ../README.md. This secret is
   * deliberately the signer's only binding and never appears in a response.
   */
  PATTERN_ONTOLOGY_SIGNING_KEY: string;
}

interface SigningKey {
  alg: OntologySigningAlgorithm;
  privateKeyPkcs8: Uint8Array;
}

function rejected(code: OntologySigningErrorCode): OntologySigningResult {
  return { ok: false, error: { code } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function containsForbiddenField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  if (!isRecord(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      FORBIDDEN_FIELD_MARKERS.some((marker) =>
        normalizedKey.includes(marker))
    ) {
      return true;
    }
    if (containsForbiddenField(child)) return true;
  }
  return false;
}

function parseRequest(value: unknown): OntologySigningRequest | null {
  if (!isRecord(value) || !hasExactFields(value, REQUEST_FIELDS)) return null;
  if (
    typeof value.payload !== "string" ||
    typeof value.payload_hash !== "string" ||
    typeof value.key_id !== "string" ||
    !HASH_PATTERN.test(value.payload_hash) ||
    !KEY_ID_PATTERN.test(value.key_id)
  ) {
    return null;
  }
  return {
    payload: value.payload,
    payload_hash: value.payload_hash,
    key_id: value.key_id,
  };
}

function validatePayload(payload: string):
  | { value: Record<string, unknown> }
  | { error: OntologySigningErrorCode } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { error: "payload_malformed" };
  }
  if (!isRecord(parsed)) return { error: "payload_malformed" };
  if (canonicalJson(parsed) !== payload) return { error: "payload_noncanonical" };
  if (containsForbiddenField(parsed)) return { error: "forbidden_field" };
  if (
    Object.keys(parsed).some((key) => !PAYLOAD_FIELDS.has(key)) ||
    REQUIRED_PAYLOAD_FIELDS.some((field) => !(field in parsed)) ||
    typeof parsed.schema_version !== "string" ||
    typeof parsed.ontology_version !== "string" ||
    typeof parsed.corpus_release_hash !== "string" ||
    typeof parsed.locale !== "string" ||
    parsed.status !== "candidate" ||
    !Array.isArray(parsed.records) ||
    !isRecord(parsed.evaluation)
  ) {
    return { error: "payload_malformed" };
  }
  return { value: parsed };
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!BASE64URL_PATTERN.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return toBase64Url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseSigningKeyring(raw: string): Map<string, SigningKey> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasExactFields(value, new Set(["version", "keys"]))) return null;
  if (value.version !== 1 || !isRecord(value.keys)) return null;
  const entries = Object.entries(value.keys);
  if (entries.length === 0 || entries.length > MAX_CONFIGURED_KEYS) return null;

  const keys = new Map<string, SigningKey>();
  for (const [keyId, candidate] of entries) {
    if (!KEY_ID_PATTERN.test(keyId) || !isRecord(candidate)) return null;
    if (!hasExactFields(candidate, new Set(["alg", "private_key_pkcs8"]))) return null;
    if (
      (candidate.alg !== "Ed25519" && candidate.alg !== "ES256") ||
      typeof candidate.private_key_pkcs8 !== "string"
    ) {
      return null;
    }
    const privateKeyPkcs8 = decodeBase64Url(candidate.private_key_pkcs8);
    if (!privateKeyPkcs8 || privateKeyPkcs8.byteLength > 1024) return null;
    keys.set(keyId, { alg: candidate.alg, privateKeyPkcs8 });
  }
  return keys;
}

async function importSigningKey(key: SigningKey): Promise<CryptoKey | null> {
  const attempts: SubtleCryptoImportKeyAlgorithm[] =
    key.alg === "Ed25519"
      ? [{ name: "Ed25519" }, { name: "NODE-ED25519", namedCurve: "NODE-ED25519" }]
      : [{ name: "ECDSA", namedCurve: "P-256" }];
  for (const params of attempts) {
    try {
      return await crypto.subtle.importKey(
        "pkcs8",
        key.privateKeyPkcs8,
        params,
        false,
        ["sign"],
      );
    } catch {
      // The fallback is only for the workerd Ed25519 algorithm spelling.
    }
  }
  return null;
}

function signingParams(
  alg: OntologySigningAlgorithm,
  key: CryptoKey,
): SubtleCryptoSignAlgorithm {
  return alg === "ES256"
    ? { name: "ECDSA", hash: "SHA-256" }
    : { name: key.algorithm.name };
}

async function signOntologyPayload(
  value: unknown,
  signingKeySecret: string,
): Promise<OntologySigningResult> {
  const request = parseRequest(value);
  if (!request) return rejected("request_malformed");
  if (new TextEncoder().encode(request.payload).byteLength > MAX_SIGNING_PAYLOAD_BYTES) {
    return rejected("payload_too_large");
  }

  const payload = validatePayload(request.payload);
  if ("error" in payload) return rejected(payload.error);
  const computedHash = await contentHash(request.payload);
  if (computedHash !== request.payload_hash) return rejected("payload_hash_mismatch");

  const keyring = parseSigningKeyring(signingKeySecret);
  if (!keyring) return rejected("signer_configuration_invalid");
  const configured = keyring.get(request.key_id);
  if (!configured) return rejected("signing_key_unknown");
  const key = await importSigningKey(configured);
  if (!key) return rejected("signer_configuration_invalid");

  try {
    const rawSignature = await crypto.subtle.sign(
      signingParams(configured.alg, key),
      key,
      new TextEncoder().encode(request.payload),
    );
    return {
      ok: true,
      signature: {
        alg: configured.alg,
        key_id: request.key_id,
        signature: toBase64Url(new Uint8Array(rawSignature)),
        signed_payload_hash: request.payload_hash,
      },
    };
  } catch {
    return rejected("signer_configuration_invalid");
  }
}

export default class OntologySigner extends WorkerEntrypoint<SignerEnv> {
  async signOntology(request: unknown): Promise<OntologySigningResult> {
    return signOntologyPayload(request, this.env.PATTERN_ONTOLOGY_SIGNING_KEY);
  }
}
