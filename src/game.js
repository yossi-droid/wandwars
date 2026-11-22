import {
  INVENTORY_SLOT_COUNT,
  ITEM_DEFINITIONS,
  canStackItems,
  itemFromGround,
  stackLimit,
} from './items.js';
import { createTerrain } from './terrain.js';
import { createTerrainSupport } from './terrainSupport.js';
import { createTerrainFluids } from './terrainFluids.js';
import { createWaterways, waterContact, setWaterContact, stepBuoyancy } from './waterPhysics.js';

// Pure, testable logic for a magic battle royale. NO browser code here (no
// `document`, `canvas`, or `window`) — just the rules, so they are easy to
// unit-test. `main.js` + `render3d.js` handle drawing, input, and sound.
//
// The world is a flat plane: wizards move on (x, y). 3D is only a way of drawing
// it, exactly like Bumper Brawl. Wizards fire spell bolts from a wand, a magic
// storm shrinks the safe zone over time, and the last wizard standing wins.

// ---- Tunable constants -----------------------------------------------------

// World scale: 1 unit = 10 cm, so 1 mile = 16,093 units. The playable area (the
// starting storm circle) is sized to exactly ONE SQUARE MILE:
//   area = 1 mi^2  ->  radius = 1mi / sqrt(pi) = 16093 / 1.7725 ~= 9080 units.
export const ARENA = { radius: 9300 }; // hard world boundary (a bit past the storm)

// The safe circle. Outside it you take damage; it shrinks to force fights.
// It starts as a full square-mile circle and closes over a long match.
export const STORM = {
  cx: 0,
  cy: 0,
  startRadius: 9080, // one square mile of playable area
  minRadius: 300,
  shrinkPerSec: 150, // world units of radius lost per second, once shrinking
  shrinkDelay: 12, // seconds of calm before the storm starts closing in
  dps: 11, // health lost per second while outside the safe circle
};

// Seconds at the start of a match before bots open fire. They still maneuver,
// but hold their spells so you get a moment to orient instead of being
// instantly focus-fired.
export const BOT_ENGAGE_DELAY = 3;

export const WIZARD = {
  radius: 16,
  speed: 220, // slower everyday walk used by players and bots
  runSpeed: 390, // player sprint while Shift is held
  maxHealth: 100,
};

export const STAMINA = {
  max: 6, // six full seconds of sprinting
  drainPerSec: 1,
  regenPerSec: 1, // empty-to-full recovery takes six seconds
  partialDelay: 1.5, // delay after stopping before stamina starts returning
  emptyDelay: 4, // longer delay after completely exhausting the bar
};

export const OPENING = {
  countdown: 3,
  chooseTime: 15,
  portalCount: 5,
  platformRadius: 520,
  portalRing: 430,
  portalOuterWidth: 336,
  portalRadius: 132,
  platformHeight: 2600,
  dropHeight: 1900,
  fallSpeed: 155,
  steerSpeed: 300,
};

export const PORTAL_DESTINATIONS = [
  // Five broad landing choices matching the supplied map: northwest wilderness,
  // the central castle, northeast farmland, southwest harbor, and southeast desert.
  {
    name: 'Enchanted Highlands',
    x: -4300,
    y: -4100,
    landingRadius: 1250,
    color: '#34d399',
  },
  { name: 'Crown Castle', x: -450, y: 500, landingRadius: 1100, color: '#c4b5fd' },
  { name: 'Harvest Village', x: 4300, y: -3200, landingRadius: 1300, color: '#fbbf24' },
  { name: 'Western Harbor', x: -5600, y: 3500, landingRadius: 1100, color: '#60a5fa' },
  { name: 'Sunken Desert', x: 4700, y: 4700, landingRadius: 1350, color: '#f59e0b' },
];

function createOpening(enabled) {
  return {
    phase: enabled ? 'countdown' : 'complete',
    timer: enabled ? OPENING.countdown : 0,
    elapsed: 0,
    portals: Array.from({ length: OPENING.portalCount }, (_, index) => {
      const angle = (index / OPENING.portalCount) * Math.PI * 2;
      return {
        index,
        angle,
        x: Math.cos(angle) * OPENING.portalRing,
        y: Math.sin(angle) * OPENING.portalRing,
        destination: index % PORTAL_DESTINATIONS.length,
        unstable: index % 4 === 2,
        nextShift: 2.4 + (index % 3) * 0.8,
      };
    }),
  };
}

export const JUMP = {
  velocity: 420, // initial upward speed
  gravity: 1050, // brings the wizard back down in about 0.8 seconds
};

// Climbing: run-jump into a surface while holding forward to grab it, then
// ascend at your own pace, mantle onto the top, and walk around up there.
export const CLIMB = {
  up: 260, // vertical climb speed on a wall (units/sec)
  side: 220, // sideways shimmy speed along the wall
  wallGap: 22, // extra body clearance so the robe/limbs stay outside the surface
  gravity: 950, // fall speed after stepping off a ledge
};

// Props are drawn on the highest terrain point beneath their footprint so a
// large cabin never has hills poking through its floor. Gameplay uses the same
// base height when placing a climber on its roof; otherwise the model could be
// several feet inside a roof on sloped ground.
export function obstacleGroundHeight(o) {
  if (o.kind !== 'house') return terrainHeight(o.x, o.y);
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  let highest = -Infinity;
  for (const lx of [-o.hw, 0, o.hw]) {
    for (const ly of [-o.hd, 0, o.hd]) {
      highest = Math.max(highest, terrainHeight(o.x + lx * c - ly * s, o.y + lx * s + ly * c));
    }
  }
  return highest;
}

// Free-flight (sandbox testing only): fly where you look, through scenery.
export const FLY = {
  speed: 850, // horizontal units/sec
  vspeed: 650, // vertical (ascend/descend) units/sec
};

// The Fire Stream: a single long streak of fire that travels really fast. One
// shot per cast (not a continuous stream), so each hit lands solid damage.
export const WAND = {
  cooldown: 0, // every attack can be cast again immediately
  speed: 6000, // near-instant at combat range, but still a visible projectile
  life: 2.1, // reaches every target visible to the center-camera aim trace
  radius: 10, // hit radius
  damage: 22, // solid per-shot damage
  castHeight: 28, // streaks leave the wand around chest height
};

// Match the visible model (including its head/hat) so a crosshair placed on the
// upper half of a distant wizard still counts as a real hit.
export const BODY_HEIGHT = 124;
export const PLAYER_BODY_HEIGHT = 168;

// The legacy spellbook has no cooldowns. Mana/consumable rules on collectible
// attacks are the only limits on repeated casting.
export const SPELLS = {
  bolt: { name: 'Fire Stream', type: 'projectile', cooldown: WAND.cooldown, color: '#fb923c' },
  slash: {
    name: 'Spell of Slashing',
    type: 'melee',
    cooldown: 0,
    damage: 26,
    range: 82, // reach in front of the wizard
    arc: Math.PI * 0.7, // width of the swing
    duration: 0.42, // seconds the (slower) diagonal slash takes to play out
    color: '#f0abfc',
  },
  heal: { name: 'Spell of Healing', type: 'self', cooldown: 0, heal: 40, color: '#4ade80' },
};
export const SPELL_ORDER = ['bolt', 'slash', 'heal'];

// ---- Base weapons + collectible attacks -----------------------------------
//
// A base weapon is a permanent casting focus chosen before the match. It never
// grants an attack by itself: attacks are separate pieces of loot. Universal
// attacks work with every focus; Tier attacks only equip on their named focus.
export const BASE_WEAPONS = Object.freeze({
  'apprentice-wand': {
    name: 'Apprentice Wand',
    description: 'A balanced, nimble focus that feels natural with every kind of magic.',
    color: '#67e8f9',
  },
  'focusing-crystal-staff': {
    name: 'Focusing Crystal Staff',
    description: 'A precise two-handed focus made for patient, accurate casting.',
    color: '#a78bfa',
  },
  'thunderclap-gauntlet': {
    name: 'Thunderclap Gauntlet',
    description: 'A close-range conduit that channels magic through the caster’s fist.',
    color: '#38bdf8',
  },
  'arcane-spellbook': {
    name: 'Arcane Spellbook',
    description: 'A scholarly focus for runes, wards, and carefully controlled spellwork.',
    color: '#c084fc',
  },
  'enchanted-bow': {
    name: 'Enchanted Bow',
    description: 'A graceful ranged focus that shapes found attacks into magical arrows.',
    color: '#4ade80',
  },
  'chaos-orb': {
    name: 'Chaos Orb',
    description: 'An unstable floating focus that crackles with unpredictable power.',
    color: '#e879f9',
  },
});
export const BASE_WEAPON_ORDER = Object.freeze(Object.keys(BASE_WEAPONS));

// Exactly 35 universal attacks. These are real gameplay definitions rather
// than aliases for the original three spells: every entry has its own timing,
// range, damage and special behaviour. Shared `kind` values are implementation
// building blocks (projectile, nova, trap, etc.), not duplicate attacks.
const UNIVERSAL_ATTACK_DEFS = [
  {
    id: 'focusing-crystal',
    name: 'Focusing Crystal',
    description: 'Charges and fires a powerful, accurate beam.',
    kind: 'beam',
    cooldown: 0,
    manaCost: 28,
    chargeTime: 1.05,
    damage: 68,
    range: 9000,
    width: 6,
    color: '#67e8f9',
  },
  {
    id: 'triple-bolt',
    name: 'Triple Bolt',
    description: 'Fires three magical bolts in a quick burst.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 18,
    damage: 15,
    speed: 4800,
    radius: 8,
    life: 2.2,
    count: 3,
    spread: 0.055,
    color: '#a78bfa',
  },
  {
    id: 'chaos-cube',
    name: 'Chaos Cube',
    description: 'Launches unpredictable magic with a random effect.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 18,
    damage: 24,
    speed: 2700,
    radius: 18,
    life: 3,
    randomEffect: true,
    color: '#d946ef',
  },
  {
    id: 'dagger-magic',
    name: 'Dagger Magic',
    description: 'Fires quick magical daggers that work best nearby.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 5,
    damage: 12,
    speed: 5200,
    radius: 7,
    life: 0.72,
    pierce: 1,
    color: '#e2e8f0',
  },
  {
    id: 'ricochet-spell',
    name: 'Ricochet Spell',
    description: 'Bounces between walls or enemies.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 16,
    damage: 23,
    speed: 3900,
    radius: 11,
    life: 4.2,
    bounces: 5,
    chain: 2,
    chainRange: 260,
    color: '#fbbf24',
  },
  {
    id: 'war-mage-barrage',
    name: 'War Mage Barrage',
    description: 'Continuously fires fast magical projectiles.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 5,
    damage: 7,
    speed: 5000,
    radius: 7,
    life: 1.8,
    trail: 46,
    color: '#fb7185',
  },
  {
    id: 'thunderclap',
    name: 'Thunderclap',
    description: 'A close shockwave that damages and pushes enemies.',
    kind: 'nova',
    cooldown: 0,
    manaCost: 20,
    damage: 28,
    range: 185,
    knockback: 330,
    color: '#38bdf8',
  },
  {
    id: 'dragon-breath',
    name: 'Dragon Breath',
    description: 'Blasts a wide stream of fire directly ahead.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 15,
    damage: 8,
    speed: 2100,
    radius: 13,
    life: 0.85,
    count: 9,
    spread: 0.52,
    burn: 6,
    statusTime: 3,
    color: '#f97316',
  },
  {
    id: 'apprentice-bolt',
    name: 'Apprentice Bolt',
    description: 'A simple, balanced projectile that is easy to use.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 8,
    damage: 24,
    speed: 4200,
    radius: 11,
    life: 2.4,
    color: '#818cf8',
  },
  {
    id: 'wasp-swarm',
    name: 'Wasp Swarm',
    description: 'Releases small magical wasps that chase an enemy.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 18,
    damage: 6,
    speed: 1800,
    radius: 6,
    life: 5,
    count: 7,
    spread: 0.38,
    homing: 7,
    color: '#facc15',
  },
  {
    id: 'eagle-eye-shot',
    name: 'Eagle-Eye Shot',
    description: 'Fires a highly accurate long-range attack.',
    kind: 'beam',
    cooldown: 0,
    manaCost: 26,
    damage: 52,
    range: 10000,
    width: 4,
    color: '#fde68a',
  },
  {
    id: 'shifting-spell',
    name: 'Shifting Spell',
    description: 'Changes between different attack forms every cast.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 16,
    damage: 26,
    speed: 3200,
    radius: 14,
    life: 2.8,
    shifting: true,
    color: '#c084fc',
  },
  {
    id: 'enchanted-gargoyle',
    name: 'Enchanted Gargoyle',
    description: 'Summons a gargoyle that hunts nearby enemies.',
    kind: 'summon',
    cooldown: 0,
    manaCost: 32,
    damage: 14,
    speed: 950,
    radius: 20,
    life: 10,
    homing: 8,
    pierce: 8,
    color: '#94a3b8',
  },
  {
    id: 'grappling-vine',
    name: 'Grappling Vine',
    description: 'Pulls you toward buildings, trees, or cliffs.',
    kind: 'grapple',
    cooldown: 0,
    manaCost: 18,
    range: 1100,
    speed: 5600,
    color: '#4ade80',
  },
  {
    id: 'void-kings-blast',
    name: 'Void King’s Blast',
    description: 'A huge void explosion that pulls enemies inward.',
    kind: 'nova',
    cooldown: 0,
    manaCost: 60,
    damage: 48,
    range: 330,
    pull: 420,
    color: '#6d28d9',
  },
  {
    id: 'werewolf-claws',
    name: 'Werewolf Claws',
    description: 'Fast close-range claws that temporarily increase speed.',
    kind: 'melee',
    cooldown: 0,
    manaCost: 40,
    damage: 22,
    range: 105,
    arc: 1.35,
    haste: 1.42,
    statusTime: 5,
    color: '#d1d5db',
  },
  {
    id: 'giants-focusing-beam',
    name: 'Giant’s Focusing Beam',
    description: 'Charges a massive beam that deals heavy damage.',
    kind: 'beam',
    cooldown: 0,
    manaCost: 60,
    chargeTime: 1.7,
    damage: 105,
    range: 7600,
    width: 24,
    pierce: 2,
    color: '#fef3c7',
  },
  {
    id: 'baba-yagas-curse',
    name: 'Baba Yaga’s Curse',
    description: 'Curses an enemy so their magic behaves strangely.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 45,
    damage: 12,
    speed: 3000,
    radius: 15,
    life: 3.2,
    homing: 3.5,
    curse: true,
    statusTime: 7,
    color: '#a855f7',
  },
  {
    id: 'storm-kings-lightning',
    name: 'Storm King’s Lightning',
    description: 'Calls down powerful lightning that chains through enemies.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 55,
    damage: 42,
    speed: 6500,
    radius: 10,
    life: 2.2,
    chain: 5,
    chainRange: 360,
    color: '#60a5fa',
  },
  {
    id: 'twin-moon-barrage',
    name: 'Twin Moon Barrage',
    description: 'Fires two streams of moon projectiles simultaneously.',
    kind: 'projectile',
    cooldown: 0,
    manaCost: 40,
    damage: 8,
    speed: 4600,
    radius: 8,
    life: 2.1,
    count: 2,
    spread: 0.08,
    color: '#bfdbfe',
  },
  {
    id: 'poison-mist',
    name: 'Poison Mist',
    description: 'Creates a poisonous cloud that damages anyone inside.',
    kind: 'summon',
    cooldown: 0,
    manaCost: 45,
    zoneType: 'poison',
    range: 190,
    life: 9,
    damagePerSecond: 8,
    poison: 3,
    statusTime: 2,
    color: '#84cc16',
  },
  {
    id: 'boots-of-endless-flight',
    name: 'Boots of Endless Flight',
    description: 'Allow controlled flight using limited magical energy.',
    kind: 'movement',
    cooldown: 0,
    manaCost: 25,
    flightTime: 8,
    launch: 180,
    color: '#7dd3fc',
  },
  {
    id: 'rocket-rune-boots',
    name: 'Rocket Rune Boots',
    description: 'Launch you forward and upward extremely quickly.',
    kind: 'movement',
    cooldown: 0,
    manaCost: 20,
    dash: 430,
    launch: 380,
    color: '#fb923c',
  },
  {
    id: 'thunder-stones',
    name: 'Thunder Stones',
    description: 'Throw you into the air with a lightning blast.',
    kind: 'movement',
    cooldown: 0,
    manaCost: 22,
    launch: 610,
    damage: 18,
    range: 145,
    knockback: 190,
    color: '#38bdf8',
  },
  {
    id: 'haste-orb',
    name: 'Haste Orb',
    description: 'Temporarily increases running speed.',
    kind: 'movement',
    cooldown: 0,
    manaCost: 15,
    haste: 1.65,
    statusTime: 7,
    color: '#2dd4bf',
  },
  {
    id: 'fairy-fizz',
    name: 'Fairy Fizz',
    description: 'Sprays nearby allies, restoring 50 protection over 5 seconds.',
    kind: 'summon',
    cooldown: 0,
    manaCost: 0,
    consumable: true,
    zoneType: 'fairy-fizz',
    range: 170,
    life: 5,
    shieldPerSecond: 10,
    friendlyOnly: true,
    color: '#f0abfc',
  },
  {
    id: 'golden-wizard-cake',
    name: 'Golden Wizard Cake',
    description: 'Restores lots of health and protection but takes time to eat.',
    kind: 'heal',
    cooldown: 0,
    manaCost: 0,
    consumable: true,
    channelTime: 5,
    heal: 50,
    shield: 50,
    color: '#fbbf24',
  },
  {
    id: 'healing-leaves',
    name: 'Healing Leaves',
    description: 'Quickly restore a small amount of health.',
    kind: 'heal',
    cooldown: 0,
    manaCost: 0,
    consumable: true,
    channelTime: 1.5,
    heal: 25,
    color: '#4ade80',
  },
  {
    id: 'restoration-potion',
    name: 'Restoration Potion',
    description: 'Gradually restores health after drinking it.',
    kind: 'heal',
    cooldown: 0,
    manaCost: 0,
    consumable: true,
    healOverTime: 75,
    duration: 10,
    stopsOnDamage: true,
    color: '#22c55e',
  },
  {
    id: 'small-protection-potion',
    name: 'Small Protection Potion',
    description: 'Gives a small amount of magical protection.',
    kind: 'shield',
    cooldown: 0,
    manaCost: 0,
    consumable: true,
    shield: 25,
    shieldCap: 50,
    color: '#22d3ee',
  },
  {
    id: 'greater-protection-potion',
    name: 'Great Protection Potion',
    description: 'Adds 50 protection and can fill protection to 100.',
    kind: 'shield',
    cooldown: 0,
    manaCost: 0,
    consumable: true,
    shield: 50,
    shieldCap: 100,
    color: '#0284c7',
  },
  {
    id: 'cauldron-of-restoration',
    name: 'Cauldron of Restoration',
    description: 'Heals and protects every player standing nearby.',
    kind: 'summon',
    cooldown: 0,
    manaCost: 0,
    consumable: true,
    zoneType: 'restoration',
    range: 210,
    life: 20,
    health: 140,
    healPerSecond: 5,
    shieldPerSecond: 5,
    friendlyOnly: true,
    color: '#10b981',
  },
  {
    id: 'portable-summoning-circle',
    name: 'Portable Summoning Circle',
    description: 'Creates temporary magical cover around the caster.',
    kind: 'summon',
    cooldown: 0,
    manaCost: 30,
    zoneType: 'cover',
    range: 150,
    life: 11,
    shieldPerSecond: 6,
    color: '#c084fc',
  },
  {
    id: 'empowerment-beacon',
    name: 'Empowerment Beacon',
    description: 'Strengthens the attacks of nearby players.',
    kind: 'summon',
    cooldown: 0,
    manaCost: 0,
    consumable: true,
    zoneType: 'empower',
    range: 230,
    life: 20,
    health: 110,
    empower: 1.2,
    friendlyOnly: true,
    color: '#f59e0b',
  },
  {
    id: 'rune-key',
    name: 'Rune Key',
    description: 'Unlocks special vaults containing rare attacks and items.',
    kind: 'utility',
    cooldown: 0,
    manaCost: 0,
    consumable: true,
    keyCount: 1,
    color: '#facc15',
  },
];

const TIER_ATTACK_DEFS = [
  {
    id: 'continuous-magic-beam',
    name: 'Continuous Magic Beam',
    description: 'A beam that fires continuously while held.',
    kind: 'beam',
    weaponId: 'apprentice-wand',
    tier: 1,
    cooldown: 0,
    manaPerSecond: 12,
    damage: 5,
    range: 1800,
    width: 12,
    color: '#67e8f9',
  },
  {
    id: 'grappling-spell',
    name: 'Grappling Spell',
    description: 'Pulls you quickly toward the impact point.',
    kind: 'grapple',
    weaponId: 'apprentice-wand',
    tier: 2,
    cooldown: 0,
    manaCost: 15,
    speed: 5200,
    range: 850,
    color: '#38bdf8',
  },
  {
    id: 'precision-burst-spell',
    name: 'Precision Burst',
    description: 'Three accurate high-speed shots.',
    kind: 'projectile',
    weaponId: 'focusing-crystal-staff',
    tier: 1,
    cooldown: 0,
    manaCost: 22,
    damage: 13,
    speed: 5200,
    radius: 8,
    life: 2.5,
    count: 3,
    spread: 0.025,
    color: '#fbbf24',
  },
  {
    id: 'rapid-fire-spell',
    name: 'Rapid-Fire Spell',
    description: 'Fast medium-range crystal fire.',
    kind: 'projectile',
    weaponId: 'focusing-crystal-staff',
    tier: 2,
    cooldown: 0,
    manaCost: 6,
    damage: 8,
    speed: 4300,
    radius: 8,
    life: 1.8,
    color: '#38bdf8',
  },
  {
    id: 'bouncing-magic-bomb',
    name: 'Bouncing Magic Bomb',
    description: 'Bounces twice, then explodes.',
    kind: 'projectile',
    weaponId: 'thunderclap-gauntlet',
    tier: 1,
    cooldown: 0,
    manaCost: 28,
    damage: 18,
    speed: 1700,
    radius: 22,
    life: 3.2,
    bounces: 2,
    gravity: 900,
    upward: 0.2,
    explosionRadius: 180,
    splashDamage: 34,
    color: '#facc15',
  },
  {
    id: 'repulsion-spell',
    name: 'Repulsion Spell',
    description: 'Blasts nearby enemies away from the gauntlet.',
    kind: 'nova',
    weaponId: 'thunderclap-gauntlet',
    tier: 2,
    cooldown: 0,
    manaCost: 18,
    damage: 18,
    range: 190,
    knockback: 520,
    color: '#38bdf8',
  },
  {
    id: 'close-range-blast',
    name: 'Close-Range Blast',
    description: 'Heavy damage in a tight cone ahead.',
    kind: 'melee',
    weaponId: 'arcane-spellbook',
    tier: 1,
    cooldown: 0,
    manaCost: 25,
    damage: 45,
    range: 115,
    arc: 1.05,
    knockback: 170,
    color: '#fb923c',
  },
  {
    id: 'accurate-magic-shot',
    name: 'Accurate Magic Shot',
    description: 'A reliable perfectly straight shot.',
    kind: 'projectile',
    weaponId: 'arcane-spellbook',
    tier: 2,
    cooldown: 0,
    manaCost: 8,
    damage: 29,
    speed: 6500,
    radius: 8,
    life: 2.2,
    color: '#38bdf8',
  },
  {
    id: 'long-range-beam',
    name: 'Long-Range Beam',
    description: 'A slow-firing powerful sniper beam.',
    kind: 'beam',
    weaponId: 'enchanted-bow',
    tier: 1,
    cooldown: 0,
    manaCost: 30,
    damage: 72,
    range: 9000,
    width: 7,
    color: '#fbbf24',
  },
  {
    id: 'twin-magic-shot',
    name: 'Twin Magic Shot',
    description: 'Fires two magic arrows side by side.',
    kind: 'projectile',
    weaponId: 'enchanted-bow',
    tier: 2,
    cooldown: 0,
    manaCost: 12,
    damage: 18,
    speed: 4400,
    radius: 9,
    life: 2.5,
    count: 2,
    spread: 0.045,
    color: '#22d3ee',
  },
  {
    id: 'explosive-spell',
    name: 'Explosive Spell',
    description: 'A slow shot with a huge explosion.',
    kind: 'projectile',
    weaponId: 'chaos-orb',
    tier: 1,
    cooldown: 0,
    manaCost: 35,
    damage: 28,
    speed: 1550,
    radius: 25,
    life: 4,
    explosionRadius: 240,
    splashDamage: 46,
    knockback: 260,
    color: '#f97316',
  },
  {
    id: 'magic-barrage',
    name: 'Magic Barrage',
    description: 'Nine fast, weaker chaos projectiles.',
    kind: 'projectile',
    weaponId: 'chaos-orb',
    tier: 2,
    cooldown: 0,
    manaPerProjectile: 5,
    damage: 7,
    speed: 3900,
    radius: 8,
    life: 2.2,
    count: 9,
    spread: 0.28,
    color: '#d946ef',
  },
];

export const UNIVERSAL_ATTACK_IDS = Object.freeze(UNIVERSAL_ATTACK_DEFS.map(({ id }) => id));
export const TIER_ATTACK_IDS = Object.freeze(TIER_ATTACK_DEFS.map(({ id }) => id));
// The universal list follows the player's numbered design: 1–14 are regular
// combat finds, 15–21 are Mythics, 22–25 are movement, 26–32 are
// healing/protection, and 33–35 are special utility items.
export const REGULAR_UNIVERSAL_ATTACK_IDS = Object.freeze(UNIVERSAL_ATTACK_IDS.slice(0, 14));
export const MYTHIC_ATTACK_IDS = Object.freeze(UNIVERSAL_ATTACK_IDS.slice(14, 21));
export const MOVEMENT_ATTACK_IDS = Object.freeze(UNIVERSAL_ATTACK_IDS.slice(21, 25));
export const HEALING_PROTECTION_ATTACK_IDS = Object.freeze(UNIVERSAL_ATTACK_IDS.slice(25, 32));
export const SPECIAL_ATTACK_IDS = Object.freeze(UNIVERSAL_ATTACK_IDS.slice(32, 35));
export const WEAPON_UPGRADE_RUNE_ID = 'weapon-upgrade-rune';
export const TIER_MANA = Object.freeze({
  max: 100,
  starting: 0,
  firstPickup: 60,
  extraPickup: 35,
});
export const MANA_AMMUNITION = Object.freeze({
  catalyst: Object.freeze({ name: 'Catalyst Shards', max: 500, pickup: 60, color: '#e2e8f0' }),
  elemental: Object.freeze({ name: 'Elemental Essences', max: 400, pickup: 45, color: '#fb923c' }),
  burst: Object.freeze({ name: 'Burst Runes', max: 120, pickup: 18, color: '#facc15' }),
  cosmic: Object.freeze({ name: 'Cosmic Orbs', max: 30, pickup: 5, color: '#a78bfa' }),
  calamity: Object.freeze({ name: 'Calamity Cores', max: 6, pickup: 1, color: '#ef4444' }),
});
export const MANA_AMMUNITION_ORDER = Object.freeze(Object.keys(MANA_AMMUNITION));

const ATTACK_AMMO_OVERRIDES = Object.freeze({
  'focusing-crystal': 'cosmic',
  'eagle-eye-shot': 'cosmic',
  'giants-focusing-beam': 'cosmic',
  'storm-kings-lightning': 'cosmic',
  'void-kings-blast': 'calamity',
  'enchanted-gargoyle': 'calamity',
  'poison-mist': 'calamity',
  'portable-summoning-circle': 'calamity',
  'cauldron-of-restoration': null,
  'empowerment-beacon': null,
  thunderclap: 'burst',
  'werewolf-claws': 'burst',
  'thunder-stones': 'burst',
  'continuous-magic-beam': 'catalyst',
  'grappling-spell': 'elemental',
  'precision-burst-spell': 'cosmic',
  'rapid-fire-spell': 'catalyst',
  'bouncing-magic-bomb': 'elemental',
  'repulsion-spell': 'burst',
  'close-range-blast': 'burst',
  'accurate-magic-shot': 'catalyst',
  'long-range-beam': 'cosmic',
  'twin-magic-shot': 'catalyst',
  'explosive-spell': 'calamity',
  'magic-barrage': 'catalyst',
});

