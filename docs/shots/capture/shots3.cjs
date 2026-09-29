const { chromium } = require('playwright-core');

const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
const OUT = '/home/hatch/workspace/pdfstudio/docs/shots/';

async function openPdf(page, path) {
  // hidden input is always mounted at the App root; no filechooser needed
  await page.locator('input[type="file"][accept*="pdf"]').first().setInputFiles(path);
  await page.waitForTimeout(9000);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  // ---- FORMS ----
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await openPdf(page, '/home/hatch/workspace/pdfstudio/docs/shots/capture/form-demo.pdf');
  await page.getByRole('button', { name: 'Forms' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: OUT + '06-forms.png' });

  // ---- COMPARE ----
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Compare' }).click();
  await page.waitForTimeout(1000);
  const inputs = page.locator('input[type="file"][accept*="pdf"]');
  await inputs.nth(0).setInputFiles('/home/hatch/workspace/pdfstudio/docs/shots/capture/compare-a.pdf');
  await inputs.nth(1).setInputFiles('/home/hatch/workspace/pdfstudio/docs/shots/capture/compare-b.pdf');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Compare', exact: true }).last().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: OUT + '07-compare.png' });

  // ---- EXPORT ----
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.locator('button[title="Export options & document properties"]').click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: OUT + '08-export.png' });

  await browser.close();
  console.log('STAGE3 DONE');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
