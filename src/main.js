// Browser wiring for WandWars: menu, input (WASD, Shift-run, Space-jump,
// mouse aim + click to cast), and the 2D HUD drawn on top of the 3D view. All the
// game RULES live in the pure, unit-tested `game.js`.
import {
  createState,
  update,
  ARENA,
  STORM,
  WIZARD,
  STAMINA,
  OPENING,
  PORTAL_DESTINATIONS,
  BASE_WEAPONS,
  ATTACKS,
  ATTACK_SLOT_COUNT,
  ATTACK_PICKUP_RADIUS,
  attackRarityForWizard,
  effectiveAttackForWizard,
  nearestInteractableItem,
  LOOT_RARITIES,
  LOOT_MAJOR_AREAS,
  MANA_AMMUNITION,
  MANA_AMMUNITION_ORDER,
  terrainHeight,
  terrainMaterialAt,
  MAGICAL_DRILL,
} from './game.js';
import { itemName } from './items.js';
import { createRenderer, HUD_W, HUD_H } from './render3d.js';
import { ADS_SETTINGS, adsProfileForWeapon, advanceAdsAmount } from './ads.js';

// Keep every local preview on one origin. Mixed localhost/127.0.0.1 tabs cannot
// communicate through BroadcastChannel, so old 3D matches could keep their GPU
// contexts alive and prevent a new island from creating its renderer.
if (window.location.hostname === '127.0.0.1') {
  const canonical = new URL(window.location.href);
  canonical.hostname = 'localhost';
  window.location.replace(canonical);
}
// ---- DOM -------------------------------------------------------------------

const menu = document.getElementById('menu');
const settings = document.getElementById('settings');
const weaponSelect = document.getElementById('weapon-select');
const gameScreen = document.getElementById('game-screen');
const glCanvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
const hud = hudCanvas.getContext('2d');
const botsPicker = document.getElementById('bots-picker');
const weaponGrid = document.getElementById('weapon-grid');
const confirmWeaponButton = document.getElementById('confirm-weapon');
const settingsButton = document.getElementById('settings-button');
const settingsBackButton = document.getElementById('settings-back');
const fullscreenButton = document.getElementById('fullscreen-button');
const graphicsSetting = document.getElementById('setting-graphics');
const sensitivitySetting = document.getElementById('setting-sensitivity');
const sensitivityOutput = document.getElementById('setting-sensitivity-value');
const invertYSetting = document.getElementById('setting-invert-y');
const reducedMotionSetting = document.getElementById('setting-reduced-motion');
const digControlSetting = document.getElementById('setting-dig-control');
const volumeSettings = ['master', 'music', 'effects'].map((id) => ({
  input: document.getElementById(`setting-${id}`),
  output: document.getElementById(`setting-${id}-value`),
  key: `wandwars-${id}-volume`,
}));
const keybinds = document.getElementById('keybinds');
const resetKeybindsButton = document.getElementById('reset-keybinds');

const readSetting = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
};
const writeSetting = (key, value) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private browsing may disable storage */
  }
};
const DEFAULT_KEY_BINDINGS = {
  moveForward: 'KeyW',
  moveBack: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  sprint: 'ShiftLeft',
  jump: 'Space',
  crouch: 'ControlLeft',
  pickup: 'KeyF',
  holdToSwap: 'KeyT',
  dropItem: 'KeyG',
  dropOne: 'KeyH',
  dropStack: 'KeyJ',
  inventory: 'KeyE',
  map: 'KeyM',
  dig: 'KeyQ',
  digSpell: 'KeyY',
  drill: 'KeyV',
  slot1: 'Digit1',
  slot2: 'Digit2',
  slot3: 'Digit3',
  slot4: 'Digit4',
  slot5: 'Digit5',
  slot6: 'Digit6',
  menu: 'Escape',
  restart: 'KeyR',
};
const CONTROL_LABELS = {
  moveForward: 'Move forward',
  moveBack: 'Move backward',
  moveLeft: 'Move left',
  moveRight: 'Move right',
  sprint: 'Sprint',
  jump: 'Jump',
  crouch: 'Crouch / downward dig / Downdrill',
  pickup: 'Pick up',
  holdToSwap: 'Hold to swap / upgrade',
  dropItem: 'Drop selected item',
  dropOne: 'Drop one from stack',
  dropStack: 'Drop entire stack',
  inventory: 'Open inventory',
  map: 'Open map',
  dig: 'Magical digging',
  digSpell: 'Use selected digging ability',
  drill: 'Charge drill in digging mode',
  slot1: 'Hotbar slot 1',
  slot2: 'Hotbar slot 2',
  slot3: 'Hotbar slot 3',
  slot4: 'Hotbar slot 4',
  slot5: 'Hotbar slot 5',
  slot6: 'Hotbar slot 6',
  menu: 'Open menu',
  restart: 'Restart after defeat',
};
const MOUSE_LABELS = { 0: 'Left click', 1: 'Middle click', 2: 'Right click' };
let keyBindings = (() => {
  try {
    const saved = JSON.parse(readSetting('wandwars-key-bindings', '{}'));
    return Object.fromEntries(
      Object.entries(DEFAULT_KEY_BINDINGS).map(([action, fallback]) => [
        action,
        typeof saved[action] === 'string' ? saved[action] : fallback,
      ]),
    );
  } catch {
    return { ...DEFAULT_KEY_BINDINGS };
  }
})();
// E used to open the map. Move that old saved default to M so existing players
// receive the new inventory control without resetting their other bindings.
if (keyBindings.inventory === 'KeyE' && keyBindings.map === 'KeyE') keyBindings.map = 'KeyM';
let mouseBindings = {
  cast: Number(readSetting('wandwars-mouse-cast', '0')) === 1 ? 1 : 0,
};
let bindingCapture = null;
let mouseSensitivity = Number(readSetting('wandwars-mouse-sensitivity', '100')) / 100;
let invertY = readSetting('wandwars-invert-y', 'false') === 'true';
let digControl = readSetting('wandwars-dig-control', 'toggle') === 'hold' ? 'hold' : 'toggle';
const requestedGraphics = new URLSearchParams(window.location.search).get('graphics');
const itemDebug = new URLSearchParams(window.location.search).get('itemsDebug') === '1';
const terrainDebug = new URLSearchParams(window.location.search).get('terrainDebug') === '1';
const isSafari = /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent);
// Safari needs a smaller WebGL drawing buffer, but it can still render the
// proper island. Keep its input/startup compatibility behavior separate from
// the user's graphics choice.
const safariCompatibilityMode = isSafari;
let forceSafeGraphics =
  requestedGraphics === 'safe' ||
  (requestedGraphics !== 'detailed' && readSetting('wandwars-graphics', 'detailed') === 'safe');
let startLoading = document.getElementById('start-loading');
// Vite can hot-reload this module while an older preview tab still has the
// previous HTML. Build the loading panel on demand so Confirm never crashes in
// that stale-tab situation.
if (!startLoading) {
  startLoading = document.createElement('div');
  startLoading.id = 'start-loading';
  startLoading.setAttribute('role', 'status');
  startLoading.setAttribute('aria-live', 'polite');
  startLoading.hidden = true;
  startLoading.innerHTML = `
    <span class="loading-rune" aria-hidden="true">✦</span>
    <strong>Preparing the Island…</strong>
    <small>Building the detailed world. The portals will open when it is ready.</small>
  `;
  document.getElementById('stage').append(startLoading);
}

// Small read-only build facts used by browser regression tests. They also make
// it easy to confirm a deployed build contains the complete attack catalog.
document.documentElement.dataset.attackCount = String(Object.keys(ATTACKS).length);
document.documentElement.dataset.attackKinds = String(
  new Set(Object.values(ATTACKS).map((attack) => attack.kind)).size,
);

let botCount = 9; // number of computer wizards
let selectedBaseWeapon = null; // highlighted on the pre-match screen
let confirmedBaseWeapon = null; // immutable for the current match
let renderer = null;
let state = null;
let running = false;
let rafId = 0;
let last = 0;
let simulationLag = 0;
let ended = false; // the local player is out (dead) or the match is over
let lastPlayerHealth = WIZARD.maxHealth;
let damageFlash = 0;
let displayedStamina = STAMINA.max; // visually smoothed; gameplay still uses the exact value
let startGeneration = 0; // invalidates a delayed start if the player returns to the menu
const tabId =
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const gameTabChannel =
  !safariCompatibilityMode && typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('wandwars-active-match')
    : null;
let inactiveReleaseTimer = 0;
let graphicsRecoveryTimer = 0;
let graphicsRecoveryActive = false;

function showGraphicsRecovery() {
  if (gameScreen.hidden || graphicsRecoveryActive) return;
  graphicsRecoveryActive = true;
  startGeneration++;
  running = false;
  cancelAnimationFrame(rafId);
  gameScreen.dataset.starting = 'recovering';
  gameScreen.dataset.graphicsContext = 'lost';
  startLoading.hidden = false;
  startLoading.querySelector('strong').textContent = 'Restoring the Island…';
  startLoading.querySelector('small').textContent =
    'The browser paused the 3D world. WandWars is rebuilding it automatically.';
  window.clearTimeout(graphicsRecoveryTimer);
  graphicsRecoveryTimer = window.setTimeout(() => {
    // Some embedded browsers never send webglcontextrestored. One clean reload
    // is safer than leaving the player staring at the canvas clear colour.
    const url = new URL(window.location.href);
    if (url.searchParams.get('graphicsRecovery') !== '1') {
      url.searchParams.set('graphics', 'safe');
      url.searchParams.set('graphicsRecovery', '1');
      url.searchParams.set('version', 'blue-screen-recovery-20260906');
      window.location.replace(url);
      return;
    }
    gameScreen.dataset.starting = 'failed';
    startLoading.querySelector('strong').textContent = 'Graphics Need a Fresh Tab';
    startLoading.querySelector('small').textContent =
      'Close the other WandWars tab, then reload this page.';
  }, 3500);
}

function onWebglContextLost(event) {
  event.preventDefault();
  console.warn('[graphics] WebGL context lost; starting automatic recovery');
  forceSafeGraphics = true;
  showGraphicsRecovery();
}

function onWebglContextRestored() {
  console.info('[graphics] WebGL context restored');
  window.clearTimeout(graphicsRecoveryTimer);
  if (!graphicsRecoveryActive || gameScreen.hidden) return;
  // A restored context does not make the old Three.js renderer reliable again.
  // Release its CPU-side resources and rebuild the scene in safe mode.
  renderer?.dispose(false);
  renderer = null;
  graphicsRecoveryActive = false;
  gameScreen.dataset.graphicsContext = 'restored';
  window.setTimeout(() => startMatch(1), 150);
}

glCanvas.addEventListener('webglcontextlost', onWebglContextLost, false);
glCanvas.addEventListener('webglcontextrestored', onWebglContextRestored, false);

// ---- Input -----------------------------------------------------------------

const held = new Set();
let yaw = 0; // character (capsule) facing; horizontal axis spins this
let pitch = -0.26; // downward Fortnite-style framing; mouse controls it afterward
let casting = false;
let jumpQueued = false; // one jump per physical Space press (no auto-bunny-hop)
let jumpQueuedUntil = 0; // retain short presses until a physics step can accept them
let pickupQueued = false; // F stays buffered briefly so a low frame cannot swallow the press
let pickupQueuedUntil = 0;
let pickupPressedAt = 0;
let dropOneQueued = false;
let dropStackQueued = false;
let inventorySelectQueued = null;
const JUMP_INPUT_BUFFER_MS = 220;
const PICKUP_INPUT_BUFFER_MS = 650;
let mapOpen = false; // M toggles the full-screen tactical map
let inventoryOpen = false; // E opens the same six carried slots at readable size
let diggingMode = false; // customizable Dig binding, held or toggled
let diggingAction = false;
let primaryHeld = false;
let rightDigHeld = false;
let digShotQueued = false;
let digShotDirection = 'forward';
let digActionTimer = 0;
let drillHeld = false;
let digSpellQueued = false;
let selectedAttackSlot = -1; // selected occupied slot; -1 while the player is unarmed
let flying = false; // free-flight toggle (sandbox only; hotbar slot after spells)
const FLY_SLOT = ATTACK_SLOT_COUNT - 1; // sandbox-only Fly button occupies slot 6
let wheelAccum = 0; // collect tiny trackpad deltas into one deliberate gesture
const DIG_SIZE_PROFILES = [
  { length: MAGICAL_DRILL.precisionLength, radius: MAGICAL_DRILL.precisionRadius },
  { length: 120, radius: 110 },
  { length: 168, radius: 94 },
  { length: 216, radius: 78 },
  { length: 264, radius: 62 },
  { length: 300, radius: 48 },
];
let digSizeIndex = 0;
let digWheelRadius = DIG_SIZE_PROFILES[0].radius;
let digWheelLength = DIG_SIZE_PROFILES[0].length;
let lastWheelStep = 0; // throttle momentum without locking the entire gesture
let wheelResetTimer = 0;
let pickupNotice = null;
let pickupNoticeTimer = 0;
const WHEEL_THRESHOLD = 35;
const DIG_WHEEL_THRESHOLD = 18;
const WHEEL_STEP_PAUSE = 120;
const WHEEL_RESET_PAUSE = 180;
let ads = false;
let adsAmount = 0;
let fov = ADS_SETTINGS.hipFov;
let locked = false; // pointer lock engaged (unbounded mouse-look + free 360)
// Mouse-look is strictly delta-driven: the view stops the moment the mouse stops.
const PITCH_MAX = Math.PI / 2 - 0.002; // effectively vertical without a lookAt singularity
const MOUSE_SENS = 0.0028; // radians of turn per pixel of mouse movement
// Keep physics stable without tying game time to rendering speed. The detailed
// island can render slowly on some computers; previously the 0.05-second frame
// clamp made the opening countdown appear frozen. We now catch up in small,
// safe simulation steps while limiting long background-tab jumps.
const SIMULATION_STEP = 0.05;
const MAX_SIMULATION_CATCHUP = 1;
// The portal sequence is safe to catch up farther than combat. A detailed first
// frame can take several seconds while wizard rigs and scenery reach the GPU;
// letting opening time catch up prevents the initial "3" from appearing frozen.
const MAX_OPENING_CATCHUP = OPENING.countdown + OPENING.chooseTime;
// A slow GPU may take several seconds to draw one detailed frame. Never let a
// single frame consume more than one countdown number: 3, 2 and 1 must each be
// drawn before the portals open, even if that makes the countdown slightly
// longer on a struggling computer.
const MAX_COUNTDOWN_STEP = 0.9;

