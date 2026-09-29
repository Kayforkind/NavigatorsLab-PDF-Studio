const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /demo document/ }).click();
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(10000);
    const info = await page.evaluate(() => ({
      textLayerSpans: document.querySelectorAll('.textLayer span, .textLayer div').length,
      textLayerClass: document.querySelectorAll('[class*="textLayer"]').length,
      canvases: document.querySelectorAll('canvas').length,
      pageDivs: document.querySelectorAll('.page').length,
    })).catch(() => ({ crashed: true }));
    console.log(`t=${(i + 1) * 10}s`, JSON.stringify(info));
    if (info.textLayerSpans > 15 || info.crashed) break;
  }
  await page.screenshot({ path: '/home/hatch/workspace/pdfstudio/docs/shots/capture/dbg-state.png' });
  await browser.close().catch(() => {});
})().catch(e => console.error('FATAL:', e.message));
