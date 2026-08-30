import { env } from "cloudflare:test";
import { Jwt } from "hono/utils/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import { canonicalJson, contentHash } from "@patternlike/shared";

import { app } from "../index.js";
import {
  __resetAdminAccessJwksCacheForTests,
} from "../services/admin-access.js";
import {
  artifactAad,
  b64,
  encryptUnderContentKey,
  randomKey,
  randomNonce,
  wrapContentKey,
} from "../services/pattern-crypto.js";
import { computeOntologyBundleHash } from "../services/pattern-ontology-verify.js";
import {
  IDENTITY_A,
  USER_A,
  resetDb,
  seedUser,
} from "../../test/helpers.js";

const TEAM_DOMAIN = "https://patternlike.cloudflareaccess.com";
const POLICY_AUD = "admin-audience-tag";
const CERTS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;
const GENERATION_ID = `pgen_${"c".repeat(32)}`;
const CLAIM_ID = `pcl_${"d".repeat(32)}`;
const JOB_ID = `job_${"e".repeat(32)}`;
const CREATED_AT = "2026-08-28T06:00:00.000Z";
const ARTIFACT_ID = `part_${"f".repeat(32)}`;
const ARTIFACT_CLASS = "planner_response";
const ARTIFACT_CONTENT = {
  schema_version: "0.7.0",
  plan: "bounded test content",
};

interface JwkWithKid extends JsonWebKey {
  kid: string;
}

let keyPair: CryptoKeyPair;
let jwks: { keys: JwkWithKid[] };
let fetchSpy: ReturnType<typeof vi.spyOn>;

async function makeKeys() {
  keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicKey = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.publicKey,
  )) as JsonWebKey;
  jwks = {
    keys: [{ ...publicKey, kid: "access-key-1", alg: "RS256", use: "sig" }],
  };
}

async function accessToken(audience = POLICY_AUD): Promise<string> {
  const privateKey = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.privateKey,
  )) as JsonWebKey;
  const now = Math.floor(Date.now() / 1000);
  return Jwt.sign(
    {
      iss: TEAM_DOMAIN,
      aud: audience,
      sub: "access-subject-alice",
      exp: now + 300,
      iat: now,
    },
    { ...privateKey, kid: "access-key-1" } as never,
    "RS256",
  );
}

