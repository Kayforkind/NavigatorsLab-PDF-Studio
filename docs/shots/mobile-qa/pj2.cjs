const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: {width:390,height:844}, isMobile: true, hasTouch: true, proxy: PROXY });
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
  const s = await p.context().newCDPSession(p);
  const info = await p.evaluate(() => {
    const el = document.querySelector('.thumb-strip');
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // find toggle button for pages panel
    const toggles = Array.from(document.querySelectorAll('button')).filter(b => /page|thumb/i.test(b.title || b.getAttribute('aria-label') || ''));
    return {
      disp: cs.display, vis: cs.visibility, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      transform: cs.transform.slice(0,40),
      toggles: toggles.map(b => b.title || b.getAttribute('aria-label')),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await p.screenshot({ path: '/tmp/pj2.png' });
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
