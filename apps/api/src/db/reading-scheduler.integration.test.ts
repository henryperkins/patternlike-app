import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asCryptoSubject, fromB64 } from "../crypto.js";
import {
  AI_SYNTHESIS_POLICY_VERSION,
  refreshReadingCursorAfterAiConsentChange,
} from "./consents.js";
import { linkIdentity } from "./identities.js";
import {
  D1_MAX_BOUND_PARAMETERS,
  excludedBudget,
  findExpiredSchedulerCandidates,
  findStalePublishedCandidates,
  invalidatedOrphanDiscoverySql,
  INVALIDATED_ORPHAN_BACKOFF_MS,
} from "./reading-scheduler.js";
import { createSession, touchSessionActivity } from "./sessions.js";
import {
  setContentLocale,
  setSchedulingTimezone,
} from "./preferences.js";
import { encryptPayload, type UserIdentity } from "./users.js";
import {
  ALICE,
  IDENTITY_A,
  USER_A,
  postBirthProfile,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  enqueueConstrainedReading,
  resolveV5TargetDate,
} from "../services/enqueue.js";
import { runReadingScheduler } from "../services/run-reading-scheduler.js";
import { OPENAI_READING_MODEL } from "../services/reading-publisher.js";
import type { StoredReadingV5 } from "../services/stored-reading.js";
import type { Env } from "../env.js";

const SCHEDULED_AT = new Date("2026-08-11T15:00:00.000Z");
const OLD = "2026-08-01T00:00:00.000Z";
const FUTURE = "2026-08-20T00:00:00.000Z";
const ZONE = "America/Chicago";
const HEX64 = "b".repeat(64);

function identity(index: number): UserIdentity {
  const suffix = String(index).padStart(5, "0");
  return {
    userId: `usr_scheduler_${suffix}`,
    cryptoSubject: asCryptoSubject(`cs_scheduler_${suffix}`),
  };
}

function hybridEnv(queueSend = vi.fn().mockResolvedValue(undefined)): Env {
  return {
    ...env,
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
    READING_QUEUE: { send: queueSend } as unknown as Queue,
  };
}

async function grantAi(identityValue: UserIdentity, at = SCHEDULED_AT): Promise<void> {
  const iso = at.toISOString();
  await env.DB.prepare(
    `INSERT INTO consents
       (id, user_id, kind, status, policy_version, allowed_uses_json,
        scopes_json, version, granted_at, created_at, updated_at)
     VALUES (?, ?, 'ai_synthesis', 'granted', ?, '[]', '[]', 1, ?, ?, ?)`,
  )
    .bind(
      `cns_scheduler_${identityValue.userId.slice(-5)}`,
      identityValue.userId,
      AI_SYNTHESIS_POLICY_VERSION,
      iso,
      iso,
      iso,
    )
    .run();
}

async function seedRecentSession(
  identityValue: UserIdentity,
  options: { revoked?: boolean; lastSeenAt?: string } = {},
): Promise<void> {
  const createdAt = options.lastSeenAt ?? SCHEDULED_AT.toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions
       (id, user_id, token_sha256, created_at, expires_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `ses_scheduler_${identityValue.userId.slice(-5)}`,
      identityValue.userId,
      `hash_scheduler_${identityValue.userId.slice(-5)}`,
      createdAt,
      "2026-09-11T15:00:00.000Z",
      options.lastSeenAt ?? createdAt,
      options.revoked ? SCHEDULED_AT.toISOString() : null,
    )
    .run();
}

async function seedSchedulerAccount(
  identityValue: UserIdentity,
  options: {
    chart?: boolean;
    timezone?: boolean;
    locale?: boolean;
    consent?: boolean;
    session?: "recent" | "old" | "revoked" | "none";
    nextDueAt?: string | null;
  } = {},
): Promise<void> {
  await seedUser(identityValue);
  const timezone = options.timezone ?? true;
  const locale = options.locale ?? true;
  const now = SCHEDULED_AT.toISOString();
  await env.DB.prepare(
    `UPDATE users
     SET timezone = ?, timezone_source = ?, timezone_revision = ?, timezone_updated_at = ?,
         locale = ?, locale_source = ?, locale_updated_at = ?, next_due_at = ?
     WHERE id = ?`,
  )
    .bind(
      ZONE,
      timezone ? "user_confirmed" : "default_unconfirmed",
      timezone ? 1 : 0,
      timezone ? now : null,
      "en-US",
      locale ? "user_confirmed" : "default_unconfirmed",
      locale ? now : null,
      options.nextDueAt === undefined ? OLD : options.nextDueAt,
      identityValue.userId,
    )
    .run();
  if (options.chart ?? true) await seedChart(identityValue);
  if (options.consent ?? true) await grantAi(identityValue);
  const session = options.session ?? "recent";
  if (session === "recent") await seedRecentSession(identityValue);
  if (session === "old") {
    await seedRecentSession(identityValue, { lastSeenAt: "2026-06-01T00:00:00.000Z" });
  }
  if (session === "revoked") await seedRecentSession(identityValue, { revoked: true });
}