async function seedGeneration(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pattern_generation_claims (
         id, user_id, chart_fingerprint_hash, status, active_generation_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'reserved', ?, ?, ?)`,
    ).bind(
      CLAIM_ID,
      USER_A,
      `sha256:${"1".repeat(64)}`,
      GENERATION_ID,
      CREATED_AT,
      CREATED_AT,
    ),
    env.DB.prepare(
      `INSERT INTO jobs (
         id, job_type, user_id, idempotency_key, status, created_at
       ) VALUES (?, 'generate_pattern', ?, 'admin-pattern-fixture', 'queued', ?)`,
    ).bind(JOB_ID, USER_A, CREATED_AT),
    env.DB.prepare(
      `INSERT INTO pattern_generation_jobs (
         generation_id, job_id, user_id, claim_id, chart_id,
         chart_fingerprint_hash, feature_set_id, feature_set_hash,
         feature_policy_version, selection_policy_version, locale,
         locale_revision, consent_id, consent_policy_version,
         ontology_version, ontology_bundle_hash, corpus_release_hash,
         pattern_source_hash, reservation_reason, stage, stage_generation, plan_hash,
         candidate_hash, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'cht_admin_fixture', ?, 'nfs_admin_fixture', ?,
                 '1.0.0', '1.0.0', 'en-US', 1, 'cns_admin_fixture', '1.0.0',
                 'ontology-admin-fixture', ?, ?, ?, 'first_open', 'writing', 2,
                 ?, NULL, ?, ?)`,
    ).bind(
      GENERATION_ID,
      JOB_ID,
      USER_A,
      CLAIM_ID,
      `sha256:${"1".repeat(64)}`,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      `sha256:${"4".repeat(64)}`,
      `sha256:${"6".repeat(64)}`,
      `sha256:${"5".repeat(64)}`,
      CREATED_AT,
      CREATED_AT,
    ),
  ]);
}

async function seedArtifact(options: {
  expiresAt?: string;
  encrypt?: boolean;
} = {}): Promise<{ expiresAt: string }> {
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 300_000).toISOString();
  const objectKey = `pattern-generations/${GENERATION_ID}/${ARTIFACT_ID}.json.enc`;
  let stored = new Uint8Array([1, 2, 3, 4]);
  if (options.encrypt) {
    const contentKey = randomKey();
    const wrapped = await wrapContentKey(
      env,
      IDENTITY_A,
      GENERATION_ID,
      "pattern_generation_artifact_keys.wrapped_key_enc",
      contentKey,
      { generation_id: GENERATION_ID },
    );
    await env.DB.prepare(
      `INSERT INTO pattern_generation_artifact_keys (
         generation_id, user_id, wrapped_key_enc, wrapped_key_version,
         wrapped_key_nonce, created_at, erased_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      GENERATION_ID,
      USER_A,
      Uint8Array.from(atob(wrapped.ciphertext), (character) => character.charCodeAt(0)),
      wrapped.keyVersion,
      wrapped.nonce,
      CREATED_AT,
    ).run();
    const nonce = randomNonce();
    const ciphertext = await encryptUnderContentKey(
      ARTIFACT_CONTENT,
      contentKey,
      nonce,
      artifactAad(GENERATION_ID, ARTIFACT_ID, ARTIFACT_CLASS),
    );
    stored = new Uint8Array(nonce.length + ciphertext.length);
    stored.set(nonce, 0);
    stored.set(ciphertext, nonce.length);
  }
  await env.ARTIFACTS!.put(objectKey, stored);
  await env.DB.prepare(
    `INSERT INTO pattern_generation_artifacts (
       id, generation_id, user_id, artifact_class, object_key,
       ciphertext_sha256, plaintext_sha256, byte_length, created_at,
       expires_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).bind(
    ARTIFACT_ID,
    GENERATION_ID,
    USER_A,
    ARTIFACT_CLASS,
    objectKey,
    await contentHash(b64(stored)),
    await contentHash(JSON.stringify(ARTIFACT_CONTENT)),
    stored.byteLength,
    CREATED_AT,
    expiresAt,
  ).run();
  return { expiresAt };
}

async function seedOntologyRelease() {
  const unsigned = syntheticOntologyRelease("ontology-admin-release");
  const bundleHash = await computeOntologyBundleHash(unsigned);
  const release = { ...unsigned, bundle_hash: bundleHash };
  const objectKey = "pattern-ontology/ontology-admin-release.json";
  await env.ARTIFACTS!.put(objectKey, canonicalJson(release));
  await env.DB.prepare(
    `INSERT INTO pattern_ontology_releases (
       version, bundle_hash, corpus_release_hash, locale, status, object_key,
       evaluation_json, created_at, recalled_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).bind(
    release.ontology_version,
    release.bundle_hash,
    release.corpus_release_hash,
    release.locale,
    release.status,
    objectKey,
    JSON.stringify(release.evaluation),
    CREATED_AT,
  ).run();
  return release;
}

async function adminRequest(
  path: string,
  options: { audience?: string; authorization?: string } = {},
): Promise<Response> {
  const headers = new Headers();
  if (options.audience !== "none") {
    headers.set(
      "cf-access-jwt-assertion",
      await accessToken(options.audience),
    );
  }
  if (options.authorization) headers.set("authorization", options.authorization);
  return app.request(path, { headers }, env);
}

