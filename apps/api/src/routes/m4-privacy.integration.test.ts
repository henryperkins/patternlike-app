import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  SELF,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { LifeEvent, LifeEventRequest } from "@patternlike/shared";

import worker from "../index.js";
import type { PrivacyMessage } from "../env.js";
import { rotateUserDek } from "../db/users.js";
import { listLifeEvents } from "../db/life-events.js";
import {
  DELETED_USER_TABLES,
  NON_PORTABLE_USER_TABLES,
  PORTABLE_USER_TABLES,
} from "../services/deletion-manifest.js";
import {
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  confirmPreferences,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";

const EVENT: LifeEventRequest = {
  schema_version: "0.4.0",
  start_date: "2026-08-10",
  end_date: null,
  precision: "day",
  category: "work",
  significance: "high",
  title: "Started a new role",
  note: "A private note nobody but the reader should ever see.",
  use_in_time_travel: true,
};

interface SourceDocument {
  schema_version: "0.2.0";
  user_id: string;
  sources: Array<Record<string, unknown> & { source_id: string }>;
  updated_at: string;
}

async function sources(userId: string): Promise<SourceDocument> {
  const response = await SELF.fetch("http://api.test/v1/context-sources", {
    headers: { "x-user-id": userId },
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<SourceDocument>;
}

async function grant(userId: string, sourceId: "USR-06" | "USR-09", key: string) {
  const current = await sources(userId);
  const source = current.sources.find((item) => item.source_id === sourceId)!;
  const response = await SELF.fetch("http://api.test/v1/context-sources", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
      "idempotency-key": key,
    },
    body: JSON.stringify({
      ...current,
      sources: [{ ...source, enabled: true, permission_state: "active" }],
    }),
  });
  expect(response.status).toBe(200);
}

async function createEvent(
  userId: string,
  key: string,
  overrides: Partial<LifeEventRequest> = {},
): Promise<LifeEvent> {
  const response = await SELF.fetch("http://api.test/v1/life-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
      "idempotency-key": key,
    },
    body: JSON.stringify({ ...EVENT, ...overrides }),
  });
  const body = await response.json() as LifeEvent & { error?: { code: string } };
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body;
}

async function saveCheckIn(userId: string, key: string) {
  const response = await SELF.fetch("http://api.test/v1/check-ins", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
      "idempotency-key": key,
    },
    body: JSON.stringify({
      energy: "high",
      pressure: "low",
      note: "A private check-in note.",
      expires_in_seconds: 86_400,
    }),
  });
  expect(response.status).toBe(201);
}

async function runExport(userId: string, key: string): Promise<Record<string, unknown>> {
  const accepted = await SELF.fetch("http://api.test/v1/exports", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
      "idempotency-key": key,
    },
    body: JSON.stringify({ include_readings: false, include_journal: false }),
  });
  const accepance = await accepted.json() as { job_id: string; resource_id: string };
  expect(accepted.status).toBe(202);

  const batch = createMessageBatch<PrivacyMessage>("patternlike-privacy-dev", [{
    id: `msg_${accepance.job_id}`,
    timestamp: new Date(),
    attempts: 1,
    body: { kind: "privacy", job_id: accepance.job_id, job_type: "export_account" },
  }]);
  const context = createExecutionContext();
  await worker.queue(batch, env);
  expect((await getQueueResult(batch, context)).retryMessages).toEqual([]);

  const download = await SELF.fetch(
    `http://api.test/v1/exports/${accepance.resource_id}/download`,
    { headers: { "x-user-id": userId } },
  );
  const text = await download.text();
  expect(download.status, text).toBe(200);
  return JSON.parse(text) as Record<string, unknown>;
}

async function deleteAccount(userId: string, key: string) {
  const accepted = await SELF.fetch("http://api.test/v1/account", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
      "idempotency-key": key,
    },
    body: JSON.stringify({ confirm: "DELETE" }),
  });
  const acceptance = await accepted.json() as { job_id: string };
  expect(accepted.status).toBe(202);

  const batch = createMessageBatch<PrivacyMessage>("patternlike-privacy-dev", [{
    id: `msg_${acceptance.job_id}`,
    timestamp: new Date(),
    attempts: 1,
    body: { kind: "privacy", job_id: acceptance.job_id, job_type: "delete_account" },
  }]);
  const context = createExecutionContext();
  await worker.queue(batch, env);
  expect((await getQueueResult(batch, context)).retryMessages).toEqual([]);
}

