import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { LifeEvent, LifeEventRequest, TimeTravelResponse } from "@patternlike/shared";

import { createLifeEvent, updateLifeEvent } from "../db/life-events.js";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";

const BASE: LifeEventRequest = {
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

interface SourceDocument {
  schema_version: "0.2.0";
  user_id: string;
  sources: Array<Record<string, unknown> & { source_id: string; updated_at: string }>;
  updated_at: string;
}

async function sources(): Promise<SourceDocument> {
  const response = await SELF.fetch("http://api.test/v1/context-sources", {
    headers: { "x-user-id": USER_A },
  });
  return response.json() as Promise<SourceDocument>;
}

async function setUsr09(
  state: "active" | "paused" | "revoked",
  key: string,
): Promise<SourceDocument> {
  const current = await sources();
  const source = current.sources.find((item) => item.source_id === "USR-09")!;
  const response = await SELF.fetch("http://api.test/v1/context-sources", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-user-id": USER_A,
      "idempotency-key": key,
    },
    body: JSON.stringify({
      ...current,
      sources: [{ ...source, enabled: state === "active", permission_state: state }],
    }),
  });
  const body = await response.json() as SourceDocument & { error?: { code: string } };
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body;
}

async function create(
  key: string,
  overrides: Partial<LifeEventRequest> = {},
): Promise<{ status: number; body: LifeEvent & { error?: { code: string } } }> {
  const response = await SELF.fetch("http://api.test/v1/life-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": USER_A,
      "idempotency-key": key,
    },
    body: JSON.stringify({ ...BASE, ...overrides }),
  });
  return {
    status: response.status,
    body: await response.json() as LifeEvent & { error?: { code: string } },
  };
}

async function list(): Promise<{ status: number; body: { items: LifeEvent[]; error?: { code: string } } }> {
  const response = await SELF.fetch("http://api.test/v1/life-events", {
    headers: { "x-user-id": USER_A },
  });
  return {
    status: response.status,
    body: await response.json() as { items: LifeEvent[]; error?: { code: string } },
  };
}

async function travel(date: string): Promise<TimeTravelResponse> {
  const response = await SELF.fetch(`http://api.test/v1/time-travel?date=${date}`, {
    headers: { "x-user-id": USER_A },
  });
  const body = await response.json() as TimeTravelResponse;
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body;
}

