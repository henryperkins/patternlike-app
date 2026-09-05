import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import type { CodexPortraitCompletion, CodexPortraitClaim, PatternPortraitResponse, PatternResponseV7 } from "@patternlike/shared";
import { contentHash } from "@patternlike/shared";
import { decryptPatternDocument, loadAnyPatternDocument } from "../services/pattern-state.js";
import { encryptUnderContentKey, randomNonce, unwrapContentKey } from "../services/pattern-crypto.js";
import { b64 } from "../crypto.js";
import { maintainPortraits, nextPortraitMaintenanceBatch, claimPortrait, PORTRAIT_LEASE_MS } from "../services/pattern-portrait.js";
import { processDeletionMessage } from "../services/account-deletion.js";
import { applyPatternReplayEvent, writePatternReplayIntent } from "../services/pattern-replay-ledger.js";
import { collectDeletionArtifactKeys } from "../services/deletion-manifest.js";
import { app } from "../index.js";
import { createSyntheticPatternPublisher } from "../services/pattern-publisher-factory.js";
import { executePatternJob } from "../services/pattern-execute.js";
import { IDENTITY_A, IDENTITY_B, USER_A, USER_B, confirmPreferences, disablePatternAi, enablePatternAi, resetDb, seedActiveOntology, seedChart, seedUser } from "../../test/helpers.js";
import { clearPatternReplayObjects, generatePatternReplayTestKeys, installPatternReplayTestKeys } from "../../test/pattern-replay-fixtures.js";

const TOKEN = "portrait-test-runner-token-1234567890";
const enabledEnv = () => Object.defineProperties(Object.create(env), { PATTERN_PORTRAIT_ENABLED: { value:"1",configurable:true }, CODEX_RUNNER_TOKEN: { value:TOKEN,configurable:true } });
async function user(path: string, body?: unknown, userId = USER_A, extra: RequestInit = {}) {
  return app.fetch(new Request(`https://api.test${path}`, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), ...extra, headers: { "x-user-id": userId, "content-type": "application/json", "idempotency-key": "portrait-create-test-0001", ...extra.headers } }), enabledEnv());
}
async function machine(path: string, body: unknown, bindings = enabledEnv()) {
  return app.fetch(new Request(`https://api.test/codex-provider/v1/portraits${path}`, { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } }), bindings);
}
let document: PatternResponseV7;
let chartId: string;
function request() { return { pattern_id: document.pattern_id, generated_at: document.generated_at, chart_id: chartId, confirm: "CREATE MY PORTRAIT", consent_policy_version: "1.0.0" }; }

beforeEach(async () => {
  await resetDb();
  await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
  installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
  enablePatternAi();
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A);
  ({ chartId } = await seedChart(IDENTITY_A, { positions: ["sun","moon","mercury","venus","mars","jupiter","saturn","uranus","neptune","pluto"].map((body,index) => ({ body: body as "sun", longitude_deg: 12 + index * 31, speed_longitude_deg_per_day: 1, retrograde: false })) }));
  await seedActiveOntology();
  const res = await user("/v1/pattern-generations", { schema_version: "0.7.0", consent_policy_version: "1.1.0", confirm: "GENERATE MY PATTERN", reason: "first_open" });
  expect(res.status).toBe(202);
  const accepted = await res.json() as { generation: { generation_id: string } };
  for (let step = 0; step < 8; step++) {
    const row = await env.DB.prepare("SELECT job_id, stage, stage_generation FROM pattern_generation_jobs WHERE generation_id = ?").bind(accepted.generation.generation_id).first<{ job_id: string; stage: string; stage_generation: number }>();
    if (row?.stage === "succeeded") break;
    if (!row || row.stage === "failed") throw new Error("fixture Pattern failed");
    await executePatternJob(env, { kind: "pattern_generation", job_id: row.job_id, generation_id: accepted.generation.generation_id, stage_generation: row.stage_generation }, new Date(), { publisher: ({pin,packet,ontology}) => {
      const four = structuredClone(packet) as { selection_constraints: { core_chapters_min:number;core_chapters_max:number } };
      four.selection_constraints.core_chapters_min=4;four.selection_constraints.core_chapters_max=4;
      return createSyntheticPatternPublisher({ forceReject:false, packet:four,ontology,publisher:pin.publisher,measured:true });
    } });
  }
  const pattern = await user("/v1/pattern");
  expect(pattern.status).toBe(200);
  document = await pattern.json() as PatternResponseV7;
  expect(document.core_chapters).toHaveLength(4);
});
afterEach(() => { disablePatternAi(); });

