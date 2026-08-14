import { beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import type { LifeEvent, LifeEventRequest, TimeTravelResponse } from "@patternlike/shared";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";

const REQUEST: LifeEventRequest = {
  schema_version: "0.4.0",
  start_date: "2026-08-10",
  end_date: null,
  precision: "day",
  category: "work",
  significance: "high",
  title: "Started a new role",
  note: "A private note about the transition.",
  use_in_time_travel: true,
};

async function grantUsr09() {
  const get = await SELF.fetch("http://api.test/v1/context-sources", {
    headers: { "x-user-id": USER_A },
  });
  const document = await get.json() as {
    sources: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  const source = document.sources.find((item) => item.source_id === "USR-09")!;
  const put = await SELF.fetch("http://api.test/v1/context-sources", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-user-id": USER_A,
      "idempotency-key": "grant-usr09-source-0001",
    },
    body: JSON.stringify({
      ...document,
      sources: [{ ...source, enabled: true, permission_state: "active" }],
    }),
  });
  expect(put.status).toBe(200);
  return put.json() as Promise<{ sources: Array<Record<string, unknown>>; updated_at: string }>;
}

async function mutate(
  method: "POST" | "PUT",
  path: string,
  key: string,
  body: LifeEventRequest,
) {
  const response = await SELF.fetch(`http://api.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": USER_A,
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
  return {
    response,
    body: await response.json() as LifeEvent & { error?: { code: string } },
  };
}

async function remove(eventId: string, key: string) {
  return SELF.fetch(`http://api.test/v1/life-events/${eventId}`, {
    method: "DELETE",
    headers: { "x-user-id": USER_A, "idempotency-key": key },
  });
}

