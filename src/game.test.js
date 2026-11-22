// Unit tests for the pure battle-royale logic. Run with: npm run test:unit
import { describe, it, expect } from 'vitest';
import { ITEM_DEFINITIONS } from './items.js';
import {
  createState,
  update,
  moveWizard,
  castSpell,
  castAttack,
  addAttackToInventory,
  equipAttack,
  changeBaseWeapon,
  collectAttackPickup,
  collectNearbyAttacks,
  isAttackCompatible,
  tierAttackForWizard,
  stepSpells,
  applyStorm,
  checkEliminations,
  checkWin,
  aiWizard,
  nearestOpponent,
  humanWizards,
  aliveCount,
  clamp,
  dist,
  normalize,
  buildObstacles,
  resolveObstacles,
  boltHitsObstacle,
  hasLineOfSight,
  steerAroundObstacles,
  ARENA,
  STORM,
  WIZARD,
  STAMINA,
  OPENING,
  PORTAL_DESTINATIONS,
  JUMP,
  WAND,
  CLIMB,
  SPELLS,
  BODY_HEIGHT,
  PLAYER_BODY_HEIGHT,
  BOT_ENGAGE_DELAY,
  BASE_WEAPONS,
  BASE_WEAPON_ORDER,
  ATTACKS,
  UNIVERSAL_ATTACK_IDS,
  REGULAR_UNIVERSAL_ATTACK_IDS,
  MYTHIC_ATTACK_IDS,
  MOVEMENT_ATTACK_IDS,
  HEALING_PROTECTION_ATTACK_IDS,
  SPECIAL_ATTACK_IDS,
  WEAPON_UPGRADE_RUNE_ID,
  TIER_ATTACK_IDS,
  MANA_AMMUNITION,
  MANA_AMMUNITION_ORDER,
  addManaAmmunition,
  LOOT_CATEGORY_CHANCES,
  LOOT_RARITIES,
  LOOT_RARITY_ORDER,
  LOOT_MAJOR_AREAS,
  LOOT_MYTHIC_AREA_IDS,
  LOOT_SPAWN_RULES,
  rollLootCategory,
  rollTierAttackId,
  rollLootRarity,
  upgradeBaseWeaponRarity,
  attackRarityForWizard,
  effectiveAttackForWizard,
  createLootSpawnPoints,
  createAttackPickups,
  isSafeLootSpawnPoint,
  terrainSlopeAt,
  terrainHeight,
  obstacleGroundHeight,
} from './game.js';

function fillAttackAmmunition(wizard, attackId) {
  const ammoType = ATTACKS[attackId]?.ammoType;
  if (ammoType) wizard.manaPouch[ammoType] = MANA_AMMUNITION[ammoType].max;
}

function attackAmmunition(wizard, attackId) {
  return wizard.manaPouch[ATTACKS[attackId].ammoType];
}