describe("personalized portrait outbox", () => {
  it("admits one durable set of four chapters and replays creation", async () => {
    const before = await user("/v1/pattern-portrait");
    expect(before.status).toBe(200);
    expect((await before.json() as PatternPortraitResponse).status).toBe("not_started");
    const start = await user("/v1/pattern-portrait-generations", request());
    expect(start.status).toBe(202);
    const first = await start.json() as PatternPortraitResponse;
    expect(first.status).toBe("generating");
    expect(first.document_revision).toBe(`${document.schema_version}:${document.pattern_id}:${document.generated_at}`);
    const again = await user("/v1/pattern-portrait-generations", request());
    expect((await again.json() as PatternPortraitResponse).portrait_id).toBe(first.portrait_id);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM pattern_portrait_jobs").first<{ n: number }>();
    expect(count?.n).toBe(4);
    const claimResponse = await machine("/claim", {});
    expect(claimResponse.status).toBe(200);
    const claim = await claimResponse.json() as CodexPortraitClaim;
    expect(claim.chapter_index).toBe(0);
    expect(claim.image_model).toBe("gpt-image-2");
    expect(claim.prompt).toContain(document.core_chapters[0]!.summary);
    expect(claim.prompt).not.toContain(document.core_chapters[1]!.summary);
  });
  it("rejects stale revisions and another owner's Pattern", async () => {
    expect((await user("/v1/pattern-portrait-generations", { ...request(), generated_at: "2000-01-01T00:00:00.000Z" })).status).toBe(409);
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_B);
    await seedChart(IDENTITY_B);
    expect((await user("/v1/pattern-portrait-generations", request(), USER_B)).status).toBe(409);
  });
  it("stays isolated when rollout is absent", async () => {
    const result = await app.fetch(new Request("https://api.test/v1/pattern-portrait", { headers: { "x-user-id": USER_A } }), Object.defineProperty(Object.create(env), "PATTERN_PORTRAIT_ENABLED", {value:undefined}));
    expect(result.status).toBe(200);
    expect((await result.json() as PatternPortraitResponse).status).toBe("unavailable");
  });
});

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII=";
function completed(claim: CodexPortraitClaim): CodexPortraitCompletion {
  const pixels = new Uint8Array(128*128*4);
  for(let y=0;y<128;y++) for(let x=0;x<128;x++) {
    const at=(y*128+x)*4; const inside=x>25+claim.chapter_index*4 && x<97 && y>20 && y<108-claim.chapter_index*5;
    pixels[at]=pixels[at+1]=pixels[at+2]=inside?32:255;pixels[at+3]=255;
  }
  return {lease_token:claim.lease_token,source_sha256:claim.source_sha256,label:`Object ${claim.chapter_index+1}`,rationale:"An object expressing the full chapter.",image_base64:PNG,original_sha256:"a".repeat(64),pixels:{width:128,height:128,rgba_base64:b64(pixels)},provider_request_id:"thread:turn",image_request_id:"native-tool-call",image_model:"gpt-image-2"};
}
async function start() { const res=await user("/v1/pattern-portrait-generations",request());expect(res.status).toBe(202);return await res.json() as PatternPortraitResponse; }
async function take() { const res=await machine("/claim",{});expect(res.status).toBe(200);return await res.json() as CodexPortraitClaim; }
async function finish(claim: CodexPortraitClaim) { const res=await machine(`/${claim.job_id}/complete`,completed(claim));expect(res.status,await res.clone().text()).toBe(200); }
async function ready() { await start();for(let i=0;i<4;i++) await finish(await take());return await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse; }

