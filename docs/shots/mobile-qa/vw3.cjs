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
  const m = await p.evaluate(() => ({
    innerW: window.innerWidth, innerH: window.innerHeight,
    vvW: window.visualViewport ? Math.round(window.visualViewport.width) : -1,
    vvScale: window.visualViewport ? window.visualViewport.scale : -1,
    docElClientW: document.documentElement.clientWidth,
    docElSW: document.documentElement.scrollWidth,
    bodySW: document.body.scrollWidth,
    devicePixelRatio: window.devicePixelRatio,
    // any element wider than 768?
    wide: Array.from(document.querySelectorAll('*')).filter(e => e.getBoundingClientRect().width > 769 && e.getBoundingClientRect().width < 2000).slice(0,5).map(e => e.tagName + '.' + String(e.className).slice(0,40) + ' w=' + Math.round(e.getBoundingClientRect().width)),
  }));
  console.log(JSON.stringify(m, null, 1));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