describe("Cloudflare Access Pattern administration", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await seedGeneration();
    __resetAdminAccessJwksCacheForTests();
    if (!keyPair) await makeKeys();
    env.ADMIN_ACCESS_TEAM_DOMAIN = TEAM_DOMAIN;
    env.ADMIN_ACCESS_POLICY_AUD = POLICY_AUD;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === CERTS_URL) {
        return new Response(JSON.stringify(jwks), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
  });

  afterEach(() => fetchSpy.mockRestore());

  it("returns the normative metadata document and mints a scoped administrator session", async () => {
    const response = await adminRequest(
      `/admin/pattern-generations/${GENERATION_ID}?purpose=quality_review`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schema_version: "0.7.0",
      generation_id: GENERATION_ID,
      stage: "writing",
      created_at: CREATED_AT,
      ontology_version: "ontology-admin-fixture",
      plan_hash: `sha256:${"5".repeat(64)}`,
      candidate_hash: null,
      artifact_count: 0,
      exact_artifacts_retained: false,
    });
    expect(response.headers.get("set-cookie")).toMatch(
      /^pl_admin_session=[^;]+; Max-Age=\d+; Path=\/admin; HttpOnly; Secure; SameSite=Strict$/,
    );
    await expect(env.DB.prepare(
      `SELECT admin_subject, role, audience, revoked_at
       FROM pattern_admin_sessions`,
    ).first()).resolves.toEqual({
      admin_subject: "access-subject-alice",
      role: "pattern_generation_auditor",
      audience: POLICY_AUD,
      revoked_at: null,
    });
    await expect(env.DB.prepare(
      `SELECT admin_subject, purpose_class, result
       FROM pattern_admin_access_events`,
    ).first()).resolves.toEqual({
      admin_subject: "access-subject-alice",
      purpose_class: "quality_review",
      result: "granted",
    });
  });

  it("requires a closed purpose before reading generation metadata", async () => {
    const response = await adminRequest(
      `/admin/pattern-generations/${GENERATION_ID}`,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_admin_purpose" },
    });
  });

  it("rejects the removed shared bearer token without an Access assertion", async () => {
    const response = await adminRequest(
      `/admin/pattern-generations/${GENERATION_ID}?purpose=quality_review`,
      { audience: "none", authorization: "Bearer retired-admin-token" },
    );
    expect(response.status).toBe(401);
  });

  it("rejects an Access assertion for a different application", async () => {
    const response = await adminRequest(
      `/admin/pattern-generations/${GENERATION_ID}?purpose=quality_review`,
      { audience: "consumer-app" },
    );
    expect(response.status).toBe(401);
  });

  it("lists artifact metadata without returning ciphertext or content", async () => {
    const { expiresAt } = await seedArtifact();
    const response = await adminRequest(
      `/admin/pattern-generations/${GENERATION_ID}/artifacts?purpose=retention_audit`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schema_version: "0.7.0",
      generation_id: GENERATION_ID,
      artifacts: [{
        artifact_id: ARTIFACT_ID,
        artifact_class: ARTIFACT_CLASS,
        created_at: CREATED_AT,
        expires_at: expiresAt,
        deleted_at: null,
      }],
    });
  });

  it("audits and decrypts one exact retained artifact", async () => {
    const { expiresAt } = await seedArtifact({ encrypt: true });
    const response = await adminRequest(
      `/admin/pattern-generations/${GENERATION_ID}/artifacts/${ARTIFACT_ID}?purpose=safety_investigation`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schema_version: "0.7.0",
      generation_id: GENERATION_ID,
      artifact_id: ARTIFACT_ID,
      artifact_class: ARTIFACT_CLASS,
      created_at: CREATED_AT,
      expires_at: expiresAt,
      content: ARTIFACT_CONTENT,
    });
    await expect(env.DB.prepare(
      `SELECT admin_subject, purpose_class, artifact_classes_json, result
       FROM pattern_admin_access_events`,
    ).first()).resolves.toEqual({
      admin_subject: "access-subject-alice",
      purpose_class: "safety_investigation",
      artifact_classes_json: JSON.stringify([ARTIFACT_CLASS]),
      result: "granted",
    });
  });

  it("returns 410 without decrypting an expired exact artifact", async () => {
    await seedArtifact({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      encrypt: true,
    });
    const response = await adminRequest(
      `/admin/pattern-generations/${GENERATION_ID}/artifacts/${ARTIFACT_ID}?purpose=incident_response`,
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "artifact_expired" },
    });
  });

  it("fails closed when the R2 object no longer matches its inventory envelope", async () => {
    await seedArtifact({ encrypt: true });
    await env.DB.prepare(
      `UPDATE pattern_generation_artifacts SET ciphertext_sha256 = ? WHERE id = ?`,
    ).bind(`sha256:${"9".repeat(64)}`, ARTIFACT_ID).run();
    const response = await adminRequest(
      `/admin/pattern-generations/${GENERATION_ID}/artifacts/${ARTIFACT_ID}?purpose=incident_response`,
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error" },
    });
  });

  it("returns ontology release metadata without record bodies", async () => {
    const release = await seedOntologyRelease();
    const response = await adminRequest(
      `/admin/pattern-ontology-releases/${release.ontology_version}?purpose=quality_review`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schema_version: "0.7.0",
      ontology_version: release.ontology_version,
      status: release.status,
      bundle_hash: release.bundle_hash,
      corpus_release_hash: release.corpus_release_hash,
      locale: release.locale,
      provenance_origin: release.provenance?.origin ?? "absent",
      record_count: release.records.length,
      evaluation: release.evaluation,
    });
  });
});