function matchesBinding(action, event) {
  return keyBindings[action] === event.code;
}

function dirForKey(key, code) {
  if (matchesBinding('moveForward', { code }) || key === 'ArrowUp') return 'up';
  if (matchesBinding('moveBack', { code }) || key === 'ArrowDown') return 'down';
  if (matchesBinding('moveLeft', { code }) || key === 'ArrowLeft') return 'left';
  if (matchesBinding('moveRight', { code }) || key === 'ArrowRight') return 'right';
  return null;
}

function onKeyDown(e) {
  const dir = dirForKey(e.key, e.code);
  if (dir) {
    held.add(dir);
    e.preventDefault();
    return;
  }
  if (matchesBinding('sprint', e)) {
    if (!e.repeat) {
      if (held.has('run')) held.delete('run');
      else held.add('run');
    }
    e.preventDefault();
    return;
  }
  if (matchesBinding('jump', e)) {
    held.add('jump');
    if (!e.repeat) {
      jumpQueued = true;
      jumpQueuedUntil = performance.now() + JUMP_INPUT_BUFFER_MS;
    }
    e.preventDefault();
    return;
  }
  if (matchesBinding('crouch', e)) {
    held.add('crouch');
    e.preventDefault();
    return;
  }
  if (matchesBinding('pickup', e)) {
    if (!e.repeat) {
      held.add('pickup');
      pickupPressedAt = performance.now();
    }
    e.preventDefault();
    return;
  }
  if (matchesBinding('holdToSwap', e)) {
    held.add('swap');
    e.preventDefault();
    return;
  }
  if (matchesBinding('dropItem', e) || matchesBinding('dropOne', e)) {
    if (!e.repeat) dropOneQueued = true;
    e.preventDefault();
    return;
  }
  if (matchesBinding('dropStack', e)) {
    if (!e.repeat) dropStackQueued = true;
    e.preventDefault();
    return;
  }
  if (matchesBinding('inventory', e)) {
    if (!e.repeat && state) {
      inventoryOpen = !inventoryOpen;
      if (inventoryOpen) mapOpen = false;
      gameScreen.dataset.inventoryOpen = String(inventoryOpen);
      gameScreen.dataset.mapOpen = String(mapOpen);
    }
    e.preventDefault();
    return;
  }
  if (matchesBinding('map', e)) {
    if (!e.repeat && state) {
      mapOpen = !mapOpen;
      if (mapOpen) inventoryOpen = false;
      gameScreen.dataset.mapOpen = String(mapOpen);
      gameScreen.dataset.inventoryOpen = String(inventoryOpen);
    }
    e.preventDefault();
    return;
  }
  if (matchesBinding('dig', e)) {
    if (!e.repeat && state && player().alive && !ended) {
      setDiggingMode(digControl === 'toggle' ? !diggingMode : true);
    }
    e.preventDefault();
    return;
  }
  if (matchesBinding('digSpell', e)) {
    if (diggingMode && !e.repeat) {
      digSpellQueued = true;
    }
    e.preventDefault();
    return;
  }
  if (matchesBinding('drill', e)) {
    if (diggingMode) drillHeld = true;
    e.preventDefault();
    return;
  }
  const slotCode = Object.entries(keyBindings).find(
    ([action, code]) => action.startsWith('slot') && code === e.code,
  )?.[0];
  if (slotCode) {
    const idx = Number(slotCode.slice(4)) - 1;
    const item = state?.wizards?.[0]?.inventorySlots?.[idx];
    if (state?.sandbox && idx === FLY_SLOT && !item) {
      selectedAttackSlot = idx;
      flying = !flying; // toggle free flight (sandbox only)
      gameScreen.dataset.hotbarSlot = String(idx + 1);
      return;
    }
    if (idx < ATTACK_SLOT_COUNT && item) {
      selectHotbarSlot(idx);
    }
    return;
  }
  if (matchesBinding('restart', e)) {
    if (ended) showWeaponSelection();
  } else if (matchesBinding('menu', e)) {
    showMenu();
  }
}
function onKeyUp(e) {
  if (matchesBinding('dig', e) && digControl === 'hold') setDiggingMode(false);
  const dir = dirForKey(e.key, e.code);
  if (dir) held.delete(dir);
  if (matchesBinding('jump', e)) held.delete('jump');
  if (matchesBinding('crouch', e)) held.delete('crouch');
  if (matchesBinding('pickup', e)) {
    held.delete('pickup');
    if (pickupPressedAt && performance.now() - pickupPressedAt < 650) {
      pickupQueued = true;
      pickupQueuedUntil = performance.now() + PICKUP_INPUT_BUFFER_MS;
    }
    pickupPressedAt = 0;
  }
  if (matchesBinding('holdToSwap', e)) held.delete('swap');
  if (matchesBinding('drill', e)) drillHeld = false;
  // Some browsers reserve Escape's keydown solely for leaving pointer lock but
  // still deliver its keyup. Handle that half of the same physical press so a
  // second Escape is never required.
  if (matchesBinding('menu', e) && !gameScreen.hidden) showMenu();
}

function resetWheelGesture() {
  wheelAccum = 0;
  lastWheelStep = 0;
  wheelResetTimer = 0;
}

function selectHotbarSlot(index) {
  selectedAttackSlot = (index + ATTACK_SLOT_COUNT) % ATTACK_SLOT_COUNT;
  if (state?.wizards?.[0]) state.wizards[0].selectedInventorySlot = selectedAttackSlot;
  inventorySelectQueued = selectedAttackSlot;
  flying = false;
  if (gameScreen) gameScreen.dataset.hotbarSlot = String(selectedAttackSlot + 1);
}

// Scroll the mouse wheel to cycle only occupied item/attack slots. Empty slots are
// skipped; small trackpad deltas accumulate, while a short time throttle keeps
// momentum from racing across the whole bar. The window listener works over
// either canvas.
function onWheel(e) {
  e.preventDefault();
  clearTimeout(wheelResetTimer);
  wheelResetTimer = window.setTimeout(() => {
    wheelAccum = 0;
    wheelResetTimer = 0;
  }, WHEEL_RESET_PAUSE);
  if (e.deltaY === 0) return;

  const scale =
    e.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 100
        : 1;
  wheelAccum += e.deltaY * scale;
  if (diggingMode && state?.wizards?.[0]?.alive) {
    if (Math.abs(wheelAccum) < DIG_WHEEL_THRESHOLD) return;
    const dir = wheelAccum > 0 ? 1 : -1;
    digSizeIndex = Math.max(0, Math.min(DIG_SIZE_PROFILES.length - 1, digSizeIndex - dir));
    digWheelRadius = DIG_SIZE_PROFILES[digSizeIndex].radius;
    digWheelLength = DIG_SIZE_PROFILES[digSizeIndex].length;
    wheelAccum = 0;
    gameScreen.dataset.digRadius = String(digWheelRadius);
    gameScreen.dataset.digLength = String(digWheelLength);
    return;
  }
  if (Math.abs(wheelAccum) < WHEEL_THRESHOLD) return;
  const now = performance.now();
  if (lastWheelStep > 0 && now - lastWheelStep < WHEEL_STEP_PAUSE) return;
  const dir = wheelAccum > 0 ? 1 : -1;
  const current = flying ? FLY_SLOT : selectedAttackSlot;
  const me = state?.wizards?.[0];
  const available = [];
  for (let index = 0; index < ATTACK_SLOT_COUNT; index++) {
    if (me?.inventorySlots?.[index]) available.push(index);
  }
  if (state?.sandbox && !me?.inventorySlots?.[FLY_SLOT] && !available.includes(FLY_SLOT)) {
    available.push(FLY_SLOT);
  }
  if (!available.length) {
    wheelAccum = 0;
    return;
  }
  let currentIndex = available.indexOf(current);
  if (currentIndex < 0) currentIndex = dir > 0 ? -1 : 0;
  const next = available[(currentIndex + dir + available.length) % available.length];
  selectHotbarSlot(next);
  if (state?.sandbox && next === FLY_SLOT && !state.wizards?.[0]?.inventorySlots?.[next]) {
    flying = true;
  }
  wheelAccum = 0;
  lastWheelStep = now;
}

// Moving the mouse turns the view 1:1 (yaw) and tilts it (pitch). movementX/Y
// are reported whether or not the pointer is locked, so this works in-iframe.
function onMouseMove(e) {
  const adsSensitivity = 1 + (ADS_SETTINGS.lookSensitivity - 1) * adsAmount;
  const sens = MOUSE_SENS * mouseSensitivity * adsSensitivity;
  yaw += (e.movementX || 0) * sens;
  const vertical = (e.movementY || 0) * sens * (invertY ? -1 : 1);
  pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, pitch - vertical));
}
function requestLock() {
  if (locked || !glCanvas.requestPointerLock) return;
  gameScreen.dataset.pointerLockRequested = 'true';
  try {
    // Blocked in sandboxed iframes (the preview); works in a real browser tab.
    const p = glCanvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {}); // swallow the rejection quietly
  } catch {
    /* ignore */
  }
}
function onPointerLockChange() {
  const wasLocked = locked;
  locked = document.pointerLockElement === glCanvas;
  // Browsers consume the first Escape press to release pointer lock before the
  // game receives a key event. Treat that release as the same Escape action so
  // one press always returns to the menu. stopGame removes this listener before
  // releasing the lock itself, which prevents a recursive menu transition.
  if (wasLocked && !locked && !gameScreen.hidden) showMenu();
}
function syncMouseActions() {
  casting = primaryHeld && !diggingMode;
  renderer?.setDiggingMode?.(diggingMode);
  renderer?.setDiggingAction?.(diggingAction);
  gameScreen.dataset.diggingAction = String(diggingAction);
}
function queueDigShot(direction) {
  digShotQueued = true;
  digShotDirection = direction;
  diggingAction = true;
  renderer?.flashDigBeam?.();
  clearTimeout(digActionTimer);
  digActionTimer = window.setTimeout(() => {
    diggingAction = false;
    syncMouseActions();
  }, 450);
}
function setDiggingMode(active) {
  if (diggingMode === active) return;
  diggingMode = active;
  if (!active) {
    rightDigHeld = false;
    digShotQueued = false;
    diggingAction = false;
    clearTimeout(digActionTimer);
    drillHeld = false;
    updateDrillAudio(null);
  } else {
    drillHeld = false;
    ads = false;
  }
  syncMouseActions();
  gameScreen.dataset.diggingMode = String(active);
}
function onMouseDown(e) {
  onMouseMove(e);
  requestLock(); // clicking captures the mouse for free 360° look
  if (e.button === 2) {
    if (diggingMode && !rightDigHeld) queueDigShot('down');
    rightDigHeld = diggingMode;
    ads = !diggingMode;
  } else if (diggingMode && e.button === 0) {
    if (!primaryHeld) queueDigShot(held.has('crouch') ? 'down' : 'forward');
    primaryHeld = true;
  } else if (e.button === mouseBindings.cast) primaryHeld = true;
  syncMouseActions();
}
function onMouseUp(e) {
  if (e.button === 2) {
    rightDigHeld = false;
    ads = false;
  } else if (e.button === mouseBindings.cast || (diggingMode && e.button === 0))
    primaryHeld = false;
  syncMouseActions();
}
function onWindowBlur() {
  // A browser can miss mouseup when focus changes while a tool is held.
  primaryHeld = false;
  rightDigHeld = false;
  digShotQueued = false;
  diggingAction = false;
  clearTimeout(digActionTimer);
  ads = false;
  setDiggingMode(false);
  syncMouseActions();
  drillHeld = false;
  updateDrillAudio(null);
  held.delete('pickup');
  held.delete('swap');
  pickupPressedAt = 0;
}
function onContextMenu(e) {
  e.preventDefault(); // right button zooms or digs instead of opening the browser menu
}
function readInput() {
  // Move relative to where you're looking: W/S forward/back, A/D strafe.
  const forward = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
  const strafe = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  const rx = -Math.sin(yaw); // screen-right relative to the facing
  const ry = Math.cos(yaw);
  // Aim at the exact point the center crosshair is over, so shots line up.
  const t = (diggingMode && renderer.getDigAimTarget?.()) || renderer.crosshairTarget(state, 0);
  // A third-person camera can be hundreds of units behind the shovel. When
  // its center ray lands beyond arm's reach, keep the brush on the same facing
  // line at a usable distance instead of making every strike silently miss.
  const player = state?.wizards?.[0];
  const digDistance = player ? Math.hypot(t.x - player.x, t.y - player.y) : Infinity;
  const digTarget =
    diggingMode && player && digDistance > 220
      ? {
          x: player.x + fx * 145,
          y: player.y + fy * 145,
          z:
            terrainHeight(player.x + fx * 145, player.y + fy * 145) -
            terrainHeight(player.x, player.y),
          targetId: null,
        }
      : t;
  // While flying, W/S move along where you LOOK: the horizontal reach shrinks as
  // you pitch up/down, and the leftover goes into vertical ascent/descent.
  const cp = flying ? Math.cos(pitch) : 1;
  if (jumpQueued && performance.now() > jumpQueuedUntil) {
    jumpQueued = false;
    jumpQueuedUntil = 0;
  }
  const jump = jumpQueued;
  const pickup = pickupQueued && performance.now() <= pickupQueuedUntil;
  if (!pickup) {
    pickupQueued = false;
    pickupQueuedUntil = 0;
  }
  const attack = state?.wizards?.[0]?.attackSlots?.[selectedAttackSlot] || null;
  return {
    dx: fx * forward * cp + rx * strafe,
    dy: fy * forward * cp + ry * strafe,
    yaw, // the horizontal axis rotates the character capsule
    aimX: digTarget.x,
    aimY: digTarget.y,
    aimZ: digTarget.z,
    aimTargetId: digTarget.targetId,
    attack,
    cast: casting && !diggingMode,
    dig: digShotQueued && diggingMode && !drillHeld,
    digDirection: digShotQueued
      ? digShotDirection
      : rightDigHeld || (diggingMode && primaryHeld && held.has('crouch'))
        ? 'down'
        : 'forward',
    digAimPitch: pitch,
    digAimX: t.x,
    digAimZ: t.y,
    digAimY: player ? terrainHeight(player.x, player.y) + t.z : t.z,
    digAimHit: t.hitKind,
    digRadius: digWheelRadius,
    digLength: digWheelLength,
    digMode: diggingMode,
    drillHeld: drillHeld && diggingMode,
    crouch: held.has('crouch'),
    jumpHeld: held.has('jump'),
    digSpell: digSpellQueued && diggingMode,
    up: held.has('up'), // W climbs upward after a running-jump wall grab
    down: held.has('down'), // S climbs down; S + Space jumps off the wall
    run: held.has('run'), // Shift turns the slower walk into a sprint
    jump,
    pickup,
    holdSwap: held.has('pickup') || held.has('swap'),
    dropOne: dropOneQueued,
    dropStack: dropStackQueued,
    inventorySelect: inventorySelectQueued,
    flying,
    flyUp: flying ? forward * Math.sin(pitch) : 0, // look up + W to ascend
  };
}

