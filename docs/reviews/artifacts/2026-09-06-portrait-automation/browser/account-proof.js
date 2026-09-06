async (page) => {
  const origin='http://127.0.0.1:4187';
  const fixture=await (await page.request.get(origin+'/fixture.json')).json();
  const download=await (await page.request.get(origin+'/complete-download.json')).json();
  const {document,portrait,explorer}=fixture;
  const images=await Promise.all([1,2,3,4].map(async i=>(await page.request.get(origin+'/image-'+i+'.png')).body()));
  const models=await Promise.all([1,2,3,4].map(async i=>(await page.request.get(origin+'/model-'+i+'.glb')).body()));
  const allReports=[];let activeErrors=[],activeWarnings=[];
  page.on('pageerror',error=>activeErrors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')activeErrors.push(message.text());if(message.type()==='warning')activeWarnings.push(message.text())});
  await page.addInitScript(()=>{
    if(window.__portraitBlobHooks)return;window.__portraitBlobHooks=true;
    window.__portraitBlobStats={created:[],revoked:[]};
    const make=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=make(blob);window.__portraitBlobStats.created.push({url,type:blob.type,size:blob.size});return url;};
    URL.revokeObjectURL=url=>{window.__portraitBlobStats.revoked.push(url);return revoke(url);};
  });
  for(const width of [1440,390,320]){
    await page.unroute('**/v1/**');await page.setViewportSize({width,height:width===1440?1000:844});
    await page.emulateMedia({reducedMotion:'reduce'});
    let enabled=false,readyAllowed=false,activeChart=portrait.chart_id;const requests=[];activeErrors=[];activeWarnings=[];
    const consent={schema_version:'0.7.0',kind:'pattern_generation',status:'granted',provider:'OpenAI',purpose:'one_pattern_per_chart',policy_version:'1.0.0',enabled_categories:[],granted_at:'2026-09-06T00:00:00Z'};
    await page.route('**/v1/**',async route=>{
      const request=route.request(),path='/v1'+request.url().split('/v1')[1].split('?')[0];
      requests.push({path,method:request.method(),body:request.postData()});
      const replacement=activeChart!==portrait.chart_id;
      const doc=replacement?{...document,pattern_id:'pat_replacement_canary',generated_at:'2026-09-06T01:00:00.000Z'}:document;
      const json=body=>route.fulfill({status:200,contentType:'application/json',headers:{'cache-control':'private, no-store'},body:JSON.stringify(body)});
      if(path==='/v1/pattern-state')return json({schema_version:'0.9.0',state:'ready',chart:{chart_id:activeChart,effective_accuracy:'exact',feature_policy_version:'1.0.0'},consent,generation:null,pattern:{pattern_id:doc.pattern_id,generated_at:doc.generated_at,locale:doc.locale,effective_accuracy:doc.effective_accuracy},regeneration:{eligible:false,generation:null,failure:null}});
      if(path==='/v1/pattern')return json(doc);
      if(path==='/v1/pattern-portrait/automation'){
        if(request.method()==='PUT')enabled=JSON.parse(request.postData()).enabled;
        return json({schema_version:'portrait-automation/v1',available:true,chart_id:activeChart,enabled:replacement?false:enabled,consent_policy_version:'1.1.0'});
      }
      if(path==='/v1/pattern-portrait/explorer'){
        if(readyAllowed&&!replacement)return json(explorer);
        const generating=enabled&&!replacement;
        return json({schema_version:'pattern-portrait-explorer/v1',status:generating?'generating':'not_started',portrait:{...portrait,status:generating?'generating':'not_started',portrait_id:generating?portrait.portrait_id:null,chart_id:activeChart,pattern_id:doc.pattern_id,generated_at:doc.generated_at,document_revision:`${doc.schema_version}:${doc.pattern_id}:${doc.generated_at}`,completed_chapters:generating?2:0,chapters:[],graph:null},completed_models:generating?1:0,retryable:false,models:[]});
      }
      if(path.startsWith('/v1/pattern-portrait/images/')){
        const index=portrait.chapters.findIndex(c=>path.endsWith(c.reference_id));return route.fulfill({status:200,contentType:'image/png',headers:{'cache-control':'private, no-store'},body:images[index]});
      }
      if(path.startsWith('/v1/pattern-portrait/models/')){
        const index=explorer.models.findIndex(c=>path.endsWith(c.reference_id));return route.fulfill({status:200,contentType:'model/gltf-binary',headers:{'cache-control':'private, no-store'},body:models[index]});
      }
      if(path==='/v1/pattern-portrait/explorer/download')return json(download);
      return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'unexpected',message:path}})});
    });
    const checks={},check=(name,value)=>{checks[name]=Boolean(value);if(!value)throw new Error(width+': '+name);};
    const visibleProse=async()=>{const text=await page.locator('body').innerText();return document.core_chapters.every(c=>[c.summary,...c.sections.map(s=>s.text),...c.tensions.map(s=>s.text),...c.resources.map(s=>s.text),c.counter_expression.text].every(p=>text.includes(p)));};
    await page.goto(origin+'/',{waitUntil:'networkidle'});
    const optin=page.getByRole('checkbox',{name:'Automatically create my 3D portrait'});await optin.waitFor();
    check('initial_automation_off',!(await optin.isChecked()));check('complete_prose_before_generation',await visibleProse());
    await page.screenshot({path:'output/playwright/portrait-automation/account-'+width+'-opt-in.png',fullPage:true});
    await optin.click();await page.getByText('Creating your portrait · 2 of 4 images · 1 of 4 models saved.').waitFor();
    check('only_opt_in_mutation',requests.filter(r=>r.method!=='GET').length===1&&requests.find(r=>r.method!=='GET').path==='/v1/pattern-portrait/automation');
    check('complete_prose_during_generation',await visibleProse());
    await page.screenshot({path:'output/playwright/portrait-automation/account-'+width+'-progress.png',fullPage:true});
    readyAllowed=true;
    await page.getByRole('button',{name:'Explore your 3D portrait',exact:true}).waitFor({timeout:20000});
    check('no_generation_post',requests.every(r=>r.method!=='POST'));
    await page.getByRole('button',{name:'Explore your 3D portrait',exact:true}).click();
    await page.getByRole('button',{name:'Rotate left',exact:true}).waitFor({timeout:20000});
    await page.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Rotate left"]');return b&&!b.disabled&&document.querySelectorAll('canvas').length===1;},{},{timeout:20000});
    check('four_private_image_gets',requests.filter(r=>r.path.startsWith('/v1/pattern-portrait/images/')).length===4);
    check('four_private_model_gets',requests.filter(r=>r.path.startsWith('/v1/pattern-portrait/models/')).length===4);
    check('real_webgl_canvas',await page.locator('canvas').evaluate(canvas=>Boolean(canvas.width&&canvas.height&&(canvas.getContext('webgl2')||canvas.getContext('webgl')))));
    check('personal_provenance_label',await page.getByText('Private portrait',{exact:true}).count()===1&&!(await page.locator('.portrait-explorer').innerText()).includes('fictional chapter images'));
    await page.locator('.portrait-explorer').scrollIntoViewIfNeeded();
    await page.screenshot({path:'output/playwright/portrait-automation/account-'+width+'-whole.png',fullPage:true});
    const controls=page.getByRole('group',{name:'3D controls'});await controls.focus();await page.keyboard.press('ArrowRight');
    check('keyboard_camera_controls',await controls.evaluate(element=>document.activeElement===element));
    const loseGraphics=async()=>{const supported=await page.locator('canvas').evaluate(canvas=>{const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');const extension=gl?.getExtension('WEBGL_lose_context');if(!extension)return false;extension.loseContext();return true;});check('graphics_loss_supported',supported);await page.getByText('The portrait is taking a pause.',{exact:true}).waitFor();};
    await loseGraphics();check('graphics_loss_disables_camera',await page.getByRole('button',{name:'Rotate left',exact:true}).isDisabled());
    await page.screenshot({path:'output/playwright/portrait-automation/account-'+width+'-graphics-fallback.png',fullPage:true});
    await page.getByRole('button',{name:'Full reading'}).click();check('graphics_loss_keeps_complete_reading',await visibleProse());
    await page.getByRole('button',{name:'Return to portrait',exact:true}).click();await page.waitForFunction(()=>document.querySelector('button[aria-label="Rotate left"]')?.disabled===false,{}, {timeout:20000});
    await loseGraphics();await page.getByRole('button',{name:'Try 3D again',exact:true}).click();await page.waitForFunction(()=>document.querySelector('button[aria-label="Rotate left"]')?.disabled===false,{}, {timeout:20000});
    check('graphics_retry_recovers_canvas',await page.locator('canvas').count()===1);
    await page.getByRole('button',{name:'Rotate right',exact:true}).click();
    await page.getByRole('button',{name:'Unfold portrait'}).click();check('unfolds',await page.getByRole('button',{name:'Reassemble'}).count()===1);await page.getByRole('button',{name:'Reassemble'}).click();
    const nav=page.getByRole('navigation',{name:'Pattern chapters'});
    for(let i=0;i<4;i++){const button=nav.getByRole('button',{name:new RegExp('^'+(i+1)+'\\.')});await button.click();check('chapter_'+(i+1),await button.getAttribute('aria-pressed')==='true');}
    await nav.getByRole('button',{name:/^2\./}).click();
    if(width<768)await page.getByRole('button',{name:'Read chapter',exact:true}).click();
    const reader=page.getByRole('complementary',{name:'Chapter reading'});
    for(const [facet,texts] of [['Tensions',document.core_chapters[1].tensions.map(x=>x.text)],['Resources',document.core_chapters[1].resources.map(x=>x.text)],['Another expression',[document.core_chapters[1].counter_expression.text]],['Overview',[document.core_chapters[1].summary]]]){
      await page.getByRole('tab',{name:facet,exact:true}).click();check('facet_'+facet,await page.getByRole('tab',{name:facet,exact:true}).getAttribute('aria-selected')==='true');
      const body=await reader.innerText();check('facet_prose_'+facet,texts.every(text=>body.includes(text)));
    }
    await page.getByRole('tab',{name:'Resources',exact:true}).click();await page.getByRole('tab',{name:'Resources',exact:true}).focus();await page.keyboard.press('ArrowLeft');
    check('keyboard_tab_left',await page.getByRole('tab',{name:'Tensions',exact:true}).evaluate(element=>document.activeElement===element&&element.getAttribute('aria-selected')==='true'));
    await page.keyboard.press('End');check('keyboard_tab_end',await page.getByRole('tab',{name:'Another expression',exact:true}).evaluate(element=>document.activeElement===element&&element.getAttribute('aria-selected')==='true'));
    await page.getByRole('tab',{name:'Resources',exact:true}).click();
    await page.getByRole('combobox',{name:'Compare with another chapter'}).selectOption('chapter-1');
    check('compare_two_chapters',await reader.getByRole('heading',{name:document.core_chapters[0].title,exact:true}).count()===1&&await reader.getByRole('heading',{name:document.core_chapters[1].title,exact:true}).count()===1);
    await page.screenshot({path:'output/playwright/portrait-automation/account-'+width+'-compare.png',fullPage:true});
    await page.getByRole('button',{name:'End comparison',exact:true}).click();
    check('comparison_preserves_facet',await page.getByRole('tab',{name:'Resources',exact:true}).getAttribute('aria-selected')==='true');
    await page.getByRole('button',{name:'Inspect original image'}).click();await page.getByRole('dialog',{name:'Original chapter image'}).waitFor();
    check('native_image_decodes',await page.getByRole('dialog',{name:'Original chapter image'}).getByRole('img').evaluate(img=>img.complete&&img.naturalWidth>0));await page.getByRole('button',{name:'Close image',exact:true}).focus();await page.keyboard.press('Tab');
    check('image_dialog_traps_focus',await page.getByRole('button',{name:'Close image',exact:true}).evaluate(element=>document.activeElement===element));await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement?.textContent?.includes('Inspect original image'));check('image_dialog_restores_focus',true);
    if(width<768)await page.getByRole('button',{name:'Return to portrait',exact:true}).click();
    await page.getByRole('button',{name:'Guide me through'}).click();
    if(width<768)await page.getByRole('button',{name:'Read chapter',exact:true}).click();
    await page.getByText('Guided exploration · Stop 1 of 4',{exact:true}).waitFor();await page.getByRole('button',{name:'Next stop',exact:true}).click();
    check('guide_advances',await page.getByText('Guided exploration · Stop 2 of 4',{exact:true}).count()===1);await page.getByRole('button',{name:'Exit guide',exact:true}).click();
    await page.getByRole('button',{name:'Full reading'}).click();await page.getByRole('region',{name:'Complete Pattern reading'}).waitFor();
    check('complete_full_reading',await visibleProse());check('uncertainty_preserved',(await page.locator('body').innerText()).includes(document.uncertainty.text));
    await page.screenshot({path:'output/playwright/portrait-automation/account-'+width+'-reading.png',fullPage:true});
    await page.getByRole('button',{name:'Return to portrait',exact:true}).click();
    if(width<768&&await page.getByRole('button',{name:'Return to portrait',exact:true}).count())await page.getByRole('button',{name:'Return to portrait',exact:true}).click();
    await page.getByRole('button',{name:'Expand scene',exact:true}).click();await page.getByRole('dialog',{name:'Expanded portrait scene'}).waitFor();
    check('expanded_scene',await page.getByRole('dialog',{name:'Expanded portrait scene'}).locator('canvas').count()===1);
    await page.waitForFunction(()=>document.querySelector('button[aria-label="Rotate left"]')?.disabled===false,{}, {timeout:20000});await loseGraphics();
    await page.screenshot({path:'output/playwright/portrait-automation/account-'+width+'-expanded-fallback.png'});
    await page.getByRole('button',{name:'Try 3D again',exact:true}).click();await page.waitForFunction(()=>document.querySelector('button[aria-label="Rotate left"]')?.disabled===false,{}, {timeout:20000});check('expanded_graphics_pointer_retry',true);await page.getByRole('dialog',{name:'Expanded portrait scene'}).getByRole('button',{name:'Whole portrait',exact:true}).focus();await page.keyboard.press('Shift+Tab');
    check('expanded_dialog_traps_focus',await page.getByRole('dialog',{name:'Expanded portrait scene'}).evaluate(element=>element.contains(document.activeElement)));await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Expand scene');check('expanded_dialog_restores_focus',true);
    const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download complete portrait',exact:true}).click();const savedDownload=await downloadEvent;
    check('complete_download_name',savedDownload.suggestedFilename()==='pattern-portrait-complete.json');if(width===1440)await savedDownload.saveAs('output/playwright/portrait-automation/complete-portrait.json');else await savedDownload.delete();
    check('complete_download_fixture',download.images.length===4&&download.models.length===4&&JSON.stringify(download.reading)===JSON.stringify(document)&&download.models.every(m=>m.program&&m.audit.accepted));
    await page.waitForTimeout(1200);
    await page.getByRole('button',{name:'Back to reading',exact:true}).click();check('plain_reading_preserved',await visibleProse());
    await page.getByRole('button',{name:'Explore your 3D portrait',exact:true}).click();await page.waitForFunction(()=>document.querySelector('button[aria-label="Rotate left"]')?.disabled===false,{}, {timeout:20000});
    check('reopen_reuses_assets',requests.filter(r=>r.path.startsWith('/v1/pattern-portrait/images/')).length===4&&requests.filter(r=>r.path.startsWith('/v1/pattern-portrait/models/')).length===4);
    check('no_horizontal_overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const before=await page.evaluate(()=>window.__portraitBlobStats);
    if(width===1440){activeChart='cht_replacement_canary';await page.evaluate(()=>window.accountCanaryReplaceChart('cht_replacement_canary'));await page.getByText('Choose automatic portraits above to turn this Pattern into four objects you can explore. Your reading is ready below.').waitFor();
      const changed=await page.evaluate(()=>window.__portraitBlobStats);check('source_change_revokes_private_blobs',before.created.filter(item=>item.type!=='application/json').every(item=>changed.revoked.includes(item.url)));check('source_change_removes_old_canvas',await page.locator('canvas').count()===0);
    }
    await page.evaluate(()=>window.accountCanaryUnmount());const after=await page.evaluate(()=>window.__portraitBlobStats);
    check('unmount_revokes_every_blob',after.created.every(item=>after.revoked.includes(item.url)));check('no_browser_errors',activeErrors.length===0);
    allReports.push({width,height:width===1440?1000:844,checks,errors:activeErrors,warnings:activeWarnings,requests,blobStats:after,compiledEvidence:fixture.evidence});
  }
  return {scope:'Actual PatternExperience with intercepted fictional account API; no live backend or account delivery claim',manualModelEdits:false,reports:allReports};
}
