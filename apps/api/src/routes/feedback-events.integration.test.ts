import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_A, IDENTITY_B, USER_A, USER_B, resetDb, seedUser, rows } from "../../test/helpers.js";
import { encryptPayload } from "../db/users.js";
import { fromB64 } from "../crypto.js";
import { loadReadingFeedbackEvent, loadReadingFeedbackEventExports, loadReadingFeedbackOptions, loadRetainedReadingFeedbackEvents, parseReadingFeedbackEventRequest, storeReadingFeedbackEvent } from "../db/reading-feedback-events.js";
import { ensureFirstPartyGrant } from "../db/first-party-sources.js";
import { loadReadableReadingById } from "../db/readings.js";
import { isStoredReadingV5 } from "../services/stored-reading.js";
import { buildReadingFeedbackPublicationGuards } from "../db/reading-feedback-publication.js";
import { loadContextSourceGrants } from "../db/consents.js";
import { compileReadingFeedbackEvent } from "../services/reading-feedback-compiler.js";
import { loadConstrainedContext, type ConstrainedContextLoad } from "../services/context-compiler.js";
import { prepareConstrainedReadingInput } from "@patternlike/reading-engine";
import type { ReadingFeedbackEventPayload } from "../db/reading-feedback-events.js";
import type { ContextPinV2 } from "../services/generation-command-v2.js";

const READING = "rdg_categorical_feedback";
const PARAGRAPH = "par_categorical_feedback";
const HASH = `sha256:${"ab".repeat(32)}`;
const DATE = "2026-09-09";

async function seedReading() {
  const stored = {
    schema_version: "0.5.0", reading: {
      schema_version: "0.5.0", output_schema: "daily-reading-v5", reading_id: READING, local_date: DATE,
      generated_at: `${DATE}T12:00:00Z`, assembly_mode: "constrained_model", revision: 1, locale: "en-US", domain_preference: null,
      headline: "One useful commitment", disclosure: "Generated with Codex by OpenAI from your calculated chart and enabled context.",
      paragraphs: [{ paragraph_id: PARAGRAPH, role: "primary_theme", order: 1, text: "A familiar commitment can leave room for a smaller next step." }],
    },
    evidence_header: {
      schema_version: "0.5.0", reading_id: READING, revision: 1, revision_reason: "initial", generated_at: `${DATE}T12:00:00Z`,
      generation_input_id: `gin_sha256_${"ab".repeat(32)}`, input_manifest_hash: HASH, content_hash: HASH, provider_response_hash: HASH,
      calculation: { chart_contract_id: "calc-contract-launch", cycle_policy_version: "1.4.0", daily_sky_policy_version: "1.0.0", ephemeris_data_version: "swisseph-2.10.03", container_digest: HASH, tzdb_version: "2026a", local_day_resolution_policy_version: "1.0.0" },
      model: { provider: "codex", model: "gpt-5.6-sol", prompt_version: "1.0.3", selection_policy_version: "1.1.0", validation_policy_version: "1.0.0", provider_request_id: "thread_feedback_fixture", input_tokens: 100, output_tokens: 50 },
      validation: { status: "passed", policy_version: "1.0.0", checks: [{ code: "grounding", passed: true }] },
    },
    invalidation: null,
  };
  const sealed = await encryptPayload(env, IDENTITY_A, stored, { subject: IDENTITY_A.cryptoSubject, field: "daily_readings.reading_enc", recordId: READING });
  await env.DB.prepare(
    `INSERT INTO daily_readings (id,user_id,local_date,release_version,reading_key,chart_fingerprint,contract_id,
       assembly_mode,status,revision,revision_reason,command_generation,reading_enc,reading_key_version,reading_nonce,created_at,updated_at)
     VALUES (?,?,?,NULL,?,'sha256:fixture','calc-contract-launch','constrained_model','published',1,'initial',1,?,?,?,?,?)`,
  ).bind(READING, USER_A, DATE, `reading-v5:${USER_A}:${DATE}:r1`, fromB64(sealed.ciphertext), sealed.keyVersion, sealed.nonce, `${DATE}T12:00:00Z`, `${DATE}T12:00:00Z`).run();
}

async function options(query = `revision=1&paragraph_id=${PARAGRAPH}`, userId = USER_A) {
  const response = await SELF.fetch(`http://api.test/v1/readings/${READING}/feedback-options?${query}`, { headers: { "x-user-id": userId } });
  return { response, body: await response.json() as Record<string, any> };
}

