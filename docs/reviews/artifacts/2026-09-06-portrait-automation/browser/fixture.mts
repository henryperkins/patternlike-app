import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compilePortraitMesh} from '/home/henry/patternlike-app/.worktrees/portrait-explorer/apps/codex-runner/src/portrait-mesh-compiler.ts';
import {preparePortraitImage} from '/home/henry/patternlike-app/.worktrees/portrait-explorer/apps/codex-runner/src/portrait-invocation.ts';
import {createPortraitGraph} from '/home/henry/patternlike-app/.worktrees/portrait-explorer/packages/shared/src/portrait-graph.ts';
const folder='/tmp/portrait-automation-account';
const paths=['/tmp/portrait-automation-compass-02','/tmp/portrait-automation-bench-02','/tmp/portrait-automation-lantern-01','/tmp/portrait-automation-spyglass-01'];
const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const entries=await Promise.all(paths.map(async(path)=>({path,source:await fs.readFile(path+'/source.txt','utf8'),receipt:JSON.parse(await fs.readFile(path+'/receipt.json','utf8')),program:JSON.parse(await fs.readFile(path+'/program.json','utf8')),image:await fs.readFile(path+'/reference.png')})));
if(entries.some(e=>!e.receipt.result.ok))throw new Error('All model canaries must be accepted before account verification');
const document={schema_version:'0.7.0',pattern_id:'pat_automated_canary',generated_at:'2026-09-06T00:00:00.000Z',locale:'en-US',effective_accuracy:'exact',provenance:{assembly_mode:'constrained_model',provider:'OpenAI',model_family:'gpt',raw_birth_details_sent:false},core_chapters:entries.map(({source})=>{const c=JSON.parse(source);return {title:c.title,summary:c.summary,sections:c.sections.map(text=>({text})),tensions:c.tensions.map(text=>({text})),resources:c.resources.map(text=>({text})),counter_expression:{text:c.counterExpression}}}),additional_signatures:[],uncertainty:{text:'Fictional source for verification; no account birth data was used.'}};
const revision=`${document.schema_version}:${document.pattern_id}:${document.generated_at}`;
const chapters=[],models=[],samples=[],evidence=[];
for(let i=0;i<entries.length;i++){
 const entry=entries[i],chapterId=`chapter-${i+1}`, imageSha=hash(entry.image),sourceSha=hash(entry.source);
 const compiled=compilePortraitMesh(entry.program,{chapterId,documentRevision:revision,sourceImageSha256:imageSha,sourceTextSha256:sourceSha});
 if(compiled.programSha256!==entry.receipt.compiled.program_sha256)throw new Error('Authored program changed');
 await fs.writeFile(`${folder}/model-${i+1}.glb`,compiled.glb);await fs.writeFile(`${folder}/image-${i+1}.png`,entry.image);
 const prepared=await preparePortraitImage(entry.image);samples.push({width:128,height:128,data:new Uint8ClampedArray(Buffer.from(prepared.pixels.rgba_base64,'base64'))});
 chapters.push({chapter_id:chapterId,reference_id:`ppimg_${String(i+1).padStart(32,'0')}`,label:['Adjustable compass','Shared rocking bench','Nautical lantern','Collapsible spyglass'][i],rationale:'Automatically generated from the complete chapter and its saved object image.',reference_sha256:imageSha,source_text:entry.source});
 models.push({chapter_id:chapterId,reference_id:`ppmodel_${String(i+1).padStart(32,'0')}`,sha256:compiled.sha256,source_image_sha256:imageSha,source_text_sha256:sourceSha,source_text:entry.source,program_sha256:compiled.programSha256,compiler_version:compiled.compilerVersion,authoring:'codex-parametric/v1',document_revision:revision});
 evidence.push({chapterId,programUnchanged:true,triangles:compiled.triangles,bytes:compiled.glb.length,programSha256:compiled.programSha256,canary:entry.path,sourceImageSha256:imageSha,sourceTextSha256:sourceSha});
}
const portrait={schema_version:'pattern-portrait/v1',status:'ready',portrait_id:'ppor_automated_canary',chart_id:'cht_automated_canary',pattern_id:document.pattern_id,generated_at:document.generated_at,document_revision:revision,sun_sign:'taurus',completed_chapters:4,retryable:false,chapters,graph:createPortraitGraph(samples,'taurus')};
const explorer={schema_version:'pattern-portrait-explorer/v1',status:'ready',portrait,completed_models:4,retryable:false,models};
const download={schema_version:'pattern-portrait-explorer-download/v1',reading:document,explorer,images:entries.map((e,i)=>({reference_id:chapters[i].reference_id,content_type:'image/png',sha256:hash(e.image),data_base64:e.image.toString('base64')})),models:await Promise.all(entries.map(async(e,i)=>({reference_id:models[i].reference_id,content_type:'model/gltf-binary',sha256:models[i].sha256,data_base64:(await fs.readFile(`${folder}/model-${i+1}.glb`)).toString('base64'),program:e.program,audit:e.receipt.result.audit,provider_request_id:e.receipt.result.provider_request_id,audit_request_id:e.receipt.result.audit_request_id})))};
await fs.writeFile(folder+'/complete-download.json',JSON.stringify(download));
await fs.writeFile(folder+'/fixture.json',JSON.stringify({document,portrait,explorer,evidence}));
console.log(JSON.stringify({chapters:4,triangles:evidence.reduce((n,e)=>n+e.triangles,0),bytes:evidence.reduce((n,e)=>n+e.bytes,0),manualModelEdits:false}));
