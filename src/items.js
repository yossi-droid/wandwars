// Inventory item definitions are independent of the world and renderer so a
// future match server can use the same item rules as the local simulation.
// The carried inventory and the visible attack/item bar share six slots.
export const INVENTORY_SLOT_COUNT = 6;
export const ITEM_DEFINITIONS = Object.freeze({
  'rune-key': Object.freeze({ name: 'Rune Key', lootType: 'rune-key', maxStack: 5 }),
  'ward-totem': Object.freeze({ name: 'Ward Totem', lootType: 'deployable', maxStack: 3 }),
  'arcane-mine': Object.freeze({ name: 'Arcane Mine', lootType: 'deployable', maxStack: 3 }),
  'burrow-spell': Object.freeze({ name: 'Burrow Spell', lootType: 'digging-spell', maxStack: 1 }),
  'levitation-spell': Object.freeze({
    name: 'Levitation Spell',
    lootType: 'digging-spell',
    maxStack: 1,
  }),
});

export function stackLimit(item, attacks) {
  if (item.lootType === 'rune-key' || item.lootType === 'deployable') {
    return ITEM_DEFINITIONS[item.itemId]?.maxStack || 1;
  }
  if (item.lootType === 'attack' && attacks[item.attackId]?.consumable) return 3;
  return 1;
}

export function itemFromGround(pickup) {
  return {
    lootType: pickup.lootType,
    itemId: pickup.itemId || null,
    attackId: pickup.attackId || null,
    rarity: pickup.rarity || 'common',
    quantity: Math.max(1, Math.floor(pickup.quantity || 1)),
    remainingUses: pickup.remainingUses ?? null,
    data: pickup.data ? structuredClone(pickup.data) : null,
  };
}

export function canStackItems(a, b, attacks) {
  return (
    !!a &&
    !!b &&
    stackLimit(a, attacks) > 1 &&
    a.lootType === b.lootType &&
    a.itemId === b.itemId &&
    a.attackId === b.attackId &&
    a.rarity === b.rarity &&
    a.remainingUses === b.remainingUses
  );
}

export function itemName(item, attacks) {
  if (item.lootType === 'weapon-upgrade-rune') return 'Weapon Upgrade Rune';
  return attacks[item.attackId]?.name || ITEM_DEFINITIONS[item.itemId]?.name || 'Unknown Item';
}
