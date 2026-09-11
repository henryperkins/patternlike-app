import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import type {
  CodexPortraitCompletion,
  CodexPortraitClaim,
  PatternPortraitResponse,
  PatternResponseV7,
} from "@patternlike/shared";
import { b64 } from "../crypto.js";
import { contentHash } from "@patternlike/shared";
import { decryptPatternDocument, loadAnyPatternDocument } from "../services/pattern-state.js";
import { encryptUnderContentKey, randomNonce, unwrapContentKey } from "../services/pattern-crypto.js";

import { collectDeletionArtifactKeys } from "../services/deletion-manifest.js";
import { app } from "../index.js";
import { createSyntheticPatternPublisher } from "../services/pattern-publisher-factory.js";
import { executePatternJob } from "../services/pattern-execute.js";
import {
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  confirmPreferences,
  disablePatternAi,
  enablePatternAi,
  resetDb,
  seedActiveOntology,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  clearPatternReplayObjects,
  generatePatternReplayTestKeys,
  installPatternReplayTestKeys,
} from "../../test/pattern-replay-fixtures.js";

const TOKEN = "portrait-test-runner-token-1234567890";
const enabledEnv = () =>
  Object.defineProperties(Object.create(env), {
    PATTERN_PORTRAIT_ENABLED: { value: "1", configurable: true },
    PATTERN_PORTRAIT_MESH_ENABLED: { value: "1", configurable: true },
    PATTERN_ADAPTIVE_PORTRAITS_ENABLED: { value: "1", configurable: true },
    CODEX_RUNNER_TOKEN: { value: TOKEN, configurable: true },
  });
