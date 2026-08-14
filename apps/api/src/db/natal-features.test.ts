import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { IDENTITY_A, IDENTITY_B, resetDb, rows, seedChart, seedUser } from "../../test/helpers.js";
import { ensureNatalFeatureSet } from "./natal-features.js";

describe("natal feature completion receipts", () => {
  beforeEach(resetDb);

  it("atomically caches a complete set and replays it idempotently", async () => {
    await seedUser(IDENTITY_A);
    const chart = await seedChart(IDENTITY_A);
    const first = await ensureNatalFeatureSet(env, IDENTITY_A.userId, chart.chartId);
    const replay = await ensureNatalFeatureSet(env, IDENTITY_A.userId, chart.chartId);

    expect(replay).toEqual(first);
    expect(await rows("SELECT id FROM natal_feature_sets WHERE user_id = ?", IDENTITY_A.userId))
      .toHaveLength(1);
    expect(await rows("SELECT id FROM natal_features WHERE user_id = ?", IDENTITY_A.userId))
      .toHaveLength(first.features.length);
  });

  it("allows equal deterministic IDs for two owners without selecting across them", async () => {
    await seedUser(IDENTITY_A);
    await seedUser(IDENTITY_B);
    const a = await seedChart(IDENTITY_A, { fingerprint: `sha256:${"7d".repeat(32)}` });
    const b = await seedChart(IDENTITY_B, { fingerprint: `sha256:${"7d".repeat(32)}` });

    const aSet = await ensureNatalFeatureSet(env, IDENTITY_A.userId, a.chartId);
    const bSet = await ensureNatalFeatureSet(env, IDENTITY_B.userId, b.chartId);
    expect(bSet.featureSetHash).toBe(aSet.featureSetHash);
    expect(bSet.features.map((feature) => feature.feature_id))
      .toEqual(aSet.features.map((feature) => feature.feature_id));
    expect(await rows("SELECT user_id FROM natal_features ORDER BY user_id"))
      .toHaveLength(aSet.features.length + bSet.features.length);
  });

  it("fails closed when a receipted set has missing rows", async () => {
    await seedUser(IDENTITY_A);
    const chart = await seedChart(IDENTITY_A);
    const set = await ensureNatalFeatureSet(env, IDENTITY_A.userId, chart.chartId);
    await env.DB.prepare(
      "DELETE FROM natal_features WHERE user_id = ? AND chart_id = ? AND id = ?",
    ).bind(IDENTITY_A.userId, chart.chartId, set.features[0]!.feature_id).run();

    await expect(ensureNatalFeatureSet(env, IDENTITY_A.userId, chart.chartId))
      .rejects.toThrow("completion receipt does not match");
  });
});
