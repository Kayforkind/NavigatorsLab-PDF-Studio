// probeE: real scroller + pan retest + full inspector color-edit flow
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, proxy: PROXY });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 100)));
  await loadDoc(page);
  const s = await page.context().newCDPSession(page);

  // find the real scroller
  const scroller = await page.evaluate(() => {
    const cands = [];
    document.querySelectorAll('*').forEach(el => {
      if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
        cands.push(el.tagName + '.' + String(el.className).slice(0, 50) + ' sh=' + el.scrollHeight + ' ch=' + el.clientHeight);
      }
    });
    return cands.slice(0, 8);
  });
  console.log('E0. scroller candidates:', JSON.stringify(scroller, null, 1));

  async function ttap(x, y) {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function tdrag(x1, y1, x2, y2, steps = 16) {
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
  const isActive = (title) => page.evaluate((t) => {
    const b = Array.from(document.querySelectorAll('.tool-rail button')).find(x => x.getAttribute('title') === t);
    return b ? /active/.test(b.className) : false;
  }, title);
  const getScroll = () => page.evaluate(() => {
    const m = document.querySelector('main');
    return { winY: window.scrollY, mainST: m ? m.scrollTop : -1 };
  });

  // E1. PAN on the real scroller: select mode, swipe up on canvas empty area
  await tapBtnScroll('.tool-rail', 'Select & move (V)');
  console.log('E1. select active:', await isActive('Select & move (V)'));
  const before = await getScroll();
  const bx = await page.locator('.sheet-inner').first().boundingBox();
  // swipe up on lower empty part of page 1 (below text, above bottom edge)
  await tdrag(bx.x + bx.width * 0.5, bx.y + bx.height * 0.8, bx.x + bx.width * 0.5, bx.y + bx.height * 0.8 - 280);
  await page.waitForTimeout(900);
  const after = await getScroll();
  console.log('E1. PAN canvas swipe:', JSON.stringify(before), '->', JSON.stringify(after),
    (after.mainST > before.mainST + 30 || after.winY > before.winY + 30) ? 'SCROLLS' : 'NO SCROLL');

  // E2. full inspector flow
  await tapBtnScroll('.tool-rail', 'Rectangle (R)');
  console.log('E2. rect active:', await isActive('Rectangle (R)'));
  const sb = await page.locator('.sheet-inner').first().boundingBox();
  const n0 = await page.evaluate(() => { let n = 0; document.querySelectorAll('.sheet-overlay').forEach(sv => sv.querySelectorAll(':scope > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)').forEach(() => n++)); return n; });
  await tdrag(sb.x + sb.width * 0.2, sb.y + sb.height * 0.55, sb.x + sb.width * 0.55, sb.y + sb.height * 0.68, 12);
  await page.waitForTimeout(800);
  const n1 = await page.evaluate(() => { let n = 0; document.querySelectorAll('.sheet-overlay').forEach(sv => sv.querySelectorAll(':scope > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)').forEach(() => n++)); return n; });
  console.log('E2. rect drawn:', n0, '->', n1);
  await tapBtnScroll('.tool-rail', 'Select & move (V)');
  const ab = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.sheet-overlay > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)'));
    const el = els[els.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, fill: el.getAttribute('fill'), stroke: el.getAttribute('stroke') };
  });
  console.log('E2. annotation:', JSON.stringify(ab));
  let colorOk = false;
  if (ab) {
    await ttap(ab.x, ab.y);
    await page.waitForTimeout(1000);
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
      const selText = (d.innerText || '').slice(0, 200).replace(/\s+/g, ' ');
      return { disp: getComputedStyle(d).display, w: Math.round(r.width), colors: d.querySelectorAll('input[type="color"]').length, selText };
    });
    console.log('E2. inspector:', JSON.stringify(inspInfo));
    await page.screenshot({ path: '/tmp/p8-inspector-selected.png' });
    if (inspInfo.colors > 0) {
      const shape = page.locator('.sheet-overlay > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)').last();
      const beforeFill = await shape.evaluate(el => el.getAttribute('fill') || el.getAttribute('stroke'));
      const ci = page.locator('.inspector input[type="color"]').first();
      // scroll color input into view inside panel first
      await ci.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await ci.evaluate(el => { el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.waitForTimeout(700);
      const afterFill = await shape.evaluate(el => el.getAttribute('fill') || el.getAttribute('stroke'));
      colorOk = afterFill !== beforeFill;
      console.log('E2. color edit:', beforeFill, '->', afterFill, colorOk ? 'CHANGED' : 'NOT CHANGED');
    }
  }
  console.log('E. pageerrors:', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
