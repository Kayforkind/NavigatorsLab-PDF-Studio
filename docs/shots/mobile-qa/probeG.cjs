// probeG: dialog scope at 768x1024, page-jump behavior, pinch zoom, open/merge choosers, edit-text tool
const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };

async function loadDoc(page) {
  await page.goto('https://navigatorslab.com/pdf-studio/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const demo = page.getByRole('button', { name: /demo document/ });
  await demo.waitFor({ state: 'visible', timeout: 20000 });
  await demo.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  const b = await demo.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.locator('.sheet-inner').nth(3).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(4000);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // G1. 768x1024: all dialogs geometry
  {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, proxy: PROXY });
    const p = await ctx.newPage();
    await loadDoc(p);
    const s = await p.context().newCDPSession(p);
    async function openDlg(title) {
      const loc = p.locator(`.topbar button[title="${title}"]`);
      await loc.evaluate(e => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
      await p.waitForTimeout(400);
      const b = await loc.boundingBox();
      await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }] });
      await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(1100);
      const g = await p.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        if (!d) return 'no-dialog';
        const r = d.getBoundingClientRect();
        return { x: Math.round(r.x), w: Math.round(r.width), vw: window.innerWidth, fits: r.x >= 0 && r.x + r.width <= window.innerWidth + 1 };
      });
      console.log('G1. 768x1024 dialog [' + title + ']:', JSON.stringify(g));
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    }
    await openDlg('Export options & document properties');
    await openDlg('Forms');
    await openDlg('Compare documents');
    await openDlg('AI assistant');
    await openDlg('Help & shortcuts');
    await ctx.close();
  }

  // G2. 390x844: page-jump changes page, pinch zoom changes zoom, open/merge choosers, edit-text
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, proxy: PROXY });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 100)));
    await loadDoc(p);
    const s = await p.context().newCDPSession(p);
    // page jump
    const pg = await p.evaluate(() => !!document.querySelector('.page-jump'));
    console.log('G2. page-jump present:', pg);
    if (pg) {
      const info = await p.evaluate(() => {
        const el = document.querySelector('.page-jump');
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), text: (el.innerText || '').slice(0, 60) };
      });
      console.log('G2. page-jump:', JSON.stringify(info));
      const before = await p.evaluate(() => document.querySelector('main.canvas-area').scrollTop);
      // tap the "next page" part if it has buttons, else tap right side
      const btns = await p.evaluate(() => Array.from(document.querySelectorAll('.page-jump button')).map(x => x.textContent.trim().slice(0, 10)));
      console.log('G2. page-jump buttons:', JSON.stringify(btns));
      if (btns.length) {
        const nb = p.locator('.page-jump button').last();
        const nb2 = await nb.boundingBox();
        await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: nb2.x + nb2.width / 2, y: nb2.y + nb2.height / 2, id: 1 }] });
        await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await p.waitForTimeout(1200);
        const after = await p.evaluate(() => document.querySelector('main.canvas-area').scrollTop);
        console.log('G2. page-jump tap scrollTop:', Math.round(before), '->', Math.round(after), after > before + 50 ? 'CHANGED PAGE ✓' : 'no change');
      }
    }
    // pinch zoom: measure zoom % before/after
    const zoomText = () => p.evaluate(() => (document.querySelector('.zoom-pct, .zoom-label, [class*="zoom"]') || {}).innerText || document.body.innerHTML.slice(0, 0));
    const zBefore = await p.evaluate(() => { const m = document.body.innerHTML.match(/(\d{2,3})%/); return m ? m[1] : '?'; });
    // CDP has no pinch; use touchscreen.tap? Use two-finger via dispatchTouchEvent with two touchPoints
    const cx = 195, cy = 400;
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
    for (let i = 1; i <= 10; i++) {
      await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 40 - i * 8, y: cy, id: 1 }, { x: cx + 40 + i * 8, y: cy, id: 2 }] });
    }
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(1000);
    const zAfter = await p.evaluate(() => { const m = document.body.innerHTML.match(/(\d{2,3})%/); return m ? m[1] : '?'; });
    console.log('G2. pinch-out zoom:', zBefore + '%', '->', zAfter + '%', zBefore !== zAfter ? 'ZOOM CHANGED' : 'no change/crash=' + errs.length);
    // open/merge file choosers
    for (const t of ['Open a PDF file', 'Merge PDFs']) {
      const loc = p.locator(`.topbar button[title="${t}"]`);
      const n = await loc.count();
      if (!n) { console.log('G2. [' + t + ']: button not found'); continue; }
      await loc.evaluate(e => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
      await p.waitForTimeout(300);
      try {
        const [fc] = await Promise.all([
          p.waitForEvent('filechooser', { timeout: 6000 }),
          (async () => { const b = await loc.boundingBox(); await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }] }); await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); })()
        ]);
        console.log('G2. [' + t + ']: file chooser OPENED ✓ accept=' + (await fc.elementHandle().then(h => h.evaluate(e => e.accept))));
      } catch (e) { console.log('G2. [' + t + ']: NO file chooser (' + e.message.split('\n')[0] + ')'); }
    }
    // edit text tool
    const et = p.locator('.tool-rail button[title="Edit text (E)"]');
    const etn = await et.count();
    console.log('G2. edit-text button count:', etn);
    if (etn) {
      await et.evaluate(e => e.scrollIntoView({ inline: 'center', block: 'nearest' })); await p.waitForTimeout(400);
      const ebb = await et.boundingBox();
      await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ebb.x + ebb.width / 2, y: ebb.y + ebb.height / 2, id: 1 }] });
      await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(600);
      const cls = await et.evaluate(el => el.className);
      console.log('G2. edit-text active:', /active/.test(cls));
    }
    console.log('G2. pageerrors:', JSON.stringify(errs));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
