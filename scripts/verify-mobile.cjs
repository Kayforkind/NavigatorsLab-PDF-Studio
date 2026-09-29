/* Mobile production-ready verification (Phase 6).
 * Runs the full redaction workflow on real touch-emulated viewports and
 * asserts the phone/tablet layout contracts:
 *   1. No horizontal overflow at 390px, 768px, 1440px
 *   2. Every visible interactive control is a >=44px touch target at 390px and 768px
 *   3. Redact tool selectable; redact rect drawable with a touch drag (CDP touch events)
 *   4. Save triggers a download AND the redaction-verified toast (readable, above tool rail)
 *   5. Export dialog fits the viewport; all its buttons are >=44px and in view
 *   6. Inspector (style) drawer fits the viewport and closes
 * Usage: MOBILE_BASE=http://localhost:5199/ node scripts/verify-mobile.cjs
 *   (CI serves the production URL shape on :5198/pdf-studio/; the browser
 *   suites step sets MOBILE_BASE accordingly.)
 * Local VM note: playwright's bundled chromium build may not match the local
 *   browser cache — set MOBILE_CHROME to an executable path to override. */
const path = require('node:path');
function resolvePlaywright() {
  const candidates = [
    process.env.PW_MODULES,
    (process.env.APPDATA ? process.env.APPDATA + '/npm/node_modules/@playwright/test/node_modules' : ''),
    path.resolve(__dirname, '..', 'node_modules'),
  ].filter(Boolean);
  for (const c of candidates) { try { return require(path.join(c, 'playwright')); } catch { /* next */ } }
  throw new Error('playwright not found; set PW_MODULES or npm i -D playwright');
}
const { chromium } = resolvePlaywright();

const BASE = process.env.MOBILE_BASE || 'http://localhost:5199/';
const CHROME = process.env.MOBILE_CHROME || undefined;
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

