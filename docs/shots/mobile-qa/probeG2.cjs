const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: {width:390,height:844}, isMobile: true, hasTouch: true, proxy: PROXY });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0,100)));
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

  // page-jump
  const pj = await p.evaluate(() => {
    const el = document.querySelector('.page-jump');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const btns = Array.from(el.querySelectorAll('button')).map(b => b.textContent.trim().slice(0,12));
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText||'').slice(0,40).replace(/\n/g,' '), btns };
  });
  console.log('PJ:', JSON.stringify(pj));
  if (pj && pj.btns.length) {
    const nb = p.locator('.page-jump button').last();
    const b = await nb.boundingBox();
    const s0 = await p.evaluate(() => document.querySelector('main.canvas-area').scrollTop);
    await ttap(b.x + b.width/2, b.y + b.height/2);
    await p.waitForTimeout(1300);
    const s1 = await p.evaluate(() => document.querySelector('main.canvas-area').scrollTop);
    console.log('PJ tap: scrollTop', Math.round(s0), '->', Math.round(s1), s1 > s0 + 50 ? 'PAGE CHANGED ✓' : 'no change?');
  }

  // pinch zoom (two-finger spread via CDP)
  const zOf = () => p.evaluate(() => { const m = document.body.innerHTML.match(/>(\d{2,3})%</); return m ? m[1] : '?'; });
  const z0 = await zOf();
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 155, y: 400, id: 1 }, { x: 235, y: 400, id: 2 }] });
  for (let i=1;i<=10;i++){ await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 155-i*9, y: 400, id: 1 }, { x: 235+i*9, y: 400, id: 2 }] }); }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(1100);
  const z1 = await zOf();
  console.log('PINCH spread: zoom', z0 + '%', '->', z1 + '%', z0 !== z1 ? 'ZOOM CHANGED ✓' : '(no change; no crash, errs=' + errs.length + ')');

  // open/merge file choosers
  for (const t of ['Open PDF (Ctrl+O)', 'Merge another PDF after the current page']) {
    const loc = p.locator('.topbar button[title="' + t + '"]');
    await loc.evaluate(e => e.scrollIntoView({inline:'center',block:'nearest'}));
    await p.waitForTimeout(350);
    const b = await loc.boundingBox();
    try {
      const [fc] = await Promise.all([
        p.waitForEvent('filechooser', { timeout: 6000 }),
        ttap(b.x + b.width/2, b.y + b.height/2),
      ]);
      const acc = await fc.elementHandle().then(h => h.evaluate(e => e.getAttribute('accept')));
      console.log('CHOOSER [' + t.slice(0,20) + ']: OPENED ✓ accept=' + acc);
    } catch(e) { console.log('CHOOSER [' + t.slice(0,20) + ']: none (' + e.message.split('\n')[0].slice(0,60) + ')'); }
  }

  // edit text tool
  const et = p.locator('.tool-rail button[title="Edit text (E)"]');
  if (await et.count()) {
    await et.evaluate(e => e.scrollIntoView({inline:'center',block:'nearest'})); await p.waitForTimeout(400);
    const b = await et.boundingBox(); await ttap(b.x+b.width/2, b.y+b.height/2); await p.waitForTimeout(600);
    const cls = await et.evaluate(el => el.className);
    console.log('EDIT-TEXT active:', /active/.test(cls));
  } else console.log('EDIT-TEXT: button not found');

  console.log('pageerrors:', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
