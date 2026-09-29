// DOM probe v2: real selectors for tools, modals, inspector, save button
const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, proxy: PROXY });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('https://navigatorslab.com/pdf-studio/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  const demo = page.getByRole('button', { name: /demo document/ });
  await demo.waitFor({ state: 'visible', timeout: 20000 });
  await demo.scrollIntoViewIfNeeded();
  const b = await demo.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.locator('.sheet-inner').nth(3).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log('doc loaded, sheets:', await page.locator('.sheet-inner').count());

  // 1. all data-tool buttons
  const tools = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-tool]')).map(el => {
      const r = el.getBoundingClientRect();
      return { tool: el.getAttribute('data-tool'), tag: el.tagName,
        text: (el.innerText || el.textContent || '').trim().slice(0, 28).replace(/\s+/g, ' '),
        vis: r.width > 0 && r.height > 0, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
    });
  });
  console.log('=== DATA-TOOL BUTTONS (' + tools.length + ') ===');
  for (const t of tools) console.log(JSON.stringify(t));

  // 2. click export2, see what opens
  const expBtn = page.locator('[data-tool="export2"]').first();
  console.log('export2 visible:', await expBtn.isVisible().catch(() => 'err'));
  await expBtn.click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const modalInfo = await page.evaluate(() => ({
    dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(e => e.tagName + '.' + String(e.className).slice(0, 70)),
    fixedEls: Array.from(document.querySelectorAll('body *')).filter(e => getComputedStyle(e).position === 'fixed').map(e => e.tagName + '.' + String(e.className).slice(0, 70)).slice(0, 20),
  }));
  console.log('=== AFTER EXPORT2 CLICK ===', JSON.stringify(modalInfo, null, 1));
  await page.screenshot({ path: '/tmp/probe-export.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // 3. save-like buttons
  const saveInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(x => /save/i.test(x.textContent || '')).map(x => {
      const r = x.getBoundingClientRect();
      return { tag: x.tagName, tool: x.getAttribute('data-tool'), text: (x.textContent || '').trim().slice(0, 30).replace(/\s+/g, ' '), visW: Math.round(r.width), x: Math.round(r.x), y: Math.round(r.y) };
    });
  });
  console.log('=== SAVE-LIKE ===', JSON.stringify(saveInfo));

  // 4. draw rect with mouse, then select via touchscreen tap, look for inspector
  const sheet = page.locator('.sheet-inner').first();
  const bb = await sheet.boundingBox();
  await page.locator('[data-tool="rect"]').first().click();
  await page.mouse.move(bb.x + 60, bb.y + 300);
  await page.mouse.down(); await page.mouse.move(bb.x + 170, bb.y + 390, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(800);
  console.log('anns:', await page.evaluate(() => document.querySelectorAll('.annot-layer > *, svg.annot-layer > *').length));
  await page.locator('[data-tool="select"]').first().click();
  const annBox = await page.evaluate(() => {
    const el = document.querySelector('.annot-layer > *, svg.annot-layer > *');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log('annBox:', JSON.stringify(annBox));
  if (annBox) { await page.touchscreen.tap(annBox.x, annBox.y); await page.waitForTimeout(1200); }
  const insp = await page.evaluate(() => ({
    sel: document.querySelectorAll('.annot-selected, [data-selected="true"]').length,
    inspClasses: Array.from(document.querySelectorAll('*')).map(e => String(e.className)).filter(c => /inspector|drawer|propert/i.test(c)).slice(0, 10),
    asideCount: document.querySelectorAll('aside').length,
  }));
  console.log('=== AFTER SELECT TAP ===', JSON.stringify(insp));
  await page.screenshot({ path: '/tmp/probe-inspector.png' });

  // 5. note tool: tap and check
  await page.locator('[data-tool="note"]').first().click();
  const bb2 = await sheet.boundingBox();
  await page.touchscreen.tap(bb2.x + 100, bb2.y + 500);
  await page.waitForTimeout(1000);
  console.log('anns after note tap:', await page.evaluate(() => document.querySelectorAll('.annot-layer > *, svg.annot-layer > *').length));
  await page.screenshot({ path: '/tmp/probe-note.png' });

  console.log('=== PAGEERRORS ===', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('PROBE ERR:', e.message); process.exit(1); });
