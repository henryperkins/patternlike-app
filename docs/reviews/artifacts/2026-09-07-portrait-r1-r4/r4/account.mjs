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
  await page.route('**/PortraitScene.tsx*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('this.props = props;', 'this.props = props; window.__runtime = this;') }); });
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
const stable = async p => { await p.waitForFunction(()=>window.__runtime?.ready&&!window.__runtime.motion); await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); };
const pose = p => p.evaluate(()=>window.__runtime.snapshot());
const same = (a,b)=>Math.max(...a.position.map((n,i)=>Math.abs(n-b.position[i])),...a.target.map((n,i)=>Math.abs(n-b.target[i])))<.00001;
const sceneState = p => p.evaluate(()=>({experience:window.__runtime.props.experience,viewKey:window.__runtime.props.viewKey,selected:window.__runtime.props.selectedIds,unfolded:window.__runtime.props.unfolded,history:history.state,localStorage:JSON.stringify(localStorage),sessionStorage:JSON.stringify(sessionStorage)}));
async function options(p,open) {const e=p.locator('.explorer-secondary-controls');if(await e.evaluate(e=>e.open)!==open)await e.locator(':scope > summary').click();}
try {
for(const [width,height] of [[1440,900],[390,844],[844,390]]) {
 const run=await setup(width),p=run.page;await p.setViewportSize({width,height});
 await p.goto('http://127.0.0.1:5184/#pattern');await p.getByRole('button',{name:'Explore your 3D portrait',exact:true}).click();await stable(p);
 await p.getByRole('navigation',{name:'Pattern chapters'}).getByRole('button').nth(1).click();await p.getByRole('tab',{name:'Resources',exact:true}).click();
 await options(p,true);for(const name of ['Dusk','Show roof','Open reading desk','Turn chapter object','Look closer'])await p.getByRole('button',{name,exact:true}).click();await stable(p);
 await options(p,false);await p.getByRole('button',{name:'Rotate right',exact:true}).click();await p.getByRole('button',{name:'Zoom in',exact:true}).click();await stable(p);
 const before=await pose(p),state=await sceneState(p),count=()=>run.requests.filter(r=>/\/(models|images)\//.test(r.path)).length,requests=count();
 await p.getByRole('navigation',{name:'Portrait navigation'}).getByRole('button',{name:'Back to reading',exact:true}).click();await p.waitForFunction(()=>!history.state?.portrait);
 await p.getByRole('button',{name:'Explore your 3D portrait',exact:true}).click();await stable(p);const reopened=await sceneState(p);
 check(`reopen-scene-${width}`,JSON.stringify(state.experience)===JSON.stringify(reopened.experience)&&state.viewKey===reopened.viewKey,{before:state.experience,after:reopened.experience});
 check(`reopen-camera-${width}`,same(before,await pose(p)),{before,after:await pose(p)});
 check(`reopen-reading-and-assets-${width}`,await p.getByRole('tab',{name:'Resources',exact:true}).getAttribute('aria-selected')==='true'&&count()===requests,{assetRequests:count()});
 check(`private-memory-${width}`,![JSON.stringify(reopened.history),reopened.localStorage,reopened.sessionStorage,p.url()].some(value=>value.includes('chapter-2')||value.includes(doc.core_chapters[1].title)));
 await p.getByRole('button',{name:'Your sky',exact:true}).click();await stable(p);await p.getByRole('button',{name:'Rotate right',exact:true}).click();await stable(p);const sky=await pose(p);
 await p.getByRole('navigation',{name:'Portrait navigation'}).getByRole('button',{name:'Back to reading',exact:true}).click();await p.waitForFunction(()=>!history.state?.portrait);await p.getByRole('button',{name:'Explore your 3D portrait',exact:true}).click();await stable(p);
 check(`sky-reopen-${width}`,await p.getByRole('button',{name:'Your sky',exact:true}).getAttribute('aria-pressed')==='true'&&same(sky,await pose(p)));
 await p.getByRole('button',{name:'Your Pattern',exact:true}).click();await stable(p);check(`R1-sky-origin-${width}`,same(before,await pose(p))&&await p.getByRole('tab',{name:'Resources',exact:true}).getAttribute('aria-selected')==='true');
 await p.getByRole('combobox',{name:'Compare with another chapter'}).selectOption('chapter-4');await stable(p);await p.getByRole('button',{name:'Rotate right',exact:true}).click();await stable(p);const pair=await pose(p);
 await p.getByRole('navigation',{name:'Portrait navigation'}).getByRole('button',{name:'Back to reading',exact:true}).click();await p.waitForFunction(()=>!history.state?.portrait);await p.getByRole('button',{name:'Explore your 3D portrait',exact:true}).click();await stable(p);check(`comparison-reopen-${width}`,await p.getByRole('navigation',{name:'Compared chapters'}).count()===1&&same(pair,await pose(p)));
 await p.getByRole('button',{name:'End comparison',exact:true}).click();await stable(p);check(`R3-comparison-origin-${width}`,same(before,await pose(p))&&JSON.stringify((await sceneState(p)).experience)===JSON.stringify(state.experience));
 await p.locator('.explorer-scene').scrollIntoViewIfNeeded();await p.screenshot({path:`/tmp/portrait-r4/account-${width}.png`});
 await p.getByRole('navigation',{name:'Portrait navigation'}).getByRole('button',{name:'Back to reading',exact:true}).click();await p.waitForFunction(()=>!history.state?.portrait);check(`account-exit-${width}`,await p.evaluate(()=>location.hash==='#pattern'&&!history.state?.portrait));
 report.states.push({width,errors:run.errors});await run.context.close();
}
} catch(error){report.failure=error.stack;console.error(error.stack);process.exitCode=1;}
finally {await fs.writeFile('/tmp/portrait-r4/account-results.json',JSON.stringify(report,null,2));await browser.close();if(report.workflows.some(w=>!w.pass)||report.states.some(s=>s.errors.length))process.exitCode=1;}
