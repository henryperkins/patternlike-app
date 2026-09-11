import { diagnosticArray, diagnosticInteger, diagnosticRecord, diagnosticTimestamp } from "./diagnostic-data.js";
import { diagnosePattern, parsePatternDiagnostics } from "./runtime-health-diagnostics.js";
import type { RuntimeHealthResponse, RuntimeWorkClassHealth } from "./runtime-health.js";
const CLASSES = ["text", "portrait", "mesh"] as const;
const COUNTERS = ["pending_count", "scheduled_pending_count", "dispatchable_pending_count", "active_lease_count", "expired_lease_count", "failed_count", "retry_exhausted_count", "oldest_pending_age_ms", "oldest_dispatchable_pending_age_ms"];
const CLASS_KEYS = ["work_class", "observation", "reason", "runner_enabled", "retry_exhaustion_observation", ...COUNTERS, "completion_latency"];
const LATENCY_COUNTERS = ["successful_count", "p50_ms", "p95_ms", "missing_timestamp_count"];
const member = (v: unknown, values: readonly string[]) => typeof v === "string" && values.includes(v);
const count = (v: unknown) => v === null || diagnosticInteger(v);

/** Exact aggregate projection. Scoped identifiers are never admitted, including nested extras. */
export function parseRuntimeHealthSnapshot(input: unknown): RuntimeHealthResponse | null {
  const root = diagnosticRecord(input, ["schema_version", "sampled_at", "work_classes", "publication"]);
  if (!root || root.schema_version !== "runtime-health/v1" || !diagnosticTimestamp(root.sampled_at)) return null;
  const items = diagnosticArray(root.work_classes, 3);
  if (!items) return null;
  const classes: RuntimeWorkClassHealth[] = [];
  for (let i = 0; i < 3; i++) {
    const value = diagnosticRecord(items[i], CLASS_KEYS);
    if (!value || value.work_class !== CLASSES[i] || !member(value.observation, ["known", "unavailable"])
      || !member(value.reason, ["observed", "schema_unavailable", "query_failed", "sample_limit_exceeded", "invalid_timestamp"])
      || value.runner_enabled !== null || !member(value.retry_exhaustion_observation, ["known", "not_collected"])) return null;
    for (const key of COUNTERS) if (!count(value[key]) || (value.observation === "unavailable" && value[key] !== null)) return null;
    if ((value.observation === "known") !== (value.reason === "observed")) return null;
    const latency = diagnosticRecord(value.completion_latency, [...LATENCY_COUNTERS, "measurement_started_at", "window_started_at", "coverage"]);
    if (!latency || !member(latency.coverage, ["complete", "partial", "unavailable"]) || !diagnosticTimestamp(latency.window_started_at)
      || (latency.measurement_started_at !== null && !diagnosticTimestamp(latency.measurement_started_at))) return null;
    for (const key of LATENCY_COUNTERS) if (!count(latency[key])) return null;
    if (value.observation === "unavailable" && latency.coverage !== "unavailable") return null;
    if (latency.coverage === "unavailable" && LATENCY_COUNTERS.some((key) => latency[key] !== null)) return null;
    if (latency.successful_count === 0 && (latency.p50_ms !== null || latency.p95_ms !== null)) return null;
    if (typeof latency.successful_count === "number" && latency.successful_count > 0
      && (typeof latency.p50_ms !== "number" || typeof latency.p95_ms !== "number" || latency.p50_ms > latency.p95_ms)) return null;
    if (Date.parse(latency.window_started_at) !== Date.parse(root.sampled_at) - 86_400_000) return null;
    if (value.observation === "unavailable") {
      if (value.retry_exhaustion_observation !== "not_collected" || latency.measurement_started_at !== null) return null;
    } else {
      const pending = value.pending_count;
      const scheduled = value.scheduled_pending_count;
      const dispatchable = value.dispatchable_pending_count;
      const failed = value.failed_count;
      if (!diagnosticInteger(pending) || !diagnosticInteger(scheduled) || !diagnosticInteger(dispatchable)
        || !diagnosticInteger(failed) || !diagnosticInteger(value.active_lease_count) || !diagnosticInteger(value.expired_lease_count)
        || scheduled + dispatchable > pending) return null;
      if (value.work_class === "text") {
        if (value.retry_exhausted_count !== null || value.retry_exhaustion_observation !== "not_collected") return null;
      } else if (!diagnosticInteger(value.retry_exhausted_count) || value.retry_exhaustion_observation !== "known"
        || value.retry_exhausted_count > failed) return null;
      if ((pending === 0) !== (value.oldest_pending_age_ms === null)
        || (dispatchable === 0) !== (value.oldest_dispatchable_pending_age_ms === null)
        || (typeof value.oldest_pending_age_ms === "number" && typeof value.oldest_dispatchable_pending_age_ms === "number"
          && value.oldest_dispatchable_pending_age_ms > value.oldest_pending_age_ms)) return null;
      if (latency.coverage === "unavailable" || !diagnosticInteger(latency.successful_count)
        || !diagnosticInteger(latency.missing_timestamp_count) || !diagnosticTimestamp(latency.measurement_started_at)
        || Date.parse(latency.measurement_started_at) > Date.parse(root.sampled_at)) return null;
      if (latency.coverage === "complete" && (latency.missing_timestamp_count !== 0
        || Date.parse(latency.measurement_started_at) > Date.parse(latency.window_started_at))) return null;
    }
    classes.push({ ...value, completion_latency: { ...latency } } as unknown as RuntimeWorkClassHealth);
  }
  const publication = diagnosticRecord(root.publication, ["observation", "reason", "publication_safety_failed_count", "retry_failures"]);
  if (!publication || !member(publication.observation, ["known", "unavailable"]) || !member(publication.reason, ["observed", "query_failed", "sample_limit_exceeded"])
    || !count(publication.publication_safety_failed_count) || (publication.observation === "unavailable" && publication.publication_safety_failed_count !== null)) return null;
  if ((publication.observation === "known") !== (publication.reason === "observed")
    || (publication.observation === "known" && !diagnosticInteger(publication.publication_safety_failed_count))) return null;
  const retries = diagnosticRecord(publication.retry_failures, ["observation", "reason", "count"]);
  if (!retries || retries.observation !== "unavailable" || retries.reason !== "not_collected" || retries.count !== null) return null;
  return { schema_version: "runtime-health/v1", sampled_at: root.sampled_at, work_classes: classes as RuntimeHealthResponse["work_classes"],
    publication: { ...publication, retry_failures: { ...retries } } as RuntimeHealthResponse["publication"] };
}
function renderAggregate(value: RuntimeHealthResponse): string {
  const lines = [`Aggregate runtime health — observed ${value.sampled_at}`,
    "Accepted provider output does not certify reader publication.",
    "Dispatchable reflects stored schedule and attempts; it does not certify claim eligibility.",
    "work class | observation | pending | scheduled | dispatchable | active leases | expired leases | failed | exhausted | oldest pending ms | oldest dispatchable ms"];
  const show = (v: unknown) => v === null ? "not_collected" : String(v);
  for (const c of value.work_classes) {
    lines.push([c.work_class, `${c.observation}/${c.reason}`, ...COUNTERS.map((key) => show(c[key as keyof RuntimeWorkClassHealth]))].join(" | "));
    const l = c.completion_latency;
    lines.push(`${c.work_class} accepted-completion latency: count=${show(l.successful_count)} p50_ms=${show(l.p50_ms)} p95_ms=${show(l.p95_ms)} missing_timestamp_count=${show(l.missing_timestamp_count)} coverage=${l.coverage} capture_started=${show(l.measurement_started_at)} window_started=${l.window_started_at}`);
  }
  lines.push(`Publication safety failures: ${show(value.publication.publication_safety_failed_count)} (${value.publication.observation}/${value.publication.reason}); transient publication retry failures: not_collected`,
    "Installed runner enabled classes: not_collected", "Permission/admission: not_collected; exact workflow stages require separate scoped inspection.",
    "Scoped Daily, ontology, portrait and mesh diagnosis: not_collected (unsupported_domain)",
    "Alert adoption: not_configured; no production policy or delivery receipt is established by this tool.");
  return lines.join("\n");
}

