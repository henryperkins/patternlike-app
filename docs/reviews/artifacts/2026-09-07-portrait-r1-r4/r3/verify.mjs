import {chromium} from '/home/henry/core-ai-wcus/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/home/henry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const checks=[],errors=[];const check=(name,pass,details)=>{checks.push({name,pass,details});console.log(pass?'PASS':'FAIL',name,JSON.stringify(details??''));};
async function page(width,height=844) {
 const p=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.message));
 // A test-only reference exposes the existing runtime for read-only camera/geometry measurements.
 await p.route('**/PortraitScene.tsx*',async route=>{const r=await route.fetch();const s=await r.text();await route.fulfill({response:r,body:s.replace('this.props = props;','this.props = props; window.__runtime = this;')});});
 await p.goto('http://127.0.0.1:5184/pattern-portrait.html');await p.waitForFunction(()=>window.__runtime?.ready);return p;
}
const ready=async p=>{await p.waitForTimeout(1800);await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
const pose=p=>p.evaluate(()=>window.__runtime.snapshot());
const rail=p=>p.getByRole('navigation',{name:'Pattern chapters'});
const compare=async(p,id)=>{await p.getByRole('combobox',{name:'Compare with another chapter'}).selectOption(`chapter-${id}`);await ready(p);};
const metrics=p=>p.evaluate(()=>{
 const r=window.__runtime;const box=r.host.getBoundingClientRect();const visible=r.forms.filter(f=>f.root.visible);
 const objects=visible.map(f=>{const bounds=r.bounds()[r.forms.indexOf(f)];const min={x:Infinity,y:Infinity},max={x:-Infinity,y:-Infinity};for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const pt=r.camera.position.clone().set(x,y,z).project(r.camera);min.x=Math.min(min.x,pt.x);min.y=Math.min(min.y,pt.y);max.x=Math.max(max.x,pt.x);max.y=Math.max(max.y,pt.y);}return {id:f.id,min,max,left:box.left+(min.x+1)*box.width/2,right:box.left+(max.x+1)*box.width/2,top:box.top+(1-max.y)*box.height/2,bottom:box.top+(1-min.y)*box.height/2};});
 const labels=[...document.querySelectorAll('[data-form-index]')].map(l=>({id:l.dataset.chapterId,visible:getComputedStyle(l).visibility==='visible',text:l.textContent,rect:l.getBoundingClientRect().toJSON()}));
 return {objects,labels,overflow:document.documentElement.scrollWidth-innerWidth,modes:document.querySelector('.explorer-mobile-modes').getBoundingClientRect().toJSON(),scene:document.querySelector('.explorer-scene').getBoundingClientRect().toJSON()};
});
try {
 for(const width of [1440,390,320]) {
  const p=await page(width,width===1440?900:844);
  const initial=await rail(p).boundingBox();check(`R2-entry-${width}`,initial.y+initial.height<(width===1440?900:844));
  await rail(p).getByRole('button').first().click();await p.getByRole('button',{name:'Rotate right',exact:true}).click();await ready(p);
  const original=await pose(p);
  await compare(p,2);const m=await metrics(p);
  check(`pair-visible-${width}`,m.objects.length===2&&m.objects.every(o=>Math.max(Math.abs(o.min.x),Math.abs(o.max.x),Math.abs(o.min.y),Math.abs(o.max.y))<1)&&m.labels.length===2,m);
  check(`names-and-reflow-${width}`,m.labels.every(l=>l.visible&&l.rect.left>=m.scene.left&&l.rect.right<=m.scene.right&&l.text.includes(l.id==='chapter-1'?'Finding your own direction':'Making room for care'))&&m.overflow===0,m.labels);
  check(`labels-clear-of-objects-${width}`,m.labels.every(l=>m.objects.every(o=>l.rect.right<=o.left||l.rect.left>=o.right||l.rect.bottom<=o.top||l.rect.top>=o.bottom)),m);
  await p.screenshot({path:`/tmp/portrait-r3/after-${width}.png`});
  await p.getByRole('tab',{name:'Resources',exact:true}).click();const pairPose=await pose(p);await p.getByRole('tab',{name:'Tensions',exact:true}).click();check(`facets-no-camera-move-${width}`,JSON.stringify(await pose(p))===JSON.stringify(pairPose));
  await p.getByRole('button',{name:'Your sky',exact:true}).click();await p.getByRole('button',{name:'Moon in Taurus',exact:true}).click();await p.goBack();await p.getByRole('button',{name:'End comparison',exact:true}).waitFor();check(`R1-sky-back-${width}`,await p.getByRole('tab',{name:'Tensions',exact:true}).getAttribute('aria-selected')==='true');
  await p.goForward();await p.getByRole('heading',{name:'Moon in Taurus',exact:true}).waitFor();check(`R1-sky-forward-${width}`,true);await p.getByRole('button',{name:'Your Pattern',exact:true}).click();await p.getByRole('button',{name:'End comparison',exact:true}).waitFor();
  await p.getByRole('tab',{name:'Overview',exact:true}).click();const second=p.getByRole('region',{name:'Making room for care',exact:true});await second.getByRole('button',{name:'Show passage 2 in portrait',exact:true}).click();await ready(p);await p.getByRole('button',{name:'Overview: show source passage 2 for Making room for care',exact:true}).click();
  const focus=await p.evaluate(()=>({text:document.activeElement.textContent,rect:document.activeElement.getBoundingClientRect().toJSON(),inset:document.querySelector('.explorer-mobile-modes').getBoundingClientRect().bottom}));check(`second-source-passage-${width}`,focus.text.startsWith('A small, specific offer')&&focus.rect.bottom>focus.inset&&focus.rect.top<(width===1440?900:844),focus);
  await p.getByRole('button',{name:'End comparison',exact:true}).click();await p.getByRole('combobox',{name:'Compare with another chapter'}).waitFor();await ready(p);
  const returned=await pose(p);const distance=Math.max(...original.position.map((n,i)=>Math.abs(n-returned.position[i])),...original.target.map((n,i)=>Math.abs(n-returned.target[i])));check(`original-camera-return-${width}`,distance<0.00001,{distance,original,returned});
  await p.close();
 }
 const p=await page(390);
 for(const [first,second] of [[1,3],[1,4],[2,3],[2,4],[3,4]]) {await rail(p).getByRole('button').nth(first-1).click();await compare(p,second);const m=await metrics(p);check(`all-pairs-${first}-${second}`,m.objects.length===2&&m.objects.every(o=>Math.max(Math.abs(o.min.x),Math.abs(o.max.x),Math.abs(o.min.y),Math.abs(o.max.y))<1)&&m.labels.every(l=>l.visible),m);await p.getByRole('button',{name:'End comparison',exact:true}).click();await p.getByRole('combobox',{name:'Compare with another chapter'}).waitFor();}
 await p.close();
} catch(e) {check('browser-flow',false,e.stack);} finally {await fs.writeFile('/tmp/portrait-r3/results.json',JSON.stringify({checks,errors},null,2));await browser.close();if(errors.length||checks.some(c=>!c.pass))process.exitCode=1;}
