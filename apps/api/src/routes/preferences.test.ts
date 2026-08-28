import { SELF, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IDENTITY_A, USER_A, resetDb, rows, seedUser } from "../../test/helpers.js";
import type { Env } from "../env.js";
import { setContentLocale } from "../db/preferences.js";

interface PreferenceResponse {
  schema_version?: string;
  timezone?: string;
  locale?: string;
  source?: string;
  timezone_revision?: number;
  updated_at?: string;
  error?: { code: string; message: string; request_id: string | null };
}

async function put(
  path: string,
  body: unknown,
  init: { userId?: string; idempotencyKey?: string | null } = {},
): Promise<{ status: number; body: PreferenceResponse }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-user-id": init.userId ?? USER_A,
  };
  if (init.idempotencyKey !== null) {
    headers["idempotency-key"] = init.idempotencyKey ?? "pref-key-00000001";
  }
  const res = await SELF.fetch(`http://api.test${path}`, {
    method: "PUT",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as PreferenceResponse };
}

const setZone = (
  timezone: string,
  source = "user_confirmed",
  userId?: string,
  idempotencyKey?: string,
) => put("/v1/preferences/timezone", { timezone, source }, { userId, idempotencyKey });

const setLocale = (locale: string, source = "user_confirmed", idempotencyKey?: string) =>
  put("/v1/preferences/locale", { locale, source }, { idempotencyKey });

async function userRow() {
  const [row] = await rows<{
    timezone: string;
    timezone_source: string;
    timezone_revision: number;
    locale: string;
    locale_source: string;
  }>(
    `SELECT timezone, timezone_source, timezone_revision, locale, locale_source
     FROM users WHERE id = ?`,
    USER_A,
  );
  return row!;
}

function injectDeviceLocaleAfterRead(db: D1Database): D1Database {
  let injected = false;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrap(target.bind(...values));
        }
        if (property === "first") {
          return async <T>(columnName?: string) => {
            const result =
              columnName === undefined
                ? await target.first<T>()
                : await target.first<T>(columnName);
            if (!injected) {
              injected = true;
              await db
                .prepare(
                  `UPDATE users
                   SET locale = 'fr-FR', locale_source = 'device_derived',
                       locale_updated_at = '2026-08-09T12:00:00.000Z'
                   WHERE id = ?`,
                )
                .bind(USER_A)
                .run();
            }
            return result;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });

  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          const statement = target.prepare(query);
          return query.includes("SELECT timezone, timezone_source")
            ? wrap(statement)
            : statement;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