// ---- HUD -------------------------------------------------------------------

function player() {
  return state.wizards[0];
}

function drawBar(x, y, w, h, pct, color) {
  hud.fillStyle = 'rgba(0,0,0,0.55)';
  hud.fillRect(x - 1, y - 1, w + 2, h + 2);
  hud.fillStyle = color;
  hud.fillRect(x, y, w * Math.max(0, pct), h);
}

function drawEnemyHealthBars() {
  for (const w of state.wizards) {
    if (!w.alive || w.isPlayer) continue;
    const p = renderer.wizardToScreen(w, 122);
    if (!p.visible || p.x < -40 || p.x > HUD_W + 40) continue;
    const bw = 42;
    drawBar(p.x - bw / 2, p.y, bw, 5, w.health / WIZARD.maxHealth, '#f87171');
  }
}

function drawPlayerStaminaBar(me) {
  if (!me.alive) return;
  const p = renderer.wizardToScreen(me, 170);
  if (!p.visible || p.x < -40 || p.x > HUD_W + 40 || p.y < -20 || p.y > HUD_H + 20) return;

  const width = 46;
  const height = 5;
  const x = p.x - width / 2;
  const y = p.y;
  const amount = Math.max(0, Math.min(1, displayedStamina / STAMINA.max));
  hud.save();
  hud.fillStyle = 'rgba(5, 8, 18, 0.72)';
  hud.fillRect(x - 2, y - 2, width + 4, height + 4);
  hud.fillStyle = 'rgba(255, 255, 255, 0.2)';
  hud.fillRect(x, y, width, height);
  hud.fillStyle = '#ffffff';
  hud.fillRect(x, y, width * amount, height);
  hud.restore();
}

function drawMinimap() {
  const R = 78;
  const cx = HUD_W - R - 22;
  const cy = R + 46; // top-right, tucked under the storm status
  const toMap = (x, y) => ({ x: cx + (x / ARENA.radius) * R, y: cy + (y / ARENA.radius) * R });
  hud.save();
  hud.beginPath();
  hud.arc(cx, cy, R, 0, Math.PI * 2);
  hud.fillStyle = 'rgba(10,10,26,0.72)';
  hud.fill();
  hud.strokeStyle = '#3a3560';
  hud.lineWidth = 2;
  hud.stroke();
  // Safe circle.
  const s = state.storm;
  hud.beginPath();
  const sc = toMap(s.cx, s.cy);
  hud.arc(sc.x, sc.y, (s.radius / ARENA.radius) * R, 0, Math.PI * 2);
  hud.strokeStyle = s.radius < 260 ? '#f87171' : '#c084fc';
  hud.lineWidth = 1.5;
  hud.stroke();
  // Wizards.
  for (const w of state.wizards) {
    if (!w.alive) continue;
    const m = toMap(w.x, w.y);
    hud.beginPath();
    hud.arc(m.x, m.y, w.isPlayer ? 3.5 : 2.5, 0, Math.PI * 2);
    hud.fillStyle = w.isPlayer ? '#ffffff' : w.color;
    hud.fill();
  }
  hud.restore();
}

function drawFullMap() {
  const cx = HUD_W / 2;
  const cy = HUD_H / 2 + 10;
  const radius = Math.min(HUD_H * 0.39, HUD_W * 0.31);
  const toMap = (x, y) => ({
    x: cx + (x / ARENA.radius) * radius,
    y: cy + (y / ARENA.radius) * radius,
  });
  const regionColors = {
    castle: '#7c6bb3',
    highlands: '#316c53',
    harvest: '#8a7a38',
    harbor: '#356c88',
    'desert-town': '#9b6332',
    mine: '#555766',
  };

  hud.save();
  hud.fillStyle = 'rgba(5, 8, 22, 0.94)';
  hud.fillRect(0, 0, HUD_W, HUD_H);
  hud.textAlign = 'center';
  hud.fillStyle = '#fff4c4';
  hud.font = '900 28px Georgia, serif';
  hud.fillText('WANDWARS ISLAND', cx, 39);
  hud.fillStyle = '#9fb0d1';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.fillText('M · CLOSE MAP', cx, 60);

  // Ocean and irregular-looking island base.
  hud.beginPath();
  hud.arc(cx, cy, radius + 11, 0, Math.PI * 2);
  hud.fillStyle = '#174c67';
  hud.fill();
  hud.beginPath();
  hud.arc(cx, cy, radius, 0, Math.PI * 2);
  hud.fillStyle = '#486a3e';
  hud.fill();
  hud.clip();

  // Broad colored areas make the six important locations recognizable.
  for (const area of LOOT_MAJOR_AREAS) {
    const p = toMap(area.x, area.y);
    hud.beginPath();
    hud.arc(p.x, p.y, Math.max(25, (area.radius / ARENA.radius) * radius), 0, Math.PI * 2);
    hud.fillStyle = `${regionColors[area.id] || '#556b4b'}cc`;
    hud.fill();
  }

  // Coordinate grid for quickly calling out directions.
  hud.strokeStyle = 'rgba(226,232,240,0.12)';
  hud.lineWidth = 1;
  for (const fraction of [-0.5, 0, 0.5]) {
    hud.beginPath();
    hud.moveTo(cx - radius, cy + radius * fraction);
    hud.lineTo(cx + radius, cy + radius * fraction);
    hud.stroke();
    hud.beginPath();
    hud.moveTo(cx + radius * fraction, cy - radius);
    hud.lineTo(cx + radius * fraction, cy + radius);
    hud.stroke();
  }

  // Remaining loot crystals use their rarity color.
  for (const pickup of state.attackPickups || []) {
    if (pickup.collectedBy != null) continue;
    const p = toMap(pickup.x, pickup.y);
    hud.fillStyle = LOOT_RARITIES[pickup.rarity]?.color || LOOT_RARITIES.common.color;
    hud.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }

  // Current safe zone.
  const stormCenter = toMap(state.storm.cx, state.storm.cy);
  hud.beginPath();
  hud.arc(
    stormCenter.x,
    stormCenter.y,
    (state.storm.radius / ARENA.radius) * radius,
    0,
    Math.PI * 2,
  );
  hud.strokeStyle = state.storm.radius < 260 ? '#f87171' : '#d8b4fe';
  hud.lineWidth = 3;
  hud.stroke();

  // Players and bots.
  for (const wizard of state.wizards) {
    if (!wizard.alive) continue;
    const p = toMap(wizard.x, wizard.y);
    if (wizard.isPlayer) {
      hud.save();
      hud.translate(p.x, p.y);
      hud.rotate(wizard.heading);
      hud.beginPath();
      hud.moveTo(10, 0);
      hud.lineTo(-7, -6);
      hud.lineTo(-4, 0);
      hud.lineTo(-7, 6);
      hud.closePath();
      hud.fillStyle = '#ffffff';
      hud.shadowColor = '#38bdf8';
      hud.shadowBlur = 8;
      hud.fill();
      hud.restore();
    } else {
      hud.beginPath();
      hud.arc(p.x, p.y, 3, 0, Math.PI * 2);
      hud.fillStyle = '#f87171';
      hud.fill();
    }
  }
  hud.restore();

  // Labels are drawn after restoring the island clip.
  hud.save();
  hud.textAlign = 'center';
  hud.font = 'bold 11px system-ui, sans-serif';
  for (const area of LOOT_MAJOR_AREAS) {
    const p = toMap(area.x, area.y);
    hud.fillStyle = '#ffffff';
    hud.shadowColor = '#07101c';
    hud.shadowBlur = 5;
    hud.fillText(area.name, p.x, p.y - 12);
  }
  hud.fillStyle = '#e2e8f0';
  hud.font = '900 15px system-ui, sans-serif';
  hud.fillText('N', cx, cy - radius - 16);
  hud.textAlign = 'left';
  hud.fillStyle = '#ffffff';
  hud.fillText('▲ You', 30, HUD_H - 54);
  hud.fillStyle = '#f87171';
  hud.fillText('● Bots', 30, HUD_H - 30);
  hud.textAlign = 'right';
  hud.fillStyle = '#d8b4fe';
  hud.fillText('Storm circle', HUD_W - 30, HUD_H - 42);
  hud.restore();
}

function drawInventory() {
  const me = player();
  hud.save();
  hud.fillStyle = 'rgba(5, 8, 22, 0.95)';
  hud.fillRect(0, 0, HUD_W, HUD_H);
  hud.textAlign = 'left';
  hud.fillStyle = '#fff4c4';
  hud.font = '900 30px Georgia, serif';
  hud.fillText('INVENTORY', 58, 64);
  hud.fillStyle = '#9fb0d1';
  hud.font = 'bold 13px system-ui, sans-serif';
  hud.fillText('E close · M map · 1–6 select · G drop · H drop one · J drop stack', 58, 87);

  for (let index = 0; index < HOTBAR_SLOTS; index++) {
    const item = me.inventorySlots?.[index];
    const selected = index === selectedAttackSlot;
    const top = 112 + index * 62;
    hud.fillStyle = selected ? 'rgba(87, 67, 146, 0.6)' : 'rgba(33, 42, 65, 0.82)';
    hud.fillRect(58, top, 520, 54);
    hud.strokeStyle = selected ? '#d8b4fe' : '#4b5573';
    hud.lineWidth = selected ? 2 : 1;
    hud.strokeRect(58, top, 520, 54);
    hud.fillStyle = selected ? '#ffffff' : '#94a3b8';
    hud.font = '900 17px system-ui, sans-serif';
    hud.fillText(String(index + 1), 75, top + 33);
    hud.fillStyle = item ? LOOT_RARITIES[item.rarity]?.color || '#e2e8f0' : '#64748b';
    hud.font = item ? 'bold 16px system-ui, sans-serif' : '14px system-ui, sans-serif';
    hud.fillText(item ? itemName(item, ATTACKS) : 'Empty slot', 114, top + 25);
    if (item) {
      hud.fillStyle = '#a9b7cc';
      hud.font = '12px system-ui, sans-serif';
      const rarity = LOOT_RARITIES[item.rarity]?.name || 'Item';
      hud.fillText(
        `${rarity}${item.quantity > 1 ? ` · ${item.quantity} carried` : ''}`,
        114,
        top + 43,
      );
    }
  }

  hud.fillStyle = 'rgba(33, 42, 65, 0.82)';
  hud.fillRect(604, 112, 362, 154);
  hud.fillRect(604, 282, 362, 202);
  hud.fillStyle = '#fff4c4';
  hud.font = '900 17px system-ui, sans-serif';
  hud.fillText('BASE WEAPON', 624, 145);
  const weapon = BASE_WEAPONS[me.baseWeaponId];
  hud.fillStyle = '#e2e8f0';
  hud.font = 'bold 15px system-ui, sans-serif';
  hud.fillText(weapon?.name || 'None', 624, 177);
  hud.fillStyle = '#9fb0d1';
  hud.font = '13px system-ui, sans-serif';
  hud.fillText('Permanent · does not use a hotbar slot', 624, 204);

  hud.fillStyle = '#fff4c4';
  hud.font = '900 17px system-ui, sans-serif';
  hud.fillText('MANA POUCH', 624, 315);
  MANA_AMMUNITION_ORDER.forEach((id, index) => {
    const ammo = MANA_AMMUNITION[id];
    const top = 343 + index * 27;
    hud.fillStyle = ammo.color;
    hud.fillRect(624, top - 9, 9, 9);
    hud.font = 'bold 13px system-ui, sans-serif';
    hud.textAlign = 'left';
    hud.fillText(ammo.name, 644, top);
    hud.textAlign = 'right';
    hud.fillText(`${Math.floor(me.manaPouch?.[id] || 0)}/${ammo.max}`, 944, top);
  });
  hud.textAlign = 'center';
  hud.fillStyle = '#9fb0d1';
  hud.font = '13px system-ui, sans-serif';
  hud.fillText('Pick up items with F when you are near them', HUD_W / 2, 535);
  hud.restore();
}

// The hotbar: six square slots anchored in the bottom-right. Slots 1..N hold the
// spellbook (hotkey, colored icon, selection highlight); the rest sit empty,
// ready for future spells. Number keys 1..6 select a slot.
const HOTBAR_SLOTS = 6;
const HOTBAR_SIZE = 48;
const HOTBAR_GAP = 6;
const HOTBAR_W = HOTBAR_SLOTS * HOTBAR_SIZE + (HOTBAR_SLOTS - 1) * HOTBAR_GAP;
const HOTBAR_RIGHT_INSET = 22; // matches the round minimap's right edge
const hotbarX = () => HUD_W - HOTBAR_W - HOTBAR_RIGHT_INSET;
const hotbarY = () => HUD_H - HOTBAR_SIZE - 18;
const ATTACK_GLYPHS = {
  projectile: '✦',
  beam: '━',
  melee: '╱',
  nova: '◎',
  heal: '+',
  shield: '◇',
  dash: '»',
  trap: '△',
  grapple: '⌁',
  movement: '»',
  summon: '♜',
  utility: '◆',
};

