import { describe, it, expect } from 'vitest';
import {
  createState,
  update,
  NATURAL_WATER,
  MAP_FEATURES,
  terrainHeight,
  WIZARD,
  JUMP,
  originalTerrainHeight,
  castSpell,
  WAND,
} from './game.js';
import { waterContact, stepBuoyancy, WATER_PHYSICS } from './waterPhysics.js';

function sceneAt(x = MAP_FEATURES.pond.x, y = MAP_FEATURES.pond.y) {
  const state = createState({ players: 1, bots: 0, opening: false, lootSeed: 42 });
  state.obstacles = [];
  const wizard = state.wizards[0];
  wizard.x = x;
  wizard.y = y;
  wizard.lastTerrainFeetY = terrainHeight(x, y);
  return { state, wizard };
}
function advance(state, seconds, input = {}, dt = 1 / 60) {
  for (let t = 0; t < seconds - 1e-8; t += dt) update(state, [input], dt);
}

describe('water movement and buoyancy', () => {
  it('keeps spell launch height aligned with the floating wizard', () => {
    const { state, wizard } = sceneAt();
    advance(state, 2);
    castSpell(state, wizard, 'bolt');
    const bolt = state.spells[0];
    expect(bolt.originGround + bolt.z).toBeCloseTo(wizard.drillFeetY + WAND.castHeight, 5);
  });
  it('floats gently at the visible pond surface without using health or mana', () => {
    const { state, wizard } = sceneAt();
    const mana = { ...wizard.manaPouch };
    const start = terrainHeight(wizard.x, wizard.y);
    update(state, [{}], 1 / 60);
    expect(wizard.drillFeetY - start).toBeLessThan(2);
    advance(state, 3);
    expect(wizard.swimming).toBe(true);
    expect(wizard.drillFeetY).toBeCloseTo(
      NATURAL_WATER.pondLevel - wizard.bodyHeight * WATER_PHYSICS.floatDepth,
      0,
    );
    expect(wizard.health).toBe(100);
    expect(wizard.manaPouch).toEqual(mana);
  });
  it('uses swim speed rather than sprinting, and can surface or dive with existing controls', () => {
    const { state, wizard } = sceneAt();
    advance(state, 2);
    const startX = wizard.x,
      startFeet = wizard.drillFeetY;
    advance(state, 0.5, { dx: 1, run: true, jumpHeld: true });
    expect(wizard.x - startX).toBeCloseTo(WATER_PHYSICS.swimSpeed * 0.5, 1);
    expect(wizard.running).toBe(false);
    expect(wizard.drillFeetY).toBeGreaterThan(startFeet + 10);
    advance(state, 1, { crouch: true });
    expect(wizard.drillFeetY).toBeLessThan(startFeet);
    advance(state, 3);
    expect(wizard.drillFeetY).toBeCloseTo(
      NATURAL_WATER.pondLevel - wizard.bodyHeight * WATER_PHYSICS.floatDepth,
      0,
    );
  });
  it('walks out onto shore and restores normal movement and jumping', () => {
    const { state, wizard } = sceneAt();
    advance(state, 2);
    advance(state, 6, { dx: 1 });
    expect(wizard.x).toBeGreaterThan(MAP_FEATURES.pond.x + MAP_FEATURES.pond.r);
    expect(wizard.inWater).toBe(false);
    expect(wizard.swimming).toBe(false);
    advance(state, 1);
    expect(wizard.drillFeetY).toBeNull();
    const x = wizard.x;
    advance(state, 0.5, { dx: 1 });
    expect(wizard.x - x).toBeCloseTo(WIZARD.speed * 0.5, 1);
    update(state, [{ jump: true }], 1 / 60);
    expect(wizard.jumpV).toBeGreaterThan(JUMP.velocity * 0.8);
  });
  it('drifts downstream in a river without moving pond swimmers', () => {
    const sample = NATURAL_WATER.riverSamples[82];
    const { state, wizard } = sceneAt(sample.x, sample.z);
    const x = wizard.x,
      y = wizard.y;
    advance(state, 1);
    expect(Math.hypot(wizard.x - x, wizard.y - y)).toBeGreaterThan(10);
    expect(Math.hypot(wizard.x - x, wizard.y - y)).toBeLessThan(30);
    expect(wizard.swimming).toBe(true);
  });
  it('ignores flying, bridges and jumps above the water', () => {
    const { state, wizard } = sceneAt();
    wizard.flying = true;
    const contact = () =>
      waterContact(state, wizard, NATURAL_WATER.surfaceAt, terrainHeight, originalTerrainHeight);
    expect(contact()).toBeNull();
    wizard.flying = false;
    wizard.climbH = 400;
    expect(contact()).toBeNull();
    wizard.climbH = 0;
    wizard.jumpH = 400;
    expect(contact()).toBeNull();
  });
  it('does not flood a sealed tunnel, but supports buoyancy in connected flooded space', () => {
    const wizard = { x: 0, y: 0, bodyHeight: 168, alive: true, drillFeetY: 0 };
    const terrain = { density: () => 1, supportHeight: () => -30 };
    const state = { terrain, terrainFluids: { fluidAt: () => null } };
    const contact = () =>
      waterContact(
        state,
        wizard,
        () => ({ level: 220 }),
        () => 200,
        () => 200,
      );
    expect(contact()).toBeNull();
    state.terrainFluids.fluidAt = () => ({ kind: 'water', level: 180, amount: 1 });
    expect(contact()?.swimming).toBe(true);
    stepBuoyancy(wizard, contact(), 0.2, {}, terrain);
    expect(wizard.drillFeetY).toBe(0); // ceiling blocks upward movement
    expect(wizard.waterVelocity).toBe(0);
  });
  it('keeps buoyancy stable across mobile and desktop frame rates', () => {
    function simulate(dt) {
      const wizard = { x: 0, y: 0, alive: true, bodyHeight: 168 };
      for (let t = 0; t < 2 - 1e-8; t += dt) {
        stepBuoyancy(
          wizard,
          { swimming: true, feet: wizard.drillFeetY ?? 0, ground: 0, level: 200 },
          dt,
        );
      }
      return wizard.drillFeetY;
    }
    expect(simulate(1 / 120)).toBeCloseTo(simulate(1 / 20), 5);
    expect(simulate(1 / 20)).toBeGreaterThan(80);
  });
  it('wades slowly in shallow water without floating or drowning', () => {
    const wizard = { x: 0, y: 0, alive: true, bodyHeight: 168 };
    const contact = waterContact(
      {},
      wizard,
      () => ({ level: 35 }),
      () => 0,
      () => 0,
    );
    expect(contact.swimming).toBe(false);
    expect(contact.submersion).toBeCloseTo(35 / 168);
    stepBuoyancy(wizard, contact, 1);
    expect(wizard.drillFeetY).toBeUndefined();
  });
});
