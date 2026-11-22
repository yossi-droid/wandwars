// Small, bounded cell-flow simulation. It follows the excavated-space graph,
// so neither water nor lava can cross intact terrain.
export const TERRAIN_FLUIDS = Object.freeze({
  cellSize: 32,
  maxCellsPerStep: 96,
  waterRate: 0.8,
  lavaRate: 0.32,
});

function neighboringKeys(cell) {
  return [
    `${cell.ix + 1},${cell.iz},${cell.iy}`,
    `${cell.ix - 1},${cell.iz},${cell.iy}`,
    `${cell.ix},${cell.iz + 1},${cell.iy}`,
    `${cell.ix},${cell.iz - 1},${cell.iy}`,
    `${cell.ix},${cell.iz},${cell.iy + 1}`,
    `${cell.ix},${cell.iz},${cell.iy - 1}`,
  ];
}

export function createTerrainFluids(terrain, { naturalWaterAt = () => null } = {}) {
  const sources = [];
  const filledCells = new Map();
  const frontier = [];
  const queued = new Set();
  let nextSourceId = 1;

  function queue(key) {
    if (queued.has(key)) return;
    queued.add(key);
    frontier.push(key);
  }

  function markSource({ kind, x, z, y, radius = 64, level = y }) {
    if (
      (kind !== 'water' && kind !== 'lava') ||
      ![x, z, y, radius, level].every(Number.isFinite) ||
      radius <= 0
    )
      return null;
    const source = { id: nextSourceId++, kind, x, z, y, radius, level };
    sources.push(source);
    for (const [key, cell] of terrain.excavationCells) {
      if (Math.hypot(cell.x - x, cell.z - z, cell.y - y) <= radius) queue(key);
    }
    return source;
  }

  function sourceFor(cell) {
    for (const source of sources) {
      if (
        Math.hypot(cell.x - source.x, cell.z - source.z, cell.y - source.y) <= source.radius &&
        cell.y < source.level
      )
        return source;
    }
    const natural = naturalWaterAt(cell.x, cell.z, cell.y);
    return natural?.kind === 'water' && cell.y < natural.level ? natural : null;
  }

  function onTerrainEdit(result) {
    if (!result.accepted) return;
    const operation = result.operation;
    const reach = operation.radius + operation.length / 2 + TERRAIN_FLUIDS.cellSize * 2;
    if (operation.mode === 'fill') {
      for (const key of filledCells.keys()) {
        if (!terrain.excavationCells.has(key)) filledCells.delete(key);
      }
    }
    for (const [key, cell] of terrain.excavationCells) {
      if (Math.hypot(cell.x - operation.x, cell.z - operation.z) > reach) continue;
      if (Math.abs(cell.y - operation.y) > reach) continue;
      if (sourceFor(cell) || neighboringKeys(cell).some((neighbor) => filledCells.has(neighbor)))
        queue(key);
    }
  }

  function step(dt) {
    const iterations = Math.min(frontier.length, TERRAIN_FLUIDS.maxCellsPerStep);
    for (let index = 0; index < iterations; index++) {
      const key = frontier.shift();
      queued.delete(key);
      const cell = terrain.excavationCells.get(key);
      if (!cell) {
        filledCells.delete(key);
        continue;
      }
      const source = sourceFor(cell);
      let current = filledCells.get(key);
      if (!current && source) {
        current = { kind: source.kind, amount: 0, level: source.level };
        filledCells.set(key, current);
      }
      if (!current) continue;
      if (source) current.level = Math.max(current.level, source.level);
      const rate = current.kind === 'lava' ? TERRAIN_FLUIDS.lavaRate : TERRAIN_FLUIDS.waterRate;
      current.amount = Math.min(1, current.amount + rate * dt * (source ? 2 : 1));
      if (current.amount < 1) queue(key);
      for (const neighborKey of neighboringKeys(cell)) {
        const neighbor = terrain.excavationCells.get(neighborKey);
        if (
          !neighbor ||
          neighbor.regionId !== cell.regionId ||
          neighbor.y > cell.y + 32 ||
          neighbor.y >= current.level
        )
          continue;
        if (current.amount < (neighbor.y < cell.y ? 0.3 : 0.65)) continue;
        const existing = filledCells.get(neighborKey);
        if (existing && existing.amount >= 1) continue;
        if (!existing)
          filledCells.set(neighborKey, { kind: current.kind, amount: 0, level: current.level });
        else existing.level = Math.max(existing.level, current.level);
        queue(neighborKey);
      }
    }
  }

  function fluidAt(x, z, y) {
    const ix = Math.round(x / TERRAIN_FLUIDS.cellSize);
    const iz = Math.round(z / TERRAIN_FLUIDS.cellSize);
    const iy = Math.floor(y / TERRAIN_FLUIDS.cellSize);
    return filledCells.get(`${ix},${iz},${iy}`) || null;
  }

  function heatAt(x, z) {
    let heat = 0;
    for (const source of sources) {
      if (source.kind !== 'lava') continue;
      heat = Math.max(heat, Math.max(0, 1 - Math.hypot(x - source.x, z - source.z) / 360));
    }
    return heat;
  }

  return { sources, filledCells, markSource, onTerrainEdit, step, fluidAt, heatAt };
}
