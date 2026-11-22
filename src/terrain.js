// Match-local, deterministic volumetric terrain. Positive density is solid;
// spherical subtraction makes it negative. Meshes and collision read this same
// field, so a rendered opening cannot disagree with the game rules.
export const TERRAIN_GRID = Object.freeze({ span: 26600, cells: 260, cellsPerChunk: 4 });
export const TERRAIN_CHUNK_SIZE =
  (TERRAIN_GRID.span / TERRAIN_GRID.cells) * TERRAIN_GRID.cellsPerChunk;
const HALF = TERRAIN_GRID.span / 2;
const CHUNKS_PER_SIDE = TERRAIN_GRID.cells / TERRAIN_GRID.cellsPerChunk;
const BEDROCK_DEPTH = 420;
const REGION_CELL_SIZE = 32;
const VOLUME_BUCKET_SIZE = 256;
export const TERRAIN_VOLUME_KINDS = Object.freeze([
  'diggable',
  'partially-diggable',
  'indestructible',
  'bedrock',
  'protected-landmark',
  'water-sensitive',
  'collapse-resistant',
]);

function chunkCoordinate(value) {
  return Math.max(
    0,
    Math.min(CHUNKS_PER_SIDE - 1, Math.floor((value + HALF) / TERRAIN_CHUNK_SIZE)),
  );
}

function brushDistance(operation, x, z, y) {
  const dx = x - operation.x;
  const dz = z - operation.z;
  const dy = y - operation.y;
  if (operation.shape === 'sphere') return Math.hypot(dx, dz, dy) - operation.radius;
  if (operation.shape === 'cylinder' || operation.shape === 'shaft')
    return Math.max(Math.hypot(dx, dz) - operation.radius, Math.abs(dy) - operation.length / 2);
  const along = Math.max(
    -operation.length / 2,
    Math.min(operation.length / 2, dx * operation.dirX + dz * operation.dirZ + dy * operation.dirY),
  );
  const sideX = dx - operation.dirX * along;
  const sideZ = dz - operation.dirZ * along;
  const sideY = dy - operation.dirY * along;
  if (operation.shape === 'cone') {
    const taper = 1 - (along + operation.length / 2) / operation.length;
    return Math.hypot(sideX, sideZ, sideY) - Math.max(8, operation.radius * taper);
  }
  return Math.hypot(sideX, sideZ, sideY) - operation.radius;
}

export function terrainChunkAt(x, z) {
  return [chunkCoordinate(x), chunkCoordinate(z)];
}

export function terrainChunkKey(cx, cz) {
  return `${cx},${cz}`;
}