function manaAmmunitionForAttack(attack) {
  if (
    attack.consumable ||
    ((attack.manaCost || 0) === 0 && !attack.manaPerSecond && !attack.manaPerProjectile)
  )
    return null;
  if (Object.prototype.hasOwnProperty.call(ATTACK_AMMO_OVERRIDES, attack.id)) {
    return ATTACK_AMMO_OVERRIDES[attack.id];
  }
  if (attack.kind === 'projectile' || attack.kind === 'beam') return 'elemental';
  if (attack.kind === 'melee' || attack.kind === 'nova') return 'burst';
  if (attack.kind === 'summon') return 'calamity';
  return 'elemental';
}
// The simulation casts held attacks once per fixed gameplay step. This is not
// a cooldown: players can cast on every step. It only converts mana-per-second
// attacks into the correct amount of mana for one step.
export const ATTACK_CAST_STEP = 0.05;
export const ATTACKS = Object.freeze(
  Object.fromEntries([
    ...UNIVERSAL_ATTACK_DEFS.map((attack) => [
      attack.id,
      {
        ...attack,
        ammoType: manaAmmunitionForAttack(attack),
        cooldown: 0,
        spellId: attack.kind === 'heal' ? 'heal' : attack.kind === 'melee' ? 'slash' : 'bolt',
        scope: 'universal',
      },
    ]),
    ...TIER_ATTACK_DEFS.map((attack) => [
      attack.id,
      {
        ...attack,
        ammoType: manaAmmunitionForAttack(attack),
        cooldown: 0,
        spellId: attack.kind === 'heal' ? 'heal' : attack.kind === 'melee' ? 'slash' : 'bolt',
        scope: 'tier',
      },
    ]),
  ]),
);
export const ATTACK_SLOT_COUNT = 6;
export const ATTACK_PICKUP_RADIUS = 72;

// Exact per-spawn category chances. Tier 1 and Tier 2 use their overall
// chances here so one random roll covers the full 100% table without rounding.
export const LOOT_CATEGORY_CHANCES = Object.freeze({
  regular: 0.52,
  healingProtection: 0.17,
  movement: 0.1,
  special: 0.08,
  tier1: 0.035,
  tier2: 0.065,
  mythic: 0.03,
});

export function rollLootCategory(rng = Math.random) {
  const roll = rng();
  if (roll < 0.52) return 'regular';
  if (roll < 0.69) return 'healing-protection';
  if (roll < 0.79) return 'movement';
  if (roll < 0.87) return 'special';
  if (roll < 0.905) return 'tier-1';
  if (roll < 0.97) return 'tier-2';
  return 'mythic';
}

// Each weapon owns exactly one attack at each Tier. Dividing [0, 1) into six
// equal ranges gives every locked base weapon exactly the same spawn chance.
export function rollTierAttackId(tier, rng = Math.random) {
  const weaponIndex = Math.min(
    BASE_WEAPON_ORDER.length - 1,
    Math.floor(rng() * BASE_WEAPON_ORDER.length),
  );
  const weaponId = BASE_WEAPON_ORDER[weaponIndex];
  return (
    TIER_ATTACK_IDS.find((id) => {
      const attack = ATTACKS[id];
      return attack.weaponId === weaponId && attack.tier === tier;
    }) || null
  );
}

// Loot rarity is rolled independently for every active pickup. Common is the
// baseline used by every base weapon and by legacy/test attacks without an
// explicit rarity. The chances add to exactly 100%.
export const LOOT_RARITIES = Object.freeze({
  common: {
    name: 'Common',
    color: '#9ca3af',
    chance: 0.5,
    damage: 1,
    projectileSpeed: 1,
    energyUse: 1,
    cooldown: 0,
  },
  rare: {
    name: 'Rare',
    color: '#22c55e',
    chance: 0.25,
    damage: 1.05,
    projectileSpeed: 1,
    energyUse: 1,
    cooldown: 0,
  },
  'super-rare': {
    name: 'Super Rare',
    color: '#3b82f6',
    chance: 0.15,
    damage: 1.1,
    projectileSpeed: 1.08,
    energyUse: 1,
    cooldown: 0,
  },
  epic: {
    name: 'Epic',
    color: '#a855f7',
    chance: 0.08,
    damage: 1.15,
    projectileSpeed: 1,
    energyUse: 0.9,
    cooldown: 0,
  },
  legendary: {
    name: 'Legendary',
    color: '#f59e0b',
    chance: 0.02,
    damage: 1.2,
    projectileSpeed: 1,
    energyUse: 0.8,
    cooldown: 0,
  },
  mythic: {
    name: 'Mythic',
    color: '#f04b22',
    chance: 0,
    damage: 1.3,
    projectileSpeed: 1.1,
    energyUse: 0.8,
    cooldown: 0,
  },
});
export const LOOT_RARITY_ORDER = Object.freeze([
  'common',
  'rare',
  'super-rare',
  'epic',
  'legendary',
]);

export function rollLootRarity(rng = Math.random) {
  const roll = rng();
  let cumulative = 0;
  for (const id of LOOT_RARITY_ORDER) {
    cumulative += LOOT_RARITIES[id].chance;
    if (roll < cumulative) return id;
  }
  return 'legendary';
}

export function createManaPouch() {
  return Object.fromEntries(MANA_AMMUNITION_ORDER.map((id) => [id, 0]));
}

export function addManaAmmunition(wizard, ammoType, amount) {
  const definition = MANA_AMMUNITION[ammoType];
  if (!wizard || !definition || amount <= 0) return 0;
  wizard.manaPouch ||= createManaPouch();
  const before = wizard.manaPouch[ammoType] || 0;
  wizard.manaPouch[ammoType] = Math.min(definition.max, before + amount);
  return wizard.manaPouch[ammoType] - before;
}

export function manaAmmunitionAmount(wizard, attackId) {
  const ammoType = ATTACKS[attackId]?.ammoType;
  return ammoType ? wizard?.manaPouch?.[ammoType] || 0 : Infinity;
}

function spendManaAmmunition(wizard, attackId, amount) {
  const ammoType = ATTACKS[attackId]?.ammoType;
  if (!ammoType || amount <= 0) return true;
  wizard.manaPouch ||= createManaPouch();
  if ((wizard.manaPouch[ammoType] || 0) + 1e-9 < amount) return false;
  wizard.manaPouch[ammoType] = Math.max(0, wizard.manaPouch[ammoType] - amount);
  return true;
}

export function attackRarityForWizard(wizard, attackId) {
  const attackRarity = LOOT_RARITIES[wizard?.attackRarities?.[attackId]]
    ? wizard.attackRarities[attackId]
    : 'common';
  const weaponRarity = LOOT_RARITIES[wizard?.baseWeaponRarity] ? wizard.baseWeaponRarity : 'common';
  if (attackRarity === 'mythic') return attackRarity;
  return LOOT_RARITY_ORDER.indexOf(weaponRarity) > LOOT_RARITY_ORDER.indexOf(attackRarity)
    ? weaponRarity
    : attackRarity;
}

// A rune can only raise the locked base weapon to its own higher rarity.
export function upgradeBaseWeaponRarity(wizard, runeRarity = 'common') {
  if (!wizard) return null;
  const current = LOOT_RARITIES[wizard.baseWeaponRarity] ? wizard.baseWeaponRarity : 'common';
  const currentRank = LOOT_RARITY_ORDER.indexOf(current);
  const runeRank = LOOT_RARITY_ORDER.indexOf(runeRarity);
  if (runeRank > currentRank) wizard.baseWeaponRarity = runeRarity;
  return wizard.baseWeaponRarity;
}

export function effectiveAttackForWizard(wizard, attackId) {
  const attack = ATTACKS[attackId];
  if (!attack) return null;
  const rarityId = attackRarityForWizard(wizard, attackId);
  const rarity = LOOT_RARITIES[rarityId];
  const scaled = { ...attack, rarity: rarityId, rarityColor: rarity.color };
  for (const key of ['damage', 'splashDamage', 'damagePerSecond', 'burn', 'poison']) {
    if (typeof scaled[key] === 'number') scaled[key] *= rarity.damage;
  }
  if (typeof scaled.speed === 'number') scaled.speed *= rarity.projectileSpeed;
  scaled.cooldown = 0;
  let manaCost = scaled.manaCost;
  if (typeof scaled.manaPerSecond === 'number') {
    manaCost = scaled.manaPerSecond * ATTACK_CAST_STEP;
  } else if (typeof scaled.manaPerProjectile === 'number') {
    manaCost = scaled.manaPerProjectile * (scaled.count || 1);
  }
  if (typeof manaCost === 'number') {
    scaled.manaCost = Math.max(0, Math.round(manaCost * rarity.energyUse * 100) / 100);
  }
  // Calamity Cores are rocket-like ammunition: one core powers one enormous cast.
  if (scaled.ammoType === 'calamity' && scaled.manaCost > 0) scaled.manaCost = 1;
  // Cosmic Orbs are the heavy/sniper ammunition family. Their pouch only holds
  // 30, so a fully stocked pouch must always be able to power even a Mythic
  // long-range cast whose old shared-mana price was 40–60.
  if (scaled.ammoType === 'cosmic' && scaled.manaCost > 0) {
    scaled.manaCost = Math.min(MANA_AMMUNITION.cosmic.max, scaled.manaCost);
  }
  return scaled;
}

export function isAttackCompatible(weaponOrWizard, attackId) {
  const attack = ATTACKS[attackId];
  const weaponId =
    typeof weaponOrWizard === 'string' ? weaponOrWizard : weaponOrWizard?.baseWeaponId;
  return !!attack && (attack.scope === 'universal' || attack.weaponId === weaponId);
}

export function addAttackToInventory(wizard, attackId, rarity = 'common') {
  if (!wizard || !ATTACKS[attackId]) return false;
  wizard.attackInventory ||= [];
  if (wizard.attackInventory.includes(attackId)) return false;
  if (
    ATTACKS[attackId].scope === 'tier' &&
    wizard.attackInventory.some((id) => ATTACKS[id]?.scope === 'tier')
  ) {
    return false;
  }
  wizard.attackInventory.push(attackId);
  wizard.attackRarities ||= {};
  wizard.attackRarities[attackId] = LOOT_RARITIES[rarity] ? rarity : 'common';
  if (ATTACKS[attackId].scope === 'tier') wizard.tierAttackId = attackId;
  return true;
}

export function equipAttack(wizard, attackId, slot = null) {
  if (!wizard || !wizard.attackInventory?.includes(attackId)) return false;
  if (!isAttackCompatible(wizard, attackId)) return false;
  wizard.attackSlots ||= Array(ATTACK_SLOT_COUNT).fill(null);
  let target = slot;
  if (!Number.isInteger(target)) target = wizard.attackSlots.findIndex((id) => id == null);
  if (target < 0 || target >= ATTACK_SLOT_COUNT) return false;
  for (let index = 0; index < wizard.attackSlots.length; index++) {
    if (wizard.attackSlots[index] === attackId) wizard.attackSlots[index] = null;
  }
  wizard.attackSlots[target] = attackId;
  return true;
}

export function transferAttack(fromWizard, toWizard, attackId) {
  if (!fromWizard?.attackInventory?.includes(attackId) || !toWizard || !ATTACKS[attackId]) {
    return false;
  }
  const attack = ATTACKS[attackId];
  const transferredRarity = attackRarityForWizard(fromWizard, attackId);
  let receivedAttackId = attackId;
  if (attack.scope === 'tier') {
    receivedAttackId = tierAttackForWizard(toWizard, attackId);
    if (!receivedAttackId) return false;
  }
  const existingTier = toWizard.attackInventory?.find((id) => ATTACKS[id]?.scope === 'tier');
  if (attack.scope !== 'tier' && toWizard.attackInventory?.includes(receivedAttackId)) return false;
  fromWizard.attackInventory = fromWizard.attackInventory.filter((id) => id !== attackId);
  if (fromWizard.attackRarities) delete fromWizard.attackRarities[attackId];
  if (fromWizard.attackSlots) {
    fromWizard.attackSlots = fromWizard.attackSlots.map((id) => (id === attackId ? null : id));
  }
  if (fromWizard.tierAttackId === attackId) fromWizard.tierAttackId = null;
  toWizard.attackInventory ||= [];
  if (attack.scope === 'tier' && existingTier) {
    const ammoType = ATTACKS[existingTier].ammoType;
    addManaAmmunition(toWizard, ammoType, MANA_AMMUNITION[ammoType]?.pickup || 0);
    return true;
  }
  toWizard.attackInventory.push(receivedAttackId);
  toWizard.attackRarities ||= {};
  toWizard.attackRarities[receivedAttackId] = transferredRarity;
  if (attack.scope === 'tier') {
    toWizard.tierAttackId = receivedAttackId;
    const ammoType = ATTACKS[receivedAttackId].ammoType;
    addManaAmmunition(toWizard, ammoType, MANA_AMMUNITION[ammoType]?.pickup || 0);
  }
  return true;
}

export function changeBaseWeapon(wizard, nextWeaponId) {
  if (!wizard || wizard.weaponLocked || !BASE_WEAPONS[nextWeaponId]) return false;
  wizard.baseWeaponId = nextWeaponId;
  return true;
}

// Distinct wizard colors. Index 0 is player 1, index 1 is player 2.
export const COLORS = [
  '#38bdf8',
  '#f472b6',
  '#f43f5e',
  '#facc15',
  '#4ade80',
  '#c084fc',
  '#fb923c',
  '#2dd4bf',
  '#a3e635',
  '#e879f9',
  '#60a5fa',
  '#fca5a5',
];

// ---- Small math helpers ----------------------------------------------------

export function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

export function normalize(x, y) {
  const len = Math.hypot(x, y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

// Wrap an angle into [-PI, PI] so two headings can be compared.
export function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Kept for saved-state/test compatibility; every timer permanently stays zero.
export function freshCooldowns() {
  const cd = {};
  for (const id of SPELL_ORDER) cd[id] = 0;
  return cd;
}

// ---- Obstacles (trees, houses, rocks) --------------------------------------
// Solid scenery you can't walk or shoot through. Generated with a seeded PRNG so
// the exact same layout drives BOTH the physics here and the meshes in
// render3d.js. Trees/rocks are circle colliders; houses are oriented boxes.
// Bushes are included for the renderer but flagged soft (no collision).

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const OBSTACLE_SEED = 0x5eed13;

// The map is split into biome regions (nearest-centre wins), giving it the
// distinct zones of a fantasy map: a mountain massif, a forest, central
// grassland (the castle), farmland, a coastal village and a desert.
// Each special biome is a bounded blob with a radius; everything else is lush
// GRASSLAND (the default). This keeps the map mostly green with distinct
// pockets — a forest, a desert, a mountain, a coastal village, farmland — rather
// than the whole map being one biome.
const _A = ARENA.radius;
export const REGIONS = [
  { biome: 'mountain', x: -0.28 * _A, y: -0.62 * _A, r: 2850 },
  { biome: 'forest', x: -0.62 * _A, y: -0.25 * _A, r: 2850 },
  { biome: 'farm', x: 0.46 * _A, y: -0.34 * _A, r: 2450 },
  { biome: 'desert', x: 0.5 * _A, y: 0.5 * _A, r: 3000 },
  { biome: 'coast', x: -0.61 * _A, y: 0.37 * _A, r: 2550 },
];

// Major geography copied from the supplied fantasy-map composition. Negative Y
// is north/top of the map; the river begins below the northern mountains, bends
// past the west side of the central castle, and empties into the southwest bay.
export const RIVER_PATH = [
  [-900, -8500],
  [-520, -7100],
  [-760, -5750],
  [-1450, -4300],
  [-1320, -2850],
  [-850, -1500],
  [-650, -650],
  [-690, 720],
  [-1250, 1850],
  [-2250, 2850],
  [-3600, 3700],
  [-5050, 4300],
];
export const MAP_FEATURES = {
  pond: { x: 4300, y: -4300, r: 620 },
  bay: { x: -5900, y: 5000, r: 2550 },
  islet: { x: -6100, y: 6100, r: 680 },
  mine: { x: 5900, y: 900 },
};

export function riverDistance(x, y) {
  let best = Infinity;
  let segment = 0;
  let amount = 0;
  for (let i = 0; i < RIVER_PATH.length - 1; i++) {
    const a = RIVER_PATH[i];
    const b = RIVER_PATH[i + 1];
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy || 1;
    const t = clamp(((x - a[0]) * vx + (y - a[1]) * vy) / len2, 0, 1);
    const px = a[0] + vx * t;
    const py = a[1] + vy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best) {
      best = d;
      segment = i;
      amount = t;
    }
  }
  return { distance: best, segment, amount };
}
export function biomeAt(x, y) {
  let best = Infinity;
  let region = null;
  for (const rgn of REGIONS) {
    const dx = x - rgn.x;
    const dy = y - rgn.y;
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      region = rgn;
    }
  }
  if (region && best < region.r * region.r) return region.biome;
  return 'grass'; // the default that fills between the biome pockets
}

// Shared terrain height for both gameplay and rendering. Projectile collision
// must use the same hills the player sees; treating every wizard as if it stood
// at height zero made long-range shots miss on uneven ground.
function terrainSmooth(v, a, b) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
const HEIGHT_MTN = REGIONS.find((r) => r.biome === 'mountain');
const HEIGHT_DES = REGIONS.find((r) => r.biome === 'desert');
function landformHeight(x, y) {
  const r = Math.hypot(x, y);
  const A = ARENA.radius;
  // Several broad, rotated wave fields approximate low-frequency terrain noise.
  // Using different axes avoids the obvious egg-carton pattern produced by one
  // sin(x) * cos(y) layer while remaining deterministic and fast for raycasts.
  const hills =
    46 * Math.sin(x * 0.00125 + y * 0.00058 + 1.1) +
    34 * Math.sin(x * -0.00072 + y * 0.00158 - 0.6) +
    20 * Math.sin(x * 0.0029 + y * 0.0017 + 2.4) * Math.cos(y * 0.0021 - 0.8) +
    10 * Math.sin(x * 0.0071 - y * 0.0062 + 3.7);
  const relief = 0.35 + 0.65 * terrainSmooth(r, 700, 3800);
  let h = 150 + hills * relief;
  const md = Math.hypot(x - HEIGHT_MTN.x, y - HEIGHT_MTN.y);
  const mountainMask = 1 - terrainSmooth(md, 180, 2850);
  const ridge =
    0.68 +
    0.2 * (1 - Math.abs(Math.sin(x * 0.0017 + y * 0.0011))) +
    0.12 * Math.sin(x * 0.0043 - y * 0.0028);
  h += mountainMask * (760 + 520 * ridge);
  const dd = Math.hypot(x - HEIGHT_DES.x, y - HEIGHT_DES.y);
  h -= (1 - terrainSmooth(dd, 250, 2500)) * 70;
  // Twin rugged hills around the eastern mine entrances.
  for (const [mx, my, radius, height] of [
    [MAP_FEATURES.mine.x - 430, MAP_FEATURES.mine.y - 280, 1450, 470],
    [MAP_FEATURES.mine.x + 520, MAP_FEATURES.mine.y + 260, 1250, 390],
  ]) {
    const d = Math.hypot(x - mx, y - my);
    h += (1 - terrainSmooth(d, radius * 0.18, radius)) * height;
  }
  // Deep southwest bay and a raised wooded islet, mirroring the harbor and
  // offshore island in the reference map.
  const bayD = Math.hypot(x - MAP_FEATURES.bay.x, y - MAP_FEATURES.bay.y);
  h -= (1 - terrainSmooth(bayD, 450, MAP_FEATURES.bay.r)) * 420;
  const isletD = Math.hypot(x - MAP_FEATURES.islet.x, y - MAP_FEATURES.islet.y);
  h += (1 - terrainSmooth(isletD, 80, MAP_FEATURES.islet.r)) * 460;
  // Carve the winding river and a softer valley around it.
  const river = riverDistance(x, y).distance;
  h -= (1 - terrainSmooth(river, 75, 230)) * 78;
  h -= (1 - terrainSmooth(river, 170, 520)) * 34;
  // Northeast mill pond sits in a shallow natural bowl.
  const pondD = Math.hypot(x - MAP_FEATURES.pond.x, y - MAP_FEATURES.pond.y);
  h -= (1 - terrainSmooth(pondD, MAP_FEATURES.pond.r * 0.45, MAP_FEATURES.pond.r * 1.2)) * 58;
  // An irregular coastline: three broad bays/headlands alter where the terrain
  // falls through sea level, avoiding a visibly circular island silhouette.
  const angle = Math.atan2(y, x);
  const coastShape = 1 + 0.055 * Math.sin(angle * 3 + 0.4) + 0.035 * Math.sin(angle * 7 - 1.1);
  const coastStart = A * 1.03 * coastShape;
  h -= terrainSmooth(r, coastStart, coastStart + A * 0.23) * 930;
  return h;
}

export const NATURAL_WATER = createWaterways({
  riverPath: RIVER_PATH,
  pond: MAP_FEATURES.pond,
  baseHeight: landformHeight,
});

export function originalTerrainHeight(x, y) {
  return landformHeight(x, y) - NATURAL_WATER.bedLowering(x, y);
}

export function wizardWaterContact(state, wizard) {
  return waterContact(state, wizard, NATURAL_WATER.surfaceAt, terrainHeight, originalTerrainHeight);
}

let activeTerrain = null;
export function terrainHeight(x, y) {
  return activeTerrain ? activeTerrain.surfaceHeight(x, y) : originalTerrainHeight(x, y);
}

function wizardElevation(wizard) {
  return (
    (wizard.drillFeetY == null ? 0 : wizard.drillFeetY - terrainHeight(wizard.x, wizard.y)) +
    (wizard.climbH || 0) +
    (wizard.flyH || 0) +
    (wizard.jumpH || 0) +
    (wizard.openingH || 0)
  );
}

export function setActiveTerrain(terrain) {
  activeTerrain = terrain;
}

export const SHOVEL = Object.freeze({ range: 240, radius: 54, interval: 0.28 });
export const MAGICAL_DRILL = Object.freeze({
  chargeSeconds: 0.6,
  speed: 500,
  radius: 126,
  forwardDistance: 600,
  upDistance: 400,
  downDistance: 350,
  staminaPerSecond: 1.5,
  stepSeconds: 0.12,
  precisionRadius: 126,
  precisionLength: 72,
});

function precisionSize(wizard) {
  return {
    radius: Math.max(48, Math.min(126, wizard.digRadius ?? MAGICAL_DRILL.precisionRadius)),
    length: Math.max(24, Math.min(300, wizard.digLength ?? MAGICAL_DRILL.precisionLength)),
  };
}

function protectedDigVolume(state, x, z, radius) {
  return state.obstacles?.some(
    (obstacle) =>
      (obstacle.kind === 'house' || obstacle.landmark) &&
      Math.hypot(x - obstacle.x, z - obstacle.y) <
        radius + (obstacle.r || Math.max(obstacle.hw || 0, obstacle.hd || 0)) + 20,
  );
}

export function precisionDigTarget(state, wizard, direction, aimOverride = null) {
  if (!state.terrain || !wizard?.alive || (direction !== 'forward' && direction !== 'down'))
    return null;
  const aim = aimOverride || {
    x: wizard.digAimX,
    z: wizard.digAimZ,
    y: wizard.digAimY,
    hitKind: wizard.digAimHit,
  };
  if (
    direction === 'forward' &&
    aim.hitKind &&
    aim.hitKind !== 'air' &&
    [aim.x, aim.z, aim.y].every(Number.isFinite)
  ) {
    const feet = wizard.drillFeetY ?? terrainHeight(wizard.x, wizard.y);
    const dx = aim.x - wizard.x;
    const dz = aim.z - wizard.y;
    const dy = aim.y - (feet + 100);
    const length = Math.hypot(dx, dz, dy) || 1;
    return {
      x: aim.x,
      z: aim.z,
      y: aim.y,
      fx: dx / length,
      fz: dz / length,
      fy: dy / length,
      solid: aim.hitKind === 'terrain' && state.terrain.density(aim.x, aim.z, aim.y - 8) >= 0,
      hitKind: aim.hitKind,
    };
  }
  const pitch =
    direction === 'forward' && Number.isFinite(wizard.digAimPitch)
      ? Math.max(-Math.PI / 2 + 0.002, Math.min(Math.PI / 2 - 0.002, wizard.digAimPitch))
      : 0;
  const fx = Math.cos(wizard.heading) * Math.cos(pitch);
  const fz = Math.sin(wizard.heading) * Math.cos(pitch);
  const fy = Math.sin(pitch);
  const feet = wizard.drillFeetY ?? terrainHeight(wizard.x, wizard.y);
  let reach = direction === 'forward' ? 98 : 35;
  const startY = feet + (direction === 'forward' ? -8 : -28);
  let solid = false;
  if (direction === 'forward') {
    for (let candidate = 98; candidate <= 216; candidate += 16) {
      reach = candidate;
      if (
        state.terrain.density(
          wizard.x + fx * candidate,
          wizard.y + fz * candidate,
          startY + fy * candidate,
        ) >= 0
      ) {
        solid = true;
        break;
      }
    }
    // In open air, show the full laser path instead of parking a huge target
    // marker beside the wizard's feet.
    if (!solid) reach = 600;
  } else solid = state.terrain.density(wizard.x + fx * reach, wizard.y + fz * reach, startY) >= 0;
  return {
    x: wizard.x + fx * reach,
    z: wizard.y + fz * reach,
    y: startY + (direction === 'forward' ? fy * reach : 0),
    fx,
    fz,
    fy,
    solid,
    hitKind: solid ? 'terrain' : 'air',
  };
}

export function precisionDigPlan(state, wizard, direction, aimOverride = null) {
  const target = precisionDigTarget(state, wizard, direction, aimOverride);
  if (!target) return { accepted: false, reason: 'invalid-dig', target: null };
  const { x, z, y, fx, fz, fy } = target;
  if (!target.solid) return { accepted: false, reason: 'no-terrain', target };
  const materialId = terrainMaterialAt(x, z, y);
  if (materialId === 'bedrock') return { accepted: false, reason: 'bedrock', target };
  const material = TERRAIN_MATERIALS[materialId];
  const size = precisionSize(wizard);
  const radius = size.radius * material.digScale;
  const brush = {
    shape: 'capsule',
    x,
    z,
    y,
    radius,
    length: size.length,
    dirX: direction === 'forward' ? fx : 0,
    dirZ: direction === 'forward' ? fz : 0,
    dirY: direction === 'down' ? -1 : fy,
  };
  if (protectedDigVolume(state, x, z, radius + (direction === 'forward' ? size.length / 2 : 0)))
    return { accepted: false, reason: 'protected-object', target, brush };
  const check = state.terrain.subtractBrush({ ...brush, preview: true });
  if (!check.accepted) return { ...check, target, brush };
  return { accepted: true, target, brush, materialId, material };
}

export function precisionDig(state, wizard, direction) {
  const plan = precisionDigPlan(state, wizard, direction);
  if (!plan.accepted) return { accepted: false, reason: plan.reason };
  const { brush, materialId, material } = plan;
  const { x, z, y } = brush;
  const result = state.terrain.subtractBrush(brush);
  result.interval = SHOVEL.interval * material.digDelay;
  result.material = materialId;
  if (result.accepted)
    state.events.push({
      type: 'dig',
      wizardId: wizard.id,
      x,
      y: z,
      worldZ: y,
      color: material.dust,
      radius: brush.radius,
    });
  return result;
}

function cancelDrill(wizard, clearEscape = false) {
  wizard.drillCharge = 0;
  wizard.drill = null;
  if (clearEscape) wizard.drillEscapeReady = false;
}

function beginDrill(wizard, direction, free = false) {
  wizard.drill = { direction, distance: 0, time: 0, heading: wizard.heading, free };
  wizard.drillCharge = 0;
  wizard.drillNeedsRelease = true;
  wizard.jumpH = 0;
  wizard.jumpV = 0;
  wizard.drillFeetY ??= terrainHeight(wizard.x, wizard.y);
  wizard.drillFallV = 0;
  if (free) wizard.drillEscapeReady = false;
}

