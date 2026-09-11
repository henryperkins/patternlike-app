import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { sampleRuntimeHealth, expireRuntimeHealthAccess, runtimeHealthAuditExpiry, runtimeHealthQuery } from "./runtime-health.js";
const now = new Date("2026-09-11T12:00:00.000Z");
beforeEach(async () => {
  for (const table of ["runtime_health_capture", "runtime_health_access_events", "portrait_mesh_jobs", "pattern_portrait_jobs", "codex_provider_jobs"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
});
it("reports empty inventories and partial first-day capture with unknown installed runner", async () => {
  const result = await sampleRuntimeHealth(env, now);
  expect(result.work_classes.map(x => x.work_class)).toEqual(["text", "portrait", "mesh"]);
  for (const value of result.work_classes) expect(value).toMatchObject({ observation: "known", pending_count: 0, oldest_pending_age_ms: null, runner_enabled: null, completion_latency: { successful_count: 0, p50_ms: null, coverage: "partial", measurement_started_at: now.toISOString() } });
  expect(result.work_classes[0].retry_exhausted_count).toBeNull();
  expect(result.publication.retry_failures.reason).toBe("not_collected");
});
it("clamps audit expiry to calendar month end and prunes only expired access", async () => {
  expect(runtimeHealthAuditExpiry(new Date("2024-01-31T12:00:00.000Z"))).toBe("2025-02-28T12:00:00.000Z");
  for (const [id, expiry] of [["old", now.toISOString()], ["current", "2026-09-12T12:00:00.000Z"]]) await env.DB.prepare("INSERT INTO runtime_health_access_events VALUES(?, 'admin', 'incident_response', 'granted', '2025-08-11T12:00:00.000Z', ?)").bind(id, expiry).run();
  await expireRuntimeHealthAccess(env, now);
  expect((await env.DB.prepare("SELECT id FROM runtime_health_access_events").all()).results).toEqual([{id:"current"}]);
});

async function seedText(count: number, createdAt = "2026-09-09T12:00:00.000Z") {
  await env.DB.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<?)
    INSERT INTO codex_provider_jobs(id,pipeline,owner_id,user_id,pass,stage_generation,stage_attempt,
    request_hash,request_object_key,request_envelope_hash,request_ciphertext_hash,request_key_id,request_nonce,request_byte_length,
    model,reasoning_effort,prompt_version,timeout_ms,daily_call_limit,status,available_at,created_at,updated_at)
    SELECT 'cpjob_'||printf('%032x',n),'ontology','synthetic-'||n,NULL,'generator',0,0,
    ?,'codex-provider-jobs/synthetic-'||n,?,?,'synthetic',printf('%016x',n),1,
    'synthetic','xhigh','synthetic',900000,1,'pending',?,?,? FROM numbers`)
    .bind(count,`sha256:${"1".repeat(64)}`,`sha256:${"2".repeat(64)}`,`sha256:${"3".repeat(64)}`,createdAt,createdAt,createdAt).run();
}
async function succeedText(completedAt: string) {
  await env.DB.prepare(`UPDATE codex_provider_jobs SET status='completed', lease_token_hash=?,lease_expires_at=?,
    response_hash=?,response_object_key=request_object_key||'/response',response_envelope_hash=?,response_ciphertext_hash=?,
    response_key_id='response-synthetic',response_nonce=request_nonce,response_byte_length=1,provider_request_id='synthetic',input_tokens=0,output_tokens=0,completed_at=?`)
    .bind(`sha256:${"4".repeat(64)}`,now.toISOString(),`sha256:${"5".repeat(64)}`,`sha256:${"6".repeat(64)}`,`sha256:${"7".repeat(64)}`,completedAt).run();
}
it("refuses partial counts beyond the materialized ceiling while preserving other classes",async()=>{
  await seedText(10_001);
  const result = await sampleRuntimeHealth(env,now);
  expect(result.work_classes[0]).toMatchObject({observation:"unavailable",reason:"sample_limit_exceeded",pending_count:null,completion_latency:{successful_count:null}});
  expect(result.work_classes[1].observation).toBe("known");
});
it("skips large historical success backlogs via the state/time index",async()=>{
  await seedText(20_000);
  await succeedText("2026-09-09T13:00:00.000Z");
  const query = runtimeHealthQuery("text");
  const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query}`).bind("2026-09-10T12:00:00.000Z","text").all<{detail:string}>();
  const searches = plan.results.filter(row=>row.detail.includes("SEARCH codex_provider_jobs"));
  expect(searches).toHaveLength(3);
  expect(searches.every(row=>row.detail.includes("idx_runtime_text_state_time"))).toBe(true);
  const bounded = await env.DB.prepare(query).bind("2026-09-10T12:00:00.000Z","text").all();
  expect(bounded.results).toHaveLength(1); // capture metadata only
  expect(bounded.meta.rows_read).toBeLessThan(10);
  const result = await sampleRuntimeHealth(env,now);
  expect(result.work_classes[0]).toMatchObject({observation:"known",pending_count:0,completion_latency:{successful_count:0,p50_ms:null}});
});
it("uses inclusive 24-hour boundaries and nearest-rank successful latency",async()=>{
  await seedText(4,"2026-09-10T11:59:59.000Z");
  await succeedText("2026-09-10T12:00:00.000Z");
  await env.DB.prepare("UPDATE codex_provider_jobs SET completed_at=CASE owner_id WHEN 'synthetic-1' THEN '2026-09-10T11:59:59.999Z' WHEN 'synthetic-2' THEN '2026-09-10T12:00:00.000Z' WHEN 'synthetic-3' THEN '2026-09-10T12:00:02.000Z' ELSE ? END").bind(now.toISOString()).run();
  expect((await sampleRuntimeHealth(env,now)).work_classes[0].completion_latency).toMatchObject({successful_count:3,p50_ms:3000,p95_ms:86401000});
  await env.DB.prepare("UPDATE codex_provider_jobs SET completed_at=? WHERE owner_id='synthetic-4'").bind(new Date(now.getTime()+1).toISOString()).run();
  expect((await sampleRuntimeHealth(env,now)).work_classes[0]).toMatchObject({observation:"unavailable",reason:"invalid_timestamp"});
});
it("distinguishes a missing asset schema from an empty queue",async()=>{
  await env.DB.prepare("ALTER TABLE portrait_mesh_jobs RENAME COLUMN completed_at TO completion_capture_unavailable").run();
  try {
    const result = await sampleRuntimeHealth(env,now);
    expect(result.work_classes[2]).toMatchObject({observation:"unavailable",reason:"schema_unavailable",failed_count:null});
    expect(result.work_classes[0].observation).toBe("known");
  } finally { await env.DB.prepare("ALTER TABLE portrait_mesh_jobs RENAME COLUMN completion_capture_unavailable TO completed_at").run(); }
});
it("bounds audit cleanup to 500 expired rows",async()=>{
  await env.DB.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<501) INSERT INTO runtime_health_access_events SELECT 'synthetic-'||x,'admin','incident_response','granted','2025-08-11T12:00:00.000Z','2026-09-11T12:00:00.000Z' FROM n").run();
  await expireRuntimeHealthAccess(env,now);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM runtime_health_access_events").first()).toEqual({n:1});
});
it("contains partial query failures and never exposes raw errors",async()=>{
  const broken = Object.create(env) as typeof env;
  Object.defineProperty(broken,"DB",{value:new Proxy(env.DB,{get(target,key){
    if(key==="prepare") return (sql:string)=>{
      if(sql.includes("FROM portrait_mesh_jobs")) throw new Error("private-account prompt object-key raw-provider-error");
      return target.prepare(sql);
    };
    const value = Reflect.get(target,key);
    return typeof value==="function" ? value.bind(target):value;
  }})});
  const result = await sampleRuntimeHealth(broken,now);
  expect(result.work_classes[2]).toMatchObject({observation:"unavailable",reason:"query_failed",pending_count:null});
  expect(result.work_classes[0].observation).toBe("known");
  expect(JSON.stringify(result)).not.toMatch(/private-account|object-key|prompt|provider-error/);
});
it("classifies text schedules and leases without inventing a per-exchange attempt ceiling",async()=>{
  await seedText(3);
  await env.DB.prepare("UPDATE codex_provider_jobs SET available_at=? WHERE owner_id='synthetic-1'").bind(new Date(now.getTime()+1).toISOString()).run();
  await env.DB.prepare("UPDATE codex_provider_jobs SET status='leased',lease_token_hash=?,lease_expires_at=? WHERE owner_id='synthetic-3'").bind(`sha256:${"4".repeat(64)}`,now.toISOString()).run();
  expect((await sampleRuntimeHealth(env,now)).work_classes[0]).toMatchObject({pending_count:2,scheduled_pending_count:1,dispatchable_pending_count:1,active_lease_count:0,expired_lease_count:1,oldest_pending_age_ms:172800000,retry_exhausted_count:null,retry_exhaustion_observation:"not_collected"});
});
