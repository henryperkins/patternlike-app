import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  IDENTITY_A,
  READING_CODEX_PUBLISHER_VARS,
  USER_A,
  confirmPreferences,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import { AI_SYNTHESIS_POLICY_VERSION } from "../db/consents.js";
import { claimJob } from "../db/generation.js";
import type { CodexProviderJob } from "../db/codex-provider-jobs.js";
import { enqueueConstrainedReading, resolveV5TargetDate } from "./enqueue.js";
import { codexProviderOwnerIsCurrent } from "./codex-provider-domain.js";
import {
  OPENAI_READING_MODEL,
  OPENAI_READING_REASONING,
  READING_PROMPT_VERSION,
} from "./reading-publisher.js";

/**
 * The shared owner dispatcher.
 *
 * Three pipelines share one claim route, one terminal route, and one
 * maintenance sweep, so the dispatcher is the single place where "is this work
 * still wanted?" could quietly answer for the wrong domain. A reading job
 * evaluated against the ontology predicate would be admitted or cancelled on
 * evidence about a completely different run.
 */

const ZONE = "America/Chicago";

function enabledEnv(overrides: Partial<typeof env> = {}): typeof env {
  return {
    ...env,
    READING_V5_ROLLOUT: "hybrid",
    ...READING_CODEX_PUBLISHER_VARS,
    ...overrides,
  };
}

function providerJob(
  overrides: Partial<CodexProviderJob> & { ownerId: string },
): CodexProviderJob {
  const id = `cpjob_${"9".repeat(32)}`;
  return {
    id,
    pipeline: "reading",
    userId: USER_A,
    pass: "publisher",
    stageGeneration: 1,
    stageAttempt: 0,
    request: {
      objectKey: `codex-provider-jobs/${id}/request.json.enc`,
      plaintextHash: `sha256:${"1".repeat(64)}`,
      envelopeHash: `sha256:${"2".repeat(64)}`,
      ciphertextHash: `sha256:${"3".repeat(64)}`,
      keyId: "codex-test-key",
      nonce: "AAAAAAAAAAAAAAAA",
      byteLength: 1024,
    },
    response: null,
    model: OPENAI_READING_MODEL,
    reasoningEffort: OPENAI_READING_REASONING,
    promptVersion: READING_PROMPT_VERSION,
    timeoutMs: 900_000,
    dailyCallLimit: 250,
    status: "pending",
    leaseExpiresAt: null,
    providerRequestId: null,
    inputTokens: null,
    outputTokens: null,
    failureCode: null,
    safeDetailCode: null,
    availableAt: "2026-08-27T00:00:00.000Z",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

async function reserveClaimedDaily(): Promise<string> {
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A, ZONE);
  await seedChart(IDENTITY_A);
  const now = "2026-08-27T00:00:00.000Z";
  await rows(
    `INSERT INTO consents (id, user_id, kind, status, policy_version,
       allowed_uses_json, scopes_json, version, granted_at, created_at, updated_at)
     VALUES ('cns_domain_ai_0001', ?, 'ai_synthesis', 'granted', ?, '[]', '[]', 1, ?, ?, ?)`,
    USER_A,
    AI_SYNTHESIS_POLICY_VERSION,
    now,
    now,
    now,
  );
  const targetLocalDate = resolveV5TargetDate(ZONE, new Date());
  if (!targetLocalDate) throw new Error("test date did not resolve");
  const enqueued = await enqueueConstrainedReading(enabledEnv(), USER_A, {
    entry: "internal",
    reservationReason: "internal",
    targetLocalDate,
  });
  if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
  if (!await claimJob(enabledEnv(), enqueued.jobId)) {
    throw new Error("job did not claim");
  }
  return enqueued.jobId;
}

describe("the shared Codex provider owner dispatcher", () => {
  beforeEach(resetDb);

  it("routes a reading job to the Daily predicate", async () => {
    const jobId = await reserveClaimedDaily();
    expect(
      await codexProviderOwnerIsCurrent(enabledEnv(), providerJob({ ownerId: jobId })),
    ).toBe(true);
  });

  it("refuses a reading job whose owner id names no Daily job at all", async () => {
    await reserveClaimedDaily();
    // The ontology branch would look this id up in
    // pattern_ontology_pipeline_runs and answer about a different table
    // entirely. Falling through to it is the bug this asserts against.
    expect(
      await codexProviderOwnerIsCurrent(
        enabledEnv(),
        providerJob({ ownerId: "oprun_not_a_daily_job" }),
      ),
    ).toBe(false);
  });

  it("refuses a live Daily owner presented under another pipeline", async () => {
    const jobId = await reserveClaimedDaily();
    const current = enabledEnv();
    // The owner exists and is current, but the coordinate claims to be Pattern
    // or ontology work. Neither domain has a row for it, and admitting it would
    // charge the wrong ledger and nudge the wrong queue.
    expect(
      await codexProviderOwnerIsCurrent(
        current,
        providerJob({ ownerId: jobId, pipeline: "pattern", pass: "writer" }),
      ),
    ).toBe(false);
    expect(
      await codexProviderOwnerIsCurrent(
        current,
        providerJob({
          ownerId: jobId,
          pipeline: "ontology",
          pass: "generator",
          userId: null,
        }),
      ),
    ).toBe(false);
  });

  it("refuses a reading coordinate carrying a pass the pipeline does not own", async () => {
    const jobId = await reserveClaimedDaily();
    for (const pass of ["planner", "writer", "verifier", "generator", "evaluator"] as const) {
      expect(
        await codexProviderOwnerIsCurrent(
          enabledEnv(),
          providerJob({ ownerId: jobId, pass }),
        ),
      ).toBe(false);
    }
  });
});
