import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { runPortraitInvocation, preparePortraitImage } from "./portrait-invocation.js";
import { parsePortraitClaim } from "./portrait-client.js";
import type { CodexPortraitClaim } from "@patternlike/shared";

export const CLAIM: CodexPortraitClaim = {
  schema_version: "codex-portrait-claim/v1", job_id: `ppjob_${"a".repeat(32)}`,
  portrait_id: `ppor_${"b".repeat(32)}`, chapter_index: 0,
  lease_token: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", model: "gpt-5.6-sol", reasoning_effort: "xhigh",
  image_model: "gpt-image-2", prompt_version: "portrait-object-v1", timeout_ms: 5_000,
  prompt: "Private chapter text: make one blue cube.", source_sha256: "c".repeat(64),
};

async function fixture(mode = "success") {
  const root = await mkdtemp(join(tmpdir(), "portrait-runner-test-"));
  const home = join(root, "codex-home"); await mkdir(home);
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#3266aa" } }).png().toBuffer();
  const executable = join(root, "fake-codex.mjs");
  await writeFile(executable, `#!/usr/bin/env node
import fs from 'node:fs/promises'; import path from 'node:path'; import readline from 'node:readline';
const mode=${JSON.stringify(mode)}, root=${JSON.stringify(root)}, image=${JSON.stringify(png.toString("base64"))};
const args=process.argv.slice(2);
await fs.writeFile(path.join(root,'launched'), 'yes');
if(args[0]==='--version'){console.log(mode==='version'?'codex-cli 0.153.4':'codex-cli 0.153.3');process.exit(0);}
if(args[0]==='login'){console.log(mode==='auth'?'Logged in using an API key':'Logged in using ChatGPT');process.exit(0);}
await fs.writeFile(path.join(root,'record.json'),JSON.stringify({args,env:process.env}));
const thread='11111111-2222-4333-8444-555555555555', turn='turn-1', id='image-call-1';
const emit=(x)=>process.stdout.write(JSON.stringify(x)+'\\n');
for await(const line of readline.createInterface({input:process.stdin})){
 const r=JSON.parse(line); if(r.method==='initialized')continue;
 if(r.method==='initialize')emit({id:r.id,result:{codexHome:process.env.CODEX_HOME}});
 if(r.method==='config/read'){
  const overrides=Object.fromEntries(args.flatMap((v,i)=>v==='-c'?[args[i+1].split(/=(.*)/s).slice(0,2)]:[]));
  emit({id:r.id,result:{config:{model_provider:'openai',forced_login_method:'chatgpt',web_search:'disabled',notify:mode==='notify'?['unsafe-hook']:[],developer_instructions:'',instructions:'',project_doc_max_bytes:0,skills:{include_instructions:false},features:{image_generation:true,skip_host_skill_discovery:true,...Object.fromEntries(args.flatMap((v,i)=>v==='--disable'?[[args[i+1],false]]:[]))},model_instructions_file:JSON.parse(overrides.model_instructions_file),experimental_compact_prompt_file:JSON.parse(overrides.experimental_compact_prompt_file),chatgpt_base_url:'https://chatgpt.com/backend-api/',mcp_servers:{inherited:{command:'must-never-run'}}}}});
 }
 if(r.method==='configRequirements/read')emit({id:r.id,result:{requirements:mode==='managedinstructions'?{additionalDeveloperInstructions:'Host-specific instructions'}:null}});
 if(r.method==='mcpServerStatus/list')emit({id:r.id,result:{data:[{name:'inherited',runtimeStatus:mode==='mcpavailable'?'ready':'disabled',tools:mode==='mcpavailable'?{privateTool:{}}:{}}],nextCursor:null}});
 if(r.method==='thread/start'){await fs.writeFile(path.join(root,'thread.json'),JSON.stringify(r.params));emit({id:r.id,result:{thread:{id:thread},model:r.params.model,modelProvider:'openai',sandbox:{type:'readOnly'},approvalPolicy:'never'}});}
 if(r.method==='turn/start'){
  await fs.writeFile(path.join(root,'turn.json'),JSON.stringify(r.params));emit({id:r.id,result:{turn:{id:turn,status:'inProgress'}}});
  if(mode==='timeout')continue;
  const folder=path.join(process.env.CODEX_HOME,'generated_images',thread);await fs.mkdir(folder,{recursive:true});
  const saved=path.join(folder,id+'.png');await fs.writeFile(saved,Buffer.from(image,'base64'));
  const item={type:'imageGeneration',id,status:mode==='failed'?'failed':'completed',result:mode==='bytes'?Buffer.from('not png').toString('base64'):image,savedPath:mode==='escape'?path.join(root,'untouched.png'):saved};
  if(mode==='unexpectedtool')emit({method:'item/started',params:{threadId:thread,turnId:turn,item:{type:'webSearch',id:'search-1'}}});
  if(mode!=='missing')emit({method:'item/completed',params:{threadId:thread,turnId:turn,item}});
  if(mode==='multiple')emit({method:'item/completed',params:{threadId:thread,turnId:turn,item:{...item,id:'image-call-2'}}});
  if(mode==='wrongturn')emit({method:'item/completed',params:{threadId:thread,turnId:'other',item}});
  emit({method:'item/completed',params:{threadId:thread,turnId:turn,item:{type:'agentMessage',id:'message-1',phase:'final_answer',text:JSON.stringify({label:'Blue cube',rationale:'A measured, simple object.'})}}});
  emit({method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:mode==='turnfailed'?'failed':'completed',error:mode==='turnfailed'?{message:'private detail'}:null}}});
 }
}
`, { mode: 0o700 });
  await writeFile(join(root, "untouched.png"), png);
  return { root, home, executable, png, options: { claim: CLAIM, codexBin: executable, tempRoot: join(root, "attempts"), env: { HOME: root, CODEX_HOME: home, PATH: process.env.PATH, OPENAI_API_KEY: "secret", CODEX_API_KEY: "secret", CODEX_RUNNER_TOKEN: "secret", OPENAI_BASE_URL: "https://invalid.example" } } };
}