function eventRequest(grant: string, changes: Record<string, unknown> = {}) {
  return { schema_version: "reading-feedback-event/v1", category: "repetitive", revision: 1, content_hash: HASH,
    paragraph_id: PARAGRAPH, feedback_use_policy_version: "categorized-feedback-use/v1", expected_grant_state: grant,
    confirm_feedback_use: true, ...changes };
}

async function post(body: unknown, key: string | null = "categorical-feedback-one", userId = USER_A) {
  const headers: Record<string, string> = { "x-user-id": userId, "content-type": "application/json" };
  if (key !== null) headers["idempotency-key"] = key;
  const response = await SELF.fetch(`http://api.test/v1/readings/${READING}/feedback-events`, { method: "POST", headers, body: JSON.stringify(body) });
  return { response, body: await response.json() as Record<string, any> };
}

async function revoke() {
  await env.DB.prepare("UPDATE context_source_permissions SET enabled=0,permission_state='revoked' WHERE user_id=? AND source_id='USR-12'").bind(USER_A).run();
  await env.DB.prepare("UPDATE consents SET status='revoked',revoked_at='2026-09-09T12:30:00Z' WHERE user_id=? AND source_id='USR-12'").bind(USER_A).run();
}

async function feedbackPin() {
  const initial = await options();
  const stored = await post(eventRequest(initial.body.expected_grant_state));
  const now = new Date();
  const event = await loadReadingFeedbackEvent(env, IDENTITY_A, stored.body.id, now);
  const grant = (await loadContextSourceGrants(env, USER_A)).find((source) => source.source_id === "USR-12")!;
  const signal = await compileReadingFeedbackEvent(event!, grant, now);
  if (!signal) throw new Error("signal missing");
  const pin: ContextPinV2 = {
    context_ref: "context_feedback_test", signal_id: signal.signal_id, source_id: signal.source_id,
    category: signal.category, normalized_hash: signal.normalized_hash, allowed_use: "repetition_control",
    evidence_lane: signal.evidence_lane, consent_id: event!.grant.consent_id, consent_version: event!.grant.consent_version,
    permission_state: "active", freshness_status: "fresh", observed_at: signal.observed_at, expires_at: signal.expires_at,
    snapshot: signal.content,
  };
  return { pin, now };
}

async function storedEventAt(key: string, at: Date) {
  const option = await loadReadingFeedbackOptions(env, IDENTITY_A, READING, 1, null, at);
  const request = parseReadingFeedbackEventRequest(eventRequest(option!.expected_grant_state, { paragraph_id: null }))!;
  const result = await storeReadingFeedbackEvent(env, IDENTITY_A, READING, key, request, at);
  if (!result.ok) throw new Error("feedback fixture not stored");
  return (await loadReadingFeedbackEvent(env, IDENTITY_A, result.receipt.id, at))!;
}

