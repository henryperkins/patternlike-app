import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cycleHash, type AuthorizedReaderUnit, type NormalizedCycle, type ReaderDailyTarget, type ReaderRelationshipsResponse } from "@patternlike/shared";
import { DETERMINISTIC_PATTERN_PUBLISHER, IDENTITY_A, IDENTITY_B, USER_A, USER_B, confirmPreferences, disablePatternAi, enablePatternAi, resetDb, seedActiveOntology, seedChart, seedUser } from "../../test/helpers.js";
import { encryptPayload } from "../db/users.js";
import { fromB64 } from "../crypto.js";
import { persistCycles } from "../db/cycles.js";
import { hashChartFingerprint } from "../db/pattern-claims.js";
import { prepareReaderRelationshipSupport, buildReaderRelationshipSupportInsert, loadReaderRelationshipSupport } from "../db/reader-relationship-supports.js";
import { readerTimingUnits } from "../services/reader-relationship-support.js";
import { saveReading } from "../db/reading-saves.js";
import { executePatternJob } from "../services/pattern-execute.js";
import { loadPatternJob } from "../services/pattern-stage-protocol.js";
import { revokePatternGenerationConsent } from "../services/pattern-lifecycle.js";
import { clearPatternReplayObjects, generatePatternReplayTestKeys, installPatternReplayTestKeys } from "../../test/pattern-replay-fixtures.js";

const HASH = `sha256:${"ab".repeat(32)}`;
const DATE = "2026-09-09";
const SAVED_DATE = "2026-09-02";
let chartId: string;
let fingerprint: string;
let chartHash: string;

async function request(path: string, userId = USER_A) {
  const response = await SELF.fetch(`http://api.test${path}`, { headers: { "x-user-id": userId } });
  return { response, body: await response.json() as Record<string, any> };
}

async function seedReading(id: string, date = DATE, options: { support?: boolean; features?: AuthorizedReaderUnit["features"]; participants?: AuthorizedReaderUnit["participants"]; status?: "published" | "invalidated" } = {}) {
  const paragraphId = `par_${id}`;
  const status = options.status ?? "published";
  const stored = {
    schema_version: "0.5.0", reading: {
      schema_version: "0.5.0", output_schema: "daily-reading-v5", reading_id: id, local_date: date,
      generated_at: `${date}T12:00:00Z`, assembly_mode: "constrained_model", revision: 1, locale: "en-US", domain_preference: null,
      headline: "One useful commitment", disclosure: "Generated with Codex by OpenAI from your calculated chart and enabled context.",
      paragraphs: [{ paragraph_id: paragraphId, role: "primary_theme", order: 1, text: "A familiar commitment can leave room for a smaller next step." }],
    },
    evidence_header: {
      schema_version: "0.5.0", reading_id: id, revision: 1, revision_reason: "initial", generated_at: `${date}T12:00:00Z`,
      generation_input_id: `gin_sha256_${"ab".repeat(32)}`, input_manifest_hash: HASH, content_hash: HASH, provider_response_hash: HASH,
      calculation: { chart_contract_id: "calc-contract-launch", cycle_policy_version: "1.4.0", daily_sky_policy_version: "1.0.0", ephemeris_data_version: "swisseph-2.10.03", container_digest: HASH, tzdb_version: "2026a", local_day_resolution_policy_version: "1.0.0" },
      model: { provider: "codex", model: "gpt-5.6-sol", prompt_version: "1.0.1", selection_policy_version: "1.0.0", validation_policy_version: "1.0.0", provider_request_id: "thread_reader_fixture", input_tokens: 100, output_tokens: 50 },
      validation: { status: "passed", policy_version: "1.0.0", checks: [{ code: "grounding", passed: true }] },
    },
    invalidation: status === "invalidated" ? { reason: "chart_correction", actor_class: "user_change", invalidated_at: `${date}T13:00:00Z` } : null,
  };
  const sealed = await encryptPayload(env, IDENTITY_A, stored, { subject: IDENTITY_A.cryptoSubject, field: "daily_readings.reading_enc", recordId: id });
  await env.DB.prepare(
    `INSERT INTO daily_readings (id,user_id,local_date,release_version,reading_key,chart_fingerprint,contract_id,
       assembly_mode,status,revision,revision_reason,command_generation,invalidated_at,reading_enc,reading_key_version,reading_nonce,created_at,updated_at)
     VALUES (?,?,?,NULL,?,?,'calc-contract-launch','constrained_model',?,1,'initial',1,?,?,?,?,?,?)`,
  ).bind(id, USER_A, date, `reading-v5:${USER_A}:${date}:r1`, fingerprint, status,
    status === "invalidated" ? `${date}T13:00:00Z` : null, fromB64(sealed.ciphertext), sealed.keyVersion, sealed.nonce, `${date}T12:00:00Z`, `${date}T12:00:00Z`).run();
  const target: ReaderDailyTarget = { kind: "daily", reading_id: id, revision: 1, content_hash: HASH, paragraph_id: paragraphId };
  if (options.support) {
    const row = await prepareReaderRelationshipSupport(env, IDENTITY_A, {
      documentKind: "daily", documentId: id, revisionKey: "1", contentHash: HASH,
      support: { schema_version: "reader-relationship-support/v1", units: [{
        target, eligible: true, birth_time: "exact", features: options.features ?? [], participants: options.participants ?? [],
        day: { chart: chartHash, local_date: date, time_zone: "America/New_York", starts_at: `${date}T04:00:00Z`, ends_at: `${date.slice(0, 8)}${String(Number(date.slice(8)) + 1).padStart(2, "0")}T04:00:00Z` },
      }] },
    });
    await buildReaderRelationshipSupportInsert(env, row, `${date}T12:00:00Z`).run();
  }
  return target;
}

