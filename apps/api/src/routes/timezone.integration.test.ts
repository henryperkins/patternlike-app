import { beforeEach, describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import type { TimezoneLookupRequest, TimezoneLookupResponse } from "@patternlike/shared";
import { IDENTITY_A, USER_A, resetDb, seedUser } from "../../test/helpers.js";

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
});

async function lookup(
  body: TimezoneLookupRequest | string,
  userId: string | null = USER_A,
): Promise<{ status: number; body: TimezoneLookupResponse & Record<string, unknown> }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId) headers["x-user-id"] = userId;

  const res = await SELF.fetch("http://api.test/v1/timezone-lookup", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as TimezoneLookupResponse & Record<string, unknown>,
  };
}

describe("POST /v1/timezone-lookup", () => {
  it("resolves a birthplace to the zone and offset in force on the birth date", async () => {
    const res = await lookup({
      latitude: 34.0522,
      longitude: -118.2437,
      birth_date: "1990-05-15",
      birth_time_local: "12:34:00",
    });

    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe("America/Los_Angeles");
    expect(res.body.source).toBe("coordinates");
    expect(res.body.confidence).toBe("high");
    expect(res.body.local?.utc_offset_label).toBe("UTC-07:00");
    expect(res.body.local?.utc_instant).toBe("1990-05-15T19:34:00.000Z");
    expect(res.body.tzdb_stable_from_year).toBe(1970);
  });

  it("tells the caller when the birthplace overruled their hint", async () => {
    const res = await lookup({
      latitude: 34.0522,
      longitude: -118.2437,
      birth_date: "1990-05-15",
      birth_time_local: "12:34:00",
      timezone_hint: "Europe/London",
    });

    expect(res.body.timezone).toBe("America/Los_Angeles");
    expect(res.body.hint_overridden).toBe("Europe/London");
  });

  it("answers from the hint alone, marked unverified, when no place is given", async () => {
    const res = await lookup({
      birth_date: "1990-05-15",
      birth_time_local: "12:34:00",
      timezone_hint: "America/Los_Angeles",
    });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("hint");
    expect(res.body.confidence).toBe("none");
  });

  it("refuses a request with nothing to resolve", async () => {
    const res = await lookup({ birth_date: "1990-05-15" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "invalid_body" } });
  });

  it("refuses half a coordinate pair", async () => {
    const res = await lookup({ latitude: 34.0522 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "invalid_body" } });
  });

  it("refuses coordinates outside the globe", async () => {
    expect((await lookup({ latitude: 91, longitude: 0 })).status).toBe(400);
    expect((await lookup({ latitude: 0, longitude: 181 })).status).toBe(400);
    expect((await lookup({ latitude: Number.NaN, longitude: 0 })).status).toBe(400);
  });

  it("refuses a fixed offset masquerading as a zone", async () => {
    const res = await lookup({ timezone_hint: "-07:00" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "invalid_body" } });
  });

  it("refuses a body that is not JSON", async () => {
    const res = await lookup("not json at all");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "invalid_json" } });
  });

  /**
   * The body carries a birth date and time — the same values every other route
   * encrypts at rest. The lookup sits behind the same authentication as the
   * rest of /v1 rather than being an open endpoint that happens to be read-only.
   */
  it("requires authentication", async () => {
    const res = await lookup({ latitude: 34.0522, longitude: -118.2437 }, null);

    expect(res.status).toBe(401);
  });
});