function drawHotbar(me) {
  const x0 = hotbarX();
  const centerX = x0 + HOTBAR_W / 2;
  const y = hotbarY();
  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    const x = x0 + i * (HOTBAR_SIZE + HOTBAR_GAP);
    const item = me.inventorySlots?.[i] || null;
    const id = me.attackSlots?.[i] || null;
    const attack = item?.attackId === id && id ? ATTACKS[id] : null;
    const rarity = item ? LOOT_RARITIES[item.rarity] : null;
    const isFly = state.sandbox && i === FLY_SLOT && !item; // Fly fills an empty slot 6
    const selected = (!flying && !!item && selectedAttackSlot === i) || (isFly && flying);
    const cx = x + HOTBAR_SIZE / 2;

    // Slot background.
    hud.fillStyle = 'rgba(10,10,26,0.72)';
    hud.fillRect(x, y, HOTBAR_SIZE, HOTBAR_SIZE);

    if (attack) {
      // Colored icon disc. Attacks are always immediately ready when mana is available.
      hud.globalAlpha = 0.9;
      hud.fillStyle = attack.color;
      hud.beginPath();
      hud.arc(cx, y + HOTBAR_SIZE / 2 + 4, 12, 0, Math.PI * 2);
      hud.fill();
      hud.globalAlpha = 1;
      hud.fillStyle = '#ffffff';
      hud.font = '900 14px system-ui, sans-serif';
      hud.textAlign = 'center';
      hud.fillText(ATTACK_GLYPHS[attack.kind] || '✦', cx, y + HOTBAR_SIZE / 2 + 9);
    } else if (item) {
      hud.fillStyle = rarity?.color || '#cbd5e1';
      hud.font = '900 24px system-ui, sans-serif';
      hud.textAlign = 'center';
      const glyph =
        item.lootType === 'tier-scroll'
          ? '▤'
          : item.lootType === 'weapon-upgrade-rune'
            ? '⬡'
            : item.lootType === 'deployable'
              ? '△'
              : item.lootType === 'rune-key'
                ? '⚿'
                : '✦';
      hud.fillText(glyph, cx, y + HOTBAR_SIZE / 2 + 10);
    } else if (isFly) {
      // Fly icon: a cyan double up-chevron (bright when flight is on).
      const cyp = y + HOTBAR_SIZE / 2 + 5;
      hud.globalAlpha = flying ? 1 : 0.8;
      hud.strokeStyle = '#7dd3fc';
      hud.lineWidth = 3;
      for (const dy of [0, 7]) {
        hud.beginPath();
        hud.moveTo(cx - 10, cyp + dy);
        hud.lineTo(cx, cyp - 8 + dy);
        hud.lineTo(cx + 10, cyp + dy);
        hud.stroke();
      }
      hud.globalAlpha = 1;
    }

    // Border (highlighted when selected/active) and hotkey number.
    const accent = isFly ? '#7dd3fc' : rarity?.color || null;
    hud.lineWidth = selected ? 2.5 : 1;
    hud.strokeStyle = selected ? accent || '#ffffff' : item || isFly ? '#3a3560' : '#262441';
    hud.strokeRect(x, y, HOTBAR_SIZE, HOTBAR_SIZE);
    hud.textAlign = 'left';
    hud.fillStyle = selected ? '#ffffff' : item || isFly ? '#cbd5e1' : '#4b5573';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.fillText(String(i + 1), x + 5, y + 15);
    if (item?.quantity > 1) {
      hud.textAlign = 'right';
      hud.fillText(String(item.quantity), x + HOTBAR_SIZE - 4, y + HOTBAR_SIZE - 5);
    }
  }

  // Label above the row: flight status while flying, else the equipped spell.
  hud.textAlign = 'center';
  hud.font = 'bold 13px system-ui, sans-serif';
  if (flying) {
    hud.fillStyle = '#7dd3fc';
    hud.fillText('✈ Flying — look up/down + W · 6 to land', centerX, y - 9, HOTBAR_W);
  } else {
    const selectedId = me.attackSlots?.[selectedAttackSlot];
    const selected = selectedId ? ATTACKS[selectedId] : null;
    if (selected) {
      const rarityId = attackRarityForWizard(me, selectedId);
      const rarity = LOOT_RARITIES[rarityId];
      const effective = effectiveAttackForWizard(me, selectedId);
      const ammo = selected.ammoType ? MANA_AMMUNITION[selected.ammoType] : null;
      const manaLabel = selected.consumable
        ? 'one use'
        : selected.manaPerSecond
          ? `${selected.manaPerSecond} ${ammo?.name || 'mana'}/s`
          : selected.manaPerProjectile
            ? `${selected.manaPerProjectile} ${ammo?.name || 'mana'}/shot`
            : `${effective.manaCost} ${ammo?.name || 'mana'}`;
      hud.fillStyle = rarity.color;
      hud.fillText(`${rarity.name} · ${selected.name} · ${manaLabel}`, centerX, y - 9, HOTBAR_W);
    } else {
      const selectedItem = me.inventorySlots?.[selectedAttackSlot];
      hud.fillStyle = selectedItem ? '#cbd5e1' : '#94a3b8';
      hud.fillText(
        selectedItem
          ? `${itemName(selectedItem, ATTACKS)} · G drop · H one · J stack`
          : 'Find an attack or item on the island',
        centerX,
        y - 9,
        HOTBAR_W,
      );
    }
  }

  if (me.itemUse) {
    const item = ATTACKS[me.itemUse.attackId];
    const progress = 1 - me.itemUse.remaining / Math.max(0.001, me.itemUse.total);
    const useX = x0 + HOTBAR_W - 190;
    const useY = y - 55;
    hud.fillStyle = 'rgba(5, 10, 30, 0.88)';
    hud.fillRect(useX - 8, useY - 17, 198, 25);
    hud.fillStyle = '#29344f';
    hud.fillRect(useX, useY, 182, 5);
    hud.fillStyle = item?.color || '#ffffff';
    hud.fillRect(useX, useY, 182 * progress, 5);
    hud.fillStyle = '#ffffff';
    hud.font = 'bold 10px system-ui, sans-serif';
    hud.textAlign = 'left';
    hud.fillText(
      `USING ${item?.name || 'ITEM'} · ${me.itemUse.remaining.toFixed(1)}s`,
      useX,
      useY - 5,
    );
  }
}

function drawCrosshair() {
  const x = HUD_W / 2; // the aim is always dead center
  const y = HUD_H / 2;
  hud.save();
  // Center crosshair = where you cast.
  hud.strokeStyle = diggingMode ? '#ff3038' : 'rgba(226,232,240,0.9)';
  hud.lineWidth = 2;
  hud.beginPath();
  hud.arc(x, y, 9, 0, Math.PI * 2);
  hud.moveTo(x - 15, y);
  hud.lineTo(x - 5, y);
  hud.moveTo(x + 5, y);
  hud.lineTo(x + 15, y);
  hud.moveTo(x, y - 15);
  hud.lineTo(x, y - 5);
  hud.moveTo(x, y + 5);
  hud.lineTo(x, y + 15);
  hud.stroke();
  hud.restore();
}

function drawDiggingMode() {
  if (!diggingMode) return;
  hud.save();
  const width = 380;
  const x = HUD_W / 2 - width / 2;
  const y = 24;
  hud.fillStyle = 'rgba(45, 25, 10, 0.9)';
  hud.fillRect(x, y, width, 65);
  hud.strokeStyle = '#fbbf24';
  hud.lineWidth = 2;
  hud.strokeRect(x, y, width, 65);
  hud.textAlign = 'center';
  hud.fillStyle = '#fde68a';
  hud.font = '900 17px system-ui, sans-serif';
  hud.fillText('⛏ DIGGING MODE', HUD_W / 2, y + 20);
  hud.fillStyle = '#fef3c7';
  hud.font = '11px system-ui, sans-serif';
  hud.fillText(
    held.has('run')
      ? `${activeDigHint()} · Click to fire laser · Right-click down · hold ${bindingLabel(keyBindings.drill)} to drill`
      : `${activeDigHint()} · Click to fire laser · Right-click down · ${bindingLabel(keyBindings.digSpell)} support`,
    HUD_W / 2,
    y + 39,
  );
  hud.fillText(
    `Wheel: short/wide ↔ long/thin · length ${digWheelLength} · width ${digWheelRadius * 2}`,
    HUD_W / 2,
    y + 56,
  );
  const drillPower = Math.min(1, (player().drillCharge || 0) / MAGICAL_DRILL.chargeSeconds);
  if (drillPower > 0 || player().drill) {
    hud.fillStyle = 'rgba(16, 25, 17, 0.82)';
    hud.fillRect(x, y + 69, width, 12);
    hud.fillStyle = player().drill ? '#86efac' : '#fbbf24';
    hud.fillRect(x + 2, y + 71, (width - 4) * (player().drill ? 1 : drillPower), 8);
  }
  hud.restore();
}

function drawPickupPrompt(me) {
  const pickup = nearestInteractableItem(state, me);
  if (!pickup) return;
  const distance = Math.hypot(me.x - pickup.x, me.y - pickup.y);
  if (distance > ATTACK_PICKUP_RADIUS + WIZARD.radius) return;
  const rarity = LOOT_RARITIES[pickup.rarity] || LOOT_RARITIES.common;
  const selected = me.inventorySlots?.[me.selectedInventorySlot];
  const full = me.inventorySlots?.every(Boolean);
  const name = itemName(pickup, ATTACKS);
  const betterRune =
    pickup.lootType === 'weapon-upgrade-rune' &&
    Object.keys(LOOT_RARITIES).indexOf(pickup.rarity) >
      Object.keys(LOOT_RARITIES).indexOf(me.baseWeaponRarity);
  const action = full
    ? `Hold ${bindingLabel(keyBindings.pickup)} to swap ${itemName(selected, ATTACKS)}`
    : `Tap ${bindingLabel(keyBindings.pickup)} to pick up`;
  const heading = `${rarity.name} ${name}${pickup.quantity > 1 ? ` ×${pickup.quantity}` : ''}`;
  const attack = ATTACKS[pickup.attackId];
  const compatible = !attack || attack.scope !== 'tier' || attack.weaponId === me.baseWeaponId;
  const detail =
    attack?.scope === 'tier'
      ? compatible
        ? 'Compatible'
        : `Requires ${BASE_WEAPONS[attack.weaponId]?.name}`
      : pickup.lootType === 'weapon-upgrade-rune'
        ? betterRune
          ? `Hold ${bindingLabel(keyBindings.pickup)} to upgrade ${BASE_WEAPONS[me.baseWeaponId]?.name} (${LOOT_RARITIES[me.baseWeaponRarity]?.name} → ${rarity.name})`
          : `Cannot upgrade ${LOOT_RARITIES[me.baseWeaponRarity]?.name} weapon · can carry or trade`
        : '';
  hud.save();
  hud.font = 'bold 14px system-ui, sans-serif';
  hud.textAlign = 'center';
  const width = Math.min(
    560,
    Math.max(
      hud.measureText(heading).width,
      hud.measureText(action).width,
      hud.measureText(detail).width,
    ) + 34,
  );
  const x = HUD_W / 2 - width / 2;
  const y = HUD_H - 158;
  hud.fillStyle = 'rgba(7, 10, 28, 0.86)';
  hud.fillRect(x, y, width, 62);
  hud.strokeStyle = rarity.color;
  hud.lineWidth = 2;
  hud.strokeRect(x, y, width, 62);
  hud.fillStyle = rarity.color;
  hud.fillText(heading, HUD_W / 2, y + 19);
  hud.fillStyle = '#f8fafc';
  hud.fillText(action, HUD_W / 2, y + 37);
  hud.fillStyle = compatible ? '#86efac' : '#f87171';
  hud.font = 'bold 11px system-ui, sans-serif';
  hud.fillText(detail, HUD_W / 2, y + 53);
  if (me.interactionGroundId === pickup.id && me.interactionHeldTime > 0) {
    hud.fillStyle = rarity.color;
    hud.fillRect(x, y + 59, width * Math.min(1, me.interactionHeldTime / 0.65), 3);
  }
  hud.restore();
}

function drawItemDebug(me) {
  if (!itemDebug) return;
  hud.save();
  hud.fillStyle = 'rgba(3,8,22,0.86)';
  hud.fillRect(16, 72, 370, 154);
  hud.fillStyle = '#e2e8f0';
  hud.font = '11px monospace';
  hud.textAlign = 'left';
  hud.fillText(`ITEM DEBUG · revision ${state.inventoryRevision}`, 26, 90);
  hud.fillText(`Pickup radius ${ATTACK_PICKUP_RADIUS + WIZARD.radius}`, 26, 106);
  hud.fillText(`Selected slot ${(me.selectedInventorySlot || 0) + 1}`, 26, 122);
  (me.inventorySlots || []).forEach((item, index) => {
    const label = item ? `${itemName(item, ATTACKS)} ×${item.quantity} (${item.rarity})` : 'empty';
    hud.fillText(`${index + 1}: ${label}`, 26, 138 + index * 14);
  });
  hud.fillText(
    `Mana: ${MANA_AMMUNITION_ORDER.map((id) => `${id}:${me.manaPouch?.[id] || 0}`).join(' ')}`,
    26,
    218,
  );
  const feet = renderer.wizardToScreen(me, 0);
  const radiusPoint = renderer.worldToScreen(
    me.x + ATTACK_PICKUP_RADIUS + WIZARD.radius,
    me.y,
    terrainHeight(me.x, me.y),
  );
  if (feet.visible && radiusPoint.visible) {
    hud.strokeStyle = '#67e8f9';
    hud.beginPath();
    hud.arc(feet.x, feet.y, Math.abs(radiusPoint.x - feet.x), 0, Math.PI * 2);
    hud.stroke();
  }
  for (const pickup of state.attackPickups || []) {
    if (pickup.collectedBy != null || Math.hypot(me.x - pickup.x, me.y - pickup.y) > 550) continue;
    const ground = renderer.worldToScreen(
      pickup.x,
      pickup.y,
      pickup.groundHeight ?? terrainHeight(pickup.x, pickup.y),
    );
    const floating = renderer.worldToScreen(
      pickup.x,
      pickup.y,
      (pickup.groundHeight ?? terrainHeight(pickup.x, pickup.y)) + 34,
    );
    if (!ground.visible) continue;
    hud.strokeStyle = '#facc15';
    hud.beginPath();
    hud.moveTo(floating.x, floating.y);
    hud.lineTo(ground.x, ground.y);
    hud.stroke();
    hud.fillStyle = LOOT_RARITIES[pickup.rarity]?.color || '#9ca3af';
    hud.fillText(
      `${pickup.id} ${itemName(pickup, ATTACKS)} ${pickup.rarity || 'common'} ${
        pickup.attackId &&
        ATTACKS[pickup.attackId]?.scope === 'tier' &&
        ATTACKS[pickup.attackId].weaponId !== me.baseWeaponId
          ? 'INCOMPATIBLE'
          : 'OK'
      }`,
      floating.x + 5,
      floating.y - 4,
    );
  }
  hud.restore();
}

