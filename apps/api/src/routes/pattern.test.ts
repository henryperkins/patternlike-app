import { beforeEach, describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import type { PatternContentObject, PatternResponse } from "@patternlike/shared";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  resetDb,
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
  return { response, body: await response.json() as PatternResponse & { error?: { code: string } } };
}

describe("GET /v1/pattern", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A, {
      positions: [{ body: "sun", longitude_deg: 15 }],
    });
  });

  it("drains every eligible chapter in stable editorial order with a bound cursor", async () => {
    const release = await seedM4([
      pattern("pattern.third", 30, 1),
      pattern("pattern.first", 10, 1),
      pattern("pattern.second", 20, 1),
      pattern("pattern.not-matched", 5, 2),
    ]);

    const first = await get("/v1/pattern?limit=2");
    expect(first.response.status).toBe(200);
    expect(first.body.schema_version).toBe("0.4.0");
    expect(first.body.bundle_hash).toBe(release.bundleHash);
    expect(first.body.items.map((item) => item.content_id))
      .toEqual(["pattern.first", "pattern.second"]);
    expect(first.body.items[0]!.evidence[0]!.feature_id).toMatch(/^nft_[0-9a-f]{32}$/);
    expect(first.body.next_cursor).toEqual(expect.any(String));
    expect(first.body.omissions.predicate_mismatch).toBe(1);

    const second = await get(`/v1/pattern?limit=2&cursor=${first.body.next_cursor}`);
    expect(second.response.status).toBe(200);
    expect(second.body.items.map((item) => item.content_id)).toEqual(["pattern.third"]);
    expect(second.body.next_cursor).toBeNull();
  });

  it.each([
    "/v1/pattern?other=1",
    "/v1/pattern?limit=0",
    "/v1/pattern?limit=51",
    "/v1/pattern?limit=2&limit=3",
    "/v1/pattern?cursor=not-base64url",
  ])("rejects the closed query shape: %s", async (path) => {
    await seedM4([pattern("pattern.one", 1, 1)]);
    const result = await get(path);
    expect(result.response.status).toBe(400);
    expect(result.body.error?.code).toBe("invalid_pattern_query");
  });

  it("rejects a cursor after the active release changes", async () => {
    await seedM4([pattern("pattern.one", 1, 1), pattern("pattern.two", 2, 1)]);
    const first = await get("/v1/pattern?limit=1");
    expect(first.body.next_cursor).toEqual(expect.any(String));
    await seedActiveRelease("release-m4-next", (bundle) => {
      bundle.schema_version = "0.4.0";
      bundle.objects.patterns = [pattern("pattern.next", 1, 1)];
    });

    const stale = await get(`/v1/pattern?cursor=${first.body.next_cursor}`);
    expect(stale.response.status).toBe(409);
    expect(stale.body.error?.code).toBe("pattern_cursor_stale");
  });

  it("projects only reader-facing chapter fields and never the release internals", async () => {
    await seedM4([pattern("pattern.one", 1, 1)]);
    const result = await get();
    expect(result.response.status).toBe(200);
    expect(result.body.items).toHaveLength(1);

    // The reader gets prose and its evidence. Match rules, object hashes,
    // review status, signature bytes, and unmatched objects stay server-side.
    expect(Object.keys(result.body.items[0]!).sort()).toEqual([
      "body",
      "content_id",
      "content_version",
      "counter_expression",
      "evidence",
      "resources",
      "summary",
      "tensions",
      "title",
    ]);
    // Key names rather than substrings: `predicate_mismatch` is a legitimate
    // omission counter, and a substring ban on "match" would call it a leak.
    const keys = new Set<string>();
    const collect = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(collect);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value)) {
        keys.add(key);
        collect(nested);
      }
    };
    collect(result.body);
    for (const internal of [
      "object_hash", "match", "all_of", "any_of", "none_of", "prohibited_claims",
      "signature", "status", "requires_houses", "minimum_accuracy",
      "required_bodies", "required_aspects", "tags", "reviewer_notes",
    ]) {
      expect([...keys], `${internal} reached the client`).not.toContain(internal);
    }
  });

  it("keeps an intentional M3 rollback honest instead of serving draft fallback", async () => {
    await seedActiveRelease("release-m3-rollback");
    const result = await get();
    expect(result.response.status).toBe(503);
    expect(result.body.error?.code).toBe("pattern_release_not_active");
  });
});
