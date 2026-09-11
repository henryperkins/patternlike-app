import assert from "node:assert/strict";
import test from "node:test";
import { CodexPortraitClient, decodePortraitBase64, parsePortraitClaim, validPortraitCompletion } from "./portrait-client.js";
import type { CodexPortraitClaim, CodexPortraitClaimV2, CodexPortraitCompletion } from "@patternlike/shared";

const claim: CodexPortraitClaim = {
  schema_version: "codex-portrait-claim/v1", job_id: `ppjob_${"a".repeat(32)}`, portrait_id: `ppor_${"b".repeat(32)}`,
  chapter_index: 1, lease_token: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", model: "gpt-5.6-sol", reasoning_effort: "xhigh",
  image_model: "gpt-image-2", prompt_version: "portrait-object-v1", timeout_ms: 900000, prompt: "Chapter one only.", source_sha256: "c".repeat(64),
};
const options = { apiOrigin: "https://api.example.test", runnerToken: "machine-token" };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

const adaptiveClaim = (chapterCount: 3 | 5 | 6): CodexPortraitClaimV2 => ({
  ...claim,
  schema_version: "codex-portrait-claim/v2",
  chapter_count: chapterCount,
  chapter_index: chapterCount - 1,
  chapter_id: `chapter-${chapterCount}`,
  document_revision: `pattern-response/v7:fictional:${chapterCount}`,
});

test("completion transport preserves a qualified image request without claiming observed model identity", async () => {
  const legacy: CodexPortraitCompletion = {
    lease_token: claim.lease_token, source_sha256: claim.source_sha256,
    label: "Blue cube", rationale: "A simple object.", original_sha256: "d".repeat(64),
    image_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII=",
    pixels: { width: 128, height: 128, rgba_base64: Buffer.alloc(128 * 128 * 4).toString("base64") },
    provider_request_id: "thread:turn", image_request_id: "image-call-1", image_model: "gpt-image-2",
  };
  const provenance = {
    schema_version: "portrait-image-model-provenance/v1", requested_image_model: "gpt-image-2",
    observed_image_model: null, observation_status: "not_exposed", codex_cli_version: "0.153.3",
  } as const;
  const qualified = { ...legacy, image_model_provenance: provenance };
  const bodies: unknown[] = [];
  const client = new CodexPortraitClient({ ...options, fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(String(init!.body)));
    return json({ schema_version: "codex-portrait-terminal/v1", status: "accepted" });
  } });
  await client.complete(claim.job_id, qualified);
  await client.complete(claim.job_id, legacy);
  assert.deepEqual(bodies, [qualified, legacy]);
  for (const invalid of [
    { observed_image_model: "gpt-image-2" }, { requested_image_model: "other" },
    { observation_status: "provider_attested" }, { observation_status: "legacy_unrecorded", codex_cli_version: null },
    { codex_cli_version: "0.153.4" }, { provider_attested: true },
  ]) assert.equal(validPortraitCompletion({ ...qualified, image_model_provenance: { ...provenance, ...invalid } } as unknown as CodexPortraitCompletion), false);
});

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
  assert.equal(new Headers(calls[0]!.init.headers).get("x-patternlike-portrait-protocol"), "v2");
  assert.equal(new Headers(calls[1]!.init.headers).get("x-patternlike-portrait-protocol"), "v2");
  assert.equal(calls[0]!.init.redirect, "error"); assert.equal(calls[0]!.init.body, "{}");
});

test("portrait transport accepts old Worker claims and binds adaptive failure terminals to the claimed source", async () => {
  const v2 = adaptiveClaim(6);
  const calls: Array<{ url: string; body: unknown; protocol: string | null }> = [];
  const client = new CodexPortraitClient({ ...options, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init!.body)), protocol: new Headers(init!.headers).get("x-patternlike-portrait-protocol") });
    return calls.length === 1 ? json(v2) : json({ schema_version: "codex-portrait-terminal/v2", status: "accepted" });
  } });
  assert.deepEqual(await client.claim(), { status: "claimed", claim: v2 });
  await client.fail(v2.job_id, { lease_token: v2.lease_token, code: "image_invalid" });
  assert.deepEqual(calls.map(({ protocol }) => protocol), ["v2", "v2"]);
  assert.deepEqual(calls[1]!.body, {
    schema_version: "codex-portrait-failure/v2",
    chapter_count: 6,
    chapter_index: 5,
    chapter_id: "chapter-6",
    document_revision: v2.document_revision,
    lease_token: v2.lease_token,
    source_sha256: v2.source_sha256,
    code: "image_invalid",
  });
});

test("portrait client submits only an exactly bound adaptive completion", async () => {
  const claim = adaptiveClaim(5);
  const base: CodexPortraitCompletion = {
    lease_token: claim.lease_token,
    source_sha256: claim.source_sha256,
    label: "Blue cube",
    rationale: "A simple object.",
    original_sha256: "d".repeat(64),
    image_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII=",
    pixels: { width: 128, height: 128, rgba_base64: Buffer.alloc(128 * 128 * 4).toString("base64") },
    provider_request_id: "thread:turn",
    image_request_id: "image-call-1",
    image_model: "gpt-image-2",
  };
  const completion = {
    ...base,
    schema_version: "codex-portrait-completion/v2",
    chapter_count: claim.chapter_count,
    chapter_index: claim.chapter_index,
    chapter_id: claim.chapter_id,
    document_revision: claim.document_revision,
  } as const;
  const bodies: unknown[] = [];
  const client = new CodexPortraitClient({ ...options, fetchImpl: async (url, init) => {
    bodies.push(JSON.parse(String(init!.body)));
    return String(url).endsWith("/claim") ? json(claim) : json({ schema_version: "codex-portrait-terminal/v2", status: "accepted" });
  } });
  await client.claim();
  await assert.rejects(client.complete(claim.job_id, { ...completion, chapter_id: "chapter-4" }), /Invalid portrait completion/);
  await assert.rejects(client.complete(claim.job_id, { ...completion, source_sha256: "e".repeat(64) }), /Invalid portrait completion/);
  await client.complete(claim.job_id, completion);
  assert.deepEqual(bodies, [{}, completion]);
});

test("portrait parser accepts adaptive last chapters for 3, 5 and 6 and rejects inconsistent closed bindings", () => {
  for (const count of [3, 5, 6] as const) assert.deepEqual(parsePortraitClaim(adaptiveClaim(count)), adaptiveClaim(count));
  const v2 = adaptiveClaim(6);
  for (const invalid of [
    { ...v2, chapter_index: 6, chapter_id: "chapter-7" },
    { ...v2, chapter_index: 5, chapter_id: "chapter-5" },
    { ...v2, chapter_count: 4, chapter_index: 5 },
    { ...v2, document_revision: "" },
    { ...v2, extra_source_metadata: { birth_date: "private" } },
  ]) assert.equal(parsePortraitClaim(invalid), null);
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
