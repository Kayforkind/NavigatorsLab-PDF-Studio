/* Rotated-page redaction e2e (overlay-perception fix batch).
 * Covers the coordinate-mapping failure mode: redact text on 90°/270° rotated
 * pages, export, forensically confirm the secrets are gone from the bytes.
 * A vacuous mapping (rect covering nothing while appearing over text) fails
 * this test because the secret text would survive in the output.
 *
 * The fixture PDF is generated in-script: page 1 carries /Rotate 90, page 2
 * /Rotate 270, each with a unique secret token. Full-page redact rects are
 * dragged in the real UI (mouse), so the display→content mapping for rotated
 * pages is exercised end to end. The export bytes are then scanned for the
 * tokens in UTF-8, UTF-16BE/LE (±BOM) and hex-string forms.
 *
 * Also asserts the perception contract: the editor shows the hatched
 * MARKED treatment (.redact-mark) and NEVER solid black boxes pre-export.
 *
 * Usage: ROTATE_BASE=http://localhost:5198/pdf-studio/ node scripts/verify-rotate-redact.cjs
 *   (CI serves the production URL shape on :5198/pdf-studio/; wired into ci.yml.)
 * Local VM note: set MOBILE_CHROME to a chromium executable if playwright's
 *   bundled build doesn't match (same as verify-mobile.cjs).
 */
const path = require('node:path');
const fs = require('node:fs');
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
const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');

const BASE = process.env.ROTATE_BASE || 'http://localhost:5198/pdf-studio/';
const CHROME = process.env.MOBILE_CHROME || undefined;
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

/** byte-substring search */
function byteIncludes(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  const first = needle[0];
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    if (hay[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
/** all byte forms the token could survive in (mirrors redactVerify encodeVariants) */
function tokenForms(token) {
  const forms = [Buffer.from(token, 'utf8')];
  const units = [];
  for (const ch of token) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) { const h = cp - 0x10000; units.push(0xd800 + (h >> 10), 0xdc00 + (h & 0x3ff)); }
    else units.push(cp);
  }
  const be = Buffer.alloc(units.length * 2);
  const le = Buffer.alloc(units.length * 2);
  units.forEach((u, i) => {
    be[i * 2] = (u >> 8) & 0xff; be[i * 2 + 1] = u & 0xff;
    le[i * 2] = u & 0xff; le[i * 2 + 1] = (u >> 8) & 0xff;
  });
  forms.push(be, Buffer.concat([Buffer.from([0xfe, 0xff]), be]), le, Buffer.concat([Buffer.from([0xff, 0xfe]), le]));
  // hex-ASCII form as it appears inside PDF <…> strings
  forms.push(Buffer.from('<' + be.toString('hex') + '>', 'utf8'));
  forms.push(Buffer.from('(' + token + ')', 'utf8'));
  return forms;
}
const tokenLeaked = (bytes, token) => tokenForms(token).some((f) => byteIncludes(bytes, f));

async function makeFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [
    { rot: 90, token: 'ROT90SECRET-ALPHA-7741' },
    { rot: 270, token: 'ROT270SECRET-BETA-7741' },
  ];
  for (const { rot, token } of pages) {
    const pg = doc.addPage([612, 792]);
    pg.setRotation(degrees(rot));
    // secret token on several lines + filler, spread across the page so a
    // full-page redact rect must remove every occurrence.
    const lines = [
      `Secret alpha line: ${token} do not disclose`,
      'Filler paragraph one: the quick brown fox jumps over the lazy dog.',
      `Secret beta line: ${token} do not disclose`,
      'Filler paragraph two: pack my box with five dozen liquor jugs.',
      `Secret gamma line: ${token} do not disclose`,
      'Filler paragraph three: how vexingly quick daft zebras jump.',
    ];
    lines.forEach((t, i) => pg.drawText(t, { x: 60, y: 700 - i * 44, size: 15, font }));
  }
  return { bytes: Buffer.from(await doc.save()), tokens: pages.map((p) => p.token) };
}

