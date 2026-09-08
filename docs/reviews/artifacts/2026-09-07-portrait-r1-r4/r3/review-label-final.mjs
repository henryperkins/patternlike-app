import { chromium } from '/home/henry/core-ai-wcus/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/home/henry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const measure = page => page.evaluate(() => {
  const r = window.__r3Runtime, host = r.host.getBoundingClientRect();
  const objects = r.bounds().flatMap((box, index) => {
    if (!r.props.selectedIds.includes(r.forms[index].id)) return [];
    const xs = [], ys = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const point = box.min.clone().set(x, y, z).project(r.camera);
      xs.push(host.x + (point.x + 1) * r.width / 2); ys.push(host.y + (1 - point.y) * r.height / 2);
    }
    return [{ id: r.forms[index].id, left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }];
  });
  const labels = [...r.labels.querySelectorAll('[data-form-index]')].map(el => {
    const rect = el.getBoundingClientRect(), visible = getComputedStyle(el).visibility === 'visible';
    return { chapter: el.dataset.chapterId, visible, focused: document.activeElement === el, rect: rect.toJSON(),
      overlaps: visible ? objects.filter(object => rect.left < object.right && rect.right > object.left && rect.top < object.bottom && rect.bottom > object.top).map(object => object.id) : [], transform: el.style.transform };
  });
  return { camera: r.camera.position.toArray(), target: r.controls.target.toArray(), host: host.toJSON(), objects, labels,
    focus: document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent,
    native: [...document.querySelectorAll('.explorer-compared-chapters button')].map(el => ({ text: el.textContent, rect: el.getBoundingClientRect().toJSON() })),
    horizontalOverflow: document.documentElement.scrollWidth - innerWidth, idle: r.animation === null && !r.motion };
});
try {
  for (const scenario of ['idle-labels', 'focused-label', 'all-text', 'focused-all-text', 'focused-normal-motion', 'focused-expanded']) {
    const page = await browser.newPage({ viewport: { width: 320, height: 844 }, reducedMotion: scenario === 'focused-normal-motion' ? 'no-preference' : 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/PortraitScene.tsx*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('this.props = props;', 'this.props = props; window.__r3Runtime = this;') }); });
    await page.goto('http://127.0.0.1:5184/pattern-portrait.html');
    await page.waitForFunction(() => window.__r3Runtime?.ready);
    await page.getByRole('navigation', { name: 'Pattern chapters' }).getByRole('button').first().click();
    await page.getByRole('tab', { name: 'Tensions', exact: true }).click();
    await page.getByRole('combobox', { name: 'Compare with another chapter' }).selectOption('chapter-2');
    await page.getByRole('button', { name: 'View objects', exact: true }).click();
    if (scenario === 'focused-expanded') { await page.getByRole('button', {name: 'Expand scene', exact: true}).click(); await page.waitForFunction(() => window.__r3Runtime?.ready); }
    await page.waitForTimeout(700); await page.waitForFunction(() => window.__r3Runtime.animation === null && !window.__r3Runtime.motion);
    if (scenario.startsWith('focused-')) {
      await page.locator('.explorer-annotation').first().focus();
      if (!(await page.locator('.explorer-annotation').first().evaluate(el => el === document.activeElement))) throw new Error('Cannot focus initial annotation');
    }
    const before = await measure(page);
    await page.evaluate(scenario => {
      const selector = scenario.includes('all-text') || scenario === 'focused-normal-motion' ? '.portrait-explorer *' : '.explorer-labels [data-form-index], .explorer-labels [data-form-index] *';
      for (const el of document.querySelectorAll(selector)) if ([...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * 2}px`;
    }, scenario);
    await page.waitForTimeout(600); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await measure(page);
    if (after.labels.some(label => label.visible && label.overlaps.length)) throw new Error(`${scenario}: visible label overlaps an object`);
    if (JSON.stringify(before.camera) !== JSON.stringify(after.camera) || JSON.stringify(before.target) !== JSON.stringify(after.target)) throw new Error(`${scenario}: label resizing changed camera`);
    const focusReceipt = await page.evaluate(() => {
      const focus = document.activeElement, modeBar = document.querySelector('.explorer-mobile-modes'), dialog = document.querySelector('.explorer-expanded-dialog');
      return {native: focus.matches('.explorer-compared-chapters button'), chapter: focus.dataset.chapterId, rect: focus.getBoundingClientRect().toJSON(), modeBottom: modeBar?.getBoundingClientRect().bottom, dialog: dialog?.getBoundingClientRect().toJSON(), scrollMargin: getComputedStyle(focus).scrollMarginBlockStart};
    });
    if (scenario.startsWith('focused-') && (!focusReceipt.native || focusReceipt.chapter !== 'chapter-1')) throw new Error(`${scenario}: focus did not reach matching native source link`);
    if (scenario !== 'focused-expanded' && scenario.startsWith('focused-') && focusReceipt.rect.top < focusReceipt.modeBottom) throw new Error(`${scenario}: native focus is under sticky controls`);
    await page.screenshot({ path: `/tmp/portrait-r3/review-label-${scenario}.png` });
    await page.getByRole('navigation', { name: 'Compared chapters' }).getByRole('button').nth(1).click();
    await page.waitForTimeout(900);
    const sourceFocus = await page.evaluate(() => ({ text: document.activeElement.textContent, matchingChapter: document.activeElement.matches('.explorer-comparison > section:nth-child(2) .explorer-passage p') }));
    if (!sourceFocus.matchingChapter || !sourceFocus.text.startsWith('Being needed can feel close')) throw new Error(`${scenario}: source handoff wrong`);
    console.log(JSON.stringify({ scenario, focusReceipt, before, after, cameraUnchanged: JSON.stringify(before.camera) === JSON.stringify(after.camera) && JSON.stringify(before.target) === JSON.stringify(after.target), sourceFocus, errors }));
    await page.close();
  }
} finally { await browser.close(); }
