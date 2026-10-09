/* Regenerates docs/demo.gif — the README hero animation.
 * Flow: open the demo document → press E (Edit text) → click a line of text →
 * retype it. Records a Playwright video, then converts it to a palette-optimised GIF.
 * Usage: SHOTS_BASE=http://localhost:5198/pdf-studio/ node scripts/make-demo-gif.cjs
 * Needs ffmpeg on PATH (set FFMPEG to override).
 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
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

const BASE = process.env.SHOTS_BASE || 'http://localhost:5198/pdf-studio/';
const OUT = path.resolve(__dirname, '..', 'docs', 'demo.gif');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const W = 1000;
const H = 625;
const REPLACEMENT = 'Retyped in PDF Studio';

(async () => {
  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfs-demo-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: videoDir, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /demo document/i }).click();
  await page.waitForSelector('.sheet-canvas', { timeout: 20_000 });
  await page.waitForTimeout(2000);

  await page.keyboard.press('e');
  await page.waitForTimeout(900);

  const hit = page.locator('.hit-hint[data-text]:not([data-text=""])').first();
  if ((await hit.count()) === 0) throw new Error('no edit-text hits rendered');
  await hit.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const box = await hit.boundingBox();
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.6);
  await page.waitForSelector('.inline-input', { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.keyboard.type(REPLACEMENT, { delay: 70 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  // The GIF is only useful if the edit actually landed: assert the replacement is rendered.
  const rendered = await page.evaluate((want) =>
    Array.from(document.querySelectorAll('svg.sheet-overlay text')).some((t) => (t.textContent || '').includes(want)),
    REPLACEMENT);
  if (!rendered) throw new Error('retyped text was not rendered; GIF would show a broken edit');
  await page.waitForTimeout(1200);

  await page.close();
  const video = await page.video();
  const webm = await video.path();
  await ctx.close();
  await browser.close();

  // Palette-optimised GIF: 12 fps, 800px wide, trimmed to the recorded session.
  const filter = 'fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5';
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', webm, '-vf', filter, '-loop', '0', OUT], { stdio: 'inherit' });
  fs.rmSync(videoDir, { recursive: true, force: true });
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bytes)`);
})().catch((e) => { console.error(e); process.exit(1); });
