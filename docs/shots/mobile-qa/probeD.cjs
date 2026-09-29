// probe D: pan retest, textfield activation, inspector-via-palette flow at 390x844
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
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, proxy: PROXY });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 100)));
  await loadDoc(page);
  const s = await page.context().newCDPSession(page);

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

  // PAN 1: swipe in inter-page gap (empty area, not on canvas)
  await tapBtnScroll('.tool-rail', 'Select & move (V)');
  await page.evaluate(() => window.scrollTo(0, 300)); await page.waitForTimeout(400);
  const yA = await page.evaluate(() => window.scrollY);
  await tdrag(20, 500, 20, 250);
  await page.waitForTimeout(900);
  const yB = await page.evaluate(() => window.scrollY);
  console.log('D1. PAN gap-swipe scrollY:', yA, '->', yB, yB > yA + 30 ? 'SCROLLS' : 'NO SCROLL');

  // PAN 2: swipe on canvas empty area (select mode)
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);
  const yC = await page.evaluate(() => window.scrollY);
  const bx = await page.locator('.sheet-inner').first().boundingBox();
  await tdrag(bx.x + bx.width * 0.5, bx.y + bx.height * 0.75, bx.x + bx.width * 0.5, bx.y + bx.height * 0.75 - 260);
  await page.waitForTimeout(900);
  const yD = await page.evaluate(() => window.scrollY);
  console.log('D2. PAN canvas-swipe scrollY:', yC, '->', yD, yD > yC + 30 ? 'SCROLLS' : 'NO SCROLL');

  // TEXTFIELD activation retry (3 attempts)
  for (let i = 0; i < 3; i++) {
    await tapBtnScroll('.tool-rail', 'Text field (F)');
    const cls = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.tool-rail button')).find(x => x.getAttribute('title') === 'Text field (F)');
      return b && b.className;
    });
    const on = /active/.test(cls || '');
    console.log('D3. textfield attempt', i + 1, 'active:', on);
    if (on) break;
    await page.waitForTimeout(400);
  }

  // INSPECTOR via palette: draw rect, tap-select it, tap palette button
  await tapBtnScroll('.tool-rail', 'Rectangle (R)');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  const sb = await page.locator('.sheet-inner').first().boundingBox();
  await tdrag(sb.x + sb.width * 0.2, sb.y + sb.height * 0.3, sb.x + sb.width * 0.5, sb.y + sb.height * 0.4, 10);
  await page.waitForTimeout(700);
  await tapBtnScroll('.tool-rail', 'Select & move (V)');
  const ab = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.sheet-overlay > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)'));
    const el = els[els.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log('D4. annotation to select:', JSON.stringify(ab));
  if (ab) { await ttap(ab.x, ab.y); await page.waitForTimeout(1000); }
  const selVisible = await page.evaluate(() => {
    // selection outline = dashed rect or handles in overlay
    const html = document.querySelector('.annot-selection') || document.querySelector('[class*="selection"]');
    return !!html;
  });
  const pal = page.locator('.topbar button[title^="Colors, fonts"]');
  await pal.evaluate(e => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
  await page.waitForTimeout(400);
  const pb2 = await pal.boundingBox();
  await ttap(pb2.x + pb2.width / 2, pb2.y + pb2.height / 2);
  await page.waitForTimeout(1000);
  const insp = await page.evaluate(() => {
    const d = document.querySelector('.inspector');
    if (!d) return 'no-el';
    const r = d.getBoundingClientRect();
    return 'display=' + getComputedStyle(d).display + ' w=' + Math.round(r.width) + ' h=' + Math.round(r.height) + ' x=' + Math.round(r.x);
  });
  console.log('D4. selection-indicator:', selVisible, '| inspector after select+palette:', insp);
  await page.screenshot({ path: '/tmp/p7-inspector-palette.png' });
  console.log('D. pageerrors:', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
