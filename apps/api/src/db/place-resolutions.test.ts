import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";

import {
  IDENTITY_A,
  IDENTITY_B,
  resetDb,
  rows,
  seedUser,
  USER_A,
} from "../../test/helpers.js";
import {
  loadPlaceResolution,
  pruneExpiredPlaceResolutions,
  storePlaceResolution,
} from "./place-resolutions.js";

const SELECTED = {
  label: "London, UK",
  latitude: 51.5074,
  longitude: -0.1278,
  geocode_confidence: "high" as const,
  qualifiers: [],
};

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
  await seedUser(IDENTITY_B);
});

describe("selected place resolutions", () => {
  it("round-trips normalized fields for the owner", async () => {
    const created = await storePlaceResolution(env, IDENTITY_A, SELECTED, {
      now: new Date("2026-08-28T08:00:00.000Z"),
    });

    expect(
      await loadPlaceResolution(
        env,
        IDENTITY_A,
        created.placeId,
        new Date("2026-08-29T07:59:59.000Z"),
      ),
    ).toEqual({ schema_version: "0.8.0", place_id: created.placeId, ...SELECTED });

    const stored = await rows<{
      payload_enc: ArrayBuffer | readonly number[];
      provider: string;
    }>(
      "SELECT payload_enc, provider FROM place_resolutions WHERE user_id = ?",
      USER_A,
    );
    expect(stored[0]!.provider).toBe("google_places_geocoding_v4");
    const payloadBytes = stored[0]!.payload_enc instanceof ArrayBuffer
      ? new Uint8Array(stored[0]!.payload_enc)
      : Uint8Array.from(stored[0]!.payload_enc);
    expect(new TextDecoder().decode(payloadBytes)).not.toContain("London");
  });

  it("returns null for foreign and expired ids", async () => {
    const created = await storePlaceResolution(env, IDENTITY_A, SELECTED, {
      now: new Date("2026-08-28T08:00:00.000Z"),
    });

    expect(
      await loadPlaceResolution(env, IDENTITY_B, created.placeId, new Date("2026-08-28T09:00:00.000Z")),
    ).toBeNull();
    expect(
      await loadPlaceResolution(env, IDENTITY_A, created.placeId, new Date("2026-08-29T08:00:00.000Z")),
    ).toBeNull();
  });

  it("cannot commit ciphertext sealed before a rotation fence", async () => {
    await env.DB.prepare(
      "UPDATE users SET crypto_write_fence = ? WHERE id = ?",
    ).bind("cop_00000000000000000000000000000001", USER_A).run();

    await expect(storePlaceResolution(env, IDENTITY_A, SELECTED)).rejects.toThrow();
    expect(await rows("SELECT id FROM place_resolutions")).toEqual([]);
  });

  it("prunes expired consumed and unconsumed rows in bounded order", async () => {
    const old = new Date("2026-08-26T08:00:00.000Z");
    const first = await storePlaceResolution(env, IDENTITY_A, SELECTED, { now: old });
    const second = await storePlaceResolution(env, IDENTITY_A, SELECTED, { now: old });
    await env.DB.prepare(
      "UPDATE place_resolutions SET consumed_at = ? WHERE id = ?",
    ).bind("2026-08-26T09:00:00.000Z", second.placeId).run();
    const live = await storePlaceResolution(env, IDENTITY_A, SELECTED, {
      now: new Date("2026-08-28T08:00:00.000Z"),
    });

    expect(await pruneExpiredPlaceResolutions(
      env,
      new Date("2026-08-28T08:00:00.000Z"),
      10,
    )).toBe(2);
    expect(await rows<{ id: string }>("SELECT id FROM place_resolutions"))
      .toEqual([{ id: live.placeId }]);
    expect(first.placeId).not.toBe(second.placeId);
  });
});
