import { describe, expect, it } from 'vitest';
import { createTerrain, TERRAIN_CHUNK_SIZE, terrainChunkAt } from './terrain.js';
import {
  castDiggingSpell,
  createState,
  digTerrain,
  terrainHeight,
  terrainMaterialAt,
  TERRAIN_MATERIALS,
  update,
  MAGICAL_DRILL,
  PLAYER_BODY_HEIGHT,
  precisionDig,
  precisionDigPlan,
  BASE_WEAPON_ORDER,
  reinforceLevitation,
  updateMagicalDigging,
  JUMP,
  moveWizard,
} from './game.js';

describe('smooth volumetric terrain prototype', () => {
  it('keeps ordered edits deterministic and buffers out-of-order match updates', () => {
    const host = createTerrain(() => 100);
    host.subtractSphere(0, 0, 60, 40);
    host.subtractSphere(80, 0, 60, 40);
    const client = createTerrain(() => 100);
    const [first, second] = host.exportOperations();
    expect(client.applyOrderedOperation(second).applied).toBe(0);
    expect(client.revision).toBe(0);
    expect(client.applyOrderedOperation(first).applied).toBe(2);
    expect(client.applyOrderedOperation(first).reason).toBe('duplicate-operation');
    expect(client.density(0, 0, 60)).toBe(host.density(0, 0, 60));
    expect(client.chunkChecksum(...terrainChunkAt(0, 0))).toBe(
      host.chunkChecksum(...terrainChunkAt(0, 0)),
    );
  });

  it('rebuilds an edited mesh incrementally without changing late-join geometry', () => {
    const host = createTerrain(() => 160);
    host.subtractSphere(0, 0, 115, 40);
    const [cx, cz] = terrainChunkAt(0, 0);
    host.meshChunk(cx, cz);
    for (let index = 0; index < 40; index++) {
      host.subtractSphere(index * 3, 0, 110, 25);
    }
    const incremental = host.meshChunk(cx, cz);
    const newcomer = createTerrain(() => 160);
    expect(newcomer.loadOperations(host.exportOperations())).toEqual({ accepted: true, count: 41 });
    const rebuilt = newcomer.meshChunk(cx, cz);
    expect(incremental.positions).toEqual(rebuilt.positions);
    expect(incremental.normals).toEqual(rebuilt.normals);
  });

  it('keeps rendered positions and normals aligned across edited chunk seams', () => {
    const terrain = createTerrain(() => 160);
    const [cx, cz] = terrainChunkAt(0, 0);
    const edgeX = -13300 + (cx + 1) * TERRAIN_CHUNK_SIZE;
    terrain.subtractSphere(edgeX, 0, 120, 60);
    expect(terrain.validateChunkSeams(cx, cz)).toEqual({ valid: true, errors: [] });
  });

  it('rejects brushes crossing developer-marked indestructible terrain', () => {
    const terrain = createTerrain(() => 100);
    const volume = terrain.markVolume({
      x: 50,
      z: 0,
      y: 60,
      radius: 20,
      height: 80,
      kind: 'indestructible',
    });
    expect(
      terrain.subtractBrush({ shape: 'tunnel', x: 0, z: 0, y: 60, radius: 18, length: 120 }).reason,
    ).toBe('protected-terrain');
    expect(terrain.revision).toBe(0);
    expect(terrain.unmarkVolume(volume.id)).toBe(true);
    expect(terrain.subtractSphere(50, 0, 60, 18).accepted).toBe(true);
  });
  it('subtracts a rounded hole while preserving bedrock and untouched land', () => {
    const terrain = createTerrain(() => 100);
    const untouched = terrain.surfaceHeight(0, 0);
    const edit = terrain.subtractSphere(0, 0, 92, 48);
    expect(edit.accepted).toBe(true);
    expect(terrain.surfaceHeight(0, 0)).toBeLessThan(50);
    expect(terrain.surfaceHeight(200, 200)).toBe(untouched);
    expect(terrain.density(0, 0, 92)).toBeLessThan(0);
    expect(terrain.density(0, 0, -400)).toBeGreaterThan(0);
    expect(terrain.operations).toHaveLength(1);
  });

  it('holds an enclosed underground cavity without erasing its roof', () => {
    const terrain = createTerrain(() => 100);
    terrain.subtractSphere(0, 0, 25, 30);
    expect(terrain.density(0, 0, 25)).toBeLessThan(0);
    expect(terrain.surfaceHeight(0, 0)).toBe(100);
  });

  it('marks both chunks and gives them matching density along a shared edge', () => {
    const terrain = createTerrain(() => 100);
    const boundary = -13300 + TERRAIN_CHUNK_SIZE;
    const z = -13300 + TERRAIN_CHUNK_SIZE * 30.5;
    const [leftX, row] = terrainChunkAt(boundary - 1, z);
    const [rightX] = terrainChunkAt(boundary + 1, z);
    expect(rightX).toBe(leftX + 1);
    // The prototype's protected island boundary is separate from the data model.
    const centerX = -13300 + TERRAIN_CHUNK_SIZE * 32;
    const centerZ = 0;
    const chunks = terrain.subtractSphere(centerX, centerZ, 90, 90);
    expect(chunks.accepted).toBe(true);
    expect(chunks.chunks.length).toBeGreaterThan(1);
    expect(terrain.density(centerX - 1, centerZ, 90)).toBeCloseTo(
      terrain.density(centerX + 1, centerZ, 90),
      1,
    );
    expect(terrain.takeDirtyChunks()).toHaveLength(chunks.chunks.length);
    expect(terrain.takeDirtyChunks()).toHaveLength(0);
    expect(row).toBeGreaterThan(0);
  });

  it('generates smooth finite triangles and unit surface normals', () => {
    const terrain = createTerrain(() => 100);
    terrain.subtractSphere(0, 0, 90, 70);
    const [cx, cz] = terrainChunkAt(0, 0);
    const mesh = terrain.meshChunk(cx, cz);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.positions.length % 9).toBe(0);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect([...mesh.positions].every(Number.isFinite)).toBe(true);
    for (let i = 0; i < mesh.normals.length; i += 3) {
      expect(Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2])).toBeCloseTo(
        1,
        3,
      );
    }
  });

  it('accepts a single smooth tunnel brush and rejects oversized edits', () => {
    const terrain = createTerrain(() => 100);
    const edit = terrain.subtractBrush({
      shape: 'tunnel',
      x: 0,
      z: 0,
      y: 30,
      radius: 40,
      length: 200,
      dirX: 1,
      dirZ: 0,
    });
    expect(edit.accepted).toBe(true);
    expect(terrain.density(90, 0, 30)).toBeLessThan(0);
    expect(terrain.density(0, 60, 30)).toBeGreaterThan(0);
    expect(terrain.surfaceHeight(0, 0)).toBe(100);
    expect(
      terrain.subtractBrush({ shape: 'tunnel', x: 0, z: 0, y: 30, radius: 400, length: 200 })
        .accepted,
    ).toBe(false);
  });

  it('detects underground floor and ceiling cells and surface openings', () => {
    const terrain = createTerrain(() => 100);
    terrain.subtractSphere(0, 0, 24, 32);
    expect(terrain.regions.size).toBe(1);
    let region = [...terrain.regions.values()][0];
    expect(region.undergroundCells).toBeGreaterThan(0);
    expect(region.floorCells.length).toBeGreaterThan(0);
    expect(region.ceilingCells.length).toBeGreaterThan(0);
    terrain.subtractSphere(0, 0, 83, 45);
    region = [...terrain.regions.values()][0];
    expect(region.openings.length).toBeGreaterThan(0);
  });

  it('merges only the underground regions connected by a new tunnel', () => {
    const terrain = createTerrain(() => 100);
    terrain.subtractSphere(-110, 0, 24, 35);
    terrain.subtractSphere(110, 0, 24, 35);
    expect(terrain.regions.size).toBe(2);
    terrain.subtractBrush({
      shape: 'tunnel',
      x: 0,
      z: 0,
      y: 24,
      radius: 37,
      length: 190,
      dirX: 1,
    });
    expect(terrain.regions.size).toBe(1);
    expect([...terrain.regions.values()][0].cellKeys.size).toBeGreaterThan(8);
  });
});