async function user(
  path: string,
  body?: unknown,
  userId = USER_A,
  extra: RequestInit = {},
) {
  return app.fetch(
    new Request(`https://api.test${path}`, {
      method: body === undefined ? "GET" : "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      ...extra,
      headers: {
        "x-user-id": userId,
        "content-type": "application/json",
        "idempotency-key": "portrait-create-test-0001",
        ...extra.headers,
      },
    }),
    enabledEnv(),
  );
}
async function machine(path: string, body: unknown, bindings = enabledEnv(), protocol = "v1") {
  return app.fetch(
    new Request(`https://api.test/codex-provider/v1/portraits${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        ...(protocol === "v2" ? { "X-Patternlike-Portrait-Protocol": "v2" } : {}),
      },
    }),
    bindings,
  );
}
let document: PatternResponseV7;
let chartId: string;

beforeEach(async () => {
  const chapterCount = Number(expect.getState().currentTestName?.match(/adaptive count=(3|4|5|6)/)?.[1] ?? 4);
  await resetDb();
  await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
  installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
  enablePatternAi();
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A);
  ({ chartId } = await seedChart(IDENTITY_A, {
    positions: [
      "sun",
      "moon",
      "mercury",
      "venus",
      "mars",
      "jupiter",
      "saturn",
      "uranus",
      "neptune",
      "pluto",
    ].map((body, index) => ({
      body: body as "sun",
      longitude_deg: 12 + index * 31,
      speed_longitude_deg_per_day: 1,
      retrograde: false,
    })),
  }));
  await seedActiveOntology();
  const res = await user("/v1/pattern-generations", {
    schema_version: "0.7.0",
    consent_policy_version: "1.1.0",
    confirm: "GENERATE MY PATTERN",
    reason: "first_open",
  });
  expect(res.status).toBe(202);
  const accepted = (await res.json()) as {
    generation: { generation_id: string };
  };
  for (let step = 0; step < 8; step++) {
    const row = await env.DB.prepare(
      "SELECT job_id, stage, stage_generation FROM pattern_generation_jobs WHERE generation_id = ?",
    )
      .bind(accepted.generation.generation_id)
      .first<{ job_id: string; stage: string; stage_generation: number }>();
    if (row?.stage === "succeeded") break;
    if (!row || row.stage === "failed")
      throw new Error("fixture Pattern failed");
    await executePatternJob(
      env,
      {
        kind: "pattern_generation",
        job_id: row.job_id,
        generation_id: accepted.generation.generation_id,
        stage_generation: row.stage_generation,
      },
      new Date(),
      {
        publisher: ({ pin, packet, ontology }) => {
          const four = structuredClone(packet) as {
            selection_constraints: {
              core_chapters_min: number;
              core_chapters_max: number;
            };
          };
          four.selection_constraints.core_chapters_min = 4;
          four.selection_constraints.core_chapters_max = 4;
          return createSyntheticPatternPublisher({
            forceReject: false,
            packet: four,
            ontology,
            publisher: pin.publisher,
            measured: true,
          });
        },
      },
    );
  }
  const pattern = await user("/v1/pattern");
  expect(pattern.status).toBe(200);
  document = (await pattern.json()) as PatternResponseV7;
  if (chapterCount !== 4) await replaceChapterCount(chapterCount);
  expect(document.core_chapters).toHaveLength(chapterCount);
});
afterEach(() => {
  disablePatternAi();
});

import {
  maintainPortraitMeshes,
  claimPortraitMesh,
  completePortraitMesh,
  failPortraitMesh,
} from "../services/pattern-portrait-mesh.js";
function automation(enabled = true) {
  return {
    chart_id: chartId,
    enabled,
    consent_policy_version: "1.1.0",
    confirm: enabled
      ? "ENABLE AUTOMATIC PORTRAITS"
      : "DISABLE AUTOMATIC PORTRAITS",
  };
}
async function preference(enabled = true) {
  return user("/v1/pattern-portrait/automation", automation(enabled), USER_A, {
    method: "PUT",
  });
}
describe("explicit portrait automation", () => {
  it("defaults off without expanding written Pattern consent, then queues one durable start", async () => {
    const before = await user("/v1/pattern-portrait/automation");
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({
      enabled: false,
      available: true,
      chart_id: chartId,
    });
    expect((await preference()).status).toBe(200);
    expect((await preference()).status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM portrait_start_outbox",
      ).first(),
    ).toEqual({ n: 1 });
    await maintainPortraitMeshes(enabledEnv());
    await maintainPortraitMeshes(enabledEnv());
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM pattern_portrait_jobs",
      ).first(),
    ).toEqual({ n: 4 });
    expect(
      await env.DB.prepare("SELECT status FROM portrait_start_outbox").first(),
    ).toEqual({ status: "complete" });
  });
  it("withdraws unfinished automatic work without requiring a fresh Pattern consent", async () => {
    await preference();
    await maintainPortraitMeshes(enabledEnv());
    expect((await preference(false)).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT status FROM pattern_portraits").first(),
    ).toEqual({ status: "failed" });
    expect(
      await user("/v1/pattern-portrait/automation").then((r) => r.json()),
    ).toMatchObject({ enabled: false });
  });
  it("rejects stale chart consent and keeps disabled deployments query-safe", async () => {
    expect(
      (
        await user(
          "/v1/pattern-portrait/automation",
          { ...automation(), chart_id: "stale" },
          USER_A,
          { method: "PUT" },
        )
      ).status,
    ).toBe(409);
    const response = await app.fetch(
      new Request("https://api.test/v1/pattern-portrait/explorer", {
        headers: { "x-user-id": USER_A },
      }),
      Object.defineProperty(Object.create(env), "PATTERN_PORTRAIT_ENABLED", {
        value: undefined,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "unavailable",
      models: [],
    });
  });

  it.each(["snapshot", "grant"] as const)("an old %s read cannot cancel a newer explicit automation start", async (phase) => {
    await preference();
    const original = await env.DB.prepare("SELECT id,grant_id FROM portrait_start_outbox").first<{ id: string; grant_id: string }>();
    let injected = false;
    const wrap = (statement: D1PreparedStatement, query: string): D1PreparedStatement => new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") return (...values: unknown[]) => wrap(target.bind(...values), query);
        const value = Reflect.get(target, property, receiver);
        const selected = phase === "snapshot"
          ? property === "all" && query.startsWith("UPDATE portrait_start_outbox SET checked_at=")
          : property === "first" && query.startsWith("SELECT * FROM portrait_automation_grants WHERE");
        if (selected) return async (...args: unknown[]) => {
          const result = await Reflect.apply(value, target, args);
          if (!injected) {
            injected = true;
            expect((await preference(false)).status).toBe(200);
            expect((await preference()).status).toBe(200);
          }
          return result;
        };
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const database = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === "prepare") return (query: string) => wrap(target.prepare(query), query);
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await maintainPortraitMeshes(Object.defineProperty(enabledEnv(), "DB", { value: database }));
    expect(injected).toBe(true);
    const replacement = await env.DB.prepare("SELECT id,grant_id,status FROM portrait_start_outbox").first<{ id: string; grant_id: string; status: string }>();
    expect(replacement).toMatchObject({ id: original!.id, status: "pending" });
    expect(replacement!.grant_id).not.toBe(original!.grant_id);
    await maintainPortraitMeshes(enabledEnv());
    expect(await env.DB.prepare("SELECT status FROM portrait_start_outbox").first()).toEqual({ status: "complete" });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM pattern_portrait_jobs").first()).toEqual({ n: 4 });
  });
});

import {
  canonicalJson,
  sha256Hex,
  type CodexPortraitMeshClaim,
  type CodexPortraitMeshCompletion,
} from "@patternlike/shared";
import { fixtureGlb } from "../../test/portrait-mesh-fixture.js";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII=";
async function images(count = 4, adaptive = false) {
  if (adaptive) {
    const result = await user("/v1/pattern-portrait/automation", { ...automation(), consent_policy_version: "2.0.0" }, USER_A,
      { method: "PUT", headers: { "X-Patternlike-Portrait-Protocol": "v2" } });
    expect(result.status, await result.clone().text()).toBe(200);
  } else await preference();
  await maintainPortraitMeshes(enabledEnv());
  for (let i = 0; i < count; i++) {
    const claim = (await (
      await machine("/claim", {}, enabledEnv(), adaptive ? "v2" : "v1")
    ).json()) as CodexPortraitClaim;
    const pixels = new Uint8Array(128 * 128 * 4);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const at = (y * 128 + x) * 4;
        pixels[at] =
          pixels[at + 1] =
          pixels[at + 2] =
            x > 25 && x < 97 && y > 20 && y < 108 ? 32 : 255;
        pixels[at + 3] = 255;
      }
    const completion: CodexPortraitCompletion = {
      ...(claim.schema_version === "codex-portrait-claim/v2" ? { schema_version: "codex-portrait-completion/v2" as const,
        chapter_count: claim.chapter_count, chapter_index: claim.chapter_index, chapter_id: claim.chapter_id,
        document_revision: claim.document_revision } : {}),
      lease_token: claim.lease_token,
      source_sha256: claim.source_sha256,
      label: "Source object",
      rationale: "Expresses chapter",
      image_base64: PNG,
      original_sha256: "a".repeat(64),
      pixels: { width: 128, height: 128, rgba_base64: b64(pixels) },
      provider_request_id: "thread:turn",
      image_request_id: "native-tool",
      image_model: "gpt-image-2",
    };
    const result = await machine(`/${claim.job_id}/complete`, completion, enabledEnv(), adaptive ? "v2" : "v1");
    expect(result.status, await result.clone().text()).toBe(200);
  }
  return (await (
    await user("/v1/pattern-portrait", undefined, USER_A, { headers: adaptive ? { "X-Patternlike-Portrait-Protocol": "v2" } : {} })
  ).json()) as PatternPortraitResponse;
}
async function meshMachine(path: string, body: unknown, bindings = enabledEnv(), protocol = "v1") {
  return app.fetch(
    new Request(`https://api.test/codex-provider/v1/portrait-meshes${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        ...(protocol === "v2" ? { "X-Patternlike-Portrait-Protocol": "v2" } : {}),
      },
    }),
    bindings,
  );
}
async function meshCompletion(
  claim: CodexPortraitMeshClaim,
): Promise<CodexPortraitMeshCompletion> {
  const program = {
    ...(claim.schema_version === "codex-portrait-mesh-claim/v2"
      ? { version: "portrait-mesh-program/v2" as const, chapter_count: claim.chapter_count, chapter_id: claim.chapter_id }
      : { version: "portrait-mesh-program/v1" as const }),
    materials: [
      { id: "solid", color: "#778899", metalness: 0, roughness: 0.5 },
    ],
    parts: [
      {
        name: "Body",
        material: "solid",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        repeat: null,
        geometry: {
          kind: "box" as const,
          size: [1, 1, 1] as [number, number, number],
          bevel: 0,
        },
      },
    ],
  };
  const programHash = await sha256Hex(canonicalJson(program));
  const glb = fixtureGlb({
    chapterId: claim.chapter_id,
    documentRevision: claim.document_revision,
    sourceImageSha256: claim.source_image_sha256,
    sourceTextSha256: claim.source_text_sha256,
    programSha256: programHash,
    compilerVersion: claim.compiler_version,
    authoring: claim.schema_version === "codex-portrait-mesh-claim/v2" ? "codex-parametric/v2" : "codex-parametric/v1",
    ...(claim.schema_version === "codex-portrait-mesh-claim/v2" ? { chapterCount: claim.chapter_count } : {}),
  });
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", glb)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
  return {
    ...(claim.schema_version === "codex-portrait-mesh-claim/v2" ? { schema_version: "codex-portrait-mesh-completion/v2" as const,
      chapter_count: claim.chapter_count, chapter_index: claim.chapter_index, chapter_id: claim.chapter_id,
      document_revision: claim.document_revision } : {}),
    lease_token: claim.lease_token,
    program,
    program_sha256: programHash,
    glb_base64: b64(glb),
    glb_sha256: hash,
    compiler_version: claim.compiler_version,
    audit: {
      schema_version: "portrait-mesh-audit/v1",
      accepted: true,
      recognizable: true,
      substantial: true,
      source_correspondence: true,
      no_severe_intersections: true,
      view_count: 4,
      notes: "Checked four views",
    },
    provider_request_id: "mesh:turn",
    audit_request_id: "audit:turn",
  } as CodexPortraitMeshCompletion;
}

