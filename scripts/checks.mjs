// Extra checks beyond the end-to-end tests: small and landscape phones, tablet, reduced motion, an
// iframe, and the optimizer's run time under 4x CPU throttling. Screenshots go to shots/check-*.png.
// Usage: npm run build && node scripts/checks.mjs
import { chromium } from '@playwright/test';
import { startServer } from './serve.mjs';

const server = await startServer(5312);
const base = 'http://127.0.0.1:5312/dist/';
const browser = await chromium.launch();
const problems = [];
const shot = (page, name) => page.screenshot({ path: `shots/check-${name}.png` });

async function open(opts, url = base) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(url);
  return { ctx, page };
}

async function noSideScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (over > 0) problems.push(`${label}: page scrolls sideways by ${over}px`);
}

try {
  for (const [name, viewport] of [
    ['phone-360', { width: 360, height: 740 }],
    ['phone-landscape', { width: 844, height: 390 }],
    ['tablet-768', { width: 768, height: 1024 }],
  ]) {
    const { ctx, page } = await open({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.waitForSelector('[data-job]');
    await page.waitForTimeout(400);
    await noSideScroll(page, name);
    await shot(page, name);
    await ctx.close();
  }

  // Reduced motion: everything still works, without glides.
  {
    const { ctx, page } = await open({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    await page.locator('[data-plan]').tap();
    await page.waitForSelector('[data-result]', { timeout: 20000 });
    await page.waitForTimeout(300);
    await shot(page, 'reduced-motion-planned');
    console.log('reduced motion: planned, overtime =', await page.locator('[data-total="ot"]').getAttribute('data-value'));
    await ctx.close();
  }

  // Inside an iframe, as a page that embeds the app would show it.
  {
    const { ctx, page } = await open(
      { viewport: { width: 1200, height: 800 } },
      'http://127.0.0.1:5312/scripts/iframe-host.html',
    );
    const frame = page.frameLocator('iframe');
    await frame.locator('[data-job]').first().waitFor();
    await frame.locator('[data-plan]').click();
    await frame.locator('[data-result]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    await shot(page, 'iframe');
    console.log('iframe: planned inside the frame');
    await ctx.close();
  }

  // Optimizer under 4x CPU throttling.
  {
    const { ctx, page } = await open({ viewport: { width: 1440, height: 900 } });
    await page.waitForSelector('[data-job]');
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await page.locator('[data-plan]').click();
    await page.waitForSelector('[data-result]', { timeout: 60000 });
    const wall = Date.now() - t0;
    const ms = await page.evaluate(() => document.documentElement.dataset.planMs);
    console.log(`4x CPU throttling: worker reports ${ms} ms, ${wall} ms from press to result line`);
    await ctx.close();
  }
  // Chrome's CPU throttling does not reach Web Workers, so time the same optimizer on the main thread.
  {
    const { ctx, page } = await open({ viewport: { width: 1440, height: 900 } }, base + '?bench=1');
    await page.waitForSelector('[data-job]');
    const plain = await page.evaluate(() => window.__bench());
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const runs = [];
    for (let k = 0; k < 3; k++) runs.push(await page.evaluate(() => window.__bench()));
    console.log(
      `optimizer on the main thread: ${plain.toFixed(0)} ms unthrottled, ${runs.map((r) => r.toFixed(0)).join(' / ')} ms at 4x throttling`,
    );
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.error('Problems:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('checks passed');
