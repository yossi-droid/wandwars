import { test, expect } from '@playwright/test';

test('dig wheel sizes the visible cut and a fresh hole causes a fall', async ({ page }) => {
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
  await page.keyboard.down('q');
  const canvas = page.locator('#game');
  await expect(canvas).toHaveAttribute('data-dig-hitbox-visible', 'true');
  const firstFlowPhase = await canvas.getAttribute('data-dig-flow-phase');
  await expect.poll(() => canvas.getAttribute('data-dig-flow-phase')).not.toBe(firstFlowPhase);
  await page.screenshot({ path: '/tmp/wandwars-red-laser.png' });
  const initialLength = Number(await canvas.getAttribute('data-dig-preview-length'));
  const initialRadius = Number(await canvas.getAttribute('data-dig-preview-radius'));
  await canvas.hover();
  await page.mouse.wheel(0, -120);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-dig-preview-length')))
    .toBe(initialLength + 48);
  const firstRadius = Number(await canvas.getAttribute('data-dig-preview-radius'));
  expect(firstRadius).toBeLessThan(initialRadius);
  await page.mouse.wheel(0, -120);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-dig-preview-length')))
    .toBe(initialLength + 96);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-dig-preview-radius')))
    .toBeLessThan(firstRadius);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 120);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-dig-preview-length')))
    .toBe(initialLength + 48);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-dig-preview-radius')))
    .toBe(firstRadius);
  await expect(page.locator('#game-screen')).toHaveAttribute('data-dig-radius', '110');
  await page.keyboard.up('Shift');
  const before = await page.evaluate(() => window.__terrainDebug.snapshot());
  await canvas.dispatchEvent('mousedown', { button: 2 });
  await expect.poll(async () => windowOperationCount(page)).toBeGreaterThan(before.operations);
  const shot = await page.evaluate(() => window.__terrainDebug.snapshot());
  expect(shot.lastOperations.at(-1).length).toBeGreaterThan(72);
  expect(shot.lastOperations.at(-1).radius).toBeLessThan(initialRadius);
  await page.dispatchEvent('body', 'mouseup', { button: 2 });
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120);
  await expect(canvas).toHaveAttribute('data-dig-preview-length', '300');
  await expect(page.locator('#game-screen')).toHaveAttribute('data-dig-radius', '48');
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120);
  await expect(canvas).toHaveAttribute('data-dig-preview-length', '72');
  await expect(page.locator('#game-screen')).toHaveAttribute('data-dig-radius', '126');
  await page.evaluate(() => {
    window.__terrainDebug.resetTerrain();
    window.__terrainDebug.teleportClear();
  });
  await page.waitForTimeout(100);
  const top = (await page.evaluate(() => window.__terrainDebug.snapshot())).player.feetY;
  await page.evaluate(() => window.__terrainDebug.spawnTestRoom(130, 65));
  const afterCut = await page.evaluate(() => window.__terrainDebug.snapshot());
  expect(afterCut.player.feetY).toBeGreaterThan(top - 15);
  expect(afterCut.player.surfaceY).toBeLessThan(top - 50);
  await expect
    .poll(async () => (await page.evaluate(() => window.__terrainDebug.snapshot())).player.feetY)
    .toBeLessThan(top - 30);
  await page.screenshot({ path: '/tmp/wandwars-hole-fall.png' });
});

async function windowOperationCount(page) {
  return (await page.evaluate(() => window.__terrainDebug.snapshot())).operations;
}
