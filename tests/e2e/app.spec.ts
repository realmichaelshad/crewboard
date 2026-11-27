import { expect, test, type Page } from '@playwright/test';

const problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems.length = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:5312/')) problems.push(`outside request: ${r.url()}`);
  });
});

test.afterEach(() => {
  expect(problems, problems.join('\n')).toEqual([]);
});

async function total(page: Page, key: string): Promise<number> {
  return Number(await page.locator(`[data-total="${key}"]`).getAttribute('data-value'));
}

async function cellOf(page: Page, id: string): Promise<string | null> {
  return page.locator(`[data-job="${id}"]`).evaluate((el) => el.closest('[data-cell]')?.getAttribute('data-cell') ?? null);
}

async function planAndCheck(page: Page) {
  const before = {
    drive: await total(page, 'drive'),
    ot: await total(page, 'ot'),
    win: await total(page, 'win'),
    un: await total(page, 'un'),
  };
  expect(before.ot).toBeGreaterThan(0);
  expect(before.win).toBeGreaterThan(0);
  await page.locator('[data-plan]').click();
  await expect(page.locator('[data-plan]')).toHaveAttribute('aria-busy', 'true');
  const result = page.locator('[data-result]');
  await expect(result).toBeVisible({ timeout: 20000 });
  const after = {
    drive: await total(page, 'drive'),
    ot: await total(page, 'ot'),
    win: await total(page, 'win'),
    un: await total(page, 'un'),
  };
  expect(after.drive).toBeLessThan(before.drive * 0.75);
  expect(after.ot).toBe(0);
  expect(after.win).toBe(0);
  expect(after.un).toBe(0);
  await expect(result).toContainText('Drive time');
  await expect(result).toContainText('now');
  return { before, after };
}

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone only');

  test('moves a card by press-and-hold drag, then by the Move sheet, then plans the week', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-job]').first()).toBeVisible();
    await expect(page.getByText('Demo data. The town, crews and customers are fictional.')).toBeVisible();
    // Make room: fold the map so two crew lanes are on screen.
    await page.getByRole('button', { name: /Map, Monday/ }).tap();

    // Press and hold the first card of Marta's Monday, drag it into Owen's Monday.
    const card = page.locator('[data-cell="0"] [data-job]').first();
    const id = (await card.getAttribute('data-job'))!;
    const from = (await card.boundingBox())!;
    const to = (await page.locator('[data-cell="5"] [data-job]').first().boundingBox())!;
    const driveBefore = await total(page, 'drive');
    const cdp = await page.context().newCDPSession(page);
    const sx = from.x + 60;
    const sy = from.y + 20;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
    await page.waitForTimeout(500);
    await expect(page.locator('.ghost-card')).toBeVisible();
    const tx = to.x + 60;
    const ty = to.y + 8;
    for (let k = 1; k <= 14; k++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: sx + ((tx - sx) * k) / 14, y: sy + ((ty - sy) * k) / 14 }],
      });
      await page.waitForTimeout(16);
    }
    await expect(page.locator('[data-cell="5"] .drop-ind')).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => cellOf(page, id)).toBe('5');
    expect(await total(page, 'drive')).not.toBe(driveBefore);

    // Move another card with the sheet of valid destinations.
    const second = page.locator('[data-cell="0"] [data-job]').first();
    const id2 = (await second.getAttribute('data-job'))!;
    await second.getByRole('button', { name: 'Move' }).tap();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    const firstDest = sheet.locator('.dest').first();
    const label = await firstDest.innerText();
    await firstDest.tap();
    await expect(sheet).toBeHidden();
    await expect.poll(() => cellOf(page, id2)).not.toBe('0');
    expect(label).toMatch(/stop/);

    await planAndCheck(page);
    // No flag is left on any day.
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      await page.getByRole('tab', { name: d }).tap();
      await expect(page.locator('.flag')).toHaveCount(0);
      await expect(page.locator('.over')).toHaveCount(0);
    }
  });

  test('crew view checks off a stop and keeps it after a reload', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('tab', { name: 'Crew view' }).tap();
    const box = page.locator('.check input').first();
    await box.check();
    await expect(page.locator('.it-stop.done')).toHaveCount(1);
    await page.waitForTimeout(300);
    await page.reload();
    await page.getByRole('tab', { name: 'Crew view' }).tap();
    await expect(page.locator('.it-stop.done')).toHaveCount(1);
  });
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop only');

  test('drags a card with the mouse, plans the week, and undoes it', async ({ page }) => {
    await page.goto('./');
    const card = page.locator('[data-cell="0"] [data-job]').first();
    const id = (await card.getAttribute('data-job'))!;
    const box = (await card.boundingBox())!;
    const target = (await page.locator('[data-cell="1"] [data-job]').nth(1).boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 14);
    await page.mouse.down();
    await page.mouse.move(box.x + 70, box.y + 30, { steps: 3 });
    await page.mouse.move(target.x + 50, target.y + target.height - 6, { steps: 10 });
    await expect(page.locator('.ghost-card .drop-chip')).toBeVisible();
    await expect(page.locator('[data-cell="1"] .drop-ind')).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => cellOf(page, id)).toBe('1');
    const manual = await total(page, 'drive');

    const { after } = await planAndCheck(page);
    // The desktop board renders every cell, so this covers the whole week.
    await expect(page.locator('.flag')).toHaveCount(0);
    await expect(page.locator('.over')).toHaveCount(0);
    expect(after.drive).toBeLessThan(manual);

    await page.getByRole('button', { name: 'Undo' }).first().click();
    await expect.poll(() => total(page, 'drive')).toBe(manual);
    await expect.poll(() => cellOf(page, id)).toBe('1');
  });

  test('adds a job and fits it in at the cheapest valid spot', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Add a job' }).click();
    await page.getByRole('combobox', { name: 'Job', exact: true }).selectOption('mowing');
    await page.getByRole('button', { name: 'Add to backlog' }).click();
    const added = page.locator('[data-cell="backlog"] [data-job^="N"]');
    await expect(added).toHaveCount(1);
    expect(await total(page, 'un')).toBe(4);
    await added.getByRole('button', { name: 'Fit it in' }).click();
    await expect(page.locator('.toast')).toContainText('Adds');
    await expect(page.locator('[data-cell="backlog"] [data-job^="N"]')).toHaveCount(0);
    expect(await total(page, 'un')).toBe(3);
  });

  test('attract mode runs by itself and hands over on input', async ({ page }) => {
    await page.goto('./?attract=1');
    await expect(page.locator('.app.attract')).toBeVisible();
    await expect(page.locator('[data-result]')).toBeVisible({ timeout: 20000 });
    expect(await total(page, 'ot')).toBe(0);
    await page.mouse.click(700, 500);
    await expect(page.locator('.app.attract')).toHaveCount(0);
    expect(await total(page, 'ot')).toBeGreaterThan(0);
  });
});
