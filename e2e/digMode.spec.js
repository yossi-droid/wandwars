import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wandwars-dig-control', 'hold'));
});

test('one click fires one rounded digging laser and restores combat', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?graphics=safe&terrainDebug=1');
  await page.locator('#bots-picker button[data-bots="0"]').click();
  await page.locator('#play').click();
  await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
  await page.locator('#confirm-weapon').click();
  await expect(page.locator('#game-screen')).toHaveAttribute('data-starting', 'false', {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__terrainDebug.teleportClear());
  const canvas = page.locator('#game');
  const snapshot = () => page.evaluate(() => window.__terrainDebug.snapshot());
  const initial = await snapshot();
  await page.keyboard.down('q');
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-mode', 'true');
  await expect(canvas).toHaveAttribute('data-dig-beam-visible', 'false');
  await expect(canvas).toHaveAttribute('data-dig-hitbox-visible', 'true');
  await expect(canvas).toHaveAttribute('data-dig-preview-direction', 'forward');
  await expect(canvas).toHaveAttribute('data-dig-preview-length', String(72));
  await expect(canvas).toHaveAttribute('data-dig-arm-joint', 'mixamorigRightArm');
  await expect(canvas).toHaveAttribute('data-dig-hand-attached', 'true');
  expect(await canvas.getAttribute('data-spectral-active')).toBeNull();
  await page.waitForTimeout(450);
  expect((await snapshot()).operations).toBe(initial.operations);
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-action', 'false');
  await canvas.dispatchEvent('mousedown', { button: 0 });
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-action', 'true');
  await expect(canvas).toHaveAttribute('data-dig-beam-visible', 'true');
  await expect.poll(async () => (await snapshot()).operations).toBe(initial.operations + 1);
  await page.waitForTimeout(650);
  await expect(canvas).toHaveAttribute('data-dig-beam-visible', 'false');
  expect((await snapshot()).operations).toBe(initial.operations + 1);
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-action', 'false');
  const held = await snapshot();
  expect(held.lastOperations.at(-1).shape).toBe('capsule');
  expect(held.lastOperations.at(-1).radius).toBeGreaterThanOrEqual(126);
  expect(Number(await canvas.getAttribute('data-dig-preview-radius'))).toBeGreaterThanOrEqual(126);
  expect(held.player.mana).toEqual(initial.player.mana);
  expect(held.player.inventory).toEqual(initial.player.inventory);
  expect(held.player.baseWeaponId).toBe(initial.player.baseWeaponId);
  const beamStartX = Number(await canvas.getAttribute('data-dig-beam-start-x'));
  const beamStartZ = Number(await canvas.getAttribute('data-dig-beam-start-z'));
  expect(Math.hypot(beamStartX - held.player.x, beamStartZ - held.player.y)).toBeLessThan(120);
  await page.dispatchEvent('body', 'mouseup', { button: 0 });
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-action', 'false');
  const afterForward = (await snapshot()).operations;
  await page.waitForTimeout(450);
  expect((await snapshot()).operations).toBe(afterForward);
  await canvas.dispatchEvent('mousedown', { button: 2 });
  await expect(canvas).toHaveAttribute('data-dig-preview-direction', 'down');
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-action', 'false');
  await canvas.dispatchEvent('mouseup', { button: 2 });
  await expect(canvas).toHaveAttribute('data-dig-preview-direction', 'forward');
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-action', 'false');
  await page.keyboard.up('q');
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-mode', 'false');
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-action', 'false');
  await expect(canvas).toHaveAttribute('data-player-weapon-visible', 'true');
  await expect(canvas).toHaveAttribute('data-dig-beam-visible', 'false');
  await expect(canvas).toHaveAttribute('data-dig-hitbox-visible', 'false');
  const stopped = (await snapshot()).operations;
  await page.waitForTimeout(450);
  expect((await snapshot()).operations).toBe(stopped);

  for (let index = 0; index < 5; index++) {
    await page.keyboard.down('q');
    await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-mode', 'true');
    await page.keyboard.up('q');
    await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-mode', 'false');
  }
  expect(await canvas.getAttribute('data-spectral-active')).toBeNull();
});

