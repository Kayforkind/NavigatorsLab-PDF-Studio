const { chromium } = require('playwright-core');

const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const OUT = '/home/hatch/workspace/pdfstudio/docs/shots/';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /demo document/ }).click();
  // wait for thumbnails to actually render (non-blank canvases)
  await page.waitForFunction(() => {
    const cs = Array.from(document.querySelectorAll('canvas'));
    return cs.length > 3;
  }, { timeout: 30000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: OUT + '01-hero.png' });

  // Edit hints view
  await page.keyboard.press('e');
  await page.waitForSelector('rect.hit-hint', { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + '02-edit-hints.png' });

  await browser.close();
  console.log('STAGE1 DONE');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
