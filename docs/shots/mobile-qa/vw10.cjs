const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: {width:768,height:1024}, isMobile: true, hasTouch: true, proxy: PROXY });
  const p = await ctx.newPage();
  await p.goto('https://navigatorslab.com/pdf-studio/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  const demo = p.getByRole('button', { name: /demo document/ });
  await demo.waitFor({ state: 'visible', timeout: 20000 });
  await demo.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  const db = await demo.boundingBox();
  await p.touchscreen.tap(db.x + db.width/2, db.y + db.height/2);
  await p.locator('.sheet-inner').nth(3).waitFor({ state: 'visible', timeout: 60000 });
  await p.waitForTimeout(4000);
  for (const t of ['Export options & document properties', 'Detect and fill PDF form fields (AcroForm)', 'Compare the text of two PDFs side by side', 'Private on-device AI (ask / summarize this document)', 'Help']) {
    await p.evaluate((tt) => { document.querySelector('.topbar button[title="' + tt + '"]').click(); }, t);
    await p.waitForTimeout(1100);
    const g = await p.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return 'no-dialog';
      const r = d.getBoundingClientRect();
      const cls = d.className;
      return { cls, x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.x + r.width), over: Math.round(r.x + r.width) > 768 || Math.round(r.x) < 0 ? 'OVERFLOWS' : 'fits' };
    });
    console.log(t.slice(0, 30), JSON.stringify(g));
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
