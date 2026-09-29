const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };
(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const ctx = await b.newContext({ viewport: {width:390,height:844}, isMobile: true, hasTouch: true, proxy: PROXY });
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
  async function ttap(x, y) {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const rb = p.locator('.tool-rail button[title="Rectangle (R)"]');
  await rb.evaluate(e => e.scrollIntoView({inline:'center',block:'nearest'})); await p.waitForTimeout(400);
  const rbb = await rb.boundingBox(); await ttap(rbb.x+rbb.width/2, rbb.y+rbb.height/2); await p.waitForTimeout(500);
  const sb = await p.locator('.sheet-inner').first().boundingBox();
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sb.x+sb.width*0.2, y: sb.y+sb.height*0.25, id: 1 }] });
  for (let i=1;i<=12;i++){ await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sb.x+sb.width*0.2+(sb.width*0.35)*i/12, y: sb.y+sb.height*0.25+(sb.height*0.13)*i/12, id: 1 }] }); }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(800);
  const dom = await p.evaluate(() => {
    const sv = document.querySelector('.sheet-overlay');
    return sv ? sv.innerHTML.slice(0, 1200) : 'no-overlay';
  });
  console.log('OVERLAY DOM:', dom);
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