describe("PUT /v1/preferences/timezone", () => {
  beforeAll(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });
  beforeEach(async () => {
    await rows(
      `UPDATE users SET timezone = 'UTC', timezone_source = 'default_unconfirmed',
                        timezone_revision = 0, timezone_updated_at = NULL
       WHERE id = ?`,
      USER_A,
    );
    await rows("DELETE FROM timezone_changes WHERE user_id = ?", USER_A);
    await rows("DELETE FROM jobs WHERE user_id = ? AND job_type LIKE 'preference_%'", USER_A);
  });

  it("stores a confirmed zone, increments the revision, and logs the change", async () => {
    const res = await setZone("America/Chicago");
    expect(res.status).toBe(200);
    expect(res.body.schema_version).toBe("0.3.0");
    expect(res.body.timezone).toBe("America/Chicago");
    expect(res.body.source).toBe("user_confirmed");
    expect(res.body.timezone_revision).toBe(1);
    expect(res.body.updated_at).toBeTruthy();

    const row = await userRow();
    expect(row.timezone).toBe("America/Chicago");
    expect(row.timezone_source).toBe("user_confirmed");
    expect(row.timezone_revision).toBe(1);

    const log = await rows<{ previous_zone: string; next_zone: string; revision: number }>(
      "SELECT previous_zone, next_zone, revision FROM timezone_changes WHERE user_id = ?",
      USER_A,
    );
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      previous_zone: "UTC",
      next_zone: "America/Chicago",
      revision: 1,
    });
  });

  it("does not store an idempotent preference mutation while crypto writes are fenced", async () => {
    await rows(
      `UPDATE users SET crypto_write_fence =
         'cop_00000000000000000000000000000001' WHERE id = ?`,
      USER_A,
    );
    try {
      const result = await setZone(
        "America/Chicago",
        "user_confirmed",
        undefined,
        "pref-zone-fenced-0001",
      );

      expect(result.status).toBe(500);
      expect((await userRow()).timezone).toBe("UTC");
      expect(await rows(
        "SELECT id FROM jobs WHERE idempotency_key = ?",
        "pref-zone-fenced-0001",
      )).toEqual([]);
    } finally {
      await rows("UPDATE users SET crypto_write_fence = NULL WHERE id = ?", USER_A);
    }
  });

  it("moves the default off default_unconfirmed, which is what gates generation", async () => {
    expect((await userRow()).timezone_source).toBe("default_unconfirmed");
    await setZone("Europe/Berlin", "device_derived");
    expect((await userRow()).timezone_source).toBe("device_derived");
  });

  it("refuses a device sync over a zone the user chose", async () => {
    await setZone("America/Chicago", "user_confirmed", undefined, "pref-zone-user-0001");
    const res = await setZone("Asia/Tokyo", "device_derived", undefined, "pref-zone-device-0001");
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("preference_locked");
    expect(res.body.error?.request_id).toBeTruthy();

    const row = await userRow();
    expect(row.timezone).toBe("America/Chicago");
    expect(row.timezone_revision).toBe(1);
  });

  it("lets the user overrule their own device", async () => {
    await setZone("Europe/Berlin", "device_derived", undefined, "pref-zone-device-0002");
    const res = await setZone("Asia/Tokyo", "user_confirmed", undefined, "pref-zone-user-0002");
    expect(res.status).toBe(200);
    expect(res.body.timezone_revision).toBe(2);
  });

  it("treats an unchanged repeat as a no-op rather than a change", async () => {
    await setZone("Europe/Berlin", "device_derived", undefined, "pref-zone-noop-0001");
    const again = await setZone(
      "Europe/Berlin",
      "device_derived",
      undefined,
      "pref-zone-noop-0002",
    );
    expect(again.status).toBe(200);
    expect(again.body.timezone_revision).toBe(1);

    const log = await rows("SELECT id FROM timezone_changes WHERE user_id = ?", USER_A);
    expect(log).toHaveLength(1);
  });

  it("converges device A to B to A with distinct keys and keeps old replay inert", async () => {
    const firstA = await setZone(
      "America/Chicago",
      "device_derived",
      undefined,
      "web-device-timezone-a1",
    );
    const b = await setZone(
      "Asia/Tokyo",
      "device_derived",
      undefined,
      "web-device-timezone-b1",
    );

    expect(firstA.status).toBe(200);
    expect(b.body).toMatchObject({
      timezone: "Asia/Tokyo",
      source: "device_derived",
      timezone_revision: 2,
    });

    const replay = await setZone(
      "America/Chicago",
      "device_derived",
      undefined,
      "web-device-timezone-a1",
    );
    expect(replay).toEqual(firstA);
    expect(await userRow()).toMatchObject({
      timezone: "Asia/Tokyo",
      timezone_source: "device_derived",
      timezone_revision: 2,
    });
    expect(
      await rows(
        `SELECT id FROM jobs
         WHERE user_id = ? AND job_type = 'preference_timezone'`,
        USER_A,
      ),
    ).toHaveLength(2);
    expect(
      await rows(
        "SELECT id FROM timezone_changes WHERE user_id = ?",
        USER_A,
      ),
    ).toHaveLength(2);

    const secondA = await setZone(
      "America/Chicago",
      "device_derived",
      undefined,
      "web-device-timezone-a2",
    );
    expect(secondA.status).toBe(200);
    expect(secondA.body).toMatchObject({
      timezone: "America/Chicago",
      source: "device_derived",
      timezone_revision: 3,
    });
    expect(await userRow()).toMatchObject({
      timezone: "America/Chicago",
      timezone_source: "device_derived",
      timezone_revision: 3,
    });
    expect(
      await rows(
        `SELECT id FROM jobs
         WHERE user_id = ? AND job_type = 'preference_timezone'`,
        USER_A,
      ),
    ).toHaveLength(3);
    expect(
      await rows(
        "SELECT id FROM timezone_changes WHERE user_id = ?",
        USER_A,
      ),
    ).toHaveLength(3);
  });

  it("replays the original result without applying the preference again", async () => {
    const first = await setZone(
      "America/Chicago",
      "user_confirmed",
      undefined,
      "pref-zone-replay-0001",
    );
    await setZone("Asia/Tokyo", "user_confirmed", undefined, "pref-zone-replay-0002");

    const replay = await setZone(
      "America/Chicago",
      "user_confirmed",
      undefined,
      "pref-zone-replay-0001",
    );
    expect(replay).toEqual(first);
    expect(await userRow()).toMatchObject({
      timezone: "Asia/Tokyo",
      timezone_revision: 2,
    });
    const records = await rows<{ payload_json: string | null; payload_enc: ArrayBuffer | null }>(
      `SELECT payload_json, payload_enc FROM jobs
       WHERE user_id = ? AND job_type = 'preference_timezone'`,
      USER_A,
    );
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.payload_json === null)).toBe(true);
    expect(records.every((record) => record.payload_enc !== null)).toBe(true);
  });

  it("rejects reuse of an idempotency key for a different time zone", async () => {
    await setZone(
      "America/Chicago",
      "user_confirmed",
      undefined,
      "pref-zone-conflict-0001",
    );
    const conflict = await setZone(
      "Asia/Tokyo",
      "user_confirmed",
      undefined,
      "pref-zone-conflict-0001",
    );

    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe("idempotency_conflict");
    expect((await userRow()).timezone).toBe("America/Chicago");
  });

  it("does not disguise an unrelated D1 failure as a concurrent preference write", async () => {
    await rows("ALTER TABLE timezone_changes RENAME TO timezone_changes_unavailable");
    try {
      const result = await setZone(
        "America/Chicago",
        "user_confirmed",
        undefined,
        "pref-zone-outage-0001",
      );
      expect(result.status).toBe(500);
      expect(result.body.error?.code).toBe("internal_error");
    } finally {
      await rows("ALTER TABLE timezone_changes_unavailable RENAME TO timezone_changes");
    }
  });

  it("rejects a zone ICU accepts but the pinned tz database does not carry", async () => {
    // isValidIanaZone asks the runtime's ICU; every scheduler consumer resolves
    // the stored value through the pinned moment-timezone table, which throws
    // for a name it does not carry. Storing one poisons that user's cursor and,
    // because the scheduler lanes do not catch, aborts every cron invocation for
    // every user from then on. The write gate has to ask the database that will
    // actually be used.
    for (const zone of ["US/Pacific-New", "Canada/East-Saskatchewan"]) {
      const res = await setZone(zone);
      expect(res.status, zone).toBe(400);
      expect(res.body.error?.code, zone).toBe("invalid_timezone");
    }
  });

  it("rejects a fixed offset, an unknown zone, and a missing source", async () => {
    for (const zone of ["+05:30", "UTC+2", "Not/AZone", "", "   "]) {
      const res = await setZone(zone);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("invalid_timezone");
    }
    const noSource = await put("/v1/preferences/timezone", { timezone: "UTC" });
    expect(noSource.status).toBe(400);
    expect(noSource.body.error?.code).toBe("invalid_body");

    const unconfirmable = await put("/v1/preferences/timezone", {
      timezone: "UTC",
      source: "default_unconfirmed",
    });
    expect(unconfirmable.status).toBe(400);

    expect((await userRow()).timezone_revision).toBe(0);
  });

  it("requires an idempotency key and valid JSON", async () => {
    const noKey = await put(
      "/v1/preferences/timezone",
      { timezone: "UTC", source: "user_confirmed" },
      { idempotencyKey: null },
    );
    expect(noKey.status).toBe(400);
    expect(noKey.body.error?.code).toBe("missing_idempotency_key");

    const badJson = await put("/v1/preferences/timezone", "{oops");
    expect(badJson.status).toBe(400);
    expect(badJson.body.error?.code).toBe("invalid_json");
  });

  it("rejects an unauthenticated caller", async () => {
    const res = await SELF.fetch("http://api.test/v1/preferences/timezone", {
      method: "PUT",
      headers: { "content-type": "application/json", "idempotency-key": "pref-key-00000001" },
      body: JSON.stringify({ timezone: "UTC", source: "user_confirmed" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("PUT /v1/preferences/locale", () => {
  beforeAll(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });
  beforeEach(async () => {
    await rows(
      `UPDATE users SET locale = 'en-US', locale_source = 'default_unconfirmed',
                        locale_updated_at = NULL
       WHERE id = ?`,
      USER_A,
    );
    await rows("DELETE FROM jobs WHERE user_id = ? AND job_type LIKE 'preference_%'", USER_A);
  });

  it("stores a confirmed locale", async () => {
    const res = await setLocale("es-ES");
    expect(res.status).toBe(200);
    expect(res.body.schema_version).toBe("0.3.0");
    expect(res.body.locale).toBe("es-ES");
    expect(res.body.source).toBe("user_confirmed");

    const row = await userRow();
    expect(row.locale).toBe("es-ES");
    expect(row.locale_source).toBe("user_confirmed");
  });

  it("accepts a valid tag the active release may not support", async () => {
    // Support is resolved by the engine's fallback chain at read time. Refusing
    // it here would reject a legitimate preference the release cannot serve yet.
    const res = await setLocale("cy-GB");
    expect(res.status).toBe(200);
    expect(res.body.locale).toBe("cy-GB");
  });

  it("refuses a device sync over a locale the user chose", async () => {
    await setLocale("es-ES", "user_confirmed", "pref-locale-user-0001");
    const res = await setLocale("fr-FR", "device_derived", "pref-locale-device-0001");
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("preference_locked");
    expect((await userRow()).locale).toBe("es-ES");
  });

  it("lets a user choice supersede a device write that lands after its read", async () => {
    const racedEnv = {
      ...env,
      DB: injectDeviceLocaleAfterRead(env.DB),
    } as Env;
    const user = await setContentLocale(racedEnv, USER_A, "es-ES", "user_confirmed");

    expect(user.ok).toBe(true);
    expect(await userRow()).toMatchObject({
      locale: "es-ES",
      locale_source: "user_confirmed",
    });
  });

  it("replays the original locale result without overwriting a later choice", async () => {
    const first = await setLocale("es-ES", "user_confirmed", "pref-locale-replay-0001");
    await setLocale("de-DE", "user_confirmed", "pref-locale-replay-0002");

    const replay = await setLocale("es-ES", "user_confirmed", "pref-locale-replay-0001");
    expect(replay).toEqual(first);
    expect((await userRow()).locale).toBe("de-DE");
  });

  it("rejects a malformed tag", async () => {
    for (const locale of ["e", "not a locale", "en_US_", "", "x".repeat(40)]) {
      const res = await setLocale(locale);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("invalid_locale");
    }
    expect((await userRow()).locale).toBe("en-US");
  });
});