describe("portrait durable completion and privacy",() => {
  it("saves exactly four images and a stable encrypted graph, with private image and download routes",async () => {
    const result=await ready();expect(result.status).toBe("ready");expect(result.completed_chapters).toBe(4);expect(result.chapters).toHaveLength(4);expect(result.graph?.engine_version).toBe("constellation-v1");
    const reopen=await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse;
    expect(reopen).toEqual(result);expect((await machine("/claim",{})).status).toBe(204);
    const image=await user(`/v1/pattern-portrait/images/${result.chapters[0]!.reference_id}`);expect(image.status).toBe(200);expect(image.headers.get("content-type")).toBe("image/png");expect(image.headers.get("cache-control")).toBe("private, no-store");expect(b64(await image.arrayBuffer())).toBe(PNG);
    const keys=await collectDeletionArtifactKeys(enabledEnv(),USER_A);const portraitKeys=keys.filter((key)=>key.startsWith("pattern-portraits/"));expect(portraitKeys).toHaveLength(9);
    const object=await env.ARTIFACTS!.get(portraitKeys[0]!);expect(object).not.toBeNull();expect(await object!.text()).not.toContain("Object 1");
    const bundle=await user(`/v1/pattern-portrait/download?pattern_id=${document.pattern_id}&chart_id=${chartId}&generated_at=${encodeURIComponent(document.generated_at)}`);expect(bundle.status).toBe(200);const body=await bundle.json() as {portrait:PatternPortraitResponse;images:unknown[]};expect(body.portrait).toEqual(result);expect(body.images).toHaveLength(4);
    expect((await user("/v1/pattern-portrait/download?pattern_id=stale")).status).toBe(409);
    await seedUser(IDENTITY_B);expect((await user(`/v1/pattern-portrait/images/${result.chapters[0]!.reference_id}`,undefined,USER_B)).status).toBe(404);
  });
  it("replays the same completion, rejects changed content, and resumes only missing chapters",async () => {
    await start();const claim=await take();await finish(claim);await finish(claim);
    expect((await machine(`/${claim.job_id}/complete`,{...completed(claim),label:"Different object"})).status).toBe(409);
    const partial=await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse;expect(partial.status).toBe("generating");expect(partial.completed_chapters).toBe(1);expect(partial.graph).toBeNull();expect((await take()).chapter_index).toBe(1);
  });
  it("expires a claim and refuses its late result without overwriting a successor",async () => {
    await start();const old=await take();
    await env.DB.prepare("UPDATE pattern_portrait_jobs SET lease_expires_at = ? WHERE id = ?").bind("2000-01-01T00:00:00.000Z",old.job_id).run();
    const next=await take();expect(next.job_id).toBe(old.job_id);expect(next.lease_token).not.toBe(old.lease_token);
    expect((await machine(`/${old.job_id}/complete`,completed(old))).status).toBe(409);await finish(next);
  });
  it("cancels before late completion on Pattern deletion and durably erases registered images",async () => {
    const portrait=await start();const first=await take();await finish(first);const second=await take();
    const deletion=await user("/v1/pattern",{confirm:"DELETE PATTERN"},USER_A,{method:"DELETE"});expect([202,204]).toContain(deletion.status);
    expect((await machine(`/${second.job_id}/complete`,completed(second))).status).toBe(409);
    await maintainPortraits(enabledEnv());
    const files=await env.ARTIFACTS!.list({prefix:`pattern-portraits/${portrait.portrait_id}/`});expect(files.objects).toEqual([]);
    const row=await env.DB.prepare("SELECT status FROM pattern_portraits WHERE id = ?").bind(portrait.portrait_id).first<{status:string}>();expect(row?.status).toBe("cancelled");
  });
  it("rejects malformed images and a wrong source revision without accepting a chapter",async () => {
    await start();const claim=await take();
    expect((await machine(`/${claim.job_id}/complete`,{...completed(claim),image_base64:b64(new Uint8Array([1,2,3]))})).status).toBe(400);
    expect((await machine(`/${claim.job_id}/complete`,{...completed(claim),source_sha256:"b".repeat(64)})).status).toBe(409);
    const response=await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse;expect(response.completed_chapters).toBe(0);
  });
  it("retains a ready portrait on consent revocation but cancels unfinished generation",async () => {
    const result=await ready();
    const revoke=await user("/v1/consents/pattern-generation",{},USER_A,{method:"DELETE"});expect(revoke.status).toBe(200);
    expect((await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse).graph).toEqual(result.graph);
  });
  it("cancels new work when processing consent or the active profile changes",async () => {
    await start();const claim=await take();
    await env.DB.prepare("UPDATE consents SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND kind = 'account_processing'").bind(new Date().toISOString(),USER_A).run();
    expect((await machine(`/${claim.job_id}/complete`,completed(claim))).status).toBe(409);expect((await machine("/claim",{})).status).toBe(204);
  });
  it("bounds attempts and never regenerates an accepted chapter",async () => {
    await start();const claim=await take();await finish(claim);
    const next=await take();await env.DB.prepare("UPDATE pattern_portrait_jobs SET attempts = 3, lease_expires_at = ? WHERE id = ?").bind("2000-01-01T00:00:00.000Z",next.job_id).run();
    await claimPortrait(enabledEnv(),new Date(Date.now()+PORTRAIT_LEASE_MS));
    const status=await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse;expect(status.status).toBe("failed");expect(status.retryable).toBe(false);expect(status.completed_chapters).toBe(1);
  });
  it("reports a missing saved image instead of claiming a complete ready set",async () => {
    const result=await ready();const asset=await env.DB.prepare("SELECT object_key FROM pattern_portrait_assets WHERE id = ?").bind(result.chapters[0]!.reference_id).first<{object_key:string}>();await env.ARTIFACTS!.delete(asset!.object_key);
    const response=await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse;expect(response.status).toBe("failed");expect(response.retryable).toBe(false);expect(response.graph).toBeNull();
  });
});

