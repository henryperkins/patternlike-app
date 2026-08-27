import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env, SELF } from "cloudflare:test";
import type { BirthProfileRequest } from "@patternlike/shared";
import { decryptPayload, encryptPayload, type UserIdentity } from "../db/users.js";
import {
  ALICE,
  BOB,
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  getChart,
  postBirthProfile,
  resetDb,
  rows,
  seedUser,
} from "../../test/helpers.js";
import {
  LEAKY_UPSTREAM_MESSAGE,
  TRIGGER_CALC_ERROR,
  TRIGGER_CALC_FINGERPRINT_RACE,
  TRIGGER_INVALID_PROFILE,
} from "../../test/mock-calc-service.js";

const DEFAULT_CALC_FETCH_TIMEOUT_MS = env.CALC_FETCH_TIMEOUT_MS;
const DEFAULT_BIRTH_CALC_DAILY_LIMIT = env.BIRTH_CALC_DAILY_LIMIT;
const TRIGGER_CALC_TIMEOUT = "TRIGGER_CALC_TIMEOUT";
const RETRY_REQUEST: BirthProfileRequest = {
  accuracy: "exact",
  consent_id: "cns_retry_safe_birth_0001",
  birth_date: "1990-05-15",
  birth_time_local: "12:34:00",
  approximate_window_minutes: null,
  timezone_hint: "America/Los_Angeles",
  birthplace: {
    place_id: "plc_retry_safe_birth_0001",
    label: TRIGGER_CALC_ERROR,
    latitude: 34.05,
    longitude: -118.24,
  },
};

function retryCommand() {
  return {
    schema_version: "birth-calc-command/v1",
    submitted: {
      accuracy: RETRY_REQUEST.accuracy,
      consent_id: RETRY_REQUEST.consent_id,
      birth_date: RETRY_REQUEST.birth_date ?? null,
      birth_time_local: RETRY_REQUEST.birth_time_local ?? null,
      approximate_window_minutes:
        RETRY_REQUEST.approximate_window_minutes ?? null,
      timezone_hint: RETRY_REQUEST.timezone_hint ?? null,
      birthplace: {
        place_id: RETRY_REQUEST.birthplace?.place_id ?? null,
        label: RETRY_REQUEST.birthplace?.label ?? null,
        latitude: RETRY_REQUEST.birthplace?.latitude ?? null,
        longitude: RETRY_REQUEST.birthplace?.longitude ?? null,
      },
    },
    effective: {
      accuracy: RETRY_REQUEST.accuracy,
      birth_date: RETRY_REQUEST.birth_date ?? null,
      birth_time_local: RETRY_REQUEST.birth_time_local ?? null,
      approximate_window_minutes:
        RETRY_REQUEST.approximate_window_minutes ?? null,
      timezone: "America/Los_Angeles",
      birthplace: {
        place_id: RETRY_REQUEST.birthplace?.place_id ?? null,
        label: RETRY_REQUEST.birthplace?.label ?? null,
        latitude: RETRY_REQUEST.birthplace?.latitude ?? null,
        longitude: RETRY_REQUEST.birthplace?.longitude ?? null,
      },
      location_confidence: "high",
      location_qualifier_codes: [],
    },
  };
}

