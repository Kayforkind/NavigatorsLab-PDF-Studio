// probe2: real modal / sign-pad / inspector / note / image-stamp selectors
const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };
const OUT = '/tmp/';

async function setup() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, proxy: PROXY, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE-ERR: ' + m.text().slice(0, 120)); });
  await page.goto('https://navigatorslab.com/pdf-studio/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const demo = page.getByRole('button', { name: /demo document/ });
  await demo.waitFor({ state: 'visible', timeout: 20000 });
  await demo.scrollIntoViewIfNeeded();
  const db = await demo.boundingBox();
  await page.touchscreen.tap(db.x + db.width / 2, db.y + db.height / 2);
  await page.locator('.sheet-inner').nth(3).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  const session = await page.context().newCDPSession(page);
  return { browser, page, session, errs };
}
async function tapBtn(page, title) {
  const loc = page.locator(`button[title="${title}"]`).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  const b = await loc.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(500);
}
async function touchTap(session, x, y) {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function dumpOverlays(page, label) {
  const info = await page.evaluate(() => {
    const dlg = Array.from(document.querySelectorAll('[role="dialog"]'));
    return {
      dialogCount: dlg.length,
      dialogs: dlg.map(d => ({ tag: d.tagName, cls: String(d.className).slice(0, 100), r: (() => { const x = d.getBoundingClientRect(); return { x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.width), h: Math.round(x.height) }; })() })),
      allFixed: Array.from(document.querySelectorAll('body *')).filter(e => { const p = getComputedStyle(e).position; return p === 'fixed' && e.getBoundingClientRect().width > 50 && e.getBoundingClientRect().height > 50; }).map(e => e.tagName + '.' + String(e.className).slice(0, 80)),
    };
  });
  console.log('=== ' + label + ' ===');
  console.log(JSON.stringify(info, null, 1));
}

(async () => {
  const { browser, page, session, errs } = await setup();
  const sheet = page.locator('.sheet-inner').first();
  const sbox = () => sheet.boundingBox();

  // A. EXPORT dialog
  await tapBtn(page, 'Export options & document properties');
  await page.waitForTimeout(1200);
  await dumpOverlays(page, 'AFTER EXPORT CLICK');
  await page.screenshot({ path: OUT + 'p2-export.png' });

  // B. close via Escape, then FORMS
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await tapBtn(page, 'Detect and fill PDF form fields (AcroForm)');
  await page.waitForTimeout(1200);
  await dumpOverlays(page, 'AFTER FORMS CLICK');
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);

  // C. SIGNATURE: tool -> tap page
  await tapBtn(page, 'Signature (G)');
  const bb = await sbox();
  await touchTap(session, bb.x + bb.width * 0.5, bb.y + bb.height * 0.4);
  await page.waitForTimeout(1200);
  await dumpOverlays(page, 'AFTER SIGN TAP');
  await page.screenshot({ path: OUT + 'p2-sign.png' });
  // look for canvas pad
  const padInfo = await page.evaluate(() => Array.from(document.querySelectorAll('canvas')).map(c => {
    const r = c.getBoundingClientRect();
    return { cls: String(c.className).slice(0, 60), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
  }));
  console.log('CANVASES:', JSON.stringify(padInfo));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);

  // D. NOTE tool tap
  await tapBtn(page, 'Sticky note (N)');
  const bb2 = await sbox();
  const before = await page.evaluate(() => document.querySelectorAll('.sheet-overlay > :not(defs)').length);
  await touchTap(session, bb2.x + bb2.width * 0.7, bb2.y + bb2.height * 0.35);
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => document.querySelectorAll('.sheet-overlay > :not(defs)').length);
  console.log('NOTE anns', before, '->', after);
  await dumpOverlays(page, 'AFTER NOTE TAP');
  await page.screenshot({ path: OUT + 'p2-note.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);

  // E. SELECT annotation -> inspector
  // draw rect via mouse for a target
  await tapBtn(page, 'Rectangle (R)');
  const bb3 = await sbox();
  await page.mouse.move(bb3.x + 60, bb3.y + 300); await page.mouse.down();
  await page.mouse.move(bb3.x + 170, bb3.y + 390, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(800);
  await tapBtn(page, 'Select & move (V)');
  const annBox = await page.evaluate(() => {
    const el = document.querySelector('.sheet-overlay > :not(defs):not(.hit-hint)');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, cls: String(el.getAttribute('class')).slice(0, 60) };
  });
  console.log('annBox:', JSON.stringify(annBox));
  if (annBox) { await touchTap(session, annBox.x, annBox.y); await page.waitForTimeout(1200); }
  const selInfo = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.sheet-overlay *')).map(e => String(e.getAttribute('class') || e.tagName));
    const sel = all.filter(c => /select/i.test(c));
    const panels = Array.from(document.querySelectorAll('*')).map(e => String(e.className)).filter(c => /inspect|drawer|panel|sidebar|propert/i.test(c));
    return { selClasses: [...new Set(sel)].slice(0, 10), panels: [...new Set(panels)].slice(0, 15) };
  });
  console.log('SEL INFO:', JSON.stringify(selInfo, null, 1));
  await page.screenshot({ path: OUT + 'p2-inspector.png' });

  console.log('ERRORS:', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('PROBE2 ERR:', e.message); process.exit(1); });