function withPut(put: R2Bucket["put"]) {
  return Object.defineProperty(enabledEnv(),"ARTIFACTS",{ value:new Proxy(env.ARTIFACTS!,{ get(target,property,receiver) { if(property === "put") return put;const value=Reflect.get(target,property,receiver);return typeof value === "function" ? value.bind(target):value; } }) });
}
describe("portrait upload and lifecycle races",() => {
  it("keeps pre-registered upload inventory and retries the same image after an R2 outage",async () => {
    await start();const claim=await take();
    const unavailable=withPut((async ()=>{throw new Error("injected R2 outage");}) as R2Bucket["put"]);
    expect((await machine(`/${claim.job_id}/complete`,completed(claim),unavailable)).status).toBe(503);
    const inventory=await env.DB.prepare("SELECT COUNT(*) n FROM pattern_portrait_assets").first<{n:number}>();expect(inventory?.n).toBe(1);
    await finish(claim);expect((await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse).completed_chapters).toBe(1);
  });
  it("fences deletion during the R2 put and sweeps the late ciphertext",async () => {
    const portrait=await start();const claim=await take();let injected=false;
    const racing=withPut((async (...args: Parameters<R2Bucket["put"]>)=>{
      if(!injected) { injected=true;const result=await user("/v1/pattern",{confirm:"DELETE PATTERN"},USER_A,{method:"DELETE"});expect([202,204]).toContain(result.status); }
      return env.ARTIFACTS!.put(...args);
    }) as R2Bucket["put"]);
    expect((await machine(`/${claim.job_id}/complete`,completed(claim),racing)).status).toBe(409);
    await maintainPortraits(enabledEnv());expect((await env.ARTIFACTS!.list({prefix:`pattern-portraits/${portrait.portrait_id}/`})).objects).toEqual([]);
  });
  it("erases all portrait inventory through the existing account deletion workflow",async () => {
    const result=await ready();const response=await user("/v1/account",{confirm:"DELETE"},USER_A,{method:"DELETE"});expect(response.status).toBe(202);
    const accepted=await response.json() as {job_id:string};expect(await processDeletionMessage(enabledEnv(),{kind:"privacy",job_id:accepted.job_id,job_type:"delete_account"})).toBe("ack");
    expect((await env.ARTIFACTS!.list({prefix:`pattern-portraits/${result.portrait_id}/`})).objects).toEqual([]);
    expect(await env.DB.prepare("SELECT 1 FROM pattern_portraits WHERE user_id = ?").bind(USER_A).first()).toBeNull();
    const manifest=await env.DB.prepare("SELECT artifact_manifest_json FROM deletion_requests WHERE user_id = ?").bind(USER_A).first<{artifact_manifest_json:string}>();expect(JSON.parse(manifest!.artifact_manifest_json).filter((key:string)=>key.startsWith("pattern-portraits/"))).toHaveLength(9);
  });
  it("invalidates a restored portrait when signed Pattern erasure is replayed",async () => {
    const portrait=await ready();const row=await env.DB.prepare("SELECT claim_id,generation_id,chart_fingerprint_hash,ontology_version FROM pattern_documents WHERE id = ?").bind(document.pattern_id).first<{claim_id:string;generation_id:string;chart_fingerprint_hash:string;ontology_version:string}>();
    const replay=await writePatternReplayIntent(enabledEnv(),{eventClass:"pattern_deleted",semanticOperationKey:"portrait-replay-test",targetUserId:USER_A,chartFingerprintHash:row!.chart_fingerprint_hash,claimId:row!.claim_id,generationId:row!.generation_id,patternId:document.pattern_id,ontologyVersion:row!.ontology_version,priorClaimStatus:"accepted",nextClaimStatus:"deleted"},new Date());
    await applyPatternReplayEvent(enabledEnv(),replay.event);await maintainPortraits(enabledEnv());
    expect((await env.ARTIFACTS!.list({prefix:`pattern-portraits/${portrait.portrait_id}/`})).objects).toEqual([]);
    expect((await user(`/v1/pattern-portrait/images/${portrait.chapters[0]!.reference_id}`)).status).toBe(404);
  });
  it("requires all exact revision coordinates before preparing a private download",async () => {
    await ready();expect((await user("/v1/pattern-portrait/download")).status).toBe(409);
  });
});

