const { chromium } = require('playwright-core');

const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const OUT = '/home/hatch/workspace/pdfstudio/docs/shots/';

async function drag(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /demo document/ }).click();
  // Render gate: page canvases exist AND the largest one has varied pixels
  // (the app draws its own overlays — no pdf.js .textLayer DOM here)
  try {
    await page.waitForFunction(
      () => {
        const cs = [...document.querySelectorAll('canvas')];
        if (cs.length < 5) return false;
        const big = cs.reduce((a, b) => (a.width * a.height > b.width * b.height ? a : b));
        try {
          const ctx = big.getContext('2d');
          const w = big.width, h = big.height;
          // sample a grid across the canvas; rendered pages have pixel variance
          const pts = [[w*0.2,h*0.2],[w*0.5,h*0.3],[w*0.8,h*0.5],[w*0.3,h*0.7],[w*0.6,h*0.85]];
          const vals = pts.map(([x, y]) => ctx.getImageData(x | 0, y | 0, 1, 1).data[0]);
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
          return variance > 30; // blank canvas => ~0 variance
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
  const canvasCount = await page.evaluate(() => document.querySelectorAll('canvas').length);
  console.log('canvases:', canvasCount);

  // --- Highlight the Privacy bullet + underline the Merge bullet ---
  await page.keyboard.press('h');
  await page.waitForTimeout(400);
  await drag(page, 468, 744, 1055, 762);
  await page.waitForTimeout(600);
  await page.keyboard.press('u');
  await page.waitForTimeout(400);
  await drag(page, 468, 710, 1010, 716);
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '03-annotate.png' });

  // --- Redact the tagline ---
  await page.keyboard.press('b');
  await page.waitForTimeout(400);
  await drag(page, 390, 326, 985, 366);
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '04-redact.png' });

  // --- Signature: sign mode -> click page -> draw flourish -> use ---
  await page.keyboard.press('g');
  await page.waitForTimeout(400);
  await page.mouse.click(800, 620);
  const pad = page.locator('canvas.sign-pad');
  await pad.waitFor({ timeout: 15000 });
  const pb = await pad.boundingBox();
  const ox = pb.x + 70, oy = pb.y + pb.height * 0.55;
  const stroke = [
    [0,0],[8,-16],[20,-26],[34,-24],[42,-12],[36,0],[22,6],[10,0],          // loop
    [26,-8],[55,-14],[90,-6],[125,-18],[160,-8],[195,-18],[230,-8],[265,-14], // name wave
    [295,-4],[325,-10],[355,-2],[385,-8],                                     // tail
  ];
  const swash = [[-30,34],[60,42],[160,36],[260,44],[360,34],[440,40]];       // underline flourish
  await page.mouse.move(ox, oy);
  await page.mouse.down();
  for (const [dx, dy] of stroke) { await page.mouse.move(ox + dx, oy + dy, { steps: 2 }); }
  for (const [dx, dy] of swash) { await page.mouse.move(ox + dx, oy + dy, { steps: 2 }); }
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '05-signature-pad.png' });
  await page.getByRole('button', { name: /Use this signature/ }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + '05b-signature-placed.png' });

  await browser.close();
  console.log('STAGE2 DONE');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