/** GET-only operator client: no discovery, artifact bodies, redirects, retries or mutations. */
export async function runRuntimeHealthRead(command: unknown, origin: string, accessAssertion: string, fetcher: typeof fetch = fetch, now?: string): Promise<string> {
  const aggregate = diagnosticRecord(command, ["mode"]);
  const scoped = diagnosticRecord(command, ["mode", "generation_id", "purpose"]);
  let path: string;
  let mode: "aggregate" | "pattern";
  if (aggregate?.mode === "aggregate") {
    mode = "aggregate"; path = "/admin/runtime-health?purpose=incident_response";
  } else if (scoped?.mode === "pattern" && typeof scoped.generation_id === "string" && /^pgen_[a-f0-9]{32}$/.test(scoped.generation_id)
    && member(scoped.purpose, ["quality_review", "safety_investigation", "incident_response", "retention_audit"])) {
    mode = "pattern"; path = `/admin/pattern-generations/${scoped.generation_id}/diagnostics?purpose=${scoped.purpose}`;
  } else return "Diagnostic command unavailable: invalid_scope";
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || typeof accessAssertion !== "string" || accessAssertion.length === 0 || accessAssertion.length > 16384) return "Diagnostic command unavailable: invalid_configuration";
    const response = await fetcher(new URL(path, url.origin), { method: "GET", redirect: "error", cache: "no-store", headers: { "cf-access-jwt-assertion": accessAssertion, accept: "application/json" } });
    const title = mode === "aggregate" ? "Aggregate health" : "Pattern inspection";
    if (!response.ok) return `${title} unavailable: ${[401, 403].includes(response.status) ? "scope_not_authorized" : response.status === 404 ? "record_missing" : "observation_unavailable"}`;
    const raw = await response.text();
    if (raw.length > 65536) return `${title} unavailable: invalid_snapshot`;
    const input: unknown = JSON.parse(raw);
    if (mode === "aggregate") {
      const health = parseRuntimeHealthSnapshot(input);
      return health ? renderAggregate(health) : `${title} unavailable: invalid_snapshot`;
    }
    const snapshot = parsePatternDiagnostics(input);
    if (!snapshot || snapshot.generation_id !== scoped?.generation_id) return `${title} unavailable: invalid_snapshot`;
    return `Private scoped Pattern inspection\n${JSON.stringify(diagnosePattern({ domain: "pattern", authorized: true, snapshot }, now ?? new Date().toISOString()), null, 2)}\nRecovery suggestions are read-only. Current reader access and alert adoption are not established.`;
  } catch { return `${mode === "aggregate" ? "Aggregate health" : "Pattern inspection"} unavailable: observation_unavailable`; }
}
