import { chromium } from '/home/henry/core-ai-wcus/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const files = ['PortraitExplorer.tsx', 'explorer.css'];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(`/home/henry/patternlike-app/apps/web/src/components/portrait-explorer/${file}`)).digest('hex')]));
const start = hashes();
const browser = await chromium.launch({ executablePath: '/home/henry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const capture = page => page.evaluate(() => {
  const reader = document.querySelector('.explorer-reader');
  const focused = document.activeElement;
  return { y: scrollY, readerTop: reader.scrollTop, readerRect: reader.getBoundingClientRect().toJSON(),
    focus: focused.getAttribute('aria-label') ?? focused.textContent, focusRect: focused.getBoundingClientRect().toJSON(),
    active: reader.querySelector('.explorer-passage[data-active="true"] p')?.textContent,
    facet: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    root: document.querySelector('.portrait-explorer').className,
  };
});
try {
  for (const reducedMotion of ['reduce', 'no-preference']) for (const width of [1440, 390]) {
    const height = width === 1440 ? 900 : 844;
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5184/pattern-portrait.html');
    await page.waitForFunction(() => document.querySelector('button[aria-label="Rotate left"]')?.disabled === false);
    const chapters = page.getByRole('navigation', { name: 'Pattern chapters' });
    await chapters.getByRole('button').first().click();
    await page.getByRole('button', { name: 'Show passage 2 in portrait', exact: true }).click();
    if (width === 390) await page.getByRole('button', { name: 'Read chapter', exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    const choice = page.getByRole('combobox', { name: 'Compare with another chapter' });
    if (width === 390) await choice.scrollIntoViewIfNeeded(); else {
      const box = await page.locator('.explorer-reader').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -100); await page.waitForTimeout(120); await page.mouse.wheel(0, 500);
    }
    await choice.focus(); await page.waitForTimeout(400); const origin = await capture(page);
    await choice.selectOption('chapter-2');
    await page.getByRole('tab', { name: 'Resources', exact: true }).click();
    await page.locator('.explorer-compared-chapters button').nth(1).click();
    await page.getByRole('button', { name: 'End comparison', exact: true }).focus();
    await page.waitForTimeout(600); await page.goBack();
    await page.waitForFunction(() => !document.querySelector('.portrait-explorer').classList.contains('explorer-comparing'));
    await page.waitForTimeout(400); const returned = await capture(page);
    if (Math.abs(origin.y - returned.y) > 1 || Math.abs(origin.readerTop - returned.readerTop) > 1 || origin.active !== returned.active || returned.facet !== 'Overview' || returned.focus !== 'Compare with another chapter') throw new Error(`Origin restoration failed ${width}/${reducedMotion}: ${JSON.stringify({origin, returned})}`);
    const receipt = { width, height, reducedMotion, origin, returned, errors };
    if (width === 1440) {
      await chapters.getByRole('button').nth(3).click();
      await page.locator('.explorer-next-chapter').click();
      await page.waitForTimeout(400); receipt.nextChapter = await capture(page);
      if (receipt.nextChapter.readerTop !== 0 || receipt.nextChapter.focus !== 'Finding your own direction' || receipt.nextChapter.focusRect.top < 0) throw new Error(`Next chapter focus failed: ${JSON.stringify(receipt.nextChapter)}`);
      await page.getByRole('button', { name: 'Show passage 2 in portrait', exact: true }).click();
      await page.getByRole('button', { name: 'Expand scene', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Expanded portrait scene' });
      await page.waitForFunction(() => document.querySelector('dialog button[aria-label="Rotate left"]')?.disabled === false);
      await page.waitForTimeout(600);
      await dialog.getByRole('button', { name: 'Overview: show source passage 2 for Finding your own direction', exact: true }).click();
      await dialog.waitFor({ state: 'detached' }); await page.waitForTimeout(500);
      receipt.expandedPassage = await capture(page);
      const result = receipt.expandedPassage;
      if (result.focus !== result.active || result.focusRect.bottom <= Math.max(0, result.readerRect.top) || result.focusRect.top >= Math.min(height, result.readerRect.bottom)) throw new Error(`Expanded passage handoff failed: ${JSON.stringify(result)}`);
    }
    console.log(JSON.stringify(receipt));
    await page.close();
  }
  const end = hashes();
  if (JSON.stringify(start) !== JSON.stringify(end)) throw new Error(`Controller/CSS changed during verification: ${JSON.stringify({start,end})}`);
  console.log(JSON.stringify({ status: 'PASS', sourceHashes: end }));
} finally { await browser.close(); }
