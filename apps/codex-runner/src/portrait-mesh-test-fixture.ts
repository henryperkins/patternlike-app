import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function jsonFixture(mode = "success", outputs: unknown[] = [{ answer: "complete" }]) {
  const root = await mkdtemp(join(tmpdir(), "portrait-json-test-"));
  const home = join(root, "codex-home"); await mkdir(home);
  const executable = join(root, "fake-codex.mjs");
  await writeFile(executable, `#!/usr/bin/env node
import fs from 'node:fs/promises'; import path from 'node:path'; import readline from 'node:readline';
const mode=${JSON.stringify(mode)}, root=${JSON.stringify(root)}, outputs=${JSON.stringify(outputs)};
const args=process.argv.slice(2); await fs.writeFile(path.join(root,'launched'), 'yes');
if(args[0]==='--version'){console.log(mode==='version'?'codex-cli 0.153.4':'codex-cli 0.153.3');process.exit(0);}
if(args[0]==='login'){console.log(mode==='auth'?'Logged in using an API key':'Logged in using ChatGPT');process.exit(0);}
let count=0;try{count=Number(await fs.readFile(path.join(root,'count'),'utf8'));}catch{} await fs.writeFile(path.join(root,'count'),String(count+1));
await fs.writeFile(path.join(root,'record-'+count+'.json'),JSON.stringify({args,env:process.env}));
const thread=count===0?'11111111-2222-4333-8444-555555555555':'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',turn='turn-1';
const emit=(x)=>process.stdout.write(JSON.stringify(x)+'\\n');
for await(const line of readline.createInterface({input:process.stdin})){
 const r=JSON.parse(line);if(r.method==='initialized')continue;
 if(r.method==='initialize')emit({id:r.id,result:{codexHome:mode==='wronghome'?'/wrong':process.env.CODEX_HOME}});
 if(r.method==='config/read'){
  const overrides=Object.fromEntries(args.flatMap((v,i)=>v==='-c'?[args[i+1].split(/=(.*)/s).slice(0,2)]:[]));
  emit({id:r.id,result:{config:{model_provider:'openai',forced_login_method:'chatgpt',web_search:'disabled',notify:mode==='notify'?['unsafe']:[],developer_instructions:'',instructions:'',project_doc_max_bytes:0,skills:{include_instructions:false},tools:{web_search:null},features:{skip_host_skill_discovery:true,...Object.fromEntries(args.flatMap((v,i)=>v==='--disable'?[[args[i+1],false]]:[])),...(mode==='imageenabled'?{image_generation:true}:{})},model_instructions_file:JSON.parse(overrides.model_instructions_file),experimental_compact_prompt_file:JSON.parse(overrides.experimental_compact_prompt_file),chatgpt_base_url:'https://chatgpt.com/backend-api/',mcp_servers:{inherited:{command:'must-never-run'}}},layers:mode==='missinglayers'?null:[{name:{type:'sessionFlags'},version:'flags-v1',disabledReason:null,config:{tools:{update_plan:{enabled:mode==='tooloverride'?true:JSON.parse(overrides['tools.update_plan.enabled']??'true')},experimental_request_user_input:{enabled:JSON.parse(overrides['tools.experimental_request_user_input.enabled']??'true')}}}}],origins:{'tools.update_plan.enabled':{name:{type:mode==='toolorigin'?'system':'sessionFlags'},version:'flags-v1'},'tools.experimental_request_user_input.enabled':{name:{type:'sessionFlags'},version:'flags-v1'}}}});
 }
 if(r.method==='configRequirements/read')emit({id:r.id,result:{requirements:mode==='managedinstructions'?{additionalDeveloperInstructions:'private host instructions'}:null}});
 if(r.method==='thread/start'){await fs.writeFile(path.join(root,'thread-'+count+'.json'),JSON.stringify(r.params));emit({id:r.id,result:{thread:{id:thread},model:r.params.model,modelProvider:'openai',serviceTier:mode==='tier'?'default':r.params.serviceTier,reasoningEffort:mode==='effort'?'low':r.params.config.model_reasoning_effort,sandbox:{type:mode==='sandbox'?'dangerFullAccess':'readOnly'},approvalPolicy:mode==='approvalpolicy'?'onRequest':'never'}});}
 if(r.method==='mcpServerStatus/list')emit({id:r.id,result:{data:[{name:'inherited',runtimeStatus:mode==='mcpavailable'?'ready':'disabled',tools:mode==='mcpavailable'?{privateTool:{}}:{}}],nextCursor:null}});
 if(r.method==='turn/start'){
  await fs.writeFile(path.join(root,'turn-'+count+'.json'),JSON.stringify(r.params));emit({id:r.id,result:{turn:{id:turn,status:'inProgress'}}});
  if(mode==='timeout')continue;
  if(mode==='rerouted')emit({method:'model/rerouted',params:{threadId:thread,turnId:turn,fromModel:r.params.model,toModel:'another-model'}});
  if(mode!=='missing-usage')emit({method:'thread/tokenUsage/updated',params:{threadId:thread,turnId:mode==='usage-turn'?'another-turn':turn,tokenUsage:{total:{inputTokens:mode==='usage-invalid'?-1:17,outputTokens:9},last:{inputTokens:17,outputTokens:9}}}});
  if(mode==='approval')emit({id:42,method:'item/commandExecution/requestApproval',params:{}});
  if(mode==='tool'||mode==='imagegen')emit({method:'item/started',params:{threadId:thread,turnId:turn,item:{type:mode==='tool'?'commandExecution':'imageGeneration',id:'bad'}}});
  const item={type:'agentMessage',id:'message-1',phase:'final_answer',text:mode==='malformed'?'private invalid json':mode==='oversized'?'x'.repeat(70000):JSON.stringify(outputs[count]??outputs[0])};
  if(mode!=='missing')emit({method:'item/completed',params:{threadId:thread,turnId:mode==='wrongturn'?'other':turn,item}});
  if(mode==='duplicate')emit({method:'item/completed',params:{threadId:thread,turnId:turn,item}});
  emit({method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:mode==='failed'?'failed':'completed',error:null}}});
 }
}
`, { mode: 0o700 });
  const options = { codexBin: executable, tempRoot: join(root, "attempts"), env: { HOME: root, CODEX_HOME: home, PATH: process.env.PATH, OPENAI_API_KEY: "secret", CODEX_API_KEY: "secret", CODEX_RUNNER_TOKEN: "secret", OPENAI_BASE_URL: "https://invalid.example" }, model: "gpt-5.6-sol", effort: "xhigh" as const, timeoutMs: 5_000, instructions: "Return only the requested JSON. No tools.", input: [{ type: "text" as const, text: "Complete private source\nfinal paragraph.", text_elements: [] }, { type: "image" as const, url: "data:image/png;base64,aGVsbG8=" }], outputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false }, maxOutputBytes: 65536 };
  return { root, home, executable, options };
}