function drawTerrainDebug(me) {
  if (!terrainDebug || !state?.terrain) return;
  const terrain = state.terrain;
  hud.save();
  hud.fillStyle = 'rgba(12, 22, 29, 0.78)';
  hud.fillRect(18, 248, 315, 110);
  hud.fillStyle = '#d1fae5';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.fillText(`TERRAIN DEBUG · edit ${terrain.revision}`, 26, 266);
  hud.font = '11px system-ui, sans-serif';
  hud.fillText(
    `Chunks ${terrain.modifiedChunks.size} · cells ${terrain.excavationCells.size}`,
    26,
    283,
  );
  hud.fillText(
    `Rooms ${terrain.regions.size} · remesh ${glCanvas.dataset.terrainRemeshMs || '0'} ms`,
    26,
    299,
  );
  const nearby = [...terrain.regions.values()].find((region) =>
    [...region.cellKeys].some((key) => {
      const cell = terrain.excavationCells.get(key);
      return Math.hypot(cell.x - me.x, cell.z - me.y) < 400;
    }),
  );
  if (nearby)
    hud.fillText(
      `Region ${nearby.id}: roof ${nearby.ceilingCells.length}, floor ${nearby.floorCells.length}, openings ${nearby.openings.length}`,
      26,
      315,
    );
  hud.fillText(
    `Support ${state.terrainSupport.nodes.size} · cave-ins ${state.terrainSupport.pendingCollapses.length} · fluid ${state.terrainFluids.filledCells.size}`,
    26,
    332,
  );
  hud.restore();
  for (const cell of terrain.excavationCells.values()) {
    if (Math.hypot(cell.x - me.x, cell.z - me.y) > 650) continue;
    const screen = renderer.worldToScreen(cell.x, cell.z, cell.y);
    if (!screen.visible) continue;
    hud.fillStyle = cell.openSky
      ? '#38bdf8'
      : cell.ceiling
        ? '#f97316'
        : cell.floor
          ? '#4ade80'
          : '#c4b5fd';
    hud.fillRect(screen.x - 2, screen.y - 2, 4, 4);
  }
}

function drawCeilingSafety(me) {
  const feet = me.drillFeetY ?? terrainHeight(me.x, me.y);
  const status = state.terrainSupport?.statusAt(me.x, me.y, feet + 90);
  if (!status || !status.roofArea) return;
  const colors = {
    green: '#4ade80',
    yellow: '#facc15',
    orange: '#fb923c',
    red: '#f87171',
    purple: '#c084fc',
  };
  const top = 76;
  const center = 150;
  hud.save();
  hud.textAlign = 'center';
  hud.font = 'bold 13px system-ui, sans-serif';
  hud.fillStyle = 'rgba(12, 22, 29, 0.72)';
  hud.fillRect(18, top, 264, 57);
  hud.fillStyle = colors[status.state] || colors.green;
  hud.fillText(`CEILING SAFETY · ${status.state.toUpperCase()}`, center, top + 17);
  hud.font = '11px system-ui, sans-serif';
  hud.fillText(`${status.anchored} natural · ${status.levitated} levitated`, center, top + 31);
  const node = [...state.terrainSupport.nodes.values()].find(
    (candidate) =>
      candidate.regionId === status.regionId && candidate.team === (me.teamId ?? me.id),
  );
  if (node) {
    hud.fillStyle = node.overload ? '#fb923c' : '#c4b5fd';
    hud.fillText(
      `Weave ${Math.ceil(node.networkHealth)}/${Math.ceil(node.networkMaxHealth)} · ${Math.ceil(node.mana)} mana${node.overload ? ' · OVERLOADED' : ''}`,
      center,
      top + 47,
    );
  }
  hud.restore();
}

function drawGroundHeat(me) {
  if ((state.terrainFluids?.heatAt(me.x, me.y) || 0) < 0.38) return;
  hud.save();
  hud.textAlign = 'center';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.fillStyle = '#fb923c';
  hud.fillText('The ground feels dangerously hot', HUD_W / 2, diggingMode ? 155 : 92);
  hud.restore();
}

function drawOpeningHud() {
  const opening = state.opening;
  const me = player();
  hud.save();
  hud.textAlign = 'center';
  hud.shadowColor = '#4c1d95';
  hud.shadowBlur = 18;

  if (opening.phase === 'countdown') {
    hud.fillStyle = '#f5f3ff';
    hud.font = '900 86px system-ui, sans-serif';
    hud.fillText(`${Math.max(1, Math.ceil(opening.timer))}`, HUD_W / 2, 150);
    hud.font = 'bold 24px system-ui, sans-serif';
    hud.fillText('PORTALS OPENING', HUD_W / 2, 194);
  } else if (opening.phase === 'choose') {
    const justOpened = opening.timer > OPENING.chooseTime - 1.2;
    hud.fillStyle = justOpened ? '#facc15' : '#f5f3ff';
    hud.font = `900 ${justOpened ? 46 : 31}px system-ui, sans-serif`;
    hud.fillText(justOpened ? 'PORTALS OPEN' : 'CHOOSE A PORTAL', HUD_W / 2, 72);
    hud.fillStyle = '#facc15';
    hud.font = '900 30px system-ui, sans-serif';
    hud.fillText(`${Math.ceil(opening.timer)}s`, HUD_W / 2, 110);

    let nearest = null;
    let nearestDistance = Infinity;
    for (const portal of opening.portals) {
      const distance = Math.hypot(me.x - portal.x, me.y - portal.y);
      if (distance < nearestDistance) {
        nearest = portal;
        nearestDistance = distance;
      }
    }
    if (nearest) {
      const destination = PORTAL_DESTINATIONS[nearest.destination];
      hud.fillStyle = destination.color;
      hud.font = 'bold 20px system-ui, sans-serif';
      hud.fillText(
        `${nearest.unstable ? '⚠ Unstable portal' : 'Nearest portal'}: ${destination.name}`,
        HUD_W / 2,
        HUD_H - 62,
      );
    }
    hud.fillStyle = '#e2e8f0';
    hud.font = '14px system-ui, sans-serif';
    hud.fillText('Run through an archway to choose your landing area', HUD_W / 2, HUD_H - 34);
  } else if (me.slowFalling) {
    hud.fillStyle = '#c4b5fd';
    hud.font = '900 34px system-ui, sans-serif';
    hud.fillText('SLOW-FALL SPELL', HUD_W / 2, 70);
    hud.fillStyle = '#f5f3ff';
    hud.font = 'bold 18px system-ui, sans-serif';
    hud.fillText(`Altitude: ${Math.ceil(me.openingH)} · WASD to steer`, HUD_W / 2, 103);
  }

  hud.restore();
}

function drawHud() {
  hud.clearRect(0, 0, HUD_W, HUD_H);
  if (inventoryOpen) {
    drawInventory();
    drawDamageVignette();
    return;
  }
  if (mapOpen) {
    drawFullMap();
    drawDamageVignette();
    return;
  }
  if (state.opening?.phase && state.opening.phase !== 'complete' && !player().openingLanded) {
    drawOpeningHud();
    drawDamageVignette();
    return;
  }
  drawEnemyHealthBars();
  const me = player();
  drawPlayerStaminaBar(me);

  // Alive count (top-left).
  const alive = state.wizards.filter((w) => w.alive).length;
  hud.fillStyle = '#e2e8f0';
  hud.font = 'bold 22px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText(`Alive: ${alive}`, 20, 34);
  const baseWeapon = BASE_WEAPONS[me.baseWeaponId];
  if (baseWeapon) {
    const weaponRarity = LOOT_RARITIES[me.baseWeaponRarity] || LOOT_RARITIES.common;
    hud.fillStyle = weaponRarity.color;
    hud.font = 'bold 13px system-ui, sans-serif';
    hud.fillText(`🔒 ${weaponRarity.name} ${baseWeapon.name}`, 20, 56);
  }

  // Storm status (top-right) — or a sandbox banner when testing with 0 bots.
  hud.textAlign = 'right';
  hud.font = 'bold 15px system-ui, sans-serif';
  if (state.sandbox) {
    hud.fillStyle = '#7dd3fc';
    hud.fillText('🧪 Sandbox — free roam', HUD_W - 20, 30);
  } else if (state.time < STORM.shrinkDelay) {
    hud.fillStyle = '#a3aed0';
    hud.fillText(`Storm closes in ${Math.ceil(STORM.shrinkDelay - state.time)}s`, HUD_W - 20, 30);
  } else {
    hud.fillStyle = '#f0abfc';
    hud.fillText('⚡ The storm is closing', HUD_W - 20, 30);
  }

  // Your health and shield (bottom-left corner). Stamina follows the wizard overhead.
  hud.textAlign = 'left';
  hud.font = 'bold 14px system-ui, sans-serif';
  hud.fillStyle = me.alive ? '#e2e8f0' : '#f87171';
  hud.fillText(me.alive ? 'You' : 'You (down)', 20, HUD_H - 62);

  drawBar(20, HUD_H - 55, 240, 14, Math.max(0, me.health) / WIZARD.maxHealth, '#4ade80');
  hud.fillStyle = '#06060f';
  hud.font = 'bold 11px system-ui, sans-serif';
  hud.fillText(`${Math.max(0, Math.ceil(me.health))}`, 26, HUD_H - 44);

  const shield = Math.max(0, Math.min(100, me.shield || 0));
  drawBar(20, HUD_H - 36, 240, 11, shield / 100, '#38bdf8');
  // Keep a blue outline visible at zero so the shield meter always has a
  // clear place beneath health, then fill it as protection is gained.
  hud.strokeStyle = '#7dd3fc';
  hud.lineWidth = 1;
  hud.strokeRect(20.5, HUD_H - 35.5, 239, 10);
  hud.fillStyle = shield > 20 ? '#082f49' : '#bae6fd';
  hud.font = 'bold 9px system-ui, sans-serif';
  hud.fillText(`${Math.ceil(shield)}`, 26, HUD_H - 27);
  drawHotbar(me);
  drawCeilingSafety(me);
  drawGroundHeat(me);
  drawMinimap();
  if (me.alive && !ended) drawCrosshair();
  if (me.alive && !ended) drawDiggingMode();
  if (me.alive && !ended) drawPickupPrompt(me);
  drawItemDebug(me);
  drawTerrainDebug(me);

  if (pickupNotice && pickupNoticeTimer > 0) {
    hud.save();
    hud.textAlign = 'center';
    hud.font = 'bold 17px system-ui, sans-serif';
    hud.fillStyle = pickupNotice.color || (pickupNotice.compatible ? '#86efac' : '#fbbf24');
    hud.shadowColor = pickupNotice.color || (pickupNotice.compatible ? '#166534' : '#92400e');
    hud.shadowBlur = 12;
    hud.fillText(pickupNotice.text, HUD_W / 2, 130);
    hud.restore();
  }

  // Controls hint (bottom-center).
  hud.textAlign = 'left';
  hud.font = '12px system-ui, sans-serif';
  hud.fillStyle = 'rgba(148,163,184,0.7)';
  hud.fillText(
    diggingMode
      ? `WASD move · ${activeDigHint()} · Click to fire laser · Right-click down · ${bindingLabel(keyBindings.drill)} drill · E inventory · M map`
      : locked
        ? `WASD move · Click cast · Right-click zoom · ${digControlHint()} · E inventory · M map`
        : `Click to look · WASD move · Right-click zoom · ${digControlHint()} · E inventory · M map`,
    20,
    HUD_H - 14,
    hotbarX() - 36,
  );

  drawDamageVignette();
  if (ended) drawEndScreen();
}

function drawDamageVignette() {
  if (damageFlash <= 0.001) return;
  const strength = Math.min(1, damageFlash);
  const edge = 135;
  const paintEdge = (gradient, x, y, w, h) => {
    hud.fillStyle = gradient;
    hud.fillRect(x, y, w, h);
  };
  hud.save();
  hud.globalCompositeOperation = 'source-over';

  const left = hud.createLinearGradient(0, 0, edge, 0);
  left.addColorStop(0, `rgba(185, 12, 22, ${0.78 * strength})`);
  left.addColorStop(1, 'rgba(185, 12, 22, 0)');
  paintEdge(left, 0, 0, edge, HUD_H);

  const right = hud.createLinearGradient(HUD_W, 0, HUD_W - edge, 0);
  right.addColorStop(0, `rgba(185, 12, 22, ${0.78 * strength})`);
  right.addColorStop(1, 'rgba(185, 12, 22, 0)');
  paintEdge(right, HUD_W - edge, 0, edge, HUD_H);

  const top = hud.createLinearGradient(0, 0, 0, edge);
  top.addColorStop(0, `rgba(220, 24, 32, ${0.68 * strength})`);
  top.addColorStop(1, 'rgba(220, 24, 32, 0)');
  paintEdge(top, 0, 0, HUD_W, edge);

  const bottom = hud.createLinearGradient(0, HUD_H, 0, HUD_H - edge);
  bottom.addColorStop(0, `rgba(155, 5, 16, ${0.72 * strength})`);
  bottom.addColorStop(1, 'rgba(155, 5, 16, 0)');
  paintEdge(bottom, 0, HUD_H - edge, HUD_W, edge);

  hud.restore();
}

