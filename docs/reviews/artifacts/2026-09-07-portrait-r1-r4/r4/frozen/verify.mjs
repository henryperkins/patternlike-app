import {chromium} from '/home/henry/core-ai-wcus/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/home/henry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const checks=[],errors=[];const check=(name,pass,data)=>{checks.push({name,pass,data});console.log(pass?'PASS':'FAIL',name,JSON.stringify(data??''));};
const stable=async p=>{await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await p.waitForFunction(()=>window.__runtime?.ready&&!window.__runtime.motion&&window.__runtime.forms.every(f=>Math.abs(f.root.rotation.y-(window.__runtime.props.experience?.turns[f.id]??0)*Math.PI/4)<.002));await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
const pose=p=>p.evaluate(()=>window.__runtime.snapshot());
const rail=p=>p.getByRole('navigation',{name:'Pattern chapters'});
const same=(a,b)=>Math.max(...a.position.map((n,i)=>Math.abs(n-b.position[i])),...a.target.map((n,i)=>Math.abs(n-b.target[i])))<.00001;
async function options(p,open){const el=p.locator('.explorer-secondary-controls');if(await el.evaluate(e=>e.open)!==open)await el.locator(':scope > summary').click();}
async function measure(p){return p.evaluate(()=>{
 const r=window.__runtime,host=r.host.getBoundingClientRect();
 const boxes=r.bounds(); const objects=r.forms.filter(f=>f.root.visible).map(f=>{
  const box=boxes[r.forms.indexOf(f)],min={x:Infinity,y:Infinity},max={x:-Infinity,y:-Infinity};
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const pt=r.camera.position.clone().set(x,y,z).project(r.camera);min.x=Math.min(min.x,pt.x);min.y=Math.min(min.y,pt.y);max.x=Math.max(max.x,pt.x);max.y=Math.max(max.y,pt.y);}
  let rays=0,visible=0,point=null;
  if(r.props.selectedIds.includes(f.id))for(let x=0;x<=6;x++)for(let y=0;y<=6;y++){
   const v={x:min.x+(max.x-min.x)*x/6,y:min.y+(max.y-min.y)*y/6};r.raycaster.setFromCamera(v,r.camera);
   if(!r.raycaster.intersectObject(f.root,true).length)continue;rays++;
   if(r.visibleHit()?.object.userData.chapterId===f.id){visible++;point??=v;}
  }
  return {id:f.id,min,max,top:(1-max.y)*host.height/2,bottom:(1-min.y)*host.height/2,rays,visible,point};
 });
 return {objects,top:r.topInset,bottom:host.height-r.bottomInset,host:host.toJSON(),selected:r.props.selectedIds,overflow:document.documentElement.scrollWidth-innerWidth,unfolded:r.props.unfolded,labels:[...document.querySelectorAll('[data-form-index]')].map(e=>({id:e.dataset.chapterId,visible:getComputedStyle(e).visibility==='visible',rect:e.getBoundingClientRect().toJSON()}))};
});}
const fit=(o,m)=>Math.abs(o.min.x)<1&&Math.abs(o.max.x)<1&&o.top>=m.top&&o.bottom<=m.bottom;
try {
for(const [width,height,scale,motion] of [[1440,900,1,'reduce'],[390,844,1,'reduce'],[320,844,2,'reduce'],[844,390,1,'no-preference']]) {
 const p=await browser.newPage({viewport:{width,height},reducedMotion:motion});p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/PortraitScene.tsx*',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('this.props = props;','this.props = props; window.__runtime = this;')});});
 await p.goto('http://127.0.0.1:5174/pattern-portrait.html');await stable(p);if(scale===2)await p.addStyleTag({content:'html { font-size: 200% !important; }'});
 check(`page-${width}`,await p.title()==='Pattern portrait · Pattern/Like preview'&&!await p.locator('vite-error-overlay').count(),{title:await p.title(),url:p.url()});
 await options(p,true);await p.locator('.explorer-settings > summary').click();await p.getByRole('combobox',{name:'Graphics',exact:true}).selectOption('low');await options(p,false);
 const entry=await rail(p).boundingBox();check(`R2-entry-${width}`,scale===2||height<481||entry.y+entry.height<=height,entry);
 for(let i=0;i<4;i++){
  await rail(p).getByRole('button').nth(i).click();await stable(p);await p.locator('.explorer-scene').scrollIntoViewIfNeeded();
  const approach=await measure(p),object=approach.objects.find(o=>o.id===`chapter-${i+1}`);check(`approach-${width}-${i+1}`,fit(object,approach)&&approach.overflow===0,{object,top:approach.top,bottom:approach.bottom});
  await options(p,true);await p.getByRole('button',{name:'Look closer',exact:true}).click();await stable(p);await options(p,false);await p.locator('.explorer-scene').scrollIntoViewIfNeeded();
  const inspect=await measure(p),close=inspect.objects.find(o=>o.id===`chapter-${i+1}`);
  check(`inspect-${width}-${i+1}`,fit(close,inspect)&&close.rays>0&&close.visible/close.rays>=.8&&close.max.x-close.min.x>object.max.x-object.min.x,{object:close,top:inspect.top,bottom:inspect.bottom});
  if(close.point){await p.mouse.move(inspect.host.left+(close.point.x+1)*inspect.host.width/2,inspect.host.top+(1-close.point.y)*inspect.host.height/2);check(`pointer-${width}-${i+1}`,await p.locator('canvas').evaluate(e=>e.style.cursor)==='pointer');}
  if(width===1440||width===390)await p.screenshot({path:`/tmp/portrait-r4/frozen/after-${width}-${i+1}.png`});
  await options(p,true);await p.getByRole('button',{name:'Open reading desk',exact:true}).click();for(let step=0;step<2;step++)await p.getByRole('button',{name:'Turn chapter object',exact:true}).click();await stable(p);await p.locator('.explorer-scene').scrollIntoViewIfNeeded();
  const turned=await measure(p);check(`turned-open-desk-${width}-${i+1}`,fit(turned.objects.find(o=>o.id===`chapter-${i+1}`),turned),turned.objects.find(o=>o.id===`chapter-${i+1}`));
  await options(p,false);
 }
 await options(p,true);await p.getByRole('button',{name:'Show roof',exact:true}).click();await stable(p);check(`roof-choice-${width}`,await p.evaluate(()=>window.__runtime.world.roof.visible));
 // The canopy still blocks ray picking; native chapters remain usable.
 await rail(p).getByRole('button').nth(1).click();await stable(p);check(`restricted-native-selection-${width}`,await p.getByRole('heading',{name:'Making room for care',exact:true}).isVisible());
 await options(p,true);await p.getByRole('button',{name:'Cut away roof',exact:true}).click();await p.getByRole('button',{name:'Look closer',exact:true}).click();await stable(p);await options(p,false);
 await p.getByRole('tab',{name:'Resources',exact:true}).click();const original=await pose(p);const beforeHistory=await p.evaluate(()=>history.state.portrait.index);
 await p.getByRole('button',{name:'Unfold portrait',exact:true}).click();await stable(p);let m=await measure(p);check(`unfold-overview-${width}`,m.unfolded&&m.selected.length===0&&m.objects.every(o=>fit(o,m)),m.objects);
 const unfoldedHistory=await p.evaluate(()=>history.state.portrait.index);check(`unfold-one-step-${width}`,unfoldedHistory===beforeHistory+1);
 for(let n=0;n<3;n++)await p.getByRole('button',{name:'Zoom in',exact:true}).click();await p.getByRole('button',{name:'Whole portrait',exact:true}).click();await stable(p);m=await measure(p);check(`whole-refits-${width}`,m.unfolded&&m.objects.every(o=>fit(o,m))&&await p.evaluate(()=>history.state.portrait.index)===unfoldedHistory);
 await p.goBack();await stable(p);check(`unfold-back-${width}`,same(original,await pose(p))&&await p.getByRole('tab',{name:'Resources',exact:true}).getAttribute('aria-selected')==='true');
 await p.getByRole('button',{name:'Your sky',exact:true}).click();await p.getByRole('button',{name:'Moon in Taurus',exact:true}).click();await p.goBack();await stable(p);check(`R1-sky-return-${width}`,same(original,await pose(p)));await p.goForward();await p.getByRole('heading',{name:'Moon in Taurus',exact:true}).waitFor();await p.getByRole('button',{name:'Your Pattern',exact:true}).click();await stable(p);
 await p.getByRole('combobox',{name:'Compare with another chapter'}).selectOption('chapter-4');await stable(p);m=await measure(p);check(`R3-pair-${width}`,m.objects.length===2&&m.objects.every(o=>fit(o,m)));
 const pair=await pose(p);await p.getByRole('tab',{name:'Tensions',exact:true}).click();await stable(p);check(`R5-facet-camera-${width}`,same(pair,await pose(p)),{before:pair,after:await pose(p),layout:await measure(p)});
 await p.getByRole('button',{name:'End comparison',exact:true}).click();await stable(p);check(`R3-origin-${width}`,same(original,await pose(p))&&await p.getByRole('tab',{name:'Resources',exact:true}).getAttribute('aria-selected')==='true');
 await p.getByRole('button',{name:'Full reading',exact:true}).click();check(`complete-reading-${width}`,await p.getByRole('heading',{name:'Seeing beyond the immediate',exact:true}).count()===1);await p.getByRole('button',{name:'Return to portrait',exact:true}).click();await stable(p);check(`full-reading-camera-${width}`,same(original,await pose(p)));
 await p.getByRole('button',{name:'Expand scene',exact:true}).click();await stable(p);m=await measure(p);check(`expanded-${width}`,m.objects.filter(o=>m.selected.includes(o.id)).every(o=>fit(o,m))&&m.overflow===0,m);await p.getByRole('button',{name:'Close expanded scene',exact:true}).click();await stable(p);check(`expanded-return-${width}`,same(original,await pose(p)));
 await p.locator('.explorer-scene').scrollIntoViewIfNeeded();await p.screenshot({path:`/tmp/portrait-r4/frozen/final-${width}.png`});await p.close();
}
} catch(e){check('browser-flow',false,e.stack);} finally{await fs.writeFile('/tmp/portrait-r4/frozen/results.json',JSON.stringify({checks,errors},null,2));await browser.close();if(errors.length||checks.some(c=>!c.pass))process.exitCode=1;}
