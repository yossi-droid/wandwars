// Browser smoke + regression tests. Run with: npm run test:e2e
//
// These open the built game in a real browser (Chromium) and check the things
// that must NEVER break: the menu loads, Play starts the match and shows the
// arena, and there are no console errors.
import { test, expect } from '@playwright/test';

async function chooseWeapon(page, weaponId = 'apprentice-wand') {
  await page.locator('#play').click();
  await page.locator(`.weapon-card[data-weapon="${weaponId}"]`).click();
  await page.locator('#confirm-weapon').click();
  await expect(page.locator('#game-screen')).toHaveAttribute('data-starting', 'false', {
    timeout: 30_000,
  });
}

test.describe('smoke + regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('wandwars-dig-control', 'hold'));
  });
  test('right mouse smoothly zooms in weapon mode and digs only in digging mode', async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await page.goto('/?graphics=safe&terrainDebug=1');
    await page.locator('#bots-picker button[data-bots="0"]').click();
    await chooseWeapon(page, 'apprentice-wand');
    const gameScreen = page.locator('#game-screen');
    const canvas = page.locator('#game');
    await page.evaluate(() => window.__terrainDebug.teleportClear());
    const before = await page.evaluate(() => window.__terrainDebug.snapshot().operations);

    await canvas.dispatchEvent('mousedown', { button: 2 });
    await expect(gameScreen).toHaveAttribute('data-digging-action', 'false');
    await expect
      .poll(() => gameScreen.getAttribute('data-ads-amount').then(Number))
      .toBeGreaterThan(0.35);
    expect(await page.evaluate(() => window.__terrainDebug.snapshot().operations)).toBe(before);
    expect(Number(await gameScreen.getAttribute('data-fov'))).toBeLessThan(75);
    await page.dispatchEvent('body', 'mouseup', { button: 2 });
    await expect
      .poll(() => gameScreen.getAttribute('data-ads-amount').then(Number))
      .toBeLessThan(0.08);

    await page.keyboard.down('q');
    await expect(gameScreen).toHaveAttribute('data-digging-mode', 'true');
    await canvas.dispatchEvent('mousedown', { button: 2 });
    await expect(gameScreen).toHaveAttribute('data-digging-action', 'true');
    await expect
      .poll(() => page.evaluate(() => window.__terrainDebug.snapshot().operations))
      .toBeGreaterThan(before);
    expect(
      await page.evaluate(() => window.__terrainDebug.snapshot().lastOperations.at(-1).dirY),
    ).toBe(-1);
    await page.dispatchEvent('body', 'mouseup', { button: 2 });
    await expect(gameScreen).toHaveAttribute('data-digging-action', 'false');
    await page.keyboard.press('Shift');
    const runningBefore = await page.evaluate(() => window.__terrainDebug.snapshot().operations);
    await canvas.dispatchEvent('mousedown', { button: 2 });
    await expect(gameScreen).toHaveAttribute('data-digging-action', 'true');
    expect(
      await page.evaluate(() => window.__terrainDebug.snapshot().operations),
    ).toBeGreaterThanOrEqual(runningBefore);
    await expect(gameScreen).toHaveAttribute('data-ads-held', 'false');
    await page.dispatchEvent('body', 'mouseup', { button: 2 });

    await page.keyboard.up('q');
    await expect(gameScreen).toHaveAttribute('data-digging-mode', 'false');
    const afterExit = await page.evaluate(() => window.__terrainDebug.snapshot().operations);
    await canvas.dispatchEvent('mousedown', { button: 2 });
    await expect(gameScreen).toHaveAttribute('data-digging-action', 'false');
    await expect
      .poll(() => gameScreen.getAttribute('data-ads-amount').then(Number))
      .toBeGreaterThan(0.35);
    expect(await page.evaluate(() => window.__terrainDebug.snapshot().operations)).toBe(afterExit);
    await page.dispatchEvent('body', 'mouseup', { button: 2 });
  });

  test('Safari compatibility mode starts a match after weapon confirmation', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    });
    const page = await context.newPage();
    await page.goto('/?graphics=detailed');
    await page.locator('#bots-picker button[data-bots="0"]').click();
    await chooseWeapon(page, 'apprentice-wand');
    const gameScreen = page.locator('#game-screen');
    await expect(gameScreen).toHaveAttribute('data-safe-graphics', 'false');
    await expect(gameScreen).toHaveAttribute('data-player-landed', 'true');
    const backingSize = await page.locator('#game').evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
    }));
    expect(backingSize.width).toBeLessThanOrEqual(960);
    expect(backingSize.height).toBeLessThanOrEqual(540);
    await context.close();
  });

  test('homepage loads with the title and a Play button', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/WandWars/);
    await expect(page.locator('#title')).toBeVisible();
    await expect(page.locator('#play')).toBeVisible();
    // The arena is hidden until you press Play.
    await expect(page.locator('#game-screen')).toBeHidden();
    await expect(page.locator('#weapon-select')).toBeHidden();
  });

  test('main menu settings open, update, and persist preferences', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('#settings-button').click();
    await expect(page.locator('#settings')).toBeVisible();
    await expect(page.locator('#setting-graphics')).toHaveValue('detailed');

    await page.locator('#setting-sensitivity').fill('125');
    await expect(page.locator('#setting-sensitivity-value')).toHaveText('125%');
    await page.locator('#setting-invert-y').check();
    await page.locator('#setting-master').fill('60');
    await expect(page.locator('#setting-master-value')).toHaveText('60%');
    await page.locator('#settings-back').click();
    await expect(page.locator('#settings')).toBeHidden();
    await expect(page.locator('#menu')).toBeVisible();

    await page.reload();
    await page.locator('#settings-button').click();
    await expect(page.locator('#setting-sensitivity')).toHaveValue('125');
    await expect(page.locator('#setting-invert-y')).toBeChecked();
    await expect(page.locator('#setting-master')).toHaveValue('60');
  });

  test('settings can rebind and reset gameplay controls', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('#settings-button').click();

    const forwardBinding = page
      .locator('.keybind-row')
      .filter({ hasText: 'Move forward' })
      .locator('.keybind-button');
    await expect(forwardBinding).toHaveText('W');
    await forwardBinding.click();
    await page.keyboard.press('z');
    await expect(forwardBinding).toHaveText('Z');

    await page
      .locator('.keybind-row')
      .filter({ hasText: 'Cast spell' })
      .locator('select')
      .selectOption('1');
    await page.locator('#reset-keybinds').click();
    await expect(forwardBinding).toHaveText('W');
    await expect(
      page.locator('.keybind-row').filter({ hasText: 'Cast spell' }).locator('select'),
    ).toHaveValue('0');
    await expect(page.locator('.keybind-row').filter({ hasText: 'Aim / zoom' })).toHaveCount(0);
  });

  test('the wizard-count picker has five options including sandbox mode', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#bots-picker button')).toHaveCount(5);
  });

  test('pressing Play requires one of six base weapons before the match', async ({ page }) => {
    await page.goto('/');
    await page.locator('#play').click();
    await expect(page.locator('#weapon-select')).toBeVisible();
    await expect(page.locator('.weapon-card')).toHaveCount(6);
    await expect
      .poll(() =>
        page
          .locator('.weapon-card img')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                image.complete &&
                image.naturalWidth > 0 &&
                getComputedStyle(image).objectFit === 'contain',
            ),
          ),
      )
      .toBe(true);
    const cardShape = await page.locator('.weapon-card').first().boundingBox();
    expect(cardShape.height).toBeGreaterThan(cardShape.width);
    await expect(page.locator('#confirm-weapon')).toBeHidden();
    await expect(page.locator('#game-screen')).toBeHidden();
  });

  test('the browser loads all 47 real attacks, not three aliases', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-attack-count', '47');
    await expect(page.locator('html')).toHaveAttribute('data-attack-kinds', '10');
  });

  test('selection highlights, confirms, and spawns the locked weapon', async ({ page }) => {
    await page.goto('/');
    await page.locator('#play').click();
    const bow = page.locator('.weapon-card[data-weapon="enchanted-bow"]');
    await bow.click();
    await expect(bow).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#confirm-weapon')).toBeVisible();
    await expect(page.locator('#confirm-weapon')).toContainText('Enchanted Bow');
    await page.locator('#confirm-weapon').click();
    await expect(page.locator('#game-screen')).toBeVisible();
    await expect(page.locator('#game-screen')).toHaveAttribute('data-base-weapon', 'enchanted-bow');
    await expect(page.locator('#game')).toBeVisible();
  });

  test('the live island starts after the detailed scene is ready', async ({ page }) => {
    await page.goto('/');
    await page.locator('#play').click();
    await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
    await page.evaluate(() => {
      const gameScreen = document.querySelector('#game-screen');
      window.__openingReadySnapshot = new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (gameScreen.dataset.starting !== 'false') return;
          observer.disconnect();
          resolve({
            phase: gameScreen.dataset.openingPhase,
            timer: Number(gameScreen.dataset.openingTimer),
          });
        });
        observer.observe(gameScreen, { attributes: true });
      });
    });
    await page.locator('#confirm-weapon').click();
    const firstReadyState = await page.evaluate(() => window.__openingReadySnapshot);
    expect(firstReadyState).toEqual({ phase: 'complete', timer: 0 });
    await expect(page.locator('#start-loading')).toBeHidden();
  });

  test('an embedded preview cannot get stuck when its first animation frames are paused', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#play').click();
    await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
    await page.evaluate(() => {
      const realRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      let pausedFrames = 2;
      window.requestAnimationFrame = (callback) => {
        if (pausedFrames > 0) {
          pausedFrames -= 1;
          return 1;
        }
        return realRequestAnimationFrame(callback);
      };
    });
    await page.locator('#confirm-weapon').click();
    await expect(page.locator('#game-screen')).toHaveAttribute('data-starting', 'false', {
      timeout: 30_000,
    });
    await expect(page.locator('#start-loading')).toBeHidden();
    await expect(page.locator('#game-screen')).toHaveAttribute('data-opening-phase', 'complete');
  });

  test('camera responds smoothly after direct island start', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/');
    await page.locator('#bots-picker button[data-bots="0"]').click();
    await chooseWeapon(page, 'apprentice-wand');
    const gameScreen = page.locator('#game-screen');
    const yawAtStart = Number(await gameScreen.getAttribute('data-camera-yaw'));

    // The live camera follows actual mouse movement.
    await page.locator('#game').evaluate((canvas) => {
      canvas.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: canvas.getBoundingClientRect().left + 400,
          clientY: canvas.getBoundingClientRect().top + 300,
          movementX: 900,
          movementY: -300,
        }),
      );
    });
    await page.waitForTimeout(100);
    const yawAfterMove = Number(await gameScreen.getAttribute('data-camera-yaw'));
    expect(yawAfterMove).not.toBeCloseTo(yawAtStart, 3);
    await expect
      .poll(() => gameScreen.getAttribute('data-player-heading').then(Number))
      .toBeCloseTo(yawAfterMove, 6);

    await expect(gameScreen).toHaveAttribute('data-opening-phase', 'complete');
    expect(Number(await gameScreen.getAttribute('data-camera-yaw'))).toBeCloseTo(yawAfterMove, 6);

    // With no further input, the camera must not rotate itself.
    await page.waitForTimeout(350);
    expect(Number(await gameScreen.getAttribute('data-camera-yaw'))).toBeCloseTo(yawAfterMove, 6);

    // Resting the cursor anywhere on the game must never rotate the view.
    const restingYaw = Number(await gameScreen.getAttribute('data-camera-yaw'));
    await page.waitForTimeout(600);
    expect(Number(await gameScreen.getAttribute('data-camera-yaw'))).toBeCloseTo(restingYaw, 6);

    // Look remains responsive to another movement.
    await page.locator('#game').evaluate((canvas) => {
      canvas.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: canvas.getBoundingClientRect().left + 420,
          clientY: canvas.getBoundingClientRect().top + 300,
          movementX: 120,
        }),
      );
    });
    await expect
      .poll(() => gameScreen.getAttribute('data-camera-yaw').then(Number))
      .not.toBeCloseTo(yawAfterMove, 3);
  });

  test('a match lands on the island and allows ground movement', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await page.locator('#bots-picker button[data-bots="0"]').click();
    await chooseWeapon(page, 'apprentice-wand');
    const gameScreen = page.locator('#game-screen');

    // Direct start must leave the player on the playable island.
    await expect(gameScreen).toHaveAttribute('data-opening-phase', 'complete', {
      timeout: 65_000,
    });
    await expect(gameScreen).toHaveAttribute('data-player-landed', 'true');
    await expect
      .poll(() => gameScreen.getAttribute('data-player-x').then(Number))
      .toBeGreaterThan(0);

    const before = await gameScreen.evaluate((screen) => ({
      x: Number(screen.dataset.playerX),
      y: Number(screen.dataset.playerY),
    }));
    await page.keyboard.down('w');
    await expect
      .poll(
        () =>
          gameScreen.evaluate(
            (screen, start) =>
              Math.hypot(
                Number(screen.dataset.playerX) - start.x,
                Number(screen.dataset.playerY) - start.y,
              ),
            before,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(20);
    await page.keyboard.up('w');
  });

  test('mouse wheel and number keys cannot select empty hotbar slots', async ({ page }) => {
    await page.goto('/');
    await chooseWeapon(page, 'apprentice-wand');
    const gameScreen = page.locator('#game-screen');
    await expect(gameScreen).toHaveAttribute('data-hotbar-slot', 'none');
    await page.mouse.wheel(0, 100);
    await expect(gameScreen).toHaveAttribute('data-hotbar-slot', 'none');
    await page.keyboard.press('3');
    await expect(gameScreen).toHaveAttribute('data-hotbar-slot', 'none');
  });

  test('the six-slot bar selects and drops a carried item with number keys', async ({ page }) => {
    await page.goto('/?graphics=safe&terrainDebug=1');
    await page.locator('#bots-picker button[data-bots="0"]').click();
    await chooseWeapon(page, 'apprentice-wand');
    const gameScreen = page.locator('#game-screen');
    await page.evaluate(() => window.__terrainDebug.grantBurrowSpell());
    await expect(gameScreen).toHaveAttribute('data-hotbar-slot', '1');
    await page.keyboard.press('2');
    await expect(gameScreen).toHaveAttribute('data-hotbar-slot', '1');
    await page.keyboard.press('g');
    await expect(gameScreen).toHaveAttribute('data-hotbar-slot', 'none');
  });

  test('E opens inventory and M opens the map without duplicating the hotbar', async ({ page }) => {
    await page.goto('/?graphics=safe&terrainDebug=1');
    await page.evaluate(() =>
      localStorage.setItem('wandwars-key-bindings', JSON.stringify({ map: 'KeyE' })),
    );
    await page.reload();
    await chooseWeapon(page, 'apprentice-wand');
    const gameScreen = page.locator('#game-screen');
    await page.evaluate(() => window.__terrainDebug.grantBurrowSpell());
    await expect(gameScreen).toHaveAttribute('data-map-open', 'false');
    await expect(gameScreen).toHaveAttribute('data-inventory-open', 'false');
    await page.keyboard.press('e');
    await expect(gameScreen).toHaveAttribute('data-inventory-open', 'true');
    await expect(gameScreen).toHaveAttribute('data-map-open', 'false');
    await page.screenshot({ path: '/tmp/wandwars-inventory.png' });
    await page.keyboard.press('m');
    await expect(gameScreen).toHaveAttribute('data-inventory-open', 'false');
    await expect(gameScreen).toHaveAttribute('data-map-open', 'true');
    await page.keyboard.press('m');
    await expect(gameScreen).toHaveAttribute('data-map-open', 'false');
    await page.screenshot({ path: '/tmp/wandwars-game-no-pouch.png' });
  });

  test('holding Q enters Dig mode and clicking starts digging', async ({ page }) => {
    await page.goto('/');
    await page.locator('#bots-picker button[data-bots="0"]').click();
    await chooseWeapon(page, 'apprentice-wand');
    const gameScreen = page.locator('#game-screen');

    await expect(gameScreen).toHaveAttribute('data-digging-mode', 'false');
    await page.keyboard.down('q');
    await expect(gameScreen).toHaveAttribute('data-digging-mode', 'true');
    await expect(gameScreen).toHaveAttribute('data-player-alive', 'true');
    await page.mouse.down();
    await expect(gameScreen).toHaveAttribute('data-digging-action', 'true');
    await page.mouse.up();
    await expect(gameScreen).toHaveAttribute('data-digging-action', 'false');
    await page.keyboard.up('q');
    await expect(gameScreen).toHaveAttribute('data-digging-mode', 'false');
    await expect(gameScreen).toHaveAttribute('data-digging-action', 'false');
  });

  test('a carried Burrow Spell removes terrain and updates the visible chunk', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/?graphics=safe&terrainDebug=1');
    await page.locator('#bots-picker button[data-bots="0"]').click();
    await chooseWeapon(page, 'apprentice-wand');
    const site = await page.evaluate(() => {
      window.__terrainDebug.grantBurrowSpell();
      return window.__terrainDebug.teleportClear();
    });
    expect(site).toBeTruthy();
    await expect(page.locator('#game-screen')).toHaveAttribute('data-player-x', String(site.x));
    await page.keyboard.down('q');
    const manaBefore = await page.evaluate(
      () => window.__terrainDebug.snapshot().player.mana.elemental,
    );
    await page.keyboard.press('y');
    await expect
      .poll(() => page.evaluate(() => window.__terrainDebug.snapshot().player.mana.elemental))
      .toBeLessThan(manaBefore);
    await expect
      .poll(() => page.locator('#game').getAttribute('data-terrain-chunks').then(Number))
      .toBeGreaterThan(0);
  });

  test('one Escape press leaves a live match', async ({ page }) => {
    await page.goto('/');
    await page.locator('#bots-picker button[data-bots="0"]').click();
    await chooseWeapon(page, 'apprentice-wand');

    // Pointer-lock browsers may reserve keydown but still deliver keyup.
    // Simulate that exact one-physical-press path.
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }),
      ),
    );

    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#game-screen')).toBeHidden();
  });

  test('entering a match immediately requests cursor lock', async ({ page }) => {
    await page.goto('/');
    await page.locator('#play').click();
    await page.locator('.weapon-card[data-weapon="apprentice-wand"]').click();
    await page.locator('#confirm-weapon').click();

    await expect(page.locator('#game-screen')).toHaveAttribute(
      'data-pointer-lock-requested',
      'true',
    );
  });

  test('returning and starting another match requires a fresh confirmation', async ({ page }) => {
    await page.goto('/');
    await chooseWeapon(page, 'chaos-orb');
    await page.locator('#back').click();
    await expect(page.locator('#menu')).toBeVisible();
    await page.locator('#play').click();
    await expect(page.locator('#weapon-select')).toBeVisible();
    await expect(page.locator('.weapon-card[aria-selected="true"]')).toHaveCount(0);
    await expect(page.locator('#confirm-weapon')).toBeHidden();
  });

  test('both screens load and play without console errors', async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await chooseWeapon(page, 'arcane-spellbook');
    // Drive a couple of frames and a movement key.
    await page.locator('#game').focus();
    await page.keyboard.press('w');
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape'); // back to menu
    await expect(page.locator('#menu')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('a new game tab releases the old tab instead of exhausting WebGL', async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext();
    const first = await context.newPage();
    await first.goto('/');
    await chooseWeapon(first, 'apprentice-wand');

    const second = await context.newPage();
    await second.goto('/');
    await chooseWeapon(second, 'arcane-spellbook');

    await expect(first.locator('#menu')).toBeVisible();
    await expect(first.locator('#game-screen')).toBeHidden();
    await expect(first.locator('#game-screen')).toHaveAttribute('data-inactive-tab', 'true');
    await expect(second.locator('#game-screen')).toHaveAttribute('data-starting', 'false');
    await context.close();
  });

  test('safe graphics starts a playable 3D match without heavy scenery', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/?graphics=safe');
    await chooseWeapon(page, 'apprentice-wand');
    const gameScreen = page.locator('#game-screen');
    await expect(gameScreen).toHaveAttribute('data-safe-graphics', 'true');
    await expect(gameScreen).toHaveAttribute('data-opening-phase', 'complete');
    const before = await gameScreen.evaluate((screen) => ({
      x: Number(screen.dataset.playerX),
      y: Number(screen.dataset.playerY),
    }));
    await page.keyboard.down('w');
    await page.waitForTimeout(700);
    await page.keyboard.up('w');
    await expect
      .poll(() =>
        gameScreen.evaluate(
          (screen, start) =>
            Math.hypot(
              Number(screen.dataset.playerX) - start.x,
              Number(screen.dataset.playerY) - start.y,
            ),
          before,
        ),
      )
      .toBeGreaterThan(20);
  });
});