async function replaceChapterCount(count: number) {
  const row = (await loadAnyPatternDocument(env, USER_A))!;
  const internal = await decryptPatternDocument(env, IDENTITY_A, row);
  internal.artifact.chapters = Array.from({ length: count }, (_, index) => ({
    ...internal.artifact.chapters[index % 4]!, chapter_key: `chapter_0${index + 1}`,
  }));
  const key = await unwrapContentKey(env, IDENTITY_A, row.id, "pattern_documents.wrapped_document_key_enc", {
    key_version: row.wrapped_document_key_version, nonce: row.wrapped_document_key_nonce, ciphertext: b64(row.wrapped_document_key_enc),
  });
  const nonce = randomNonce();
  const cipher = await encryptUnderContentKey(internal, key, nonce, new TextEncoder().encode(JSON.stringify(["patternlike.pattern-document", 1, row.id, row.generation_id])));
  await env.DB.prepare("UPDATE pattern_documents SET document_enc=?,document_nonce=?,content_hash=? WHERE id=?")
    .bind(cipher, b64(nonce), await contentHash(JSON.stringify(internal)), row.id).run();
  document = await (await user("/v1/pattern")).json() as PatternResponseV7;
}
const adaptiveHeaders = { "X-Patternlike-Portrait-Protocol": "v2" };
const adaptiveUser = (path: string) => user(path, undefined, USER_A, { headers: adaptiveHeaders });
const adaptiveOff = () => Object.defineProperty(enabledEnv(), "PATTERN_ADAPTIVE_PORTRAITS_ENABLED", { value: "0" });