it("fairly reserves maintenance beyond one hundred established portraits",async () => {
  const portrait=await start();
  const columns="user_id,generation_id,chart_id,chart_fingerprint_hash,document_revision,document_hash,generated_at,ontology_version,processing_consent_id,pattern_consent_id,consent_policy_version,sun_sign,status,created_at,updated_at";
  await env.DB.batch(Array.from({length:101},(_,index)=>env.DB.prepare(`INSERT INTO pattern_portraits (id,pattern_id,${columns}) SELECT ?,?,${columns} FROM pattern_portraits WHERE id = ?`).bind(`ppor_scan_${index.toString().padStart(3,"0")}`,`pat_scan_${index}`,portrait.portrait_id)));
  const first=await nextPortraitMaintenanceBatch(enabledEnv(),new Date());
  expect(first).toHaveLength(100);
  const next=await nextPortraitMaintenanceBatch(enabledEnv(),new Date(Date.now()+1000));
  const visited=new Set([...first,...next].map((row)=>row.id));expect(visited.size).toBe(102);
});

it.each([3,5])("keeps a %i-chapter Pattern readable while portrait creation is unavailable",async (count) => {
  const row=(await loadAnyPatternDocument(env,USER_A))!;const internal=await decryptPatternDocument(env,IDENTITY_A,row);
  internal.artifact.chapters=Array.from({length:count},(_,index)=>({...internal.artifact.chapters[index%4]!,chapter_key:`chapter_0${index+1}`}));
  const key=await unwrapContentKey(env,IDENTITY_A,row.id,"pattern_documents.wrapped_document_key_enc",{key_version:row.wrapped_document_key_version,nonce:row.wrapped_document_key_nonce,ciphertext:b64(row.wrapped_document_key_enc)});const nonce=randomNonce();const cipher=await encryptUnderContentKey(internal,key,nonce,new TextEncoder().encode(JSON.stringify(["patternlike.pattern-document",1,row.id,row.generation_id])));
  await env.DB.prepare("UPDATE pattern_documents SET document_enc = ?,document_nonce = ?,content_hash = ? WHERE id = ?").bind(cipher,b64(nonce),await contentHash(JSON.stringify(internal)),row.id).run();
  expect((await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse).status).toBe("unavailable");expect((await user("/v1/pattern-portrait-generations",request())).status).toBe(409);
  const reading=await user("/v1/pattern");expect(reading.status).toBe(200);expect((await reading.json() as PatternResponseV7).core_chapters).toHaveLength(count);
});
it("keeps an accepted portrait readable after a later locale preference change",async () => {
  const portrait=await ready();await env.DB.prepare("UPDATE users SET locale = 'fr-FR' WHERE id = ?").bind(USER_A).run();expect((await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse).graph).toEqual(portrait.graph);
});