function bytesToBase64(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function seedFailedBirthAttempt(
  key: string,
  payload: unknown,
  options: {
    identity?: UserIdentity;
    version?: number;
    attempts?: number;
  } = {},
): Promise<string> {
  const identity = options.identity ?? IDENTITY_A;
  const version = options.version ?? 1;
  const attempts = options.attempts ?? 1;
  const now = "2026-08-26T12:00:00.000Z";
  const sealed = await encryptPayload(env, identity, payload, {
    subject: identity.cryptoSubject,
    field: "birth_profiles.payload_enc",
    recordId: String(version),
  });
  const jobId = `job_${key.replace(/[^a-z0-9]/gi, "_")}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO birth_profiles (
         user_id, version, accuracy, status, timezone, payload_enc,
         payload_key_version, payload_nonce, geocode_confidence,
         created_at, updated_at
       ) VALUES (?, ?, 'exact', 'invalid', 'America/Los_Angeles', ?, ?, ?,
                 'high', ?, ?)`,
    ).bind(
      identity.userId,
      version,
      Uint8Array.from(atob(sealed.ciphertext), (character) =>
        character.charCodeAt(0)
      ),
      sealed.keyVersion,
      sealed.nonce,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO jobs (
         id, job_type, user_id, idempotency_key, status, payload_json,
         result_class, attempts, started_at, finished_at, created_at
       ) VALUES (?, 'NormalizeBirthAndCalculateChart', ?, ?, 'failed', ?,
                 'calc_error', ?, ?, ?, ?)`,
    ).bind(
      jobId,
      identity.userId,
      key,
      JSON.stringify({ profile_version: version }),
      attempts,
      now,
      now,
      now,
    ),
  ]);
  return jobId;
}

async function postBirthResponse(
  userId: string,
  idempotencyKey: string,
  body: Partial<BirthProfileRequest>,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await SELF.fetch("http://api.test/v1/birth-profiles", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  return {
    response,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function completedCalcEvents(
  info: ReturnType<typeof vi.spyOn>,
): Array<[unknown, ...unknown[]]> {
  return info.mock.calls.filter(
    (call: unknown[]): call is [unknown, ...unknown[]] =>
      call[0] === "birth_calc_completed",
  );
}

// Users exist before any request now — creation moved to identity-link time.
// resetDb truncates users, so both are seeded unconditionally: a suite that
// authenticates as USER_B without a row would 401 where it asserts a
// route-level status.
beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
  await seedUser(IDENTITY_B);
});

afterEach(() => {
  env.CALC_FETCH_TIMEOUT_MS = DEFAULT_CALC_FETCH_TIMEOUT_MS;
  env.BIRTH_CALC_DAILY_LIMIT = DEFAULT_BIRTH_CALC_DAILY_LIMIT;
  vi.restoreAllMocks();
});

describe("POST /v1/birth-profiles — the cross-tenant defect", () => {
  it("does not hand one user's chart to another who reuses their idempotency key", async () => {
    const a = await postBirthProfile(USER_A, "shared-key-001", ALICE);
    expect(a.status).toBe(202);
    expect(a.body.status).toBe("succeeded");

    const b = await postBirthProfile(USER_B, "shared-key-001", BOB);

    // Before the fix this was 202 "duplicate" carrying A's job_id and chart id,
    // while B's profile was never written.
    expect(b.status).toBe(202);
    expect(b.body.status).toBe("succeeded");
    expect(b.body.job_id).not.toBe(a.body.job_id);
    expect(b.body.resource_id).not.toBe(a.body.resource_id);
  });

  it("lets the second user read their own chart", async () => {
    await postBirthProfile(USER_A, "shared-key-001", ALICE);
    await postBirthProfile(USER_B, "shared-key-001", BOB);

    const chart = await getChart(USER_B);
    // Before the fix: 404 "No active chart for user" — permanent silent data loss.
    expect(chart.status).toBe(200);
    expect(chart.body.user_id).toBe(USER_B);
  });

  it("writes a birth profile for both users", async () => {
    await postBirthProfile(USER_A, "shared-key-001", ALICE);
    await postBirthProfile(USER_B, "shared-key-001", BOB);

    const profiles = await rows<{ user_id: string }>(
      "SELECT user_id FROM birth_profiles WHERE status = 'active' ORDER BY user_id",
    );
    expect(profiles.map((p) => p.user_id)).toEqual([USER_A, USER_B]);
  });

  it("keeps one jobs row per user for the same key", async () => {
    await postBirthProfile(USER_A, "shared-key-001", ALICE);
    await postBirthProfile(USER_B, "shared-key-001", BOB);

    const jobs = await rows<{ user_id: string; idempotency_key: string }>(
      "SELECT user_id, idempotency_key FROM jobs ORDER BY user_id",
    );
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.idempotency_key === "shared-key-001")).toBe(true);
  });
});

describe("POST /v1/birth-profiles — idempotency", () => {
  it("eagerly commits a deterministic natal-feature receipt after chart activation", async () => {
    const created = await postBirthProfile(USER_A, "key-feature-cache", ALICE);
    expect(created.status).toBe(202);
    const receipts = await rows<{ chart_id: string; feature_count: number }>(
      "SELECT chart_id, feature_count FROM natal_feature_sets WHERE user_id = ?",
      USER_A,
    );
    expect(receipts).toEqual([
      expect.objectContaining({ chart_id: created.body.resource_id, feature_count: expect.any(Number) }),
    ]);
    expect(receipts[0]!.feature_count).toBeGreaterThan(0);
  });

  it("returns 202 duplicate with the same chart id when a key is replayed", async () => {
    const first = await postBirthProfile(USER_A, "key-replay", ALICE);
    const second = await postBirthProfile(USER_A, "key-replay", ALICE);

    expect(second.status).toBe(202);
    expect(second.body.status).toBe("duplicate");
    expect(second.body.job_id).toBe(first.body.job_id);
    expect(second.body.resource_id).toBe(first.body.resource_id);
  });

  it("does not create a second profile version on replay", async () => {
    await postBirthProfile(USER_A, "key-replay", ALICE);
    await postBirthProfile(USER_A, "key-replay", ALICE);

    const profiles = await rows("SELECT version FROM birth_profiles WHERE user_id = ?", USER_A);
    expect(profiles).toHaveLength(1);
  });

  it("returns 409 when identical birth data is resubmitted under a new key", async () => {
    const first = await postBirthProfile(USER_A, "key-one-0001", ALICE);
    const dup = await postBirthProfile(USER_A, "key-two-0002", ALICE);

    // OpenAPI declares 409 here; the old code let UNIQUE(user_id, fingerprint)
    // throw a bare 500 after the profile and job rows were already committed.
    expect(dup.status).toBe(409);
    const err = dup.body.error as Record<string, unknown>;
    expect(err.code).toBe("chart_already_exists");
    expect((err.details as Record<string, unknown>).chart_id).toBe(first.body.resource_id);
  });

  it("leaves no job stuck in running after a 409", async () => {
    await postBirthProfile(USER_A, "key-one-0001", ALICE);
    await postBirthProfile(USER_A, "key-two-0002", ALICE);

    const stuck = await rows("SELECT id FROM jobs WHERE status = 'running'");
    expect(stuck).toHaveLength(0);
  });
});

describe("POST /v1/birth-profiles — operational guards", () => {
  it("charges five distinct keys, denies the sixth exactly, and keeps another user's budget independent", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    for (let number = 1; number <= 5; number++) {
      const accepted = await postBirthProfile(
        USER_A,
        `key-budget-${number}`,
        {
          ...ALICE,
          birth_date: `199${number}-05-15`,
        },
      );
      expect(accepted.status).toBe(202);
    }

    const deniedKey = "key-budget-denied-6";
    const denied = await postBirthResponse(USER_A, deniedKey, {
      ...ALICE,
      birth_date: "1996-05-15",
    });
    expect(denied.response.status).toBe(429);
    expect(denied.response.headers.get("retry-after")).toMatch(/^[1-9]\d*$/);
    expect(denied.body).toMatchObject({
      error: {
        code: "birth_calc_budget_exhausted",
        message: "The daily birth calculation limit has been reached",
        request_id: expect.stringMatching(/^[A-Za-z0-9_.:-]{8,128}$/),
        details: {
          resets_at: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/,
          ),
        },
      },
    });
    expect(
      await rows(
        "SELECT id FROM jobs WHERE user_id = ? AND idempotency_key = ?",
        USER_A,
        deniedKey,
      ),
    ).toEqual([]);
    expect(
      await rows<{ version: number }>(
        "SELECT version FROM birth_profiles WHERE user_id = ? ORDER BY version",
        USER_A,
      ),
    ).toHaveLength(5);

    const other = await postBirthProfile(USER_B, "key-budget-other-user", BOB);
    expect(other.status).toBe(202);
    expect(
      await rows<{ user_id: string; reserved_calc_count: number }>(
        `SELECT user_id, reserved_calc_count
         FROM birth_calc_daily_usage ORDER BY user_id`,
      ),
    ).toEqual([
      { user_id: USER_A, reserved_calc_count: 5 },
      { user_id: USER_B, reserved_calc_count: 1 },
    ]);
    expect(completedCalcEvents(info)).toHaveLength(6);
    expect(
      info.mock.calls.filter(
        (call) => call[0] === "birth_calc_completed",
      ).every((call) =>
        (call[1] as { outcome?: unknown }).outcome === "success"
      ),
    ).toBe(true);
  });

  it("short-circuits succeeded and running owner-scoped jobs without another charge or invocation", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const first = await postBirthProfile(USER_A, "key-free-replay", ALICE);
    expect(first.status).toBe(202);
    const replay = await postBirthProfile(USER_A, "key-free-replay", {
      ...ALICE,
      birth_date: "2000-01-01",
    });
    expect(replay.status).toBe(202);
    expect(replay.body.status).toBe("duplicate");

    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO jobs (
         id, job_type, user_id, idempotency_key, status, attempts,
         started_at, created_at
       ) VALUES (
         'job_running_birth_replay', 'NormalizeBirthAndCalculateChart',
         ?, 'key-running-replay', 'running', 1, ?, ?
       )`,
    ).bind(USER_A, now, now).run();
    const running = await postBirthProfile(
      USER_A,
      "key-running-replay",
      ALICE,
    );
    expect(running.status).toBe(202);
    expect(running.body.status).toBe("running");

    expect(
      await rows<{ reserved_calc_count: number }>(
        "SELECT reserved_calc_count FROM birth_calc_daily_usage WHERE user_id = ?",
        USER_A,
      ),
    ).toEqual([{ reserved_calc_count: 1 }]);
    expect(completedCalcEvents(info)).toHaveLength(1);
    expect(
      await rows(
        "SELECT last_allocated_version FROM birth_profile_version_counters WHERE user_id = ?",
        USER_A,
      ),
    ).toHaveLength(1);
  });

  it("charges one new unit when the exact failed v1 command is retried", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const first = await postBirthProfile(
      USER_A,
      "key-v1-failed-retry",
      RETRY_REQUEST,
    );
    const retry = await postBirthProfile(
      USER_A,
      "key-v1-failed-retry",
      RETRY_REQUEST,
    );

    expect(first.status).toBe(502);
    expect(retry.status).toBe(502);
    expect(
      await rows<{ attempts: number; status: string }>(
        "SELECT attempts, status FROM jobs WHERE user_id = ?",
        USER_A,
      ),
    ).toEqual([{ attempts: 2, status: "failed" }]);
    expect(
      await rows<{ reserved_calc_count: number }>(
        "SELECT reserved_calc_count FROM birth_calc_daily_usage WHERE user_id = ?",
        USER_A,
      ),
    ).toEqual([{ reserved_calc_count: 2 }]);
    expect(
      await rows("SELECT version FROM birth_profiles WHERE user_id = ?", USER_A),
    ).toHaveLength(2);
    expect(completedCalcEvents(info)).toHaveLength(2);
  });

  it("conflicts before charge for every changed normalized submitted field", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const changes: Array<[string, BirthProfileRequest]> = [
      ["accuracy", { ...RETRY_REQUEST, accuracy: "approximate" }],
      [
        "approximate-window",
        { ...RETRY_REQUEST, approximate_window_minutes: 60 },
      ],
      [
        "timezone",
        { ...RETRY_REQUEST, timezone_hint: "America/New_York" },
      ],
      [
        "place-id",
        {
          ...RETRY_REQUEST,
          birthplace: {
            ...RETRY_REQUEST.birthplace,
            place_id: "plc_changed",
          },
        },
      ],
      [
        "place-label",
        {
          ...RETRY_REQUEST,
          birthplace: {
            ...RETRY_REQUEST.birthplace,
            label: "PRIVATE_CHANGED_PLACE",
          },
        },
      ],
      [
        "latitude",
        {
          ...RETRY_REQUEST,
          birthplace: { ...RETRY_REQUEST.birthplace, latitude: 35.05 },
        },
      ],
      [
        "longitude",
        {
          ...RETRY_REQUEST,
          birthplace: { ...RETRY_REQUEST.birthplace, longitude: -117.24 },
        },
      ],
      ["birth-date", { ...RETRY_REQUEST, birth_date: "1991-05-15" }],
      ["birth-time", { ...RETRY_REQUEST, birth_time_local: "12:35:00" }],
      [
        "consent",
        { ...RETRY_REQUEST, consent_id: "cns_retry_safe_birth_changed" },
      ],
    ];

    for (const [label, changed] of changes) {
      const key = `key-v1-conflict-${label}`;
      await seedFailedBirthAttempt(key, retryCommand(), {
        version: changes.findIndex(([name]) => name === label) + 1,
      });
      const conflict = await postBirthProfile(USER_A, key, changed);
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({
        error: {
          code: "idempotency_conflict",
          request_id: expect.stringMatching(/^[A-Za-z0-9_.:-]{8,128}$/),
        },
      });
      expect(JSON.stringify(conflict.body)).not.toContain(
        "PRIVATE_CHANGED_PLACE",
      );
    }

    expect(await rows("SELECT * FROM birth_calc_daily_usage")).toEqual([]);
    expect(await rows("SELECT * FROM birth_calc_reservations")).toEqual([]);
    expect(await rows("SELECT * FROM birth_profile_version_counters")).toEqual([]);
    expect(
      await rows<{ attempts: number }>(
        "SELECT attempts FROM jobs ORDER BY id",
      ),
    ).toHaveLength(changes.length);
    expect(completedCalcEvents(info)).toHaveLength(0);
  });

  it("refuses a failed legacy payload before allocation, charge, write, or calc", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const legacy = {
      birth_date: RETRY_REQUEST.birth_date,
      birth_time_local: RETRY_REQUEST.birth_time_local,
      birthplace: RETRY_REQUEST.birthplace,
      approximate_window_minutes: RETRY_REQUEST.approximate_window_minutes,
      consent_id: RETRY_REQUEST.consent_id,
    };
    await seedFailedBirthAttempt("key-legacy-failed", legacy);

    const result = await postBirthProfile(
      USER_A,
      "key-legacy-failed",
      RETRY_REQUEST,
    );
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: {
        code: "idempotency_conflict",
        message: expect.stringMatching(/predates retry-safe birth commands/i),
      },
    });
    expect(JSON.stringify(result.body)).toMatch(/new Idempotency-Key/i);
    expect(await rows("SELECT * FROM birth_calc_daily_usage")).toEqual([]);
    expect(await rows("SELECT * FROM birth_profile_version_counters")).toEqual([]);
    expect(
      await rows("SELECT version FROM birth_profiles WHERE user_id = ?", USER_A),
    ).toHaveLength(1);
    expect(
      await rows<{ attempts: number }>(
        "SELECT attempts FROM jobs WHERE user_id = ?",
        USER_A,
      ),
    ).toEqual([{ attempts: 1 }]);
    expect(completedCalcEvents(info)).toHaveLength(0);
  });

  it("refuses an unknown failed command version before allocation, charge, write, or calc", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await seedFailedBirthAttempt("key-unknown-failed", {
      ...retryCommand(),
      schema_version: "birth-calc-command/v2",
    });

    const result = await postBirthProfile(
      USER_A,
      "key-unknown-failed",
      RETRY_REQUEST,
    );
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: {
        code: "idempotency_conflict",
        message: expect.stringMatching(/predates retry-safe birth commands/i),
      },
    });
    expect(await rows("SELECT * FROM birth_calc_daily_usage")).toEqual([]);
    expect(await rows("SELECT * FROM birth_profile_version_counters")).toEqual([]);
    expect(
      await rows<{ attempts: number }>(
        "SELECT attempts FROM jobs WHERE user_id = ?",
        USER_A,
      ),
    ).toEqual([{ attempts: 1 }]);
    expect(completedCalcEvents(info)).toHaveLength(0);
  });

  it("sends malformed claimed-v1 corruption through the generic 500 boundary without charge", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const command = retryCommand();
    await seedFailedBirthAttempt("key-corrupt-v1", {
      ...command,
      effective: {
        ...command.effective,
        timezone: null,
      },
    });

    const result = await postBirthProfile(
      USER_A,
      "key-corrupt-v1",
      RETRY_REQUEST,
    );
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      error: {
        code: "internal_error",
        message: "Unexpected server error",
        request_id: expect.stringMatching(/^[A-Za-z0-9_.:-]{8,128}$/),
      },
    });
    expect(await rows("SELECT * FROM birth_calc_daily_usage")).toEqual([]);
    expect(await rows("SELECT * FROM birth_profile_version_counters")).toEqual([]);
    expect(
      await rows<{ attempts: number }>(
        "SELECT attempts FROM jobs WHERE user_id = ?",
        USER_A,
      ),
    ).toEqual([{ attempts: 1 }]);
    expect(completedCalcEvents(info)).toHaveLength(0);
  });

  it("refuses hidden effective-input mismatches before allocation, charge, write, or calc", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mismatches: Array<[string, Partial<ReturnType<typeof retryCommand>["effective"]>]> = [
      ["accuracy", { accuracy: "approximate" }],
      ["birth-date", { birth_date: "1991-05-15" }],
      ["birth-time", { birth_time_local: "12:35:00" }],
      ["approximate-window", { approximate_window_minutes: 30 }],
    ];

    for (const [index, [label, effectiveChange]] of mismatches.entries()) {
      const command = retryCommand();
      const key = `key-corrupt-effective-${label}`;
      await seedFailedBirthAttempt(
        key,
        {
          ...command,
          effective: { ...command.effective, ...effectiveChange },
        },
        { version: index + 1 },
      );
      const result = await postBirthProfile(USER_A, key, RETRY_REQUEST);
      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({
        error: {
          code: "internal_error",
          message: "Unexpected server error",
        },
      });
    }

    expect(await rows("SELECT * FROM birth_calc_daily_usage")).toEqual([]);
    expect(await rows("SELECT * FROM birth_calc_reservations")).toEqual([]);
    expect(await rows("SELECT * FROM birth_profile_version_counters")).toEqual([]);
    expect(
      await rows<{ version: number }>(
        "SELECT version FROM birth_profiles ORDER BY version",
      ),
    ).toEqual(mismatches.map((_, index) => ({ version: index + 1 })));
    expect(
      await rows<{ attempts: number; status: string }>(
        "SELECT attempts, status FROM jobs ORDER BY id",
      ),
    ).toEqual(
      Array.from({ length: mismatches.length }, () => ({
        attempts: 1,
        status: "failed",
      })),
    );
    expect(completedCalcEvents(info)).toHaveLength(0);
  });

  it("converges concurrent new requests for one key on one charge, job, profile, and calc", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const [first, second] = await Promise.all([
      postBirthProfile(USER_A, "key-concurrent-new", ALICE),
      postBirthProfile(USER_A, "key-concurrent-new", ALICE),
    ]);

    expect([first.status, second.status]).toEqual([202, 202]);
    expect(second.body.job_id).toBe(first.body.job_id);
    expect([first.body.status, second.body.status]).toContain("succeeded");
    expect(
      [first.body.status, second.body.status].every((status) =>
        status === "succeeded" ||
        status === "running" ||
        status === "duplicate"
      ),
    ).toBe(true);
    expect(
      await rows<{ reserved_calc_count: number }>(
        "SELECT reserved_calc_count FROM birth_calc_daily_usage WHERE user_id = ?",
        USER_A,
      ),
    ).toEqual([{ reserved_calc_count: 1 }]);
    expect(
      await rows("SELECT version FROM birth_profiles WHERE user_id = ?", USER_A),
    ).toHaveLength(1);
    expect(
      await rows("SELECT id FROM jobs WHERE user_id = ?", USER_A),
    ).toHaveLength(1);
    expect(completedCalcEvents(info)).toHaveLength(1);
  });

  it("lets only one concurrent retry claim the next attempt and invocation", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await seedFailedBirthAttempt(
      "key-concurrent-retry",
      retryCommand(),
    );
    const [first, second] = await Promise.all([
      postBirthProfile(USER_A, "key-concurrent-retry", RETRY_REQUEST),
      postBirthProfile(USER_A, "key-concurrent-retry", RETRY_REQUEST),
    ]);

    expect([first.status, second.status].filter((status) => status === 502))
      .toHaveLength(1);
    expect([first.status, second.status].filter((status) => status === 202))
      .toHaveLength(1);
    expect(
      await rows<{ attempts: number }>(
        "SELECT attempts FROM jobs WHERE user_id = ?",
        USER_A,
      ),
    ).toEqual([{ attempts: 2 }]);
    expect(
      await rows("SELECT version FROM birth_profiles WHERE user_id = ?", USER_A),
    ).toHaveLength(2);
    expect(
      await rows<{ reserved_calc_count: number }>(
        "SELECT reserved_calc_count FROM birth_calc_daily_usage WHERE user_id = ?",
        USER_A,
      ),
    ).toEqual([{ reserved_calc_count: 1 }]);
    expect(
      await rows("SELECT reservation_hash FROM birth_calc_reservations"),
    ).toHaveLength(1);
    expect(completedCalcEvents(info)).toHaveLength(1);
  });

  it("allocates distinct versions and AAD for concurrent distinct keys", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const [first, second] = await Promise.all([
      postBirthProfile(USER_A, "key-concurrent-distinct-a", {
        ...ALICE,
        birth_date: "1991-05-15",
      }),
      postBirthProfile(USER_A, "key-concurrent-distinct-b", {
        ...ALICE,
        birth_date: "1992-05-15",
      }),
    ]);
    expect([first.status, second.status]).toEqual([202, 202]);

    const profiles = await rows<{
      version: number;
      payload_key_version: number;
      payload_nonce: string;
      payload_enc: ArrayBuffer;
    }>(
      `SELECT version, payload_key_version, payload_nonce, payload_enc
       FROM birth_profiles WHERE user_id = ? ORDER BY version`,
      USER_A,
    );
    expect(profiles.map((profile) => profile.version)).toEqual([1, 2]);
    expect(Array.from(new Uint8Array(profiles[0]!.payload_enc))).not.toEqual(
      Array.from(new Uint8Array(profiles[1]!.payload_enc)),
    );
    for (const profile of profiles) {
      const encrypted = {
        key_version: profile.payload_key_version,
        nonce: profile.payload_nonce,
        ciphertext: bytesToBase64(profile.payload_enc),
      };
      await expect(
        decryptPayload(env, IDENTITY_A, encrypted, {
          subject: IDENTITY_A.cryptoSubject,
          field: "birth_profiles.payload_enc",
          recordId: String(profile.version),
        }),
      ).resolves.toMatchObject({
        schema_version: "birth-calc-command/v1",
      });
      await expect(
        decryptPayload(env, IDENTITY_A, encrypted, {
          subject: IDENTITY_A.cryptoSubject,
          field: "birth_profiles.payload_enc",
          recordId: String(profile.version === 1 ? 2 : 1),
        }),
      ).rejects.toThrow();
    }
    expect(completedCalcEvents(info)).toHaveLength(2);
  });

  it("settles both distinct-key jobs when identical births race on one fingerprint", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const identical = {
      ...ALICE,
      birthplace: {
        ...ALICE.birthplace,
        label: TRIGGER_CALC_FINGERPRINT_RACE,
      },
    };
    const requests = [
      { key: "key-fingerprint-race-a", body: identical },
      { key: "key-fingerprint-race-b", body: identical },
    ];
    const results = await Promise.all(
      requests.map(async ({ key, body }) => ({
        key,
        ...(await postBirthResponse(USER_A, key, body)),
      })),
    );

    expect(results.map(({ response }) => response.status).sort()).toEqual([
      202,
      409,
    ]);
    const charts = await rows<{ id: string; fingerprint: string }>(
      `SELECT id, fingerprint FROM chart_snapshots
       WHERE user_id = ?`,
      USER_A,
    );
    expect(charts).toHaveLength(1);
    const jobs = await rows<{
      idempotency_key: string;
      status: string;
      result_class: string | null;
      payload_json: string | null;
    }>(
      `SELECT idempotency_key, status, result_class, payload_json
       FROM jobs WHERE user_id = ? ORDER BY idempotency_key`,
      USER_A,
    );
    expect(jobs).toHaveLength(2);
    expect(jobs.map(({ status }) => status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(jobs.map(({ result_class }) => result_class)).toEqual([
      charts[0]!.id,
      charts[0]!.id,
    ]);
    const profiles = await rows<{ version: number; status: string }>(
      `SELECT version, status FROM birth_profiles
       WHERE user_id = ? ORDER BY version`,
      USER_A,
    );
    expect(profiles).toHaveLength(2);
    expect(profiles.map(({ status }) => status).sort()).toEqual([
      "active",
      "superseded",
    ]);
    const losing = results.find(({ response }) => response.status === 409);
    expect(losing?.body).toMatchObject({
      error: {
        code: "chart_already_exists",
        details: {
          chart_id: charts[0]!.id,
          fingerprint: charts[0]!.fingerprint,
        },
      },
    });
    const losingJob = jobs.find(
      ({ idempotency_key }) =>
        idempotency_key === losing?.key,
    );
    const losingVersion = Number(
      JSON.parse(losingJob?.payload_json ?? "{}").profile_version,
    );
    expect(
      profiles.find(({ version }) => version === losingVersion)?.status,
    ).toBe("superseded");
    expect(completedCalcEvents(info)).toHaveLength(2);
  });

  it("settles an insert-time fingerprint winner without stranding the losing job", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await seedFailedBirthAttempt(
      "key-fingerprint-winner-seed",
      retryCommand(),
    );
    await env.DB.prepare(
      `UPDATE birth_profiles SET status = 'active'
       WHERE user_id = ? AND version = 1`,
    ).bind(USER_A).run();
    const winnerId = "cht_injected_fingerprint_winner_0001";
    await env.DB.prepare(
      `CREATE TRIGGER inject_birth_fingerprint_winner
       BEFORE INSERT ON chart_snapshots
       WHEN NEW.id != '${winnerId}'
       BEGIN
         INSERT INTO chart_snapshots (
           id, user_id, profile_version, fingerprint, contract_id,
           contract_version, container_digest, tzdb_version, status,
           calculated_at, snapshot_json, birth_accuracy, birth_enc,
           birth_key_version, birth_nonce, r2_uri, uncertainty_json, created_at
         ) VALUES (
           '${winnerId}', NEW.user_id, 1, NEW.fingerprint, NEW.contract_id,
           NEW.contract_version, NEW.container_digest, NEW.tzdb_version,
           'active', NEW.calculated_at, NEW.snapshot_json, NEW.birth_accuracy,
           NEW.birth_enc, NEW.birth_key_version, NEW.birth_nonce, NEW.r2_uri,
           NEW.uncertainty_json, NEW.created_at
         );
         SELECT RAISE(IGNORE);
       END`,
    ).run();
    try {
      const result = await postBirthResponse(
        USER_A,
        "key-insert-time-fingerprint-winner",
        ALICE,
      );
      expect(result.response.status).toBe(409);
      expect(result.body).toMatchObject({
        error: {
          code: "chart_already_exists",
          details: { chart_id: winnerId },
        },
      });
      expect(
        await rows<{ id: string }>(
          "SELECT id FROM chart_snapshots WHERE user_id = ?",
          USER_A,
        ),
      ).toEqual([{ id: winnerId }]);
      expect(
        await rows<{ status: string; result_class: string | null }>(
          `SELECT status, result_class FROM jobs
           WHERE user_id = ? AND idempotency_key = ?`,
          USER_A,
          "key-insert-time-fingerprint-winner",
        ),
      ).toEqual([{ status: "succeeded", result_class: winnerId }]);
      expect(
        await rows<{ status: string }>(
          `SELECT status FROM birth_profiles
           WHERE user_id = ? AND version = 2`,
          USER_A,
        ),
      ).toEqual([{ status: "superseded" }]);
    } finally {
      await env.DB.prepare(
        "DROP TRIGGER inject_birth_fingerprint_winner",
      ).run();
    }
  });

  it("terminalizes a charged publication conflict before returning the generic 500", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await env.DB.prepare(
      `CREATE TRIGGER ignore_birth_chart_insert
       BEFORE INSERT ON chart_snapshots
       BEGIN
         SELECT RAISE(IGNORE);
       END`,
    ).run();
    try {
      const result = await postBirthResponse(
        USER_A,
        "key-ignored-chart-without-winner",
        ALICE,
      );
      expect(result.response.status).toBe(500);
      expect(result.body).toMatchObject({
        error: {
          code: "internal_error",
          message: "Unexpected server error",
        },
      });
      expect(JSON.stringify(result.body)).not.toContain(
        "chart_publication_conflict",
      );
      expect(
        await rows(
          `SELECT id, fingerprint FROM chart_snapshots
           WHERE user_id = ?`,
          USER_A,
        ),
      ).toEqual([]);
      expect(
        await rows<{
          status: string;
          result_class: string | null;
          finished_at: string | null;
        }>(
          `SELECT status, result_class, finished_at FROM jobs
           WHERE user_id = ? AND idempotency_key = ?`,
          USER_A,
          "key-ignored-chart-without-winner",
        ),
      ).toEqual([{
        status: "failed",
        result_class: "chart_publication_conflict",
        finished_at: expect.any(String),
      }]);
      expect(
        await rows<{ status: string }>(
          `SELECT status FROM birth_profiles
           WHERE user_id = ? AND version = 1`,
          USER_A,
        ),
      ).toEqual([{ status: "invalid" }]);
    } finally {
      await env.DB.prepare("DROP TRIGGER ignore_birth_chart_insert").run();
    }
  });

  it("settles a fingerprint winner that appears after the first null reread", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await seedFailedBirthAttempt(
      "key-late-fingerprint-winner-seed",
      retryCommand(),
    );
    await env.DB.prepare(
      `UPDATE birth_profiles SET status = 'active'
       WHERE user_id = ? AND version = 1`,
    ).bind(USER_A).run();

    const winnerId = "cht_late_fingerprint_winner_0001";
    await env.DB.prepare(
      `CREATE TRIGGER ignore_birth_chart_before_late_winner
       BEFORE INSERT ON chart_snapshots
       WHEN NEW.id != '${winnerId}'
       BEGIN
         SELECT RAISE(IGNORE);
       END`,
    ).run();

    const prepare = env.DB.prepare.bind(env.DB);
    let winnerInjected = false;
    vi.spyOn(env.DB, "prepare").mockImplementation((query) => {
      const statement = prepare(query);
      if (
        !query.includes("SELECT id FROM chart_snapshots") ||
        !query.includes("WHERE user_id = ? AND fingerprint = ?")
      ) {
        return statement;
      }
      return new Proxy(statement, {
        get(target, property) {
          if (property === "bind") {
            return (...values: unknown[]) => {
              const bound = target.bind(...values);
              return new Proxy(bound, {
                get(boundTarget, boundProperty) {
                  if (boundProperty === "first") {
                    return async (columnName?: string) => {
                      const result = columnName === undefined
                        ? await boundTarget.first()
                        : await boundTarget.first(columnName);
                      if (!winnerInjected && result === null) {
                        winnerInjected = true;
                        const now = "2026-08-27T01:30:00.000Z";
                        await prepare(
                          `INSERT INTO chart_snapshots (
                             id, user_id, profile_version, fingerprint,
                             contract_id, contract_version, container_digest,
                             tzdb_version, status, calculated_at, snapshot_json,
                             birth_accuracy, birth_enc, birth_key_version,
                             birth_nonce, r2_uri, uncertainty_json, created_at
                           ) VALUES (
                             ?, ?, 1, ?, 'patternlike.chart', '0.2.0', ?,
                             '2026a', 'active', ?, '{}', 'exact', X'00', 1,
                             'late-winner-nonce', NULL, '{}', ?
                           )`,
                        ).bind(
                          winnerId,
                          USER_A,
                          values[1],
                          `sha256:${"c".repeat(64)}`,
                          now,
                          now,
                        ).run();
                      }
                      return result;
                    };
                  }
                  const value = Reflect.get(
                    boundTarget,
                    boundProperty,
                    boundTarget,
                  ) as unknown;
                  return typeof value === "function"
                    ? value.bind(boundTarget)
                    : value;
                },
              });
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });

    try {
      const result = await postBirthResponse(
        USER_A,
        "key-late-fingerprint-winner",
        ALICE,
      );
      expect(winnerInjected).toBe(true);
      expect(result.response.status).toBe(409);
      expect(result.body).toMatchObject({
        error: {
          code: "chart_already_exists",
          details: { chart_id: winnerId },
        },
      });
      expect(
        await rows<{ status: string; result_class: string | null }>(
          `SELECT status, result_class FROM jobs
           WHERE user_id = ? AND idempotency_key = ?`,
          USER_A,
          "key-late-fingerprint-winner",
        ),
      ).toEqual([{ status: "succeeded", result_class: winnerId }]);
      expect(
        await rows<{ status: string }>(
          `SELECT status FROM birth_profiles
           WHERE user_id = ? AND version = 2`,
          USER_A,
        ),
      ).toEqual([{ status: "superseded" }]);
    } finally {
      await env.DB.prepare(
        "DROP TRIGGER ignore_birth_chart_before_late_winner",
      ).run();
    }
  });

  it("uses one captured wall-clock instant across reservation, profile, job, and completion writes", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await postBirthProfile(USER_A, "key-one-now", ALICE);
    expect(result.status).toBe(202);

    const timestampRows = await rows<Record<string, string>>(
      `SELECT
         p.created_at AS profile_created,
         p.updated_at AS profile_updated,
         j.created_at AS job_created,
         j.started_at AS job_started,
         j.finished_at AS job_finished,
         r.created_at AS reservation_created,
         r.charged_at AS reservation_charged,
         u.created_at AS usage_created,
         u.updated_at AS usage_updated,
         c.updated_at AS counter_updated
       FROM birth_profiles p
       JOIN jobs j ON j.user_id = p.user_id
       JOIN birth_calc_reservations r ON r.user_id = p.user_id
       JOIN birth_calc_daily_usage u ON u.user_id = p.user_id
       JOIN birth_profile_version_counters c ON c.user_id = p.user_id
       WHERE p.user_id = ?`,
      USER_A,
    );
    expect(timestampRows).toHaveLength(1);
    expect(new Set(Object.values(timestampRows[0]!))).toHaveProperty("size", 1);
  });

  it("rolls a charged reservation back when the guarded profile/job batch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await env.DB.prepare(
      `CREATE TRIGGER fail_birth_profile_guarded_write
       BEFORE INSERT ON birth_profiles
       BEGIN
         SELECT RAISE(ABORT, 'forced birth profile write failure');
       END`,
    ).run();
    try {
      const result = await postBirthProfile(
        USER_A,
        "key-guarded-write-failure",
        ALICE,
      );
      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({
        error: { code: "internal_error" },
      });
      expect(await rows("SELECT * FROM birth_calc_daily_usage")).toEqual([]);
      expect(await rows("SELECT * FROM birth_calc_reservations")).toEqual([]);
      expect(await rows("SELECT * FROM birth_profiles")).toEqual([]);
      expect(await rows("SELECT * FROM jobs")).toEqual([]);
    } finally {
      await env.DB.prepare(
        "DROP TRIGGER fail_birth_profile_guarded_write",
      ).run();
    }
  });
});