describe('shovel integration', () => {
  it('falls into a newly cut hole instead of teleporting to its floor', () => {
    const state = createState({ bots: 1, opening: false });
    const wizard = state.wizards[0];
    state.obstacles = [];
    wizard.x = 0;
    wizard.y = 0;
    const top = terrainHeight(0, 0);
    wizard.lastTerrainFeetY = top;
    expect(state.terrain.subtractSphere(0, 0, top - 65, 130).accepted).toBe(true);
    const floor = terrainHeight(0, 0);
    expect(top - floor).toBeGreaterThan(100);
    update(state, [{ dx: 0, dy: 0 }], 0.016);
    expect(wizard.drillFeetY).toBeGreaterThan(floor + 100);
    expect(wizard.drillFeetY).toBeLessThanOrEqual(top);
    for (let i = 0; i < 70; i++) update(state, [{ dx: 0, dy: 0 }], 0.016);
    expect(wizard.drillFeetY).toBeCloseTo(floor, 0);
    expect(wizard.drillFallV).toBe(0);
  });

  it('lets a running jump grab an excavated wall and climb back to the rim', () => {
    const state = createState({ bots: 1, opening: false });
    const wizard = state.wizards[0];
    state.obstacles = [];
    wizard.x = 0;
    wizard.y = 0;
    const top = terrainHeight(0, 0);
    expect(state.terrain.subtractSphere(0, 0, top - 65, 130).accepted).toBe(true);
    const floor = terrainHeight(0, 0);
    wizard.drillFeetY = floor;
    wizard.lastTerrainFeetY = floor;
    wizard.running = true;
    wizard.runningJump = true;
    wizard.jumpV = JUMP.velocity;
    wizard.wantClimb = true;
    for (let i = 0; i < 40 && wizard.climbState == null; i++)
      moveWizard(wizard, 1, 0, 0.016, state.obstacles);
    expect(wizard.climbState).toBe('terrain-wall');
    for (let i = 0; i < 100 && wizard.climbState === 'terrain-wall'; i++)
      moveWizard(wizard, 1, 0, 0.016, state.obstacles);
    expect(wizard.climbState).toBeNull();
    expect(wizard.drillFeetY).toBeGreaterThan(floor + 80);
    expect(state.terrain.density(wizard.x, wizard.y, wizard.drillFeetY + 30)).toBeLessThan(0);
  });

  it('lets a nearby wizard reinforce a friendly ceiling weave with real mana', () => {
    const state = createState({ players: 1, bots: 0, opening: false });
    const wizard = state.wizards[0];
    const surface = terrainHeight(wizard.x, wizard.y);
    state.terrain.subtractSphere(wizard.x, wizard.y, surface - 130, 90);
    const node = state.terrainSupport.placeNode({
      x: wizard.x,
      z: wizard.y,
      team: wizard.id,
      ownerId: wizard.id,
    }).node;
    wizard.manaPouch.elemental = 40;
    expect(reinforceLevitation(state, wizard).accepted).toBe(true);
    expect(wizard.manaPouch.elemental).toBe(20);
    expect(node.mana).toBe(20);
    expect(reinforceLevitation(state, wizard).reason).toBe('spell-recharging');
  });
  it('changes the match terrain near the player and rejects out-of-range edits', () => {
    const state = createState({ players: 1, bots: 0 });
    const wizard = state.wizards[0];
    wizard.x = 0;
    wizard.y = 0;
    state.obstacles = [];
    const x = 120;
    const before = terrainHeight(x, 0);
    const result = digTerrain(state, wizard, x, 0, before);
    expect(result.accepted).toBe(true);
    expect(terrainHeight(x, 0)).toBeLessThan(before);
    expect(state.events.some((event) => event.type === 'dig')).toBe(true);
    expect(digTerrain(state, wizard, 1000, 0, terrainHeight(1000, 0)).accepted).toBe(false);
    expect(state.terrain.operations).toHaveLength(1);
  });

  it('spends mana only for an accepted carried Burrow Spell', () => {
    const state = createState({ players: 1, bots: 0 });
    const wizard = state.wizards[0];
    wizard.x = 0;
    wizard.y = 0;
    wizard.heading = 0;
    state.obstacles = [];
    const height = terrainHeight(130, 0);
    expect(castDiggingSpell(state, wizard, 'burrow-spell', 130, 0, height).reason).toBe(
      'spell-not-carried',
    );
    wizard.inventorySlots[0] = {
      lootType: 'digging-spell',
      itemId: 'burrow-spell',
      rarity: 'rare',
      quantity: 1,
    };
    wizard.manaPouch.elemental = 40;
    const cast = castDiggingSpell(state, wizard, 'burrow-spell', 130, 0, height);
    expect(cast.accepted).toBe(true);
    expect(wizard.manaPouch.elemental).toBe(5);
    expect(state.terrain.operations).toHaveLength(1);
    expect(castDiggingSpell(state, wizard, 'burrow-spell', 130, 0, height).reason).toBe(
      'spell-recharging',
    );
  });

  it('routes the bound spell input through the normal simulation step', () => {
    const state = createState({ players: 1, bots: 0 });
    const wizard = state.wizards[0];
    wizard.x = 0;
    wizard.y = 0;
    wizard.heading = 0;
    state.obstacles = [];
    wizard.inventorySlots[0] = {
      lootType: 'digging-spell',
      itemId: 'burrow-spell',
      rarity: 'rare',
      quantity: 1,
    };
    wizard.manaPouch.elemental = 45;
    const targetHeight = terrainHeight(130, 0);
    update(
      state,
      [
        {
          attack: null,
          aimX: 130,
          aimY: 0,
          aimZ: targetHeight - terrainHeight(0, 0),
          digSpell: true,
        },
      ],
      0.05,
    );
    expect(state.terrain.revision).toBe(1);
    expect(wizard.manaPouch.elemental).toBe(10);
    expect(state.events.some((event) => event.type === 'dig-spell')).toBe(true);
  });

  it('uses material strength for spell restrictions', () => {
    const state = createState({ players: 1, bots: 0 });
    const wizard = state.wizards[0];
    wizard.x = -2600;
    wizard.y = -5600;
    state.obstacles = [];
    wizard.inventorySlots[0] = {
      lootType: 'digging-spell',
      itemId: 'burrow-spell',
      rarity: 'rare',
      quantity: 1,
    };
    wizard.manaPouch.elemental = 100;
    const x = wizard.x + 130;
    const height = terrainHeight(x, wizard.y);
    expect(terrainMaterialAt(x, wizard.y, height)).toBe('stone');
    expect(TERRAIN_MATERIALS.stone.digScale).toBeLessThan(TERRAIN_MATERIALS.dirt.digScale);
    expect(castDiggingSpell(state, wizard, 'burrow-spell', x, wizard.y, height).reason).toBe(
      'material-too-hard',
    );
    expect(wizard.manaPouch.elemental).toBe(100);
  });
});

