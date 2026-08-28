import { beforeEach, describe, expect, it, vi } from "vitest";
import { env, SELF } from "cloudflare:test";
import {
  assertExactCurrentAccountProcessingGrant,
  loadExactCurrentAccountProcessingGrant,
} from "../db/account-processing-consents.js";
import {
  IDENTITY_A,
  USER_A,
  resetDb,
  rows,
  seedUser,
} from "../../test/helpers.js";

const POLICY_VERSION = "account-processing-v1-2026-08-28";
const PATH = "http://api.test/v1/consents/account-processing";

interface AccountProcessingDocument {
  schema_version: "0.8.0";
  kind: "account_processing";
  source_id: "AST-01";
  permission_tier: 0;
  allowed_uses: ["chart_fact", "cycle_detection", "uncertainty_model"];
  provider: null;
  scopes: [];
  connector_account_id: null;
  status: "granted" | "not_granted";
  consent_id: string | null;
  account_status: "active" | "frozen";
  has_active_chart: boolean;
  regrant_will_restore_access: boolean;
  policy_version: string;
  granted_at: string | null;
  ui_surface: "onboarding" | "privacy_center" | null;
  disclosure: {
    text: string;
    links: { patternlike_terms: "/terms.html"; patternlike_privacy: "/privacy.html" };
  };
}

interface ErrorDocument {
  error: { code: string; request_id: string | null };
}

async function requestAccountProcessing(
  method: "GET" | "PUT" | "DELETE",
  options: {
    key?: string;
    surface?: "onboarding" | "privacy_center";
    policyVersion?: string;
    body?: string;
  } = {},
) {
  const headers: Record<string, string> = { "x-user-id": USER_A };
  if (options.key) headers["idempotency-key"] = options.key;
  if (options.surface) headers["x-consent-ui-surface"] = options.surface;
  let body = options.body;
  if (method === "PUT" && body === undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify({ policy_version: options.policyVersion ?? POLICY_VERSION });
  }
  const response = await SELF.fetch(PATH, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
  return {
    status: response.status,
    body: (await response.json()) as AccountProcessingDocument | ErrorDocument,
  };
}

async function request(path: string) {
  const response = await SELF.fetch(`http://api.test${path}`, {
    headers: { "x-user-id": USER_A },
  });
  return {
    status: response.status,
    body: (await response.json()) as ErrorDocument,
  };
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A, { accountProcessingConsent: false });
});

