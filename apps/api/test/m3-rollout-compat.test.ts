import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";
import dailyReadingFixture from "../../../contracts/m3/fixtures/valid/daily-reading.published.json";
import evidenceFixture from "../../../contracts/m3/fixtures/valid/reading-evidence.daily.json";
import { fromB64 } from "../src/crypto.js";
import { encryptPayload } from "../src/db/users.js";
import { localDateIn } from "../src/services/local-day.js";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  rows,
  seedActiveRelease,
  seedChart,
  seedUser,
} from "./helpers.js";

const ZONE = "America/Chicago";

async function seedStoredV3() {
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A, ZONE);
  const chart = await seedChart(IDENTITY_A);
  await seedActiveRelease("release-12");

  const localDate = localDateIn(ZONE, new Date());
  const readingId = "rdg_m3_compat_00000001";
  const reading = {
    ...dailyReadingFixture,
    reading_id: readingId,
    local_date: localDate,
  };
  const { paragraphs: _fixtureParagraphs, ...fixtureHeader } = evidenceFixture;
  const evidenceHeader = {
    ...fixtureHeader,
    reading_id: readingId,
    user_id: USER_A,
    local_date: localDate,
    reading_key: `user:${USER_A}:${localDate}:release-12:r1`,
    chart_fingerprint: chart.fingerprint,
  };
  const stored = {
    reading,
    assembly_id: evidenceHeader.assembly_id,
    content_hash: evidenceHeader.content_hash,
    primary_cycle_id: evidenceHeader.primary_theme?.cycle_id ?? null,
    supporting_cycle_id: null,
    validation: evidenceHeader.validation,
    evidence_header: evidenceHeader,
  };
  const sealedReading = await encryptPayload(env, IDENTITY_A, stored, {
    subject: IDENTITY_A.cryptoSubject,
    field: "daily_readings.reading_enc",
    recordId: readingId,
  });

  await rows(
    `INSERT INTO daily_readings
       (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
        contract_id, assembly_mode, status, revision, revision_reason,
        command_generation, reading_enc, reading_key_version, reading_nonce,
        created_at, updated_at)
     VALUES (?, ?, ?, 'release-12', ?, ?, 'patternlike.chart.launch',
             'deterministic', 'published', 1, 'initial', 1, ?, ?, ?, ?, ?)`,
    readingId,
    USER_A,
    localDate,
    `user:${USER_A}:${localDate}:release-12:r1`,
    chart.fingerprint,
    fromB64(sealedReading.ciphertext),
    sealedReading.keyVersion,
    sealedReading.nonce,
    new Date().toISOString(),
    new Date().toISOString(),
  );

  for (const paragraph of reading.paragraphs) {
    const sourceId = `rsc_m3_compat_${paragraph.order.toString().padStart(2, "0")}`;
    const sealedEvidence = await encryptPayload(
      env,
      IDENTITY_A,
      {
        paragraph_id: paragraph.paragraph_id,
        role: paragraph.role,
        order: paragraph.order,
        evidence_lane: "celestial_facts",
        text_hash: null,
        facts: [],
        content: [],
        context_signals: [],
        ranking_factors: [],
        model_output: null,
      },
      {
        subject: IDENTITY_A.cryptoSubject,
        field: "reading_sources.evidence_enc",
        recordId: sourceId,
      },
    );
    await rows(
      `INSERT INTO reading_sources
         (id, reading_id, user_id, paragraph_id, paragraph_order,
          evidence_enc, evidence_key_version, evidence_nonce, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sourceId,
      readingId,
      USER_A,
      paragraph.paragraph_id,
      paragraph.order,
      fromB64(sealedEvidence.ciphertext),
      sealedEvidence.keyVersion,
      sealedEvidence.nonce,
      new Date().toISOString(),
    );
  }

  return { readingId, localDate };
}

it("serves the complete M3 read-only surface on 0001+0002 with rollout off", async () => {
  const columns = await rows<{ name: string }>("PRAGMA table_info(daily_readings)");
  expect(columns.map((column) => column.name)).not.toContain("invalidated_at");
  expect(
    await rows<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'reading_provider_daily_usage'",
    ),
  ).toEqual([]);
  const { readingId, localDate } = await seedStoredV3();

  expect((await SELF.fetch("http://api.test/health")).status).toBe(200);
  expect((await SELF.fetch("http://api.test/v1/readings/today")).status).toBe(401);

  const originalFetch = globalThis.fetch;
  let outboundCalls = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    outboundCalls += 1;
    return originalFetch(...args);
  }) as typeof fetch;
  try {
    const today = await SELF.fetch("http://api.test/v1/readings/today", {
      headers: { "x-user-id": USER_A },
    });
    expect(today.status).toBe(200);
    expect(await today.json()).toMatchObject({
      schema_version: "0.3.0",
      reading: {
        output_schema: "daily-reading-v3",
        reading_id: readingId,
        local_date: localDate,
      },
      evidence_url: `/v1/readings/${readingId}/evidence`,
    });

    const evidence = await SELF.fetch(
      `http://api.test/v1/readings/${readingId}/evidence`,
      { headers: { "x-user-id": USER_A } },
    );
    expect(evidence.status).toBe(200);
    expect(await evidence.json()).toMatchObject({
      schema_version: "0.3.0",
      reading_id: readingId,
      release_version: "release-12",
    });

    const before = {
      readings: await rows("SELECT id, status FROM daily_readings"),
      jobs: await rows("SELECT id FROM jobs"),
    };
    const secondGet = await SELF.fetch("http://api.test/v1/readings/today", {
      headers: { "x-user-id": USER_A },
    });
    expect(secondGet.status).toBe(200);
    expect(await rows("SELECT id, status FROM daily_readings")).toEqual(before.readings);
    expect(await rows("SELECT id FROM jobs")).toEqual(before.jobs);

    await rows("DELETE FROM reading_sources");
    await rows("DELETE FROM daily_readings");
    const blocked = await SELF.fetch("http://api.test/v1/readings/today", {
      method: "PUT",
      headers: { "x-user-id": USER_A },
    });
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({
      error: { code: "publisher_not_configured", retryable: false },
    });
    expect(await rows("SELECT id FROM daily_readings")).toEqual([]);
    expect(await rows("SELECT id FROM jobs")).toEqual(before.jobs);
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect(outboundCalls).toBe(0);
});
