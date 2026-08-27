import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import m0Common from "../../../../contracts/m0/common.schema.json";
import m3Common from "../../../../contracts/m3/common.schema.json";
import m3AssemblyIdentity from "../../../../contracts/m3/assembly-identity.schema.json";
import m5Common from "../../../../contracts/m5/common.schema.json";
import m5GenerationCommand from "../../../../contracts/m5/generation-command.schema.json";
import m5ReadingGenerationRequest from "../../../../contracts/m5/reading-generation-request.schema.json";
import m5ReadingGenerationOutput from "../../../../contracts/m5/reading-generation-output.schema.json";

import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import { decryptPayload } from "../db/users.js";
import { claimJob } from "../db/generation.js";
import { enqueueConstrainedReading, resolveV5TargetDate } from "./enqueue.js";
import {
  buildGenerationCommandV2,
  buildV5ReadingKey,
  isCommandV2,
  projectNatalFacts,
  type GenerateDailyReadingCommandV2,
} from "./generation-command-v2.js";
import { AI_SYNTHESIS_POLICY_VERSION } from "../db/consents.js";
import {
  OPENAI_READING_MODEL,
  READING_PUBLISHER_PROVIDER,
} from "./reading-publisher.js";
import { READING_PUBLISHER_PROVIDERS } from "@patternlike/shared";

const ZONE = "America/Chicago";

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
for (const schema of [
  m0Common,
  m3Common,
  m3AssemblyIdentity,
  m5Common,
  m5ReadingGenerationOutput,
  m5ReadingGenerationRequest,
  m5GenerationCommand,
]) {
  ajv.addSchema(schema);
}
const validateCommandV2 = ajv.getSchema(
  `${m5GenerationCommand.$id}#/$defs/generateDailyReadingCommandV2`,
)!;
const validateRequest = ajv.getSchema(
  `${m5ReadingGenerationRequest.$id}#/$defs/readingGenerationRequest`,
)!;

/** The publisher configuration a real enabled deployment carries. */
function enabledEnv(rollout = "internal") {
  return {
    ...env,
    READING_V5_ROLLOUT: rollout,
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

async function grantAiSynthesis(policyVersion = AI_SYNTHESIS_POLICY_VERSION) {
  await rows(
    `INSERT INTO consents (id, user_id, kind, status, policy_version, allowed_uses_json,
       scopes_json, version, granted_at, created_at, updated_at)
     VALUES (?, ?, 'ai_synthesis', 'granted', ?, '[]', '[]', 1, ?, ?, ?)`,
    "cns_ai_synthesis_0001",
    USER_A,
    policyVersion,
    "2026-08-09T00:00:00Z",
    "2026-08-09T00:00:00Z",
    "2026-08-09T00:00:00Z",
  );
}

const today = () => resolveV5TargetDate(ZONE, new Date())!;

async function build(overrides: { rollout?: string } = {}) {
  return buildGenerationCommandV2(enabledEnv(overrides.rollout) as typeof env, IDENTITY_A, {
    readingId: "rdg_v2_test_0001",
    revision: 1,
    revisionReason: "initial",
    supersedesReadingId: null,
    reservationReason: "internal",
    commandGeneration: 1,
    replacesJobId: null,
    commandReplacementReason: null,
    targetLocalDate: today(),
    now: new Date(),
  });
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A, ZONE);
  await seedChart(IDENTITY_A);
  await grantAiSynthesis();
});