function sourceQuery(target: ReaderDailyTarget) {
  return new URLSearchParams({ revision: String(target.revision), paragraph_id: target.paragraph_id, content_hash: target.content_hash });
}

const cycle: NormalizedCycle = {
  id: `cyc_${"bc".repeat(16)}`, technique: "transit", body: "saturn", target: "sun", aspect: "square",
  start_at: "2026-08-22T00:00:00Z", exact_at: "2026-09-02T11:35:00Z", end_at: "2026-09-03T00:00:00Z",
  pass_count: 1, passes: [{ pass_index: 1, direction: "direct", exact_at: "2026-09-02T11:35:00Z", speed_deg_per_day: 0.04 }], orb_deg: 3,
};

describe("authorized connected-reader routes", () => {
  afterEach(() => { disablePatternAi(); env.PATTERN_ONTOLOGY_KEYS = ""; });
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_A);
    ({ chartId, fingerprint } = await seedChart(IDENTITY_A));
    chartHash = await hashChartFingerprint(fingerprint);
  });

  it("discovers the exact encrypted edition and honestly leaves historical missing support empty", async () => {
    const target = await seedReading("rdg_reader_source");
    const query = new URLSearchParams({ revision: "1", paragraph_id: target.paragraph_id });
    const discovered = await request(`/v1/readings/${target.reading_id}/relationship-source?${query}`);
    expect(discovered.response.status).toBe(200);
    expect(discovered.response.headers.get("cache-control")).toBe("private, no-store");
    expect(discovered.body).toEqual({ schema_version: "reader-relationship-source/v1", status: "available", source: target });
    expect((await request(`/v1/readings/${target.reading_id}/relationships?${sourceQuery(target)}`)).body)
      .toMatchObject({ status: "no_supported_connection", items: [] });
    for (const [id, user, revision] of [[target.reading_id, USER_B, "1"], ["rdg_absent", USER_A, "1"], [target.reading_id, USER_A, "2"]]) {
      const unavailable = await request(`/v1/readings/${id}/relationship-source?revision=${revision}&paragraph_id=${target.paragraph_id}`, user);
      expect(unavailable.body).toEqual({ schema_version: "reader-relationship-source/v1", status: "unavailable", source: null });
    }
    const wrongHash = { ...target, content_hash: `sha256:${"00".repeat(32)}` };
    expect((await request(`/v1/readings/${target.reading_id}/relationships?${sourceQuery(wrongHash)}`)).body).toMatchObject({ status: "unavailable", items: [] });
  });

  it.each(["revision=1&revision=2&paragraph_id=par_a", "revision=0&paragraph_id=par_a", "revision=1&paragraph_id=par_a&unexpected=1", "revision=1"]) ("rejects invalid source coordinates: %s", async (query) => {
    const result = await request(`/v1/readings/rdg_reader_source/relationship-source?${query}`);
    expect(result.response.status).toBe(400);
    expect(result.response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("opens a retained ended cycle, follows its saved exact edition and revalidates removed support", async () => {
    await persistCycles(env, USER_A, chartId, [cycle]);
    const timing = (await readerTimingUnits({ cycle, chartFingerprintHash: chartHash, effectiveAccuracy: "exact", suppressedFeatures: [], timeZone: "America/New_York", policyVersion: "1.4.0" }))[0]!;
    const participant = timing.participants[0]!;
    const source = await seedReading("rdg_reader_today", DATE, { support: true, participants: [{ ...participant, role: "natal_interpretation" }] });
    const saved = await seedReading("rdg_reader_saved", SAVED_DATE, { support: true, status: "invalidated" });
    await saveReading(env, USER_A, saved.reading_id);
    const graph = (await request(`/v1/readings/${source.reading_id}/relationships?${sourceQuery(source)}`)).body as ReaderRelationshipsResponse;
    expect(graph.items.map((edge) => edge.kind)).toEqual(["shared_natal_participant", "dated_occurrence"]);
    expect(JSON.stringify(graph)).not.toContain(chartHash);
    const timingEdge = graph.items[0]!;
    const open = new URLSearchParams(sourceQuery(source));
    open.set("relationship_id", timingEdge.id);
    const detail = await request(`/v1/readings/${source.reading_id}/relationship-target?${open}`);
    expect(detail.body).toMatchObject({ status: "available", kind: "timing", target: { cycle_id: cycle.id, pass_index: 1, local_date: SAVED_DATE } });
    open.set("relationship_id", graph.items[1]!.id);
    const savedResponse = await request(`/v1/readings/${source.reading_id}/relationship-target?${open}`);
    expect(savedResponse.body).toMatchObject({ status: "available", kind: "daily", reading_status: "invalidated", target: saved, reading: { reading: { reading_id: saved.reading_id } } });
    await env.DB.prepare("DELETE FROM reader_relationship_supports WHERE document_id = ?").bind(source.reading_id).run();
    expect((await request(`/v1/readings/${source.reading_id}/relationship-target?${open}`)).body).toEqual({ schema_version: "reader-relationship-target/v1", status: "unavailable" });
  });

  it("requires exact cycle hash/pass/date/owner and the same active chart", async () => {
    await persistCycles(env, USER_A, chartId, [cycle]);
    const values = new URLSearchParams({ cycle_hash: await cycleHash(cycle), pass_index: "1", local_date: SAVED_DATE, time_zone: "America/New_York" });
    expect((await request(`/v1/timing/cycles/${cycle.id}?${values}`)).response.status).toBe(200);
    expect((await request(`/v1/timing/cycles/${cycle.id}?${values}`, USER_B)).response.status).toBe(404);
    for (const [key, value] of [["cycle_hash", "00".repeat(32)], ["pass_index", "2"], ["local_date", DATE]]) {
      const changed = new URLSearchParams(values); changed.set(key!, value!);
      expect((await request(`/v1/timing/cycles/${cycle.id}?${changed}`)).response.status).toBe(404);
    }
    await env.DB.prepare("UPDATE chart_snapshots SET status = 'superseded' WHERE id = ?").bind(chartId).run();
    expect((await request(`/v1/timing/cycles/${cycle.id}?${values}`)).response.status).toBe(404);
  });

  it("does not use unsaved editions as History targets or grant permission by navigating", async () => {
    await persistCycles(env, USER_A, chartId, [cycle]);
    const timing = (await readerTimingUnits({ cycle, chartFingerprintHash: chartHash, effectiveAccuracy: "exact", suppressedFeatures: [], timeZone: "America/New_York", policyVersion: "1.4.0" }))[0]!;
    const source = await seedReading("rdg_reader_today", DATE, { support: true, participants: [{ ...timing.participants[0]!, role: "natal_interpretation" }] });
    await seedReading("rdg_reader_unsaved", SAVED_DATE, { support: true });
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM consents WHERE user_id = ?").bind(USER_A).first<{ n: number }>();
    const result = await request(`/v1/readings/${source.reading_id}/relationships?${sourceQuery(source)}`);
    expect(result.body.items.map((edge: { kind: string }) => edge.kind)).toEqual(["shared_natal_participant"]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM consents WHERE user_id = ?").bind(USER_A).first()).toEqual(before);
  });

  it("opens the exact actually published Pattern, retains it after consent withdrawal, and refuses recall or hash drift", async () => {
    await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
    installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
    enablePatternAi();
    await seedActiveOntology();
    const reservedResponse = await SELF.fetch("http://api.test/v1/pattern-generations", {
      method: "POST", headers: { "x-user-id": USER_A, "content-type": "application/json", "idempotency-key": "reader-pattern-test-first" },
      body: JSON.stringify({ schema_version: "0.7.0", consent_policy_version: "1.1.0", confirm: "GENERATE MY PATTERN", reason: "first_open" }),
    });
    expect(reservedResponse.status).toBe(202);
    const reserved = await reservedResponse.json() as { generation: { generation_id: string } };
    let job = await loadPatternJob(env, reserved.generation.generation_id);
    for (let attempt = 0; attempt < 8 && job && job.stage !== "succeeded"; attempt += 1) {
      await executePatternJob(env, { kind: "pattern_generation", job_id: job.job_id, generation_id: job.generation_id, stage_generation: job.stage_generation }, new Date(), DETERMINISTIC_PATTERN_PUBLISHER);
      job = await loadPatternJob(env, reserved.generation.generation_id);
    }
    expect(job?.stage).toBe("succeeded");
    const row = await env.DB.prepare("SELECT id,content_hash,generated_at,ontology_version FROM pattern_documents WHERE user_id = ?")
      .bind(USER_A).first<{ id: string; content_hash: string; generated_at: string; ontology_version: string }>();
    expect(row).not.toBeNull();
    const support = await loadReaderRelationshipSupport(env, IDENTITY_A, { documentKind: "pattern", documentId: row!.id, revisionKey: `0.7.0:${row!.id}:${row!.generated_at}`, contentHash: row!.content_hash });
    const chapter = support!.units.find((unit) => unit.features.length > 0)!;
    expect(chapter).toBeDefined();
    const source = await seedReading("rdg_reader_pattern", DATE, { support: true, features: chapter.features, participants: chapter.participants });
    const graph = (await request(`/v1/readings/${source.reading_id}/relationships?${sourceQuery(source)}`)).body as ReaderRelationshipsResponse;
    const edge = graph.items.find((entry) => entry.to.kind === "pattern")!;
    expect(edge.to).toEqual(chapter.target);
    const query = sourceQuery(source); query.set("relationship_id", edge.id);
    const open = () => request(`/v1/readings/${source.reading_id}/relationship-target?${query}`);
    expect((await open()).body).toMatchObject({ status: "available", kind: "pattern", target: chapter.target, pattern: { pattern_id: row!.id } });
    await revokePatternGenerationConsent(env, IDENTITY_A);
    expect((await open()).body.status).toBe("available");
    await env.DB.prepare("UPDATE pattern_documents SET content_hash = ? WHERE id = ?").bind(HASH, row!.id).run();
    expect((await open()).body.status).toBe("unavailable");
    await env.DB.prepare("UPDATE pattern_documents SET content_hash = ? WHERE id = ?").bind(row!.content_hash, row!.id).run();
    await env.DB.prepare("UPDATE pattern_ontology_releases SET status = 'recalled' WHERE version = ?").bind(row!.ontology_version).run();
    expect((await open()).body.status).toBe("unavailable");
  });
});
