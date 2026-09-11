import assert from "node:assert/strict";
import { test } from "node:test";
import { runRuntimeHealthRead, parseRuntimeHealthSnapshot } from "./runtime-health-tool.js";
import type { RuntimeHealthResponse } from "./runtime-health.js";
const time = "2026-09-11T00:00:00.000Z";
const health: RuntimeHealthResponse = { schema_version: "runtime-health/v1", sampled_at: time,
  work_classes: ["text", "portrait", "mesh"].map((work_class) => ({ work_class, observation: "known", reason: "observed", runner_enabled: null,
    pending_count: 0, scheduled_pending_count: 0, dispatchable_pending_count: 0, active_lease_count: 0, expired_lease_count: 0, failed_count: 0, retry_exhausted_count: work_class === "text" ? null : 0,
    retry_exhaustion_observation: work_class === "text" ? "not_collected" : "known", oldest_pending_age_ms: null, oldest_dispatchable_pending_age_ms: null,
    completion_latency: { successful_count: 0, p50_ms: null, p95_ms: null, missing_timestamp_count: 0, measurement_started_at: time, window_started_at: "2026-09-10T00:00:00.000Z", coverage: "partial" } })) as RuntimeHealthResponse["work_classes"],
  publication: { observation: "known", reason: "observed", publication_safety_failed_count: 0, retry_failures: { observation: "unavailable", reason: "not_collected", count: null } } };
test("aggregate read makes exactly one GET, rejects detail IDs and never follows redirects", async () => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify(health)); };
  const output = await runRuntimeHealthRead({ mode: "aggregate" }, "https://api.example", "access-token", fetcher, time);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "https://api.example/admin/runtime-health?purpose=incident_response");
  assert.equal(requests[0]!.init!.method, "GET");
  assert.equal(requests[0]!.init!.redirect, "error");
  assert.match(output, /Accepted provider output does not certify reader publication/);
  assert.match(output, /Alert adoption: not_configured/);
  assert.doesNotMatch(output, /access-token|pgen_|job_id/);
  await runRuntimeHealthRead({ mode: "aggregate", generation_id: "private" }, "https://api.example", "access-token", fetcher, time);
  assert.equal(requests.length, 1);
});
test("exact Pattern command has its own purpose and cannot fetch artifacts or execute repairs", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (url, init) => { requests.push(String(url)); assert.equal(init!.method, "GET"); return new Response("private", { status: 403 }); };
  const id = `pgen_${"a".repeat(32)}`;
  const result = await runRuntimeHealthRead({ mode: "pattern", generation_id: id, purpose: "safety_investigation" }, "https://api.example", "access-token", fetcher, time);
  assert.deepEqual(requests, [`https://api.example/admin/pattern-generations/${id}/diagnostics?purpose=safety_investigation`]);
  assert.equal(result, "Pattern inspection unavailable: scope_not_authorized");
  for (const command of [{ mode: "pattern", generation_id: id }, { mode: "pattern", generation_id: "../artifacts", purpose: "incident_response" }, { mode: "daily" }]) {
    await runRuntimeHealthRead(command, "https://api.example", "access-token", fetcher, time);
  }
  assert.equal(requests.length, 1);
});
test("aggregate boundary rejects unknown private fields at every nesting level", () => {
  assert.ok(parseRuntimeHealthSnapshot(health));
  for (const value of [{ ...health, user_id: "private" }, { ...health, work_classes: health.work_classes.map((v) => ({ ...v, job_id: "private" })) },
    { ...health, publication: { ...health.publication, message: "private" } },
    { ...health, work_classes: health.work_classes.map((v) => ({ ...v, completion_latency: { ...v.completion_latency, error: Error("private") } })) }]) assert.equal(parseRuntimeHealthSnapshot(value), null);
});

