const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell';
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto('http://127.0.0.1:8901/pdf-studio/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const demo = page.getByRole('button', { name: /demo document/ });
  await demo.waitFor({ state: 'visible', timeout: 30000 });
  await demo.click();
  await page.locator('.sheet-inner').nth(3).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(2000);
  const m = await page.evaluate(() => {
    const tb = document.querySelector('.topbar');
    const save = document.querySelector('.save-cta').getBoundingClientRect();
    return { scrollW: document.documentElement.scrollWidth, tbScrollW: tb.scrollWidth, tbClientW: tb.clientWidth,
      saveRight: Math.round(save.right), innerW: window.innerWidth };
  });
  await page.screenshot({ path: 'd1fix-desktop-1440x900.png' });
  console.log(JSON.stringify(m));
  await browser.close();
})();
