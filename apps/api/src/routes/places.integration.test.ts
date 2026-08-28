import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { GEOCODER_CONSENT_POLICY_VERSION } from "@patternlike/shared";

import { app } from "../index.js";
import { grantGeocoderConsent } from "../db/consents.js";
import {
  IDENTITY_A,
  resetDb,
  rows,
  seedUser,
  USER_A,
} from "../../test/helpers.js";

function requestEnv(overrides: Record<string, unknown> = {}) {
  return {
    ...env,
    GEOCODER_ROLLOUT: "enabled",
    GOOGLE_MAPS_PLATFORM_API_KEY: "test-google-key",
    PLACE_SEARCH_RATE_LIMITER: {
      limit: async () => ({ success: true }),
    },
    ...overrides,
  } as typeof env;
}

async function post(path: string, body: unknown, overrides = {}) {
  const response = await app.request(`http://api.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": USER_A,
    },
    body: JSON.stringify(body),
  }, requestEnv(overrides));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await resetDb();
  await seedUser(IDENTITY_A);
});

describe("place routes", () => {
  it("returns unavailable before parsing or provider access while rollout is off", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await post("/v1/places/search", { malformed: true }, {
      GEOCODER_ROLLOUT: "off",
      GOOGLE_MAPS_PLATFORM_API_KEY: "",
    });
    expect(response).toMatchObject({
      status: 503,
      body: { error: { code: "geocoder_unavailable" } },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires the exact active geocoder consent before rate limiting", async () => {
    const limiter = { limit: vi.fn(async () => ({ success: true })) };
    const response = await post("/v1/places/search", {
      query: "London",
      session_token: "session-0001",
    }, { PLACE_SEARCH_RATE_LIMITER: limiter });
    expect(response).toMatchObject({
      status: 403,
      body: { error: { code: "geocoder_consent_required" } },
    });
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("searches and stores one normalized selected place", async () => {
    await grantGeocoderConsent(
      env,
      IDENTITY_A,
      GEOCODER_CONSENT_POLICY_VERSION,
      "onboarding",
      "geocoder-grant-0001",
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("places:autocomplete")) {
        return new Response(JSON.stringify({
          suggestions: [{
            placePrediction: {
              placeId: "google-place-id",
              structuredFormat: {
                mainText: { text: "London" },
                secondaryText: { text: "United Kingdom" },
              },
            },
          }],
        }));
      }
      return new Response(JSON.stringify({
        formattedAddress: "London, UK",
        location: { latitude: 51.5074, longitude: -0.1278 },
        granularity: "GEOMETRIC_CENTER",
        types: ["locality"],
        addressComponents: [],
      }));
    });
    vi.stubGlobal("fetch", fetcher);

    expect(await post("/v1/places/search", {
      query: "London",
      locale: "en-GB",
      session_token: "session-0001",
    })).toMatchObject({
      status: 200,
      body: {
        schema_version: "0.8.0",
        candidates: [{ candidate_id: "google-place-id" }],
      },
    });

    const resolved = await post("/v1/places/resolve", {
      candidate_id: "google-place-id",
      session_token: "session-0001",
    });
    expect(resolved).toMatchObject({
      status: 200,
      body: {
        schema_version: "0.8.0",
        label: "London, UK",
        latitude: 51.5074,
        longitude: -0.1278,
        geocode_confidence: "high",
      },
    });
    expect(String(resolved.body.place_id)).toMatch(/^plc_[0-9a-f]{32}$/);
    expect(await rows("SELECT id FROM place_resolutions WHERE user_id = ?", USER_A))
      .toHaveLength(1);
  });
});
