import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  confirmPreferences,
  resetDb,
  rows,
  seedUser,
} from "../../test/helpers.js";
import { encryptPayload } from "../db/users.js";
import { fromB64 } from "../crypto.js";
import { loadContextSourceGrants } from "../db/consents.js";
import { loadConstrainedContext, READING_FEEDBACK_SOURCE_ID } from "./context-compiler.js";

/**
 * The loader reads; it does not decide.
 *
 * Every eligibility question belongs to `prepareConstrainedReadingInput()`. What
 * these tests protect is the other half of that split: that the loader returns
 * enough for the compiler to answer them, scoped to one owner, and that it never
 * quietly filters on its own.
 */

const CONSENT_ID = "cns_ctx_source_0001";

async function seedSourceGrant(
  userId: string,
  options: {
    sourceId?: string;
    enabled?: number;
    permissionState?: string;
    permissionUses?: string[];
    consentUses?: string[];
    consentStatus?: string;
    consentSourceId?: string;
    consentId?: string | null;
  } = {},
) {
  const sourceId = options.sourceId ?? "USR-02";
  const consentId = options.consentId === undefined ? `${CONSENT_ID}_${userId}` : options.consentId;
  if (consentId) {
    await rows(
      `INSERT INTO consents (id, user_id, kind, status, source_id, policy_version,
         allowed_uses_json, scopes_json, version, granted_at, created_at, updated_at)
       VALUES (?, ?, 'product_source', ?, ?, '1.0.0', ?, '[]', 3, ?, ?, ?)`,
      consentId,
      userId,
      options.consentStatus ?? "granted",
      options.consentSourceId ?? sourceId,
      JSON.stringify(options.consentUses ?? ["life_domain_selection", "reflection_prompt"]),
      "2026-08-01T00:00:00Z",
      "2026-08-01T00:00:00Z",
      "2026-08-01T00:00:00Z",
    );
  }
  await rows(
    `INSERT INTO context_source_permissions (user_id, source_id, enabled, permission_state,
       allowed_uses_json, permission_tier, consent_id, scopes_json, updated_at)
     VALUES (?, ?, ?, ?, ?, 2, ?, '[]', ?)`,
    userId,
    sourceId,
    options.enabled ?? 1,
    options.permissionState ?? "active",
    JSON.stringify(options.permissionUses ?? ["life_domain_selection", "reflection_prompt"]),
    consentId,
    "2026-08-01T00:00:00Z",
  );
}

async function seedEncryptedSignal(
  userId: string,
  identity: typeof IDENTITY_A,
  signalId: string,
  text: string,
  observedAt = "2026-08-09T10:00:00Z",
  options: { sourceId?: string; value?: unknown } = {},
) {
  const sourceId = options.sourceId ?? "USR-02";
  const sealed = await encryptPayload(env, identity, options.value ?? { text }, {
    subject: identity.cryptoSubject,
    field: "context_signals.value_enc",
    recordId: signalId,
  });
  await rows(
    `INSERT INTO context_signals
       (id, user_id, source_id, evidence_lane, allowed_uses_json, confidence, sensitivity,
        permission_state, conflict_status, consent_id, freshness_status, observed_at,
        ingested_at, value_encoding, value_enc, value_key_version, value_nonce,
        normalized_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'user_and_context', '["life_domain_selection"]', 'high', 'personal',
             'active', 'none', ?, 'fresh', ?, ?, 'encrypted', ?, ?, ?, ?, ?, ?)`,
    signalId,
    userId,
    sourceId,
    `${CONSENT_ID}_${userId}`,
    observedAt,
    observedAt,
    fromB64(sealed.ciphertext),
    sealed.keyVersion,
    sealed.nonce,
    `hash-${signalId}`,
    observedAt,
    observedAt,
  );
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
  await seedUser(IDENTITY_B);
  await confirmPreferences(USER_A, "America/Chicago");
});

