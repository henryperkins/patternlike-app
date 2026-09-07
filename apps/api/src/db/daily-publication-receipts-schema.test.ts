import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildDailyPublicationReceiptInsert, type DailyPublicationReceiptInput } from "./daily-publication-receipts.js";

const columns = ["receipt_id", "reading_id", "job_id", "command_generation", "provider", "provider_job_id",
  "stage_generation", "stage_attempt", "model", "reasoning_effort", "prompt_version", "request_hash",
  "response_hash", "input_tokens", "output_tokens", "provider_completed_at", "worker_version_id", "release_git_sha", "published_at"];

function receipt(effort: "high" | "xhigh"): DailyPublicationReceiptInput {
  return {
    readingId: `reading_${effort}`, jobId: `job_${effort}`, commandGeneration: 1,
    providerJobId: `cpjob_${"a".repeat(32)}`, stageGeneration: 1, stageAttempt: 0,
    model: "gpt-5.6-sol", reasoningEffort: effort, promptVersion: "1.0.3",
    requestHash: `sha256:${"a".repeat(64)}`, responseHash: `sha256:${"b".repeat(64)}`,
    inputTokens: 42, outputTokens: 10, providerCompletedAt: "2026-09-07T00:00:00Z",
    workerVersionId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", releaseGitSha: "a".repeat(40),
  };
}

describe.each(["fresh", "populated 0028 upgrade"])("0029 %s", (lane) => {
  const db = lane === "fresh" ? env.DB : env.MIGRATION_UPGRADE_DB;
  it("creates exactly the technical allowlist, indexes, and no foreign keys", async () => {
    expect((await db.prepare("PRAGMA table_info(daily_publication_receipts)").all<{ name: string }>()).results.map(row => row.name)).toEqual(columns);
    expect(columns).not.toContain("user_id");
    expect((await db.prepare("PRAGMA foreign_key_list(daily_publication_receipts)").all()).results).toEqual([]);
    expect((await db.prepare("PRAGMA index_list(daily_publication_receipts)").all<{ name: string }>()).results
      .map(row => row.name).filter(name => !name.startsWith("sqlite_")).sort())
      .toEqual(["idx_daily_publication_receipts_job", "idx_daily_publication_receipts_release"]);
    for (const [name, fields] of [
      ["idx_daily_publication_receipts_job", ["job_id"]],
      ["idx_daily_publication_receipts_release", ["release_git_sha", "published_at", "receipt_id"]],
    ] as const) {
      expect((await db.prepare(`PRAGMA index_info(${name})`).all<{ name: string }>()).results.map(row => row.name)).toEqual(fields);
    }
  });

  it("accepts high and xhigh but refuses other effort and malformed UUIDs", async () => {
    for (const effort of ["high", "xhigh"] as const) {
      await buildDailyPublicationReceiptInsert({ DB: db }, receipt(effort), "2026-09-07T00:00:01Z").run();
    }
    for (const effort of ["low", "medium", "", "XHIGH"]) {
      await expect(buildDailyPublicationReceiptInsert({ DB: db }, {
        ...receipt("high"), readingId: `invalid_${effort}`, reasoningEffort: effort as "high",
      }, "2026-09-07T00:00:01Z").run()).rejects.toThrow();
    }
    for (const id of ["aaaaaaaa-bbbbb-cccc-dddd-eeeeeeeeeee", "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1fZ"]) {
      await expect(buildDailyPublicationReceiptInsert({ DB: db }, {
        ...receipt("high"), readingId: "invalid_uuid", workerVersionId: id,
      }, "2026-09-07T00:00:01Z").run()).rejects.toThrow();
    }
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect((await db.prepare("PRAGMA quick_check").all()).results).toEqual([{ quick_check: "ok" }]);
    expect((await db.prepare("SELECT * FROM assertion_probe").all()).results).toEqual([]);
  });
});
