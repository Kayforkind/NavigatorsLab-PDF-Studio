const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  for (const [w, h] of [[390,844],[768,1024],[844,390],[414,896],[360,740]]) {
    const ctx = await browser.newContext({ viewport: {width:w,height:h}, isMobile: true, hasTouch: true, proxy: PROXY });
    const p = await ctx.newPage();
    await p.goto('https://navigatorslab.com/pdf-studio/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(2500);
    const m = await p.evaluate(() => ({
      innerW: window.innerWidth,
      docElW: document.documentElement.clientWidth,
      bodySW: document.body.scrollWidth,
      htmlMinW: getComputedStyle(document.documentElement).minWidth,
      bodyMinW: getComputedStyle(document.body).minWidth,
    }));
    console.log(w + 'x' + h, JSON.stringify(m));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
