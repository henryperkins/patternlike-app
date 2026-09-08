import fs from "node:fs/promises";
import { chromium } from "/home/henry/core-ai-wcus/node_modules/playwright/index.mjs";
const root = new URL("../portrait-review-resume/", import.meta.url);
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

try {
 const run=await setup(390),p=run.page;
 await p.setViewportSize({width:390,height:844});
 await p.goto('http://127.0.0.1:5184/#pattern');
 const entry=p.getByRole('button',{name:'Explore your 3D portrait',exact:true});
 await entry.click();await sceneReady(p);
 const count=()=>run.requests.filter(r=>/\/(models|images)\//.test(r.path)).length;
 await p.getByRole('navigation',{name:'Pattern chapters'}).getByRole('button').first().click();
 await p.getByRole('tab',{name:'Resources',exact:true}).click();
 await p.getByRole('button',{name:'Look closer',exact:true}).click();
 await p.getByRole('button',{name:'Open reading desk',exact:true}).click();
 await p.getByRole('button',{name:'Dusk',exact:true}).click();
 const pose=()=>p.evaluate(()=>({inspect:[...document.querySelectorAll('button')].some(b=>b.textContent==='Step back'),desk:[...document.querySelectorAll('button')].some(b=>b.textContent==='Close reading desk'),dusk:[...document.querySelectorAll('button')].find(b=>b.textContent==='Dusk')?.getAttribute('aria-pressed'),sky:document.querySelector('.observatory-views button:nth-child(2)')?.getAttribute('aria-pressed')}));
 const before={reader:await measure(p),pose:await pose(),assetRequests:count()};
 await p.getByRole('button',{name:'Your sky',exact:true}).click();
 const skyBeforeClose=await pose();
 await p.getByRole('navigation',{name:'Portrait navigation'}).getByRole('button',{name:'Back to reading',exact:true}).click();
 await entry.waitFor();await entry.click();await sceneReady(p);
 const after={reader:await measure(p),pose:await pose(),assetRequests:count()};
 await p.getByRole('button',{name:'Read chapter',exact:true}).click();
 await p.evaluate(()=>scrollBy(0,250));
 const returnButton=await p.getByRole('button',{name:'Return to portrait',exact:true}).boundingBox();
 report.workflows.push({before,skyBeforeClose,after,returnButton,errors:run.errors});
 console.log(JSON.stringify(report.workflows,null,2));
 await p.screenshot({path:new URL('account-reading-return.png',import.meta.url).pathname});
 await run.context.close();
} catch(error) {report.failure=error.stack;console.error(error.stack);process.exitCode=1;}
finally {await fs.writeFile(new URL('account-results.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();}