it("keeps account deletion working before 0026 when portrait rollout is absent",async () => {
  const triggers=(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'pattern_portrait_%'").all<{name:string}>()).results;
  const migration=env.TEST_MIGRATIONS.find((item)=>item.name === "0026_pattern_portraits.sql")!;
  await env.DB.batch([...triggers.map(({name})=>env.DB.prepare(`DROP TRIGGER ${name}`)),...['pattern_portrait_assets','pattern_portrait_jobs','pattern_portraits'].map((table)=>env.DB.prepare(`DROP TABLE ${table}`))]);
  try {
    const disabled=Object.defineProperty(Object.create(env),"PATTERN_PORTRAIT_ENABLED",{value:undefined});
    const response=await app.fetch(new Request("https://api.test/v1/account",{method:"DELETE",headers:{"x-user-id":USER_A,"content-type":"application/json","idempotency-key":"portrait-premigration-delete"},body:JSON.stringify({confirm:"DELETE"})}),disabled);
    expect(response.status).toBe(202);const accepted=await response.json() as {job_id:string};
    expect(await processDeletionMessage(disabled,{kind:"privacy",job_id:accepted.job_id,job_type:"delete_account"})).toBe("ack");
    expect((await env.DB.prepare("SELECT status FROM users WHERE id = ?").bind(USER_A).first<{status:string}>())?.status).toBe("deleted");
  } finally {
    await env.DB.batch(migration.queries.map((query)=>env.DB.prepare(query)));
  }
});

it.each(["blank","low_contrast"])("rejects %s samples before completing a chapter and recovers only missing work",async (kind) => {
  await start();for(let index=0;index<3;index++) await finish(await take());const claim=await take();
  const body=completed(claim);const pixels=new Uint8Array(128*128*4);
  for(let index=0;index<pixels.length;index+=4) { const gray=kind === "blank" ? 255 : (index%32 === 0 ? 127 : 128);pixels[index]=pixels[index+1]=pixels[index+2]=gray;pixels[index+3]=255; }
  body.pixels.rgba_base64=b64(pixels);
  const result=await machine(`/${claim.job_id}/complete`,body);expect(result.status).toBe(400);
  expect((await result.json() as {error:{code:string}}).error.code).toBe("invalid_image");
  const partial=await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse;expect(partial.status).toBe("generating");expect(partial.completed_chapters).toBe(3);expect(partial.graph).toBeNull();
  const count=await env.DB.prepare("SELECT COUNT(*) n FROM pattern_portrait_assets").first<{n:number}>();expect(count?.n).toBe(6);
  expect((await machine(`/${claim.job_id}/fail`,{lease_token:claim.lease_token,code:"image_invalid"})).status).toBe(200);
  expect((await user("/v1/pattern-portrait-generations",request())).status).toBe(202);
  const retry=await take();expect(retry.job_id).toBe(claim.job_id);expect(retry.chapter_index).toBe(3);await finish(retry);
  expect((await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse).status).toBe("ready");
});

it("retains a ready portrait during temporary account freezing for key rotation",async () => {
  const portrait=await ready();await env.DB.prepare("UPDATE users SET status = 'frozen' WHERE id = ?").bind(USER_A).run();
  await maintainPortraits(enabledEnv());
  expect((await env.DB.prepare("SELECT status FROM pattern_portraits WHERE id = ?").bind(portrait.portrait_id).first<{status:string}>())?.status).toBe("ready");
  expect((await env.ARTIFACTS!.list({prefix:`pattern-portraits/${portrait.portrait_id}/`})).objects).toHaveLength(9);
  await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(USER_A).run();
  expect((await (await user("/v1/pattern-portrait")).json() as PatternPortraitResponse).graph).toEqual(portrait.graph);
});
it("pauses pending portrait claims while frozen and resumes missing chapters afterward",async () => {
  const portrait=await start();await finish(await take());await env.DB.prepare("UPDATE users SET status = 'frozen' WHERE id = ?").bind(USER_A).run();
  expect((await machine("/claim",{})).status).toBe(204);
  expect((await env.DB.prepare("SELECT status FROM pattern_portraits WHERE id = ?").bind(portrait.portrait_id).first<{status:string}>())?.status).toBe("generating");
  await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(USER_A).run();expect((await take()).chapter_index).toBe(1);
});
