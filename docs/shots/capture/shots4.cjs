const { chromium } = require('playwright-core');

const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const OUT = '/home/hatch/workspace/pdfstudio/docs/shots/';

async function renderGate(page) {
  // Try the strict canvas gate briefly; fall back to a fixed render wait.
  // (The strict gate hangs on viewports/dialogs that legitimately render
  // fewer canvases — e.g. mobile. A fixed wait + visual verification wins.)
  try {
    await page.waitForFunction(
      () => {
        const cs = [...document.querySelectorAll('canvas')];
        if (cs.length < 5) return false;
        const big = cs.reduce((a, b) => (a.width * a.height > b.width * b.height ? a : b));
        try {
          const ctx = big.getContext('2d');
          const w = big.width, h = big.height;
          const pts = [[w*0.2,h*0.2],[w*0.5,h*0.3],[w*0.8,h*0.5],[w*0.3,h*0.7],[w*0.6,h*0.85]];
          const vals = pts.map(([x, y]) => ctx.getImageData(x | 0, y | 0, 1, 1).data[0]);
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
          return variance > 30;
        } catch { return true; }
      },
      undefined,
      { timeout: 25000, polling: 1500 }
    );
  } catch {
    console.log('renderGate: strict gate timed out, using fixed 8s render wait');
    await page.waitForTimeout(8000);
  }
  await page.waitForTimeout(2500);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // ---- AI DIALOG ----
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /demo document/ }).click();
    await renderGate(page);
    await page.locator('button[title*="on-device AI"]').click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: OUT + '09-ai.png' });
    await page.close();
  }

  // ---- MOBILE ----
  {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /demo document/ }).click();
    await renderGate(page);
    await page.waitForTimeout(7000); // let the "Opened ..." toast dismiss
    await page.screenshot({ path: OUT + '10-mobile.png' });
    await page.close();
  }

  await browser.close();
  console.log('STAGE4 DONE');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
