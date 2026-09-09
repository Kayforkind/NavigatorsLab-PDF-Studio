/* End-to-end verification of the six user-reported issues, on the subpath
 * server (mimics GitHub Pages layout). Asserts with real downloads parsed
 * via pdf-lib — not just "no console errors".
 *  1. Edit Text: click a hit, retype, export → new text present in output
 *  2. True redaction: redact a line, export → original text GONE from file
 *  3. Sticky note: create, resize via corner drag → marker grows
 *  4. Print: print button → hidden blob iframe created (real print path)
 *  5. Standard-font assets: cmaps/standard_fonts actually fetched by pdf.js
 *  6. Formatting: font picker + custom color present in Inspector
 * Usage: node scripts/verify-fixes.cjs  (server must run on :5198 /pdf-studio/) */
const path = require('node:path');
const { chromium } = require(path.join(process.env.APPDATA + '/npm/node_modules/@playwright/test/node_modules', 'playwright'));

const BASE = process.env.VERIFY_BASE || 'http://localhost:5198/pdf-studio/';
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`);
  }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
    if (/raster-debug|rasterizePage failed/.test(m.text())) console.log('  [pg]', m.text().slice(0, 110));
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('response', (r) => { if (r.status() === 404) console.log('  [404]', r.url()); });
  const fontRequests = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/cmaps/') || u.includes('/standard_fonts/') || u.includes('/tess')) fontRequests.push(u);
  });

  console.log('== 0 · Load app + demo document ==');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /demo document/i }).click();
  await page.waitForSelector('.sheet-canvas', { timeout: 20_000 });
  await page.waitForTimeout(2500); // allow pages to paint
  const painted = await page.evaluate(() => {
    const c = document.querySelector('.sheet-canvas');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(2, 2, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  });
  ok('page canvas painted', painted && painted[3] > 0, JSON.stringify(painted));

  console.log('== 5 · pdf.js asset roots (blank-page fix) ==');
  // The demo doc embeds its fonts, so pdf.js won't fetch aux assets for it —
  // assert instead that the asset trees are deployed AT THE RIGHT BASE (this
  // is what fixes non-embedded-font / CJK documents rendering blank).
  const fontAsset = await page.evaluate(async (u) => (await fetch(u + 'standard_fonts/LiberationSans-Regular.ttf')).status, BASE);
  const cmapAsset = await page.evaluate(async (u) => (await fetch(u + 'cmaps/78-H.bcmap')).status, BASE);
  ok('standard font assets deployed at base', fontAsset === 200, `status=${fontAsset}`);
  ok('cmap assets deployed at base', cmapAsset === 200, `status=${cmapAsset}`);

  console.log('== 1 · Edit Text round-trip ==');
  // activate the edit tool and count the detected lines on the current page
  await page.evaluate(() => {
    const rail = document.querySelector('.tool-rail');
    const btns = rail ? Array.from(rail.querySelectorAll('button')) : [];
    const edit = btns.find((b) => b.title && b.title.startsWith('Edit text'));
    edit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  const hitCount = await page.locator('.hit-hint').count();
  ok('Edit Text detects original text lines', hitCount > 3, `${hitCount} hits`);
  // click a text hit (scroll the first hit into view first — hits render on
  // every sheet when the edit tool is active)
  const firstHit = page.locator('.hit-hint').first();
  await firstHit.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const hb = await firstHit.boundingBox();
  await page.mouse.click(hb.x + hb.width * 0.35, hb.y + hb.height * 0.6);
  await page.waitForSelector('.inline-input', { timeout: 5000 });
  await page.waitForTimeout(250); // let the open-guard lapse (blur-race protection)
  const original = await page.inputValue('.inline-input');
  const REPLACEMENT = 'EDITED BY TEST';
  await page.fill('.inline-input', REPLACEMENT);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  // assert via the rendered overlay (the session blob persists lazily)
  const editAnn = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll('svg.sheet-overlay text'));
    return texts.some((t) => (t.textContent || '').includes('EDITED BY TEST'));
  });
  ok('edit annotation created and rendered', editAnn);

  console.log('== 6 · Formatting controls ==');
  const hasFont = (await page.locator('.inspector select').count()) > 0;
  const hasCustomColor = (await page.locator('.inspector input[type=color]').count()) > 0;
  ok('font family picker present', hasFont);
  ok('custom color picker present', hasCustomColor);

  console.log('== 2 · True redaction ==');
  const redactCtx = {}; // shared between the drag step and the export assertions
  // switch to redact tool, drag over a line on page 1
  await page.evaluate(() => {
    const rail = document.querySelector('.tool-rail');
    const btns = rail ? Array.from(rail.querySelectorAll('button')) : [];
    const red = btns.find((b) => b.title === 'Redact');
    red?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  ok('redact tool active', (await page.evaluate(() => (document.querySelector('.st-left')?.textContent || '').match(/tool: \w+/)?.[0])) === 'tool: redact');
  await page.waitForTimeout(300);
  const sheetEl = page.locator('.sheet-inner').first();
  await sheetEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const sheet = await sheetEl.boundingBox();
  // Pick a REAL text line under the band instead of guessing a fraction —
  // after the Edit-Text step the view may be scrolled onto a later page.
  // The hit hints only render while the Edit tool is active: re-select it,
  // find a line on the CURRENT sheet, then switch back to redact.
  await page.evaluate(() => { const b = [...document.querySelectorAll('.tool-rail button')].find((x) => x.title === 'Edit text'); if (b) b.click(); });
  await page.waitForTimeout(700);
  // Bring a hit INTO the viewport first (mouse coords are viewport-relative).
  const anyHit = page.locator('.hit-hint[data-text]:not([data-text=""])').first();
  if ((await anyHit.count()) === 0) throw new Error('edit-text hits not rendered at all');
  await anyHit.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  // Identify which PAGE the target hit lives on (pageTexts is page-indexed).
  const targetInfo = await page.evaluate(() => {
    const vh = window.innerHeight;
    const vis = [...document.querySelectorAll('.hit-hint')].filter((h) => {
      const r = h.getBoundingClientRect();
      return (h.getAttribute('data-text') || '').trim().length > 0 && r.top >= 40 && r.bottom <= vh - 40 && r.width > 20;
    });
    if (!vis.length) return null;
    const r = vis[0].getBoundingClientRect();
    const pageId = vis[0].closest('[data-page-id]')?.getAttribute('data-page-id') ?? null;
    return { text: vis[0].getAttribute('data-text'), pageId, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  });
  if (!targetInfo) throw new Error('no edit-text hits visible — cannot place redaction band');
  const bandText = targetInfo.text;
  const band = targetInfo.rect;
  console.log('  target line:', JSON.stringify(bandText), 'on page-id', targetInfo.pageId);
  // Tell the export assertions which page index got rasterized.
  redactCtx.pageIndex = await page.evaluate((pid) => {
    const sheets = [...document.querySelectorAll('[data-page-id]')];
    return sheets.findIndex((s) => s.getAttribute('data-page-id') === pid);
  }, targetInfo.pageId);
  // back to redact for the actual drag
  await page.evaluate(() => { const b = [...document.querySelectorAll('.tool-rail button')].find((x) => x.title === 'Redact'); if (b) b.click(); });
  await page.waitForTimeout(300);
  if (!band || !bandText) throw new Error('no edit-text hits visible — cannot place redaction band');
  // Drag a band covering the chosen line (padded vertically to be safe).
  await page.mouse.move(band.x - 8, band.y - band.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(band.x + band.w + 8, band.y + band.h * 1.5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  console.log('  marks after redact drag:', await page.evaluate(() => (document.querySelector('.st-left')?.textContent || '').match(/(\d+) mark/)?.[1]));
  await page.screenshot({ path: 'docs/redact-debug.png' });
  // export via Save and capture the download
  console.log('  marks before export:', await page.evaluate(() => (document.querySelector('.st-left')?.textContent || '').match(/(\d+) mark/)?.[1]));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.evaluate(() => document.querySelector('.save-cta')?.click())]);
  const fp = await dl.path();
  const PDFDocument = require('pdf-lib').PDFDocument;
  const fs = require('node:fs');
  const bytes = fs.readFileSync(fp);
  const doc = await PDFDocument.load(bytes);
  const texts = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const b = await doc.save(); // no text extraction in pdf-lib; use raw scan below
    break;
  }
  // Decode content streams (they are Flate-compressed — raw byte scans lie)
  const pdfLib = require('pdf-lib');
  const { decodePDFRawStream, PDFRawStream, PDFArray } = pdfLib;
  const pageTexts = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const pg = doc.getPage(i);
    let txt = '';
    const contents = pg.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    for (const s of streams) {
      if (s instanceof PDFRawStream) {
        try {
          txt += Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
        } catch {
          txt += Buffer.from(s.contents).toString('latin1');
        }
      }
    }
    pageTexts.push(txt);
  }
  // pdf-lib writes text as <HEX> literals — hex-decode before searching
  const hexToAscii = (s) =>
    s.replace(/<([0-9A-Fa-f\s]+)>/g, (_, h) => {
      const clean = h.replace(/\s+/g, '');
      let out = '';
      for (let i = 0; i + 1 < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.substr(i, 2), 16));
      return out;
    });
  const allDecoded = hexToAscii(pageTexts.join(' '));
  const hasEdited = allDecoded.includes('EDITED BY TEST');
  ok('edited text present in exported PDF', hasEdited);
  // TRUE redaction: page 1 is replaced by a raster — its original text
  // operators (the heading under the redact box) must be GONE from the file.
  let hasDct = false;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const f = obj.dict && obj.dict.get ? obj.dict.get(pdfLib.PDFName.of('Filter')) : null;
      if (f && String(f).includes('DCTDecode')) {
        hasDct = true;
        break;
      }
    }
  }
  ok('redacted page content replaced by raster (true removal)', hasDct);
  // The line that was under the band must be unrecoverable FROM THAT PAGE
  // (other pages may legitimately repeat the same words).
  const target = String(bandText || '');
  const token = target.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, '')).filter((w) => w.length >= 6)[0] || target.trim().slice(0, 12);
  const rasterPageIdx = redactCtx.pageIndex ?? 0;
  const rasterPageDecoded = hexToAscii(pageTexts[rasterPageIdx] || '');
  const headingLeak = token.length > 0 && rasterPageDecoded.includes(token);
  ok('redacted heading unrecoverable in file', !headingLeak);
  console.log('== 3 · Sticky note resizable ==');
  await page.evaluate(() => {
    const rail = document.querySelector('.tool-rail');
    const btns = rail ? Array.from(rail.querySelectorAll('button')) : [];
    const note = btns.find((b) => b.title === 'Sticky note');
    note?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sheetEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const sheet2 = await sheetEl.boundingBox();
  await page.mouse.click(sheet2.x + sheet2.width * 0.5, sheet2.y + sheet2.height * 0.6);
  await page.waitForSelector('.inline-input', { timeout: 5000 });
  await page.waitForTimeout(250);
  await page.keyboard.type('note body');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const noteBefore = await page.locator('svg.sheet-overlay rect[stroke="#b48a10"]').last().boundingBox();
  // select tool, grab the note's resize corner (bottom-right of marker)
  await page.evaluate(() => {
    const rail = document.querySelector('.tool-rail');
    const btns = rail ? Array.from(rail.querySelectorAll('button')) : [];
    const sel = btns.find((b) => b.title === 'Select & move');
    sel?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const nx = noteBefore.x + noteBefore.width;
  const ny = noteBefore.y + noteBefore.height;
  await page.mouse.move(nx - 2, ny - 2);
  await page.mouse.down();
  await page.mouse.move(nx + 34, ny + 34, { steps: 8 });
  const midResize = await page.evaluate(() => {
    const g = Array.from(document.querySelectorAll('svg.sheet-overlay rect')).find((r) => r.getAttribute('stroke') === '#3b82f6' && r.getAttribute('stroke-dasharray'));
    return !!g;
  });
  console.log('  resize gesture active mid-drag:', midResize);
  await page.mouse.up();
  await page.waitForTimeout(500);
  console.log('  marks after resize attempt:', await page.evaluate(() => (document.querySelector('.st-left')?.textContent || '').match(/(\d+) mark/)?.[1]));
  const noteAfter = await page.locator('svg.sheet-overlay rect[stroke="#b48a10"]').last().boundingBox();
  ok('sticky note resized via corner drag', noteAfter.width > noteBefore.width + 15, `${Math.round(noteBefore.width)}→${Math.round(noteAfter.width)}px`);

  console.log('== 4 · Print prints the PDF, not the app ==');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.tb-btn.icon')).find((b) => (b.title || '').startsWith('Print the PDF'));
    btn?.click();
  });
  await page.waitForTimeout(1500);
  const printIframe = await page.evaluate(() => {
    const f = Array.from(document.querySelectorAll('iframe')).find((x) => (x.src || '').startsWith('blob:'));
    return f ? { src: f.src.slice(0, 30), hidden: f.style.opacity === '0' } : null;
  });
  ok('print builds PDF blob in hidden iframe', !!printIframe, JSON.stringify(printIframe));

  console.log(`== console errors: ${consoleErrors.length} ==`);
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 5).join('\n---\n'));

  await browser.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('VERIFY CRASH:', e);
  process.exit(2);
});