describe("account-processing consent resource", () => {
  it("serves the immutable current policy before a reader grants it", async () => {
    const response = await requestAccountProcessing("GET");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      schema_version: "0.8.0",
      kind: "account_processing",
      source_id: "AST-01",
      permission_tier: 0,
      allowed_uses: ["chart_fact", "cycle_detection", "uncertainty_model"],
      provider: null,
      scopes: [],
      connector_account_id: null,
      status: "not_granted",
      consent_id: null,
      account_status: "active",
      has_active_chart: false,
      regrant_will_restore_access: false,
      policy_version: POLICY_VERSION,
      granted_at: null,
      ui_surface: null,
      disclosure: {
        links: { patternlike_terms: "/terms.html", patternlike_privacy: "/privacy.html" },
      },
    });
  });

  it("appends a server-owned grant with an encrypted receipt and audit event", async () => {
    const response = await requestAccountProcessing("PUT", {
      key: "account-processing-grant-0001",
      surface: "onboarding",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "granted",
      account_status: "active",
      policy_version: POLICY_VERSION,
      ui_surface: "onboarding",
    });
    const consentId = (response.body as AccountProcessingDocument).consent_id;
    expect(consentId).toEqual(expect.any(String));
    expect(
      await rows(
        `SELECT kind, status, source_id, permission_tier, allowed_uses_json,
                provider, connector_account_id, scopes_json, policy_version,
                ui_surface, version
         FROM consents WHERE id = ?`,
        consentId,
      ),
    ).toEqual([
      {
        kind: "account_processing",
        status: "granted",
        source_id: "AST-01",
        permission_tier: 0,
        allowed_uses_json: JSON.stringify([
          "chart_fact",
          "cycle_detection",
          "uncertainty_model",
        ]),
        provider: null,
        connector_account_id: null,
        scopes_json: "[]",
        policy_version: POLICY_VERSION,
        ui_surface: "onboarding",
        version: 1,
      },
    ]);
    expect(
      await rows(
        `SELECT job_type, status, result_class, payload_enc IS NOT NULL AS encrypted
         FROM jobs WHERE user_id = ? AND idempotency_key = ?`,
        USER_A,
        "account-processing-grant-0001",
      ),
    ).toEqual([
      {
        job_type: "account_processing_consent_grant",
        status: "succeeded",
        result_class: "consent_cursor_refreshed",
        encrypted: 1,
      },
    ]);
    expect(
      await rows(
        "SELECT actor_id, action, resource_type, resource_id FROM audit_events WHERE actor_id = ?",
        USER_A,
      ),
    ).toEqual([
      {
        actor_id: USER_A,
        action: "consent.granted",
        resource_type: "consent",
        resource_id: consentId,
      },
    ]);
  });

  it("does not store account-processing consent while crypto writes are fenced", async () => {
    await rows(
      `UPDATE users SET crypto_write_fence =
         'cop_00000000000000000000000000000001' WHERE id = ?`,
      USER_A,
    );

    const response = await requestAccountProcessing("PUT", {
      key: "account-processing-fenced-0001",
      surface: "onboarding",
    });

    expect(response.status).toBe(409);
    expect(await rows(
      "SELECT id FROM consents WHERE user_id = ? AND kind = 'account_processing'",
      USER_A,
    )).toEqual([]);
    expect(await rows(
      "SELECT id FROM jobs WHERE idempotency_key = ?",
      "account-processing-fenced-0001",
    )).toEqual([]);
  });

  it("aborts a grant when account deletion changes lifecycle state before its batch", async () => {
    const batch = env.DB.batch.bind(env.DB);
    let injected = false;
    const batchSpy = vi.spyOn(env.DB, "batch").mockImplementation(async (statements) => {
      if (!injected) {
        injected = true;
        await env.DB.prepare(
          "UPDATE users SET status = 'pending_deletion' WHERE id = ? AND status = 'active'",
        ).bind(USER_A).run();
      }
      return batch(statements);
    });

    try {
      const response = await requestAccountProcessing("PUT", {
        key: "account-processing-deletion-race",
        surface: "onboarding",
      });
      expect(response).toMatchObject({
        status: 409,
        body: { error: { code: "account_state_conflict" } },
      });
      expect(await rows("SELECT * FROM consents WHERE user_id = ?", USER_A)).toEqual([]);
      expect(await rows("SELECT * FROM jobs WHERE user_id = ?", USER_A)).toEqual([]);
      expect(await rows("SELECT * FROM audit_events WHERE actor_id = ?", USER_A)).toEqual([]);
    } finally {
      batchSpy.mockRestore();
    }
  });

  it("freezes on revoke and reactivates only by superseding that revocation", async () => {
    const grant = await requestAccountProcessing("PUT", {
      key: "account-processing-grant-0002",
      surface: "onboarding",
    });
    const grantId = (grant.body as AccountProcessingDocument).consent_id;
    const revoked = await requestAccountProcessing("DELETE", {
      key: "account-processing-revoke-0002",
      surface: "privacy_center",
    });

    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({
      status: "not_granted",
      account_status: "frozen",
      regrant_will_restore_access: true,
    });
    expect(await request("/v1/not-a-recovery-route")).toMatchObject({
      status: 403,
      body: { error: { code: "account_not_active" } },
    });

    const regrant = await requestAccountProcessing("PUT", {
      key: "account-processing-regrant-0002",
      surface: "privacy_center",
    });
    expect(regrant.body).toMatchObject({
      status: "granted",
      account_status: "active",
      regrant_will_restore_access: false,
    });
    expect(
      await rows(
        `SELECT status, version, supersedes_consent_id
         FROM consents WHERE user_id = ? AND kind = 'account_processing' ORDER BY version`,
        USER_A,
      ),
    ).toEqual([
      { status: "granted", version: 1, supersedes_consent_id: null },
      { status: "revoked", version: 2, supersedes_consent_id: grantId },
      { status: "granted", version: 3, supersedes_consent_id: expect.any(String) },
    ]);
    expect(
      await rows(
        "SELECT action, resource_id FROM audit_events WHERE actor_id = ?",
        USER_A,
      ),
    ).toEqual(expect.arrayContaining([
      { action: "consent.granted", resource_id: grantId },
      { action: "consent.revoked", resource_id: expect.any(String) },
      { action: "account.frozen", resource_id: USER_A },
      { action: "consent.granted", resource_id: expect.any(String) },
      { action: "account.activated", resource_id: USER_A },
    ]));
  });

  it("shares an exact active-user current-grant predicate with birth reservation batches", async () => {
    const grant = await requestAccountProcessing("PUT", {
      key: "account-processing-grant-birth-assertion",
      surface: "onboarding",
    });
    const consentId = (grant.body as AccountProcessingDocument).consent_id!;

    await expect(
      loadExactCurrentAccountProcessingGrant(env, USER_A, consentId),
    ).resolves.toMatchObject({ consentId, grantedAt: expect.any(String) });
    await expect(
      loadExactCurrentAccountProcessingGrant(env, "usr_test_other_00001", consentId),
    ).resolves.toBeNull();

    await env.DB.batch([
      assertExactCurrentAccountProcessingGrant(env, USER_A, consentId),
      env.DB.prepare("UPDATE users SET locale = 'fr-CA' WHERE id = ?").bind(USER_A),
    ]);
    expect(await rows("SELECT locale FROM users WHERE id = ?", USER_A)).toEqual([
      { locale: "fr-CA" },
    ]);

    await expect(env.DB.batch([
      assertExactCurrentAccountProcessingGrant(env, USER_A, "cns_wrong_birth_assertion"),
      env.DB.prepare("UPDATE users SET locale = 'de-DE' WHERE id = ?").bind(USER_A),
    ])).rejects.toThrow();
    expect(await rows("SELECT locale FROM users WHERE id = ?", USER_A)).toEqual([
      { locale: "fr-CA" },
    ]);

    await env.DB.prepare("UPDATE users SET status = 'frozen' WHERE id = ?").bind(USER_A).run();
    await expect(
      loadExactCurrentAccountProcessingGrant(env, USER_A, consentId),
    ).resolves.toBeNull();
  });

  it("replays a receipt as the resource state at response time", async () => {
    await requestAccountProcessing("PUT", {
      key: "account-processing-grant-replay",
      surface: "onboarding",
    });
    await requestAccountProcessing("DELETE", {
      key: "account-processing-revoke-replay",
      surface: "privacy_center",
    });

    const replay = await requestAccountProcessing("PUT", {
      key: "account-processing-grant-replay",
      surface: "onboarding",
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      status: "not_granted",
      account_status: "frozen",
      regrant_will_restore_access: true,
    });
    expect(
      await rows(
        "SELECT COUNT(*) AS count FROM consents WHERE user_id = ? AND kind = 'account_processing'",
        USER_A,
      ),
    ).toEqual([{ count: 2 }]);
  });

  it("does not turn an expired non-grant into a consent-owned freeze", async () => {
    const grant = await requestAccountProcessing("PUT", {
      key: "account-processing-grant-expired",
      surface: "onboarding",
    });
    const consentId = (grant.body as AccountProcessingDocument).consent_id!;
    await env.DB.prepare(
      "UPDATE consents SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
    ).bind(consentId).run();

    const revoked = await requestAccountProcessing("DELETE", {
      key: "account-processing-revoke-expired",
      surface: "privacy_center",
    });

    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({
      status: "not_granted",
      account_status: "active",
      regrant_will_restore_access: false,
    });
    expect(
      await rows(
        `SELECT status, version FROM consents
         WHERE user_id = ? AND kind = 'account_processing' ORDER BY version`,
        USER_A,
      ),
    ).toEqual([{ status: "granted", version: 1 }]);
  });

  it("fails closed when a grant carries an unreadable expiry", async () => {
    const grant = await requestAccountProcessing("PUT", {
      key: "account-processing-grant-bad-expiry",
      surface: "onboarding",
    });
    const consentId = (grant.body as AccountProcessingDocument).consent_id!;
    await env.DB.prepare(
      "UPDATE consents SET expires_at = 'not-a-timestamp' WHERE id = ?",
    ).bind(consentId).run();

    const current = await requestAccountProcessing("GET");
    expect(current.body).toMatchObject({
      status: "not_granted",
      consent_id: null,
      account_status: "active",
    });
    expect(await request("/v1/time-travel?date=2026-08-12")).toMatchObject({
      status: 403,
      body: { error: { code: "account_processing_required" } },
    });
    await expect(
      loadExactCurrentAccountProcessingGrant(env, USER_A, consentId),
    ).resolves.toBeNull();
    await expect(
      env.DB.batch([
        assertExactCurrentAccountProcessingGrant(env, USER_A, consentId),
        env.DB.prepare("UPDATE users SET locale = 'fr-CA' WHERE id = ?").bind(USER_A),
      ]),
    ).rejects.toThrow();
  });

  it("rejects parseable but noncanonical grant timestamps in reads and assertions", async () => {
    const grant = await requestAccountProcessing("PUT", {
      key: "account-processing-grant-noncanonical-time",
      surface: "onboarding",
    });
    const consentId = (grant.body as AccountProcessingDocument).consent_id!;
    await env.DB.prepare(
      "UPDATE consents SET granted_at = 'August 28, 2026' WHERE id = ?",
    ).bind(consentId).run();

    expect(await requestAccountProcessing("GET")).toMatchObject({
      status: 200,
      body: { status: "not_granted", consent_id: null },
    });
    await expect(
      loadExactCurrentAccountProcessingGrant(env, USER_A, consentId),
    ).resolves.toBeNull();
    await expect(env.DB.batch([
      assertExactCurrentAccountProcessingGrant(env, USER_A, consentId),
      env.DB.prepare("UPDATE users SET locale = 'fr-CA' WHERE id = ?").bind(USER_A),
    ])).rejects.toThrow();
  });

  it("gates active product requests but leaves only named recovery routes available", async () => {
    expect(await request("/v1/time-travel?date=2026-08-12")).toMatchObject({
      status: 403,
      body: { error: { code: "account_processing_required" } },
    });
    expect((await requestAccountProcessing("GET")).status).toBe(200);
    expect((await request("/v1/consents/ai-synthesis")).status).toBe(200);

    await requestAccountProcessing("PUT", {
      key: "account-processing-grant-freeze-routes",
      surface: "onboarding",
    });
    await requestAccountProcessing("DELETE", {
      key: "account-processing-revoke-freeze-routes",
      surface: "privacy_center",
    });

    expect((await requestAccountProcessing("GET")).status).toBe(200);
    expect((await request("/v1/consents/unknown-future-resource")).status).toBe(403);
  });
});
