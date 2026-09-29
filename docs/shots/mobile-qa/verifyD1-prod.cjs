// D1 fix verification: topbar must not overflow the page; .modal-wide dialogs
// must render fully inside the visual viewport at 768x1024 and 844x390.
const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const URL = 'https://navigatorslab.com/pdf-studio/';

async function loadDoc(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const demo = page.getByRole('button', { name: /demo document/ });
  await demo.waitFor({ state: 'visible', timeout: 30000 });
  await demo.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  const b = await demo.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.locator('.sheet-inner').nth(3).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
}

async function tapBtn(page, s, title) {
  const loc = page.locator('.topbar button[title="' + title + '"]').first();
  await loc.evaluate(e => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
  await page.waitForTimeout(300);
  const b = await loc.boundingBox();
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }] });
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = {};
  for (const [w, h] of [[768, 1024], [844, 390]]) {
    const ctx = await browser.newContext({ proxy: { server: 'http://127.0.0.1:18080' }, viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 80)));
    await loadDoc(page);
    const s = await page.context().newCDPSession(page);
    const metrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      topbarScrollW: document.querySelector('.topbar').scrollWidth,
      topbarClientW: document.querySelector('.topbar').clientWidth,
      topbarOverflowX: getComputedStyle(document.querySelector('.topbar')).overflowX,
    }));
    // Export dialog
    await tapBtn(page, s, 'Export options & document properties');
    const dlg = await page.evaluate(() => {
      const m = document.querySelector('.modal-wide');
      if (!m) return null;
      const r = m.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right), vw: window.innerWidth };
    });
    await page.screenshot({ path: `d1fix-export-${w}x${h}.png` });
    // close + open Forms dialog as a second sample
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await tapBtn(page, s, 'Detect and fill PDF form fields (AcroForm)');
    const dlg2 = await page.evaluate(() => {
      const m = document.querySelector('.modal-wide');
      if (!m) return null;
      const r = m.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right), vw: window.innerWidth };
    });
    await page.screenshot({ path: `d1fix-forms-${w}x${h}.png` });
    out[`${w}x${h}`] = { metrics, exportDlg: dlg, formsDlg: dlg2, pageErrors: errs };
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 1));
})();
