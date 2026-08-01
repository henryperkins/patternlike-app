import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
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
  TRIGGER_INVALID_PROFILE,
} from "../../test/mock-calc-service.js";

// Users exist before any request now — creation moved to identity-link time.
// resetDb truncates users, so both are seeded unconditionally: a suite that
// authenticates as USER_B without a row would 401 where it asserts a
// route-level status.
beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
  await seedUser(IDENTITY_B);
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
    const res = await postBirthProfile(USER_A, "key-invalidprofile", failing(TRIGGER_INVALID_PROFILE));
    expect(res.status).toBe(400);
    expect((res.body.error as Record<string, unknown>).code).toBe("invalid_birth_profile");
  });

  it("returns 502 for an upstream fault without leaking the server's filesystem path", async () => {
    const res = await postBirthProfile(USER_A, "key-calcerror", failing(TRIGGER_CALC_ERROR));
    expect(res.status).toBe(502);

    const err = res.body.error as Record<string, string>;
    expect(err.code).toBe("calc_failed");
    expect(err.message).not.toContain("/srv/app");
    expect(err.message).not.toBe(LEAKY_UPSTREAM_MESSAGE);
    expect(JSON.stringify(res.body)).not.toContain("sepl_18.se1");
  });

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

  it("recovers when the calculation service comes back", async () => {
    await postBirthProfile(USER_A, "key-recover", failing(TRIGGER_CALC_ERROR));
    const ok = await postBirthProfile(USER_A, "key-recover", ALICE);

    expect(ok.status).toBe(202);
    expect(ok.body.status).toBe("succeeded");
    const jobs = await rows<{ status: string }>("SELECT status FROM jobs");
    expect(jobs.map((j) => j.status)).toEqual(["succeeded"]);
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
