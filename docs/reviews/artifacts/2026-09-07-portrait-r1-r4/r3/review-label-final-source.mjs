import {chromium} from '/home/henry/core-ai-wcus/node_modules/playwright/index.mjs';
const browser = await chromium.launch({executablePath:'/home/henry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const settle = async page => {await page.waitForTimeout(500); await page.evaluate(() => new Promise((resolve,reject)=>{let last=scrollY,count=0,start=performance.now();const frame=()=>{if(scrollY===last)count++;else count=0;last=scrollY;if(count>=12)return resolve();if(performance.now()-start>12000)return reject(new Error('Scrolling did not settle'));requestAnimationFrame(frame)};requestAnimationFrame(frame)}));};
try {
 for (const reducedMotion of ['no-preference','no-preference','no-preference']) {
  const page = await browser.newPage({viewport:{width:320,height:844},reducedMotion});
  const errors=[]; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/PortraitScene.tsx*',async route => {const response=await route.fetch(); await route.fulfill({response,body:(await response.text()).replace('this.props = props;','this.props = props; window.__r3Runtime = this;')});});
  await page.goto('http://127.0.0.1:5184/pattern-portrait.html');
  await page.waitForFunction(() => window.__r3Runtime?.ready);
  await page.getByRole('navigation',{name:'Pattern chapters'}).getByRole('button').first().click();
  await page.getByRole('combobox',{name:'Compare with another chapter'}).selectOption('chapter-2');
  const section = page.locator('.explorer-comparison > section').nth(1);
  const exactSource = await section.locator('.explorer-passage p').nth(1).textContent();
  await section.getByRole('button',{name:'Show passage 2 in portrait',exact:true}).click();
  await settle(page);
  await page.keyboard.press('Tab');
  await page.locator('.explorer-annotation[data-chapter-id="chapter-2"]').evaluate(el => el.focus({preventScroll:true}));
  await settle(page);
  const before=await page.evaluate(()=>({camera:window.__r3Runtime.camera.position.toArray(),target:window.__r3Runtime.controls.target.toArray()}));
  await page.evaluate(() => {for(const el of document.querySelectorAll('.portrait-explorer *')) if([...el.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim())) el.style.fontSize=`${parseFloat(getComputedStyle(el).fontSize)*2}px`;});
  await settle(page);
  const fallback = await page.evaluate(()=>{const r=window.__r3Runtime,f=document.activeElement,c=getComputedStyle(f);return {chapter:f.dataset.chapterId,native:f.matches('.explorer-compared-chapters button'),focusVisible:f.matches(':focus-visible'),outlineWidth:c.outlineWidth,rect:f.getBoundingClientRect().toJSON(),stickyBottom:document.querySelector('.explorer-mobile-modes').getBoundingClientRect().bottom,camera:r.camera.position.toArray(),target:r.controls.target.toArray(),hidden:[...document.querySelectorAll('.explorer-annotation')].map(el=>getComputedStyle(el).visibility),overflow:document.documentElement.scrollWidth-innerWidth};});
  if(!fallback.native||fallback.chapter!=='chapter-2'||!fallback.focusVisible||fallback.rect.top<fallback.stickyBottom||fallback.rect.bottom>844||fallback.overflow!==0)throw new Error(`Bad focus fallback: ${JSON.stringify(fallback)}`);
  if(JSON.stringify(before.camera)!==JSON.stringify(fallback.camera)||JSON.stringify(before.target)!==JSON.stringify(fallback.target))throw new Error('Camera moved during text resize');
  await page.keyboard.press('Enter'); await settle(page);
  const firstReturn=await page.evaluate(()=>({text:document.activeElement.textContent,source:document.activeElement.matches('.explorer-comparison > section:nth-child(2) .explorer-passage:nth-child(4) p'),p:document.activeElement.tagName}));
  if(firstReturn.text!==exactSource||firstReturn.p!=='P')throw new Error(`Wrong first source: ${JSON.stringify(firstReturn)}`);
  await section.getByRole('button',{name:'Show passage 2 in portrait',exact:true}).click(); await settle(page);
  const showReturn=await page.evaluate(()=>({native:document.activeElement.matches('.explorer-compared-chapters button'),chapter:document.activeElement.dataset.chapterId,rect:document.activeElement.getBoundingClientRect().toJSON(),stickyBottom:document.querySelector('.explorer-mobile-modes').getBoundingClientRect().bottom,passage:document.querySelector('.explorer-annotation[data-chapter-id="chapter-2"]').dataset.activePassage}));
  if(!showReturn.native||showReturn.chapter!=='chapter-2'||showReturn.passage!=='1'||showReturn.rect.top<showReturn.stickyBottom)throw new Error(`Wrong Show handoff: ${JSON.stringify(showReturn)}`);
  await page.keyboard.press('Enter'); await settle(page);
  const finalText=await page.evaluate(()=>document.activeElement.textContent);
  if(finalText!==exactSource)throw new Error(`Wrong repeated source ${finalText}`);
  console.log(JSON.stringify({reducedMotion,fallback,showReturn,exactSource,firstReturn,repeatExactSource:finalText===exactSource,errors}));
  await page.close();
 }
}finally{await browser.close();}
