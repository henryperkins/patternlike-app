import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { PATTERN_GENERATION_CONSENT_POLICY_VERSION } from "@patternlike/shared";
import { IDENTITY_A, USER_A, resetDb, rows, seedUser } from "../../test/helpers.js";
import {
  insertPatternConsentGrant,
  latestPatternConsentVersion,
  loadLatestPatternConsent,
  loadPatternGenerationGrant,
  patternConsentDocument,
} from "./pattern-consents.js";

interface ConsentRowShape {
  id: string;
  status: string;
  policy_version: string;
  version: number;
  supersedes_consent_id: string | null;
  provider: string;
}

async function consentChain(): Promise<ConsentRowShape[]> {
  return rows<ConsentRowShape>(
    `SELECT id, status, policy_version, version, supersedes_consent_id, provider
     FROM consents WHERE user_id = ? AND kind = 'pattern_generation'
     ORDER BY version, created_at, id`,
    USER_A,
  );
}

async function insertStoredGrant(
  id: string,
  policyVersion: string,
  version: number,
  supersedes: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO consents (
       id, user_id, kind, status, permission_tier, allowed_uses_json, scopes_json,
       provider, policy_version, granted_at, version, supersedes_consent_id,
       created_at, updated_at
     ) VALUES (?, ?, 'pattern_generation', 'granted', 0, '[]', '[]', 'OpenAI',
               ?, ?, ?, ?, ?, ?)`,
  ).bind(id, USER_A, policyVersion, now, version, supersedes, now, now).run();
}

describe("Pattern generation consent", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  it("loads a grant under the current policy", async () => {
    await insertStoredGrant("cns_current", PATTERN_GENERATION_CONSENT_POLICY_VERSION, 1, null);

    const grant = await loadPatternGenerationGrant(env, USER_A);

    expect(grant).toMatchObject({
      consentId: "cns_current",
      policyVersion: PATTERN_GENERATION_CONSENT_POLICY_VERSION,
    });
  });

  it("loads a stored 1.0.0 grant as no active grant", async () => {
    // The reader agreed to copy that said provider-side storage was off, that
    // retention was thirty days, and that granting turned training off. None of
    // those is a promise this deployment can keep, so the old grant cannot go on
    // authorising generation — it has to be asked again.
    await insertStoredGrant("cns_policy_1_0_0", "1.0.0", 1, null);

    expect(await loadPatternGenerationGrant(env, USER_A)).toBeNull();
    // The row itself is untouched: consent history is append-only evidence.
    expect(await consentChain()).toEqual([
      expect.objectContaining({ id: "cns_policy_1_0_0", policy_version: "1.0.0" }),
    ]);
  });

  it("appends a 1.1.0 grant to the chain rather than rewriting it", async () => {
    await insertStoredGrant("cns_policy_1_0_0", "1.0.0", 1, null);
    const previous = await loadLatestPatternConsent(env, USER_A);

    await env.DB.batch([
      insertPatternConsentGrant(
        env,
        USER_A,
        "cns_policy_1_1_0",
        (await latestPatternConsentVersion(env, USER_A)) + 1,
        previous?.id ?? null,
        new Date().toISOString(),
      ),
    ]);

    expect(await consentChain()).toEqual([
      expect.objectContaining({
        id: "cns_policy_1_0_0",
        policy_version: "1.0.0",
        version: 1,
        supersedes_consent_id: null,
      }),
      expect.objectContaining({
        id: "cns_policy_1_1_0",
        policy_version: PATTERN_GENERATION_CONSENT_POLICY_VERSION,
        version: 2,
        supersedes_consent_id: "cns_policy_1_0_0",
        // The processor of record is unchanged, so the stored value and the
        // wire field stay `OpenAI`. What changed is what the reader was told
        // about it, which is the policy version's job to record.
        provider: "OpenAI",
      }),
    ]);
    expect(await loadPatternGenerationGrant(env, USER_A)).toMatchObject({
      consentId: "cns_policy_1_1_0",
    });
  });

  it("reports the current policy and processor in the consent document", async () => {
    expect(patternConsentDocument(null)).toMatchObject({
      status: "not_granted",
      provider: "OpenAI",
      purpose: "one_pattern_per_chart",
      policy_version: PATTERN_GENERATION_CONSENT_POLICY_VERSION,
    });
  });
});
