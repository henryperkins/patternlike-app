#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const instant = (value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) ? Date.parse(value) : NaN;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const unconfigured = (name) => ({ name, status: "unconfigured" });

/** Evaluate an operator-supplied account observation; this does not fetch provider usage or deliver alerts. */
export function evaluateGeoapifyUsage(value, { now = new Date().toISOString() } = {}) {
  const name = "geoapify_account_usage";
  if (!value) return unconfigured(name);
  const time = instant(now), observed = instant(value.observed_at), start = instant(value.period_start), end = instant(value.period_end);
  if (value.schema_version !== "geoapify-account-usage.v1" || value.scope !== "account" ||
    !["account_dashboard", "provider_account_export"].includes(value.source) ||
    !/^[a-f0-9]{64}$/.test(value.evidence_sha256 ?? "") ||
    ![time, observed, start, end].every(Number.isFinite) || observed > time || time - observed > 60 * 60 * 1000 ||
    start > observed || observed >= end || time >= end ||
    !Number.isSafeInteger(value.used_credits) || value.used_credits < 0 ||
    !Number.isSafeInteger(value.allowance_credits) || value.allowance_credits <= 0) {
    return { name, status: "unverified", code: "account_usage_evidence_invalid_or_stale" };
  }
  const ratio = value.used_credits / value.allowance_credits;
  return { name, status: ratio >= 1 ? "fail" : ratio >= 0.8 ? "warning" : "pass",
    observation_source: "operator_supplied_account_observation", evidence_sha256: value.evidence_sha256,
    observed_at: value.observed_at, used_credits: value.used_credits, allowance_credits: value.allowance_credits,
    utilization_percent: Math.round(ratio * 1000) / 10, warning_percent: 80, critical_percent: 100 };
}

function safeOrigin(origin) {
  const url = new URL(origin);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.protocol !== "https:") {
    throw new Error("canary_origin_invalid");
  }
  return url.origin;
}

async function check(fetcher, origin, name, path, inspect, { sessionToken, body } = {}) {
  let httpStatus = null;
  try {
    const response = await fetcher(new URL(path, origin), { method: body ? "POST" : "GET", redirect: "manual",
      cache: "no-store", signal: AbortSignal.timeout(15_000), headers: {
        accept: "application/json", ...(sessionToken ? { cookie: `pl_session=${sessionToken}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
    httpStatus = response.status;
    if ((httpStatus >= 300 && httpStatus < 400) || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel();
      return { name, status: "fail", http_status: httpStatus, code: "unexpected_response" };
    }
    const reader = response.body?.getReader(), chunks = [];
    let bytes = 0;
    if (!reader) throw new Error("body_missing");
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 256 * 1024) { await reader.cancel(); throw new Error("body_too_large"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = inspect(httpStatus, value);
    return { name, http_status: httpStatus, ...result };
  } catch { return { name, status: "fail", http_status: httpStatus, code: "request_or_payload_invalid" }; }
}

/** Readback only; never generate, change consent, resolve a birthplace, or delete an account. */
export async function runOperationalCanary({ origin, sessionToken, readingId, expectedLocalDate, geoapifyUsage, fetcher,
  now = new Date().toISOString() } = {}) {
  origin = safeOrigin(origin);
  if (!Number.isFinite(instant(now)) || (sessionToken && !/^[A-Za-z0-9._~-]{16,1024}$/.test(sessionToken)) ||
    (readingId && !/^[A-Za-z0-9_-]{8,100}$/.test(readingId)) ||
    (expectedLocalDate && !/^\d{4}-\d\d-\d\d$/.test(expectedLocalDate))) throw new Error("canary_arguments_invalid");
  const outcome = (ok) => ({ status: ok ? "pass" : "fail", ...(ok ? {} : { code: "response_contract_not_met" }) });
  const execute = fetcher ?? fetch;
  const checks = [];
  checks.push(await check(execute, origin, "health", "/health", (status, value) =>
    outcome(status === 200 && value.ok === true && value.service === "patternlike-api")));
  checks.push(await check(execute, origin, "configuration", "/v1/meta", (status, value) =>
    outcome(status === 200 && value.auth_stub === false && value.calc_service_configured === true)));
  checks.push(await check(execute, origin, "protected_route", "/v1/readings/canary-auth-boundary", (status, value) =>
    outcome(status === 401 && value.error?.code === "unauthorized")));
  checks.push(sessionToken ? await check(execute, origin, "geocoding", "/v1/places/search", (status, value) => {
    const ok = status === 200 && Array.isArray(value.candidates) && value.candidates.length > 0 &&
      value.candidates.every((entry) => nonempty(entry.candidate_id) && nonempty(entry.primary_label) && typeof entry.secondary_label === "string");
    return { ...outcome(ok), ...(ok ? { candidate_count: value.candidates.length } : {}) };
  }, { sessionToken, body: { query: "London", locale: "en-US", session_token: "patternlike-operational-canary" } }) : unconfigured("geocoding"));
  checks.push(sessionToken && readingId && expectedLocalDate ? await check(execute, origin, "daily_publication_readback",
    "/v1/readings/" + encodeURIComponent(readingId), (status, value) => {
      const reading = value.reading, generated = instant(reading?.generated_at), age = instant(now) - generated;
      const ok = status === 200 && reading?.reading_id === readingId && reading.local_date === expectedLocalDate &&
        Number.isFinite(age) && age >= 0 && age <= 26 * 60 * 60 * 1000 &&
        value.evidence_url === `/v1/readings/${readingId}/evidence` &&
        Array.isArray(reading.paragraphs) && reading.paragraphs.length > 0 && reading.paragraphs.every((entry) => nonempty(entry.text));
      return { ...outcome(ok), reading_id_sha256: digest(readingId), ...(ok ? { paragraph_count: reading.paragraphs.length } : {}) };
    }, { sessionToken }) : unconfigured("daily_publication_readback"));
  checks.push(evaluateGeoapifyUsage(geoapifyUsage, { now }));
  return { schema_version: "patternlike-operational-canary.v1", observed_at: now, origin, checks,
    execution_kind: fetcher ? "test_double" : "native_http",
    response_evidence_observed: !fetcher && checks.some((entry) => Number.isInteger(entry.http_status)),
    status: checks.some((entry) => entry.status === "fail") ? "fail" :
      checks.some((entry) => ["unconfigured", "unverified"].includes(entry.status)) ? "incomplete" :
      checks.some((entry) => entry.status === "warning") ? "warning" : "pass",
    fresh_generation_exercised: false, lifecycle_exercised: false, notification_delivery: "unconfigured" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("usage: operational-canary.mjs <https-origin>");
    const usagePath = process.env.GEOAPIFY_ACCOUNT_USAGE_FILE;
    const result = await runOperationalCanary({ origin: process.argv[2], sessionToken: process.env.PATTERNLIKE_CANARY_SESSION_TOKEN,
      readingId: process.env.PATTERNLIKE_CANARY_READING_ID, expectedLocalDate: process.env.PATTERNLIKE_CANARY_LOCAL_DATE,
      geoapifyUsage: usagePath ? JSON.parse(readFileSync(usagePath, "utf8")) : undefined });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.status === "pass" ? 0 : result.status === "incomplete" ? 2 : 1;
  } catch { process.stderr.write("Operational canary could not run; no credentials or response bodies logged.\n"); process.exitCode = 2; }
}