// Copy a real writer payload under each row's own authenticated encryption
// identity, including its receipt coordinates. Mutations model retained events
// whose edition or consent no longer matches the currently readable state.
async function copyFeedbackEvents(
  template: ReadingFeedbackEventPayload,
  ids: string[],
  mutate: (event: ReadingFeedbackEventPayload) => void = () => {},
) {
  const statements: D1PreparedStatement[] = [];
  for (const id of ids) {
    const event = structuredClone(template);
    event.receipt.id = id;
    mutate(event);
    const sealed = await encryptPayload(env, IDENTITY_A, event,
      { subject: IDENTITY_A.cryptoSubject, field: "reading_feedback_events.event_enc", recordId: id });
    statements.push(env.DB.prepare(`INSERT INTO reading_feedback_events
      (id,user_id,reading_id,idempotency_key,event_enc,event_key_version,event_nonce,created_at,effect_expires_at,retention_expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, USER_A, READING, id, fromB64(sealed.ciphertext), sealed.keyVersion, sealed.nonce,
      event.receipt.created_at, event.receipt.effect_expires_at, event.receipt.retention_expires_at));
  }
  await env.DB.batch(statements);
}

function prepareFeedbackContext(context: ConstrainedContextLoad, anchor: Date, selectionVersion = "1.2.0") {
  const calculation = {
    policy_id: "feedback-fixture", policy_version: "1.0.0", orb_policy_id: null, orb_policy_version: null,
    request_digest: HASH, response_digest: HASH, container_digest: HASH, ephemeris_data_version: "swisseph-2.10.03",
  };
  return prepareConstrainedReadingInput({
    schema_version: "0.5.0", prompt_version: selectionVersion === "1.2.0" ? "1.0.4" : "1.0.3",
    output_schema: "daily-reading-v5", selection_policy_version: selectionVersion, validation_policy_version: "1.0.0",
    context_max_bytes: 98304, target_local_date: "2028-03-21", target_timezone: "Etc/UTC", locale: "en-US",
    generation_anchor: anchor.toISOString(), revision: 1, domain_preference: null,
    consent_categories: ["birth_accuracy_and_uncertainty", "calculated_natal_facts", "reading_feedback"],
    day: { day_start_at: "2028-03-21T00:00:00Z", day_end_at: "2028-03-22T00:00:00Z", anchor_at: "2028-03-21T12:00:00Z",
      anchor_resolution: "unique", tzdb_version: "2026a", local_day_resolution_policy_version: "1.0.0" },
    chart: { fingerprint: HASH, contract_id: "calc-contract-launch", contract_version: "0.2.0", container_digest: HASH,
      effective_accuracy: "exact", uncertainty: { accuracy: "exact", window_plus_minus_minutes: null, suppressed_features: [], qualified_features: [] } },
    cycle_scan: calculation, cycles: [], daily_sky: calculation, daily_sky_facts: [],
    natal_facts: [{ fact_id: "nat_feedback_fixture", fact_class: "natal_position", body: "sun", target: null, aspect: null,
      sign: "capricorn", degree_deg: 1.774002, house: null }],
    context_sources: context.sources, context_signals: context.signals, prior_readings: [],
  });
}

describe("exact-edition categorical feedback", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await seedUser(IDENTITY_B);
    await seedReading();
  });

  it("explains a new grant for the exact target without writing permission or an event", async () => {
    const result = await options();
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("cache-control")).toBe("private, no-store");
    expect(result.body).toMatchObject({
      schema_version: "reading-feedback-options/v1",
      target: { reading_id: READING, revision: 1, content_hash: HASH, paragraph_id: PARAGRAPH },
      grant_action: "create", feedback_use_policy_version: "categorized-feedback-use/v1",
      categories: ["repetitive", "not_relevant_today", "unclear"], effect_window_days: 7, retention_months: 24,
      generation_effects_active: false, latest_event: null,
    });
    expect(result.body.expected_grant_state).toMatch(/^feedback-grant:[a-f0-9]{64}$/);
    expect(await rows("SELECT id FROM consents WHERE source_id = 'USR-12'")).toEqual([]);
    expect(await rows("SELECT id FROM reading_feedback_events")).toEqual([]);
  });

  it.each(["repetitive", "not_relevant_today", "unclear"])("records %s separately from resonance with an encrypted note and bounded receipt", async (category) => {
    const initial = await options();
    const request = eventRequest(initial.body.expected_grant_state, { category, note: "Only the actual passage, please." });
    const result = await post(request);
    expect(result.response.status).toBe(201);
    expect(result.response.headers.get("cache-control")).toBe("private, no-store");
    expect(result.body).toMatchObject({ schema_version: "reading-feedback-event-receipt/v1", category,
      target: { reading_id: READING, revision: 1, content_hash: HASH, paragraph_id: PARAGRAPH } });
    expect(result.body.id).toMatch(/^rfe_[a-f0-9]{32}$/);
    if (category === "unclear") expect(result.body.effect_expires_at).toBeNull();
    else expect(Date.parse(result.body.effect_expires_at) - Date.parse(result.body.created_at)).toBe(7 * 86_400_000);
    const stored = await loadReadingFeedbackEvent(env, IDENTITY_A, result.body.id, new Date());
    expect(stored?.request.note).toBe("Only the actual passage, please.");
    expect(stored?.targets).toEqual({ fact_ids: [], theme_ids: [] });
    expect(stored?.grant.policy_version).toBe("usr-12-v1");
    expect(JSON.stringify(await rows("SELECT * FROM reading_feedback_events"))).not.toContain("Only the actual passage");
    expect(await rows("SELECT id FROM reading_feedback")).toEqual([]);
    expect(await rows("SELECT id FROM jobs WHERE idempotency_key=?", "categorical-feedback-one")).toEqual([]);
    expect((await options()).body.latest_event).toEqual(result.body);
    expect((await options("revision=1")).body.latest_event).toBeNull();
  });

  it("reuses an active grant and returns the original receipt after revocation without renewing", async () => {
    const initial = await options();
    const request = eventRequest(initial.body.expected_grant_state);
    const first = await post(request);
    const next = await options();
    expect(next.body.grant_action).toBe("reuse");
    const grants = await rows("SELECT id,version FROM consents WHERE source_id='USR-12'");
    expect((await post(eventRequest(next.body.expected_grant_state, { category: "unclear" }), "categorical-feedback-two")).response.status).toBe(201);
    expect(await rows("SELECT id,version FROM consents WHERE source_id='USR-12'")).toEqual(grants);
    await revoke();
    const replay = await post(request);
    expect(replay.response.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(await rows("SELECT permission_state,enabled FROM context_source_permissions WHERE source_id='USR-12'"))
      .toEqual([{ permission_state: "revoked", enabled: 0 }]);
    expect((await post({ ...request, note: "Changed" })).body.error.code).toBe("idempotency_conflict");
  });

  it.each(["identical", "different", "revoked after commit"])("resolves concurrent requests (%s) committed after the opening replay read", async (kind) => {
    const initial = await options();
    const first = parseReadingFeedbackEventRequest(eventRequest(initial.body.expected_grant_state, { note: "Original note." }))!;
    const second = parseReadingFeedbackEventRequest(eventRequest(initial.body.expected_grant_state,
      { note: kind === "different" ? "Changed note." : "  Original note.  " }))!;
    const key = "feedback-concurrent-first-submit";
    const prepare = env.DB.prepare.bind(env.DB);
    let intercept = true;
    let committed: Awaited<ReturnType<typeof storeReadingFeedbackEvent>> | undefined;
    const spy = vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
      const statement = prepare(sql);
      if (!intercept || !sql.includes("f.idempotency_key = ?")) return statement;
      return new Proxy(statement, { get(target, property, receiver) {
        if (property !== "bind") return Reflect.get(target, property, receiver);
        return (...values: unknown[]) => new Proxy(target.bind(...values), { get(bound, member, boundReceiver) {
          if (member !== "first") return Reflect.get(bound, member, boundReceiver);
          return async () => {
            const openingReplay = await bound.first();
            // B has read no completed event. A now commits through the real
            // store before B can inspect the newly changed first-party grant.
            if (intercept && openingReplay === null) {
              intercept = false;
              committed = await storeReadingFeedbackEvent(env, IDENTITY_A, READING, key, first);
              if (kind === "revoked after commit") await revoke();
            }
            return openingReplay;
          };
        } });
      } });
    });
    try {
      const raced = await storeReadingFeedbackEvent(env, IDENTITY_A, READING, key, second);
      expect(committed?.ok).toBe(true);
      expect(raced).toEqual(kind === "different" ? { ok: false, reason: "idempotency_conflict" } : committed);
    } finally { spy.mockRestore(); }
    expect(await rows("SELECT id FROM reading_feedback_events")).toHaveLength(1);
    expect(await rows("SELECT version,status FROM consents WHERE source_id='USR-12'"))
      .toEqual([{ version: 1, status: kind === "revoked after commit" ? "revoked" : "granted" }]);
  });

  it("refuses a stale explanation then permits a fresh deliberate renewal", async () => {
    await ensureFirstPartyGrant(env, IDENTITY_A, "USR-12");
    const initial = await options();
    await revoke();
    const stale = await post(eventRequest(initial.body.expected_grant_state));
    expect(stale.response.status).toBe(409);
    expect(stale.body.error.code).toBe("feedback_use_changed");
    expect(await rows("SELECT id FROM reading_feedback_events")).toEqual([]);
    expect(await rows("SELECT version FROM consents WHERE source_id='USR-12'")).toEqual([{ version: 1 }]);
    const refreshed = await options();
    expect(refreshed.body.grant_action).toBe("renew");
    expect((await post(eventRequest(refreshed.body.expected_grant_state))).response.status).toBe(201);
    expect(await rows("SELECT version FROM consents WHERE source_id='USR-12' ORDER BY version")).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("compares the grant again inside the guarded write before any renewal or event", async () => {
    await ensureFirstPartyGrant(env, IDENTITY_A, "USR-12");
    const initial = await options();
    const request = parseReadingFeedbackEventRequest(eventRequest(initial.body.expected_grant_state))!;
    const original = env.DB.batch.bind(env.DB);
    const spy = vi.spyOn(env.DB, "batch").mockImplementationOnce(async (statements) => {
      await revoke();
      return original(statements);
    });
    try {
      expect(await storeReadingFeedbackEvent(env, IDENTITY_A, READING, "race-feedback-grant", request))
        .toEqual({ ok: false, reason: "feedback_use_changed" });
    } finally { spy.mockRestore(); }
    expect(await rows("SELECT id FROM reading_feedback_events")).toEqual([]);
    expect(await rows("SELECT version,status FROM consents WHERE source_id='USR-12'")).toEqual([{ version: 1, status: "revoked" }]);
  });

  it("rolls grant creation back when the event insert fails", async () => {
    const initial = await options();
    await env.DB.exec("CREATE TRIGGER fail_feedback_insert BEFORE INSERT ON reading_feedback_events BEGIN SELECT RAISE(ABORT,'test event failure'); END;");
    try {
      const result = await post(eventRequest(initial.body.expected_grant_state));
      expect(result.response.status).toBe(500);
      expect(await rows("SELECT id FROM consents WHERE source_id='USR-12'")).toEqual([]);
      expect(await rows("SELECT user_id FROM context_source_permissions WHERE source_id='USR-12'")).toEqual([]);
      expect(await rows("SELECT id FROM reading_feedback_events")).toEqual([]);
    } finally { await env.DB.exec("DROP TRIGGER fail_feedback_insert;"); }
  });

  it("rejects a crypto write fence before creating the feedback grant", async () => {
    const initial = await options();
    await env.DB.prepare("UPDATE users SET crypto_write_fence='cop_00000000000000000000000000000001' WHERE id=?").bind(USER_A).run();
    expect((await post(eventRequest(initial.body.expected_grant_state))).response.status).toBe(500);
    expect(await rows("SELECT id FROM consents WHERE source_id='USR-12'")).toEqual([]);
    expect(await rows("SELECT id FROM reading_feedback_events")).toEqual([]);
  });

  it("rejects foreign, stale and nonexistent passage coordinates without a grant", async () => {
    const initial = await options();
    expect((await options(undefined, USER_B)).response.status).toBe(404);
    for (const change of [{ revision: 2 }, { content_hash: `sha256:${"00".repeat(32)}` }, { paragraph_id: "par_missing" }]) {
      expect((await post(eventRequest(initial.body.expected_grant_state, change))).response.status).toBe(404);
    }
    expect((await post(eventRequest(initial.body.expected_grant_state), "foreign-feedback-request", USER_B)).response.status).toBe(404);
    expect(await rows("SELECT id FROM consents WHERE source_id='USR-12'")).toEqual([]);
    expect(await rows("SELECT id FROM reading_feedback_events")).toEqual([]);
  });

  it.each(["revision=0", "revision=1&revision=2", "revision=1&paragraph_id=x&paragraph_id=y", "revision=1&note=hidden"])("rejects ambiguous options: %s", async (query) => {
    expect((await options(query)).response.status).toBe(400);
  });

  it("rejects unknown keys, unconfirmed use, unsupported policy, and oversized notes", async () => {
    const initial = await options();
    for (const change of [{ resonance: "not_helpful" }, { confirm_feedback_use: false }, { feedback_use_policy_version: "future" }, { note: "x".repeat(2001) }, { category: "other" }]) {
      expect((await post(eventRequest(initial.body.expected_grant_state, change))).response.status).toBe(400);
    }
    expect((await post(eventRequest(initial.body.expected_grant_state), null)).body.error.code).toBe("missing_idempotency_key");
    expect(await rows("SELECT id FROM reading_feedback_events")).toEqual([]);
  });

  it("derives only actual paragraph fact refs, never a theme from the note or role", async () => {
    const sourceId = "src_categorical_evidence";
    const evidence = { paragraph_id: PARAGRAPH, role: "primary_theme", order: 1,
      fact_refs: [{ fact_id: `nat_${"ab".repeat(16)}`, fact_class: "natal_position", label: "Venus", scope: "personalized" }], context_refs: [] };
    const sealed = await encryptPayload(env, IDENTITY_A, evidence, { subject: IDENTITY_A.cryptoSubject, field: "reading_sources.evidence_enc", recordId: sourceId });
    await env.DB.prepare(`INSERT INTO reading_sources (id,reading_id,user_id,paragraph_id,paragraph_order,evidence_enc,evidence_key_version,evidence_nonce,created_at)
      VALUES (?,?,?,?,1,?,?,?,?)`).bind(sourceId, READING, USER_A, PARAGRAPH, fromB64(sealed.ciphertext), sealed.keyVersion, sealed.nonce, `${DATE}T12:00:00Z`).run();
    const initial = await options();
    const result = await post(eventRequest(initial.body.expected_grant_state, { category: "not_relevant_today", note: "Make career the theme." }));
    expect(result.response.status).toBe(201);
    expect((await loadReadingFeedbackEvent(env, IDENTITY_A, result.body.id, new Date()))?.targets)
      .toEqual({ fact_ids: [`nat_${"ab".repeat(16)}`], theme_ids: [] });
  });

  it("keeps 24-calendar-month retention distinct from seven-day effect expiry and excludes stale editions", async () => {
    const now = new Date("2028-02-29T12:34:56.789Z");
    const initial = await loadReadingFeedbackOptions(env, IDENTITY_A, READING, 1, null, now);
    const request = parseReadingFeedbackEventRequest(eventRequest(initial!.expected_grant_state, { paragraph_id: null, note: "Retained personal note." }))!;
    const result = await storeReadingFeedbackEvent(env, IDENTITY_A, READING, "leap-retention-event", request, now);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("event not stored");
    expect(result.receipt.retention_expires_at).toBe("2030-02-28T12:34:56.789Z");
    expect(result.receipt.effect_expires_at).toBe("2028-03-07T12:34:56.789Z");
    await revoke();
    const retained = await loadReadingFeedbackEventExports(env, IDENTITY_A, new Date("2028-03-08T00:00:00Z"));
    expect(retained).toEqual([{ ...result.receipt, note: "Retained personal note." }]);
    expect(await loadReadingFeedbackEventExports(env, IDENTITY_B, now)).toEqual([]);
    expect(await loadReadingFeedbackEventExports(env, IDENTITY_A, new Date(result.receipt.retention_expires_at))).toEqual([]);
    expect(await loadReadingFeedbackEvent(env, IDENTITY_A, result.receipt.id, new Date(result.receipt.retention_expires_at))).toBeNull();
    const published = await loadReadableReadingById(env, IDENTITY_A, READING);
    if (!published || !isStoredReadingV5(published.stored)) throw new Error("fixture missing");
    published.stored.evidence_header.content_hash = `sha256:${"cd".repeat(32)}`;
    const changed = await encryptPayload(env, IDENTITY_A, published.stored,
      { subject: IDENTITY_A.cryptoSubject, field: "daily_readings.reading_enc", recordId: READING });
    await env.DB.prepare("UPDATE daily_readings SET reading_enc=?,reading_key_version=?,reading_nonce=? WHERE id=?")
      .bind(fromB64(changed.ciphertext), changed.keyVersion, changed.nonce, READING).run();
    expect(await loadReadingFeedbackEvent(env, IDENTITY_A, result.receipt.id, now)).toBeNull();
    expect(await loadRetainedReadingFeedbackEvents(env, IDENTITY_A, now)).toEqual([]);
  });

  it("treats an elapsed grant as changed use rather than silently renewing an old explanation", async () => {
    const now = new Date("2028-02-29T12:00:00Z");
    await ensureFirstPartyGrant(env, IDENTITY_A, "USR-12", now);
    await env.DB.prepare("UPDATE consents SET expires_at='2028-02-29T12:00:01Z' WHERE source_id='USR-12'").run();
    const initial = await loadReadingFeedbackOptions(env, IDENTITY_A, READING, 1, null, now);
    expect(initial?.grant_action).toBe("reuse");
    const request = parseReadingFeedbackEventRequest(eventRequest(initial!.expected_grant_state, { paragraph_id: null }))!;
    expect(await storeReadingFeedbackEvent(env, IDENTITY_A, READING, "expired-grant-request", request, new Date("2028-02-29T12:00:01Z")))
      .toEqual({ ok: false, reason: "feedback_use_changed" });
    expect(await rows("SELECT id FROM reading_feedback_events")).toEqual([]);
  });

  it.each(["revoked", "deleted event", "deleted reading", "changed event", "changed reading", "expired effect", "changed policy", "invalid expiry"])("aborts an atomic publication after %s following its final read", async (change) => {
    const { pin, now } = await feedbackPin();
    const guards = await buildReadingFeedbackPublicationGuards(env, IDENTITY_A, [pin], now);
    expect(guards).not.toBeNull();
    if (change === "revoked") await revoke();
    else if (change === "deleted event") await env.DB.prepare("DELETE FROM reading_feedback_events WHERE id=?").bind(pin.signal_id).run();
    else if (change === "deleted reading") await env.DB.prepare("DELETE FROM daily_readings WHERE id=?").bind(READING).run();
    else if (change === "changed event") await env.DB.prepare("UPDATE reading_feedback_events SET event_nonce='changed' WHERE id=?").bind(pin.signal_id).run();
    else if (change === "changed reading") await env.DB.prepare("UPDATE daily_readings SET reading_nonce='changed' WHERE id=?").bind(READING).run();
    else if (change === "expired effect") await env.DB.prepare("UPDATE reading_feedback_events SET effect_expires_at=? WHERE id=?").bind(now.toISOString(), pin.signal_id).run();
    else if (change === "changed policy") await env.DB.prepare("UPDATE consents SET policy_version='future' WHERE source_id='USR-12'").run();
    else await env.DB.prepare("UPDATE consents SET expires_at='tomorrow' WHERE source_id='USR-12'").run();
    await expect(env.DB.batch([...guards!, env.DB.prepare("UPDATE users SET locale='fr-FR' WHERE id=?").bind(USER_A)]))
      .rejects.toThrow("CHECK constraint failed");
    expect(await rows("SELECT locale FROM users WHERE id=?", USER_A)).toEqual([{ locale: "en-US" }]);
  });

  it("permits unchanged atomic inputs and rejects a changed frozen feedback snapshot", async () => {
    const { pin, now } = await feedbackPin();
    expect(await buildReadingFeedbackPublicationGuards(env, IDENTITY_A, [{ ...pin, normalized_hash: `sha256:${"00".repeat(32)}` }], now)).toBeNull();
    const guards = await buildReadingFeedbackPublicationGuards(env, IDENTITY_A, [pin], now);
    expect(guards).toHaveLength(1);
    await expect(env.DB.batch(guards!)).resolves.toBeDefined();
    expect(await buildReadingFeedbackPublicationGuards(env, IDENTITY_B, [pin], now)).toBeNull();
  });

  it.each(["superseded", "invalidated"])("preserves feedback about a retained %s edition", async (status) => {
    await env.DB.prepare("UPDATE daily_readings SET status=?,invalidated_at=? WHERE id=?")
      .bind(status, status === "invalidated" ? `${DATE}T13:00:00Z` : null, READING).run();
    const initial = await options();
    expect(initial.response.status).toBe(200);
    expect((await post(eventRequest(initial.body.expected_grant_state))).response.status).toBe(201);
  });

  it("cannot create or replay an event after its reading is erased", async () => {
    const initial = await options();
    const request = eventRequest(initial.body.expected_grant_state);
    expect((await post(request)).response.status).toBe(201);
    await env.DB.prepare("DELETE FROM daily_readings WHERE id=?").bind(READING).run();
    expect(await rows("SELECT id FROM reading_feedback_events")).toEqual([]);
    expect((await post(request)).response.status).toBe(404);
    expect((await options()).response.status).toBe(404);
  });

  it("does not let twenty newer unclear responses crowd out a live repetition event", async () => {
    const expiredAt = new Date("2028-03-01T12:00:00Z");
    const eligibleAt = new Date("2028-03-19T12:00:00Z");
    const anchor = new Date("2028-03-20T12:00:00Z");
    let initial = await loadReadingFeedbackOptions(env, IDENTITY_A, READING, 1, null, expiredAt);
    const old = parseReadingFeedbackEventRequest(eventRequest(initial!.expected_grant_state, { paragraph_id: null }))!;
    expect((await storeReadingFeedbackEvent(env, IDENTITY_A, READING, "feedback-expired-before-cap", old, expiredAt)).ok).toBe(true);
    initial = await loadReadingFeedbackOptions(env, IDENTITY_A, READING, 1, null, eligibleAt);
    const eligible = parseReadingFeedbackEventRequest(eventRequest(initial!.expected_grant_state, { paragraph_id: null }))!;
    const saved = await storeReadingFeedbackEvent(env, IDENTITY_A, READING, "feedback-live-before-cap", eligible, eligibleAt);
    if (!saved.ok) throw new Error("eligible event missing");
    const unclear = { ...eligible, category: "unclear" as const };
    for (let index = 0; index < 20; index++) {
      expect((await storeReadingFeedbackEvent(env, IDENTITY_A, READING, `feedback-unclear-${index}`, unclear, anchor)).ok).toBe(true);
    }
    expect((await loadRetainedReadingFeedbackEvents(env, IDENTITY_A, anchor)).map((event) => event.receipt.id))
      .toEqual([saved.receipt.id]);
    expect(await loadReadingFeedbackEventExports(env, IDENTITY_A, anchor)).toHaveLength(22);
  });

  it.each(["unsupported theme", "stale revision", "stale hash", "missing paragraph", "replaced grant"])(
    "admits an older repetition event after twenty candidates with %s", async (kind) => {
      const anchor = new Date("2028-03-20T12:00:00Z");
      const eligible = await storedEventAt("older-eligible-feedback", new Date("2028-03-19T12:00:00Z"));
      const newer = await storedEventAt("newer-feedback-template", anchor);
      await env.DB.prepare("DELETE FROM reading_feedback_events WHERE id=?").bind(newer.receipt.id).run();
      await copyFeedbackEvents(newer, Array.from({ length: 20 }, (_, index) => `rfe_ineligible_${index}`), (event) => {
        if (kind === "unsupported theme") {
          event.request.category = "not_relevant_today";
          event.receipt.category = "not_relevant_today";
        } else if (kind === "stale revision") {
          event.request.revision = event.receipt.target.revision = 2;
        } else if (kind === "stale hash") {
          event.request.content_hash = event.receipt.target.content_hash = `sha256:${"cd".repeat(32)}`;
        } else if (kind === "missing paragraph") {
          event.request.paragraph_id = event.receipt.target.paragraph_id = "par_erased";
        } else {
          event.grant.consent_version += 1;
        }
      });
      const loaded = await loadConstrainedContext(env, IDENTITY_A, "2028-03-21", { selectionVersion: "1.2.0", anchor });
      expect(loaded.signals.map((signal) => signal.signal_id)).toEqual([eligible.receipt.id]);
      expect(prepareFeedbackContext(loaded, anchor).selected_context.map((pin) => pin.signal_id)).toEqual([eligible.receipt.id]);
      expect(await loadReadingFeedbackEventExports(env, IDENTITY_A, anchor)).toHaveLength(21);
    },
  );

  it("stops at one hundred candidates and caps admitted feedback across formats in stable tie order", async () => {
    const anchor = new Date("2028-03-20T12:00:00Z");
    const template = await storedEventAt("feedback-bound-template", anchor);
    await env.DB.prepare("DELETE FROM reading_feedback_events WHERE id=?").bind(template.receipt.id).run();
    // Reverse insertion must not affect either the SQL boundary or packet cap.
    const ids = Array.from({ length: 101 }, (_, index) => `rfe_bounded_${String(index).padStart(3, "0")}`);
    await copyFeedbackEvents(template, [...ids].reverse());
    const legacyIds = Array.from({ length: 20 }, (_, index) => `fb_legacy_${String(index).padStart(3, "0")}`);
    await env.DB.batch(legacyIds.map((id, index) => env.DB.prepare(`INSERT INTO reading_feedback
      (id,reading_id,user_id,resonance,relevance_labels_json,created_at)
      VALUES (?,?,?,'helpful','[]',?)`).bind(id, READING, USER_A, `2028-03-19T12:00:${String(20 - index).padStart(2, "0")}.000Z`)));

    expect((await loadRetainedReadingFeedbackEvents(env, IDENTITY_A, anchor)).map((event) => event.receipt.id))
      .toEqual(ids.slice(0, 100));
    const loaded = await loadConstrainedContext(env, IDENTITY_A, "2028-03-21", { selectionVersion: "1.2.0", anchor });
    const prepared = prepareFeedbackContext(loaded, anchor);
    expect(prepared.selected_context.map((pin) => pin.signal_id)).toEqual(ids.slice(0, 20));
    expect(JSON.stringify(prepared.request)).not.toContain("rfe_bounded_");

    const incumbent = await loadConstrainedContext(env, IDENTITY_A, "2028-03-21", { selectionVersion: "1.1.0", anchor });
    const oldPacket = prepareFeedbackContext(incumbent, anchor, "1.1.0");
    expect(incumbent.signals.map((signal) => signal.signal_id)).toEqual(legacyIds);
    expect([...new Set(oldPacket.selected_context.map((pin) => pin.signal_id))]).toEqual(legacyIds);
    expect(prepared.selected_facts).toEqual(oldPacket.selected_facts);
  });
});
