import {
  createExecutionContext,
  createScheduledController,
  env,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "./index.js";
import type { Env } from "./env.js";
import { IDENTITY_A, USER_A, resetDb, rows, seedUser } from "../test/helpers.js";
import { OPENAI_READING_MODEL } from "./services/reading-publisher.js";

function hybridEnv(db: D1Database = env.DB): Env {
  return {
    ...env,
    DB: db,
    READING_V5_ROLLOUT: "hybrid",
    READING_PUBLISHER: "openai",
    OPENAI_READING_MODEL,
    OPENAI_READING_REASONING: "high",
    OPENAI_READING_PROMPT_VERSION: "1.0.1",
    OPENAI_READING_TIMEOUT_MS: "90000",
    OPENAI_READING_MAX_OUTPUT_TOKENS: "4000",
    READING_CONTEXT_MAX_BYTES: "98304",
    READING_PREGEN_ACTIVE_DAYS: "30",
    READING_PREGEN_LEAD_MINUTES: "30",
    READING_PREGEN_SPREAD_MINUTES: "45",
    READING_SCHEDULER_BATCH_LIMIT: "100",
    READING_DAILY_PROVIDER_CALL_LIMIT: "250",
    OPENAI_API_KEY: "sk-test-key",
  };
}

beforeEach(resetDb);

describe("scheduled Worker entry point", () => {
  it("exports scheduled beside the incumbent fetch and queue handlers", () => {
    expect(worker.fetch).toBeTypeOf("function");
    expect(worker.queue).toBeTypeOf("function");
    expect(worker.scheduled).toBeTypeOf("function");
  });

  it("uses ScheduledController.scheduledTime as the scheduler clock", async () => {
    await env.DB.prepare(
      `INSERT INTO users
         (id, crypto_subject, status, locale, timezone, entitlement_tier,
          next_due_at, created_at, updated_at)
       VALUES ('usr_scheduled_clock', 'cs_scheduled_clock', 'active', 'en-US',
               'UTC', 'free', NULL, '2031-01-01T00:00:00.000Z',
               '2031-01-01T00:00:00.000Z')`,
    ).run();
    const scheduledTime = Date.parse("2031-01-02T12:00:00.000Z");
    const controller = createScheduledController({
      scheduledTime,
      cron: "*/15 * * * *",
    });
    const ctx = createExecutionContext();

    await worker.scheduled(controller, hybridEnv(), ctx);

    const [row] = await rows<{ next_due_at: string | null }>(
      "SELECT next_due_at FROM users WHERE id = 'usr_scheduled_clock'",
    );
    expect(Date.parse(row!.next_due_at!)).toBeGreaterThan(Date.parse("2031-01-01T00:00:00.000Z"));
  });

  it("checks secure configuration before the first scheduler query", async () => {
    const prepare = vi.fn(() => {
      throw new Error("scheduler queried before configuration was checked");
    });
    const guardedDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === "prepare") return prepare;
        return Reflect.get(target, property, receiver);
      },
    }) as D1Database;
    const controller = createScheduledController({
      scheduledTime: Date.parse("2031-01-02T12:00:00.000Z"),
      cron: "*/15 * * * *",
    });
    const ctx = createExecutionContext();
    const invalid = {
      ...hybridEnv(guardedDb),
      READING_PUBLISHER: undefined,
    };

    await expect(worker.scheduled(controller, invalid, ctx)).resolves.toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("redrives an undispatched privacy outbox job on the scheduled clock", async () => {
    await seedUser(IDENTITY_A);
    await rows("UPDATE users SET status = 'frozen' WHERE id = ?", USER_A);
    await rows(
      `INSERT INTO jobs
         (id, job_type, user_id, idempotency_key, status, attempts, created_at)
       VALUES ('job_scheduled_export', 'export_account', ?, 'idem-scheduled-export',
               'queued', 0, '2031-01-01T00:00:00.000Z')`,
      USER_A,
    );
    const send = vi.fn(async () => undefined);
    const privacyQueue = { send } as unknown as Queue;
    const scheduledTime = Date.parse("2031-01-02T12:00:00.000Z");

    await worker.scheduled(
      createScheduledController({ scheduledTime, cron: "*/15 * * * *" }),
      { ...hybridEnv(), PRIVACY_QUEUE: privacyQueue },
      createExecutionContext(),
    );

    expect(send).toHaveBeenCalledWith({
      kind: "privacy",
      job_id: "job_scheduled_export",
      job_type: "export_account",
    });
    expect(
      await rows("SELECT dispatched_at FROM jobs WHERE id = 'job_scheduled_export'"),
    ).toEqual([{ dispatched_at: "2031-01-02T12:00:00.000Z" }]);
  });

  it("attempts privacy maintenance even when the reading lane fails", async () => {
    await seedUser(IDENTITY_A);
    await rows("UPDATE users SET status = 'frozen' WHERE id = ?", USER_A);
    await rows(
      `INSERT INTO jobs
         (id, job_type, user_id, idempotency_key, status, attempts, created_at)
       VALUES ('job_scheduled_after_failure', 'export_account', ?,
               'idem-scheduled-after-failure', 'queued', 0,
               '2031-01-01T00:00:00.000Z')`,
      USER_A,
    );
    let readingLaneFailed = false;
    const db = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (query: string) => {
            if (!readingLaneFailed) {
              readingLaneFailed = true;
              throw new Error("reading lane unavailable");
            }
            return target.prepare(query);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as D1Database;
    const send = vi.fn(async () => undefined);
    const scheduledTime = Date.parse("2031-01-02T12:00:00.000Z");

    await expect(
      worker.scheduled(
        createScheduledController({ scheduledTime, cron: "*/15 * * * *" }),
        {
          ...hybridEnv(db),
          PRIVACY_QUEUE: { send } as unknown as Queue,
        },
        createExecutionContext(),
      ),
    ).rejects.toThrow("reading lane unavailable");

    expect(send).toHaveBeenCalledWith({
      kind: "privacy",
      job_id: "job_scheduled_after_failure",
      job_type: "export_account",
    });
  });
});
