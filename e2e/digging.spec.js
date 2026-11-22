import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wandwars-dig-control', 'hold'));
});

test('precision and charged drills visibly change terrain in every direction', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?graphics=safe&terrainDebug=1');
  await page.locator('#bots-picker button[data-bots="0"]').click();
  await page.locator('#play').click();
  await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
  await page.locator('#confirm-weapon').click();
  await expect(page.locator('#game-screen')).toHaveAttribute('data-starting', 'false', {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__terrainDebug.teleportClear());
  const snapshot = () => page.evaluate(() => window.__terrainDebug.snapshot());
  const canvas = page.locator('#game');
  await page.keyboard.down('q');
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-mode', 'true');
  let before = (await snapshot()).operations;
  await canvas.dispatchEvent('mousedown', { button: 0 });
  await expect.poll(async () => (await snapshot()).operations).toBeGreaterThan(before);
  expect((await snapshot()).lastOperations.at(-1).dirX).toBeGreaterThan(0.9);
  await page.dispatchEvent('body', 'mouseup', { button: 0 });
  await page.screenshot({ path: '/tmp/wandwars-precision-forward.png' });

  before = (await snapshot()).operations;
  await canvas.dispatchEvent('mousedown', { button: 2 });
  await expect.poll(async () => (await snapshot()).operations).toBeGreaterThan(before);
  await expect.poll(async () => (await snapshot()).lastOperations.at(-1).dirY).toBe(-1);
  await page.dispatchEvent('body', 'mouseup', { button: 2 });
  await page.screenshot({ path: '/tmp/wandwars-precision-down.png' });

  await page.keyboard.press('Shift');
  await expect.poll(async () => (await snapshot()).digging.runOn).toBe(true);
  before = (await snapshot()).operations;
  await page.keyboard.down('v');
  await expect.poll(async () => (await snapshot()).digging.charge).toBeGreaterThan(0.1);
  await page.screenshot({ path: '/tmp/wandwars-drill-charge.png' });
  await expect.poll(async () => (await snapshot()).operations).toBeGreaterThan(before);
  expect((await snapshot()).lastOperations.at(-1).dirX).toBeGreaterThan(0.9);
  await page.screenshot({ path: '/tmp/wandwars-drill-forward.png' });
  await page.keyboard.up('v');
  await expect.poll(async () => (await snapshot()).digging.direction).toBeNull();

  await page.keyboard.down('Space');
  before = (await snapshot()).operations;
  await page.keyboard.down('v');
  await expect.poll(async () => (await snapshot()).digging.charge).toBeGreaterThan(0.1);
  await page.screenshot({ path: '/tmp/wandwars-drill-up-charge.png' });
  await expect.poll(async () => (await snapshot()).operations).toBeGreaterThan(before);
  expect((await snapshot()).lastOperations.at(-1).dirY).toBe(1);
  await page.screenshot({ path: '/tmp/wandwars-drill-up.png' });
  await page.keyboard.up('v');
  await page.keyboard.up('Space');
  await expect.poll(async () => (await snapshot()).digging.direction).toBeNull();

  await page.keyboard.down('Control');
  before = (await snapshot()).operations;
  await page.keyboard.down('v');
  await expect.poll(async () => (await snapshot()).digging.charge).toBeGreaterThan(0.1);
  await page.screenshot({ path: '/tmp/wandwars-drill-down-charge.png' });
  await expect.poll(async () => (await snapshot()).operations).toBeGreaterThan(before);
  expect((await snapshot()).lastOperations.at(-1).dirY).toBe(-1);
  await page.screenshot({ path: '/tmp/wandwars-drill-down.png' });
  await page.keyboard.up('v');
  await page.keyboard.up('Control');

  await page.keyboard.up('q');
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-mode', 'false');
  await page.screenshot({ path: '/tmp/wandwars-combat-restored.png' });
});
