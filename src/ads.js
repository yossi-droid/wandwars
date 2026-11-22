// Aim-down-sights tuning lives in one place. Add a weapon entry below to give
// it a unique zoom or camera-relative pose without changing input or rendering.
export const ADS_SETTINGS = Object.freeze({
  hipFov: 75,
  adsFov: 52,
  transitionSpeed: 14,
  lookSensitivity: 0.58,
  hipWeaponPosition: Object.freeze([0, 0, 0]),
  adsWeaponPosition: Object.freeze([0, -5, -58]),
  weaponAimAxis: Object.freeze([0.84, 0.54, 0]),
  adsWeaponRotation: Object.freeze([0, 0, 0]),
  adsWeaponScale: 1,
  weapons: Object.freeze({
    'focusing-crystal-staff': Object.freeze({
      adsFov: 46,
      adsWeaponPosition: Object.freeze([0, -7, -72]),
      weaponAimAxis: Object.freeze([0.8, 0.72, 0]),
    }),
    'thunderclap-gauntlet': Object.freeze({
      adsFov: 56,
      adsWeaponPosition: Object.freeze([0, -8, -46]),
      weaponAimAxis: Object.freeze([1, 0, 0]),
      adsWeaponScale: 1.08,
    }),
    'arcane-spellbook': Object.freeze({
      adsFov: 54,
      adsWeaponPosition: Object.freeze([0, -6, -52]),
      weaponAimAxis: Object.freeze([1, 0, 0]),
    }),
    'enchanted-bow': Object.freeze({
      adsFov: 48,
      adsWeaponPosition: Object.freeze([0, -6, -66]),
      weaponAimAxis: Object.freeze([0, 1, 0]),
    }),
    'chaos-orb': Object.freeze({
      adsFov: 54,
      adsWeaponPosition: Object.freeze([0, -3, -51]),
      weaponAimAxis: Object.freeze([1, 0, 0]),
      adsWeaponScale: 0.96,
    }),
  }),
});

export function adsProfileForWeapon(weaponId) {
  return { ...ADS_SETTINGS, ...(ADS_SETTINGS.weapons[weaponId] || {}) };
}

// Exponential smoothing is frame-rate independent and safely reverses from
// its current value when RMB is pressed/released during an active transition.
export function advanceAdsAmount(current, held, dt, speed = ADS_SETTINGS.transitionSpeed) {
  const target = held ? 1 : 0;
  if (dt <= 0) return current;
  const next = current + (target - current) * (1 - Math.exp(-speed * dt));
  if (Math.abs(target - next) < 0.0001) return target;
  return Math.max(0, Math.min(1, next));
}
