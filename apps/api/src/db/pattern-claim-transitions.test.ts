import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { IDENTITY_A, USER_A, resetDb, seedUser } from "../../test/helpers.js";
import {
  acceptPatternClaim,
  deleteAcceptedPatternClaim,
  releaseUnconsumedPatternClaim,
  releasePatternRegeneration,
  reservePatternClaim,
  reservePatternRegeneration,
  supersedeAcceptedPatternClaim,
  withdrawAcceptedPatternClaim,
} from "./pattern-claim-transitions.js";

const CLAIM_ID = "pgc_transition_test";
const FINGERPRINT = `sha256:${"a".repeat(64)}`;
const AT = "2026-08-28T12:00:00.000Z";

async function claim() {
  return env.DB.prepare(
    `SELECT status, active_generation_id, pending_regeneration_id, consumed_at, accepted_at,
            deleted_at, superseded_at, withdrawn_at
     FROM pattern_generation_claims WHERE id = ?`,
  ).bind(CLAIM_ID).first<{
    status: string;
    active_generation_id: string | null;
    pending_regeneration_id: string | null;
    consumed_at: string | null;
    accepted_at: string | null;
    deleted_at: string | null;
    superseded_at: string | null;
    withdrawn_at: string | null;
  }>();
}

describe("Pattern claim transition repository", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  it("owns the live reserve, release, and accept transitions", async () => {
    await reservePatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      chartFingerprintHash: FINGERPRINT,
      chartId: "cht_transition_a",
      generationId: "pgen_transition_a",
      now: AT,
      existing: false,
    }).run();
    expect(await claim()).toMatchObject({
      status: "reserved",
      active_generation_id: "pgen_transition_a",
      consumed_at: null,
    });

    await releaseUnconsumedPatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      generationId: "pgen_transition_a",
      now: AT,
    }).run();
    expect(await claim()).toMatchObject({
      status: "available",
      active_generation_id: null,
      pending_regeneration_id: null,
      consumed_at: null,
    });

    await reservePatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      chartFingerprintHash: FINGERPRINT,
      chartId: "cht_transition_b",
      generationId: "pgen_transition_b",
      now: AT,
      existing: true,
    }).run();
    await acceptPatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      generationId: "pgen_transition_b",
      now: AT,
    }).run();
    expect(await claim()).toEqual({
      status: "accepted",
      active_generation_id: null,
      pending_regeneration_id: null,
      consumed_at: AT,
      accepted_at: AT,
      deleted_at: null,
      superseded_at: null,
      withdrawn_at: null,
    });
  });

  it.each([
    ["deleted", deleteAcceptedPatternClaim, "deleted_at"],
    ["superseded", supersedeAcceptedPatternClaim, "superseded_at"],
    ["withdrawn", withdrawAcceptedPatternClaim, "withdrawn_at"],
  ] as const)("advances accepted to the terminal %s state", async (status, transition, timestamp) => {
    await reservePatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      chartFingerprintHash: FINGERPRINT,
      chartId: "cht_transition",
      generationId: "pgen_transition",
      now: AT,
      existing: false,
    }).run();
    await acceptPatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      generationId: "pgen_transition",
      now: AT,
    }).run();
    await transition(env, { claimId: CLAIM_ID, userId: USER_A, now: AT }).run();

    expect(await claim()).toMatchObject({
      status,
      consumed_at: AT,
      [timestamp]: AT,
    });
  });
});

describe("Pattern claim transition migration guard", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await reservePatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      chartFingerprintHash: FINGERPRINT,
      chartId: "cht_transition",
      generationId: "pgen_transition",
      now: AT,
      existing: false,
    }).run();
  });

  it("rejects a reserved-to-terminal shortcut", async () => {
    await expect(env.DB.prepare(
      `UPDATE pattern_generation_claims
       SET status = 'deleted', active_generation_id = NULL,
           consumed_at = ?, deleted_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(AT, AT, AT, CLAIM_ID).run()).rejects.toThrow();
  });

  it("never permits a consumed claim to reopen or change terminal reason", async () => {
    await acceptPatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      generationId: "pgen_transition",
      now: AT,
    }).run();
    await expect(env.DB.prepare(
      `UPDATE pattern_generation_claims
       SET status = 'available', consumed_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).bind(AT, CLAIM_ID).run()).rejects.toThrow();

    await deleteAcceptedPatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      now: AT,
    }).run();
    await expect(env.DB.prepare(
      `UPDATE pattern_generation_claims
       SET status = 'superseded', deleted_at = NULL, superseded_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(AT, AT, CLAIM_ID).run()).rejects.toThrow();
  });

  it("keeps consumed_at immutable on same-state updates", async () => {
    await acceptPatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      generationId: "pgen_transition",
      now: AT,
    }).run();
    await expect(env.DB.prepare(
      `UPDATE pattern_generation_claims SET consumed_at = ?, updated_at = ? WHERE id = ?`,
    ).bind("2026-08-29T12:00:00.000Z", AT, CLAIM_ID).run()).rejects.toThrow();
  });
});

describe("Pattern accepted-claim regeneration coordinate", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await reservePatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      chartFingerprintHash: FINGERPRINT,
      chartId: "cht_transition",
      generationId: "pgen_initial",
      now: AT,
      existing: false,
    }).run();
    await acceptPatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      generationId: "pgen_initial",
      now: AT,
    }).run();
  });

  it("reserves and releases one pending generation without reopening consumption", async () => {
    const reserved = await reservePatternRegeneration(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      chartFingerprintHash: FINGERPRINT,
      chartId: "cht_transition",
      generationId: "pgen_regeneration_a",
      now: AT,
    }).run();
    expect(reserved.meta.changes).toBe(1);
    expect(await claim()).toMatchObject({
      status: "accepted",
      active_generation_id: null,
      pending_regeneration_id: "pgen_regeneration_a",
      consumed_at: AT,
      accepted_at: AT,
    });

    const loser = await reservePatternRegeneration(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      chartFingerprintHash: FINGERPRINT,
      chartId: "cht_transition",
      generationId: "pgen_regeneration_b",
      now: AT,
    }).run();
    expect(loser.meta.changes).toBe(0);

    await releasePatternRegeneration(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      generationId: "pgen_regeneration_a",
      now: AT,
    }).run();
    expect(await claim()).toMatchObject({
      status: "accepted",
      pending_regeneration_id: null,
      consumed_at: AT,
      accepted_at: AT,
    });
  });

  it("blocks owner swaps and terminal transitions until the pending job clears", async () => {
    await reservePatternRegeneration(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      chartFingerprintHash: FINGERPRINT,
      chartId: "cht_transition",
      generationId: "pgen_regeneration_a",
      now: AT,
    }).run();

    await expect(env.DB.prepare(
      `UPDATE pattern_generation_claims
       SET pending_regeneration_id = 'pgen_regeneration_b', updated_at = ?
       WHERE id = ?`,
    ).bind(AT, CLAIM_ID).run()).rejects.toThrow();
    await expect(deleteAcceptedPatternClaim(env, {
      claimId: CLAIM_ID,
      userId: USER_A,
      now: AT,
    }).run()).rejects.toThrow();
  });
});