describe('math helpers', () => {
  it('clamp keeps values in range', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('dist and normalize', () => {
    expect(dist(0, 0, 3, 4)).toBe(5);
    expect(normalize(0, 5)).toEqual({ x: 0, y: 1 });
    expect(normalize(0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('createState', () => {
  it('builds the requested humans + bots, all alive at full health', () => {
    const s = createState({ players: 2, bots: 8 });
    expect(s.wizards).toHaveLength(10);
    expect(humanWizards(s)).toHaveLength(2);
    expect(s.wizards[0].playerIndex).toBe(0);
    expect(s.wizards[1].playerIndex).toBe(1);
    expect(s.wizards.every((w) => w.alive && w.health === WIZARD.maxHealth)).toBe(true);
    expect(s.storm.radius).toBe(STORM.startRadius);
    expect(s.over).toBe(false);
  });
  it('defaults to 1 human and 9 bots', () => {
    const s = createState();
    expect(s.wizards).toHaveLength(10);
    expect(humanWizards(s)).toHaveLength(1);
  });
  it('spawns everyone inside the arena and the starting storm', () => {
    for (const w of createState({ bots: 11 }).wizards) {
      expect(dist(w.x, w.y, 0, 0)).toBeLessThan(STORM.startRadius);
    }
  });
  it('0 bots is a free-roam sandbox: no storm, never ends', () => {
    const s = createState({ bots: 0 });
    expect(s.wizards).toHaveLength(1);
    expect(s.sandbox).toBe(true);
    for (let i = 0; i < 120; i++) update(s, [{ dx: 0, dy: 0 }], 0.3); // ~36s of play
    expect(s.over).toBe(false); // no auto-victory with nobody to fight
    expect(s.storm.radius).toBe(STORM.startRadius); // storm never closed
    expect(s.wizards[0].alive).toBe(true); // and no storm damage
  });
});

describe('base weapon selection and attack compatibility', () => {
  it('defines six base weapons and exactly 35 universal attacks', () => {
    expect(BASE_WEAPON_ORDER).toHaveLength(6);
    expect(Object.keys(BASE_WEAPONS)).toHaveLength(6);
    expect(UNIVERSAL_ATTACK_IDS).toHaveLength(35);
    expect(TIER_ATTACK_IDS).toHaveLength(12);
    expect(Object.keys(ATTACKS)).toHaveLength(47);
  });

  it('uses the requested 35 universal abilities in the requested order', () => {
    expect(UNIVERSAL_ATTACK_IDS.map((id) => ATTACKS[id].name)).toEqual([
      'Focusing Crystal',
      'Triple Bolt',
      'Chaos Cube',
      'Dagger Magic',
      'Ricochet Spell',
      'War Mage Barrage',
      'Thunderclap',
      'Dragon Breath',
      'Apprentice Bolt',
      'Wasp Swarm',
      'Eagle-Eye Shot',
      'Shifting Spell',
      'Enchanted Gargoyle',
      'Grappling Vine',
      'Void King’s Blast',
      'Werewolf Claws',
      'Giant’s Focusing Beam',
      'Baba Yaga’s Curse',
      'Storm King’s Lightning',
      'Twin Moon Barrage',
      'Poison Mist',
      'Boots of Endless Flight',
      'Rocket Rune Boots',
      'Thunder Stones',
      'Haste Orb',
      'Fairy Fizz',
      'Golden Wizard Cake',
      'Healing Leaves',
      'Restoration Potion',
      'Small Protection Potion',
      'Great Protection Potion',
      'Cauldron of Restoration',
      'Portable Summoning Circle',
      'Empowerment Beacon',
      'Rune Key',
    ]);
    expect(ATTACKS['repulsion-spell'].scope).toBe('tier');
    expect(ATTACKS['repulsion-spell'].name).toBe('Repulsion Spell');
  });

  it('uses the exact requested mana costs for all 12 Tier attacks', () => {
    expect(ATTACKS['continuous-magic-beam'].manaPerSecond).toBe(12);
    expect(ATTACKS['grappling-spell'].manaCost).toBe(15);
    expect(ATTACKS['precision-burst-spell'].manaCost).toBe(22);
    expect(ATTACKS['rapid-fire-spell'].manaCost).toBe(6);
    expect(ATTACKS['bouncing-magic-bomb'].manaCost).toBe(28);
    expect(ATTACKS['repulsion-spell'].manaCost).toBe(18);
    expect(ATTACKS['close-range-blast'].manaCost).toBe(25);
    expect(ATTACKS['accurate-magic-shot'].manaCost).toBe(8);
    expect(ATTACKS['long-range-beam'].manaCost).toBe(30);
    expect(ATTACKS['twin-magic-shot'].manaCost).toBe(12);
    expect(ATTACKS['explosive-spell'].manaCost).toBe(35);
    expect(ATTACKS['magic-barrage'].manaPerProjectile).toBe(5);
    expect(effectiveAttackForWizard({ baseWeaponRarity: 'common' }, 'magic-barrage').manaCost).toBe(
      45,
    );
  });

  it('keeps universal abilities inside their requested mana bands', () => {
    const expectBand = (ids, minimum, maximum) => {
      for (const id of ids) {
        expect(ATTACKS[id].manaCost, id).toBeGreaterThanOrEqual(minimum);
        expect(ATTACKS[id].manaCost, id).toBeLessThanOrEqual(maximum);
      }
    };
    expectBand(['dagger-magic', 'war-mage-barrage', 'apprentice-bolt'], 5, 10);
    expectBand(
      [
        'triple-bolt',
        'chaos-cube',
        'ricochet-spell',
        'thunderclap',
        'dragon-breath',
        'wasp-swarm',
        'shifting-spell',
      ],
      12,
      20,
    );
    expectBand(['focusing-crystal', 'eagle-eye-shot'], 22, 30);
    expectBand(
      [
        'grappling-vine',
        'boots-of-endless-flight',
        'rocket-rune-boots',
        'thunder-stones',
        'haste-orb',
      ],
      15,
      25,
    );
    expectBand(['enchanted-gargoyle', 'portable-summoning-circle'], 25, 40);
    expectBand(MYTHIC_ATTACK_IDS, 40, 60);

    for (const id of [
      'golden-wizard-cake',
      'healing-leaves',
      'restoration-potion',
      'small-protection-potion',
      'greater-protection-potion',
      'fairy-fizz',
      'cauldron-of-restoration',
      'empowerment-beacon',
      'rune-key',
    ]) {
      expect(ATTACKS[id].manaCost, id).toBe(0);
      expect(ATTACKS[id].consumable, id).toBe(true);
    }
  });

  it('spends typed Mana Pouch ammunition and removes consumables after use', () => {
    const state = createState({ bots: 0, baseWeapon: 'apprentice-wand' });
    const wizard = state.wizards[0];
    expect(wizard.manaPouch).toEqual({
      catalyst: 0,
      elemental: 0,
      burst: 0,
      cosmic: 0,
      calamity: 0,
    });

    addAttackToInventory(wizard, 'apprentice-bolt');
    equipAttack(wizard, 'apprentice-bolt', 0);
    addManaAmmunition(wizard, ATTACKS['apprentice-bolt'].ammoType, 8);
    expect(castAttack(state, wizard, 'apprentice-bolt')).toBe(true);
    expect(attackAmmunition(wizard, 'apprentice-bolt')).toBe(0);
    expect(castAttack(state, wizard, 'apprentice-bolt')).toBe(false);

    addAttackToInventory(wizard, 'healing-leaves');
    equipAttack(wizard, 'healing-leaves', 1);
    wizard.health = 50;
    expect(castAttack(state, wizard, 'healing-leaves')).toBe(true);
    expect(wizard.health).toBe(50);
    update(state, [{ dx: 0, dy: 0 }], 1.5);
    expect(wizard.health).toBe(75);
    expect(wizard.attackInventory).not.toContain('healing-leaves');
    expect(wizard.attackSlots).not.toContain('healing-leaves');

    addAttackToInventory(wizard, 'void-kings-blast');
    equipAttack(wizard, 'void-kings-blast', 2);
    addManaAmmunition(wizard, 'calamity', 1);
    expect(castAttack(state, wizard, 'void-kings-blast')).toBe(true);
    expect(wizard.manaPouch.calamity).toBe(0);
    expect(castAttack(state, wizard, 'void-kings-blast')).toBe(false);
  });

  it('caps all five Mana Pouch ammunition families and keeps them out of the hotbar', () => {
    const state = createState({ bots: 0 });
    const wizard = state.wizards[0];
    for (const ammoType of MANA_AMMUNITION_ORDER) {
      expect(addManaAmmunition(wizard, ammoType, 9999)).toBe(MANA_AMMUNITION[ammoType].max);
      expect(wizard.manaPouch[ammoType]).toBe(MANA_AMMUNITION[ammoType].max);
    }
    expect(wizard.attackSlots).toEqual([null, null, null, null, null, null]);
  });

  it('uses the exact healing and protection amounts and timings', () => {
    const state = createState({ bots: 0 });
    const wizard = state.wizards[0];
    wizard.health = 25;
    wizard.shield = 20;
    addAttackToInventory(wizard, 'golden-wizard-cake');
    equipAttack(wizard, 'golden-wizard-cake', 0);
    expect(castAttack(state, wizard, 'golden-wizard-cake')).toBe(true);
    update(state, [{}], 4.9);
    expect(wizard.health).toBe(25);
    expect(wizard.shield).toBe(20);
    update(state, [{}], 0.1);
    expect(wizard.health).toBe(75);
    expect(wizard.shield).toBe(70);

    addAttackToInventory(wizard, 'small-protection-potion');
    equipAttack(wizard, 'small-protection-potion', 0);
    wizard.shield = 45;
    castAttack(state, wizard, 'small-protection-potion');
    expect(wizard.shield).toBe(50);

    addAttackToInventory(wizard, 'greater-protection-potion');
    equipAttack(wizard, 'greater-protection-potion', 0);
    castAttack(state, wizard, 'greater-protection-potion');
    expect(wizard.shield).toBe(100);
  });

  it('restores 75 health over ten seconds and damage interrupts restoration', () => {
    const state = createState({ bots: 1 });
    const [wizard] = state.wizards;
    wizard.health = 10;
    addAttackToInventory(wizard, 'restoration-potion');
    equipAttack(wizard, 'restoration-potion', 0);
    castAttack(state, wizard, 'restoration-potion');
    update(state, [{}], 4);
    expect(wizard.health).toBeCloseTo(40);
    expect(wizard.regenTimer).toBeCloseTo(6);
    state.storm.radius = 1;
    wizard.x = 100;
    applyStorm(state, 0.1);
    expect(wizard.regenTimer).toBe(0);
    expect(wizard.regenStopsOnDamage).toBe(false);
  });

  it('defines real distinct mechanics instead of three renamed spell aliases', () => {
    const attacks = Object.values(ATTACKS);
    const kinds = new Set(attacks.map((attack) => attack.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(10);
    expect(kinds).toEqual(
      new Set([
        'projectile',
        'melee',
        'beam',
        'nova',
        'heal',
        'shield',
        'grapple',
        'movement',
        'summon',
        'utility',
      ]),
    );
    expect(attacks.every((attack) => attack.cooldown === 0 && attack.color)).toBe(true);

    const gameplaySignatures = new Set(
      attacks.map((attack) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(attack).filter(
              ([key]) =>
                ![
                  'id',
                  'name',
                  'description',
                  'color',
                  'weaponId',
                  'tier',
                  'scope',
                  'spellId',
                ].includes(key),
            ),
          ),
        ),
      ),
    );
    expect(gameplaySignatures.size).toBe(attacks.length);
  });

  it('can cast every compatible universal and Tier attack through its real mechanic', () => {
    for (const weaponId of BASE_WEAPON_ORDER) {
      const compatible = Object.values(ATTACKS).filter((attack) =>
        isAttackCompatible(weaponId, attack.id),
      );
      for (const attack of compatible) {
        const state = createState({ bots: 0, baseWeapon: weaponId });
        const wizard = state.wizards[0];
        fillAttackAmmunition(wizard, attack.id);
        addAttackToInventory(wizard, attack.id);
        expect(equipAttack(wizard, attack.id, 0)).toBe(true);
        expect(castAttack(state, wizard, attack.id), attack.id).toBe(true);
        if (attack.channelTime) expect(wizard.itemUse?.attackId).toBe(attack.id);
        else expect(wizard.cooldowns[`attack:${attack.id}`], attack.id).toBe(0);
      }
    }
  });

  it('casts reusable attacks back-to-back with no cooldown whatsoever', () => {
    const state = createState({ bots: 0, baseWeapon: 'apprentice-wand' });
    const wizard = state.wizards[0];
    addAttackToInventory(wizard, 'apprentice-bolt');
    equipAttack(wizard, 'apprentice-bolt', 0);
    fillAttackAmmunition(wizard, 'apprentice-bolt');
    const manaBefore = attackAmmunition(wizard, 'apprentice-bolt');

    expect(castAttack(state, wizard, 'apprentice-bolt')).toBe(true);
    expect(castAttack(state, wizard, 'apprentice-bolt')).toBe(true);
    expect(state.spells.filter((spell) => spell.attackId === 'apprentice-bolt')).toHaveLength(2);
    expect(attackAmmunition(wizard, 'apprentice-bolt')).toBe(
      manaBefore - ATTACKS['apprentice-bolt'].manaCost * 2,
    );
    expect(wizard.cooldowns['attack:apprentice-bolt']).toBe(0);
  });

  it('charges continuous-beam mana by time held rather than by cooldown', () => {
    const state = createState({ bots: 0, baseWeapon: 'apprentice-wand' });
    const wizard = state.wizards[0];
    addAttackToInventory(wizard, 'continuous-magic-beam');
    equipAttack(wizard, 'continuous-magic-beam', 0);
    fillAttackAmmunition(wizard, 'continuous-magic-beam');
    const manaBefore = attackAmmunition(wizard, 'continuous-magic-beam');

    for (let step = 0; step < 20; step++) {
      expect(castAttack(state, wizard, 'continuous-magic-beam')).toBe(true);
    }
    expect(attackAmmunition(wizard, 'continuous-magic-beam')).toBeCloseTo(manaBefore - 12);
    expect(wizard.cooldowns['attack:continuous-magic-beam']).toBe(0);
  });

  it('gives burst, beam, nova, status, shield, and trap attacks different results', () => {
    const state = createState({ bots: 1, baseWeapon: 'focusing-crystal-staff' });
    const [wizard, target] = state.wizards;
    state.obstacles = [];
    wizard.x = 0;
    wizard.y = 0;
    wizard.heading = 0;
    wizard.aimX = target.x = 100;
    wizard.aimY = target.y = 0;
    wizard.aimZ = WAND.castHeight;
    wizard.aimTargetId = target.id;

    addAttackToInventory(wizard, 'triple-bolt');
    equipAttack(wizard, 'triple-bolt', 0);
    fillAttackAmmunition(wizard, 'triple-bolt');
    castAttack(state, wizard, 'triple-bolt');
    expect(state.spells.filter((spell) => spell.attackId === 'triple-bolt')).toHaveLength(3);

    addAttackToInventory(wizard, 'focusing-crystal');
    equipAttack(wizard, 'focusing-crystal', 0);
    fillAttackAmmunition(wizard, 'focusing-crystal');
    const beforeBeam = target.health;
    castAttack(state, wizard, 'focusing-crystal');
    expect(target.health).toBeLessThan(beforeBeam);
    expect(state.events.some((event) => event.type === 'beam')).toBe(true);

    addAttackToInventory(wizard, 'small-protection-potion');
    equipAttack(wizard, 'small-protection-potion', 0);
    castAttack(state, wizard, 'small-protection-potion');
    expect(wizard.shield).toBe(25);

    addAttackToInventory(wizard, 'poison-mist');
    equipAttack(wizard, 'poison-mist', 0);
    fillAttackAmmunition(wizard, 'poison-mist');
    castAttack(state, wizard, 'poison-mist');
    expect(state.spells.some((spell) => spell.kind === 'zone')).toBe(true);
  });

  it('implements the new movement, flight, haste, summon, and Rune Key abilities', () => {
    const state = createState({ bots: 0, baseWeapon: 'apprentice-wand' });
    const wizard = state.wizards[0];
    state.obstacles = [];
    wizard.x = 0;
    wizard.y = 0;
    wizard.heading = 0;

    for (const id of [
      'rocket-rune-boots',
      'boots-of-endless-flight',
      'haste-orb',
      'enchanted-gargoyle',
      'rune-key',
    ]) {
      addAttackToInventory(wizard, id);
    }

    equipAttack(wizard, 'rocket-rune-boots', 0);
    fillAttackAmmunition(wizard, 'rocket-rune-boots');
    castAttack(state, wizard, 'rocket-rune-boots');
    expect(wizard.x).toBeGreaterThan(400);
    expect(wizard.jumpV).toBeGreaterThan(300);

    equipAttack(wizard, 'boots-of-endless-flight', 0);
    fillAttackAmmunition(wizard, 'boots-of-endless-flight');
    castAttack(state, wizard, 'boots-of-endless-flight');
    expect(wizard.abilityFlightTimer).toBe(8);
    expect(wizard.flying).toBe(true);

    equipAttack(wizard, 'haste-orb', 0);
    fillAttackAmmunition(wizard, 'haste-orb');
    castAttack(state, wizard, 'haste-orb');
    expect(wizard.hasteFactor).toBeGreaterThan(1.5);
    expect(wizard.hasteTimer).toBe(7);

    equipAttack(wizard, 'enchanted-gargoyle', 0);
    fillAttackAmmunition(wizard, 'enchanted-gargoyle');
    castAttack(state, wizard, 'enchanted-gargoyle');
    expect(state.spells.some((spell) => spell.attackId === 'enchanted-gargoyle')).toBe(true);

    equipAttack(wizard, 'rune-key', 0);
    castAttack(state, wizard, 'rune-key');
    expect(wizard.runeKeys).toBe(1);
  });

  it('keeps poison, restoration, protection, and empowerment fields active over time', () => {
    const poisonState = createState({ bots: 1, baseWeapon: 'apprentice-wand' });
    const [caster, victim] = poisonState.wizards;
    poisonState.obstacles = [];
    caster.x = victim.x = 0;
    caster.y = victim.y = 0;
    addAttackToInventory(caster, 'poison-mist');
    equipAttack(caster, 'poison-mist', 0);
    fillAttackAmmunition(caster, 'poison-mist');
    castAttack(poisonState, caster, 'poison-mist');
    const beforePoison = victim.health;
    stepSpells(poisonState, 0.5);
    expect(victim.health).toBeLessThan(beforePoison);
    expect(victim.dotTimer).toBeGreaterThan(0);

    const supportState = createState({ bots: 1, baseWeapon: 'apprentice-wand' });
    const [support, nearby] = supportState.wizards;
    supportState.obstacles = [];
    support.x = nearby.x = 0;
    support.y = nearby.y = 0;
    support.health = nearby.health = 50;
    addAttackToInventory(support, 'cauldron-of-restoration');
    equipAttack(support, 'cauldron-of-restoration', 0);
    castAttack(supportState, support, 'cauldron-of-restoration');
    stepSpells(supportState, 1);
    expect(support.health).toBeGreaterThan(50);
    expect(nearby.health).toBe(50);
    expect(nearby.shield).toBe(0);

    addAttackToInventory(support, 'empowerment-beacon');
    equipAttack(support, 'empowerment-beacon', 0);
    castAttack(supportState, support, 'empowerment-beacon');
    stepSpells(supportState, 0.1);
    expect(support.empowerFactor).toBeGreaterThan(1);
    expect(nearby.empowerFactor).toBe(1);
  });

  it('makes Chaos Cube random and Baba Yaga’s Curse disrupt the target’s casting', () => {
    const state = createState({ bots: 1, baseWeapon: 'apprentice-wand' });
    const [wizard, target] = state.wizards;
    state.obstacles = [];
    wizard.x = 0;
    wizard.y = 0;
    target.x = 100;
    target.y = 0;
    wizard.heading = 0;
    wizard.aimX = target.x;
    wizard.aimY = target.y;
    wizard.aimZ = WAND.castHeight;
    wizard.aimTargetId = target.id;

    addAttackToInventory(wizard, 'chaos-cube');
    equipAttack(wizard, 'chaos-cube', 0);
    fillAttackAmmunition(wizard, 'chaos-cube');
    castAttack(state, wizard, 'chaos-cube');
    stepSpells(state, 0.1);
    expect(state.events.some((event) => event.type === 'chaos-effect')).toBe(true);

    // Chaos may knock or pull its victim. Put the target back on the curse's
    // center line so this half of the test measures the Curse itself.
    target.health = WIZARD.maxHealth;
    target.x = 100;
    target.y = 0;
    state.spells = [];
    addAttackToInventory(wizard, 'baba-yagas-curse');
    equipAttack(wizard, 'baba-yagas-curse', 0);
    fillAttackAmmunition(wizard, 'baba-yagas-curse');
    castAttack(state, wizard, 'baba-yagas-curse');
    stepSpells(state, 0.1);
    expect(target.curseTimer).toBeGreaterThan(0);
  });

  it('spawns with the confirmed weapon locked and no attacks', () => {
    const state = createState({ bots: 0, baseWeapon: 'chaos-orb' });
    const wizard = state.wizards[0];
    expect(state.baseWeaponId).toBe('chaos-orb');
    expect(wizard.baseWeaponId).toBe('chaos-orb');
    expect(wizard.weaponLocked).toBe(true);
    expect(wizard.attackInventory).toEqual([]);
    expect(wizard.attackSlots).toEqual([null, null, null, null, null, null]);
    expect(changeBaseWeapon(wizard, 'apprentice-wand')).toBe(false);
    expect(wizard.baseWeaponId).toBe('chaos-orb');
    expect(Object.getOwnPropertyDescriptor(wizard, 'baseWeaponId').writable).toBe(false);
  });

  it('cannot cast from an empty match hotbar', () => {
    const state = createState({ bots: 0, baseWeapon: 'apprentice-wand' });
    update(state, [{ attack: null, cast: true, aimX: 500, aimY: 0 }], 0.016);
    expect(state.spells).toHaveLength(0);
    expect(state.wizards[0].castTimer).toBe(0);
  });

  it('lets every weapon equip and cast a universal attack', () => {
    for (const weaponId of BASE_WEAPON_ORDER) {
      const state = createState({ bots: 0, baseWeapon: weaponId });
      const wizard = state.wizards[0];
      expect(addAttackToInventory(wizard, 'apprentice-bolt')).toBe(true);
      expect(isAttackCompatible(wizard, 'apprentice-bolt')).toBe(true);
      expect(equipAttack(wizard, 'apprentice-bolt', 0)).toBe(true);
      fillAttackAmmunition(wizard, 'apprentice-bolt');
      expect(castAttack(state, wizard, 'apprentice-bolt')).toBe(true);
    }
  });

  it('marks all 35 universal attacks compatible with every weapon', () => {
    for (const attackId of UNIVERSAL_ATTACK_IDS) {
      for (const weaponId of BASE_WEAPON_ORDER) {
        expect(isAttackCompatible(weaponId, attackId)).toBe(true);
      }
    }
  });

  it('marks every Tier attack compatible with only its assigned weapon', () => {
    for (const attackId of TIER_ATTACK_IDS) {
      const attack = ATTACKS[attackId];
      for (const weaponId of BASE_WEAPON_ORDER) {
        expect(isAttackCompatible(weaponId, attackId)).toBe(weaponId === attack.weaponId);
      }
    }
  });

  it('resolves either Tier to the collector’s permanently locked weapon', () => {
    const state = createState({ bots: 0, baseWeapon: 'arcane-spellbook' });
    const wizard = state.wizards[0];
    for (const pickupAttackId of TIER_ATTACK_IDS) {
      const resolved = tierAttackForWizard(wizard, pickupAttackId);
      expect(resolved).toBeTruthy();
      expect(ATTACKS[resolved].weaponId).toBe('arcane-spellbook');
      expect(ATTACKS[resolved].tier).toBe(ATTACKS[pickupAttackId].tier);
    }
  });

  it('equips the first compatible Tier scroll, then converts later scrolls to matching ammunition', () => {
    const state = createState({ bots: 0, baseWeapon: 'arcane-spellbook' });
    const wizard = state.wizards[0];
    const pickup = (id, attackId) => ({
      id,
      lootType: ATTACKS[attackId]?.scope === 'tier' ? 'tier-scroll' : 'attack',
      attackId,
      rarity: 'common',
      x: wizard.x,
      y: wizard.y,
      collectedBy: null,
    });
    const universal = pickup(1, 'apprentice-bolt');
    const firstTier = pickup(2, 'bouncing-magic-bomb');
    const extraTier = pickup(3, 'rapid-fire-spell');
    state.attackPickups = [universal, firstTier];
    expect(collectNearbyAttacks(state, wizard)).toBe(2);
    expect(wizard.attackInventory).toEqual(
      expect.arrayContaining(['apprentice-bolt', 'close-range-blast']),
    );
    expect(wizard.attackSlots).toContain('apprentice-bolt');
    expect(wizard.attackSlots).toContain('close-range-blast');
    expect(wizard.tierAttackId).toBe('close-range-blast');
    expect(attackAmmunition(wizard, 'close-range-blast')).toBe(MANA_AMMUNITION.burst.pickup);

    wizard.manaPouch.burst = 30;
    const beforeEnergy = wizard.manaPouch.burst;
    state.attackPickups.push(extraTier);
    expect(collectNearbyAttacks(state, wizard)).toBe(1);
    expect(wizard.attackInventory.filter((id) => ATTACKS[id].scope === 'tier')).toEqual([
      'close-range-blast',
    ]);
    expect(wizard.manaPouch.burst).toBe(beforeEnergy + MANA_AMMUNITION.burst.pickup);
    expect(state.events.some((event) => event.convertedToMana)).toBe(true);

    const manaBeforeCast = wizard.manaPouch.burst;
    const effectiveTierAttack = effectiveAttackForWizard(wizard, 'close-range-blast');
    expect(castAttack(state, wizard, 'close-range-blast')).toBe(true);
    expect(wizard.manaPouch.burst).toBe(manaBeforeCast - effectiveTierAttack.manaCost);
    wizard.manaPouch.burst = 0;
    expect(castAttack(state, wizard, 'close-range-blast')).toBe(false);
  });

  it('creates a fresh empty loadout and fresh pickups when a match restarts', () => {
    const first = createState({ bots: 0, baseWeapon: 'enchanted-bow', lootSeed: 111 });
    const firstWizard = first.wizards[0];
    addAttackToInventory(firstWizard, 'apprentice-bolt');
    equipAttack(firstWizard, 'apprentice-bolt', 0);
    first.attackPickups[0].collectedBy = firstWizard.id;

    const restarted = createState({ bots: 0, baseWeapon: 'arcane-spellbook', lootSeed: 222 });
    expect(restarted.wizards[0].baseWeaponId).toBe('arcane-spellbook');
    expect(restarted.wizards[0].baseWeaponRarity).toBe('common');
    expect(restarted.wizards[0].attackInventory).toEqual([]);
    expect(restarted.wizards[0].attackRarities).toEqual({});
    expect(restarted.wizards[0].attackSlots.every((slot) => slot == null)).toBe(true);
    expect(restarted.wizards[0].tierAttackId).toBe(null);
    expect(restarted.wizards[0].manaPouch).toEqual({
      catalyst: 0,
      elemental: 0,
      burst: 0,
      cosmic: 0,
      calamity: 0,
    });
    expect(restarted.attackPickups.every((pickup) => pickup.collectedBy == null)).toBe(true);
    expect(restarted.attackPickups.map((pickup) => pickup.spawnPointId)).not.toEqual(
      first.attackPickups.map((pickup) => pickup.spawnPointId),
    );
  });
});

describe('safe randomized loot and rarity', () => {
  it('uses the exact 52/17/10/8/10/3 category chances and Tier split', () => {
    expect(LOOT_CATEGORY_CHANCES).toEqual({
      regular: 0.52,
      healingProtection: 0.17,
      movement: 0.1,
      special: 0.08,
      tier1: 0.035,
      tier2: 0.065,
      mythic: 0.03,
    });
    expect(Object.values(LOOT_CATEGORY_CHANCES).reduce((sum, chance) => sum + chance, 0)).toBe(1);
    expect(LOOT_CATEGORY_CHANCES.tier1 + LOOT_CATEGORY_CHANCES.tier2).toBe(0.1);

    const categoryAt = (value) => rollLootCategory(() => value);
    expect(categoryAt(0)).toBe('regular');
    expect(categoryAt(0.519999)).toBe('regular');
    expect(categoryAt(0.52)).toBe('healing-protection');
    expect(categoryAt(0.689999)).toBe('healing-protection');
    expect(categoryAt(0.69)).toBe('movement');
    expect(categoryAt(0.789999)).toBe('movement');
    expect(categoryAt(0.79)).toBe('special');
    expect(categoryAt(0.869999)).toBe('special');
    expect(categoryAt(0.87)).toBe('tier-1');
    expect(categoryAt(0.904999)).toBe('tier-1');
    expect(categoryAt(0.905)).toBe('tier-2');
    expect(categoryAt(0.969999)).toBe('tier-2');
    expect(categoryAt(0.97)).toBe('mythic');
    expect(categoryAt(0.999999)).toBe('mythic');
  });

  it('gives all six base weapons equal-sized Tier 1 and Tier 2 roll ranges', () => {
    for (const tier of [1, 2]) {
      for (let index = 0; index < BASE_WEAPON_ORDER.length; index++) {
        const attackId = rollTierAttackId(tier, () => (index + 0.5) / BASE_WEAPON_ORDER.length);
        expect(ATTACKS[attackId].weaponId).toBe(BASE_WEAPON_ORDER[index]);
        expect(ATTACKS[attackId].tier).toBe(tier);
      }
    }
  });

  it('uses the exact 50/25/15/8/2 rarity chances and colors', () => {
    expect(LOOT_RARITY_ORDER).toEqual(['common', 'rare', 'super-rare', 'epic', 'legendary']);
    expect(LOOT_RARITY_ORDER.map((id) => LOOT_RARITIES[id].chance)).toEqual([
      0.5, 0.25, 0.15, 0.08, 0.02,
    ]);
    expect(Object.values(LOOT_RARITIES).reduce((sum, rarity) => sum + rarity.chance, 0)).toBe(1);
    expect(LOOT_RARITY_ORDER.map((id) => LOOT_RARITIES[id].color)).toEqual([
      '#9ca3af',
      '#22c55e',
      '#3b82f6',
      '#a855f7',
      '#f59e0b',
    ]);
  });

  it('rolls rarity at the exact percentage boundaries', () => {
    const rarityAt = (value) => rollLootRarity(() => value);
    expect(rarityAt(0)).toBe('common');
    expect(rarityAt(0.499999)).toBe('common');
    expect(rarityAt(0.5)).toBe('rare');
    expect(rarityAt(0.749999)).toBe('rare');
    expect(rarityAt(0.75)).toBe('super-rare');
    expect(rarityAt(0.899999)).toBe('super-rare');
    expect(rarityAt(0.9)).toBe('epic');
    expect(rarityAt(0.979999)).toBe('epic');
    expect(rarityAt(0.98)).toBe('legendary');
    expect(rarityAt(0.999999)).toBe('legendary');
  });

  it('starts every base weapon at Common and lets runes improve the locked weapon', () => {
    const state = createState({ bots: 0, baseWeapon: 'enchanted-bow', lootSeed: 81 });
    const wizard = state.wizards[0];
    expect(wizard.baseWeaponRarity).toBe('common');
    expect(upgradeBaseWeaponRarity(wizard, 'common')).toBe('common');
    expect(upgradeBaseWeaponRarity(wizard, 'epic')).toBe('epic');

    const rune = {
      id: 999,
      lootType: 'weapon-upgrade-rune',
      attackId: null,
      rarity: 'legendary',
      x: wizard.x,
      y: wizard.y,
      collectedBy: null,
    };
    expect(collectAttackPickup(state, wizard, rune)).toBe(true);
    expect(wizard.baseWeaponRarity).toBe('legendary');
    expect(rune.collectedBy).toBe(wizard.id);
    expect(state.events.at(-1)).toMatchObject({
      type: 'weapon-upgrade',
      previousRarity: 'epic',
      rarity: 'legendary',
      upgraded: true,
    });

    addAttackToInventory(wizard, 'apprentice-bolt', 'common');
    expect(attackRarityForWizard(wizard, 'apprentice-bolt')).toBe('legendary');
    expect(effectiveAttackForWizard(wizard, 'apprentice-bolt').damage).toBeCloseTo(
      ATTACKS['apprentice-bolt'].damage * LOOT_RARITIES.legendary.damage,
    );
  });

  it('applies every rarity gameplay bonus to attacks', () => {
    const state = createState({ bots: 0, baseWeapon: 'apprentice-wand', lootSeed: 10 });
    const wizard = state.wizards[0];
    addAttackToInventory(wizard, 'apprentice-bolt', 'rare');
    expect(attackRarityForWizard(wizard, 'apprentice-bolt')).toBe('rare');
    expect(effectiveAttackForWizard(wizard, 'apprentice-bolt').damage).toBeCloseTo(
      ATTACKS['apprentice-bolt'].damage * 1.05,
    );

    wizard.attackRarities['apprentice-bolt'] = 'super-rare';
    const superRare = effectiveAttackForWizard(wizard, 'apprentice-bolt');
    expect(superRare.damage).toBeCloseTo(ATTACKS['apprentice-bolt'].damage * 1.1);
    expect(superRare.speed).toBeCloseTo(ATTACKS['apprentice-bolt'].speed * 1.08);

    addAttackToInventory(wizard, 'continuous-magic-beam', 'epic');
    const epic = effectiveAttackForWizard(wizard, 'continuous-magic-beam');
    expect(epic.damage).toBeCloseTo(ATTACKS['continuous-magic-beam'].damage * 1.15);
    expect(epic.manaCost).toBeCloseTo(0.54);

    wizard.attackRarities['continuous-magic-beam'] = 'legendary';
    const legendary = effectiveAttackForWizard(wizard, 'continuous-magic-beam');
    expect(legendary.damage).toBeCloseTo(ATTACKS['continuous-magic-beam'].damage * 1.2);
    expect(legendary.manaCost).toBeCloseTo(0.48);
    expect(legendary.cooldown).toBe(0);
  });

  it('uses rarity-modified speed, damage, and energy with no cooldown during real casts', () => {
    const state = createState({ bots: 0, baseWeapon: 'apprentice-wand', lootSeed: 20 });
    const wizard = state.wizards[0];
    wizard.x = 0;
    wizard.y = 0;
    wizard.heading = 0;
    wizard.aimX = 1000;
    wizard.aimY = 0;
    wizard.aimZ = WAND.castHeight;
    addAttackToInventory(wizard, 'apprentice-bolt', 'super-rare');
    equipAttack(wizard, 'apprentice-bolt', 0);
    fillAttackAmmunition(wizard, 'apprentice-bolt');
    expect(castAttack(state, wizard, 'apprentice-bolt')).toBe(true);
    const projectile = state.spells.find((spell) => spell.attackId === 'apprentice-bolt');
    expect(projectile.damage).toBeCloseTo(ATTACKS['apprentice-bolt'].damage * 1.1);
    expect(Math.hypot(projectile.vx, projectile.vy, projectile.vz)).toBeCloseTo(
      ATTACKS['apprentice-bolt'].speed * 1.08,
    );

    addAttackToInventory(wizard, 'continuous-magic-beam', 'legendary');
    equipAttack(wizard, 'continuous-magic-beam', 1);
    fillAttackAmmunition(wizard, 'continuous-magic-beam');
    const manaBefore = attackAmmunition(wizard, 'continuous-magic-beam');
    const effectiveTier = effectiveAttackForWizard(wizard, 'continuous-magic-beam');
    expect(castAttack(state, wizard, 'continuous-magic-beam')).toBe(true);
    expect(attackAmmunition(wizard, 'continuous-magic-beam')).toBe(
      manaBefore - effectiveTier.manaCost,
    );
    expect(wizard.cooldowns['attack:continuous-magic-beam']).toBe(0);
  });

  it('builds safe grounded spawn pools away from hazards and steep terrain', () => {
    const obstacles = buildObstacles();
    const points = createLootSpawnPoints(obstacles);
    expect(points.length).toBeGreaterThan(250);
    expect(points.filter((point) => point.density === 'major').length).toBeGreaterThan(
      points.filter((point) => point.density === 'wilderness').length,
    );
    for (const point of points) {
      expect(isSafeLootSpawnPoint(point.x, point.y, obstacles), point.id).toBe(true);
      expect(point.groundHeight, point.id).toBeCloseTo(terrainHeight(point.x, point.y));
      expect(terrainSlopeAt(point.x, point.y), point.id).toBeLessThanOrEqual(
        LOOT_SPAWN_RULES.maximumSlope,
      );
      expect(Math.hypot(point.x, point.y), point.id).toBeLessThanOrEqual(
        ARENA.radius - LOOT_SPAWN_RULES.edgeMargin,
      );
    }
    for (let left = 0; left < points.length; left++) {
      for (let right = left + 1; right < points.length; right++) {
        expect(
          dist(points[left].x, points[left].y, points[right].x, points[right].y),
        ).toBeGreaterThanOrEqual(LOOT_SPAWN_RULES.minimumSpacing);
      }
    }
  });

  it('randomly activates loot while guaranteeing useful combat choices in every major area', () => {
    const obstacles = buildObstacles();
    const first = createAttackPickups(obstacles, 123);
    const second = createAttackPickups(obstacles, 456);
    for (const pickups of [first, second]) {
      expect(pickups).toHaveLength(
        LOOT_MAJOR_AREAS.length * LOOT_SPAWN_RULES.activePerMajorArea +
          LOOT_SPAWN_RULES.activeWilderness +
          MANA_AMMUNITION_ORDER.length * 2,
      );
      expect(new Set(pickups.map((pickup) => pickup.spawnPointId)).size).toBe(pickups.length);
      const mythics = pickups.filter((pickup) => pickup.category === 'mythic');
      expect(mythics.length).toBeGreaterThanOrEqual(1);
      expect(mythics.length).toBeLessThanOrEqual(3);
      expect(mythics.every((pickup) => LOOT_MYTHIC_AREA_IDS.includes(pickup.areaId))).toBe(true);

      for (const pickup of pickups) {
        expect(LOOT_RARITIES[pickup.rarity]).toBeTruthy();
        if (pickup.lootType === 'mana-ammunition') {
          expect(MANA_AMMUNITION[pickup.ammoType]).toBeTruthy();
          expect(pickup.amount).toBe(MANA_AMMUNITION[pickup.ammoType].pickup);
          continue;
        }
        if (pickup.lootType === 'weapon-upgrade-rune') {
          expect(pickup.category).toBe('special');
          expect(pickup.attackId).toBe(null);
          continue;
        }
        if (ITEM_DEFINITIONS[pickup.itemId]) {
          expect(ITEM_DEFINITIONS[pickup.itemId]?.lootType).toBe(pickup.lootType);
          expect(pickup.category).toBe('special');
          continue;
        }
        expect(ATTACKS[pickup.attackId]).toBeTruthy();
        if (pickup.category === 'regular') {
          expect(REGULAR_UNIVERSAL_ATTACK_IDS).toContain(pickup.attackId);
        } else if (pickup.category === 'healing-protection') {
          expect(HEALING_PROTECTION_ATTACK_IDS).toContain(pickup.attackId);
        } else if (pickup.category === 'movement') {
          expect(MOVEMENT_ATTACK_IDS).toContain(pickup.attackId);
        } else if (pickup.category === 'special') {
          expect(SPECIAL_ATTACK_IDS).toContain(pickup.attackId);
        } else if (pickup.category === 'tier') {
          expect(TIER_ATTACK_IDS).toContain(pickup.attackId);
          expect(ATTACKS[pickup.attackId].tier).toBe(pickup.tier);
        } else if (pickup.category === 'mythic') {
          expect(MYTHIC_ATTACK_IDS).toContain(pickup.attackId);
        }
      }

      for (const area of LOOT_MAJOR_AREAS) {
        const areaPickups = pickups.filter((pickup) => pickup.areaId === area.id);
        expect(
          areaPickups.filter((pickup) => pickup.lootType !== 'mana-ammunition'),
          area.id,
        ).toHaveLength(LOOT_SPAWN_RULES.activePerMajorArea);
        expect(
          areaPickups.filter((pickup) => {
            const attack = ATTACKS[pickup.attackId];
            return (
              attack && (attack.damage > 0 || attack.splashDamage > 0 || attack.damagePerSecond > 0)
            );
          }).length,
          area.id,
        ).toBeGreaterThanOrEqual(3);
      }
    }
    expect(first.map((pickup) => pickup.spawnPointId)).not.toEqual(
      second.map((pickup) => pickup.spawnPointId),
    );
    expect(first.map((pickup) => `${pickup.category}:${pickup.attackId}`)).not.toEqual(
      second.map((pickup) => `${pickup.category}:${pickup.attackId}`),
    );
  });

  it('can spawn Upgrade Runes and rolls their rarity from the exact rarity table', () => {
    const obstacles = buildObstacles();
    const runes = Array.from({ length: 40 }, (_, seed) =>
      createAttackPickups(obstacles, seed + 1).filter(
        (pickup) => pickup.lootType === 'weapon-upgrade-rune',
      ),
    ).flat();
    expect(runes.length).toBeGreaterThan(0);
    expect(runes.every((rune) => rune.category === 'special' && rune.attackId == null)).toBe(true);
    expect(runes.every((rune) => LOOT_RARITIES[rune.rarity])).toBe(true);
    expect(WEAPON_UPGRADE_RUNE_ID).toBe('weapon-upgrade-rune');
  });
});

describe('manual player loot pickup', () => {
  it('does not automatically collect loot when the player walks over it', () => {
    const state = createState({ bots: 0, lootSeed: 700 });
    const wizard = state.wizards[0];
    const pickup = state.attackPickups[0];
    pickup.x = wizard.x;
    pickup.y = wizard.y;

    update(state, [{ attack: null, dx: 0, dy: 0 }], 0.016);
    expect(pickup.collectedBy).toBe(null);
    expect(wizard.attackInventory).toEqual([]);
  });

  it('collects only the closest nearby crystal for one F pickup input', () => {
    const state = createState({ bots: 0, lootSeed: 701 });
    const wizard = state.wizards[0];
    const nearby = state.attackPickups.slice(0, 2);
    state.attackPickups = nearby;
    nearby[0].x = wizard.x + 2;
    nearby[0].y = wizard.y;
    nearby[1].x = wizard.x + 4;
    nearby[1].y = wizard.y;

    update(state, [{ attack: null, pickup: true }], 0.016);
    expect(nearby.filter((pickup) => pickup.collectedBy === wizard.id)).toHaveLength(1);
    expect(nearby[0].collectedBy).toBe(wizard.id);
    expect(nearby[1].collectedBy).toBe(null);
  });

  it('keeps bot looting automatic', () => {
    const state = createState({ bots: 1, lootSeed: 702 });
    const bot = state.wizards[1];
    const pickup = state.attackPickups.find(
      (candidate) => ATTACKS[candidate.attackId].scope === 'universal',
    );
    state.attackPickups = [pickup];
    pickup.x = bot.x;
    pickup.y = bot.y;

    update(state, [{ attack: null }], 0.016);
    expect(pickup.collectedBy).toBe(bot.id);
    expect(bot.attackInventory).toContain(pickup.attackId);
  });
});

describe('portal opening', () => {
  it('has exactly five portals with one unique major-region destination each', () => {
    const state = createState({ bots: 0, opening: true });
    expect(OPENING.portalCount).toBe(5);
    expect(PORTAL_DESTINATIONS).toHaveLength(5);
    expect(state.opening.portals).toHaveLength(5);
    const centerSpacing = 2 * OPENING.portalRing * Math.sin(Math.PI / OPENING.portalCount);
    const gap = centerSpacing - OPENING.portalOuterWidth;
    expect(gap / OPENING.portalOuterWidth).toBeCloseTo(0.5, 1);
    expect(new Set(state.opening.portals.map((portal) => portal.destination)).size).toBe(5);
    expect(PORTAL_DESTINATIONS.map((destination) => destination.name)).toEqual([
      'Enchanted Highlands',
      'Crown Castle',
      'Harvest Village',
      'Western Harbor',
      'Sunken Desert',
    ]);
  });

  it('counts down, opens portals, teleports, and completes after slow-fall', () => {
    const s = createState({ bots: 0, opening: true });
    const w = s.wizards[0];
    expect(s.opening.phase).toBe('countdown');
    expect(w.openingH).toBeGreaterThan(2000);

    update(s, [{ dx: 0, dy: 0 }], OPENING.countdown);
    expect(s.opening.phase).toBe('choose');
    const portal = s.opening.portals[0];
    w.x = portal.x;
    w.y = portal.y;
    update(s, [{ dx: 0, dy: 0 }], 0.01);
    expect(w.slowFalling).toBe(true);
    expect(w.openingH).toBeGreaterThan(1000);
    const destination = PORTAL_DESTINATIONS[0];
    expect(dist(w.x, w.y, destination.x, destination.y)).toBeLessThanOrEqual(
      destination.landingRadius,
    );
    expect(isSafeLootSpawnPoint(w.x, w.y, s.obstacles)).toBe(true);

    for (let i = 0; i < 20 && s.opening.phase !== 'complete'; i++) {
      update(s, [{ dx: 1, dy: 0 }], 1);
    }
    expect(w.openingLanded).toBe(true);
    expect(w.openingH).toBe(0);
    expect(s.opening.phase).toBe('complete');
    expect(s.time).toBe(0);
  });

  it('chooses different safe landing points throughout each portal region', () => {
    const landings = [];
    for (let match = 0; match < 4; match++) {
      const state = createState({ bots: 0, opening: true });
      update(state, [{}], OPENING.countdown);
      const wizard = state.wizards[0];
      const portal = state.opening.portals[0];
      wizard.x = portal.x;
      wizard.y = portal.y;
      update(state, [{}], 0.01);
      const destination = PORTAL_DESTINATIONS[portal.destination];
      expect(dist(wizard.x, wizard.y, destination.x, destination.y)).toBeLessThanOrEqual(
        destination.landingRadius,
      );
      expect(isSafeLootSpawnPoint(wizard.x, wizard.y, state.obstacles)).toBe(true);
      landings.push(`${wizard.x.toFixed(2)},${wizard.y.toFixed(2)}`);
    }
    expect(new Set(landings).size).toBeGreaterThan(1);
  });

  it('keeps players and bots completely still until the portal countdown finishes', () => {
    const state = createState({ bots: 1, opening: true });
    const [playerWizard, bot] = state.wizards;
    const playerStart = { x: playerWizard.x, y: playerWizard.y };
    const botStart = { x: bot.x, y: bot.y };

    update(state, [{ dx: 1, dy: 1, run: true }], OPENING.countdown - 0.01);
    expect(state.opening.phase).toBe('countdown');
    expect({ x: playerWizard.x, y: playerWizard.y }).toEqual(playerStart);
    expect({ x: bot.x, y: bot.y }).toEqual(botStart);

    // Crossing zero opens the portals, but movement begins on the next step.
    update(state, [{ dx: 1, dy: 1, run: true }], 0.01);
    expect(state.opening.phase).toBe('choose');
    expect({ x: playerWizard.x, y: playerWizard.y }).toEqual(playerStart);
    expect({ x: bot.x, y: bot.y }).toEqual(botStart);

    update(state, [{ dx: 1, dy: 0 }], 0.1);
    expect(playerWizard.x).toBeGreaterThan(playerStart.x);
    expect(dist(bot.x, bot.y, botStart.x, botStart.y)).toBeGreaterThan(0);
  });

  it('changes unstable portal destinations during the choice window', () => {
    const s = createState({ bots: 0, opening: true });
    update(s, [{}], OPENING.countdown);
    const unstable = s.opening.portals.find((portal) => portal.unstable);
    const before = unstable.destination;
    update(s, [{}], 5);
    expect(unstable.destination).not.toBe(before);
  });

  it('lets the player move immediately after landing while bots are still falling', () => {
    const state = createState({ bots: 1, opening: true });
    const [playerWizard, bot] = state.wizards;
    state.obstacles = [];
    state.opening.phase = 'falling';
    playerWizard.x = 0;
    playerWizard.y = 0;
    playerWizard.openingH = 0.1;
    playerWizard.slowFalling = true;
    playerWizard.openingLanded = false;
    bot.openingH = 1200;
    bot.slowFalling = true;
    bot.openingLanded = false;

    update(state, [{ dx: 0, dy: 0 }], 0.01);
    expect(playerWizard.openingLanded).toBe(true);
    expect(bot.openingLanded).toBe(false);
    expect(state.opening.phase).toBe('falling');

    const landedX = playerWizard.x;
    update(state, [{ dx: 1, dy: 0 }], 0.1);
    expect(playerWizard.x).toBeGreaterThan(landedX);
    expect(state.time).toBeGreaterThan(0);
  });

  it('allows a slow-falling player to land and walk on a house roof', () => {
    const state = createState({ bots: 0, opening: true });
    const wizard = state.wizards[0];
    const house = {
      kind: 'house',
      x: 500,
      y: 400,
      angle: 0,
      hw: 100,
      hd: 90,
      h: 120,
      top: 216,
    };
    state.obstacles = [house];
    state.opening.phase = 'falling';
    wizard.x = house.x;
    wizard.y = house.y;
    wizard.openingH = 250;
    wizard.slowFalling = true;
    wizard.openingLanded = false;

    update(state, [{ dx: 0, dy: 0 }], 1);

    expect(wizard.openingLanded).toBe(true);
    expect(wizard.slowFalling).toBe(false);
    expect(wizard.climbState).toBe('top');
    expect(wizard.climbOver).toBe(house);
    expect(terrainHeight(wizard.x, wizard.y) + wizard.climbH).toBeCloseTo(
      obstacleGroundHeight(house) + house.h * 1.7,
    );
  });

  it('does not let landed bots attack until the entire portal opening is complete', () => {
    const state = createState({ bots: 2, opening: true });
    const [playerWizard, armedBot, fallingBot] = state.wizards;
    state.obstacles = [];
    state.attackPickups = [];
    state.opening.phase = 'falling';
    playerWizard.openingLanded = true;
    playerWizard.slowFalling = false;
    playerWizard.x = 0;
    playerWizard.y = 0;
    armedBot.openingLanded = true;
    armedBot.slowFalling = false;
    armedBot.x = 150;
    armedBot.y = 0;
    fallingBot.openingLanded = false;
    fallingBot.slowFalling = true;
    fallingBot.openingH = 1200;
    addAttackToInventory(armedBot, 'apprentice-bolt');
    equipAttack(armedBot, 'apprentice-bolt', 0);
    fillAttackAmmunition(armedBot, 'apprentice-bolt');
    const manaBefore = attackAmmunition(armedBot, 'apprentice-bolt');
    state.time = BOT_ENGAGE_DELAY + 10;

    update(state, [{ dx: 0, dy: 0 }], 0.1);

    expect(state.opening.phase).toBe('falling');
    expect(attackAmmunition(armedBot, 'apprentice-bolt')).toBe(manaBefore);
    expect(state.spells).toHaveLength(0);
  });
});

describe('moveWizard', () => {
  it('moves along the direction', () => {
    const w = createState().wizards[0];
    const x0 = w.x;
    w.x = 0;
    w.y = 0;
    moveWizard(w, 1, 0, 0.1);
    expect(w.x).toBeCloseTo(WIZARD.speed * 0.1);
    expect(x0).not.toBeUndefined();
  });
  it('walks slowly and only uses the faster speed while running', () => {
    const w = createState({ bots: 0 }).wizards[0];
    w.x = 0;
    w.y = 0;
    moveWizard(w, 1, 0, 0.1);
    expect(w.x).toBeCloseTo(WIZARD.speed * 0.1);
    expect(WIZARD.speed).toBeLessThan(WIZARD.runSpeed);

    w.x = 0;
    w.running = true;
    moveWizard(w, 1, 0, 0.1);
    expect(w.x).toBeCloseTo(WIZARD.runSpeed * 0.1);
  });
  it('jumps once, follows gravity, and lands back at zero height', () => {
    const s = createState({ bots: 0 });
    s.obstacles = [];
    const w = s.wizards[0];
    w.x = 0;
    w.y = 0;
    update(s, [{ dx: 1, dy: 0, run: true, jump: true }], 0.05);
    expect(w.x).toBeCloseTo(WIZARD.runSpeed * 0.05);
    expect(w.jumpH).toBeGreaterThan(0);
    expect(w.jumpV).toBeLessThan(JUMP.velocity);

    for (let i = 0; i < 100 && w.jumpH > 0; i++) {
      update(s, [{ dx: 0, dy: 0, jump: false }], 0.02);
    }
    expect(w.jumpH).toBe(0);
    expect(w.jumpV).toBe(0);
  });
  it('is clamped to the arena boundary', () => {
    const w = createState().wizards[0];
    w.x = ARENA.radius - 1;
    w.y = 0;
    moveWizard(w, 1, 0, 100); // huge shove outward
    expect(dist(w.x, w.y, 0, 0)).toBeLessThanOrEqual(ARENA.radius + 0.001);
  });
});

describe('stamina', () => {
  it('provides six seconds of sprinting, then waits four seconds and refills in six', () => {
    const s = createState({ bots: 0 });
    s.obstacles = [];
    const w = s.wizards[0];
    w.x = 0;
    w.y = 0;

    for (let i = 0; i < 6; i++) update(s, [{ dx: 1, run: true }], 1);
    expect(w.stamina).toBe(0);
    expect(w.staminaExhausted).toBe(true);

    for (let i = 0; i < 4; i++) update(s, [{ dx: 0, run: false }], 1);
    expect(w.stamina).toBe(0);
    for (let i = 0; i < 6; i++) update(s, [{ dx: 0, run: false }], 1);
    expect(w.stamina).toBe(STAMINA.max);
    expect(w.staminaExhausted).toBe(false);
  });

  it('waits 1.5 seconds before regenerating partially used stamina', () => {
    const s = createState({ bots: 0 });
    s.obstacles = [];
    const w = s.wizards[0];
    update(s, [{ dx: 1, run: true }], 2);
    expect(w.stamina).toBe(4);

    update(s, [{ dx: 0, run: false }], 1);
    expect(w.stamina).toBe(4);
    update(s, [{ dx: 0, run: false }], 0.5);
    expect(w.stamina).toBe(4);
    update(s, [{ dx: 0, run: false }], 1);
    expect(w.stamina).toBe(5);
  });

  it('can interrupt regeneration to sprint and still walks normally at zero', () => {
    const s = createState({ bots: 0 });
    s.obstacles = [];
    const w = s.wizards[0];
    w.x = 0;
    w.y = 0;
    w.stamina = 0;
    w.staminaExhausted = true;
    w.staminaRegenDelay = 0;

    update(s, [{ dx: 0, run: false }], 1);
    expect(w.stamina).toBe(1);
    expect(w.staminaExhausted).toBe(false);

    update(s, [{ dx: 1, run: true }], 0.5);
    expect(w.running).toBe(true);
    expect(w.stamina).toBe(0.5);

    w.x = 0;
    w.stamina = 0;
    w.staminaExhausted = true;
    w.staminaRegenDelay = 1;
    update(s, [{ dx: 1, run: true }], 0.5);
    expect(w.running).toBe(false);
    expect(w.x).toBeCloseTo(WIZARD.speed * 0.5);
  });
});

describe('wand / spells', () => {
  it('castSpell spawns a bolt in the heading and remains immediately ready', () => {
    const s = createState();
    const w = s.wizards[0];
    w.heading = 0; // +x
    expect(castSpell(s, w)).toBe(true);
    expect(s.spells).toHaveLength(1);
    expect(s.spells[0].vx).toBeGreaterThan(0);
    expect(s.spells[0].originX).toBeCloseTo(s.spells[0].x);
    expect(s.spells[0].originY).toBeCloseTo(s.spells[0].y);
    expect(s.spells[0].originGround).toBeCloseTo(terrainHeight(w.x, w.y));
    expect(w.cooldowns.bolt).toBe(0);
  });
  it('ignores stale cooldown data and casts immediately', () => {
    const s = createState();
    s.wizards[0].cooldowns.bolt = 1;
    expect(castSpell(s, s.wizards[0])).toBe(true);
    expect(s.spells).toHaveLength(1);
    expect(s.wizards[0].cooldowns.bolt).toBe(0);
  });
  it('a bolt damages an enemy it hits and is consumed', () => {
    const s = createState({ bots: 1 });
    const [a, b] = s.wizards;
    b.x = 300;
    b.y = 300;
    const before = b.health;
    s.spells = [
      {
        x: b.x - 5,
        y: b.y,
        z: WAND.castHeight,
        vx: WAND.speed,
        vy: 0,
        vz: 0,
        life: 1,
        ownerId: a.id,
        radius: WAND.radius,
        damage: WAND.damage,
        color: '#fff',
      },
    ];
    stepSpells(s, 0.016);
    expect(b.health).toBe(before - WAND.damage);
    expect(s.spells).toHaveLength(0);
  });
  it('a bolt never hits its own caster', () => {
    const s = createState({ bots: 1 });
    const a = s.wizards[0];
    s.spells = [
      {
        x: a.x,
        y: a.y,
        z: WAND.castHeight,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 1,
        ownerId: a.id,
        radius: WAND.radius,
        damage: WAND.damage,
        color: '#fff',
      },
    ];
    const hp = a.health;
    stepSpells(s, 0.016);
    expect(a.health).toBe(hp);
  });

  it('emits a world-positioned impact when a bolt strikes the terrain', () => {
    const s = createState({ bots: 0 });
    const a = s.wizards[0];
    s.obstacles = [];
    s.spells = [
      {
        x: 0,
        y: 0,
        z: 1,
        originGround: terrainHeight(0, 0),
        vx: 0,
        vy: 0,
        vz: -100,
        life: 1,
        ownerId: a.id,
        radius: WAND.radius,
        damage: WAND.damage,
        color: '#fb923c',
      },
    ];
    stepSpells(s, 0.016);
    const impact = s.events.find((event) => event.type === 'block');
    expect(impact).toBeTruthy();
    expect(impact.worldZ).toBeCloseTo(terrainHeight(impact.x, impact.y));
    expect(s.spells).toHaveLength(0);
  });

  it('a bolt aimed at an enemy converges and hits it', () => {
    const s = createState({ bots: 1 });
    const [a, b] = s.wizards;
    a.x = 0;
    a.y = 0;
    a.heading = 0;
    b.x = 200;
    b.y = 0;
    a.aimX = 200; // aim right at the enemy (chest height)
    a.aimY = 0;
    a.aimZ = WAND.castHeight;
    castSpell(s, a);
    const before = b.health;
    for (let i = 0; i < 60; i++) stepSpells(s, 0.016);
    expect(b.health).toBeLessThan(before);
  });

  it('keeps a direct center-ray target accurate while that wizard moves', () => {
    const s = createState({ bots: 1 });
    const [a, b] = s.wizards;
    s.obstacles = [];
    a.x = 0;
    a.y = 0;
    a.heading = 0;
    b.x = 500;
    b.y = 0;
    a.aimX = b.x;
    a.aimY = b.y;
    a.aimZ = terrainHeight(b.x, b.y) - terrainHeight(a.x, a.y) + BODY_HEIGHT * 0.5;
    a.aimTargetId = b.id;
    castSpell(s, a);
    b.y = 200; // move well clear of the original straight path after the click
    const before = b.health;
    for (let i = 0; i < 30; i++) stepSpells(s, 0.016);
    expect(b.health).toBeLessThan(before);
    expect(s.events.some((event) => event.type === 'hit' && event.victim === b.id)).toBe(true);
  });

  it('an upward-aimed bolt flies over a wizard and misses', () => {
    const s = createState({ bots: 1 });
    const [a, b] = s.wizards;
    a.x = 0;
    a.y = 0;
    a.heading = 0;
    b.x = 120; // enemy straight ahead on the ground
    b.y = 0;
    a.aimX = 200; // aim high above/beyond the enemy
    a.aimY = 0;
    a.aimZ = 400;
    castSpell(s, a);
    expect(s.spells[0].vz).toBeGreaterThan(0); // bolt rises
    const before = b.health;
    for (let i = 0; i < 30; i++) stepSpells(s, 0.016);
    expect(b.health).toBe(before); // it sailed over the enemy's head
  });

  it('hits a distant wizard on a much higher hill when aimed at its visible body', () => {
    const s = createState({ bots: 1 });
    const [a, b] = s.wizards;
    s.obstacles = [];
    // A clear uphill sightline beside the new northwest river/mountain layout.
    // (The old coordinates now correctly put a ridge between the two wizards.)
    a.x = -2434;
    a.y = -354;
    b.x = -2913;
    b.y = -3526;
    a.heading = Math.atan2(b.y - a.y, b.x - a.x);
    a.aimX = b.x;
    a.aimY = b.y;
    a.aimZ = terrainHeight(b.x, b.y) - terrainHeight(a.x, a.y) + BODY_HEIGHT * 0.5;
    const before = b.health;
    castSpell(s, a);
    for (let i = 0; i < 100; i++) stepSpells(s, 0.016);
    expect(b.health).toBeLessThan(before);
  });

  it('the body height is above the cast height (level shots connect)', () => {
    expect(BODY_HEIGHT).toBeGreaterThan(WAND.castHeight);
    expect(PLAYER_BODY_HEIGHT).toBeGreaterThan(BODY_HEIGHT);
    expect(createState({ bots: 0 }).wizards[0].bodyHeight).toBe(PLAYER_BODY_HEIGHT);
  });
});

describe('spellbook', () => {
  it('slash hits an enemy in front and remains immediately ready', () => {
    const s = createState({ bots: 1 });
    const [a, b] = s.wizards;
    a.x = 0;
    a.y = 0;
    a.heading = 0; // facing +x
    b.x = 40; // just in front, within slash range
    b.y = 0;
    const before = b.health;
    expect(castSpell(s, a, 'slash')).toBe(true);
    expect(b.health).toBe(before - SPELLS.slash.damage);
    expect(a.slashTimer).toBeGreaterThan(0);
    expect(a.cooldowns.slash).toBe(0);
    expect(a.cooldowns.bolt).toBe(0); // other spells are still ready
  });

  it('slash misses an enemy behind you', () => {
    const s = createState({ bots: 1 });
    const [a, b] = s.wizards;
    a.x = 0;
    a.y = 0;
    a.heading = 0; // facing +x
    b.x = -40; // behind
    b.y = 0;
    const before = b.health;
    castSpell(s, a, 'slash');
    expect(b.health).toBe(before);
  });

  it('heal restores health without exceeding the maximum', () => {
    const s = createState();
    const a = s.wizards[0];
    a.health = 20;
    expect(castSpell(s, a, 'heal')).toBe(true);
    expect(a.health).toBe(Math.min(WIZARD.maxHealth, 20 + SPELLS.heal.heal));
    a.health = WIZARD.maxHealth - 5;
    a.cooldowns.heal = 0;
    castSpell(s, a, 'heal');
    expect(a.health).toBe(WIZARD.maxHealth); // capped
  });

  it('update casts the selected spell from input.spell', () => {
    const s = createState({ bots: 1 });
    const [a, b] = s.wizards;
    a.x = 0;
    a.y = 0;
    b.x = 40;
    b.y = 0;
    const before = b.health;
    update(s, [{ dx: 0, dy: 0, yaw: 0, aimX: 200, aimY: 0, spell: 'slash', cast: true }], 0.016);
    expect(b.health).toBeLessThan(before); // slashed, not bolted
    expect(s.spells).toHaveLength(0); // no projectile spawned
  });
});

describe('obstacles', () => {
  it('builds a deterministic layout with solids and soft (pass-through) bushes', () => {
    const a = buildObstacles();
    const b = buildObstacles();
    expect(a.length).toBeGreaterThan(200);
    expect(a.length).toBe(b.length);
    expect(a[0]).toEqual(b[0]); // same seed -> identical every match
    expect(a.some((o) => o.kind === 'tree')).toBe(true);
    expect(a.some((o) => o.kind === 'house')).toBe(true);
    expect(a.some((o) => o.soft)).toBe(true); // bushes don't collide
  });

  it('a bot cannot walk through a tree (it is blocked, not climbing)', () => {
    const tree = { kind: 'tree', x: 60, y: 0, r: 30, top: 400 };
    const bot = createState({ bots: 1 }).wizards[1]; // a bot: no climbing
    bot.x = 0;
    bot.y = 0;
    for (let i = 0; i < 20; i++) moveWizard(bot, 1, 0, 0.1, [tree]); // shove into it
    expect(dist(bot.x, bot.y, tree.x, tree.y)).toBeGreaterThanOrEqual(
      WIZARD.radius + tree.r - 0.01,
    );
    expect(bot.climbOver).toBe(null);
  });

  it('a player run-jumps into a wall, mantles onto the top, then drops off the edge', () => {
    const house = { kind: 'house', x: 60, y: 0, angle: 0, hw: 30, hd: 30, h: 120, top: 216 };
    const me = createState().wizards[0]; // the player
    me.x = 0;
    me.y = 0;
    me.wantClimb = true;
    me.runningJump = true;
    me.jumpV = JUMP.velocity;
    for (let i = 0; i < 10 && me.climbState == null; i++) {
      moveWizard(me, 1, 0, 0.05, [house]);
    }
    expect(me.climbState).toBe('wall');
    expect(me.climbOver).toBe(house);
    expect(me.x).toBeLessThanOrEqual(house.x - house.hw - WIZARD.radius - CLIMB.wallGap + 0.01); // rendered body and moving limbs stay clear of the wall
    for (let i = 0; i < 300 && me.climbState === 'wall'; i++) moveWizard(me, 1, 0, 0.05, [house]);
    expect(me.climbState).toBe('top'); // mantled onto the top
    expect(terrainHeight(me.x, me.y) + me.climbH).toBeCloseTo(
      obstacleGroundHeight(house) + house.h * 1.7,
    ); // feet stand at the roof's world height, never inside it
    // The whole collider, not just its centre, has cleared the near roof edge.
    expect(me.x - WIZARD.radius).toBeGreaterThanOrEqual(house.x - house.hw - 0.01);
    // Keep walking forward: off the far edge and now falling.
    for (let i = 0; i < 100 && me.climbState === 'top'; i++) moveWizard(me, 1, 0, 0.05, [house]);
    expect(me.climbState).toBe(null); // walked off the edge
    expect(me.climbH).toBeGreaterThan(0); // airborne (update() applies the fall)
  });

  it('holds completely still when a taller ledge blocks the mantle', () => {
    const wall = { kind: 'house', x: 60, y: 0, angle: 0, hw: 30, hd: 30, h: 120, top: 216 };
    // This taller solid overlaps the would-be landing point but not the approach.
    const ledge = { kind: 'tree', x: 56, y: 0, r: 10, top: 240 };
    const me = createState().wizards[0];
    me.x = 0;
    me.y = 0;
    me.wantClimb = true;
    me.runningJump = true;
    me.jumpV = JUMP.velocity;
    moveWizard(me, 1, 0, 0.05, [wall, ledge]);
    for (let i = 0; i < 300 && !me.climbBlocked; i++) moveWizard(me, 1, 0, 0.05, [wall, ledge]);
    expect(me.climbState).toBe('wall');
    expect(me.climbBlocked).toBe(true);

    const held = { x: me.x, y: me.y, h: me.climbH };
    for (let i = 0; i < 30; i++) moveWizard(me, 1, 0, 0.05, [wall, ledge]);
    expect(me.x).toBeCloseTo(held.x);
    expect(me.y).toBeCloseTo(held.y);
    expect(me.climbH).toBeCloseTo(held.h);

    me.wantClimb = false;
    me.climbDown = true; // S deliberately starts descending
    moveWizard(me, 1, 0, 0.05, [wall, ledge]);
    expect(me.climbBlocked).toBe(false);
    expect(me.climbH).toBeLessThan(held.h);
  });

  it('uses the cached nearby set while standing on a ledge', () => {
    const roof = { kind: 'house', x: 0, y: 0, angle: 0, hw: 80, hd: 80, h: 120, top: 216 };
    const me = createState().wizards[0];
    me.x = 0;
    me.y = 0;
    me.climbState = 'top';
    me.climbOver = roof;
    me.climbH = roof.h;
    me.climbNearby = [];
    // Reading this getter proves the old full-map loop was entered.
    const farWorldProp = {
      get soft() {
        throw new Error('walkOnTop scanned the full world');
      },
    };
    expect(() => moveWizard(me, 0, 0, 0.016, [roof, farWorldProp])).not.toThrow();
    expect(me.climbState).toBe('top');
  });

  it('a player does NOT climb unless holding forward (up)', () => {
    const tree = { kind: 'tree', x: 60, y: 0, r: 30, top: 120 };
    const me = createState().wizards[0];
    me.x = 0;
    me.y = 0;
    me.wantClimb = false; // not holding up -> blocked, no climb
    for (let i = 0; i < 20; i++) moveWizard(me, 1, 0, 0.1, [tree]);
    expect(me.climbOver).toBe(null);
    expect(dist(me.x, me.y, tree.x, tree.y)).toBeGreaterThanOrEqual(WIZARD.radius + tree.r - 0.01);
  });

  it('walking, sprinting on the ground, and a standing jump cannot start climbing', () => {
    const house = { kind: 'house', x: 60, y: 0, angle: 0, hw: 30, hd: 30, h: 120, top: 216 };
    for (const pose of [
      { running: false, runningJump: false, jumpV: 0 },
      { running: true, runningJump: false, jumpV: 0 },
      { running: false, runningJump: false, jumpV: JUMP.velocity },
    ]) {
      const me = createState().wizards[0];
      me.x = 0;
      me.y = 0;
      me.wantClimb = true;
      Object.assign(me, pose);
      for (let i = 0; i < 20; i++) moveWizard(me, 1, 0, 0.05, [house]);
      expect(me.climbState).toBe(null);
      expect(me.climbOver).toBe(null);
    }
  });

  it('holds position after releasing W, descends only with S, and jumps off with S + Space', () => {
    const wall = { kind: 'house', x: 60, y: 0, angle: 0, hw: 30, hd: 30, h: 120, top: 216 };
    const me = createState().wizards[0];
    me.x = 0;
    me.y = 0;
    me.wantClimb = true;
    me.runningJump = true;
    me.jumpV = JUMP.velocity;
    for (let i = 0; i < 10 && me.climbState == null; i++) moveWizard(me, 1, 0, 0.05, [wall]);
    expect(me.climbState).toBe('wall');

    for (let i = 0; i < 5; i++) moveWizard(me, 1, 0, 0.05, [wall]);
    me.wantClimb = false;
    const heldHeight = me.climbH;
    for (let i = 0; i < 10; i++) moveWizard(me, 0, 0, 0.05, [wall]);
    expect(me.climbH).toBeCloseTo(heldHeight);
    expect(me.climbState).toBe('wall');

    me.climbDown = true;
    moveWizard(me, -1, 0, 0.05, [wall]);
    expect(me.climbH).toBeLessThan(heldHeight);
    expect(me.climbState).toBe('wall');

    const wallX = me.x;
    me.climbJumpOff = true;
    moveWizard(me, -1, 0, 0.05, [wall]);
    expect(me.climbState).toBe(null);
    expect(me.climbOver).toBe(null);
    expect(me.climbH).toBe(0);
    expect(me.jumpH).toBeGreaterThan(0);
    expect(me.jumpV).toBeGreaterThan(0);
    expect(me.x).toBeLessThan(wallX);
  });

  it('ejects a wizard out of a house footprint', () => {
    const house = { kind: 'house', x: 0, y: 0, angle: 0, hw: 50, hd: 50, top: 200 };
    const [x, y] = resolveObstacles(0, 0, WIZARD.radius, [house]);
    const outX = Math.abs(x) >= house.hw + WIZARD.radius - 0.01;
    const outY = Math.abs(y) >= house.hd + WIZARD.radius - 0.01;
    expect(outX || outY).toBe(true); // shoved to (past) a wall
  });

  it('blocks bolts with solid scenery but lets them sail over short/soft props', () => {
    const tree = { kind: 'tree', x: 0, y: 0, r: 20, top: 300 };
    expect(boltHitsObstacle(0, 0, WAND.castHeight, WAND.radius, [tree])).toBe(true);
    expect(boltHitsObstacle(0, 0, 500, WAND.radius, [tree])).toBe(false); // above the treetop
    const bush = { kind: 'bush', x: 0, y: 0, r: 30, top: 40, soft: true };
    expect(boltHitsObstacle(0, 0, WAND.castHeight, WAND.radius, [bush])).toBe(false);
  });

  it('a wall eats a bolt before it reaches an enemy behind it', () => {
    const s = createState({ bots: 1 });
    const [a, b] = s.wizards;
    a.x = 0;
    a.y = 0;
    a.heading = 0;
    b.x = 200;
    b.y = 0;
    s.obstacles = [{ kind: 'house', x: 100, y: 0, angle: 0, hw: 30, hd: 30, top: 200 }];
    a.aimX = 200;
    a.aimY = 0;
    a.aimZ = WAND.castHeight;
    a.aimTargetId = b.id; // even a direct aim lock must not shoot through a wall
    castSpell(s, a);
    const before = b.health;
    for (let i = 0; i < 60; i++) stepSpells(s, 0.016);
    expect(b.health).toBe(before); // shot splashed on the wall
    expect(s.spells).toHaveLength(0);
  });
});

describe('storm', () => {
  it('damages wizards outside the safe circle, spares those inside', () => {
    const s = createState({ bots: 1 });
    s.storm.radius = 100;
    const [inside, outside] = s.wizards;
    inside.x = 0;
    inside.y = 0;
    outside.x = 500;
    outside.y = 0;
    const hIn = inside.health;
    const hOut = outside.health;
    applyStorm(s, 1);
    expect(inside.health).toBe(hIn);
    expect(outside.health).toBeCloseTo(hOut - STORM.dps);
  });
  it('shrinks only after the calm period', () => {
    const s = createState();
    update(s, [{}], 1); // still calm
    expect(s.storm.radius).toBe(STORM.startRadius);
    s.time = STORM.shrinkDelay + 1;
    update(s, [{}], 1);
    expect(s.storm.radius).toBeLessThan(STORM.startRadius);
  });
});

describe('eliminations + win', () => {
  it('records a placement when a wizard is knocked out', () => {
    const s = createState({ bots: 3 }); // 4 wizards
    s.wizards[2].health = 0;
    checkEliminations(s);
    expect(s.wizards[2].alive).toBe(false);
    expect(s.wizards[2].placement).toBe(4); // last of four to fall so far
  });
  it('ends as a player victory when only the player survives', () => {
    const s = createState({ bots: 2 });
    s.wizards[1].alive = false;
    s.wizards[2].alive = false;
    checkWin(s);
    expect(s.over).toBe(true);
    expect(s.playerWon).toBe(true);
    expect(s.winnerId).toBe(s.wizards[0].id);
    expect(s.wizards[0].placement).toBe(1);
  });
  it('does not end while two or more survive', () => {
    const s = createState({ bots: 3 });
    checkWin(s);
    expect(s.over).toBe(false);
  });
});

describe('AI', () => {
  it('nearestOpponent finds the closest living rival', () => {
    const s = createState({ bots: 2 });
    const me = s.wizards[0];
    s.wizards[1].x = me.x + 40;
    s.wizards[1].y = me.y;
    s.wizards[2].x = me.x + 400;
    s.wizards[2].y = me.y;
    expect(nearestOpponent(s, me)).toBe(s.wizards[1]);
  });
  it('a bot near the storm edge steers back toward the center', () => {
    const s = createState({ bots: 1 });
    s.obstacles = []; // isolate the storm-steering behavior
    s.storm.radius = 200;
    const bot = s.wizards[1];
    bot.x = 195; // just inside the edge, to the right of center
    bot.y = 0;
    s.wizards[0].x = 600; // target is out past the edge
    s.wizards[0].y = 0;
    const move = aiWizard(s, bot);
    expect(move.dx).toBeLessThan(0); // pulled back toward center (leftward)
  });

  it('keeps its target unless another rival is clearly closer (no flip-flop)', () => {
    const s = createState({ bots: 2 }); // player + 2 bots
    s.obstacles = [];
    const bot = s.wizards[1];
    bot.x = 0;
    bot.y = 0;
    const t1 = s.wizards[0];
    const t2 = s.wizards[2];
    t1.x = 100;
    t1.y = 0;
    t2.x = 110;
    t2.y = 0;
    aiWizard(s, bot);
    expect(bot.targetId).toBe(t1.id); // locks onto the nearest
    t1.x = 105; // t2 now marginally closer, but within the 1.3x stick margin
    t2.x = 100;
    aiWizard(s, bot);
    expect(bot.targetId).toBe(t1.id); // holds instead of twitching to t2
    t2.x = 40; // now clearly closer
    aiWizard(s, bot);
    expect(bot.targetId).toBe(t2.id); // commits to the new one
  });

  it('line of sight is blocked by a wall but clear to the side', () => {
    const wall = [{ kind: 'house', x: 100, y: 0, angle: 0, hw: 30, hd: 30, top: 200 }];
    expect(hasLineOfSight(0, 0, 200, 0, wall)).toBe(false); // straight through it
    expect(hasLineOfSight(0, 0, 0, 200, wall)).toBe(true); // off to the side
  });

  it('a bot holds fire when a wall blocks its shot, but fires in the open', () => {
    const make = (obstacles) => {
      const s = createState({ bots: 1 });
      const [me, bot] = s.wizards;
      s.time = BOT_ENGAGE_DELAY + 1;
      s.storm.radius = STORM.startRadius;
      bot.x = 0;
      bot.y = 0;
      bot.cooldowns.bolt = 0;
      me.x = 200;
      me.y = 0;
      s.obstacles = obstacles;
      return aiWizard(s, bot);
    };
    expect(make([{ kind: 'house', x: 100, y: 0, angle: 0, hw: 30, hd: 30, top: 200 }]).cast).toBe(
      false,
    );
    expect(make([]).cast).toBe(true);
  });

  it('steering bends a head-on path around scenery', () => {
    const tree = [{ kind: 'tree', x: 40, y: 0, r: 30, top: 400 }];
    const out = steerAroundObstacles(0, 0, 1, 0, tree); // walking straight at it
    expect(Math.abs(out.y)).toBeGreaterThan(0.1); // veered off the collision course
    const clear = steerAroundObstacles(0, 0, 1, 0, []);
    expect(clear).toEqual({ x: 1, y: 0 }); // nothing nearby -> unchanged
  });
});

describe('update', () => {
  it('moves the player wizard and faces the aim point', () => {
    const s = createState();
    const p = s.wizards[0];
    p.x = 0;
    p.y = 0;
    update(s, [{ dx: 1, dy: 0, aimX: 100, aimY: 0, cast: false }], 0.1);
    expect(p.x).toBeGreaterThan(0);
    expect(p.heading).toBeCloseTo(0); // facing +x toward the aim
  });
  it('casting through update spawns a bolt', () => {
    const s = createState({ bots: 1 });
    s.obstacles = []; // clear scenery so the bolt isn't absorbed by a wall point-blank
    s.wizards[0].x = 0;
    s.wizards[0].y = 0;
    update(s, [{ dx: 0, dy: 0, aimX: 999, aimY: 0, cast: true }], 0.016);
    expect(s.spells.length).toBeGreaterThanOrEqual(1);
  });
  it('casts from the same position used by the camera before movement', () => {
    const s = createState({ bots: 1 });
    s.obstacles = [];
    const p = s.wizards[0];
    p.x = 0;
    p.y = 0;
    p.heading = 0;
    update(
      s,
      [{ dx: 1, dy: 0, yaw: 0, aimX: 1000, aimY: 0, aimZ: WAND.castHeight, cast: true }],
      0.1,
    );
    expect(p.x).toBeGreaterThan(0); // movement still happened this frame
    expect(s.spells[0].originX).toBeCloseTo(WIZARD.radius + 8); // old camera/muzzle position
    expect(s.spells[0].originY).toBeCloseTo(0);
  });
  it('does nothing once the match is over', () => {
    const s = createState({ bots: 1 });
    s.over = true;
    const snap = JSON.stringify(s.wizards);
    update(s, [{ dx: 1, dy: 1, cast: true }], 0.2);
    expect(JSON.stringify(s.wizards)).toBe(snap);
  });
  it('tracks how many wizards remain', () => {
    const s = createState({ bots: 4 });
    expect(aliveCount(s)).toBe(5);
    s.wizards[1].alive = false;
    expect(aliveCount(s)).toBe(4);
  });

  it('bots hold fire during the opening grace, then cast', () => {
    const s = createState({ bots: 1 });
    const [me, bot] = s.wizards;
    addAttackToInventory(bot, 'apprentice-bolt');
    equipAttack(bot, 'apprentice-bolt', 0); // bots must find/equip attacks too
    fillAttackAmmunition(bot, 'apprentice-bolt');
    const place = () => {
      me.x = 0;
      me.y = 0;
      bot.x = 150; // well within cast range, both deep inside the storm
      bot.y = 0;
      bot.cooldowns['attack:apprentice-bolt'] = 0;
    };
    place();
    const startingMana = attackAmmunition(bot, 'apprentice-bolt');
    update(s, [{ dx: 0, dy: 0, cast: false }], 0.1); // t ~ 0.1s, within grace
    expect(attackAmmunition(bot, 'apprentice-bolt')).toBe(startingMana); // held fire

    s.time = BOT_ENGAGE_DELAY + 1; // grace over
    place();
    update(s, [{ dx: 0, dy: 0, cast: false }], 0.016);
    expect(attackAmmunition(bot, 'apprentice-bolt')).toBeLessThan(startingMana);
    expect(bot.cooldowns['attack:apprentice-bolt']).toBe(0);
  });
});