async function touchDrag(cdp, x0, y0, x1, y1, steps = 10) {
  const tp = (x, y) => ({ x, y, id: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(x0, y0)] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** every visible button/input/select/textarea/summary/link must be >=44px */
async function touchTargets(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('button, input, select, textarea, summary, a')];
    const bad = [];
    for (const el of els) {
      if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'color' || el.type === 'range')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.bottom < -4 || r.top > window.innerHeight + 4) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      if (r.width < 44 || r.height < 44) {
        const label = (el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || el.className || el.tagName).toString().slice(0, 36).replace(/\n/g, ' ');
        bad.push(`${el.tagName}.${String(el.className).split(' ')[0]} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return bad;
  });
}

async function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function openDemo(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText(/Open the demo document/).click();
  await page.waitForSelector('.sheet-inner', { timeout: 30000 });
  await page.waitForTimeout(2000);
}

(async () => {
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const consoleErrors = [];

  // ---------------- phone 390 ----------------
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
      acceptDownloads: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    console.log('== phone 390: redaction workflow ==');
    await openDemo(page);

    ok('no horizontal overflow (390)', await noOverflow(page));
    const bad390 = await touchTargets(page);
    ok('touch targets >=44px (390)', bad390.length === 0, bad390.slice(0, 6).join(' | '));

    // redact tool one tap away, at the head of the bottom rail (visual order!)
    await page.locator('.tool-rail button', { hasText: 'Redact' }).click();
    await page.waitForTimeout(400);
    const active = await page.locator('.tool-rail button.active', { hasText: 'Redact' }).count();
    ok('redact tool activates', active === 1);
    const firstVisible = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.tool-rail .tool-btn')];
      btns.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      return btns[0] ? btns[0].innerText.split('\n')[0] : '';
    });
    ok('redact group leads the rail', /redact/i.test(firstVisible), `leftmost=${firstVisible}`);

    // draw a rect with a finger drag
    const box = await page.locator('.sheet-inner').first().boundingBox();
    const cdp = await ctx.newCDPSession(page);
    await touchDrag(cdp, box.x + box.width * 0.25, box.y + box.height * 0.15, box.x + box.width * 0.7, box.y + box.height * 0.22);
    await page.waitForTimeout(700);
    const rects = await page.evaluate(() => document.querySelectorAll('.sheet-overlay rect[fill="#111114"]').length);
    ok('touch drag draws a redact rect', rects > 0, `rects=${rects}`);

    // save -> download + verification toast
    const dlP = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
    await page.locator('.save-cta').click();
    const dl = await dlP;
    ok('save downloads the PDF', !!dl, dl ? dl.suggestedFilename() : 'no download');
    let toastOk = false;
    try { await page.getByText(/regions redacted/).waitFor({ timeout: 60000 }); toastOk = true; } catch { /* no */ }
    ok('verification toast shown', toastOk);
    const toastAboveRail = await page.evaluate(() => {
      const t = [...document.querySelectorAll('.toast')].find((el) => /regions redacted/.test(el.textContent));
      if (!t) return false;
      const rail = document.querySelector('.tool-rail').getBoundingClientRect();
      return t.getBoundingClientRect().bottom <= rail.top + 2;
    });
    ok('toast sits above the tool rail', toastAboveRail);

    // export dialog: fits, buttons reachable
    await page.locator('.topbar button[title="Export options & document properties"]').scrollIntoViewIfNeeded();
    await page.locator('.topbar button[title="Export options & document properties"]').click();
    await page.waitForSelector('.modal-wide', { timeout: 10000 });
    await page.waitForTimeout(300);
    const exp = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      const r = m.getBoundingClientRect();
      const btns = [...m.querySelectorAll('.modal-actions .btn')].map((b) => {
        const br = b.getBoundingClientRect();
        return br.height >= 44 && br.top >= -2 && br.bottom <= window.innerHeight + 2;
      });
      return { fits: r.left >= 0 && r.right <= window.innerWidth + 1, btns };
    });
    ok('export dialog fits viewport', exp.fits);
    ok('export action buttons >=44px and reachable', exp.btns.length >= 3 && exp.btns.every(Boolean), `buttons=${exp.btns.length}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // inspector drawer: fits, closes
    await page.locator('.topbar button[title="Colors, fonts & size (opens the style panel)"]').scrollIntoViewIfNeeded();
    await page.locator('.topbar button[title="Colors, fonts & size (opens the style panel)"]').click();
    await page.waitForTimeout(400);
    const drawer = await page.evaluate(() => {
      const d = document.querySelector('.inspector.drawer-open');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      const close = d.querySelector('.drawer-close').getBoundingClientRect();
      return { fits: r.left >= 0 && r.right <= window.innerWidth + 1, closeOk: close.width >= 44 && close.height >= 44 };
    });
    ok('inspector drawer fits viewport', !!drawer && drawer.fits);
    ok('drawer close target >=44px', !!drawer && drawer.closeOk);
    await page.locator('.inspector.drawer-open .drawer-close').click();
    await page.waitForTimeout(200);
    ok('drawer closes', (await page.locator('.inspector.drawer-open').count()) === 0);

    // pinch-to-zoom: a two-finger pinch must zoom the DOCUMENT (not the page)
    {
      const zoomOf = () =>
        page.evaluate(() => {
          const m = /(\d+)%/.exec(document.querySelector('.statusbar')?.textContent ?? '');
          return m ? parseInt(m[1], 10) : null;
        });
      const z0 = await zoomOf();
      const cdpP = await ctx.newCDPSession(page);
      const pbox = await page.locator('.sheet-inner').first().boundingBox();
      const pcx = pbox.x + pbox.width / 2, pcy = pbox.y + pbox.height / 2;
      const t2 = (x, y, id) => ({ x, y, id });
      await cdpP.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [t2(pcx - 40, pcy, 1), t2(pcx + 40, pcy, 2)] });
      for (let i = 1; i <= 6; i++) {
        await cdpP.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [t2(pcx - 40 - i * 14, pcy, 1), t2(pcx + 40 + i * 14, pcy, 2)] });
      }
      await cdpP.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(900);
      const z1 = await zoomOf();
      ok('pinch-to-zoom changes document zoom', z0 !== null && z1 !== null && z1 > z0, `${z0}% -> ${z1}%`);
    }

    // tap-then-pinch: starting a draw and then pinching must NOT commit a stray mark
    {
      await page.locator('.tool-rail button', { hasText: 'Redact' }).click();
      await page.waitForTimeout(300);
      const before = await page.evaluate(() => document.querySelectorAll('.sheet-overlay rect[fill="#111114"]').length);
      const cdpC = await ctx.newCDPSession(page);
      const cbox = await page.locator('.sheet-inner').first().boundingBox();
      const sx = cbox.x + cbox.width * 0.3, sy = cbox.y + cbox.height * 0.5;
      const t1 = (x, y, id) => ({ x, y, id });
      await cdpC.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [t1(sx, sy, 1)] });
      await page.waitForTimeout(200);
      await cdpC.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [t1(sx, sy, 1), t1(sx + 60, sy, 2)] });
      for (let i = 1; i <= 5; i++) {
        await cdpC.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [t1(sx - i * 10, sy, 1), t1(sx + 60 + i * 10, sy, 2)] });
      }
      await cdpC.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(900);
      const after = await page.evaluate(() => document.querySelectorAll('.sheet-overlay rect[fill="#111114"]').length);
      ok('tap-then-pinch commits no stray mark', after === before, `marks ${before} -> ${after}`);
    }
    await ctx.close();
  }

  // ---------------- tablet 768 ----------------
  {
    const ctx = await browser.newContext({
      viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      acceptDownloads: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    console.log('== tablet 768 ==');
    await openDemo(page);
    ok('no horizontal overflow (768)', await noOverflow(page));
    const bad768 = await touchTargets(page);
    ok('touch targets >=44px (768)', bad768.length === 0, bad768.slice(0, 6).join(' | '));
    await ctx.close();
  }

  // ---------------- desktop 1440 regression ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    console.log('== desktop 1440 (regression) ==');
    await openDemo(page);
    ok('no horizontal overflow (1440)', await noOverflow(page));
    const railVisible = await page.locator('.tool-rail').isVisible();
    const inspVisible = await page.evaluate(() => getComputedStyle(document.querySelector('.inspector')).display !== 'none');
    ok('desktop keeps side rail + docked inspector', railVisible && inspVisible);
    const statusVisible = await page.evaluate(() => getComputedStyle(document.querySelector('.statusbar')).display !== 'none');
    ok('desktop keeps status bar', statusVisible);
    await ctx.close();
  }

  await browser.close();
  const realErrors = consoleErrors.filter((m) => !/ResizeObserver|favicon/i.test(m));
  ok('no page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
