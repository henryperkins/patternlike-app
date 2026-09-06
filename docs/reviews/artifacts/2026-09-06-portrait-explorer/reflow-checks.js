async (page) => {
 const result={};
 await page.setViewportSize({width:320,height:740});
 await page.goto('http://127.0.0.1:5175/pattern-portrait.html');
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="Rotate left"]')?.disabled);
 await page.getByRole('button',{name:/^1\./}).click();
 await page.evaluate(()=>{const values=[...document.querySelectorAll('.portrait-explorer *')].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)]);for(const[el,size]of values)el.style.fontSize=`${size*2}px`;});
 await page.evaluate(async()=>{for(let i=0;i<30;i++)await new Promise(requestAnimationFrame)});
 result.text200=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,buttons:[...document.querySelectorAll('.explorer-scene-toolbar button')].map(el=>({label:el.getAttribute('aria-label'),rect:el.getBoundingClientRect().toJSON()})),passageSize:getComputedStyle(document.querySelector('.explorer-passage p')).fontSize}));
 await page.screenshot({path:'docs/reviews/artifacts/2026-09-06-portrait-explorer/mobile-text-200.png',scale:'css',fullPage:true});
 await page.goto('http://127.0.0.1:5175/pattern-portrait.html');await page.setViewportSize({width:820,height:1180});
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="Rotate left"]')?.disabled);
 result.tablet=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,columns:getComputedStyle(document.querySelector('.explorer-workspace')).gridTemplateColumns}));
 await page.screenshot({path:'docs/reviews/artifacts/2026-09-06-portrait-explorer/tablet-whole.png',scale:'css'});
 return result;
}
