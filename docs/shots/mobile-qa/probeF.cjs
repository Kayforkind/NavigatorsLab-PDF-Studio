// probeF: clean inspector color-edit flow (scroll main to top first)
const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, proxy: PROXY });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 100)));
  await page.goto('https://navigatorslab.com/pdf-studio/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const demo = page.getByRole('button', { name: /demo document/ });
  await demo.waitFor({ state: 'visible', timeout: 20000 });
  await demo.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  const db = await demo.boundingBox();
  await page.touchscreen.tap(db.x + db.width / 2, db.y + db.height / 2);
  await page.locator('.sheet-inner').nth(3).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(4000);
  const s = await page.context().newCDPSession(page);

  async function ttap(x, y) {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function tdrag(x1, y1, x2, y2, steps = 14) {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1, id: 1 }] });
    for (let i = 1; i <= steps; i++) {
      await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps, id: 1 }] });
    }
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function tapBtnScroll(containerSel, title) {
    const loc = page.locator(containerSel + ' button[title="' + title + '"]').first();
    await loc.evaluate(e => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
    await page.waitForTimeout(400);
    const b = await loc.boundingBox();
    await ttap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(500);
  }
  const mainTop = () => page.evaluate(() => { document.querySelector('main.canvas-area').scrollTop = 0; });
  const anns = () => page.evaluate(() => { let n = 0; document.querySelectorAll('.sheet-overlay').forEach(sv => sv.querySelectorAll(':scope > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)').forEach(() => n++)); return n; });

  await mainTop(); await page.waitForTimeout(400);
  await tapBtnScroll('.tool-rail', 'Rectangle (R)');
  const sb = await page.locator('.sheet-inner').first().boundingBox();
  console.log('F. sheet box:', JSON.stringify({ x: Math.round(sb.x), y: Math.round(sb.y), w: Math.round(sb.width), h: Math.round(sb.height) }));
  const n0 = await anns();
  await tdrag(sb.x + sb.width * 0.2, sb.y + sb.height * 0.25, sb.x + sb.width * 0.55, sb.y + sb.height * 0.38, 12);
  await page.waitForTimeout(800);
  const n1 = await anns();
  console.log('F. rect drawn:', n0, '->', n1);
  await tapBtnScroll('.tool-rail', 'Select & move (V)');
  const ab = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.sheet-overlay > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)'));
    const el = els[els.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log('F. annotation center:', JSON.stringify(ab));
  if (ab) {
    await ttap(ab.x, ab.y);
    await page.waitForTimeout(1000);
    const selOutline = await page.evaluate(() => !!document.querySelector('.annot-selection, [class*="annot-select"]'));
    // open inspector via palette
    const pal = page.locator('.topbar button[title^="Colors, fonts"]');
    await pal.evaluate(e => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
    await page.waitForTimeout(400);
    const pb = await pal.boundingBox();
    await ttap(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.waitForTimeout(1000);
    const inspInfo = await page.evaluate(() => {
      const d = document.querySelector('.inspector');
      const r = d.getBoundingClientRect();
      return { disp: getComputedStyle(d).display, w: Math.round(r.width), colors: d.querySelectorAll('input[type="color"]').length,
        selText: (d.innerText || '').slice(0, 160).replace(/\s+/g, ' ') };
    });
    console.log('F. selOutline:', selOutline, '| inspector:', JSON.stringify(inspInfo));
    await page.screenshot({ path: '/tmp/p9-inspector-selected.png' });
    if (inspInfo.colors > 0 && /selected/i.test(inspInfo.selText) && !/nothing selected/i.test(inspInfo.selText)) {
      const shape = page.locator('.sheet-overlay > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)').last();
      const beforeFill = await shape.evaluate(el => el.getAttribute('fill') || el.getAttribute('stroke') || el.style.fill);
      const ci = page.locator('.inspector input[type="color"]').first();
      await ci.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await ci.evaluate(el => { el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.waitForTimeout(700);
      const afterFill = await shape.evaluate(el => el.getAttribute('fill') || el.getAttribute('stroke') || el.style.fill);
      console.log('F. COLOR EDIT:', beforeFill, '->', afterFill, afterFill !== beforeFill ? 'CHANGED' : 'NOT CHANGED');
      await page.screenshot({ path: '/tmp/p9-inspector-recolored.png' });
    } else {
      console.log('F. inspector does not show selection properties; skipping color edit');
    }
  }
  console.log('F. pageerrors:', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
