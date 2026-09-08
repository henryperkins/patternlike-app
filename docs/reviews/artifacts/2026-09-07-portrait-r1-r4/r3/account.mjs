import fs from "node:fs/promises";
import { chromium } from "/home/henry/core-ai-wcus/node_modules/playwright/index.mjs";
const root = new URL("file:///home/henry/patternlike-app/output/playwright/portrait-review-resume/");
const fixture = JSON.parse(await fs.readFile(new URL("fixture.json", root), "utf8"));
const {document: doc, chart, explorer} = fixture;
const images = await Promise.all([1,2,3,4].map(i=>fs.readFile(`apps/web/src/preview/references/native-0${i}.png`)));
const models = await Promise.all([1,2,3,4].map(i=>fs.readFile(new URL(`model-${i}.glb`, root))));
const browser = await chromium.launch({executablePath: "/home/henry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]});
const report = {fixture: "Fictional chapter/image fixtures and deterministic compiled test shapes, all API calls intercepted. Real validators and renderer unchanged.", states: [], workflows: []};
const json = (route, body, status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
const consent = {schema_version:"0.7.0",kind:"pattern_generation",status:"granted",provider:"OpenAI",purpose:"one_pattern_per_chart",policy_version:"1.0.0",enabled_categories:[],granted_at:"2026-09-06T00:00:00Z"};
const state = {schema_version:"0.9.0",state:"ready",chart:{chart_id:chart.id,effective_accuracy:"exact",feature_policy_version:"1.0.0"},consent,generation:null,regeneration:null,pattern:{pattern_id:doc.pattern_id,generated_at:doc.generated_at,locale:doc.locale,effective_accuracy:doc.effective_accuracy}};
async function setup(width) {
  const context = await browser.newContext({viewport:{width,height:900},reducedMotion:"reduce"});
  const page = await context.newPage();
  page.setDefaultTimeout(18000);
  let mode="ready", enabled=true;
  const requests=[],errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/v1/**",async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    requests.push({path,method:req.method()});
    if(path==="/v1/chart")return json(route,chart);
    if(path==="/v1/pattern")return json(route,doc);
    if(path==="/v1/pattern-state")return json(route,state);
    if(path==="/v1/consents/pattern-generation")return json(route,consent);
    if(path==="/v1/preferences/topic-exclusions")return json(route,{schema_version:"0.2.0",excluded_topics:[],updated_at:null});
    if(path==="/v1/pattern-portrait/automation"){
      if(req.method()==="PUT")enabled=req.postDataJSON().enabled;
      return json(route,{schema_version:"portrait-automation/v1",available:true,chart_id:chart.id,enabled,consent_policy_version:"1.1.0"});
    }
    if(path==="/v1/pattern-portrait/explorer"){
      if(mode==="ready")return json(route,explorer);
      if(mode==="stale")return json(route,{...explorer,portrait:{...explorer.portrait,document_revision:"stale-review-revision"}});
      return json(route,{...explorer,status:mode,completed_models:mode==="not_started"?0:1,models:[],retryable:mode==="generating",portrait:{...explorer.portrait,status:mode,completed_chapters:mode==="not_started"?0:2,chapters:[],graph:null}});
    }
    if(path.startsWith("/v1/pattern-portrait/images/"))return route.fulfill({status:200,contentType:"image/png",body:images[Number(path.split("-").at(-1))-1]});
    if(path.startsWith("/v1/pattern-portrait/models/"))return route.fulfill({status:200,contentType:"model/gltf-binary",body:models[Number(path.split("-").at(-1))-1]});
    return json(route,{error:{code:"not_found",message:"Local review mock: endpoint not needed",request_id:"review"}},404);
  });
  return {context,page,requests,errors,setMode:value=>mode=value};
}
const sceneReady = page=>page.waitForFunction(()=>document.querySelector('button[aria-label="Rotate left"]')?.disabled===false,{},{timeout:30000});
async function snap(page,name,selector=".portrait-explorer") {
  const target=page.locator(selector);
  await target.screenshot({path:new URL(`${name}.png`,root).pathname,timeout:30000});
}
const measure = page=>page.evaluate(()=>{
  const reader=document.querySelector(".explorer-reader"), h=reader?.querySelector("[data-reader-heading]");
  return {heading:h?.textContent,headingTop:h?.getBoundingClientRect().top,scrollY,readerTop:reader?.scrollTop,readerHeight:reader?.clientHeight,readerScrollHeight:reader?.scrollHeight,facet:document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,focus:document.activeElement?.textContent?.slice(0,100),presentation:document.querySelector(".portrait-explorer")?.className,overflow:document.documentElement.scrollWidth-innerWidth};
});


const check=(name,pass,data)=>{report.workflows.push({name,pass,data});console.log(pass?'PASS':'FAIL',name,JSON.stringify(data??''));};
try {
for(const [width,height] of [[1440,900],[390,844],[320,844],[844,390]]) {
 const run=await setup(width),p=run.page;await p.setViewportSize({width,height});
 await p.goto('http://127.0.0.1:5184/#pattern');await p.getByRole('button',{name:'Explore your 3D portrait',exact:true}).click();await sceneReady(p);
 await p.getByRole('navigation',{name:'Pattern chapters'}).getByRole('button').first().click();await p.getByRole('tab',{name:'Tensions',exact:true}).click();
 if(width<768)await p.getByRole('button',{name:'Read chapter',exact:true}).click();
 await p.getByRole('combobox',{name:'Compare with another chapter'}).selectOption('chapter-2');await p.waitForTimeout(1800);
 const pair=await p.evaluate(()=>({canvas:document.querySelector('canvas')?.getAttribute('aria-label'),labels:[...document.querySelectorAll('[data-form-index]')].map(e=>e.dataset.chapterId),overflow:document.documentElement.scrollWidth-innerWidth}));
 check(`account-pair-${width}`,pair.labels.length===2&&pair.overflow===0&&pair.canvas?.startsWith('Two saved chapter objects:'),pair);
 await p.getByRole('button',{name:'View objects',exact:true}).click();await p.screenshot({path:`/tmp/portrait-r3/account-${width}.png`});
 await p.getByRole('button',{name:'Expand scene',exact:true}).click();await p.getByRole('dialog').waitFor();
 const secondName=doc.core_chapters[1].title;await p.getByRole('dialog').getByRole('navigation',{name:'Compared chapters'}).getByRole('button',{name:new RegExp(secondName)}).click();
 await p.waitForFunction(()=>!document.querySelector('dialog'));
 const focus=await p.evaluate(()=>({text:document.activeElement.textContent,rect:document.activeElement.getBoundingClientRect().toJSON(),inset:document.querySelector('.explorer-mobile-modes').getBoundingClientRect().bottom}));
 check(`account-expanded-source-${width}`,focus.text===doc.core_chapters[1].tensions[0].text&&focus.rect.bottom>focus.inset&&focus.rect.top<height,focus);
 await p.getByRole('button',{name:'Your sky',exact:true}).click();await p.goBack();await p.getByRole('button',{name:'End comparison',exact:true}).waitFor();check(`account-sky-origin-${width}`,await p.getByRole('tab',{name:'Tensions',exact:true}).getAttribute('aria-selected')==='true');
 const count=()=>run.requests.filter(r=>/\/(models|images)\//.test(r.path)).length;
 const beforeCount=count();await p.getByRole('navigation',{name:'Portrait navigation'}).getByRole('button',{name:'Back to reading',exact:true}).click();
 await p.getByRole('button',{name:'Explore your 3D portrait',exact:true}).click();await sceneReady(p);
 check(`account-reopen-pair-${width}`,await p.getByRole('navigation',{name:'Compared chapters'}).count()===1&&count()===beforeCount,{assetRequests:count()});
 await p.getByRole('button',{name:'End comparison',exact:true}).click();await p.getByRole('combobox',{name:'Compare with another chapter'}).waitFor();check(`account-original-facet-${width}`,await p.getByRole('tab',{name:'Tensions',exact:true}).getAttribute('aria-selected')==='true');
 await p.getByRole('navigation',{name:'Portrait navigation'}).getByRole('button',{name:'Back to reading',exact:true}).click();await p.waitForFunction(()=>!history.state?.portrait);check(`account-exit-${width}`,await p.evaluate(()=>location.hash==='#pattern'&&!history.state?.portrait));
 report.states.push({width,errors:run.errors});await run.context.close();
}
} catch(error){report.failure=error.stack;console.error(error.stack);process.exitCode=1;}
finally {await fs.writeFile('/tmp/portrait-r3/account-results.json',JSON.stringify(report,null,2));await browser.close();if(report.workflows.some(w=>!w.pass)||report.states.some(s=>s.errors.length))process.exitCode=1;}