test('Dig works with every base weapon', async ({ page }) => {
  test.setTimeout(180_000);
  for (const weaponId of [
    'apprentice-wand',
    'focusing-crystal-staff',
    'thunderclap-gauntlet',
    'arcane-spellbook',
    'enchanted-bow',
    'chaos-orb',
  ]) {
    await page.goto('/?graphics=safe&terrainDebug=1');
    await page.locator('#bots-picker button[data-bots="0"]').click();
    await page.locator('#play').click();
    await page.locator(`.weapon-card[data-weapon="${weaponId}"]`).click();
    await page.locator('#confirm-weapon').click();
    await expect(page.locator('#game-screen')).toHaveAttribute('data-starting', 'false', {
      timeout: 30_000,
    });
    const canvas = page.locator('#game');
    await page.keyboard.down('q');
    await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-mode', 'true');
    expect(await canvas.getAttribute('data-spectral-active')).toBeNull();
    await page.keyboard.up('q');
    await expect(canvas).toHaveAttribute('data-player-weapon-visible', 'true');
    expect(await page.evaluate(() => window.__terrainDebug.snapshot().player.baseWeaponId)).toBe(
      weaponId,
    );
  }
});

test('the held Dig action uses the customized key binding', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('wandwars-key-bindings', JSON.stringify({ dig: 'KeyZ' })),
  );
  await page.goto('/?graphics=safe');
  await page.locator('#bots-picker button[data-bots="0"]').click();
  await page.locator('#play').click();
  await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
  await page.locator('#confirm-weapon').click();
  const screen = page.locator('#game-screen');
  await expect(screen).toHaveAttribute('data-starting', 'false', { timeout: 30_000 });
  await page.keyboard.press('q');
  await expect(screen).toHaveAttribute('data-digging-mode', 'false');
  await page.keyboard.down('z');
  await expect(screen).toHaveAttribute('data-digging-mode', 'true');
  await page.keyboard.up('z');
  await expect(screen).toHaveAttribute('data-digging-mode', 'false');
});

test('the laser fires at unbreakable terrain without removing it', async ({ page }) => {
  await page.goto('/?graphics=safe&terrainDebug=1');
  await page.locator('#bots-picker button[data-bots="0"]').click();
  await page.locator('#play').click();
  await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
  await page.locator('#confirm-weapon').click();
  await expect(page.locator('#game-screen')).toHaveAttribute('data-starting', 'false', {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__terrainDebug.teleportClear());
  const canvas = page.locator('#game');
  const before = await page.evaluate(() => window.__terrainDebug.snapshot().operations);
  await page.keyboard.down('q');
  await expect(canvas).toHaveAttribute('data-dig-beam-visible', 'false');
  // Protect the point the camera actually targets. The third-person camera
  // can see farther than a fixed offset from the wizard.
  await page.evaluate(() => {
    const canvas = document.querySelector('#game');
    window.__terrainDebug.markVolume({
      x: Number(canvas.dataset.digBeamEndX),
      z: Number(canvas.dataset.digBeamEndZ),
      y: Number(canvas.dataset.digBeamEndY),
      radius: 48,
      height: 120,
      kind: 'indestructible',
    });
  });
  await expect(canvas).toHaveAttribute('data-dig-target-valid', 'false');
  await expect(canvas).toHaveAttribute('data-dig-hitbox-visible', 'true');
  await canvas.dispatchEvent('mousedown', { button: 0 });
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-action', 'true');
  await expect(canvas).toHaveAttribute('data-dig-beam-visible', 'true');
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => window.__terrainDebug.snapshot().operations)).toBe(before);
  await page.dispatchEvent('body', 'mouseup', { button: 0 });
  await page.keyboard.up('q');
});

test('looking up aims and fires the laser into empty sky', async ({ page }) => {
  await page.goto('/?graphics=safe&terrainDebug=1');
  await page.locator('#bots-picker button[data-bots="0"]').click();
  await page.locator('#play').click();
  await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
  await page.locator('#confirm-weapon').click();
  await expect(page.locator('#game-screen')).toHaveAttribute('data-starting', 'false', {
    timeout: 30_000,
  });
  const canvas = page.locator('#game');
  await canvas.dispatchEvent('mousemove', { movementY: -600 });
  await expect
    .poll(async () => Number(await page.locator('#game-screen').getAttribute('data-camera-pitch')))
    .toBeGreaterThan(0.8);
  await page.keyboard.down('q');
  await expect(canvas).toHaveAttribute('data-dig-beam-visible', 'false');
  await expect(canvas).toHaveAttribute('data-dig-target-valid', 'false');
  await expect
    .poll(async () => {
      const start = Number(await canvas.getAttribute('data-dig-beam-start-y'));
      const end = Number(await canvas.getAttribute('data-dig-beam-end-y'));
      return end - start;
    })
    .toBeGreaterThan(250);
  const before = await page.evaluate(() => window.__terrainDebug.snapshot().operations);
  await canvas.dispatchEvent('mousedown', { button: 0 });
  await expect(page.locator('#game-screen')).toHaveAttribute('data-digging-action', 'true');
  await expect(canvas).toHaveAttribute('data-dig-beam-visible', 'true');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__terrainDebug.snapshot().operations)).toBe(before);
  await page.dispatchEvent('body', 'mouseup', { button: 0 });
  await page.keyboard.up('q');
});

