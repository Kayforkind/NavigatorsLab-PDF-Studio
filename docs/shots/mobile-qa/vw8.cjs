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
  await p.evaluate(() => { document.querySelector('.topbar button[title="Export options & document properties"]').click(); });
  await p.waitForTimeout(1200);
  const m = await p.evaluate(() => {
    const bd = document.querySelector('.modal-backdrop');
    const bdr = bd.getBoundingClientRect();
    const bcs = getComputedStyle(bd);
    const tb = document.querySelector('.topbar');
    const tcs = getComputedStyle(tb);
    const tr = tb.getBoundingClientRect();
    // topbar inner scroller?
    const inner = tb.querySelector('.topbar-scroll, .tb-scroll, .topbar-inner');
    return {
      backdrop: { pos: bcs.position, left: bcs.left, right: bcs.right, w: bcs.width, x: Math.round(bdr.x), bw: Math.round(bdr.width) },
      topbar: { overflowX: tcs.overflowX, clientW: tb.clientWidth, scrollW: tb.scrollWidth, x: Math.round(tr.x), w: Math.round(tr.width) },
      topbarInner: inner ? { cls: inner.className, overflowX: getComputedStyle(inner).overflowX, clientW: inner.clientWidth, scrollW: inner.scrollWidth } : 'none found',
      // is there horizontal page scroll? check documentElement
      docSW: document.documentElement.scrollWidth, docCW: document.documentElement.clientWidth,
    };
  });
  console.log(JSON.stringify(m, null, 1));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