describe("USR-09 hardening", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A, "America/Chicago");
    await setUsr09("active", "grant-usr09-hardening-01");
  });

  it("stamps the exact registry metadata the source policy declares", async () => {
    await create("event-metadata-key-01");

    const [signal] = await rows<{
      evidence_lane: string;
      allowed_uses_json: string;
      confidence: string;
      sensitivity: string;
      permission_state: string;
      conflict_status: string;
      consent_id: string | null;
      freshness_status: string;
      expires_at: string | null;
      retention_expires_at: string | null;
      value_encoding: string;
      source_revision: number;
      is_current: number;
    }>(
      `SELECT evidence_lane, allowed_uses_json, confidence, sensitivity,
              permission_state, conflict_status, consent_id, freshness_status,
              expires_at, retention_expires_at, value_encoding, source_revision,
              is_current
       FROM context_signals WHERE source_id = 'USR-09'`,
    );

    expect(signal).toMatchObject({
      evidence_lane: "user_and_context",
      confidence: "user_confirmed",
      sensitivity: "highly_sensitive",
      permission_state: "active",
      conflict_status: "none",
      freshness_status: "fresh",
      // Registry retention for USR-09 is "until deletion": no expiry, and no
      // retention expiry either. A value here would silently age out a record
      // the reader believes they still control.
      expires_at: null,
      retention_expires_at: null,
      value_encoding: "encrypted",
      source_revision: 1,
      is_current: 1,
    });
    expect(signal!.consent_id).toMatch(/^cns_/);

    // The initial grant is the least-privileged registry subset. Widening it to
    // daily-reading ranking needs its own policy version and consent, not a
    // quiet addition here.
    expect(JSON.parse(signal!.allowed_uses_json)).toEqual(["time_travel"]);

    const [consent] = await rows<{ permission_tier: number; source_id: string; status: string }>(
      "SELECT permission_tier, source_id, status FROM consents WHERE source_id = 'USR-09'",
    );
    expect(consent).toMatchObject({ permission_tier: 1, source_id: "USR-09", status: "granted" });

    const [permission] = await rows<{ permission_tier: number; allowed_uses_json: string }>(
      "SELECT permission_tier, allowed_uses_json FROM context_source_permissions WHERE source_id = 'USR-09'",
    );
    expect(permission).toMatchObject({ permission_tier: 1 });
    expect(JSON.parse(permission!.allowed_uses_json)).toEqual(["time_travel"]);
  });

  it("keeps no private field in a clear or indexed column and salts every hash", async () => {
    const first = await create("event-clear-key-01");
    const second = await create("event-clear-key-02", { start_date: "2026-08-09" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    // Two events with byte-identical normalized content, under different keys.
    // They must not share a clear hash: dates, categories, significance, and
    // short titles are low-entropy enough to enumerate, which is exactly what
    // the encrypted per-revision salt prevents.
    const duplicate = await create("event-clear-key-03");
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.id).not.toBe(first.body.id);

    const stored = await rows<Record<string, unknown>>(
      "SELECT * FROM context_signals WHERE source_id = 'USR-09'",
    );
    // Every clear value, ciphertext excluded. Substring for the distinctive
    // free text and equality for the low-entropy enums: `category = "work"` is
    // a substring of the server-owned provenance string "cloudflare-api-worker",
    // so a naive contains() would call that a leak and hide a real one behind
    // an expected failure.
    const clearValues = stored.flatMap((row) =>
      Object.entries(row)
        .filter(([column]) => column !== "value_enc")
        .map(([, value]) => (typeof value === "string" ? value : JSON.stringify(value ?? null))),
    );
    for (const secret of [BASE.title, BASE.note!, BASE.start_date, "hash_salt"]) {
      for (const value of clearValues) {
        expect(value, `${secret} reached a clear column`).not.toContain(secret);
      }
    }
    for (const secret of [BASE.category, BASE.significance]) {
      expect(clearValues, `${secret} reached a clear column`).not.toContain(secret);
    }
    const hashes = stored.map((row) => String(row.normalized_hash));
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("covers day, month, year, and range precision when deciding overlap", async () => {
    await seedChart(IDENTITY_A);
    // Every window is already complete: USR-09 records what happened, so a
    // month or year whose last day is still ahead is refused on creation.
    // Sequential, not concurrent: each create advances the source permission's
    // `updated_at`, which is the next create's compare-and-set precondition, so
    // firing them together is a real conflict rather than a test artefact.
    const created = [
      await create("event-precision-day", { precision: "day", start_date: "2026-06-14", title: "Day event" }),
      await create("event-precision-month", { precision: "month", start_date: "2026-06-03", end_date: null, title: "Month event" }),
      await create("event-precision-year", { precision: "year", start_date: "2025-07-09", end_date: null, title: "Year event" }),
      await create("event-precision-range", {
        precision: "range",
        start_date: "2026-06-05",
        end_date: "2026-06-20",
        title: "Range event",
      }),
    ];
    expect(created.map((item) => item.status)).toEqual([201, 201, 201, 201]);

    const inside = await travel("2026-06-14");
    expect(inside.saved_context.map((item) => item.event.title).sort()).toEqual([
      "Day event",
      "Month event",
      "Range event",
    ]);

    // A date inside the year window and outside every other one.
    const outside = await travel("2025-03-02");
    expect(outside.saved_context.map((item) => item.event.title)).toEqual(["Year event"]);

    // A month whose last day has not passed is not a completed event.
    const future = await create("event-precision-future", {
      precision: "month",
      start_date: new Date().toISOString().slice(0, 8) + "01",
      title: "This month",
    });
    expect(future.status).toBe(400);
    expect(future.body.error?.code).toBe("invalid_life_event");
  });

  it("returns the whole bounded list sorted by interval, and rejects every query parameter", async () => {
    await create("event-sort-key-01", { start_date: "2026-01-15", title: "Oldest" });
    await create("event-sort-key-02", { start_date: "2026-08-10", title: "Newest" });
    await create("event-sort-key-03", { start_date: "2026-05-04", title: "Middle" });

    const listed = await list();
    expect(listed.status).toBe(200);
    // Sorted after decryption, by normalized interval start descending. There
    // is no clear date column to sort on and no recording-order cursor.
    expect(listed.body.items.map((item) => item.title)).toEqual(["Newest", "Middle", "Oldest"]);

    for (const query of ["?limit=1", "?cursor=abc", "?date=2026-08-10", "?"]) {
      const response = await SELF.fetch(`http://api.test/v1/life-events${query}`, {
        headers: { "x-user-id": USER_A },
      });
      const body = await response.json() as { error?: { code: string } };
      if (query === "?") {
        // A bare "?" carries no parameter; it is not a rejected query.
        expect(response.status).toBe(200);
        continue;
      }
      expect(response.status, query).toBe(400);
      expect(body.error?.code).toBe("invalid_query");
    }
  });

  it("enforces the 500-event account cap without evicting anything", async () => {
    const kept = await create("event-cap-key-real", { title: "The one real event" });
    expect(kept.status).toBe(201);

    // 499 synthetic current rows take the account to the cap. Written directly
    // because the assertion this test makes is about the bound, not about 499
    // more encryptions.
    const now = new Date().toISOString();
    const [{ consent_id: consentId }] = await rows<{ consent_id: string }>(
      "SELECT consent_id FROM context_source_permissions WHERE source_id = 'USR-09'",
    );
    const statements = [];
    for (let index = 0; index < 499; index++) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO context_signals
             (id, user_id, source_id, source_window, evidence_lane, allowed_uses_json,
              confidence, sensitivity, permission_state, conflict_status, consent_id,
              freshness_status, observed_at, ingested_at, expires_at, value_encoding,
              value_json, labels_json, normalized_hash, created_at, updated_at,
              source_revision, is_current, retention_expires_at)
           VALUES (?, ?, 'USR-09', ?, 'user_and_context', '["time_travel"]',
                   'user_confirmed', 'highly_sensitive', 'active', 'none', ?,
                   'fresh', ?, ?, NULL, 'structured', '{}', '[]', ?, ?, ?, 1, 1, NULL)`,
        ).bind(
          `sig_pad${String(index).padStart(28, "0")}`,
          USER_A,
          `evt_pad${String(index).padStart(25, "0")}`,
          consentId,
          now,
          now,
          `${String(index).padStart(64, "0")}`,
          now,
          now,
        ),
      );
    }
    await env.DB.batch(statements);

    const refused = await create("event-cap-key-over", { title: "One too many" });
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("event_limit_reached");

    // Nothing was evicted or overwritten to make room.
    const [{ count }] = await rows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM context_signals WHERE source_id = 'USR-09' AND is_current = 1",
    );
    expect(count).toBe(500);
    expect(
      await rows("SELECT id FROM context_signals WHERE source_window = ?", kept.body.id),
    ).toHaveLength(1);
  });

  it("converges concurrent revisions on exactly one current row", async () => {
    const created = await create("event-race-key-01");
    const attempts = await Promise.allSettled([
      updateLifeEvent(env, IDENTITY_A, created.body.id, "race-a", { ...BASE, title: "Branch A" }),
      updateLifeEvent(env, IDENTITY_A, created.body.id, "race-b", { ...BASE, title: "Branch B" }),
    ]);
    // Neither attempt may throw: a loser reports a safe conflict.
    expect(attempts.every((attempt) => attempt.status === "fulfilled")).toBe(true);

    const current = await rows<{ source_revision: number }>(
      `SELECT source_revision FROM context_signals
       WHERE source_id = 'USR-09' AND source_window = ? AND is_current = 1`,
      created.body.id,
    );
    expect(current).toHaveLength(1);

    const revisions = await rows<{ source_revision: number }>(
      `SELECT source_revision FROM context_signals
       WHERE source_id = 'USR-09' AND source_window = ? ORDER BY source_revision`,
      created.body.id,
    );
    expect(new Set(revisions.map((row) => row.source_revision)).size).toBe(revisions.length);
  });

  it("repairs the source link when the event it pointed at is deleted", async () => {
    const created = await create("event-link-key-01");
    const [linked] = await rows<{ last_signal_id: string | null; updated_at: string }>(
      "SELECT last_signal_id, updated_at FROM context_source_permissions WHERE source_id = 'USR-09'",
    );
    expect(linked!.last_signal_id).toMatch(/^sig_/);

    const removed = await SELF.fetch(`http://api.test/v1/life-events/${created.body.id}`, {
      method: "DELETE",
      headers: { "x-user-id": USER_A, "idempotency-key": "event-link-delete-01" },
    });
    expect(removed.status).toBe(204);

    const [repaired] = await rows<{ last_signal_id: string | null; updated_at: string }>(
      "SELECT last_signal_id, updated_at FROM context_source_permissions WHERE source_id = 'USR-09'",
    );
    // A dangling link would outlive the row it named, and the next revision's
    // compare-and-set reads this timestamp as a precondition.
    expect(repaired!.last_signal_id).toBeNull();
    expect(repaired!.updated_at >= linked!.updated_at).toBe(true);

    // The repaired timestamp is the live precondition: a further write succeeds
    // against it rather than conflicting on the stale one.
    const next = await create("event-link-key-02", { title: "After the repair" });
    expect(next.status).toBe(201);
  });

  it("restores Time Travel context after pause then resume", async () => {
    const created = await create("event-resume-key-01");
    await seedChart(IDENTITY_A);

    expect((await travel("2026-08-10")).saved_context.map((item) => item.event.id))
      .toEqual([created.body.id]);

    await setUsr09("paused", "set-usr09-resume-pause-01");
    const hidden = await travel("2026-08-10");
    expect(hidden.life_event_source_state).toBe("paused");
    expect(hidden.saved_context).toEqual([]);

    await setUsr09("active", "set-usr09-resume-active-01");
    const restored = await travel("2026-08-10");
    expect(restored.life_event_source_state).toBe("active");
    expect(restored.saved_context.map((item) => item.event.id)).toEqual([created.body.id]);
  });

  it("keeps listing and deletion available while the source is paused or revoked", async () => {
    const created = await create("event-state-key-01");
    await seedChart(IDENTITY_A);

    for (const state of ["paused", "revoked"] as const) {
      await setUsr09(state, `set-usr09-${state}-01`);

      const listed = await list();
      expect(listed.status, state).toBe(200);
      expect(listed.body.items.map((item) => item.id)).toEqual([created.body.id]);

      // Revocation takes effect before the next read, without deleting anything.
      const reconstruction = await travel("2026-08-10");
      expect(reconstruction.life_event_source_state).toBe(state);
      expect(reconstruction.saved_context).toEqual([]);

      const blocked = await create(`event-state-write-${state}`, { title: "Should not save" });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error?.code).toBe("context_source_inactive");
    }

    const removed = await SELF.fetch(`http://api.test/v1/life-events/${created.body.id}`, {
      method: "DELETE",
      headers: { "x-user-id": USER_A, "idempotency-key": "event-state-delete-01" },
    });
    expect(removed.status).toBe(204);
    expect((await list()).body.items).toEqual([]);
  });

  it("never sends a life event into daily-reading context", async () => {
    await create("event-lane-key-01");
    // USR-06 is what the reading compiler reads. Widening USR-09 into that lane
    // is a separate consent decision, so the grant must not appear there.
    const permissions = await rows<{ source_id: string; allowed_uses_json: string }>(
      "SELECT source_id, allowed_uses_json FROM context_source_permissions",
    );
    for (const permission of permissions) {
      const uses = JSON.parse(permission.allowed_uses_json) as string[];
      if (permission.source_id === "USR-09") expect(uses).toEqual(["time_travel"]);
      else expect(uses).not.toContain("time_travel");
    }
  });

  it("refuses to create a revision the caller could not have read", async () => {
    // A create against an event id that does not exist is a 404, not a silent
    // insert under a caller-chosen identifier.
    const response = await SELF.fetch(
      "http://api.test/v1/life-events/evt_00000000000000000000000000000000",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-user-id": USER_A,
          "idempotency-key": "event-missing-key-01",
        },
        body: JSON.stringify(BASE),
      },
    );
    expect(response.status).toBe(404);
    expect(await rows("SELECT id FROM context_signals WHERE source_id = 'USR-09'")).toEqual([]);

    const malformed = await SELF.fetch("http://api.test/v1/life-events/not-an-event-id", {
      method: "DELETE",
      headers: { "x-user-id": USER_A, "idempotency-key": "event-missing-key-02" },
    });
    expect(malformed.status).toBe(400);
  });

  it("keeps a direct create call owner-scoped even when the route is bypassed", async () => {
    const outcome = await createLifeEvent(env, IDENTITY_A, "direct-create-01", BASE);
    expect(outcome.ok).toBe(true);
    const owners = await rows<{ user_id: string }>(
      "SELECT DISTINCT user_id FROM context_signals WHERE source_id = 'USR-09'",
    );
    expect(owners).toEqual([{ user_id: USER_A }]);
  });
});
