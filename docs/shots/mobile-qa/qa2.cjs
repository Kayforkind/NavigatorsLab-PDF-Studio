// qa2.cjs — corrected second pass: scroll rails into view before tapping.
// Covers everything the first pass got wrong: tools behind rail scroll,
// dialogs behind topbar scroll, real selectors for inspector/sign/note/image,
// export download bytes, save CTA, pan/scroll, and smoke viewports.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const OUT = __dirname + '/';
const URL = 'https://navigatorslab.com/pdf-studio/';
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const PROXY = { server: 'http://127.0.0.1:18080' };
const STAMP = __dirname + '/stamp.png';

const results = [];
const defects = [];
const errors = [];
function rec(item, viewport, status, notes) { results.push({ item, viewport, status, notes }); }
function defect(sev, title, viewport, repro, evidence) { defects.push({ severity: sev, title, viewport, repro, evidence }); }

async function shot(page, name) { const p = OUT + name; await page.screenshot({ path: p }); return p; }
async function cdp(page) { return await page.context().newCDPSession(page); }
async function touchTap(s, x, y) {
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function touchDrag(s, x1, y1, x2, y2, steps = 14) {
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps, y = y1 + ((y2 - y1) * i) / steps;
    await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
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
// Scroll a scrollable container so the button with given title is in view, then touch-tap it.
async function tapBtnScroll(page, session, containerSel, title) {
  const loc = page.locator(`${containerSel} button[title="${title}"]`).first();
  await loc.waitFor({ state: 'attached', timeout: 15000 });
  await loc.evaluate((el) => el.scrollIntoView({ inline: 'center', block: 'nearest' }));
  await page.waitForTimeout(400);
  const b = await loc.boundingBox();
  if (!b) throw new Error('no bbox for ' + title);
  const vw = page.viewportSize();
  if (b.x < 0 || b.x + b.width > vw.width + 1) throw new Error(`button still off-viewport after scroll: ${title} x=${Math.round(b.x)}`);
  await touchTap(session, b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(500);
  return b;
}
async function toolActive(page, title) {
  return await page.evaluate((t) => {
    const b = Array.from(document.querySelectorAll('.tool-rail button')).find(x => x.getAttribute('title') === t);
    return b ? b.className : null;
  }, title);
}
async function sheetBox(page, i) {
  const box = await page.locator('.sheet-inner').nth(i).boundingBox();
  if (!box) throw new Error('no sheet box');
  return box;
}
async function scrollTop(page) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500); }
async function loadDoc(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const demo = page.getByRole('button', { name: /demo document/ });
  await demo.waitFor({ state: 'visible', timeout: 20000 });
  await demo.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const b = await demo.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.locator('.sheet-inner').nth(3).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(4000);
  await scrollTop(page);
}
function watch(page, vw) {
  page.on('pageerror', (e) => errors.push({ viewport: vw, where: 'PAGEERROR', text: e.message.slice(0, 200) }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push({ viewport: vw, where: 'CONSOLE', text: m.text().slice(0, 200) }); });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // ================= 390x844 corrected full matrix =================
  {
    const VW = '390x844';
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, proxy: PROXY, acceptDownloads: true });
    const page = await ctx.newPage(); watch(page, VW);
    const session = await cdp(page);
    await loadDoc(page);
    rec('2. Load multi-page PDF (v2)', VW, 'PASS', 'pages=4');

    // --- drag tools behind the rail scroll ---
    const dragTools = [
      ['ink', 'Pen / draw (D)'], ['rect', 'Rectangle (R)'], ['ellipse', 'Ellipse (O)'],
      ['arrow', 'Arrow / pointer (A)'], ['redact', 'Redact (B)'], ['whiteout', 'Whiteout (W)'],
    ];
    for (const [id, title] of dragTools) {
      try {
        await tapBtnScroll(page, session, '.tool-rail', title);
        const cls = await toolActive(page, title);
        const active = /active/.test(cls || '');
        await scrollTop(page);
        const box = await sheetBox(page, 0);
        const before = await annCount(page);
        if (id === 'ink') {
          const cx = box.x + box.width / 2, cy = box.y + box.height * 0.5;
          await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 40, y: cy, id: 1 }] });
          for (const [dx, dy] of [[-20, -18], [0, 0], [20, 18], [40, 0]])
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dx, y: cy + dy, id: 1 }] });
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await touchDrag(session, box.x + box.width * 0.15, box.y + box.height * 0.45, box.x + box.width * 0.85, box.y + box.height * 0.6);
        }
        await page.waitForTimeout(700);
        const after = await annCount(page);
        const ok = active && after > before;
        const p = await shot(page, `v2-tool-${id}-390x844.png`);
        rec(`3. Tool: ${id} (touch-drag, rail-scrolled)`, VW, ok ? 'PASS' : 'FAIL', `active=${active}, anns ${before}→${after}, shot=${p}`);
        if (!ok) defect(active ? 'major' : 'critical', `${id}: ${active ? 'drag creates no annotation' : 'tool button does not activate on touch tap'}`, VW, `Scroll tool rail to ${title}, tap, touch-drag`, p);
      } catch (e) { rec(`3. Tool: ${id}`, VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }
    }

    // --- note tool ---
    try {
      await tapBtnScroll(page, session, '.tool-rail', 'Sticky note (N)');
      const cls = await toolActive(page, 'Sticky note (N)');
      await scrollTop(page);
      const box = await sheetBox(page, 0);
      const before = await annCount(page);
      await touchTap(session, box.x + box.width * 0.7, box.y + box.height * 0.5);
      await page.waitForTimeout(1000);
      const dlgOpen = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
      const after = await annCount(page);
      const p = await shot(page, 'v2-tool-note-390x844.png');
      const ok = after > before;
      rec('3. Tool: note (tap, rail-scrolled)', VW, ok ? 'PASS' : 'FAIL', `active=${/active/.test(cls || '')}, anns ${before}→${after}, dialog=${dlgOpen}, shot=${p}`);
      if (!ok) defect('major', 'Note tool: tap does not drop marker', VW, 'Scroll rail to Sticky note, tap, tap page', p);
      await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400);
    } catch (e) { rec('3. Tool: note', VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }

    // --- signature ---
    try {
      await tapBtnScroll(page, session, '.tool-rail', 'Signature (G)');
      const cls = await toolActive(page, 'Signature (G)');
      await scrollTop(page);
      const box = await sheetBox(page, 0);
      const before = await annCount(page);
      await touchTap(session, box.x + box.width * 0.5, box.y + box.height * 0.55);
      await page.waitForTimeout(1200);
      const dlg = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        if (!d) return null;
        const r = d.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x),
          canvas: Array.from(d.querySelectorAll('canvas')).map(c => { const q = c.getBoundingClientRect(); return Math.round(q.width) + 'x' + Math.round(q.height); }),
          btns: Array.from(d.querySelectorAll('button')).map(x => (x.textContent || '').trim().slice(0, 22)) };
      });
      const p1 = await shot(page, 'v2-sign-pad-390x844.png');
      let stamped = false;
      if (dlg && dlg.canvas.length) {
        const pb = await page.evaluate(() => { const c = document.querySelector('[role="dialog"] canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
        await touchDrag(session, pb.x + pb.w * 0.2, pb.y + pb.h * 0.5, pb.x + pb.w * 0.8, pb.y + pb.h * 0.5);
        await page.waitForTimeout(600);
        const useBtn = page.locator('[role="dialog"] button').filter({ hasText: /use|stamp|place|done|ok/i }).first();
        const nBtns = await page.locator('[role="dialog"] button').count();
        let clicked = false;
        if (await useBtn.count()) { try { await useBtn.click({ timeout: 5000 }); clicked = true; } catch {} }
        await page.waitForTimeout(900);
        const after = await annCount(page);
        stamped = clicked && after > before;
        const p2 = await shot(page, 'v2-sign-stamped-390x844.png');
        rec('3. Tool: signature (pad+stamp)', VW, stamped ? 'PASS' : 'FAIL', `active=${/active/.test(cls || '')}, pad=${!!dlg}, canvas=${JSON.stringify(dlg?.canvas)}, btns=${nBtns}, clicked=${clicked}, anns ${before}→${after}, shots=${p1},${p2}`);
        if (!stamped) defect('major', 'Signature flow broken on touch', VW, 'Signature tool → tap page → draw → confirm', p2);
      } else {
        rec('3. Tool: signature (pad+stamp)', VW, 'FAIL', `active=${/active/.test(cls || '')}, pad-opened=${!!dlg}, shot=${p1}`);
        defect('major', 'Sign pad dialog did not open on touch tap', VW, 'Scroll rail to Signature, tap, tap page', p1);
      }
      await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400);
    } catch (e) { rec('3. Tool: signature', VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }

    // --- image stamp ---
    try {
      await tapBtnScroll(page, session, '.tool-rail', 'Image stamp (I)');
      const cls = await toolActive(page, 'Image stamp (I)');
      await scrollTop(page);
      const box = await sheetBox(page, 0);
      const before = await annCount(page);
      await touchTap(session, box.x + box.width * 0.5, box.y + box.height * 0.6);
      await page.waitForTimeout(900);
      const inp = page.locator('input[type="file"]');
      const nInp = await inp.count();
      if (nInp) { await inp.first().setInputFiles(STAMP); await page.waitForTimeout(1200); }
      const after = await annCount(page);
      const p = await shot(page, 'v2-tool-image-390x844.png');
      const ok = after > before;
      rec('3. Tool: image stamp', VW, ok ? 'PASS' : 'FAIL', `active=${/active/.test(cls || '')}, file-inputs=${nInp}, anns ${before}→${after}, shot=${p}`);
      if (!ok) defect('major', 'Image stamp not placed via touch flow', VW, 'Image stamp tool → tap page → choose PNG', p);
      await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400);
    } catch (e) { rec('3. Tool: image stamp', VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }

    // --- form tools: text field + checkbox ---
    for (const [id, title] of [['textfield', 'Text field (F)'], ['checkbox', 'Checkbox (C)']]) {
      try {
        await tapBtnScroll(page, session, '.tool-rail', title);
        const cls = await toolActive(page, title);
        await scrollTop(page);
        const box = await sheetBox(page, 0);
        const before = await annCount(page);
        await touchDrag(session, box.x + box.width * 0.2, box.y + box.height * 0.65, box.x + box.width * 0.6, box.y + box.height * 0.72);
        await page.waitForTimeout(700);
        const after = await annCount(page);
        const widgets = await page.evaluate(() => document.querySelectorAll('.form-widget').length);
        const ok = /active/.test(cls || '') && (after > before || widgets > 0);
        const p = await shot(page, `v2-tool-${id}-390x844.png`);
        rec(`3. Tool: ${id}`, VW, ok ? 'PASS' : 'FAIL', `active=${/active/.test(cls || '')}, anns ${before}→${after}, widgets=${widgets}, shot=${p}`);
        if (!ok) defect('major', `${id}: drag does not place form widget`, VW, `Scroll rail to ${title}, tap, touch-drag`, p);
      } catch (e) { rec(`3. Tool: ${id}`, VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }
    }

    // --- inspector: draw rect, tap-select, check panel + color edit ---
    try {
      await tapBtnScroll(page, session, '.tool-rail', 'Rectangle (R)');
      await scrollTop(page);
      const box = await sheetBox(page, 0);
      await touchDrag(session, box.x + box.width * 0.2, box.y + box.height * 0.3, box.x + box.width * 0.5, box.y + box.height * 0.4);
      await page.waitForTimeout(700);
      await tapBtnScroll(page, session, '.tool-rail', 'Select & move (V)');
      const annBox = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('.sheet-overlay > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)'));
        const el = els[els.length - 1];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      let inspState = null, colorChanged = false, beforeFill = null;
      if (annBox) {
        const shape = page.locator('.sheet-overlay > :not(defs):not(.hit-hint):not(.form-widget):not(.search-hl)').last();
        beforeFill = await shape.evaluate((el) => el.getAttribute('fill') || el.getAttribute('stroke')).catch(() => null);
        await touchTap(session, annBox.x, annBox.y);
        await page.waitForTimeout(1000);
        inspState = await page.evaluate(() => {
          const d = document.querySelector('.inspector');
          if (!d) return { exists: false };
          const r = d.getBoundingClientRect(); const cs = getComputedStyle(d);
          return { exists: true, display: cs.display, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
            colorInputs: d.querySelectorAll('input[type="color"]').length, buttons: d.querySelectorAll('button').length };
        });
        const p1 = await shot(page, 'v2-inspector-390x844.png');
        if (inspState?.exists && inspState.w > 0 && inspState.colorInputs > 0) {
          const ci = page.locator('.inspector input[type="color"]').first();
          await ci.evaluate((el) => { el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
          await page.waitForTimeout(600);
          const afterFill = await shape.evaluate((el) => el.getAttribute('fill') || el.getAttribute('stroke')).catch(() => null);
          colorChanged = afterFill !== beforeFill;
        }
        const p2 = await shot(page, 'v2-inspector-colored-390x844.png');
        const drawerOk = !!(inspState?.exists && inspState.w > 0);
        rec('4. Select + inspector + color edit', VW, drawerOk && colorChanged ? 'PASS' : 'FAIL', `inspector=${JSON.stringify(inspState)}, color ${beforeFill}→changed=${colorChanged}, shots=${p1},${p2}`);
        if (!drawerOk) defect('major', 'Tap-to-select does not open inspector panel', VW, 'Draw rect → Select tool → tap annotation', p1);
        else if (!colorChanged) defect('minor', 'Inspector color edit does not apply', VW, 'Select annotation → set inspector color', p2);
      } else { rec('4. Select + inspector', VW, 'FAIL', 'no annotation to select'); }
    } catch (e) { rec('4. Select + inspector', VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }

    // --- dialogs via topbar scroll ---
    const dialogs = [
      ['Export options & document properties', 'v2-dialog-export'],
      ['Detect and fill PDF form fields (AcroForm)', 'v2-dialog-forms'],
      ['Compare the text of two PDFs side by side', 'v2-dialog-compare'],
      ['Private on-device AI (ask / summarize this document)', 'v2-dialog-ai'],
      ['Help', 'v2-dialog-help'],
    ];
    for (const [title, shotName] of dialogs) {
      try {
        await tapBtnScroll(page, session, '.topbar', title);
        await page.waitForTimeout(1000);
        const g = await page.evaluate(() => {
          const d = document.querySelector('[role="dialog"]');
          if (!d) return null;
          const r = d.getBoundingClientRect();
          return { x: Math.round(r.x), w: Math.round(r.width), sw: d.scrollWidth, cw: d.clientWidth };
        });
        const p = await shot(page, `${shotName}-390x844.png`);
        const vw = page.viewportSize().width;
        const fits = g && g.x >= 0 && g.x + g.w <= vw + 1 && g.sw <= g.cw + 1;
        rec(`5. Dialog: ${title.slice(0, 26)}…`, VW, g && fits ? 'PASS' : 'FAIL', `geom=${JSON.stringify(g)}, shot=${p}`);
        if (!(g && fits)) defect('major', `Dialog broken on mobile (${title.slice(0, 30)})`, VW, 'Scroll topbar right, tap button', p);
        await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      } catch (e) { rec(`5. Dialog: ${title.slice(0, 26)}`, VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }
    }

    // --- export download → valid PDF bytes ---
    try {
      await tapBtnScroll(page, session, '.topbar', 'Export options & document properties');
      await page.waitForTimeout(1000);
      const dlBtn = page.locator('[role="dialog"] button').filter({ hasText: /^Download PDF$/ }).first();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        dlBtn.click({ timeout: 8000 }),
      ]);
      const fp = await download.path();
      const buf = fs.readFileSync(fp);
      const head = buf.slice(0, 5).toString();
      const ok = head === '%PDF-';
      rec('5b. Export downloads valid PDF', VW, ok ? 'PASS' : 'FAIL', `bytes=${buf.length}, header=${JSON.stringify(head)}`);
      if (!ok) defect('critical', 'Export does not produce a valid PDF', VW, 'Export dialog → Download PDF', '');
      await page.keyboard.press('Escape').catch(() => {});
    } catch (e) { rec('5b. Export download', VW, 'FAIL', 'exception: ' + e.message.slice(0, 200)); }

    // --- Save CTA ---
    try {
      const saveCta = page.locator('button.save-cta').first();
      const vis = await saveCta.isVisible();
      let dlOk = false, note = '';
      if (vis) {
        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 30000 }),
            saveCta.click({ timeout: 8000 }),
          ]);
          const fp = await download.path();
          const buf = fs.readFileSync(fp);
          dlOk = buf.slice(0, 5).toString() === '%PDF-';
          note = `bytes=${buf.length}`;
        } catch (e) { note = 'no download: ' + e.message.slice(0, 100); }
      }
      rec('6. Topbar: Save CTA', VW, vis && dlOk ? 'PASS' : 'FAIL', `visible=${vis}, valid-pdf=${dlOk} ${note}`);
      if (!(vis && dlOk)) defect('major', 'Save CTA does not produce a valid PDF', VW, 'Tap Save in topbar', '');
    } catch (e) { rec('6. Topbar: Save CTA', VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }

    // --- pan/scroll with select tool via touch ---
    try {
      await tapBtnScroll(page, session, '.tool-rail', 'Select & move (V)');
      await scrollTop(page);
      const y0 = await page.evaluate(() => window.scrollY);
      const box = await sheetBox(page, 0);
      // slow upward swipe on empty canvas area
      await touchDrag(session, box.x + box.width * 0.5, box.y + box.height * 0.7, box.x + box.width * 0.5, box.y + box.height * 0.35, 20);
      await page.waitForTimeout(800);
      const y1 = await page.evaluate(() => window.scrollY);
      const p = await shot(page, 'v2-pan-390x844.png');
      const ok = y1 > y0 + 30;
      rec('10. Touch pan scrolls document (select mode)', VW, ok ? 'PASS' : 'FAIL', `scrollY ${y0}→${y1}, shot=${p}`);
      if (!ok) defect('major', 'Touch-drag on page does not scroll document in Select mode', VW, 'Select tool → slow swipe up on empty page area', p);
    } catch (e) { rec('10. Touch pan', VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }

    // --- input font sizes (re-verify) ---
    try {
      await tapBtnScroll(page, session, '.topbar', 'Export options & document properties');
      await page.waitForTimeout(800);
      const bad = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('input, textarea, select').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < 16) out.push(el.tagName + '.' + String(el.className).slice(0, 30) + '=' + fs);
          }
        });
        return out;
      });
      const p = await shot(page, 'v2-inputs-390x844.png');
      rec('9. Input font-size ≥16px (dialog)', VW, bad.length === 0 ? 'PASS' : 'FAIL', `bad=${JSON.stringify(bad)}, shot=${p}`);
      if (bad.length) defect('minor', 'Input(s) below 16px on mobile', VW, 'Open Export dialog', p);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    } catch (e) { rec('9. Input font-size', VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }

    await ctx.close();
  }

  // ================= smoke viewports =================
  const smokes = [[360, 740], [414, 896], [768, 1024], [844, 390]];
  for (const [w, h] of smokes) {
    const VW = `${w}x${h}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, proxy: PROXY });
    const page = await ctx.newPage(); watch(page, VW);
    const session = await cdp(page);
    try {
      await loadDoc(page);
      rec('2. Load multi-page PDF (smoke)', VW, 'PASS', 'pages=4');
      const p1 = await shot(page, `v2-s1-doc-${VW}.png`);
      // rect via rail scroll
      try {
        await tapBtnScroll(page, session, '.tool-rail', 'Rectangle (R)');
        await scrollTop(page);
        const box = await sheetBox(page, 0);
        const before = await annCount(page);
        await touchDrag(session, box.x + box.width * 0.2, box.y + box.height * 0.4, box.x + box.width * 0.6, box.y + box.height * 0.55);
        await page.waitForTimeout(700);
        const after = await annCount(page);
        const ok = after > before;
        const p = await shot(page, `v2-s2-rect-${VW}.png`);
        rec('3. Touch-draw rect (smoke)', VW, ok ? 'PASS' : 'FAIL', `anns ${before}→${after}, shot=${p}`);
        if (!ok) defect('critical', 'Touch-drag creates no annotation (smoke)', VW, 'Rail-scroll to Rectangle, tap, touch-drag', p);
      } catch (e) { rec('3. Touch-draw rect (smoke)', VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }
      // export dialog fit
      try {
        await tapBtnScroll(page, session, '.topbar', 'Export options & document properties');
        await page.waitForTimeout(1000);
        const g = await page.evaluate(() => {
          const d = document.querySelector('[role="dialog"]');
          if (!d) return null;
          const r = d.getBoundingClientRect();
          return { x: Math.round(r.x), w: Math.round(r.width), sw: d.scrollWidth, cw: d.clientWidth };
        });
        const p = await shot(page, `v2-s3-export-${VW}.png`);
        const fits = g && g.x >= 0 && g.x + g.w <= w + 1 && g.sw <= g.cw + 1;
        rec('5. Export dialog fits (smoke)', VW, g && fits ? 'PASS' : 'FAIL', `geom=${JSON.stringify(g)}, shot=${p}`);
        if (!(g && fits)) defect('major', 'Export dialog broken (smoke)', VW, 'Scroll topbar, tap Export', p);
        await page.keyboard.press('Escape').catch(() => {});
      } catch (e) { rec('5. Export dialog (smoke)', VW, 'FAIL', 'exception: ' + e.message.slice(0, 160)); }
      void p1;
    } catch (e) { rec('smoke load', VW, 'FAIL', 'exception: ' + e.message.slice(0, 200)); }
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(OUT + 'results2.json', JSON.stringify({ results, defects, errors }, null, 1));
  console.log(`QA2 DONE — items: ${results.length} defects: ${defects.length} errors: ${errors.length}`);
})().catch((e) => { console.error('QA2 FATAL', e); process.exit(1); });