function drawEndScreen() {
  const me = player();
  const won = state.playerWon && me.alive;
  hud.save();
  hud.fillStyle = 'rgba(6,6,15,0.8)';
  hud.fillRect(0, 0, HUD_W, HUD_H);
  hud.textAlign = 'center';
  const accent = won ? '#facc15' : '#f87171';
  hud.fillStyle = accent;
  hud.shadowColor = accent;
  hud.shadowBlur = 24;
  hud.font = 'bold 52px system-ui, sans-serif';
  hud.fillText(won ? 'VICTORY ROYALE!' : 'DEFEATED', HUD_W / 2, HUD_H / 2 - 20);
  hud.shadowBlur = 0;
  hud.fillStyle = '#e2e8f0';
  hud.font = '22px system-ui, sans-serif';
  const total = state.wizards.length;
  hud.fillText(
    won ? `Winner of ${total}` : `You placed #${me.placement} of ${total}`,
    HUD_W / 2,
    HUD_H / 2 + 22,
  );
  hud.fillStyle = '#a3aed0';
  hud.font = '16px system-ui, sans-serif';
  hud.fillText('Press R to play again · Esc for menu', HUD_W / 2, HUD_H / 2 + 58);
  hud.restore();
}

// ---- Loop ------------------------------------------------------------------

let pickupAudioContext = null;
let drillAudio = null;
function updateDrillAudio(wizard) {
  const active = !!wizard?.drill;
  const charging = !active && (wizard?.drillCharge || 0) > 0;
  if (!active && !charging) {
    if (drillAudio) {
      const { oscillator, gain, context } = drillAudio;
      gain.gain.setTargetAtTime(0, context.currentTime, 0.035);
      oscillator.stop(context.currentTime + 0.16);
      drillAudio = null;
    }
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    pickupAudioContext ||= new AudioContextClass();
    pickupAudioContext.resume();
    if (!drillAudio) {
      const oscillator = pickupAudioContext.createOscillator();
      const gain = pickupAudioContext.createGain();
      oscillator.type = 'sawtooth';
      gain.gain.value = 0;
      oscillator.connect(gain).connect(pickupAudioContext.destination);
      oscillator.start();
      drillAudio = { oscillator, gain, context: pickupAudioContext };
    }
    const amount = active ? 1 : Math.min(1, wizard.drillCharge / MAGICAL_DRILL.chargeSeconds);
    const volume = Number(readSetting('wandwars-effects-volume', '100')) / 100;
    drillAudio.oscillator.frequency.setTargetAtTime(
      76 + amount * 165,
      pickupAudioContext.currentTime,
      0.04,
    );
    drillAudio.gain.gain.setTargetAtTime(
      volume * (active ? 0.055 : 0.025),
      pickupAudioContext.currentTime,
      0.04,
    );
  } catch {
    // Audio is optional; no browser audio failure may stop a terrain edit.
  }
}
function playPickupSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    pickupAudioContext ||= new AudioContextClass();
    pickupAudioContext.resume();
    const now = pickupAudioContext.currentTime;
    const oscillator = pickupAudioContext.createOscillator();
    const gain = pickupAudioContext.createGain();
    const effectsVolume = Number(readSetting('wandwars-effects-volume', '100')) / 100;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(490, now);
    oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.13);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, effectsVolume * 0.1), now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain).connect(pickupAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.19);
  } catch {
    // Muted or suspended audio must never block a pickup.
  }
}

function playDigSound(blocked = false, magicalPunch = false) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    pickupAudioContext ||= new AudioContextClass();
    pickupAudioContext.resume();
    const now = pickupAudioContext.currentTime;
    const oscillator = pickupAudioContext.createOscillator();
    const gain = pickupAudioContext.createGain();
    const effectsVolume = Number(readSetting('wandwars-effects-volume', '100')) / 100;
    oscillator.type = blocked ? 'triangle' : magicalPunch ? 'sine' : 'sawtooth';
    oscillator.frequency.setValueAtTime(blocked ? 840 : magicalPunch ? 180 : 130, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      blocked ? 310 : magicalPunch ? 62 : 58,
      now + 0.13,
    );
    gain.gain.setValueAtTime(Math.max(0.0001, effectsVolume * (blocked ? 0.07 : 0.06)), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    oscillator.connect(gain).connect(pickupAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.16);
    if (magicalPunch && !blocked) {
      const shimmer = pickupAudioContext.createOscillator();
      const shimmerGain = pickupAudioContext.createGain();
      shimmer.type = 'triangle';
      shimmer.frequency.setValueAtTime(660, now);
      shimmer.frequency.exponentialRampToValueAtTime(330, now + 0.15);
      shimmerGain.gain.setValueAtTime(Math.max(0.0001, effectsVolume * 0.025), now);
      shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
      shimmer.connect(shimmerGain).connect(pickupAudioContext.destination);
      shimmer.start(now);
      shimmer.stop(now + 0.18);
    }
    if (!blocked) navigator.vibrate?.(18);
  } catch {
    // Optional feedback must never interrupt digging.
  }
}

function processMatchEvents() {
  for (const event of state.events || []) {
    if (event.type === 'terrain-collapse') {
      if (event.first && Math.hypot(player().x - event.x, player().y - event.y) < 1200) {
        playDigSound(false);
        navigator.vibrate?.(40);
      }
      continue;
    }
    if (event.wizardId !== player().id) continue;
    if (
      [
        'dig',
        'dig-blocked',
        'dig-spell',
        'dig-spell-blocked',
        'drill',
        'levitation-placed',
        'levitation-reinforced',
      ].includes(event.type)
    ) {
      const blocked = event.type.endsWith('blocked');
      if (event.type !== 'drill') playDigSound(blocked, event.type === 'dig');
      if (blocked) {
        if (event.type !== 'dig-blocked' || event.reason !== 'no-terrain') {
          pickupNotice = {
            color: '#cbd5e1',
            text: event.type === 'dig-blocked' ? 'That surface will not break' : 'Spell blocked',
          };
          pickupNoticeTimer = 0.7;
        }
      }
      continue;
    }
    if (
      ['attack-pickup', 'weapon-upgrade', 'inventory-pickup', 'inventory-swap'].includes(event.type)
    ) {
      // A buffered F press collects at most one object. Clear it immediately
      // after success so overlapping loot is never vacuumed up accidentally.
      pickupQueued = false;
      pickupQueuedUntil = 0;
    }
    if (
      ['inventory-pickup', 'inventory-swap', 'weapon-upgrade', 'mana-pickup'].includes(event.type)
    ) {
      playPickupSound();
    }
    if (event.type === 'inventory-pickup' || event.type === 'inventory-swap') {
      if (!player().inventorySlots[selectedAttackSlot]) {
        const firstOccupied = player().inventorySlots.findIndex(Boolean);
        if (firstOccupied >= 0) selectHotbarSlot(firstOccupied);
      }
      const rarity = LOOT_RARITIES[event.item.rarity] || LOOT_RARITIES.common;
      pickupNotice = {
        compatible: event.compatible !== false,
        color: event.compatible === false ? '#f87171' : rarity.color,
        text: `${event.type === 'inventory-swap' ? 'Swapped for' : 'Picked up'} ${rarity.name} ${itemName(event.item, ATTACKS)}${event.compatible === false ? ' · Cannot equip with this weapon' : ''}`,
      };
      pickupNoticeTimer = 3.2;
      continue;
    }
    if (event.type === 'inventory-drop') {
      if (!player().inventorySlots[selectedAttackSlot]) {
        const nextOccupied = player().inventorySlots.findIndex(Boolean);
        if (nextOccupied >= 0) selectHotbarSlot(nextOccupied);
        else {
          selectedAttackSlot = -1;
          gameScreen.dataset.hotbarSlot = 'none';
        }
      }
      pickupNotice = { color: '#cbd5e1', text: `Dropped ${itemName(event.item, ATTACKS)}` };
      pickupNoticeTimer = 2;
      continue;
    }
    if (event.type === 'weapon-upgrade') {
      const rarity = LOOT_RARITIES[event.rarity] || LOOT_RARITIES.common;
      pickupNotice = {
        compatible: true,
        color: rarity.color,
        text: event.upgraded
          ? `Base weapon upgraded to ${rarity.name}`
          : 'Base weapon is already Legendary',
      };
      pickupNoticeTimer = 3.2;
      continue;
    }
    if (event.type === 'mana-pickup') {
      const ammo = MANA_AMMUNITION[event.ammoType];
      pickupNotice = {
        compatible: true,
        color: ammo?.color,
        text: `+${Math.floor(event.amount)} ${ammo?.name || 'mana ammunition'}`,
      };
      pickupNoticeTimer = 3.2;
      continue;
    }
    if (event.type !== 'attack-pickup') continue;
    const attack = ATTACKS[event.attackId];
    if (!attack) continue;
    if (event.equipped) {
      const slot = player().attackSlots.indexOf(event.attackId);
      if (!player().attackSlots[selectedAttackSlot] && slot >= 0) selectHotbarSlot(slot);
    }
    pickupNotice = {
      compatible: true,
      color: event.rarity ? LOOT_RARITIES[event.rarity]?.color : null,
      text: event.convertedToMana
        ? `Tier scroll converted into +${event.manaEnergy} ${MANA_AMMUNITION[attack.ammoType]?.name || 'mana ammunition'}`
        : `${event.upgraded ? 'Upgraded' : 'Picked up'} ${event.rarity ? `${LOOT_RARITIES[event.rarity].name} ` : ''}${attack.name}${event.equipped ? ' — equipped' : ''}${event.tierClaimed ? ` · +${event.manaEnergy} ${MANA_AMMUNITION[attack.ammoType]?.name || 'mana ammunition'}` : ''}`,
    };
    pickupNoticeTimer = 3.2;
  }
}

function advanceSimulation(elapsed, openingCatchup = false) {
  const catchupLimit = openingCatchup ? MAX_OPENING_CATCHUP : MAX_SIMULATION_CATCHUP;
  simulationLag = Math.min(catchupLimit, simulationLag + elapsed);
  let input = readInput();
  let processedInput = false;
  while (simulationLag >= SIMULATION_STEP && !ended) {
    processedInput = true;
    const beforeJumpH = player().jumpH || 0;
    const beforeClimbState = player().climbState;
    update(state, [input], SIMULATION_STEP);
    const jumpAccepted =
      input.jump &&
      ((beforeJumpH <= 0 && (player().jumpH || 0) > 0) ||
        (beforeClimbState === 'wall' && player().climbState == null && (player().jumpV || 0) > 0));
    if (jumpAccepted) {
      jumpQueued = false;
      jumpQueuedUntil = 0;
    }
    processMatchEvents();
    simulationLag -= SIMULATION_STEP;
    if (!player().alive || state.over) ended = true;
    // Never turn opening catch-up into several seconds of unattended combat.
    // Once landing completes, normal capped timing resumes on the next frame.
    if (openingCatchup && state.opening?.phase === 'complete') {
      simulationLag = 0;
      break;
    }
    // A successful jump belongs to one simulation step. If the player pressed
    // Space just before landing, keep it through the short buffer until a step
    // can accept it. Pickup remains a single attempt per catch-up batch.
    if (
      jumpAccepted ||
      input.pickup ||
      input.dropOne ||
      input.dropStack ||
      input.dig ||
      input.digSpell ||
      input.inventorySelect != null
    ) {
      input = {
        ...input,
        jump: jumpAccepted ? false : input.jump,
        pickup: false,
        dropOne: false,
        dropStack: false,
        dig: false,
        digSpell: false,
        inventorySelect: null,
      };
    }
  }
  if (processedInput) {
    dropOneQueued = false;
    dropStackQueued = false;
    inventorySelectQueued = null;
    digShotQueued = false;
    digSpellQueued = false;
  }
  // Running out cancels the sprint toggle. The player keeps normal walking
  // speed and can press Shift again as soon as some stamina has regenerated.
  if (player().staminaExhausted) held.delete('run');
  const currentHealth = Math.max(0, player().health);
  if (currentHealth < lastPlayerHealth - 0.01) {
    const damage = lastPlayerHealth - currentHealth;
    damageFlash = Math.min(1, damageFlash + 0.34 + (damage / WIZARD.maxHealth) * 2.2);
  }
  lastPlayerHealth = currentHealth;
}

function frame(now) {
  if (!running) return;
  const elapsed = Math.max(0, (now - last) / 1000);
  const visualDt = Math.min(0.1, elapsed);
  updateDrillAudio(player());
  last = now;
  const adsProfile = adsProfileForWeapon(confirmedBaseWeapon);
  adsAmount = advanceAdsAmount(adsAmount, ads, visualDt, adsProfile.transitionSpeed);
  fov = adsProfile.hipFov + (adsProfile.adsFov - adsProfile.hipFov) * adsAmount;
  renderer.setFov(fov);
  renderer.setAdsAmount(adsAmount);
  // Position the camera first so the crosshair-target raycast (used by the sim
  // for aiming) reflects exactly where the player is looking this frame.
  renderer.setAim(yaw, pitch);
  // During the opening there is no combat raycast to preserve, so advance its
  // clock before the expensive 3D frame. If the previous frame was slow, the
  // very next picture already shows the correctly advanced portal phase.
  const openingPhaseAtFrameStart = state.opening?.phase;
  const openingBeforeRender =
    !ended && openingPhaseAtFrameStart && openingPhaseAtFrameStart !== 'complete';
  if (openingBeforeRender) {
    const openingElapsed =
      openingPhaseAtFrameStart === 'countdown' ? Math.min(elapsed, MAX_COUNTDOWN_STEP) : elapsed;
    advanceSimulation(openingElapsed, true);
  }
  // During 3-2-1, update only the live camera. This lets the player look around
  // without running the expensive full island/wizard synchronization each
  // frame. The chosen angle carries straight into the open-portal phase.
  const keepWarmedCountdownFrame =
    openingPhaseAtFrameStart === 'countdown' && state.opening?.phase === 'countdown';
  if (keepWarmedCountdownFrame) renderer.updateOpeningCamera(state, visualDt, 0);
  else renderer.update(state, visualDt, 0);
  if (!ended && !openingBeforeRender) advanceSimulation(elapsed);
  const staminaTarget = Math.max(0, Math.min(STAMINA.max, player().stamina));
  const staminaResponse = staminaTarget < displayedStamina ? 14 : 8;
  displayedStamina +=
    (staminaTarget - displayedStamina) * (1 - Math.exp(-staminaResponse * visualDt));
  if (Math.abs(staminaTarget - displayedStamina) < 0.01) displayedStamina = staminaTarget;
  gameScreen.dataset.openingPhase = state.opening?.phase || 'none';
  gameScreen.dataset.openingTimer = String(state.opening?.timer || 0);
  if (state.opening?.phase === 'countdown') {
    const digit = String(Math.max(1, Math.ceil(state.opening.timer)));
    const seen = gameScreen.dataset.countdownSeen?.split(',').filter(Boolean) || [];
    if (seen.at(-1) !== digit) gameScreen.dataset.countdownSeen = [...seen, digit].join(',');
  }
  gameScreen.dataset.playerLanded = String(!!player().openingLanded);
  gameScreen.dataset.playerAlive = String(!!player().alive);
  gameScreen.dataset.matchOver = String(!!state.over);
  gameScreen.dataset.playerX = String(player().x);
  gameScreen.dataset.playerY = String(player().y);
  gameScreen.dataset.cameraYaw = String(yaw);
  gameScreen.dataset.cameraPitch = String(pitch);
  gameScreen.dataset.adsHeld = String(ads);
  gameScreen.dataset.adsAmount = adsAmount.toFixed(4);
  gameScreen.dataset.fov = fov.toFixed(3);
  gameScreen.dataset.playerHeading = String(player().heading);
  gameScreen.dataset.displayedStamina = displayedStamina.toFixed(3);
  pickupNoticeTimer = Math.max(0, pickupNoticeTimer - visualDt);
  damageFlash = Math.max(0, damageFlash - visualDt * 1.35);
  try {
    renderer.render();
  } catch (error) {
    console.error('[graphics] frame render failed', error);
    showGraphicsRecovery();
    return;
  }
  drawHud();
  rafId = requestAnimationFrame(frame);
}

