async(page)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="Rotate left"]')?.disabled);
 await page.getByRole('button',{name:/^1\./}).click();await page.getByRole('button',{name:'Expand scene',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Expanded portrait scene'});
 await page.waitForFunction(()=>!document.querySelector('dialog button[aria-label="Rotate left"]')?.disabled);
 await dialog.getByRole('button',{name:/^4\./}).focus();await page.keyboard.press('Tab');
 const forward=await page.evaluate(()=>document.activeElement.textContent);
 await page.keyboard.press('Shift+Tab');const backward=await page.evaluate(()=>document.activeElement.getAttribute('aria-label'));
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 const restored=await page.evaluate(()=>document.activeElement.getAttribute('aria-label'));
 await page.getByRole('tab',{name:'Tensions',exact:true}).click();await page.getByRole('button',{name:/Tensions: show source passage/}).click();
 const paragraph=await page.evaluate(()=>document.activeElement.textContent);
 return{url:page.url(),forwardTab:forward,backwardTab:backward,focusReturn:restored,sourceParagraph:paragraph,canvasCount:await page.locator('canvas').count(),errors};
}
