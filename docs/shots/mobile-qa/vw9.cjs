const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  for (const [w, h] of [[390,844],[768,1024]]) {
    const ctx = await browser.newContext({ viewport: {width:w,height:h}, isMobile: true, hasTouch: true, proxy: PROXY });
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
      const tb = document.querySelector('.topbar');
      return {
        tbOverflowX: getComputedStyle(tb).overflowX,
        tbClientW: tb.clientWidth, tbScrollW: tb.scrollWidth,
        docSW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        railBottom: !!document.querySelector('.tool-rail') && getComputedStyle(document.querySelector('.tool-rail')).position === 'fixed',
        leftRail: !!document.querySelector('.tool-rail-vertical, aside.tool-rail, .rail-left'),
        topbarTitles: Array.from(document.querySelectorAll('.topbar button[title]')).map(x => x.getAttribute('title')).slice(0, 20),
      };
    });
    console.log('=== ' + w + 'x' + h + ' ===');
    console.log(JSON.stringify(m, null, 1));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
