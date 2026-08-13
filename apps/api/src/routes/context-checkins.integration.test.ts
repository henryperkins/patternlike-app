import { SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  resetDb,
  rows,
  seedUser,
} from "../../test/helpers.js";

interface SourceProjection {
  schema_version: "0.2.0";
  user_id: string;
  source_id: "USR-06";
  enabled: boolean;
  permission_state: "active" | "paused" | "revoked" | "expired" | "never_granted";
  allowed_uses: string[];
  permission_tier: 1;
  consent_id: string | null;
  freshness: null;
  last_signal_id: string | null;
  scopes: string[];
  connector_status: "not_applicable";
  updated_at: string;
}

interface SourcesDocument {
  schema_version: "0.2.0";
  user_id: string;
  sources: [SourceProjection];
  updated_at: string;
}

async function getSources(): Promise<{ status: number; body: SourcesDocument }> {
  const response = await SELF.fetch("http://api.test/v1/context-sources", {
    headers: { "x-user-id": USER_A },
  });
  return { status: response.status, body: (await response.json()) as SourcesDocument };
}

async function putSources(key: string, body: SourcesDocument) {
  const response = await SELF.fetch("http://api.test/v1/context-sources", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-user-id": USER_A,
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as SourcesDocument & {
      error?: { code: string };
    },
  };
}

function desired(
  document: SourcesDocument,
  state: "active" | "paused" | "revoked",
): SourcesDocument {
  const source = document.sources[0];
  return {
    ...document,
    sources: [
      {
        ...source,
        enabled: state === "active",
        permission_state: state,
      },
    ],
  };
}

async function enableSource() {
  const current = await getSources();
  const enabled = await putSources(
    "idem-context-enable-1",
    desired(current.body, "active"),
  );
  expect(enabled.status).toBe(200);
  return enabled.body;
}

