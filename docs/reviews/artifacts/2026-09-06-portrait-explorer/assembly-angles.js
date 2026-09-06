async(page)=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('http://127.0.0.1:5175/pattern-portrait.html');await page.waitForFunction(()=>!document.querySelector('button[aria-label="Rotate left"]')?.disabled);
 const settle=()=>page.evaluate(async()=>{for(let i=0;i<12;i++)await new Promise(requestAnimationFrame)});
 const shots=[];
 for(const[name,turns]of[['front',0],['front-left',2],['left',4],['rear',8],['right',12],['front-right',14]]){
  await page.getByRole('button',{name:'Reset view',exact:true}).click();for(let i=0;i<turns;i++)await page.getByRole('button',{name:'Rotate left',exact:true}).click();await page.mouse.move(1400,100);await settle();
  await page.locator('.explorer-scene').screenshot({path:`docs/reviews/artifacts/2026-09-06-portrait-explorer/assembly-${name}.png`,scale:'css'});shots.push(name);
 }
 await page.getByText('Scene controls & motion',{exact:true}).click();
 for(const[name,tilt]of[['elevated','Tilt up'],['lower','Tilt down']]){
  await page.getByRole('button',{name:'Reset view',exact:true}).click();await page.getByRole('button',{name:tilt,exact:true}).click();await page.getByRole('button',{name:tilt,exact:true}).click();await settle();
  await page.locator('.explorer-scene').screenshot({path:`docs/reviews/artifacts/2026-09-06-portrait-explorer/assembly-${name}.png`,scale:'css'});shots.push(name);
 }
 return{shots};
}