describe('magical digging mode', () => {
  it('does not create blanket protected terrain around ordinary scenery', () => {
    const state = createState({ players: 1, bots: 0 });
    expect(
      state.terrain.protectedVolumes.every((volume) => volume.kind !== 'protected-landmark'),
    ).toBe(true);
    expect(state.terrain.protectedVolumes.length).toBeLessThan(state.obstacles.length);
  });
  function setup(baseWeapon = 'apprentice-wand') {
    const state = createState({ players: 1, bots: 0, baseWeapon });
    const wizard = state.wizards[0];
    wizard.x = 0;
    wizard.y = 0;
    wizard.heading = 0;
    state.obstacles = [];
    return { state, wizard };
  }
  function press(state, wizard, overrides = {}, steps = 15) {
    const input = { digMode: true, run: true, drillHeld: true, ...overrides };
    for (let i = 0; i < steps; i++) updateMagicalDigging(state, wizard, input, 0.05);
  }
  function buried() {
    const { state, wizard } = setup();
    state.terrain = createTerrain(() => 1000);
    state.terrain.subtractSphere(0, 0, 834, 140);
    wizard.drillFeetY = 750;
    return { state, wizard };
  }
  it('starts held digging immediately, rate limits terrain edits, and stops on release', () => {
    const { state, wizard } = setup();
    state.terrain = createTerrain(() => 600);
    wizard.drillFeetY = 430;
    const mana = JSON.stringify(wizard.manaPouch);
    const inventory = JSON.stringify(wizard.inventorySlots);
    const input = {
      digMode: true,
      dig: true,
      digDirection: 'forward',
      digAimX: 200,
      digAimZ: 0,
      digAimY: 560,
      digAimHit: 'terrain',
    };
    update(state, [input], 0.05);
    expect(state.terrain.operations).toHaveLength(1);
    const nextTime = wizard.nextPrecisionDigTime;
    update(state, [{ ...input, digAimX: 450 }], 0.05);
    expect(state.terrain.operations).toHaveLength(1);
    expect(wizard.digging).toBe(true);
    while (state.time <= nextTime + 0.05) update(state, [{ ...input, digAimX: 450 }], 0.05);
    expect(state.terrain.operations.length).toBeGreaterThan(1);
    update(state, [{ ...input, dig: false }], 0.05);
    expect(wizard.digging).toBe(false);
    expect(wizard.nextPrecisionDigTime).toBe(0);
    const stopped = state.terrain.operations.length;
    update(state, [{ ...input, digMode: false }], 0.05);
    expect(state.terrain.operations).toHaveLength(stopped);
    expect(JSON.stringify(wizard.manaPouch)).toBe(mana);
    expect(JSON.stringify(wizard.inventorySlots)).toBe(inventory);
  });
  it('toggles off, cancels charges on release, run-off, and heavy damage', () => {
    const { state, wizard } = setup();
    press(state, wizard, {}, 8);
    expect(wizard.drillCharge).toBeGreaterThan(0);
    updateMagicalDigging(state, wizard, { digMode: true, run: true, drillHeld: false }, 0.05);
    expect(wizard.drillCharge).toBe(0);
    press(state, wizard, {}, 5);
    updateMagicalDigging(state, wizard, { digMode: true, run: false, drillHeld: true }, 0.05);
    expect(wizard.drill).toBeNull();
    expect(wizard.drillCharge).toBe(0);
    press(state, wizard, {}, 5);
    wizard.health -= 20;
    press(state, wizard, {}, 20);
    expect(wizard.drill).toBeNull();
    updateMagicalDigging(state, wizard, { digMode: false, run: true }, 0.05);
    expect(wizard.digMode).toBe(false);
    wizard.drillFeetY = terrainHeight(wizard.x, wizard.y);
    updateMagicalDigging(state, wizard, { digMode: false, run: false }, 0.05);
    expect(wizard.drillFeetY).toBeNull();
  });
  it('makes separate weak forward and downward capsule cuts without moving', () => {
    const { state, wizard } = setup();
    const first = precisionDig(state, wizard, 'forward');
    const second = precisionDig(state, wizard, 'down');
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(state.terrain.operations.map((op) => op.shape)).toEqual(['capsule', 'capsule']);
    expect(state.terrain.operations.map((op) => op.dirY)).toEqual([0, -1]);
    expect([wizard.x, wizard.y]).toEqual([0, 0]);
    expect(precisionDig(state, wizard, 'up').accepted).toBe(false);
  });
  it('previews the exact laser hitbox without changing terrain', () => {
    const { state, wizard } = setup();
    const plan = precisionDigPlan(state, wizard, 'forward');
    expect(plan.accepted).toBe(true);
    expect(plan.brush).toMatchObject({
      shape: 'capsule',
      length: MAGICAL_DRILL.precisionLength,
      dirY: 0,
    });
    expect(state.terrain.operations).toHaveLength(0);
    state.obstacles.push({ kind: 'house', x: plan.brush.x, y: plan.brush.z, r: 35 });
    const protectedPlan = precisionDigPlan(state, wizard, 'forward');
    expect(protectedPlan.accepted).toBe(false);
    expect(state.terrain.operations).toHaveLength(0);
    state.obstacles = [];
    const cut = precisionDig(state, wizard, 'forward');
    expect(cut.accepted).toBe(true);
    expect(cut.operation).toMatchObject(plan.brush);
  });
  it('uses the selected laser length and width for both preview and terrain cut', () => {
    const { state, wizard } = setup();
    wizard.digRadius = 72;
    wizard.digLength = 216;
    const plan = precisionDigPlan(state, wizard, 'forward');
    expect(plan.accepted).toBe(true);
    expect(plan.brush.radius).toBe(72);
    expect(plan.brush.length).toBe(216);
    expect(precisionDig(state, wizard, 'forward').operation).toMatchObject(plan.brush);
  });
  it('aims a forward laser up into open sky without carving terrain', () => {
    const { state, wizard } = setup();
    wizard.digAimPitch = 0.95;
    const before = state.terrain.revision;
    const plan = precisionDigPlan(state, wizard, 'forward');
    expect(plan.target.y).toBeGreaterThan(terrainHeight(wizard.x, wizard.y) + 400);
    expect(plan.target.fy).toBeGreaterThan(0.8);
    expect(plan.reason).toBe('no-terrain');
    expect(precisionDig(state, wizard, 'forward').reason).toBe('no-terrain');
    expect(state.terrain.revision).toBe(before);
    expect(precisionDigPlan(state, wizard, 'down').target.fy).toBe(0);
  });
  it('tilts the digging capsule upward when an elevated wall is hit', () => {
    const { state, wizard } = setup();
    state.terrain = createTerrain(() => 1000);
    wizard.drillFeetY = 850;
    wizard.digAimPitch = 0.6;
    const plan = precisionDigPlan(state, wizard, 'forward');
    expect(plan.accepted).toBe(true);
    expect(plan.brush.dirY).toBeGreaterThan(0.5);
    expect(plan.target.y).toBeGreaterThan(wizard.drillFeetY);
  });
  it('places a ground cut at the camera cursor hit', () => {
    const { state, wizard } = setup();
    state.terrain = createTerrain(() => 1000);
    wizard.drillFeetY = 850;
    const cursorHit = { x: 250, z: 40, y: 1000, hitKind: 'terrain' };
    const plan = precisionDigPlan(state, wizard, 'forward', cursorHit);
    expect(plan.accepted).toBe(true);
    expect(plan.target).toMatchObject({ x: 250, z: 40, y: 1000 });
    Object.assign(wizard, {
      digAimX: cursorHit.x,
      digAimZ: cursorHit.z,
      digAimY: cursorHit.y,
      digAimHit: cursorHit.hitKind,
    });
    const result = precisionDig(state, wizard, 'forward');
    expect(result.accepted).toBe(true);
    expect(result.operation).toMatchObject({ x: 250, z: 40, y: 1000 });
  });
  it('keeps advancing held strikes without using mana, changing weapons, or hurting players', () => {
    for (const weaponId of BASE_WEAPON_ORDER) {
      const { state, wizard } = setup(weaponId);
      const opponent = { ...wizard, id: 99, x: 130, health: 100 };
      state.wizards.push(opponent);
      const mana = JSON.stringify(wizard.manaPouch);
      const inventory = JSON.stringify(wizard.inventorySlots);
      const first = precisionDig(state, wizard, 'forward');
      const second = precisionDig(state, wizard, 'forward');
      expect(first.accepted).toBe(true);
      expect(second.accepted).toBe(true);
      expect(second.operation.x).toBeGreaterThan(first.operation.x);
      expect(precisionDig(state, wizard, 'forward')).toEqual({
        accepted: false,
        reason: 'no-terrain',
      });
      expect(state.terrain.operations).toHaveLength(2);
      expect(state.terrain.operations.every((operation) => operation.shape === 'capsule')).toBe(
        true,
      );
      expect(JSON.stringify(wizard.manaPouch)).toBe(mana);
      expect(JSON.stringify(wizard.inventorySlots)).toBe(inventory);
      expect(wizard.baseWeaponId).toBe(weaponId);
      expect(opponent.health).toBe(100);
      expect([wizard.x, wizard.y]).toEqual([0, 0]);
      expect(state.terrain.density(0, 0, terrainHeight(0, 0) + 40)).toBeLessThan(0);
    }
  });
  it('cuts ordinary ground but leaves buildings, indestructible rock, and bedrock intact', () => {
    const { state, wizard } = setup();
    const feet = terrainHeight(0, 0);
    state.obstacles.push({ kind: 'tree', x: 98, y: 0, r: 35 });
    expect(precisionDigPlan(state, wizard, 'forward').accepted).toBe(true);
    state.obstacles = [{ kind: 'house', x: 98, y: 0, r: 35 }];
    expect(precisionDig(state, wizard, 'forward').reason).toBe('protected-object');
    state.obstacles = [];
    state.terrain.markVolume({
      x: 98,
      z: 0,
      y: feet - 8,
      radius: 40,
      height: 100,
      kind: 'indestructible',
    });
    expect(precisionDig(state, wizard, 'forward').reason).toBe('protected-terrain');
    expect(state.terrain.operations).toHaveLength(0);
    wizard.drillFeetY = feet - 410;
    expect(precisionDig(state, wizard, 'down').accepted).toBe(false);
    expect(state.terrain.operations).toHaveLength(0);
  });
  it('starts all three drill directions after the full charge', () => {
    for (const direction of ['forward', 'up', 'down']) {
      const { state, wizard } = setup();
      press(state, wizard, { jumpHeld: direction === 'up', crouch: direction === 'down' }, 11);
      expect(wizard.drill).toBeNull();
      press(state, wizard, { jumpHeld: direction === 'up', crouch: direction === 'down' }, 3);
      expect(state.terrain.operations.length).toBeGreaterThan(0);
      const operation = state.terrain.operations.at(-1);
      expect(operation.radius).toBe(MAGICAL_DRILL.radius);
      expect(Math.sign(operation.dirY)).toBe(
        direction === 'up' ? 1 : direction === 'down' ? -1 : 0,
      );
    }
  });
  it('caps a forward tunnel at exactly 600 units with a 126-unit radius', () => {
    const { state, wizard } = buried();
    press(state, wizard, {}, 45);
    expect(wizard.drill).toBeNull();
    expect(wizard.x).toBeCloseTo(MAGICAL_DRILL.forwardDistance, 3);
    expect(
      state.terrain.operations
        .slice(1)
        .every((operation) => operation.shape === 'tunnel' && operation.radius === 126),
    ).toBe(true);
    expect(MAGICAL_DRILL.radius * 2).toBe(252);
    expect(MAGICAL_DRILL.radius * 2).toBe(PLAYER_BODY_HEIGHT * 1.5);
  });
  it('caps vertical drilling, falls after Updrill, and grants one instant sideways escape', () => {
    const { state, wizard } = buried();
    press(state, wizard, { jumpHeld: true }, 17);
    expect(wizard.drill).toBeNull();
    expect(wizard.drillEscapeReady).toBe(true);
    expect(wizard.drillFeetY).toBeLessThan(750 + MAGICAL_DRILL.upDistance);
    expect(wizard.drillFallV).toBeLessThanOrEqual(MAGICAL_DRILL.speed);
    for (let i = 0; i < 9; i++)
      updateMagicalDigging(state, wizard, { digMode: true, run: true, drillHeld: false }, 0.05);
    expect(wizard.drillFallV).toBeLessThan(0);
    updateMagicalDigging(state, wizard, { digMode: true, run: true, drillHeld: true }, 0.05);
    expect(wizard.drill?.direction).toBe('forward');
    expect(wizard.drill?.free).toBe(true);
    expect(wizard.drillEscapeReady).toBe(false);
    updateMagicalDigging(state, wizard, { digMode: true, run: false }, 0.05);
    expect(wizard.drill).toBeNull();
    expect(wizard.drillEscapeReady).toBe(false);
    updateMagicalDigging(state, wizard, { digMode: true, run: true, drillHeld: true }, 0.05);
    expect(wizard.drill).toBeNull();
    const down = setup();
    down.state.terrain = createTerrain(() => 1000);
    down.wizard.drillFeetY = 1000;
    press(down.state, down.wizard, { crouch: true }, 24);
    expect(down.state.terrain.operations.length).toBeGreaterThan(0);
    expect(down.wizard.drill?.distance).toBeLessThan(MAGICAL_DRILL.downDistance);
    updateMagicalDigging(
      down.state,
      down.wizard,
      { digMode: true, run: true, drillHeld: true, crouch: true },
      0.05,
    );
    expect(down.wizard.drill).toBeNull();
    const finalBrush = down.state.terrain.operations.at(-1);
    expect(finalBrush.y - (finalBrush.length - 2) / 2 - 84).toBeCloseTo(
      1000 - MAGICAL_DRILL.downDistance,
      3,
    );
  });
  it('stops before protected structures and when stamina runs out', () => {
    const blocked = buried();
    blocked.state.obstacles = [{ kind: 'house', x: 240, y: 0, r: 28 }];
    press(blocked.state, blocked.wizard, {}, 25);
    expect(blocked.wizard.x).toBeLessThan(240 - MAGICAL_DRILL.radius);
    const tired = buried();
    tired.wizard.stamina = 0.3;
    press(tired.state, tired.wizard, {}, 25);
    expect(tired.wizard.x).toBeLessThan(150);
    expect(tired.wizard.stamina).toBe(0);
    const canceled = buried();
    press(canceled.state, canceled.wizard, {}, 15);
    expect(canceled.wizard.drill).not.toBeNull();
    updateMagicalDigging(canceled.state, canceled.wizard, { digMode: true, run: false }, 0.05);
    expect(canceled.wizard.drill).toBeNull();
    const bedrock = setup();
    let carved = false;
    bedrock.state.terrain = {
      baseHeight: () => 1000,
      density: () => 1,
      supportHeight: () => 650,
      subtractBrush: () => {
        carved = true;
        return { accepted: true };
      },
    };
    bedrock.wizard.drillFeetY = 650;
    press(bedrock.state, bedrock.wizard, { crouch: true }, 17);
    expect(carved).toBe(false);
    expect(bedrock.wizard.drill).toBeNull();
  });
  it('never travels beyond either vertical maximum when solid terrain continues', () => {
    for (const direction of ['up', 'down']) {
      const { state, wizard } = setup();
      const brushes = [];
      state.terrain = {
        baseHeight: () => 1000,
        density: (_x, _z, y) =>
          brushes.some((brush) => Math.abs(y - brush.y) < brush.radius + brush.length / 2) ? -1 : 1,
        supportHeight: () => 1000,
        subtractBrush: (brush) => {
          brushes.push(brush);
          return { accepted: true };
        },
      };
      wizard.drillFeetY = 1000;
      press(state, wizard, { jumpHeld: direction === 'up', crouch: direction === 'down' }, 40);
      const traveled = brushes.reduce((sum, brush) => sum + brush.length - 2, 0);
      expect(traveled).toBeCloseTo(
        direction === 'up' ? MAGICAL_DRILL.upDistance : MAGICAL_DRILL.downDistance,
        5,
      );
      expect(wizard.drill).toBeNull();
    }
  });
});
