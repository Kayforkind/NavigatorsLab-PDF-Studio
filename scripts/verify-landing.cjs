/* Landing-page browser checks (issues #11, #12, #13).
 *   1. Landing loads no third-party hosts: every request must stay on the app origin
 *      (data:/blob: are local). Would have caught the Cloudflare beacon CSP violation.
 *   2. Under prefers-reduced-motion, no animation is running on .reveal, .cine-bg .orb,
 *      or .sw-old; in a normal context those same animations DO run (non-vacuous check).
 *   3. Toasts render inside an element with role="status" and aria-live="polite".
 * Usage: LANDING_BASE=http://localhost:5198/pdf-studio/ node scripts/verify-landing.cjs
 *   (CI serves the production URL shape on :5198/pdf-studio/.)
 *   Set LANDING_CHROME to an executable path to override the Playwright browser.
 */
const path = require('node:path');
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

const BASE = process.env.LANDING_BASE || 'http://localhost:5198/pdf-studio/';
const CHROME = process.env.LANDING_CHROME || undefined;
const origin = new URL(BASE).origin;
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const MOTION_SELECTORS = ['.reveal', '.cine-bg .orb', '.sw-old'];

/** Count running animations whose target matches one of the motion selectors. */
async function runningMotion(page) {
  return page.evaluate((selectors) => {
    const hits = [];
    for (const a of document.getAnimations()) {
      const el = a.effect && a.effect.target;
      if (!el || a.playState !== 'running') continue;
      if (selectors.some((s) => el.matches(s))) hits.push(el.className || el.tagName);
    }
    return hits;
  }, MOTION_SELECTORS);
}

(async () => {
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

  // ---------- 1. third-party hosts + 2a. motion running (normal context) ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    const foreign = [];
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (u.protocol === 'data:' || u.protocol === 'blob:') return;
      if (u.origin !== origin) foreign.push(req.url());
    });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    console.log('== landing, normal motion ==');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.landing', { timeout: 30000 });
    await page.waitForTimeout(1500);

    ok('no third-party hosts requested', foreign.length === 0, foreign.slice(0, 4).join(' | '));
    const running = await runningMotion(page);
    ok('animations run with normal motion (non-vacuous)', running.length > 0, `running=${running.length}`);
    ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

    // 3. toasts: the container must be a polite live region. Open the demo to trigger toasts.
    console.log('== toasts ==');
    await page.getByText(/Open the demo document/).click();
    await page.waitForSelector('canvas.sheet-canvas, .sheet-inner', { timeout: 30000 });
    await page.waitForTimeout(800);
    const live = await page.evaluate(() => {
      const c = document.querySelector('.toasts');
      if (!c) return { container: false };
      return { container: true, role: c.getAttribute('role'), live: c.getAttribute('aria-live'), toasts: c.querySelectorAll('.toast').length };
    });
    ok('toast container exists after opening a document', live.container, JSON.stringify(live));
    ok('toast container is role=status', live.container && live.role === 'status');
    ok('toast container is aria-live=polite', live.container && live.live === 'polite');
    await ctx.close();
  }

  // ---------- 2b. reduced motion: nothing running ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    console.log('== landing, reduced motion ==');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.landing', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const emulated = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    ok('reduced-motion is emulated', emulated);
    const running = await runningMotion(page);
    ok('no motion running under reduced motion', running.length === 0, running.slice(0, 4).join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
