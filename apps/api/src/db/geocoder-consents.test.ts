import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  GEOCODER_CONSENT_POLICY_VERSION,
} from "@patternlike/shared";

import { IDENTITY_A, resetDb, rows, seedUser, USER_A } from "../../test/helpers.js";
import {
  grantGeocoderConsent,
  loadGeocoderConsentState,
  loadGeocoderGrant,
  revokeGeocoderConsent,
} from "./consents.js";

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
});

describe("geocoder consent chain", () => {
  it("appends the exact AST-02 grant and replays one idempotency key", async () => {
    const first = await grantGeocoderConsent(
      env,
      IDENTITY_A,
      GEOCODER_CONSENT_POLICY_VERSION,
      "onboarding",
      "geocoder-grant-0001",
      new Date("2026-08-28T08:00:00.000Z"),
    );
    const replay = await grantGeocoderConsent(
      env,
      IDENTITY_A,
      GEOCODER_CONSENT_POLICY_VERSION,
      "onboarding",
      "geocoder-grant-0001",
      new Date("2026-08-28T09:00:00.000Z"),
    );

    expect(first).toEqual(replay);
    expect(first).toMatchObject({ ok: true, state: { status: "granted" } });
    expect(await loadGeocoderGrant(env, USER_A)).toMatchObject({
      policyVersion: GEOCODER_CONSENT_POLICY_VERSION,
      uiSurface: "onboarding",
    });
    expect(await rows("SELECT id FROM consents WHERE source_id = 'AST-02'"))
      .toHaveLength(1);
  });

  it("rejects different input under the same scoped key", async () => {
    await grantGeocoderConsent(
      env,
      IDENTITY_A,
      GEOCODER_CONSENT_POLICY_VERSION,
      "onboarding",
      "geocoder-grant-0001",
    );
    expect(await grantGeocoderConsent(
      env,
      IDENTITY_A,
      GEOCODER_CONSENT_POLICY_VERSION,
      "privacy_center",
      "geocoder-grant-0001",
    )).toEqual({ ok: false, reason: "idempotency_conflict" });
  });

  it("appends revocation and refuses an old policy as authorization", async () => {
    await env.DB.prepare(
      `INSERT INTO consents (
         id, user_id, kind, status, source_id, permission_tier,
         allowed_uses_json, scopes_json, provider, connector_account_id,
         policy_version, ui_surface, granted_at, version, created_at, updated_at
       ) VALUES ('cns_geocoder_old', ?, 'product_source', 'granted', 'AST-02', 0,
                 '["chart_fact","timezone_resolution"]', '[]',
                 'google_places_geocoding_v4', NULL, 'old-policy', 'onboarding',
                 ?, 1, ?, ?)`,
    ).bind(USER_A, "2026-08-28T08:00:00.000Z", "2026-08-28T08:00:00.000Z", "2026-08-28T08:00:00.000Z").run();
    expect(await loadGeocoderGrant(env, USER_A)).toBeNull();

    const revoked = await revokeGeocoderConsent(
      env,
      IDENTITY_A,
      "privacy_center",
      "geocoder-revoke-0001",
      new Date("2026-08-28T09:00:00.000Z"),
    );
    expect(revoked).toMatchObject({ ok: true, state: { status: "not_granted" } });
    expect(await loadGeocoderConsentState(env, USER_A)).toMatchObject({
      status: "not_granted",
      uiSurface: "privacy_center",
    });
    expect(await rows("SELECT version FROM consents WHERE source_id = 'AST-02' ORDER BY version"))
      .toEqual([{ version: 1 }, { version: 2 }]);
  });
});
