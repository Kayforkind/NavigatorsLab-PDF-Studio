/* Deep mobile QA — TEST ONLY. No code changes, no push, no deploy.
 * Live target: https://navigatorslab.com/pdf-studio/
 * Run: node qa.cjs  (uses playwright-core + headless shell already on the VM)
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const OUT = '/home/hatch/workspace/pdfstudio/docs/shots/mobile-qa/';
const URL = 'https://navigatorslab.com/pdf-studio/';
const STAMP = OUT + 'stamp.png';

const results = [];   // {item, viewport, status, notes}
const defects = [];   // {severity, title, viewport, repro, evidence}
const errors = [];    // console/page errors {viewport, where, text}

function rec(item, viewport, status, notes) { results.push({ item, viewport, status, notes }); }
function defect(severity, title, viewport, repro, evidence) { defects.push({ severity, title, viewport, repro, evidence }); }

async function shot(page, name) {
  const p = OUT + name;
  await page.screenshot({ path: p });
  return p;
}

async function tapBtn(page, title) {
  const loc = page.locator(`button[title="${title}"]`).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  const b = await loc.boundingBox();
  if (!b) throw new Error('no bbox for ' + title);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(400);
}

async function cdp(page) { return await page.context().newCDPSession(page); }

async function touchDrag(session, x1, y1, x2, y2, steps = 14) {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function touchTap(session, x, y) {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function annCount(page) {
  return await page.evaluate(() => {
    let n = 0;
    document.querySelectorAll('.sheet-overlay').forEach((svg) => {
      svg.querySelectorAll(':scope > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)').forEach(() => n++);
    });
    return n;
  });
}

async function sheetBox(page, idx = 0) {
  const loc = page.locator('.sheet-inner').nth(idx);
  await loc.waitFor({ state: 'visible', timeout: 20000 });
  const b = await loc.boundingBox();
  if (!b) throw new Error('no sheet bbox');
  return b;
}

async function scrollTop(page) {
  await page.evaluate(() => {
    const ca = document.querySelector('.canvas-area');
    if (ca) ca.scrollTo(0, 0);
    else window.scrollTo(0, 0);
  });
  await page.waitForTimeout(600);
}

async function noHOverflow(page) {
  return await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function dialogOverflow(page) {
  // returns {name, scrollW, clientW} for the open dialog
  return await page.evaluate(() => {
    const d = document.querySelector('.modal[role="dialog"]');
    if (!d) return null;
    return { scrollW: d.scrollWidth, clientW: d.clientWidth, cls: d.className };
  });
}

async function closeDialog(page) {
  const btn = page.locator('.modal [aria-label="Close"], .modal .modal-head button').first();
  try {
    await btn.click({ timeout: 3000 });
  } catch {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(500);
}

function attachErrorHooks(page, viewport, where) {
  page.on('pageerror', (e) => errors.push({ viewport, where, text: 'PAGEERROR: ' + String(e).slice(0, 300) }));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ viewport, where, text: 'CONSOLE: ' + m.text().slice(0, 300) });
  });
}

async function loadDoc(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const demo = page.getByRole('button', { name: /demo document/ });
  await demo.waitFor({ state: 'visible', timeout: 20000 });
  const b = await demo.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  // wait for 4 pages rendered (waitForSelector avoids CSP unsafe-eval issues with waitForFunction)
  await page.locator('.sheet-inner').nth(3).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(4000);
  await scrollTop(page);
}

/* ---------------- FULL MATRIX (390x844) ---------------- */
async function fullMatrix(browser) {
  const VW = '390x844';
  const ctx = await browser.newContext(ctxOpts([390, 844]));
  const page = await ctx.newPage();
  attachErrorHooks(page, VW, 'global');
  const session = await cdp(page);

  // 1. Landing
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const p = await shot(page, '01-landing-390x844.png');
    const ok = await noHOverflow(page);
    const drop = await page.locator('.dropzone, [class*="drop"]').first().isVisible().catch(() => false);
    rec('1. Landing layout', VW, ok ? 'PASS' : 'FAIL', `no-h-overflow=${ok}, dropzone-visible=${drop}, shot=${p}`);
    if (!ok) defect('major', 'Landing page horizontal overflow', VW, 'Load landing at 390x844', p);
  } catch (e) { rec('1. Landing layout', VW, 'FAIL', 'exception: ' + e.message); }

  // 2. Load multi-page PDF
  try {
    await loadDoc(page);
    const n = await page.evaluate(() => document.querySelectorAll('.sheet-inner').length);
    const p = await shot(page, '02-doc-390x844.png');
    rec('2. Load multi-page PDF', VW, n >= 4 ? 'PASS' : 'FAIL', `pages=${n}, shot=${p}`);
  } catch (e) { rec('2. Load multi-page PDF', VW, 'FAIL', 'exception: ' + e.message); return; }

  // 3. Markup tools via genuine touch-drag
  const dragTools = [
    ['highlight', 'Highlight (H)'], ['underline', 'Underline (U)'], ['strike', 'Strikethrough (X)'],
    ['ink', 'Pen / draw (D)'], ['rect', 'Rectangle (R)'], ['ellipse', 'Ellipse (O)'],
    ['arrow', 'Arrow / pointer (A)'], ['redact', 'Redact (B)'], ['whiteout', 'Whiteout (W)'],
  ];
  for (const [id, title] of dragTools) {
    try {
      await tapBtn(page, title);
      await scrollTop(page);
      const box = await sheetBox(page, 0);
      const before = await annCount(page);
      // draw in the upper-middle of the page; ink gets a scribble
      if (id === 'ink') {
        const cx = box.x + box.width / 2, cy = box.y + box.height * 0.18;
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 40, y: cy, id: 1 }] });
        const pts = [[-40, 0], [-20, -18], [0, 0], [20, 18], [40, 0]];
        for (const [dx, dy] of pts) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dx, y: cy + dy, id: 1 }] });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await touchDrag(session, box.x + box.width * 0.15, box.y + box.height * 0.12, box.x + box.width * 0.85, box.y + box.height * 0.22);
      }
      await page.waitForTimeout(700);
      const after = await annCount(page);
      const ok = after > before;
      const p = await shot(page, `03-tool-${id}-390x844.png`);
      rec(`3. Tool: ${id} (touch-drag)`, VW, ok ? 'PASS' : 'FAIL', `anns ${before}→${after}, shot=${p}`);
      if (!ok) defect('critical', `Touch-drag creates no ${id} annotation`, VW, `Select ${id} tool, touch-drag on page 1`, p);
    } catch (e) { rec(`3. Tool: ${id} (touch-drag)`, VW, 'FAIL', 'exception: ' + e.message); }
  }

  // 3b. text tool (tap + type + Enter)
  try {
    await tapBtn(page, 'Add text (T)');
    await scrollTop(page);
    const box = await sheetBox(page, 0);
    const before = await annCount(page);
    await touchTap(session, box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.waitForTimeout(800);
    const inputVisible = await page.locator('.inline-input').isVisible().catch(() => false);
    if (inputVisible) {
      await page.keyboard.type('QA mobile text');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
    }
    const after = await annCount(page);
    const ok = after > before;
    const p = await shot(page, '03-tool-text-390x844.png');
    rec('3. Tool: text (tap+type)', VW, ok ? 'PASS' : 'FAIL', `inline-input=${inputVisible}, anns ${before}→${after}, shot=${p}`);
    if (!ok) defect('major', 'Text tool: tap does not create annotation', VW, 'Select Add text, tap page, type, Enter', p);
  } catch (e) { rec('3. Tool: text (tap+type)', VW, 'FAIL', 'exception: ' + e.message); }

  // 3c. note tool (tap to drop)
  try {
    await tapBtn(page, 'Sticky note (N)');
    await scrollTop(page);
    const box = await sheetBox(page, 0);
    const before = await annCount(page);
    await touchTap(session, box.x + box.width * 0.7, box.y + box.height * 0.35);
    await page.waitForTimeout(800);
    // dismiss the note editor if open
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(400);
    const after = await annCount(page);
    const ok = after > before;
    const p = await shot(page, '03-tool-note-390x844.png');
    rec('3. Tool: note (tap)', VW, ok ? 'PASS' : 'FAIL', `anns ${before}→${after}, shot=${p}`);
    if (!ok) defect('major', 'Note tool: tap does not drop marker', VW, 'Select Sticky note, tap page', p);
  } catch (e) { rec('3. Tool: note (tap)', VW, 'FAIL', 'exception: ' + e.message); }

  // 3d. signature (tap → pad → draw → stamp)
  try {
    await tapBtn(page, 'Signature (G)');
    await scrollTop(page);
    const box = await sheetBox(page, 0);
    const before = await annCount(page);
    await touchTap(session, box.x + box.width * 0.5, box.y + box.height * 0.4);
    await page.waitForTimeout(1000);
    const padVisible = await page.locator('.sign-pad').isVisible().catch(() => false);
    let placed = false;
    if (padVisible) {
      const pb = await page.locator('.sign-pad').boundingBox();
      await touchDrag(session, pb.x + pb.width * 0.2, pb.y + pb.height * 0.5, pb.x + pb.width * 0.8, pb.y + pb.height * 0.5);
      await page.waitForTimeout(500);
      const useBtn = page.locator('.modal .btn.primary:not([disabled])');
      const p1 = await shot(page, '03-sign-pad-390x844.png');
      try {
        await useBtn.first().click({ timeout: 5000 });
        await page.waitForTimeout(800);
        placed = true;
      } catch { defect('major', 'Sign pad: cannot confirm signature', VW, 'Draw in pad, primary button stays disabled or unclickable', p1); }
    }
    const after = await annCount(page);
    const ok = placed && after > before;
    const p = await shot(page, '03-tool-sign-390x844.png');
    rec('3. Tool: signature (pad+stamp)', VW, ok ? 'PASS' : 'FAIL', `pad=${padVisible}, anns ${before}→${after}, shot=${p}`);
    if (!ok && padVisible) defect('major', 'Signature not stamped on page', VW, 'Sign tool → tap page → draw → confirm', p);
    if (!padVisible) defect('major', 'Sign pad dialog did not open', VW, 'Sign tool → tap page', p);
  } catch (e) { rec('3. Tool: signature (pad+stamp)', VW, 'FAIL', 'exception: ' + e.message); }

  // 3e. image stamp (tap → file input → stamp)
  try {
    await tapBtn(page, 'Image stamp (I)');
    await scrollTop(page);
    const box = await sheetBox(page, 0);
    const before = await annCount(page);
    await touchTap(session, box.x + box.width * 0.5, box.y + box.height * 0.45);
    await page.waitForTimeout(800);
    const inp = page.locator('input[accept="image/png,image/jpeg,image/webp,image/svg+xml"]');
    const hasInput = (await inp.count()) > 0;
    if (hasInput) {
      await inp.first().setInputFiles(STAMP);
      await page.waitForTimeout(1000);
    }
    const after = await annCount(page);
    const ok = after > before;
    const p = await shot(page, '03-tool-image-390x844.png');
    rec('3. Tool: image stamp', VW, ok ? 'PASS' : 'FAIL', `file-input=${hasInput}, anns ${before}→${after}, shot=${p}`);
    if (!ok) defect('major', 'Image stamp not placed', VW, 'Image tool → tap page → choose PNG', p);
  } catch (e) { rec('3. Tool: image stamp', VW, 'FAIL', 'exception: ' + e.message); }

  // 4. Tap-to-select + inspector + edit color
  try {
    await tapBtn(page, 'Select & move (V)');
    await scrollTop(page);
    const shape = page.locator('.sheet-overlay > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)').first();
    const sb = await shape.boundingBox();
    const beforeFill = await shape.evaluate((el) => el.getAttribute('fill') || el.getAttribute('stroke'));
    await touchTap(session, sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.waitForTimeout(800);
    const drawerOpen = await page.evaluate(() => {
      const d = document.querySelector('.inspector');
      return d && getComputedStyle(d).display !== 'none' && d.getBoundingClientRect().width > 0;
    });
    const p1 = await shot(page, '04-inspector-390x844.png');
    let colorChanged = false;
    if (drawerOpen) {
      const colorInput = page.locator('.inspector input[type="color"]').first();
      if ((await colorInput.count()) > 0) {
        await colorInput.evaluate((el) => { el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForTimeout(600);
        const afterFill = await shape.evaluate((el) => el.getAttribute('fill') || el.getAttribute('stroke'));
        colorChanged = afterFill !== beforeFill;
      }
    }
    const p2 = await shot(page, '04-inspector-colored-390x844.png');
    const ok = drawerOpen && colorChanged;
    rec('4. Select + inspector + color edit', VW, ok ? 'PASS' : 'FAIL', `drawer=${drawerOpen}, color-changed=${colorChanged} (${beforeFill}), shots=${p1},${p2}`);
    if (!drawerOpen) defect('major', 'Tap-to-select does not open inspector drawer', VW, 'Select tool → tap annotation', p1);
    else if (!colorChanged) defect('minor', 'Inspector color change does not apply', VW, 'Select annotation → change color in inspector', p2);
  } catch (e) { rec('4. Select + inspector + color edit', VW, 'FAIL', 'exception: ' + e.message); }

  // 5. Dialogs: fit + export download
  const dialogs = [
    ['Export options & document properties', 'export', '05-dialog-export'],
    ['Detect and fill PDF form fields (AcroForm)', 'forms', '05-dialog-forms'],
    ['Compare the text of two PDFs side by side', 'compare', '05-dialog-compare'],
    ['Private on-device AI (ask / summarize this document)', 'ai', '05-dialog-ai'],
    ['Help', 'help', '05-dialog-help'],
  ];
  for (const [title, , shotName] of dialogs) {
    try {
      await tapBtn(page, title);
      await page.waitForTimeout(900);
      const ov = await dialogOverflow(page);
      const p = await shot(page, `${shotName}-390x844.png`);
      const fits = ov ? ov.scrollW <= ov.clientW + 1 : false;
      const ok = !!ov && fits;
      rec(`5. Dialog: ${title.slice(0, 24)}… fits`, VW, ok ? 'PASS' : 'FAIL', `scrollW=${ov?.scrollW} clientW=${ov?.clientW}, shot=${p}`);
      if (!ok) defect(ov && !fits ? 'major' : 'major', `Dialog overflows horizontally (${title.slice(0, 30)})`, VW, `Open dialog at 390px`, p);
      await closeDialog(page);
    } catch (e) { rec(`5. Dialog: ${title.slice(0, 24)}…`, VW, 'FAIL', 'exception: ' + e.message); }
  }
  // Sign pad dialog
  try {
    await tapBtn(page, 'Signature (G)');
    await scrollTop(page);
    const box = await sheetBox(page, 0);
    await touchTap(session, box.x + box.width * 0.5, box.y + box.height * 0.55);
    await page.waitForTimeout(900);
    const ov = await dialogOverflow(page);
    const p = await shot(page, '05-dialog-signpad-390x844.png');
    const fits = ov ? ov.scrollW <= ov.clientW + 1 : false;
    rec('5. Dialog: sign pad fits', VW, ov && fits ? 'PASS' : 'FAIL', `scrollW=${ov?.scrollW} clientW=${ov?.clientW}, shot=${p}`);
    if (!(ov && fits)) defect('major', 'Sign pad dialog overflows horizontally', VW, 'Sign tool → tap page', p);
    await closeDialog(page);
    await tapBtn(page, 'Select & move (V)');
  } catch (e) { rec('5. Dialog: sign pad', VW, 'FAIL', 'exception: ' + e.message); }

  // 5b. Export completes → valid PDF download
  try {
    await tapBtn(page, 'Export options & document properties');
    await page.waitForTimeout(900);
    const dlBtn = page.locator('.modal .btn.primary').first();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 45000 }),
      (async () => { const b = await dlBtn.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); })(),
    ]);
    const dp = await download.path();
    const head = fs.readFileSync(dp).slice(0, 5).toString();
    const size = fs.statSync(dp).size;
    const ok = head === '%PDF-';
    rec('5b. Export downloads valid PDF', VW, ok ? 'PASS' : 'FAIL', `header=${JSON.stringify(head)}, bytes=${size}`);
    if (!ok) defect('critical', 'Export does not produce a valid PDF', VW, 'Export dialog → Download PDF', '');
    await page.waitForTimeout(500);
    await closeDialog(page).catch(() => {});
  } catch (e) { rec('5b. Export downloads valid PDF', VW, 'FAIL', 'exception: ' + e.message); await closeDialog(page).catch(() => {}); }

  // 6. Topbar buttons
  const topbar = [
    ['Open PDF (Ctrl+O)', 'open'],
    ['Merge another PDF after the current page', 'merge'],
    ['Undo (Ctrl+Z)', 'undo'], ['Redo (Ctrl+Y)', 'redo'],
    ['Zoom out', 'zoomout'], ['Zoom in', 'zoomin'],
    ['Detect and fill PDF form fields (AcroForm)', 'forms2'],
    ['Compare the text of two PDFs side by side', 'compare2'],
    ['Private on-device AI (ask / summarize this document)', 'ai2'],
    ['Help', 'help2'],
    ['Print the PDF with annotations (Ctrl+P)', 'print'],
    ['Colors, fonts & size (opens the style panel)', 'palette'],
    ['Export options & document properties', 'export2'],
    ['Save a copy (Ctrl+S)', 'save'],
  ];
  for (const [title, key] of topbar) {
    try {
      const loc = page.locator(`button[title="${title}"]`).first();
      const vis = await loc.isVisible().catch(() => false);
      if (!vis) { rec(`6. Topbar: ${key}`, VW, 'FAIL', 'button not visible'); defect('major', `Topbar button not visible on mobile: ${title}`, VW, 'Load doc at 390x844', ''); continue; }
      const b = await loc.boundingBox();
      const errsBefore = errors.length;
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(900);
      const newErrs = errors.length - errsBefore;
      // dismiss anything it opened
      if (await page.locator('.modal[role="dialog"]').count() > 0) await closeDialog(page);
      const p = key === 'save' ? await shot(page, '06-topbar-after-390x844.png') : '';
      rec(`6. Topbar: ${key}`, VW, newErrs === 0 ? 'PASS' : 'FAIL', `visible, new-errors=${newErrs}${p ? ', shot=' + p : ''}`);
      if (newErrs > 0) defect('major', `Topbar button throws errors: ${title}`, VW, `Tap ${title}`, p);
    } catch (e) { rec(`6. Topbar: ${key}`, VW, 'FAIL', 'exception: ' + e.message); }
  }
  // functional: undo/redo round-trip
  try {
    const n0 = await annCount(page);
    const ub = await page.locator('button[title="Undo (Ctrl+Z)"]').first().boundingBox();
    await page.touchscreen.tap(ub.x + ub.width / 2, ub.y + ub.height / 2);
    await page.waitForTimeout(600);
    const n1 = await annCount(page);
    const rb = await page.locator('button[title="Redo (Ctrl+Y)"]').first().boundingBox();
    await page.touchscreen.tap(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.waitForTimeout(600);
    const n2 = await annCount(page);
    const ok = n1 === n0 - 1 && n2 === n0;
    rec('6b. Undo/redo round-trip', VW, ok ? 'PASS' : 'FAIL', `anns ${n0}→${n1}→${n2}`);
    if (!ok) defect('major', 'Undo/redo does not round-trip annotation count', VW, 'Tap Undo then Redo', '');
  } catch (e) { rec('6b. Undo/redo round-trip', VW, 'FAIL', 'exception: ' + e.message); }

  // 7. Page navigation on mobile
  try {
    const hasThumbStrip = await page.evaluate(() => {
      const t = document.querySelector('.thumb-strip');
      return t && getComputedStyle(t).display !== 'none';
    });
    const jumpUI = await page.evaluate(() => !!document.querySelector('[aria-label*="page" i], .page-jump, .page-indicator'));
    // scroll through the document
    await page.evaluate(() => document.querySelector('.canvas-area')?.scrollTo(0, 2000));
    await page.waitForTimeout(800);
    const scrolled = await page.evaluate(() => (document.querySelector('.canvas-area')?.scrollTop ?? 0) > 100);
    const p = await shot(page, '07-pagenav-390x844.png');
    rec('7. Page navigation', VW, scrolled ? 'PASS' : 'FAIL', `thumb-strip-visible=${hasThumbStrip}, page-jump-UI=${jumpUI}, scroll-works=${scrolled}, shot=${p}`);
    if (!jumpUI) defect('minor', 'No page-jump control on mobile (scroll only)', VW, 'Load 4-page doc at 390x844; thumb strip hidden', p);
    if (!scrolled) defect('major', 'Cannot scroll between pages on mobile', VW, 'Touch/scroll canvas area', p);
  } catch (e) { rec('7. Page navigation', VW, 'FAIL', 'exception: ' + e.message); }

  // 9. Input font sizes
  try {
    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('input, select, textarea').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) out.push(`${el.tagName}.${el.className.toString().slice(0, 30)}:${fs}px`);
      });
      return out;
    });
    rec('9. Input font-size ≥16px', VW, small.length === 0 ? 'PASS' : 'FAIL', small.length ? small.join('; ') : 'all visible inputs ≥16px');
    if (small.length) defect('minor', 'Inputs below 16px (iOS auto-zoom risk)', VW, 'Inspect computed font-size of visible inputs', small.join('; '));
  } catch (e) { rec('9. Input font-size', VW, 'FAIL', 'exception: ' + e.message); }

  // 10. Pinch-zoom + pan in select mode
  try {
    await tapBtn(page, 'Select & move (V)');
    await scrollTop(page);
    const box = await sheetBox(page, 0);
    const cx = box.x + box.width / 2, cy = Math.min(box.y + 200, 600);
    const errsBefore = errors.length;
    // pinch out
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
    for (let i = 1; i <= 8; i++) {
      const d = 40 + (i * 10);
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(900);
    const stillAlive = await page.evaluate(() => document.querySelectorAll('.sheet-inner').length >= 4);
    // pan: touch-drag on empty area in select mode should scroll the canvas
    const st0 = await page.evaluate(() => document.querySelector('.canvas-area')?.scrollTop ?? 0);
    await touchDrag(session, cx, cy, cx, cy - 250);
    await page.waitForTimeout(700);
    const st1 = await page.evaluate(() => document.querySelector('.canvas-area')?.scrollTop ?? 0);
    const panned = Math.abs(st1 - st0) > 50;
    const newErrs = errors.length - errsBefore;
    const p = await shot(page, '10-pinch-390x844.png');
    const ok = stillAlive && newErrs === 0;
    rec('10. Pinch-zoom + pan', VW, ok ? 'PASS' : 'FAIL', `alive=${stillAlive}, pan-scroll=${panned}, new-errors=${newErrs}, shot=${p}`);
    if (!ok) defect('major', 'Pinch gesture breaks app or throws', VW, 'Two-finger pinch on document', p);
    if (!panned) defect('minor', 'Touch-drag pan does not scroll document in select mode', VW, 'Select tool → drag on empty page area', p);
  } catch (e) { rec('10. Pinch-zoom + pan', VW, 'FAIL', 'exception: ' + e.message); }

  await shot(page, '99-final-390x844.png');
  await ctx.close();
}

