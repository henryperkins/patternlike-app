import { expect, inject, it } from "vitest";
import { env } from "cloudflare:test";
import { contentHash, isPortraitGraph, type CodexPortraitClaim, type CodexPortraitCompletion, type PatternPortraitResponse } from "@patternlike/shared";
import { app } from "../src/index.js";
import { IDENTITY_A, USER_A, confirmPreferences, enablePatternAi, resetDb, seedActiveOntology, seedChart, seedUser } from "./helpers.js";
import { clearPatternReplayObjects, generatePatternReplayTestKeys, installPatternReplayTestKeys } from "./pattern-replay-fixtures.js";
import { createSyntheticPatternPublisher } from "../src/services/pattern-publisher-factory.js";
import { executePatternJob } from "../src/services/pattern-execute.js";
import { decryptPatternDocument, loadAnyPatternDocument } from "../src/services/pattern-state.js";
import { b64, fromB64 } from "../src/crypto.js";
import { encryptUnderContentKey, randomNonce, unwrapContentKey } from "../src/services/pattern-crypto.js";

interface Source { title:string;summary:string;sections:string[];tensions:string[];resources:string[];counterExpression:string }
const canary=inject("portraitCanary" as never) as {chapters:Source[];completions:CodexPortraitCompletion[];graphSha256:string};
const TOKEN="portrait-canary-local-runner-1234567890";
const bindings=Object.defineProperties(Object.create(env),{PATTERN_PORTRAIT_ENABLED:{value:"1"},CODEX_RUNNER_TOKEN:{value:TOKEN}});
async function call(path:string,body?:unknown,machine=false) {
  return app.fetch(new Request(`https://api.test${path}`,{method:body===undefined?"GET":"POST",body:body===undefined?undefined:JSON.stringify(body),headers:{"content-type":"application/json","idempotency-key":"portrait-native-canary-0001",...(machine?{authorization:`Bearer ${TOKEN}`}:{"x-user-id":USER_A})}}),bindings);
}
async function digest(bytes:Uint8Array) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join(""); }

