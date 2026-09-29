const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };
(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const ctx = await b.newContext({ viewport: {width:390,height:844}, isMobile: true, hasTouch: true, proxy: PROXY });
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
  const rb = p.locator('.tool-rail button[title="Rectangle (R)"]');
  await rb.evaluate(e => e.scrollIntoView({inline:'center',block:'nearest'})); await p.waitForTimeout(400);
  const rbb = await rb.boundingBox(); await ttap(rbb.x+rbb.width/2, rbb.y+rbb.height/2); await p.waitForTimeout(500);
  const sb = await p.locator('.sheet-inner').first().boundingBox();
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sb.x+sb.width*0.2, y: sb.y+sb.height*0.25, id: 1 }] });
  for (let i=1;i<=12;i++){ await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sb.x+sb.width*0.2+(sb.width*0.35)*i/12, y: sb.y+sb.height*0.25+(sb.height*0.13)*i/12, id: 1 }] }); }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(800);
  const sel = p.locator('.tool-rail button[title="Select & move (V)"]');
  await sel.evaluate(e => e.scrollIntoView({inline:'center',block:'nearest'})); await p.waitForTimeout(400);
  const sbb = await sel.boundingBox(); await ttap(sbb.x+sbb.width/2, sbb.y+sbb.height/2); await p.waitForTimeout(500);
  const ab = await p.evaluate(() => { const els = Array.from(document.querySelectorAll('.sheet-overlay > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)')); const el = els[els.length-1]; const r = el.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 }; });
  await ttap(ab.x, ab.y); await p.waitForTimeout(1000);
  const pal = p.locator('.topbar button[title^="Colors, fonts"]');
  await pal.evaluate(e => e.scrollIntoView({inline:'center',block:'nearest'})); await p.waitForTimeout(400);
  const pbb = await pal.boundingBox(); await ttap(pbb.x+pbb.width/2, pbb.y+pbb.height/2); await p.waitForTimeout(1000);
  const shape = p.locator('.sheet-overlay > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)').last();
  const before = await shape.evaluate(el => JSON.stringify({stroke: el.getAttribute('stroke'), fill: el.getAttribute('fill'), style: (el.getAttribute('style')||'').slice(0,80)}));
  console.log('before:', before);
  // tap the RED swatch (rgb(255, 92, 92)) via genuine touch
  const red = await p.evaluate(() => { const bs = Array.from(document.querySelectorAll('.inspector button')); const t = bs.find(x => (x.style.background||'').includes('255, 92, 92')); if(!t) return null; const q = t.getBoundingClientRect(); return {x: q.x+q.width/2, y: q.y+q.height/2}; });
  console.log('red swatch at:', JSON.stringify(red));
  await ttap(red.x, red.y); await p.waitForTimeout(900);
  const after = await shape.evaluate(el => JSON.stringify({stroke: el.getAttribute('stroke'), fill: el.getAttribute('fill'), style: (el.getAttribute('style')||'').slice(0,80)}));
  console.log('after:', after);
  console.log('COLOR EDIT:', before !== after ? 'CHANGED ✓' : 'NOT CHANGED ✗');
  await p.screenshot({ path: '/tmp/p11-recolored.png' });
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
