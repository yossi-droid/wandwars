// Structural rules live beside the deterministic terrain model, not in the
// renderer. A match host can run this module without Three.js.
export const TERRAIN_SUPPORT = Object.freeze({
  cellSize: 32,
  maxCellsPerCollapse: 64,
  maxCollapseCellsPerStep: 12,
  maxLevitationNodesPerTeam: 12,
  nodeRadius: 210,
  nodeHealth: 120,
  nodeCapacity: 24,
  minimumCollapseCells: 5,
});

function cellKey(ix, iz, iy) {
  return `${ix},${iz},${iy}`;
}

function adjacentRoofKeys(cell) {
  const keys = [];
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    for (const dy of [-1, 0, 1]) keys.push(cellKey(cell.ix + dx, cell.iz + dz, cell.iy + dy));
  }
  return keys;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function createTerrainSupport(
  terrain,
  {
    materialAt = () => 'dirt',
    onCollapse = () => {},
    onEdit = () => {},
    authoritative = true,
  } = {},
) {
  const nodes = new Map();
  const pendingCollapses = [];
  const collapsingCells = new Set();
  const statuses = new Map();
  let nextNodeId = 1;
  let nextCollapseId = 1;
  let insideCollapse = false;

  function nearbyCell(x, z, y, requireCeiling = true) {
    let best = null;
    let distance = Infinity;
    for (const cell of terrain.excavationCells.values()) {
      if (requireCeiling && (!cell.ceiling || cell.openSky)) continue;
      const d = Number.isFinite(y)
        ? Math.hypot(cell.x - x, cell.z - z, cell.y - y)
        : Math.hypot(cell.x - x, cell.z - z);
      if (d >= distance || d > 80) continue;
      distance = d;
      best = cell;
    }
    return best;
  }

  function naturalAnchorSteps(cell, strength) {
    const roofY = cell.y + TERRAIN_SUPPORT.cellSize;
    const maximum = clamp(Math.round(3 + strength * 2), 3, 9);
    const visited = new Set();
    const queue = [{ ix: cell.ix, iz: cell.iz, steps: 0 }];
    for (let index = 0; index < queue.length && index < 180; index++) {
      const point = queue[index];
      const key = `${point.ix},${point.iz}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const x = point.ix * TERRAIN_SUPPORT.cellSize;
      const z = point.iz * TERRAIN_SUPPORT.cellSize;
      if (terrain.density(x, z, roofY) < 0) continue;
      const volume = terrain.volumeAt(x, z, roofY);
      if (
        volume &&
        ['collapse-resistant', 'indestructible', 'bedrock', 'protected-landmark'].includes(
          volume.kind,
        )
      )
        return point.steps;
      // A real anchor has natural mass below and on several sides. This keeps
      // a thin isolated pillar from stabilizing a large roof by itself.
      const solidNeighbors = [
        [32, 0],
        [-32, 0],
        [0, 32],
        [0, -32],
      ].filter(([dx, dz]) => terrain.density(x + dx, z + dz, roofY) >= 4).length;
      if (
        terrain.density(x, z, roofY - 32) >= 4 &&
        solidNeighbors >= 3 &&
        terrain.baseHeight(x, z) - roofY >= 8
      )
        return point.steps;
      if (point.steps >= maximum) continue;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        queue.push({ ix: point.ix + dx, iz: point.iz + dz, steps: point.steps + 1 });
    }
    return Infinity;
  }

  function activeNodesFor(cell) {
    return [...nodes.values()].filter(
      (node) =>
        node.health > 0 &&
        node.load < TERRAIN_SUPPORT.nodeCapacity * 3 &&
        node.regionId === cell.regionId &&
        Math.hypot(cell.x - node.x, cell.z - node.z) <= node.radius &&
        Math.abs(cell.y - node.y) < 96,
    );
  }

  function assessRegion(region) {
    const unsupported = [];
    let anchored = 0;
    let levitated = 0;
    let supportedWeight = 0;
    for (const key of region.ceilingCells) {
      if (collapsingCells.has(key)) continue;
      const cell = terrain.excavationCells.get(key);
      if (!cell || cell.openSky) continue;
      const roofY = cell.y + TERRAIN_SUPPORT.cellSize;
      if (
        ['collapse-resistant', 'indestructible', 'bedrock', 'protected-landmark'].includes(
          terrain.volumeAt(cell.x, cell.z, roofY)?.kind,
        )
      ) {
        anchored++;
        continue;
      }
      const material = materialAt(cell.x, cell.z, roofY);
      const strength = material?.strength ?? 1;
      const density = material?.density ?? 1;
      const thickness = clamp(terrain.baseHeight(cell.x, cell.z) - roofY, 16, 420);
      supportedWeight += (thickness / 120) * density;
      if (Number.isFinite(naturalAnchorSteps(cell, strength))) {
        anchored++;
      } else if (activeNodesFor(cell).length) {
        levitated++;
      } else {
        unsupported.push(key);
      }
    }
    const roofArea = region.ceilingCells.length * TERRAIN_SUPPORT.cellSize ** 2;
    const status = {
      regionId: region.id,
      roofArea,
      anchored,
      levitated,
      unsupported: unsupported.length,
      supportedWeight,
      state:
        unsupported.length >= TERRAIN_SUPPORT.minimumCollapseCells
          ? 'red'
          : unsupported.length
            ? 'yellow'
            : levitated
              ? anchored
                ? 'orange'
                : 'purple'
              : region.ceilingCells.length > 20 && anchored < region.ceilingCells.length / 2
                ? 'yellow'
                : 'green',
    };
    statuses.set(region.id, status);
    return { status, unsupported };
  }

  function recalculateNetworks() {
    // Region IDs change when rooms merge. Reattach nodes to the ceiling cell
    // beneath them and preserve their health fraction across the new load.
    for (const node of nodes.values()) {
      if (terrain.density(node.x, node.z, node.y + TERRAIN_SUPPORT.cellSize) < 0) {
        nodes.delete(node.id);
        continue;
      }
      const cell = nearbyCell(node.x, node.z, node.y);
      if (!cell) {
        nodes.delete(node.id);
        continue;
      }
      node.regionId = cell.regionId;
    }
    const groups = new Map();
    for (const node of nodes.values()) {
      const key = `${node.team}:${node.regionId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(node);
    }
    for (const group of groups.values()) {
      const region = terrain.regions.get(group[0].regionId);
      const load = region
        ? region.ceilingCells.filter((key) => {
            const cell = terrain.excavationCells.get(key);
            return (
              cell &&
              group.some((node) => Math.hypot(cell.x - node.x, cell.z - node.z) <= node.radius)
            );
          }).length
        : 0;
      const base = group.length * TERRAIN_SUPPORT.nodeHealth;
      const mana = group.reduce((sum, node) => sum + node.mana * 0.75, 0);
      const maximum = clamp(base + mana - load * 1.5, 15, base + mana);
      const fraction = clamp(
        group.reduce((sum, node) => sum + node.health, 0) / Math.max(1, base + mana),
        0,
        1,
      );
      const health = maximum * fraction;
      for (const node of group) {
        node.networkMaxHealth = maximum;
        node.networkHealth = health;
        node.load = load;
        node.overload = load > group.length * TERRAIN_SUPPORT.nodeCapacity;
      }
    }
  }

  function queueCollapses(region, keys) {
    const remaining = new Set(keys);
    while (remaining.size) {
      const seed = remaining.values().next().value;
      remaining.delete(seed);
      const cluster = [seed];
      for (let i = 0; i < cluster.length; i++) {
        const cell = terrain.excavationCells.get(cluster[i]);
        if (!cell) continue;
        for (const adjacent of adjacentRoofKeys(cell)) {
          if (!remaining.delete(adjacent)) continue;
          cluster.push(adjacent);
        }
      }
      if (cluster.length < TERRAIN_SUPPORT.minimumCollapseCells) continue;
      const limited = cluster.slice(0, TERRAIN_SUPPORT.maxCellsPerCollapse);
      for (const key of limited) collapsingCells.add(key);
      const points = limited.map((key) => terrain.excavationCells.get(key)).filter(Boolean);
      pendingCollapses.push({
        id: nextCollapseId++,
        regionId: region.id,
        keys: limited,
        index: 0,
        centerX: points.reduce((sum, cell) => sum + cell.x, 0) / points.length,
        centerZ: points.reduce((sum, cell) => sum + cell.z, 0) / points.length,
        radius: Math.sqrt((limited.length * TERRAIN_SUPPORT.cellSize ** 2) / Math.PI) + 40,
      });
    }
  }

  function onTerrainEdit(result) {
    if (!result.accepted) return;
    onEdit(result);
    if (insideCollapse) return;
    for (const id of statuses.keys()) if (!terrain.regions.has(id)) statuses.delete(id);
    recalculateNetworks();
    const operation = result.operation;
    for (const region of terrain.regions.values()) {
      if (
        !region.ceilingCells.some((key) => {
          const cell = terrain.excavationCells.get(key);
          return (
            cell &&
            Math.hypot(cell.x - operation.x, cell.z - operation.z) <
              operation.radius + operation.length / 2 + 240
          );
        })
      )
        continue;
      const { unsupported } = assessRegion(region);
      if (authoritative) queueCollapses(region, unsupported);
    }
  }

  function placeNode({ x, z, y, team, ownerId }) {
    if (team == null || ownerId == null) return { accepted: false, reason: 'invalid-owner' };
    const cell = nearbyCell(x, z, y);
    if (!cell) return { accepted: false, reason: 'no-ceiling' };
    if (
      [...nodes.values()].filter((node) => node.team === team).length >=
      TERRAIN_SUPPORT.maxLevitationNodesPerTeam
    )
      return { accepted: false, reason: 'node-limit' };
    const node = {
      id: nextNodeId++,
      team,
      ownerId,
      x: cell.x,
      z: cell.z,
      y: cell.y,
      regionId: cell.regionId,
      radius: TERRAIN_SUPPORT.nodeRadius,
      health: TERRAIN_SUPPORT.nodeHealth,
      mana: 0,
      networkHealth: TERRAIN_SUPPORT.nodeHealth,
      networkMaxHealth: TERRAIN_SUPPORT.nodeHealth,
    };
    nodes.set(node.id, node);
    recalculateNetworks();
    const region = terrain.regions.get(node.regionId);
    if (region) assessRegion(region);
    return { accepted: true, node };
  }

  function previewNode(x, z) {
    const cell = nearbyCell(x, z, null);
    return cell
      ? {
          valid: true,
          x: cell.x,
          z: cell.z,
          y: cell.y,
          estimatedArea: Math.PI * TERRAIN_SUPPORT.nodeRadius ** 2,
        }
      : { valid: false, reason: 'no-ceiling' };
  }

  function reinforceNode(id, team, mana) {
    const node = nodes.get(id);
    if (!node || node.team !== team || !Number.isFinite(mana) || mana <= 0)
      return { accepted: false, reason: 'invalid-reinforcement' };
    node.mana += mana;
    node.health = Math.min(node.health + mana * 0.75, TERRAIN_SUPPORT.nodeHealth + node.mana);
    recalculateNetworks();
    const region = terrain.regions.get(node.regionId);
    if (region) assessRegion(region);
    return { accepted: true, node };
  }

  function damageNode(id, damage) {
    const node = nodes.get(id);
    if (!node || !Number.isFinite(damage) || damage <= 0)
      return { accepted: false, reason: 'invalid-damage' };
    node.health -= damage;
    if (node.health <= 0) nodes.delete(id);
    recalculateNetworks();
    if (!authoritative) return { accepted: true, destroyed: !nodes.has(id) };
    for (const region of terrain.regions.values()) {
      if (region.id !== node.regionId) continue;
      const { unsupported } = assessRegion(region);
      queueCollapses(region, unsupported);
    }
    return { accepted: true, destroyed: !nodes.has(id) };
  }

  function stepCollapses() {
    let processed = 0;
    const changed = [];
    while (pendingCollapses.length && processed < TERRAIN_SUPPORT.maxCollapseCellsPerStep) {
      const collapse = pendingCollapses[0];
      const key = collapse.keys[collapse.index++];
      const cell = terrain.excavationCells.get(key);
      if (cell) {
        const roofY = cell.y + TERRAIN_SUPPORT.cellSize;
        const top = terrain.baseHeight(cell.x, cell.z) + 12;
        const length = Math.max(24, top - roofY);
        insideCollapse = true;
        const result = terrain.subtractBrush({
          shape: 'shaft',
          x: cell.x,
          z: cell.z,
          y: roofY + length / 2,
          radius: 32,
          length,
          source: 'collapse',
        });
        insideCollapse = false;
        if (result.accepted) {
          processed++;
          changed.push([cell.x, cell.z]);
          onCollapse({
            id: collapse.id,
            first: collapse.index === 1,
            x: cell.x,
            z: cell.z,
            y: roofY,
            centerX: collapse.centerX,
            centerZ: collapse.centerZ,
            radius: collapse.radius,
            area: collapse.keys.length * TERRAIN_SUPPORT.cellSize ** 2,
            damage: clamp(20 + collapse.keys.length * 1.6, 20, 90),
          });
        }
      }
      if (collapse.index >= collapse.keys.length) pendingCollapses.shift();
    }
    if (processed && !pendingCollapses.length) {
      recalculateNetworks();
      for (const region of terrain.regions.values()) {
        const near = region.ceilingCells.some((key) => {
          const cell = terrain.excavationCells.get(key);
          return cell && changed.some(([x, z]) => Math.hypot(cell.x - x, cell.z - z) < 240);
        });
        if (!near) continue;
        const { unsupported } = assessRegion(region);
        queueCollapses(region, unsupported);
      }
    }
    return processed;
  }

  function statusAt(x, z, y) {
    const cell = nearbyCell(x, z, y, false);
    if (!cell || cell.openSky) return null;
    return statuses.get(cell.regionId) || null;
  }

  function forceCollapse(regionId) {
    if (!authoritative) return { accepted: false, reason: 'not-authoritative' };
    const region = terrain.regions.get(regionId);
    if (!region || !region.ceilingCells.length) return { accepted: false, reason: 'no-ceiling' };
    const before = pendingCollapses.length;
    queueCollapses(region, region.ceilingCells);
    return {
      accepted: pendingCollapses.length > before,
      queued: pendingCollapses.length - before,
    };
  }

  terrain.setEditListener(onTerrainEdit);
  return {
    nodes,
    statuses,
    pendingCollapses,
    collapsingCells,
    onTerrainEdit,
    placeNode,
    previewNode,
    reinforceNode,
    damageNode,
    stepCollapses,
    statusAt,
    forceCollapse,
    recalculateNetworks,
  };
}
