/* Verify the table-cell fix: on the demo invoice page (page 3), Edit Text
 * must produce per-CELL hits, not one box spanning the whole row.
 * Usage: node scripts/probe-cells.cjs [baseUrl] */
const path = require('node:path');
const { chromium } = require(path.join(process.env.APPDATA + '/npm/node_modules/@playwright/test/node_modules', 'playwright'));

const BASE = process.argv[2] || 'http://localhost:5198/pdf-studio/';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /demo document/i }).click();
  await p.waitForSelector('.sheet-canvas', { timeout: 20000 });
  await p.waitForTimeout(2500);

  // switch to Edit text tool
  await p.evaluate(() => {
    const btns = [...document.querySelectorAll('.tool-rail button')];
    const edit = btns.find((x) => x.title && x.title.startsWith('Edit text'));
    if (edit) edit.click();
  });
  await p.waitForTimeout(2000);

  // gather hit boxes with their page labels and text
  const hits = await p.evaluate(() => {
    const sheets = [...document.querySelectorAll('.sheet')];
    const out = [];
    for (const s of sheets) {
      const label = s.querySelector('.sheet-label')?.textContent || '';
      const hh = [...s.querySelectorAll('.hit-hint')];
      for (const h of hh) {
        const r = h.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        out.push({ label, text: (h.getAttribute('data-text') || '').slice(0, 22), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return out;
  });

  const invoice = hits.filter((h) => h.label.includes('Page 3'));
  console.log('== Page 3 (invoice) hits ==');
  for (const h of invoice) console.log(`  ${h.w}px × ${h.h}px  "${h.text}"`);

  const wide = invoice.filter((h) => h.w > 160);
  console.log(`\nrow-spanning boxes (>160px wide): ${wide.length} of ${invoice.length}`);
  console.log(`narrow cell boxes (≤160px): ${invoice.length - wide.length}`);
  console.log('console errors:', errors.length);
  await b.close();
  if (errors.length) process.exit(1);
})();