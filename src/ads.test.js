import { describe, expect, it } from 'vitest';
import { ADS_SETTINGS, adsProfileForWeapon, advanceAdsAmount } from './ads.js';

describe('aim-down-sights transition', () => {
  it('smoothly approaches ADS and hip-fire without snapping', () => {
    const firstAimFrame = advanceAdsAmount(0, true, 1 / 60);
    expect(firstAimFrame).toBeGreaterThan(0);
    expect(firstAimFrame).toBeLessThan(1);

    const firstReleaseFrame = advanceAdsAmount(firstAimFrame, false, 1 / 60);
    expect(firstReleaseFrame).toBeGreaterThanOrEqual(0);
    expect(firstReleaseFrame).toBeLessThan(firstAimFrame);
  });

  it('reverses repeatedly from the current position without overshoot', () => {
    let amount = 0;
    for (let index = 0; index < 120; index++) {
      amount = advanceAdsAmount(amount, index % 4 < 2, 1 / 120);
      expect(amount).toBeGreaterThanOrEqual(0);
      expect(amount).toBeLessThanOrEqual(1);
      expect(Number.isFinite(amount)).toBe(true);
    }
  });

  it('supports per-weapon zoom and pose overrides with shared defaults', () => {
    const wand = adsProfileForWeapon('apprentice-wand');
    const staff = adsProfileForWeapon('focusing-crystal-staff');
    expect(wand.hipFov).toBe(ADS_SETTINGS.hipFov);
    expect(staff.adsFov).toBeLessThan(wand.adsFov);
    expect(staff.transitionSpeed).toBe(ADS_SETTINGS.transitionSpeed);
    expect(staff.adsWeaponPosition).not.toEqual(wand.adsWeaponPosition);
  });
});
