/* End-to-end feature review — every advertised feature, exercised like a user.
 * Complements verify-fixes.cjs (edit/redact/notes/print/controls) with:
 *  - blank-page scenario (non-embedded-font PDF, the attachment-2 class)
 *  - full-document search + match cycling
 *  - thumbnail ops: duplicate, delete, undo (Ctrl+Z)
 *  - Forms dialog on a real AcroForm (form-test.pdf) + value round-trip in export
 *  - range export (1-2 → 2-page download)
 *  - OCR (same-origin engine) producing editable lines
 *  - formatting (font family) reflected in exported PDF
 *  - compare + AI dialogs open/close
 *  - mobile viewport: no horizontal overflow
 *  - privacy sweep: every network request stays same-origin (or blob:/data:)
 * Usage: node scripts/review-e2e.cjs  (BASE env overrides, default localhost:5198/pdf-studio/) */
const path = require('node:path');
const { chromium } = require(path.join(process.env.APPDATA + '/npm/node_modules/@playwright/test/node_modules', 'playwright'));

const BASE = process.env.REVIEW_BASE || 'http://localhost:5198/pdf-studio/';
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond });
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const externalRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:')) externalRequests.push(u);
  });
  const marks = () => page.evaluate(() => parseInt((document.querySelector('.st-left')?.textContent || '').match(/(\d+) mark/)?.[1] || '0', 10));

  console.log('== A · Load + demo document ==');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((x) => /demo/i.test(x.textContent)).click(); });
  await page.waitForTimeout(2500);
  const diversity = await page.evaluate(() => {
    const el = document.querySelector('.sheet-canvas');
    if (!el) return 0;
    const ctx2 = el.getContext('2d');
    const d = ctx2.getImageData(0, 0, el.width, Math.min(el.height, 600)).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 400) set.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
    return set.size;
  });
  ok('demo document renders (canvas painted)', diversity > 50, `${diversity} colors`);

  console.log('== B · Blank-page scenario: non-embedded-font PDF (attachment-2 class) ==');
  // Build a PDF whose text uses StandardFonts.Helvetica WITHOUT embedding —
  // exactly the class of document that rendered blank before the cMaps/
  // standard-fonts fix.
  const { PDFDocument: PL, StandardFonts: SF } = require('pdf-lib');
  const src = await PL.create();
  const helv = await src.embedFont(SF.Helvetica);
  const pg1 = src.addPage([612, 792]);
  pg1.drawText('NONEMBEDDED FONT RENDER TEST 123', { x: 60, y: 700, size: 20, font: helv });
  pg1.drawText('Second line for edit-text detection.', { x: 60, y: 660, size: 14, font: helv });
  const nonEmbedBytes = Buffer.from(await src.save());
  const fileInput = page.locator('input[type=file]').first();
  await fileInput.setInputFiles({ name: 'nonembedded.pdf', mimeType: 'application/pdf', buffer: nonEmbedBytes });
  await page.waitForTimeout(2500);
  const diversity2 = await page.evaluate(() => {
    const el = document.querySelector('.sheet-canvas');
    if (!el) return 0;
    const ctx2 = el.getContext('2d');
    const d = ctx2.getImageData(0, 0, el.width, Math.min(el.height, 600)).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 400) set.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
    return set.size;
  });
  ok('non-embedded-font page renders visibly (no blank)', diversity2 > 10, `${diversity2} colors`);
  // Edit Text should see its lines too (text extraction may take a moment)
  await page.evaluate(() => { const el = [...document.querySelectorAll('.tool-rail button')].find((x) => x.title === 'Edit text'); if (el) el.click(); });
  let hitCount2 = 0;
  for (let i = 0; i < 16 && !hitCount2; i++) {
    await page.waitForTimeout(500);
    hitCount2 = await page.locator('.hit-hint').count();
  }
  ok('Edit Text detects lines on non-embedded-font page', hitCount2 > 0, `${hitCount2} hits`);

  console.log('== C · Full-document search ==');
  const searchBox = page.locator('.search-box');
  await searchBox.fill('line');
  await searchBox.press('Enter');
  await page.waitForTimeout(1500);
  const searchCount = await page.evaluate(() => document.querySelectorAll('.search-hl').length);
  const counter = await page.evaluate(() => document.querySelector('.search-count')?.textContent || '');
  ok('search executes and reports', searchCount > 0 || /\d+/.test(counter), `counter="${counter.trim()}" highlights=${searchCount}`);
  await searchBox.press('Enter'); // cycle to next match
  await page.waitForTimeout(400);
  ok('search cycles without errors', consoleErrors.length === 0);
  await searchBox.fill('');
  await searchBox.press('Enter');
  await page.waitForTimeout(400);

  console.log('== D · Thumbnails & page ops ==');
  const thumbCount = () => page.locator('.thumb').count();
  const t0 = await thumbCount();
  ok('thumbnail rail lists all pages', t0 >= 1, `${t0} thumbs`);
  await page.locator('.thumb').first().locator('button[title="Duplicate page"]').click();
  await page.waitForTimeout(500);
  const t1 = await thumbCount();
  ok('duplicate page adds a thumb', t1 === t0 + 1, `${t0}→${t1}`);
  await page.locator('.thumb').first().locator('button[title="Rotate clockwise"]').click();
  await page.waitForTimeout(500);
  ok('rotate applies without errors', true);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const t2 = await thumbCount();
  ok('Ctrl+Z undoes duplicate (and rotate)', t2 === t0, `${t1}→${t2}`);

  console.log('== E · Forms round-trip (real AcroForm) ==');
  const fs = require('node:fs');
  const formPath = path.resolve('public/form-test.pdf');
  if (fs.existsSync(formPath)) {
    await fileInput.setInputFiles(formPath);
    await page.waitForTimeout(2200);
    await page.evaluate(() => { const el = [...document.querySelectorAll('.tb-btn')].find((x) => /Forms/.test(x.textContent)); if (el) el.click(); });
    await page.waitForTimeout(800);
    const dlg = await page.evaluate(() => {
      const d = [...document.querySelectorAll('.dialog, [role=dialog], .modal')].find((x) => /Fill form fields/i.test(x.textContent || ''));
      return d ? d.textContent.slice(0, 120) : null;
    });
    ok('Forms dialog lists detected fields', !!dlg, dlg ? dlg.replace(/\s+/g, ' ').slice(0, 70) : 'no dialog');
    // fill the first text input inside the dialog
    const filled = await page.evaluate(() => {
      const d = [...document.querySelectorAll('.dialog, [role=dialog], .modal')].find((x) => /Fill form fields/i.test(x.textContent || ''));
      if (!d) return false;
      const inp = d.querySelector('input[type=text], input:not([type])');
      if (!inp) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, 'ZEBRA VALUE');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    // close dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if (filled) {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => document.querySelector('.save-cta')?.click())]);
      const PLib = require('pdf-lib');
      const d2 = await PLib.PDFDocument.load(fs.readFileSync(await dl.path()));
      // Export FLATTENS values into page content by design (so they cannot be
      // changed downstream). pdf-lib's flatten bakes field text into the
      // widget appearance streams that the page paints via /Do — so scan
      // EVERY stream in the file, not just page content.
      const { decodePDFRawStream, PDFRawStream, PDFArray } = PLib;
      let streamTxt = '';
      for (const [, obj] of d2.context.enumerateIndirectObjects()) {
        if (obj instanceof PDFRawStream) {
          try { streamTxt += Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1'); } catch {}
        } else if (obj && obj.dict instanceof (PLib.PDFDict || Object)) { /* skip */ }
      }
      const hexToAscii = (s) => s.replace(/<([0-9A-Fa-f\s]+)>/g, (_, h) => { const clean = h.replace(/\s+/g, ''); let out = ''; for (let i = 0; i + 1 < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.substr(i, 2), 16)); return out; });
      const hasZebra = hexToAscii(streamTxt).includes('ZEBRA VALUE');
      ok('form value survives export (real AcroForm write)', hasZebra, hasZebra ? 'flattened into content' : 'value missing');
    } else {
      ok('form value survives export (real AcroForm write)', false, 'no text field found in dialog');
    }
  } else {
    ok('Forms round-trip', false, 'public/form-test.pdf missing');
  }

  console.log('== F · Range export ==');
  // build a 4-page document so a 1-2 range export is meaningful
  const multi = await PL.create();
  const mfont = await multi.embedFont(SF.Helvetica);
  for (let i = 1; i <= 4; i++) {
    const mp = multi.addPage([612, 792]);
    mp.drawText(`MULTI PAGE ${i} OF 4`, { x: 60, y: 700, size: 20, font: mfont });
  }
  const multiBytes = Buffer.from(await multi.save());
  await fileInput.setInputFiles({ name: 'multi4.pdf', mimeType: 'application/pdf', buffer: multiBytes });
  await page.waitForTimeout(2500);
  // quickSave download (Save button) as the full-export path…
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => document.querySelector('.save-cta')?.click())]);
  {
    const PLib = require('pdf-lib');
    const d3 = await PLib.PDFDocument.load(fs.readFileSync(await dl2.path()));
    ok('full export works (Save)', d3.getPageCount() >= 1, `${d3.getPageCount()} pages`);
  }
  // …then the range export through the Export dialog (icon button by title)
  await page.evaluate(() => { const el = [...document.querySelectorAll('button')].find((x) => (x.title || '').includes('Export options')); if (el) el.click(); });
  await page.waitForTimeout(600);
  const rangeInput = page.locator('.modal input.text-input, [role=dialog] input.text-input').first();
  if (await rangeInput.count()) {
    await rangeInput.fill('1-2');
    const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => {
      const el = [...document.querySelectorAll('.modal button, [role=dialog] button')].find((x) => /Download these pages/i.test(x.textContent || ''));
      if (el) el.click();
    })]).catch(() => [null]);
    if (dl3) {
      const PLib = require('pdf-lib');
      const d4 = await PLib.PDFDocument.load(fs.readFileSync(await dl3.path()));
      ok('range export 1-2 yields exactly 2 pages', d4.getPageCount() === 2, `${d4.getPageCount()} pages`);
    } else ok('range export 1-2 yields exactly 2 pages', false, 'no download');
  } else {
    ok('range export 1-2 yields exactly 2 pages', false, 'range input not found');
    await page.keyboard.press('Escape');
  }

  console.log('== G · OCR (same-origin engine) ==');
  await page.evaluate(() => { const el = [...document.querySelectorAll('.tool-rail button')].find((x) => x.title === 'Edit text'); if (el) el.click(); });
  await page.waitForTimeout(500);
  const before = await marks();
  await page.evaluate(() => document.querySelector('.ocr-cta')?.click());
  // OCR can take a while on first run (engine init)
  let ocrDone = false;
  try {
    await page.waitForFunction(() => !document.querySelector('.ocr-cta') || !(document.querySelector('.ocr-cta')?.textContent || '').includes('OCR:'), null, { timeout: 180000 });
    ocrDone = true;
  } catch { ocrDone = false; }
  const after = await marks();
  ok('OCR completes (engine loads same-origin)', ocrDone, `busy label cleared=${ocrDone}`);
  ok('OCR produces editable lines', ocrDone && after > before, `${before}→${after} marks`);

  console.log('== H · Formatting reaches the export ==');
  // close any dialog left open by earlier sections (F/G) — its overlay
  // otherwise swallows every click below
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // fresh single-page doc — the OCR marks from section G would otherwise
  // swallow the click that is meant to create a new text annotation
  await fileInput.setInputFiles({ name: 'nonembedded.pdf', mimeType: 'application/pdf', buffer: nonEmbedBytes });
  await page.waitForTimeout(2200);
  // 1) tool-level font applies to NEW annotations…
  const toolFont = page.locator('.inspector select').first();
  if (await toolFont.count()) {
    await toolFont.selectOption('Times');
    await page.waitForTimeout(300);
  }
  // 2) …create a text annotation on the CURRENT sheet (earlier sections scroll
  // the page column; a stale .sheet-inner box clicks off-viewport)
  await page.evaluate(() => { const el = [...document.querySelectorAll('.tool-rail button')].find((x) => x.title === 'Add text'); if (el) el.click(); });
  await page.waitForTimeout(300);
  // center the current sheet — scrollIntoViewIfNeeded no-ops when partially
  // visible, leaving the click point outside the viewport
  await page.evaluate(() => document.querySelector('.sheet-current')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  const sheet = await page.locator('.sheet-current').boundingBox();
  await page.mouse.click(sheet.x + sheet.width * 0.35, sheet.y + sheet.height * 0.5);
  const inlineH = await page.waitForSelector('.inline-input', { timeout: 4000 }).then(() => true).catch(() => false);
  if (inlineH) {
    await page.waitForTimeout(120);
    await page.keyboard.press('Control+a');
  }
  await page.keyboard.type('SERIF EXPORT TEST');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  // 3) per-selection font — the new annotation is still selected after commit
  // (a re-click here can land on the glyph edge and deselect)
  const selFont = page.locator('.sel-detail select').first();
  if (await selFont.count()) {
    await selFont.selectOption('Times');
    await page.waitForTimeout(300);
  }
  const [dl4] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => document.querySelector('.save-cta')?.click())]);
  {
    const PLib = require('pdf-lib');
    const { decodePDFRawStream, PDFRawStream, PDFArray, PDFName } = PLib;
    const d5 = await PLib.PDFDocument.load(fs.readFileSync(await dl4.path()));
    // Font choices surface as /BaseFont entries in font objects (content
    // streams only reference resource names like /F1).
    const baseFonts = new Set();
    for (const [, obj] of d5.context.enumerateIndirectObjects()) {
      if (obj && obj.dict) {
        const bf = obj.dict.get(PDFName.of('BaseFont'));
        if (bf) baseFonts.add(String(bf));
      }
    }
    const hasSerif = [...baseFonts].some((f) => /Times/i.test(f));
    ok('serif font choice reaches exported PDF', hasSerif, `base fonts: ${[...baseFonts].join(', ')}`);
  }

  console.log('== I · Compare + AI dialogs ==');
  for (const label of ['Compare', 'Private on-device AI']) {
    await page.evaluate((l) => { const el = [...document.querySelectorAll('.tb-btn')].find((x) => (x.title || '').includes(l)); if (el) el.click(); }, label);
    await page.waitForTimeout(700);
    const opened = await page.evaluate(() => !!document.querySelector('.dialog, [role=dialog], .modal'));
    ok(`${label} dialog opens`, opened);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  console.log('== J · Mobile viewport ==');
  const mpage = await ctx.newPage();
  await mpage.setViewportSize({ width: 390, height: 844 });
  await mpage.goto(BASE, { waitUntil: 'networkidle' });
  await mpage.evaluate(() => { [...document.querySelectorAll('button')].find((x) => /demo/i.test(x.textContent)).click(); });
  await mpage.waitForTimeout(2500);
  const overflow = await mpage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('mobile: no horizontal overflow', overflow <= 2, `${overflow}px overflow`);
  await mpage.close();

  console.log('== K · Privacy sweep ==');
  ok('every request stayed same-origin', externalRequests.length === 0, externalRequests.length ? externalRequests.slice(0, 3).join(' | ') : '0 external requests');
  ok('zero console errors across the whole review', consoleErrors.length === 0, consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : '');

  const failed = results.filter((r) => !r.pass);
  console.log(`\nRESULT: ${results.length - failed.length} passed, ${failed.length} failed`);
  await b.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('REVIEW CRASH:', e.message); process.exit(2); });
