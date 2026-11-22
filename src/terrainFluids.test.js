import { describe, expect, it } from 'vitest';
import { createTerrain } from './terrain.js';
import { createTerrainFluids } from './terrainFluids.js';

describe('underground water and lava', () => {
  it('moves water through a connected tunnel without crossing intact earth', () => {
    const terrain = createTerrain(() => 200);
    terrain.subtractBrush({ shape: 'tunnel', x: 0, z: 0, y: 100, radius: 55, length: 240 });
    terrain.subtractSphere(300, 0, 100, 55);
    const fluids = createTerrainFluids(terrain);
    fluids.markSource({ kind: 'water', x: -80, z: 0, y: 100, radius: 50, level: 180 });
    for (let frame = 0; frame < 40; frame++) fluids.step(0.25);
    expect(fluids.fluidAt(80, 0, 100)?.amount).toBe(1);
    expect(fluids.fluidAt(300, 0, 100)).toBeNull();
    expect(fluids.fluidAt(0, 0, 220)).toBeNull();
  });

  it('releases lava only after an excavation reaches its hidden source', () => {
    const terrain = createTerrain(() => 200);
    const fluids = createTerrainFluids(terrain);
    fluids.markSource({ kind: 'lava', x: 0, z: 0, y: 80, radius: 50, level: 160 });
    fluids.step(1);
    expect(fluids.filledCells.size).toBe(0);
    terrain.subtractSphere(0, 0, 80, 60);
    fluids.onTerrainEdit({ accepted: true, operation: terrain.operations[0] });
    for (let frame = 0; frame < 20; frame++) fluids.step(0.25);
    expect(fluids.fluidAt(0, 0, 80)?.kind).toBe('lava');
  });

  it('stops new flow when a restored wall divides a flooded passage', () => {
    const terrain = createTerrain(() => 200);
    terrain.subtractBrush({ shape: 'tunnel', x: 0, z: 0, y: 100, radius: 40, length: 240 });
    const fluids = createTerrainFluids(terrain);
    fluids.markSource({ kind: 'water', x: -80, z: 0, y: 100, radius: 30, level: 180 });
    fluids.step(0.1);
    const restored = terrain.fillSphere(0, 0, 100, 45);
    fluids.onTerrainEdit(restored);
    for (let frame = 0; frame < 40; frame++) fluids.step(0.25);
    expect(fluids.fluidAt(-80, 0, 100)?.kind).toBe('water');
    expect(fluids.fluidAt(80, 0, 100)).toBeNull();
  });
});
