import { describe, expect, it } from 'vitest';
import { impactShakeStrength } from './impactFeedback.js';
import { ARENA, WIZARD, createState, stepSpells, stepHitKnockback, terrainHeight } from './game.js';

describe('spell impact feedback', () => {
  it('shakes for nearby big impacts, with distance falloff and no shake for small hits', () => {
    const event = { type: 'explosion', x: 0, y: 0, radius: 240, impactPower: 46 };
    const near = impactShakeStrength(event, { x: 50, y: 0 });
    expect(near).toBeGreaterThan(3);
    expect(impactShakeStrength(event, { x: 500, y: 0 })).toBeLessThan(near);
    expect(impactShakeStrength(event, { x: 2000, y: 0 })).toBe(0);
    expect(impactShakeStrength({ ...event, type: 'hit', impactPower: 14 }, { x: 0, y: 0 })).toBe(0);
    expect(
      impactShakeStrength({ ...event, type: 'block', impactPower: 90 }, { x: 0, y: 0 }),
    ).toBeGreaterThan(0);
  });

  it('a projectile hitting the exact target center pushes in its incoming direction', () => {
    const state = createState({ players: 2, bots: 0, opening: false });
    const [caster, victim] = state.wizards;
    state.obstacles = [];
    victim.x = 200;
    victim.y = 0;
    state.spells = [
      {
        x: 195,
        y: 0,
        z: 90,
        originGround: terrainHeight(200, 0),
        vx: 1000,
        vy: 0,
        vz: 0,
        radius: 8,
        damage: 20,
        ownerId: caster.id,
        targetId: victim.id,
        targetDistance: 0,
        life: 1,
        color: '#fff',
      },
    ];
    stepSpells(state, 0.01);
    expect(victim.health).toBe(80);
    expect(victim.knockbackX).toBeGreaterThan(0);
    expect(victim.x).toBe(200);
    stepHitKnockback(state, victim, 0.05);
    expect(victim.x).toBeGreaterThan(200);
    expect(victim.x).toBeLessThan(220);
  });

  it('slows smoothly with consistent travel across simulation step sizes', () => {
    const make = () => ({ alive: true, x: 0, y: 0, knockbackX: 400, knockbackY: 0 });
    const coarse = make();
    const fine = make();
    const state = { obstacles: [], terrain: null };
    stepHitKnockback(state, coarse, 0.2);
    for (let i = 0; i < 20; i++) stepHitKnockback(state, fine, 0.01);
    expect(fine.x).toBeCloseTo(coarse.x, 5);
    expect(fine.knockbackX).toBeCloseTo(coarse.knockbackX, 5);
    expect(fine.knockbackX).toBeLessThan(100);
  });

  it('cannot knock a player through a thin building wall or beyond the map', () => {
    const victim = { alive: true, x: 0, y: 0, knockbackX: 650, knockbackY: 0 };
    const state = {
      obstacles: [{ kind: 'house', x: 38, y: 0, hw: 2, hd: 50, angle: 0 }],
      terrain: null,
    };
    stepHitKnockback(state, victim, 0.5);
    expect(victim.x).toBeLessThanOrEqual(38 - 2 - WIZARD.radius);
    expect(victim.knockbackX).toBe(0);
    victim.x = ARENA.radius - WIZARD.radius - 1;
    victim.knockbackX = 650;
    state.obstacles = [];
    stepHitKnockback(state, victim, 0.2);
    expect(Math.hypot(victim.x, victim.y)).toBeLessThanOrEqual(ARENA.radius - WIZARD.radius);
  });

  it('slides across a roof without being ejected through the building walls below', () => {
    const victim = {
      alive: true,
      x: 0,
      y: 0,
      climbH: 100,
      climbState: 'top',
      knockbackX: 200,
      knockbackY: 0,
    };
    const state = {
      terrain: null,
      obstacles: [{ kind: 'house', x: 0, y: 0, hw: 50, hd: 50, top: 100, angle: 0 }],
    };
    stepHitKnockback(state, victim, 0.1);
    expect(victim.x).toBeGreaterThan(0);
    expect(victim.x).toBeLessThan(20);
    expect(victim.y).toBe(0);
  });

  it('stops at the solid side of an excavated tunnel', () => {
    const victim = { alive: true, x: 0, y: 0, drillFeetY: 0, knockbackX: 650, knockbackY: 0 };
    const state = { obstacles: [], terrain: { density: (x) => (x >= 18 ? 1 : -1) } };
    stepHitKnockback(state, victim, 0.3);
    expect(victim.x).toBeLessThan(18);
    expect(victim.knockbackX).toBe(0);
  });
});
