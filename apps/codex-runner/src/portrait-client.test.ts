import assert from "node:assert/strict";
import test from "node:test";
import { CodexPortraitClient, decodePortraitBase64 } from "./portrait-client.js";
import type { CodexPortraitClaim } from "@patternlike/shared";

const claim: CodexPortraitClaim = {
  schema_version: "codex-portrait-claim/v1", job_id: `ppjob_${"a".repeat(32)}`, portrait_id: `ppor_${"b".repeat(32)}`,
  chapter_index: 1, lease_token: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", model: "gpt-5.6-sol", reasoning_effort: "xhigh",
  image_model: "gpt-image-2", prompt_version: "portrait-object-v1", timeout_ms: 900000, prompt: "Chapter one only.", source_sha256: "c".repeat(64),
};
const options = { apiOrigin: "https://api.example.test", runnerToken: "machine-token" };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

test("portrait transport uses dedicated auth, exact paths and claim/terminal schemas", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new CodexPortraitClient({ ...options, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return calls.length === 1 ? json(claim) : json({ schema_version: "codex-portrait-terminal/v1", status: "accepted" });
  } });
  assert.deepEqual(await client.claim(), { status: "claimed", claim });
  await client.fail(claim.job_id, { lease_token: claim.lease_token, code: "image_invalid" });
  assert.deepEqual(calls.map((c) => c.url), ["https://api.example.test/codex-provider/v1/portraits/claim", `https://api.example.test/codex-provider/v1/portraits/${claim.job_id}/fail`]);
  assert.equal(new Headers(calls[0]!.init.headers).get("authorization"), "Bearer machine-token");
  assert.equal(calls[0]!.init.redirect, "error"); assert.equal(calls[0]!.init.body, "{}");
});

test("portrait transport accepts204 and rejects extraneous claims/acknowledgements", async () => {
  const empty = new CodexPortraitClient({ ...options, fetchImpl: async () => new Response(null, { status: 204 }) });
  assert.deepEqual(await empty.claim(), { status: "empty" });
  const malformed = new CodexPortraitClient({ ...options, fetchImpl: async () => json({ ...claim, secret: "unexpected" }) });
  await assert.rejects(malformed.claim(), /Invalid portrait claim/);
  const ack = new CodexPortraitClient({ ...options, fetchImpl: async () => json({ schema_version: "codex-portrait-terminal/v1", status: "accepted", extra: true }) });
  await assert.rejects(ack.fail(claim.job_id, { lease_token: claim.lease_token, code: "image_invalid" }), /acknowledgement/);
  await assert.rejects(ack.fail("../other", { lease_token: claim.lease_token, code: "image_invalid" }), /Invalid portrait failure/);
});

test("portrait response body stays bounded and request timeout includes body consumption", async () => {
  const oversized = new CodexPortraitClient({ ...options, fetchImpl: async () => new Response(" ".repeat(300 * 1024), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(oversized.claim(), /too large/);
  const waiting = new CodexPortraitClient({ ...options, requestTimeoutMs: 25, fetchImpl: async (_url, init) => new Response(new ReadableStream({
    start(controller) { init!.signal!.addEventListener("abort", () => controller.error(new Error("private detail")), { once: true }); },
  }), { headers: { "content-type": "application/json" } }) });
  // Keep the test process alive independently of the intentionally unref'd timer.
  const keepAlive = setTimeout(() => undefined, 1_000);
  try { await assert.rejects(waiting.claim(), /Portrait transport failed/); } finally { clearTimeout(keepAlive); }
});

test("native-sized base64 is bounded, canonical and decoded without regex recursion", () => {
  const bytes = Buffer.alloc(2 * 1024 * 1024, 31);
  assert.deepEqual(decodePortraitBase64(bytes.toString("base64"), bytes.length), bytes);
  assert.equal(decodePortraitBase64("YWJj\n", 100), null);
  assert.equal(decodePortraitBase64("YQ=", 100), null);
  assert.equal(decodePortraitBase64(bytes.toString("base64"), bytes.length - 1), null);
});
