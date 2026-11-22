import { describe, expect, it } from 'vitest';
import { createTerrain } from './terrain.js';
import { createTerrainSupport } from './terrainSupport.js';

function cutIsolatedRoof(terrain) {
  terrain.subtractBrush({ shape: 'cylinder', x: 0, z: 0, y: 140, radius: 140, length: 100 });
  for (let index = 0; index < 16; index++) {
    const angle = (index * Math.PI) / 8;
    terrain.subtractBrush({
      shape: 'shaft',
      x: 180 * Math.cos(angle),
      z: 180 * Math.sin(angle),
      y: 140,
      radius: 55,
      length: 260,
    });
  }
}

describe('underground structural support', () => {
  it('leaves a small naturally anchored tunnel intact', () => {
    const terrain = createTerrain(() => 200);
    const support = createTerrainSupport(terrain);
    terrain.subtractBrush({ shape: 'tunnel', x: 0, z: 0, y: 100, radius: 70, length: 180 });
    expect(support.pendingCollapses).toHaveLength(0);
    expect(support.statusAt(0, 0, 128)?.state).toBe('green');
  });

  it('collapses only an isolated roof after its last natural connection is cut', () => {
    const terrain = createTerrain(() => 250);
    const events = [];
    const support = createTerrainSupport(terrain, { onCollapse: (event) => events.push(event) });
    cutIsolatedRoof(terrain);
    expect(support.pendingCollapses.length).toBeGreaterThan(0);
    const floorBefore = terrain.density(0, 0, 40);
    support.stepCollapses();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].damage).toBeGreaterThanOrEqual(20);
    expect(events[0].damage).toBeLessThanOrEqual(90);
    expect(terrain.density(0, 0, 40)).toBe(floorBefore);
    expect(terrain.density(events[0].x, events[0].z, events[0].y + 16)).toBeLessThan(0);
  });

  it('lets a Levitation node support a severed roof until that node is destroyed', () => {
    const terrain = createTerrain(() => 250);
    const support = createTerrainSupport(terrain);
    terrain.subtractBrush({ shape: 'cylinder', x: 0, z: 0, y: 140, radius: 140, length: 100 });
    const placement = support.placeNode({ x: 0, z: 0, team: 1, ownerId: 5 });
    expect(placement.accepted).toBe(true);
    cutIsolatedRoof(terrain);
    expect(support.pendingCollapses).toHaveLength(0);
    expect(support.statusAt(0, 0, 160)?.state).toBe('purple');
    expect(support.damageNode(placement.node.id, 121).destroyed).toBe(true);
    expect(support.pendingCollapses.length).toBeGreaterThan(0);
  });

  it('rejects placement without a ceiling and enforces ownership and node limits', () => {
    const terrain = createTerrain(() => 250);
    const support = createTerrainSupport(terrain);
    expect(support.placeNode({ x: 0, z: 0, team: 1, ownerId: 1 }).reason).toBe('no-ceiling');
    terrain.subtractBrush({ shape: 'sphere', x: 0, z: 0, y: 110, radius: 65 });
    const node = support.placeNode({ x: 0, z: 0, team: 1, ownerId: 1 }).node;
    expect(support.reinforceNode(node.id, 2, 20).accepted).toBe(false);
    expect(support.reinforceNode(node.id, 1, 20).accepted).toBe(true);
    expect(node.mana).toBe(20);
  });

  it('does not invent cave-ins on a non-authoritative replay client', () => {
    const terrain = createTerrain(() => 250);
    const support = createTerrainSupport(terrain, { authoritative: false });
    cutIsolatedRoof(terrain);
    expect(support.statuses.size).toBeGreaterThan(0);
    expect(support.pendingCollapses).toHaveLength(0);
    expect(support.forceCollapse([...terrain.regions.keys()][0]).reason).toBe('not-authoritative');
  });

  it('merges friendly room support while keeping opposing networks separate', () => {
    const terrain = createTerrain(() => 260);
    const support = createTerrainSupport(terrain);
    terrain.subtractSphere(-140, 0, 120, 70);
    terrain.subtractSphere(140, 0, 120, 70);
    const left = support.placeNode({ x: -140, z: 0, team: 1, ownerId: 1 }).node;
    const right = support.placeNode({ x: 140, z: 0, team: 1, ownerId: 2 }).node;
    const enemy = support.placeNode({ x: 140, z: 0, team: 2, ownerId: 3 }).node;
    support.damageNode(left.id, 30);
    terrain.subtractBrush({ shape: 'tunnel', x: 0, z: 0, y: 120, radius: 40, length: 220 });
    expect(terrain.regions.size).toBe(1);
    expect(left.regionId).toBe(right.regionId);
    expect(left.networkMaxHealth).toBe(right.networkMaxHealth);
    expect(left.networkMaxHealth).toBeGreaterThan(120);
    expect(left.networkHealth).toBeLessThan(left.networkMaxHealth);
    expect(enemy.regionId).toBe(left.regionId);
    expect(enemy.networkMaxHealth).toBeLessThan(left.networkMaxHealth);
  });

  it('splits a supported room into separate networks when a passage is restored', () => {
    const terrain = createTerrain(() => 260);
    const support = createTerrainSupport(terrain);
    terrain.subtractSphere(-140, 0, 120, 70);
    terrain.subtractSphere(140, 0, 120, 70);
    const left = support.placeNode({ x: -140, z: 0, team: 1, ownerId: 1 }).node;
    const right = support.placeNode({ x: 140, z: 0, team: 1, ownerId: 2 }).node;
    terrain.subtractBrush({ shape: 'tunnel', x: 0, z: 0, y: 120, radius: 40, length: 220 });
    expect(left.regionId).toBe(right.regionId);
    terrain.fillSphere(0, 0, 120, 55);
    expect(terrain.regions.size).toBe(2);
    expect(left.regionId).not.toBe(right.regionId);
    expect(left.networkMaxHealth).toBeLessThan(120);
    expect(right.networkMaxHealth).toBeLessThan(120);
  });
});