describe("adaptive mesh artwork v2", () => {
  it.each([3, 4, 5, 6])("adaptive count=%i completes and downloads every ordered model", async (count) => {
    const portrait = await images(count, true);
    expect(portrait).toMatchObject({ schema_version: "pattern-portrait/v2", chapter_count: count, status: "ready" });
    // Capability filtering happens before lease acquisition, leaving v2 jobs untouched.
    expect((await meshMachine("/claim", {})).status).toBe(204);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM portrait_mesh_jobs WHERE attempts!=0 OR status!='pending'").first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM portrait_mesh_jobs").first()).toEqual({ n: count });
    expect(await user("/v1/pattern-portrait/explorer").then(result => result.json())).toMatchObject({
      schema_version: "pattern-portrait-explorer/v1", status: "unavailable", models: [],
    });
    for (let index = 0; index < count; index++) {
      const response = await meshMachine("/claim", {}, enabledEnv(), "v2");
      expect(response.status, await response.clone().text()).toBe(200);
      const claim = await response.json() as CodexPortraitMeshClaim;
      expect(claim).toMatchObject({ schema_version: "codex-portrait-mesh-claim/v2", chapter_count: count,
        chapter_index: index, chapter_id: `chapter-${index + 1}`, document_revision: portrait.document_revision,
        compiler_version: "portrait-mesh-compiler/v2", prompt_version: "portrait-mesh/v2" });
      const input = await meshCompletion(claim);
      // Already-reserved work finishes even when adaptive production is disabled.
      const complete = await meshMachine(`/${claim.job_id}/complete`, input, adaptiveOff(), "v2");
      expect(complete.status, await complete.clone().text()).toBe(200);
      expect(await complete.json()).toMatchObject({ schema_version: "codex-portrait-mesh-terminal/v2" });
      const progress = await adaptiveUser("/v1/pattern-portrait/explorer").then(result => result.json()) as {
        status: string; completed_models: number; models: Array<{ chapter_id: string; reference_id: string }>;
      };
      expect(progress.completed_models).toBe(index + 1);
      expect(progress.status).toBe(index === count - 1 ? "ready" : "generating");
      expect(progress.models).toHaveLength(index === count - 1 ? count : 0);
    }
    const url = new URLSearchParams({ chart_id: chartId, pattern_id: document.pattern_id, generated_at: document.generated_at });
    const download = await adaptiveUser(`/v1/pattern-portrait/explorer/download?${url}`);
    expect(download.status, await download.clone().text()).toBe(200);
    expect(download.headers.get("vary")).toContain("X-Patternlike-Portrait-Protocol");
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    const bundle = await download.json() as { schema_version: string; images: unknown[];
      models: Array<{ reference_id: string; program: { chapter_id: string; chapter_count: number }; audit: { view_count: number } }> };
    expect(bundle.schema_version).toBe("pattern-portrait-explorer-download/v2");
    expect(bundle.images).toHaveLength(count);
    expect(bundle.models).toHaveLength(count);
    expect(bundle.models.map(model => model.program.chapter_id)).toEqual(Array.from({ length: count }, (_, index) => `chapter-${index + 1}`));
    expect(bundle.models.every(model => model.program.chapter_count === count && model.audit.view_count === 4)).toBe(true);
    expect((await user(`/v1/pattern-portrait/models/${bundle.models.at(-1)!.reference_id}`)).status).toBe(404);
    expect((await adaptiveUser(`/v1/pattern-portrait/models/${bundle.models.at(-1)!.reference_id}`)).status).toBe(200);
    const offRead = await app.fetch(new Request("https://api.test/v1/pattern-portrait/explorer", {
      headers: { "x-user-id": USER_A, ...adaptiveHeaders },
    }), adaptiveOff());
    expect(await offRead.json()).toMatchObject({ status: "ready", completed_models: count });
  }, 30000);

  it("adaptive count=6 requires renewed policy and supports withdrawal with creation disabled", async () => {
    expect((await preference()).status).toBe(200);
    const old = await env.DB.prepare("SELECT id,policy_version FROM portrait_automation_grants WHERE enabled=1").first();
    await maintainPortraitMeshes(enabledEnv());
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM pattern_portraits").first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT status FROM portrait_start_outbox").first()).toEqual({ status: "unsupported" });
    expect(await adaptiveUser("/v1/pattern-portrait/automation").then(result => result.json())).toMatchObject({ enabled: false, available: true, consent_policy_version: "2.0.0" });
    await images(6, true);
    // A legacy client cannot implicitly cancel the new wider grant or its jobs.
    expect((await preference()).status).toBe(409);
    expect(await env.DB.prepare("SELECT policy_version FROM portrait_automation_grants WHERE enabled=1").first()).toEqual({ policy_version: "2.0.0" });
    expect(await env.DB.prepare("SELECT id,policy_version FROM portrait_automation_grants WHERE enabled=0").first()).toEqual(old);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM portrait_start_outbox").first()).toEqual({ n: 1 });
    const claimResponse = await meshMachine("/claim", {}, enabledEnv(), "v2");
    const claim = await claimResponse.json() as CodexPortraitMeshClaim;
    const disabled = await app.fetch(new Request("https://api.test/v1/pattern-portrait/automation", {
      method: "PUT", headers: { "x-user-id": USER_A, "content-type": "application/json", ...adaptiveHeaders },
      body: JSON.stringify({ ...automation(false), consent_policy_version: "2.0.0" }),
    }), adaptiveOff());
    expect(disabled.status, await disabled.clone().text()).toBe(200);
    expect(await disabled.json()).toMatchObject({ enabled: false, available: false });
    expect((await meshMachine(`/${claim.job_id}/complete`, await meshCompletion(claim), adaptiveOff(), "v2")).status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM portrait_mesh_jobs WHERE status='running'").first()).toEqual({ n: 0 });
  });

  it("adaptive count=6 binds terminal schema, count, revision, source and GLB identity", async () => {
    await images(6, true);
    const claim = await meshMachine("/claim", {}, enabledEnv(), "v2").then(result => result.json()) as CodexPortraitMeshClaim;
    const input = await meshCompletion(claim);
    expect((await meshMachine(`/${claim.job_id}/complete`, input)).status).toBe(400);
    for (const mutation of [
      { schema_version: "codex-portrait-mesh-completion/v1" },
      { chapter_count: 5 }, { chapter_index: 1, chapter_id: "chapter-2" },
      { document_revision: "different-revision" }, { compiler_version: "portrait-mesh-compiler/v1" },
      { program: { ...input.program, version: "portrait-mesh-program/v1" } },
    ]) {
      const response = await meshMachine(`/${claim.job_id}/complete`, { ...input, ...mutation }, enabledEnv(), "v2");
      expect([400, 409]).toContain(response.status);
    }
    const wrongCountGlb = fixtureGlb({ chapterId: claim.chapter_id, chapterCount: 5,
      documentRevision: claim.document_revision, sourceTextSha256: claim.source_text_sha256,
      sourceImageSha256: claim.source_image_sha256, compilerVersion: claim.compiler_version,
      programSha256: input.program_sha256, authoring: "codex-parametric/v2" });
    const wrongCountHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", wrongCountGlb)), byte => byte.toString(16).padStart(2, "0")).join("");
    expect((await meshMachine(`/${claim.job_id}/complete`, { ...input, glb_base64: b64(wrongCountGlb), glb_sha256: wrongCountHash }, enabledEnv(), "v2")).status).toBe(400);
    const legacy = { ...input } as Record<string, unknown>;
    for (const key of ["schema_version", "chapter_count", "chapter_index", "chapter_id", "document_revision"]) delete legacy[key];
    expect((await meshMachine(`/${claim.job_id}/complete`, legacy)).status).toBe(409);
    expect((await meshMachine(`/${claim.job_id}/fail`, { lease_token: claim.lease_token, code: "generation_failed" })).status).toBe(409);
    expect(await env.DB.prepare("SELECT status,attempts FROM portrait_mesh_jobs WHERE id=?").bind(claim.job_id).first()).toEqual({ status: "running", attempts: 1 });
    const failure = { schema_version: "codex-portrait-mesh-failure/v2", chapter_count: 6, chapter_index: claim.chapter_index,
      chapter_id: claim.chapter_id, document_revision: claim.document_revision, lease_token: claim.lease_token, code: "generation_failed" };
    expect((await meshMachine(`/${claim.job_id}/fail`, failure)).status).toBe(400);
    expect((await meshMachine(`/${claim.job_id}/fail`, failure, adaptiveOff(), "v2")).status).toBe(200);
  });

  it("adaptive count=6 resumes its reserved image jobs after renewed consent and admission rollback", async () => {
    const update = (enabled: boolean, headers: Record<string, string> = adaptiveHeaders) => user("/v1/pattern-portrait/automation",
      { ...automation(enabled), consent_policy_version: "2.0.0" }, USER_A, { method: "PUT", headers });
    expect((await update(true, {})).status).toBe(400);
    expect((await update(true)).status).toBe(200);
    await maintainPortraitMeshes(enabledEnv());
    const claim = await (await machine("/claim", {}, enabledEnv(), "v2")).json() as CodexPortraitClaim;
    expect(claim.chapter_index).toBe(0);
    expect((await update(false)).status).toBe(200);
    expect(await env.DB.prepare("SELECT status,attempts FROM pattern_portrait_jobs WHERE id=?").bind(claim.job_id).first())
      .toEqual({ status: "cancelled", attempts: 1 });
    expect((await update(true)).status).toBe(200);
    await maintainPortraitMeshes(adaptiveOff());
    expect(await env.DB.prepare("SELECT status,attempts FROM pattern_portrait_jobs WHERE id=?").bind(claim.job_id).first())
      .toEqual({ status: "pending", attempts: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM pattern_portrait_jobs").first()).toEqual({ n: 6 });
    expect(await env.DB.prepare("SELECT status FROM portrait_start_outbox").first()).toEqual({ status: "complete" });
    const resumed = await (await machine("/claim", {}, adaptiveOff(), "v2")).json() as CodexPortraitClaim;
    expect(resumed.job_id).toBe(claim.job_id);
    expect(await env.DB.prepare("SELECT attempts FROM pattern_portrait_jobs WHERE id=?").bind(claim.job_id).first())
      .toEqual({ attempts: 2 });
  });

  it("shows and stops the original grant when adaptive creation is disabled", async () => {
    await preference();
    const response = await app.fetch(new Request("https://api.test/v1/pattern-portrait/automation", {
      headers: { "x-user-id": USER_A, ...adaptiveHeaders },
    }), adaptiveOff());
    expect(await response.json()).toMatchObject({ enabled: false, legacy_enabled: true, available: false, chart_id: chartId });
    const disabled = await app.fetch(new Request("https://api.test/v1/pattern-portrait/automation", {
      method: "PUT", headers: { "x-user-id": USER_A, "content-type": "application/json", ...adaptiveHeaders },
      body: JSON.stringify(automation(false)),
    }), adaptiveOff());
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toMatchObject({ enabled: false, legacy_enabled: false, available: false });
  });

  it("adaptive count=3 fences revoked consent and erases model inventory with the document", async () => {
    await images(3, true);
    const claim = await meshMachine("/claim", {}, enabledEnv(), "v2").then(result => result.json()) as CodexPortraitMeshClaim;
    const input = await meshCompletion(claim);
    expect((await meshMachine(`/${claim.job_id}/complete`, input, enabledEnv(), "v2")).status).toBe(200);
    const unfinished = await meshMachine("/claim", {}, enabledEnv(), "v2").then(result => result.json()) as CodexPortraitMeshClaim;
    await env.DB.prepare("UPDATE consents SET status='revoked' WHERE user_id=? AND kind='pattern_generation'").bind(USER_A).run();
    expect((await meshMachine(`/${unfinished.job_id}/complete`, await meshCompletion(unfinished), adaptiveOff(), "v2")).status).toBe(409);
    expect(await env.DB.prepare("SELECT status FROM portrait_mesh_jobs WHERE id=?").bind(claim.job_id).first()).toEqual({ status: "complete" });
    await env.DB.prepare("DELETE FROM pattern_documents WHERE user_id=?").bind(USER_A).run();
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM portrait_mesh_assets WHERE cleanup_at IS NULL").first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM portrait_mesh_assets").first()).toEqual({ n: 2 });
    await maintainPortraitMeshes(adaptiveOff());
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM portrait_mesh_assets WHERE deleted_at IS NOT NULL").first()).toEqual({ n: 2 });
  });

  it("keeps existing four-chapter assets and v1 claims readable by a v2 client", async () => {
    await images();
    const response = await meshMachine("/claim", {}, enabledEnv(), "v2");
    const claim = await response.json() as CodexPortraitMeshClaim;
    expect(claim.schema_version).toBe("codex-portrait-mesh-claim/v1");
    expect((await meshMachine(`/${claim.job_id}/complete`, await meshCompletion(claim), enabledEnv(), "v2")).status).toBe(200);
    expect(await adaptiveUser("/v1/pattern-portrait/explorer").then(result => result.json())).toMatchObject({ schema_version: "pattern-portrait-explorer/v1", completed_models: 1 });
  });
});