test("scoped successful GET renders explicit stage coverage and read-only recovery", async () => {
  const { readFileSync } = await import("node:fs");
  const fixture = JSON.parse(readFileSync(new URL("../../../contracts/runtime-health-v1/fixtures/valid/pattern-diagnostics.provider-accepted-unpublished.json", import.meta.url), "utf8"));
  const result = await runRuntimeHealthRead({ mode: "pattern", generation_id: fixture.generation_id, purpose: "incident_response" },
    "https://api.example", "access-token", async (_url, init) => {
      assert.equal(init!.method, "GET");
      return new Response(JSON.stringify(fixture));
    }, time);
  assert.match(result, /"provider_output": "accepted"/);
  assert.match(result, /"publication": "not_published"/);
  assert.match(result, /"action": "reload_status"/);
  assert.match(result, /"stage": "permission_admission"/);
  assert.doesNotMatch(result, /retry_generation|artifact|access-token/);
});

test("CLI invalid arguments return fixed help without exposing environment credentials", async () => {
  const { spawnSync } = await import("node:child_process");
  const cli = new URL("../../../apps/api/scripts/runtime-health.ts", import.meta.url);
  const result = spawnSync(process.execPath, ["--import", "tsx", cli.pathname, "invalid-command"], {
    env: { ...process.env, CF_ACCESS_JWT_ASSERTION: "private-token" }, encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-token/);
});

test("unavailable or contradictory aggregate observations cannot render healthy-looking completion counts", () => {
  const unavailable = { ...health, work_classes: health.work_classes.map((v) => ({ ...v,
    observation: "unavailable", reason: "query_failed", pending_count: null, scheduled_pending_count: null,
    dispatchable_pending_count: null, active_lease_count: null, expired_lease_count: null, failed_count: null,
    retry_exhausted_count: null })) };
  assert.equal(parseRuntimeHealthSnapshot(unavailable), null);
  assert.equal(parseRuntimeHealthSnapshot({ ...health, work_classes: health.work_classes.map((v) => ({ ...v,
    completion_latency: { ...v.completion_latency, successful_count: 2, p50_ms: 100, p95_ms: 10 } })) }), null);
});

test("aggregate parser enforces measurement, coverage, queue and publication relationships", () => {
  const clone = () => structuredClone(health);
  const mutations: Array<(v: RuntimeHealthResponse) => void> = [
    v => { v.work_classes[0].pending_count = null; },
    v => { Object.assign(v.work_classes[0].completion_latency,{coverage:"complete",successful_count:null,p50_ms:null,p95_ms:null,missing_timestamp_count:null,measurement_started_at:null}); },
    v => { v.work_classes[0].completion_latency.coverage = "unavailable"; },
    v => { v.work_classes[0].completion_latency.coverage = "complete"; },
    v => { Object.assign(v.work_classes[0].completion_latency,{coverage:"complete",measurement_started_at:"2026-09-09T00:00:00.000Z",missing_timestamp_count:1}); },
    v => { v.work_classes[0].completion_latency.measurement_started_at = "2026-09-12T00:00:00.000Z"; },
    v => { v.work_classes[0].completion_latency.window_started_at = time; },
    v => { v.work_classes[0].retry_exhausted_count = 0; },
    v => { v.work_classes[1].retry_exhaustion_observation = "not_collected"; },
    v => { v.work_classes[1].retry_exhausted_count = 1; },
    v => { v.work_classes[0].scheduled_pending_count = 1; },
    v => { v.work_classes[0].oldest_pending_age_ms = 1; },
    v => { Object.assign(v.publication,{observation:"known",reason:"query_failed",publication_safety_failed_count:null}); },
  ];
  for (const mutate of mutations) { const value = clone(); mutate(value); assert.equal(parseRuntimeHealthSnapshot(value),null); }
});

test("strict aggregate parser accepts the committed schema-valid complete and partial fixtures", async () => {
  const { readFileSync } = await import("node:fs");
  for (const name of ["runtime-health-empty.json", "runtime-health-partial-query.json", "runtime-health-historical-missing.json"]) {
    const fixture = JSON.parse(readFileSync(new URL(`../../../contracts/runtime-health-v1/fixtures/valid/${name}`, import.meta.url), "utf8"));
    assert.ok(parseRuntimeHealthSnapshot(fixture),name);
  }
  const complete = structuredClone(health);
  for (const work of complete.work_classes) Object.assign(work.completion_latency,{coverage:"complete",measurement_started_at:"2026-09-09T00:00:00.000Z"});
  assert.ok(parseRuntimeHealthSnapshot(complete));
});