function stepDrill(state, wizard, dt) {
  const drill = wizard.drill;
  if (!drill) return;
  const config = MAGICAL_DRILL;
  drill.time += dt;
  if (drill.time + 1e-9 < config.stepSeconds) return;
  const elapsed = drill.time;
  drill.time = 0;
  const maximum =
    drill.direction === 'forward'
      ? config.forwardDistance
      : drill.direction === 'up'
        ? config.upDistance
        : config.downDistance;
  const travel = Math.min(
    config.speed * elapsed,
    maximum - drill.distance,
    (wizard.stamina / config.staminaPerSecond) * config.speed,
  );
  if (travel <= 0) {
    cancelDrill(wizard);
    return;
  }
  const sign = drill.direction === 'up' ? 1 : -1;
  const fx = Math.cos(drill.heading);
  const fz = Math.sin(drill.heading);
  const midX = wizard.x + (drill.direction === 'forward' ? (fx * travel) / 2 : 0);
  const midZ = wizard.y + (drill.direction === 'forward' ? (fz * travel) / 2 : 0);
  const midY = wizard.drillFeetY + (drill.direction === 'forward' ? 84 : 84 + (sign * travel) / 2);
  const endX = wizard.x + (drill.direction === 'forward' ? fx * travel : 0);
  const endZ = wizard.y + (drill.direction === 'forward' ? fz * travel : 0);
  const endFeet = wizard.drillFeetY + (drill.direction === 'forward' ? 0 : sign * travel);
  if (
    protectedDigVolume(
      state,
      midX,
      midZ,
      config.radius + (drill.direction === 'forward' ? travel / 2 + 12 : 0),
    ) ||
    Math.hypot(endX, endZ) + config.radius >= ARENA.radius ||
    (drill.direction === 'down' &&
      endFeet + 84 - config.radius < state.terrain.baseHeight(endX, endZ) - 420 + 18)
  ) {
    cancelDrill(wizard);
    state.events.push({ type: 'dig-blocked', wizardId: wizard.id, reason: 'protected-terrain' });
    return;
  }
  // Probe beyond the current capsule. Its own overlap must not look like open
  // air, or a drill would stop after its very first segment.
  const probeX = endX + (drill.direction === 'forward' ? fx * (config.radius + 40) : 0);
  const probeZ = endZ + (drill.direction === 'forward' ? fz * (config.radius + 40) : 0);
  const probeY = endFeet + 84 + (drill.direction === 'forward' ? 0 : sign * (config.radius + 40));
  if (
    drill.direction !== 'up' &&
    drill.distance > 0 &&
    state.terrain.density(probeX, probeZ, probeY) < 0
  ) {
    cancelDrill(wizard);
    return;
  }
  const result = state.terrain.subtractBrush({
    shape: 'tunnel',
    x: midX,
    z: midZ,
    y: midY,
    radius: config.radius,
    length: travel + (drill.direction === 'forward' ? 24 : 2),
    dirX: drill.direction === 'forward' ? fx : 0,
    dirZ: drill.direction === 'forward' ? fz : 0,
    dirY: drill.direction === 'forward' ? 0 : sign,
  });
  if (!result.accepted) {
    cancelDrill(wizard);
    state.events.push({ type: 'dig-blocked', wizardId: wizard.id, reason: result.reason });
    return;
  }
  if ([30, 84, 150].some((height) => state.terrain.density(endX, endZ, endFeet + height) >= 0)) {
    cancelDrill(wizard);
    state.events.push({ type: 'dig-blocked', wizardId: wizard.id, reason: 'solid-terrain' });
    return;
  }
  wizard.stamina = Math.max(0, wizard.stamina - (travel / config.speed) * config.staminaPerSecond);
  wizard.staminaRegenDelay = STAMINA.partialDelay;
  wizard.x = endX;
  wizard.y = endZ;
  if (drill.direction !== 'forward') wizard.drillFeetY = endFeet;
  if (drill.direction === 'up') wizard.drillFallV = config.speed;
  drill.distance += travel;
  state.events.push({ type: 'drill', wizardId: wizard.id, x: midX, y: midZ, worldZ: midY });
  if (
    drill.direction === 'up' &&
    state.terrain.surfaceHeight?.(endX, endZ) < wizard.drillFeetY + PLAYER_BODY_HEIGHT
  ) {
    cancelDrill(wizard);
    wizard.drillEscapeReady = true;
    return;
  }
  if (drill.distance >= maximum - 0.001 || wizard.stamina <= 0) {
    const direction = drill.direction;
    cancelDrill(wizard);
    if (direction === 'up') {
      wizard.drillEscapeReady = true;
      wizard.drillFallV = 0;
    }
  }
}

export function updateMagicalDigging(state, wizard, input, dt) {
  wizard.digMode = !!input.digMode;
  wizard.drillIntent = input.crouch ? 'down' : input.jumpHeld ? 'up' : 'forward';
  const run = !!input.run && !wizard.staminaExhausted;
  if (!wizard.digMode || !run || !wizard.alive) {
    cancelDrill(wizard, true);
    wizard.drillButtonWasHeld = false;
    wizard.drillNeedsRelease = false;
  } else if (wizard.drill) {
    stepDrill(state, wizard, dt);
  } else if (input.drillHeld && !wizard.drillNeedsRelease) {
    if (!wizard.drillButtonWasHeld) {
      wizard.drillButtonWasHeld = true;
      wizard.drillChargeHealth = wizard.health;
      if (wizard.drillEscapeReady && wizard.drillFallV < 0) {
        beginDrill(wizard, 'forward', true);
        stepDrill(state, wizard, MAGICAL_DRILL.stepSeconds);
      } else wizard.drillCharge = 0;
    } else if (!wizard.drill) {
      if (wizard.drillChargeHealth - wizard.health >= 18) {
        wizard.drillCharge = 0;
        wizard.drillInterrupted = true;
      }
      if (!wizard.drillInterrupted) {
        wizard.drillCharge += dt;
        if (wizard.drillCharge >= MAGICAL_DRILL.chargeSeconds) {
          beginDrill(wizard, input.crouch ? 'down' : input.jumpHeld ? 'up' : 'forward');
          stepDrill(state, wizard, MAGICAL_DRILL.stepSeconds);
        }
      }
    }
  } else if (!input.drillHeld) {
    wizard.drillButtonWasHeld = false;
    wizard.drillNeedsRelease = false;
    wizard.drillCharge = 0;
    wizard.drillInterrupted = false;
  }
  // A cut made on the previous frame can remove the ground beneath a standing
  // wizard. Retain the old feet height so gravity, rather than the new surface
  // query, carries the wizard into the hole.
  const surfaceNow = terrainHeight(wizard.x, wizard.y);
  if (
    wizard.drillFeetY == null &&
    surfaceNow < wizard.lastTerrainFeetY - 12 &&
    originalTerrainHeight(wizard.x, wizard.y) - surfaceNow > 16
  ) {
    wizard.drillFeetY = wizard.lastTerrainFeetY;
    wizard.drillFallV = 0;
  }
  if (wizard.drillFeetY != null && !wizard.drill && !wizard.swimming) {
    if (wizard.climbState === 'terrain-wall') return;
    const floor = state.terrain.supportHeight(wizard.x, wizard.y, wizard.drillFeetY + 8);
    if (wizard.drillFeetY > floor + 1) {
      wizard.drillFallV -= JUMP.gravity * dt;
      wizard.drillFeetY = Math.max(floor, wizard.drillFeetY + wizard.drillFallV * dt);
    } else {
      wizard.drillFeetY = floor;
      wizard.drillFallV = 0;
      wizard.drillEscapeReady = false;
    }
    const surface = terrainHeight(wizard.x, wizard.y);
    const carvedDepth = originalTerrainHeight(wizard.x, wizard.y) - surface;
    if (
      carvedDepth < 24 &&
      surface - wizard.drillFeetY < 24 &&
      Math.abs(surface - wizard.drillFeetY) < 12
    ) {
      wizard.drillFeetY = null;
    }
  }
}
export const TERRAIN_MATERIALS = Object.freeze({
  sand: Object.freeze({
    name: 'Sand',
    digScale: 1.2,
    digDelay: 0.8,
    density: 0.8,
    strength: 0.55,
    dust: '#c8a575',
  }),
  dirt: Object.freeze({
    name: 'Dirt',
    digScale: 1,
    digDelay: 1,
    density: 1,
    strength: 1,
    dust: '#a07652',
  }),
  clay: Object.freeze({
    name: 'Clay',
    digScale: 0.95,
    digDelay: 1.1,
    density: 1.3,
    strength: 1.15,
    dust: '#765c54',
  }),
  stone: Object.freeze({
    name: 'Stone',
    digScale: 0.62,
    digDelay: 1.65,
    density: 1.8,
    strength: 2,
    dust: '#818b94',
  }),
  crystal: Object.freeze({
    name: 'Crystal',
    digScale: 0.45,
    digDelay: 2,
    density: 1.5,
    strength: 2.3,
    dust: '#a78bfa',
  }),
  bedrock: Object.freeze({
    name: 'Bedrock',
    digScale: 0,
    digDelay: 1,
    density: 3,
    strength: Infinity,
    dust: '#cbd5e1',
  }),
});

export function terrainMaterialAt(x, y, worldHeight = terrainHeight(x, y)) {
  const markedMaterial = activeTerrain?.volumeAt(x, y, worldHeight)?.materialId;
  if (markedMaterial && TERRAIN_MATERIALS[markedMaterial]) return markedMaterial;
  const depth = originalTerrainHeight(x, y) - worldHeight;
  if (depth > 400) return 'bedrock';
  if (dist(x, y, MAP_FEATURES.mine.x, MAP_FEATURES.mine.y) < 950 && depth > 100) return 'crystal';
  if (depth > 210) return 'stone';
  const biome = biomeAt(x, y);
  if (biome === 'mountain' || dist(x, y, MAP_FEATURES.mine.x, MAP_FEATURES.mine.y) < 1150)
    return 'stone';
  if (biome === 'desert' || terrainHeight(x, y) < 50) return 'sand';
  if (biome === 'coast') return 'clay';
  return 'dirt';
}
export const DIGGING_SPELLS = Object.freeze({
  'burrow-spell': Object.freeze({
    name: 'Burrow Spell',
    shape: 'tunnel',
    radius: 92,
    length: 260,
    range: 340,
    manaType: 'elemental',
    manaCost: 35,
    interval: 1.2,
    maxChunks: 9,
    affectsStone: false,
    affectsStructures: false,
    canTriggerCollapse: true,
    color: '#b991f1',
  }),
});

export function digTerrain(state, wizard, targetX, targetY, targetHeight) {
  if (!state.terrain || !wizard?.alive || !wizard.isPlayer)
    return { accepted: false, reason: 'invalid-player' };
  if (![targetX, targetY, targetHeight].every(Number.isFinite))
    return { accepted: false, reason: 'invalid-target' };
  const distance = Math.hypot(targetX - wizard.x, targetY - wizard.y);
  if (distance > SHOVEL.range || distance < WIZARD.radius + 12)
    return { accepted: false, reason: 'out-of-range' };
  const ground = terrainHeight(targetX, targetY);
  if (Math.abs(targetHeight - ground) > 60) return { accepted: false, reason: 'not-terrain' };
  const materialId = terrainMaterialAt(targetX, targetY, targetHeight);
  const material = TERRAIN_MATERIALS[materialId];
  if (materialId === 'bedrock') return { accepted: false, reason: 'bedrock' };
  if (
    state.obstacles?.some(
      (obstacle) =>
        !obstacle.soft &&
        Math.hypot(targetX - obstacle.x, targetY - obstacle.y) <
          SHOVEL.radius + (obstacle.r || Math.max(obstacle.hw || 0, obstacle.hd || 0)) + 20,
    )
  )
    return { accepted: false, reason: 'protected-object' };
  const result = state.terrain.subtractSphere(
    targetX,
    targetY,
    targetHeight - 18,
    SHOVEL.radius * material.digScale,
  );
  result.interval = SHOVEL.interval * material.digDelay;
  result.material = materialId;
  if (result.accepted) {
    state.events.push({
      type: 'dig',
      wizardId: wizard.id,
      x: targetX,
      y: targetY,
      worldZ: targetHeight,
      color: material.dust,
      radius: SHOVEL.radius * material.digScale,
    });
  }
  return result;
}

export function castDiggingSpell(state, wizard, itemId, targetX, targetY, targetHeight) {
  if (itemId === 'levitation-spell') {
    if (!state.terrainSupport || !wizard?.alive || !wizard.isPlayer)
      return { accepted: false, reason: 'invalid-spell' };
    const slot = inventorySlots(wizard).findIndex((item) => item?.itemId === itemId);
    if (slot < 0) return { accepted: false, reason: 'spell-not-carried' };
    if (Math.hypot(targetX - wizard.x, targetY - wizard.y) > 300)
      return { accepted: false, reason: 'out-of-range' };
    const result = state.terrainSupport.placeNode({
      x: targetX,
      z: targetY,
      y: null,
      team: wizard.teamId ?? wizard.id,
      ownerId: wizard.id,
    });
    if (result.accepted) {
      inventorySlots(wizard)[slot] = null;
      state.inventoryRevision++;
      state.events.push({
        type: 'levitation-placed',
        x: result.node.x,
        y: result.node.z,
        worldZ: result.node.y,
        wizardId: wizard.id,
      });
    }
    return result;
  }
  const spell = DIGGING_SPELLS[itemId];
  if (!spell || !state.terrain || !wizard?.alive || !wizard.isPlayer)
    return { accepted: false, reason: 'invalid-spell' };
  if (!inventorySlots(wizard).some((item) => item?.itemId === itemId))
    return { accepted: false, reason: 'spell-not-carried' };
  if ((wizard.nextDigSpellTime || 0) > state.time)
    return { accepted: false, reason: 'spell-recharging' };
  if ((wizard.manaPouch?.[spell.manaType] || 0) < spell.manaCost)
    return { accepted: false, reason: 'not-enough-mana' };
  if (
    ![targetX, targetY, targetHeight].every(Number.isFinite) ||
    Math.hypot(targetX - wizard.x, targetY - wizard.y) > spell.range
  )
    return { accepted: false, reason: 'out-of-range' };
  const materialId = terrainMaterialAt(targetX, targetY, targetHeight);
  if (
    materialId === 'bedrock' ||
    ((materialId === 'stone' || materialId === 'crystal') && !spell.affectsStone)
  )
    return { accepted: false, reason: 'material-too-hard' };
  const dirX = Math.cos(wizard.heading);
  const dirZ = Math.sin(wizard.heading);
  const centerX = targetX + dirX * spell.length * 0.5;
  const centerY = targetY + dirZ * spell.length * 0.5;
  if (
    state.obstacles?.some(
      (obstacle) =>
        !obstacle.soft &&
        Math.hypot(centerX - obstacle.x, centerY - obstacle.y) <
          spell.radius +
            spell.length / 2 +
            (obstacle.r || Math.max(obstacle.hw || 0, obstacle.hd || 0)) +
            20,
    )
  )
    return { accepted: false, reason: 'protected-object' };
  const result = state.terrain.subtractBrush({
    shape: spell.shape,
    x: centerX,
    z: centerY,
    y: targetHeight - 30,
    radius: spell.radius,
    length: spell.length,
    dirX,
    dirZ,
  });
  if (result.accepted) {
    wizard.manaPouch[spell.manaType] -= spell.manaCost;
    wizard.nextDigSpellTime = state.time + spell.interval;
    state.events.push({
      type: 'dig-spell',
      wizardId: wizard.id,
      x: centerX,
      y: centerY,
      worldZ: targetHeight,
      color: spell.color,
      radius: spell.radius,
    });
  }
  return result;
}

export function reinforceLevitation(state, wizard) {
  if (!state.terrainSupport || !wizard?.alive || !wizard.isPlayer)
    return { accepted: false, reason: 'invalid-player' };
  const cost = 20;
  if ((wizard.manaPouch?.elemental || 0) < cost)
    return { accepted: false, reason: 'not-enough-mana' };
  if ((wizard.nextReinforceTime || 0) > state.time)
    return { accepted: false, reason: 'spell-recharging' };
  const team = wizard.teamId ?? wizard.id;
  const node = [...state.terrainSupport.nodes.values()]
    .filter((candidate) => candidate.team === team)
    .sort((a, b) => dist(wizard.x, wizard.y, a.x, a.z) - dist(wizard.x, wizard.y, b.x, b.z))[0];
  if (!node || dist(wizard.x, wizard.y, node.x, node.z) > 240)
    return { accepted: false, reason: 'no-friendly-support' };
  const result = state.terrainSupport.reinforceNode(node.id, team, cost);
  if (result.accepted) {
    wizard.manaPouch.elemental -= cost;
    wizard.nextReinforceTime = state.time + 0.5;
    state.events.push({
      type: 'levitation-reinforced',
      wizardId: wizard.id,
      x: node.x,
      y: node.z,
      worldZ: node.y + 23,
    });
  }
  return result;
}

// ---- Prop factories --------------------------------------------------------
function makeTree(x, y, rng) {
  const scale = 0.9 + rng() * rng() * 3.6;
  return {
    kind: 'tree',
    x,
    y,
    scale,
    rot: rng() * Math.PI,
    leaf: (rng() * 4) | 0,
    r: 15 * scale,
    top: 200 * scale,
  };
}
function makeCactus(x, y, rng) {
  const scale = 0.8 + rng() * 1.0;
  return {
    kind: 'cactus',
    x,
    y,
    scale,
    rot: rng() * Math.PI,
    arms: 1 + ((rng() * 3) | 0),
    r: 12 * scale,
    top: 95 * scale,
  };
}
function makeRock(x, y, rng, big) {
  const s = (big ? 34 : 12) + rng() * (big ? 95 : 40);
  const sy = big ? 0.9 + rng() * 1.0 : 0.5 + rng() * 0.5;
  return {
    kind: 'rock',
    x,
    y,
    s,
    sy,
    rx: rng() * 3,
    ry: rng() * 3,
    rz: rng() * 3,
    r: s * 0.9,
    top: s * (0.3 + sy),
  };
}
function makeBush(x, y, rng) {
  const s = 10 + rng() * 16;
  return { kind: 'bush', x, y, s, rot: rng() * Math.PI, leaf: (rng() * 4) | 0, soft: true };
}
function makeHouse(x, y, rng) {
  // Twice house-sized — big two-storey houses against the ~82-unit wizards.
  const w = 600 + rng() * 400;
  const d = 600 + rng() * 400;
  const h = 236 + rng() * 128;
  // Face the map centre (the castle), with a little natural jitter, so houses are
  // deliberately oriented (door toward the centre) instead of randomly spun.
  const angle = Math.atan2(-y, -x) - Math.PI / 2 + (rng() - 0.5) * 0.3;
  return {
    kind: 'house',
    x,
    y,
    w,
    d,
    h,
    angle,
    wall: (rng() * 4) | 0,
    roof: (rng() * 4) | 0,
    hw: w / 2,
    hd: d / 2,
    top: h * 1.8,
  };
}

// Build the scenery layout: an array of props with collision info. Vegetation is
// biome-driven (dense forest, sparse mountains, cacti + spires in the desert),
// plus a coastal village and a farm hamlet, and a clearing around the castle.
export function buildObstacles(seed = OBSTACLE_SEED) {
  const rng = mulberry32(seed);
  const props = [];
  const A = ARENA.radius;
  const edge = A - 80;
  const clearCentre = (x, y) => dist(x, y, 0, 0) < 700; // keep the castle area open

  const scatter = (count, inner, outer, make) => {
    for (let i = 0; i < count; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = Math.sqrt(inner * inner + rng() * (outer * outer - inner * inner));
      make(Math.cos(ang) * rad, Math.sin(ang) * rad);
    }
  };
  const cluster = (cx, cy, count, spread, make) => {
    for (let i = 0; i < count; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * spread;
      make(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
    }
  };

  // Trees / cacti / bushes, chosen by biome.
  scatter(1500, 300, edge, (x, y) => {
    if (clearCentre(x, y)) return;
    if (riverDistance(x, y).distance < 300 || terrainHeight(x, y) < 7) return;
    const b = biomeAt(x, y);
    if (b === 'desert') {
      const roll = rng();
      if (roll < 0.4) props.push(makeCactus(x, y, rng));
      else if (roll < 0.62) props.push(makeRock(x, y, rng, true));
      return;
    }
    const treeP = b === 'forest' ? 0.92 : b === 'mountain' ? 0.32 : b === 'farm' ? 0.28 : 0.55;
    if (rng() < treeP) props.push(makeTree(x, y, rng));
    else if (rng() < 0.28) props.push(makeBush(x, y, rng));
  });

  // Rocks — plentiful on the mountain, some in the desert, sparse elsewhere.
  scatter(520, 300, edge, (x, y) => {
    if (clearCentre(x, y)) return;
    if (riverDistance(x, y).distance < 250 || terrainHeight(x, y) < 4) return;
    const b = biomeAt(x, y);
    const p = b === 'mountain' ? 0.85 : b === 'desert' ? 0.5 : 0.25;
    if (rng() < p) props.push(makeRock(x, y, rng, b === 'mountain'));
  });

  // Coastal village, farm hamlet, and a few outlying cabins.
  const coast = REGIONS.find((r) => r.biome === 'coast');
  const farm = REGIONS.find((r) => r.biome === 'farm');
  const desert = REGIONS.find((r) => r.biome === 'desert');
  // Add a house only if it doesn't overlap an existing one (big houses need room).
  const addHouse = (x, y) => {
    if (riverDistance(x, y).distance < 520 || terrainHeight(x, y) < 12) return;
    if (dist(x, y, MAP_FEATURES.pond.x, MAP_FEATURES.pond.y) < MAP_FEATURES.pond.r + 220) return;
    const h = makeHouse(x, y, rng);
    const half = Math.max(h.hw, h.hd);
    const clash = props.some(
      (p) => p.kind === 'house' && dist(x, y, p.x, p.y) < half + Math.max(p.hw, p.hd) + 70,
    );
    if (!clash) props.push(h);
  };
  cluster(coast.x, coast.y, 34, 2900, addHouse);
  cluster(farm.x, farm.y, 12, 2100, addHouse);
  cluster(desert.x + 300, desert.y + 520, 14, 1800, addHouse);
  cluster(MAP_FEATURES.mine.x, MAP_FEATURES.mine.y + 1250, 8, 1150, addHouse);
  scatter(26, 1600, edge, (x, y) => {
    const b = biomeAt(x, y);
    if (!clearCentre(x, y) && b !== 'desert' && b !== 'mountain') addHouse(x, y);
  });

  // Invisible collision partners for the large bespoke landmarks rendered in
  // render3d.js. Marked `landmark` so the generic scenery builder does not draw
  // a second rock/house on top of them.
  const mountain = REGIONS.find((r) => r.biome === 'mountain');
  for (const [ox, oy, radius, height] of [
    [-1100, 220, 280, 720],
    [-720, -440, 360, 930],
    [-280, 160, 310, 820],
    [180, -520, 390, 1020],
    [620, 80, 300, 780],
    [1050, -360, 345, 890],
    [-850, 880, 270, 650],
    [-300, 820, 350, 850],
    [300, 900, 290, 690],
    [820, 700, 320, 760],
    [-1250, -650, 240, 580],
    [1250, 400, 250, 620],
  ]) {
    props.push({
      kind: 'rock',
      landmark: true,
      x: mountain.x + ox,
      y: mountain.y + oy,
      r: radius * 0.82,
      top: height,
    });
  }
  for (const [ox, oy, radius, height] of [
    [-1700, 450, 340, 620],
    [-700, 1180, 280, 500],
    [450, 600, 390, 690],
    [1450, 1300, 260, 470],
    [1550, -200, 310, 560],
  ]) {
    props.push({
      kind: 'rock',
      landmark: true,
      x: desert.x + ox,
      y: desert.y + oy,
      r: radius * 0.9,
      top: height,
    });
  }
  for (const [ox, oy, radius, height] of [
    [-430, -280, 420, 720],
    [520, 260, 360, 620],
  ]) {
    props.push({
      kind: 'rock',
      landmark: true,
      x: MAP_FEATURES.mine.x + ox,
      y: MAP_FEATURES.mine.y + oy,
      r: radius,
      top: height,
    });
  }
  props.push({
    kind: 'house',
    landmark: true,
    x: MAP_FEATURES.islet.x,
    y: MAP_FEATURES.islet.y,
    w: 250,
    d: 190,
    h: 250,
    hw: 125,
    hd: 95,
    top: 250,
    angle: 0,
  });

  // Drop any tree/rock/cactus/bush that ended up inside a house footprint.
  const houses = props.filter((p) => p.kind === 'house');
  return props.filter((p) => {
    if (p.kind === 'house') return true;
    for (const h of houses) {
      const [ox, oy] = pushOutOfObstacle(p.x, p.y, 25, h);
      if (ox !== p.x || oy !== p.y) return false; // sat inside/touching this house
    }
    return true;
  });
}

// Push a circle of radius `rad` centered at (px, py) out of a single obstacle.
// Returns the corrected [x, y]. Trees/rocks are circles; houses oriented boxes.
export function pushOutOfObstacle(px, py, rad, o) {
  if (o.soft) return [px, py];
  if (o.kind === 'house') {
    const c = Math.cos(o.angle);
    const s = Math.sin(o.angle);
    const dx = px - o.x;
    const dy = py - o.y;
    let lx = dx * c + dy * s; // world -> box-local
    let ly = -dx * s + dy * c;
    const clx = clamp(lx, -o.hw, o.hw);
    const cly = clamp(ly, -o.hd, o.hd);
    const inside = clx === lx && cly === ly;
    if (inside) {
      // Center is within the walls: eject through the nearest face.
      const dl = o.hw - Math.abs(lx);
      const dd = o.hd - Math.abs(ly);
      if (dl < dd) lx = (lx < 0 ? -1 : 1) * (o.hw + rad);
      else ly = (ly < 0 ? -1 : 1) * (o.hd + rad);
    } else {
      const ex = lx - clx;
      const ey = ly - cly;
      const d2 = ex * ex + ey * ey;
      if (d2 >= rad * rad) return [px, py]; // clear of the box
      const d = Math.sqrt(d2) || 1;
      const push = rad - d;
      lx += (ex / d) * push;
      ly += (ey / d) * push;
    }
    return [o.x + lx * c - ly * s, o.y + lx * s + ly * c]; // box-local -> world
  }
  // Circle obstacle (tree, rock).
  const dx = px - o.x;
  const dy = py - o.y;
  const rr = rad + o.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return [px, py];
  const d = Math.sqrt(d2);
  if (d < 1e-4) return [o.x + rr, o.y]; // dead center: shove in a fixed direction
  return [o.x + (dx / d) * rr, o.y + (dy / d) * rr];
}

// Resolve a circle (a wizard) against every obstacle, in place.
export function resolveObstacles(px, py, rad, obstacles) {
  if (!obstacles) return [px, py];
  let x = px;
  let y = py;
  for (const o of obstacles) {
    const out = pushOutOfObstacle(x, y, rad, o);
    x = out[0];
    y = out[1];
  }
  return [x, y];
}

// Does a spell bolt at (bx, by, bz) with radius br hit a solid obstacle?
export function boltHitsObstacle(bx, by, bz, br, obstacles) {
  if (!obstacles) return false;
  for (const o of obstacles) {
    if (o.soft || bz > o.top) continue;
    if (o.kind === 'house') {
      const c = Math.cos(o.angle);
      const s = Math.sin(o.angle);
      const dx = bx - o.x;
      const dy = by - o.y;
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      if (Math.abs(lx) <= o.hw + br && Math.abs(ly) <= o.hd + br) return true;
    } else if (dist(bx, by, o.x, o.y) <= o.r + br) {
      return true;
    }
  }
  return false;
}

// A fixed pool of safe ground locations is shared by every match. Only a
// random subset activates, so loot moves each game without ever appearing in
// water, scenery, thin air, steep peaks, or the dangerous coastline fringe.
export const LOOT_MAJOR_AREAS = Object.freeze([
  { id: 'castle', name: 'Crown Castle', x: 0, y: 0, radius: 1450 },
  { id: 'highlands', name: 'Enchanted Highlands', x: -4300, y: -4100, radius: 1500 },
  { id: 'harvest', name: 'Harvest Village', x: 4300, y: -3200, radius: 1500 },
  { id: 'harbor', name: 'Western Harbor', x: -5600, y: 3500, radius: 1450 },
  { id: 'desert-town', name: 'Sunken Desert', x: 4700, y: 4700, radius: 1550 },
  {
    id: 'mine',
    name: 'Eastern Mine',
    x: MAP_FEATURES.mine.x,
    y: MAP_FEATURES.mine.y,
    radius: 1300,
  },
]);

// These named locations represent a boss stronghold and two special magical
// landmarks. Mythics may never be assigned to wilderness or ordinary towns.
export const LOOT_MYTHIC_AREA_IDS = Object.freeze(['castle', 'highlands', 'desert-town']);

export const LOOT_SPAWN_RULES = Object.freeze({
  edgeMargin: 620,
  riverMargin: 250,
  pondMargin: 95,
  obstacleMargin: 26,
  minimumSpacing: 175,
  maximumSlope: 0.72,
  majorPoolPerArea: 34,
  activePerMajorArea: 8,
  wildernessPool: 110,
  activeWilderness: 24,
});

export function terrainSlopeAt(x, y, sample = 42) {
  const dx = (terrainHeight(x + sample, y) - terrainHeight(x - sample, y)) / (2 * sample);
  const dy = (terrainHeight(x, y + sample) - terrainHeight(x, y - sample)) / (2 * sample);
  return Math.hypot(dx, dy);
}

function blockedByDecorativeLandmark(x, y) {
  // Central keep plus the circular wall/tower ring.
  const castleDistance = Math.hypot(x, y);
  if (castleDistance < 155 || Math.abs(castleDistance - 340) < 78) return true;
  // The windmill and lighthouse are decorative meshes rather than obstacle
  // records, so reserve their visible footprints explicitly.
  const farm = REGIONS.find((region) => region.biome === 'farm');
  if (dist(x, y, farm.x, farm.y) < 120) return true;
  const coast = REGIONS.find((region) => region.biome === 'coast');
  const coastLength = Math.hypot(coast.x, coast.y) || 1;
  const lighthouseX = (coast.x / coastLength) * (coastLength + 1400);
  const lighthouseY = (coast.y / coastLength) * (coastLength + 1400);
  return dist(x, y, lighthouseX, lighthouseY) < 105;
}

export function isSafeLootSpawnPoint(x, y, obstacles = [], otherPoints = []) {
  if (Math.hypot(x, y) > ARENA.radius - LOOT_SPAWN_RULES.edgeMargin) return false;
  const groundHeight = terrainHeight(x, y);
  if (groundHeight < 14) return false;
  if (riverDistance(x, y).distance < LOOT_SPAWN_RULES.riverMargin) return false;
  if (
    dist(x, y, MAP_FEATURES.pond.x, MAP_FEATURES.pond.y) <
    MAP_FEATURES.pond.r + LOOT_SPAWN_RULES.pondMargin
  ) {
    return false;
  }
  if (terrainSlopeAt(x, y) > LOOT_SPAWN_RULES.maximumSlope) return false;
  if (blockedByDecorativeLandmark(x, y)) return false;
  if (
    boltHitsObstacle(x, y, 1, ATTACK_PICKUP_RADIUS + LOOT_SPAWN_RULES.obstacleMargin, obstacles)
  ) {
    return false;
  }
  return !otherPoints.some(
    (point) => dist(x, y, point.x, point.y) < LOOT_SPAWN_RULES.minimumSpacing,
  );
}

function shuffleLoot(list, rng) {
  for (let index = list.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1));
    [list[index], list[swap]] = [list[swap], list[index]];
  }
  return list;
}

