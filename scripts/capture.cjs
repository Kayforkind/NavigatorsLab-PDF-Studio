/* Dev-only: capture in-depth screenshots of every PDF Studio feature.
 * Run: node scripts/capture.cjs  (expects the subpath server on :5198)   */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:5198/pdf-studio/';
const OUT = path.join(__dirname, '..', 'docs', 'shots');

async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

  /* ---------- 1. Landing ---------- */
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await wait(1200);
  await page.screenshot({ path: path.join(OUT, '01-landing.png') });

  /* ---------- open demo doc ---------- */
  await page.getByText('Open the demo document').click();
  await page.waitForSelector('canvas.sheet-canvas', { timeout: 15000 });
  await wait(1800);

  /* ---------- 2. Edit text: hints ---------- */
  await page.locator('button[title*="Edit text"]').first().click();
  await wait(1500);
  await page.screenshot({ path: path.join(OUT, '02-edit-hints.png') });

  /* ---------- 3. Edit text: inline editor ---------- */
  const sheet = await page.locator('canvas.sheet-canvas').first().boundingBox();
  // click the middle of the first hint rect
  const hint = await page.locator('.hit-hint').first().boundingBox();
  if (hint) {
    await page.mouse.click(hint.x + hint.width / 2, hint.y + hint.height / 2);
    await wait(700);
    await page.screenshot({ path: path.join(OUT, '03-edit-inline.png') });
    await page.keyboard.press('Escape');
    await wait(300);
  }

  /* ---------- 4. Annotate: highlight ---------- */
  await page.locator('button[title*="Highlight"]').first().click();
  await wait(400);
  await page.mouse.move(sheet.x + 120, sheet.y + 150);
  await page.mouse.down();
  await page.mouse.move(sheet.x + 420, sheet.y + 150, { steps: 8 });
  await page.mouse.up();
  await wait(500);
  await page.locator('button[title*="Pen"]').first().click();
  await wait(300);
  await page.mouse.move(sheet.x + 100, sheet.y + 300);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) await page.mouse.move(sheet.x + 100 + i * 22, sheet.y + 300 + Math.sin(i) * 30, { steps: 2 });
  await page.mouse.up();
  await wait(500);
  await page.locator('button[title*="Sticky note"]').first().click();
  await wait(300);
  await page.mouse.click(sheet.x + 300, sheet.y + 480);
  await wait(500);
  await page.keyboard.type('Action item: renew contract by Friday');
  await page.keyboard.press('Enter');
  await wait(600);
  await page.screenshot({ path: path.join(OUT, '04-annotate.png') });

  /* ---------- 5. Signature pad ---------- */
  await page.locator('button[title*="Signature"]').first().click();
  await wait(400);
  await page.mouse.click(sheet.x + 380, sheet.y + 620); // click page → pad opens
  await wait(900);
  const pad = await page.locator('.modal canvas').first().boundingBox();
  if (pad) {
    await page.mouse.move(pad.x + pad.width * 0.2, pad.y + pad.height * 0.55);
    await page.mouse.down();
    for (let i = 0; i < 16; i++) await page.mouse.move(pad.x + pad.width * (0.2 + i * 0.045), pad.y + pad.height * (0.55 + Math.sin(i / 2) * 0.12), { steps: 2 });
    await page.mouse.up();
  }
  await page.screenshot({ path: path.join(OUT, '05-signature-pad.png') });
  await page.locator('button:has-text("Use this signature")').first().click().catch(() => {});
  await wait(600);
  // the pending placement completes on the next page click
  await page.mouse.click(sheet.x + 380, sheet.y + 620);
  await wait(900);

  /* ---------- 6. Thumbnails & organize ---------- */
  await page.screenshot({ path: path.join(OUT, '06-pages-thumbs.png') });

  /* ---------- 7. Forms dialog ---------- */
  const formFile = path.join(__dirname, '..', 'dev-assets', 'h-form.pdf');
  if (fs.existsSync(formFile)) {
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles(formFile);
    await page.waitForSelector('canvas.sheet-canvas', { timeout: 15000 });
    await wait(2000);
    await page.locator('button:has-text("Forms")').first().click();
    await wait(1000);
    await page.screenshot({ path: path.join(OUT, '07-forms.png') });
    // show on pages + filled state
    const toggle = page.locator('.modal input[type=checkbox]').first();
    if (await toggle.count()) { await toggle.click(); await wait(900); }
    await page.keyboard.press('Escape');
    await wait(600);
    await page.screenshot({ path: path.join(OUT, '08-forms-on-canvas.png') });
  }

  /* ---------- 8. Export / stamps ---------- */
  const save = page.locator('button:has-text("Save")').first();
  await save.click();
  await wait(900);
  await page.screenshot({ path: path.join(OUT, '09-export-stamps.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await wait(500);

  /* ---------- 9. Compare ---------- */
  await page.locator('button:has-text("Compare")').first().click();
  await wait(800);
  await page.screenshot({ path: path.join(OUT, '10-compare.png') });
  await page.keyboard.press('Escape');
  await wait(500);

  /* ---------- 10. AI assistant ---------- */
  const ai = page.locator('button[title*="AI"], button:has-text("✦")').first();
  if (await ai.count()) {
    await ai.click();
    await wait(1000);
    await page.screenshot({ path: path.join(OUT, '11-ai.png') });
    await page.keyboard.press('Escape');
    await wait(400);
  }

  /* ---------- 11. Search ---------- */
  const sb = page.locator('input[placeholder*="earch"]').first();
  if (await sb.count()) {
    await sb.fill('payment');
    await sb.press('Enter');
    await wait(1200);
    await page.screenshot({ path: path.join(OUT, '12-search.png') });
  }

  await browser.close();
  console.log('done:', fs.readdirSync(OUT).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