describe("V2 command", () => {
  it("validates against the frozen M5 command contract", async () => {
    const built = await build();
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(validateCommandV2(built.command)).toBe(true);
    expect(validateCommandV2.errors ?? []).toEqual([]);
  });

  it("carries no editorial release and never reads one", async () => {
    const built = await build();
    if (!built.ok) throw new Error(built.detail);
    const serialized = JSON.stringify(built.command);
    expect(serialized).not.toContain("release_version");
    expect(serialized).not.toContain("release_bundle_hash");
    expect(serialized).not.toContain("assembly_id");
    expect(built.command.assembly_mode).toBe("constrained_model");
    expect(built.command.output_schema).toBe("daily-reading-v5");
  });

  it("pins both calculation exchanges under one ephemeris vintage", async () => {
    const built = await build();
    if (!built.ok) throw new Error(built.detail);
    const { cycle_scan, daily_sky } = built.command;

    expect(cycle_scan.ephemeris_data_version).toBe(daily_sky.ephemeris_data_version);
    for (const pin of [cycle_scan, daily_sky]) {
      expect(pin.request_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(pin.response_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(pin.request_id).toBeTruthy();
    }
    // The daily-sky layer is what makes a zero-cycle day still a factual day.
    expect(daily_sky.selected.length).toBeGreaterThanOrEqual(2);
  });

  it("freezes both identities, and the full digest for the input id", async () => {
    const built = await build();
    if (!built.ok) throw new Error(built.detail);

    expect(built.command.generation_input_id).toMatch(/^gin_sha256_[a-f0-9]{64}$/);
    expect(built.command.input_manifest_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(built.command.generation_input_id).not.toContain(
      built.command.input_manifest_hash.slice(7),
    );
  });

  it("produces a provider packet that validates against its own contract", async () => {
    const built = await build();
    if (!built.ok) throw new Error(built.detail);

    expect(validateRequest(built.request)).toBe(true);
    expect(validateRequest.errors ?? []).toEqual([]);

    const packet = JSON.stringify(built.request);
    for (const forbidden of [USER_A, ZONE, built.command.reading_key, built.command.chart.fingerprint]) {
      expect(packet, forbidden).not.toContain(forbidden);
    }
  });

  it("uses the v5 reading key namespace", async () => {
    const built = await build();
    if (!built.ok) throw new Error(built.detail);
    expect(built.command.reading_key).toBe(buildV5ReadingKey(USER_A, today(), 1));
    expect(built.command.reading_key.startsWith("reading-v5:")).toBe(true);
  });

  it("pins the consent it was frozen under, in the frozen display order", async () => {
    const built = await build();
    if (!built.ok) throw new Error(built.detail);
    expect(built.command.ai_consent).toMatchObject({
      kind: "ai_synthesis",
      status: "granted",
      policy_version: AI_SYNTHESIS_POLICY_VERSION,
    });
    expect(built.command.ai_consent.categories[0]).toBe("birth_accuracy_and_uncertainty");
    expect(built.command.ai_consent.categories).toHaveLength(7);
  });

  it("pins the publisher configuration rather than leaving it to execution", async () => {
    const built = await build();
    if (!built.ok) throw new Error(built.detail);
    expect(built.command.publisher).toMatchObject({
      provider: READING_PUBLISHER_PROVIDER,
      model: OPENAI_READING_MODEL,
      reasoning_effort: "high",
      output_schema: "daily-reading-v5",
      max_output_tokens: 4000,
      context_max_bytes: 98304,
    });
    expect(built.command.publisher.selection_policy_version).toBeTruthy();
    expect(built.command.publisher.validation_policy_version).toBeTruthy();
  });

  it("freezes exactly one member of the closed publisher vocabulary", async () => {
    const built = await build();
    if (!built.ok) throw new Error(built.detail);
    // Asserted against the shared vocabulary rather than a literal: a frozen
    // command must name the publisher that will actually execute it, and the
    // point of the closed set is that no third value can appear here at all.
    const known: readonly string[] = READING_PUBLISHER_PROVIDERS;
    expect(known).toEqual(["openai", "codex"]);
    expect(known).toContain(built.command.publisher.provider);
    expect(built.command.publisher.provider).toBe(READING_PUBLISHER_PROVIDER);
  });

  it("takes the target day as given rather than resolving today again", async () => {
    // The scheduler reserves tomorrow's edition before its local day starts.
    const tomorrow = new Date(Date.parse(`${today()}T12:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const built = await buildGenerationCommandV2(enabledEnv() as typeof env, IDENTITY_A, {
      readingId: "rdg_v2_test_0002",
      revision: 1,
      revisionReason: "initial",
      supersedesReadingId: null,
      reservationReason: "scheduled",
      commandGeneration: 1,
      replacesJobId: null,
      commandReplacementReason: null,
      targetLocalDate: tomorrow,
      now: new Date(),
    });
    if (!built.ok) throw new Error(built.detail);
    expect(built.command.target_local_date).toBe(tomorrow);
    expect(built.command.reservation_reason).toBe("scheduled");
    // The freeze instant is not the day anchor, and is legitimately outside it.
    expect(built.command.anchor_at >= built.command.day_start_at).toBe(true);
    expect(built.command.anchor_at < built.command.day_end_at).toBe(true);
  });

  it("refuses without a current ai_synthesis grant", async () => {
    await rows("DELETE FROM consents WHERE user_id = ?", USER_A);
    const built = await build();
    expect(built).toMatchObject({ ok: false, reason: "ai_synthesis_consent_required" });
  });

  it("refuses a grant under a policy version this deployment does not implement", async () => {
    await rows("DELETE FROM consents WHERE user_id = ?", USER_A);
    await grantAiSynthesis("9.9.9");
    const built = await build();
    expect(built).toMatchObject({ ok: false, reason: "ai_synthesis_consent_required" });
  });

  it("does not treat research or model_training as an ai_synthesis grant", async () => {
    await rows("DELETE FROM consents WHERE user_id = ?", USER_A);
    for (const kind of ["research", "model_training"]) {
      await rows(
        `INSERT INTO consents (id, user_id, kind, status, policy_version, allowed_uses_json,
           scopes_json, version, granted_at, created_at, updated_at)
         VALUES (?, ?, ?, 'granted', ?, '[]', '[]', 1, ?, ?, ?)`,
        `cns_${kind}`,
        USER_A,
        kind,
        AI_SYNTHESIS_POLICY_VERSION,
        "2026-08-09T00:00:00Z",
        "2026-08-09T00:00:00Z",
        "2026-08-09T00:00:00Z",
      );
    }
    const built = await build();
    expect(built).toMatchObject({ ok: false, reason: "ai_synthesis_consent_required" });
  });

  it("refuses while the publisher is not configured", async () => {
    const built = await buildGenerationCommandV2(env, IDENTITY_A, {
      readingId: "rdg_v2_test_0003",
      revision: 1,
      revisionReason: "initial",
      supersedesReadingId: null,
      reservationReason: "internal",
      commandGeneration: 1,
      replacesJobId: null,
      commandReplacementReason: null,
      targetLocalDate: today(),
      now: new Date(),
    });
    expect(built).toMatchObject({ ok: false, reason: "publisher_not_configured" });
  });

  it("derives content-addressed natal handles that two builds agree on", async () => {
    const [chart] = await rows<{ snapshot_json: string; uncertainty_json: string }>(
      "SELECT snapshot_json, uncertainty_json FROM chart_snapshots WHERE user_id = ?",
      USER_A,
    );
    const snapshot = {
      ...JSON.parse(chart!.snapshot_json),
      uncertainty: JSON.parse(chart!.uncertainty_json),
    };
    const first = await projectNatalFacts(snapshot);
    const second = await projectNatalFacts(snapshot);
    expect(first.map((f) => f.fact_id)).toEqual(second.map((f) => f.fact_id));
    expect(first.every((f) => /^nat_[a-f0-9]{32}$/.test(f.fact_id))).toBe(true);
  });
});

describe("V2 reservation", () => {
  it("binds constrained_model and a null release, and stores the command encrypted", async () => {
    const enqueued = await enqueueConstrainedReading(enabledEnv() as typeof env, USER_A, {
      entry: "internal",
      reservationReason: "internal",
      targetLocalDate: today(),
    });
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) return;

    const [row] = await rows<{
      assembly_mode: string;
      release_version: string | null;
      reading_key: string;
      status: string;
    }>(
      "SELECT assembly_mode, release_version, reading_key, status FROM daily_readings WHERE id = ?",
      enqueued.readingId,
    );
    expect(row!.assembly_mode).toBe("constrained_model");
    expect(row!.release_version).toBeNull();
    expect(row!.reading_key.startsWith("reading-v5:")).toBe(true);
    expect(row!.status).toBe("pending");

    const [job] = await rows<{ payload_enc: ArrayBuffer | null; payload_json: string | null }>(
      "SELECT payload_enc, payload_json FROM jobs WHERE id = ?",
      enqueued.jobId,
    );
    expect(job!.payload_enc).not.toBeNull();
    expect(job!.payload_json).toBeNull();
  });

  it("reads the command back as v2 through the same claim path as v1", async () => {
    const enqueued = await enqueueConstrainedReading(enabledEnv() as typeof env, USER_A, {
      entry: "internal",
      reservationReason: "internal",
      targetLocalDate: today(),
    });
    if (!enqueued.ok) throw new Error(enqueued.detail);

    const claim = await claimJob(env, enqueued.jobId);
    expect(claim).not.toBeNull();
    expect(isCommandV2(claim!.command)).toBe(true);
    expect(claim!.leaseExpiresAt).toBeTruthy();
    const command = claim!.command as GenerateDailyReadingCommandV2;
    expect(command.reading_id).toBe(enqueued.readingId);
  });

  it("keeps raw context values inside the encrypted envelope and nowhere else", async () => {
    const enqueued = await enqueueConstrainedReading(enabledEnv() as typeof env, USER_A, {
      entry: "internal",
      reservationReason: "internal",
      targetLocalDate: today(),
    });
    if (!enqueued.ok) throw new Error(enqueued.detail);

    const [job] = await rows<{
      payload_enc: ArrayBuffer;
      payload_key_version: number;
      payload_nonce: string;
    }>(
      "SELECT payload_enc, payload_key_version, payload_nonce FROM jobs WHERE id = ?",
      enqueued.jobId,
    );
    let binary = "";
    for (const byte of new Uint8Array(job!.payload_enc)) binary += String.fromCharCode(byte);
    const command = await decryptPayload<GenerateDailyReadingCommandV2>(
      env,
      IDENTITY_A,
      {
        key_version: job!.payload_key_version,
        nonce: job!.payload_nonce,
        ciphertext: btoa(binary),
      },
      { subject: IDENTITY_A.cryptoSubject, field: "jobs.payload_enc", recordId: enqueued.jobId },
    );
    expect(command.command_version).toBe("v2");
    expect(validateCommandV2(command)).toBe(true);
  });

  it.each(["off", "first_open", "hybrid"] as const)(
    "gates the internal entry point on the rollout (%s)",
    async (mode) => {
      const result = await enqueueConstrainedReading(enabledEnv(mode) as typeof env, USER_A, {
        entry: "scheduled",
        reservationReason: "scheduled",
        targetLocalDate: today(),
      });
      if (mode === "hybrid") {
        expect(result.ok).toBe(true);
      } else {
        expect(result).toMatchObject({ ok: false, reason: "rollout_disabled" });
      }
    },
  );

  it("reserves nothing and calculates nothing while the rollout is off", async () => {
    const result = await enqueueConstrainedReading(enabledEnv("off") as typeof env, USER_A, {
      entry: "internal",
      reservationReason: "internal",
      targetLocalDate: today(),
    });
    expect(result).toMatchObject({ ok: false, reason: "rollout_disabled" });
    expect(await rows("SELECT id FROM daily_readings WHERE user_id = ?", USER_A)).toEqual([]);
    expect(await rows("SELECT id FROM jobs WHERE user_id = ?", USER_A)).toEqual([]);
    // The kill switch has to cost nothing at all: no scan means no cycle rows.
    expect(await rows("SELECT id FROM cycle_instances WHERE user_id = ?", USER_A)).toEqual([]);
  });

  it("pins stored reading feedback once the USR-12 grant exists", async () => {
    const { ensureFirstPartyGrant, USR12_SOURCE_ID } = await import("../db/first-party-sources.js");
    await rows(
      `INSERT INTO daily_readings
         (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
          contract_id, assembly_mode, status, revision, revision_reason,
          command_generation, created_at, updated_at)
       VALUES ('rdg_fb_cmd_0001', ?, '2026-08-08', NULL, ?, 'sha256:f', 'c',
               'constrained_model', 'failed', 1, 'initial', 1, ?, ?)`,
      USER_A,
      `reading-v5:${USER_A}:2026-08-08:r1`,
      "2026-08-08T00:00:00Z",
      "2026-08-08T00:00:00Z",
    );
    await rows(
      `INSERT INTO reading_feedback (id, reading_id, user_id, resonance,
         relevance_labels_json, created_at)
       VALUES ('rfb_cmd_0001', 'rdg_fb_cmd_0001', ?, 'helpful', '["work"]', ?)`,
      USER_A,
      "2026-08-08T12:00:00Z",
    );
    await ensureFirstPartyGrant(env, IDENTITY_A, USR12_SOURCE_ID);

    const built = await build();
    if (!built.ok) throw new Error(built.detail);
    const pins = built.command.context.filter((pin) => pin.source_id === USR12_SOURCE_ID);
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.every((pin) => pin.category === "reading_feedback")).toBe(true);
    expect(new Set(pins.map((pin) => pin.allowed_use))).toEqual(
      new Set(["repetition_control", "theme_ranking"]),
    );
    expect(pins[0]!.snapshot).toEqual({
      kind: "structured",
      value: { resonance: "helpful", relevance_labels: ["work"] },
    });
  });

  it("pins topic exclusions under theme_filtering", async () => {
    const { storeTopicExclusions } = await import("../db/topic-exclusions.js");
    const stored = await storeTopicExclusions(
      env,
      IDENTITY_A,
      "idem-cmd-exclusions-1",
      ["relationships", "work"],
    );
    expect(stored.ok).toBe(true);

    const built = await build();
    if (!built.ok) throw new Error(built.detail);
    const pins = built.command.context.filter((pin) => pin.source_id === "USR-05");
    expect(pins).toEqual([
      expect.objectContaining({
        source_id: "USR-05",
        allowed_use: "theme_filtering",
        category: "enabled_personal_context",
        snapshot: {
          kind: "structured",
          value: { excluded_topics: ["relationships", "work"] },
        },
      }),
    ]);
  });
});
