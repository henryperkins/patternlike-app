import { newId, type RuntimeHealthResponse, type RuntimeHealthReason, type RuntimeWorkClass, type RuntimeWorkClassHealth } from "@patternlike/shared";
import type { Env } from "../env.js";

export const RUNTIME_HEALTH_SAMPLE_LIMIT = 10_000;
const DAY_MS = 86_400_000;
const CLASSES = ["text", "portrait", "mesh"] as const;
interface MetricRow {
  status: string; created_at: string; dispatch_at: string | null;
  lease_expires_at: string | null; completed_at: string | null; attempts: number | null;
  measurement_started_at: string | null;
}
/** Three disjoint indexed branches; old timestamped successes are never materialized.
 * One SQL statement gives a consistent class snapshot, including capture metadata.
 * LIMIT+1 is an overflow sentinel, never an approximate count. */
export function runtimeHealthQuery(workClass: RuntimeWorkClass): string {
  const text = workClass === "text";
  const table = text ? "codex_provider_jobs" : workClass === "portrait" ? "pattern_portrait_jobs" : "portrait_mesh_jobs";
  const success = text ? "completed" : "complete";
  const columns = `status,created_at,${text ? "available_at" : "retry_at"} AS dispatch_at,lease_expires_at,completed_at,${text ? "NULL" : "attempts"} AS attempts`;
  return `WITH bounded AS (
    SELECT ${columns} FROM ${table} WHERE status IN ('pending','${text ? "leased" : "running"}','failed')
    UNION ALL SELECT ${columns} FROM ${table} WHERE status='${success}' AND julianday(completed_at)>=julianday(?1)
    UNION ALL SELECT ${columns} FROM ${table} WHERE status='${success}' AND julianday(completed_at) IS NULL
    LIMIT ${RUNTIME_HEALTH_SAMPLE_LIMIT + 1}
  ) SELECT bounded.*, (SELECT started_at FROM runtime_health_capture WHERE work_class=?2) AS measurement_started_at FROM bounded
  UNION ALL SELECT NULL,NULL,NULL,NULL,NULL,NULL,(SELECT started_at FROM runtime_health_capture WHERE work_class=?2)`;
}
function unavailable(workClass: RuntimeWorkClass, reason: RuntimeHealthReason, window: string): RuntimeWorkClassHealth {
  return {work_class: workClass, observation: "unavailable", reason, runner_enabled: null,
    pending_count: null, scheduled_pending_count: null, dispatchable_pending_count: null,
    active_lease_count: null, expired_lease_count: null, failed_count: null, retry_exhausted_count: null,
    retry_exhaustion_observation: "not_collected",
    oldest_pending_age_ms: null, oldest_dispatchable_pending_age_ms: null,
    completion_latency: {successful_count: null,p50_ms: null,p95_ms: null,missing_timestamp_count: null,measurement_started_at: null,window_started_at: window,coverage: "unavailable"},
  };
}
function timestamp(value: string | null): number {
  if (typeof value !== "string") throw new Error("invalid_timestamp");
  const parsed = Date.parse(value);
  // Round-tripping rejects impossible calendar dates, while allowing stored seconds.
  if (!Number.isSafeInteger(parsed) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || new Date(parsed).toISOString().slice(0,19) !== value.slice(0,19)) throw new Error("invalid_timestamp");
  return parsed;
}
function aggregate(workClass: RuntimeWorkClass, rows: MetricRow[], now: Date, window: string): RuntimeWorkClassHealth {
  const metadata = rows.pop();
  if (rows.length > RUNTIME_HEALTH_SAMPLE_LIMIT) return unavailable(workClass,"sample_limit_exceeded",window);
  const result = unavailable(workClass,"observed",window);
  const time = now.getTime();
  const windowStartedAt = timestamp(window);
  const started = timestamp(metadata?.measurement_started_at ?? null);
  if (started > time) throw new Error("invalid_timestamp");
  Object.assign(result,{observation:"known",pending_count:0,scheduled_pending_count:0,dispatchable_pending_count:0,active_lease_count:0,expired_lease_count:0,failed_count:0,retry_exhausted_count: workClass === "text" ? null : 0, retry_exhaustion_observation:workClass === "text" ? "not_collected" : "known"});
  const durations: number[] = [];
  let missing = 0;
  for (const row of rows) {
    const created = timestamp(row.created_at);
    if (created > time) throw new Error("invalid_timestamp");
    const age = time-created;
    if (row.status === "pending") {
      result.pending_count!++;
      result.oldest_pending_age_ms = Math.max(result.oldest_pending_age_ms ?? 0,age);
      const scheduled = row.dispatch_at === null ? false : timestamp(row.dispatch_at)>time;
      if (scheduled) result.scheduled_pending_count!++;
      else if (workClass === "text" || (row.attempts !== null && row.attempts<3)) {
        result.dispatchable_pending_count!++;
        result.oldest_dispatchable_pending_age_ms = Math.max(result.oldest_dispatchable_pending_age_ms ?? 0,age);
      }
    } else if (row.status === "leased" || row.status === "running") {
      if (timestamp(row.lease_expires_at)>time) result.active_lease_count!++;
      else result.expired_lease_count!++;
    } else if (row.status === "failed") {
      result.failed_count!++;
      if (workClass !== "text" && row.attempts !== null && row.attempts>=3) result.retry_exhausted_count!++;
    } else if (row.completed_at === null) missing++;
    else {
      const completed = timestamp(row.completed_at);
      if (completed>time || completed<created) throw new Error("invalid_timestamp");
      // Collection can advance the shared clock beyond the query's lower bound.
      if (completed >= windowStartedAt) durations.push(completed-created);
    }
  }
  durations.sort((a,b)=>a-b);
  result.completion_latency = {successful_count:durations.length,p50_ms:durations[Math.ceil(.5*durations.length)-1]??null,p95_ms:durations[Math.ceil(.95*durations.length)-1]??null,missing_timestamp_count:missing,measurement_started_at:new Date(started).toISOString(),window_started_at:window,coverage:started<=time-DAY_MS && missing===0 ? "complete":"partial"};
  return result;
}
async function collectClass(env: Env, workClass: RuntimeWorkClass, now: Date, window: string): Promise<MetricRow[] | RuntimeHealthReason> {
  try {
    // First actual instrumentation use starts coverage; migration application alone does not.
    await env.DB.prepare("INSERT OR IGNORE INTO runtime_health_capture(work_class,started_at) VALUES(?,?)").bind(workClass,now.toISOString()).run();
    const data = await env.DB.prepare(runtimeHealthQuery(workClass)).bind(window,workClass).all<MetricRow>();
    return data.success ? data.results : "query_failed";
  } catch {
    // Identify schema absence with a fixed metadata projection, never exception text.
    try {
      const table = workClass === "text" ? "codex_provider_jobs" : workClass === "portrait" ? "pattern_portrait_jobs" : "portrait_mesh_jobs";
      const columns = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{name:string}>();
      const capture = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_health_capture'").first();
      if (!capture || !columns.results.some(column=>column.name==="completed_at")) return "schema_unavailable";
    } catch { /* A failed metadata probe cannot assert schema absence. */ }
    return "query_failed";
  }
}
async function collectPublication(env: Env): Promise<RuntimeHealthResponse["publication"]> {
  const publication: RuntimeHealthResponse["publication"] = {observation:"unavailable",reason:"query_failed",publication_safety_failed_count:null,retry_failures:{observation:"unavailable",reason:"not_collected",count:null}};
  try {
    const rows = await env.DB.prepare(`SELECT failure_class FROM pattern_generation_jobs WHERE stage='failed' AND failure_class='publication_safety_failed' LIMIT ${RUNTIME_HEALTH_SAMPLE_LIMIT+1}`).all();
    if (rows.success && rows.results.length<=RUNTIME_HEALTH_SAMPLE_LIMIT) Object.assign(publication,{observation:"known",reason:"observed",publication_safety_failed_count:rows.results.length});
    else if (rows.success) publication.reason="sample_limit_exceeded";
  } catch { /* Fixed unavailable projection; no error content. */ }
  return publication;
}
/** A supplied Date freezes the observation clock for deterministic callers. */
export async function sampleRuntimeHealth(env: Env, now?: Date): Promise<RuntimeHealthResponse> {
  const startedAt = new Date(now ?? Date.now());
  const queryWindow = new Date(startedAt.getTime()-DAY_MS).toISOString();
  const [snapshots, publication] = await Promise.all([
    Promise.all(CLASSES.map(workClass=>collectClass(env,workClass,startedAt,queryWindow))),
    collectPublication(env),
  ]);
  // A reservation/adoption may happen during D1 I/O. Use the collection end
  // for every class, rather than treating normal concurrent work as future data.
  // Each class still has a consistent SQL snapshot, with collection lag bounded
  // by this request. The materialization ceiling remains conservative if old
  // successes leave the latency window while snapshots are being collected.
  const sampledAt = now ? startedAt : new Date(Math.max(startedAt.getTime(),Date.now()));
  const window = new Date(sampledAt.getTime()-DAY_MS).toISOString();
  const classes = CLASSES.map((workClass,index)=>{
    const snapshot = snapshots[index]!;
    if (typeof snapshot === "string") return unavailable(workClass,snapshot,window);
    try { return aggregate(workClass,snapshot,sampledAt,window); }
    catch { return unavailable(workClass,"invalid_timestamp",window); }
  });
  return {schema_version:"runtime-health/v1",sampled_at:sampledAt.toISOString(),work_classes:[classes[0]!,classes[1]!,classes[2]!],publication};
}
export function runtimeHealthAuditExpiry(createdAt: Date): string {
  const expiry = new Date(createdAt);
  const day = expiry.getUTCDate();
  expiry.setUTCDate(1);
  expiry.setUTCMonth(expiry.getUTCMonth()+13);
  const last = new Date(Date.UTC(expiry.getUTCFullYear(),expiry.getUTCMonth()+1,0)).getUTCDate();
  expiry.setUTCDate(Math.min(day,last));
  return expiry.toISOString();
}
export async function recordRuntimeHealthAccess(env: Env, subject: string, result: "granted"|"denied"|"unavailable", now: Date): Promise<void> {
  const write = await env.DB.prepare("INSERT INTO runtime_health_access_events(id,admin_subject,purpose_class,result,created_at,expires_at) VALUES(?,?,'incident_response',?,?,?)").bind(newId("rha"),subject,result,now.toISOString(),runtimeHealthAuditExpiry(now)).run();
  if (!write.success) throw new Error("runtime_health_audit_unavailable");
}
export async function expireRuntimeHealthAccess(env: Env, now: Date): Promise<void> {
  await env.DB.prepare("DELETE FROM runtime_health_access_events WHERE id IN (SELECT id FROM runtime_health_access_events WHERE expires_at<=? ORDER BY expires_at,id LIMIT 500)").bind(now.toISOString()).run();
}
