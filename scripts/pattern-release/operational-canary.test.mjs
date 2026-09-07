import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

const subject = await import("./operational-canary.mjs").catch(() => null);
const now = "2026-09-06T18:00:00.000Z";
const usage = { schema_version: "geoapify-account-usage.v1", scope: "account", source: "account_dashboard",
  evidence_sha256: "a".repeat(64), observed_at: now, period_start: "2026-09-06T00:00:00Z",
  period_end: "2026-09-07T00:00:00Z", used_credits: 79, allowance_credits: 100 };
async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
function reply(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
// The only HTTP exception lives in a test double, never in the operator CLI.
const syntheticTransport = (origin) => ({ origin: "https://canary.example",
  fetcher: (input, init) => fetch(new URL(new URL(input).pathname, origin), init) });

test("health alone stays incomplete and does not trigger authenticated or generation routes", async () => {
  assert(subject, "Operational canary is missing");
  const paths = [];
  await withServer((request, response) => {
    paths.push(request.url);
    if (request.url === "/health") reply(response, 200, { ok: true, service: "patternlike-api" });
    else if (request.url === "/v1/meta") reply(response, 200, { auth_stub: false, calc_service_configured: true });
    else reply(response, 401, { error: { code: "unauthorized" } });
  }, async (origin) => {
    const result = await subject.runOperationalCanary({ ...syntheticTransport(origin), now });
    assert.equal(result.status, "incomplete");
    assert(result.checks.filter((entry) => ["geocoding", "daily_publication_readback", "geoapify_account_usage"].includes(entry.name))
      .every((entry) => entry.status === "unconfigured"));
    assert.deepEqual(paths, ["/health", "/v1/meta", "/v1/readings/canary-auth-boundary"]);
    assert.equal(result.fresh_generation_exercised, false);
    assert.equal(result.notification_delivery, "unconfigured");
  });
});

test("authenticated checks verify real responses and retain no cookies, query results, or reading prose", async () => {
  assert(subject, "Operational canary is missing");
  const token = "private-session-token-123456789";
  const requests = [];
  await withServer((request, response) => {
    requests.push({ path: request.url, method: request.method, cookie: request.headers.cookie });
    if (request.url === "/health") reply(response, 200, { ok: true, service: "patternlike-api" });
    else if (request.url === "/v1/meta") reply(response, 200, { auth_stub: false, calc_service_configured: true });
    else if (!request.headers.cookie) reply(response, 401, { error: { code: "unauthorized" } });
    else if (request.url === "/v1/places/search") reply(response, 200, { candidates: [
      { candidate_id: "private-candidate", primary_label: "private location", secondary_label: "private region" },
    ] });
    else reply(response, 200, { schema_version: "0.5.0", evidence_url: "/v1/readings/reading_canary/evidence", reading: {
      reading_id: "reading_canary", local_date: "2026-09-06", generated_at: now, paragraphs: [{ text: "private reading prose" }],
    } });
  }, async (origin) => {
    const result = await subject.runOperationalCanary({ ...syntheticTransport(origin), now, sessionToken: token,
      readingId: "reading_canary", expectedLocalDate: "2026-09-06", geoapifyUsage: usage });
    assert.equal(result.status, "pass");
    assert.equal(result.execution_kind, "test_double");
    assert.equal(result.response_evidence_observed, false);
    assert.equal(result.fresh_generation_exercised, false);
    assert.equal(result.notification_delivery, "unconfigured");
    assert(!JSON.stringify(result).includes("private"));
    assert(!JSON.stringify(result).includes("reading_canary"));
    assert(requests.filter((entry) => entry.cookie).every((entry) => entry.cookie === `pl_session=${token}`));
    assert(!requests.some((entry) => /today|generate|resolve/.test(entry.path)));
    assert.deepEqual(requests.filter((entry) => entry.method === "POST").map((entry) => entry.path), ["/v1/places/search"]);
  });
});

test("redirects are never followed, empty geocoding and stale publication fail even with HTTP 200", async () => {
  assert(subject, "Operational canary is missing");
  const paths = [];
  await withServer((request, response) => {
    paths.push(request.url);
    if (request.url === "/health") { response.writeHead(302, { location: "/private-target" }); response.end(); }
    else if (request.url === "/v1/meta") reply(response, 200, { auth_stub: false, calc_service_configured: true });
    else if (!request.headers.cookie) reply(response, 401, { error: { code: "unauthorized" } });
    else if (request.url === "/v1/places/search") reply(response, 200, { candidates: [] });
    else reply(response, 200, { reading: { reading_id: "reading_canary", local_date: "2026-09-05", generated_at: now,
      paragraphs: [{ text: "stale" }] }, evidence_url: "/v1/readings/reading_canary/evidence" });
  }, async (origin) => {
    const result = await subject.runOperationalCanary({ ...syntheticTransport(origin), now, sessionToken: "synthetic-session-token",
      readingId: "reading_canary", expectedLocalDate: "2026-09-06", geoapifyUsage: usage });
    assert.equal(result.status, "fail");
    for (const name of ["health", "geocoding", "daily_publication_readback"]) {
      assert.equal(result.checks.find((entry) => entry.name === name).status, "fail");
    }
    assert(!paths.includes("/private-target"));
  });
});

test("credit thresholds use current account-wide credits and refuse missing, stale, future, or project-only inputs", () => {
  assert(subject, "Operational canary is missing");
  assert.equal(subject.evaluateGeoapifyUsage(usage, { now }).status, "pass");
  assert.equal(subject.evaluateGeoapifyUsage({ ...usage, used_credits: 80 }, { now }).status, "warning");
  assert.equal(subject.evaluateGeoapifyUsage({ ...usage, used_credits: 100 }, { now }).status, "fail");
  assert.equal(subject.evaluateGeoapifyUsage(null, { now }).status, "unconfigured");
  for (const change of [{ scope: "project" }, { allowance_credits: 0 }, { used_credits: -1 },
    { observed_at: "2026-09-06T16:00:00Z" }, { observed_at: "2026-09-06T19:00:00Z" },
    { period_end: now }, { evidence_sha256: "missing" }]) {
    assert.equal(subject.evaluateGeoapifyUsage({ ...usage, ...change }, { now }).status, "unverified");
  }
});

test("plaintext origins are rejected before any credential-bearing request", async () => {
  assert(subject, "Operational canary is missing");
  let requests = 0;
  await withServer((request, response) => { requests++; reply(response, 401, {}); }, async (origin) => {
    await assert.rejects(subject.runOperationalCanary({ origin, sessionToken: "synthetic-session-token", now }), /canary_origin_invalid/);
    assert.equal(requests, 0);
  });
});

test("usage warnings cannot conceal missing authenticated coverage", async () => {
  assert(subject, "Operational canary is missing");
  await withServer((request, response) => {
    if (request.url === "/health") reply(response, 200, { ok: true, service: "patternlike-api" });
    else if (request.url === "/v1/meta") reply(response, 200, { auth_stub: false, calc_service_configured: true });
    else reply(response, 401, { error: { code: "unauthorized" } });
  }, async (origin) => {
    const result = await subject.runOperationalCanary({ ...syntheticTransport(origin), now, geoapifyUsage: { ...usage, used_credits: 80 } });
    assert.equal(result.status, "incomplete");
    assert.equal(result.checks.find((entry) => entry.name === "geoapify_account_usage").status, "warning");
  });
});

test("native transport failures before headers do not claim observed response evidence", async () => {
  assert(subject, "Operational canary is missing");
  const result = await subject.runOperationalCanary({ origin: "https://127.0.0.1:1", now });
  assert.equal(result.status, "fail");
  assert.equal(result.execution_kind, "native_http");
  assert.equal(result.response_evidence_observed, false);
  assert(result.checks.filter((entry) => "http_status" in entry).every((entry) => entry.http_status === null));
});
