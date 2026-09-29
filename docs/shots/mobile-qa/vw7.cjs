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
  const m = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('*').forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.width >= 1185 && r.width <= 1200) {
        out.push(e.tagName + '.' + String(e.className).slice(0,60) + ' w=' + Math.round(r.width) + ' x=' + Math.round(r.x));
      }
    });
    return { wide: out.slice(0,10), n: out.length,
      appSW: document.querySelector('div.app') ? document.querySelector('div.app').scrollWidth : -1,
      topbarSW: document.querySelector('.topbar') ? document.querySelector('.topbar').scrollWidth : -1,
      mainSW: document.querySelector('main') ? document.querySelector('main').scrollWidth : -1 };
  });
  console.log(JSON.stringify(m, null, 1));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