describe("private durable models", () => {
  it("repairs accepted images, admits exact source, and delivers only complete owner models", async () => {
    const portrait = await images();
    expect(portrait.status).toBe("ready");
    const references: string[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await meshMachine("/claim", {});
      expect(response.status).toBe(200);
      const claim = (await response.json()) as CodexPortraitMeshClaim;
      expect(claim.source_text).toBe(portrait.chapters[i]!.source_text);
      expect(claim.image_base64).toBe(PNG);
      expect(claim.source_text_sha256).toBe(await sha256Hex(claim.source_text));
      const input = await meshCompletion(claim);
      expect(
        (
          await meshMachine(`/${claim.job_id}/complete`, {
            ...input,
            program_sha256: "0".repeat(64),
          })
        ).status,
      ).toBe(400);
      const before = Date.now();
      const finish = await meshMachine(`/${claim.job_id}/complete`, input);
      expect(finish.status, await finish.clone().text()).toBe(200);
      const first = await env.DB.prepare("SELECT completed_at FROM portrait_mesh_jobs WHERE id = ?").bind(claim.job_id).first<{completed_at: string}>();
      expect(Date.parse(first!.completed_at)).toBeGreaterThanOrEqual(before);
      expect(
        (await meshMachine(`/${claim.job_id}/complete`, input)).status,
      ).toBe(200);
      expect(await env.DB.prepare("SELECT completed_at FROM portrait_mesh_jobs WHERE id = ?").bind(claim.job_id).first()).toEqual(first);
      const state = (await (
        await user("/v1/pattern-portrait/explorer")
      ).json()) as {
        status: string;
        completed_models: number;
        models: Array<{ reference_id: string }>;
      };
      expect(state.completed_models).toBe(i + 1);
      expect(state.status).toBe(i === 3 ? "ready" : "generating");
      references.push(...state.models.map((m) => m.reference_id));
    }
    const model = await user(`/v1/pattern-portrait/models/${references[0]}`);
    expect(model.status).toBe(200);
    expect(model.headers.get("cache-control")).toBe("private, no-store");
    expect(model.headers.get("content-type")).toBe("model/gltf-binary");
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_B);
    await seedChart(IDENTITY_B);
    expect(
      (
        await user(
          `/v1/pattern-portrait/models/${references[0]}`,
          undefined,
          USER_B,
        )
      ).status,
    ).toBe(404);
    expect(
      (await collectDeletionArtifactKeys(enabledEnv(), USER_A)).filter((k) =>
        k.startsWith("portrait-meshes/"),
      ),
    ).toHaveLength(8);
    const url = new URLSearchParams({
      chart_id: chartId,
      pattern_id: document.pattern_id,
      generated_at: document.generated_at,
    });
    const download = await user(
      `/v1/pattern-portrait/explorer/download?${url}`,
    );
    expect(download.status).toBe(200);
    const bundle = await download.json() as { images: Array<{ image_model_provenance: unknown }> };
    expect(bundle).toMatchObject({
      reading: document,
      models: expect.any(Array),
      images: expect.any(Array),
    });
    expect(bundle.images).toHaveLength(4);
    for (const image of bundle.images) expect(image.image_model_provenance).toEqual({
      schema_version: "portrait-image-model-provenance/v1", requested_image_model: "gpt-image-2",
      observed_image_model: null, observation_status: "legacy_unrecorded", codex_cli_version: null,
    });
  });
  it("withdrawal cancels meshes after the legacy graph is ready and rejects late completion", async () => {
    await images();
    const claim = (await (
      await meshMachine("/claim", {})
    ).json()) as CodexPortraitMeshClaim;
    const input = await meshCompletion(claim);
    await preference(false);
    expect(
      await user("/v1/pattern-portrait").then((r) => r.json()),
    ).toMatchObject({ status: "ready" });
    expect((await meshMachine(`/${claim.job_id}/complete`, input)).status).toBe(
      409,
    );
    expect((await meshMachine("/claim", {})).status).toBe(204);
  });
  it("reclaims expiring leases with a bounded automatic visual retry budget", async () => {
    await images();
    let now = new Date();
    let claim = await claimPortraitMesh(enabledEnv(), now);
    expect(claim).not.toBeNull();
    const first = claim!;
    now = new Date(now.getTime() + 21 * 60000);
    claim = await claimPortraitMesh(enabledEnv(), now);
    expect(claim?.job_id).toBe(first.job_id);
    expect(claim?.lease_token).not.toBe(first.lease_token);
    expect(
      (
        await meshMachine(
          `/${first.job_id}/complete`,
          await meshCompletion(first),
        )
      ).status,
    ).toBe(409);
    await failPortraitMesh(
      enabledEnv(),
      claim!.job_id,
      { lease_token: claim!.lease_token, code: "visual_check_failed" },
      now,
    );
    await expect(
      failPortraitMesh(
        enabledEnv(),
        claim!.job_id,
        { lease_token: claim!.lease_token, code: "visual_check_failed" },
        now,
      ),
    ).resolves.toBeUndefined();
    now = new Date(now.getTime() + 61000);
    claim = await claimPortraitMesh(enabledEnv(), now);
    expect(claim?.job_id).toBe(first.job_id);
    await failPortraitMesh(
      enabledEnv(),
      claim!.job_id,
      { lease_token: claim!.lease_token, code: "visual_check_failed" },
      now,
    );
    expect(
      await env.DB.prepare(
        "SELECT status,attempts FROM portrait_mesh_jobs WHERE id=?",
      )
        .bind(first.job_id)
        .first(),
    ).toEqual({ status: "failed", attempts: 3 });
  });
});