describe("M4 export, retention, and deletion boundary", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A, "America/Chicago");
  });

  it("exports USR-09 through the existing M6 sections and strips the internal salt", async () => {
    await grant(USER_A, "USR-06", "grant-usr06-export-01");
    await grant(USER_A, "USR-09", "grant-usr09-export-01");
    await saveCheckIn(USER_A, "checkin-export-key-01");
    const event = await createEvent(USER_A, "event-export-key-01");

    const artifact = await runExport(USER_A, "idem-export-m4-0001");
    const signals = artifact.context_signals as Array<Record<string, unknown>>;
    const byId = new Map(signals.map((signal) => [signal.source_id, signal]));

    // Both sources ride the frozen M6 section. M4 adds no top-level key.
    expect([...byId.keys()].sort()).toEqual(["USR-06", "USR-09"]);
    expect(artifact).not.toHaveProperty("life_events");

    const usr09 = byId.get("USR-09")!;
    const value = (usr09.value as { structured: Record<string, unknown> }).structured;
    const stored = value.event as Record<string, unknown>;
    expect(stored).toMatchObject({
      id: event.id,
      title: EVENT.title,
      note: EVENT.note,
      precision: "day",
      use_in_time_travel: true,
    });
    expect(value).toHaveProperty("normalized_start_date", "2026-08-10");

    // The salt protects the clear normalized_hash from being a dictionary
    // fingerprint of low-entropy dates and categories. Exporting both halves
    // beside each other would undo exactly that.
    for (const signal of signals) {
      const projected = (signal.value as { structured: Record<string, unknown> }).structured;
      expect(projected).not.toHaveProperty("hash_salt");
      expect(JSON.stringify(projected)).not.toContain("hash_salt");
      expect(signal.consent_id ?? (signal.consent as { consent_id?: string })?.consent_id)
        .toEqual(expect.stringMatching(/^cns_/));
    }
    expect(JSON.stringify(artifact)).not.toContain("hash_salt");
  });

  it("classifies the three derived M4 tables as non-portable and deletes them with the account", async () => {
    for (const table of ["natal_feature_sets", "cycle_scan_receipts", "time_travel_daily_usage"] as const) {
      expect(NON_PORTABLE_USER_TABLES).toContain(table);
      expect(PORTABLE_USER_TABLES).not.toContain(table as never);
      expect(DELETED_USER_TABLES).toContain(table);
    }

    await grant(USER_A, "USR-09", "grant-usr09-delete-01");
    await seedChart(IDENTITY_A);
    await createEvent(USER_A, "event-delete-key-01");
    // Drives a real Time Travel request so the receipt and the spend ledger
    // are populated by the product path rather than by hand.
    const travel = await SELF.fetch("http://api.test/v1/time-travel?date=2026-08-10", {
      headers: { "x-user-id": USER_A },
    });
    expect(travel.status).toBe(200);
    const pattern = await SELF.fetch("http://api.test/v1/pattern", {
      headers: { "x-user-id": USER_A },
    });
    // Pattern needs an active M4 release here; either way the lazy feature
    // derivation is what this test cares about, so only its rows are asserted.
    expect([200, 409, 503]).toContain(pattern.status);

    expect(await rows("SELECT id FROM cycle_scan_receipts WHERE user_id = ?", USER_A))
      .not.toHaveLength(0);
    expect(await rows("SELECT user_id FROM time_travel_daily_usage WHERE user_id = ?", USER_A))
      .not.toHaveLength(0);

    await deleteAccount(USER_A, "idem-delete-m4-0001");

    for (const table of ["natal_feature_sets", "natal_features", "cycle_scan_receipts", "time_travel_daily_usage", "context_signals"]) {
      expect(
        await rows(`SELECT * FROM ${table} WHERE user_id = ?`, USER_A),
        `${table} still holds rows after deletion`,
      ).toEqual([]);
    }
    expect(
      await rows("SELECT id FROM jobs WHERE user_id = ? AND job_type LIKE 'life_event%'", USER_A),
    ).toEqual([]);
  });

  it("keeps life-event ciphertext readable across a DEK rotation", async () => {
    await grant(USER_A, "USR-09", "grant-usr09-rotate-01");
    const event = await createEvent(USER_A, "event-rotate-key-01");

    // No new encrypted column: life events reuse context_signals.value_enc and
    // jobs.payload_enc, both already registered for rotation. If either were
    // missing from ENCRYPTED_COLUMNS this call would leave them unreadable.
    await rotateUserDek(env, IDENTITY_A);

    const after = await listLifeEvents(env, IDENTITY_A);
    expect(after.map((item) => item.id)).toEqual([event.id]);
    expect(after[0]).toMatchObject({ title: EVENT.title, note: EVENT.note });

    const replay = await SELF.fetch("http://api.test/v1/life-events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": USER_A,
        "idempotency-key": "event-rotate-key-01",
      },
      body: JSON.stringify(EVENT),
    });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ id: event.id, revision: 1 });
  });

  it("scopes every M4 read to its owner", async () => {
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_B, "America/Chicago");
    await grant(USER_A, "USR-09", "grant-usr09-owner-01");
    await grant(USER_B, "USR-09", "grant-usr09-owner-02");
    await seedChart(IDENTITY_A);
    const mine = await createEvent(USER_A, "event-owner-key-01");

    const theirList = await SELF.fetch("http://api.test/v1/life-events", {
      headers: { "x-user-id": USER_B },
    });
    expect(await theirList.json()).toEqual({ schema_version: "0.4.0", items: [] });

    // Another owner cannot revise or delete an event they do not own, and the
    // refusal is "not found" rather than a permission hint.
    const theirUpdate = await SELF.fetch(`http://api.test/v1/life-events/${mine.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-user-id": USER_B,
        "idempotency-key": "event-owner-key-02",
      },
      body: JSON.stringify({ ...EVENT, title: "Taken over" }),
    });
    expect(theirUpdate.status).toBe(404);
    const theirDelete = await SELF.fetch(`http://api.test/v1/life-events/${mine.id}`, {
      method: "DELETE",
      headers: { "x-user-id": USER_B, "idempotency-key": "event-owner-key-03" },
    });
    expect(theirDelete.status).toBe(404);

    await SELF.fetch("http://api.test/v1/time-travel?date=2026-08-10", {
      headers: { "x-user-id": USER_A },
    });
    const receipts = await rows<{ user_id: string }>("SELECT user_id FROM cycle_scan_receipts");
    expect(receipts.every((row) => row.user_id === USER_A)).toBe(true);

    // B has no chart, so their own request cannot reach A's receipts.
    const theirTravel = await SELF.fetch("http://api.test/v1/time-travel?date=2026-08-10", {
      headers: { "x-user-id": USER_B },
    });
    expect(theirTravel.status).toBe(404);
    expect(await rows("SELECT id FROM cycle_scan_receipts WHERE user_id = ?", USER_B)).toEqual([]);
  });
});