test("requires one completed native image and successful turn, preserves image provenance and cleans only its files", async () => {
  const f = await fixture();
  try {
    let original: Buffer | null = null;
    const out = await runPortraitInvocation({ ...f.options, onVerifiedImage: async (bytes: Buffer) => { original = Buffer.from(bytes); } });
    assert.deepEqual(original, f.png);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.completion.original_sha256, createHash("sha256").update(f.png).digest("hex"));
    assert.equal(out.completion.provider_request_id, "11111111-2222-4333-8444-555555555555:turn-1");
    assert.equal(out.completion.image_request_id, "image-call-1");
    assert.equal(out.completion.source_sha256, CLAIM.source_sha256);
    assert.equal(out.completion.pixels.width, 128);
    assert.equal(Buffer.from(out.completion.pixels.rgba_base64, "base64").length, 128 * 128 * 4);
    const derivative = Buffer.from(out.completion.image_base64, "base64");
    const metadata = await sharp(derivative).metadata();
    assert.equal(metadata.width, 512); assert.equal(metadata.height, 384);
    assert.equal(metadata.exif, undefined);
    const record = JSON.parse(await readFile(join(f.root, "record.json"), "utf8"));
    for (const name of ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL", "CODEX_RUNNER_TOKEN"]) assert.equal(record.env[name], undefined);
    assert(record.args.includes('forced_login_method="chatgpt"'));
    assert(record.args.includes('model_provider="openai"'));
    const thread = JSON.parse(await readFile(join(f.root, "thread.json"), "utf8"));
    assert.equal(thread.ephemeral, true); assert.equal(thread.sandbox, "read-only");
    assert.deepEqual(thread.config.mcp_servers, { inherited: { enabled: false, required: false } });
    assert.equal(thread.developerInstructions, "");
    assert.equal(thread.model, CLAIM.model);
    const turn = JSON.parse(await readFile(join(f.root, "turn.json"), "utf8"));
    assert.equal(turn.effort, "xhigh");
    assert.equal(turn.input[0].text, CLAIM.prompt);
    assert.deepEqual(await readdir(join(f.root, "attempts")), []);
    assert.deepEqual(await readdir(join(f.home, "generated_images")), []);
    assert.deepEqual(await readFile(join(f.root, "untouched.png")), f.png);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const mode of ["failed", "missing", "multiple", "bytes", "escape", "wrongturn", "turnfailed", "auth", "version", "timeout", "notify", "managedinstructions", "mcpavailable", "unexpectedtool"]) {
  test(`rejects ${mode} native generation without exposing provider content`, async () => {
    const f = await fixture(mode);
    try {
      const out = await runPortraitInvocation({ ...f.options, claim: { ...CLAIM, timeout_ms: mode === "timeout" ? 300 : 5_000 } });
      assert.equal(out.ok, false);
      if (!out.ok) assert(["generation_failed", "generation_refused", "image_invalid", "authentication_failed"].includes(out.code));
      if (!out.ok && ["auth", "version"].includes(mode)) assert.equal(out.fatal, true);
      if (["notify", "managedinstructions", "mcpavailable"].includes(mode)) await assert.rejects(readFile(join(f.root, "turn.json")), { code: "ENOENT" });
      assert(!JSON.stringify(out).includes("private"));
      assert.deepEqual(await readFile(join(f.root, "untouched.png")), f.png);
      assert.deepEqual(await readdir(join(f.root, "attempts")), []);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
}

test("nonempty global instructions fail before launching Codex without reading or modifying them", async () => {
  const f = await fixture();
  try {
    const path = join(f.home, "AGENTS.md");
    await writeFile(path, "Unrelated host instructions.");
    const out = await runPortraitInvocation(f.options);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.fatal, true);
    await assert.rejects(readFile(join(f.root, "launched")), { code: "ENOENT" });
    assert.equal(await readFile(path, "utf8"), "Unrelated host instructions.");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("an already aborted invocation never starts Codex", async () => {
  const f = await fixture();
  try {
    const out = await runPortraitInvocation({ ...f.options, signal: AbortSignal.abort() });
    assert.deepEqual(out, { ok: false, code: "generation_failed", fatal: false });
    await assert.rejects(readFile(join(f.root, "launched")), { code: "ENOENT" });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("an unsafe cleanup destination stops the runner and preserves unrelated files", async () => {
  const f = await fixture();
  try {
    const out = await runPortraitInvocation({ ...f.options, onVerifiedImage: async () => {
      const folder = join(f.home, "generated_images", "11111111-2222-4333-8444-555555555555");
      await rm(folder, { recursive: true });
      await symlink(f.root, folder, "dir");
    } });
    assert.deepEqual(out, { ok: false, code: "generation_failed", fatal: true });
    assert.deepEqual(await readFile(join(f.root, "untouched.png")), f.png);
    assert.deepEqual(await readdir(join(f.root, "attempts")), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("PNG samples derive exactly from the sanitized image and malformed input is rejected", async () => {
  const png = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 31, g: 77, b: 155, alpha: 0.6 } } }).png().toBuffer();
  const result = await preparePortraitImage(png);
  const expected = await sharp(Buffer.from(result.image_base64, "base64")).resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer();
  assert.deepEqual(Buffer.from(result.pixels.rgba_base64, "base64"), expected);
  await assert.rejects(preparePortraitImage(Buffer.from("fake png")));
});

test("claim parser rejects unexpected fields, wrong pins, identifiers, and bounds", () => {
  assert.deepEqual(parsePortraitClaim(CLAIM), CLAIM);
  for (const bad of [{ extra: true }, { job_id: "../bad" }, { lease_token: "short" }, { source_sha256: `sha256:${"c".repeat(64)}` }, { timeout_ms: 900001 }, { chapter_index: 4 }, { image_model: "other" }, { reasoning_effort: "high" }, { prompt: "" }]) {
    assert.equal(parsePortraitClaim({ ...CLAIM, ...bad }), null);
  }
});
