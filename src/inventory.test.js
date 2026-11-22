import { describe, expect, it } from 'vitest';
import { INVENTORY_SLOT_COUNT } from './items.js';
import {
  ATTACKS,
  BASE_WEAPONS,
  MANA_AMMUNITION,
  createState,
  collectGroundItem,
  collectNearbyMana,
  dropInventoryItem,
  dropEliminatedInventory,
  equipAttack,
  castAttack,
  isSafeLootSpawnPoint,
  terrainHeight,
} from './game.js';

function match(players = 1) {
  const state = createState({ players, bots: 0, lootSeed: 8123 });
  const point = state.attackPickups[0];
  for (const wizard of state.wizards) {
    wizard.x = point.x;
    wizard.y = point.y;
  }
  state.attackPickups = [];
  return state;
}

function ground(state, fields = {}) {
  const wizard = state.wizards[0];
  const pickup = {
    id: `test-${state.attackPickups.length}`,
    lootType: 'attack',
    attackId: 'apprentice-bolt',
    rarity: 'common',
    quantity: 1,
    x: wizard.x,
    y: wizard.y,
    collectedBy: null,
    ...fields,
  };
  state.attackPickups.push(pickup);
  return pickup;
}

describe('single six-slot hotbar', () => {
  it('picks up an attack into the first free slot and equips it', () => {
    const state = match();
    const pickup = ground(state);
    expect(collectGroundItem(state, state.wizards[0], pickup.id)).toBe(true);
    expect(state.wizards[0].inventorySlots[0].attackId).toBe('apprentice-bolt');
    expect(state.wizards[0].attackSlots[0]).toBe('apprentice-bolt');
    expect(state.wizards[0].inventorySlots).toHaveLength(6);
    expect(state.events.at(-1)).toMatchObject({
      type: 'inventory-pickup',
      groundId: pickup.id,
      wizardId: state.wizards[0].id,
    });
    expect(collectGroundItem(state, state.wizards[0], pickup.id)).toBe(false);
  });

  it('puts an attack in the same slot as its carried scroll and clears it when dropped', () => {
    const state = match();
    const wizard = state.wizards[0];
    wizard.inventorySlots[0] = {
      lootType: 'rune-key',
      itemId: 'rune-key',
      rarity: 'common',
      quantity: 1,
    };
    const pickup = ground(state);
    expect(collectGroundItem(state, wizard, pickup.id)).toBe(true);
    expect(wizard.inventorySlots[1].attackId).toBe('apprentice-bolt');
    expect(wizard.attackSlots[1]).toBe('apprentice-bolt');
    expect(wizard.attackSlots[0]).toBeNull();
    expect(dropInventoryItem(state, wizard, 1)).toBeTruthy();
    expect(wizard.attackSlots[1]).toBeNull();
  });

  it('swaps only the selected item when all slots are occupied', () => {
    const state = match();
    const wizard = state.wizards[0];
    wizard.inventorySlots = Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index) => ({
      lootType: 'attack',
      attackId: 'apprentice-bolt',
      rarity: 'rare',
      quantity: 1,
      remainingUses: index + 1,
    }));
    wizard.selectedInventorySlot = 2;
    const replacement = Object.values(ATTACKS).find(
      (attack) => attack.scope === 'universal' && attack.id !== 'apprentice-bolt',
    ).id;
    const pickup = ground(state, { attackId: replacement, rarity: 'epic' });
    expect(collectGroundItem(state, wizard, pickup.id)).toBe(false);
    expect(collectGroundItem(state, wizard, pickup.id, 'swap')).toBe(true);
    expect(wizard.inventorySlots[2].attackId).toBe(replacement);
    const dropped = state.attackPickups.find((item) => item.droppedBy === wizard.id);
    expect(dropped).toMatchObject({
      attackId: 'apprentice-bolt',
      rarity: 'rare',
      remainingUses: 3,
      quantity: 1,
    });
    expect(collectGroundItem(state, wizard, dropped.id)).toBe(false);
  });

  it('lets another player immediately collect a dropped item while delaying its owner', () => {
    const state = match(2);
    const [owner, other] = state.wizards;
    const pickup = ground(state);
    expect(collectGroundItem(state, owner, pickup.id)).toBe(true);
    const dropped = dropInventoryItem(state, owner, 0);
    expect(dropped).toBeTruthy();
    expect(collectGroundItem(state, owner, dropped.id)).toBe(false);
    other.x = dropped.x;
    other.y = dropped.y;
    expect(collectGroundItem(state, other, dropped.id)).toBe(true);
    expect(other.inventorySlots[0].attackId).toBe('apprentice-bolt');
  });

  it('allows only one claimant for a ground ID', () => {
    const state = match(2);
    const pickup = ground(state);
    expect(collectGroundItem(state, state.wizards[0], pickup.id)).toBe(true);
    expect(collectGroundItem(state, state.wizards[1], pickup.id)).toBe(false);
    expect(state.wizards[1].inventorySlots.every((slot) => slot == null)).toBe(true);
  });

  it('carries an incompatible Tier Scroll without equipping or casting it', () => {
    const state = match();
    const wizard = state.wizards[0];
    const attackId = Object.values(ATTACKS).find(
      (attack) => attack.scope === 'tier' && attack.weaponId !== wizard.baseWeaponId,
    ).id;
    const pickup = ground(state, { lootType: 'tier-scroll', attackId });
    expect(collectGroundItem(state, wizard, pickup.id)).toBe(true);
    expect(wizard.inventorySlots[0].attackId).toBe(attackId);
    expect(equipAttack(wizard, attackId)).toBe(false);
    expect(castAttack(state, wizard, attackId)).toBe(false);
  });

  it('upgrades only with a stronger rune and keeps weaker runes as items', () => {
    const state = match();
    const wizard = state.wizards[0];
    const strong = ground(state, {
      lootType: 'weapon-upgrade-rune',
      attackId: null,
      rarity: 'epic',
    });
    expect(collectGroundItem(state, wizard, strong.id, 'upgrade')).toBe(true);
    expect(wizard.baseWeaponRarity).toBe('epic');
    const weak = ground(state, {
      id: 'weak',
      lootType: 'weapon-upgrade-rune',
      attackId: null,
      rarity: 'rare',
    });
    expect(collectGroundItem(state, wizard, weak.id, 'upgrade')).toBe(false);
    expect(collectGroundItem(state, wizard, weak.id)).toBe(true);
    expect(wizard.inventorySlots[0].rarity).toBe('rare');
    expect(wizard.baseWeaponRarity).toBe('epic');
  });

  it('stacks matching consumables without deleting overflow', () => {
    const state = match();
    const wizard = state.wizards[0];
    const consumable = Object.values(ATTACKS).find((attack) => attack.consumable);
    wizard.inventorySlots[0] = {
      lootType: 'attack',
      attackId: consumable.id,
      rarity: 'rare',
      quantity: 2,
      remainingUses: null,
      itemId: null,
    };
    for (let index = 1; index < INVENTORY_SLOT_COUNT; index++) {
      wizard.inventorySlots[index] = {
        lootType: 'rune-key',
        itemId: 'rune-key',
        rarity: 'common',
        quantity: 5,
      };
    }
    const pickup = ground(state, { attackId: consumable.id, rarity: 'rare', quantity: 4 });
    expect(collectGroundItem(state, wizard, pickup.id)).toBe(true);
    expect(wizard.inventorySlots[0].quantity).toBe(3);
    expect(pickup.quantity).toBe(3);
    expect(pickup.collectedBy).toBe(null);
  });

  it('automatically gathers mana outside inventory and drops half on elimination', () => {
    const state = match();
    const wizard = state.wizards[0];
    ground(state, { lootType: 'mana-ammunition', attackId: null, ammoType: 'burst', amount: 19 });
    collectNearbyMana(state, wizard);
    expect(wizard.manaPouch.burst).toBe(19);
    expect(wizard.inventorySlots.every((slot) => slot == null)).toBe(true);
    wizard.inventorySlots[0] = {
      lootType: 'rune-key',
      itemId: 'rune-key',
      rarity: 'rare',
      quantity: 2,
    };
    dropEliminatedInventory(state, wizard);
    expect(
      state.attackPickups.some((item) => item.itemId === 'rune-key' && item.quantity === 2),
    ).toBe(true);
    expect(state.attackPickups.some((item) => item.ammoType === 'burst' && item.amount === 9)).toBe(
      true,
    );
    expect(
      state.attackPickups.some((item) => Object.keys(BASE_WEAPONS).includes(item.itemId)),
    ).toBe(false);
    for (const item of state.attackPickups.filter((pickup) => pickup.droppedBy === wizard.id)) {
      expect(isSafeLootSpawnPoint(item.x, item.y, state.obstacles)).toBe(true);
      expect(item.groundHeight).toBeCloseTo(terrainHeight(item.x, item.y));
    }
    expect(wizard.manaPouch.burst).toBe(10);
    expect(MANA_AMMUNITION.burst.max).toBeGreaterThan(19);
  });
});
