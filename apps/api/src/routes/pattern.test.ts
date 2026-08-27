import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import type { PatternContentObject } from "@patternlike/shared";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  disablePatternAi,
  enablePatternAi,
  resetDb,
  seedActiveOntology,
  seedActiveRelease,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import type { ContentReleaseBundle } from "../services/content-release.js";

function pattern(id: string, priority: number, sign: number): PatternContentObject {
  return {
    id,
    content_type: "pattern",
    content_version: "1.0.0",
    object_hash: `sha256:${"0".repeat(64)}`,
    locale: "en-US",
    status: "approved",
    display_priority: priority,
    title: `Chapter ${id}`,
    summary: "A mechanical summary.",
    body: "Reviewed chapter body.",
    resources: ["A practical resource"],
    tensions: ["A named tension"],
    counter_expression: "The same fact can be expressed another way.",
    prohibited_claims: ["causal_claims"],
    tags: ["launch"],
    minimum_accuracy: "unknown",
    requires_houses: false,
    required_bodies: ["sun"],
    required_aspects: [],
    match: {
      all_of: [{ type: "position", body: "sun", sign }],
      any_of: [],
      none_of: [],
    },
  };
}

async function seedM4(patterns: PatternContentObject[]): Promise<{ bundleHash: string }> {
  return seedActiveRelease("release-m4-pattern", (bundle: ContentReleaseBundle) => {
    bundle.schema_version = "0.4.0";
    bundle.objects.patterns = patterns;
  });
}

async function get(path = "/v1/pattern") {
  const response = await SELF.fetch(`http://api.test${path}`, {
    headers: { "x-user-id": USER_A },
  });
  const text = await response.text();
  return {
    response,
    body: (text ? JSON.parse(text) : {}) as {
      items?: unknown[];
      error?: { code: string };
    },
  };
}

/**
 * `GET /v1/pattern` is the generated Pattern reader for every authenticated
 * account. The M4 editorial catalogue is preserved data — releases still ingest
 * and still export — but it is no longer a product path this route can select,
 * so a matching approved chapter must never reach a reader from here.
 */
describe("GET /v1/pattern", () => {
  beforeEach(async () => {
    await resetDb();
    disablePatternAi();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A, {
      positions: [{ body: "sun", longitude_deg: 15 }],
    });
  });

  it("never serves an eligible editorial chapter, even with a matching M4 release", async () => {
    await seedM4([
      pattern("pattern.third", 30, 1),
      pattern("pattern.first", 10, 1),
      pattern("pattern.second", 20, 1),
    ]);

    const result = await get();
    expect(result.body.items).toBeUndefined();
    expect(result.response.status).toBe(409);
    expect(result.body.error?.code).toBe("pattern_generation_consent_required");
  });

  it.each([
    "/v1/pattern?other=1",
    "/v1/pattern?limit=0",
    "/v1/pattern?limit=2",
    "/v1/pattern?limit=2&limit=3",
    "/v1/pattern?cursor=anything",
  ])("accepts no query parameter at all: %s", async (path) => {
    await seedM4([pattern("pattern.one", 1, 1)]);
    const result = await get(path);
    expect(result.response.status).toBe(400);
    expect(result.body.error?.code).toBe("invalid_pattern_query");
  });

  it("answers the ontology gate rather than an editorial page once consent exists", async () => {
    enablePatternAi();
    await seedM4([pattern("pattern.one", 1, 1)]);
    await seedActiveOntology();

    const reserved = await SELF.fetch("http://api.test/v1/pattern-generations", {
      method: "POST",
      headers: {
        "x-user-id": USER_A,
        "content-type": "application/json",
        "idempotency-key": "idem-pattern-route-generated",
      },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: "1.0.0",
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(reserved.status).toBe(202);

    const result = await get();
    expect(result.body.items).toBeUndefined();
    expect(result.response.status).toBe(409);
    expect(result.body.error?.code).toBe("pattern_generation_in_progress");
  });

  it("keeps an M3 rollback out of the generated reader's answer", async () => {
    await seedActiveRelease("release-m3-rollback");
    const result = await get();
    expect(result.response.status).toBe(409);
    expect(result.body.error?.code).toBe("pattern_generation_consent_required");
  });

  it("leaves the ingested editorial release readable in D1", async () => {
    const release = await seedM4([pattern("pattern.one", 1, 1)]);
    const row = await env.DB.prepare(
      `SELECT bundle_hash FROM content_releases WHERE version = 'release-m4-pattern'`,
    ).first<{ bundle_hash: string }>();
    expect(row?.bundle_hash).toBe(release.bundleHash);
  });
});