describe("context loader", () => {
  it("returns both halves of a source grant without judging them", async () => {
    await seedSourceGrant(USER_A);
    const grants = await loadContextSourceGrants(env, USER_A);

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      source_id: "USR-02",
      permission_state: "active",
      consent_status: "granted",
      consent_source_id: "USR-02",
      consent_version: 3,
    });
    expect(grants[0]!.permission_consent_id).toBe(grants[0]!.consent_id);
  });

  it("reports a disagreement rather than resolving it", async () => {
    // The compiler rejects the whole source for this. The loader's job is to
    // make the disagreement visible, not to intersect two records that do not
    // describe the same grant.
    await seedSourceGrant(USER_A, {
      permissionUses: ["life_domain_selection"],
      consentUses: ["life_domain_selection", "tone"],
      consentSourceId: "USR-03",
    });
    const [grant] = await loadContextSourceGrants(env, USER_A);
    expect(grant!.consent_source_id).toBe("USR-03");
    expect(grant!.permission_allowed_uses).toEqual(["life_domain_selection"]);
    expect(grant!.consent_allowed_uses).toEqual(["life_domain_selection", "tone"]);
  });

  it("rejects an enabled/state mismatch as an invariant failure", async () => {
    await seedSourceGrant(USER_A, { enabled: 0, permissionState: "active" });
    await expect(loadContextSourceGrants(env, USER_A)).rejects.toThrow(
      "Context-source permission state is inconsistent",
    );
  });

  it("returns a permission with no consent so the compiler can reject it", async () => {
    await seedSourceGrant(USER_A, { consentId: null });
    const [grant] = await loadContextSourceGrants(env, USER_A);
    expect(grant!.consent_id).toBe("");
    expect(grant!.consent_status).not.toBe("granted");
  });

  it("decrypts owner-scoped signal values and never another account's", async () => {
    await seedSourceGrant(USER_A);
    await seedSourceGrant(USER_B);
    await seedEncryptedSignal(USER_A, IDENTITY_A, "sig_a_0001", "Third week of the migration.");
    await seedEncryptedSignal(USER_B, IDENTITY_B, "sig_b_0001", "Someone else's sentence.");

    const loaded = await loadConstrainedContext(env, IDENTITY_A, "2026-08-10");
    const texts = loaded.signals
      .filter((s) => s.content.kind === "text")
      .map((s) => (s.content as { kind: "text"; text: string }).text);
    expect(texts).toContain("Third week of the migration.");
    expect(texts).not.toContain("Someone else's sentence.");
    expect(loaded.signals.every((s) => s.signal_id !== "sig_b_0001")).toBe(true);
  });

  it("unwraps a check-in value without exposing its private hash salt", async () => {
    await seedSourceGrant(USER_A, { sourceId: "USR-06" });
    await seedEncryptedSignal(
      USER_A,
      IDENTITY_A,
      "sig_checkin_0001",
      "unused",
      "2026-08-09T10:00:00Z",
      {
        sourceId: "USR-06",
        value: {
          hash_salt: "private-salt",
          value: { energy: "low", note: null },
        },
      },
    );

    const loaded = await loadConstrainedContext(env, IDENTITY_A, "2026-08-10");
    const signal = loaded.signals.find((item) => item.signal_id === "sig_checkin_0001");
    expect(signal?.content).toEqual({
      kind: "structured",
      value: { energy: "low", note: null },
    });
  });

  it("keeps ineligible signals rather than filtering them out of the compiler's view", async () => {
    await seedSourceGrant(USER_A, { enabled: 0, permissionState: "revoked" });
    await seedEncryptedSignal(USER_A, IDENTITY_A, "sig_a_0002", "Still loaded.");

    const loaded = await loadConstrainedContext(env, IDENTITY_A, "2026-08-10");
    // The source is plainly ineligible and the signal is still returned: the
    // compiler is what records WHY it was rejected, and it cannot record a
    // reason for something it never saw.
    expect(loaded.signals.some((s) => s.signal_id === "sig_a_0002")).toBe(true);
    expect(loaded.sources[0]!.permission_state).toBe("revoked");
  });

  it("offers reading feedback under the registry source that describes it", async () => {
    await rows(
      `INSERT INTO daily_readings
         (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
          contract_id, assembly_mode, status, revision, revision_reason,
          command_generation, created_at, updated_at)
       VALUES ('rdg_fb_0001', ?, '2026-08-08', NULL, ?, 'sha256:f', 'c',
               'constrained_model', 'failed', 1, 'initial', 1, ?, ?)`,
      USER_A,
      `reading-v5:${USER_A}:2026-08-08:r1`,
      "2026-08-08T00:00:00Z",
      "2026-08-08T00:00:00Z",
    );
    await rows(
      `INSERT INTO reading_feedback (id, reading_id, user_id, resonance,
         relevance_labels_json, created_at)
       VALUES ('fb_0001', 'rdg_fb_0001', ?, 'helpful', '["work"]', ?)`,
      USER_A,
      "2026-08-08T12:00:00Z",
    );

    const loaded = await loadConstrainedContext(env, IDENTITY_A, "2026-08-10");
    const feedback = loaded.signals.find((s) => s.signal_id === "fb_0001");
    expect(feedback).toBeDefined();
    expect(feedback!.source_id).toBe(READING_FEEDBACK_SOURCE_ID);
    expect(feedback!.category).toBe("reading_feedback");
    expect(feedback!.content.kind).toBe("structured");
    // No grant exists yet, so the compiler will reject it through exactly the
    // same gate as every other source, with no special case.
    expect(loaded.sources.some((s) => s.source_id === READING_FEEDBACK_SOURCE_ID)).toBe(false);
  });

  it("surfaces the USR-12 grant once the writer has created it", async () => {
    const { ensureFirstPartyGrant, USR12_SOURCE_ID } = await import("../db/first-party-sources.js");
    await rows(
      `INSERT INTO daily_readings
         (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
          contract_id, assembly_mode, status, revision, revision_reason,
          command_generation, created_at, updated_at)
       VALUES ('rdg_fb_0002', ?, '2026-08-08', NULL, ?, 'sha256:f', 'c',
               'constrained_model', 'failed', 1, 'initial', 1, ?, ?)`,
      USER_A,
      `reading-v5:${USER_A}:2026-08-08:r2`,
      "2026-08-08T00:00:00Z",
      "2026-08-08T00:00:00Z",
    );
    await rows(
      `INSERT INTO reading_feedback (id, reading_id, user_id, resonance,
         relevance_labels_json, created_at)
       VALUES ('fb_0002', 'rdg_fb_0002', ?, 'not_helpful', '[]', ?)`,
      USER_A,
      "2026-08-08T12:00:00Z",
    );
    await ensureFirstPartyGrant(env, IDENTITY_A, USR12_SOURCE_ID);

    const loaded = await loadConstrainedContext(env, IDENTITY_A, "2026-08-10");
    expect(loaded.sources.some((s) => s.source_id === USR12_SOURCE_ID)).toBe(true);
    expect(loaded.signals.some((s) => s.signal_id === "fb_0002")).toBe(true);
  });

  it("draws prior readings only from v5 artifacts", async () => {
    // A v3 reading has no headline, and manufacturing one from its prose would
    // invent a repetition signal rather than record one.
    const stored = {
      reading: {
        schema_version: "0.3.0",
        output_schema: "daily-reading-v3",
        reading_id: "rdg_v3_prior",
        local_date: "2026-08-09",
        generated_at: "2026-08-09T00:00:00Z",
        assembly_mode: "deterministic",
        revision: 1,
        locale: "en-US",
        domain_preference: null,
        fallback_used: false,
        paragraphs: [
          { paragraph_id: "p1", role: "primary_theme", order: 1, text: "Yesterday's lead." },
        ],
      },
    };
    const sealed = await encryptPayload(env, IDENTITY_A, stored, {
      subject: IDENTITY_A.cryptoSubject,
      field: "daily_readings.reading_enc",
      recordId: "rdg_v3_prior",
    });
    await rows(
      `INSERT INTO content_releases (version, bundle_hash, status, approver_id,
         last_author_id, changelog, created_at)
       VALUES ('release-12', 'sha256:r', 'active', 'a', 'b', 'c', ?)`,
      "2026-08-01T00:00:00Z",
    );
    await rows(
      `INSERT INTO daily_readings
         (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
          contract_id, assembly_mode, status, revision, revision_reason,
          command_generation, reading_enc, reading_key_version, reading_nonce,
          created_at, updated_at)
       VALUES ('rdg_v3_prior', ?, '2026-08-09', 'release-12', ?, 'sha256:f', 'c',
               'deterministic', 'published', 1, 'initial', 1, ?, ?, ?, ?, ?)`,
      USER_A,
      `user:${USER_A}:2026-08-09:release-12:r1`,
      fromB64(sealed.ciphertext),
      sealed.keyVersion,
      sealed.nonce,
      "2026-08-09T00:00:00Z",
      "2026-08-09T00:00:00Z",
    );

    const loaded = await loadConstrainedContext(env, IDENTITY_A, "2026-08-10");
    expect(loaded.priorReadings).toEqual([]);
  });
});