it("persists and reopens four actual native generated images through authenticated D1/R2 routes",async () => {
  await resetDb();await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);installPatternReplayTestKeys(env,await generatePatternReplayTestKeys());enablePatternAi();await seedUser(IDENTITY_A);await confirmPreferences(USER_A);
  const {chartId}=await seedChart(IDENTITY_A,{positions:["sun","moon","mercury","venus","mars","jupiter","saturn","uranus","neptune","pluto"].map((body,index)=>({body:body as "sun",longitude_deg:12+index*31,speed_longitude_deg_per_day:1,retrograde:false}))});await seedActiveOntology();
  const start=await call("/v1/pattern-generations",{schema_version:"0.7.0",consent_policy_version:"1.1.0",confirm:"GENERATE MY PATTERN",reason:"first_open"});expect(start.status).toBe(202);const accepted=await start.json() as {generation:{generation_id:string}};
  for(let step=0;step<8;step++) {
    const row=await env.DB.prepare("SELECT job_id,stage,stage_generation FROM pattern_generation_jobs WHERE generation_id = ?").bind(accepted.generation.generation_id).first<{job_id:string;stage:string;stage_generation:number}>();if(row?.stage==="succeeded") break;expect(row?.stage).not.toBe("failed");
    await executePatternJob(env,{kind:"pattern_generation",job_id:row!.job_id,generation_id:accepted.generation.generation_id,stage_generation:row!.stage_generation},new Date(),{publisher:({pin,packet,ontology})=>{const four=structuredClone(packet) as {selection_constraints:{core_chapters_min:number;core_chapters_max:number}};four.selection_constraints.core_chapters_min=4;four.selection_constraints.core_chapters_max=4;return createSyntheticPatternPublisher({forceReject:false,packet:four,ontology,publisher:pin.publisher,measured:true});}});
  }
  // Local fictional accepted-document fixture. Preserve envelope/claim provenance;
  // replace only its prose with the exact source JSON used by the native probe.
  const document=(await loadAnyPatternDocument(env,USER_A))!;const internal=await decryptPatternDocument(env,IDENTITY_A,document);const template=internal.artifact.chapters[0]!;
  internal.artifact.chapters=canary.chapters.map((source,index)=>({...template,chapter_key:`chapter_0${index+1}`,title:source.title,summary:source.summary,sections:source.sections.map((text,i)=>({...template.sections[i%template.sections.length]!,text})),tensions:source.tensions.map(text=>({...template.tensions[0]!,text})),resources:source.resources.map(text=>({...template.resources[0]!,text})),counter_expression:{...template.counter_expression,text:source.counterExpression}}));
  const key=await unwrapContentKey(env,IDENTITY_A,document.id,"pattern_documents.wrapped_document_key_enc",{key_version:document.wrapped_document_key_version,nonce:document.wrapped_document_key_nonce,ciphertext:b64(document.wrapped_document_key_enc)});const nonce=randomNonce();
  const ciphertext=await encryptUnderContentKey(internal,key,nonce,new TextEncoder().encode(JSON.stringify(["patternlike.pattern-document",1,document.id,document.generation_id])));
  await env.DB.prepare("UPDATE pattern_documents SET document_enc = ?,document_nonce = ?,content_hash = ? WHERE id = ?").bind(ciphertext,b64(nonce),await contentHash(JSON.stringify(internal)),document.id).run();
  const creation=await call("/v1/pattern-portrait-generations",{pattern_id:document.id,chart_id:chartId,generated_at:document.generated_at,confirm:"CREATE MY PORTRAIT",consent_policy_version:"1.0.0"});expect(creation.status).toBe(202);
  const hashes=[];
  for(let index=0;index<4;index++) {
    const claimed=await call("/codex-provider/v1/portraits/claim",{},true);expect(claimed.status).toBe(200);const claim=await claimed.json() as CodexPortraitClaim;expect(claim.chapter_index).toBe(index);
    const native=canary.completions[index]!;expect(claim.source_sha256).toBe(native.source_sha256);
    const complete=await call(`/codex-provider/v1/portraits/${claim.job_id}/complete`,{...native,lease_token:claim.lease_token},true);expect(complete.status,await complete.clone().text()).toBe(200);
    hashes.push({chapter:index+1,source_sha256:claim.source_sha256,original_sha256:native.original_sha256,image_sha256:await digest(fromB64(native.image_base64))});
  }
  const portrait=await (await call("/v1/pattern-portrait")).json() as PatternPortraitResponse;expect(portrait.status).toBe("ready");expect(isPortraitGraph(portrait.graph)).toBe(true);expect(portrait.chapters).toHaveLength(4);
  expect(await (await call("/v1/pattern-portrait")).json()).toEqual(portrait);
  for(let index=0;index<4;index++) {const image=await call(`/v1/pattern-portrait/images/${portrait.chapters[index]!.reference_id}`);expect(image.status).toBe(200);expect(await digest(new Uint8Array(await image.arrayBuffer()))).toBe(hashes[index]!.image_sha256);expect(portrait.chapters[index]!.reference_sha256).toBe(hashes[index]!.image_sha256);}
  const download=await call(`/v1/pattern-portrait/download?pattern_id=${document.id}&chart_id=${chartId}&generated_at=${encodeURIComponent(document.generated_at)}`);expect(download.status).toBe(200);const bundle=await download.json() as {portrait:PatternPortraitResponse;images:Array<{sha256:string;data_base64:string}>};expect(bundle.portrait).toEqual(portrait);expect(bundle.images.map(image=>image.sha256)).toEqual(hashes.map(image=>image.image_sha256));
  expect(await Promise.all(bundle.images.map(image=>digest(fromB64(image.data_base64))))).toEqual(hashes.map(image=>image.image_sha256));
  const inventory=await env.DB.prepare("SELECT COUNT(*) n FROM pattern_portrait_assets WHERE portrait_id = ?").bind(portrait.portrait_id).first<{n:number}>();expect(inventory?.n).toBe(9);expect((await call("/codex-provider/v1/portraits/claim",{},true)).status).toBe(204);
  expect(await digest(new TextEncoder().encode(JSON.stringify(portrait.graph)))).toBe(canary.graphSha256);
  console.log("PORTRAIT_NATIVE_CANARY",JSON.stringify({hashes,graph_sha256:await digest(new TextEncoder().encode(JSON.stringify(portrait.graph))),stars:portrait.graph!.source_indices.length,connections:portrait.graph!.connections.length,encrypted_objects:inventory!.n,ready_reopen_equal:true,download_bytes_match:true}));
},120000);
