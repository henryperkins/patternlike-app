import fs from "node:fs/promises";
import { chromium } from "/home/henry/core-ai-wcus/node_modules/playwright/index.mjs";
const root = new URL("./", import.meta.url);
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
  const desktop=await setup(1440),p=desktop.page;
  for(const mode of process.env.REVIEW_CONFIRM ? ["ready"] : ["not_started","generating","failed","stale","ready"]){
    desktop.setMode(mode);
    await p.goto(`http://127.0.0.1:5183/?review=${mode}#pattern`);
    await p.locator(".account-portrait").waitFor();
    await p.waitForFunction(()=>!document.querySelector(".account-portrait")?.textContent.includes("Checking your saved portrait."));
    const text=await p.locator(".account-portrait").innerText();
    report.states.push({mode,text,prosePresent:(await p.locator("body").innerText()).includes(doc.core_chapters[0].sections[0].text)});
    await snap(p,`account-${mode}`,".account-portrait");
    console.log("state",mode, text.replace(/\s+/g," ").slice(-260));
  }
  await p.getByRole("button",{name:"Explore your 3D portrait",exact:true}).click();
  await sceneReady(p);
  const flow={width:1440,entry:await measure(p)};
  await snap(p,"account-desktop-entry");
  await p.getByRole("navigation",{name:"Pattern chapters"}).getByRole("button").nth(1).click();
  flow.selected=await measure(p);
  await p.getByRole("tab",{name:"Resources",exact:true}).click();
  await p.locator(".explorer-reader").evaluate(el=>{el.scrollTop=60;el.dispatchEvent(new Event("scroll"));});
  flow.beforeWhole=await measure(p);
  await p.getByRole("button",{name:"Whole portrait",exact:true}).click();
  flow.whole=await measure(p);
  await p.goBack();
  await p.getByRole("tab",{name:"Resources",exact:true}).waitFor();
  flow.afterBack=await measure(p);
  await p.getByRole("tab",{name:"Overview",exact:true}).click();
  await p.locator(".explorer-reader").evaluate(el=>{el.scrollTop=150;el.dispatchEvent(new Event("scroll"));});
  flow.scrolledBeforeWhole=await measure(p);
  await p.getByRole("button",{name:"Whole portrait",exact:true}).click();
  await p.goBack();
  await p.getByRole("tab",{name:"Overview",exact:true}).waitFor();
  flow.scrolledAfterBack=await measure(p);
  await p.locator(".explorer-reader").evaluate(el=>el.scrollTop=0);
  await snap(p,"account-desktop-chapter");
  flow.actions=await p.locator(".explorer-reader-actions").evaluate(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,readerBottom:el.closest("aside").getBoundingClientRect().bottom}));
  flow.privateAssetRequests=desktop.requests.filter(r=>/\/(models|images)\//.test(r.path)).length;
  flow.errors=desktop.errors;
  report.workflows.push(flow);
  await desktop.context.close();
  console.log("desktop",JSON.stringify(flow));

  const mobile=await setup(390),m=mobile.page;
  await m.goto("http://127.0.0.1:5183/#pattern");
  await m.getByRole("button",{name:"Explore your 3D portrait",exact:true}).click();
  await sceneReady(m);
  const phone={width:390,entry:await measure(m)};
  await m.getByRole("navigation",{name:"Pattern chapters"}).getByRole("button").nth(1).click();
  phone.railSelected=await measure(m);
  await m.screenshot({path:new URL("account-phone-rail-selected.png",root).pathname});
  await m.getByRole("button",{name:"Read chapter",exact:true}).click();
  phone.reading=await measure(m);
  await m.getByRole("tab",{name:"Resources",exact:true}).click();
  await m.getByRole("button",{name:"Your sky",exact:true}).click();
  await m.getByRole("button",{name:"Back to Pattern",exact:true}).click();
  phone.skyReturn=await measure(m);
  await m.getByRole("button",{name:"Return to portrait",exact:true}).click();
  await m.getByRole("button",{name:"Whole portrait",exact:true}).click();
  await m.getByRole("button",{name:/^Begin with/}).click();
  phone.primarySelected=await measure(m);
  await m.getByRole("button",{name:"Whole portrait",exact:true}).click();
  const label=m.locator('button[data-form-index="0"]');
  await label.scrollIntoViewIfNeeded();
  await label.click();
  phone.sceneSelected=await measure(m);
  await m.screenshot({path:new URL("account-phone-scene-selected.png",root).pathname});
  await m.getByRole("button",{name:"Full reading"}).click();
  const complete=await m.locator(".explorer-complete").innerText();
  phone.completeProse=doc.core_chapters.every(c=>[c.title,c.summary,...c.sections.map(x=>x.text),...c.tensions.map(x=>x.text),...c.resources.map(x=>x.text),c.counter_expression.text].every(t=>complete.includes(t)));
  phone.errors=mobile.errors;
  report.workflows.push(phone);
  console.log("mobile",JSON.stringify(phone));
  await mobile.context.close();
} catch(error){report.failure=String(error.stack);console.error(report.failure);process.exitCode=1;}
finally {await fs.writeFile(new URL(process.env.REVIEW_CONFIRM ? "confirmation.json" : "results.json",root),JSON.stringify(report,null,2));await browser.close();}