function syncSize() {
  const w = glCanvas.clientWidth || HUD_W;
  const h = glCanvas.clientHeight || HUD_H;
  renderer.resize(w, h);
}

function prewarmIslandRenderer() {
  if (renderer) return;
  try {
    renderer = createRenderer(glCanvas, { safeMode: forceSafeGraphics });
    renderer.resize(HUD_W, HUD_H);
    gameScreen.dataset.safeGraphics = String(forceSafeGraphics);
    gameScreen.dataset.graphicsContext = 'ok';
    console.info('[start-match] island renderer prewarmed during weapon selection');
  } catch (error) {
    // startMatch retains its normal safe retry if prewarming is unavailable.
    renderer = null;
    console.warn('[start-match] renderer prewarm deferred', error);
  }
}

// ---- Screen management -----------------------------------------------------

function startMatch(retryCount = 0) {
  if (!confirmedBaseWeapon || !BASE_WEAPONS[confirmedBaseWeapon]) return;
  const rendererWasReady = !!renderer;
  const generation = ++startGeneration;
  gameScreen.dataset.starting = 'true';
  gameScreen.dataset.openingPhase = 'preparing';
  gameScreen.dataset.openingTimer = '0';
  delete gameScreen.dataset.startError;
  graphicsRecoveryActive = false;
  window.clearTimeout(graphicsRecoveryTimer);
  gameScreen.dataset.graphicsContext = 'ok';
  startLoading.hidden = rendererWasReady;
  startLoading.querySelector('strong').textContent = 'Preparing the Island…';
  startLoading.querySelector('small').textContent =
    'Building the detailed world. The portals will open when it is ready.';
  console.info('[start-match] preparing detailed island', {
    bots: botCount,
    baseWeapon: confirmedBaseWeapon,
  });

  // Let the loading screen paint before Three.js builds and compiles the very
  // detailed island. The first render is intentionally warmed here while the
  // match clock is stopped, so the countdown always begins at a real 3.
  window.setTimeout(
    async () => {
      if (generation !== startGeneration || gameScreen.hidden) return;
      const startedAt = performance.now();
      try {
        state = createState({
          players: 1,
          bots: botCount,
          // Reliability first: enter the island as a live landed player. The
          // portal sequence was the source of repeated startup stalls in the
          // embedded browser and must never stand between Confirm and gameplay.
          opening: false,
          baseWeapon: confirmedBaseWeapon,
        });
        if (terrainDebug) {
          window.__terrainDebug = {
            snapshot: () => ({
              revision: state.terrain.revision,
              operations: state.terrain.operations.length,
              lastOperations: state.terrain.operations.slice(-5).map((operation) => ({
                shape: operation.shape,
                dirX: operation.dirX,
                dirY: operation.dirY,
                x: operation.x,
                z: operation.z,
                y: operation.y,
                radius: operation.radius,
                length: operation.length,
              })),
              chunks: state.terrain.modifiedChunks.size,
              cells: state.terrain.excavationCells.size,
              regions: [...state.terrain.regions.values()].map((region) => ({
                id: region.id,
                cells: region.cellKeys.size,
                ceilings: region.ceilingCells.length,
                floors: region.floorCells.length,
                openings: region.openings.length,
                safety: state.terrainSupport.statuses.get(region.id)?.state || null,
              })),
              levitationNodes: [...state.terrainSupport.nodes.values()].map((node) => ({
                id: node.id,
                team: node.team,
                regionId: node.regionId,
                health: node.health,
                networkHealth: node.networkHealth,
                networkMaxHealth: node.networkMaxHealth,
                load: node.load,
                overload: node.overload,
              })),
              pendingCollapses: state.terrainSupport.pendingCollapses.length,
              waterCells: [...state.terrainFluids.filledCells.values()].filter(
                (fluid) => fluid.kind === 'water',
              ).length,
              lavaCells: [...state.terrainFluids.filledCells.values()].filter(
                (fluid) => fluid.kind === 'lava',
              ).length,
              player: {
                x: player().x,
                y: player().y,
                feetY: player().drillFeetY ?? terrainHeight(player().x, player().y),
                surfaceY: terrainHeight(player().x, player().y),
                health: player().health,
                mana: { ...player().manaPouch },
                baseWeaponId: player().baseWeaponId,
                inventory: player().inventorySlots.map((item) => item?.itemId || null),
              },
              digging: {
                mode: player().digMode,
                charge: player().drillCharge,
                direction: player().drill?.direction || null,
                distance: player().drill?.distance || 0,
                feetY: player().drillFeetY,
                escape: player().drillEscapeReady,
                stamina: player().stamina,
                runOn: held.has('run'),
                rightHeld: drillHeld,
              },
            }),
            grantBurrowSpell: () => {
              const slot = Math.max(
                0,
                player().inventorySlots.findIndex((item) => !item),
              );
              player().inventorySlots[slot] = {
                lootType: 'digging-spell',
                itemId: 'burrow-spell',
                rarity: 'rare',
                quantity: 1,
              };
              player().selectedInventorySlot = slot;
              selectHotbarSlot(slot);
              player().manaPouch.elemental = Math.max(100, player().manaPouch.elemental);
              state.inventoryRevision++;
            },
            grantLevitationSpell: () => {
              const slot = Math.max(
                0,
                player().inventorySlots.findIndex((item) => !item),
              );
              player().inventorySlots[slot] = {
                lootType: 'digging-spell',
                itemId: 'levitation-spell',
                rarity: 'rare',
                quantity: 1,
              };
              player().selectedInventorySlot = slot;
              selectHotbarSlot(slot);
              state.inventoryRevision++;
            },
            grantElementalMana: (amount = 100) => {
              player().manaPouch.elemental += Math.max(0, amount);
              return player().manaPouch.elemental;
            },
            markVolume: (volume) => state.terrain.markVolume(volume),
            unmarkVolume: (id) => state.terrain.unmarkVolume(id),
            markLiquidSource: (source) => state.terrainFluids.markSource(source),
            forceCollapse: (regionId) => state.terrainSupport.forceCollapse(regionId),
            damageLevitation: (nodeId, damage) => state.terrainSupport.damageNode(nodeId, damage),
            placeLevitationAtPlayer: () =>
              state.terrainSupport.placeNode({
                x: player().x,
                z: player().y,
                team: player().teamId ?? player().id,
                ownerId: player().id,
              }),
            rebuildChunk: (cx, cz) => state.terrain.rebuildChunk(cx, cz),
            validateSeams: (cx, cz) => state.terrain.validateChunkSeams(cx, cz),
            exportTerrain: () => state.terrain.exportOperations(),
            resetTerrain: () => {
              state = createState({
                players: 1,
                bots: botCount,
                opening: false,
                baseWeapon: confirmedBaseWeapon,
              });
              return true;
            },
            setMaterial: (volume, materialId) =>
              state.terrain.markVolume({ ...volume, kind: 'diggable', materialId }),
            spawnTestRoom: (radius = 110, depth = 130) => {
              const me = player();
              const surface = state.terrain.baseHeight(me.x, me.y);
              return state.terrain.subtractSphere(me.x, me.y, surface - depth, radius);
            },
            teleportToRegion: (id) => {
              const region = state.terrain.regions.get(id);
              const cells = [...(region?.floorCells || [])]
                .map((key) => state.terrain.excavationCells.get(key))
                .filter(Boolean);
              const centerX = cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length;
              const centerZ = cells.reduce((sum, cell) => sum + cell.z, 0) / cells.length;
              const cell = cells
                .filter((candidate) =>
                  [30, 80, 130].every(
                    (height) =>
                      state.terrain.density(candidate.x, candidate.z, candidate.y + height) < 0,
                  ),
                )
                .sort(
                  (a, b) =>
                    Math.hypot(a.x - centerX, a.z - centerZ) -
                    Math.hypot(b.x - centerX, b.z - centerZ),
                )[0];
              if (!cell) return false;
              player().x = cell.x;
              player().y = cell.z;
              player().drillFeetY = state.terrain.supportHeight(cell.x, cell.z, cell.y + 8);
              player().lastTerrainFeetY = player().drillFeetY;
              return true;
            },
            revealEnemySupport: (enabled = true) => {
              state.terrainSupport.revealAll = !!enabled;
            },
            teleportClear: () => {
              for (let y = -4000; y <= 4000; y += 500) {
                for (let x = -4000; x <= 4000; x += 500) {
                  if (terrainMaterialAt(x, y) !== 'dirt' || terrainHeight(x, y) < 100) continue;
                  if (
                    state.obstacles.some(
                      (o) =>
                        Math.hypot(x - o.x, y - o.y) <
                        600 + (o.r || Math.max(o.hw || 0, o.hd || 0)),
                    )
                  )
                    continue;
                  player().x = x;
                  player().y = y;
                  player().drillFeetY = null;
                  player().lastTerrainFeetY = terrainHeight(x, y);
                  yaw = 0;
                  return { x, y };
                }
              }
              return null;
            },
          };
        }
        if (!renderer) {
          try {
            const safeMode = forceSafeGraphics || retryCount > 0;
            renderer = createRenderer(glCanvas, { safeMode });
            gameScreen.dataset.safeGraphics = String(safeMode);
          } catch (rendererError) {
            console.warn(
              '[start-match] normal renderer unavailable; using safe 3D graphics',
              rendererError,
            );
            renderer = createRenderer(glCanvas, { safeMode: true });
            gameScreen.dataset.safeGraphics = 'true';
          }
        }
        ended = false;
        lastPlayerHealth = WIZARD.maxHealth;
        displayedStamina = state.wizards[0].stamina;
        damageFlash = 0;
        held.clear();
        casting = false;
        jumpQueued = false;
        jumpQueuedUntil = 0;
        pickupQueued = false;
        pickupQueuedUntil = 0;
        pickupPressedAt = 0;
        dropOneQueued = false;
        dropStackQueued = false;
        inventorySelectQueued = null;
        diggingMode = false;
        diggingAction = false;
        primaryHeld = false;
        rightDigHeld = false;
        digShotQueued = false;
        clearTimeout(digActionTimer);
        ads = false;
        adsAmount = 0;
        fov = adsProfileForWeapon(confirmedBaseWeapon).hipFov;
        drillHeld = false;
        digSpellQueued = false;
        yaw = state.wizards[0].heading; // start facing the way we spawned
        pitch = -0.26; // reference-style downward view with the full wizard in frame
        selectedAttackSlot = -1;
        flying = false;
        mapOpen = false;
        inventoryOpen = false;
        gameScreen.dataset.hotbarSlot = 'none';
        gameScreen.dataset.mapOpen = 'false';
        gameScreen.dataset.inventoryOpen = 'false';
        gameScreen.dataset.diggingMode = 'false';
        gameScreen.dataset.diggingAction = 'false';
        renderer.setDiggingMode?.(false);
        renderer.setDiggingAction?.(false);
        pickupNotice = null;
        pickupNoticeTimer = 0;
        resetWheelGesture();
        simulationLag = 0;
        syncSize();

        // Finish decoding/attaching the detailed wizard before revealing a live
        // countdown. Late GLB attachment previously blocked the main thread just
        // after "3" appeared and looked like a cooldown/portal glitch.
        await renderer.prepareMatch(state, 0);
        if (generation !== startGeneration || gameScreen.hidden) return;

        // Compile the expensive first frame before starting simulation time.
        renderer.setAim(yaw, pitch);
        renderer.setFov(fov);
        renderer.setAdsAmount(0);
        renderer.update(state, 0, 0);
        try {
          renderer.render();
        } catch (error) {
          console.error('[graphics] first render failed', error);
          showGraphicsRecovery();
          return;
        }

        // One full warm render is enough: changing a portal's open uniform does
        // not compile a different shader. The old three-render sequence tripled
        // startup work and made a healthy game look as though it would not start.
        if (generation !== startGeneration || gameScreen.hidden) return;

        // Embedded previews can temporarily pause requestAnimationFrame while a
        // heavy WebGL canvas is being composited. Never let that leave the game
        // permanently stuck behind the loading cover: prefer two painted frames,
        // but use a short timer as a guaranteed fallback.
        running = true;
        let revealed = false;
        let revealFallback = 0;
        const revealMatch = (revealAt = performance.now()) => {
          if (revealed || generation !== startGeneration || gameScreen.hidden || !running) return;
          revealed = true;
          window.clearTimeout(revealFallback);
          gameScreen.dataset.countdownSeen = '';
          gameScreen.dataset.starting = 'false';
          gameScreen.dataset.openingPhase = state.opening.phase;
          gameScreen.dataset.openingTimer = String(state.opening.timer);
          gameScreen.dataset.playerLanded = String(!!player().openingLanded);
          gameScreen.dataset.playerAlive = String(!!player().alive);
          gameScreen.dataset.matchOver = String(!!state.over);
          gameScreen.dataset.playerX = String(player().x);
          gameScreen.dataset.playerY = String(player().y);
          gameScreen.dataset.cameraYaw = String(yaw);
          gameScreen.dataset.cameraPitch = String(pitch);
          gameScreen.dataset.playerHeading = String(player().heading);
          startLoading.hidden = true;
          last = revealAt;
          rafId = requestAnimationFrame(frame);
          console.info('[start-match] ready', {
            milliseconds: Math.round(performance.now() - startedAt),
          });
        };
        revealFallback = window.setTimeout(() => revealMatch(), 1200);
        rafId = requestAnimationFrame(() => {
          if (generation !== startGeneration || gameScreen.hidden || !running) return;
          rafId = requestAnimationFrame(revealMatch);
        });
      } catch (error) {
        console.error('[start-match] failed', error);
        if (retryCount < 1 && generation === startGeneration && !gameScreen.hidden) {
          if (renderer) {
            // A failed renderer must surrender its WebGL context before the safe
            // retry creates another one. Keeping it alive can exhaust the
            // browser's context limit and make the retry fail too.
            renderer.dispose(true);
            renderer = null;
          }
          startLoading.querySelector('strong').textContent = 'Restarting the Island…';
          startLoading.querySelector('small').textContent =
            'The 3D renderer was interrupted. Retrying automatically in safe graphics mode.';
          window.setTimeout(() => {
            if (generation !== startGeneration || gameScreen.hidden) return;
            gameScreen.dataset.safeGraphics = 'true';
            startMatch(retryCount + 1);
          }, 800);
          return;
        }
        gameScreen.dataset.starting = 'failed';
        gameScreen.dataset.startError = error instanceof Error ? error.message : String(error);
        startLoading.querySelector('strong').textContent = 'The Island Could Not Start';
        startLoading.querySelector('small').textContent =
          'Return to the menu and try again. The error has been recorded.';
      }
    },
    rendererWasReady ? 0 : 80,
  );
}