function storedReading(
  readingId: string,
  invalidated: boolean,
  localDate = "2026-08-11",
): StoredReadingV5 {
  return {
    schema_version: "0.5.0",
    reading: {
      schema_version: "0.5.0",
      output_schema: "daily-reading-v5",
      reading_id: readingId,
      local_date: localDate,
      generated_at: "2026-08-11T13:00:00.000Z",
      assembly_mode: "constrained_model",
      revision: 1,
      locale: "en-US",
      domain_preference: null,
      headline: "A narrower commitment",
      disclosure: "Generated with OpenAI from your calculated chart and enabled context.",
      paragraphs: [
        {
          paragraph_id: `par_${readingId}`,
          role: "primary_theme",
          order: 1,
          text: "The pressure asks for a smaller promise.",
        },
      ],
    },
    evidence_header: {
      schema_version: "0.5.0",
      reading_id: readingId,
      revision: 1,
      revision_reason: "initial",
      generated_at: "2026-08-11T13:00:00.000Z",
      generation_input_id: `gin_sha256_${HEX64}`,
      input_manifest_hash: `sha256:${HEX64}`,
      content_hash: `sha256:${HEX64}`,
      provider_response_hash: `sha256:${HEX64}`,
      calculation: {
        chart_contract_id: "calc-contract-launch",
        cycle_policy_version: "1.4.0",
        daily_sky_policy_version: "1.0.0",
        ephemeris_data_version: "swisseph-2.10.03",
        container_digest: `sha256:${HEX64}`,
        tzdb_version: "2026a",
        local_day_resolution_policy_version: "1.0.0",
      },
      model: {
        provider: "openai",
        model: OPENAI_READING_MODEL,
        prompt_version: "1.0.1",
        selection_policy_version: "1.0.0",
        validation_policy_version: "1.0.0",
        provider_request_id: `resp_${readingId}`,
        input_tokens: 100,
        output_tokens: 50,
      },
      validation: {
        status: "passed",
        policy_version: "1.0.0",
        checks: [{ code: "grounding", passed: true }],
      },
    },
    invalidation: invalidated
      ? {
          reason: "calculation_defect",
          actor_class: "operator",
          invalidated_at: "2026-08-11T07:00:00.000Z",
        }
      : null,
  };
}

