import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {chromium} from "/home/henry/core-ai-wcus/node_modules/playwright/index.mjs";
const folder=new URL("./",import.meta.url);
const browser=await chromium.launch({executablePath:"/home/henry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const report={source:"6e706741f03253f2807d33380afb529161f3481f",method:"Original fictional preview models; Chromium/SwiftShader; reduced motion enabled to inspect settled states.",states:[]};
const digest=b=>createHash("sha256").update(b).digest("hex");
async function measure(page,name){
 const data=await page.evaluate(()=>{
  const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,display:getComputedStyle(el).display,position:getComputedStyle(el).position};};
  return {scrollY,viewport:{width:innerWidth,height:innerHeight},sky:document.querySelector('.observatory-views button:nth-child(2)')?.getAttribute('aria-pressed'),heading:document.querySelector('.explorer-reader [data-reader-heading]')?.textContent,facet:document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,annotation:document.querySelector('.explorer-annotation')?.textContent,scene:rect(document.querySelector('.explorer-scene')),visual:rect(document.querySelector('.explorer-visual')),rail:rect(document.querySelector('.explorer-chapters')),returnControl:rect([...document.querySelectorAll('button')].find(b=>b.textContent==='Return to portrait')),inspectButton:[...document.querySelectorAll('button')].find(b=>['Look closer','Step back'].includes(b.textContent))?.textContent,unfoldButton:[...document.querySelectorAll('button')].find(b=>/^(Unfold portrait|Reassemble)/.test(b.textContent))?.textContent,labels:[...document.querySelectorAll('button[data-form-index]')].map(b=>({text:b.textContent,compact:b.dataset.compact,visible:getComputedStyle(b).visibility})),history:history.state,overflow:document.documentElement.scrollWidth-innerWidth};
 });
 report.states.push({name,...data});console.log(name,JSON.stringify(data));return data;
}
async function shot(page,name,canvasOnly=false){
 await page.waitForTimeout(400);
 const bytes=await page.locator(canvasOnly?'canvas':'.explorer-scene').screenshot({path:new URL(name+'.png',folder).pathname,timeout:30000});
 return digest(bytes);
}
async function open(width,height){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage();
 page.setDefaultTimeout(18000);
 await page.goto('http://127.0.0.1:5184/pattern-portrait.html');
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Rotate left"]')?.disabled===false,{},{timeout:30000});
 await page.evaluate(()=>scrollTo(0,0));return {context,page};
}
try {
 const desktop=await open(1440,900),p=desktop.page;
 await measure(p,'desktop-entry');await shot(p,'desktop-entry');
 await p.getByRole('navigation',{name:'Pattern chapters'}).getByRole('button').first().click();
 await p.evaluate(()=>scrollTo(0,0));
 await measure(p,'desktop-chapter');
 report.chapterHash=await shot(p,'chapter-canvas',true);
 await p.getByRole('button',{name:'Look closer',exact:true}).click();
 await measure(p,'desktop-inspect');
 report.inspectHash=await shot(p,'inspect-canvas',true);
 await p.getByRole('tab',{name:'Tensions',exact:true}).click();
 await measure(p,'desktop-tensions');
 report.tensionsHash=await shot(p,'tensions-canvas',true);
 await p.getByRole('button',{name:'Your sky',exact:true}).click();
 await measure(p,'sky-before-back');
 await p.goBack();
 await measure(p,'sky-after-browser-back');
 await p.getByRole('button',{name:'Your Pattern',exact:true}).click();
 await measure(p,'pattern-after-browser-back');
 await p.getByRole('tab',{name:'Tensions',exact:true}).click();
 await p.getByRole('combobox',{name:'Compare with another chapter'}).selectOption('chapter-2');
 await measure(p,'comparison');
 await p.locator('.explorer-workspace').screenshot({path:new URL('comparison.png',folder).pathname});
 await p.getByRole('button',{name:'End comparison',exact:true}).click();
 await p.getByRole('tab',{name:'Tensions',exact:true}).waitFor();
 const closer=p.getByRole('button',{name:'Look closer',exact:true});
 if(await closer.count())await closer.click();
 await p.getByRole('button',{name:/^Unfold portrait/}).click();
 await measure(p,'unfolded-inspect');
 report.unfoldedInspectHash=await shot(p,'unfolded-inspect-canvas',true);
 await p.getByRole('button',{name:'Whole portrait',exact:true}).click();
 await measure(p,'whole-after-inspect-unfold');
 report.wholeHash=await shot(p,'whole-after-inspect-unfold-canvas',true);
 await desktop.context.close();

 const mobile=await open(390,844),m=mobile.page;
 await measure(m,'phone-entry');
 await m.screenshot({path:new URL('phone-entry.png',folder).pathname});
 await m.getByRole('button',{name:/^Begin with/}).click();
 await measure(m,'phone-primary-entry');
 await m.getByRole('button',{name:'Read chapter',exact:true}).click();
 await measure(m,'phone-reading-start');
 await m.evaluate(()=>scrollBy(0,250));
 await measure(m,'phone-reading-scrolled');
 await m.screenshot({path:new URL('phone-reading-scrolled.png',folder).pathname});
 await mobile.context.close();

 const landscape=await open(844,390),l=landscape.page;
 await measure(l,'landscape-inline');
 await l.getByRole('button',{name:'Expand scene',exact:true}).click();
 await l.getByRole('dialog',{name:'Expanded portrait scene'}).waitFor();
 await measure(l,'landscape-expanded');
 await l.screenshot({path:new URL('landscape-expanded.png',folder).pathname});
 await landscape.context.close();
} catch(error){report.error=error.stack;console.error(error.stack);process.exitCode=1;}
finally {await fs.writeFile(new URL('results.json',folder),JSON.stringify(report,null,2));await browser.close();}
