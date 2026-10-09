/* Regenerates the README screenshots in docs/shots/ from the running app.
 * One command: npm run shots   (serves dist/ on :5198 first; see below)
 *
 * Usage:
 *   npm run build:pages && node scripts/subpath-server.cjs 5198 &
 *   SHOTS_BASE=http://localhost:5198/pdf-studio/ npm run shots
 *
 * Selectors that depend on UI text read the English catalog, so a renamed
 * button fails here with a clear message instead of silently drifting.
 * Chromium: uses Playwright's bundled browser; set SHOTS_CHROME to override.
 * Every file listed below is written, or the script exits 1.
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
const en = require('../src/locales/en/translation.json');

const BASE = process.env.SHOTS_BASE || 'http://localhost:5198/pdf-studio/';
const CHROME = process.env.SHOTS_CHROME || undefined;
const OUT = path.resolve(__dirname, '..', 'docs', 'shots');
const FORM_FIXTURE = path.resolve(__dirname, '..', 'public', 'form-test.pdf');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Click the first page canvas at the same offset capture.cjs used (the sign tool places on click). */
const clickPage = async (page) => {
  const c = await page.locator('canvas.sheet-canvas').first().boundingBox();
  await page.mouse.click(c.x + 380, c.y + 620);
};

const titled = (key) => `button[title="${en.app[key]}"]`;

async function openDemo(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText(/Open the demo document/).click();
  await page.waitForSelector('.sheet-inner', { timeout: 30000 });
  await wait(1500);
}

async function tool(page, re) {
  const btn = page.locator('.tool-rail button').filter({ hasText: re }).first();
  if (!(await btn.count())) {
    const titles = await page.locator('.tool-rail button').evaluateAll((els) => els.map((e) => e.innerText.trim()).filter(Boolean));
    throw new Error(`no tool matching ${re}; rail shows: ${titles.join(' | ')}`);
  }
  await btn.click();
  await wait(400);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), animations: 'disabled' });
}

const shots = {
  '01-hero.png': async (b) => {
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    await openDemo(page);
    return page;
  },
  '02-edit-hints.png': async (b) => {
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    await openDemo(page);
    await tool(page, /Edit/);
    await page.waitForSelector('.hit-hint', { timeout: 15000 });
    return page;
  },
  '03-annotate.png': async (b) => {
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    await openDemo(page);
    await tool(page, /Underline|Highlight/);
    const box = await page.locator('.sheet-inner').first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.2, { steps: 10 });
    await page.mouse.up();
    await wait(400);
    return page;
  },
  '04-redact.png': async (b) => {
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    await openDemo(page);
    await tool(page, /Redact/);
    const box = await page.locator('.sheet-inner').first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.36, { steps: 10 });
    await page.mouse.up();
    await wait(400);
    return page;
  },
  '05-signature-pad.png': async (b) => {
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    await openDemo(page);
    await tool(page, /Sign/);
    await clickPage(page);
    await page.waitForSelector('.modal canvas', { timeout: 10000 });
    await wait(500);
    const pad = await page.locator('.modal canvas').first().boundingBox();
    await page.mouse.move(pad.x + pad.width * 0.2, pad.y + pad.height * 0.55);
    await page.mouse.down();
    for (let i = 0; i < 16; i++) {
      await page.mouse.move(pad.x + pad.width * (0.2 + i * 0.045), pad.y + pad.height * (0.55 + Math.sin(i / 2) * 0.12), { steps: 2 });
    }
    await page.mouse.up();
    await wait(300);
    return page;
  },
  '05b-signature-placed.png': async (b) => {
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    await openDemo(page);
    await tool(page, /Sign/);
    await clickPage(page);
    await page.waitForSelector('.modal canvas', { timeout: 10000 });
    await wait(400);
    const pad = await page.locator('.modal canvas').first().boundingBox();
    await page.mouse.move(pad.x + pad.width * 0.2, pad.y + pad.height * 0.55);
    await page.mouse.down();
    for (let i = 0; i < 16; i++) {
      await page.mouse.move(pad.x + pad.width * (0.2 + i * 0.045), pad.y + pad.height * (0.55 + Math.sin(i / 2) * 0.12), { steps: 2 });
    }
    await page.mouse.up();
    await page.locator('button', { hasText: /Use this signature|Use signature/ }).first().click();
    await wait(400);
    await clickPage(page);
    await wait(900);
    return page;
  },
  '06-forms.png': async (b) => {
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('input[type=file]').first().setInputFiles(FORM_FIXTURE);
    await page.waitForSelector('.sheet-inner', { timeout: 30000 });
    await wait(1200);
    await page.locator(titled('formsTitle')).click();
    await wait(800);
    return page;
  },
  '07-compare.png': async (b) => {
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    await openDemo(page);
    await page.locator(titled('compareTitle')).click();
    await wait(800);
    return page;
  },
  '08-export.png': async (b) => {
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    await openDemo(page);
    await page.locator(titled('exportTitle')).click();
    await page.waitForSelector('.modal-wide', { timeout: 10000 });
    await wait(400);
    return page;
  },
  '09-ai.png': async (b) => {
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    await openDemo(page);
    await page.locator(titled('aiTitle')).click();
    await wait(800);
    return page;
  },
  '10-mobile.png': async (b) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await openDemo(page);
    return page;
  },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const failures = [];
  for (const [name, make] of Object.entries(shots)) {
    try {
      const page = await make(browser);
      await shot(page, name);
      console.log(`  wrote docs/shots/${name}`);
      await page.context().close();
    } catch (e) {
      failures.push(`${name}: ${e.message.split('\n')[0]}`);
      console.error(`  FAIL ${name}: ${e.message.split('\n')[0]}`);
    }
  }
  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} screenshot(s) failed`);
    process.exit(1);
  }
  console.log(`\nall ${Object.keys(shots).length} screenshots regenerated`);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
