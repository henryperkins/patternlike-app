import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { CodexPortraitMeshClient, parsePortraitMeshClaim } from "./portrait-mesh-client.js";
import type { CodexPortraitMeshClaimV2, PortraitMeshProgramV2 } from "@patternlike/shared";
import { compilePortraitMesh } from "./portrait-mesh-compiler.js";

const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA6sAAAAASUVORK5CYII=", "base64");
const source = "Complete fictional chapter.";
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const CLAIM = { schema_version: "codex-portrait-mesh-claim/v1", job_id: `ppmesh_${"a".repeat(32)}`, portrait_id: `ppor_${"b".repeat(32)}`, chapter_index: 0, chapter_id: "chapter-1", lease_token: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", model: "gpt-5.6-sol", reasoning_effort: "xhigh", prompt_version: "portrait-mesh/v1", timeout_ms: 900000, source_text: source, source_text_sha256: sha(source), source_image_sha256: sha(image), document_revision: "revision-1", image_base64: image.toString("base64"), compiler_version: "portrait-mesh-compiler/v1" };
const options = { apiOrigin: "https://api.example.test", runnerToken: "machine-token" };
const adaptiveClaim = (chapterCount: 3 | 5 | 6): CodexPortraitMeshClaimV2 => ({
  ...CLAIM,
  schema_version: "codex-portrait-mesh-claim/v2",
  chapter_count: chapterCount,
  chapter_index: chapterCount - 1,
  chapter_id: `chapter-${chapterCount}`,
  prompt_version: "portrait-mesh/v2",
  compiler_version: "portrait-mesh-compiler/v2",
});
test("mesh client uses authenticated nonredirecting machine routes with exact versioned claims and acknowledgments", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new CodexPortraitMeshClient({ ...options, fetchImpl: async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return String(url).endsWith("/claim") ? Response.json(CLAIM) : Response.json({ schema_version: "codex-portrait-mesh-terminal/v1", status: "accepted" });
  } });
  assert.deepEqual(await client.claim(), { status: "claimed", claim: CLAIM });
  await client.fail(CLAIM.job_id, { lease_token: CLAIM.lease_token, code: "visual_check_failed" });
  assert.deepEqual(requests.map((r) => r.url), [`${options.apiOrigin}/codex-provider/v1/portrait-meshes/claim`, `${options.apiOrigin}/codex-provider/v1/portrait-meshes/${CLAIM.job_id}/fail`]);
  for (const r of requests) {
    assert.equal(r.init.redirect, "error");
    assert.equal(new Headers(r.init.headers).get("authorization"), "Bearer machine-token");
    assert.equal(new Headers(r.init.headers).get("x-patternlike-portrait-protocol"), "v2");
  }
});
test("mesh client accepts old Worker claims and binds adaptive failure terminals to the claimed chapter", async () => {
  const claim = adaptiveClaim(6);
  const bodies: unknown[] = [];
  const client = new CodexPortraitMeshClient({ ...options, fetchImpl: async (url, init) => {
    bodies.push(JSON.parse(String(init!.body)));
    return String(url).endsWith("/claim") ? Response.json(claim) : Response.json({ schema_version: "codex-portrait-mesh-terminal/v2", status: "accepted" });
  } });
  assert.deepEqual(await client.claim(), { status: "claimed", claim });
  await client.fail(claim.job_id, { lease_token: claim.lease_token, code: "visual_check_failed" });
  assert.deepEqual(bodies[1], {
    schema_version: "codex-portrait-mesh-failure/v2",
    chapter_count: 6,
    chapter_index: 5,
    chapter_id: "chapter-6",
    document_revision: claim.document_revision,
    lease_token: claim.lease_token,
    code: "visual_check_failed",
  });
});
test("mesh client submits only an exactly bound adaptive completion", async () => {
  const claim = adaptiveClaim(5);
  const program: PortraitMeshProgramV2 = {
    version: "portrait-mesh-program/v2",
    chapter_count: 5,
    chapter_id: "chapter-5",
    materials: [{ id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 }],
    parts: [{ name: "body", material: "oak", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null,
      geometry: { kind: "box", size: [1, 1.3, 0.7], bevel: 0.04 } }],
  };
  const compiled = compilePortraitMesh(program, { chapterId: claim.chapter_id, chapterCount: claim.chapter_count,
    documentRevision: claim.document_revision, sourceImageSha256: claim.source_image_sha256, sourceTextSha256: claim.source_text_sha256 });
  const completion = {
    schema_version: "codex-portrait-mesh-completion/v2" as const,
    chapter_count: claim.chapter_count,
    chapter_index: claim.chapter_index,
    chapter_id: claim.chapter_id,
    document_revision: claim.document_revision,
    lease_token: claim.lease_token,
    program,
    program_sha256: compiled.programSha256,
    glb_base64: Buffer.from(compiled.glb).toString("base64"),
    glb_sha256: compiled.sha256,
    compiler_version: compiled.compilerVersion,
    audit: { schema_version: "portrait-mesh-audit/v1" as const, accepted: true as const, recognizable: true as const, substantial: true as const,
      source_correspondence: true as const, no_severe_intersections: true as const, view_count: 4 as const, notes: "All four views show a substantial fictional object." },
    provider_request_id: "author-turn",
    audit_request_id: "audit-turn",
  };
  const bodies: unknown[] = [];
  const client = new CodexPortraitMeshClient({ ...options, fetchImpl: async (url, init) => {
    bodies.push(JSON.parse(String(init!.body)));
    return String(url).endsWith("/claim") ? Response.json(claim) : Response.json({ schema_version: "codex-portrait-mesh-terminal/v2", status: "accepted" });
  } });
  await client.claim();
  await assert.rejects(client.complete(claim.job_id, { ...completion, chapter_index: 3 }), /Invalid mesh completion/);
  await client.complete(claim.job_id, completion);
  assert.deepEqual(bodies, [{}, completion]);
});
test("mesh parser accepts adaptive last chapters for 3, 5 and 6 and rejects inconsistent closed bindings", () => {
  for (const count of [3, 5, 6] as const) assert.deepEqual(parsePortraitMeshClaim(adaptiveClaim(count)), adaptiveClaim(count));
  const claim = adaptiveClaim(6);
  for (const invalid of [
    { ...claim, chapter_index: 6, chapter_id: "chapter-7" },
    { ...claim, chapter_id: "chapter-5" },
    { ...claim, chapter_count: 5 },
    { ...claim, extra_source_metadata: { birth_time: "private" } },
  ]) assert.equal(parsePortraitMeshClaim(invalid), null);
});
for (const value of [{ ...CLAIM, extra: true }, { ...CLAIM, schema_version: "codex-portrait-claim/v1" }, { ...CLAIM, source_text: "" }, { ...CLAIM, compiler_version: "unknown" }, { ...CLAIM, model: "model with spaces" }, { ...CLAIM, image_base64: "not base64" }]) {
  test("mesh client rejects malformed or downgraded claims", async () => {
    const client = new CodexPortraitMeshClient({ ...options, fetchImpl: async () => Response.json(value) });
    await assert.rejects(client.claim(), /Invalid mesh claim/);
  });
}
test("mesh client accepts only empty 204 and exact current terminal acknowledgments", async () => {
  assert.deepEqual(await new CodexPortraitMeshClient({ ...options, fetchImpl: async () => new Response(null, { status: 204 }) }).claim(), { status: "empty" });
  for (const value of [{ schema_version: "codex-portrait-terminal/v1", status: "accepted" }, { schema_version: "codex-portrait-mesh-terminal/v1", status: "accepted", extra: true }]) {
    const client = new CodexPortraitMeshClient({ ...options, fetchImpl: async () => Response.json(value) });
    await assert.rejects(client.fail(CLAIM.job_id, { lease_token: CLAIM.lease_token, code: "generation_failed" }), /acknowledgement/);
  }
});
test("mesh client rejects oversized responses and invalid content types without leaking body content", async () => {
  for (const response of [new Response("private response", { headers: { "content-length": "9999999", "content-type": "application/json" } }), new Response("private response", { headers: { "content-type": "text/plain" } }), new Response("x".repeat(3 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } })]) {
    const client = new CodexPortraitMeshClient({ ...options, fetchImpl: async () => response });
    await assert.rejects(client.claim(), (error: Error) => !error.message.includes("private"));
  }
});
test("mesh client rejects invalid failures and executable programs before transport", async () => {
  let calls = 0;
  const client = new CodexPortraitMeshClient({ ...options, fetchImpl: async () => { calls++; return Response.json({}); } });
  await assert.rejects(client.fail("../bad", { lease_token: CLAIM.lease_token, code: "generation_failed" }));
  await assert.rejects(client.complete(CLAIM.job_id, { program: { code: "exec" } } as never));
  assert.equal(calls, 0);
});
