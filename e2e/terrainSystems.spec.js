import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wandwars-dig-control', 'hold'));
});

test('a test room shows levitation, cave-in, and underground flooding', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?graphics=safe&terrainDebug=1');
  await page.locator('#bots-picker button[data-bots="0"]').click();
  await page.locator('#play').click();
  await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
  await page.locator('#confirm-weapon').click();
  await expect(page.locator('#game-screen')).toHaveAttribute('data-starting', 'false', {
    timeout: 30_000,
  });
  const setup = await page.evaluate(() => {
    const debug = window.__terrainDebug;
    debug.teleportClear();
    const edit = debug.spawnTestRoom();
    const room = debug.snapshot().regions.find((region) => region.ceilings >= 5);
    return { edit, room };
  });
  expect(setup.edit.accepted).toBe(true);
  expect(setup.room).toBeTruthy();
  await page.evaluate((id) => window.__terrainDebug.teleportToRegion(id), setup.room.id);
  await page.evaluate(() => window.__terrainDebug.grantLevitationSpell());
  await page.keyboard.down('q');
  await page.keyboard.press('y');
  await page.keyboard.up('q');
  await expect
    .poll(() => page.evaluate(() => window.__terrainDebug.snapshot().levitationNodes.length))
    .toBe(1);
  await page.evaluate(() => window.__terrainDebug.grantElementalMana(40));
  await page.waitForTimeout(550);
  await page.keyboard.down('q');
  await page.keyboard.press('y');
  await page.keyboard.up('q');
  await expect
    .poll(() => page.evaluate(() => window.__terrainDebug.snapshot().levitationNodes[0].health))
    .toBeGreaterThan(120);
  await page.screenshot({ path: '/tmp/wandwars-levitation-room.png' });

  const before = await page.evaluate(() => window.__terrainDebug.snapshot().revision);
  const collapse = await page.evaluate(
    (id) => window.__terrainDebug.forceCollapse(id),
    setup.room.id,
  );
  expect(collapse.accepted).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__terrainDebug.snapshot().revision))
    .toBeGreaterThan(before);
  await expect
    .poll(() => page.evaluate(() => window.__terrainDebug.snapshot().pendingCollapses))
    .toBe(0);
  await page.screenshot({ path: '/tmp/wandwars-cave-in.png' });

  await page.evaluate(() => {
    const debug = window.__terrainDebug;
    const player = debug.snapshot().player;
    debug.markLiquidSource({
      kind: 'water',
      x: player.x,
      z: player.y,
      y: player.feetY + 40,
      radius: 100,
      level: player.feetY + 120,
    });
  });
  await expect
    .poll(() => page.evaluate(() => window.__terrainDebug.snapshot().waterCells))
    .toBeGreaterThan(0);
  await page.screenshot({ path: '/tmp/wandwars-flooded-room.png' });
  expect(await page.locator('#game-screen').getAttribute('data-starting')).toBe('false');
});
