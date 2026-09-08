import { chromium } from '/home/henry/core-ai-wcus/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/home/henry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const measure = page => page.evaluate(() => {
  const reader = document.querySelector('.explorer-reader');
  const choice = document.querySelector('[aria-label="Compare with another chapter"]');
  return {
    y: scrollY,
    readerTop: reader.scrollTop,
    readerHeight: reader.clientHeight,
    readerScrollHeight: reader.scrollHeight,
    readerWidth: reader.clientWidth,
    passageFont: getComputedStyle(reader.querySelector(".explorer-passage p")).font,
    passageWidth: reader.querySelector(".explorer-passage p").getBoundingClientRect().width,
    focus: document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent,
    choiceBox: choice?.getBoundingClientRect().toJSON(),
  };
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.__r3ScrollReview = [];
    window.__r3ScrollPhase = 'load';
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', {
      ...descriptor,
      set(value) {
        const tracked = this.matches('.explorer-reader');
        const before = tracked ? descriptor.get.call(this) : null;
        descriptor.set.call(this, value);
        if (tracked) window.__r3ScrollReview.push({
          phase: window.__r3ScrollPhase,
          requested: value,
          before,
          after: descriptor.get.call(this),
          height: this.clientHeight,
          scrollHeight: this.scrollHeight,
          width: this.clientWidth,
          passageFont: getComputedStyle(this.querySelector('.explorer-passage p') ?? this).font,
          passageWidth: this.querySelector(".explorer-passage p")?.getBoundingClientRect().width,
          workspaceClass: this.closest(".explorer-workspace")?.className,
          passagesClass: this.querySelector(".explorer-passages")?.className,
          root: document.querySelector('.portrait-explorer')?.className,
        });
      },
    });
  });
  await page.goto('http://127.0.0.1:5184/pattern-portrait.html');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Rotate left"]')?.disabled === false);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('navigation', { name: 'Pattern chapters' }).getByRole('button').first().click();
  await page.waitForTimeout(300);
  const reader = await page.locator('.explorer-reader').boundingBox();
  await page.mouse.move(reader.x + reader.width / 2, reader.y + reader.height / 2);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(500);
  const before = await measure(page);
  await page.evaluate(() => { window.__r3ScrollPhase = 'compare'; });
  await page.getByRole('combobox', { name: 'Compare with another chapter' }).selectOption('chapter-2');
  await page.getByRole('tab', { name: 'Resources', exact: true }).click();
  await page.getByRole('button', { name: 'End comparison', exact: true }).focus();
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__r3ScrollPhase = 'return'; });
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.portrait-explorer')?.classList.contains('explorer-comparing'));
  await page.waitForTimeout(500);
  const returned = await measure(page);
  console.log(JSON.stringify({ before, returned, assignments: await page.evaluate(() => window.__r3ScrollReview) }, null, 2));
} finally {
  await browser.close();
}
