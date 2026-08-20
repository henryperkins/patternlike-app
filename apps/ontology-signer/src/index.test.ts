import { canonicalJson, contentHash } from "@patternlike/shared";
import { exports } from "cloudflare:workers";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  verifyRawSignature,
  type ReleasePublicKey,
  type SignatureAlgorithm,
} from "../../api/src/services/content-release.js";
import OntologySigner, {
  MAX_SIGNING_PAYLOAD_BYTES,
  type OntologySigningRequest,
  type OntologySigningResult,
} from "./index.js";

interface TestSigningKey {
  alg: SignatureAlgorithm;
  keyId: string;
  privateKeyPkcs8: string;
  publicKey: ReleasePublicKey;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateKey(keyId: string, alg: SignatureAlgorithm): Promise<TestSigningKey> {
  const params: SubtleCryptoGenerateKeyAlgorithm =
    alg === "Ed25519"
      ? { name: "Ed25519" }
      : { name: "ECDSA", namedCurve: "P-256" };
  const pair = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateKeyPkcs8 = toBase64Url(
    new Uint8Array(
      (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
    ),
  );
  const publicKey = toBase64Url(
    new Uint8Array(
      (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
    ),
  );
  return {
    alg,
    keyId,
    privateKeyPkcs8,
    publicKey: { alg, publicKey },
  };
}

function signingSecret(keys: TestSigningKey[]): string {
  return JSON.stringify({
    version: 1,
    keys: Object.fromEntries(
      keys.map((key) => [
        key.keyId,
        {
          alg: key.alg,
          private_key_pkcs8: key.privateKeyPkcs8,
        },
      ]),
    ),
  });
}

function candidateBody(): Record<string, unknown> {
  return {
    schema_version: "0.7.0",
    ontology_version: "ontology-machine-1",
    corpus_release_hash: `sha256:${"a".repeat(64)}`,
    locale: "en-US",
    status: "candidate",
    records: [{ id: `ont_${"b".repeat(32)}` }],
    evaluation: {
      schema_version: "0.7.0",
      ontology_version: "ontology-machine-1",
      verdict: "pass",
      compiler_passed: true,
      evaluator_passed: true,
      regression_passed: false,
      unevaluated_fixture_count: 0,
      evaluation_report_hash: `sha256:${"c".repeat(64)}`,
    },
    provenance: { origin: "machine_pipeline" },
  };
}

async function requestFor(body = candidateBody()): Promise<OntologySigningRequest> {
  const payload = canonicalJson(body);
  return {
    payload,
    payload_hash: await contentHash(payload),
    key_id: "ontology-ed25519",
  };
}

async function sign(request: unknown): Promise<OntologySigningResult> {
  return exports.default.signOntology(request);
}

describe("ontology signing Worker", () => {
  it("has no fetch route", () => {
    expect(Object.prototype.hasOwnProperty.call(OntologySigner.prototype, "fetch")).toBe(false);
  });

  it.each(["Ed25519", "ES256"] as const)(
    "produces a real %s signature accepted by the API verifier",
    async (alg) => {
      const keyId = alg === "Ed25519" ? "ontology-ed25519" : "ontology-es256";
      const key = await generateKey(keyId, alg);
      env.PATTERN_ONTOLOGY_SIGNING_KEY = signingSecret([key]);
      const request = await requestFor();
      request.key_id = keyId;

      const result = await sign(request);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.signature).toEqual({
        alg,
        key_id: keyId,
        signature: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
        signed_payload_hash: request.payload_hash,
      });
      const verified = await verifyRawSignature(
        result.signature.alg,
        result.signature.key_id,
        result.signature.signature,
        request.payload,
        new Map([[keyId, key.publicKey]]),
      );
      expect(verified).toBeNull();
    },
  );

  it("refuses a noncanonical payload", async () => {
    const key = await generateKey("ontology-ed25519", "Ed25519");
    env.PATTERN_ONTOLOGY_SIGNING_KEY = signingSecret([key]);
    const body = candidateBody();
    const payload = JSON.stringify(body);
    expect(payload).not.toBe(canonicalJson(body));

    const result = await sign({
      payload,
      payload_hash: await contentHash(payload),
      key_id: key.keyId,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "payload_noncanonical" },
    });
  });

  it("refuses an oversized payload before hashing or parsing it", async () => {
    const result = await sign({
      payload: "x".repeat(MAX_SIGNING_PAYLOAD_BYTES + 1),
      payload_hash: `sha256:${"0".repeat(64)}`,
      key_id: "ontology-ed25519",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "payload_too_large" },
    });
  });

  it("refuses malformed and open request envelopes", async () => {
    const valid = await requestFor();
    await expect(sign(null)).resolves.toEqual({
      ok: false,
      error: { code: "request_malformed" },
    });
    await expect(sign({ ...valid, provider: "openai" })).resolves.toEqual({
      ok: false,
      error: { code: "request_malformed" },
    });
    await expect(sign({ ...valid, payload_hash: "not-a-hash" })).resolves.toEqual({
      ok: false,
      error: { code: "request_malformed" },
    });
  });

  it.each([
    "prompt",
    "provider",
    "model",
    "messages",
    "instructions",
    "generator_prompt",
    "provider_name",
    "model_id",
  ])(
    "refuses forbidden %s fields inside signing payloads",
    async (field) => {
      const key = await generateKey("ontology-ed25519", "Ed25519");
      env.PATTERN_ONTOLOGY_SIGNING_KEY = signingSecret([key]);
      const body = candidateBody();
      (body.evaluation as Record<string, unknown>)[field] = "must not reach signer";
      const request = await requestFor(body);

      const result = await sign(request);

      expect(result).toEqual({
        ok: false,
        error: { code: "forbidden_field" },
      });
    },
  );

  it("refuses a declared hash mismatch", async () => {
    const key = await generateKey("ontology-ed25519", "Ed25519");
    env.PATTERN_ONTOLOGY_SIGNING_KEY = signingSecret([key]);
    const request = await requestFor();
    request.payload_hash = `sha256:${"f".repeat(64)}`;

    const result = await sign(request);

    expect(result).toEqual({
      ok: false,
      error: { code: "payload_hash_mismatch" },
    });
  });

  it("refuses unknown key ids without disclosing configured ids", async () => {
    const key = await generateKey("ontology-ed25519", "Ed25519");
    env.PATTERN_ONTOLOGY_SIGNING_KEY = signingSecret([key]);
    const request = await requestFor();
    request.key_id = "unknown-key";

    const result = await sign(request);

    expect(result).toEqual({
      ok: false,
      error: { code: "signing_key_unknown" },
    });
    expect(JSON.stringify(result)).not.toContain(key.keyId);
  });

  it("fails closed on malformed secret configuration without returning key bytes", async () => {
    const marker = "private-key-material-must-not-escape";
    env.PATTERN_ONTOLOGY_SIGNING_KEY = JSON.stringify({
      version: 1,
      keys: {
        "ontology-ed25519": {
          alg: "Ed25519",
          private_key_pkcs8: marker,
        },
      },
    });

    const result = await sign(await requestFor());

    expect(result).toEqual({
      ok: false,
      error: { code: "signer_configuration_invalid" },
    });
    expect(JSON.stringify(result)).not.toContain(marker);
  });
});