describe("POST /v1/birth-profiles — input validation", () => {
  const cases: Array<[string, Partial<Record<string, unknown>>, string]> = [
    [
      "exact accuracy with no birth_time_local",
      { ...ALICE, birth_time_local: undefined },
      "invalid_body",
    ],
    ["birth_date not YYYY-MM-DD", { ...ALICE, birth_date: "1990-5-15" }, "invalid_body"],
    [
      "latitude out of range",
      { ...ALICE, birthplace: { latitude: 999, longitude: 0 } },
      "invalid_body",
    ],
    [
      "coordinates as strings",
      { ...ALICE, birthplace: { latitude: "34.05", longitude: -118.24 } },
      "invalid_body",
    ],
    [
      "half-specified birthplace",
      { ...ALICE, birthplace: { latitude: 34.05 } },
      "invalid_body",
    ],
    ["missing consent_id", { ...ALICE, consent_id: undefined }, "invalid_body"],
    ["unrecognised accuracy", { ...ALICE, accuracy: "precise" }, "invalid_body"],
  ];

  for (const [label, body, code] of cases) {
    it(`rejects ${label} with 400 ${code}`, async () => {
      const res = await postBirthProfile(USER_A, `key-${label.replace(/\W+/g, "-")}`, body);
      expect(res.status).toBe(400);
      expect((res.body.error as Record<string, unknown>).code).toBe(code);
    });
  }

  it("writes nothing when validation fails", async () => {
    await postBirthProfile(USER_A, "key-invalid", { ...ALICE, birth_time_local: undefined });
    expect(await rows("SELECT version FROM birth_profiles")).toHaveLength(0);
    expect(await rows("SELECT id FROM jobs")).toHaveLength(0);
  });

  it("returns a JSON envelope for a malformed body, not text/plain 500", async () => {
    const res = await postBirthProfile(USER_A, "key-badjson", '{"accuracy":');
    expect(res.status).toBe(400);
    expect(res.contentType).toContain("application/json");
    expect((res.body.error as Record<string, unknown>).code).toBe("invalid_json");
  });

  it("requires an idempotency key", async () => {
    const res = await SELF.fetch("http://api.test/v1/birth-profiles", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": USER_A },
      body: JSON.stringify(ALICE),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("missing_idempotency_key");
  });

  it("requires identity", async () => {
    const res = await SELF.fetch("http://api.test/v1/birth-profiles", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "key-noauth" },
      body: JSON.stringify(ALICE),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/birth-profiles — calculation failures", () => {
  const failing = (trigger: string) => ({
    ...ALICE,
    birthplace: { label: trigger, latitude: 34.05, longitude: -118.24 },
  });

  it("maps an upstream invalid_birth_profile to 400, echoing the caller's own fault", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await postBirthProfile(USER_A, "key-invalidprofile", failing(TRIGGER_INVALID_PROFILE));
    expect(res.status).toBe(400);
    expect((res.body.error as Record<string, unknown>).code).toBe("invalid_birth_profile");
    expect(completedCalcEvents(info)).toHaveLength(1);
    expect(completedCalcEvents(info)[0]![1]).toMatchObject({
      outcome: "invalid_input",
      latency_ms: expect.any(Number),
      timeout_ms: 10_000,
    });
  });

  it("returns 502 for an upstream fault without leaking the server's filesystem path", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await postBirthProfile(USER_A, "key-calcerror", failing(TRIGGER_CALC_ERROR));
    expect(res.status).toBe(502);

    const err = res.body.error as Record<string, string>;
    expect(err.code).toBe("calc_failed");
    expect(err.message).not.toContain("/srv/app");
    expect(err.message).not.toBe(LEAKY_UPSTREAM_MESSAGE);
    expect(JSON.stringify(res.body)).not.toContain("sepl_18.se1");
    expect(completedCalcEvents(info)).toHaveLength(1);
    expect(completedCalcEvents(info)[0]![1]).toMatchObject({
      outcome: "upstream_failure",
      latency_ms: expect.any(Number),
      timeout_ms: 10_000,
    });
  });

  it("aborts the deterministic timeout sentinel and emits one closed timeout event", async () => {
    env.CALC_FETCH_TIMEOUT_MS = "1000";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await postBirthProfile(
      USER_A,
      "key-calc-timeout",
      failing(TRIGGER_CALC_TIMEOUT),
    );

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({
      error: {
        code: "calc_failed",
        message: "Calculation service could not produce a chart",
        request_id: expect.stringMatching(/^[A-Za-z0-9_.:-]{8,128}$/),
      },
    });
    expect(JSON.stringify(res.body)).not.toContain("TRIGGER_CALC_TIMEOUT");
    expect(
      await rows<{ profile_status: string; job_status: string; result_class: string }>(
        `SELECT p.status AS profile_status, j.status AS job_status,
                j.result_class
         FROM birth_profiles p JOIN jobs j ON j.user_id = p.user_id
         WHERE p.user_id = ?`,
        USER_A,
      ),
    ).toEqual([{
      profile_status: "invalid",
      job_status: "failed",
      result_class: "calc_transport_error",
    }]);

    const events = completedCalcEvents(info);
    expect(events).toHaveLength(1);
    expect(events[0]![1]).toMatchObject({
      outcome: "timeout",
      latency_ms: expect.any(Number),
      timeout_ms: 1_000,
    });
    expect(Number.isInteger(
      (events[0]![1] as { latency_ms: number }).latency_ms,
    )).toBe(true);
    expect(
      (events[0]![1] as { latency_ms: number }).latency_ms,
    ).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify([
      ...info.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ])).not.toContain("TRIGGER_CALC_TIMEOUT");
  }, 5_000);

  it("marks the profile invalid and the job failed rather than orphaning them", async () => {
    await postBirthProfile(USER_A, "key-calcerror", failing(TRIGGER_CALC_ERROR));

    const profiles = await rows<{ status: string }>("SELECT status FROM birth_profiles");
    const jobs = await rows<{ status: string }>("SELECT status FROM jobs");
    expect(profiles.map((p) => p.status)).toEqual(["invalid"]);
    expect(jobs.map((j) => j.status)).toEqual(["failed"]);
  });

  it("retries a failed key without colliding on the unique index", async () => {
    await postBirthProfile(USER_A, "key-retry", failing(TRIGGER_CALC_ERROR));
    const retry = await postBirthProfile(USER_A, "key-retry", failing(TRIGGER_CALC_ERROR));

    // Before the fix this was a 500 forever: the job was stuck 'running' so the
    // succeeded-only short-circuit never fired and the jobs INSERT re-collided.
    expect(retry.status).toBe(502);
    const jobs = await rows<{ attempts: number }>("SELECT attempts FROM jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.attempts).toBe(2);
  });

  it("requires a new key before recovering with changed birth data", async () => {
    await postBirthProfile(USER_A, "key-recover", failing(TRIGGER_CALC_ERROR));
    const conflict = await postBirthProfile(USER_A, "key-recover", ALICE);
    expect(conflict.status).toBe(409);
    expect((conflict.body.error as Record<string, unknown>).code).toBe(
      "idempotency_conflict",
    );

    const ok = await postBirthProfile(USER_A, "key-recover-new", ALICE);
    expect(ok.status).toBe(202);
    expect(ok.body.status).toBe("succeeded");
    const jobs = await rows<{ status: string }>(
      "SELECT status FROM jobs ORDER BY idempotency_key",
    );
    expect(jobs.map((j) => j.status).sort()).toEqual(["failed", "succeeded"]);
  });
});

describe("chart lifecycle invariants", () => {
  it("keeps at most one active profile per user across many submissions", async () => {
    await postBirthProfile(USER_A, "key-alpha-01", ALICE);
    await postBirthProfile(USER_A, "key-beta-002", { ...ALICE, birth_date: "1991-06-16" });
    await postBirthProfile(USER_A, "key-gamma-03", { ...ALICE, birth_date: "1992-07-17" });

    const active = await rows("SELECT version FROM birth_profiles WHERE status = 'active'");
    expect(active).toHaveLength(1);
  });

  it("keeps at most one active chart per user", async () => {
    await postBirthProfile(USER_A, "key-alpha-01", ALICE);
    await postBirthProfile(USER_A, "key-beta-002", { ...ALICE, birth_date: "1991-06-16" });

    const active = await rows("SELECT id FROM chart_snapshots WHERE status = 'active'");
    expect(active).toHaveLength(1);
  });

  it("maps every active chart to an active profile", async () => {
    await postBirthProfile(USER_A, "key-alpha-01", ALICE);
    await postBirthProfile(USER_A, "key-beta-002", { ...ALICE, birth_date: "1991-06-16" });

    const mismatched = await rows(
      `SELECT c.id FROM chart_snapshots c
       JOIN birth_profiles p ON p.user_id = c.user_id AND p.version = c.profile_version
       WHERE c.status = 'active' AND p.status <> 'active'`,
    );
    expect(mismatched).toHaveLength(0);
  });

  it("supersedes rather than deletes the previous chart", async () => {
    await postBirthProfile(USER_A, "key-alpha-01", ALICE);
    await postBirthProfile(USER_A, "key-beta-002", { ...ALICE, birth_date: "1991-06-16" });

    const all = await rows<{ status: string }>(
      "SELECT status FROM chart_snapshots ORDER BY created_at",
    );
    expect(all).toHaveLength(2);
    expect(all.filter((c) => c.status === "superseded")).toHaveLength(1);
  });

  it("serves the replacement chart and writes its natal-feature receipt", async () => {
    const first = await postBirthProfile(USER_A, "key-alpha-01", ALICE);
    const second = await postBirthProfile(USER_A, "key-bob-corr", BOB);

    expect(second.status).toBe(202);
    expect(second.body.status).toBe("succeeded");
    expect(second.body.resource_id).not.toBe(first.body.resource_id);

    const chart = await getChart(USER_A);
    expect(chart.status).toBe(200);
    expect(chart.body.id).toBe(second.body.resource_id);

    const receipts = await rows<{ chart_id: string }>(
      `SELECT chart_id FROM natal_feature_sets WHERE user_id = ?`,
      USER_A,
    );
    expect(receipts).toHaveLength(2);
    expect(receipts.map((row) => row.chart_id)).toEqual(
      expect.arrayContaining([first.body.resource_id, second.body.resource_id]),
    );
  });

  it("stores birth PII only as ciphertext", async () => {
    await postBirthProfile(USER_A, "key-alpha-01", ALICE);

    const snap = await rows<{ snapshot_json: string; birth_enc: unknown }>(
      "SELECT snapshot_json, birth_enc FROM chart_snapshots",
    );
    expect(snap[0]!.birth_enc).toBeTruthy();
    // The queryable snapshot must not carry the birth date or place in clear.
    expect(snap[0]!.snapshot_json).not.toContain("1990-05-15");
    expect(snap[0]!.snapshot_json).not.toContain("Los Angeles");
  });
});

describe("unknown birth time", () => {
  const UNKNOWN = {
    accuracy: "unknown" as const,
    consent_id: "cns_unknown",
    birth_date: "1990-05-15",
    timezone_hint: "America/Los_Angeles",
    birthplace: { label: "Los Angeles", latitude: 34.05, longitude: -118.24 },
  };

  it("returns a chart with no angles and no houses", async () => {
    await postBirthProfile(USER_A, "key-unknown", UNKNOWN);
    const chart = await getChart(USER_A);

    expect(chart.status).toBe(200);
    expect(chart.body.angles).toBeNull();
    expect(chart.body.houses).toBeNull();
  });

  it("omits the ascendant and leaves every house null", async () => {
    await postBirthProfile(USER_A, "key-unknown", UNKNOWN);
    const chart = await getChart(USER_A);

    const positions = chart.body.positions as Array<{ body: string; house: number | null }>;
    expect(positions.some((p) => p.body === "ascendant")).toBe(false);
    expect(positions.every((p) => p.house === null)).toBe(true);
  });

  it("agrees with itself about accuracy", async () => {
    await postBirthProfile(USER_A, "key-unknown", UNKNOWN);
    const chart = await getChart(USER_A);

    const birth = chart.body.birth as { accuracy: string };
    const uncertainty = chart.body.uncertainty as { accuracy: string };
    // The old code returned birth.accuracy "exact" alongside an uncertainty
    // report declaring angles suppressed for unknown_birth_time.
    expect(birth.accuracy).toBe("unknown");
    expect(uncertainty.accuracy).toBe("unknown");
  });

  it("reports angles as suppressed", async () => {
    await postBirthProfile(USER_A, "key-unknown", UNKNOWN);
    const chart = await getChart(USER_A);

    const uncertainty = chart.body.uncertainty as {
      suppressed_features: Array<{ feature_class: string }>;
    };
    const classes = uncertainty.suppressed_features.map((f) => f.feature_class);
    expect(classes).toContain("angles");
    expect(classes).toContain("houses");
    expect(classes).toContain("moon_time_sensitive");
  });
});

describe("historical timezone resolution", () => {
  /**
   * `timezone_hint` is the browser's *current* zone, which is wrong for anyone
   * who has moved since being born. Before the lookup was connected it was
   * passed straight through to the calculation, so a Londoner requesting their
   * Los Angeles chart got one built eight hours out.
   */
  it("calculates in the birthplace's zone, not the client's hint", async () => {
    const res = await postBirthProfile(USER_A, "key-tz-override", {
      ...ALICE,
      timezone_hint: "Europe/London",
    });

    expect(res.status).toBe(202);
    expect(res.body.timezone).toMatchObject({
      resolved: "America/Los_Angeles",
      source: "coordinates",
      hint_overridden: "Europe/London",
    });

    const profile = await rows<{ timezone: string }>(
      "SELECT timezone FROM birth_profiles WHERE user_id = ?",
      USER_A,
    );
    expect(profile[0]!.timezone).toBe("America/Los_Angeles");
  });

  it("grades the lookup instead of leaving geocode_confidence null", async () => {
    await postBirthProfile(USER_A, "key-tz-confidence", ALICE);

    const profile = await rows<{ geocode_confidence: string | null }>(
      "SELECT geocode_confidence FROM birth_profiles WHERE user_id = ?",
      USER_A,
    );
    expect(profile[0]!.geocode_confidence).toBe("high");
  });

  it("qualifies a pre-1970 birth rather than presenting the zone as settled", async () => {
    const res = await postBirthProfile(USER_A, "key-tz-pre-1970", {
      ...ALICE,
      birth_date: "1952-03-04",
    });

    expect(res.body.timezone).toMatchObject({ confidence: "medium" });
    const qualifiers = (res.body.timezone as { qualifiers: Array<{ code: string }> })
      .qualifiers;
    expect(qualifiers.map((q) => q.code)).toContain("pre_1970_zone_boundary");

    const profile = await rows<{ geocode_confidence: string | null }>(
      "SELECT geocode_confidence FROM birth_profiles WHERE user_id = ?",
      USER_A,
    );
    expect(profile[0]!.geocode_confidence).toBe("medium");
  });

  it("keeps the hint when there is no birthplace to check it against", async () => {
    const res = await postBirthProfile(USER_A, "key-tz-no-place", {
      accuracy: "exact",
      consent_id: "cns_alice_0001",
      birth_date: "1990-05-15",
      birth_time_local: "12:34:00",
      timezone_hint: "America/Los_Angeles",
    });

    expect(res.status).toBe(202);
    expect(res.body.timezone).toMatchObject({
      resolved: "America/Los_Angeles",
      source: "hint",
      confidence: "none",
    });
  });

  it("rejects a timezone_hint that is not an IANA zone before calculating", async () => {
    const res = await postBirthProfile(USER_A, "key-tz-garbage", {
      accuracy: "exact",
      consent_id: "cns_alice_0001",
      birth_date: "1990-05-15",
      birth_time_local: "12:34:00",
      // A fixed offset has no history, so it can never be a birth zone.
      timezone_hint: "-07:00",
    });

    expect(res.status).toBe(400);
    expect((res.body.error as Record<string, unknown>).code).toBe("invalid_body");

    // Nothing was written and no calculation was invoked.
    const profiles = await rows("SELECT 1 FROM birth_profiles WHERE user_id = ?", USER_A);
    expect(profiles).toHaveLength(0);
  });

  it("rejects a non-string timezone_hint as a bad request, not a crash", async () => {
    const res = await postBirthProfile(
      USER_A,
      "key-tz-not-a-string",
      JSON.stringify({
        accuracy: "exact",
        consent_id: "cns_alice_0001",
        birth_date: "1990-05-15",
        birth_time_local: "12:34:00",
        timezone_hint: -7,
      }),
    );

    expect(res.status).toBe(400);
    expect((res.body.error as Record<string, unknown>).code).toBe("invalid_body");
  });

  it("agrees with what the lookup endpoint told the client", async () => {
    const preview = await SELF.fetch("http://api.test/v1/timezone-lookup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": USER_A },
      body: JSON.stringify({
        latitude: ALICE.birthplace!.latitude,
        longitude: ALICE.birthplace!.longitude,
        birth_date: ALICE.birth_date,
        birth_time_local: ALICE.birth_time_local,
        timezone_hint: ALICE.timezone_hint,
      }),
    });
    const previewed = (await preview.json()) as { timezone: string };

    const created = await postBirthProfile(USER_A, "key-tz-agreement", ALICE);
    const profile = await rows<{ timezone: string }>(
      "SELECT timezone FROM birth_profiles WHERE user_id = ?",
      USER_A,
    );

    // The onboarding form asks the user to confirm the previewed zone; a chart
    // calculated in a different one would make that confirmation meaningless.
    // GET /v1/chart redacts birth.timezone, so the stored profile is where the
    // two can be compared.
    expect(previewed.timezone).toBe("America/Los_Angeles");
    expect(profile[0]!.timezone).toBe(previewed.timezone);
    expect((created.body.timezone as { resolved: string }).resolved).toBe(
      previewed.timezone,
    );
  });
});

describe("GET /v1/chart", () => {
  it("404s for an authenticated user with no chart", async () => {
    // USER_B is seeded and has no chart in this suite, so this keeps its
    // original meaning. The "no such user" case it used to conflate is a
    // different concern, covered by the authenticate tests.
    const res = await getChart(USER_B);
    expect(res.status).toBe(404);
    expect((res.body.error as Record<string, unknown>).code).toBe("chart_not_found");
  });

  it("redacts birth PII from the response", async () => {
    await postBirthProfile(USER_A, "key-alpha-01", ALICE);
    const chart = await getChart(USER_A);

    const birth = chart.body.birth as Record<string, unknown>;
    expect(birth.utc_instant).toBeNull();
    expect(birth.place_label).toBeNull();
    expect(birth.latitude).toBeNull();
    expect(birth.longitude).toBeNull();
    expect(birth.accuracy).toBe("exact");
  });
});
