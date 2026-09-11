import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import reading from "../../../../contracts/m5/fixtures/valid/daily-reading.codex.json";
import evidence from "../../../../contracts/m5/fixtures/valid/reading-evidence.codex.json";
import { IDENTITY_A, USER_A, USER_B, resetDb, seedUser } from "../../test/helpers.js";
import { fromB64 } from "../crypto.js";
import { encryptPayload } from "../db/users.js";
import { loadReadingFeedbackEvent, loadReadingFeedbackOptions, storeReadingFeedbackEvent } from "../db/reading-feedback-events.js";
import { loadConstrainedContext } from "./context-compiler.js";
import type { ContextPinV2 } from "./generation-command-v2.js";
import { currentCategoricalFeedbackMatches } from "./reading-feedback-admission.js";

const CREATED = new Date("2026-09-09T12:00:00.000Z");
const DEADLINE = new Date("2026-09-09T13:00:00.000Z");
const POLICY = "1.2.0";

async function context(now: Date, selectionVersion = POLICY) {
  return loadConstrainedContext(env, IDENTITY_A, "2026-09-10", { selectionVersion, anchor: now });
}

async function seedPin(): Promise<ContextPinV2> {
  const sealed = await encryptPayload(env, IDENTITY_A,
    { schema_version: "0.5.0", reading, evidence_header: evidence, invalidation: null },
    { subject: IDENTITY_A.cryptoSubject, field: "daily_readings.reading_enc", recordId: reading.reading_id });
  await env.DB.prepare(`INSERT INTO daily_readings
    (id,user_id,local_date,release_version,reading_key,chart_fingerprint,contract_id,assembly_mode,status,
     revision,revision_reason,command_generation,reading_enc,reading_key_version,reading_nonce,created_at,updated_at)
    VALUES (?,?,?,NULL,?,'sha256:fixture','calc-contract-launch','constrained_model','published',1,'initial',1,?,?,?,?,?)`)
    .bind(reading.reading_id, USER_A, reading.local_date, `reading-v5:${USER_A}:${reading.local_date}:r1`,
      fromB64(sealed.ciphertext), sealed.keyVersion, sealed.nonce, reading.generated_at, reading.generated_at).run();
  const options = await loadReadingFeedbackOptions(env, IDENTITY_A, reading.reading_id, 1, null, CREATED);
  expect(options).not.toBeNull();
  const stored = await storeReadingFeedbackEvent(env, IDENTITY_A, reading.reading_id, "admission-feedback-event", {
    schema_version: "reading-feedback-event/v1", category: "repetitive", revision: 1,
    content_hash: evidence.content_hash, feedback_use_policy_version: "categorized-feedback-use/v1",
    expected_grant_state: options!.expected_grant_state, confirm_feedback_use: true,
  }, CREATED);
  if (!stored.ok) throw new Error(stored.reason);
  const event = await loadReadingFeedbackEvent(env, IDENTITY_A, stored.receipt.id, CREATED);
  const signal = (await context(CREATED)).signals.find((item) => item.signal_id === stored.receipt.id);
  expect(signal).toBeDefined();
  if (!signal || signal.freshness_status !== "fresh") throw new Error("expected eligible fresh feedback");
  return {
    context_ref: "ctx_1", signal_id: signal!.signal_id, source_id: signal!.source_id,
    category: signal!.category, normalized_hash: signal!.normalized_hash,
    allowed_use: signal!.allowed_uses[0]!, evidence_lane: signal!.evidence_lane,
    consent_id: event!.grant.consent_id, consent_version: event!.grant.consent_version,
    permission_state: "active", freshness_status: signal!.freshness_status,
    observed_at: signal!.observed_at, expires_at: signal!.expires_at, snapshot: signal!.content,
  };
}

describe("current categorical feedback authorization", () => {
  beforeEach(async () => { await resetDb(); await seedUser(IDENTITY_A); });

  it("stops enqueue and resumed provider admission at consent expiry without changing old policy loads", async () => {
    const pin = await seedPin();
    await env.DB.prepare("UPDATE consents SET expires_at = ? WHERE id = ?").bind(DEADLINE.toISOString(), pin.consent_id).run();
    const before = new Date(DEADLINE.getTime() - 1);
    expect((await context(before)).signals.some((signal) => signal.signal_id === pin.signal_id)).toBe(true);
    expect(await currentCategoricalFeedbackMatches(env, USER_A, [pin], POLICY, before)).toBe(true);
    expect((await context(DEADLINE)).signals.some((signal) => signal.signal_id === pin.signal_id)).toBe(false);
    expect(await currentCategoricalFeedbackMatches(env, USER_A, [pin], POLICY, DEADLINE)).toBe(false);
    expect(await context(before, "1.1.0")).toEqual(await context(DEADLINE, "1.1.0"));
  });

  it.each(["expired-policy", "usr-12-v2"])("rejects a changed current consent policy %s", async (policy) => {
    const pin = await seedPin();
    await env.DB.prepare("UPDATE consents SET policy_version = ? WHERE id = ?").bind(policy, pin.consent_id).run();
    expect((await context(CREATED)).signals.some((signal) => signal.signal_id === pin.signal_id)).toBe(false);
    expect(await currentCategoricalFeedbackMatches(env, USER_A, [pin], POLICY, CREATED)).toBe(false);
  });

  it("rejects an invalid deadline, missing allowed use, and another owner", async () => {
    const pin = await seedPin();
    expect(await currentCategoricalFeedbackMatches(env, USER_B, [pin], POLICY, CREATED)).toBe(false);
    await env.DB.prepare("UPDATE consents SET expires_at = 'not-a-timestamp' WHERE id = ?").bind(pin.consent_id).run();
    expect((await context(CREATED)).signals.some((signal) => signal.signal_id === pin.signal_id)).toBe(false);
    expect(await currentCategoricalFeedbackMatches(env, USER_A, [pin], POLICY, CREATED)).toBe(false);
    await env.DB.prepare("UPDATE consents SET expires_at = NULL, allowed_uses_json = '[]' WHERE id = ?").bind(pin.consent_id).run();
    expect((await context(CREATED)).signals.some((signal) => signal.signal_id === pin.signal_id)).toBe(false);
    expect(await currentCategoricalFeedbackMatches(env, USER_A, [pin], POLICY, CREATED)).toBe(false);
  });
});