export function createTerrain(naturalHeight) {
  const operations = [];
  const byChunk = new Map();
  const dirty = new Set();
  let sequence = 0;
  let nextRegionId = 1;
  const excavationCells = new Map();
  const regions = new Map();
  const gridStep = TERRAIN_GRID.span / TERRAIN_GRID.cells;
  const naturalSamples = new Map();
  const meshFields = new Map();
  const protectedVolumes = [];
  const volumeBuckets = new Map();
  const pendingOperations = new Map();
  let nextVolumeId = 1;
  let onEdit = null;

  function volumeBucketKey(ix, iz) {
    return `${ix},${iz}`;
  }

  function eachVolumeBucket(x, z, radius, visit) {
    const minX = Math.floor((x - radius) / VOLUME_BUCKET_SIZE);
    const maxX = Math.floor((x + radius) / VOLUME_BUCKET_SIZE);
    const minZ = Math.floor((z - radius) / VOLUME_BUCKET_SIZE);
    const maxZ = Math.floor((z + radius) / VOLUME_BUCKET_SIZE);
    for (let iz = minZ; iz <= maxZ; iz++)
      for (let ix = minX; ix <= maxX; ix++) visit(volumeBucketKey(ix, iz));
  }

  function markVolume({ x, z, y, radius, height = radius * 2, kind, materialId = null }) {
    if (
      !TERRAIN_VOLUME_KINDS.includes(kind) ||
      ![x, z, y, radius, height].every(Number.isFinite) ||
      radius <= 0 ||
      height <= 0
    )
      return null;
    const volume = { id: nextVolumeId++, x, z, y, radius, height, kind, materialId };
    protectedVolumes.push(volume);
    eachVolumeBucket(x, z, radius, (key) => {
      if (!volumeBuckets.has(key)) volumeBuckets.set(key, []);
      volumeBuckets.get(key).push(volume);
    });
    return volume;
  }

  function unmarkVolume(id) {
    const index = protectedVolumes.findIndex((volume) => volume.id === id);
    if (index < 0) return false;
    const [volume] = protectedVolumes.splice(index, 1);
    eachVolumeBucket(volume.x, volume.z, volume.radius, (key) => {
      const bucket = volumeBuckets.get(key);
      if (!bucket) return;
      const offset = bucket.indexOf(volume);
      if (offset >= 0) bucket.splice(offset, 1);
      if (!bucket.length) volumeBuckets.delete(key);
    });
    return true;
  }

  function volumeAt(x, z, y) {
    const bucket =
      volumeBuckets.get(
        volumeBucketKey(Math.floor(x / VOLUME_BUCKET_SIZE), Math.floor(z / VOLUME_BUCKET_SIZE)),
      ) || [];
    for (let i = bucket.length - 1; i >= 0; i--) {
      const volume = bucket[i];
      if (
        Math.hypot(x - volume.x, z - volume.z) <= volume.radius &&
        Math.abs(y - volume.y) <= volume.height / 2
      )
        return volume;
    }
    return null;
  }
  function gridHeight(ix, iz) {
    const key = iz * (TERRAIN_GRID.cells + 1) + ix;
    if (!naturalSamples.has(key))
      naturalSamples.set(key, naturalHeight(-HALF + ix * gridStep, -HALF + iz * gridStep));
    return naturalSamples.get(key);
  }
  // The untouched Three.js island is a 260x260 triangle heightfield. Using
  // the same interpolated surface at arbitrary points keeps new chunk edges,
  // character feet, and the old mesh aligned exactly.
  function baseHeight(x, z) {
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) return naturalHeight(x, z);
    const gx = (x + HALF) / gridStep;
    const gz = (z + HALF) / gridStep;
    const ix = Math.min(TERRAIN_GRID.cells - 1, Math.floor(gx));
    const iz = Math.min(TERRAIN_GRID.cells - 1, Math.floor(gz));
    const tx = gx - ix;
    const tz = gz - iz;
    const a = gridHeight(ix, iz) * (1 - tx) + gridHeight(ix + 1, iz) * tx;
    const b = gridHeight(ix, iz + 1) * (1 - tx) + gridHeight(ix + 1, iz + 1) * tx;
    return a * (1 - tz) + b * tz;
  }

  function operationsAt(x, z) {
    const [cx, cz] = terrainChunkAt(x, z);
    return byChunk.get(terrainChunkKey(cx, cz)) || [];
  }

  function density(x, z, y) {
    const natural = baseHeight(x, z);
    if (y <= natural - BEDROCK_DEPTH) return natural - y;
    let value = natural - y;
    for (const operation of operationsAt(x, z)) {
      const brush = brushDistance(operation, x, z, y);
      value = operation.mode === 'fill' ? Math.max(value, -brush) : Math.min(value, brush);
    }
    return value;
  }

  function surfaceHeight(x, z) {
    const natural = baseHeight(x, z);
    if (!operationsAt(x, z).length) return natural;
    if (density(x, z, natural) >= 0) return natural;
    let upper = natural;
    let lower = natural - BEDROCK_DEPTH;
    // Start from the sky and find the first solid surface, preserving the roof
    // of an enclosed cave while exposing the floor of an open trench.
    for (let y = natural - 12; y > lower; y -= 12) {
      if (density(x, z, y) < 0) continue;
      lower = y;
      break;
    }
    for (let i = 0; i < 12; i++) {
      const mid = (lower + upper) * 0.5;
      if (density(x, z, mid) >= 0) lower = mid;
      else upper = mid;
    }
    return lower;
  }

  // The first solid below a character's feet can be a cave floor even when a
  // roof remains above it. Keeping this query separate from surfaceHeight is
  // essential for vertical drills and the fall back down their shafts.
  function supportHeight(x, z, fromY) {
    const natural = baseHeight(x, z);
    const bottom = natural - BEDROCK_DEPTH;
    let upper = Math.min(fromY, natural + 16);
    if (density(x, z, upper) >= 0) {
      let lower = upper;
      for (let candidate = upper + 8; candidate <= upper + 64; candidate += 8) {
        if (density(x, z, candidate) >= 0) continue;
        upper = candidate;
        for (let i = 0; i < 12; i++) {
          const middle = (lower + upper) / 2;
          if (density(x, z, middle) >= 0) lower = middle;
          else upper = middle;
        }
        return lower;
      }
      return fromY;
    }
    for (let lower = upper - 8; lower >= bottom; lower -= 8) {
      if (density(x, z, lower) < 0) continue;
      for (let i = 0; i < 12; i++) {
        const middle = (lower + upper) / 2;
        if (density(x, z, middle) >= 0) lower = middle;
        else upper = middle;
      }
      return lower;
    }
    return bottom;
  }

  function subtractBrush({
    shape = 'sphere',
    x,
    z,
    y,
    radius,
    length = 0,
    dirX = 1,
    dirZ = 0,
    dirY = 0,
    source = 'dig',
    mode = 'subtract',
    preview = false,
  }) {
    if (![x, z, y, radius].every(Number.isFinite) || radius < 8 || radius > 160) {
      return { accepted: false, reason: 'invalid-brush' };
    }
    const shapes = ['sphere', 'capsule', 'tunnel', 'trench', 'cylinder', 'shaft', 'cone'];
    if (
      (mode !== 'subtract' && mode !== 'fill') ||
      !shapes.includes(shape) ||
      !Number.isFinite(length) ||
      length < 0 ||
      length > 640 ||
      (shape !== 'sphere' && length < 24)
    )
      return { accepted: false, reason: 'invalid-brush' };
    const directionLength = Math.hypot(dirX, dirZ, dirY);
    if (
      shape !== 'sphere' &&
      shape !== 'cylinder' &&
      shape !== 'shaft' &&
      (!Number.isFinite(directionLength) || directionLength < 0.001)
    )
      return { accepted: false, reason: 'invalid-brush' };
    const reach = radius + length / 2;
    const verticalReach =
      shape === 'cylinder' || shape === 'shaft'
        ? length / 2
        : radius + ((Math.abs(dirY) / (directionLength || 1)) * length) / 2;
    if (
      Math.hypot(x, z) + reach > 9200 ||
      y - verticalReach < baseHeight(x, z) - BEDROCK_DEPTH + 18
    ) {
      return { accepted: false, reason: 'protected-terrain' };
    }
    // Sample the actual brush rather than just its bounding box. This allows
    // edits beside a protected landmark while rejecting cuts through it.
    const samples = Math.max(1, Math.ceil(length / 32));
    for (let sample = 0; sample <= samples; sample++) {
      const t = samples ? sample / samples - 0.5 : 0;
      const sx = x + dirX * length * t;
      const sz = z + dirZ * length * t;
      const sy = y + dirY * length * t;
      const nearbyVolumes = new Set();
      eachVolumeBucket(sx, sz, radius, (key) => {
        for (const volume of volumeBuckets.get(key) || []) nearbyVolumes.add(volume);
      });
      for (const volume of nearbyVolumes) {
        if (
          volume.kind !== 'indestructible' &&
          volume.kind !== 'bedrock' &&
          volume.kind !== 'protected-landmark'
        )
          continue;
        if (
          Math.hypot(sx - volume.x, sz - volume.z) < radius + volume.radius &&
          Math.abs(sy - volume.y) < radius + volume.height / 2
        )
          return { accepted: false, reason: 'protected-terrain' };
      }
    }
    const firstX = chunkCoordinate(x - reach);
    const lastX = chunkCoordinate(x + reach);
    const firstZ = chunkCoordinate(z - reach);
    const lastZ = chunkCoordinate(z + reach);
    if ((lastX - firstX + 1) * (lastZ - firstZ + 1) > 9)
      return { accepted: false, reason: 'too-many-chunks' };
    if (preview) return { accepted: true };
    const operation = {
      sequence: ++sequence,
      shape,
      x,
      z,
      y,
      radius,
      length,
      dirX: dirX / (directionLength || 1),
      dirZ: dirZ / (directionLength || 1),
      dirY: dirY / (directionLength || 1),
      source,
      mode,
    };
    operations.push(operation);
    for (let cz = firstZ; cz <= lastZ; cz++) {
      for (let cx = firstX; cx <= lastX; cx++) {
        const key = terrainChunkKey(cx, cz);
        if (!byChunk.has(key)) byChunk.set(key, []);
        byChunk.get(key).push(operation);
        dirty.add(key);
      }
    }
    updateExcavationRegions(operation, reach, verticalReach);
    const result = { accepted: true, operation, chunks: [...dirty] };
    onEdit?.(result);
    return result;
  }

  function exportOperations() {
    return operations.map((operation) => ({ ...operation }));
  }

  // A match host can send compact ordered operations. Out-of-order packets are
  // buffered until every earlier edit arrives; duplicates cannot dig twice.
  function applyOrderedOperation(operation) {
    if (!Number.isSafeInteger(operation?.sequence) || operation.sequence < 1)
      return { accepted: false, reason: 'invalid-sequence' };
    if (operation.sequence <= sequence || pendingOperations.has(operation.sequence))
      return { accepted: false, reason: 'duplicate-operation' };
    pendingOperations.set(operation.sequence, operation);
    let applied = 0;
    while (pendingOperations.has(sequence + 1)) {
      const next = pendingOperations.get(sequence + 1);
      pendingOperations.delete(sequence + 1);
      const result = subtractBrush(next);
      if (!result.accepted) {
        pendingOperations.clear();
        return result;
      }
      applied++;
    }
    return { accepted: true, applied, waitingFor: pendingOperations.size ? sequence + 1 : null };
  }

  function chunkChecksum(cx, cz) {
    let hash = 2166136261;
    for (const operation of byChunk.get(terrainChunkKey(cx, cz)) || []) {
      for (const value of [
        operation.sequence,
        operation.x,
        operation.z,
        operation.y,
        operation.radius,
        operation.length,
      ]) {
        const number = Math.round(value * 100) >>> 0;
        hash = Math.imul(hash ^ number, 16777619) >>> 0;
      }
    }
    return hash.toString(16).padStart(8, '0');
  }

  function loadOperations(snapshot) {
    if (!Array.isArray(snapshot) || operations.length)
      return { accepted: false, reason: 'nonempty-terrain' };
    for (const operation of snapshot) {
      const result = applyOrderedOperation(operation);
      if (!result.accepted) return result;
    }
    if (pendingOperations.size)
      return { accepted: false, reason: 'missing-operation', waitingFor: sequence + 1 };
    return { accepted: true, count: sequence };
  }

  function regionCellKey(ix, iz, iy) {
    return `${ix},${iz},${iy}`;
  }

  function updateExcavationRegions(operation, horizontalReach, verticalReach) {
    const touched = new Set();
    const previousRegions = new Set();
    const minX = Math.floor((operation.x - horizontalReach) / REGION_CELL_SIZE);
    const maxX = Math.ceil((operation.x + horizontalReach) / REGION_CELL_SIZE);
    const minZ = Math.floor((operation.z - horizontalReach) / REGION_CELL_SIZE);
    const maxZ = Math.ceil((operation.z + horizontalReach) / REGION_CELL_SIZE);
    const minY = Math.floor((operation.y - verticalReach) / REGION_CELL_SIZE);
    const maxY = Math.ceil((operation.y + verticalReach) / REGION_CELL_SIZE);
    for (let iz = minZ; iz <= maxZ; iz++)
      for (let ix = minX; ix <= maxX; ix++) {
        const x = ix * REGION_CELL_SIZE;
        const z = iz * REGION_CELL_SIZE;
        const original = baseHeight(x, z);
        for (let iy = minY; iy <= maxY; iy++) {
          const y = iy * REGION_CELL_SIZE;
          const key = regionCellKey(ix, iz, iy);
          const previous = excavationCells.get(key);
          if (previous?.regionId) previousRegions.add(previous.regionId);
          if (y >= original - 8 || density(x, z, y) > -4) {
            if (previous) {
              excavationCells.delete(key);
              touched.add(key);
            }
            continue;
          }
          excavationCells.set(key, {
            ix,
            iz,
            iy,
            x,
            z,
            y,
            openSky: surfaceHeight(x, z) < y + REGION_CELL_SIZE / 2,
            floor: density(x, z, y - REGION_CELL_SIZE) >= 0,
            ceiling: density(x, z, y + REGION_CELL_SIZE) >= 0,
            regionId: previous?.regionId || null,
          });
          touched.add(key);
        }
      }
    if (!touched.size) return;
    // Include the existing components beside the edit. This makes a new tunnel
    // fuse only the rooms it touches, rather than scanning every island cell.
    const neighborsOf = (cell) => [
      regionCellKey(cell.ix + 1, cell.iz, cell.iy),
      regionCellKey(cell.ix - 1, cell.iz, cell.iy),
      regionCellKey(cell.ix, cell.iz + 1, cell.iy),
      regionCellKey(cell.ix, cell.iz - 1, cell.iy),
      regionCellKey(cell.ix, cell.iz, cell.iy + 1),
      regionCellKey(cell.ix, cell.iz, cell.iy - 1),
    ];
    for (const key of touched) {
      const cell = excavationCells.get(key);
      if (!cell) continue;
      for (const neighborKey of neighborsOf(cell)) {
        const regionId = excavationCells.get(neighborKey)?.regionId;
        if (regionId) previousRegions.add(regionId);
      }
    }
    const work = new Set(touched);
    for (const id of previousRegions) {
      for (const key of regions.get(id)?.cellKeys || []) work.add(key);
      regions.delete(id);
    }
    while (work.size) {
      const seed = work.values().next().value;
      work.delete(seed);
      if (!excavationCells.has(seed)) continue;
      const id = nextRegionId++;
      const region = {
        id,
        cellKeys: new Set(),
        ceilingCells: [],
        floorCells: [],
        openings: [],
        undergroundCells: 0,
      };
      const queue = [seed];
      for (let index = 0; index < queue.length; index++) {
        const key = queue[index];
        const cell = excavationCells.get(key);
        if (!cell) continue;
        cell.regionId = id;
        region.cellKeys.add(key);
        if (cell.floor) region.floorCells.push(key);
        if (cell.ceiling && !cell.openSky) region.ceilingCells.push(key);
        if (cell.openSky) region.openings.push(key);
        else region.undergroundCells++;
        for (const adjacent of neighborsOf(cell)) {
          if (!work.delete(adjacent)) continue;
          queue.push(adjacent);
        }
      }
      regions.set(id, region);
    }
  }

  function subtractSphere(x, z, y, radius) {
    return subtractBrush({ shape: 'sphere', x, z, y, radius });
  }

  function fillSphere(x, z, y, radius) {
    return subtractBrush({ shape: 'sphere', x, z, y, radius, mode: 'fill', source: 'restore' });
  }

  function takeDirtyChunks() {
    const keys = [...dirty];
    dirty.clear();
    return keys;
  }

  function rebuildChunk(cx, cz) {
    if (
      !Number.isInteger(cx) ||
      !Number.isInteger(cz) ||
      cx < 0 ||
      cz < 0 ||
      cx >= CHUNKS_PER_SIDE ||
      cz >= CHUNKS_PER_SIDE
    )
      return false;
    dirty.add(terrainChunkKey(cx, cz));
    return true;
  }

  function normal(x, z, y) {
    const epsilon = 2;
    const nx = density(x - epsilon, z, y) - density(x + epsilon, z, y);
    const ny = density(x, z, y - epsilon) - density(x, z, y + epsilon);
    const nz = density(x, z - epsilon, y) - density(x, z + epsilon, y);
    const length = Math.hypot(nx, ny, nz) || 1;
    return [nx / length, ny / length, nz / length];
  }

  // Marching tetrahedra avoids cube ambiguities and generates curved, continuous
  // iso-surfaces. Adjacent chunks sample the same world coordinates and normals.
  function meshChunk(cx, cz, step = 32) {
    const x0 = -HALF + cx * TERRAIN_CHUNK_SIZE;
    const z0 = -HALF + cz * TERRAIN_CHUNK_SIZE;
    const heights = [];
    for (let iz = 0; iz <= 4; iz++)
      for (let ix = 0; ix <= 4; ix++)
        heights.push(
          baseHeight(x0 + (ix / 4) * TERRAIN_CHUNK_SIZE, z0 + (iz / 4) * TERRAIN_CHUNK_SIZE),
        );
    const bottom = Math.floor((Math.min(...heights) - BEDROCK_DEPTH) / step) * step;
    const top = Math.ceil((Math.max(...heights) + 64) / step) * step;
    const cells = 16;
    const verticalCells = Math.ceil((top - bottom) / step);
    const strideY = verticalCells + 1;
    const strideX = strideY;
    const strideZ = (cells + 1) * strideY;
    const cacheKey = `${cx},${cz},${step}`;
    let cached = meshFields.get(cacheKey);
    if (!cached || cached.bottom !== bottom || cached.verticalCells !== verticalCells) {
      cached = {
        bottom,
        verticalCells,
        processed: 0,
        field: new Float32Array((cells + 1) * (cells + 1) * strideY),
      };
      for (let iz = 0; iz <= cells; iz++)
        for (let ix = 0; ix <= cells; ix++) {
          const x = x0 + (ix / cells) * TERRAIN_CHUNK_SIZE;
          const z = z0 + (iz / cells) * TERRAIN_CHUNK_SIZE;
          const natural = baseHeight(x, z);
          for (let iy = 0; iy <= verticalCells; iy++)
            cached.field[iz * strideZ + ix * strideX + iy] = natural - (bottom + iy * step);
        }
      meshFields.set(cacheKey, cached);
      if (meshFields.size > 96) meshFields.delete(meshFields.keys().next().value);
    }
    const field = cached.field;
    const localOperations = byChunk.get(terrainChunkKey(cx, cz)) || [];
    const fieldAt = (ix, iy, iz) => field[iz * strideZ + ix * strideX + iy];
    for (let index = cached.processed; index < localOperations.length; index++) {
      const operation = localOperations[index];
      const reach = operation.radius + operation.length / 2;
      const ixMin = Math.max(
        0,
        Math.floor(((operation.x - reach - x0) / TERRAIN_CHUNK_SIZE) * cells),
      );
      const ixMax = Math.min(
        cells,
        Math.ceil(((operation.x + reach - x0) / TERRAIN_CHUNK_SIZE) * cells),
      );
      const izMin = Math.max(
        0,
        Math.floor(((operation.z - reach - z0) / TERRAIN_CHUNK_SIZE) * cells),
      );
      const izMax = Math.min(
        cells,
        Math.ceil(((operation.z + reach - z0) / TERRAIN_CHUNK_SIZE) * cells),
      );
      const iyMin = Math.max(0, Math.floor((operation.y - reach - bottom) / step));
      const iyMax = Math.min(verticalCells, Math.ceil((operation.y + reach - bottom) / step));
      for (let iz = izMin; iz <= izMax; iz++)
        for (let ix = ixMin; ix <= ixMax; ix++) {
          const x = x0 + (ix / cells) * TERRAIN_CHUNK_SIZE;
          const z = z0 + (iz / cells) * TERRAIN_CHUNK_SIZE;
          const natural = baseHeight(x, z);
          for (let iy = iyMin; iy <= iyMax; iy++) {
            const y = bottom + iy * step;
            if (y <= natural - BEDROCK_DEPTH) continue;
            const offset = iz * strideZ + ix * strideX + iy;
            const brush = brushDistance(operation, x, z, y);
            field[offset] =
              operation.mode === 'fill'
                ? Math.max(field[offset], -brush)
                : Math.min(field[offset], brush);
          }
        }
    }
    cached.processed = localOperations.length;
    const sampleField = (x, z, y) => {
      const gx = Math.max(0, Math.min(cells - 0.0001, ((x - x0) / TERRAIN_CHUNK_SIZE) * cells));
      const gz = Math.max(0, Math.min(cells - 0.0001, ((z - z0) / TERRAIN_CHUNK_SIZE) * cells));
      const gy = Math.max(0, Math.min(verticalCells - 0.0001, (y - bottom) / step));
      const ix = Math.floor(gx);
      const iz = Math.floor(gz);
      const iy = Math.floor(gy);
      const tx = gx - ix;
      const tz = gz - iz;
      const ty = gy - iy;
      const corner = (dx, dz, dy) => fieldAt(ix + dx, iy + dy, iz + dz);
      const blend = (dx, dz) => corner(dx, dz, 0) * (1 - ty) + corner(dx, dz, 1) * ty;
      const front = blend(0, 0) * (1 - tx) + blend(1, 0) * tx;
      const back = blend(0, 1) * (1 - tx) + blend(1, 1) * tx;
      return front * (1 - tz) + back * tz;
    };
    const vertices = [];
    const normals = [];
    const normalCache = new Map();
    const vertexNormal = (point) => {
      const key = point.map((coordinate) => coordinate.toFixed(3)).join(',');
      let value = normalCache.get(key);
      if (!value) {
        const x = point[0];
        const y = point[1];
        const z = point[2];
        const margin = TERRAIN_CHUNK_SIZE / cells;
        if (
          x - x0 < margin ||
          x0 + TERRAIN_CHUNK_SIZE - x < margin ||
          z - z0 < margin ||
          z0 + TERRAIN_CHUNK_SIZE - z < margin
        ) {
          // Boundary normals use the exact world density so adjacent chunks
          // agree even when their local interpolation grids differ.
          value = normal(x, z, y);
        } else {
          const epsilon = Math.min(step / 4, 8);
          const nx = sampleField(x - epsilon, z, y) - sampleField(x + epsilon, z, y);
          const ny = sampleField(x, z, y - epsilon) - sampleField(x, z, y + epsilon);
          const nz = sampleField(x, z - epsilon, y) - sampleField(x, z + epsilon, y);
          const size = Math.hypot(nx, ny, nz) || 1;
          value = [nx / size, ny / size, nz / size];
        }
        normalCache.set(key, value);
      }
      return value;
    };
    const tetrahedra = [
      [0, 5, 1, 6],
      [0, 1, 2, 6],
      [0, 2, 3, 6],
      [0, 3, 7, 6],
      [0, 7, 4, 6],
      [0, 4, 5, 6],
    ];
    const edgePairs = [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ];
    const pushTriangle = (a, b, c) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      const expected = vertexNormal(a);
      if (cross[0] * expected[0] + cross[1] * expected[1] + cross[2] * expected[2] < 0)
        [b, c] = [c, b];
      for (const p of [a, b, c]) {
        vertices.push(...p);
        normals.push(...vertexNormal(p));
      }
    };
    for (let iz = 0; iz < cells; iz++)
      for (let ix = 0; ix < cells; ix++)
        for (let iy = 0; iy < verticalCells; iy++) {
          const xa = x0 + (ix / cells) * TERRAIN_CHUNK_SIZE;
          const xb = x0 + ((ix + 1) / cells) * TERRAIN_CHUNK_SIZE;
          const za = z0 + (iz / cells) * TERRAIN_CHUNK_SIZE;
          const zb = z0 + ((iz + 1) / cells) * TERRAIN_CHUNK_SIZE;
          const ya = bottom + iy * step;
          const yb = ya + step;
          const p = [
            [xa, ya, za],
            [xb, ya, za],
            [xb, ya, zb],
            [xa, ya, zb],
            [xa, yb, za],
            [xb, yb, za],
            [xb, yb, zb],
            [xa, yb, zb],
          ];
          const values = [
            fieldAt(ix, iy, iz),
            fieldAt(ix + 1, iy, iz),
            fieldAt(ix + 1, iy, iz + 1),
            fieldAt(ix, iy, iz + 1),
            fieldAt(ix, iy + 1, iz),
            fieldAt(ix + 1, iy + 1, iz),
            fieldAt(ix + 1, iy + 1, iz + 1),
            fieldAt(ix, iy + 1, iz + 1),
          ];
          if (values.every((v) => v >= 0) || values.every((v) => v < 0)) continue;
          for (const tetrahedron of tetrahedra) {
            const intersections = [];
            for (const [a, b] of edgePairs) {
              const ai = tetrahedron[a];
              const bi = tetrahedron[b];
              const va = values[ai];
              const vb = values[bi];
              if (va >= 0 === vb >= 0) continue;
              const t = va / (va - vb);
              intersections.push(
                p[ai].map((coordinate, axis) => coordinate + (p[bi][axis] - coordinate) * t),
              );
            }
            if (intersections.length === 3) pushTriangle(...intersections);
            else if (intersections.length === 4) {
              const center = [0, 1, 2].map(
                (axis) => intersections.reduce((sum, point) => sum + point[axis], 0) / 4,
              );
              const outward = vertexNormal(center);
              const tangent = intersections[0].map((coordinate, axis) => coordinate - center[axis]);
              const tangentLength = Math.hypot(...tangent) || 1;
              for (let axis = 0; axis < 3; axis++) tangent[axis] /= tangentLength;
              const bitangent = [
                outward[1] * tangent[2] - outward[2] * tangent[1],
                outward[2] * tangent[0] - outward[0] * tangent[2],
                outward[0] * tangent[1] - outward[1] * tangent[0],
              ];
              intersections.sort((a, b) => {
                const angle = (point) => {
                  const delta = point.map((coordinate, axis) => coordinate - center[axis]);
                  const u = delta.reduce(
                    (sum, coordinate, axis) => sum + coordinate * tangent[axis],
                    0,
                  );
                  const v = delta.reduce(
                    (sum, coordinate, axis) => sum + coordinate * bitangent[axis],
                    0,
                  );
                  return Math.atan2(v, u);
                };
                return angle(a) - angle(b);
              });
              pushTriangle(intersections[0], intersections[1], intersections[2]);
              pushTriangle(intersections[0], intersections[2], intersections[3]);
            }
          }
        }
    return { positions: Float32Array.from(vertices), normals: Float32Array.from(normals) };
  }

  function validateChunkSeams(cx, cz, step = 32) {
    const origin = meshChunk(cx, cz, step);
    const errors = [];
    for (const [nx, nz, axis, boundary] of [
      [cx + 1, cz, 0, -HALF + (cx + 1) * TERRAIN_CHUNK_SIZE],
      [cx, cz + 1, 2, -HALF + (cz + 1) * TERRAIN_CHUNK_SIZE],
    ]) {
      if (nx >= CHUNKS_PER_SIDE || nz >= CHUNKS_PER_SIDE) continue;
      const neighbor = meshChunk(nx, nz, step);
      const edge = (mesh) => {
        const vertices = new Map();
        for (let index = 0; index < mesh.positions.length; index += 3) {
          if (Math.abs(mesh.positions[index + axis] - boundary) > 0.01) continue;
          const key = [0, 1, 2]
            .filter((coordinate) => coordinate !== axis)
            .map((coordinate) => mesh.positions[index + coordinate].toFixed(2))
            .join(',');
          vertices.set(key, [
            mesh.normals[index],
            mesh.normals[index + 1],
            mesh.normals[index + 2],
          ]);
        }
        return vertices;
      };
      const left = edge(origin);
      const right = edge(neighbor);
      for (const [key, normal] of left) {
        const other = right.get(key);
        if (!other || Math.hypot(...normal.map((value, index) => value - other[index])) > 0.03)
          errors.push({ edge: `${cx},${cz}:${nx},${nz}`, vertex: key });
      }
      for (const key of right.keys()) {
        if (!left.has(key)) errors.push({ edge: `${cx},${cz}:${nx},${nz}`, vertex: key });
      }
    }
    return { valid: errors.length === 0, errors };
  }

  return {
    baseHeight,
    density,
    surfaceHeight,
    supportHeight,
    subtractSphere,
    fillSphere,
    subtractBrush,
    takeDirtyChunks,
    rebuildChunk,
    meshChunk,
    validateChunkSeams,
    normal,
    operations,
    modifiedChunks: byChunk,
    excavationCells,
    regions,
    protectedVolumes,
    markVolume,
    unmarkVolume,
    volumeAt,
    exportOperations,
    loadOperations,
    applyOrderedOperation,
    chunkChecksum,
    setEditListener(listener) {
      onEdit = listener;
    },
    get revision() {
      return sequence;
    },
    get dirtyCount() {
      return dirty.size;
    },
  };
}
