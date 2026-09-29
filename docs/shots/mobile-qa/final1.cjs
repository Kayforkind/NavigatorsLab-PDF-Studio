const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: {width:390,height:844}, isMobile: true, hasTouch: true, proxy: PROXY });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0,100)));
  const cerrs = []; p.on('console', m => { if (m.type() === 'error') cerrs.push(m.text().slice(0,90)); });
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

  // file choosers (clean)
  for (const t of ['Open PDF (Ctrl+O)', 'Merge another PDF after the current page']) {
    const loc = p.locator('.topbar button[title="' + t + '"]');
    await loc.evaluate(e => e.scrollIntoView({inline:'center',block:'nearest'}));
    await p.waitForTimeout(350);
    const b = await loc.boundingBox();
    try {
      await Promise.all([
        p.waitForEvent('filechooser', { timeout: 6000 }),
        (async () => {
          await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x+b.width/2, y: b.y+b.height/2, id: 1 }] });
          await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        })(),
      ]);
      console.log('CHOOSER [' + t.slice(0,24) + ']: file picker opened via touch ✓');
    } catch(e) { console.log('CHOOSER [' + t.slice(0,24) + ']: FAILED'); }
  }
  // zoom buttons change zoom
  const zOf = () => p.evaluate(() => { const m = document.body.innerHTML.match(/>(\d{2,3})%</); return m ? m[1] : '?'; });
  const zin = p.locator('.topbar button[title="Zoom in"]');
  await zin.evaluate(e => e.scrollIntoView({inline:'center',block:'nearest'})); await p.waitForTimeout(300);
  const zb = await zin.boundingBox();
  const z0 = await zOf();
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: zb.x+zb.width/2, y: zb.y+zb.height/2, id: 1 }] });
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(900);
  console.log('ZOOM-IN button: ' + z0 + '% -> ' + await zOf() + '%');
  // inputs audit
  const inputs = await p.evaluate(() => Array.from(document.querySelectorAll('input, textarea, select')).filter(e => e.getBoundingClientRect().width > 0).map(e => ({ tag: e.tagName, type: e.type || '', fs: parseFloat(getComputedStyle(e).fontSize) })));
  const small = inputs.filter(i => i.fs < 16);
  console.log('INPUTS: ' + inputs.length + ' visible, below 16px: ' + small.length, JSON.stringify(small.slice(0,5)));
  console.log('pageerrors:', JSON.stringify(errs));
  console.log('console errors:', JSON.stringify([...new Set(cerrs)].slice(0,6)));
  await p.screenshot({ path: '/tmp/final-mobile.png' });
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
