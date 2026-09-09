/* Verifies today's four user-reported UX fixes end to end:
 *  1. Thumbnails render content (getPage off-by-one fix)
 *  2. Edit Text: click a line, retype → committed edit annotation
 *  3. Image stamp: place, drag corner handle → grows, aspect kept
 *  4. Styling drawer: hidden sidebar on narrow viewport, palette button opens it
 * Usage: node scripts/verify-ux.cjs [baseUrl]  (default http://localhost:5198/pdf-studio/) */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(path.join(process.env.APPDATA + '/npm/node_modules/@playwright/test/node_modules', 'playwright'));

const BASE = process.argv[2] || 'http://localhost:5198/pdf-studio/';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

/* 48px test stamp PNG */
function stampPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAKklEQVR4nO3NMQEAIAzAsIF/z0OGBx4S2N3d3d3d3d3d3d3d3d3d3d3dPewFbAABtjHbgAAAAASUVORK5CYII=',
    'base64',
  );
}

(async () => {
  const pngPath = path.resolve(__dirname, '.fixture-stamp.png');
  fs.writeFileSync(pngPath, stampPng());

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /open the demo/i }).click();
  await page.waitForSelector('.sheet-current', { timeout: 30000 });
  await page.waitForTimeout(2500);

  /* ---- 1 · thumbnails ---- */
  const thumbs = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.thumb canvas')];
    return t.map((c) => {
      const cx = c.getContext('2d');
      const d = cx.getImageData(0, 0, c.width, Math.max(1, Math.floor(c.height * 0.2))).data;
      let nonBlank = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) nonBlank++;
      return { w: c.width, nonBlank };
    });
  });
  ok('1 · thumbnails render content', thumbs.length >= 2 && thumbs.filter((t) => t.w > 0 && t.nonBlank > 20).length >= 2, JSON.stringify(thumbs));

  /* ---- 2 · edit text ---- */
  await page.locator('.tool-rail button[title*="Edit text" i], .tool-rail button[title*="existing text" i]').first().click();
  await page.waitForTimeout(1200);
  const hitInfo = await page.evaluate(() => {
    const hits = [...document.querySelectorAll('[data-text]')];
    const vis = hits.filter((h) => {
      const r = h.getBoundingClientRect();
      return r.width > 2 && r.top > 90 && r.bottom < window.innerHeight - 40;
    });
    const h = vis[0] || hits[0];
    if (!h) return null;
    h.scrollIntoView({ block: 'center' });
    const r = h.getBoundingClientRect();
    return { text: h.dataset.text, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  ok('2a · edit-text hits extracted', !!hitInfo, hitInfo ? `"${(hitInfo.text || '').slice(0, 26)}"` : 'no hits');
  if (hitInfo) {
    await page.mouse.click(hitInfo.x, hitInfo.y);
    await page.waitForSelector('.inline-input', { timeout: 5000 });
    await page.waitForTimeout(80);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('EDITED OK');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    const committed = await page.evaluate(() => {
      const texts = [...document.querySelectorAll('.sheet-current svg text')];
      return texts.some((t) => (t.textContent || '').includes('EDITED OK'));
    });
    ok('2b · edit committed', committed);
  }

  /* ---- 3 · image stamp + corner resize ---- */
  await page.locator('.tool-rail button[title*="Image stamp" i]').first().click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 8000 }),
    page.locator('.sheet-current').click({ position: { x: 300, y: 200 } }),
  ]);
  await chooser.setFiles(pngPath);
  await page.waitForTimeout(1200);
  const placed = await page.evaluate(() => {
    const img = document.querySelector('.sheet-current svg image[href]');
    const r = img ? img.getBoundingClientRect() : null;
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  });
  ok('3a · stamp placed & selected', !!placed, placed ? `${Math.round(placed.w)}x${Math.round(placed.h)}` : 'no image element');

  if (placed) {
    // drag the corner handle from just inside the visual bottom-right corner
    const hx = placed.x + placed.w - 3;
    const hy = placed.y + placed.h - 3;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 80, hy + 50, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const img = document.querySelector('.sheet-current svg image[href]');
      const r = img ? img.getBoundingClientRect() : null;
      return r ? { w: r.width, h: r.height } : null;
    });
    const grew = after && after.w > placed.w + 40;
    const aspectBefore = placed.w / placed.h;
    const aspectAfter = after ? after.w / after.h : 0;
    ok('3b · corner handle resizes stamp', !!grew, after ? `${Math.round(after.w)}x${Math.round(after.h)}` : 'gone');
    ok('3c · aspect locked while resizing', !!after && Math.abs(aspectAfter - aspectBefore) < 0.08, `AR ${aspectBefore.toFixed(2)} → ${aspectAfter.toFixed(2)}`);
  }

  /* ---- 4 · styling drawer on narrow viewport ---- */
  await page.setViewportSize({ width: 980, height: 800 });
  await page.waitForTimeout(400);
  const sidebarHidden = await page.evaluate(() => {
    const i = document.querySelector('.inspector');
    return i ? getComputedStyle(i).display === 'none' : true;
  });
  ok('4a · sidebar hidden on narrow viewport', sidebarHidden);
  // activate a color-capable tool so the tool section shows its swatch row
  await page.locator('.tool-rail button[title*="Highlight" i]').first().click();
  await page.locator('.topbar button[title*="Colors, fonts" i]').first().click();
  await page.waitForTimeout(400);
  const drawer = await page.evaluate(() => {
    const i = document.querySelector('.inspector.drawer-open');
    if (!i) return { open: false };
    const cs = getComputedStyle(i);
    return { open: cs.display !== 'none', swatches: i.querySelectorAll('.swatch').length, closeBtn: !!i.querySelector('.drawer-close') };
  });
  ok('4b · drawer opens with swatches', !!(drawer && drawer.open && drawer.swatches >= 6), drawer && drawer.open ? `${drawer.swatches} swatches, close=${drawer.closeBtn}` : 'not visible');

  console.log(`\npage errors: ${errors.length}${errors.length ? ' → ' + errors.slice(0, 3).join(' | ') : ''}`);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close();
  fs.unlinkSync(pngPath);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
