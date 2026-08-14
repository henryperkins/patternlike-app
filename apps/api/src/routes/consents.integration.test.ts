import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import {
  AI_CONSENT_DATA_CATEGORIES,
} from "@patternlike/shared";
import m5ReadingGenerationRequest from "../../../../contracts/m5/reading-generation-request.schema.json";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { app } from "../index.js";
import {
  AI_SYNTHESIS_POLICY_VERSION,
  grantAiSynthesisConsent,
} from "../db/consents.js";
import type { GenerationMessage } from "../env.js";
import { OPENAI_READING_MODEL } from "../services/reading-publisher.js";
import {
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  confirmPreferences,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";

const ZONE = "America/Chicago";
const QUEUE = "patternlike-daily-readings-dev";

interface ConsentBody {
  kind: "ai_synthesis";
  status: "granted" | "not_granted";
  provider: "OpenAI";
  purpose: "daily_reading_generation";
  policy_version: string;
  enabled_categories: string[];
  granted_at: string | null;
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    request_id: string | null;
  };
}

function publisherEnv(
  overrides: Partial<typeof env> = {},
): typeof env {
  return {
    ...env,
    READING_V5_ROLLOUT: "first_open",
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
    ...overrides,
  };
}

function failNextCursorWrite(database: D1Database): D1Database {
  let pending = true;

  function wrapStatement(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values));
        }
        if (property === "run") {
          return async () => {
            if (pending) {
              pending = false;
              throw new Error("injected cursor write failure");
            }
            return target.run();
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          const statement = target.prepare(query);
          return query.includes("UPDATE users SET next_due_at = ?")
            ? wrapStatement(statement)
            : statement;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function requestConsent(
  method: "GET" | "PUT" | "DELETE",
  options: {
    userId?: string | null;
    key?: string;
    policyVersion?: string;
    body?: string;
    requestEnv?: typeof env;
  } = {},
) {
  const userId = options.userId === undefined ? USER_A : options.userId;
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  if (options.key) headers["idempotency-key"] = options.key;
  let body = options.body;
  if (method === "PUT" && body === undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify({
      policy_version: options.policyVersion ?? AI_SYNTHESIS_POLICY_VERSION,
    });
  }
  const response = await app.request(
    "http://api.test/v1/consents/ai-synthesis",
    { method, headers, ...(body === undefined ? {} : { body }) },
    options.requestEnv ?? { ...env, READING_V5_ROLLOUT: "off" },
  );
  return {
    status: response.status,
    body: (await response.json()) as ConsentBody | ErrorBody,
  };
}

async function seedReader(identity = IDENTITY_A): Promise<void> {
  await seedUser(identity);
  await confirmPreferences(identity.userId, ZONE);
  await seedChart(identity);
}

async function deliver(message: GenerationMessage, deliveryEnv: typeof env) {
  const batch = createMessageBatch<GenerationMessage>(QUEUE, [
    { id: "msg-consent-route", timestamp: new Date(0), attempts: 1, body: message },
  ]);
  const ctx = createExecutionContext();
  await worker.queue(batch, deliveryEnv);
  return getQueueResult(batch, ctx);
}

describe("AI-synthesis consent routes", () => {
  beforeEach(async () => {
    await resetDb();
    await seedReader();
  });

  it("authenticates and returns only the server-owned safe disclosure", async () => {
    const unauthenticated = await requestConsent("GET", { userId: null });
    expect(unauthenticated.status).toBe(401);
    expect((unauthenticated.body as ErrorBody).error.code).toBe("unauthorized");

    const current = await requestConsent("GET");
    expect(current.status).toBe(200);
    expect(current.body).toEqual({
      kind: "ai_synthesis",
      status: "not_granted",
      provider: "OpenAI",
      purpose: "daily_reading_generation",
      policy_version: AI_SYNTHESIS_POLICY_VERSION,
      enabled_categories: [...AI_CONSENT_DATA_CATEGORIES],
      granted_at: null,
    });
    const serialized = JSON.stringify(current.body);
    for (const forbidden of [
      USER_A,
      "consent_id",
      "source_id",
      "allowed_uses_json",
      "research",
      "model_training",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    // This inventory is checked against the actual frozen provider-request
    // properties. Adding a request section without classifying it here fails;
    // fact classes are likewise checked against the schema enum rather than a
    // second imagined packet shape.
    const operationalSections = [
      "schema_version",
      "prompt_version",
      "selection_policy_version",
      "output_schema",
      "local_date",
      "locale",
      "composition",
    ] as const;
    const disclosedSections = {
      birth_time_accuracy: "birth_accuracy_and_uncertainty",
      suppressed_features: "birth_accuracy_and_uncertainty",
      domain_preference: "enabled_personal_context",
      facts: null,
      context: null,
      prior_readings: "prior_reading_excerpts",
    } as const;
    const requestDefinition = m5ReadingGenerationRequest.$defs.readingGenerationRequest;
    expect(
      [...operationalSections, ...Object.keys(disclosedSections)].sort(),
    ).toEqual(Object.keys(requestDefinition.properties).sort());

    const factCategoryByClass = {
      cycle_instance: "active_calculated_cycles",
      transit_natal_contact: "calculated_daily_sky",
      house_placement: "calculated_daily_sky",
      anchor_position: "calculated_daily_sky",
      lunar_phase: "calculated_daily_sky",
      sign_ingress: "calculated_daily_sky",
      collective_exact_aspect: "calculated_daily_sky",
      natal_position: "calculated_natal_facts",
      natal_aspect: "calculated_natal_facts",
    } as const;
    expect(Object.keys(factCategoryByClass).sort()).toEqual(
      [...m5ReadingGenerationRequest.$defs.requestFact.properties.fact_class.enum].sort(),
    );
    const disclosedCategories = new Set(AI_CONSENT_DATA_CATEGORIES);
    for (const category of Object.values(factCategoryByClass)) {
      expect(disclosedCategories.has(category)).toBe(true);
    }
    for (const category of Object.values(disclosedSections)) {
      if (category !== null) expect(disclosedCategories.has(category)).toBe(true);
    }
    // Each actual context item carries exactly one category on the wire. These
    // are the only two compiler lanes eligible to populate that section.
    expect(m5ReadingGenerationRequest.$defs.requestContext.required).toContain("category");
    expect(["enabled_personal_context", "reading_feedback"].every(
      (category) => disclosedCategories.has(category as (typeof AI_CONSENT_DATA_CATEGORIES)[number]),
    )).toBe(true);
    expect(current.body).not.toHaveProperty("context_sources");

    const contextSources = await app.request(
      "/v1/context-sources",
      { headers: { "x-user-id": USER_A } },
      { ...env, READING_V5_ROLLOUT: "off" },
    );
    expect(contextSources.status).toBe(200);
    // Both registry sources, in canonical order. Neither is granted by the
    // AI-synthesis consent: that consent governs model synthesis, and a source
    // it silently switched on would be a permission nobody was shown.
    expect(await contextSources.json()).toMatchObject({
      schema_version: "0.2.0",
      user_id: USER_A,
      sources: [
        {
          source_id: "USR-06",
          permission_state: "never_granted",
          enabled: false,
        },
        {
          source_id: "USR-09",
          permission_state: "never_granted",
          enabled: false,
        },
      ],
    });
  });

  it("requires the exact displayed policy and applies the existing idempotency convention", async () => {
    expect((await requestConsent("PUT")).status).toBe(400);
    expect(
      await requestConsent("DELETE", {
        key: "web-ai-synthesis-delete-body",
        body: "{}",
      }),
    ).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_body" } },
    });

    const stale = await requestConsent("PUT", {
      key: "web-ai-synthesis-stale",
      policyVersion: "0.9.0",
    });
    expect(stale.status).toBe(409);
    expect((stale.body as ErrorBody).error.code).toBe("consent_policy_version_stale");

    const first = await requestConsent("PUT", { key: "web-ai-synthesis-grant-1" });
    const replay = await requestConsent("PUT", { key: "web-ai-synthesis-grant-1" });
    expect(first.status).toBe(200);
    expect(replay).toEqual(first);
    expect(first.body).toMatchObject({
      kind: "ai_synthesis",
      status: "granted",
      policy_version: AI_SYNTHESIS_POLICY_VERSION,
      granted_at: expect.any(String),
    });
    expect(
      await rows(
        "SELECT kind, status, policy_version, version FROM consents WHERE user_id = ? ORDER BY version",
        USER_A,
      ),
    ).toEqual([
      {
        kind: "ai_synthesis",
        status: "granted",
        policy_version: AI_SYNTHESIS_POLICY_VERSION,
        version: 1,
      },
    ]);
    expect(
      await rows(
        "SELECT job_type, idempotency_key FROM jobs WHERE user_id = ? ORDER BY created_at",
        USER_A,
      ),
    ).toEqual([
      {
        job_type: "ai_synthesis_consent_grant",
        idempotency_key: "web-ai-synthesis-grant-1",
      },
    ]);

    const conflict = await requestConsent("PUT", {
      key: "web-ai-synthesis-grant-1",
      policyVersion: "0.9.0",
    });
    expect(conflict.status).toBe(409);

    await seedReader(IDENTITY_B);
    const otherOwner = await requestConsent("PUT", {
      userId: USER_B,
      key: "web-ai-synthesis-grant-1",
    });
    expect(otherOwner.status).toBe(200);
    expect(await rows("SELECT user_id FROM consents ORDER BY user_id")).toEqual([
      { user_id: USER_A },
      { user_id: USER_B },
    ]);
  });

  it("keeps grant/revocation history append-only, recomputes the cursor, and cannot mutate training purposes", async () => {
    const now = new Date().toISOString();
    await rows(
      `INSERT INTO consents
         (id, user_id, kind, status, policy_version, version, created_at, updated_at)
       VALUES ('cns_research_control', ?, 'research', 'granted', '1.0.0', 1, ?, ?),
              ('cns_training_control', ?, 'model_training', 'denied', '1.0.0', 1, ?, ?)`,
      USER_A,
      now,
      now,
      USER_A,
      now,
      now,
    );
    await rows("UPDATE users SET next_due_at = NULL WHERE id = ?", USER_A);

    await requestConsent("PUT", { key: "web-ai-synthesis-grant-history" });
    expect(
      await rows("SELECT next_due_at IS NOT NULL AS scheduled FROM users WHERE id = ?", USER_A),
    ).toEqual([{ scheduled: 1 }]);

    await rows("UPDATE users SET next_due_at = NULL WHERE id = ?", USER_A);
    const revoked = await requestConsent("DELETE", {
      key: "web-ai-synthesis-revoke-history",
    });
    const replay = await requestConsent("DELETE", {
      key: "web-ai-synthesis-revoke-history",
    });
    expect(revoked.status).toBe(200);
    expect(replay).toEqual(revoked);
    expect(revoked.body).toMatchObject({ status: "not_granted", granted_at: null });
    expect(
      await rows("SELECT next_due_at IS NOT NULL AS scheduled FROM users WHERE id = ?", USER_A),
    ).toEqual([{ scheduled: 1 }]);

    const history = await rows<{
      id: string;
      status: string;
      version: number;
      supersedes_consent_id: string | null;
    }>(
      `SELECT id, status, version, supersedes_consent_id
       FROM consents WHERE user_id = ? AND kind = 'ai_synthesis' ORDER BY version`,
      USER_A,
    );
    expect(history).toHaveLength(2);
    expect(history.map(({ status, version }) => ({ status, version }))).toEqual([
      { status: "granted", version: 1 },
      { status: "revoked", version: 2 },
    ]);
    expect(history[1]!.supersedes_consent_id).toBe(history[0]!.id);
    expect(
      await rows(
        "SELECT kind, status FROM consents WHERE id IN ('cns_research_control', 'cns_training_control') ORDER BY kind",
      ),
    ).toEqual([
      { kind: "model_training", status: "denied" },
      { kind: "research", status: "granted" },
    ]);
  });

  it("repairs the consent-owned cursor when the durable mutation outlives the first response", async () => {
    await rows("UPDATE users SET next_due_at = NULL WHERE id = ?", USER_A);
    const key = "web-ai-synthesis-cursor-crash";
    const failed = await requestConsent("PUT", {
      key,
      requestEnv: {
        ...env,
        READING_V5_ROLLOUT: "off",
        DB: failNextCursorWrite(env.DB),
      },
    });
    expect(failed).toMatchObject({
      status: 500,
      body: { error: { code: "internal_error" } },
    });
    expect(
      await rows(
        `SELECT c.status, c.granted_at, u.next_due_at
         FROM consents c JOIN users u ON u.id = c.user_id
         WHERE c.user_id = ? AND c.kind = 'ai_synthesis'`,
        USER_A,
      ),
    ).toEqual([
      {
        status: "granted",
        granted_at: expect.any(String),
        next_due_at: null,
      },
    ]);

    const repaired = await requestConsent("PUT", { key });
    expect(repaired).toMatchObject({
      status: 200,
      body: { status: "granted", granted_at: expect.any(String) },
    });
    const [durable] = await rows<{ granted_at: string }>(
      "SELECT granted_at FROM consents WHERE user_id = ? AND kind = 'ai_synthesis'",
      USER_A,
    );
    expect((repaired.body as ConsentBody).granted_at).toBe(durable!.granted_at);
    expect(
      await rows(
        `SELECT
           (SELECT COUNT(*) FROM consents WHERE user_id = ? AND kind = 'ai_synthesis') AS consent_count,
           (SELECT COUNT(*) FROM jobs WHERE user_id = ? AND idempotency_key = ?) AS job_count,
           (SELECT next_due_at IS NOT NULL FROM users WHERE id = ?) AS scheduled`,
        USER_A,
        USER_A,
        key,
        USER_A,
      ),
    ).toEqual([{ consent_count: 1, job_count: 1, scheduled: 1 }]);

    const repairedDueAt = (
      await rows<{ next_due_at: string }>("SELECT next_due_at FROM users WHERE id = ?", USER_A)
    )[0]!.next_due_at;
    await rows("UPDATE users SET next_due_at = ? WHERE id = ?", "2099-01-01T00:00:00.000Z", USER_A);
    expect(await requestConsent("PUT", { key })).toEqual(repaired);
    expect(
      await rows<{ next_due_at: string }>("SELECT next_due_at FROM users WHERE id = ?", USER_A),
    ).toEqual([{ next_due_at: "2099-01-01T00:00:00.000Z" }]);
    expect(repairedDueAt).not.toBe("2099-01-01T00:00:00.000Z");
  });

  it.each([
    {
      name: "expired",
      policyVersion: AI_SYNTHESIS_POLICY_VERSION,
      expiresAt: "2026-01-01T00:00:00.000Z",
    },
    { name: "old-policy", policyVersion: "0.9.0", expiresAt: null },
  ])("appends revocation for a latest $name grant", async ({ policyVersion, expiresAt }) => {
    const grantedAt = "2025-12-01T00:00:00.000Z";
    await rows(
      `INSERT INTO consents
         (id, user_id, kind, status, policy_version, granted_at, expires_at,
          version, created_at, updated_at)
       VALUES ('cns_historical_grant', ?, 'ai_synthesis', 'granted', ?, ?, ?, 1, ?, ?)`,
      USER_A,
      policyVersion,
      grantedAt,
      expiresAt,
      grantedAt,
      grantedAt,
    );

    expect(await requestConsent("DELETE", { key: `web-ai-revoke-${policyVersion}` })).toMatchObject({
      status: 200,
      body: { status: "not_granted" },
    });
    expect(
      await rows(
        `SELECT status, version, supersedes_consent_id
         FROM consents WHERE user_id = ? AND kind = 'ai_synthesis' ORDER BY version`,
        USER_A,
      ),
    ).toEqual([
      { status: "granted", version: 1, supersedes_consent_id: null },
      { status: "revoked", version: 2, supersedes_consent_id: "cns_historical_grant" },
    ]);
  });

  it("records a fresh grant when the displayed policy changes while the prior grant is active", async () => {
    const firstAt = "2026-08-10T10:00:00.000Z";
    await rows(
      `INSERT INTO consents
         (id, user_id, kind, status, policy_version, granted_at,
          version, created_at, updated_at)
       VALUES ('cns_prior_displayed_policy', ?, 'ai_synthesis', 'granted', ?, ?, 1, ?, ?)`,
      USER_A,
      AI_SYNTHESIS_POLICY_VERSION,
      firstAt,
      firstAt,
      firstAt,
    );

    const nextDisplayedPolicy = "1.1.0";
    const nextAt = new Date("2026-08-11T10:00:00.000Z");
    const result = await grantAiSynthesisConsent(
      env,
      IDENTITY_A,
      nextDisplayedPolicy,
      "web-ai-next-displayed-policy",
      nextAt,
    );
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      state: { status: "granted", grantedAt: nextAt.toISOString() },
    });
    expect(
      await rows(
        `SELECT policy_version, granted_at, version, supersedes_consent_id
         FROM consents WHERE user_id = ? AND kind = 'ai_synthesis' ORDER BY version`,
        USER_A,
      ),
    ).toEqual([
      {
        policy_version: AI_SYNTHESIS_POLICY_VERSION,
        granted_at: firstAt,
        version: 1,
        supersedes_consent_id: null,
      },
      {
        policy_version: nextDisplayedPolicy,
        granted_at: nextAt.toISOString(),
        version: 2,
        supersedes_consent_id: "cns_prior_displayed_policy",
      },
    ]);
  });

  it("treats expired and old-policy grants as absent until a fresh current-policy grant", async () => {
    const now = new Date();
    await rows(
      `INSERT INTO consents
         (id, user_id, kind, status, policy_version, granted_at, expires_at,
          version, created_at, updated_at)
       VALUES ('cns_old_policy', ?, 'ai_synthesis', 'granted', '0.9.0', ?, NULL, 1, ?, ?),
              ('cns_expired_policy', ?, 'ai_synthesis', 'granted', ?, ?, ?, 2, ?, ?)`,
      USER_A,
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
      USER_A,
      AI_SYNTHESIS_POLICY_VERSION,
      new Date(now.getTime() - 60_000).toISOString(),
      new Date(now.getTime() - 1).toISOString(),
      now.toISOString(),
      now.toISOString(),
    );

    expect(await requestConsent("GET")).toMatchObject({
      status: 200,
      body: { status: "not_granted", granted_at: null },
    });
    expect(
      await requestConsent("PUT", {
        key: "web-ai-synthesis-old-copy",
        policyVersion: "0.9.0",
      }),
    ).toMatchObject({
      status: 409,
      body: { error: { code: "consent_policy_version_stale" } },
    });

    const fresh = await requestConsent("PUT", { key: "web-ai-synthesis-fresh-copy" });
    expect(fresh).toMatchObject({ status: 200, body: { status: "granted" } });
    expect(
      await rows(
        `SELECT policy_version, version, supersedes_consent_id
         FROM consents WHERE user_id = ? AND kind = 'ai_synthesis' ORDER BY version DESC LIMIT 1`,
        USER_A,
      ),
    ).toEqual([
      {
        policy_version: AI_SYNTHESIS_POLICY_VERSION,
        version: 3,
        supersedes_consent_id: "cns_expired_policy",
      },
    ]);
  });

  it("revocation blocks queued provider work, re-grant alone is inert, and explicit Today replaces only through g3", async () => {
    const messages: GenerationMessage[] = [];
    const requestEnv = publisherEnv({
      READING_QUEUE: {
        send: async (message: GenerationMessage) => {
          messages.push(message);
        },
      } as unknown as typeof env.READING_QUEUE,
    });
    await requestConsent("PUT", {
      key: "web-ai-synthesis-queue-grant-1",
      requestEnv,
    });

    const initial = await app.request(
      "/v1/readings/today",
      { method: "PUT", headers: { "x-user-id": USER_A } },
      requestEnv,
    );
    expect(initial.status).toBe(202);
    expect(messages).toHaveLength(1);
    const [original] = await rows<{ id: string; payload_enc: ArrayBuffer }>(
      `SELECT id, payload_enc FROM jobs
       WHERE user_id = ? AND job_type = 'generate_daily_reading' ORDER BY created_at`,
      USER_A,
    );

    for (let generation = 1; generation <= 3; generation += 1) {
      await requestConsent("DELETE", {
        key: `web-ai-synthesis-queue-revoke-${generation}`,
        requestEnv,
      });
      let providerCalls = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (new URL(request.url).hostname === "api.openai.com") providerCalls += 1;
        return originalFetch(input, init);
      }) as typeof fetch;
      try {
        const result = await deliver(messages[generation - 1]!, requestEnv);
        expect(result.retryMessages).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
      }
      expect(providerCalls).toBe(0);

      const beforeRegrant = messages.length;
      await requestConsent("PUT", {
        key: `web-ai-synthesis-queue-regrant-${generation}`,
        requestEnv,
      });
      expect(messages).toHaveLength(beforeRegrant);

      const retried = await app.request(
        "/v1/readings/today",
        { method: "PUT", headers: { "x-user-id": USER_A } },
        requestEnv,
      );
      if (generation < 3) {
        expect(retried.status).toBe(202);
        expect(messages).toHaveLength(beforeRegrant + 1);
      } else {
        expect(retried.status).toBe(424);
        expect((await retried.json()) as ErrorBody).toMatchObject({
          error: { code: "reading_generation_failed" },
        });
        expect(messages).toHaveLength(beforeRegrant);
      }
    }

    expect(
      await rows(
        `SELECT command_generation FROM daily_readings
         WHERE user_id = ? ORDER BY command_generation DESC LIMIT 1`,
        USER_A,
      ),
    ).toEqual([{ command_generation: 3 }]);
    expect(
      await rows(
        `SELECT COUNT(*) AS count FROM jobs
         WHERE user_id = ? AND job_type = 'generate_daily_reading'`,
        USER_A,
      ),
    ).toEqual([{ count: 3 }]);
    const [after] = await rows<{ payload_enc: ArrayBuffer }>(
      "SELECT payload_enc FROM jobs WHERE id = ?",
      original!.id,
    );
    expect(new Uint8Array(after!.payload_enc)).toEqual(new Uint8Array(original!.payload_enc));
  });

  it("keeps a valid published V5 reading readable after revocation", async () => {
    const messages: GenerationMessage[] = [];
    const requestEnv = publisherEnv({
      READING_QUEUE: {
        send: async (message: GenerationMessage) => {
          messages.push(message);
        },
      } as unknown as typeof env.READING_QUEUE,
    });
    await requestConsent("PUT", {
      key: "web-ai-synthesis-published-grant",
      requestEnv,
    });
    expect(
      (
        await app.request(
          "/v1/readings/today",
          { method: "PUT", headers: { "x-user-id": USER_A } },
          requestEnv,
        )
      ).status,
    ).toBe(202);
    await deliver(messages[0]!, requestEnv);

    const before = await app.request(
      "/v1/readings/today",
      { headers: { "x-user-id": USER_A } },
      requestEnv,
    );
    expect(before.status).toBe(200);
    const body = (await before.json()) as { reading: { reading_id: string } };

    await requestConsent("DELETE", {
      key: "web-ai-synthesis-published-revoke",
      requestEnv,
    });
    const after = await app.request(
      "/v1/readings/today",
      { headers: { "x-user-id": USER_A } },
      requestEnv,
    );
    expect(after.status).toBe(200);
    expect((await after.json()) as { reading: { reading_id: string } }).toMatchObject({
      reading: { reading_id: body.reading.reading_id },
    });
  });
});