function withMeshPut(put: R2Bucket["put"]) {
  return Object.defineProperty(enabledEnv(), "ARTIFACTS", {
    value: new Proxy(env.ARTIFACTS!, {
      get(target, property, receiver) {
        if (property === "put") return put;
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  });
}
it("retains live inventory through transient storage failure and accepts the same completion retry", async () => {
  await images();
  const claim = await claimPortraitMesh(enabledEnv());
  const input = await meshCompletion(claim!);
  await expect(
    completePortraitMesh(
      withMeshPut((async () => {
        throw new Error("storage down");
      }) as R2Bucket["put"]),
      claim!.job_id,
      input,
    ),
  ).rejects.toMatchObject({ status: 503 });
  await expect(
    completePortraitMesh(enabledEnv(), claim!.job_id, input),
  ).resolves.toBeUndefined();
  expect(
    await env.DB.prepare("SELECT status FROM portrait_mesh_jobs WHERE id=?")
      .bind(claim!.job_id)
      .first(),
  ).toEqual({ status: "complete" });
});
it("withdrawal during upload fences acceptance, retains the graph, and sweeps late model bytes", async () => {
  await images();
  const claim = await claimPortraitMesh(enabledEnv());
  const input = await meshCompletion(claim!);
  let injected = false;
  const racing = withMeshPut((async (...args: Parameters<R2Bucket["put"]>) => {
    if (!injected) {
      injected = true;
      await preference(false);
    }
    return env.ARTIFACTS!.put(...args);
  }) as R2Bucket["put"]);
  await expect(
    completePortraitMesh(racing, claim!.job_id, input),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await user("/v1/pattern-portrait").then((r) => r.json()),
  ).toMatchObject({ status: "ready" });
  const assets = await env.DB.prepare(
    "SELECT cleanup_at FROM portrait_mesh_assets WHERE job_id=?",
  )
    .bind(claim!.job_id)
    .all<{ cleanup_at: string | null }>();
  expect(assets.results).toHaveLength(1);
  expect(assets.results[0]!.cleanup_at).not.toBeNull();
  await maintainPortraitMeshes(enabledEnv());
  expect(
    (
      await env.ARTIFACTS!.list({
        prefix: `portrait-meshes/${claim!.portrait_id}/`,
      })
    ).objects,
  ).toEqual([]);
});
it("queues future accepted Patterns atomically from an explicit grant made before written-Pattern consent", async () => {
  await seedUser(IDENTITY_B);
  await confirmPreferences(USER_B);
  const chart = await seedChart(IDENTITY_B, {
    positions: [
      "sun",
      "moon",
      "mercury",
      "venus",
      "mars",
      "jupiter",
      "saturn",
      "uranus",
      "neptune",
      "pluto",
    ].map((body, index) => ({
      body: body as "sun",
      longitude_deg: 12 + index * 31,
      speed_longitude_deg_per_day: 1,
      retrograde: false,
    })),
  });
  expect(
    await env.DB.prepare(
      "SELECT 1 FROM consents WHERE user_id=? AND kind='pattern_generation'",
    )
      .bind(USER_B)
      .first(),
  ).toBeNull();
  const optin = await user(
    "/v1/pattern-portrait/automation",
    { ...automation(), chart_id: chart.chartId },
    USER_B,
    { method: "PUT" },
  );
  expect(optin.status).toBe(200);
  expect(
    await env.DB.prepare("SELECT 1 FROM portrait_start_outbox WHERE user_id=?")
      .bind(USER_B)
      .first(),
  ).toBeNull();
  const res = await user(
    "/v1/pattern-generations",
    {
      schema_version: "0.7.0",
      consent_policy_version: "1.1.0",
      confirm: "GENERATE MY PATTERN",
      reason: "first_open",
    },
    USER_B,
  );
  expect(res.status).toBe(202);
  const accepted = (await res.json()) as {
    generation: { generation_id: string };
  };
  for (let step = 0; step < 8; step++) {
    const row = await env.DB.prepare(
      "SELECT job_id,stage,stage_generation FROM pattern_generation_jobs WHERE generation_id=?",
    )
      .bind(accepted.generation.generation_id)
      .first<{ job_id: string; stage: string; stage_generation: number }>();
    if (row?.stage === "succeeded") break;
    if (!row || row.stage === "failed")
      throw new Error("Pattern fixture failed");
    await executePatternJob(
      env,
      {
        kind: "pattern_generation",
        job_id: row.job_id,
        generation_id: accepted.generation.generation_id,
        stage_generation: row.stage_generation,
      },
      new Date(),
      {
        publisher: ({ pin, packet, ontology }) => {
          const four = structuredClone(packet) as {
            selection_constraints: {
              core_chapters_min: number;
              core_chapters_max: number;
            };
          };
          four.selection_constraints.core_chapters_min = 4;
          four.selection_constraints.core_chapters_max = 4;
          return createSyntheticPatternPublisher({
            forceReject: false,
            packet: four,
            ontology,
            publisher: pin.publisher,
            measured: true,
          });
        },
      },
    );
  }
  expect(
    await env.DB.prepare(
      "SELECT status FROM portrait_start_outbox WHERE user_id=?",
    )
      .bind(USER_B)
      .first(),
  ).toEqual({ status: "pending" });
  await maintainPortraitMeshes(enabledEnv());
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) n FROM pattern_portrait_jobs WHERE user_id=?",
    )
      .bind(USER_B)
      .first(),
  ).toEqual({ n: 4 });
});