const LOOT_SPAWN_POINT_SEED = 0x51afe123;
let cachedLootSpawnPointPool = null;
let cachedLootObstacleCount = -1;
export function createLootSpawnPoints(obstacles = [], seed = LOOT_SPAWN_POINT_SEED) {
  if (
    seed === LOOT_SPAWN_POINT_SEED &&
    obstacles.length > 0 &&
    cachedLootSpawnPointPool &&
    cachedLootObstacleCount === obstacles.length
  ) {
    return cachedLootSpawnPointPool.map((point) => ({
      ...point,
      groundHeight: terrainHeight(point.x, point.y),
    }));
  }
  const rng = mulberry32(seed);
  const points = [];
  let nextId = 0;
  const addPoint = (x, y, areaId, density, core = false) => {
    if (!isSafeLootSpawnPoint(x, y, obstacles, points)) return false;
    points.push({
      id: `loot-spawn-${nextId++}`,
      x,
      y,
      groundHeight: terrainHeight(x, y),
      areaId,
      density,
      core,
    });
    return true;
  };

  for (const area of LOOT_MAJOR_AREAS) {
    let created = 0;
    let attempts = 0;
    while (created < LOOT_SPAWN_RULES.majorPoolPerArea && attempts++ < 9000) {
      const castleCore = area.id === 'castle' && created < 4;
      const inner = castleCore ? 175 : 90;
      const outer = castleCore ? 250 : area.radius;
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(inner * inner + rng() * (outer * outer - inner * inner));
      if (
        addPoint(
          area.x + Math.cos(angle) * radius,
          area.y + Math.sin(angle) * radius,
          area.id,
          'major',
          castleCore,
        )
      ) {
        created++;
      }
    }
  }

  let wildernessCreated = 0;
  let wildernessAttempts = 0;
  while (wildernessCreated < LOOT_SPAWN_RULES.wildernessPool && wildernessAttempts++ < 18000) {
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * (ARENA.radius - LOOT_SPAWN_RULES.edgeMargin - 100);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (
      LOOT_MAJOR_AREAS.some(
        (area) => dist(x, y, area.x, area.y) < area.radius + LOOT_SPAWN_RULES.minimumSpacing,
      )
    ) {
      continue;
    }
    if (addPoint(x, y, 'wilderness', 'wilderness')) wildernessCreated++;
  }

  if (seed === LOOT_SPAWN_POINT_SEED && obstacles.length > 0) {
    cachedLootSpawnPointPool = points.map((point) => ({ ...point }));
    cachedLootObstacleCount = obstacles.length;
  }
  return points;
}

function isUsefulCombatAttack(attackId) {
  const attack = ATTACKS[attackId];
  return !!attack && (attack.damage > 0 || attack.splashDamage > 0 || attack.damagePerSecond > 0);
}

function randomLootEntry(list, rng) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

function rollNonMythicLootCategory(rng) {
  let category = rollLootCategory(rng);
  while (category === 'mythic') category = rollLootCategory(rng);
  return category;
}

function lootForCategory(category, rng, forceCombat = false) {
  if (category === 'regular') {
    const pool = forceCombat
      ? REGULAR_UNIVERSAL_ATTACK_IDS.filter(isUsefulCombatAttack)
      : REGULAR_UNIVERSAL_ATTACK_IDS;
    return { lootType: 'attack', attackId: randomLootEntry(pool, rng) };
  }
  if (category === 'healing-protection') {
    return {
      lootType: 'attack',
      attackId: randomLootEntry(HEALING_PROTECTION_ATTACK_IDS, rng),
    };
  }
  if (category === 'movement') {
    return { lootType: 'attack', attackId: randomLootEntry(MOVEMENT_ATTACK_IDS, rng) };
  }
  if (category === 'special') {
    const specialLoot = [
      ...SPECIAL_ATTACK_IDS,
      WEAPON_UPGRADE_RUNE_ID,
      ...Object.keys(ITEM_DEFINITIONS),
    ];
    const itemId = randomLootEntry(specialLoot, rng);
    if (itemId === WEAPON_UPGRADE_RUNE_ID) {
      return { lootType: 'weapon-upgrade-rune', attackId: null };
    }
    if (ITEM_DEFINITIONS[itemId]) {
      return { lootType: ITEM_DEFINITIONS[itemId].lootType, itemId, attackId: null };
    }
    return { lootType: 'attack', attackId: itemId };
  }
  if (category === 'tier-1' || category === 'tier-2') {
    return {
      lootType: 'tier-scroll',
      attackId: rollTierAttackId(category === 'tier-1' ? 1 : 2, rng),
    };
  }
  return { lootType: 'attack', attackId: randomLootEntry(MYTHIC_ATTACK_IDS, rng) };
}

const DEFAULT_ATTACK_PICKUP_SEED = 0xa77ac5;
export function createAttackPickups(obstacles = [], seed = DEFAULT_ATTACK_PICKUP_SEED) {
  const rng = mulberry32(seed);
  const pool = createLootSpawnPoints(obstacles);
  const activePoints = [];
  for (const area of LOOT_MAJOR_AREAS) {
    const candidates = shuffleLoot(
      pool.filter((point) => point.areaId === area.id),
      rng,
    );
    // Always keep at least one courtyard point active inside Crown Castle.
    if (area.id === 'castle') {
      const courtyard = candidates.find((point) => point.core);
      if (courtyard) activePoints.push(courtyard);
    }
    for (const candidate of candidates) {
      if (activePoints.includes(candidate)) continue;
      const areaCount = activePoints.filter((point) => point.areaId === area.id).length;
      if (areaCount >= LOOT_SPAWN_RULES.activePerMajorArea) break;
      activePoints.push(candidate);
    }
  }

  activePoints.push(
    ...shuffleLoot(
      pool.filter((point) => point.areaId === 'wilderness'),
      rng,
    ).slice(0, LOOT_SPAWN_RULES.activeWilderness),
  );

  const categories = activePoints.map(() => rollLootCategory(rng));

  // Enforce the map rule after the exact per-point rolls: Mythics are limited
  // to one–three total and moved only onto approved boss/special landmarks.
  const eligibleMythicIndexes = shuffleLoot(
    activePoints
      .map((point, index) => (LOOT_MYTHIC_AREA_IDS.includes(point.areaId) ? index : -1))
      .filter((index) => index >= 0),
    rng,
  );
  const rolledMythicCount = categories.filter((category) => category === 'mythic').length;
  const mythicCount = Math.max(1, Math.min(3, rolledMythicCount));
  const chosenMythicIndexes = new Set(eligibleMythicIndexes.slice(0, mythicCount));
  for (let index = 0; index < categories.length; index++) {
    if (chosenMythicIndexes.has(index)) categories[index] = 'mythic';
    else if (categories[index] === 'mythic') categories[index] = rollNonMythicLootCategory(rng);
  }

  const pickups = activePoints.map((point, index) => {
    const category = categories[index];
    const loot = lootForCategory(category, rng);
    return {
      id: index,
      spawnPointId: point.id,
      areaId: point.areaId,
      density: point.density,
      category: category.startsWith('tier-') ? 'tier' : category,
      tier: category === 'tier-1' ? 1 : category === 'tier-2' ? 2 : null,
      lootType: loot.lootType,
      itemId: loot.itemId || null,
      attackId: loot.attackId,
      rarity: category === 'mythic' ? 'mythic' : rollLootRarity(rng),
      x: point.x,
      y: point.y,
      groundHeight: point.groundHeight,
      collectedBy: null,
    };
  });

  // Mana Pouch ammunition uses additional safe points and never consumes a
  // hotbar slot. Two bundles of every family ensure even rare ammunition can
  // be found without changing the requested attack/item category percentages.
  const usedSpawnPoints = new Set(activePoints.map((point) => point.id));
  const ammunitionPoints = shuffleLoot(
    pool.filter((point) => !usedSpawnPoints.has(point.id)),
    rng,
  ).slice(0, MANA_AMMUNITION_ORDER.length * 2);
  for (let index = 0; index < ammunitionPoints.length; index++) {
    const point = ammunitionPoints[index];
    const ammoType = MANA_AMMUNITION_ORDER[index % MANA_AMMUNITION_ORDER.length];
    pickups.push({
      id: pickups.length,
      spawnPointId: point.id,
      areaId: point.areaId,
      density: point.density,
      category: 'mana-ammunition',
      tier: null,
      lootType: 'mana-ammunition',
      attackId: null,
      ammoType,
      amount: MANA_AMMUNITION[ammoType].pickup,
      rarity: 'common',
      x: point.x,
      y: point.y,
      groundHeight: point.groundHeight,
      collectedBy: null,
    });
  }

  // Keep the earlier safety promise that every important location has at least
  // three immediately useful combat finds. Replace only the minimum number of
  // non-Mythic utility rolls needed in an unusually peaceful area.
  for (const area of LOOT_MAJOR_AREAS) {
    const areaPickups = pickups.filter((pickup) => pickup.areaId === area.id);
    let combatCount = areaPickups.filter((pickup) => isUsefulCombatAttack(pickup.attackId)).length;
    const replacements = areaPickups.filter(
      (pickup) =>
        pickup.category !== 'mythic' &&
        pickup.lootType !== 'mana-ammunition' &&
        !isUsefulCombatAttack(pickup.attackId),
    );
    for (const pickup of replacements) {
      if (combatCount >= 3) break;
      pickup.category = 'regular';
      pickup.tier = null;
      pickup.lootType = 'attack';
      pickup.itemId = null;
      pickup.attackId = randomLootEntry(
        REGULAR_UNIVERSAL_ATTACK_IDS.filter(isUsefulCombatAttack),
        rng,
      );
      combatCount++;
    }
  }

  return pickups;
}

// A Tier crystal keeps its tier number but changes to the version belonging to
// the collector's permanent base weapon. That makes every Tier pickup usable
// without turning weapon-specific Tier attacks into universal attacks.
export function tierAttackForWizard(wizard, pickupAttackId) {
  const source = ATTACKS[pickupAttackId];
  if (!wizard || source?.scope !== 'tier') return null;
  return (
    TIER_ATTACK_IDS.find((id) => {
      const candidate = ATTACKS[id];
      return candidate.weaponId === wizard.baseWeaponId && candidate.tier === source.tier;
    }) || null
  );
}

export function collectAttackPickup(state, wizard, pickup) {
  if (!state || !wizard || !pickup || pickup.collectedBy != null) return false;

  if (pickup.lootType === 'mana-ammunition') {
    const gained = addManaAmmunition(wizard, pickup.ammoType, pickup.amount);
    if (gained <= 0) return false;
    pickup.collectedBy = wizard.id;
    state.events.push({
      type: 'mana-pickup',
      groundId: pickup.id,
      wizardId: wizard.id,
      ammoType: pickup.ammoType,
      amount: gained,
    });
    return true;
  }

  if (pickup.lootType === 'weapon-upgrade-rune') {
    const previousRarity = LOOT_RARITIES[wizard.baseWeaponRarity]
      ? wizard.baseWeaponRarity
      : 'common';
    const nextRarity = upgradeBaseWeaponRarity(wizard, pickup.rarity);
    pickup.collectedBy = wizard.id;
    state.events.push({
      type: 'weapon-upgrade',
      groundId: pickup.id,
      wizardId: wizard.id,
      runeRarity: pickup.rarity,
      previousRarity,
      rarity: nextRarity,
      upgraded: nextRarity !== previousRarity,
    });
    return true;
  }

  const worldAttack = ATTACKS[pickup.attackId];
  if (!worldAttack) return false;

  if (worldAttack.scope === 'tier') {
    const resolvedAttackId = tierAttackForWizard(wizard, pickup.attackId);
    if (!resolvedAttackId) return false;
    const ownedTier =
      wizard.tierAttackId ||
      wizard.attackInventory?.find((id) => ATTACKS[id]?.scope === 'tier') ||
      null;
    pickup.collectedBy = wizard.id;
    if (ownedTier) {
      const ammoType = ATTACKS[ownedTier].ammoType;
      const manaEnergy = addManaAmmunition(
        wizard,
        ammoType,
        MANA_AMMUNITION[ammoType]?.pickup || 0,
      );
      state.events.push({
        type: 'attack-pickup',
        groundId: pickup.id,
        wizardId: wizard.id,
        attackId: ownedTier,
        originalAttackId: pickup.attackId,
        compatible: true,
        equipped: false,
        convertedToMana: true,
        manaEnergy,
        ammoType,
      });
      return true;
    }
    if (!addAttackToInventory(wizard, resolvedAttackId, pickup.rarity)) return false;
    const ammoType = ATTACKS[resolvedAttackId].ammoType;
    const manaEnergy = addManaAmmunition(wizard, ammoType, MANA_AMMUNITION[ammoType]?.pickup || 0);
    let equipped = equipAttack(wizard, resolvedAttackId);
    // A Tier claim is important enough to remain usable even if six universal
    // attacks already filled the hotbar. The displaced attack stays in the
    // inventory; only the last hotbar slot is replaced.
    if (!equipped) equipped = equipAttack(wizard, resolvedAttackId, ATTACK_SLOT_COUNT - 1);
    state.events.push({
      type: 'attack-pickup',
      groundId: pickup.id,
      wizardId: wizard.id,
      attackId: resolvedAttackId,
      originalAttackId: pickup.attackId,
      compatible: true,
      equipped,
      tierClaimed: true,
      manaEnergy,
      ammoType,
      rarity: attackRarityForWizard(wizard, resolvedAttackId),
    });
    return true;
  }

  if (wizard.attackInventory?.includes(pickup.attackId)) {
    const currentRarity = attackRarityForWizard(wizard, pickup.attackId);
    const currentRank = LOOT_RARITY_ORDER.indexOf(currentRarity);
    const pickupRank = LOOT_RARITY_ORDER.indexOf(pickup.rarity);
    if (pickupRank <= currentRank) return false;
    wizard.attackRarities[pickup.attackId] = pickup.rarity;
    pickup.collectedBy = wizard.id;
    state.events.push({
      type: 'attack-pickup',
      groundId: pickup.id,
      wizardId: wizard.id,
      attackId: pickup.attackId,
      compatible: true,
      equipped: wizard.attackSlots?.includes(pickup.attackId),
      upgraded: true,
      rarity: pickup.rarity,
    });
    return true;
  }
  if (!addAttackToInventory(wizard, pickup.attackId, pickup.rarity)) return false;
  pickup.collectedBy = wizard.id;
  const equipped = equipAttack(wizard, pickup.attackId);
  state.events.push({
    type: 'attack-pickup',
    groundId: pickup.id,
    wizardId: wizard.id,
    attackId: pickup.attackId,
    compatible: true,
    equipped,
    rarity: attackRarityForWizard(wizard, pickup.attackId),
  });
  return true;
}

export function collectNearbyAttacks(state, wizard) {
  let collected = 0;
  for (const pickup of state.attackPickups || []) {
    if (pickup.collectedBy != null) continue;
    if (dist(wizard.x, wizard.y, pickup.x, pickup.y) > ATTACK_PICKUP_RADIUS + WIZARD.radius) {
      continue;
    }
    if (collectAttackPickup(state, wizard, pickup)) collected++;
  }
  return collected;
}

// Player interaction pickup: F claims only the single closest crystal in
// reach. Bots keep using collectNearbyAttacks so their looting remains fully
// automatic.
export function collectNearestNearbyAttack(state, wizard) {
  const pickup = nearestAttackPickup(state, wizard);
  if (!pickup) return false;
  if (dist(wizard.x, wizard.y, pickup.x, pickup.y) > ATTACK_PICKUP_RADIUS + WIZARD.radius) {
    return false;
  }
  return collectAttackPickup(state, wizard, pickup);
}