function showGame() {
  gameTabChannel?.postMessage({ type: 'match-started', tabId });
  menu.hidden = true;
  weaponSelect.hidden = true;
  gameScreen.hidden = false;
  gameScreen.dataset.baseWeapon = confirmedBaseWeapon;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', syncSize);
  glCanvas.addEventListener('mousemove', onMouseMove);
  glCanvas.addEventListener('mousedown', onMouseDown);
  glCanvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onWindowBlur);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  gameScreen.dataset.pointerLockRequested = 'false';
  // Safari can pause the Confirm event while it negotiates pointer lock and a
  // new WebGL canvas at the same time. Let the first click inside the live game
  // capture the mouse instead; onMouseDown already handles that path.
  if (!safariCompatibilityMode) requestLock();
  startMatch();
  glCanvas.focus();
}

function stopGame(releaseRenderer = false) {
  startGeneration++;
  running = false;
  updateDrillAudio(null);
  cancelAnimationFrame(rafId);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('resize', syncSize);
  glCanvas.removeEventListener('mousemove', onMouseMove);
  glCanvas.removeEventListener('mousedown', onMouseDown);
  glCanvas.removeEventListener('contextmenu', onContextMenu);
  window.removeEventListener('wheel', onWheel);
  window.removeEventListener('mouseup', onMouseUp);
  window.removeEventListener('blur', onWindowBlur);
  document.removeEventListener('pointerlockchange', onPointerLockChange);
  if (document.pointerLockElement) document.exitPointerLock();
  locked = false;
  held.clear();
  casting = false;
  primaryHeld = false;
  rightDigHeld = false;
  digShotQueued = false;
  clearTimeout(digActionTimer);
  ads = false;
  adsAmount = 0;
  fov = ADS_SETTINGS.hipFov;
  jumpQueued = false;
  jumpQueuedUntil = 0;
  pickupQueued = false;
  pickupQueuedUntil = 0;
  pickupPressedAt = 0;
  dropOneQueued = false;
  dropStackQueued = false;
  inventorySelectQueued = null;
  diggingMode = false;
  diggingAction = false;
  drillHeld = false;
  digSpellQueued = false;
  renderer?.setDiggingMode?.(false);
  renderer?.setDiggingAction?.(false);
  mapOpen = false;
  inventoryOpen = false;
  gameScreen.dataset.mapOpen = 'false';
  gameScreen.dataset.inventoryOpen = 'false';
  gameScreen.dataset.diggingMode = 'false';
  gameScreen.dataset.diggingAction = 'false';
  clearTimeout(wheelResetTimer);
  resetWheelGesture();
  startLoading.hidden = true;
  gameScreen.dataset.starting = 'false';
  gameScreen.dataset.pointerLockRequested = 'false';
  gameScreen.hidden = true;
  if (releaseRenderer && renderer) {
    renderer.dispose();
    renderer = null;
  }
}

function resetWeaponSelection() {
  selectedBaseWeapon = null;
  confirmedBaseWeapon = null;
  for (const card of weaponGrid.querySelectorAll('.weapon-card')) {
    card.setAttribute('aria-selected', 'false');
  }
  confirmWeaponButton.hidden = true;
  confirmWeaponButton.disabled = true;
  confirmWeaponButton.textContent = 'Confirm Weapon';
}

function returnInactiveTabToMenu() {
  stopGame(true);
  resetWeaponSelection();
  weaponSelect.hidden = true;
  menu.hidden = false;
  gameScreen.dataset.inactiveTab = 'true';
}

gameTabChannel?.addEventListener('message', (event) => {
  if (
    !['match-preparing', 'match-started'].includes(event.data?.type) ||
    event.data.tabId === tabId
  )
    return;
  returnInactiveTabToMenu();
});

function scheduleInactiveRelease() {
  window.clearTimeout(inactiveReleaseTimer);
  if (!document.hidden || !running) return;
  inactiveReleaseTimer = window.setTimeout(() => {
    if (document.hidden && running) returnInactiveTabToMenu();
  }, 15_000);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) scheduleInactiveRelease();
  else window.clearTimeout(inactiveReleaseTimer);
});

window.addEventListener('pagehide', () => {
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
});

function showWeaponSelection() {
  stopGame();
  settings.hidden = true;
  gameTabChannel?.postMessage({ type: 'match-preparing', tabId });
  menu.hidden = true;
  weaponSelect.hidden = false;
  resetWeaponSelection();
  // Let the cards paint first, then build the lightweight world behind them.
  // By the time the player chooses a weapon, Confirm can reveal a rendered
  // match directly with no "Preparing the Island" transition.
  if (!safariCompatibilityMode) window.setTimeout(prewarmIslandRenderer, 0);
}

function showMenu() {
  stopGame();
  weaponSelect.hidden = true;
  settings.hidden = true;
  menu.hidden = false;
}

function bindingLabel(code) {
  const labels = {
    Escape: 'Esc',
    Space: 'Space',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    Tab: 'Tab',
    Backspace: 'Backspace',
  };
  if (labels[code]) return labels[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code || 'Unassigned';
}

function digControlHint() {
  const key = bindingLabel(keyBindings.dig);
  return digControl === 'toggle' ? `Press ${key} for Dig mode` : `Hold ${key} for Dig mode`;
}

function activeDigHint() {
  const key = bindingLabel(keyBindings.dig);
  return digControl === 'toggle'
    ? `Press ${key} to exit Dig mode`
    : `Release ${key} to exit Dig mode`;
}

function saveKeyBindings() {
  writeSetting('wandwars-key-bindings', JSON.stringify(keyBindings));
}

function renderKeybinds() {
  keybinds.replaceChildren();
  for (const [action, label] of Object.entries(CONTROL_LABELS)) {
    const row = document.createElement('div');
    row.className = 'keybind-row';
    const name = document.createElement('span');
    name.textContent = label;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'keybind-button';
    button.textContent =
      bindingCapture?.action === action ? 'Press a key…' : bindingLabel(keyBindings[action]);
    button.addEventListener('click', () => {
      bindingCapture = { action };
      renderKeybinds();
    });
    row.append(name, button);
    keybinds.append(row);
  }
  for (const [action, label] of [['cast', 'Cast spell']]) {
    const row = document.createElement('div');
    row.className = 'keybind-row';
    const name = document.createElement('span');
    name.textContent = label;
    const select = document.createElement('select');
    select.className = 'keybind-select';
    for (const [value, optionLabel] of Object.entries(MOUSE_LABELS)) {
      if (value === '2') continue; // right-click is reserved for downward digging in Q mode
      const option = document.createElement('option');
      option.value = value;
      option.textContent = optionLabel;
      select.append(option);
    }
    select.value = String(mouseBindings[action]);
    select.addEventListener('change', () => {
      mouseBindings[action] = Number(select.value);
      writeSetting(`wandwars-mouse-${action}`, select.value);
    });
    row.append(name, select);
    keybinds.append(row);
  }
}

function captureKeyBinding(event) {
  if (!bindingCapture || settings.hidden) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.code === 'Escape') {
    bindingCapture = null;
    renderKeybinds();
    return true;
  }
  const { action } = bindingCapture;
  const previous = keyBindings[action];
  const otherAction = Object.entries(keyBindings).find(
    ([name, code]) => name !== action && code === event.code,
  )?.[0];
  keyBindings[action] = event.code;
  if (otherAction) keyBindings[otherAction] = previous;
  bindingCapture = null;
  saveKeyBindings();
  renderKeybinds();
  return true;
}

function applySettingsToUi() {
  const savedGraphics = readSetting(
    'wandwars-graphics',
    requestedGraphics === 'safe' ? 'safe' : 'detailed',
  );
  graphicsSetting.value =
    requestedGraphics === 'detailed' ? 'detailed' : savedGraphics === 'safe' ? 'safe' : 'detailed';
  forceSafeGraphics = graphicsSetting.value === 'safe';
  const sensitivity = Math.round(mouseSensitivity * 100);
  sensitivitySetting.value = String(Math.max(25, Math.min(200, sensitivity)));
  sensitivityOutput.value = `${sensitivitySetting.value}%`;
  invertYSetting.checked = invertY;
  digControlSetting.value = digControl;
  reducedMotionSetting.checked = readSetting('wandwars-reduced-motion', 'false') === 'true';
  document.documentElement.dataset.reducedMotion = String(reducedMotionSetting.checked);
  for (const { input, output, key } of volumeSettings) {
    const fallback = key.endsWith('master-volume')
      ? '80'
      : key.endsWith('music-volume')
        ? '70'
        : '85';
    input.value = readSetting(key, fallback);
    output.value = `${input.value}%`;
  }
  mouseBindings = {
    cast: Number(readSetting('wandwars-mouse-cast', '0')) === 1 ? 1 : 0,
  };
  renderKeybinds();
  fullscreenButton.textContent = document.fullscreenElement ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
}

function showSettings() {
  stopGame();
  menu.hidden = true;
  weaponSelect.hidden = true;
  settings.hidden = false;
  applySettingsToUi();
}

function closeSettings() {
  settings.hidden = true;
  menu.hidden = false;
}

// ---- Menu wiring -----------------------------------------------------------

for (const btn of botsPicker.querySelectorAll('button[data-bots]')) {
  btn.addEventListener('click', () => {
    botCount = Number(btn.dataset.bots);
    for (const sib of botsPicker.querySelectorAll('button[data-bots]')) {
      sib.setAttribute('aria-pressed', String(sib === btn));
    }
  });
}
for (const card of weaponGrid.querySelectorAll('.weapon-card[data-weapon]')) {
  card.addEventListener('click', () => {
    const weaponId = card.dataset.weapon;
    if (!BASE_WEAPONS[weaponId]) return;
    selectedBaseWeapon = weaponId;
    for (const sibling of weaponGrid.querySelectorAll('.weapon-card')) {
      sibling.setAttribute('aria-selected', String(sibling === card));
    }
    confirmWeaponButton.hidden = false;
    confirmWeaponButton.disabled = false;
    confirmWeaponButton.textContent = `Confirm ${BASE_WEAPONS[weaponId].name}`;
  });
}

confirmWeaponButton.addEventListener('click', () => {
  if (!selectedBaseWeapon || !BASE_WEAPONS[selectedBaseWeapon]) return;
  confirmedBaseWeapon = selectedBaseWeapon;
  showGame();
});

document.getElementById('play').addEventListener('click', showWeaponSelection);
document.getElementById('weapon-back').addEventListener('click', showMenu);
document.getElementById('back').addEventListener('click', showMenu);
settingsButton.addEventListener('click', showSettings);
settingsBackButton.addEventListener('click', closeSettings);
window.addEventListener('keydown', captureKeyBinding, true);
resetKeybindsButton.addEventListener('click', () => {
  keyBindings = { ...DEFAULT_KEY_BINDINGS };
  mouseBindings = { cast: 0 };
  bindingCapture = null;
  saveKeyBindings();
  writeSetting('wandwars-mouse-cast', '0');
  renderKeybinds();
});
sensitivitySetting.addEventListener('input', () => {
  mouseSensitivity = Number(sensitivitySetting.value) / 100;
  sensitivityOutput.value = `${sensitivitySetting.value}%`;
  writeSetting('wandwars-mouse-sensitivity', sensitivitySetting.value);
});
invertYSetting.addEventListener('change', () => {
  invertY = invertYSetting.checked;
  writeSetting('wandwars-invert-y', invertY);
});
reducedMotionSetting.addEventListener('change', () => {
  document.documentElement.dataset.reducedMotion = String(reducedMotionSetting.checked);
  writeSetting('wandwars-reduced-motion', reducedMotionSetting.checked);
});
digControlSetting.addEventListener('change', () => {
  digControl = digControlSetting.value === 'hold' ? 'hold' : 'toggle';
  writeSetting('wandwars-dig-control', digControl);
});
for (const { input, output, key } of volumeSettings) {
  input.addEventListener('input', () => {
    output.value = `${input.value}%`;
    writeSetting(key, input.value);
  });
}
graphicsSetting.addEventListener('change', () => {
  const value = graphicsSetting.value === 'safe' ? 'safe' : 'detailed';
  forceSafeGraphics = value === 'safe';
  writeSetting('wandwars-graphics', value);
});
fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    // Fullscreen can be unavailable in embedded previews; the rest of Settings remains usable.
  }
  applySettingsToUi();
});
document.addEventListener('fullscreenchange', applySettingsToUi);
applySettingsToUi();
