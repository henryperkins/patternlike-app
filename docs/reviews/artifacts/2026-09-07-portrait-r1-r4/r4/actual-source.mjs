import {chromium} from '/home/henry/core-ai-wcus/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/home/henry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const checks=[],errors=[],warnings=[];const check=(name,pass,data)=>{checks.push({name,pass,data});console.log(pass?'PASS':'FAIL',name,JSON.stringify(data??''));};
const ready=p=>p.waitForFunction(()=>document.querySelector('button[aria-label="Rotate left"]')?.disabled===false);
try {
 for(const [width,height] of [[1440,900],[390,844]]){
 const p=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
 await p.goto('http://127.0.0.1:5174/pattern-portrait.html');await ready(p);check(`actual-source-load-${width}`,await p.title()==='Pattern portrait · Pattern/Like preview'&&!await p.locator('vite-error-overlay').count()&&await p.getByRole('navigation',{name:'Pattern chapters'}).getByRole('button').count()===4);
 await p.getByRole('navigation',{name:'Pattern chapters'}).getByRole('button').nth(2).click();await p.locator('.explorer-secondary-controls > summary').click();await p.getByRole('button',{name:'Look closer',exact:true}).click();await p.locator('.explorer-secondary-controls > summary').click();await p.locator('.explorer-scene').scrollIntoViewIfNeeded();await p.screenshot({path:`/tmp/portrait-r4/actual-${width}.png`});
 await p.getByRole('tab',{name:'Resources',exact:true}).click();
 if(width===390){
  await p.getByRole('button',{name:'Read chapter',exact:true}).click();await p.evaluate(()=>scrollBy(0,250));
  const reading=await p.evaluate(()=>({bar:document.querySelector('.explorer-mobile-modes').getBoundingClientRect().toJSON(),identity:document.querySelector('.explorer-reading-identity').textContent,overflow:document.documentElement.scrollWidth-innerWidth}));
  check('R2-sticky-reading-return',reading.bar.top>=0&&reading.bar.bottom<height&&reading.identity==='Keeping what matters'&&reading.overflow===0,reading);
  await p.getByRole('button',{name:'Your sky',exact:true}).click();await p.goBack();await p.getByRole('button',{name:'Return to portrait',exact:true}).waitFor();check('R1-phone-reading-sky-back',await p.getByRole('tab',{name:'Resources',exact:true}).getAttribute('aria-selected')==='true');
  await p.getByRole('button',{name:'Return to portrait',exact:true}).click();
 }
 await p.getByRole('button',{name:'Inspect original image',exact:true}).click();const originalImage=p.getByRole('dialog',{name:'Original chapter image'}).getByRole('img');await originalImage.waitFor({state:'visible'});await originalImage.evaluate(img=>img.decode());check(`R6-original-image-${width}`,await originalImage.evaluate(img=>img.complete&&img.naturalWidth>0),await originalImage.boundingBox());await p.getByRole('button',{name:'Close image',exact:true}).click();
 await p.getByRole('combobox',{name:'Compare with another chapter'}).selectOption('chapter-4');await p.getByRole('button',{name:'End comparison',exact:true}).click();await p.getByRole('combobox',{name:'Compare with another chapter'}).waitFor();check(`R3-comparison-reading-return-${width}`,await p.getByRole('tab',{name:'Resources',exact:true}).getAttribute('aria-selected')==='true');
 await p.locator('canvas').evaluate(canvas=>canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
 await p.getByRole('button',{name:'Try 3D again',exact:true}).waitFor();check(`graphics-reading-fallback-${width}`,await p.getByRole('tab',{name:'Resources',exact:true}).getAttribute('aria-selected')==='true'&&await p.getByRole('button',{name:'Continue reading',exact:true}).isVisible());
 await p.getByRole('button',{name:'Try 3D again',exact:true}).click();await ready(p);check(`graphics-recovery-${width}`,await p.getByRole('tab',{name:'Resources',exact:true}).getAttribute('aria-selected')==='true');
 await p.close();
 }
}catch(error){check('actual-source-flow',false,error.stack);}finally{await fs.writeFile('/tmp/portrait-r4/actual-results.json',JSON.stringify({checks,errors,warnings},null,2));await browser.close();if(errors.length||checks.some(c=>!c.pass))process.exitCode=1;}