/* ---------------- SMOKE MATRIX (other viewports) ---------------- */
async function smokeMatrix(browser, w, h) {
  const VW = `${w}x${h}`;
  const ctx = await browser.newContext(ctxOpts([w, h]));
  const page = await ctx.newPage();
  attachErrorHooks(page, VW, 'global');
  const session = await cdp(page);
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const p1 = await shot(page, `s1-landing-${VW}.png`);
    const okLand = await noHOverflow(page);
    rec('1. Landing layout', VW, okLand ? 'PASS' : 'FAIL', `no-h-overflow=${okLand}, shot=${p1}`);
    if (!okLand) defect('major', 'Landing page horizontal overflow', VW, `Load landing at ${VW}`, p1);

    await loadDoc(page);
    const n = await page.evaluate(() => document.querySelectorAll('.sheet-inner').length);
    const p2 = await shot(page, `s2-doc-${VW}.png`);
    rec('2. Load multi-page PDF', VW, n >= 4 ? 'PASS' : 'FAIL', `pages=${n}, shot=${p2}`);

    // one touch-draw per category
    await tapBtn(page, 'Rectangle (R)');
    await scrollTop(page);
    const box = await sheetBox(page, 0);
    const before = await annCount(page);
    await touchDrag(session, box.x + box.width * 0.2, box.y + box.height * 0.15, box.x + box.width * 0.8, box.y + box.height * 0.3);
    await page.waitForTimeout(700);
    const after = await annCount(page);
    const okDraw = after > before;
    const p3 = await shot(page, `s3-rect-${VW}.png`);
    rec('3. Touch-draw rect', VW, okDraw ? 'PASS' : 'FAIL', `anns ${before}→${after}, shot=${p3}`);
    if (!okDraw) defect('critical', 'Touch-drag creates no annotation', VW, `Rect tool touch-drag at ${VW}`, p3);

    // dialogs overflow spot-check (export)
    await tapBtn(page, 'Export options & document properties');
    await page.waitForTimeout(900);
    const ov = await dialogOverflow(page);
    const p4 = await shot(page, `s4-export-${VW}.png`);
    const fits = ov ? ov.scrollW <= ov.clientW + 1 : false;
    rec('5. Export dialog fits', VW, ov && fits ? 'PASS' : 'FAIL', `scrollW=${ov?.scrollW} clientW=${ov?.clientW}, shot=${p4}`);
    if (!(ov && fits)) defect('major', 'Export dialog overflows horizontally', VW, `Open export at ${VW}`, p4);
    await closeDialog(page);

    // landscape-specific: critical overlap check
    if (w > h) {
      const overlap = await page.evaluate(() => {
        const tb = document.querySelector('.topbar')?.getBoundingClientRect();
        const rail = document.querySelector('.tool-rail')?.getBoundingClientRect();
        if (!tb || !rail) return 'missing-elements';
        return `topbar-h=${tb.height.toFixed(0)} rail@${rail.x.toFixed(0)},${rail.y.toFixed(0)}`;
      });
      const okNo = await noHOverflow(page);
      rec('11. Landscape usable', VW, okNo ? 'PASS' : 'FAIL', `${overlap}, no-h-overflow=${okNo}, shot=${p4}`);
    }
  } catch (e) {
    rec('smoke', VW, 'FAIL', 'exception: ' + e.message);
  }
  await ctx.close();
}

/* Local preemptive-auth forward proxy on 127.0.0.1:18080 (see /tmp/fwdproxy.py).
 * Chromium waits for a 407 before sending Proxy-Authorization; the egress
 * proxy drops instead, so we route through the forwarder which injects it. */
const PROXY = { server: 'http://127.0.0.1:18080' };

function ctxOpts(vw) {
  return {
    viewport: { width: vw[0], height: vw[1] }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    ...(PROXY ? { proxy: PROXY } : {}),
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await fullMatrix(browser);
  for (const [w, h] of [[360, 740], [414, 896], [768, 1024], [844, 390]]) {
    await smokeMatrix(browser, w, h);
  }
  await browser.close();
  fs.writeFileSync(OUT + 'results.json', JSON.stringify({ results, defects, errors }, null, 2));
  console.log('QA DONE — items:', results.length, 'defects:', defects.length, 'errors:', errors.length);
})().catch((e) => { console.error('QA FATAL:', e.message); process.exit(1); });