export function nearestAttackPickup(state, wizard, compatibleOnly = false, tierOnly = false) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const pickup of state.attackPickups || []) {
    if (pickup.collectedBy != null) continue;
    if (tierOnly && ATTACKS[pickup.attackId]?.scope !== 'tier') continue;
    if (
      compatibleOnly &&
      ATTACKS[pickup.attackId]?.scope !== 'tier' &&
      !isAttackCompatible(wizard, pickup.attackId)
    ) {
      continue;
    }
    const distance = dist(wizard.x, wizard.y, pickup.x, pickup.y);
    if (distance < nearestDistance) {
      nearest = pickup;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function nearestManaPickup(state, wizard, ammoType = null) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const pickup of state.attackPickups || []) {
    if (pickup.collectedBy != null || pickup.lootType !== 'mana-ammunition') continue;
    if (ammoType && pickup.ammoType !== ammoType) continue;
    const distance = dist(wizard.x, wizard.y, pickup.x, pickup.y);
    if (distance < nearestDistance) {
      nearest = pickup;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function nearestInteractableItem(state, wizard) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const pickup of state.attackPickups || []) {
    if (pickup.collectedBy != null || pickup.lootType === 'mana-ammunition') continue;
    if (pickup.droppedBy === wizard.id && state.time < (pickup.blockedUntil || 0)) continue;
    const distance = dist(wizard.x, wizard.y, pickup.x, pickup.y);
    if (distance < nearestDistance) {
      nearest = pickup;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function nearestEquippableBotItem(state, wizard) {
  let nearest = null;
  let best = Infinity;
  for (const pickup of state.attackPickups || []) {
    if (
      pickup.collectedBy != null ||
      !ATTACKS[pickup.attackId] ||
      !isAttackCompatible(wizard, pickup.attackId)
    )
      continue;
    const distance = dist(wizard.x, wizard.y, pickup.x, pickup.y);
    if (distance < best) {
      nearest = pickup;
      best = distance;
    }
  }
  return nearest;
}

// ---- Five-slot item inventory ---------------------------------------------

export const INVENTORY_PICKUP_HOLD_SECONDS = 0.65;
export const DROPPED_ITEM_OWNER_DELAY = 1;

function inventorySlots(wizard) {
  wizard.inventorySlots ||= Array(INVENTORY_SLOT_COUNT).fill(null);
  return wizard.inventorySlots;
}

function validGroundItem(pickup) {
  if (pickup.lootType === 'mana-ammunition') {
    return !!MANA_AMMUNITION[pickup.ammoType] && pickup.amount > 0;
  }
  if (pickup.lootType === 'weapon-upgrade-rune') {
    return LOOT_RARITY_ORDER.includes(pickup.rarity);
  }
  if (pickup.lootType === 'tier-scroll') return ATTACKS[pickup.attackId]?.scope === 'tier';
  if (pickup.lootType === 'attack') return ATTACKS[pickup.attackId]?.scope === 'universal';
  return ITEM_DEFINITIONS[pickup.itemId]?.lootType === pickup.lootType;
}

function inventoryCapacity(wizard, item) {
  const limit = stackLimit(item, ATTACKS);
  return inventorySlots(wizard).reduce((capacity, slot) => {
    if (!slot) return capacity + limit;
    return capacity + (canStackItems(slot, item, ATTACKS) ? limit - slot.quantity : 0);
  }, 0);
}

function putInInventory(wizard, item, quantity) {
  const slots = inventorySlots(wizard);
  const limit = stackLimit(item, ATTACKS);
  let remaining = quantity;
  for (const slot of slots) {
    if (!canStackItems(slot, item, ATTACKS)) continue;
    const added = Math.min(remaining, limit - slot.quantity);
    slot.quantity += added;
    remaining -= added;
    if (!remaining) return;
  }
  for (let index = 0; index < slots.length && remaining; index++) {
    if (slots[index]) continue;
    const added = Math.min(remaining, limit);
    slots[index] = { ...item, quantity: added };
    remaining -= added;
  }
}

function refreshEquippedAttack(wizard, attackId) {
  if (!attackId || !ATTACKS[attackId]) return false;
  if (!isAttackCompatible(wizard, attackId)) return false;
  const slot = inventorySlots(wizard).findIndex((item) => item?.attackId === attackId);
  if (slot < 0) return false;
  if (
    !wizard.attackInventory?.includes(attackId) &&
    !addAttackToInventory(wizard, attackId, inventorySlots(wizard)[slot].rarity)
  )
    return false;
  // The physical item's position is the attack's hotbar position. A second
  // hidden equip order would make the six visible slots misleading.
  return equipAttack(wizard, attackId, slot);
}

function forgetAttackIfGone(wizard, attackId) {
  if (!attackId || inventorySlots(wizard).some((slot) => slot?.attackId === attackId)) return;
  wizard.attackInventory = (wizard.attackInventory || []).filter((id) => id !== attackId);
  wizard.attackSlots = (wizard.attackSlots || []).map((id) => (id === attackId ? null : id));
  if (wizard.attackRarities) delete wizard.attackRarities[attackId];
  if (wizard.tierAttackId === attackId) wizard.tierAttackId = null;
}

function nearbyDropPoint(state, x, y, sequence = 0) {
  for (const radius of [0, 60, 110, 170, 240, 320, 430, 600, 850, 1200]) {
    for (let step = 0; step < 20; step++) {
      const angle = (step / 20) * Math.PI * 2 + sequence * 2.39996;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      const hit = raycastLootGround(state, px, py);
      if (!hit) continue;
      if (
        (state.attackPickups || []).some(
          (pickup) => pickup.collectedBy == null && dist(px, py, pickup.x, pickup.y) < 30,
        )
      )
        continue;
      return hit;
    }
  }
  // A player can die in water or against the world edge. Fall back to the
  // nearest prevalidated loot location so the item is never silently lost.
  const fallback = createLootSpawnPoints(state.obstacles).sort(
    (a, b) => dist(x, y, a.x, a.y) - dist(x, y, b.x, b.y),
  );
  return (
    fallback.find(
      (point) =>
        !state.attackPickups.some(
          (pickup) => pickup.collectedBy == null && dist(point.x, point.y, pickup.x, pickup.y) < 30,
        ),
    ) || null
  );
}

// The island is generated from terrainHeight, so a vertical ray has one exact
// intersection with this height field. This is the same ground surface the 3D
// renderer and projectile collision use.
export function raycastLootGround(state, x, y) {
  if (!isSafeLootSpawnPoint(x, y, state.obstacles)) return null;
  return { x, y, groundHeight: terrainHeight(x, y) };
}

function cleanupGroundItems(state) {
  if (state.time < (state.nextGroundCleanup || 0)) return;
  state.nextGroundCleanup = state.time + 10;
  state.attackPickups = state.attackPickups.filter((pickup) => {
    if (pickup.createdAt == null) return true;
    if (pickup.collectedBy != null) return state.time - pickup.createdAt < 30;
    if (state.time - pickup.createdAt < 600) return true;
    return state.wizards.some(
      (wizard) => wizard.alive && dist(wizard.x, wizard.y, pickup.x, pickup.y) < 500,
    );
  });
}

function createDroppedGroundItem(state, item, position, ownerId) {
  const pickup = {
    ...item,
    id: `ground-${state.nextGroundItemId++}`,
    x: position.x,
    y: position.y,
    groundHeight: position.groundHeight,
    collectedBy: null,
    droppedBy: ownerId,
    blockedUntil: state.time + DROPPED_ITEM_OWNER_DELAY,
    createdAt: state.time,
  };
  state.attackPickups.push(pickup);
  return pickup;
}

// The caller supplies only a ground ID and an action. All item attributes come
// from match state, which keeps repeated or simultaneous requests idempotent.
export function collectGroundItem(state, wizard, groundId, action = 'pickup') {
  if (!state?.wizards?.includes(wizard) || !wizard.alive) return false;
  const pickup = state.attackPickups?.find((item) => item.id === groundId);
  if (!pickup || pickup.collectedBy != null || !validGroundItem(pickup)) return false;
  if (pickup.droppedBy === wizard.id && state.time < (pickup.blockedUntil || 0)) return false;
  if (dist(wizard.x, wizard.y, pickup.x, pickup.y) > ATTACK_PICKUP_RADIUS + WIZARD.radius) {
    return false;
  }

  if (pickup.lootType === 'mana-ammunition') {
    const gained = Math.min(
      pickup.amount,
      MANA_AMMUNITION[pickup.ammoType].max - (wizard.manaPouch?.[pickup.ammoType] || 0),
    );
    if (gained <= 0) return false;
    pickup.collectedBy = wizard.id;
    addManaAmmunition(wizard, pickup.ammoType, gained);
    pickup.amount -= gained;
    if (pickup.amount > 0) pickup.collectedBy = null;
    state.inventoryRevision++;
    state.events.push({
      type: 'mana-pickup',
      groundId: pickup.id,
      wizardId: wizard.id,
      ammoType: pickup.ammoType,
      amount: gained,
      x: pickup.x,
      y: pickup.y,
    });
    return true;
  }

  if (action === 'upgrade') {
    const current = wizard.baseWeaponRarity || 'common';
    if (
      pickup.lootType !== 'weapon-upgrade-rune' ||
      LOOT_RARITY_ORDER.indexOf(pickup.rarity) <= LOOT_RARITY_ORDER.indexOf(current)
    )
      return false;
    pickup.collectedBy = wizard.id;
    upgradeBaseWeaponRarity(wizard, pickup.rarity);
    state.inventoryRevision++;
    state.events.push({
      type: 'weapon-upgrade',
      groundId: pickup.id,
      wizardId: wizard.id,
      previousRarity: current,
      rarity: wizard.baseWeaponRarity,
      upgraded: true,
      x: pickup.x,
      y: pickup.y,
    });
    return true;
  }

  const item = itemFromGround(pickup);
  const capacity = inventoryCapacity(wizard, item);
  if (capacity <= 0 && action !== 'swap') return false;
  if (capacity <= 0) {
    const index = wizard.selectedInventorySlot ?? 0;
    const old = inventorySlots(wizard)[index];
    if (!old) return false;
    const position = nearbyDropPoint(state, pickup.x, pickup.y, state.nextGroundItemId);
    if (!position) return false;
    const amount = Math.min(item.quantity, stackLimit(item, ATTACKS));
    pickup.collectedBy = wizard.id;
    wizard.inventorySlots[index] = { ...item, quantity: amount };
    pickup.quantity = item.quantity - amount;
    if (pickup.quantity > 0) pickup.collectedBy = null;
    createDroppedGroundItem(state, old, position, wizard.id);
    forgetAttackIfGone(wizard, old.attackId);
    refreshEquippedAttack(wizard, item.attackId);
    state.inventoryRevision++;
    state.events.push({
      type: 'inventory-swap',
      groundId: pickup.id,
      wizardId: wizard.id,
      item,
      droppedItem: old,
      slot: index,
      x: pickup.x,
      y: pickup.y,
    });
    return true;
  }

  const amount = Math.min(item.quantity, capacity);
  pickup.collectedBy = wizard.id;
  putInInventory(wizard, item, amount);
  pickup.quantity = item.quantity - amount;
  if (pickup.quantity > 0) pickup.collectedBy = null;
  const equipped = refreshEquippedAttack(wizard, item.attackId);
  state.inventoryRevision++;
  state.events.push({
    type: 'inventory-pickup',
    groundId: pickup.id,
    wizardId: wizard.id,
    item: { ...item, quantity: amount },
    equipped,
    compatible: !item.attackId || isAttackCompatible(wizard, item.attackId),
    x: pickup.x,
    y: pickup.y,
  });
  return true;
}

export function dropInventoryItem(state, wizard, slotIndex, entireStack = false) {
  if (!state?.wizards?.includes(wizard) || !wizard.alive) return false;
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= INVENTORY_SLOT_COUNT)
    return false;
  const slot = inventorySlots(wizard)[slotIndex];
  if (!slot) return false;
  const position = nearbyDropPoint(state, wizard.x, wizard.y, state.nextGroundItemId);
  if (!position) return false;
  const quantity = entireStack ? slot.quantity : 1;
  const dropped = { ...slot, quantity };
  if (quantity === slot.quantity) wizard.inventorySlots[slotIndex] = null;
  else slot.quantity -= quantity;
  forgetAttackIfGone(wizard, dropped.attackId);
  const pickup = createDroppedGroundItem(state, dropped, position, wizard.id);
  state.inventoryRevision++;
  state.events.push({
    type: 'inventory-drop',
    wizardId: wizard.id,
    item: dropped,
    groundId: pickup.id,
    x: pickup.x,
    y: pickup.y,
  });
  return pickup;
}

export function dropEliminatedInventory(state, wizard) {
  if (wizard.lootDropped) return;
  wizard.lootDropped = true;
  let sequence = 0;
  for (const item of inventorySlots(wizard)) {
    if (!item) continue;
    const position = nearbyDropPoint(state, wizard.x, wizard.y, sequence++);
    if (position) createDroppedGroundItem(state, item, position, wizard.id);
  }
  wizard.inventorySlots = Array(INVENTORY_SLOT_COUNT).fill(null);
  for (const ammoType of MANA_AMMUNITION_ORDER) {
    const amount = Math.floor((wizard.manaPouch?.[ammoType] || 0) / 2);
    if (!amount) continue;
    const position = nearbyDropPoint(state, wizard.x, wizard.y, sequence++);
    if (!position) continue;
    createDroppedGroundItem(
      state,
      { lootType: 'mana-ammunition', ammoType, amount, rarity: 'common', quantity: 1 },
      position,
      wizard.id,
    );
    wizard.manaPouch[ammoType] -= amount;
  }
  wizard.attackInventory = [];
  wizard.attackSlots = Array(ATTACK_SLOT_COUNT).fill(null);
  wizard.tierAttackId = null;
  state.inventoryRevision++;
}

export function collectNearbyMana(state, wizard) {
  for (const pickup of state.attackPickups || []) {
    if (
      pickup.collectedBy == null &&
      pickup.lootType === 'mana-ammunition' &&
      dist(wizard.x, wizard.y, pickup.x, pickup.y) <= ATTACK_PICKUP_RADIUS + WIZARD.radius
    ) {
      collectGroundItem(state, wizard, pickup.id);
    }
  }
}

// ---- State -----------------------------------------------------------------

// Build a fresh match. `players` humans (1 or 2) + `bots` computer wizards.
export function createState({
  players = 1,
  bots = 9,
  opening = false,
  baseWeapon = 'apprentice-wand',
  lootSeed = null,
} = {}) {
  // A previous match may have excavated this island. Generate fresh spawns,
  // scenery and loot against the immutable original before activating the new
  // match-local terrain field.
  setActiveTerrain(null);
  const chosenBaseWeapon = BASE_WEAPONS[baseWeapon] ? baseWeapon : 'apprentice-wand';
  const total = players + bots;
  const ring = opening ? 155 : STORM.startRadius * 0.72;
  const obstacles = buildObstacles();
  const wizards = [];
  for (let i = 0; i < total; i++) {
    const angle = (i / total) * Math.PI * 2;
    const human = i < players;
    // Nudge the spawn point out of any tree/house/rock it landed inside.
    const sx = STORM.cx + Math.cos(angle) * ring;
    const sy = STORM.cy + Math.sin(angle) * ring;
    const [spawnX, spawnY] = opening
      ? [sx, sy]
      : resolveObstacles(sx, sy, WIZARD.radius, obstacles);
    const wizard = {
      id: i,
      isPlayer: human,
      playerIndex: human ? i : -1, // which human controls this wizard
      color: COLORS[i % COLORS.length],
      x: spawnX,
      y: spawnY,
      vx: 0,
      vy: 0,
      heading: angle + Math.PI, // face roughly toward the center
      health: WIZARD.maxHealth,
      shield: 0,
      slowFactor: 1,
      slowTimer: 0,
      hasteFactor: 1,
      hasteTimer: 0,
      empowerFactor: 1,
      empowerTimer: 0,
      curseTimer: 0,
      regenTimer: 0,
      regenHealthPerSecond: 0,
      regenShieldPerSecond: 0,
      abilityFlightTimer: 0,
      runeKeys: 0,
      mana: 0, // legacy display field; real ammunition lives in the Mana Pouch
      manaMax: 0,
      manaPouch: createManaPouch(),
      itemUse: null,
      tierAttackId: null,
      baseWeaponRarity: 'common',
      attackRarities: {},
      dotDamage: 0,
      dotTimer: 0,
      cooldowns: freshCooldowns(), // compatibility map; values always remain zero
      slashTimer: 0, // >0 while a melee slash is being drawn
      castTimer: 0, // 1 -> 0 over the cast animation (wand-arm thrust)
      aiMoveX: 0, // low-passed AI move direction (kills frame-to-frame jitter)
      aiMoveY: 0,
      targetId: null, // current AI target, kept stable via hysteresis
      wantClimb: false, // true while the player holds forward (opt-in to climbing)
      climbDown: false, // S descends only while attached to a wall
      climbJumpOff: false, // one-step S + Space wall-jump request
      runningJump: false, // true only when this jump began while sprinting forward
      climbState: null, // null | 'wall' (ascending) | 'top' (standing on it)
      climbOver: null, // obstacle currently being climbed / stood on
      climbH: 0, // current climb height in world units (0 on the ground)
      climbBlocked: false, // holding still beneath an unsafe/blocked mantle
      climbNearby: [], // tiny local collision set used while climbing (not whole map)
      running: false,
      stamina: STAMINA.max,
      staminaRegenDelay: 0,
      staminaExhausted: false,
      jumpH: 0, // temporary height above the current ground/platform
      jumpV: 0, // vertical jump velocity
      knockbackX: 0,
      knockbackY: 0,
      inWater: false,
      swimming: false,
      waterVelocity: 0,
      waterMoveScale: 1,
      waterLevel: null,
      digMode: false,
      drillCharge: 0,
      drill: null,
      drillButtonWasHeld: false,
      drillFeetY: null,
      lastTerrainFeetY: terrainHeight(spawnX, spawnY),
      digRadius: MAGICAL_DRILL.precisionRadius,
      digLength: MAGICAL_DRILL.precisionLength,
      drillFallV: 0,
      drillEscapeReady: false,
      nextPrecisionDigTime: 0,
      flying: false, // free-flight toggle (sandbox only)
      flyH: 0, // current flight altitude in world units
      openingH: opening ? OPENING.platformHeight - terrainHeight(spawnX, spawnY) : 0,
      slowFalling: false,
      openingLanded: !opening,
      chosenPortal: null,
      portalLandingX: null,
      portalLandingY: null,
      aimTargetId: null, // exact wizard selected by the center-screen ray
      bodyHeight: human ? PLAYER_BODY_HEIGHT : BODY_HEIGHT,
      weaponLocked: true, // base weapon cannot change after the match is created
      inventorySlots: Array(INVENTORY_SLOT_COUNT).fill(null),
      selectedInventorySlot: 0,
      interactionHeldTime: 0,
      interactionGroundId: null,
      interactionTriggered: false,
      attackInventory: [], // equipped/available attacks; physical items live in inventorySlots
      attackSlots: Array(ATTACK_SLOT_COUNT).fill(null), // starts with NO attacks
      attack: null,
      alive: true,
      placement: 0, // final rank once knocked out (1 = winner)
    };
    // Human players use the confirmed pre-match choice. Bots rotate through all
    // six focuses and must collect a compatible attack before they can fight.
    const weaponId = human
      ? chosenBaseWeapon
      : BASE_WEAPON_ORDER[(i - players) % BASE_WEAPON_ORDER.length];
    Object.defineProperty(wizard, 'baseWeaponId', {
      value: weaponId,
      enumerable: true,
      writable: false,
      configurable: false,
    });
    wizards.push(wizard);
  }
  const resolvedLootSeed = Number.isInteger(lootSeed)
    ? lootSeed >>> 0
    : (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const attackPickups = createAttackPickups(obstacles, resolvedLootSeed);
  const state = {
    wizards,
    obstacles, // solid scenery (trees, houses, rocks)
    spells: [], // in-flight bolts
    storm: { cx: STORM.cx, cy: STORM.cy, radius: STORM.startRadius },
    time: 0,
    over: false,
    winnerId: null,
    playerWon: false,
    // With no opponents it's a free-roam TESTING sandbox: the storm never closes
    // and the match never auto-ends, so you can explore the whole map.
    sandbox: bots === 0,
    events: [], // transient events for the wiring (casts, hits, deaths)
    baseWeaponId: chosenBaseWeapon,
    attackPickups,
    nextGroundItemId: attackPickups.length,
    inventoryRevision: 0,
    lootSeed: resolvedLootSeed,
    opening: createOpening(opening),
  };
  state.terrain = createTerrain(originalTerrainHeight);
  setActiveTerrain(state.terrain);
  for (const obstacle of state.obstacles) {
    // Only actual structures and major landmarks resist excavation. Ordinary
    // trees, cacti, and rocks do not turn the surrounding ground into a no-dig zone.
    if (obstacle.kind !== 'house' && !obstacle.landmark) continue;
    const radius =
      obstacle.kind === 'house'
        ? Math.hypot(obstacle.hw, obstacle.hd) + 24
        : (obstacle.r || obstacle.s || 20) + 12;
    state.terrain.markVolume({
      kind: 'indestructible',
      x: obstacle.x,
      z: obstacle.y,
      y: originalTerrainHeight(obstacle.x, obstacle.y),
      radius,
      height: obstacle.kind === 'house' ? 360 : 480,
    });
  }
  state.terrainFluids = createTerrainFluids(state.terrain, {
    naturalWaterAt: (x, z) => {
      const water = NATURAL_WATER.surfaceAt(x, z);
      if (!water) return null;
      const surface = originalTerrainHeight(x, z);
      // An intact riverbed must not leak into a tunnel beneath it.
      if (state.terrain.density(x, z, surface - 8) >= 0) return null;
      return { kind: 'water', level: water.level };
    },
  });
  const lavaX = HEIGHT_DES.x - 1000;
  const lavaZ = HEIGHT_DES.y;
  const lavaSurface = originalTerrainHeight(lavaX, lavaZ);
  state.terrainFluids.markSource({
    kind: 'lava',
    x: lavaX,
    z: lavaZ,
    y: lavaSurface - 170,
    radius: 100,
    level: lavaSurface - 80,
  });
  state.terrainSupport = createTerrainSupport(state.terrain, {
    materialAt: (x, z, y) => TERRAIN_MATERIALS[terrainMaterialAt(x, z, y)],
    onEdit: ({ operation }) => {
      state.terrainFluids.onTerrainEdit({ accepted: true, operation });
      const reach = operation.radius + operation.length / 2 + 24;
      for (const pickup of state.attackPickups) {
        if (
          pickup.collectedBy != null ||
          dist(pickup.x, pickup.y, operation.x, operation.z) > reach
        )
          continue;
        pickup.groundHeight = state.terrain.supportHeight(
          pickup.x,
          pickup.y,
          pickup.groundHeight + 16,
        );
      }
    },
    onCollapse: (collapse) => {
      state.events.push({
        type: 'terrain-collapse',
        x: collapse.x,
        y: collapse.z,
        worldZ: collapse.y,
        color: '#a07652',
        collapseId: collapse.id,
        first: collapse.first,
        centerX: collapse.centerX,
        centerY: collapse.centerZ,
        radius: collapse.radius,
      });
      if (!collapse.first) return;
      for (const wizard of state.wizards) {
        const feet = wizard.drillFeetY ?? terrainHeight(wizard.x, wizard.y);
        if (
          !wizard.alive ||
          dist(wizard.x, wizard.y, collapse.centerX, collapse.centerZ) > collapse.radius ||
          feet > collapse.y + 10 ||
          feet < collapse.y - 280
        )
          continue;
        const absorbed = Math.min(wizard.shield || 0, collapse.damage);
        wizard.shield -= absorbed;
        wizard.health -= collapse.damage - absorbed;
        state.events.push({ type: 'collapse-hit', victim: wizard.id, amount: collapse.damage });
      }
    },
  });
  return state;
}

export function humanWizards(state) {
  return state.wizards.filter((w) => w.isPlayer);
}

export function aliveCount(state) {
  return state.wizards.filter((w) => w.alive).length;
}

function updateStamina(wizard, wantsRun, isMoving, dt) {
  // Fully exhausting stamina locks sprint only during the requested four-second
  // pause. Once recovery begins, the player may spend whatever has returned.
  if (wizard.staminaExhausted) {
    wizard.running = false;
    if (wizard.staminaRegenDelay > 0) {
      wizard.staminaRegenDelay = Math.max(0, wizard.staminaRegenDelay - dt);
      return;
    }
    wizard.staminaExhausted = false;
    wizard.stamina = Math.min(STAMINA.max, wizard.stamina + STAMINA.regenPerSec * dt);
    return;
  }

  const sprinting = wantsRun && isMoving && wizard.stamina > 0;
  wizard.running = sprinting;
  if (sprinting) {
    wizard.stamina = Math.max(0, wizard.stamina - STAMINA.drainPerSec * dt);
    if (wizard.stamina <= 0) {
      wizard.stamina = 0;
      wizard.staminaExhausted = true;
      wizard.staminaRegenDelay = STAMINA.emptyDelay;
    } else {
      // Continually reset this while sprinting, so recovery begins 1.5 seconds
      // after the actual moment the player stops.
      wizard.staminaRegenDelay = STAMINA.partialDelay;
    }
    return;
  }

  if (wizard.stamina >= STAMINA.max) return;
  if (wizard.staminaRegenDelay > 0) {
    wizard.staminaRegenDelay = Math.max(0, wizard.staminaRegenDelay - dt);
  } else {
    wizard.stamina = Math.min(STAMINA.max, wizard.stamina + STAMINA.regenPerSec * dt);
  }
}

// ---- Movement + casting ----------------------------------------------------

// The height a wizard mantles onto for an obstacle (roof peak for houses; a
// capped height for trees/rocks so you don't stand atop a giant pine).
function climbTopOf(o) {
  // This 1.7 multiplier matches the rendered pitched roof's apex.
  return o.kind === 'house' ? o.h * 1.7 : Math.min(o.top, 150);
}

function climbTopWorldY(o) {
  return obstacleGroundHeight(o) + climbTopOf(o);
}

function climbTopOffsetAt(o, x, y) {
  return climbTopWorldY(o) - terrainHeight(x, y);
}

function obstacleBoundRadius(o) {
  return o.kind === 'house' ? Math.hypot(o.hw, o.hd) : o.r || 0;
}

// Build a small collision set ONCE when the wall is grabbed. Previously every
// climbing frame repeatedly swept the entire one-square-mile prop list, which
// caused visible hitches around complex ledges and villages.
function nearbyClimbObstacles(climbed, obstacles) {
  const base = obstacleBoundRadius(climbed);
  return (obstacles || []).filter((other) => {
    if (other === climbed || other.soft) return false;
    const reach = base + obstacleBoundRadius(other) + WIZARD.radius + CLIMB.wallGap + 80;
    return dist(climbed.x, climbed.y, other.x, other.y) <= reach;
  });
}

function mantleIsBlocked(wizard, x, y, topWorldY) {
  for (const other of wizard.climbNearby || []) {
    // Props wholly below the destination platform cannot block the wizard's
    // body. Taller nearby geometry acts as an overhead ledge/wall.
    const otherWorldTop = obstacleGroundHeight(other) + (other.top || climbTopOf(other));
    if (otherWorldTop <= topWorldY + 6) continue;
    const [px, py] = pushOutOfObstacle(x, y, WIZARD.radius, other);
    if (px !== x || py !== y) return true;
  }
  return false;
}

// Slide a wizard along a direction, kept inside the arena and out of scenery.
// A PLAYER holding forward into a surface CLIMBS it: they grab the wall, ascend
// at their own pace, mantle onto the top, and can walk around up there — then
// walk off an edge to drop back down. See climbWall / walkOnTop.
export function moveWizard(wizard, dx, dy, dt, obstacles) {
  if (wizard.flying) {
    wizard.climbState = null;
    wizard.climbOver = null;
    wizard.climbBlocked = false;
    wizard.climbNearby = [];
    wizard.jumpH = 0;
    wizard.jumpV = 0;
    const dir = normalize(dx, dy);
    if (!dir.x && !dir.y) return;
    let x = wizard.x + dir.x * FLY.speed * dt;
    let y = wizard.y + dir.y * FLY.speed * dt;
    const d = dist(x, y, 0, 0);
    if (d > ARENA.radius) {
      x = (x / d) * ARENA.radius;
      y = (y / d) * ARENA.radius;
    }
    wizard.x = x;
    wizard.y = y;
    return;
  }
  if (wizard.climbState === 'wall') return climbWall(wizard, dx, dy, dt);
  if (wizard.climbState === 'terrain-wall') return climbTerrainWall(wizard, dx, dy, dt, obstacles);
  if (wizard.climbState === 'top') return walkOnTop(wizard, dx, dy, dt);

  const dir = normalize(dx, dy);
  if (dir.x === 0 && dir.y === 0) return;
  const speed =
    (wizard.running ? WIZARD.runSpeed : WIZARD.speed) *
    (wizard.waterMoveScale ?? 1) *
    (wizard.slowFactor || 1) *
    (wizard.hasteFactor || 1);
  let x = wizard.x + dir.x * speed * dt;
  let y = wizard.y + dir.y * speed * dt;
  const d = dist(x, y, 0, 0);
  if (d > ARENA.radius) {
    x = (x / d) * ARENA.radius;
    y = (y / d) * ARENA.radius;
  }
  const terrain = activeTerrain;
  const feet = wizard.drillFeetY ?? terrainHeight(wizard.x, wizard.y);
  const inExcavation =
    wizard.drillFeetY != null ||
    originalTerrainHeight(wizard.x, wizard.y) - terrainHeight(wizard.x, wizard.y) > 24;
  if (
    terrain &&
    inExcavation &&
    [30, 84, 150].some((height) => terrain.density(x, y, feet + (wizard.jumpH || 0) + height) >= 0)
  ) {
    if (
      wizard.isPlayer &&
      wizard.wantClimb &&
      wizard.runningJump &&
      ((wizard.jumpH || 0) > 0 || (wizard.jumpV || 0) > 0)
    ) {
      wizard.climbState = 'terrain-wall';
      wizard.terrainClimbX = dir.x;
      wizard.terrainClimbY = dir.y;
      wizard.climbH = wizard.jumpH || 0;
      wizard.jumpH = 0;
      wizard.jumpV = 0;
      wizard.runningJump = false;
      wizard.drillFeetY ??= feet;
      wizard.drillFallV = 0;
    }
    return;
  }
  if (obstacles) {
    // A wall grab requires a running jump. Walking, a standing jump, or simply
    // sprinting into scenery stays blocked by the normal collision response.
    if (
      wizard.isPlayer &&
      wizard.wantClimb &&
      wizard.runningJump &&
      ((wizard.jumpH || 0) > 0 || (wizard.jumpV || 0) > 0)
    ) {
      for (const o of obstacles) {
        if (o.soft || o.climbable === false) continue;
        const [px, py] = pushOutOfObstacle(x, y, WIZARD.radius, o);
        if (px === x && py === y) continue; // not overlapping this one
        const to = normalize(o.x - wizard.x, o.y - wizard.y);
        if (dir.x * to.x + dir.y * to.y > 0.4) {
          wizard.climbState = 'wall';
          wizard.runningJump = false;
          wizard.climbOver = o;
          wizard.climbBlocked = false;
          wizard.climbNearby = nearbyClimbObstacles(o, obstacles);
          const [gx, gy] = resolveObstacles(x, y, WIZARD.radius, obstacles);
          // The collider is narrower than the rendered wizard. Pin the climbing
          // body an extra step away so robes, knees and elbows do not enter the
          // wall while the larger animation plays.
          const [wx, wy] = pushOutOfObstacle(gx, gy, WIZARD.radius + CLIMB.wallGap, o);
          wizard.x = wx;
          wizard.y = wy;
          return;
        }
      }
    }
    const [rx, ry] = resolveObstacles(x, y, WIZARD.radius, obstacles);
    wizard.x = rx;
    wizard.y = ry;
    return;
  }
  wizard.x = x;
  wizard.y = y;
}

// Cut earth uses the same W/S wall controls as scenery. The feet remain at a
// fixed world height while attached, then settle onto the actual rim surface.
function climbTerrainWall(wizard, dx, dy, dt, obstacles) {
  const terrain = activeTerrain;
  if (!terrain) {
    wizard.climbState = null;
    return;
  }
  const base = wizard.drillFeetY ?? terrainHeight(wizard.x, wizard.y);
  const towardX = wizard.terrainClimbX;
  const towardY = wizard.terrainClimbY;
  if (wizard.climbJumpOff) {
    wizard.drillFeetY = base + wizard.climbH;
    wizard.drillFallV = 0;
    wizard.x -= towardX * (WIZARD.radius + CLIMB.wallGap);
    wizard.y -= towardY * (WIZARD.radius + CLIMB.wallGap);
    wizard.jumpV = JUMP.velocity * 0.72;
    wizard.jumpH = 0;
    wizard.climbH = 0;
    wizard.climbState = null;
    wizard.climbJumpOff = false;
    return;
  }
  const vertical = (wizard.wantClimb ? 1 : 0) - (wizard.climbDown ? 1 : 0);
  wizard.climbH = Math.max(0, wizard.climbH + vertical * CLIMB.up * dt);
  const reach = WIZARD.radius * 2 + CLIMB.wallGap + 12;
  const mantleX = wizard.x + towardX * reach;
  const mantleY = wizard.y + towardY * reach;
  const rim = terrain.surfaceHeight(mantleX, mantleY);
  if (wizard.climbH >= rim - base && rim > base + 20) {
    const [clearX, clearY] = resolveObstacles(mantleX, mantleY, WIZARD.radius, obstacles || []);
    if (
      clearX === mantleX &&
      clearY === mantleY &&
      [30, 84, 150].every((height) => terrain.density(mantleX, mantleY, rim + height) < 0)
    ) {
      wizard.x = mantleX;
      wizard.y = mantleY;
      wizard.drillFeetY = rim;
      wizard.drillFallV = 0;
      wizard.climbH = 0;
      wizard.climbState = null;
      return;
    }
    wizard.climbH = Math.max(0, rim - base - 1);
  }
  if (wizard.climbH <= 0 && wizard.climbDown) {
    wizard.climbH = 0;
    wizard.climbState = null;
  }
  // Horizontal motion while climbing is limited to the tangent of the wall.
  const side = -dy * towardX + dx * towardY;
  const nextX = wizard.x - towardY * side * CLIMB.side * dt;
  const nextY = wizard.y + towardX * side * CLIMB.side * dt;
  if (
    [30, 84].every((height) => terrain.density(nextX, nextY, base + wizard.climbH + height) < 0)
  ) {
    wizard.x = nextX;
    wizard.y = nextY;
  }
}

// On a wall: W ascends, no vertical key holds position, and S descends. S + Space
// jumps away. Strafe to shimmy sideways; reaching the top mantles onto it.
function climbWall(wizard, dx, dy, dt) {
  const o = wizard.climbOver;
  if (!o) {
    wizard.climbState = null;
    wizard.climbBlocked = false;
    wizard.climbNearby = [];
    return;
  }

  // S + Space detaches from the wall, preserves the current world height, and
  // adds a short upward/backward jump away from the climbed surface.
  if (wizard.climbJumpOff) {
    const away = normalize(wizard.x - o.x, wizard.y - o.y);
    wizard.x += away.x * (WIZARD.radius + CLIMB.wallGap);
    wizard.y += away.y * (WIZARD.radius + CLIMB.wallGap);
    wizard.jumpH = Math.max(0, wizard.climbH || 0);
    wizard.jumpV = JUMP.velocity * 0.72;
    wizard.climbH = 0;
    wizard.climbState = null;
    wizard.climbOver = null;
    wizard.climbBlocked = false;
    wizard.climbNearby = [];
    wizard.climbJumpOff = false;
    wizard.runningJump = false;
    return;
  }

  // A blocked mantle remains a stable grip until S is deliberately held.
  if (wizard.climbBlocked) {
    if (!wizard.climbDown) return;
    wizard.climbBlocked = false;
  }
  const verticalInput = (wizard.wantClimb ? 1 : 0) - (wizard.climbDown ? 1 : 0);
  wizard.climbH += verticalInput > 0 ? CLIMB.up * dt : verticalInput < 0 ? -CLIMB.up * 0.9 * dt : 0;
  // Shimmy horizontally, then re-pin to the wall face (stay just outside it).
  // S is a vertical wall control, so it must not also move away from the wall.
  const dir = wizard.climbDown ? { x: 0, y: 0 } : normalize(dx, dy);
  let x = wizard.x + dir.x * CLIMB.side * dt;
  let y = wizard.y + dir.y * CLIMB.side * dt;
  [x, y] = pushOutOfObstacle(x, y, WIZARD.radius + CLIMB.wallGap, o);
  // Only nearby solids are relevant while attached to this wall. This usually
  // loops over zero or one prop instead of thousands.
  for (const other of wizard.climbNearby || []) {
    [x, y] = pushOutOfObstacle(x, y, WIZARD.radius, other);
  }
  wizard.x = x;
  wizard.y = y;
  const topWorldY = climbTopWorldY(o);
  const topOffset = topWorldY - terrainHeight(wizard.x, wizard.y);
  if (wizard.climbH >= topOffset) {
    const toward = normalize(o.x - wizard.x, o.y - wizard.y);
    // Start far enough inside that the complete character collider clears the
    // roof edge. The old landing had only a 10-unit inset for a 16-unit body,
    // which visibly put the wizard through the roof and caused state thrashing.
    const mantleStep = WIZARD.radius * 2 + CLIMB.wallGap + 8;
    const mantleX = wizard.x + toward.x * mantleStep;
    const mantleY = wizard.y + toward.y * mantleStep;
    if (mantleIsBlocked(wizard, mantleX, mantleY, topWorldY)) {
      wizard.climbH = Math.max(0, topOffset - 1);
      wizard.climbBlocked = true;
      return;
    }
    wizard.climbH = climbTopOffsetAt(o, mantleX, mantleY);
    wizard.climbState = 'top';
    wizard.climbBlocked = false;
    // Mantle toward the obstacle centre. This always lands inside the top even
    // when the player approached a corner at an angle.
    wizard.x = mantleX;
    wizard.y = mantleY;
  } else if (wizard.climbH <= 0) {
    wizard.climbH = 0;
    wizard.climbState = null;
    wizard.climbOver = null;
    wizard.climbBlocked = false;
    wizard.climbNearby = [];
  }
}

// Standing on top of an obstacle: walk around freely up there; walk off the edge
// (centre leaves the footprint) and you drop (update applies gravity to climbH).
function walkOnTop(wizard, dx, dy, dt) {
  const o = wizard.climbOver;
  if (!o) {
    wizard.climbState = null;
    wizard.climbBlocked = false;
    wizard.climbNearby = [];
    return;
  }
  // Keep feet at the prop's absolute roof height while terrain beneath the
  // character changes. This is essential for large cabins built across hills.
  wizard.climbH = climbTopOffsetAt(o, wizard.x, wizard.y);
  const dir = normalize(dx, dy);
  const speed =
    (wizard.running ? WIZARD.runSpeed : WIZARD.speed) *
    (wizard.slowFactor || 1) *
    (wizard.hasteFactor || 1);
  let x = wizard.x + dir.x * speed * dt;
  let y = wizard.y + dir.y * speed * dt;
  const d = dist(x, y, 0, 0);
  if (d > ARENA.radius) {
    x = (x / d) * ARENA.radius;
    y = (y / d) * ARENA.radius;
  }
  // Bump off nearby solids using the cache built when this wall was grabbed.
  // Scanning every tree, rock and house on the island here caused the ledge
  // transition to hitch badly on the detailed map.
  for (const ob of wizard.climbNearby || []) {
    const [px, py] = pushOutOfObstacle(x, y, WIZARD.radius, ob);
    x = px;
    y = py;
  }
  wizard.x = x;
  wizard.y = y;
  // `pushOutOfObstacle(..., 0)` changes a point only while it is INSIDE the
  // footprint. The old check was reversed, so every successful mantle was
  // immediately treated as a fall and could cycle back into climbing.
  const [ix, iy] = pushOutOfObstacle(wizard.x, wizard.y, 0, o);
  const insideTop = ix !== wizard.x || iy !== wizard.y;
  if (!insideTop) {
    wizard.climbState = null;
    wizard.climbOver = null; // climbH stays; update() eases it down (fall)
    wizard.climbBlocked = false;
    wizard.climbNearby = [];
  }
}

// Cast a spell by id (defaults to the bolt). There is deliberately no cooldown;
// every input step may produce another cast.
export function castSpell(state, wizard, spellId = 'bolt') {
  const spell = SPELLS[spellId] || SPELLS.bolt;
  const cd = wizard.cooldowns || (wizard.cooldowns = freshCooldowns());

  if (spell.type === 'projectile') castBolt(state, wizard);
  else if (spell.type === 'melee') castSlash(state, wizard, spell);
  else if (spell.type === 'self') {
    wizard.health = Math.min(WIZARD.maxHealth, wizard.health + spell.heal);
    state.events.push({ type: 'heal', id: wizard.id, amount: spell.heal });
  }

  cd[spellId] = 0;
  wizard.castTimer = 1; // kick off the wand-arm cast animation
  return true;
}

// Match-facing casting goes through the equipped attack. Keeping this wrapper
// separate preserves castSpell as the low-level spell-effect dispatcher while
// enforcing inventory and weapon compatibility for real matches.
export function castAttack(state, wizard, attackId, castDuration = ATTACK_CAST_STEP) {
  const attack = ATTACKS[attackId];
  if (!attack || !wizard.attackSlots?.includes(attackId)) return false;
  if (!isAttackCompatible(wizard, attackId)) return false;
  if (wizard.itemUse) return false;
  if (attack.consumable && attack.channelTime > 0) {
    wizard.itemUse = { attackId, remaining: attack.channelTime, total: attack.channelTime };
    wizard.castTimer = 1;
    state.events.push({
      type: 'item-use-start',
      wizardId: wizard.id,
      attackId,
      duration: attack.channelTime,
      color: attack.color,
    });
    return true;
  }
  const cooldowns = wizard.cooldowns || (wizard.cooldowns = freshCooldowns());
  const cooldownKey = `attack:${attackId}`;
  const effectiveAttack = effectiveAttackForWizard(wizard, attackId);
  const rarity = LOOT_RARITIES[effectiveAttack.rarity];
  const manaCost =
    typeof effectiveAttack.manaPerSecond === 'number'
      ? Math.max(
          0,
          Math.round(
            effectiveAttack.manaPerSecond * Math.max(0, castDuration) * rarity.energyUse * 100,
          ) / 100,
        )
      : effectiveAttack.manaCost || 0;
  if (manaAmmunitionAmount(wizard, attackId) < manaCost) return false;

  const resolvedAttack = resolveShiftingAttack(state, wizard, effectiveAttack);
  let cast = true;
  if (effectiveAttack.kind === 'projectile') spawnAttackProjectiles(state, wizard, resolvedAttack);
  else if (effectiveAttack.kind === 'beam') castBeamAttack(state, wizard, resolvedAttack);
  else if (effectiveAttack.kind === 'melee') castAttackMelee(state, wizard, resolvedAttack);
  else if (effectiveAttack.kind === 'nova') castNovaAttack(state, wizard, resolvedAttack);
  else if (effectiveAttack.kind === 'heal') castHealAttack(state, wizard, resolvedAttack);
  else if (effectiveAttack.kind === 'shield') castShieldAttack(state, wizard, resolvedAttack);
  else if (effectiveAttack.kind === 'dash') castDashAttack(state, wizard, resolvedAttack);
  else if (effectiveAttack.kind === 'trap') placeAttackTrap(state, wizard, resolvedAttack);
  else if (effectiveAttack.kind === 'grapple') castGrappleAttack(state, wizard, resolvedAttack);
  else if (effectiveAttack.kind === 'movement') castMovementAttack(state, wizard, resolvedAttack);
  else if (effectiveAttack.kind === 'summon') castSummonAttack(state, wizard, resolvedAttack);
  else if (effectiveAttack.kind === 'utility') castUtilityAttack(state, wizard, resolvedAttack);
  else cast = false;

  if (!cast) return false;
  if (!spendManaAmmunition(wizard, attackId, manaCost)) return false;
  if (attack.consumable) {
    consumeInventoryAttack(wizard, attackId);
  }
  cooldowns[cooldownKey] = 0;
  wizard.attack = attack.consumable ? null : attackId;
  wizard.castTimer = 1;
  state.events.push({
    type: 'attack-cast',
    wizardId: wizard.id,
    attackId,
    kind: attack.kind,
    color: attack.color,
    rarity: effectiveAttack.rarity,
    rarityColor: effectiveAttack.rarityColor,
    manaCost,
    ammoType: attack.ammoType,
    consumed: !!attack.consumable,
  });
  return true;
}

function consumeInventoryAttack(wizard, attackId) {
  const physical = inventorySlots(wizard).find((slot) => slot?.attackId === attackId);
  if (physical) {
    physical.quantity -= 1;
    if (physical.quantity > 0) return;
    wizard.inventorySlots[wizard.inventorySlots.indexOf(physical)] = null;
  }
  wizard.attackInventory = (wizard.attackInventory || []).filter((id) => id !== attackId);
  wizard.attackSlots = (wizard.attackSlots || []).map((id) => (id === attackId ? null : id));
  if (wizard.attackRarities) delete wizard.attackRarities[attackId];
  if (wizard.tierAttackId === attackId) wizard.tierAttackId = null;
}

function updateItemUse(state, wizard, dt) {
  if (!wizard.itemUse) return;
  wizard.itemUse.remaining = Math.max(0, wizard.itemUse.remaining - dt);
  if (wizard.itemUse.remaining > 0) return;
  const attackId = wizard.itemUse.attackId;
  const attack = ATTACKS[attackId];
  wizard.itemUse = null;
  if (!attack || !wizard.attackInventory?.includes(attackId)) return;
  if (attack.kind === 'heal') castHealAttack(state, wizard, attack);
  else if (attack.kind === 'shield') castShieldAttack(state, wizard, attack);
  else if (attack.kind === 'utility') castUtilityAttack(state, wizard, attack);
  else return;
  consumeInventoryAttack(wizard, attackId);
  wizard.attack = null;
  state.events.push({
    type: 'item-use-complete',
    wizardId: wizard.id,
    attackId,
    color: attack.color,
  });
}

function resolveShiftingAttack(state, wizard, attack) {
  if (!attack.shifting) return attack;
  const forms = [
    { form: 'heavy', damage: attack.damage * 1.7, speed: attack.speed * 0.72, radius: 22 },
    {
      form: 'rapid',
      damage: attack.damage * 0.58,
      speed: attack.speed * 1.5,
      count: 3,
      spread: 0.12,
    },
    { form: 'seeking', damage: attack.damage * 0.85, speed: attack.speed * 0.8, homing: 6 },
    { form: 'explosive', explosionRadius: 150, splashDamage: attack.damage * 0.7 },
  ];
  const form = forms[Math.floor(Math.random() * forms.length)];
  state.events.push({
    type: 'shift-form',
    wizardId: wizard.id,
    attackId: attack.id,
    form: form.form,
    color: attack.color,
  });
  return { ...attack, ...form };
}

export function attackCooldownRemaining(wizard, attackId) {
  void wizard;
  void attackId;
  return 0;
}

function attackOrigin(wizard) {
  const angle = wizard.heading;
  const bodyBase = wizardElevation(wizard);
  return {
    x: wizard.x + Math.cos(angle) * (WIZARD.radius + 8),
    y: wizard.y + Math.sin(angle) * (WIZARD.radius + 8),
    z: bodyBase + WAND.castHeight,
  };
}

function attackAim(wizard, origin) {
  const angle = wizard.heading;
  const tx = wizard.aimX ?? wizard.x + Math.cos(angle) * 600;
  const ty = wizard.aimY ?? wizard.y + Math.sin(angle) * 600;
  const tz = wizard.aimZ ?? WAND.castHeight;
  const dx = tx - origin.x;
  const dy = ty - origin.y;
  const dz = tz - origin.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  return { tx, ty, tz, dx: dx / length, dy: dy / length, dz: dz / length, length };
}

function empoweredDamage(wizard, amount) {
  return amount * (wizard.empowerTimer > 0 ? wizard.empowerFactor || 1 : 1);
}

function spawnAttackProjectiles(state, wizard, attack) {
  const origin = attackOrigin(wizard);
  const aim = attackAim(wizard, origin);
  const count = attack.count || 1;
  const totalSpread = attack.spread || 0;
  for (let index = 0; index < count; index++) {
    const curseWobble = wizard.curseTimer > 0 ? (Math.random() - 0.5) * 0.65 : 0;
    const offset = (count === 1 ? 0 : (index / (count - 1) - 0.5) * totalSpread) + curseWobble;
    const c = Math.cos(offset);
    const s = Math.sin(offset);
    const dx = aim.dx * c - aim.dy * s;
    const dy = aim.dx * s + aim.dy * c;
    const speed = attack.speed || WAND.speed;
    const preserveTarget = count === 1 || Math.abs(offset) < 0.001;
    const directTarget = preserveTarget
      ? state.wizards.find(
          (target) => target.id === wizard.aimTargetId && target.alive && target.id !== wizard.id,
        )
      : null;
    state.spells.push({
      kind: 'projectile',
      attackId: attack.id,
      x: origin.x,
      y: origin.y,
      z: origin.z,
      originX: origin.x,
      originY: origin.y,
      originGround: terrainHeight(wizard.x, wizard.y),
      targetId: directTarget?.id ?? null,
      targetDistance: directTarget ? aim.length : null,
      travelled: 0,
      vx: dx * speed,
      vy: dy * speed,
      vz: aim.dz * speed + speed * (attack.upward || 0),
      gravity: attack.gravity || 0,
      life: attack.life || 2.5,
      ownerId: wizard.id,
      radius: attack.radius || 10,
      damage: empoweredDamage(wizard, attack.damage || 0),
      color: attack.color,
      trail: attack.trail || 72,
      remainingPierce: attack.pierce || 0,
      bounces: attack.bounces || 0,
      hitIds: [],
      homing: attack.homing || 0,
      explosionRadius: attack.explosionRadius || 0,
      splashDamage: empoweredDamage(wizard, attack.splashDamage || 0),
      knockback: attack.knockback || 0,
      pull: attack.pull || 0,
      slow: attack.slow || 0,
      poison: attack.poison || 0,
      burn: attack.burn || 0,
      statusTime: attack.statusTime || 0,
      chain: attack.chain || 0,
      chainRange: attack.chainRange || 0,
    });
  }
  state.events.push({ type: 'cast', x: wizard.x, y: wizard.y, color: attack.color });
}

function targetDistanceFromLine(target, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = clamp(((target.x - x1) * dx + (target.y - y1) * dy) / lengthSq, 0, 1);
  return {
    distance: dist(target.x, target.y, x1 + dx * t, y1 + dy * t),
    along: t,
  };
}

function applyAttackStatus(target, attack) {
  if (attack.slow) {
    target.slowFactor = Math.min(target.slowFactor || 1, attack.slow);
    target.slowTimer = Math.max(target.slowTimer || 0, attack.statusTime || 1.5);
  }
  if (attack.poison || attack.burn) {
    const incoming = attack.poison || attack.burn;
    if (incoming >= (target.dotDamage || 0)) {
      target.dotDamage = incoming;
      target.dotKind = attack.burn ? 'burn' : 'poison';
    }
    target.dotTimer = Math.max(target.dotTimer || 0, attack.statusTime || 3);
  }
  if (attack.curse) {
    target.curseTimer = Math.max(target.curseTimer || 0, attack.statusTime || 6);
  }
}

function moveTargetByForce(state, target, sourceX, sourceY, amount) {
  if (!amount) return;
  const away = normalize(target.x - sourceX, target.y - sourceY);
  const sign = amount < 0 ? -1 : 1;
  let x = target.x + away.x * Math.abs(amount) * sign;
  let y = target.y + away.y * Math.abs(amount) * sign;
  const boundary = dist(x, y, 0, 0);
  if (boundary > ARENA.radius) {
    x = (x / boundary) * ARENA.radius;
    y = (y / boundary) * ARENA.radius;
  }
  [target.x, target.y] = resolveObstacles(x, y, WIZARD.radius, state.obstacles);
}

function addHitKnockback(target, sourceX, sourceY, strength) {
  let away = normalize(target.x - sourceX, target.y - sourceY);
  if (!away.x && !away.y)
    away = { x: Math.cos(target.heading || 0), y: Math.sin(target.heading || 0) };
  let vx = (target.knockbackX || 0) + away.x * strength;
  let vy = (target.knockbackY || 0) + away.y * strength;
  const speed = Math.hypot(vx, vy);
  if (speed > 650) {
    vx *= 650 / speed;
    vy *= 650 / speed;
  }
  target.knockbackX = vx;
  target.knockbackY = vy;
  if (target.climbState === 'wall' || target.climbState === 'terrain-wall') {
    target.climbState = null;
    target.climbOver = null;
    target.runningJump = false;
  }
}

// Advance a short physical slide rather than teleporting the victim. Small
// collision steps prevent strong hits from passing through thin walls.
export function stepHitKnockback(state, wizard, dt) {
  let vx = wizard.knockbackX || 0;
  let vy = wizard.knockbackY || 0;
  if (!wizard.alive || Math.hypot(vx, vy) < 2) {
    wizard.knockbackX = wizard.knockbackY = 0;
    return;
  }
  const decay = Math.exp(-8 * dt);
  if (!wizard.drill) {
    const travel = (1 - decay) / 8;
    const steps = Math.max(1, Math.ceil((Math.hypot(vx, vy) * travel) / 8));
    const feet = wizard.drillFeetY ?? terrainHeight(wizard.x, wizard.y);
    const elevation = (wizard.jumpH || 0) + (wizard.climbH || 0) + (wizard.flyH || 0);
    const bodyFeet = feet + elevation;
    const collisionObstacles =
      elevation > 0
        ? (state.obstacles || []).filter(
            (obstacle) =>
              obstacleGroundHeight(obstacle) + (obstacle.top || climbTopOf(obstacle)) >
              bodyFeet + 4,
          )
        : state.obstacles;
    const inExcavation =
      wizard.drillFeetY != null ||
      originalTerrainHeight(wizard.x, wizard.y) - terrainHeight(wizard.x, wizard.y) > 24;
    for (let step = 0; step < steps; step++) {
      const candidateX = wizard.x + (vx * travel) / steps;
      const candidateY = wizard.y + (vy * travel) / steps;
      const boundary = Math.hypot(candidateX, candidateY);
      const limit = ARENA.radius - WIZARD.radius;
      let x = boundary > limit ? (candidateX / boundary) * limit : candidateX;
      let y = boundary > limit ? (candidateY / boundary) * limit : candidateY;
      [x, y] = resolveObstacles(x, y, WIZARD.radius, collisionObstacles);
      if (
        state.terrain &&
        inExcavation &&
        [30, 84, 150].some((height) => state.terrain.density(x, y, bodyFeet + height) >= 0)
      ) {
        vx = vy = 0;
        break;
      }
      if (Math.abs(x - candidateX) > 0.001) vx = 0;
      if (Math.abs(y - candidateY) > 0.001) vy = 0;
      wizard.x = x;
      wizard.y = y;
    }
  }
  wizard.knockbackX = vx * decay;
  wizard.knockbackY = vy * decay;
}

function damageWithAttack(state, target, amount, attack, sourceX, sourceY) {
  if (!target?.alive || amount <= 0) return 0;
  if (target.regenStopsOnDamage) {
    target.regenTimer = 0;
    target.regenHealthPerSecond = 0;
    target.regenShieldPerSecond = 0;
    target.regenStopsOnDamage = false;
    state.events.push({ type: 'restoration-interrupted', wizardId: target.id });
  }
  let damage = amount;
  if ((target.shield || 0) > 0) {
    const absorbed = Math.min(target.shield, damage);
    target.shield -= absorbed;
    damage -= absorbed;
    state.events.push({ type: 'shield-hit', victim: target.id, amount: absorbed });
  }
  target.health -= damage;
  applyAttackStatus(target, attack);
  if (!attack.pull && attack.kind !== 'zone' && amount >= 1) {
    addHitKnockback(target, sourceX, sourceY, attack.knockback || clamp(amount * 6, 35, 360));
  }
  if (attack.pull) moveTargetByForce(state, target, sourceX, sourceY, -attack.pull);
  return damage;
}

function castBeamAttack(state, wizard, attack) {
  const origin = attackOrigin(wizard);
  const aim = attackAim(wizard, origin);
  const range = attack.range || 4000;
  const endX = origin.x + aim.dx * range;
  const endY = origin.y + aim.dy * range;
  const candidates = state.wizards
    .filter((target) => target.alive && target.id !== wizard.id)
    .map((target) => ({
      target,
      ...targetDistanceFromLine(target, origin.x, origin.y, endX, endY),
    }))
    .filter(
      ({ target, distance }) =>
        distance <= WIZARD.radius + (attack.width || 8) &&
        hasLineOfSight(wizard, target, state.obstacles),
    )
    .sort((a, b) => a.along - b.along);
  const exact = state.wizards.find(
    (target) => target.id === wizard.aimTargetId && target.alive && target.id !== wizard.id,
  );
  if (
    exact &&
    !candidates.some(({ target }) => target === exact) &&
    dist(wizard.x, wizard.y, exact.x, exact.y) <= range &&
    hasLineOfSight(wizard, exact, state.obstacles)
  ) {
    candidates.unshift({ target: exact, along: 0, distance: 0 });
  }
  const maxHits = 1 + (attack.pierce || 0);
  for (const { target } of candidates.slice(0, maxHits)) {
    damageWithAttack(
      state,
      target,
      empoweredDamage(wizard, attack.damage),
      attack,
      wizard.x,
      wizard.y,
    );
    state.events.push({
      type: 'hit',
      x: target.x,
      y: target.y,
      z: BODY_HEIGHT * 0.55,
      worldZ: terrainHeight(target.x, target.y) + BODY_HEIGHT * 0.55,
      color: attack.color,
      victim: target.id,
      impactPower: attack.damage,
    });
  }
  state.events.push({
    type: 'beam',
    x: origin.x,
    y: origin.y,
    z: origin.z,
    endX,
    endY,
    endZ: origin.z + aim.dz * range,
    color: attack.color,
    width: attack.width || 8,
  });
}

function targetsInArc(state, wizard, range, arc = Math.PI * 2) {
  const half = arc / 2;
  return state.wizards.filter((target) => {
    if (!target.alive || target.id === wizard.id) return false;
    if (dist(wizard.x, wizard.y, target.x, target.y) > range + WIZARD.radius) return false;
    if (arc >= Math.PI * 2 - 0.001) return true;
    const angle = Math.atan2(target.y - wizard.y, target.x - wizard.x);
    return Math.abs(normalizeAngle(angle - wizard.heading)) <= half;
  });
}

function castAttackMelee(state, wizard, attack) {
  wizard.slashTimer = 0.42;
  if (attack.haste) {
    wizard.hasteFactor = Math.max(wizard.hasteFactor || 1, attack.haste);
    wizard.hasteTimer = Math.max(wizard.hasteTimer || 0, attack.statusTime || 4);
  }
  for (const target of targetsInArc(state, wizard, attack.range, attack.arc)) {
    damageWithAttack(
      state,
      target,
      empoweredDamage(wizard, attack.damage),
      attack,
      wizard.x,
      wizard.y,
    );
    state.events.push({
      type: 'slashhit',
      x: target.x,
      y: target.y,
      victim: target.id,
      color: attack.color,
      impactPower: attack.damage,
    });
  }
  state.events.push({
    type: 'slash',
    x: wizard.x,
    y: wizard.y,
    dir: wizard.heading,
    color: attack.color,
    range: attack.range,
    impactPower: attack.damage,
  });
}

function castNovaAttack(state, wizard, attack) {
  for (const target of targetsInArc(state, wizard, attack.range)) {
    damageWithAttack(
      state,
      target,
      empoweredDamage(wizard, attack.damage),
      attack,
      wizard.x,
      wizard.y,
    );
  }
  state.events.push({
    type: 'nova',
    x: wizard.x,
    y: wizard.y,
    range: attack.range,
    impactPower: attack.damage,
    color: attack.color,
  });
}

function castHealAttack(state, wizard, attack) {
  wizard.health = Math.min(WIZARD.maxHealth, wizard.health + (attack.heal || 0));
  if (attack.shield) {
    wizard.shield = Math.min(attack.shieldCap || 100, (wizard.shield || 0) + attack.shield);
  }
  if (attack.healOverTime || attack.shieldOverTime) {
    const duration = attack.duration || 6;
    wizard.regenTimer = Math.max(wizard.regenTimer || 0, duration);
    wizard.regenHealthPerSecond = Math.max(
      wizard.regenHealthPerSecond || 0,
      (attack.healOverTime || 0) / duration,
    );
    wizard.regenShieldPerSecond = Math.max(
      wizard.regenShieldPerSecond || 0,
      (attack.shieldOverTime || 0) / duration,
    );
    wizard.regenStopsOnDamage = !!attack.stopsOnDamage;
  }
  if (attack.cleanse) {
    wizard.slowTimer = 0;
    wizard.slowFactor = 1;
    wizard.dotTimer = 0;
    wizard.dotDamage = 0;
  }
  state.events.push({ type: 'heal', id: wizard.id, amount: attack.heal || 0, color: attack.color });
}

function castShieldAttack(state, wizard, attack) {
  wizard.shield = Math.min(attack.shieldCap || 100, (wizard.shield || 0) + (attack.shield || 0));
  if (attack.damage && attack.range) castNovaAttack(state, wizard, attack);
  state.events.push({
    type: 'shield',
    id: wizard.id,
    x: wizard.x,
    y: wizard.y,
    radius: 85,
    amount: attack.shield,
    color: attack.color,
  });
}

function castDashAttack(state, wizard, attack) {
  const dx = Math.cos(wizard.heading);
  const dy = Math.sin(wizard.heading);
  const [x, y] = resolveObstacles(
    wizard.x + dx * attack.dash,
    wizard.y + dy * attack.dash,
    WIZARD.radius,
    state.obstacles,
  );
  wizard.x = x;
  wizard.y = y;
  castAttackMelee(state, wizard, attack);
  state.events.push({ type: 'blink', x, y, color: attack.color });
}

function placeAttackTrap(state, wizard, attack) {
  state.spells.push({
    kind: 'trap',
    attackId: attack.id,
    x: wizard.x,
    y: wizard.y,
    z: 3,
    originX: wizard.x,
    originY: wizard.y,
    originGround: terrainHeight(wizard.x, wizard.y),
    vx: 0,
    vy: 0,
    vz: 0,
    life: attack.life,
    armTime: attack.armTime,
    ownerId: wizard.id,
    radius: 16,
    damage: attack.damage,
    explosionRadius: attack.range,
    splashDamage: attack.damage,
    color: attack.color,
  });
  state.events.push({ type: 'trap', x: wizard.x, y: wizard.y, color: attack.color });
}

function castGrappleAttack(state, wizard, attack) {
  const origin = attackOrigin(wizard);
  const aim = attackAim(wizard, origin);
  const distance = Math.min(attack.range, aim.length);
  let x = wizard.x + aim.dx * distance;
  let y = wizard.y + aim.dy * distance;
  [x, y] = resolveObstacles(x, y, WIZARD.radius, state.obstacles);
  wizard.x = x;
  wizard.y = y;
  state.events.push({
    type: 'grapple',
    x: origin.x,
    y: origin.y,
    endX: x,
    endY: y,
    color: attack.color,
  });
}

function castMovementAttack(state, wizard, attack) {
  if (attack.dash) {
    const dx = Math.cos(wizard.heading);
    const dy = Math.sin(wizard.heading);
    [wizard.x, wizard.y] = resolveObstacles(
      wizard.x + dx * attack.dash,
      wizard.y + dy * attack.dash,
      WIZARD.radius,
      state.obstacles,
    );
  }
  if (attack.launch) {
    wizard.jumpV = Math.max(wizard.jumpV || 0, attack.launch);
    wizard.jumpH = Math.max(wizard.jumpH || 0, 1);
  }
  if (attack.flightTime) {
    wizard.abilityFlightTimer = Math.max(wizard.abilityFlightTimer || 0, attack.flightTime);
    wizard.flyH = Math.max(wizard.flyH || 0, attack.launch || 150);
    wizard.flying = true;
  }
  if (attack.haste) {
    wizard.hasteFactor = Math.max(wizard.hasteFactor || 1, attack.haste);
    wizard.hasteTimer = Math.max(wizard.hasteTimer || 0, attack.statusTime || 5);
  }
  if (attack.damage && attack.range) castNovaAttack(state, wizard, attack);
  state.events.push({
    type: 'movement-cast',
    wizardId: wizard.id,
    x: wizard.x,
    y: wizard.y,
    color: attack.color,
  });
}

function castSummonAttack(state, wizard, attack) {
  if (!attack.zoneType) {
    spawnAttackProjectiles(state, wizard, attack);
    state.events.push({
      type: 'summon',
      wizardId: wizard.id,
      summon: attack.id,
      x: wizard.x,
      y: wizard.y,
      color: attack.color,
    });
    return;
  }
  state.spells.push({
    kind: 'zone',
    zoneType: attack.zoneType,
    attackId: attack.id,
    x: wizard.x,
    y: wizard.y,
    z: 3,
    originX: wizard.x,
    originY: wizard.y,
    originGround: terrainHeight(wizard.x, wizard.y),
    vx: 0,
    vy: 0,
    vz: 0,
    life: attack.life,
    ownerId: wizard.id,
    radius: attack.range,
    damagePerSecond: attack.damagePerSecond || 0,
    healPerSecond: attack.healPerSecond || 0,
    shieldPerSecond: attack.shieldPerSecond || 0,
    empower: attack.empower || 0,
    poison: attack.poison || 0,
    statusTime: attack.statusTime || 0,
    health: attack.health || 0,
    friendlyOnly: !!attack.friendlyOnly,
    color: attack.color,
  });
  state.events.push({
    type: 'summon-zone',
    wizardId: wizard.id,
    zoneType: attack.zoneType,
    x: wizard.x,
    y: wizard.y,
    range: attack.range,
    color: attack.color,
  });
}

function castUtilityAttack(state, wizard, attack) {
  wizard.runeKeys = (wizard.runeKeys || 0) + (attack.keyCount || 0);
  state.events.push({
    type: 'rune-key',
    wizardId: wizard.id,
    keys: wizard.runeKeys,
    x: wizard.x,
    y: wizard.y,
    color: attack.color,
  });
}

// Fire a bolt toward the wizard's 3D aim point (aimX, aimY on the ground, aimZ
// height). Aiming at the exact point the crosshair is over makes shots line up
// with the reticle, and travelling in 3D lets you shoot up and down.
function castBolt(state, wizard) {
  const a = wizard.heading;
  const mx = wizard.x + Math.cos(a) * (WIZARD.radius + 8);
  const my = wizard.y + Math.sin(a) * (WIZARD.radius + 8);
  const bodyBase = wizardElevation(wizard);
  const mz = bodyBase + WAND.castHeight;
  const originGround = terrainHeight(wizard.x, wizard.y);
  const tx = wizard.aimX ?? wizard.x + Math.cos(a) * 300;
  const ty = wizard.aimY ?? wizard.y + Math.sin(a) * 300;
  const tz = wizard.aimZ ?? WAND.castHeight;
  const dx = tx - mx;
  const dy = ty - my;
  const dz = tz - mz;
  const len = Math.hypot(dx, dy, dz) || 1;
  const directTarget = state.wizards.find(
    (w) => w.id === wizard.aimTargetId && w.alive && w.id !== wizard.id,
  );
  state.spells.push({
    x: mx,
    y: my,
    z: mz,
    // Keep the launch point so the renderer can anchor this bolt to one world
    // height. Sampling the terrain under it every frame made hills bend its
    // otherwise-straight trajectory.
    originX: mx,
    originY: my,
    originGround,
    targetId: directTarget?.id ?? null,
    targetDistance: directTarget ? len : null,
    travelled: 0,
    vx: (dx / len) * WAND.speed,
    vy: (dy / len) * WAND.speed,
    vz: (dz / len) * WAND.speed,
    life: WAND.life,
    ownerId: wizard.id,
    radius: WAND.radius,
    damage: WAND.damage,
    color: SPELLS.bolt.color, // fire-colored streak
  });
  state.events.push({ type: 'cast', x: wizard.x, y: wizard.y });
}

// A close-range melee slash: hits every living enemy within a frontal arc.
function castSlash(state, wizard, spell) {
  wizard.slashTimer = spell.duration || 0.42;
  const half = spell.arc / 2;
  for (const o of state.wizards) {
    if (o === wizard || !o.alive) continue;
    if (dist(wizard.x, wizard.y, o.x, o.y) > spell.range + WIZARD.radius) continue;
    const ang = Math.atan2(o.y - wizard.y, o.x - wizard.x);
    if (Math.abs(normalizeAngle(ang - wizard.heading)) > half) continue;
    damageWithAttack(state, o, spell.damage, spell, wizard.x, wizard.y);
    state.events.push({ type: 'slashhit', x: o.x, y: o.y, victim: o.id, color: o.color });
  }
  state.events.push({ type: 'slash', x: wizard.x, y: wizard.y, dir: wizard.heading });
}

function explodeProjectile(state, projectile, x, y, worldZ) {
  if (!projectile.explosionRadius) return;
  const attack = ATTACKS[projectile.attackId] || projectile;
  const owner = state.wizards.find((wizard) => wizard.id === projectile.ownerId);
  for (const node of state.terrainSupport?.nodes.values() || []) {
    if (node.team === (owner?.teamId ?? owner?.id)) continue;
    if (
      dist(x, y, node.x, node.z) > projectile.explosionRadius ||
      Math.abs(worldZ - (node.y + 23)) > projectile.explosionRadius
    )
      continue;
    projectile.damagedNodeIds ||= new Set();
    if (projectile.damagedNodeIds.has(node.id)) continue;
    projectile.damagedNodeIds.add(node.id);
    state.terrainSupport.damageNode(node.id, projectile.splashDamage || projectile.damage || 10);
  }
  for (const target of state.wizards) {
    if (!target.alive || target.id === projectile.ownerId) continue;
    const distance = dist(x, y, target.x, target.y);
    if (distance > projectile.explosionRadius + WIZARD.radius) continue;
    const falloff = 1 - clamp(distance / projectile.explosionRadius, 0, 0.7);
    damageWithAttack(
      state,
      target,
      (projectile.splashDamage || projectile.damage) * falloff,
      attack,
      x,
      y,
    );
  }
  state.events.push({
    type: 'explosion',
    x,
    y,
    worldZ,
    radius: projectile.explosionRadius,
    impactPower: projectile.splashDamage || projectile.damage,
    color: projectile.color,
  });
}

function chainFromTarget(state, projectile, firstTarget) {
  let current = firstTarget;
  const struck = new Set([projectile.ownerId, firstTarget.id]);
  const attack = ATTACKS[projectile.attackId] || projectile;
  for (let jump = 0; jump < (projectile.chain || 0); jump++) {
    const next = state.wizards
      .filter(
        (target) =>
          target.alive &&
          !struck.has(target.id) &&
          dist(current.x, current.y, target.x, target.y) <= projectile.chainRange,
      )
      .sort(
        (a, b) => dist(current.x, current.y, a.x, a.y) - dist(current.x, current.y, b.x, b.y),
      )[0];
    if (!next) break;
    struck.add(next.id);
    damageWithAttack(
      state,
      next,
      projectile.damage * Math.pow(0.72, jump + 1),
      attack,
      current.x,
      current.y,
    );
    state.events.push({
      type: 'chain',
      x: current.x,
      y: current.y,
      endX: next.x,
      endY: next.y,
      color: projectile.color,
    });
    current = next;
  }
}

function hitWizardWithProjectile(state, projectile, target, hitX, hitY, worldZ) {
  let attack = ATTACKS[projectile.attackId] || projectile;
  let damage = projectile.damage;
  if (attack.randomEffect) {
    const effects = [
      { effect: 'blast', damage: damage * 1.75, knockback: 240 },
      { effect: 'gravity', damage: damage * 0.7, pull: 260 },
      { effect: 'frost', damage: damage * 0.8, slow: 0.32, statusTime: 3.5 },
      { effect: 'fire', damage: damage * 1.05, burn: 7, statusTime: 4 },
      { effect: 'chain', damage: damage * 0.9, curse: true, statusTime: 5 },
    ];
    const chosen = effects[Math.floor(Math.random() * effects.length)];
    damage = chosen.damage;
    attack = { ...attack, ...chosen };
    state.events.push({
      type: 'chaos-effect',
      effect: chosen.effect,
      x: hitX,
      y: hitY,
      victim: target.id,
      color: projectile.color,
    });
  }
  const incoming = normalize(projectile.vx || 0, projectile.vy || 0);
  damageWithAttack(
    state,
    target,
    damage,
    attack,
    target.x - incoming.x * 100,
    target.y - incoming.y * 100,
  );
  projectile.hitIds ||= [];
  projectile.hitIds.push(target.id);
  chainFromTarget(state, projectile, target);
  state.events.push({
    type: 'hit',
    x: hitX,
    y: hitY,
    z: worldZ - terrainHeight(hitX, hitY),
    worldZ,
    color: projectile.color,
    victim: target.id,
    impactPower: damage,
  });
  explodeProjectile(state, projectile, hitX, hitY, worldZ);
  if ((projectile.remainingPierce || 0) > 0) {
    projectile.remainingPierce--;
    projectile.targetId = null;
    projectile.targetDistance = null;
    return false;
  }
  return true;
}

function steerHomingProjectile(state, projectile, dt) {
  if (!projectile.homing) return;
  let target = state.wizards.find(
    (wizard) =>
      wizard.id === projectile.targetId && wizard.alive && wizard.id !== projectile.ownerId,
  );
  if (!target) {
    target = state.wizards
      .filter(
        (wizard) =>
          wizard.alive &&
          wizard.id !== projectile.ownerId &&
          !projectile.hitIds?.includes(wizard.id),
      )
      .sort(
        (a, b) =>
          dist(projectile.x, projectile.y, a.x, a.y) - dist(projectile.x, projectile.y, b.x, b.y),
      )[0];
  }
  if (!target || dist(projectile.x, projectile.y, target.x, target.y) > 1500) return;
  projectile.targetId = target.id;
  projectile.targetDistance = null;
  const bodyBase = wizardElevation(target);
  const targetWorldZ =
    terrainHeight(target.x, target.y) + bodyBase + (target.bodyHeight || BODY_HEIGHT) * 0.5;
  const projectileWorldZ = projectile.originGround + projectile.z;
  const direction = normalize3(
    target.x - projectile.x,
    target.y - projectile.y,
    targetWorldZ - projectileWorldZ,
  );
  const speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz || 0);
  const blend = 1 - Math.exp(-projectile.homing * dt);
  projectile.vx += (direction.x * speed - projectile.vx) * blend;
  projectile.vy += (direction.y * speed - projectile.vy) * blend;
  projectile.vz += (direction.z * speed - (projectile.vz || 0)) * blend;
}

function normalize3(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

// Advance projectiles, bombs and traps in 3D. Movement remains sub-stepped so
// even the new sniper-speed attacks cannot tunnel through characters or walls.
export function stepSpells(state, dt) {
  const surviving = [];
  for (const projectile of state.spells) {
    const b = projectile;
    if (!Number.isFinite(b.originGround)) {
      b.originGround = terrainHeight(b.originX ?? b.x, b.originY ?? b.y);
    }

    if (b.kind === 'trap') {
      b.life -= dt;
      b.armTime = Math.max(0, (b.armTime || 0) - dt);
      const triggered =
        b.armTime <= 0 &&
        state.wizards.some(
          (wizard) =>
            wizard.alive &&
            wizard.id !== b.ownerId &&
            dist(b.x, b.y, wizard.x, wizard.y) <= b.explosionRadius,
        );
      if (triggered || b.life <= 0) {
        explodeProjectile(state, b, b.x, b.y, b.originGround + b.z);
      } else {
        surviving.push(b);
      }
      continue;
    }

    if (b.kind === 'zone') {
      b.life -= dt;
      const attack = ATTACKS[b.attackId] || b;
      for (const wizard of state.wizards) {
        if (!wizard.alive || dist(b.x, b.y, wizard.x, wizard.y) > b.radius) continue;
        if (b.friendlyOnly && wizard.id !== b.ownerId) continue;
        if (b.damagePerSecond && wizard.id !== b.ownerId) {
          damageWithAttack(state, wizard, b.damagePerSecond * dt, attack, b.x, b.y);
        }
        if (b.healPerSecond) {
          wizard.health = Math.min(WIZARD.maxHealth, wizard.health + b.healPerSecond * dt);
        }
        if (b.shieldPerSecond) {
          wizard.shield = Math.min(100, (wizard.shield || 0) + b.shieldPerSecond * dt);
        }
        if (b.empower) {
          wizard.empowerFactor = Math.max(wizard.empowerFactor || 1, b.empower);
          wizard.empowerTimer = Math.max(wizard.empowerTimer || 0, 0.2);
        }
      }
      if (b.life > 0) surviving.push(b);
      else {
        state.events.push({
          type: 'zone-expire',
          x: b.x,
          y: b.y,
          zoneType: b.zoneType,
          color: b.color,
        });
      }
      continue;
    }

    steerHomingProjectile(state, b, dt);
    const speed = Math.hypot(b.vx, b.vy, b.vz || 0);
    const hitR = WIZARD.radius + b.radius;
    const steps = Math.max(1, Math.ceil((speed * dt) / (hitR * 0.75)));
    const sdt = dt / steps;
    let done = false;
    for (let step = 0; step < steps && !done; step++) {
      const previousX = b.x;
      const previousY = b.y;
      b.vz = (b.vz || 0) - (b.gravity || 0) * sdt;
      b.x += b.vx * sdt;
      b.y += b.vy * sdt;
      b.z = (b.z ?? WAND.castHeight) + b.vz * sdt;
      b.travelled = (b.travelled || 0) + speed * sdt;
      const groundHere = terrainHeight(b.x, b.y);
      const worldZ = b.originGround + b.z;
      const heightHere = worldZ - groundHere;

      const owner = state.wizards.find((wizard) => wizard.id === b.ownerId);
      const hitNode = [...(state.terrainSupport?.nodes.values() || [])].find(
        (node) =>
          node.team !== (owner?.teamId ?? owner?.id) &&
          dist(b.x, b.y, node.x, node.z) <= b.radius + 28 &&
          Math.abs(worldZ - (node.y + 23)) <= b.radius + 28,
      );
      if (hitNode) {
        b.damagedNodeIds ||= new Set();
        b.damagedNodeIds.add(hitNode.id);
        state.terrainSupport.damageNode(hitNode.id, b.damage || 10);
        state.events.push({
          type: 'levitation-hit',
          x: hitNode.x,
          y: hitNode.z,
          worldZ: hitNode.y + 23,
          color: '#c084fc',
        });
        explodeProjectile(state, b, b.x, b.y, worldZ);
        done = true;
        break;
      }

      if (heightHere < Math.max(0, b.radius * 0.25)) {
        if ((b.bounces || 0) > 0) {
          b.bounces--;
          b.z = groundHere - b.originGround + b.radius * 0.3;
          b.vz = Math.max(180, Math.abs(b.vz) * 0.62);
          b.vx *= 0.82;
          b.vy *= 0.82;
          state.events.push({ type: 'bounce', x: b.x, y: b.y, worldZ: groundHere, color: b.color });
          continue;
        }
        state.events.push({
          type: 'block',
          x: b.x,
          y: b.y,
          z: b.z,
          worldZ: groundHere,
          color: b.color,
          impactPower: b.damage,
          radius: b.radius,
        });
        explodeProjectile(state, b, b.x, b.y, groundHere);
        done = true;
        break;
      }
      if (dist(b.x, b.y, 0, 0) > ARENA.radius) {
        done = true;
        break;
      }
      if (boltHitsObstacle(b.x, b.y, heightHere, b.radius, state.obstacles)) {
        if ((b.bounces || 0) > 0) {
          b.bounces--;
          b.x = previousX;
          b.y = previousY;
          b.vx *= -0.72;
          b.vy *= -0.72;
          state.events.push({ type: 'bounce', x: b.x, y: b.y, worldZ, color: b.color });
          continue;
        }
        state.events.push({
          type: 'block',
          x: b.x,
          y: b.y,
          z: b.z,
          worldZ,
          color: b.color,
          impactPower: b.damage,
          radius: b.radius,
        });
        explodeProjectile(state, b, b.x, b.y, worldZ);
        done = true;
        break;
      }

      const destructibleZone = state.spells.find(
        (zone) =>
          zone.kind === 'zone' &&
          zone !== b &&
          zone.ownerId !== b.ownerId &&
          (zone.health || 0) > 0 &&
          dist(b.x, b.y, zone.x, zone.y) <= b.radius + Math.min(32, zone.radius * 0.28) &&
          heightHere <= 58,
      );
      if (destructibleZone) {
        destructibleZone.health -= b.damage || 0;
        state.events.push({
          type: 'zone-hit',
          x: destructibleZone.x,
          y: destructibleZone.y,
          zoneType: destructibleZone.zoneType,
          health: Math.max(0, destructibleZone.health),
          color: destructibleZone.color,
        });
        if (destructibleZone.health <= 0) {
          destructibleZone.life = 0;
          state.events.push({
            type: 'zone-destroyed',
            x: destructibleZone.x,
            y: destructibleZone.y,
            zoneType: destructibleZone.zoneType,
            color: destructibleZone.color,
          });
        }
        explodeProjectile(state, b, b.x, b.y, worldZ);
        done = true;
        break;
      }

      const directTarget =
        b.targetId == null
          ? null
          : state.wizards.find(
              (wizard) =>
                wizard.id === b.targetId && wizard.alive && !b.hitIds?.includes(wizard.id),
            );
      if (directTarget && b.targetDistance != null && b.travelled >= b.targetDistance) {
        const bodyBase = wizardElevation(directTarget);
        const hitZ = bodyBase + (directTarget.bodyHeight || BODY_HEIGHT) * 0.55;
        done = hitWizardWithProjectile(
          state,
          b,
          directTarget,
          directTarget.x,
          directTarget.y,
          terrainHeight(directTarget.x, directTarget.y) + hitZ,
        );
        if (done) break;
      }

      for (const wizard of state.wizards) {
        if (!wizard.alive || wizard.id === b.ownerId || b.hitIds?.includes(wizard.id)) continue;
        const bodyBase = wizardElevation(wizard);
        const bodyWorldBase = terrainHeight(wizard.x, wizard.y) + bodyBase;
        if (
          worldZ >= bodyWorldBase &&
          worldZ <= bodyWorldBase + (wizard.bodyHeight || BODY_HEIGHT) &&
          dist(b.x, b.y, wizard.x, wizard.y) <= hitR
        ) {
          done = hitWizardWithProjectile(state, b, wizard, b.x, b.y, worldZ);
          break;
        }
      }
    }
    b.life -= dt;
    if (!done && b.life > 0) surviving.push(b);
    else if (!done && b.explosionRadius) {
      explodeProjectile(state, b, b.x, b.y, b.originGround + b.z);
    }
  }
  state.spells = surviving;
}

// ---- Storm + elimination + win ---------------------------------------------

// Damage wizards caught outside the safe circle.
export function applyStorm(state, dt) {
  const s = state.storm;
  for (const w of state.wizards) {
    if (!w.alive) continue;
    if (dist(w.x, w.y, s.cx, s.cy) > s.radius) {
      if (w.regenStopsOnDamage) {
        w.regenTimer = 0;
        w.regenHealthPerSecond = 0;
        w.regenShieldPerSecond = 0;
        w.regenStopsOnDamage = false;
      }
      w.health -= STORM.dps * dt;
      state.events.push({ type: 'storm', victim: w.id });
    }
  }
}

// Knock out wizards at 0 health, recording their finishing placement.
export function checkEliminations(state) {
  for (const w of state.wizards) {
    if (!w.alive) continue;
    if (w.health <= 0) {
      w.health = 0;
      w.alive = false;
      dropEliminatedInventory(state, w);
      w.placement = aliveCount(state) + 1; // they were the next to go
      state.events.push({ type: 'death', x: w.x, y: w.y, color: w.color, id: w.id });
    }
  }
}

// The match ends when one (or zero) wizards remain.
export function checkWin(state) {
  if (state.over) return;
  const alive = state.wizards.filter((w) => w.alive);
  if (alive.length <= 1) {
    state.over = true;
    const winner = alive[0] || null;
    state.winnerId = winner ? winner.id : null;
    state.playerWon = !!(winner && winner.isPlayer);
    if (winner) winner.placement = 1;
    state.events.push({ type: 'over', winnerId: state.winnerId, playerWon: state.playerWon });
  }
}

// ---- AI --------------------------------------------------------------------

// Nearest living opponent to a wizard, or null.
export function nearestOpponent(state, wizard) {
  let best = Infinity;
  let target = null;
  for (const o of state.wizards) {
    if (o === wizard || !o.alive) continue;
    const d = dist(wizard.x, wizard.y, o.x, o.y);
    if (d < best) {
      best = d;
      target = o;
    }
  }
  return target;
}

// The point on an obstacle's surface closest to (px, py), plus the gap to it.
// Circles project onto the rim; houses clamp to the oriented box. Used both for
// steering away from scenery and for feeling out how blocked a path is.
function nearestPointOnObstacle(o, px, py) {
  if (o.kind === 'house') {
    const c = Math.cos(o.angle);
    const s = Math.sin(o.angle);
    const dx = px - o.x;
    const dy = py - o.y;
    const lx = clamp(dx * c + dy * s, -o.hw, o.hw);
    const ly = clamp(-dx * s + dy * c, -o.hd, o.hd);
    const wx = o.x + lx * c - ly * s;
    const wy = o.y + lx * s + ly * c;
    return { x: wx, y: wy, gap: dist(px, py, wx, wy) };
  }
  const d = dist(px, py, o.x, o.y);
  const t = d > 1e-4 ? o.r / d : 0;
  return { x: o.x + (px - o.x) * t, y: o.y + (py - o.y) * t, gap: Math.max(0, d - o.r) };
}

// Is the straight line from (x1,y1) to (x2,y2) clear of solid scenery at chest
// height? Bots use this so they don't waste shots on walls they can't see past.
export function hasLineOfSight(x1, y1, x2, y2, obstacles) {
  if (!obstacles) return true;
  const d = dist(x1, y1, x2, y2);
  const steps = Math.max(1, Math.ceil(d / 40));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    if (boltHitsObstacle(px, py, WAND.castHeight, WAND.radius, obstacles)) return false;
  }
  return true;
}

// Bend a desired move direction away from nearby solid scenery so bots flow
// around trees and houses instead of grinding into them. Returns a unit vector.
export function steerAroundObstacles(x, y, dirX, dirY, obstacles) {
  if (!obstacles) return normalize(dirX, dirY);
  const REACH = 120; // start veering this far from an obstacle's surface
  let ax = dirX;
  let ay = dirY;
  for (const o of obstacles) {
    if (o.soft) continue;
    const near = nearestPointOnObstacle(o, x, y);
    if (near.gap > REACH) continue;
    let awx = x - near.x;
    let awy = y - near.y;
    let len = Math.hypot(awx, awy);
    if (len < 1e-3) {
      // Sitting exactly on the surface: shove out from the obstacle center.
      awx = x - o.x;
      awy = y - o.y;
      len = Math.hypot(awx, awy) || 1;
    }
    const strength = (REACH - near.gap) / REACH; // 0 far .. 1 touching
    const nx = awx / len;
    const ny = awy / len;
    ax += nx * strength * 2.2; // push away from the surface
    ay += ny * strength * 2.2;
    // Slip sideways too, so a head-on approach slides around instead of just
    // stalling. Pick the tangent that best matches where we already want to go.
    const perpX = -ny;
    const perpY = nx;
    const side = perpX * dirX + perpY * dirY >= 0 ? 1 : -1;
    ax += perpX * side * strength * 1.4;
    ay += perpY * side * strength * 1.4;
  }
  return normalize(ax, ay);
}

// Pick a bot's target with hysteresis: keep whoever it's already chasing unless
// another rival is clearly closer. Without this the target flips between two
// near-equal rivals every frame, which makes the bot twitch in place.
function chooseTarget(state, wizard) {
  const nearest = nearestOpponent(state, wizard);
  const cur = state.wizards.find((o) => o.id === wizard.targetId && o.alive && o !== wizard);
  let target = nearest;
  if (cur) {
    const dCur = dist(wizard.x, wizard.y, cur.x, cur.y);
    const dNear = nearest ? dist(wizard.x, wizard.y, nearest.x, nearest.y) : Infinity;
    if (dCur < dNear * 1.3) target = cur; // stick unless the nearest is much closer
  }
  wizard.targetId = target ? target.id : null;
  return target;
}

// Decide a bot's move direction, aim, and whether to cast. It stays inside the
// safe circle, hunts a stable target, strafes to juke, steers around scenery,
// and only fires when it actually has a clear line of sight. The final move
// direction is low-pass filtered so decisions can't reverse frame-to-frame.
export function aiWizard(state, wizard, dt = 1 / 60) {
  const s = state.storm;
  const obstacles = state.obstacles;
  const fromCenter = dist(wizard.x, wizard.y, s.cx, s.cy);
  const target = chooseTarget(state, wizard);

  // Danger: how close to (or past) the storm edge, 0 safe .. 1 at the edge.
  const danger = clamp((fromCenter - s.radius * 0.75) / (s.radius * 0.25), 0, 1);
  const toCenter = normalize(s.cx - wizard.x, s.cy - wizard.y);

  let moveX = toCenter.x;
  let moveY = toCenter.y;
  let aimX = wizard.x + Math.cos(wizard.heading);
  let aimY = wizard.y + Math.sin(wizard.heading);
  let cast = false;

  if (target) {
    aimX = target.x;
    aimY = target.y;
    const d = dist(wizard.x, wizard.y, target.x, target.y);
    const toTarget = normalize(target.x - wizard.x, target.y - wizard.y);
    const los = hasLineOfSight(wizard.x, wizard.y, target.x, target.y, obstacles);

    // Smoothly ramp approach<->retreat around an ideal range (~280): no hard
    // sign flips at the boundaries, which used to make bots stutter in place.
    let desired = clamp((d - 280) / 120, -0.7, 1);
    if (!los) desired = 1; // blind: close in to get a clear look

    let engageX = toTarget.x * desired;
    let engageY = toTarget.y * desired;

    // Circle-strafe when holding at range with a clear shot: harder to hit and
    // it feels alive. Each bot picks a consistent orbit direction from its id.
    if (los && d >= 200 && d <= 420) {
      const side = wizard.id % 2 === 0 ? 1 : -1;
      engageX += -toTarget.y * side * 0.8;
      engageY += toTarget.x * side * 0.8;
    }

    // Blend safety (toward center) with fighting, weighting safety near the edge.
    moveX = toCenter.x * danger + engageX * (1 - danger);
    moveY = toCenter.y * danger + engageY * (1 - danger);
    cast = d < 520 && danger < 0.8 && los;
  }

  // Weave the chosen direction around any scenery in the way...
  const steered = steerAroundObstacles(wizard.x, wizard.y, moveX, moveY, obstacles);
  // ...then low-pass it. moveWizard re-normalizes, so this steers the HEADING
  // only (not the speed); rapid reversals get smoothed into turns, not jitter.
  const blend = 1 - Math.exp(-8 * dt);
  wizard.aiMoveX = (wizard.aiMoveX ?? 0) + (steered.x - (wizard.aiMoveX ?? 0)) * blend;
  wizard.aiMoveY = (wizard.aiMoveY ?? 0) + (steered.y - (wizard.aiMoveY ?? 0)) * blend;
  const mag = Math.hypot(wizard.aiMoveX, wizard.aiMoveY);
  // Near a reversal the filtered vector passes through ~0; stand still for that
  // instant instead of amplifying noise into a random dart.
  if (mag < 0.06) return { dx: 0, dy: 0, aimX, aimY, cast };
  return { dx: wizard.aiMoveX / mag, dy: wizard.aiMoveY / mag, aimX, aimY, cast };
}

function moveOnOpeningPlatform(wizard, dx, dy, dt, running = false) {
  const direction = normalize(dx, dy);
  const speed = running ? WIZARD.runSpeed : WIZARD.speed;
  wizard.x += direction.x * speed * dt;
  wizard.y += direction.y * speed * dt;
  const radius = Math.hypot(wizard.x, wizard.y);
  const limit = OPENING.platformRadius - WIZARD.radius;
  if (radius > limit) {
    wizard.x = (wizard.x / radius) * limit;
    wizard.y = (wizard.y / radius) * limit;
  }
  wizard.openingH = OPENING.platformHeight - terrainHeight(wizard.x, wizard.y);
}

function enterOpeningPortal(state, wizard, portal) {
  const destination = PORTAL_DESTINATIONS[portal.destination];
  const occupiedLandingPoints = state.wizards
    .filter((other) => other !== wizard && other.slowFalling)
    .map((other) => ({ x: other.x, y: other.y }));
  let targetX = destination.x;
  let targetY = destination.y;
  let foundSafeLanding = false;
  // Sample the whole region disc uniformly. Candidates must be walkable land,
  // clear of scenery/water/steep slopes, and separated from earlier drops.
  for (let attempt = 0; attempt < 100; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * destination.landingRadius;
    const candidateX = destination.x + Math.cos(angle) * radius;
    const candidateY = destination.y + Math.sin(angle) * radius;
    if (!isSafeLootSpawnPoint(candidateX, candidateY, state.obstacles, occupiedLandingPoints)) {
      continue;
    }
    targetX = candidateX;
    targetY = candidateY;
    foundSafeLanding = true;
    break;
  }
  // An unlikely unlucky random sequence still gets a safe point by scanning
  // the same region in a deterministic golden-angle spiral.
  if (!foundSafeLanding) {
    for (let attempt = 0; attempt < 160; attempt++) {
      const angle = attempt * 2.399963;
      const radius = Math.sqrt((attempt + 1) / 160) * destination.landingRadius;
      const candidateX = destination.x + Math.cos(angle) * radius;
      const candidateY = destination.y + Math.sin(angle) * radius;
      if (!isSafeLootSpawnPoint(candidateX, candidateY, state.obstacles, occupiedLandingPoints)) {
        continue;
      }
      targetX = candidateX;
      targetY = candidateY;
      break;
    }
  }
  [wizard.x, wizard.y] = resolveObstacles(targetX, targetY, WIZARD.radius, state.obstacles);
  wizard.portalLandingX = wizard.x;
  wizard.portalLandingY = wizard.y;
  wizard.openingH = OPENING.dropHeight;
  wizard.slowFalling = true;
  wizard.openingLanded = false;
  wizard.chosenPortal = portal.index;
  wizard.heading = Math.atan2(-wizard.y, -wizard.x);
  state.events.push({
    type: 'portal-enter',
    wizardId: wizard.id,
    portalIndex: portal.index,
    destination: destination.name,
    landingX: wizard.x,
    landingY: wizard.y,
  });
}

// Return the highest valid surface directly beneath a slow-falling wizard.
// Houses use their rendered roof apex, allowing a portal drop to finish on a
// rooftop and hand cleanly into the existing walk-on-roof movement state.
function slowFallLandingSurface(state, wizard, currentWorldHeight) {
  let height = terrainHeight(wizard.x, wizard.y);
  let obstacle = null;
  for (const candidate of state.obstacles || []) {
    if (candidate.soft || candidate.kind !== 'house') continue;
    const c = Math.cos(candidate.angle || 0);
    const s = Math.sin(candidate.angle || 0);
    const dx = wizard.x - candidate.x;
    const dy = wizard.y - candidate.y;
    const localX = dx * c + dy * s;
    const localY = -dx * s + dy * c;
    // Keep the wizard's centre safely inside the roof instead of balancing its
    // body beyond an eave and immediately falling through the wall collider.
    const inset = WIZARD.radius * 0.35;
    if (
      Math.abs(localX) > Math.max(0, candidate.hw - inset) ||
      Math.abs(localY) > Math.max(0, candidate.hd - inset)
    ) {
      continue;
    }
    const roofHeight = climbTopWorldY(candidate);
    if (roofHeight > currentWorldHeight + 1 || roofHeight <= height) continue;
    height = roofHeight;
    obstacle = candidate;
  }
  return { height, obstacle };
}

function updateOpening(state, inputs, dt) {
  const opening = state.opening;
  // Remember the phase at the beginning of this simulation step. If the timer
  // reaches zero during this step, movement starts on the following step so a
  // held key cannot spend countdown time moving the wizard toward a portal.
  const phaseAtStepStart = opening.phase;
  opening.elapsed += dt;
  opening.timer = Math.max(0, opening.timer - dt);

  if (opening.phase === 'countdown' && opening.timer <= 0) {
    opening.phase = 'choose';
    opening.timer = OPENING.chooseTime;
    state.events.push({ type: 'portals-open' });
  }

  if (opening.phase === 'choose') {
    for (const portal of opening.portals) {
      if (!portal.unstable || opening.elapsed < portal.nextShift) continue;
      portal.destination = (portal.destination + 1 + portal.index) % PORTAL_DESTINATIONS.length;
      portal.nextShift += 2.6 + (portal.index % 4) * 0.45;
      state.events.push({ type: 'portal-shift', portalIndex: portal.index });
    }
  }

  for (const wizard of state.wizards) {
    if (!wizard.alive || wizard.openingLanded) continue;

    if (wizard.slowFalling) {
      const currentWorldHeight = terrainHeight(wizard.x, wizard.y) + wizard.openingH;
      let dx = 0;
      let dy = 0;
      if (wizard.isPlayer) {
        const input = (inputs && inputs[wizard.playerIndex]) || {};
        dx = input.dx || 0;
        dy = input.dy || 0;
        if (typeof input.yaw === 'number') wizard.heading = input.yaw;
      } else {
        // Bots drift toward their destination's centre while descending.
        const portal = opening.portals[wizard.chosenPortal] || opening.portals[0];
        const destination = PORTAL_DESTINATIONS[portal.destination];
        const toward = normalize(
          (wizard.portalLandingX ?? destination.x) - wizard.x,
          (wizard.portalLandingY ?? destination.y) - wizard.y,
        );
        dx = toward.x;
        dy = toward.y;
        wizard.heading = Math.atan2(dy, dx);
      }
      const direction = normalize(dx, dy);
      wizard.x += direction.x * OPENING.steerSpeed * dt;
      wizard.y += direction.y * OPENING.steerSpeed * dt;
      const landing = slowFallLandingSurface(state, wizard, currentWorldHeight);
      const nextWorldHeight = currentWorldHeight - OPENING.fallSpeed * dt;
      wizard.openingH = Math.max(0, nextWorldHeight - terrainHeight(wizard.x, wizard.y));
      if (nextWorldHeight <= landing.height) {
        wizard.openingH = 0;
        wizard.slowFalling = false;
        wizard.openingLanded = true;
        if (landing.obstacle) {
          wizard.climbOver = landing.obstacle;
          wizard.climbState = 'top';
          wizard.climbH = landing.height - terrainHeight(wizard.x, wizard.y);
          wizard.climbBlocked = false;
          wizard.climbNearby = nearbyClimbObstacles(landing.obstacle, state.obstacles);
        } else {
          wizard.climbOver = null;
          wizard.climbState = null;
          wizard.climbH = 0;
          wizard.climbBlocked = false;
          wizard.climbNearby = [];
        }
        state.events.push({ type: 'slow-fall-land', wizardId: wizard.id });
      }
      continue;
    }

    let dx = 0;
    let dy = 0;
    let running = false;
    if (wizard.isPlayer) {
      const input = (inputs && inputs[wizard.playerIndex]) || {};
      const portalsWereOpen = phaseAtStepStart === 'choose' || phaseAtStepStart === 'falling';
      if (portalsWereOpen) {
        dx = input.dx || 0;
        dy = input.dy || 0;
        running = !!input.run;
      }
      if (typeof input.yaw === 'number') wizard.heading = input.yaw;
    } else if (phaseAtStepStart === 'choose' && opening.phase === 'choose') {
      const portal = opening.portals[wizard.id % opening.portals.length];
      const toward = normalize(portal.x - wizard.x, portal.y - wizard.y);
      dx = toward.x;
      dy = toward.y;
      wizard.heading = Math.atan2(dy, dx);
    }
    moveOnOpeningPlatform(wizard, dx, dy, dt, running);

    if (opening.phase === 'choose') {
      for (const portal of opening.portals) {
        if (dist(wizard.x, wizard.y, portal.x, portal.y) <= OPENING.portalRadius) {
          enterOpeningPortal(state, wizard, portal);
          break;
        }
      }
    }
  }

  const waiting = state.wizards.filter((wizard) => wizard.alive && !wizard.openingLanded);
  const anyoneOnPlatform = waiting.some((wizard) => !wizard.slowFalling);
  if (opening.phase === 'choose' && (opening.timer <= 0 || !anyoneOnPlatform)) {
    for (const wizard of waiting) {
      if (!wizard.slowFalling) {
        const portal = opening.portals[wizard.id % opening.portals.length];
        enterOpeningPortal(state, wizard, portal);
      }
    }
    opening.phase = 'falling';
    opening.timer = 0;
  }

  if (state.wizards.every((wizard) => !wizard.alive || wizard.openingLanded)) {
    opening.phase = 'complete';
    opening.timer = 0;
    state.time = 0;
    state.events.push({ type: 'opening-complete' });
  }
}

// ---- Main step -------------------------------------------------------------

// Advance the match by `dt`. `inputs` is an array indexed by player: each is
// { dx, dy, aimX, aimY, cast } — dx/dy a move direction, aimX/aimY a world
// point to face, cast a boolean.
export function update(state, inputs, dt) {
  if (state.terrain) setActiveTerrain(state.terrain);
  if (state.over) return state;
  state.events = [];
  if (state.opening?.phase && state.opening.phase !== 'complete') {
    updateOpening(state, inputs, dt);
    // Preserve the exact landing frame, then begin normal gameplay on the next
    // frame. In multiplayer/bot matches, landed humans no longer wait for every
    // other wizard to finish descending.
    if (state.opening.phase === 'complete') return state;
    const humansReady = state.wizards
      .filter((wizard) => wizard.isPlayer && wizard.alive)
      .every((wizard) => wizard.openingLanded);
    if (!humansReady) return state;
  }
  state.time += dt;
  cleanupGroundItems(state);

  // Close the storm in once the calm period ends (never in the testing sandbox).
  if (!state.sandbox && state.time > STORM.shrinkDelay) {
    state.storm.radius = Math.max(STORM.minRadius, state.storm.radius - STORM.shrinkPerSec * dt);
  }

  for (const w of state.wizards) {
    if (!w.alive) continue;
    // Once the player has landed, normal gameplay runs while remaining bots
    // continue their slow-fall in updateOpening. They join combat on landing.
    if (state.opening?.phase !== 'complete' && !w.openingLanded) continue;
    setWaterContact(w, wizardWaterContact(state, w));
    if (w.inWater && w.dotKind === 'burn') {
      w.dotTimer = w.dotDamage = 0;
      w.dotKind = null;
    }
    if (w.slowTimer > 0) {
      w.slowTimer = Math.max(0, w.slowTimer - dt);
      if (w.slowTimer === 0) w.slowFactor = 1;
    }
    if (w.hasteTimer > 0) {
      w.hasteTimer = Math.max(0, w.hasteTimer - dt);
      if (w.hasteTimer === 0) w.hasteFactor = 1;
    }
    if (w.empowerTimer > 0) {
      w.empowerTimer = Math.max(0, w.empowerTimer - dt);
      if (w.empowerTimer === 0) w.empowerFactor = 1;
    }
    if (w.curseTimer > 0) w.curseTimer = Math.max(0, w.curseTimer - dt);
    if (w.abilityFlightTimer > 0) {
      w.abilityFlightTimer = Math.max(0, w.abilityFlightTimer - dt);
    }
    updateItemUse(state, w, dt);
    if (w.regenTimer > 0) {
      const activeTime = Math.min(dt, w.regenTimer);
      w.health = Math.min(WIZARD.maxHealth, w.health + (w.regenHealthPerSecond || 0) * activeTime);
      w.shield = Math.min(100, (w.shield || 0) + (w.regenShieldPerSecond || 0) * activeTime);
      w.regenTimer = Math.max(0, w.regenTimer - dt);
      if (w.regenTimer === 0) {
        w.regenHealthPerSecond = 0;
        w.regenShieldPerSecond = 0;
        w.regenStopsOnDamage = false;
      }
    }
    if (w.dotTimer > 0) {
      if (w.regenStopsOnDamage) {
        w.regenTimer = 0;
        w.regenHealthPerSecond = 0;
        w.regenShieldPerSecond = 0;
        w.regenStopsOnDamage = false;
      }
      w.dotTimer = Math.max(0, w.dotTimer - dt);
      w.health -= (w.dotDamage || 0) * dt;
      if (w.dotTimer === 0) {
        w.dotDamage = 0;
        w.dotKind = null;
      }
    }
    let move = { x: 0, y: 0 };
    let aimX = w.x + Math.cos(w.heading);
    let aimY = w.y + Math.sin(w.heading);
    let attackId = null;
    let cast = false;
    let dig = false;
    let jump = false;
    let pickup = false;
    let holdSwap = false;
    let dropOne = false;
    let dropStack = false;

    if (w.isPlayer) {
      const input = (inputs && inputs[w.playerIndex]) || {};
      move = { x: input.dx || 0, y: input.dy || 0 };
      if (typeof input.aimX === 'number') aimX = input.aimX;
      if (typeof input.aimY === 'number') aimY = input.aimY;
      w.aimX = aimX;
      w.aimY = aimY;
      w.aimZ = typeof input.aimZ === 'number' ? input.aimZ : WAND.castHeight;
      w.aimTargetId = Number.isInteger(input.aimTargetId) ? input.aimTargetId : null;
      // The horizontal axis rotates the capsule directly (falls back to the aim).
      if (typeof input.yaw === 'number') w.heading = input.yaw;
      else if (aimX !== w.x || aimY !== w.y) w.heading = Math.atan2(aimY - w.y, aimX - w.x);
      // Browser matches use collectible attack ids. `input.spell` remains as a
      // backwards-compatible low-level hook for existing simulations/tests.
      const matchAttackInput = Object.prototype.hasOwnProperty.call(input, 'attack');
      attackId = ATTACKS[input.attack] ? input.attack : null;
      if (matchAttackInput) {
        if (attackId && w.attackSlots.includes(attackId) && isAttackCompatible(w, attackId)) {
          w.attack = attackId;
          w.spell = ATTACKS[attackId].spellId;
        } else {
          w.attack = null;
          w.spell = null; // a real match with an empty slot cannot cast
        }
      } else {
        w.attack = null;
        w.spell = SPELLS[input.spell] ? input.spell : 'bolt'; // legacy simulation input
      }
      w.wantClimb = !!input.up;
      w.climbDown = !!input.down;
      w.climbJumpOff = !!input.down && !!input.jump;
      // Free-flight (sandbox): rise/fall with the look direction; glide back down
      // to the ground when flight is switched off.
      const abilityFlying = (w.abilityFlightTimer || 0) > 0;
      w.flying = abilityFlying || (state.sandbox && !!input.flying);
      const isMoving = Math.hypot(move.x, move.y) > 0.01;
      updateStamina(w, !!input.run && !w.flying && !w.drill && !w.swimming, isMoving, dt);
      updateMagicalDigging(state, w, input, dt);
      w.digDirection = input.digDirection;
      w.digAimPitch = Number.isFinite(input.digAimPitch) ? input.digAimPitch : 0;
      w.digAimX = Number.isFinite(input.digAimX) ? input.digAimX : null;
      w.digAimZ = Number.isFinite(input.digAimZ) ? input.digAimZ : null;
      w.digAimY = Number.isFinite(input.digAimY) ? input.digAimY : null;
      w.digAimHit = input.digAimHit || null;
      w.digRadius = precisionSize({ digRadius: input.digRadius ?? w.digRadius }).radius;
      w.digLength = precisionSize({ digLength: input.digLength ?? w.digLength }).length;
      jump = !!input.jump && !(w.digMode && !!input.run && !!input.drillHeld);
      pickup = !!input.pickup;
      holdSwap = !!input.holdSwap;
      dropOne = !!input.dropOne;
      dropStack = !!input.dropStack;
      if (
        Number.isInteger(input.inventorySelect) &&
        input.inventorySelect >= 0 &&
        input.inventorySelect < INVENTORY_SLOT_COUNT
      ) {
        w.selectedInventorySlot = input.inventorySelect;
      }
      dig =
        !!input.dig &&
        !!input.digMode &&
        (!state.opening?.phase || state.opening.phase === 'complete');
      w.digging = dig;
      if (input.digSpell && (!state.opening?.phase || state.opening.phase === 'complete')) {
        const selectedItem = inventorySlots(w)[w.selectedInventorySlot];
        const spellResult = selectedItem?.itemId
          ? castDiggingSpell(
              state,
              w,
              selectedItem.itemId,
              aimX,
              aimY,
              terrainHeight(w.x, w.y) + w.aimZ,
            )
          : reinforceLevitation(state, w);
        if (!spellResult.accepted)
          state.events.push({
            type: 'dig-spell-blocked',
            wizardId: w.id,
            reason: spellResult.reason,
          });
      }
      if (w.flying) w.flyH = Math.max(0, w.flyH + (input.flyUp || 0) * FLY.vspeed * dt);
      else if (w.flyH > 0) w.flyH = Math.max(0, w.flyH - FLY.vspeed * dt);
      cast = !!input.cast && !w.digMode && !!w.spell;
    } else {
      // An unarmed bot searches for the nearest compatible pickup first. Once
      // armed, the existing combat AI takes over unchanged.
      attackId = w.attackSlots.find((id) => id && isAttackCompatible(w, id)) || null;
      const effectiveBotAttack = attackId ? effectiveAttackForWizard(w, attackId) : null;
      const needsMana =
        !!attackId &&
        manaAmmunitionAmount(w, attackId) < (effectiveBotAttack?.manaCost || 0) &&
        !ATTACKS[attackId].consumable;
      const loot = attackId
        ? needsMana
          ? nearestManaPickup(state, w, effectiveBotAttack?.ammoType)
          : null
        : nearestEquippableBotItem(state, w);
      const decision = loot
        ? {
            ...normalize(loot.x - w.x, loot.y - w.y),
            aimX: loot.x,
            aimY: loot.y,
            cast: false,
          }
        : aiWizard(state, w, dt);
      move = { x: decision.dx ?? decision.x ?? 0, y: decision.dy ?? decision.y ?? 0 };
      aimX = decision.aimX;
      aimY = decision.aimY;
      w.aimX = aimX;
      w.aimY = aimY;
      w.aimTargetId = null;
      // Aim at the target's actual elevation instead of a flat imaginary map.
      w.aimZ = terrainHeight(aimX, aimY) - terrainHeight(w.x, w.y) + WAND.castHeight;
      if (aimX !== w.x || aimY !== w.y) w.heading = Math.atan2(aimY - w.y, aimX - w.x);
      w.attack = attackId;
      w.spell = attackId ? ATTACKS[attackId].spellId : null;
      w.running = false; // bots use the new slower movement speed
      // Bots still respect the opening grace period, but attacks themselves
      // have no cooldown or hidden firing delay.
      // Landed players can move and loot while the remaining wizards descend,
      // but bots must not begin combat during that opening overlap. On slower
      // renderers the descent can take several real seconds, previously letting
      // bots eliminate the player before the match looked fully started.
      const openingCombatReady = !state.opening || state.opening.phase === 'complete';
      const wantCast =
        openingCombatReady && !!attackId && state.time >= BOT_ENGAGE_DELAY && decision.cast;
      cast = wantCast;
    }

    // Record movement intent before resolving jump and wall contact. This lets
    // climbing remember whether the player was sprinting at takeoff, even if
    // Shift is released before they reach the wall.
    w.moving = Math.hypot(move.x, move.y) > 0.01;

    // Cooldowns are disabled globally. Clearing stale timers also makes an old
    // hot-reloaded match immediately follow the no-cooldown rule.
    for (const id in w.cooldowns) w.cooldowns[id] = 0;
    if (w.slashTimer > 0) w.slashTimer = Math.max(0, w.slashTimer - dt);
    if (w.castTimer > 0) w.castTimer = Math.max(0, w.castTimer - dt / 0.28); // ~0.28s pose
    const undergroundGrounded =
      w.drillFeetY == null ||
      (w.drillFallV === 0 &&
        w.drillFeetY <= state.terrain.supportHeight(w.x, w.y, w.drillFeetY + 8) + 1);
    const groundedForJump =
      w.climbState === 'top' ||
      (w.climbState == null && w.climbH <= 0 && (w.flyH || 0) <= 0 && undergroundGrounded);
    if (jump && !w.flying && !w.swimming && groundedForJump && (w.jumpH || 0) <= 0) {
      w.jumpV = JUMP.velocity;
      w.runningJump = !!w.running && w.moving;
    }
    // Cast before this frame's movement is applied. The center-screen ray was
    // calculated from the camera at this exact position, so moving first made
    // the muzzle and crosshair come from different frames while strafing.
    if (cast) {
      if (attackId) castAttack(state, w, attackId, dt);
      else castSpell(state, w, w.spell); // legacy direct-spell input
    }
    if (dig && state.time >= (w.nextPrecisionDigTime || 0)) {
      const result = precisionDig(state, w, w.digDirection || 'forward');
      w.nextPrecisionDigTime = state.time + (result.interval || SHOVEL.interval);
      if (!result.accepted && result.reason !== 'no-terrain') {
        const target = precisionDigTarget(state, w, w.digDirection || 'forward');
        state.events.push({
          type: 'dig-blocked',
          wizardId: w.id,
          x: target?.x ?? w.aimX,
          y: target?.z ?? w.aimY,
          worldZ: target?.y ?? terrainHeight(w.aimX, w.aimY),
          reason: result.reason,
        });
      }
    } else if (!dig) {
      w.digging = false;
      w.nextPrecisionDigTime = 0;
    }
    if (!w.drill) {
      const previousX = w.x;
      const previousY = w.y;
      moveWizard(w, move.x, move.y, dt, state.obstacles);
      if (
        w.drillFeetY != null &&
        [30, 84, 150].some((height) => state.terrain.density(w.x, w.y, w.drillFeetY + height) >= 0)
      ) {
        w.x = previousX;
        w.y = previousY;
      }
    }
    collectNearbyMana(state, w);
    if (w.isPlayer) {
      const nearby = nearestInteractableItem(state, w);
      if (pickup && nearby) {
        collectGroundItem(state, w, nearby.id);
      }
      if (
        holdSwap &&
        nearby &&
        dist(w.x, w.y, nearby.x, nearby.y) <= ATTACK_PICKUP_RADIUS + WIZARD.radius
      ) {
        if (w.interactionGroundId !== nearby.id) {
          w.interactionGroundId = nearby.id;
          w.interactionHeldTime = 0;
          w.interactionTriggered = false;
        }
        w.interactionHeldTime += dt;
        if (!w.interactionTriggered && w.interactionHeldTime >= INVENTORY_PICKUP_HOLD_SECONDS) {
          const betterRune =
            nearby.lootType === 'weapon-upgrade-rune' &&
            LOOT_RARITY_ORDER.indexOf(nearby.rarity) >
              LOOT_RARITY_ORDER.indexOf(w.baseWeaponRarity);
          if (collectGroundItem(state, w, nearby.id, betterRune ? 'upgrade' : 'swap')) {
            w.interactionTriggered = true;
          }
        }
      } else {
        w.interactionGroundId = null;
        w.interactionHeldTime = 0;
        w.interactionTriggered = false;
      }
      if (dropOne || dropStack) {
        dropInventoryItem(state, w, w.selectedInventorySlot, dropStack);
      }
    } else {
      const nearby = attackId
        ? nearestManaPickup(state, w, ATTACKS[attackId]?.ammoType)
        : nearestEquippableBotItem(state, w);
      if (
        nearby &&
        nearby.lootType !== 'mana-ammunition' &&
        dist(w.x, w.y, nearby.x, nearby.y) <= ATTACK_PICKUP_RADIUS + WIZARD.radius &&
        (!nearby.attackId || isAttackCompatible(w, nearby.attackId))
      ) {
        collectGroundItem(state, w, nearby.id);
      }
    }
    // Jump arc: horizontal steering continues, while this independent vertical
    // offset rises and falls back onto the current ground or platform.
    if (w.flying || w.climbState === 'wall' || w.climbState === 'terrain-wall') {
      w.jumpH = 0;
      w.jumpV = 0;
    } else if ((w.jumpH || 0) > 0 || (w.jumpV || 0) > 0) {
      w.jumpV -= JUMP.gravity * dt;
      w.jumpH += w.jumpV * dt;
      if (w.jumpH <= 0) {
        w.jumpH = 0;
        w.jumpV = 0;
        w.runningJump = false;
      }
    }
    // Fall back to the ground after stepping off a ledge (not climbing/flying).
    if (!w.flying && w.climbState == null && w.climbH > 0) {
      w.climbH = Math.max(0, w.climbH - CLIMB.gravity * dt);
    }
    const surfaceAtFeet = terrainHeight(w.x, w.y);
    if (
      w.drillFeetY == null &&
      surfaceAtFeet < w.lastTerrainFeetY - 12 &&
      originalTerrainHeight(w.x, w.y) - surfaceAtFeet > 16
    ) {
      w.drillFeetY = w.lastTerrainFeetY;
      w.drillFallV = 0;
    }
    w.lastTerrainFeetY = w.drillFeetY ?? surfaceAtFeet;
  }

  stepSpells(state, dt);
  for (const wizard of state.wizards) stepHitKnockback(state, wizard, dt);
  state.terrainSupport?.stepCollapses();
  state.terrainFluids?.step(dt);
  for (const wizard of state.wizards) {
    if (!wizard.alive || !wizard.openingLanded) continue;
    const wasWet = wizard.waterWasWet || false;
    const contact = wizardWaterContact(state, wizard);
    setWaterContact(wizard, contact);
    if (contact) {
      stepBuoyancy(wizard, contact, dt, inputs?.[wizard.playerIndex] || {}, state.terrain);
      if (contact.swimming && contact.kind === 'river') {
        const currentSpeed = Math.hypot(contact.currentX, contact.currentZ);
        if (currentSpeed > 0)
          moveWizard(
            wizard,
            contact.currentX,
            contact.currentZ,
            (dt * currentSpeed) /
              (WIZARD.speed *
                wizard.waterMoveScale *
                (wizard.slowFactor || 1) *
                (wizard.hasteFactor || 1)),
            state.obstacles,
          );
      }
      if (
        !contact.swimming &&
        wizard.drillFeetY != null &&
        wizard.drillFeetY <= contact.ground + 4
      ) {
        wizard.drillFeetY = null;
        wizard.waterVelocity = 0;
      }
      if (!wasWet || (wizard.moving && state.time >= (wizard.nextWaterRipple || 0))) {
        state.events.push({
          type: wasWet ? 'water-ripple' : 'water-splash',
          wizardId: wizard.id,
          x: wizard.x,
          y: wizard.y,
          worldZ: contact.level,
          radius: wasWet ? 24 : 48,
          color: '#b9edff',
        });
        wizard.nextWaterRipple = state.time + 0.4;
      }
      if (wizard.dotKind === 'burn') {
        wizard.dotTimer = wizard.dotDamage = 0;
        wizard.dotKind = null;
      }
    } else {
      wizard.waterVelocity = 0;
    }
    wizard.waterWasWet = !!contact;
  }
  if (state.time >= (state.nextLavaSupportTick || 0)) {
    state.nextLavaSupportTick = state.time + 0.5;
    for (const node of [...(state.terrainSupport?.nodes.values() || [])]) {
      const fluid = state.terrainFluids.fluidAt(node.x, node.z, node.y);
      if (fluid?.kind === 'lava' && fluid.amount > 0.2)
        state.terrainSupport.damageNode(node.id, 6 * fluid.amount);
    }
  }
  for (const wizard of state.wizards) {
    if (!wizard.alive || wizard.drillFeetY == null) continue;
    const fluid = state.terrainFluids?.fluidAt(wizard.x, wizard.y, wizard.drillFeetY + 48);
    if (!fluid || fluid.amount < 0.2) continue;
    if (fluid.kind === 'lava') {
      const amount = 18 * fluid.amount * dt;
      const absorbed = Math.min(wizard.shield || 0, amount);
      wizard.shield -= absorbed;
      wizard.health -= amount - absorbed;
    } else {
      wizard.slowFactor = Math.min(wizard.slowFactor || 1, 0.8);
      wizard.slowTimer = Math.max(wizard.slowTimer || 0, 0.2);
      if (wizard.dotKind === 'burn') {
        wizard.dotTimer = 0;
        wizard.dotDamage = 0;
        wizard.dotKind = null;
      }
    }
  }
  if (!state.sandbox) {
    applyStorm(state, dt); // no storm damage while free-roaming for tests
    checkEliminations(state);
    checkWin(state); // and never auto-declare victory with nobody to fight
  }
  return state;
}
