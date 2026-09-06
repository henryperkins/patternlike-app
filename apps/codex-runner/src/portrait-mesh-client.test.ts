import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { CodexPortraitMeshClient } from "./portrait-mesh-client.js";

const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA6sAAAAASUVORK5CYII=", "base64");
const source = "Complete fictional chapter.";
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const CLAIM = { schema_version: "codex-portrait-mesh-claim/v1", job_id: `ppmesh_${"a".repeat(32)}`, portrait_id: `ppor_${"b".repeat(32)}`, chapter_index: 0, chapter_id: "chapter-1", lease_token: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", model: "gpt-5.6-sol", reasoning_effort: "xhigh", prompt_version: "portrait-mesh/v1", timeout_ms: 900000, source_text: source, source_text_sha256: sha(source), source_image_sha256: sha(image), document_revision: "revision-1", image_base64: image.toString("base64"), compiler_version: "portrait-mesh-compiler/v1" };
const options = { apiOrigin: "https://api.example.test", runnerToken: "machine-token" };
test("mesh client uses authenticated nonredirecting machine routes with exact versioned claims and acknowledgments", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new CodexPortraitMeshClient({ ...options, fetchImpl: async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return String(url).endsWith("/claim") ? Response.json(CLAIM) : Response.json({ schema_version: "codex-portrait-mesh-terminal/v1", status: "accepted" });
  } });
  assert.deepEqual(await client.claim(), { status: "claimed", claim: CLAIM });
  await client.fail(CLAIM.job_id, { lease_token: CLAIM.lease_token, code: "visual_check_failed" });
  assert.deepEqual(requests.map((r) => r.url), [`${options.apiOrigin}/codex-provider/v1/portrait-meshes/claim`, `${options.apiOrigin}/codex-provider/v1/portrait-meshes/${CLAIM.job_id}/fail`]);
  for (const r of requests) { assert.equal(r.init.redirect, "error"); assert.equal(new Headers(r.init.headers).get("authorization"), "Bearer machine-token"); }
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
