import { test, expect } from '@playwright/test';

async function startMatch(page) {
  await page.locator('#bots-picker button[data-bots="0"]').click();
  await page.locator('#play').click();
  await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
  await page.locator('#confirm-weapon').click();
  await expect(page.locator('#game-screen')).toHaveAttribute('data-starting', 'false', {
    timeout: 30_000,
  });
}

test('Dig can be pressed to toggle, with a saved Hold option in Settings', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?graphics=safe&terrainDebug=1');
  await page.locator('#settings-button').click();
  const control = page.locator('#setting-dig-control');
  await expect(control).toHaveValue('toggle');
  await page.locator('#settings-back').click();

  await startMatch(page);
  await page.evaluate(() => window.__terrainDebug.teleportClear());
  const screen = page.locator('#game-screen');
  const canvas = page.locator('#game');
  const initial = await page.evaluate(() => window.__terrainDebug.snapshot().operations);
  await page.keyboard.press('q');
  await expect(screen).toHaveAttribute('data-digging-mode', 'true');
  expect(await canvas.getAttribute('data-spectral-active')).toBeNull();
  await expect
    .poll(() => page.evaluate(() => window.__terrainDebug.snapshot().operations))
    .toBeGreaterThan(initial);
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q', repeat: true })),
  );
  await expect(screen).toHaveAttribute('data-digging-mode', 'true');
  await page.keyboard.press('q');
  await expect(screen).toHaveAttribute('data-digging-mode', 'false');
  await expect(canvas).toHaveAttribute('data-player-weapon-visible', 'true');

  await page.locator('#back').click();
  await page.locator('#settings-button').click();
  await control.selectOption('hold');
  await page.reload();
  await page.locator('#settings-button').click();
  await expect(control).toHaveValue('hold');
  await page.locator('#settings-back').click();
  await startMatch(page);
  await page.keyboard.down('q');
  await expect(screen).toHaveAttribute('data-digging-mode', 'true');
  await page.keyboard.up('q');
  await expect(screen).toHaveAttribute('data-digging-mode', 'false');
});
