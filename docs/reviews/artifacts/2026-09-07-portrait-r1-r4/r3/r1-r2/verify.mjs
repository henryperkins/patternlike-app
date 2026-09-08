import {chromium} from '/home/henry/core-ai-wcus/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/home/henry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const report={checks:[],states:[],errors:[]};
const check=(name,pass,details)=>{report.checks.push({name,pass,details});console.log(pass?'PASS':'FAIL',name,JSON.stringify(details??''));};
async function measure(page,name) {
 const data=await page.evaluate(()=>{
  const rect=s=>{const el=document.querySelector(s);if(!el)return null;return {...el.getBoundingClientRect().toJSON(),display:getComputedStyle(el).display};};
  return {width:innerWidth,height:innerHeight,scrollY,scene:rect('.explorer-scene'),rail:rect('.explorer-chapters'),controls:rect('.explorer-scene-toolbar'),modes:rect('.explorer-mobile-modes'),identity:rect('.explorer-reading-identity'),overflow:document.documentElement.scrollWidth-innerWidth,heading:document.querySelector('.explorer-reader [data-reader-heading]')?.textContent,sky:document.querySelector('.observatory-views button:nth-child(2)')?.getAttribute('aria-pressed'),presentation:document.querySelector('.portrait-explorer')?.className};
 });report.states.push({name,...data});return data;
}
const reading=page=>page.evaluate(()=>({heading:document.querySelector('.explorer-reader [data-reader-heading]')?.textContent,facet:document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,passage:document.querySelector('.explorer-passage[data-active="true"]')?.textContent,readerScroll:document.querySelector('.explorer-reader')?.scrollTop,scrollY,presentation:document.querySelector('.portrait-explorer')?.className,history:history.state}));
async function travel(page,direction,sky) {await page[direction]();await page.waitForFunction(value=>document.querySelector('.observatory-views button:nth-child(2)')?.getAttribute('aria-pressed')===String(value),sky);}
try {for(const [width,height,textScale] of [[1440,900,1],[390,844,1],[320,844,1],[320,844,2],[844,390,1]]) {
 const name=`${width}-${textScale}`,page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
 page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push({name,error:e.message}));page.on('console',m=>{if(m.type()==='error')report.errors.push({name,error:m.text()});});
 try {
 await page.goto('http://127.0.0.1:5184/pattern-portrait.html');
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Rotate left"]')?.disabled===false,null,{timeout:30000});
 if(textScale===2) await page.evaluate(()=>{for(const el of document.querySelectorAll('.portrait-explorer *')) {const style=getComputedStyle(el);if([...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()))el.style.fontSize=`${parseFloat(style.fontSize)*2}px`;}});
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:`/tmp/portrait-r3/r1-r2/after-${name}.png`});
 let state=await measure(page,`entry-${name}`);
 check(`page-${name}`,Boolean(await page.title()) && await page.locator('vite-error-overlay').count()===0 && await page.locator('.explorer-chapters button').count()===4);
 check(`overflow-${name}`,state.overflow===0,state.overflow);
 if([1440,390].includes(width)) check(`first-viewport-${name}`,state.scene.y>=0&&state.scene.bottom<=height&&state.rail.bottom<=height&&state.controls.bottom<=height,state);
 if(width===844)check('landscape-scene-height',state.scene.height<height,state.scene.height);
 await page.getByRole('navigation',{name:'Pattern chapters'}).getByRole('button').first().click();
 await page.evaluate(()=>scrollTo(0,0));
 state=await measure(page,`selected-${name}`);
 if([1440,390].includes(width)) check(`selected-viewport-${name}`,state.rail.bottom<=height,state.rail);
 check(`options-closed-${name}`,!await page.locator('.explorer-secondary-controls').evaluate(e=>e.open));
 if(textScale===2) {
  await page.getByRole('button',{name:'Read chapter',exact:true}).click();
  await page.evaluate(()=>scrollBy(0,300));
  state=await measure(page,`reading-${name}`);
  await page.screenshot({path:`/tmp/portrait-r3/r1-r2/reading-${name}.png`});
  check(`identity-return-${name}`,state.modes.y>=0&&state.modes.bottom<height&&state.identity?.height>0,state.modes);
  check(`reading-overflow-${name}`,state.overflow===0,state.overflow);
  await page.getByRole('button',{name:'Return to portrait',exact:true}).click();
  continue;
 }
 await page.getByRole('tab',{name:'Tensions',exact:true}).click();
 await page.locator('.explorer-passage').last().getByRole('button',{name:/Show passage/}).click();
 if(width===1440)await page.locator('.explorer-reader').evaluate(e=>e.scrollTop=100);
 if(width===390){
  await page.getByRole('button',{name:'Read chapter',exact:true}).click();
  await page.evaluate(()=>scrollBy(0,200));
  state=await measure(page,`reading-${name}`);
  await page.screenshot({path:`/tmp/portrait-r3/r1-r2/reading-${name}.png`});
  check(`identity-return-${name}`,state.modes.y>=0&&state.modes.bottom<height&&state.identity?.height>0,state.modes);
 }
 const origin=await reading(page);
 await page.getByRole('button',{name:'Your sky',exact:true}).click();
 await page.getByRole('button',{name:'Moon in Taurus',exact:true}).click();
 const skyMarker=await page.evaluate(()=>history.state);
 await page.getByRole('button',{name:'Rising in Libra',exact:true}).click();
 check(`body-replaces-${name}`,JSON.stringify(await page.evaluate(()=>history.state))===JSON.stringify(skyMarker));
 await travel(page,'goBack',false);
 let returned=await reading(page);
 check(`native-return-${name}`,returned.heading===origin.heading&&returned.facet===origin.facet&&returned.passage===origin.passage&&returned.presentation===origin.presentation&&JSON.stringify(returned.history)===JSON.stringify(origin.history),{origin,returned});
 if(width===1440)check(`reader-scroll-${name}`,Math.abs(returned.readerScroll-origin.readerScroll)<2,{origin:origin.readerScroll,returned:returned.readerScroll});
 await travel(page,'goForward',true);
 check(`forward-body-${name}`,await page.getByRole('heading',{name:'Rising in Libra',exact:true}).isVisible());
 await page.getByRole('button',{name:'Your Pattern',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.observatory-views button:nth-child(2)')?.getAttribute('aria-pressed')==='false');
 check(`explicit-return-${name}`,JSON.stringify((await reading(page)).history)===JSON.stringify(origin.history));
 if(width===390) {
  await page.getByRole('button',{name:'Return to portrait',exact:true}).click();
  await page.getByRole('button',{name:'Whole portrait',exact:true}).click();
  await page.getByRole('button',{name:'Explore the first chapter',exact:true}).click();
  state=await measure(page,'phone-explore-action');
  check('explore-keeps-model',state.scene.y>=0&&state.scene.bottom<=height&&state.rail.bottom<=height,state);
 }
 if(width===1440||width===390){
  await page.getByRole('combobox',{name:'Compare with another chapter'}).selectOption('chapter-2');
  const compare=await reading(page);
  await page.getByRole('button',{name:'Your sky',exact:true}).click();
  await travel(page,'goBack',false);
  const result=await reading(page);
  check(`compare-roundtrip-${name}`,await page.getByRole('button',{name:'End comparison'}).isVisible()&&result.facet===compare.facet&&JSON.stringify(result.history)===JSON.stringify(compare.history));
 }
 if(width===844) {
  await page.getByRole('button',{name:'Expand scene',exact:true}).click();
  state=await measure(page,'landscape-expanded');
  await page.screenshot({path:'/tmp/portrait-r3/r1-r2/landscape-expanded.png'});
  check('expanded-landscape-controls',state.scene.bottom<=height&&state.rail.bottom<=height,state);
 }
 } catch(error){check(`flow-${name}`,false,error.stack);} finally {await page.close();}
}} finally {await fs.writeFile('/tmp/portrait-r3/r1-r2/results.json',JSON.stringify(report,null,2));await browser.close();if(report.errors.length||report.checks.some(c=>!c.pass))process.exitCode=1;}