(async () => {
  const { bytes: pdfBytes, tokens } = await makeFixture();
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  console.log('== rotated pages: upload + mark + export ==');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const fileInput = page.locator('input[type=file]').first();
  await fileInput.setInputFiles({ name: 'rotated.pdf', mimeType: 'application/pdf', buffer: pdfBytes });
  await page.waitForFunction(() => document.querySelectorAll('.sheet-inner').length >= 2, null, { timeout: 30000 });
  await page.waitForTimeout(2500);

  // perception contract: intrinsic rotation is honored in the layout
  const sheetCount = await page.locator('.sheet-inner').count();
  ok('two rotated pages render', sheetCount >= 2, `sheets=${sheetCount}`);

  // select the redact tool, then drag a full-page rect on EACH page
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.tool-rail button')].find((x) => (x.title || '').startsWith('Redact'));
      b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const sheetEl = page.locator('.sheet-inner').nth(i);
    // Position the sheet fully below the sticky toolbar: the sheets live in
    // MAIN.canvas-area (overflow-y auto), and scrollIntoViewIfNeeded() can
    // leave the sheet top tucked under the header, in which case the drag
    // would start on the toolbar instead of the sheet.
    await sheetEl.evaluate((el) => {
      const area = el.closest('.canvas-area');
      if (!area) return;
      const r = el.getBoundingClientRect();
      const areaR = area.getBoundingClientRect();
      area.scrollTop += r.top - areaR.top - 110; // sheet top 110px below area top
    });
    await page.waitForTimeout(400);
    const box = await sheetEl.boundingBox();
    if (!box) throw new Error(`sheet ${i} has no bounding box`);
    if (box.y < 80) throw new Error(`sheet ${i} still under toolbar (y=${box.y.toFixed(0)}) — aborting drag`);
    const m = 0.02; // inset 2% to stay inside the sheet
    await page.mouse.move(box.x + box.width * m, box.y + box.height * m);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * (1 - m), box.y + box.height * (1 - m), { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }

  // perception: hatched MARKED treatment present, solid black absent pre-export
  const marked = await page.evaluate(() => document.querySelectorAll('.sheet-overlay .redact-mark').length);
  const solidBlack = await page.evaluate(() => document.querySelectorAll('.sheet-overlay rect[fill="#111114"]').length);
  ok('redact marks use the hatched MARKED treatment', marked >= 2, `marks=${marked}`);
  ok('no solid black boxes in the editor pre-export', solidBlack === 0, `solid=${solidBlack}`);
  const hatchOk = await page.evaluate(() => {
    const r = document.querySelector('.sheet-overlay .redact-mark');
    if (!r) return false;
    const fill = r.getAttribute('fill') || '';
    const dash = r.getAttribute('stroke-dasharray') || '';
    return fill.includes('url(#redact-hatch)') && dash.length > 0;
  });
  ok('marks render hatched fill with dashed outline', hatchOk);

  // export via Save and capture the download
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.evaluate(() => document.querySelector('.save-cta')?.click()),
  ]);
  ok('save downloads the PDF', !!dl, dl ? dl.suggestedFilename() : 'no download');
  let toastOk = false;
  try { await page.getByText(/regions redacted/).waitFor({ timeout: 60000 }); toastOk = true; } catch { /* no */ }
  ok('verification toast shown', toastOk);

  // forensic: neither secret token may survive anywhere in the output bytes
  const fp = await dl.path();
  const outBytes = fs.readFileSync(fp);
  for (const token of tokens) {
    ok(`secret ${token} unrecoverable in exported bytes`, !tokenLeaked(outBytes, token));
  }
  // sanity: the export is a real 2-page PDF (all text was vector-removed, so
  // it is legitimately small — no raster JPEGs were needed)
  const { PDFDocument: PL2 } = require('pdf-lib');
  let pageCount = -1;
  try { pageCount = (await PL2.load(outBytes)).getPageCount(); } catch { /* not a pdf */ }
  ok('exported file is a valid 2-page PDF', outBytes.subarray(0, 5).toString() === '%PDF-' && pageCount === 2, `${outBytes.length} bytes, pages=${pageCount}`);

  await ctx.close();
  await browser.close();
  const realErrors = consoleErrors.filter((m) => !/ResizeObserver|favicon/i.test(m));
  ok('no page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
