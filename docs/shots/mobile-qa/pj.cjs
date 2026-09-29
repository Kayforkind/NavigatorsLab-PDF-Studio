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
  const nav = await p.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[aria-label]')).filter(e => /page/i.test(e.getAttribute('aria-label')));
    return els.map(e => ({ tag: e.tagName, label: e.getAttribute('aria-label'), text: (e.innerText||'').slice(0,20), cls: String(e.className).slice(0,40) }));
  });
  console.log('page-nav elements:', JSON.stringify(nav, null, 1));
  // thumb strip?
  const thumbs = await p.evaluate(() => ({ n: document.querySelectorAll('.thumb, .thumbnail, [class*="thumb"]').length }));
  console.log('thumbs:', JSON.stringify(thumbs));
  // try tapping the first page-nav control and see if scroll changes
  if (nav.length) {
    const el = p.locator('[aria-label="' + nav[0].label + '"]').first();
    const b = await el.boundingBox();
    console.log('first nav at:', JSON.stringify({x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width)}));
    const s0 = await p.evaluate(() => document.querySelector('main.canvas-area').scrollTop);
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x+b.width/2, y: b.y+b.height/2, id: 1 }] });
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(1300);
    const s1 = await p.evaluate(() => document.querySelector('main.canvas-area').scrollTop);
    console.log('nav tap scrollTop:', Math.round(s0), '->', Math.round(s1));
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