test('the camera and digging laser can aim straight down', async ({ page }) => {
  await page.goto('/?graphics=safe&terrainDebug=1');
  await page.locator('#bots-picker button[data-bots="0"]').click();
  await page.locator('#play').click();
  await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
  await page.locator('#confirm-weapon').click();
  await expect(page.locator('#game-screen')).toHaveAttribute('data-starting', 'false', {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__terrainDebug.teleportClear());
  const canvas = page.locator('#game');
  await canvas.dispatchEvent('mousemove', { movementY: 1000 });
  await expect
    .poll(async () => Number(await page.locator('#game-screen').getAttribute('data-camera-pitch')))
    .toBeLessThan(-1.55);
  await page.keyboard.down('q');
  await expect(canvas).toHaveAttribute('data-dig-beam-visible', 'false');
  await expect
    .poll(async () => {
      const start = Number(await canvas.getAttribute('data-dig-beam-start-y'));
      const end = Number(await canvas.getAttribute('data-dig-beam-end-y'));
      return end - start;
    })
    .toBeLessThan(-50);
  await canvas.dispatchEvent('mousedown', { button: 0 });
  await expect(canvas).toHaveAttribute('data-dig-beam-visible', 'true');
  await page.screenshot({ path: '/tmp/wandwars-straight-down.png' });
  await page.dispatchEvent('body', 'mouseup', { button: 0 });
  await page.keyboard.up('q');
});

test('the ground laser follows the center cursor and cuts its previewed point', async ({
  page,
}) => {
  await page.goto('/?graphics=safe&terrainDebug=1');
  await page.locator('#bots-picker button[data-bots="0"]').click();
  await page.locator('#play').click();
  await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
  await page.locator('#confirm-weapon').click();
  await expect(page.locator('#game-screen')).toHaveAttribute('data-starting', 'false', {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__terrainDebug.teleportClear());
  const canvas = page.locator('#game');
  await page.keyboard.down('q');
  await expect(canvas).toHaveAttribute('data-dig-target-valid', 'true');
  const firstX = Number(await canvas.getAttribute('data-dig-beam-end-x'));
  await canvas.dispatchEvent('mousemove', { movementY: 90 });
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-dig-beam-end-x')))
    .toBeLessThan(firstX - 100);
  await expect(canvas).toHaveAttribute('data-dig-target-valid', 'true');
  const targetX = Number(await canvas.getAttribute('data-dig-beam-end-x'));
  const targetZ = Number(await canvas.getAttribute('data-dig-beam-end-z'));
  const center = await canvas.evaluate((element) => ({
    x: element.width / 2,
    y: element.height / 2,
  }));
  expect(Number(await canvas.getAttribute('data-dig-preview-screen-x'))).toBeCloseTo(center.x, 0);
  expect(Number(await canvas.getAttribute('data-dig-preview-screen-y'))).toBeCloseTo(center.y, 0);
  const before = await page.evaluate(() => window.__terrainDebug.snapshot().operations);
  await canvas.dispatchEvent('mousedown', { button: 0 });
  await expect
    .poll(async () => page.evaluate(() => window.__terrainDebug.snapshot().operations))
    .toBe(before + 1);
  const operation = await page.evaluate(() =>
    window.__terrainDebug.snapshot().lastOperations.at(-1),
  );
  expect(operation.x).toBeCloseTo(targetX, 0);
  expect(operation.z).toBeCloseTo(targetZ, 0);
  await page.dispatchEvent('body', 'mouseup', { button: 0 });
  await page.keyboard.up('q');
});