async function seedFactualArtifact(
  identityValue: UserIdentity,
  status: "published" | "invalidated",
  fingerprint: string,
  options: {
    localDate?: string;
    suffix?: string;
    updatedAt?: string;
  } = {},
): Promise<string> {
  const localDate = options.localDate ?? "2026-08-11";
  const readingId = `rdg_${status}_${identityValue.userId.slice(-5)}${options.suffix ?? ""}`;
  const sealed = await encryptPayload(
    env,
    identityValue,
    storedReading(readingId, status === "invalidated", localDate),
    {
      subject: identityValue.cryptoSubject,
      field: "daily_readings.reading_enc",
      recordId: readingId,
    },
  );
  const updatedAt = options.updatedAt ?? (status === "invalidated"
    ? new Date(SCHEDULED_AT.getTime() - 7 * 60 * 60 * 1000).toISOString()
    : SCHEDULED_AT.toISOString());
  await env.DB.prepare(
    `INSERT INTO daily_readings
       (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
        contract_id, assembly_mode, status, revision, revision_reason,
        supersedes_reading_id, command_generation, invalidated_at,
        reading_enc, reading_key_version, reading_nonce, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, 'calc-contract-launch',
             'constrained_model', ?, 1, 'initial', NULL, 1, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      readingId,
      identityValue.userId,
      localDate,
      `reading-v5:${identityValue.userId}:${localDate}:r1`,
      fingerprint,
      status,
      status === "invalidated" ? "2026-08-11T07:00:00.000Z" : null,
      fromB64(sealed.ciphertext),
      sealed.keyVersion,
      sealed.nonce,
      updatedAt,
      updatedAt,
    )
    .run();
  return readingId;
}

beforeEach(resetDb);

describe("scheduler eligibility and cursor lifecycle", () => {
  it("reserves only for an active chart, confirmed preferences, AI consent, and recent live session", async () => {
    const accounts = [identity(1), identity(2), identity(3), identity(4), identity(5), identity(6)];
    await seedSchedulerAccount(accounts[0]!);
    await seedSchedulerAccount(accounts[1]!, { chart: false });
    await seedSchedulerAccount(accounts[2]!, { timezone: false });
    await seedSchedulerAccount(accounts[3]!, { locale: false });
    await seedSchedulerAccount(accounts[4]!, { consent: false });
    await seedSchedulerAccount(accounts[5]!, { session: "old" });

    const summary = await runReadingScheduler(hybridEnv(), SCHEDULED_AT);
    const reserved = await rows<{ user_id: string }>(
      "SELECT user_id FROM daily_readings WHERE status = 'pending'",
    );
    const cursors = await rows<{ id: string; next_due_at: string | null }>(
      "SELECT id, next_due_at FROM users ORDER BY id",
    );

    expect(summary.due.evaluated).toBe(6);
    expect(reserved).toEqual([{ user_id: accounts[0]!.userId }]);
    expect(cursors.every((row) => row.next_due_at !== null && row.next_due_at !== OLD)).toBe(true);
  });

  it("seeds active null cursors with the remaining quota without reserving prose", async () => {
    await seedSchedulerAccount(identity(10), { nextDueAt: null, chart: false });
    await seedSchedulerAccount(identity(11), { nextDueAt: null, chart: false });
    await seedSchedulerAccount(identity(12), { nextDueAt: null, chart: false });
    await seedSchedulerAccount(identity(13), { nextDueAt: null, chart: false });
    await env.DB.prepare("UPDATE users SET status = 'frozen' WHERE id = ?")
      .bind(identity(13).userId)
      .run();

    const summary = await runReadingScheduler(hybridEnv(), SCHEDULED_AT);
    const cursorRows = await rows<{ id: string; next_due_at: string | null }>(
      "SELECT id, next_due_at FROM users ORDER BY id",
    );

    expect(summary.nullSeed.seeded).toBe(3);
    expect(await rows("SELECT id FROM daily_readings")).toEqual([]);
    expect(cursorRows.filter((row) => row.id !== identity(13).userId).every((row) => row.next_due_at)).toBe(true);
    expect(cursorRows.find((row) => row.id === identity(13).userId)?.next_due_at).toBeNull();
  });

  it("maintains cursors after account, preference, consent, chart, and throttled session activity changes", async () => {
    const linked = await linkIdentity(hybridEnv(), "https://issuer.example.com", "subject-scheduler");
    expect((await rows<{ next_due_at: string }>("SELECT next_due_at FROM users WHERE id = ?", linked.userId))[0]?.next_due_at).toBeTruthy();

    await env.DB.prepare("UPDATE users SET next_due_at = NULL WHERE id = ?").bind(linked.userId).run();
    await setSchedulingTimezone(hybridEnv(), linked.userId, ZONE, "user_confirmed");
    expect((await rows<{ next_due_at: string }>("SELECT next_due_at FROM users WHERE id = ?", linked.userId))[0]?.next_due_at).toBeTruthy();

    await env.DB.prepare("UPDATE users SET next_due_at = NULL WHERE id = ?").bind(linked.userId).run();
    await setContentLocale(hybridEnv(), linked.userId, "en-US", "user_confirmed");
    expect((await rows<{ next_due_at: string }>("SELECT next_due_at FROM users WHERE id = ?", linked.userId))[0]?.next_due_at).toBeTruthy();

    await env.DB.prepare("UPDATE users SET next_due_at = NULL WHERE id = ?").bind(linked.userId).run();
    await refreshReadingCursorAfterAiConsentChange(hybridEnv(), linked.userId, SCHEDULED_AT);
    expect((await rows<{ next_due_at: string }>("SELECT next_due_at FROM users WHERE id = ?", linked.userId))[0]?.next_due_at).toBeTruthy();

    const session = await createSession(hybridEnv(), linked.userId, new Date("2026-08-11T10:00:00.000Z"));
    const sessionRow = await rows<{ id: string }>("SELECT id FROM sessions WHERE token_sha256 IS NOT NULL AND user_id = ?", linked.userId);
    expect(session.token).toBeTruthy();
    await env.DB.prepare("UPDATE users SET next_due_at = NULL WHERE id = ?").bind(linked.userId).run();
    expect(await touchSessionActivity(hybridEnv(), sessionRow[0]!.id, linked.userId, new Date("2026-08-11T10:30:00.000Z"))).toBe(false);
    expect((await rows<{ next_due_at: string | null }>("SELECT next_due_at FROM users WHERE id = ?", linked.userId))[0]?.next_due_at).toBeNull();
    expect(await touchSessionActivity(hybridEnv(), sessionRow[0]!.id, linked.userId, new Date("2026-08-11T11:01:00.000Z"))).toBe(true);
    expect((await rows<{ next_due_at: string }>("SELECT next_due_at FROM users WHERE id = ?", linked.userId))[0]?.next_due_at).toBeTruthy();

    await seedUser(IDENTITY_A);
    await env.DB.prepare("UPDATE users SET next_due_at = NULL WHERE id = ?").bind(USER_A).run();
    const birth = await postBirthProfile(USER_A, "idem-scheduler-chart-activation", ALICE);
    expect(birth.status).toBe(202);
    expect((await rows<{ next_due_at: string }>("SELECT next_due_at FROM users WHERE id = ?", USER_A))[0]?.next_due_at).toBeTruthy();
  });
});

describe("bounded ordered repair", () => {
  it("discovers a failed generation after next_due_at already advanced and installs only g2", async () => {
    const account = identity(20);
    await seedSchedulerAccount(account, { nextDueAt: FUTURE });
    const envValue = hybridEnv();
    const localDate = resolveV5TargetDate(ZONE, SCHEDULED_AT)!;
    const reserved = await enqueueConstrainedReading(envValue, account.userId, {
      entry: "scheduled",
      reservationReason: "scheduled",
      targetLocalDate: localDate,
      now: SCHEDULED_AT,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE daily_readings SET status = 'failed', updated_at = ? WHERE id = ?",
      ).bind("2026-08-11T08:00:00.000Z", reserved.readingId),
      env.DB.prepare(
        `UPDATE jobs SET status = 'failed', result_class = 'calc_unavailable',
                         finished_at = ? WHERE id = ?`,
      ).bind("2026-08-11T08:00:00.000Z", reserved.jobId),
    ]);

    const summary = await runReadingScheduler(envValue, SCHEDULED_AT);
    const [reading] = await rows<{ status: string; command_generation: number }>(
      "SELECT status, command_generation FROM daily_readings WHERE id = ?",
      reserved.readingId,
    );

    expect(summary.repair.failedReplacements).toBe(1);
    expect(reading).toEqual({ status: "pending", command_generation: 2 });
  });

  it("repairs a pre-generated next-local-day V2 failure", async () => {
    const account = identity(21);
    await seedSchedulerAccount(account, { nextDueAt: FUTURE });
    const envValue = hybridEnv();
    const currentLocalDate = resolveV5TargetDate(ZONE, SCHEDULED_AT)!;
    const nextLocalDate = new Date(`${currentLocalDate}T12:00:00.000Z`);
    nextLocalDate.setUTCDate(nextLocalDate.getUTCDate() + 1);
    const reserved = await enqueueConstrainedReading(envValue, account.userId, {
      entry: "scheduled",
      reservationReason: "scheduled",
      targetLocalDate: nextLocalDate.toISOString().slice(0, 10),
      now: SCHEDULED_AT,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE daily_readings SET status = 'failed', updated_at = ? WHERE id = ?",
      ).bind("2026-08-11T08:00:00.000Z", reserved.readingId),
      env.DB.prepare(
        `UPDATE jobs SET status = 'failed', result_class = 'publisher_unavailable',
                         finished_at = ? WHERE id = ?`,
      ).bind("2026-08-11T08:00:00.000Z", reserved.jobId),
    ]);

    const summary = await runReadingScheduler(envValue, SCHEDULED_AT);

    expect(summary.repair.failedReplacements).toBe(1);
    expect(
      await rows<{ command_generation: number; status: string }>(
        "SELECT command_generation, status FROM daily_readings WHERE id = ?",
        reserved.readingId,
      ),
    ).toEqual([{ command_generation: 2, status: "pending" }]);
  });

  it("does not let an older nonreplaceable failure hide a later replaceable failure", async () => {
    const account = identity(22);
    await seedSchedulerAccount(account, { nextDueAt: FUTURE });
    const envValue = hybridEnv();
    const currentLocalDate = resolveV5TargetDate(ZONE, SCHEDULED_AT)!;
    const nextDate = new Date(`${currentLocalDate}T12:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const terminal = await enqueueConstrainedReading(envValue, account.userId, {
      entry: "scheduled",
      reservationReason: "scheduled",
      targetLocalDate: currentLocalDate,
      now: SCHEDULED_AT,
    });
    const replaceable = await enqueueConstrainedReading(envValue, account.userId, {
      entry: "scheduled",
      reservationReason: "scheduled",
      targetLocalDate: nextDate.toISOString().slice(0, 10),
      now: SCHEDULED_AT,
    });
    expect(terminal.ok && replaceable.ok).toBe(true);
    if (!terminal.ok || !replaceable.ok) return;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE daily_readings SET status = 'failed', updated_at = ? WHERE id = ?",
      ).bind("2026-08-11T07:00:00.000Z", terminal.readingId),
      env.DB.prepare(
        "UPDATE jobs SET status = 'failed', result_class = 'publisher_auth_failed' WHERE id = ?",
      ).bind(terminal.jobId),
      env.DB.prepare(
        "UPDATE daily_readings SET status = 'failed', updated_at = ? WHERE id = ?",
      ).bind("2026-08-11T08:00:00.000Z", replaceable.readingId),
      env.DB.prepare(
        "UPDATE jobs SET status = 'failed', result_class = 'publisher_unavailable' WHERE id = ?",
      ).bind(replaceable.jobId),
    ]);

    const summary = await runReadingScheduler(envValue, SCHEDULED_AT);

    expect(summary.repair.failedReplacements).toBe(1);
    expect(
      await rows<{ id: string; command_generation: number; status: string }>(
        `SELECT id, command_generation, status FROM daily_readings
         WHERE id IN (?, ?) ORDER BY id`,
        terminal.readingId,
        replaceable.readingId,
      ),
    ).toEqual([
      { id: replaceable.readingId, command_generation: 2, status: "pending" },
      { id: terminal.readingId, command_generation: 1, status: "failed" },
    ].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("does not let a prior-day stale row hide the same user's current-day stale row", async () => {
    const account = identity(23);
    await seedSchedulerAccount(account, { nextDueAt: FUTURE });
    const prior = await seedFactualArtifact(
      account,
      "published",
      `sha256:${"2b".repeat(32)}`,
      {
        localDate: "2026-08-10",
        suffix: "_prior",
        updatedAt: "2026-08-10T07:00:00.000Z",
      },
    );
    const current = await seedFactualArtifact(
      account,
      "published",
      `sha256:${"2b".repeat(32)}`,
      { suffix: "_current", updatedAt: "2026-08-11T08:00:00.000Z" },
    );

    const summary = await runReadingScheduler(hybridEnv(), SCHEDULED_AT);

    expect(summary.repair.factRepairs).toBe(1);
    expect(
      await rows<{ id: string; status: string }>(
        "SELECT id, status FROM daily_readings WHERE id IN (?, ?) ORDER BY id",
        prior,
        current,
      ),
    ).toEqual([
      { id: current, status: "invalidated" },
      { id: prior, status: "published" },
    ].sort((a, b) => a.id.localeCompare(b.id)));
    expect(
      await rows<{ supersedes_reading_id: string }>(
        "SELECT supersedes_reading_id FROM daily_readings WHERE supersedes_reading_id = ?",
        current,
      ),
    ).toEqual([{ supersedes_reading_id: current }]);
  });

  it("applies the stale candidate limit after exact owner-local-date filtering", async () => {
    const priorOnly = identity(25);
    const current = identity(26);
    await seedSchedulerAccount(priorOnly, { nextDueAt: FUTURE });
    await seedSchedulerAccount(current, { nextDueAt: FUTURE });
    await seedFactualArtifact(
      priorOnly,
      "published",
      `sha256:${"2b".repeat(32)}`,
      {
        localDate: "2026-08-10",
        updatedAt: "2026-08-10T07:00:00.000Z",
      },
    );
    const currentReading = await seedFactualArtifact(
      current,
      "published",
      `sha256:${"2b".repeat(32)}`,
      { updatedAt: "2026-08-11T08:00:00.000Z" },
    );

    const candidates = await findStalePublishedCandidates(
      hybridEnv(),
      SCHEDULED_AT,
      1,
      new Set(),
    );

    expect(candidates).toEqual([{
      readingId: currentReading,
      userId: current.userId,
      localDate: "2026-08-11",
    }]);
  });

  it("does not let a prior-day orphan hide the same user's current-day orphan", async () => {
    const account = identity(24);
    await seedSchedulerAccount(account, { nextDueAt: FUTURE });
    const prior = await seedFactualArtifact(
      account,
      "invalidated",
      `sha256:${"1a".repeat(32)}`,
      {
        localDate: "2026-08-10",
        suffix: "_prior",
        updatedAt: "2026-08-10T07:00:00.000Z",
      },
    );
    const current = await seedFactualArtifact(
      account,
      "invalidated",
      `sha256:${"1a".repeat(32)}`,
      { suffix: "_current", updatedAt: "2026-08-11T08:00:00.000Z" },
    );

    const summary = await runReadingScheduler(hybridEnv(), SCHEDULED_AT);

    expect(summary.repair.factRepairs).toBe(1);
    expect(
      await rows<{ supersedes_reading_id: string }>(
        `SELECT supersedes_reading_id FROM daily_readings
         WHERE supersedes_reading_id IN (?, ?) ORDER BY supersedes_reading_id`,
        prior,
        current,
      ),
    ).toEqual([{ supersedes_reading_id: current }]);
  });

  it("recovers both chart-activation and invalidation/reservation crash boundaries", async () => {
    const stale = identity(30);
    const orphan = identity(31);
    await seedSchedulerAccount(stale, { nextDueAt: FUTURE });
    await seedSchedulerAccount(orphan, { nextDueAt: FUTURE });
    const staleReading = await seedFactualArtifact(stale, "published", `sha256:${"2b".repeat(32)}`);
    const invalidatedReading = await seedFactualArtifact(orphan, "invalidated", `sha256:${"1a".repeat(32)}`);

    const summary = await runReadingScheduler(hybridEnv(), SCHEDULED_AT);
    const predecessors = await rows<{ id: string; status: string }>(
      "SELECT id, status FROM daily_readings WHERE id IN (?, ?) ORDER BY id",
      staleReading,
      invalidatedReading,
    );
    const successors = await rows<{ supersedes_reading_id: string; status: string }>(
      `SELECT supersedes_reading_id, status FROM daily_readings
       WHERE supersedes_reading_id IN (?, ?) ORDER BY supersedes_reading_id`,
      staleReading,
      invalidatedReading,
    );

    expect(summary.repair.factRepairs).toBe(2);
    expect(predecessors.every((row) => row.status === "invalidated")).toBe(true);
    expect(successors).toEqual([
      { supersedes_reading_id: invalidatedReading, status: "pending" },
      { supersedes_reading_id: staleReading, status: "pending" },
    ].sort((a, b) => a.supersedes_reading_id.localeCompare(b.supersedes_reading_id)));
  });

  it("filters an ineligible orphan before decryption and backs it off for six hours", async () => {
    const account = identity(40);
    await seedSchedulerAccount(account, { consent: false, nextDueAt: FUTURE });
    const readingId = `rdg_backoff_${account.userId.slice(-5)}`;
    const oldUpdatedAt = new Date(SCHEDULED_AT.getTime() - 7 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO daily_readings
         (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
          contract_id, assembly_mode, status, revision, revision_reason,
          command_generation, invalidated_at, reading_enc, reading_key_version,
          reading_nonce, created_at, updated_at)
       VALUES (?, ?, '2026-08-11', NULL, ?, ?, 'calc-contract-launch',
               'constrained_model', 'invalidated', 1, 'initial', 1, ?, x'00', 1,
               'not-a-real-nonce', ?, ?)`,
    )
      .bind(
        readingId,
        account.userId,
        `reading-v5:${account.userId}:2026-08-11:r1`,
        `sha256:${"1a".repeat(32)}`,
        oldUpdatedAt,
        oldUpdatedAt,
        oldUpdatedAt,
      )
      .run();

    const first = await runReadingScheduler(hybridEnv(), SCHEDULED_AT);
    const [touched] = await rows<{ updated_at: string }>(
      "SELECT updated_at FROM daily_readings WHERE id = ?",
      readingId,
    );
    const second = await runReadingScheduler(
      hybridEnv(),
      new Date(SCHEDULED_AT.getTime() + INVALIDATED_ORPHAN_BACKOFF_MS - 1),
    );

    expect(first.repair.ineligibleOrphansBackedOff).toBe(1);
    expect(touched?.updated_at).toBe(SCHEDULED_AT.toISOString());
    expect(second.repair.ineligibleOrphansBackedOff).toBe(0);
    expect(await rows("SELECT id FROM daily_readings WHERE supersedes_reading_id = ?", readingId)).toEqual([]);
  });

  it("repairs an orphan invalidated moments ago, which the six-hour backoff used to hide", async () => {
    // The crash window this lane exists to converge: invalidation committed and
    // the r+1 reservation did not. Filtering on updated_at alone hid it for six
    // hours, by which time the owner's local day had rolled and the current-day
    // scoping excluded it permanently. A fresh orphan has never been backed off,
    // so its updated_at has not moved past its own invalidated_at.
    const account = identity(71);
    await seedSchedulerAccount(account);
    const readingId = await seedFactualArtifact(
      account,
      "invalidated",
      `sha256:${"7c".repeat(32)}`,
      { updatedAt: "2026-08-11T07:00:00.000Z" },
    );

    const summary = await runReadingScheduler(hybridEnv(), SCHEDULED_AT);

    expect(summary.repair.factRepairs).toBe(1);
    expect(
      await rows("SELECT id FROM daily_readings WHERE supersedes_reading_id = ?", readingId),
    ).not.toEqual([]);
  });

  it("invalidates and backs off an ineligible stale artifact without constructing repair prose", async () => {
    const account = identity(43);
    await seedSchedulerAccount(account, { consent: false });
    const readingId = await seedFactualArtifact(
      account,
      "published",
      `sha256:${"2b".repeat(32)}`,
      { updatedAt: "2026-08-11T07:00:00.000Z" },
    );

    const first = await runReadingScheduler(hybridEnv(), SCHEDULED_AT);
    const second = await runReadingScheduler(
      hybridEnv(),
      new Date(SCHEDULED_AT.getTime() + INVALIDATED_ORPHAN_BACKOFF_MS - 1),
    );

    expect(first.repair.ineligibleOrphansBackedOff).toBe(1);
    expect(first.due.evaluated).toBe(0);
    expect(second.repair.factRepairs).toBe(0);
    expect(second.repair.ineligibleOrphansBackedOff).toBe(0);
    expect(second.due.evaluated).toBe(1);
    expect(
      await rows<{ status: string; invalidated_at: string | null }>(
        "SELECT status, invalidated_at FROM daily_readings WHERE id = ?",
        readingId,
      ),
    ).toEqual([{
      status: "invalidated",
      invalidated_at: SCHEDULED_AT.toISOString(),
    }]);
    expect(await rows("SELECT id FROM jobs WHERE user_id = ?", account.userId)).toEqual([]);
    expect(
      await rows("SELECT id FROM daily_readings WHERE supersedes_reading_id = ?", readingId),
    ).toEqual([]);
  });

  it("does not spend repair quota on a historical factual orphan", async () => {
    const historical = identity(41);
    const due = identity(42);
    await seedSchedulerAccount(historical, { nextDueAt: FUTURE });
    await seedSchedulerAccount(due);
    const readingId = await seedFactualArtifact(
      historical,
      "invalidated",
      `sha256:${"1a".repeat(32)}`,
    );
    const historicalUpdatedAt = "2026-08-01T00:00:00.000Z";
    await env.DB.prepare(
      `UPDATE daily_readings
       SET local_date = '2026-08-01', reading_key = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        `reading-v5:${historical.userId}:2026-08-01:r1`,
        historicalUpdatedAt,
        readingId,
      )
      .run();

    const summary = await runReadingScheduler(hybridEnv(), SCHEDULED_AT);

    expect(summary.usersExamined).toBe(1);
    expect(summary.due.evaluated).toBe(1);
    expect(
      await rows<{ updated_at: string }>(
        "SELECT updated_at FROM daily_readings WHERE id = ?",
        readingId,
      ),
    ).toEqual([{ updated_at: historicalUpdatedAt }]);
  });

  it("uses the invalidated repair index with stable updated_at/id ordering and a bound limit", async () => {
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${invalidatedOrphanDiscoverySql(0)}`)
      .bind(
        new Date(SCHEDULED_AT.getTime() - INVALIDATED_ORPHAN_BACKOFF_MS).toISOString(),
        "2026-08-10",
        "2026-08-12",
        JSON.stringify({ UTC: "2026-08-11" }),
        17,
      )
      .all<{ detail: string }>();
    const detail = plan.results.map((row) => row.detail).join("\n");

    expect(detail).toContain("idx_daily_readings_invalidated_repair");
    expect(invalidatedOrphanDiscoverySql(0)).toContain("ORDER BY r.updated_at, r.id");
    expect(invalidatedOrphanDiscoverySql(0)).toContain("LIMIT ?");
  });

  it("recovers expired claims before undispatched outbox rows without the manual sweep route", async () => {
    const expiredUser = identity(50);
    const outboxUser = identity(51);
    await seedSchedulerAccount(expiredUser, { nextDueAt: FUTURE });
    await seedSchedulerAccount(outboxUser, { nextDueAt: FUTURE });
    const send = vi.fn().mockResolvedValue(undefined);
    const envValue = hybridEnv(send);
    const localDate = resolveV5TargetDate(ZONE, SCHEDULED_AT)!;
    const expired = await enqueueConstrainedReading(envValue, expiredUser.userId, {
      entry: "scheduled",
      reservationReason: "scheduled",
      targetLocalDate: localDate,
      now: SCHEDULED_AT,
    });
    const outbox = await enqueueConstrainedReading(envValue, outboxUser.userId, {
      entry: "scheduled",
      reservationReason: "scheduled",
      targetLocalDate: localDate,
      now: SCHEDULED_AT,
    });
    expect(expired.ok && outbox.ok).toBe(true);
    if (!expired.ok || !outbox.ok) return;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE jobs SET status = 'running', claim_token = 'clm_crashed',
                         lease_expires_at = ?, dispatched_at = ? WHERE id = ?`,
      ).bind("2026-08-11T14:00:00.000Z", "2026-08-11T13:00:00.000Z", expired.jobId),
      env.DB.prepare(
        "UPDATE jobs SET status = 'queued', dispatched_at = NULL WHERE id = ?",
      ).bind(outbox.jobId),
    ]);
    send.mockClear();

    const summary = await runReadingScheduler(envValue, SCHEDULED_AT);

    expect(summary.repair.expiredLeaseRedispatched).toBe(1);
    expect(summary.repair.undispatchedOutboxRedispatched).toBe(1);
    expect(send.mock.calls.map(([message]) => message.job_id)).toEqual([
      expired.jobId,
      outbox.jobId,
    ]);
  });

  it("applies a repair query limit to distinct users rather than duplicate rows", async () => {
    const firstUser = identity(52);
    const secondUser = identity(53);
    await seedSchedulerAccount(firstUser, { nextDueAt: FUTURE });
    await seedSchedulerAccount(secondUser, { nextDueAt: FUTURE });
    const envValue = hybridEnv();
    const currentLocalDate = resolveV5TargetDate(ZONE, SCHEDULED_AT)!;
    const nextDate = new Date(`${currentLocalDate}T12:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const first = await enqueueConstrainedReading(envValue, firstUser.userId, {
      entry: "scheduled",
      reservationReason: "scheduled",
      targetLocalDate: currentLocalDate,
      now: SCHEDULED_AT,
    });
    const duplicateUser = await enqueueConstrainedReading(envValue, firstUser.userId, {
      entry: "scheduled",
      reservationReason: "scheduled",
      targetLocalDate: nextDate.toISOString().slice(0, 10),
      now: SCHEDULED_AT,
    });
    const second = await enqueueConstrainedReading(envValue, secondUser.userId, {
      entry: "scheduled",
      reservationReason: "scheduled",
      targetLocalDate: currentLocalDate,
      now: SCHEDULED_AT,
    });
    expect(first.ok && duplicateUser.ok && second.ok).toBe(true);
    if (!first.ok || !duplicateUser.ok || !second.ok) return;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE jobs SET status = 'running', lease_expires_at = ? WHERE id = ?",
      ).bind("2026-08-11T10:00:00.000Z", first.jobId),
      env.DB.prepare(
        "UPDATE jobs SET status = 'running', lease_expires_at = ? WHERE id = ?",
      ).bind("2026-08-11T11:00:00.000Z", duplicateUser.jobId),
      env.DB.prepare(
        "UPDATE jobs SET status = 'running', lease_expires_at = ? WHERE id = ?",
      ).bind("2026-08-11T12:00:00.000Z", second.jobId),
    ]);

    const candidates = await findExpiredSchedulerCandidates(
      envValue,
      SCHEDULED_AT,
      2,
      new Set(),
    );

    expect(candidates.map((candidate) => candidate.userId)).toEqual([
      firstUser.userId,
      secondUser.userId,
    ]);
  });

  it("spends the single 100-distinct-user ceiling on repairs before due work", async () => {
    const createdAt = "2026-08-01T00:00:00.000Z";
    const orphanAt = "2026-08-01T01:00:00.000Z";
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < 100; index += 1) {
      const id = identity(1000 + index);
      statements.push(
        env.DB.prepare(
          `INSERT INTO users
             (id, crypto_subject, status, locale, timezone, entitlement_tier,
              next_due_at, created_at, updated_at)
           VALUES (?, ?, 'active', 'en-US', 'UTC', 'free', ?, ?, ?)`,
        ).bind(id.userId, id.cryptoSubject, FUTURE, createdAt, createdAt),
        env.DB.prepare(
          `INSERT INTO daily_readings
             (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
              contract_id, assembly_mode, status, revision, revision_reason,
              command_generation, invalidated_at, reading_enc, reading_key_version,
              reading_nonce, created_at, updated_at)
           VALUES (?, ?, '2026-08-11', NULL, ?, ?, 'calc-contract-launch',
                   'constrained_model', 'invalidated', 1, 'initial', 1, ?, x'00',
                   1, 'invalid', ?, ?)`,
        ).bind(
          `rdg_quota_${index}`,
          id.userId,
          `reading-v5:${id.userId}:2026-08-11:r1`,
          `sha256:${"1a".repeat(32)}`,
          orphanAt,
          orphanAt,
          orphanAt,
        ),
      );
    }
    for (let offset = 0; offset < statements.length; offset += 40) {
      await env.DB.batch(statements.slice(offset, offset + 40));
    }
    const dueUser = identity(2000);
    await seedSchedulerAccount(dueUser, { nextDueAt: OLD });

    const summary = await runReadingScheduler(hybridEnv(), SCHEDULED_AT);

    expect(summary.usersExamined).toBe(100);
    expect(summary.repair.ineligibleOrphansBackedOff).toBe(100);
    expect(summary.repairQuotaExhausted).toBe(true);
    expect(summary.due.evaluated).toBe(0);
    expect(await rows("SELECT id FROM daily_readings WHERE user_id = ?", dueUser.userId)).toEqual([]);
  });
});

describe("rollout and reservation convergence", () => {
  it.each(["off", "internal", "first_open"] as const)(
    "does no scheduled reservation while rollout is %s",
    async (mode) => {
      const account = identity(60);
      await seedSchedulerAccount(account);
      const envValue = { ...hybridEnv(), READING_V5_ROLLOUT: mode };

      const summary = await runReadingScheduler(envValue, SCHEDULED_AT);

      expect(summary.status).toBe("disabled");
      expect(await rows("SELECT id FROM daily_readings")).toEqual([]);
      expect((await rows<{ next_due_at: string }>("SELECT next_due_at FROM users WHERE id = ?", account.userId))[0]?.next_due_at).toBe(OLD);
    },
  );

  it("lets scheduler and first-open race converge on one reservation", async () => {
    const account = identity(61);
    await seedSchedulerAccount(account);
    const envValue = hybridEnv();
    const localDate = resolveV5TargetDate(ZONE, SCHEDULED_AT)!;

    await Promise.all([
      runReadingScheduler(envValue, SCHEDULED_AT),
      enqueueConstrainedReading(envValue, account.userId, {
        entry: "first_open",
        reservationReason: "first_open",
        targetLocalDate: localDate,
        now: SCHEDULED_AT,
      }),
    ]);

    expect(
      await rows<{ count: number }>(
        "SELECT COUNT(*) AS count FROM daily_readings WHERE user_id = ? AND local_date = ?",
        account.userId,
        localDate,
      ),
    ).toEqual([{ count: 1 }]);
    expect(
      await rows<{ count: number }>(
        "SELECT COUNT(*) AS count FROM jobs WHERE user_id = ? AND job_type = 'generate_daily_reading'",
        account.userId,
      ),
    ).toEqual([{ count: 1 }]);
  });
});

describe("D1's bound-parameter ceiling", () => {
  it("keeps every lane's exclusion list inside it", () => {
    // The platform limit is asserted nowhere else in this repository, and the
    // miniflare D1 the test pool uses does not enforce it - so a lane that
    // crossed it would pass every integration test and fail only in production,
    // out of the uncaught scheduled(), taking the due and null-seed lanes with
    // it. The widest lane binds 12 fixed parameters.
    for (const fixed of [1, 2, 4, 5, 12]) {
      expect(excludedBudget(fixed) + fixed).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
    }
    // And the cap never goes negative for a lane wider than the ceiling.
    expect(excludedBudget(D1_MAX_BOUND_PARAMETERS + 5)).toBe(0);
  });
});