async function postCheckIn(key: string, body: Record<string, unknown>) {
  const response = await SELF.fetch("http://api.test/v1/check-ins", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": USER_A,
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown> & {
      error?: { code: string };
    },
  };
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("USR-06 context source", () => {
  it("projects exactly one server-owned source and appends every legal transition", async () => {
    const initial = await getSources();
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({
      schema_version: "0.2.0",
      user_id: USER_A,
      sources: [
        {
          schema_version: "0.2.0",
          user_id: USER_A,
          source_id: "USR-06",
          enabled: false,
          permission_state: "never_granted",
          allowed_uses: [],
          permission_tier: 1,
          consent_id: null,
          freshness: null,
          last_signal_id: null,
          scopes: [],
          connector_status: "not_applicable",
          updated_at: expect.any(String),
        },
      ],
      updated_at: expect.any(String),
    });

    const active = await putSources(
      "idem-context-enable-2",
      desired(initial.body, "active"),
    );
    expect(active.status).toBe(200);
    expect(active.body.sources[0]).toMatchObject({
      enabled: true,
      permission_state: "active",
      permission_tier: 1,
      consent_id: expect.stringMatching(/^cns_/),
      allowed_uses: [
        "theme_ranking",
        "tone",
        "reflection_prompt",
        "notification_timing",
      ],
    });

    const paused = await putSources(
      "idem-context-pause-1",
      desired(active.body, "paused"),
    );
    expect(paused.body.sources[0]).toMatchObject({
      enabled: false,
      permission_state: "paused",
    });

    const resumed = await putSources(
      "idem-context-resume-1",
      desired(paused.body, "active"),
    );
    expect(resumed.body.sources[0]).toMatchObject({
      enabled: true,
      permission_state: "active",
    });

    const revoked = await putSources(
      "idem-context-revoke-1",
      desired(resumed.body, "revoked"),
    );
    expect(revoked.body.sources[0]).toMatchObject({
      enabled: false,
      permission_state: "revoked",
    });

    expect(
      await rows(
        `SELECT status, version, supersedes_consent_id
         FROM consents WHERE user_id = ? AND source_id = 'USR-06'
         ORDER BY version`,
        USER_A,
      ),
    ).toEqual([
      { status: "granted", version: 1, supersedes_consent_id: null },
      { status: "paused", version: 2, supersedes_consent_id: active.body.sources[0].consent_id },
      { status: "granted", version: 3, supersedes_consent_id: paused.body.sources[0].consent_id },
      { status: "revoked", version: 4, supersedes_consent_id: resumed.body.sources[0].consent_id },
    ]);
  });

  it("deduplicates an exact document and rejects key reuse or invalid transitions", async () => {
    const initial = await getSources();
    const request = desired(initial.body, "active");
    const first = await putSources("idem-context-exact-1", request);
    expect(first.status).toBe(200);

    const replay = await putSources("idem-context-exact-1", request);
    expect(replay).toEqual(first);
    expect(await rows("SELECT id FROM consents WHERE source_id = 'USR-06'"))
      .toHaveLength(1);

    const changed = await putSources(
      "idem-context-exact-1",
      desired(first.body, "paused"),
    );
    expect(changed.status).toBe(409);
    expect(changed.body.error?.code).toBe("idempotency_conflict");

    const illegal = await putSources(
      "idem-context-illegal-1",
      desired(first.body, "revoked"),
    );
    expect(illegal.status).toBe(200);
    const revokedToPaused = await putSources(
      "idem-context-illegal-2",
      desired(illegal.body, "paused"),
    );
    expect(revokedToPaused.status).toBe(409);
    expect(revokedToPaused.body.error?.code).toBe("consent_conflict");
  });

  it("rejects unsupported sources, owner mismatches, and client-owned registry fields", async () => {
    const initial = await getSources();
    const wrongOwner = structuredClone(initial.body);
    wrongOwner.user_id = "usr_someone_else_0001";
    expect((await putSources("idem-context-owner-1", wrongOwner)).status).toBe(400);

    const wrongTier = structuredClone(initial.body);
    wrongTier.sources[0].permission_tier = 2 as 1;
    expect((await putSources("idem-context-tier-1", wrongTier)).status).toBe(400);

    const extra = structuredClone(initial.body);
    (extra.sources[0] as SourceProjection & { client_field?: boolean }).client_field = true;
    expect((await putSources("idem-context-extra-1", extra as SourcesDocument)).status)
      .toBe(400);
  });
});

describe("daily check-ins", () => {
  it("requires an active source and a confirmed usable time zone", async () => {
    const inactive = await postCheckIn("idem-check-in-inactive", { energy: "low" });
    expect(inactive.status).toBe(409);
    expect(inactive.body.error?.code).toBe("context_source_inactive");

    await enableSource();
    const unconfirmed = await postCheckIn("idem-check-in-zone", { energy: "low" });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error?.code).toBe("timezone_confirmation_required");
  });

  it("stores an encrypted local-day signal, exact replay, and immutable edits", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-12T05:30:00.000Z"));
    await enableSource();
    await confirmPreferences(USER_A, "America/Chicago");

    const firstRequest = {
      energy: "low",
      pressure: "medium",
      note: "Taking the morning slowly.",
    };
    const first = await postCheckIn("idem-check-in-write-1", firstRequest);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      schema_version: "0.2.0",
      user_id: USER_A,
      source_id: "USR-06",
      source_window: "2026-08-12",
      evidence_lane: "user_and_context",
      permission_state: "active",
      conflict_status: "none",
      freshness: {
        status: "fresh",
        observed_at: "2026-08-12T05:30:00.000Z",
        expires_at: "2026-08-13T05:30:00.000Z",
        max_age_seconds: 86400,
        age_seconds: 0,
      },
      value: {
        encoding: "structured",
        structured: {
          energy: "low",
          pressure: "medium",
          clarity: null,
          connection: null,
          focus_domain: null,
          note: "Taking the morning slowly.",
        },
      },
      supersedes_signal_id: null,
      normalized_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });

    const stored = await rows<{
      value_json: string | null;
      value_enc: unknown;
      source_revision: number;
      is_current: number;
      retention_expires_at: string;
    }>(
      `SELECT value_json, value_enc, source_revision, is_current,
              retention_expires_at
       FROM context_signals WHERE user_id = ?`,
      USER_A,
    );
    expect(stored).toEqual([
      {
        value_json: null,
        value_enc: expect.anything(),
        source_revision: 1,
        is_current: 1,
        retention_expires_at: "2027-09-12T05:30:00.000Z",
      },
    ]);

    const replay = await postCheckIn("idem-check-in-write-1", firstRequest);
    expect(replay).toEqual(first);
    expect(await rows("SELECT id FROM context_signals WHERE user_id = ?", USER_A))
      .toHaveLength(1);

    const conflict = await postCheckIn("idem-check-in-write-1", { energy: "high" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe("idempotency_conflict");

    const second = await postCheckIn("idem-check-in-write-2", { energy: "high" });
    expect(second.status).toBe(201);
    expect(second.body.supersedes_signal_id).toBe(first.body.id);
    expect(second.body.normalized_hash).not.toBe(first.body.normalized_hash);
    expect(
      await rows(
        `SELECT id, source_revision, is_current, conflict_status,
                supersedes_signal_id
         FROM context_signals WHERE user_id = ? ORDER BY source_revision`,
        USER_A,
      ),
    ).toEqual([
      {
        id: first.body.id,
        source_revision: 1,
        is_current: 0,
        conflict_status: "superseded",
        supersedes_signal_id: null,
      },
      {
        id: second.body.id,
        source_revision: 2,
        is_current: 1,
        conflict_status: "none",
        supersedes_signal_id: first.body.id,
      },
    ]);

    const third = await postCheckIn("idem-check-in-write-3", { energy: "low" });
    expect(third.status).toBe(201);
    expect(third.body.normalized_hash).not.toBe(first.body.normalized_hash);
  });

  it("enforces the frozen request bounds", async () => {
    await enableSource();
    await confirmPreferences(USER_A);
    for (const [key, body] of [
      ["bad-energy", { energy: "exhausted" }],
      ["extra", { energy: "low", extra: true }],
      ["long-note", { energy: "low", note: "x".repeat(1001) }],
      ["short-expiry", { energy: "low", expires_in_seconds: 299 }],
      ["long-expiry", { energy: "low", expires_in_seconds: 604801 }],
    ] as const) {
      const result = await postCheckIn(`idem-check-in-${key}`, body);
      expect(result.status, key).toBe(400);
      expect(result.body.error?.code, key).toBe("invalid_body");
    }
  });
});