import { processDeletionMessage } from "../services/account-deletion.js";
it("erases accepted mesh inventory and its grants through the existing account deletion job", async () => {
  await images();
  const claim = await claimPortraitMesh(enabledEnv());
  await completePortraitMesh(
    enabledEnv(),
    claim!.job_id,
    await meshCompletion(claim!),
  );
  const response = await user("/v1/account", { confirm: "DELETE" }, USER_A, {
    method: "DELETE",
  });
  expect(response.status).toBe(202);
  const accepted = (await response.json()) as { job_id: string };
  expect(
    await processDeletionMessage(enabledEnv(), {
      kind: "privacy",
      job_id: accepted.job_id,
      job_type: "delete_account",
    }),
  ).toBe("ack");
  for (const table of [
    "portrait_mesh_assets",
    "portrait_mesh_jobs",
    "portrait_start_outbox",
    "portrait_automation_grants",
  ])
    expect(
      await env.DB.prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id=?`)
        .bind(USER_A)
        .first(),
    ).toEqual({ n: 0 });
  expect(
    (
      await env.ARTIFACTS!.list({
        prefix: `portrait-meshes/${claim!.portrait_id}/`,
      })
    ).objects,
  ).toEqual([]);
});
it("does not deliver an accepted model when its source image is missing", async () => {
  const portrait = await images();
  const claim = await claimPortraitMesh(enabledEnv());
  await completePortraitMesh(
    enabledEnv(),
    claim!.job_id,
    await meshCompletion(claim!),
  );
  const row = await env.DB.prepare(
    "SELECT model_asset_id FROM portrait_mesh_jobs WHERE id=?",
  )
    .bind(claim!.job_id)
    .first<{ model_asset_id: string }>();
  const image = await env.DB.prepare(
    "SELECT object_key FROM pattern_portrait_assets WHERE id=?",
  )
    .bind(portrait.chapters[0]!.reference_id)
    .first<{ object_key: string }>();
  await env.ARTIFACTS!.delete(image!.object_key);
  expect(
    (await user(`/v1/pattern-portrait/models/${row!.model_asset_id}`)).status,
  ).toBe(404);
});

import { insertPatternConsentGrant } from "../db/pattern-consents.js";
it("captures fresh mesh consent independently of an already accepted graph", async () => {
  const portrait = await images();
  const prior = await env.DB.prepare(
    "SELECT id,version FROM consents WHERE user_id=? AND kind='pattern_generation' ORDER BY version DESC LIMIT 1",
  )
    .bind(USER_A)
    .first<{ id: string; version: number }>();
  expect(
    (
      await user("/v1/consents/pattern-generation", {}, USER_A, {
        method: "DELETE",
      })
    ).status,
  ).toBe(200);
  const id = crypto.randomUUID();
  await insertPatternConsentGrant(
    env,
    USER_A,
    id,
    prior!.version + 2,
    prior!.id,
    new Date().toISOString(),
  ).run();
  expect((await preference()).status).toBe(200);
  const claim = await claimPortraitMesh(enabledEnv());
  expect(claim).not.toBeNull();
  expect(claim!.portrait_id).toBe(portrait.portrait_id);
  expect(
    await env.DB.prepare(
      "SELECT pattern_consent_id FROM portrait_mesh_jobs WHERE id=?",
    )
      .bind(claim!.job_id)
      .first(),
  ).toEqual({ pattern_consent_id: id });
});
it("resumes cancelled source work within the same budget after a new explicit grant", async () => {
  await preference();
  await maintainPortraitMeshes(enabledEnv());
  await preference(false);
  await preference();
  await maintainPortraitMeshes(enabledEnv());
  expect(
    await user("/v1/pattern-portrait/explorer").then((r) => r.json()),
  ).toMatchObject({ status: "generating" });
});

it("fails confirmed missing source images without spending or hanging a mesh lease", async () => {
  const portrait = await images();
  const image = await env.DB.prepare(
    "SELECT object_key FROM pattern_portrait_assets WHERE id=?",
  )
    .bind(portrait.chapters[0]!.reference_id)
    .first<{ object_key: string }>();
  await env.ARTIFACTS!.delete(image!.object_key);
  const claim = await claimPortraitMesh(enabledEnv());
  expect(claim?.chapter_index).toBe(1);
  expect(
    await env.DB.prepare(
      "SELECT status,attempts,failure_code FROM portrait_mesh_jobs WHERE portrait_id=? AND chapter_index=0",
    )
      .bind(portrait.portrait_id)
      .first(),
  ).toEqual({
    status: "failed",
    attempts: 0,
    failure_code: "source_unavailable",
  });
});

it("preserves accepted partial images and models across automation withdrawal and resume", async () => {
  const portrait = await images(1);
  expect(portrait.completed_chapters).toBe(1);
  const mesh = await claimPortraitMesh(enabledEnv());
  await completePortraitMesh(
    enabledEnv(),
    mesh!.job_id,
    await meshCompletion(mesh!),
  );
  const before = await env.DB.prepare(
    "SELECT object_key FROM pattern_portrait_assets WHERE portrait_id=? ORDER BY id",
  )
    .bind(portrait.portrait_id)
    .all();
  expect(before.success).toBe(true);
  const capture = await env.DB.prepare("SELECT completed_at FROM portrait_mesh_jobs WHERE id=?").bind(mesh!.job_id).first<{completed_at:string}>();
  const imageCapture = await env.DB.prepare("SELECT completed_at FROM pattern_portrait_jobs WHERE portrait_id=? AND status='complete'").bind(portrait.portrait_id).first<{completed_at:string}>();
  expect(capture?.completed_at).toMatch(/Z$/);
  expect(imageCapture?.completed_at).toMatch(/Z$/);
  await preference(false);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) n FROM pattern_portrait_assets WHERE portrait_id=? AND cleanup_at IS NOT NULL",
    )
      .bind(portrait.portrait_id)
      .first(),
  ).toEqual({ n: 0 });
  expect(
    await env.DB.prepare("SELECT status FROM portrait_mesh_jobs WHERE id=?")
      .bind(mesh!.job_id)
      .first(),
  ).toEqual({ status: "complete" });
  await preference();
  await maintainPortraitMeshes(enabledEnv());
  const next = (await (
    await machine("/claim", {})
  ).json()) as CodexPortraitClaim;
  expect(next.chapter_index).toBe(1);
  const after = await env.DB.prepare(
    "SELECT object_key FROM pattern_portrait_assets WHERE portrait_id=? ORDER BY id",
  )
    .bind(portrait.portrait_id)
    .all();
  expect(after.success).toBe(true);
  expect(after.results).toEqual(before.results);
  expect(await env.DB.prepare("SELECT completed_at FROM portrait_mesh_jobs WHERE id=?").bind(mesh!.job_id).first()).toEqual(capture);
  expect(await env.DB.prepare("SELECT completed_at FROM pattern_portrait_jobs WHERE portrait_id=? AND status='complete'").bind(portrait.portrait_id).first()).toEqual(imageCapture);
});
it("resumes a cancelled mesh under the new grant without resetting its attempt budget", async () => {
  await images();
  const first = await claimPortraitMesh(enabledEnv());
  await preference(false);
  await preference();
  const second = await claimPortraitMesh(enabledEnv());
  expect(second?.job_id).toBe(first!.job_id);
  expect(second?.lease_token).not.toBe(first!.lease_token);
  expect(
    await env.DB.prepare(
      "SELECT attempts,status FROM portrait_mesh_jobs WHERE id=?",
    )
      .bind(first!.job_id)
      .first(),
  ).toEqual({ attempts: 2, status: "running" });
  await preference();
  await maintainPortraitMeshes(enabledEnv());
  expect(
    await env.DB.prepare(
      "SELECT attempts,status FROM portrait_mesh_jobs WHERE id=?",
    )
      .bind(first!.job_id)
      .first(),
  ).toEqual({ attempts: 2, status: "running" });
});

import { runPrivacyMaintenance } from "../services/privacy-maintenance.js";
it("retains deletion tombstone inventory when a full account erasure wins during model upload", async () => {
  await images();
  const claim = await claimPortraitMesh(enabledEnv());
  const input = await meshCompletion(claim!);
  let injected = false;
  const racing = withMeshPut((async (...args: Parameters<R2Bucket["put"]>) => {
    if (!injected) {
      injected = true;
      const response = await user(
        "/v1/account",
        { confirm: "DELETE" },
        USER_A,
        { method: "DELETE" },
      );
      expect(response.status).toBe(202);
      const accepted = (await response.json()) as { job_id: string };
      expect(
        await processDeletionMessage(enabledEnv(), {
          kind: "privacy",
          job_id: accepted.job_id,
          job_type: "delete_account",
        }),
      ).toBe("ack");
    }
    return env.ARTIFACTS!.put(...args);
  }) as R2Bucket["put"]);
  await expect(
    completePortraitMesh(racing, claim!.job_id, input),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) n FROM portrait_mesh_assets WHERE user_id=?",
    )
      .bind(USER_A)
      .first(),
  ).toEqual({ n: 0 });
  const late = (
    await env.ARTIFACTS!.list({
      prefix: `portrait-meshes/${claim!.portrait_id}/`,
    })
  ).objects;
  expect(late).toHaveLength(1);
  const tombstone = await env.DB.prepare(
    "SELECT artifact_manifest_json FROM deletion_requests WHERE user_id=?",
  )
    .bind(USER_A)
    .first<{ artifact_manifest_json: string }>();
  expect(JSON.parse(tombstone!.artifact_manifest_json)).toContain(late[0]!.key);
  await runPrivacyMaintenance(enabledEnv(), new Date());
  expect(
    (
      await env.ARTIFACTS!.list({
        prefix: `portrait-meshes/${claim!.portrait_id}/`,
      })
    ).objects,
  ).toEqual([]);
});

it("keeps mixed failed and pending chapters generating until all automatic work settles", async () => {
  await images();
  const first = await claimPortraitMesh(enabledEnv());
  await failPortraitMesh(enabledEnv(), first!.job_id, {
    lease_token: first!.lease_token,
    code: "generation_refused",
  });
  expect(
    await user("/v1/pattern-portrait/explorer").then((r) => r.json()),
  ).toMatchObject({ status: "generating", retryable: true });
  for (let i = 0; i < 3; i++) {
    const next = await claimPortraitMesh(enabledEnv());
    await failPortraitMesh(enabledEnv(), next!.job_id, {
      lease_token: next!.lease_token,
      code: "generation_refused",
    });
  }
  expect(
    await user("/v1/pattern-portrait/explorer").then((r) => r.json()),
  ).toMatchObject({ status: "failed", retryable: false });
});