describe("USR-09 life-event routes", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A, "America/Chicago");
  });

  it("requires a separate active grant for creation but allows listing while off", async () => {
    const denied = await mutate("POST", "/v1/life-events", "event-create-denied-01", REQUEST);
    expect(denied.response.status).toBe(409);
    expect(denied.body.error?.code).toBe("context_source_inactive");

    const list = await SELF.fetch("http://api.test/v1/life-events", {
      headers: { "x-user-id": USER_A },
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ schema_version: "0.4.0", items: [] });
  });

  it("creates encrypted immutable revisions and enforces operation-scoped replay", async () => {
    await grantUsr09();
    const created = await mutate("POST", "/v1/life-events", "event-create-key-0001", REQUEST);
    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^evt_[0-9a-f]{32}$/),
      revision: 1,
      title: REQUEST.title,
      use_in_time_travel: true,
    });

    const stored = await rows<{
      value_json: string | null;
      value_enc: unknown;
      normalized_hash: string;
      consent_id: string | null;
    }>("SELECT value_json, value_enc, normalized_hash, consent_id FROM context_signals");
    expect(stored[0]).toMatchObject({
      value_json: null,
      value_enc: expect.anything(),
      normalized_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      consent_id: expect.stringMatching(/^cns_/),
    });
    expect(JSON.stringify(stored)).not.toContain(REQUEST.title);
    expect(JSON.stringify(stored)).not.toContain(REQUEST.start_date);

    const replay = await mutate("POST", "/v1/life-events", "event-create-key-0001", REQUEST);
    expect(replay.response.status).toBe(201);
    expect(replay.body).toEqual(created.body);
    const conflict = await mutate("POST", "/v1/life-events", "event-create-key-0001", {
      ...REQUEST,
      title: "A different event",
    });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body.error?.code).toBe("idempotency_conflict");

    const updated = await mutate(
      "PUT",
      `/v1/life-events/${created.body.id}`,
      "event-update-key-0001",
      { ...REQUEST, significance: "medium", note: null },
    );
    expect(updated.response.status).toBe(200);
    expect(updated.body).toMatchObject({ id: created.body.id, revision: 2, significance: "medium" });
    expect(await rows<{ source_revision: number; is_current: number }>(
      "SELECT source_revision, is_current FROM context_signals ORDER BY source_revision",
    )).toEqual([
      { source_revision: 1, is_current: 0 },
      { source_revision: 2, is_current: 1 },
    ]);
  });

  it("deletes the full chain, tombstones private replays, and keeps delete replay idempotent", async () => {
    await grantUsr09();
    const created = await mutate("POST", "/v1/life-events", "event-create-key-0002", REQUEST);
    await mutate("PUT", `/v1/life-events/${created.body.id}`, "event-update-key-0002", {
      ...REQUEST,
      title: "Revised title",
    });

    expect((await remove(created.body.id, "event-delete-key-0001")).status).toBe(204);
    expect(await rows("SELECT id FROM context_signals WHERE source_id = 'USR-09'"))
      .toHaveLength(0);
    expect(await rows<{ payload_enc: unknown; payload_key_version: number | null; payload_nonce: string | null; result_class: string }>(
      "SELECT payload_enc, payload_key_version, payload_nonce, result_class FROM jobs WHERE job_type IN ('life_event_create','life_event_update')",
    )).toEqual(expect.arrayContaining([
      { payload_enc: null, payload_key_version: null, payload_nonce: null, result_class: "event_deleted" },
      { payload_enc: null, payload_key_version: null, payload_nonce: null, result_class: "event_deleted" },
    ]));

    const retired = await mutate("POST", "/v1/life-events", "event-create-key-0002", REQUEST);
    expect(retired.response.status).toBe(410);
    expect(retired.body.error?.code).toBe("event_deleted");
    expect((await remove(created.body.id, "event-delete-key-0001")).status).toBe(204);
  });

  it("rejects future-completing and malformed precision windows", async () => {
    await grantUsr09();
    const future = await mutate("POST", "/v1/life-events", "event-future-key-0001", {
      ...REQUEST,
      start_date: "2099-01-01",
    });
    expect(future.response.status).toBe(400);
    expect(future.body.error?.code).toBe("invalid_life_event");
    const reversed = await mutate("POST", "/v1/life-events", "event-range-key-0001", {
      ...REQUEST,
      precision: "range",
      start_date: "2026-08-10",
      end_date: "2026-08-01",
    });
    expect(reversed.response.status).toBe(400);
  });

  it("adds only authorized overlapping events to Time Travel and omits unreadable ones", async () => {
    const document = await grantUsr09();
    await seedChart(IDENTITY_A);
    const created = await mutate("POST", "/v1/life-events", "event-create-key-0003", REQUEST);
    expect(created.response.status).toBe(201);
    await mutate("POST", "/v1/life-events", "event-create-key-0004", {
      ...REQUEST,
      start_date: "2026-08-09",
      use_in_time_travel: false,
      title: "Not authorized for Time Travel",
    });

    const first = await SELF.fetch("http://api.test/v1/time-travel?date=2026-08-10", {
      headers: { "x-user-id": USER_A },
    });
    const firstBody = await first.json() as TimeTravelResponse;
    expect(first.status).toBe(200);
    expect(firstBody.saved_context.map((item) => item.event.id)).toEqual([created.body.id]);
    expect(firstBody.saved_context[0]!.recording_relation).toBe("added_later");

    await env.DB.prepare(
      "UPDATE context_signals SET value_enc = x'00' WHERE source_id = 'USR-09' AND source_window = ?",
    ).bind(created.body.id).run();
    const unreadable = await SELF.fetch("http://api.test/v1/time-travel?date=2026-08-10", {
      headers: { "x-user-id": USER_A },
    });
    const unreadableBody = await unreadable.json() as TimeTravelResponse;
    expect(unreadable.status).toBe(200);
    expect(unreadableBody.saved_context).toEqual([]);
    expect(unreadableBody.unreadable_context_count).toBe(1);

    const current = await SELF.fetch("http://api.test/v1/context-sources", {
      headers: { "x-user-id": USER_A },
    }).then((response) => response.json()) as typeof document;
    const source = current.sources.find((item) => item.source_id === "USR-09")!;
    const paused = await SELF.fetch("http://api.test/v1/context-sources", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-user-id": USER_A,
        "idempotency-key": "pause-usr09-source-0001",
      },
      body: JSON.stringify({ ...current, sources: [{ ...source, enabled: false, permission_state: "paused" }] }),
    });
    expect(paused.status).toBe(200);
    const hidden = await SELF.fetch("http://api.test/v1/time-travel?date=2026-08-10", {
      headers: { "x-user-id": USER_A },
    });
    const hiddenBody = await hidden.json() as TimeTravelResponse;
    expect(hiddenBody.life_event_source_state).toBe("paused");
    expect(hiddenBody.saved_context).toEqual([]);
  });
});
