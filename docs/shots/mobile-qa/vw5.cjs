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
  // open export dialog via JS click (no CDP needed)
  await p.evaluate(() => { document.querySelector('.topbar button[title="Export options & document properties"]').scrollIntoView({inline:'center'}); });
  await p.waitForTimeout(300);
  await p.locator('.topbar button[title="Export options & document properties"]').click({ timeout: 8000 });
  await p.waitForTimeout(1000);
  const m = await p.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const cs = d ? getComputedStyle(d) : null;
    const r = d ? d.getBoundingClientRect() : null;
    // find what's 1192 wide: check scrollWidth contributors
    const wide = [];
    document.querySelectorAll('body > *').forEach(e => {
      const sw = e.scrollWidth;
      if (sw > 800) wide.push(e.tagName + '.' + String(e.className).slice(0, 40) + ' scrollW=' + sw + ' clientW=' + e.clientWidth);
    });
    return {
      dlg: d ? { pos: cs.position, left: cs.left, transform: cs.transform.slice(0, 40), margin: cs.marginLeft, x: Math.round(r.x), w: Math.round(r.width) } : null,
      bodyChildren: wide.slice(0, 8),
      innerW: window.innerWidth,
    };
  });
  console.log(JSON.stringify(m, null, 1));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
