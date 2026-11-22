// 3D renderer for the magic battle royale, built on Three.js. It holds NO game
// rules — it just draws whatever `game.js` produces. The simulation is a flat
// (x, y) plane; here we map it into a 3D world (sim x -> world x, sim y -> world
// z, y is up) and follow the local player with an angled top-down camera.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  ARENA,
  WIZARD,
  WAND,
  BODY_HEIGHT,
  SPELLS,
  buildObstacles,
  boltHitsObstacle,
  REGIONS,
  biomeAt,
  terrainHeight,
  originalTerrainHeight,
  obstacleGroundHeight,
  RIVER_PATH,
  MAP_FEATURES,
  NATURAL_WATER,
  riverDistance,
  OPENING,
  PORTAL_DESTINATIONS,
  ATTACKS,
  LOOT_RARITIES,
  MANA_AMMUNITION,
  MAGICAL_DRILL,
  precisionDigPlan,
} from './game.js';

function wizardGround(wizard) {
  return wizard.drillFeetY ?? terrainHeight(wizard.x, wizard.y);
}
import { STYLE_SAMPLE, styleWeight, polishGround, buildRiversideDetails } from './fantasyStyle.js';
import { advanceSwimPose, swimStroke, usesTunnelCamera, waterVisualHeight } from './swimVisuals.js';
import { adsProfileForWeapon } from './ads.js';
import { terrainChunkAt, terrainChunkKey } from './terrain.js';
import { impactShakeStrength } from './impactFeedback.js';

export const HUD_W = 1024;
export const HUD_H = 576;

const safariCompatibilityAssets = /^((?!chrome|chromium|android).)*safari/i.test(
  globalThis.navigator?.userAgent || '',
);

function loadOptionalModel(url, warning, loadInSafari = false) {
  if (safariCompatibilityAssets && !loadInSafari) return Promise.resolve(null);
  return new Promise((resolve) => {
    new GLTFLoader().load(url, resolve, undefined, (error) => {
      console.warn(warning, error);
      resolve(null);
    });
  });
}

// Start downloading the advanced player while the menu is visible so pressing
// Play can use it immediately instead of briefly showing the fallback model.
const advancedWizardPromise = loadOptionalModel(
  '/models/wizard-mixamo-compatible.glb?v=20260919-soft-knees-v11',
  'Advanced wizard model could not load; using the built-in fallback.',
  true,
);

// The shovel is kept as a separate asset so it can be edited in Blender and
// replaced without touching the player model. The renderer also has a small
// procedural fallback below, so a slow asset load can never block a match.
const shovelModelPromise = loadOptionalModel(
  '/models/shovel.glb?v=20260907',
  'Shovel model could not load; using the built-in shovel.',
);

// Load each item once; pickup instances share immutable geometry and materials.
const itemModelNames = [
  'fairy_fizz',
  'golden_wizard_cake',
  'healing_leaves',
  'small_protection_potion',
  'great_protection_potion',
  'tier_i_attack_scroll',
  'tier_ii_attack_scroll',
  'common_rune',
  'rare_rune',
  'super_rare_rune',
  'epic_rune',
  'legendary_rune',
  'catalyst_shards',
  'elemental_essences',
  'burst_runes',
  'cosmic_orbs',
  'calamity_cores',
];
const itemModels = new Map();
const itemLoader = new GLTFLoader();
if (!safariCompatibilityAssets) {
  for (const name of itemModelNames) {
    itemLoader.load(
      `/models/items/${name}.glb`,
      ({ scene: model }) => {
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const normalized = new THREE.Group();
        model.position.sub(center);
        normalized.add(model);
        normalized.scale.setScalar(32 / Math.max(size.x, size.y, size.z, 0.001));
        itemModels.set(name, normalized);
      },
      undefined,
      (error) => {
        console.warn(`Item model ${name} could not load; using the pickup fallback.`, error);
      },
    );
  }
}

function pickupModelName(pickup) {
  if (pickup.lootType === 'mana-ammunition') {
    return {
      catalyst: 'catalyst_shards',
      elemental: 'elemental_essences',
      burst: 'burst_runes',
      cosmic: 'cosmic_orbs',
      calamity: 'calamity_cores',
    }[pickup.ammoType];
  }
  if (pickup.lootType === 'tier-scroll') {
    return (pickup.tier ?? ATTACKS[pickup.attackId]?.tier) === 1
      ? 'tier_i_attack_scroll'
      : 'tier_ii_attack_scroll';
  }
  if (pickup.lootType === 'rune-key') return 'rare_rune';
  if (pickup.lootType === 'deployable') return 'epic_rune';
  if (pickup.lootType === 'digging-spell') return 'epic_rune';
  const consumable = {
    'fairy-fizz': 'fairy_fizz',
    'golden-wizard-cake': 'golden_wizard_cake',
    'healing-leaves': 'healing_leaves',
    'small-protection-potion': 'small_protection_potion',
    'greater-protection-potion': 'great_protection_potion',
  }[pickup.attackId];
  return consumable || `${(pickup.rarity || 'common').replaceAll('-', '_')}_rune`;
}

// ---- Terrain height field --------------------------------------------------
// Gameplay is a flat plane; this height function is purely visual. The ground,
// props, wizards and camera are all lifted by terrainHeight(x, z) so the world
// reads as plains in the middle, rolling hills, and an outer mountain range.
function tsmooth(v, a, b) {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
// Biome palette.
const C_SAND = new THREE.Color(0xc9ba91);
const C_DUNE = new THREE.Color(0xc8ad78);
const C_DIRT = new THREE.Color(0x927552);
const C_GRASS = new THREE.Color(0x68885b);
const C_GRASS2 = new THREE.Color(0x3f6744);
const C_ROCK = new THREE.Color(0x696861);
const C_SNOW = new THREE.Color(0xe3e7e6);
const _mix = (a, b, t, out) => out.copy(a).lerp(b, Math.max(0, Math.min(1, t)));
function finishTerrainColor(x, z, out) {
  // Fine mottling breaks up the huge single-colour biome patches. This is baked
  // into the terrain vertices, so it adds no extra draw calls at runtime.
  const broad = Math.sin(x * 0.0021 + 0.7) * Math.cos(z * 0.0025 - 1.2);
  const fine = Math.sin(x * 0.0093 - 2.4) * Math.cos(z * 0.0107 + 0.3);
  out.offsetHSL(0, 0, broad * 0.025 + fine * 0.014);
  return polishGround(
    out,
    x,
    z,
    terrainHeight(x, z),
    originalTerrainHeight(x, z),
    1,
    riverDistance(x, z).distance,
  );
}
function terrainColorAt(x, z, h, out) {
  const riverD = riverDistance(x, z).distance;
  if (riverD < 310 && h > 4) {
    const bank = 1 - tsmooth(riverD, 95, 310);
    return finishTerrainColor(x, z, _mix(C_GRASS, C_DIRT, 0.45 + bank * 0.4, out));
  }
  if (h < 5) return finishTerrainColor(x, z, out.copy(C_SAND)); // beach at the waterline
  if (biomeAt(x, z) === 'desert') {
    if (h < 60) return finishTerrainColor(x, z, _mix(C_SAND, C_DUNE, (h - 5) / 55, out));
    if (h < 340) return finishTerrainColor(x, z, _mix(C_DUNE, C_DIRT, (h - 60) / 280, out));
    if (h < 640) return finishTerrainColor(x, z, _mix(C_DIRT, C_ROCK, (h - 340) / 300, out));
    return finishTerrainColor(x, z, _mix(C_ROCK, C_SNOW, (h - 640) / 300, out));
  }
  if (h < 45) return finishTerrainColor(x, z, _mix(C_SAND, C_GRASS, (h - 5) / 40, out));
  if (h < 380) return finishTerrainColor(x, z, _mix(C_GRASS, C_GRASS2, (h - 45) / 335, out)); // hills stay green
  if (h < 760) return finishTerrainColor(x, z, _mix(C_GRASS2, C_ROCK, (h - 380) / 380, out));
  return finishTerrainColor(x, z, _mix(C_ROCK, C_SNOW, (h - 760) / 300, out));
}

export function createRenderer(glCanvas, { safeMode = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    antialias: !safeMode && !safariCompatibilityAssets,
    powerPreference: safeMode ? 'low-power' : 'high-performance',
    // Safari can reject the combined depth/stencil backing buffer before the
    // first frame. The game needs depth testing, but never uses stencil.
    stencil: false,
    // The opening is rendered continuously, so retaining every previous frame
    // is unnecessary. Disabling it greatly reduces GPU memory and avoids the
    // GL readback stalls that could make WebGL context creation fail.
    preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = !safeMode;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9ac8df');
  // Keep the entire island crisp at long range. Distance fog made mountains,
  // buildings, trees, and distant players fade out while aiming or flying.
  scene.fog = null;

  const camera = new THREE.PerspectiveCamera(75, HUD_W / HUD_H, 1, 13000);
  camera.position.set(0, 560, 420);
  camera.lookAt(0, 0, 0);
  let requestedFov = 75;

  // Field of view is animated by the shared per-weapon ADS profile.
  function setFov(f) {
    requestedFov = f;
  }

  // ---- Lighting (bright midday) --------------------------------------------
  const ambient = new THREE.AmbientLight(0xd8e5eb, 0.5);
  scene.add(ambient);
  // Direction from the world toward the sun — drives BOTH the sunlight and the
  // visible sun disc, so the disc sits exactly where the light and shadows point.
  const SUN_OFFSET = new THREE.Vector3(700, 520, 470);
  const _sunNorm = SUN_OFFSET.clone().normalize();
  const SUN_DIST = 9000; // how far up the sky to park the visible disc
  // Physically-inspired atmospheric sky. It follows the camera each frame so
  // the horizon remains continuous across the one-square-mile island.
  const sky = new Sky();
  sky.scale.setScalar(10500);
  const skyU = sky.material.uniforms;
  skyU.turbidity.value = 4.8;
  skyU.rayleigh.value = 2.15;
  skyU.mieCoefficient.value = 0.0045;
  skyU.mieDirectionalG.value = 0.82;
  skyU.sunPosition.value.copy(_sunNorm);
  sky.material.depthWrite = false;
  scene.add(sky);
  // The sunlight. Its shadow camera only covers a patch, so on this huge map we
  // glide the whole rig along with the player each frame (see updateCamera).
  const key = new THREE.DirectionalLight(0xffefd3, 2.55);
  key.position.copy(SUN_OFFSET);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00008;
  key.shadow.normalBias = 0.6;
  key.shadow.radius = 2;
  const sc = key.shadow.camera;
  sc.left = -900;
  sc.right = 900;
  sc.top = 900;
  sc.bottom = -900;
  sc.near = 50;
  sc.far = 2600;
  const keyTarget = new THREE.Object3D();
  scene.add(keyTarget);
  key.target = keyTarget;
  scene.add(key);
  const hemisphere = new THREE.HemisphereLight(0xc9e7f5, 0x526142, 1.05);
  scene.add(hemisphere);

  // A visible sun: a bright disc with a soft glow, parked far away in the sun's
  // direction so it reads as a fixed point in the sky. It follows the player
  // (see updateCamera) to stay put.
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(560, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff3bf, fog: false }),
  );
  const sunGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1100, 24, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffe58f,
      transparent: true,
      opacity: 0.35,
      fog: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  scene.add(sunDisc);
  scene.add(sunGlow);

  // ---- Floating portal arena ---------------------------------------------
  const openingArena = new THREE.Group();
  openingArena.name = 'FloatingPortalArena';
  const stone = new THREE.MeshStandardMaterial({
    color: 0x777789,
    roughness: 0.82,
    metalness: 0.08,
  });
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x343544, roughness: 0.9 });
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(OPENING.platformRadius, OPENING.platformRadius * 0.9, 34, 96),
    stone,
  );
  platform.position.y = OPENING.platformHeight - 17;
  platform.castShadow = true;
  platform.receiveShadow = true;
  openingArena.add(platform);

  for (const radius of [145, 275, 390, 505]) {
    const runeRing = new THREE.Mesh(
      new THREE.TorusGeometry(radius, radius === 505 ? 7 : 3.5, 8, 128),
      new THREE.MeshBasicMaterial({
        color: radius === 505 ? 0x8b5cf6 : 0x5ee7ff,
        transparent: true,
        opacity: radius === 505 ? 0.85 : 0.52,
      }),
    );
    runeRing.rotation.x = Math.PI / 2;
    runeRing.position.y = OPENING.platformHeight + 2;
    openingArena.add(runeRing);
  }

  const portalVisuals = [];
  const portalHalfWidth = OPENING.portalOuterWidth / 2;
  const portalArchTube = 32;
  const portalArchRadius = portalHalfWidth - portalArchTube;
  for (let index = 0; index < OPENING.portalCount; index++) {
    const angle = (index / OPENING.portalCount) * Math.PI * 2;
    const portalGroup = new THREE.Group();
    portalGroup.position.set(
      Math.cos(angle) * OPENING.portalRing,
      OPENING.platformHeight,
      Math.sin(angle) * OPENING.portalRing,
    );
    portalGroup.rotation.y = -angle + Math.PI / 2;
    for (const side of [-1, 1]) {
      const column = new THREE.Mesh(new THREE.BoxGeometry(52, 300, 52), stoneDark);
      column.position.set(side * portalArchRadius, 150, 0);
      column.castShadow = true;
      portalGroup.add(column);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(72, 25, 66), stone);
      cap.position.set(side * portalArchRadius, 300, 0);
      portalGroup.add(cap);
    }
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(portalArchRadius, portalArchTube, 14, 52, Math.PI),
      stoneDark,
    );
    arch.position.y = 299;
    portalGroup.add(arch);
    const energyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x7c3aed) },
        uOpen: { value: 0.15 },
        uSeed: { value: index * 1.731 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpen;
        uniform float uSeed;
        uniform vec3 uColor;
        varying vec2 vUv;

        void main() {
          vec2 p = (vUv - 0.5) * vec2(2.0, 3.1);
          float radius = length(p);
          float angle = atan(p.y, p.x);
          float spiralA = sin(angle * 6.0 - radius * 13.0 + uTime * 3.6 + uSeed);
          float spiralB = sin(angle * -4.0 - radius * 18.0 - uTime * 2.7 - uSeed);
          float current = 0.5 + 0.28 * spiralA + 0.22 * spiralB;
          float lightning = pow(max(0.0, sin(angle * 11.0 + radius * 27.0 - uTime * 7.0)), 12.0);
          float center = 1.0 - smoothstep(0.0, 0.42, radius);
          vec3 cyan = vec3(0.25, 0.9, 1.0);
          vec3 color = mix(uColor * 0.55, cyan, center * 0.7 + lightning * 0.45);
          color *= 0.72 + current * 0.8 + lightning * 1.4;
          float alpha = uOpen * (0.46 + current * 0.38 + lightning * 0.45 + center * 0.32);
          gl_FragColor = vec4(color, clamp(alpha, 0.05, 0.94));
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    // Fill the complete archway—straight sides plus a rounded top—instead of
    // placing a flat circular disc between the pillars.
    const openingHalfWidth = portalArchRadius - portalArchTube - 6;
    const doorwayShape = new THREE.Shape();
    doorwayShape.moveTo(-openingHalfWidth, 3);
    doorwayShape.lineTo(-openingHalfWidth, 299);
    doorwayShape.absarc(0, 299, openingHalfWidth, Math.PI, 0, true);
    doorwayShape.lineTo(openingHalfWidth, 3);
    doorwayShape.closePath();
    const energy = new THREE.Mesh(new THREE.ShapeGeometry(doorwayShape, 32), energyMaterial);
    energy.position.z = 1;
    portalGroup.add(energy);

    const ribbonMaterial = new THREE.MeshBasicMaterial({
      color: 0x7c3aed,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const makeSpiral = (direction, phase) => {
      const points = [];
      for (let step = 0; step < 52; step++) {
        const t = step / 51;
        const turn = direction * (t * Math.PI * 4.2 + phase);
        const radius = 94 * (1 - t * 0.82);
        points.push(new THREE.Vector3(Math.cos(turn) * radius, Math.sin(turn) * radius, 4));
      }
      const spiral = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 80, 4.5, 7, false),
        ribbonMaterial.clone(),
      );
      spiral.position.y = 245;
      return spiral;
    };
    const swirl = makeSpiral(1, index * 0.7);
    const counterSwirl = makeSpiral(-1, index * 0.9 + 1.6);
    counterSwirl.scale.setScalar(0.72);
    portalGroup.add(swirl, counterSwirl);

    const sparkPositions = [];
    for (let spark = 0; spark < 30; spark++) {
      const sx = Math.sin((spark + 1) * 19.17 + index) * openingHalfWidth * 0.82;
      const sy = 18 + ((spark * 67 + index * 31) % 350);
      sparkPositions.push(sx, sy, 7);
    }
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sparkPositions, 3));
    const sparks = new THREE.Points(
      sparkGeometry,
      new THREE.PointsMaterial({
        color: 0x9beaff,
        size: 6,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    portalGroup.add(sparks);
    openingArena.add(portalGroup);
    portalVisuals.push({
      group: portalGroup,
      energy,
      swirl,
      counterSwirl,
      sparks,
      material: energyMaterial,
    });
  }

  // Floating rubble and four magical waterfalls sell the impossible altitude.
  for (let index = 0; index < 18; index++) {
    const angle = (index / 18) * Math.PI * 2 + (index % 2) * 0.13;
    const radius = 465 + (index % 4) * 32;
    const chunk = new THREE.Mesh(
      new THREE.DodecahedronGeometry(24 + (index % 3) * 9, 0),
      stoneDark,
    );
    chunk.position.set(
      Math.cos(angle) * radius,
      OPENING.platformHeight - 45 - (index % 5) * 28,
      Math.sin(angle) * radius,
    );
    chunk.rotation.set(index * 0.7, index * 0.43, index * 0.29);
    openingArena.add(chunk);
  }
  for (const angle of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const waterfall = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 5, 680, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x60d8ff,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    waterfall.position.set(
      Math.cos(angle) * 475,
      OPENING.platformHeight - 355,
      Math.sin(angle) * 475,
    );
    openingArena.add(waterfall);
  }
  scene.add(openingArena);

  // Seamless-enough procedural surface grain. Repeating neutral detail textures
  // preserve biome vertex colours while adding visible soil, cloth, wood, bark,
  // and water breakup without downloading external art assets.
  function makeNoiseTexture(size, seed, low = 185, high = 255) {
    const data = new Uint8Array(size * size * 4);
    let state = seed >>> 0;
    const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const broad =
          Math.sin((x / size) * Math.PI * 8 + Math.sin((y / size) * Math.PI * 4)) * 0.24 +
          Math.cos((y / size) * Math.PI * 10 - Math.sin((x / size) * Math.PI * 6)) * 0.2;
        const grain = (rnd() - 0.5) * 0.3;
        const t = THREE.MathUtils.clamp(0.56 + broad + grain, 0, 1);
        const value = Math.round(THREE.MathUtils.lerp(low, high, t));
        const i = (y * size + x) * 4;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    return tex;
  }

  // ---- Terrain (hills, plains, mountains) + ocean --------------------------
  // A displaced height-field island, vertex-coloured by elevation (sand -> grass
  // -> rock -> snow), ringed by ocean. The land dips below sea level past the
  // mountains, so the shoreline forms itself where the terrain crosses y=0.
  let ocean;
  let waterDetail;
  let waterMaterial;
  let riversideWaterDetail;
  let land;
  let originalLandIndices;
  let terrainRevision = -1;
  let terrainIdentity = null;
  let landHiddenChunkCount = 0;
  const terrainChunkMeshes = new Map();
  const levitationMeshes = new Map();
  const fluidMeshes = new Map();
  const fluidGeometry = new THREE.CircleGeometry(24, 16);
  const floodMaterials = {
    water: new THREE.MeshBasicMaterial({
      color: 0x4cafff,
      transparent: true,
      opacity: 0.54,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    lava: new THREE.MeshBasicMaterial({
      color: 0xff6b1b,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  };
  const levitationGeometry = new THREE.TorusGeometry(54, 2.5, 6, 32);
  const levitationOuterGeometry = new THREE.TorusGeometry(138, 1.4, 5, 48);
  const levitationSpokePositions = [];
  for (let index = 0; index < 8; index++) {
    const angle = (index / 8) * Math.PI * 2;
    levitationSpokePositions.push(48 * Math.cos(angle), 48 * Math.sin(angle), 0);
    levitationSpokePositions.push(136 * Math.cos(angle), 136 * Math.sin(angle), 0);
  }
  const levitationSpokeGeometry = new THREE.BufferGeometry();
  levitationSpokeGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(levitationSpokePositions, 3),
  );
  const levitationMaterial = new THREE.MeshBasicMaterial({
    color: 0xb88bff,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const weakenedLevitationColor = new THREE.Color(0xff5353);
  const levitationPreview = new THREE.Mesh(
    new THREE.TorusGeometry(66, 3, 6, 40),
    new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  levitationPreview.rotation.x = Math.PI / 2;
  levitationPreview.visible = false;
  scene.add(levitationPreview);

  function syncLevitation(state, player, dt) {
    const active = new Set();
    for (const node of state.terrainSupport?.nodes.values() || []) {
      if (node.team !== (player?.teamId ?? player?.id) && !state.terrainSupport?.revealAll)
        continue;
      active.add(node.id);
      let mesh = levitationMeshes.get(node.id);
      if (!mesh) {
        mesh = new THREE.Mesh(levitationGeometry, levitationMaterial.clone());
        mesh.add(new THREE.Mesh(levitationOuterGeometry, mesh.material));
        mesh.add(
          new THREE.LineSegments(
            levitationSpokeGeometry,
            new THREE.LineBasicMaterial({ color: 0xb88bff, transparent: true, opacity: 0.4 }),
          ),
        );
        mesh.rotation.x = Math.PI / 2;
        scene.add(mesh);
        levitationMeshes.set(node.id, mesh);
      }
      mesh.position.set(node.x, node.y + 23, node.z);
      mesh.material.color
        .set(0xb88bff)
        .lerp(weakenedLevitationColor, Math.max(0, 1 - node.health / 120));
      mesh.children[1].material.color.copy(mesh.material.color);
      mesh.rotation.z += dt * 0.7;
      mesh.scale.setScalar(1 + Math.min(0.2, (node.mana || 0) / 300));
    }
    for (const [id, mesh] of levitationMeshes) {
      if (active.has(id)) continue;
      scene.remove(mesh);
      mesh.children[1].material.dispose();
      mesh.material.dispose();
      levitationMeshes.delete(id);
    }
    const selected = player?.inventorySlots?.[player.selectedInventorySlot];
    const preview =
      player?.digMode && selected?.itemId === 'levitation-spell'
        ? state.terrainSupport?.previewNode(player.aimX, player.aimY)
        : null;
    levitationPreview.visible = !!preview;
    if (preview) {
      levitationPreview.material.color.set(preview.valid ? 0x4ade80 : 0xf87171);
      levitationPreview.position.set(
        preview.valid ? preview.x : player.aimX,
        preview.valid ? preview.y + 23 : terrainHeight(player.aimX, player.aimY) + 8,
        preview.valid ? preview.z : player.aimY,
      );
      levitationPreview.rotation.z += dt * 1.2;
    }
  }

  function syncUndergroundFluids(state, player) {
    const active = new Set();
    if (player) {
      let visible = 0;
      for (const [key, fluid] of state.terrainFluids?.filledCells || []) {
        if (fluid.amount < 0.05 || visible >= 96) continue;
        const cell = state.terrain.excavationCells.get(key);
        if (!cell || Math.hypot(cell.x - player.x, cell.z - player.y) > 700) continue;
        active.add(key);
        visible++;
        let mesh = fluidMeshes.get(key);
        if (!mesh) {
          mesh = new THREE.Mesh(fluidGeometry, floodMaterials[fluid.kind]);
          mesh.rotation.x = -Math.PI / 2;
          scene.add(mesh);
          fluidMeshes.set(key, mesh);
        }
        mesh.material = floodMaterials[fluid.kind];
        mesh.position.set(cell.x, cell.y - 16 + fluid.amount * 30, cell.z);
      }
    }
    for (const [key, mesh] of fluidMeshes) {
      if (active.has(key)) continue;
      scene.remove(mesh);
      fluidMeshes.delete(key);
    }
  }
  let diggingPreviewEnabled = false;
  const digPreviewGeometries = new Map();
  function digPreviewGeometry(radius, length) {
    const key = `${radius}:${length}`;
    if (!digPreviewGeometries.has(key))
      digPreviewGeometries.set(key, new THREE.CapsuleGeometry(radius, length, 6, 18));
    return digPreviewGeometries.get(key);
  }
  const digPreview = new THREE.Mesh(
    digPreviewGeometry(MAGICAL_DRILL.precisionRadius, MAGICAL_DRILL.precisionLength),
    new THREE.MeshBasicMaterial({
      color: 0xff3038,
      transparent: true,
      opacity: 0.1,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
  );
  digPreview.visible = false;
  digPreview.renderOrder = 4;
  scene.add(digPreview);
  const digTargetRing = new THREE.Mesh(
    new THREE.TorusGeometry(MAGICAL_DRILL.precisionRadius, 2.6, 7, 32),
    new THREE.MeshBasicMaterial({
      color: 0xff4949,
      transparent: true,
      opacity: 0.52,
      depthTest: false,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
  );
  digTargetRing.visible = false;
  digTargetRing.renderOrder = 5;
  scene.add(digTargetRing);
  const digBeam = new THREE.Mesh(
    // The preview widens from the wizard's hand to the full tunnel opening.
    new THREE.CylinderGeometry(1, 0.05, 1, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xf9202d,
      transparent: true,
      opacity: 0.07,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
  );
  const digBeamCore = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4, 1, 10),
    new THREE.MeshBasicMaterial({
      color: 0xff1724,
      transparent: true,
      opacity: 0.65,
      depthTest: true,
      depthWrite: false,
    }),
  );
  digBeam.renderOrder = 4;
  digBeamCore.renderOrder = 6;
  const digHandGlow = new THREE.Mesh(
    new THREE.SphereGeometry(6, 12, 8),
    new THREE.MeshBasicMaterial({
      color: 0xff4b40,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  for (const part of [digBeam, digBeamCore, digHandGlow]) {
    part.visible = false;
    scene.add(part);
  }
  const digFlowCount = 16;
  const digFlowPositions = new Float32Array(digFlowCount * 6);
  const digFlowGeometry = new THREE.BufferGeometry();
  digFlowGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(digFlowPositions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  const digFlow = new THREE.LineSegments(
    digFlowGeometry,
    new THREE.LineBasicMaterial({
      color: 0xff2130,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    }),
  );
  digFlow.visible = false;
  digFlow.frustumCulled = false;
  digFlow.renderOrder = 7;
  scene.add(digFlow);
  const digHandWorld = new THREE.Vector3();
  const digBeamEnd = new THREE.Vector3();
  const digBeamDirection = new THREE.Vector3();
  const digFlowSide = new THREE.Vector3();
  const digFlowUp = new THREE.Vector3();
  const digAxis = new THREE.Vector3(0, 1, 0);
  const digRingNormal = new THREE.Vector3(0, 0, 1);
  let digBeamFlash = 0;
  let latestDigAim = null;
  buildTerrain();
  buildWaterways();

  function buildTerrain() {
    const span = (ARENA.radius + 4000) * 2;
    const seg = 260;
    const geo = new THREE.PlaneGeometry(span, span, seg, seg);
    geo.rotateX(-Math.PI / 2); // lay it flat: shape spans X/Z, Y is up
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const pz = pos.getZ(i);
      const h = terrainHeight(px, pz);
      pos.setY(i, h);
      terrainColorAt(px, pz, h, c);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // Expose rock on steep slopes. Height-only colouring made cliffs look like
    // smooth green ramps; normal-based colouring gives hills readable faces and
    // keeps snow mainly on gentler shelves and summits.
    const normals = geo.attributes.normal;
    const colorAttr = geo.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const steepness = 1 - tsmooth(normals.getY(i), 0.56, 0.93);
      if (steepness <= 0.02) continue;
      c.fromBufferAttribute(colorAttr, i);
      const rockColor = biomeAt(pos.getX(i), pos.getZ(i)) === 'desert' ? C_DIRT : C_ROCK;
      c.lerp(rockColor, steepness * 0.58);
      polishGround(
        c,
        pos.getX(i),
        pos.getZ(i),
        pos.getY(i),
        originalTerrainHeight(pos.getX(i), pos.getZ(i)),
        normals.getY(i),
        riverDistance(pos.getX(i), pos.getZ(i)).distance,
      );
      colorAttr.setXYZ(i, c.r, c.g, c.b);
    }
    colorAttr.needsUpdate = true;
    const groundDetail = makeNoiseTexture(256, 0x71a93d2f, 230, 255);
    groundDetail.repeat.set(175, 175);
    groundDetail.colorSpace = THREE.SRGBColorSpace;
    const groundBump = groundDetail.clone();
    groundBump.colorSpace = THREE.NoColorSpace;
    groundBump.needsUpdate = true;
    originalLandIndices = Array.from(geo.index.array);
    land = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: groundDetail,
        bumpMap: groundBump,
        bumpScale: 3.6,
        roughness: 0.96,
        metalness: 0,
        envMapIntensity: 0.28,
      }),
    );
    land.receiveShadow = true;
    scene.add(land);
    // The sea is masked by the immutable natural coastline. A global sea
    // plane used to show through dry inland caves dug below y=0.
    waterDetail = makeNoiseTexture(192, 0x1144aa77, 95, 255);
    waterDetail.repeat.set(90, 90);
    waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x237b9f,
      roughness: 0.1,
      metalness: 0,
      clearcoat: 0.95,
      clearcoatRoughness: 0.1,
      ior: 1.333,
      reflectivity: 0.82,
      envMapIntensity: 1.45,
      bumpMap: waterDetail,
      bumpScale: 8,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const oceanRadius = ARENA.radius + 9000;
    const maskSize = 512;
    const maskPixels = new Uint8Array(maskSize * maskSize * 4);
    for (let iz = 0; iz < maskSize; iz++)
      for (let ix = 0; ix < maskSize; ix++) {
        const x = ((ix + 0.5) / maskSize) * oceanRadius * 2 - oceanRadius;
        const z = oceanRadius - ((iz + 0.5) / maskSize) * oceanRadius * 2;
        const water =
          NATURAL_WATER.surfaceAt(x, z)?.kind === 'ocean'
            ? THREE.MathUtils.smoothstep(-originalTerrainHeight(x, z), -8, 8)
            : 0;
        const offset = (iz * maskSize + ix) * 4;
        maskPixels[offset] = 255;
        maskPixels[offset + 1] = Math.round(water * 255);
        maskPixels[offset + 2] = 255;
        maskPixels[offset + 3] = 255;
      }
    const oceanMask = new THREE.DataTexture(maskPixels, maskSize, maskSize, THREE.RGBAFormat);
    oceanMask.magFilter = THREE.LinearFilter;
    oceanMask.minFilter = THREE.LinearFilter;
    oceanMask.needsUpdate = true;
    const oceanMaterial = waterMaterial.clone();
    oceanMaterial.alphaMap = oceanMask;
    ocean = new THREE.Mesh(new THREE.CircleGeometry(oceanRadius, 160), oceanMaterial);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = 0;
    scene.add(ocean);
  }

  function syncTerrain(terrain) {
    if (terrain !== terrainIdentity) {
      for (const mesh of terrainChunkMeshes.values()) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      terrainChunkMeshes.clear();
      land.geometry.setIndex(originalLandIndices);
      landHiddenChunkCount = 0;
      terrainIdentity = terrain;
      terrainRevision = -1;
    }
    if (!terrain || (terrain.revision === terrainRevision && !terrain.dirtyCount)) return;
    terrainRevision = terrain.revision;
    const dirty = terrain.takeDirtyChunks();
    if (!dirty.length) return;
    const start = performance.now();
    for (const key of dirty) {
      const old = terrainChunkMeshes.get(key);
      if (old) {
        scene.remove(old);
        old.geometry.dispose();
      }
      const [cx, cz] = key.split(',').map(Number);
      const data = terrain.meshChunk(cx, cz, safeMode ? 38 : 32);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      const colors = new Float32Array(data.positions.length);
      const uvs = new Float32Array((data.positions.length / 3) * 2);
      const color = new THREE.Color();
      for (let i = 0; i < data.positions.length; i += 3) {
        const x = data.positions[i];
        const y = data.positions[i + 1];
        const z = data.positions[i + 2];
        terrainColorAt(x, z, y, color);
        const steepness = 1 - tsmooth(data.normals[i + 1], 0.56, 0.93);
        if (steepness > 0.02)
          color.lerp(biomeAt(x, z) === 'desert' ? C_DIRT : C_ROCK, steepness * 0.58);
        polishGround(
          color,
          x,
          z,
          y,
          originalTerrainHeight(x, z),
          data.normals[i + 1],
          riverDistance(x, z).distance,
        );
        colors[i] = color.r;
        colors[i + 1] = color.g;
        colors[i + 2] = color.b;
        uvs[(i / 3) * 2] = (x + 13300) / 26600;
        uvs[(i / 3) * 2 + 1] = (13300 - z) / 26600;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      const mesh = new THREE.Mesh(geometry, land.material);
      mesh.receiveShadow = true;
      terrainChunkMeshes.set(key, mesh);
      scene.add(mesh);
    }
    // The untouched island remains one mesh. Remove only base-grid triangles
    // replaced by volumetric chunks; the base grid and chunks share borders.
    if (terrainChunkMeshes.size !== landHiddenChunkCount) {
      const position = land.geometry.attributes.position;
      const indices = [];
      for (let i = 0; i < originalLandIndices.length; i += 3) {
        const a = originalLandIndices[i];
        const b = originalLandIndices[i + 1];
        const c = originalLandIndices[i + 2];
        const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
        const z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
        const [cx, cz] = terrainChunkAt(x, z);
        if (terrainChunkMeshes.has(terrainChunkKey(cx, cz))) continue;
        indices.push(a, b, c);
      }
      land.geometry.setIndex(indices);
      landHiddenChunkCount = terrainChunkMeshes.size;
    }
    glCanvas.dataset.terrainChunks = String(terrainChunkMeshes.size);
    glCanvas.dataset.terrainRemeshMs = (performance.now() - start).toFixed(1);
  }

  function buildWaterways() {
    const segments = 150;
    const verts = [];
    const uvs = [];
    const indices = [];
    const leftBank = [];
    const rightBank = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const sample = NATURAL_WATER.riverSamples[i];
      const p = { x: sample.x, z: sample.z };
      const { nx, nz, width, level: waterY } = sample;
      for (const side of [-1, 1]) {
        verts.push(p.x + nx * width * side, waterY, p.z + nz * width * side);
        uvs.push(t * 18, side < 0 ? 0 : 1);
      }
      leftBank.push(new THREE.Vector3(p.x - nx * (width + 4), waterY + 2, p.z - nz * (width + 4)));
      rightBank.push(new THREE.Vector3(p.x + nx * (width + 4), waterY + 2, p.z + nz * (width + 4)));
      if (i < segments) {
        const n = i * 2;
        indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      }
    }
    const riverGeo = new THREE.BufferGeometry();
    riverGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    riverGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    riverGeo.setIndex(indices);
    riverGeo.computeVertexNormals();
    const riverColors = [];
    const riverColor = new THREE.Color();
    for (let i = 0; i <= segments; i++) {
      const p = NATURAL_WATER.riverSamples[i];
      riverColor
        .copy(waterMaterial.color)
        .lerp(new THREE.Color(0x32b9bd), styleWeight(p.x, p.z) * 0.8);
      for (let side = 0; side < 2; side++)
        riverColors.push(riverColor.r, riverColor.g, riverColor.b);
    }
    riverGeo.setAttribute('color', new THREE.Float32BufferAttribute(riverColors, 3));
    const riverMaterial = waterMaterial.clone();
    riverMaterial.color.set(0xffffff);
    riverMaterial.vertexColors = true;
    riverMaterial.roughness = 0.28;
    riverMaterial.bumpScale = 0.8;
    riverMaterial.bumpMap = waterDetail.clone();
    riverMaterial.bumpMap.repeat.set(1, 1);
    riverMaterial.bumpMap.needsUpdate = true;
    riversideWaterDetail = riverMaterial.bumpMap;
    let groupStart = 0,
      previousMaterial = -1;
    for (let i = 0; i < segments; i++) {
      const p = NATURAL_WATER.riverSamples[i];
      const material = styleWeight(p.x, p.z) > 0.001 ? 1 : 0;
      if (previousMaterial !== -1 && material !== previousMaterial) {
        riverGeo.addGroup(groupStart * 6, (i - groupStart) * 6, previousMaterial);
        groupStart = i;
      }
      previousMaterial = material;
    }
    riverGeo.addGroup(groupStart * 6, (segments - groupStart) * 6, previousMaterial);
    const river = new THREE.Mesh(riverGeo, [waterMaterial, riverMaterial]);
    river.receiveShadow = true;
    scene.add(river);

    const foamMat = new THREE.MeshBasicMaterial({
      color: 0xa9d9df,
      transparent: true,
      opacity: 0.42,
    });
    for (const bank of [leftBank, rightBank]) {
      const foam = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bank), 120, 3.2, 6, false),
        foamMat,
      );
      scene.add(foam);
    }

    const pondY = NATURAL_WATER.pondLevel;
    const pond = new THREE.Mesh(new THREE.CircleGeometry(MAP_FEATURES.pond.r, 64), waterMaterial);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(MAP_FEATURES.pond.x, pondY, MAP_FEATURES.pond.y);
    pond.receiveShadow = true;
    scene.add(pond);
    const pondEdge = new THREE.Mesh(
      new THREE.TorusGeometry(MAP_FEATURES.pond.r * 0.97, 9, 8, 96),
      new THREE.MeshStandardMaterial({ color: 0x70815a, roughness: 1 }),
    );
    pondEdge.rotation.x = -Math.PI / 2;
    pondEdge.position.copy(pond.position).add(new THREE.Vector3(0, 2, 0));
    scene.add(pondEdge);
  }

  // ---- World scenery: trees, houses, rocks, bushes -------------------------
  // Built from the SAME obstacle list game.js uses for collision, so what you
  // see is exactly what blocks you. Everything shares geometries/materials.
  if (safeMode) {
    buildSafeScenery();
  } else {
    buildScenery();
    buildLandmarks();
    buildDetails();
  }

  const riverside = buildRiversideDetails(
    scene,
    terrainHeight,
    NATURAL_WATER,
    buildObstacles(),
    safeMode,
  );
  glCanvas.dataset.styleSample = 'riverside';
  glCanvas.dataset.styleDetailInstances = String(
    riverside.grassMesh.count + riverside.flowers.count,
  );
  const sampleFog = new THREE.Fog(0xb6d8de, 5000, 12500);
  scene.fog = sampleFog;

  // Safe mode preserves the complete collision layout with very cheap shapes.
  // It is a real playable 3D fallback, not the full detailed renderer relabeled:
  // every blocking tree, rock, cactus and house still has visible geometry.
  function buildSafeScenery() {
    const obstacles = buildObstacles();
    const simple = obstacles.filter((obstacle) => !obstacle.soft && obstacle.kind !== 'house');
    const houses = obstacles.filter((obstacle) => obstacle.kind === 'house');
    const solidGeometry = new THREE.CylinderGeometry(1, 1, 1, 7);
    const houseGeometry = new THREE.BoxGeometry(1, 1, 1);
    const solidMaterial = new THREE.MeshLambertMaterial({ color: 0x506743 });
    const houseMaterial = new THREE.MeshLambertMaterial({ color: 0x9a7654 });
    const solidInstances = new THREE.InstancedMesh(solidGeometry, solidMaterial, simple.length);
    const houseInstances = new THREE.InstancedMesh(houseGeometry, houseMaterial, houses.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);

    simple.forEach((obstacle, index) => {
      const height = Math.max(24, obstacle.top || obstacle.s || obstacle.r * 2 || 50);
      const radius = Math.max(8, obstacle.r || obstacle.s || 16);
      position.set(obstacle.x, obstacleGroundHeight(obstacle) + height / 2, obstacle.y);
      rotation.setFromAxisAngle(yAxis, obstacle.rot || obstacle.ry || 0);
      scale.set(radius, height, radius);
      matrix.compose(position, rotation, scale);
      solidInstances.setMatrixAt(index, matrix);
    });
    houses.forEach((house, index) => {
      const height = Math.max(80, house.h || house.top * 0.65 || 180);
      position.set(house.x, obstacleGroundHeight(house) + height / 2, house.y);
      rotation.setFromAxisAngle(yAxis, -house.angle || 0);
      scale.set(house.w || house.hw * 2, height, house.d || house.hd * 2);
      matrix.compose(position, rotation, scale);
      houseInstances.setMatrixAt(index, matrix);
    });
    solidInstances.receiveShadow = false;
    houseInstances.receiveShadow = false;
    scene.add(solidInstances, houseInstances);
  }

  // Ground-level detail (no collision): instanced wildflowers, grass tufts and
  // pebbles carpeting the grasslands, clouds in the sky, and crop fields +
  // haystacks on the farm. InstancedMesh keeps thousands of these cheap.
  function buildDetails() {
    let seed = 0x9e3779b1;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const TAU = Math.PI * 2;
    const R = ARENA.radius - 120;
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _p = new THREE.Vector3();
    const _s = new THREE.Vector3();
    const YUP = new THREE.Vector3(0, 1, 0);
    const ZAXIS = new THREE.Vector3(0, 0, 1);

    const gather = (n, filter) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU;
        const rad = Math.sqrt(rnd()) * R;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        const h = terrainHeight(x, z);
        if (filter(x, z, h)) out.push([x, h, z, rnd(), rnd()]);
      }
      return out;
    };
    const onGreen = (x, z, h) => {
      if (h < 12 || h > 380) return false;
      if (riverDistance(x, z).distance < 280) return false;
      if (Math.hypot(x - MAP_FEATURES.pond.x, z - MAP_FEATURES.pond.y) < MAP_FEATURES.pond.r) {
        return false;
      }
      const b = biomeAt(x, z);
      return b === 'grass' || b === 'farm' || b === 'forest' || b === 'coast';
    };

    // Winding dirt trails connect the castle to every major region. They follow
    // the terrain vertex-by-vertex instead of hovering above hills.
    const trailDetail = makeNoiseTexture(128, 0x6319a55d, 170, 255);
    trailDetail.repeat.set(28, 3);
    trailDetail.colorSpace = THREE.SRGBColorSpace;
    const trailMat = new THREE.MeshStandardMaterial({
      color: 0x8d704b,
      map: trailDetail,
      bumpMap: trailDetail,
      bumpScale: 2.2,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const addTrail = (tx, tz, trailIndex) => {
      const len = Math.hypot(tx, tz) || 1;
      const nx = tx / len;
      const nz = tz / len;
      const px = -nz;
      const pz = nx;
      const segments = 86;
      const verts = [];
      const indices = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const edgeFade = Math.sin(t * Math.PI);
        const bend =
          edgeFade *
          (120 * Math.sin(t * Math.PI * (2.1 + trailIndex * 0.13) + trailIndex) +
            46 * Math.sin(t * Math.PI * 7.2 + trailIndex * 0.7));
        const start = 430;
        const distance = start + (len - start) * t;
        const cx = nx * distance + px * bend;
        const cz = nz * distance + pz * bend;
        const width = 42 + 18 * (0.5 + 0.5 * Math.sin(t * 18 + trailIndex));
        for (const side of [-1, 1]) {
          const x = cx + px * width * side;
          const z = cz + pz * width * side;
          verts.push(x, terrainHeight(x, z) + 4, z);
        }
        if (i < segments) {
          const n = i * 2;
          indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const trail = new THREE.Mesh(geo, trailMat);
      trail.receiveShadow = true;
      scene.add(trail);
    };
    REGIONS.forEach((region, i) => addTrail(region.x, region.y, i));

    // Secondary road network between settlements and landmarks. These thinner
    // winding routes reproduce the web of paths visible across the reference.
    const addRoadBetween = (ax, az, bx, bz, routeIndex) => {
      const vx = bx - ax;
      const vz = bz - az;
      const len = Math.hypot(vx, vz) || 1;
      const nx = vx / len;
      const nz = vz / len;
      const px = -nz;
      const pz = nx;
      const segments = Math.max(24, Math.ceil(len / 95));
      const verts = [];
      const indices = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const bend =
          Math.sin(t * Math.PI) *
          (75 * Math.sin(t * Math.PI * 3.2 + routeIndex * 1.7) +
            28 * Math.sin(t * Math.PI * 8.4 + routeIndex));
        const cx = ax + vx * t + px * bend;
        const cz = az + vz * t + pz * bend;
        const width = 24 + 7 * Math.sin(t * 14 + routeIndex);
        for (const side of [-1, 1]) {
          const x = cx + px * width * side;
          const z = cz + pz * width * side;
          verts.push(x, terrainHeight(x, z) + 4.5, z);
        }
        if (i < segments) {
          const n = i * 2;
          indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const route = new THREE.Mesh(geo, trailMat);
      route.receiveShadow = true;
      scene.add(route);
    };
    const forest = REGIONS.find((r) => r.biome === 'forest');
    const mountain = REGIONS.find((r) => r.biome === 'mountain');
    const farmRoad = REGIONS.find((r) => r.biome === 'farm');
    const desertRoad = REGIONS.find((r) => r.biome === 'desert');
    const coastRoad = REGIONS.find((r) => r.biome === 'coast');
    addRoadBetween(forest.x, forest.y, mountain.x - 500, mountain.y + 650, 10);
    addRoadBetween(mountain.x + 900, mountain.y + 900, -700, -1800, 11);
    addRoadBetween(farmRoad.x, farmRoad.y, MAP_FEATURES.pond.x, MAP_FEATURES.pond.y, 12);
    addRoadBetween(
      farmRoad.x + 500,
      farmRoad.y + 600,
      MAP_FEATURES.mine.x,
      MAP_FEATURES.mine.y,
      13,
    );
    addRoadBetween(MAP_FEATURES.mine.x, MAP_FEATURES.mine.y + 700, desertRoad.x, desertRoad.y, 14);
    addRoadBetween(desertRoad.x - 800, desertRoad.y - 400, -2100, 2700, 15);
    addRoadBetween(coastRoad.x + 500, coastRoad.y - 500, -850, 1150, 16);

    // Wildflowers (stems + colourful blooms, both instanced). There are enough
    // that a player always has several patches in view instead of one flower
    // every few hundred metres.
    const flowerCols = [0xffffff, 0xffe14d, 0xff6b6b, 0xb478ff, 0x6bb6ff, 0xff9f43].map(
      (c) => new THREE.Color(c),
    );
    const fPts = gather(6000, onGreen);
    const stems = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.8, 1.1, 12, 4),
      new THREE.MeshStandardMaterial({ color: 0x3f7c35, roughness: 1 }),
      fPts.length,
    );
    const flowers = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(2.2, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.7 }),
      fPts.length,
    );
    fPts.forEach((p, i) => {
      const size = 0.7 + p[3] * 1.1;
      _q.identity();
      _p.set(p[0], p[1] + 6 * size, p[2]);
      _s.set(size, size, size);
      _m.compose(_p, _q, _s);
      stems.setMatrixAt(i, _m);
      _p.y = p[1] + 14 * size;
      _m.compose(_p, _q, _s);
      flowers.setMatrixAt(i, _m);
      flowers.setColorAt(i, flowerCols[(p[4] * flowerCols.length) | 0]);
    });
    stems.instanceMatrix.needsUpdate = true;
    flowers.instanceMatrix.needsUpdate = true;
    flowers.instanceColor.needsUpdate = true;
    scene.add(stems);
    scene.add(flowers);

    // Dense grass tufts made from three crossed tapered blades. One InstancedMesh
    // keeps tens of thousands cheap without the old field of obvious cones.
    const grassVerts = [];
    const grassIndices = [];
    for (let blade = 0; blade < 3; blade++) {
      const a = (blade / 3) * Math.PI;
      const sx = Math.cos(a) * 3.2;
      const sz = Math.sin(a) * 3.2;
      const bx = -Math.sin(a) * 2;
      const bz = Math.cos(a) * 2;
      const n = grassVerts.length / 3;
      grassVerts.push(
        -sx,
        -11,
        -sz,
        sx,
        -11,
        sz,
        sx * 0.12 + bx,
        11,
        sz * 0.12 + bz,
        -sx * 0.12 + bx,
        11,
        -sz * 0.12 + bz,
      );
      grassIndices.push(n, n + 1, n + 2, n, n + 2, n + 3);
    }
    const grassGeo = new THREE.BufferGeometry();
    grassGeo.setAttribute('position', new THREE.Float32BufferAttribute(grassVerts, 3));
    grassGeo.setIndex(grassIndices);
    grassGeo.computeVertexNormals();
    const tPts = gather(14000, onGreen);
    const tufts = new THREE.InstancedMesh(
      grassGeo,
      new THREE.MeshStandardMaterial({
        color: 0x4f743d,
        roughness: 0.95,
        side: THREE.DoubleSide,
      }),
      tPts.length,
    );
    tPts.forEach((p, i) => {
      _p.set(p[0], p[1] + 11, p[2]);
      _s.set(0.7 + p[3] * 1.1, 0.65 + p[4] * 1.15, 0.7 + p[3] * 1.1);
      _q.setFromAxisAngle(YUP, p[4] * TAU);
      _m.compose(_p, _q, _s);
      tufts.setMatrixAt(i, _m);
    });
    tufts.instanceMatrix.needsUpdate = true;
    scene.add(tufts);

    // Pebbles (instanced) — scattered on any land.
    const pPts = gather(4000, (x, z, h) => h > 8 && h < 900);
    const pebbles = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x8a8477, roughness: 1 }),
      pPts.length,
    );
    pPts.forEach((p, i) => {
      const s = 3 + p[3] * 7;
      _p.set(p[0], p[1] + s * 0.4, p[2]);
      _s.set(s, s * 0.6, s);
      _q.setFromEuler(new THREE.Euler(p[3] * 3, p[4] * 3, p[3] * 2));
      _m.compose(_p, _q, _s);
      pebbles.setMatrixAt(i, _m);
    });
    pebbles.instanceMatrix.needsUpdate = true;
    scene.add(pebbles);

    // Forest floor: mushrooms and fallen mossy logs make the forest feel like a
    // place, not merely a patch with extra trees.
    const mushroomPts = gather(2400, (x, z, h) => biomeAt(x, z) === 'forest' && h > 15 && h < 520);
    const mushroomStems = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1.5, 2, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8dfc7, roughness: 1 }),
      mushroomPts.length,
    );
    const mushroomCaps = new THREE.InstancedMesh(
      new THREE.SphereGeometry(4.5, 8, 5, 0, TAU, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ roughness: 0.85 }),
      mushroomPts.length,
    );
    const capCols = [0xc94b40, 0xe09a3e, 0x8f65bd].map((c) => new THREE.Color(c));
    mushroomPts.forEach((p, i) => {
      const size = 0.7 + p[3] * 1.1;
      _q.setFromAxisAngle(YUP, p[4] * TAU);
      _s.setScalar(size);
      _p.set(p[0], p[1] + 4 * size, p[2]);
      _m.compose(_p, _q, _s);
      mushroomStems.setMatrixAt(i, _m);
      _p.y = p[1] + 8 * size;
      _m.compose(_p, _q, _s);
      mushroomCaps.setMatrixAt(i, _m);
      mushroomCaps.setColorAt(i, capCols[(p[4] * capCols.length) | 0]);
    });
    mushroomStems.instanceMatrix.needsUpdate = true;
    mushroomCaps.instanceMatrix.needsUpdate = true;
    mushroomCaps.instanceColor.needsUpdate = true;
    scene.add(mushroomStems);
    scene.add(mushroomCaps);

    const logPts = gather(650, (x, z, h) => biomeAt(x, z) === 'forest' && h > 15 && h < 520);
    const logs = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 8),
      new THREE.MeshStandardMaterial({ color: 0x604329, roughness: 1 }),
      logPts.length,
    );
    const layFlat = new THREE.Quaternion().setFromAxisAngle(ZAXIS, Math.PI / 2);
    logPts.forEach((p, i) => {
      const radius = 5 + p[3] * 7;
      const length = 45 + p[4] * 70;
      _p.set(p[0], p[1] + radius, p[2]);
      _s.set(radius, length, radius);
      _q.setFromAxisAngle(YUP, p[4] * TAU).multiply(layFlat);
      _m.compose(_p, _q, _s);
      logs.setMatrixAt(i, _m);
    });
    logs.instanceMatrix.needsUpdate = true;
    scene.add(logs);

    // Coastal reeds, desert brush and magical mountain crystals give each biome
    // its own close-up silhouette.
    const reedPts = gather(
      4500,
      (x, z, h) => h > 3 && h < 85 && Math.hypot(x, z) > ARENA.radius * 0.82,
    );
    const reeds = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.8, 34, 4),
      new THREE.MeshStandardMaterial({ color: 0xb5a65b, roughness: 1 }),
      reedPts.length,
    );
    reedPts.forEach((p, i) => {
      _p.set(p[0], p[1] + 17, p[2]);
      _s.set(0.7 + p[3], 0.65 + p[4] * 1.2, 0.7 + p[3]);
      _q.setFromAxisAngle(YUP, p[4] * TAU);
      _m.compose(_p, _q, _s);
      reeds.setMatrixAt(i, _m);
    });
    reeds.instanceMatrix.needsUpdate = true;
    scene.add(reeds);

    const scrubPts = gather(3000, (x, z, h) => biomeAt(x, z) === 'desert' && h > 5 && h < 500);
    const scrub = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x887044, roughness: 1 }),
      scrubPts.length,
    );
    scrubPts.forEach((p, i) => {
      const size = 5 + p[3] * 12;
      _p.set(p[0], p[1] + size * 0.45, p[2]);
      _s.set(size * 1.5, size * 0.55, size * 1.2);
      _q.setFromAxisAngle(YUP, p[4] * TAU);
      _m.compose(_p, _q, _s);
      scrub.setMatrixAt(i, _m);
    });
    scrub.instanceMatrix.needsUpdate = true;
    scene.add(scrub);

    const crystalPts = gather(
      1200,
      (x, z, h) => biomeAt(x, z) === 'mountain' && h > 360 && h < 1250,
    );
    const crystals = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 1, 5),
      new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x224466, roughness: 0.3 }),
      crystalPts.length,
    );
    crystalPts.forEach((p, i) => {
      const width = 4 + p[3] * 8;
      const height = 16 + p[4] * 28;
      _p.set(p[0], p[1] + height / 2, p[2]);
      _s.set(width, height, width);
      _q.setFromAxisAngle(YUP, p[3] * TAU);
      _m.compose(_p, _q, _s);
      crystals.setMatrixAt(i, _m);
    });
    crystals.instanceMatrix.needsUpdate = true;
    scene.add(crystals);

    // Clouds — soft white puffs high in the sky (fog off so they stay bright).
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      fog: false,
      transparent: true,
      opacity: 0.9,
    });
    for (let i = 0; i < 16; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + ((rnd() * 4) | 0);
      for (let j = 0; j < puffs; j++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(200 + rnd() * 320, 16, 10), cloudMat);
        puff.position.set((rnd() - 0.5) * 650, (rnd() - 0.5) * 110, (rnd() - 0.5) * 650);
        puff.scale.y = 0.55;
        cloud.add(puff);
      }
      const a = rnd() * TAU;
      const rad = 1200 + rnd() * ARENA.radius;
      cloud.position.set(Math.cos(a) * rad, 2300 + rnd() * 800, Math.sin(a) * rad);
      scene.add(cloud);
    }

    // Lantern posts and cloth banners ring the central castle, making the hub
    // feel occupied and giving its entrances a readable scale from the roads.
    const lampCount = 28;
    const lampPosts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(2.4, 3.2, 58, 6),
      new THREE.MeshStandardMaterial({ color: 0x403226, roughness: 0.9 }),
      lampCount,
    );
    const lampOrbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(6, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffd978,
        emissive: 0x8a4b12,
        emissiveIntensity: 1.4,
        roughness: 0.45,
      }),
      lampCount,
    );
    const banners = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2, 30, 14),
      new THREE.MeshStandardMaterial({ color: 0x7048b8, roughness: 0.8 }),
      lampCount,
    );
    for (let i = 0; i < lampCount; i++) {
      const a = (i / lampCount) * TAU;
      const rad = 438 + (i % 2) * 20;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      const h = terrainHeight(x, z);
      _q.setFromAxisAngle(YUP, -a);
      _s.setScalar(1);
      _p.set(x, h + 29, z);
      _m.compose(_p, _q, _s);
      lampPosts.setMatrixAt(i, _m);
      _p.y = h + 62;
      _m.compose(_p, _q, _s);
      lampOrbs.setMatrixAt(i, _m);
      _p.set(x + Math.cos(a) * 9, h + 43, z + Math.sin(a) * 9);
      _m.compose(_p, _q, _s);
      banners.setMatrixAt(i, _m);
    }
    lampPosts.instanceMatrix.needsUpdate = true;
    lampOrbs.instanceMatrix.needsUpdate = true;
    banners.instanceMatrix.needsUpdate = true;
    scene.add(lampPosts);
    scene.add(lampOrbs);
    scene.add(banners);

    // Farmland: tilled crop fields + haystacks around the farm region.
    const farm = REGIONS.find((r) => r.biome === 'farm');
    const soilMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1 });
    const cropMat = new THREE.MeshStandardMaterial({ color: 0x9bbf3a, roughness: 0.9 });
    const hayMat = new THREE.MeshStandardMaterial({ color: 0xd8c15a, roughness: 1 });
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 });
    for (let f = 0; f < 6; f++) {
      const a = rnd() * TAU;
      const rad = rnd() * 1500;
      const fx = farm.x + Math.cos(a) * rad;
      const fz = farm.y + Math.sin(a) * rad;
      const fh = terrainHeight(fx, fz);
      if (fh < 12) continue;
      if (
        Math.hypot(fx - MAP_FEATURES.pond.x, fz - MAP_FEATURES.pond.y) <
        MAP_FEATURES.pond.r + 320
      )
        continue;
      const field = new THREE.Group();
      const w = 220 + rnd() * 160;
      const d = 150 + rnd() * 140;
      const soil = new THREE.Mesh(new THREE.BoxGeometry(w, 6, d), soilMat);
      soil.position.y = 3;
      soil.receiveShadow = true;
      field.add(soil);
      const rows = Math.floor(w / 26);
      for (let r = 0; r < rows; r++) {
        const crop = new THREE.Mesh(new THREE.BoxGeometry(9, 14, d * 0.9), cropMat);
        crop.position.set(-w / 2 + 16 + r * 26, 12, 0);
        field.add(crop);
      }
      // Low split-rail fence around every field.
      for (const zSide of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w + 24, 7, 7), fenceMat);
        rail.position.set(0, 22, zSide * (d / 2 + 10));
        rail.castShadow = true;
        field.add(rail);
      }
      for (const xSide of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(7, 7, d + 24), fenceMat);
        rail.position.set(xSide * (w / 2 + 10), 22, 0);
        rail.castShadow = true;
        field.add(rail);
      }
      for (const xSide of [-1, 1]) {
        for (const zSide of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(9, 38, 9), fenceMat);
          post.position.set(xSide * (w / 2 + 10), 19, zSide * (d / 2 + 10));
          post.castShadow = true;
          field.add(post);
        }
      }
      field.position.set(fx, fh, fz);
      field.rotation.y = rnd() * TAU;
      scene.add(field);
    }
    for (let i = 0; i < 9; i++) {
      const a = rnd() * TAU;
      const rad = rnd() * 1600;
      const hx = farm.x + Math.cos(a) * rad;
      const hz = farm.y + Math.sin(a) * rad;
      const hh = terrainHeight(hx, hz);
      if (hh < 12) continue;
      const hay = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 32, 10), hayMat);
      hay.rotation.z = Math.PI / 2;
      hay.position.set(hx, hh + 22, hz);
      hay.castShadow = true;
      scene.add(hay);
    }
  }

  // Decorative landmarks (no collision): a central castle, a coastal lighthouse,
  // and a windmill on the farmland — the signature features of the map.
  function buildLandmarks() {
    const grp = new THREE.Group();
    const at = (rx, ry) => new THREE.Vector3(rx, terrainHeight(rx, ry), ry);
    const stone = new THREE.MeshStandardMaterial({ color: 0xcabfa6, roughness: 0.9 });
    const stoneDark = new THREE.MeshStandardMaterial({ color: 0x9a8f79, roughness: 0.9 });
    const roofBlue = new THREE.MeshStandardMaterial({ color: 0x3a4b8c, roughness: 0.7 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf0efe8, roughness: 0.8 });
    const red = new THREE.MeshStandardMaterial({ color: 0xb2452f, roughness: 0.8 });
    const mountainStone = new THREE.MeshStandardMaterial({ color: 0x5d6164, roughness: 0.96 });
    const snow = new THREE.MeshStandardMaterial({ color: 0xe4e6e2, roughness: 0.9 });
    const desertStone = new THREE.MeshStandardMaterial({ color: 0xa75d31, roughness: 1 });
    const desertLight = new THREE.MeshStandardMaterial({ color: 0xc47b43, roughness: 1 });
    const tunnelMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 1 });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x34383b,
      roughness: 0.55,
      metalness: 0.6,
    });

    const tower = (x, y, z, r, hgt, roof) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, hgt, 12), stone);
      t.position.set(x, y + hgt / 2, z);
      t.castShadow = true;
      grp.add(t);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 1.35, r * 2.4, 12), roof);
      cap.position.set(x, y + hgt + r * 1.2, z);
      cap.castShadow = true;
      grp.add(cap);
    };

    // Castle at the centre: a ring wall with corner towers and a tall keep.
    const c = at(0, 0);
    const wallR = 340;
    const ringWall = new THREE.Mesh(
      new THREE.CylinderGeometry(wallR, wallR, 90, 40, 1, true),
      stoneDark,
    );
    ringWall.material.side = THREE.DoubleSide;
    ringWall.position.set(c.x, c.y + 45, c.z);
    ringWall.castShadow = true;
    grp.add(ringWall);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      tower(c.x + Math.cos(a) * wallR, c.y, c.z + Math.sin(a) * wallR, 34, 120, roofBlue);
    }
    tower(c.x, c.y, c.z, 70, 240, roofBlue); // central keep
    tower(c.x + 110, c.y, c.z + 60, 46, 170, roofBlue);
    tower(c.x - 110, c.y, c.z - 60, 46, 170, roofBlue);

    // Jagged northwest mountain range with snowy summits, matching the dominant
    // ridge across the upper-left of the reference map.
    const mountain = REGIONS.find((r) => r.biome === 'mountain');
    const peakLayout = [
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
    ];
    for (let i = 0; i < peakLayout.length; i++) {
      const [ox, oz, radius, height] = peakLayout[i];
      const x = mountain.x + ox;
      const z = mountain.y + oz;
      const ground = terrainHeight(x, z);
      const peak = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 8, 5), mountainStone);
      peak.position.set(x, ground + height / 2 - 35, z);
      peak.rotation.y = i * 1.71;
      peak.scale.z = 0.72 + (i % 3) * 0.12;
      peak.castShadow = true;
      peak.receiveShadow = true;
      grp.add(peak);
      const capH = height * 0.3;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.34, capH, 8, 2), snow);
      cap.position.set(x, ground + height - capH * 0.42 - 35, z);
      cap.rotation.y = peak.rotation.y;
      cap.scale.z = peak.scale.z;
      cap.castShadow = true;
      grp.add(cap);
    }

    // Three crossings follow the supplied map: one by the castle and two farther
    // downstream toward the harbor and desert road.
    const riverCurve = new THREE.CatmullRomCurve3(
      RIVER_PATH.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      'centripetal',
      0.45,
    );
    const bridgeAt = (t, stoneBridge) => {
      const p = riverCurve.getPoint(t);
      const tangent = riverCurve.getTangent(t).normalize();
      const nx = -tangent.z;
      const nz = tangent.x;
      const angle = -Math.atan2(nz, nx);
      const y = terrainHeight(p.x, p.z) + 30;
      const material = stoneBridge ? stoneDark : wood;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(390, 18, 92), material);
      deck.position.set(p.x, y, p.z);
      deck.rotation.y = angle;
      deck.castShadow = true;
      deck.receiveShadow = true;
      grp.add(deck);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(390, 16, 10), material);
        rail.position.set(p.x + tangent.x * side * 45, y + 17, p.z + tangent.z * side * 45);
        rail.rotation.y = angle;
        rail.castShadow = true;
        grp.add(rail);
      }
    };
    bridgeAt(0.57, true);
    bridgeAt(0.74, true);
    bridgeAt(0.88, false);

    // Lighthouse on the coast (pushed out toward the shore).
    const coast = REGIONS.find((r) => r.biome === 'coast');
    const ld = Math.hypot(coast.x, coast.y) || 1;
    const lx = (coast.x / ld) * (ld + 1400);
    const ly = (coast.y / ld) * (ld + 1400);
    const lg = at(lx, ly);
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(16 - i * 2, 18 - i * 2, 44, 12),
        i % 2 ? red : white,
      );
      seg.position.set(lg.x, lg.y + 22 + i * 44, lg.z);
      seg.castShadow = true;
      grp.add(seg);
    }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 26, 12), stoneDark);
    lamp.position.set(lg.x, lg.y + 22 + 5 * 44 + 13, lg.z);
    grp.add(lamp);
    const beam = new THREE.Mesh(
      new THREE.SphereGeometry(9, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0 }),
    );
    beam.position.copy(lamp.position);
    grp.add(beam);

    // Windmill on the farmland.
    const farm = REGIONS.find((r) => r.biome === 'farm');
    const fg = at(farm.x, farm.y);
    const mill = new THREE.Mesh(new THREE.CylinderGeometry(34, 46, 150, 12), white);
    mill.position.set(fg.x, fg.y + 75, fg.z);
    mill.castShadow = true;
    grp.add(mill);
    const millRoof = new THREE.Mesh(new THREE.ConeGeometry(50, 50, 12), red);
    millRoof.position.set(fg.x, fg.y + 175, fg.z);
    grp.add(millRoof);
    const hub = new THREE.Group();
    hub.position.set(fg.x, fg.y + 150, fg.z + 48);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(14, 120, 4), wood);
      blade.position.y = 60;
      const arm = new THREE.Group();
      arm.rotation.z = (i / 4) * Math.PI * 2;
      arm.add(blade);
      hub.add(arm);
    }
    grp.add(hub);

    // Eastern twin mine hills: dark tunnel mouths, rails, ties, and ore carts.
    const mineFacing = new THREE.Vector2(-MAP_FEATURES.mine.x, -MAP_FEATURES.mine.y).normalize();
    const mineAngle = Math.atan2(mineFacing.x, mineFacing.y);
    for (const [ox, oz, sx, sy, sz] of [
      [-430, -280, 420, 360, 500],
      [520, 260, 360, 310, 430],
    ]) {
      const x = MAP_FEATURES.mine.x + ox;
      const z = MAP_FEATURES.mine.y + oz;
      const ground = terrainHeight(x, z);
      const mound = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), mountainStone);
      mound.position.set(x, ground + sy * 0.36, z);
      mound.scale.set(sx, sy, sz);
      mound.rotation.set(0.15, ox * 0.001, -0.08);
      mound.castShadow = true;
      mound.receiveShadow = true;
      grp.add(mound);

      const opening = new THREE.Mesh(new THREE.CircleGeometry(82, 28), tunnelMat);
      opening.position.set(x + mineFacing.x * sz * 0.78, ground + 78, z + mineFacing.y * sz * 0.78);
      opening.rotation.y = mineAngle;
      grp.add(opening);

      const railLength = 720;
      const midX = opening.position.x + mineFacing.x * railLength * 0.5;
      const midZ = opening.position.z + mineFacing.y * railLength * 0.5;
      const railHeading = -Math.atan2(mineFacing.y, mineFacing.x);
      const crossX = -mineFacing.y;
      const crossZ = mineFacing.x;
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(railLength, 5, 7), railMat);
        rail.position.set(midX + crossX * side * 25, ground + 10, midZ + crossZ * side * 25);
        rail.rotation.y = railHeading;
        rail.castShadow = true;
        grp.add(rail);
      }
      for (let tie = 0; tie < 14; tie++) {
        const d = (tie / 13) * railLength;
        const sleeper = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 78), wood);
        sleeper.position.set(
          opening.position.x + mineFacing.x * d,
          ground + 6,
          opening.position.z + mineFacing.y * d,
        );
        sleeper.rotation.y = railHeading;
        sleeper.castShadow = true;
        grp.add(sleeper);
      }
      const cart = new THREE.Mesh(new THREE.BoxGeometry(80, 48, 62), railMat);
      cart.position.set(midX, ground + 39, midZ);
      cart.rotation.y = railHeading;
      cart.castShadow = true;
      grp.add(cart);
    }

    // Layered red-rock mesas across the southeast desert.
    const desert = REGIONS.find((r) => r.biome === 'desert');
    for (const [ox, oz, radius, height] of [
      [-1700, 450, 340, 620],
      [-700, 1180, 280, 500],
      [450, 600, 390, 690],
      [1450, 1300, 260, 470],
      [1550, -200, 310, 560],
    ]) {
      const x = desert.x + ox;
      const z = desert.y + oz;
      const ground = terrainHeight(x, z);
      const lower = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.72, radius, height * 0.72, 9, 4),
        desertStone,
      );
      lower.position.set(x, ground + height * 0.36, z);
      lower.rotation.y = ox * 0.002;
      lower.castShadow = true;
      lower.receiveShadow = true;
      grp.add(lower);
      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.58, radius * 0.72, height * 0.28, 9, 2),
        desertLight,
      );
      crown.position.set(x, ground + height * 0.86, z);
      crown.rotation.y = lower.rotation.y;
      crown.castShadow = true;
      grp.add(crown);
    }

    // Harbor docks project into the southwest bay beside the lighthouse town.
    const harborX = coast.x - 120;
    const harborZ = coast.y + 920;
    for (const offset of [-260, 0, 260]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(150, 18, 620), wood);
      pier.position.set(harborX + offset, 20, harborZ + 260);
      pier.castShadow = true;
      pier.receiveShadow = true;
      grp.add(pier);
      for (const side of [-1, 1]) {
        for (const end of [-1, 0, 1]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 75, 10), wood);
          post.position.set(harborX + offset + side * 64, 4, harborZ + 260 + end * 260);
          post.castShadow = true;
          grp.add(post);
        }
      }
    }
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.ConeGeometry(72, 260, 4), wood);
    hull.rotation.z = Math.PI / 2;
    hull.rotation.y = Math.PI / 4;
    hull.scale.z = 0.52;
    boat.add(hull);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 190, 10), wood);
    mast.position.y = 85;
    boat.add(mast);
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 165, 0, 0, 35, 0, 0, 35, 105], 3),
    );
    sailGeo.setIndex([0, 1, 2]);
    sailGeo.computeVertexNormals();
    const sailMaterial = white.clone();
    sailMaterial.side = THREE.DoubleSide;
    const sail = new THREE.Mesh(sailGeo, sailMaterial);
    boat.add(sail);
    boat.position.set(harborX - 520, 35, harborZ + 520);
    boat.rotation.y = -0.6;
    grp.add(boat);

    const isletY = terrainHeight(MAP_FEATURES.islet.x, MAP_FEATURES.islet.y);
    const islandCabin = new THREE.Mesh(new THREE.BoxGeometry(250, 135, 190), wood);
    islandCabin.position.set(MAP_FEATURES.islet.x, isletY + 67, MAP_FEATURES.islet.y);
    islandCabin.castShadow = true;
    grp.add(islandCabin);
    const islandRoof = new THREE.Mesh(new THREE.ConeGeometry(180, 115, 4), roofBlue);
    islandRoof.position.set(MAP_FEATURES.islet.x, isletY + 190, MAP_FEATURES.islet.y);
    islandRoof.rotation.y = Math.PI / 4;
    islandRoof.scale.z = 0.78;
    islandRoof.castShadow = true;
    grp.add(islandRoof);
    const islandDock = new THREE.Mesh(new THREE.BoxGeometry(110, 16, 520), wood);
    islandDock.position.set(MAP_FEATURES.islet.x + 120, 18, MAP_FEATURES.islet.y - 390);
    islandDock.castShadow = true;
    grp.add(islandDock);

    // Water tower marks the southern desert settlement.
    const towerX = desert.x + 850;
    const towerZ = desert.y + 1750;
    const towerY = terrainHeight(towerX, towerZ);
    for (const side of [-1, 1]) {
      for (const sideZ of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 180, 8), railMat);
        leg.position.set(towerX + side * 42, towerY + 90, towerZ + sideZ * 42);
        leg.rotation.z = side * 0.05;
        grp.add(leg);
      }
    }
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(72, 72, 92, 16), railMat);
    tank.position.set(towerX, towerY + 210, towerZ);
    tank.castShadow = true;
    grp.add(tank);

    scene.add(grp);
  }

  function buildScenery() {
    const world = new THREE.Group();

    // Shared materials (reused across every instance to keep draw state cheap).
    const barkDetail = makeNoiseTexture(128, 0xb4a72d19, 145, 255);
    barkDetail.repeat.set(3, 10);
    barkDetail.colorSpace = THREE.SRGBColorSpace;
    const stoneDetail = makeNoiseTexture(128, 0x8891aa41, 170, 255);
    stoneDetail.repeat.set(7, 6);
    stoneDetail.colorSpace = THREE.SRGBColorSpace;
    const plasterDetail = makeNoiseTexture(128, 0x217fa318, 238, 255);
    plasterDetail.repeat.set(8, 5);
    plasterDetail.colorSpace = THREE.SRGBColorSpace;
    const roofDetail = makeNoiseTexture(128, 0x771f3c52, 216, 255);
    roofDetail.repeat.set(12, 8);
    roofDetail.colorSpace = THREE.SRGBColorSpace;
    const barkMat = new THREE.MeshStandardMaterial({
      color: 0x5a3924,
      map: barkDetail,
      bumpMap: barkDetail,
      bumpScale: 2.8,
      roughness: 1,
    });
    const leafMats = [0x365f35, 0x426d3c, 0x2f5a3d, 0x587344].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.88 }),
    );
    const rockMats = [0x74746e, 0x656963, 0x7b756a, 0x5f6668].map(
      (c) =>
        new THREE.MeshStandardMaterial({
          color: c,
          map: stoneDetail,
          bumpMap: stoneDetail,
          bumpScale: 3.2,
          roughness: 0.98,
        }),
    );
    const wallMats = [0xcdb894, 0xb8a06e, 0xd8c7a2, 0xa88f63].map(
      (c) =>
        new THREE.MeshStandardMaterial({
          color: c,
          map: plasterDetail,
          bumpMap: plasterDetail,
          bumpScale: 0.65,
          roughness: 0.92,
        }),
    );
    const roofMats = [0x7c3b2e, 0x8a4a2f, 0x5a3550, 0x334155].map(
      (c) =>
        new THREE.MeshStandardMaterial({
          color: c,
          map: roofDetail,
          bumpMap: roofDetail,
          bumpScale: 1.25,
          roughness: 0.9,
        }),
    );
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.9 });
    const foundationMat = new THREE.MeshStandardMaterial({
      color: 0x625e58,
      map: stoneDetail,
      bumpMap: stoneDetail,
      bumpScale: 3,
      roughness: 1,
    });
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x2a3a52,
      roughness: 0.35,
      metalness: 0.3,
      emissive: 0x101828,
    });
    const porchLampMat = new THREE.MeshStandardMaterial({
      color: 0xffd783,
      emissive: 0x6d370d,
      emissiveIntensity: 1.2,
      roughness: 0.5,
    });
    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4c7a3d, roughness: 0.85 });

    // Shared geometries.
    const cactusGeo = new THREE.CylinderGeometry(7, 9, 95, 14);
    const cactusArmGeo = new THREE.CylinderGeometry(4.5, 5, 34, 12);
    const trunkGeo = new THREE.CylinderGeometry(4.2, 8, 100, 12, 5);
    const branchGeo = new THREE.CylinderGeometry(2, 4, 42, 10);
    const coniferGeo = new THREE.ConeGeometry(40, 84, 14, 3);
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const bushGeo = new THREE.IcosahedronGeometry(1, 1);
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    const doorGeo = new THREE.BoxGeometry(1, 1, 1);
    const lampGeo = new THREE.SphereGeometry(7, 16, 12);

    const makeGableRoof = (w, d, h) => {
      const shape = new THREE.Shape();
      shape.moveTo(-d / 2, 0);
      shape.lineTo(d / 2, 0);
      shape.lineTo(0, h);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: w,
        steps: 1,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 7,
        bevelThickness: 5,
      });
      geo.translate(0, 0, -w / 2);
      geo.rotateY(Math.PI / 2);
      geo.computeVertexNormals();
      return geo;
    };

    const obstacles = buildObstacles();
    const trees = obstacles.filter((o) => o.kind === 'tree');
    const isConifer = (o) => {
      const biome = biomeAt(o.x, o.y);
      return biome === 'mountain' || (biome === 'forest' && o.leaf % 2 === 0);
    };
    const coniferCounts = [0, 0, 0, 0];
    const crownCounts = [0, 0, 0, 0];
    let branchCount = 0;
    for (const o of trees) {
      if (isConifer(o)) coniferCounts[o.leaf] += 4;
      else {
        crownCounts[o.leaf] += 5;
        branchCount += 2;
      }
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, trees.length);
    const branches = new THREE.InstancedMesh(branchGeo, barkMat, branchCount);
    const conifers = coniferCounts.map(
      (count, i) => new THREE.InstancedMesh(coniferGeo, leafMats[i], count),
    );
    const crowns = crownCounts.map(
      (count, i) => new THREE.InstancedMesh(crownGeo, leafMats[i], count),
    );
    const parent = new THREE.Object3D();
    const part = new THREE.Object3D();
    const treeMatrix = new THREE.Matrix4();
    const coniferAt = [0, 0, 0, 0];
    const crownAt = [0, 0, 0, 0];
    let trunkAt = 0;
    let branchAt = 0;
    const setPart = (mesh, index, position, rotation, scale) => {
      part.position.set(position[0], position[1], position[2]);
      part.rotation.set(rotation[0], rotation[1], rotation[2]);
      part.scale.set(scale[0], scale[1], scale[2]);
      part.updateMatrix();
      treeMatrix.multiplyMatrices(parent.matrix, part.matrix);
      mesh.setMatrixAt(index, treeMatrix);
      const w = styleWeight(parent.position.x, parent.position.z);
      mesh.setColorAt(index, new THREE.Color(1 + w * 0.25, 1 + w * 0.4, 1 - w * 0.04));
    };
    const crownParts = [
      [-20, 120, -12, 42, 35, 38],
      [22, 126, -8, 45, 39, 41],
      [-8, 143, 20, 43, 40, 40],
      [18, 151, 15, 39, 36, 38],
      [0, 169, 0, 42, 40, 42],
    ];
    for (const o of trees) {
      parent.position.set(o.x, terrainHeight(o.x, o.y), o.y);
      parent.rotation.set(0, o.rot, 0);
      parent.scale.setScalar(o.scale);
      parent.updateMatrix();
      setPart(trunks, trunkAt++, [0, 50, 0], [0, 0, 0], [1, 1, 1]);
      if (isConifer(o)) {
        const mesh = conifers[o.leaf];
        for (let k = 0; k < 4; k++) {
          const s = 1 - k * 0.13;
          setPart(
            mesh,
            coniferAt[o.leaf]++,
            [0, 84 + k * 29, 0],
            [0, o.rot * (k + 1) * 0.37, 0],
            [s, 1 - k * 0.08, s],
          );
        }
      } else {
        for (const side of [-1, 1]) {
          setPart(
            branches,
            branchAt++,
            [side * 12, 83, side * 5],
            [side * 0.18, 0, side * 0.72],
            [1, 1, 1],
          );
        }
        const mesh = crowns[o.leaf];
        for (const [x, y, z, sx, sy, sz] of crownParts) {
          setPart(
            mesh,
            crownAt[o.leaf]++,
            [x, y, z],
            [o.rot * 0.17, o.rot * 0.51 + y, o.rot * 0.11],
            [sx, sy, sz],
          );
        }
      }
    }
    for (const mesh of [trunks, branches, ...conifers, ...crowns]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      world.add(mesh);
    }

    for (const o of obstacles) {
      if (o.kind === 'tree') continue;
      if (o.landmark) continue;
      if (o.kind === 'house') {
        const g = new THREE.Group();
        const sampleHouse = styleWeight(o.x, o.y) > 0.3;
        const sampleWall = sampleHouse
          ? new THREE.MeshStandardMaterial({ color: 0xefd9a9, roughness: 0.92 })
          : wallMats[o.wall];
        const sampleRoof = sampleHouse
          ? new THREE.MeshStandardMaterial({ color: 0x3b7289, roughness: 0.82 })
          : roofMats[o.roof];
        // Seat the house on the ground: floor at the HIGHEST terrain under the
        // footprint (so nothing pokes up through the floor), with a foundation
        // that fills the downhill gap (so it never floats). Fixes slope clipping.
        const cf = Math.cos(-o.angle);
        const sf = Math.sin(-o.angle);
        const maxH = obstacleGroundHeight(o);
        let minH = Infinity;
        for (const lx of [-o.hw, 0, o.hw]) {
          for (const lz of [-o.hd, 0, o.hd]) {
            const hh = terrainHeight(o.x + lx * cf + lz * sf, o.y - lx * sf + lz * cf);
            if (hh < minH) minH = hh;
          }
        }
        const walls = new THREE.Mesh(wallGeo, sampleWall);
        walls.scale.set(o.w, o.h, o.d);
        walls.position.y = o.h / 2;
        walls.castShadow = true;
        walls.receiveShadow = true;
        g.add(walls);
        const roof = new THREE.Mesh(makeGableRoof(o.w + 46, o.d + 54, o.h * 0.7), sampleRoof);
        roof.position.y = o.h;
        roof.castShadow = true;
        roof.receiveShadow = true;
        g.add(roof);
        const ridge = new THREE.Mesh(
          new THREE.CylinderGeometry(8, 8, o.w + 58, 12),
          roofMats[o.roof],
        );
        ridge.rotation.z = Math.PI / 2;
        ridge.position.y = o.h * 1.7 + 1;
        ridge.castShadow = true;
        g.add(ridge);
        // Chimney, timber corner posts and a roof ridge break up the large cabin
        // silhouette so the life-size buildings do not read as plain boxes.
        const chimney = new THREE.Mesh(wallGeo, foundationMat);
        chimney.scale.set(42, o.h * 0.62, 42);
        chimney.position.set(o.w * 0.28, o.h + o.h * 0.18, -o.d * 0.18);
        chimney.castShadow = true;
        g.add(chimney);
        const chimneyCap = new THREE.Mesh(wallGeo, foundationMat);
        chimneyCap.scale.set(54, 14, 54);
        chimneyCap.position.set(o.w * 0.28, o.h + o.h * 0.5, -o.d * 0.18);
        chimneyCap.castShadow = true;
        g.add(chimneyCap);
        for (const xs of [-1, 1]) {
          for (const zs of [-1, 1]) {
            const beam = new THREE.Mesh(wallGeo, doorMat);
            beam.scale.set(12, o.h + 8, 12);
            beam.position.set(xs * (o.w / 2 + 3), o.h / 2, zs * (o.d / 2 + 3));
            beam.castShadow = true;
            g.add(beam);
          }
        }
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.scale.set(46, 92, 8); // fixed person-sized doorway (wizard ≈ 82 tall)
        door.position.set(0, 46, o.d / 2 + 3);
        g.add(door);
        // Door frame, threshold and a warm porch lantern.
        for (const side of [-1, 1]) {
          const jamb = new THREE.Mesh(wallGeo, foundationMat);
          jamb.scale.set(9, 105, 11);
          jamb.position.set(side * 29, 52, o.d / 2 + 7);
          g.add(jamb);
        }
        const lintel = new THREE.Mesh(wallGeo, foundationMat);
        lintel.scale.set(67, 10, 11);
        lintel.position.set(0, 102, o.d / 2 + 7);
        g.add(lintel);
        const step = new THREE.Mesh(wallGeo, foundationMat);
        step.scale.set(130, 12, 54);
        step.position.set(0, 6, o.d / 2 + 22);
        step.castShadow = true;
        g.add(step);
        const porchLamp = new THREE.Mesh(lampGeo, porchLampMat);
        porchLamp.position.set(45, 105, o.d / 2 + 9);
        g.add(porchLamp);
        // Two storeys: a stone divider belt at mid-height + windows on both floors.
        const belt = new THREE.Mesh(wallGeo, foundationMat);
        belt.scale.set(o.w + 12, 16, o.d + 12);
        belt.position.y = o.h * 0.5;
        belt.castShadow = true;
        g.add(belt);
        // Fine horizontal timber courses and window frames keep the large walls
        // from reading as featureless boxes at close range.
        for (const fy of [0.16, 0.34, 0.66, 0.84]) {
          for (const face of [-1, 1]) {
            const course = new THREE.Mesh(wallGeo, doorMat);
            course.scale.set(o.w + 7, 5, 7);
            course.position.set(0, o.h * fy, face * (o.d / 2 + 3));
            course.castShadow = true;
            g.add(course);
          }
        }
        for (const fy of [o.h * 0.26, o.h * 0.74]) {
          for (const zs of [1, -1]) {
            for (const xf of [-0.28, 0.28]) {
              const frame = new THREE.Mesh(wallGeo, foundationMat);
              frame.scale.set(62, 74, 8);
              frame.position.set(o.w * xf, fy, zs * (o.d / 2 + 3));
              frame.castShadow = true;
              g.add(frame);
              const win = new THREE.Mesh(wallGeo, winMat);
              win.scale.set(48, 60, 6);
              win.position.set(o.w * xf, fy, zs * (o.d / 2 + 8));
              g.add(win);
            }
          }
          for (const xs of [1, -1]) {
            for (const zf of [-0.28, 0.28]) {
              const frame = new THREE.Mesh(wallGeo, foundationMat);
              frame.scale.set(8, 74, 62);
              frame.position.set(xs * (o.w / 2 + 3), fy, o.d * zf);
              frame.castShadow = true;
              g.add(frame);
              const win = new THREE.Mesh(wallGeo, winMat);
              win.scale.set(6, 60, 48);
              win.position.set(xs * (o.w / 2 + 8), fy, o.d * zf);
              g.add(win);
            }
          }
        }
        const foundH = maxH - minH + 40; // plinth down past the lowest ground
        const found = new THREE.Mesh(wallGeo, foundationMat);
        found.scale.set(o.w, foundH, o.d);
        found.position.y = -foundH / 2;
        found.castShadow = true;
        g.add(found);
        g.position.set(o.x, maxH, o.y);
        g.rotation.y = -o.angle; // sim angle -> world (y is flipped like heading)
        world.add(g);
      } else if (o.kind === 'rock') {
        const rockMat = rockMats[Math.abs(Math.floor(o.rx * 17)) % rockMats.length];
        const localRock =
          styleWeight(o.x, o.y) > 0.3
            ? new THREE.MeshStandardMaterial({ color: 0x8e9c9e, roughness: 1, flatShading: true })
            : rockMat;
        const m = new THREE.Mesh(rockGeo, localRock);
        m.scale.set(o.s, o.s * o.sy, o.s);
        m.position.set(o.x, terrainHeight(o.x, o.y) + o.s * 0.3, o.y);
        m.rotation.set(o.rx, o.ry, o.rz);
        m.castShadow = true;
        m.receiveShadow = true;
        world.add(m);
      } else if (o.kind === 'bush') {
        const g = new THREE.Group();
        for (const [x, y, z, scale] of [
          [-0.55, 0.55, 0, 0.8],
          [0.5, 0.58, -0.15, 0.88],
          [0.05, 0.82, 0.35, 0.95],
        ]) {
          const clump = new THREE.Mesh(bushGeo, leafMats[o.leaf]);
          clump.position.set(x * o.s, y * o.s, z * o.s);
          clump.scale.set(o.s * scale, o.s * scale * 0.72, o.s * scale);
          clump.castShadow = true;
          g.add(clump);
        }
        g.position.set(o.x, terrainHeight(o.x, o.y), o.y);
        g.rotation.y = o.rot;
        world.add(g);
      } else if (o.kind === 'cactus') {
        const g = new THREE.Group();
        const trunk = new THREE.Mesh(cactusGeo, cactusMat);
        trunk.position.y = 47;
        trunk.castShadow = true;
        g.add(trunk);
        for (let a = 0; a < o.arms; a++) {
          const side = a % 2 === 0 ? 1 : -1;
          const arm = new THREE.Group();
          arm.position.set(0, 34 + a * 12, 0);
          arm.rotation.y = side > 0 ? 0 : Math.PI;
          const out = new THREE.Mesh(cactusArmGeo, cactusMat);
          out.rotation.z = Math.PI / 2;
          out.position.set(11, 0, 0);
          arm.add(out);
          const up = new THREE.Mesh(cactusArmGeo, cactusMat);
          up.position.set(22, 15, 0);
          up.scale.set(1, 0.9, 1);
          arm.add(up);
          arm.children.forEach((m) => (m.castShadow = true));
          g.add(arm);
        }
        g.position.set(o.x, terrainHeight(o.x, o.y), o.y);
        g.scale.setScalar(o.scale);
        g.rotation.y = o.rot;
        world.add(g);
      }
    }
    scene.add(world);
  }

  // ---- Storm (the shrinking safe circle) -----------------------------------
  // A glowing ring on the ground plus a faint wall cylinder, both scaled to the
  // current storm radius each frame.
  const stormRing = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.012, 10, 96),
    new THREE.MeshBasicMaterial({ color: 0xc084fc }),
  );
  stormRing.rotation.x = -Math.PI / 2;
  stormRing.position.y = 1;
  scene.add(stormRing);
  const stormWall = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 300, 96, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x7c3aed,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
    }),
  );
  stormWall.position.y = 150;
  scene.add(stormWall);

  // ---- Wizards -------------------------------------------------------------
  const wizards = new Map(); // id -> { group, robe }
  let advancedWizardGltf = null;
  advancedWizardPromise.then((gltf) => {
    if (!gltf) return;
    advancedWizardGltf = gltf;
    const playerRig = [...wizards.values()].find((rig) => rig.isPlayer);
    if (playerRig) attachAdvancedWizard(playerRig);
  });

  // Shared limb bits (skin + boots), reused by every wizard. Limbs are two
  // segments each so the knees and elbows can bend during the walk cycle.
  const BODY_SCALE = 1.3; // wizards are a bit bigger than their 16-unit hitbox
  const clothDetail = makeNoiseTexture(96, 0x62ccad13, 235, 255);
  clothDetail.repeat.set(5, 9);
  clothDetail.colorSpace = THREE.SRGBColorSpace;
  const skinMat = new THREE.MeshPhysicalMaterial({
    color: 0xdca77e,
    roughness: 0.72,
    sheen: 0.12,
    sheenColor: new THREE.Color(0xffc7a6),
  });
  const bootMat = new THREE.MeshPhysicalMaterial({
    color: 0x201a2f,
    roughness: 0.62,
    clearcoat: 0.22,
    clearcoatRoughness: 0.65,
  });
  const trouserMat = new THREE.MeshStandardMaterial({ color: 0x15182a, roughness: 0.92 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.4 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 });
  const earGeo = new THREE.SphereGeometry(1.5, 8, 8);
  const thighGeo = new THREE.CylinderGeometry(3.6, 3.2, 10, 14);
  const shinGeo = new THREE.CylinderGeometry(3.0, 2.6, 10, 14);
  const heroThighGeo = new THREE.CylinderGeometry(3.7, 3.25, 11, 20);
  const heroShinGeo = new THREE.CylinderGeometry(3.35, 2.85, 11, 20);
  const upperArmGeo = new THREE.CylinderGeometry(2.8, 2.4, 10, 14);
  const foreArmGeo = new THREE.CylinderGeometry(2.3, 2.0, 10, 14);
  // The hero wears fitted articulated sleeves. Keeping each cloth section close
  // to the matching limb prevents the old wide bell sleeve from cutting through
  // the chest and robe during climbing, running, and diagonal casts.
  const heroUpperSleeveGeo = new THREE.CylinderGeometry(3.7, 3.05, 12, 24);
  const heroForeSleeveGeo = new THREE.CylinderGeometry(3.15, 2.65, 12, 24);
  const heroElbowGeo = new THREE.SphereGeometry(3.12, 20, 14);
  const heroFootGeo = new THREE.CapsuleGeometry(2.55, 4.2, 8, 18);
  const handGeo = new THREE.SphereGeometry(2.8, 10, 10);
  const neckGeo = new THREE.CylinderGeometry(2.6, 2.9, 5, 8);
  const pelvisGeo = new THREE.BoxGeometry(9, 8, 15);
  const eyeGeo = new THREE.SphereGeometry(0.95, 8, 8); // small, not a big stare
  const noseGeo = new THREE.SphereGeometry(1.2, 8, 8);
  // Gold for stars / trim, and a beard tone — the star-and-moon wizard look.
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    emissive: 0x4a3708,
    roughness: 0.4,
    metalness: 0.6,
  });
  const beardMat = new THREE.MeshStandardMaterial({ color: 0x6b5d4a, roughness: 0.95 });
  const starGeo = new THREE.OctahedronGeometry(0.9);
  const moonGeo = new THREE.TorusGeometry(3.4, 1, 6, 20, Math.PI * 1.55);
  const navy = new THREE.Color(0x07142f);
  const darkNavy = new THREE.Color(0x061433);

  function makeCoatTailGeometry(topWidth, bottomWidth, height, depth) {
    const y0 = -height / 2;
    const y1 = height / 2;
    const x0 = -depth / 2;
    const x1 = depth / 2;
    const z0 = bottomWidth / 2;
    const z1 = topWidth / 2;
    const vertices = [
      x0,
      y0,
      -z0,
      x0,
      y0,
      z0,
      x0,
      y1,
      -z1,
      x0,
      y1,
      z1,
      x1,
      y0,
      -z0,
      x1,
      y0,
      z0,
      x1,
      y1,
      -z1,
      x1,
      y1,
      z1,
    ];
    const indices = [
      0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5, 2, 6, 3, 3, 6, 7, 0,
      1, 4, 1, 5, 4,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }
  const heroBackTailGeo = makeCoatTailGeometry(7.5, 9.2, 23, 2.1);
  const heroFrontTailGeo = makeCoatTailGeometry(6.8, 8.2, 21, 1.7);
  const botTailGeo = makeCoatTailGeometry(5.6, 6.8, 20, 1.5);

  function makeHeroTorsoGeometry() {
    // A continuous human-shaped profile: narrow waist, ribcage, broad rounded
    // shoulders, then a short taper toward the neck.
    const profile = [
      new THREE.Vector2(7.5, -11),
      new THREE.Vector2(7.8, -8),
      new THREE.Vector2(8.5, -3),
      new THREE.Vector2(9.2, 3),
      new THREE.Vector2(10.8, 7.5),
      new THREE.Vector2(10.4, 9.5),
      new THREE.Vector2(8.3, 11),
    ];
    const geo = new THREE.LatheGeometry(profile, 32);
    geo.computeVertexNormals();
    return geo;
  }

  function makeBentWizardHatGeometry() {
    // One continuous tapered crown following a soft curve. This replaces the
    // old stack of cylinders, so the hat reads as stitched cloth instead of
    // separate blocks.
    const curve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 62, 0),
        new THREE.Vector3(-0.4, 71, 0),
        new THREE.Vector3(-1.2, 81, -1.2),
        new THREE.Vector3(-3.5, 90, -4.2),
        new THREE.Vector3(-7.2, 97, -9),
        new THREE.Vector3(-10.5, 101, -13),
      ],
      false,
      'centripetal',
      0.45,
    );
    const rings = 28;
    const sides = 24;
    const frames = curve.computeFrenetFrames(rings, false);
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const center = curve.getPointAt(t);
      const normal = frames.normals[i];
      const binormal = frames.binormals[i];
      const radius = 0.28 + 8.9 * Math.pow(1 - t, 0.86);
      for (let side = 0; side < sides; side++) {
        const a = (side / sides) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        positions.push(
          center.x + normal.x * ca * radius + binormal.x * sa * radius,
          center.y + normal.y * ca * radius + binormal.y * sa * radius,
          center.z + normal.z * ca * radius + binormal.z * sa * radius,
        );
        uvs.push(side / sides, t * 3);
      }
    }
    for (let ring = 0; ring < rings; ring++) {
      for (let side = 0; side < sides; side++) {
        const nextSide = (side + 1) % sides;
        const a = ring * sides + side;
        const b = ring * sides + nextSide;
        const c = (ring + 1) * sides + side;
        const d = (ring + 1) * sides + nextSide;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  const heroTorsoGeo = makeHeroTorsoGeometry();
  const heroHatGeo = makeBentWizardHatGeometry();

  const weaponWoodMat = new THREE.MeshStandardMaterial({ color: 0x6f3215, roughness: 0.78 });
  const weaponMetalMat = new THREE.MeshPhysicalMaterial({
    color: 0x263556,
    roughness: 0.35,
    metalness: 0.76,
  });
  const weaponSilverMat = new THREE.MeshPhysicalMaterial({
    color: 0xbcc8dc,
    roughness: 0.24,
    metalness: 0.82,
  });
  const weaponBookMat = new THREE.MeshPhysicalMaterial({
    color: 0x35105d,
    roughness: 0.72,
    clearcoat: 0.2,
  });
  const weaponLeafMat = new THREE.MeshStandardMaterial({ color: 0x4f9c3f, roughness: 0.8 });
  const weaponGlowMaterials = new Map();

  function weaponGlow(color) {
    if (!weaponGlowMaterials.has(color)) {
      weaponGlowMaterials.set(
        color,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
    }
    return weaponGlowMaterials.get(color);
  }

  function weaponCylinder(group, start, end, radius, material, sides = 12) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 1.06, length, sides),
      material,
    );
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  function createAdvancedBaseWeapon(weaponId) {
    const group = new THREE.Group();
    group.name = `HeldBaseWeapon:${weaponId}`;
    const cyan = weaponGlow(0x45e7ff);
    const violet = weaponGlow(0xb559ff);

    if (weaponId === 'focusing-crystal-staff') {
      weaponCylinder(
        group,
        new THREE.Vector3(-0.22, -0.18, 0),
        new THREE.Vector3(0.58, 0.54, 0),
        0.024,
        weaponWoodMat,
      );
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.115, 1), violet);
      crystal.position.set(0.64, 0.61, 0);
      crystal.scale.set(0.68, 1.45, 0.68);
      group.add(crystal);
      for (const side of [-1, 1]) {
        weaponCylinder(
          group,
          new THREE.Vector3(0.48, 0.45, 0),
          new THREE.Vector3(0.64, 0.59, side * 0.1),
          0.015,
          weaponSilverMat,
          8,
        );
      }
    } else if (weaponId === 'thunderclap-gauntlet') {
      const forearm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.16, 0.42, 10),
        weaponMetalMat,
      );
      forearm.rotation.z = Math.PI / 2;
      forearm.position.set(-0.06, 0.02, 0);
      group.add(forearm);
      const fist = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.2, 0.22), weaponMetalMat);
      fist.position.set(0.19, 0.02, 0);
      fist.rotation.z = -0.16;
      group.add(fist);
      for (let index = 0; index < 4; index++) {
        const knuckle = new THREE.Mesh(new THREE.OctahedronGeometry(0.055), goldMat);
        knuckle.position.set(0.28, 0.08, (index - 1.5) * 0.055);
        group.add(knuckle);
      }
      const rune = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.018, 7, 24), cyan);
      rune.position.set(0.03, 0.14, 0);
      rune.rotation.x = Math.PI / 2;
      group.add(rune);
    } else if (weaponId === 'arcane-spellbook') {
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.43, 0.11), weaponBookMat);
      book.position.set(0.22, 0.14, 0.08);
      book.rotation.z = -0.18;
      book.castShadow = true;
      group.add(book);
      const pages = new THREE.Mesh(
        new THREE.BoxGeometry(0.29, 0.37, 0.115),
        new THREE.MeshStandardMaterial({ color: 0xd8caa1, roughness: 0.9 }),
      );
      pages.position.copy(book.position);
      pages.rotation.copy(book.rotation);
      pages.scale.set(0.91, 0.91, 0.9);
      group.add(pages);
      const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), cyan);
      rune.position.set(0.26, 0.16, 0.155);
      group.add(rune);
      for (const corner of [
        [0.08, -0.01],
        [0.37, -0.01],
        [0.08, 0.31],
        [0.37, 0.31],
      ]) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.14), goldMat);
        cap.position.set(corner[0], corner[1], 0.08);
        group.add(cap);
      }
    } else if (weaponId === 'enchanted-bow') {
      const bowCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.05, -0.42, 0),
        new THREE.Vector3(0.17, -0.24, 0),
        new THREE.Vector3(0.05, 0, 0),
        new THREE.Vector3(0.17, 0.24, 0),
        new THREE.Vector3(-0.05, 0.42, 0),
      ]);
      const bow = new THREE.Mesh(
        new THREE.TubeGeometry(bowCurve, 24, 0.025, 8, false),
        weaponWoodMat,
      );
      bow.castShadow = true;
      group.add(bow);
      const stringGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.05, -0.42, 0),
        new THREE.Vector3(0.04, 0, 0),
        new THREE.Vector3(-0.05, 0.42, 0),
      ]);
      group.add(new THREE.Line(stringGeometry, new THREE.LineBasicMaterial({ color: 0x72ff9d })));
      for (const y of [-0.3, 0.3]) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), weaponLeafMat);
        leaf.position.set(0.11, y, 0.025);
        leaf.scale.set(1.7, 0.65, 0.35);
        group.add(leaf);
      }
    } else if (weaponId === 'chaos-orb') {
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 2), violet);
      orb.position.set(0.28, 0.2, 0);
      group.add(orb);
      for (const rotation of [0, Math.PI / 2]) {
        const orbit = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.018, 6, 28), cyan);
        orbit.position.copy(orb.position);
        orbit.rotation.x = rotation;
        orbit.rotation.y = rotation * 0.55;
        group.add(orbit);
      }
      for (let index = 0; index < 5; index++) {
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), violet);
        const angle = (index / 5) * Math.PI * 2;
        shard.position.set(0.28 + Math.cos(angle) * 0.34, 0.2 + Math.sin(angle) * 0.34, 0.04);
        group.add(shard);
      }
    } else {
      // Apprentice Wand: simple, readable, and deliberately smaller than the staff.
      weaponCylinder(
        group,
        new THREE.Vector3(-0.03, -0.05, 0),
        new THREE.Vector3(0.52, 0.31, 0),
        0.023,
        weaponWoodMat,
      );
      for (const amount of [0.12, 0.3, 0.47]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.006, 5, 12), goldMat);
        ring.position.set(amount, amount * 0.62 - 0.05, 0);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
      }
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.075), cyan);
      gem.position.set(0.56, 0.35, 0);
      group.add(gem);
    }

    group.traverse((part) => {
      if (part.isMesh) part.castShadow = true;
    });
    return group;
  }

  function createShovelModel() {
    const shovel = new THREE.Group();
    shovel.name = 'HeldShovel';
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.034, 0.58, 10),
      new THREE.MeshStandardMaterial({ color: 0x6b351d, roughness: 0.78 }),
    );
    shaft.rotation.z = -0.22;
    shaft.position.set(0.05, -0.08, 0);
    shovel.add(shaft);
    const grip = new THREE.Mesh(
      new THREE.TorusGeometry(0.075, 0.014, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0xb98242, metalness: 0.5, roughness: 0.38 }),
    );
    grip.rotation.y = Math.PI / 2;
    grip.position.set(-0.015, 0.18, 0);
    shovel.add(grip);
    const blade = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.22, 4),
      new THREE.MeshPhysicalMaterial({
        color: 0x9daabd,
        metalness: 0.8,
        roughness: 0.28,
        clearcoat: 0.35,
      }),
    );
    blade.rotation.z = -0.22;
    blade.position.set(0.18, -0.39, 0);
    blade.scale.set(0.7, 1, 0.22);
    shovel.add(blade);
    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), weaponGlow(0x45e7ff));
    rune.position.set(0.12, -0.33, 0.045);
    shovel.add(rune);
    shovel.traverse((part) => {
      if (part.isMesh) part.castShadow = true;
    });
    return shovel;
  }

  function setRigDigging(rig, enabled) {
    if (!rig) return;
    if (rig.heldWeapon) rig.heldWeapon.visible = !enabled;
    for (const part of rig.heldWeaponParts || []) part.visible = !enabled;
    if (rig.shovel) rig.shovel.visible = false;
  }

  function buildWizard(color, isPlayer, baseWeaponId = 'apprentice-wand') {
    const group = new THREE.Group();
    const body = new THREE.Group(); // everything below scales up together
    group.name = isPlayer ? 'PlayerWizardModel' : 'BotWizardModel';
    body.name = 'WizardAnimationRig';
    const col = new THREE.Color(color);
    const robeColor = isPlayer ? navy.clone() : col.clone();
    const sleeveMat = new THREE.MeshPhysicalMaterial({
      color: robeColor.clone().multiplyScalar(isPlayer ? 1.15 : 0.75),
      map: clothDetail,
      bumpMap: clothDetail,
      bumpScale: 0.18,
      roughness: isPlayer ? 0.88 : 0.6,
      metalness: isPlayer ? 0.05 : 0,
      sheen: 0.35,
      sheenColor: robeColor.clone().multiplyScalar(1.8),
      sheenRoughness: 0.8,
    });

    // Two-segment legs: hip -> thigh -> knee -> shin + foot, so the knee bends.
    // +X is forward; ±Z are the sides. Legs reach the ground from the hip at y20.
    const legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.name = side < 0 ? 'LeftHip' : 'RightHip';
      hip.position.set(0, 22, side * (isPlayer ? 5.5 : 4.8));
      const thigh = new THREE.Mesh(isPlayer ? heroThighGeo : thighGeo, trouserMat);
      thigh.position.y = isPlayer ? -5.5 : -5;
      thigh.castShadow = true;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.name = side < 0 ? 'LeftKnee' : 'RightKnee';
      knee.position.y = isPlayer ? -11 : -10;
      const shin = new THREE.Mesh(isPlayer ? heroShinGeo : shinGeo, bootMat);
      shin.position.y = isPlayer ? -5.5 : -5;
      shin.castShadow = true;
      knee.add(shin);
      const ankle = new THREE.Group();
      ankle.name = side < 0 ? 'LeftAnkle' : 'RightAnkle';
      ankle.position.y = isPlayer ? -11 : -10;
      const foot = new THREE.Mesh(heroFootGeo, bootMat);
      foot.position.set(2, isPlayer ? -0.25 : -0.5, 0);
      foot.rotation.z = Math.PI / 2;
      if (!isPlayer) foot.scale.setScalar(0.86);
      foot.castShadow = true;
      ankle.add(foot);
      knee.add(ankle);
      hip.add(knee);
      body.add(hip);
      legs.push({ hip, knee, ankle });
    }

    // Pelvis linking the legs to the torso.
    const pelvis = new THREE.Mesh(pelvisGeo, bootMat);
    pelvis.position.y = isPlayer ? 23 : 22;
    pelvis.castShadow = true;
    body.add(pelvis);

    const robeMat = new THREE.MeshPhysicalMaterial({
      color: robeColor,
      map: clothDetail,
      bumpMap: clothDetail,
      bumpScale: 0.2,
      roughness: isPlayer ? 0.95 : 0.85,
      emissive: robeColor.clone().multiplyScalar(isPlayer ? 0.16 : 0.1),
      sheen: 0.28,
      sheenColor: robeColor.clone().multiplyScalar(1.6),
      sheenRoughness: 0.84,
    });
    // The hero has a separate chest and coat tails instead of one full-height
    // cone. Broad shoulders taper into a believable waist, making the arms,
    // hips, and legs read as parts of one human body.
    const robe = new THREE.Mesh(
      isPlayer ? heroTorsoGeo : new THREE.CylinderGeometry(8.2, 7.1, 20, 16),
      robeMat,
    );
    robe.name = isPlayer ? 'FittedWizardCoat' : 'BotRobe';
    robe.position.y = isPlayer ? 37 : 36;
    robe.scale.set(isPlayer ? 0.78 : 0.82, 1, isPlayer ? 1.15 : 1.08);
    robe.castShadow = true;
    body.add(robe);
    if (!isPlayer) {
      // Bots use the same readable human construction with a simpler coloured
      // split coat. Their legs remain visible during the shared walk animation.
      for (const side of [-1, 1]) {
        for (const front of [-1, 1]) {
          const tail = new THREE.Mesh(botTailGeo, robeMat);
          tail.position.set(front * 5.85, 15, side * 3.45);
          tail.rotation.x = side * 0.012;
          tail.castShadow = true;
          body.add(tail);
        }
      }
    }
    // Belt around the waist. The player gets the reference's dark leather belt
    // with a bright gold buckle; bots retain the simpler gold band.
    const beltMat = isPlayer
      ? new THREE.MeshStandardMaterial({ color: 0x20170f, roughness: 0.8, metalness: 0.15 })
      : goldMat;
    const beltRadius = isPlayer ? 8.8 : 7.8;
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(beltRadius, beltRadius, 3, 16), beltMat);
    belt.position.y = 26;
    belt.scale.set(0.85, 1, 1);
    body.add(belt);
    if (isPlayer) {
      const buckle = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.65, 7, 18), goldMat);
      buckle.position.set(7.5, 26, 0);
      buckle.rotation.y = Math.PI / 2;
      body.add(buckle);
      for (const side of [-1, 1]) {
        const frontTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 19, 7), goldMat);
        frontTrim.position.set(7.35, 37.5, side * 4.5);
        body.add(frontTrim);
      }
    }
    // Gold stars scattered over the robe front (the star-and-moon motif).
    const frontStars = isPlayer
      ? [
          [7.3, 43, 1.8],
          [7.4, 36, -2.5],
          [7.2, 23, 1.8],
          [7.2, 14, -2.4],
          [7.1, 46, -1.8],
          [7.3, 29, 2.8],
        ]
      : [
          [8.4, 40, 1.5],
          [9.6, 33, -2],
          [11.1, 22, 1.5],
          [12.1, 16, -2],
          [7.9, 45, -1.5],
          [10.2, 28, 2.5],
        ];
    for (const [sx, sy, sz] of frontStars) {
      const star = new THREE.Mesh(starGeo, goldMat);
      star.position.set(sx, sy, sz);
      body.add(star);
    }

    // The reference outfit is a fitted long coat. Four separate lower panels
    // create a front and back split, so the legs remain visible and the lower
    // body no longer reads as a cone.
    if (isPlayer) {
      const capeMat = new THREE.MeshStandardMaterial({
        color: darkNavy,
        roughness: 0.96,
        emissive: new THREE.Color(0x020713),
        side: THREE.DoubleSide,
      });
      for (const side of [-1, 1]) {
        const backTail = new THREE.Mesh(heroBackTailGeo, capeMat);
        backTail.position.set(-6.7, 14.5, side * 4.55);
        backTail.rotation.x = side * 0.018;
        backTail.castShadow = true;
        body.add(backTail);
        const frontTail = new THREE.Mesh(heroFrontTailGeo, robeMat);
        frontTail.position.set(6.35, 15.5, side * 4.15);
        frontTail.rotation.x = side * 0.015;
        frontTail.castShadow = true;
        body.add(frontTail);

        const backHem = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 8.3), goldMat);
        backHem.position.set(-7.8, 3.05, side * 4.55);
        body.add(backHem);
        const frontHem = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 7.5), goldMat);
        frontHem.position.set(7.25, 5.05, side * 4.15);
        body.add(frontHem);
      }

      // A short shoulder yoke joins the fitted chest to the back coat panels.
      const yoke = new THREE.Mesh(new THREE.BoxGeometry(2, 12, 18.5), capeMat);
      yoke.position.set(-6.8, 39.5, 0);
      yoke.castShadow = true;
      body.add(yoke);

      // A fitted standing collar replaces the old bulky torus cowl. The cowl
      // occupied the shoulder sockets and was the main source of arm clipping.
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 10.2, 3, 24, 1, true), capeMat);
      collar.position.set(-0.8, 45.5, 0);
      collar.scale.set(0.82, 1, 1);
      collar.castShadow = true;
      body.add(collar);
      const collarTrim = new THREE.Mesh(new THREE.TorusGeometry(9.15, 0.55, 6, 28), goldMat);
      collarTrim.rotation.x = Math.PI / 2;
      collarTrim.position.set(-0.8, 47, 0);
      collarTrim.scale.set(0.82, 1, 1);
      body.add(collarTrim);

      // Narrow gold seams emphasize the split coat construction.
      for (const side of [-1, 1]) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.65, 22, 0.75), goldMat);
        seam.position.set(-7.8, 14.5, side * 0.55);
        body.add(seam);
      }

      // Large moon-and-stars arrangement on the back, matching the reference.
      const backMoon = new THREE.Mesh(moonGeo, goldMat);
      backMoon.position.set(-7.9, 37, 0);
      backMoon.rotation.y = -Math.PI / 2;
      backMoon.rotation.z = -0.25;
      backMoon.scale.setScalar(1.45);
      body.add(backMoon);
      const constellation = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.42, 6, 32), goldMat);
      constellation.position.set(-7.85, 36.5, 0);
      constellation.rotation.y = -Math.PI / 2;
      body.add(constellation);
      for (const [sx, sy, sz, scale] of [
        [-7.8, 45, -6, 1.25],
        [-7.8, 42, 6.5, 1.05],
        [-7.85, 32, -6.5, 1.2],
        [-7.85, 21, 5.5, 1.35],
        [-7.85, 11, -4.5, 1.05],
        [-7.85, 15, 7, 0.9],
      ]) {
        const star = new THREE.Mesh(starGeo, goldMat);
        star.position.set(sx, sy, sz);
        star.scale.setScalar(scale * 2.15);
        body.add(star);
      }

      // A smaller crescent on the front panel.
      const frontMoon = new THREE.Mesh(moonGeo, goldMat);
      frontMoon.position.set(7.35, 36, -3.8);
      frontMoon.rotation.y = Math.PI / 2;
      frontMoon.scale.setScalar(0.8);
      body.add(frontMoon);
    }

    // Two-segment arms: shoulder -> upper -> elbow -> forearm + hand. The shoulder
    // sits on the torso's shoulder line with a rounded deltoid that blends the arm
    // into the body, plus a slight outward splay so it hangs off naturally.
    const arms = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.name = side < 0 ? 'LeftShoulder' : 'RightShoulder';
      // Tuck the hero's shoulder socket into the fitted torso. The rounded cloth
      // cap overlaps the tunic slightly, hiding the mechanical-looking gap while
      // still leaving enough clearance for climbing and casting rotations.
      shoulder.position.set(0.4, 43.5, side * (isPlayer ? 12.3 : 9.2));
      shoulder.rotation.x = -side * 0.13; // rest splay
      const deltoid = new THREE.Mesh(
        new THREE.SphereGeometry(isPlayer ? 4 : 3.5, isPlayer ? 24 : 12, isPlayer ? 16 : 10),
        sleeveMat,
      );
      if (isPlayer) {
        // A gently tapered cloth shoulder rather than a round armor-like ball.
        deltoid.scale.set(0.92, 0.78, 1.16);
        deltoid.position.y = -0.65;
      }
      deltoid.castShadow = true;
      shoulder.add(deltoid);
      const upper = new THREE.Mesh(isPlayer ? heroUpperSleeveGeo : upperArmGeo, sleeveMat);
      upper.position.y = isPlayer ? -6 : -5;
      upper.castShadow = true;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.name = side < 0 ? 'LeftElbow' : 'RightElbow';
      elbow.position.y = isPlayer ? -12 : -10;
      if (isPlayer) {
        // A rounded cloth-covered elbow bridges the two sleeve sections. It sits
        // directly on the bend pivot, so the joint remains connected at every
        // animation angle instead of opening a visible gap.
        const elbowJoint = new THREE.Mesh(heroElbowGeo, sleeveMat);
        elbowJoint.scale.set(0.96, 0.82, 1);
        elbowJoint.castShadow = true;
        elbow.add(elbowJoint);
      }
      const fore = new THREE.Mesh(isPlayer ? heroForeSleeveGeo : foreArmGeo, sleeveMat);
      fore.position.y = isPlayer ? -6 : -5;
      fore.castShadow = true;
      elbow.add(fore);
      if (isPlayer) {
        // The cuff belongs to the moving forearm, so it never floats or slices
        // through the arm when the elbow bends. The old shoulder ring was
        // intentionally removed—the hard circle made the joint look mechanical.
        const cuff = new THREE.Mesh(new THREE.TorusGeometry(2.75, 0.5, 6, 18), goldMat);
        cuff.rotation.x = Math.PI / 2;
        cuff.position.y = -11.35;
        elbow.add(cuff);
      }
      const hand = new THREE.Mesh(handGeo, skinMat);
      hand.position.y = isPlayer ? -12.5 : -10;
      if (isPlayer) hand.scale.set(1.18, 1.05, 0.82);
      elbow.add(hand);
      shoulder.add(elbow);
      body.add(shoulder);
      arms.push({ shoulder, elbow });
    }
    const digHand = new THREE.Group();
    digHand.position.y = isPlayer ? -12.5 : -10;
    arms[1].elbow.add(digHand);

    // Wand gripped in the right hand (local +Z arm), so it swings with the arm.
    const wandLength = isPlayer ? 32 : 24;
    const wandEnd = isPlayer ? 33 : 25;
    const heldWeapon = new THREE.Group();
    heldWeapon.name = 'FallbackHeldWeaponGroup';
    const wandY = isPlayer ? -12.5 : -10;
    heldWeapon.position.set(0, wandY, 0);
    arms[1].elbow.add(heldWeapon);
    const wand = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.75, wandLength, 10),
      new THREE.MeshStandardMaterial({ color: 0x3b2a1a, emissive: 0x241a10 }),
    );
    wand.name = 'FallbackHeldWeapon';
    const heldWeaponParts = [heldWeapon, wand];
    wand.rotation.z = Math.PI / 2;
    wand.position.set(isPlayer ? 17 : 13, 0, 0);
    heldWeapon.add(wand);
    if (isPlayer) {
      // Small gold grips spiral visually along the longer wooden wand.
      for (const wx of [7, 16, 25]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.35, 5, 12), goldMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(wx, 0, 0);
        heldWeapon.add(ring);
        heldWeaponParts.push(ring);
      }
    }
    // Glowing wand tip: a bright core plus a soft additive glow.
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0 }),
    );
    tip.position.set(wandEnd, 0, 0);
    heldWeapon.add(tip);
    heldWeaponParts.push(tip);
    const tipGlow = new THREE.Mesh(
      new THREE.SphereGeometry(5, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffe08a,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    tipGlow.position.copy(tip.position);
    heldWeapon.add(tipGlow);
    heldWeaponParts.push(tipGlow);
    if (isPlayer) {
      const wandLight = new THREE.PointLight(0xffc95c, 2.2, 115, 2);
      wandLight.position.copy(tip.position);
      heldWeapon.add(wandLight);
      heldWeaponParts.push(wandLight);
    }

    const shovel = createShovelModel();
    shovel.position.set(13, wandY, 0);
    shovel.rotation.z = -0.72;
    shovel.userData.restRotationZ = shovel.rotation.z;
    shovel.userData.restPositionX = shovel.position.x;
    shovel.scale.setScalar(isPlayer ? 1.45 : 1.1);
    shovel.visible = false;
    arms[1].elbow.add(shovel);

    // Neck + head with a simple face (two eyes), so it reads as a person.
    const neck = new THREE.Mesh(
      isPlayer ? new THREE.CylinderGeometry(3.15, 3.45, 9, 18) : neckGeo,
      skinMat,
    );
    if (!isPlayer) neck.scale.set(1.05, 1.35, 1.05);
    neck.position.y = isPlayer ? 50 : 48.5;
    neck.castShadow = true;
    body.add(neck);
    // Lift the complete hero head assembly together. This creates a visible neck
    // without separating the face, beard, hair, or hat from one another.
    const headRig = new THREE.Group();
    headRig.name = 'HeadAndHat';
    headRig.position.y = isPlayer ? 4 : 2;
    body.add(headRig);
    const head = new THREE.Mesh(new THREE.SphereGeometry(7.5, 18, 18), skinMat);
    head.position.y = 54;
    head.scale.set(isPlayer ? 1.02 : 0.98, isPlayer ? 1.14 : 1.08, isPlayer ? 0.92 : 0.94);
    headRig.add(head);
    // A friendly face: small eyes, a little nose, and a smile — so it reads as a
    // cheerful person instead of a blank stare.
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(6.9, 54.4, side * 2.7);
      headRig.add(eye);
    }
    const nose = new THREE.Mesh(noseGeo, skinMat);
    nose.position.set(7.6, 52.9, 0);
    headRig.add(nose);
    // A wizard's beard covering the lower face and hanging to a point.
    const beard = new THREE.Mesh(
      new THREE.ConeGeometry(isPlayer ? 4.7 : 4.4, isPlayer ? 10 : 9, isPlayer ? 18 : 14),
      beardMat,
    );
    beard.position.set(isPlayer ? 5.2 : 4.7, isPlayer ? 49 : 48.2, 0);
    beard.rotation.x = Math.PI; // point downward
    beard.castShadow = true;
    headRig.add(beard);
    if (isPlayer) {
      // Fuller jaw and moustache turn the simple face into the bearded adult
      // wizard from the references while retaining the friendly proportions.
      for (const side of [-1, 1]) {
        const jaw = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 10), beardMat);
        jaw.position.set(5.6, 49, side * 4.8);
        jaw.scale.set(1, 1.25, 0.8);
        headRig.add(jaw);
        const moustache = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 3, 5, 8), beardMat);
        moustache.position.set(7.1, 50.8, side * 1.7);
        moustache.rotation.x = Math.PI / 2;
        moustache.rotation.z = side * 0.35;
        headRig.add(moustache);
      }
    }

    // Hair: a rounded cap over the top and back of the head (offset back so the
    // face stays clear) plus little ears — a normal person, no wizard hat.
    const hair = new THREE.Mesh(new THREE.SphereGeometry(7.9, 16, 16), hairMat);
    hair.position.set(-1.1, 55.4, 0);
    hair.scale.set(1.02, 0.95, 0.9);
    hair.castShadow = true;
    headRig.add(hair);
    if (isPlayer) {
      for (const [hx, hy, hz, scale] of [
        [-5.8, 56, -5.2, 1.1],
        [-6.8, 52, -5.8, 1],
        [-6.4, 48, -5.2, 0.95],
        [-5.8, 56, 5.2, 1.1],
        [-6.8, 52, 5.8, 1],
        [-6.4, 48, 5.2, 0.95],
        [-7.4, 54, 0, 1.15],
      ]) {
        const curl = new THREE.Mesh(new THREE.SphereGeometry(2.5, 9, 9), hairMat);
        curl.position.set(hx, hy, hz);
        curl.scale.setScalar(scale);
        curl.castShadow = true;
        headRig.add(curl);
      }
    }
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, skinMat);
      ear.position.set(0, 53.6, side * 7.3);
      headRig.add(ear);
    }

    // Pointed wizard hat (matches the robe) with a brim and gold stars, over the
    // hair.
    const hatMat = new THREE.MeshPhysicalMaterial({
      color: robeColor.clone().multiplyScalar(isPlayer ? 0.88 : 0.65),
      map: clothDetail,
      bumpMap: clothDetail,
      bumpScale: isPlayer ? 0.22 : 0.1,
      roughness: isPlayer ? 0.95 : 0.85,
      sheen: isPlayer ? 0.32 : 0.12,
      sheenColor: robeColor.clone().multiplyScalar(1.7),
      sheenRoughness: 0.82,
      side: THREE.DoubleSide,
    });
    const brim = new THREE.Mesh(
      new THREE.ConeGeometry(isPlayer ? 18 : 13, isPlayer ? 3 : 4, 28),
      hatMat,
    );
    brim.position.y = 61;
    brim.castShadow = true;
    headRig.add(brim);
    if (isPlayer) {
      const crown = new THREE.Mesh(heroHatGeo, hatMat);
      crown.name = 'BentWizardHat';
      crown.castShadow = true;
      headRig.add(crown);

      const hatBand = new THREE.Mesh(new THREE.TorusGeometry(9.15, 0.85, 7, 30), goldMat);
      hatBand.position.y = 63.2;
      hatBand.rotation.x = Math.PI / 2;
      headRig.add(hatBand);
      const brimTrim = new THREE.Mesh(new THREE.TorusGeometry(17.6, 0.65, 6, 40), goldMat);
      brimTrim.position.y = 60.8;
      brimTrim.rotation.x = Math.PI / 2;
      headRig.add(brimTrim);
    } else {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(8.5, 34, 18), hatMat);
      cone.position.y = 78;
      cone.castShadow = true;
      headRig.add(cone);
    }
    const hatStars = isPlayer
      ? [
          [-8, 70, -2],
          [-7.2, 78, 3],
          [-6, 86, -1.5],
          [-7.2, 94, 1],
        ]
      : [
          [6.5, 64, 1.5],
          [5.5, 70, -1.5],
          [3.8, 78, 1],
          [2.2, 85, -1],
        ];
    for (const [hx, hy, hz] of hatStars) {
      const star = new THREE.Mesh(starGeo, goldMat);
      star.position.set(hx, hy, hz);
      if (isPlayer) star.scale.setScalar(2.1);
      headRig.add(star);
    }

    if (isPlayer) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(WIZARD.radius + 7, 1.25, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.5 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 1.5;
      body.add(ring);
    }

    if (isPlayer) body.scale.set(1.5, 1.65, 1.5);
    else body.scale.setScalar(BODY_SCALE);
    const contact = new THREE.Mesh(
      new THREE.CircleGeometry(isPlayer ? 25 : 18, 32),
      new THREE.MeshBasicMaterial({
        color: 0x071018,
        transparent: true,
        opacity: isPlayer ? 0.3 : 0.24,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 1.2;
    group.add(contact);
    group.add(body);
    scene.add(group);
    return {
      group,
      robe,
      robeColor,
      legs,
      arms,
      pelvis,
      body,
      contact,
      isPlayer,
      baseWeaponId,
      heldWeapon,
      heldWeaponParts,
      shovel,
      digHand,
    };
  }

  function getWizard(w) {
    let rig = wizards.get(w.id);
    // A new match may reuse wizard id 0 but must build a fresh rig for the newly
    // confirmed (and then locked) base weapon.
    if (rig && rig.baseWeaponId !== w.baseWeaponId) {
      discardWeaponPose(rig);
      scene.remove(rig.group);
      wizards.delete(w.id);
      rig = null;
    }
    if (!rig) {
      rig = buildWizard(w.color, w.isPlayer, w.baseWeaponId);
      const slowFallAura = new THREE.Group();
      const fallRing = new THREE.Mesh(
        new THREE.TorusGeometry(38, 2.6, 7, 48),
        new THREE.MeshBasicMaterial({
          color: 0x8b5cf6,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      fallRing.rotation.x = Math.PI / 2;
      fallRing.position.y = 26;
      slowFallAura.add(fallRing);
      for (let index = 0; index < 14; index++) {
        const particle = new THREE.Mesh(
          new THREE.SphereGeometry(1.8 + (index % 3), 8, 6),
          new THREE.MeshBasicMaterial({
            color: index % 2 ? 0x60a5fa : 0xc084fc,
            transparent: true,
            opacity: 0.78,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        particle.userData.angle = (index / 14) * Math.PI * 2;
        particle.userData.phase = (index % 5) * 0.7;
        slowFallAura.add(particle);
      }
      slowFallAura.visible = false;
      rig.group.add(slowFallAura);
      rig.slowFallAura = slowFallAura;
      rig.dead = false;
      rig.diggingMode = false;
      rig.diggingAction = false;
      const drillAura = new THREE.Group();
      for (let index = 0; index < 7; index++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(74 - index * 7, 3.5 - index * 0.26, 7, 36),
          new THREE.MeshBasicMaterial({
            color: index % 2 ? 0xfbbf24 : 0x86efac,
            transparent: true,
            opacity: 0.65,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        ring.userData.index = index;
        drillAura.add(ring);
      }
      drillAura.visible = false;
      rig.group.add(drillAura);
      rig.drillAura = drillAura;
      wizards.set(w.id, rig);
      if (w.isPlayer && advancedWizardGltf) attachAdvancedWizard(rig);
    }
    setRigDigging(rig, rig.diggingMode);
    return rig;
  }

  function attachAdvancedWizard(rig) {
    if (!advancedWizardGltf || rig.advancedModel) return;
    discardWeaponPose(rig);
    const model = advancedWizardGltf.scene;
    model.name = 'AdvancedWizardGLB';
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    // Blender's wizard is narrow across its local Y axis, which becomes local
    // Z after glTF's Z-up -> Y-up conversion. Preserve that slimmer silhouette
    // explicitly here instead of replacing it with a uniform game-only scale.
    model.scale.set(74, 74, 74 * 0.84);
    const tintMaterials = [];
    const oldWeaponParts = [];
    model.traverse((part) => {
      if (
        part.name.startsWith('WizardWand') ||
        part.name.startsWith('WandGrip') ||
        part.name.startsWith('WandGem') ||
        part.name.startsWith('HeldBaseWeapon:')
      ) {
        oldWeaponParts.push(part);
      }
      if (!part.isMesh) return;
      part.castShadow = true;
      part.receiveShadow = true;
      const materials = Array.isArray(part.material) ? part.material : [part.material];
      for (const mat of materials) {
        if (!mat?.color) continue;
        if (
          mat.name === 'LinenTunic' ||
          mat.name === 'LinenCuffs' ||
          mat.name === 'OliveTrousers' ||
          mat.name === 'OliveCuffs'
        ) {
          tintMaterials.push({ material: mat, base: mat.color.clone() });
        }
      }
    });
    for (const part of oldWeaponParts) {
      if (part.name.startsWith('HeldBaseWeapon:')) part.parent?.remove(part);
      else part.visible = false; // hide the Blender model's baked-in default wand
    }
    rig.body.visible = false;
    rig.group.add(model);

    // Attach the confirmed base weapon to the animated right hand. The holder's
    // inverse bone rotation keeps the geometry aligned to the model's axes while
    // still inheriting every hand movement from the walk/cast/climb clips.
    const heldWeapon = createAdvancedBaseWeapon(rig.baseWeaponId);
    const animatedWandGuide = model.getObjectByName('WizardWand');
    const rightHand =
      animatedWandGuide?.parent ||
      model.getObjectByName('mixamorigRightHand') ||
      model.getObjectByName('mixamorig:RightHand') ||
      model.getObjectByName('hand.R');
    if (rightHand) rig.digHand = rightHand;
    rig.digUpperArms = [
      model.getObjectByName('mixamorigLeftArm') || model.getObjectByName('upper_arm.L'),
      model.getObjectByName('mixamorigRightArm') || model.getObjectByName('upper_arm.R'),
    ];
    if (rightHand) {
      model.updateMatrixWorld(true);
      rightHand.updateMatrixWorld(true);
      if (animatedWandGuide) {
        // The authored wand's origin sits near its tip, while every runtime
        // weapon is built around its handle. Put that handle directly inside
        // the modeled fingers and only reuse the authored grip orientation.
        // Keeping this transform on the hand makes every weapon follow the
        // wrist through walk, jump, climb, recoil, and weapon switches.
        heldWeapon.position.set(0.012, -0.018, -0.026);
        heldWeapon.quaternion.copy(animatedWandGuide.quaternion);
        heldWeapon.scale.copy(animatedWandGuide.scale);
      } else {
        heldWeapon.position.set(0, 0, 0);
        const modelWorldRotation = model.getWorldQuaternion(new THREE.Quaternion());
        const handWorldRotation = rightHand.getWorldQuaternion(new THREE.Quaternion()).invert();
        heldWeapon.quaternion.copy(handWorldRotation.multiply(modelWorldRotation));
      }
      rightHand.add(heldWeapon);
    } else {
      heldWeapon.position.set(0.095, 0.9, 0.31);
      model.add(heldWeapon);
    }
    rig.heldWeapon = heldWeapon;
    // Use the editable Blender shovel when it is available. The procedural
    // shovel created by buildWizard remains as a safe fallback until then.
    shovelModelPromise.then((gltf) => {
      if (!gltf || !rig.advancedModel) return;
      const modelShovel = gltf.scene.clone(true);
      modelShovel.name = 'HeldShovelBlender';
      modelShovel.scale.setScalar(0.19);
      modelShovel.rotation.set(0, 0, -0.86);
      modelShovel.position.set(0.095, 0.9, 0.31);
      modelShovel.traverse((part) => {
        if (part.isMesh) {
          part.castShadow = true;
          part.receiveShadow = true;
        }
      });
      const parent = rightHand || model;
      if (rig.shovel) parent.remove(rig.shovel);
      parent.add(modelShovel);
      rig.shovel = modelShovel;
      modelShovel.userData.restRotationZ = modelShovel.rotation.z;
      modelShovel.userData.restPositionX = modelShovel.position.x;
      setRigDigging(rig, rig.diggingMode);
    });
    rig.shovelLoad = shovelModelPromise;
    rig.swimBones = [];
    for (const [i, side] of ['Left', 'Right'].entries()) {
      for (const [part, suffix] of [
        ['arm', 'Arm'],
        ['elbow', 'ForeArm'],
        ['leg', 'UpLeg'],
        ['knee', 'Leg'],
      ]) {
        const bone =
          model.getObjectByName('mixamorig' + side + suffix) ||
          model.getObjectByName('mixamorig:' + side + suffix);
        if (bone) rig.swimBones.push({ bone, part, side: i, base: bone.quaternion.clone() });
      }
    }
    // Fallback shovel is attached to the hand too, so it is visible even if
    // the optional Blender asset is still decoding during the opening.
    if (rightHand) {
      const fallback = rig.shovel;
      if (fallback) {
        rightHand.add(fallback);
        fallback.position.set(0.095, 0.9, 0.31);
        fallback.scale.setScalar(0.19);
        fallback.rotation.set(0, 0, -0.86);
        fallback.userData.restRotationZ = fallback.rotation.z;
        fallback.userData.restPositionX = fallback.position.x;
      }
    }
    rig.advancedModel = model;
    rig.advancedTintMaterials = tintMaterials;
    rig.advancedMixer = new THREE.AnimationMixer(model);
    rig.advancedActions = new Map();
    for (const clip of advancedWizardGltf.animations) {
      const action = rig.advancedMixer.clipAction(clip);
      rig.advancedActions.set(clip.name, action);
    }
    const idle = rig.advancedActions.get('Idle');
    if (idle) {
      idle.setLoop(THREE.LoopRepeat, Infinity);
      idle.play();
      rig.advancedAction = idle;
      rig.advancedActionName = 'Idle';
    }
  }

  function playAdvancedAction(rig, name) {
    if (rig.advancedActionName === name) return;
    const next = rig.advancedActions?.get(name) || rig.advancedActions?.get('Idle');
    if (!next) return;
    const previous = rig.advancedAction;
    const previousName = rig.advancedActionName;
    const oneShot = name === 'Cast' || name === 'JumpSmooth';
    const locomotion = name === 'Walk' || name === 'Run';
    const previousLocomotion = previousName === 'Walk' || previousName === 'Run';
    const stoppingLocomotion = name === 'Idle' && previousLocomotion;
    const fadeDuration = stoppingLocomotion
      ? 0.06
      : name === 'Cast' || previousName === 'Cast'
        ? 0.1
        : name === 'JumpSmooth' || previousName === 'JumpSmooth'
          ? 0.16
          : 0.22;

    // Preserve normalized foot-cycle time when changing between walk and run.
    // Restarting at frame zero made the planted foot pop backward on every
    // Shift press even though the clips themselves were smooth.
    let synchronizedTime = 0;
    if (previous && locomotion && previousLocomotion) {
      const previousDuration = Math.max(previous.getClip().duration, 0.001);
      synchronizedTime =
        ((previous.time % previousDuration) / previousDuration) * next.getClip().duration;
    }
    next.reset();
    next.time = synchronizedTime;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
    next.clampWhenFinished = oneShot;
    next.play();
    if (previous && previous !== next) previous.crossFadeTo(next, fadeDuration, true);
    else next.fadeIn(fadeDuration);
    rig.advancedAction = next;
    rig.advancedActionName = name;
  }

  const digPosePivot = new THREE.Vector3();
  const digPoseHand = new THREE.Vector3();
  const digPoseCurrent = new THREE.Vector3();
  const digPoseDesired = new THREE.Vector3();
  const digPoseDelta = new THREE.Quaternion();
  const digPoseWorld = new THREE.Quaternion();
  const digPoseParent = new THREE.Quaternion();
  const digPoseLocal = new THREE.Quaternion();
  function extendDigHand(rig, wizard) {
    if (rig.isPlayer) glCanvas.dataset.digPoseWeight = (rig.digPose || 0).toFixed(2);
    if (rig.digPose <= 0.001 || !rig.digHand) return;
    const upper = rig.advancedModel ? rig.digUpperArms?.[1] : rig.arms?.[1]?.shoulder;
    if (rig.isPlayer) {
      glCanvas.dataset.digArmJoint = upper?.name || 'missing';
      let parent = rig.digHand;
      while (parent && parent !== upper) parent = parent.parent;
      glCanvas.dataset.digHandAttached = String(parent === upper);
    }
    if (!upper?.parent) return;
    rig.group.updateMatrixWorld(true);
    upper.getWorldPosition(digPosePivot);
    rig.digHand.getWorldPosition(digPoseHand);
    digPoseCurrent.subVectors(digPoseHand, digPosePivot);
    if (digPoseCurrent.lengthSq() < 1) return;
    digPoseCurrent.normalize();
    const downward = wizard.digDirection === 'down';
    const aimPitch = Number.isFinite(wizard.digAimPitch) ? wizard.digAimPitch : 0;
    digPoseDesired
      .set(
        Math.cos(wizard.heading) * (downward ? 0.55 : Math.cos(aimPitch)),
        downward ? -0.82 : Math.sin(aimPitch) - 0.16,
        Math.sin(wizard.heading) * (downward ? 0.55 : Math.cos(aimPitch)),
      )
      .normalize();
    digPoseDelta.setFromUnitVectors(digPoseCurrent, digPoseDesired);
    upper.getWorldQuaternion(digPoseWorld);
    digPoseWorld.premultiply(digPoseDelta);
    upper.parent.getWorldQuaternion(digPoseParent);
    digPoseLocal.copy(digPoseParent).invert().multiply(digPoseWorld);
    upper.quaternion.slerp(digPoseLocal, rig.digPose);
  }

  const swimWorld = new THREE.Quaternion(),
    swimParent = new THREE.Quaternion();
  const swimDelta = new THREE.Quaternion(),
    swimLocal = new THREE.Quaternion();
  const swimSideAxis = new THREE.Vector3(),
    swimForwardAxis = new THREE.Vector3();
  function applySwimAnimation(rig, w, dt, available) {
    rig.swimPose ||= {};
    advanceSwimPose(rig.swimPose, w.swimming && available, w.moving, dt);
    const { weight, phase, drive } = rig.swimPose;
    swimSideAxis.set(-Math.sin(w.heading), 0, Math.cos(w.heading));
    swimForwardAxis.set(Math.cos(w.heading), 0, Math.sin(w.heading));
    for (const pose of rig.swimBones || []) {
      pose.base.copy(pose.bone.quaternion);
      if (weight < 0.001) continue;
      const stroke = swimStroke(phase, pose.side, drive);
      pose.bone.updateWorldMatrix(true, false);
      pose.bone.getWorldQuaternion(swimWorld);
      swimDelta.setFromAxisAngle(swimSideAxis, stroke[pose.part] * weight);
      swimWorld.premultiply(swimDelta);
      if (pose.part === 'arm') {
        swimDelta.setFromAxisAngle(swimForwardAxis, stroke.spread * weight);
        swimWorld.premultiply(swimDelta);
      }
      pose.bone.parent.getWorldQuaternion(swimParent);
      swimLocal.copy(swimParent).invert().multiply(swimWorld);
      pose.bone.quaternion.copy(swimLocal);
    }
    rig.advancedModel.rotation.z = -0.22 * drive * weight;
    if (rig.isPlayer) {
      glCanvas.dataset.swimAnimation = weight > 0.05 ? (drive > 0.3 ? 'stroke' : 'tread') : 'none';
      glCanvas.dataset.swimBlend = weight.toFixed(3);
      glCanvas.dataset.swimArmSwing = swimStroke(phase, 0, drive).arm.toFixed(3);
      glCanvas.dataset.swimLegKick = swimStroke(phase, 0, drive).leg.toFixed(3);
    }
  }

  function updateAdvancedWizard(rig, w, dt) {
    const mvx = w.x - (rig.prevX ?? w.x);
    const mvy = w.y - (rig.prevY ?? w.y);
    rig.prevX = w.x;
    rig.prevY = w.y;
    const speed = Math.hypot(mvx, mvy) / Math.max(dt, 1e-3);
    // Physics advances at 20 Hz while rendering can run much faster. Holding
    // the movement signal briefly bridges the render frames between physics
    // steps, preventing Walk/Idle/Walk flicker and visibly twitching feet.
    if (speed > 20) rig.motionHold = 0.06;
    else rig.motionHold = Math.max(0, (rig.motionHold ?? 0) - dt);
    const hasMovementIntent = typeof w.moving === 'boolean';
    const movingNow = hasMovementIntent ? w.moving : rig.motionHold > 0;
    const motionTarget = movingNow && !w.swimming ? 1 : 0;
    const motionRate = motionTarget > (rig.motionBlend ?? 0) ? 9 : 24;
    rig.motionBlend =
      (rig.motionBlend ?? 0) +
      (motionTarget - (rig.motionBlend ?? 0)) * (1 - Math.exp(-motionRate * dt));
    let action = 'Idle';
    if (w.climbState === 'wall') action = 'Climb';
    else if ((!w.digMode && w.digging) || w.slashTimer > 0 || (w.castTimer || 0) > 0)
      action = 'Cast';
    else if ((w.jumpH || 0) > 1) action = 'JumpSmooth';
    else if (movingNow && !w.swimming) action = w.running ? 'Run' : 'Walk';
    playAdvancedAction(rig, action);
    glCanvas.dataset.playerAnimation = action;
    glCanvas.dataset.playerModel = 'advanced';
    const animationRate =
      action === 'Run'
        ? 1.5
        : action === 'Walk'
          ? 1.9
          : action === 'JumpSmooth'
            ? 1
            : action === 'Climb'
              ? w.climbBlocked
                ? 0
                : 0.82
              : 1;
    rig.animationRate =
      (rig.animationRate ?? animationRate) +
      (animationRate - (rig.animationRate ?? animationRate)) * (1 - Math.exp(-14 * dt));
    rig.advancedMixer.timeScale = rig.animationRate;
    for (const pose of rig.swimBones || []) pose.bone.quaternion.copy(pose.base);
    rig.advancedMixer.update(dt);
    applySwimAnimation(rig, w, dt, action === 'Idle' || action === 'Walk' || action === 'Run');
    extendDigHand(rig, w);
    rig.group.position.y =
      wizardGround(w) + (w.climbH || 0) + (w.flyH || 0) + (w.jumpH || 0) + (w.openingH || 0);
  }

  // Walk cycle: a two-segment gait — thighs swing fore/aft, knees bend on the
  // forward swing so the foot clears the ground, arms counter-swing with a little
  // elbow flex, and the body bobs each step. Eases in/out with movement. Speed is
  // measured from the change in position, since the sim carries no velocity.
  function animateWalk(rig, w, dt) {
    const mvx = w.x - (rig.prevX ?? w.x);
    const mvy = w.y - (rig.prevY ?? w.y);
    rig.prevX = w.x;
    rig.prevY = w.y;
    const speed = Math.hypot(mvx, mvy) / Math.max(dt, 1e-3);
    if (speed > 20) rig.motionHold = 0.14;
    else rig.motionHold = Math.max(0, (rig.motionHold ?? 0) - dt);
    const target = rig.motionHold > 0 ? 1 : 0; // bridge fixed-physics frames
    const amt = (rig.walkAmt =
      (rig.walkAmt ?? 0) +
      (target - (rig.walkAmt ?? 0)) * (1 - Math.exp(-(target > (rig.walkAmt ?? 0) ? 11 : 6) * dt)));
    const runBlend = Math.max(
      0,
      Math.min(1, (speed - WIZARD.speed * 0.82) / (WIZARD.runSpeed - WIZARD.speed * 0.82)),
    );
    const cadence = 5.7 + runBlend * 3.1;
    rig.walkPhase = (rig.walkPhase ?? 0) + dt * cadence * amt;

    // How steep is the ground here? On a steep slope a moving wizard CLIMBS
    // (reaches overhead, high-steps, leans in) instead of walking.
    const e = 30;
    const gx = (terrainHeight(w.x + e, w.y) - terrainHeight(w.x - e, w.y)) / (2 * e);
    const gz = (terrainHeight(w.x, w.y + e) - terrainHeight(w.x, w.y - e)) / (2 * e);
    const slope = Math.hypot(gx, gz); // rise per unit run (tan of the angle)
    // Climb pose while scaling a wall, or when moving up a steep slope.
    const wallClimb = w.climbState === 'wall';
    const jumping = (w.jumpH || 0) > 0;
    const climbTarget = wallClimb ? 1 : jumping ? 0 : tsmooth(slope, 0.4, 0.75) * amt;
    const climb = (rig.climbAmt =
      (rig.climbAmt ?? 0) + (climbTarget - (rig.climbAmt ?? 0)) * (1 - Math.exp(-12 * dt)));
    // A separate, slower climbing rhythm creates deliberate hand-over-hand
    // reaches instead of recycling the quick walking cadence. Releasing W makes
    // the cycle run backward while the wizard slides down.
    const climbRate = wallClimb
      ? w.climbBlocked
        ? 0
        : w.wantClimb
          ? 5.2
          : -3.8
      : climbTarget > 0
        ? 4.4
        : 0;
    rig.climbPhase = (rig.climbPhase ?? 0) + dt * climbRate;
    rig.swimPhase = (rig.swimPhase ?? 0) + dt * 3.2;
    const lerp = (a, b, t) => a + (b - a) * t;

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const ph = rig.walkPhase + (i === 0 ? 0 : Math.PI); // limbs half a cycle apart
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      const swingLift = Math.max(0, Math.sin(ph + 0.48));
      // --- Walk pose ---
      // Thigh strides fore/aft. The recovery leg bends at both knee and ankle,
      // then rolls heel-to-toe as it returns to the ground.
      const stride = 0.48 + runBlend * 0.2;
      let hipZ = stride * s * amt;
      let kneeZ = -(0.1 + swingLift * (0.76 + runBlend * 0.24)) * amt;
      let ankleZ = (0.08 * c + 0.24 * swingLift - 0.1 * Math.max(0, -s)) * amt;
      let armX = -side * 0.13;
      let armZ = -(0.34 + runBlend * 0.16) * s * amt;
      let elbowZ = -(0.22 + 0.22 * Math.max(0, -s)) * amt;
      if (w.swimming) {
        const stroke = Math.sin(rig.swimPhase + i * Math.PI);
        hipZ = stroke * 0.16;
        kneeZ = -0.38;
        armX = -side * 0.4;
        armZ = stroke * 0.65;
        elbowZ = -0.55;
      }
      // --- Climb pose (blended in by `climb`) ---
      if (climb > 0.001) {
        const climbS = Math.sin(rig.climbPhase + (i === 0 ? 0 : Math.PI));
        const legLift = 0.5 + 0.5 * climbS;
        const armReach = 1 - legLift; // opposite hand reaches as this knee lifts
        // Wide high-step: the knee travels from a planted leg to a strong tuck.
        hipZ = lerp(hipZ, -0.45 + 1.8 * legLift, climb);
        kneeZ = lerp(kneeZ, -0.2 - 1.65 * legLift, climb);
        ankleZ = lerp(ankleZ, 0.18 + 0.28 * legLift, climb);
        // Both arms remain above the shoulders. One stretches to a new grip
        // while the other bends at the elbow and pulls the torso upward.
        armZ = lerp(armZ, 2.35 + 0.7 * armReach, climb);
        armX = lerp(armX, -side * (0.08 + 0.2 * armReach), climb);
        elbowZ = lerp(elbowZ, -1.15 + 0.95 * armReach, climb);
      }
      // In the air both knees tuck, then extend slightly for the landing. This
      // prevents the walking cycle from continuing as if the wizard were still
      // planted on the ground.
      const air = Math.max(0, Math.min(1, (w.jumpH || 0) / 14));
      if (air > 0) {
        const rising = (w.jumpV || 0) > 0 ? 1 : 0;
        hipZ = lerp(hipZ, 0.3 + side * 0.08, air);
        kneeZ = lerp(kneeZ, -0.75 - rising * 0.45, air);
        ankleZ = lerp(ankleZ, 0.2, air);
        armZ = lerp(armZ, -side * 0.32, air);
        elbowZ = lerp(elbowZ, -0.35, air);
      }
      rig.legs[i].hip.rotation.z = hipZ;
      rig.legs[i].knee.rotation.z = kneeZ;
      rig.legs[i].ankle.rotation.z = ankleZ;
      rig.arms[i].shoulder.rotation.x = armX;
      rig.arms[i].shoulder.rotation.z = armZ;
      rig.arms[i].elbow.rotation.z = elbowZ;
    }
    // Lean into the wall, then shift the torso from side to side as weight moves
    // between the hands and feet. Reset every axis so transitions stay smooth.
    const groundedWalk = amt * (1 - climb) * (1 - Math.min(1, (w.jumpH || 0) / 8));
    rig.body.rotation.x =
      Math.cos(rig.climbPhase) * 0.045 * climb + Math.cos(rig.walkPhase) * 0.018 * groundedWalk;
    rig.body.rotation.y =
      Math.sin(rig.climbPhase) * 0.07 * climb + Math.sin(rig.walkPhase) * 0.045 * groundedWalk;
    rig.body.rotation.z =
      -climb * 0.27 +
      Math.sin(rig.climbPhase) * 0.09 * climb -
      (0.025 + runBlend * 0.035) * groundedWalk;
    rig.body.position.z = Math.sin(rig.walkPhase) * 0.34 * groundedWalk;
    rig.pelvis.rotation.y = -Math.sin(rig.walkPhase) * 0.055 * groundedWalk;
    rig.pelvis.rotation.z = Math.cos(rig.walkPhase) * 0.025 * groundedWalk;
    // Sit on the terrain (plus any climb/flight height), with a small step bob.
    const walkBob =
      (0.5 - 0.5 * Math.cos(rig.walkPhase * 2)) * (1.35 + runBlend * 0.5) * amt * (1 - climb * 0.8);
    // Two upward pulses per cycle—one for each arm's pull. It only lifts above
    // the simulation position, so the body visibly follows the bent arm instead
    // of loosely floating up the wall.
    const climbPull = (0.5 - 0.5 * Math.cos(rig.climbPhase * 2)) * 5.5 * climb;
    rig.group.position.y =
      wizardGround(w) +
      (w.climbH || 0) +
      (w.flyH || 0) +
      (w.jumpH || 0) +
      (w.openingH || 0) +
      walkBob +
      climbPull;

    // Casting: the wand arm (right, index 1) either slashes DIAGONALLY (for the
    // slash spell) or thrusts forward (bolt/heal).
    const right = rig.arms[1];
    // While climbing, the wall-grip pose wins so casting never drops an arm.
    if (climb < 0.45 && w.slashTimer > 0) {
      // Diagonal down-slash from TOP-RIGHT to BOTTOM-LEFT, driven by the (slower)
      // slash timer so the wand traces the same arc as the effect.
      const p = 1 - w.slashTimer / SPELLS.slash.duration; // 0 -> 1
      right.shoulder.rotation.z = 2.3 - 2.5 * p; // high -> low (top -> bottom)
      right.shoulder.rotation.x = -0.9 + 1.8 * p; // right -> left (across the body)
      right.elbow.rotation.z = -0.25;
    } else if (climb < 0.45) {
      const cast = w.castTimer || 0;
      if (cast > 0) {
        right.shoulder.rotation.z = right.shoulder.rotation.z * (1 - cast) + 1.5 * cast;
        right.elbow.rotation.z = right.elbow.rotation.z * (1 - cast) + 0 * cast;
      }
    }
    extendDigHand(rig, w);
  }

  // ---- Spell bolts (pooled streaks, elongated along their flight path) ------
  const spellPool = [];
  const UP = new THREE.Vector3(0, 1, 0);
  const _dir = new THREE.Vector3();
  const spellCoreGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
  const spellGlowGeo = new THREE.CylinderGeometry(1.7, 1.7, 1, 12);
  function useSpells(n) {
    while (spellPool.length < n) {
      const m = new THREE.Group();
      const core = new THREE.Mesh(
        spellCoreGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      );
      const glow = new THREE.Mesh(
        spellGlowGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.26,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      m.add(core);
      m.add(glow);
      m.userData.core = core;
      m.userData.glow = glow;
      const traceGeometry = new THREE.BufferGeometry();
      traceGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3));
      const traceColors = [];
      for (let i = 0; i < 8; i++)
        traceColors.push((1 - i / 8) ** 2, (1 - i / 8) ** 2, (1 - i / 8) ** 2);
      traceGeometry.setAttribute('color', new THREE.Float32BufferAttribute(traceColors, 3));
      const trace = new THREE.Line(
        traceGeometry,
        new THREE.LineBasicMaterial({
          color: 0xffffff,
          vertexColors: true,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      trace.frustumCulled = false;
      m.userData.trace = trace;
      scene.add(trace);
      scene.add(m);
      spellPool.push(m);
    }
    for (let i = 0; i < spellPool.length; i++) {
      spellPool[i].visible = i < n;
      if (i >= n) {
        spellPool[i].userData.trace.visible = false;
        spellPool[i].userData.traceId = null;
      }
    }
    return spellPool;
  }

  // Tiny pooled impact sparks. Hits, walls, and terrain all emit the same brief
  // gold-white burst without creating garbage during busy bot fights.
  const sparkPool = [];
  const impactRings = [];
  const impactRingGeometry = new THREE.TorusGeometry(1, 0.025, 4, 32);
  function spawnImpactRing(event, worldY) {
    let ring = impactRings.find((r) => r.life <= 0);
    if (!ring && impactRings.length < 8) {
      const mesh = new THREE.Mesh(
        impactRingGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xffe6b8,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      scene.add(mesh);
      ring = { mesh, life: 0 };
      impactRings.push(ring);
    }
    if (!ring) return;
    ring.life = 0.32;
    ring.radius = Math.min(100, Math.max(30, event.radius || event.impactPower || 45));
    ring.mesh.position.set(event.x, worldY + 3, event.y);
    ring.mesh.material.color.set(event.color || 0xffd47d);
    ring.mesh.visible = true;
  }
  let sparkEventBatch = null;
  const fallingRoofs = [];
  let fallingRoofBatch = null;
  let collapseShake = 0;
  let impactShake = 0;
  let impactClock = 0;
  let dirtBursts = 0;
  let queuedVisualEvents = [];
  let receivedVisualEvents = new WeakSet();
  function queueMatchEvent(event) {
    if (receivedVisualEvents.has(event)) return;
    receivedVisualEvents.add(event);
    queuedVisualEvents.push(event);
  }
  function updateImpactShake(events, dt, player) {
    impactClock += dt;
    impactShake *= Math.exp(-10 * dt);
    if (impactShake < 0.02) impactShake = 0;
    const height = player ? wizardGround(player) + 80 : 0;
    for (const event of events) {
      impactShake = Math.max(impactShake, impactShakeStrength(event, player, height));
    }
    glCanvas.dataset.impactShake = impactShake.toFixed(3);
  }
  const fallingRoofGeometry = new THREE.IcosahedronGeometry(1, 1);
  const sparkGeo = new THREE.TetrahedronGeometry(2.2, 0);
  const sparkMats = [
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffb52e).multiplyScalar(1.8),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
    }),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xfff1a8).multiplyScalar(2.2),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
    }),
  ];
  const earthSparkMats = [
    new THREE.MeshBasicMaterial({ color: 0x93684a, transparent: true, opacity: 0.85 }),
    new THREE.MeshBasicMaterial({ color: 0xc9a477, transparent: true, opacity: 0.7 }),
    sparkMats[0],
  ];
  const digMagicMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff423c).multiplyScalar(2.8),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const digGoldMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffd36a).multiplyScalar(3),
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const dirtGlowCanvas = document.createElement('canvas');
  dirtGlowCanvas.width = dirtGlowCanvas.height = 64;
  const dirtGlowContext = dirtGlowCanvas.getContext('2d');
  const dirtGlowGradient = dirtGlowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  dirtGlowGradient.addColorStop(0, 'rgba(255,255,255,1)');
  dirtGlowGradient.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  dirtGlowGradient.addColorStop(0.48, 'rgba(255,255,255,0.28)');
  dirtGlowGradient.addColorStop(1, 'rgba(255,255,255,0)');
  dirtGlowContext.fillStyle = dirtGlowGradient;
  dirtGlowContext.fillRect(0, 0, 64, 64);
  const dirtGlowTexture = new THREE.CanvasTexture(dirtGlowCanvas);
  const dirtGlowMaterials = [0xff5438, 0xffd36a].map(
    (color) =>
      new THREE.SpriteMaterial({
        map: dirtGlowTexture,
        color,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
  );
  const digBlockedMat = new THREE.MeshBasicMaterial({
    color: 0xfb7185,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const digDustMaterials = new Map();
  function digDustMaterial(color) {
    const key = color || '#a07652';
    if (!digDustMaterials.has(key))
      digDustMaterials.set(
        key,
        new THREE.MeshBasicMaterial({
          color: key,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
        }),
      );
    return digDustMaterials.get(key);
  }
  function freeSpark(index) {
    let spark = sparkPool.find((s) => !s.active);
    if (!spark && sparkPool.length < 160) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMats[index % sparkMats.length]);
      const glow = new THREE.Sprite(dirtGlowMaterials[index % 2]);
      glow.scale.set(10, 10, 1);
      glow.visible = false;
      mesh.add(glow);
      mesh.visible = false;
      scene.add(mesh);
      spark = { mesh, glow, active: false, life: 0, maxLife: 0, vx: 0, vy: 0, vz: 0 };
      sparkPool.push(spark);
    }
    if (!spark) spark = sparkPool.reduce((oldest, s) => (s.life < oldest.life ? s : oldest));
    return spark;
  }

  function spawnImpactSparks(event) {
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return;
    const worldY = event.worldZ ?? terrainHeight(event.x, event.y) + (event.z || 0);
    const magicalDig = event.type === 'dig' || event.type === 'dig-blocked';
    const destroyedEarth = ['dig', 'dig-spell', 'drill', 'terrain-collapse'].includes(event.type);
    if (!magicalDig && !destroyedEarth) spawnImpactRing(event, worldY);
    if (destroyedEarth) glCanvas.dataset.dirtBursts = String(++dirtBursts);
    const count = destroyedEarth ? (event.type === 'drill' ? 18 : 32) : magicalDig ? 14 : 8;
    for (let i = 0; i < count; i++) {
      const spark = freeSpark(i);
      spark.glowingDirt = destroyedEarth && i % 3 !== 0;
      spark.glow.visible = spark.glowingDirt;
      spark.glow.material = dirtGlowMaterials[i % 2];
      spark.mesh.material = destroyedEarth
        ? spark.glowingDirt
          ? i % 2
            ? digMagicMat
            : digGoldMat
          : digDustMaterial(event.color)
        : magicalDig
          ? event.type === 'dig-blocked'
            ? digBlockedMat
            : i % 3 === 0
              ? digMagicMat
              : digDustMaterial(event.color)
          : event.type === 'drill' || event.type === 'terrain-collapse'
            ? earthSparkMats[i % 3]
            : sparkMats[i % 2];
      const angle = Math.random() * Math.PI * 2;
      const speed = destroyedEarth ? 120 + Math.random() * 180 : 75 + Math.random() * 95;
      const lift = 0.3 + Math.random() * 0.7;
      spark.active = true;
      spark.life = spark.maxLife = destroyedEarth
        ? 0.65 + Math.random() * 0.45
        : 0.16 + Math.random() * 0.16;
      spark.vx = Math.cos(angle) * speed * (1 - lift * 0.35);
      spark.vy = speed * lift;
      spark.vz = Math.sin(angle) * speed * (1 - lift * 0.35);
      spark.mesh.position.set(event.x, worldY, event.y);
      if (destroyedEarth) {
        const spread = Math.min(55, (event.radius || 45) * 0.35);
        spark.mesh.position.x += Math.cos(angle) * Math.random() * spread;
        spark.mesh.position.z += Math.sin(angle) * Math.random() * spread;
        spark.mesh.position.y += 8 + Math.random() * spread;
      }
      spark.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      spark.baseScale = spark.glowingDirt ? 1.6 + Math.random() * 1.3 : 1;
      spark.mesh.scale.setScalar(spark.baseScale);
      spark.mesh.visible = true;
    }
  }

  function updateImpactSparks(events, dt) {
    for (const ring of impactRings) {
      ring.life = Math.max(0, ring.life - dt);
      ring.mesh.visible = ring.life > 0;
      const t = 1 - ring.life / 0.32;
      ring.mesh.scale.setScalar(ring.radius * (0.35 + t));
      ring.mesh.material.opacity = (1 - t) * 0.7;
    }
    for (const spark of sparkPool) {
      if (!spark.active) continue;
      spark.life -= dt;
      if (spark.life <= 0) {
        spark.active = false;
        spark.mesh.visible = false;
        continue;
      }
      spark.vy -= (spark.glowingDirt ? 160 : 360) * dt;
      spark.mesh.position.x += spark.vx * dt;
      spark.mesh.position.y += spark.vy * dt;
      spark.mesh.position.z += spark.vz * dt;
      spark.mesh.rotation.x += 14 * dt;
      spark.mesh.rotation.z += 18 * dt;
      spark.mesh.scale.setScalar(spark.baseScale * Math.max(0.08, spark.life / spark.maxLife));
    }
    glCanvas.dataset.dirtGlowParticles = String(
      sparkPool.filter((s) => s.active && s.glowingDirt).length,
    );
    if (events === sparkEventBatch) return;
    sparkEventBatch = events;
    for (const event of events || []) {
      if (
        [
          'hit',
          'block',
          'dig',
          'dig-blocked',
          'dig-spell',
          'drill',
          'terrain-collapse',
          'levitation-placed',
          'inventory-pickup',
          'inventory-swap',
          'weapon-upgrade',
          'mana-pickup',
        ].includes(event.type)
      ) {
        spawnImpactSparks(event);
      }
    }
    glCanvas.dataset.dirtGlowParticles = String(
      sparkPool.filter((s) => s.active && s.glowingDirt).length,
    );
  }

  function updateFallingRoofs(events, dt, player) {
    if (events !== fallingRoofBatch) {
      fallingRoofBatch = events;
      for (const event of events || []) {
        if (event.type !== 'terrain-collapse' || !event.first) continue;
        const distance = player
          ? Math.hypot(player.x - event.centerX, player.y - event.centerY)
          : Infinity;
        if (distance < 900) collapseShake = Math.max(collapseShake, (1 - distance / 900) * 6);
        if (fallingRoofs.length >= 8) continue;
        const mesh = new THREE.Mesh(
          fallingRoofGeometry,
          new THREE.MeshLambertMaterial({
            color: 0x756455,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
          }),
        );
        mesh.position.set(event.centerX, event.worldZ + 22, event.centerY);
        mesh.scale.set(Math.min(event.radius || 60, 130), 18, Math.min(event.radius || 60, 130));
        scene.add(mesh);
        fallingRoofs.push({ mesh, life: 0.35 });
      }
    }
    for (let index = fallingRoofs.length - 1; index >= 0; index--) {
      const roof = fallingRoofs[index];
      roof.life -= dt;
      roof.mesh.position.y -= (400 + (0.35 - roof.life) * 400) * dt;
      roof.mesh.rotation.y += dt * 0.6;
      roof.mesh.material.opacity = Math.max(0, roof.life / 0.35) * 0.7;
      if (roof.life > 0) continue;
      scene.remove(roof.mesh);
      roof.mesh.material.dispose();
      fallingRoofs.splice(index, 1);
    }
    collapseShake = Math.max(0, collapseShake - dt * 24);
  }

  // Beams, chain lightning, grapples, novas and explosions are instantaneous
  // simulation events, so give each one a short-lived 3D shape. This makes the
  // new attacks readable at a glance instead of differing only in hidden stats.
  const attackEffects = [];
  const waterRipplePool = [];
  const waterRippleGeometry = new THREE.TorusGeometry(1, 0.045, 5, 36);
  function updateWaterEffects(events, dt) {
    for (const ripple of waterRipplePool) {
      ripple.life = Math.max(0, ripple.life - dt);
      ripple.mesh.visible = ripple.life > 0;
      if (!ripple.life) continue;
      const progress = 1 - ripple.life / 0.9;
      ripple.mesh.scale.setScalar(ripple.radius * (0.25 + progress * 1.5));
      ripple.mesh.material.opacity = (1 - progress) * 0.65;
    }
    for (const event of events) {
      if (event.type !== 'water-splash' && event.type !== 'water-ripple') continue;
      let ripple = waterRipplePool.find((item) => item.life <= 0);
      if (!ripple && waterRipplePool.length < 32) {
        const mesh = new THREE.Mesh(
          waterRippleGeometry,
          new THREE.MeshBasicMaterial({
            color: 0xb9edff,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
          }),
        );
        mesh.rotation.x = -Math.PI / 2;
        scene.add(mesh);
        ripple = { mesh, life: 0, radius: 24 };
        waterRipplePool.push(ripple);
      }
      if (!ripple) continue;
      ripple.life = 0.9;
      ripple.radius = event.radius;
      ripple.mesh.visible = true;
      ripple.mesh.position.set(event.x, event.worldZ + 2, event.y);
      ripple.mesh.scale.setScalar(event.radius * 0.25);
    }
    glCanvas.dataset.waterRipples = String(
      waterRipplePool.filter((ripple) => ripple.life > 0).length,
    );
  }
  let attackEffectBatch = null;
  const effectLineGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  const effectSphereGeometry = new THREE.SphereGeometry(1, 18, 10);

  function effectMaterial(color, opacity = 0.72, wireframe = false) {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(color || '#67e8f9').multiplyScalar(1.8),
      transparent: true,
      opacity,
      wireframe,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  }

  function spawnLineEffect(event) {
    const startY = terrainHeight(event.x, event.y) + (event.z || 55);
    const endY =
      event.endZ != null
        ? terrainHeight(event.x, event.y) + event.endZ
        : terrainHeight(event.endX, event.endY) + 55;
    const start = new THREE.Vector3(event.x, startY, event.y);
    const end = new THREE.Vector3(event.endX, endY, event.endY);
    const direction = end.clone().sub(start);
    const length = Math.max(1, direction.length());
    const mesh = new THREE.Mesh(effectLineGeometry, effectMaterial(event.color, 0.9));
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    mesh.scale.set(event.width || 3, length, event.width || 3);
    scene.add(mesh);
    attackEffects.push({ mesh, life: 0.14, maxLife: 0.14, grow: false });
  }

  function spawnBurstEffect(event) {
    const radius = event.radius || event.range || 90;
    const worldY = event.worldZ ?? terrainHeight(event.x, event.y) + 35;
    const mesh = new THREE.Mesh(effectSphereGeometry, effectMaterial(event.color, 0.58, true));
    mesh.position.set(event.x, worldY, event.y);
    mesh.scale.setScalar(radius * 0.18);
    scene.add(mesh);
    attackEffects.push({ mesh, life: 0.34, maxLife: 0.34, grow: true, radius });
  }

  function updateAttackEffects(events, dt) {
    for (let index = attackEffects.length - 1; index >= 0; index--) {
      const effect = attackEffects[index];
      effect.life -= dt;
      if (effect.life <= 0) {
        scene.remove(effect.mesh);
        effect.mesh.material.dispose();
        attackEffects.splice(index, 1);
        continue;
      }
      const remaining = effect.life / effect.maxLife;
      effect.mesh.material.opacity = remaining * 0.75;
      if (effect.grow) {
        const progress = 1 - remaining;
        effect.mesh.scale.setScalar(effect.radius * (0.18 + progress * 0.82));
      }
    }
    if (events === attackEffectBatch) return;
    attackEffectBatch = events;
    for (const event of events || []) {
      if (event.type === 'beam' || event.type === 'chain' || event.type === 'grapple') {
        spawnLineEffect(event);
      } else if (
        event.type === 'nova' ||
        event.type === 'explosion' ||
        event.type === 'shield' ||
        event.type === 'blink'
      ) {
        spawnBurstEffect(event);
      }
    }
  }

  // ---- Slash arcs (pooled flat sectors shown during a melee slash) ----------
  const slashPool = [];
  function useSlashes(n) {
    while (slashPool.length < n) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(1, 24, -SPELLS.slash.arc / 2, SPELLS.slash.arc),
        new THREE.MeshBasicMaterial({
          color: SPELLS.slash.color,
          transparent: true,
          opacity: 0.4,
          side: THREE.DoubleSide,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      scene.add(m);
      slashPool.push(m);
    }
    for (let i = 0; i < slashPool.length; i++) slashPool[i].visible = i < n;
    return slashPool;
  }

  // ---- Collectible loot ----------------------------------------------------
  // Detailed item models replace the crystals once loaded. A ground ring
  // retains the rarity cue; crystals remain only as an asset-load fallback.
  const attackPickupPool = [];
  const pickupCoreGeometry = new THREE.OctahedronGeometry(12, 1);
  const pickupRingGeometry = new THREE.TorusGeometry(19, 1.6, 7, 28);
  function useAttackPickups(n) {
    while (attackPickupPool.length < n) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(
        pickupCoreGeometry,
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      );
      const ring = new THREE.Mesh(
        pickupRingGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      const tierRing = ring.clone();
      tierRing.material = ring.material.clone();
      tierRing.rotation.set(Math.PI / 2, Math.PI / 2, 0);
      group.add(core, ring, tierRing);
      group.userData = { core, ring, tierRing };
      scene.add(group);
      attackPickupPool.push(group);
    }
    for (let index = 0; index < attackPickupPool.length; index++) {
      attackPickupPool[index].visible = index < n;
    }
    return attackPickupPool;
  }

  // Pickup rewards are granted by the simulation immediately. Their visuals
  // travel independently to the live hand, so movement never delays inventory
  // updates and an item cannot be claimed twice during its flight.
  const pickupVisualById = new Map();
  const pickupFlights = [];
  const pickupFlightTarget = new THREE.Vector3();
  let pickupFlightEvents = new WeakSet();
  let pickupFlightsStarted = 0;
  let pickupFlightsCompleted = 0;

  function animatePickup(event, state) {
    if (event.groundId == null || pickupFlightEvents.has(event)) return;
    const pickup = state.attackPickups?.find((item) => item.id === event.groundId);
    const wizard = state.wizards.find((item) => item.id === event.wizardId);
    if (!pickup || !wizard?.alive) return;
    pickupFlightEvents.add(event);
    let flight = pickupFlights.find((item) => !item.active);
    if (!flight && pickupFlights.length < 24) {
      const visual = new THREE.Group();
      const core = new THREE.Mesh(
        pickupCoreGeometry,
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      );
      visual.add(core);
      scene.add(visual);
      flight = { visual, core, start: new THREE.Vector3(), model: null, modelName: null };
      pickupFlights.push(flight);
    }
    if (!flight) {
      flight = pickupFlights.reduce((oldest, item) =>
        item.elapsed > oldest.elapsed ? item : oldest,
      );
    }
    const source = pickupVisualById.get(pickup.id);
    flight.start.copy(
      source?.position ||
        new THREE.Vector3(pickup.x, terrainHeight(pickup.x, pickup.y) + 34, pickup.y),
    );
    flight.visual.position.copy(flight.start);
    flight.visual.quaternion.copy(source?.quaternion || new THREE.Quaternion());
    flight.initialScale = source?.scale.x || 1;
    flight.visual.scale.setScalar(flight.initialScale);
    flight.core.material.color
      .set(LOOT_RARITIES[pickup.rarity]?.color || LOOT_RARITIES.common.color)
      .multiplyScalar(1.8);
    const modelName = pickupModelName(pickup);
    if (flight.modelName !== modelName) {
      if (flight.model) flight.visual.remove(flight.model);
      flight.model = null;
      flight.modelName = modelName;
    }
    if (!flight.model && itemModels.has(modelName)) {
      flight.model = itemModels.get(modelName).clone(true);
      flight.visual.add(flight.model);
    }
    flight.core.visible = !flight.model;
    flight.wizardId = wizard.id;
    flight.elapsed = 0;
    flight.active = true;
    flight.visual.visible = true;
    if (source && pickup.collectedBy != null) source.visible = false;
    glCanvas.dataset.pickupFlightsStarted = String(++pickupFlightsStarted);
  }

  function updatePickupFlights(state, dt) {
    let count = 0;
    let progress = 0;
    let distance = 0;
    for (const flight of pickupFlights) {
      if (!flight.active) continue;
      const wizard = state.wizards.find((item) => item.id === flight.wizardId);
      const rig = wizards.get(flight.wizardId);
      if (!wizard?.alive || !rig) {
        flight.active = false;
        flight.visual.visible = false;
        continue;
      }
      rig.group.updateMatrixWorld(true);
      if (rig.digHand) rig.digHand.getWorldPosition(pickupFlightTarget);
      else pickupFlightTarget.copy(rig.group.position).add(new THREE.Vector3(0, 90, 0));
      flight.elapsed += dt;
      const t = Math.min(1, flight.elapsed / 0.52);
      const eased = t * t * (3 - 2 * t);
      flight.visual.position.copy(flight.start).lerp(pickupFlightTarget, eased);
      flight.visual.position.y += Math.sin(Math.PI * t) * 24;
      flight.visual.scale.setScalar(flight.initialScale * (1 - eased * 0.78));
      flight.visual.rotation.y += dt * 3 * (1 - t);
      distance = flight.visual.position.distanceTo(pickupFlightTarget);
      progress = t;
      if (t >= 1) {
        flight.active = false;
        flight.visual.visible = false;
        glCanvas.dataset.pickupFlightsCompleted = String(++pickupFlightsCompleted);
        glCanvas.dataset.pickupCompletedHandDistance = distance.toFixed(3);
      } else count++;
    }
    glCanvas.dataset.pickupFlightCount = String(count);
    glCanvas.dataset.pickupFlightProgress = progress.toFixed(4);
    glCanvas.dataset.pickupFlightHandDistance = distance.toFixed(3);
  }

  // ---- Camera: third-person, over-the-shoulder (Fortnite-style) ------------
  // The camera orbits behind the player by a yaw (turn) and pitch (up/down) set
  // from the mouse, sitting a little above and to the side, looking forward.
  // Camera sits behind and above the player at a fixed height; `pitch` tilts the
  // LOOK direction up/down (so you can look at the sky or down at your feet),
  // and `yaw` turns it around.
  // Reference framing: the camera is built in its own right/up/forward basis.
  // That keeps the wizard at a stable screen position while pitch changes.
  const CAM = { dist: 178, side: 0.51, anchor: 90, drop: 0.2 };
  // ADS slides the boom all the way to the weapon side. It stops just behind
  // and above the casting hand so the weapon stays visible without the camera
  // entering its geometry, while the narrowed FOV supplies the sniper zoom.
  const CAM_ADS = { dist: 44, side: 0.84, anchor: 72, drop: 0.02 };
  const CAM_PAD = 20; // clearance kept between the camera and any surface
  let yaw = 0;
  let pitch = -0.26;
  let adsAmount = 0;
  const camPos = new THREE.Vector3().copy(camera.position);
  const _look = new THREE.Vector3();
  const _pivot = new THREE.Vector3();
  const _seg = new THREE.Vector3();
  const _weaponHipPosition = new THREE.Vector3();
  const _weaponAdsPosition = new THREE.Vector3();
  const _weaponOffset = new THREE.Vector3();
  const _weaponHipScale = new THREE.Vector3();
  const _weaponAdsScale = new THREE.Vector3();
  const _weaponAxis = new THREE.Vector3();
  const _cameraForwardAxis = new THREE.Vector3(0, 0, -1);
  const _weaponHipQuaternion = new THREE.Quaternion();
  const _weaponAdsQuaternion = new THREE.Quaternion();
  const _weaponAlignment = new THREE.Quaternion();
  const _weaponRotationOffset = new THREE.Quaternion();
  const _weaponEuler = new THREE.Euler();
  let camReady = false;

  function discardWeaponPose(rig) {
    const pose = rig?.weaponPose;
    if (!pose) return;
    pose.anchor.parent?.remove(pose.anchor);
    if (pose.weapon.parent === scene) scene.remove(pose.weapon);
    rig.weaponPose = null;
  }

  function ensureWeaponPose(rig) {
    const weapon = rig?.heldWeapon;
    if (!weapon?.parent) return null;
    if (rig.weaponPose?.weapon === weapon) return rig.weaponPose;
    discardWeaponPose(rig);

    // The anchor remains on the animated hand. At hip fire the weapon remains
    // a direct child of that same hand so every animation transform is inherited
    // exactly. It only moves to world space while blending toward ADS.
    const parent = weapon.parent;
    const anchor = new THREE.Object3D();
    anchor.name = `HipWeaponAnchor:${rig.baseWeaponId}`;
    anchor.position.copy(weapon.position);
    anchor.quaternion.copy(weapon.quaternion);
    anchor.scale.copy(weapon.scale);
    parent.add(anchor);
    parent.updateMatrixWorld(true);
    weapon.updateMatrixWorld(true);
    rig.weaponPose = { weapon, anchor, hand: parent };
    return rig.weaponPose;
  }

  function updatePlayerWeaponPose(rig, wizard) {
    if (!rig?.isPlayer || !rig.heldWeapon) return;
    const pose = ensureWeaponPose(rig);
    if (!pose) return;
    const { weapon, anchor, hand } = pose;
    const profile = adsProfileForWeapon(rig.baseWeaponId);

    anchor.updateWorldMatrix(true, false);
    anchor.getWorldPosition(_weaponHipPosition);
    anchor.getWorldQuaternion(_weaponHipQuaternion);
    anchor.getWorldScale(_weaponHipScale);
    _weaponOffset.fromArray(profile.hipWeaponPosition).applyQuaternion(_weaponHipQuaternion);
    _weaponHipPosition.add(_weaponOffset);

    // ADS offsets use camera-local coordinates: X right, Y up, negative Z
    // forward. X=0 keeps the weapon's sight line centered on the crosshair.
    _weaponAdsPosition
      .fromArray(profile.adsWeaponPosition)
      .applyQuaternion(camera.quaternion)
      .add(camera.position);
    const recoil = Math.max(0, Math.min(1, wizard.castTimer || 0)) * adsAmount;
    _weaponOffset.set(0, 0, recoil * 7).applyQuaternion(camera.quaternion);
    _weaponAdsPosition.add(_weaponOffset);

    _weaponAxis.fromArray(profile.weaponAimAxis).normalize();
    _weaponAlignment.setFromUnitVectors(_weaponAxis, _cameraForwardAxis);
    _weaponEuler.set(...profile.adsWeaponRotation);
    _weaponRotationOffset.setFromEuler(_weaponEuler);
    _weaponAdsQuaternion
      .copy(camera.quaternion)
      .multiply(_weaponAlignment)
      .multiply(_weaponRotationOffset);
    if (recoil > 0) {
      _weaponEuler.set(-recoil * 0.055, 0, 0);
      _weaponAdsQuaternion.multiply(_weaponRotationOffset.setFromEuler(_weaponEuler));
    }
    _weaponAdsScale.copy(_weaponHipScale).multiplyScalar(profile.adsWeaponScale);

    if (adsAmount === 0) {
      if (weapon.parent !== hand) hand.attach(weapon);
      // Copying the sibling anchor's local transform binds the weapon exactly
      // to the live hand, including animated position, rotation, and scale.
      weapon.position.copy(anchor.position);
      weapon.quaternion.copy(anchor.quaternion);
      weapon.scale.copy(anchor.scale);
      // The animated hand already supplies the full arm and wrist motion.
      // Adding a second procedural swing here rotates the handle inside the
      // fingers and makes it look detached during fast transitions.
      glCanvas.dataset.playerWeaponSwing = '0.0000';
    } else {
      if (weapon.parent !== scene) scene.attach(weapon);
      weapon.position.lerpVectors(_weaponHipPosition, _weaponAdsPosition, adsAmount);
      weapon.quaternion.slerpQuaternions(_weaponHipQuaternion, _weaponAdsQuaternion, adsAmount);
      weapon.scale.lerpVectors(_weaponHipScale, _weaponAdsScale, adsAmount);
    }
    weapon.visible =
      rig.group.visible && !rig.diggingMode && !rig.dead && rig.advancedActionName !== 'Run';
    glCanvas.dataset.playerWeaponVisible = String(weapon.visible);
    glCanvas.dataset.playerWeaponAttachedToHand = String(weapon.parent === hand);
  }

  // Spring arm: if the boom from the player's head to the camera would pass
  // through a solid tree/cabin, pull the camera in to just short of it so we
  // never see inside walls. Marches the segment and reuses the sim's own
  // point-in-obstacle test (world x,y,z -> sim x, height, y).
  function clipBoom(pivot, cam, obstacles) {
    if (!obstacles) return;
    _seg.subVectors(cam, pivot);
    const len = _seg.length();
    if (len < 1) return;
    const steps = Math.ceil(len / 22);
    let free = 1;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const wx = pivot.x + _seg.x * t;
      const wy = pivot.y + _seg.y * t;
      const wz = pivot.z + _seg.z * t;
      if (boltHitsObstacle(wx, wz, wy, CAM_PAD, obstacles)) {
        free = Math.max(0, t - CAM_PAD / len);
        break;
      }
    }
    if (free < 1)
      cam.set(pivot.x + _seg.x * free, pivot.y + _seg.y * free, pivot.z + _seg.z * free);
  }

  function setAim(y, p) {
    yaw = y;
    pitch = p;
  }

  function setAdsAmount(amount) {
    adsAmount = THREE.MathUtils.clamp(amount, 0, 1);
  }

  const waterCamera = {};
  function updateCamera(state, dt, focusIndex) {
    const pl = state.wizards.find((w) => w.isPlayer && w.playerIndex === focusIndex);
    if (!pl) return;
    const localStyle = styleWeight(pl.x, pl.y);
    sampleFog.near = 5000 + (1 - localStyle) * 20000;
    sampleFog.far = 12500 + (1 - localStyle) * 20000;
    key.intensity = 2.55 - localStyle * 0.6;
    ambient.intensity = 0.5 + localStyle * 0.25;
    hemisphere.intensity = 1.05 + localStyle * 0.3;
    renderer.toneMappingExposure = 1.06 - localStyle * 0.04;
    const rawHeight =
      wizardGround(pl) + (pl.climbH || 0) + (pl.flyH || 0) + (pl.jumpH || 0) + (pl.openingH || 0);
    const pth = waterVisualHeight(waterCamera, pl, rawHeight, dt);
    glCanvas.dataset.cameraWaterHeight = pth.toFixed(3);
    // Keep the sun (and its shadow frustum) centered on the player.
    keyTarget.position.set(pl.x, pth, pl.y);
    key.position.set(pl.x + SUN_OFFSET.x, SUN_OFFSET.y + pth, pl.y + SUN_OFFSET.z);
    // Park the visible disc far up the sky in the same direction (follows the
    // player so it holds a fixed spot in the sky).
    sunDisc.position.set(
      pl.x + _sunNorm.x * SUN_DIST,
      _sunNorm.y * SUN_DIST,
      pl.y + _sunNorm.z * SUN_DIST,
    );
    sunGlow.position.copy(sunDisc.position);
    const fwdX = Math.cos(yaw);
    const fwdZ = Math.sin(yaw);
    const rightX = -Math.sin(yaw); // over the (screen-)right shoulder
    const rightZ = Math.cos(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const forwardX = fwdX * cp;
    const forwardZ = fwdZ * cp;
    // Camera-space up: perpendicular to both the aim direction and screen-right.
    const upX = -fwdX * sp;
    const upY = cp;
    const upZ = -fwdZ * sp;
    let distance = THREE.MathUtils.lerp(CAM.dist, CAM_ADS.dist, adsAmount);
    let sideRatio = THREE.MathUtils.lerp(CAM.side, CAM_ADS.side, adsAmount);
    let dropRatio = THREE.MathUtils.lerp(CAM.drop, CAM_ADS.drop, adsAmount);
    const excavating = usesTunnelCamera(pl, terrainHeight(pl.x, pl.y));
    if (excavating) {
      // A normal shoulder boom can cross a newly carved vertical wall. Keep
      // the camera inside the player-safe 126-unit drill passage instead.
      distance = Math.min(distance, 100);
      sideRatio = 0;
      dropRatio = 0.08;
    }
    const onOpeningPlatform =
      state.opening?.phase === 'countdown' || state.opening?.phase === 'choose';
    if (onOpeningPlatform && !pl.slowFalling) {
      // Stay well inside the 430-unit portal ring. The former 330-unit boom
      // plus shoulder offset put the camera inside an archway, so its blue
      // energy sheet and stone pillar swallowed most (or all) of the screen.
      distance = 205;
      sideRatio = 0.18;
      dropRatio = 0.34;
    } else if (pl.slowFalling) {
      distance = 250;
      sideRatio = 0.36;
      dropRatio = 0.25;
    }
    // When aiming sharply upward, frame the upper body instead of trying to put
    // the camera underground. The shortened boom still preserves the same
    // left/right shoulder composition.
    const upward = THREE.MathUtils.clamp(pitch / (Math.PI / 3), 0, 1);
    const anchor = excavating
      ? 105 + upward * 18
      : THREE.MathUtils.lerp(CAM.anchor, CAM_ADS.anchor, adsAmount) + upward * 55;
    const anchorY = pth + anchor;
    const yPerDistance = -sp + upY * dropRatio;
    if (yPerDistance < 0) {
      const maxAboveGround = (anchorY - (pth + 45)) / -yPerDistance;
      distance = Math.min(distance, Math.max(72, maxAboveGround));
    }
    glCanvas.dataset.cameraBoom = distance.toFixed(2);
    glCanvas.dataset.cameraTunnel = String(excavating);
    const shoulder = distance * sideRatio;
    const lift = distance * dropRatio;
    const desired = new THREE.Vector3(
      pl.x - forwardX * distance + rightX * shoulder + upX * lift,
      anchorY - sp * distance + upY * lift,
      pl.y - forwardZ * distance + rightZ * shoulder + upZ * lift,
    );
    if (!camReady || onOpeningPlatform || camPos.distanceTo(desired) > 1500) {
      camPos.copy(desired);
      camReady = true;
    } else {
      camPos.lerp(desired, 1 - Math.exp(-18 * dt)); // snappy so mouse-look feels tight
    }
    // Pull the boom in if it would clip through a tree or cabin behind the player.
    // Move the collision pivot toward the casting hand during ADS as well. A
    // head-centred pivot would pull the close weapon camera back across the
    // wizard whenever a tree or wall was nearby.
    const pivotSide = THREE.MathUtils.lerp(18, 29, adsAmount);
    _pivot.set(pl.x + rightX * pivotSide, anchorY, pl.y + rightZ * pivotSide);
    // While attached to/on a ledge, only the climbed surface and its cached
    // neighbours can intersect this short boom. Avoiding the full island scan
    // removes the camera hitch at the wall -> top transition.
    const openingAir = state.opening?.phase && state.opening.phase !== 'complete';
    const boomObstacles = openingAir
      ? []
      : pl.climbOver
        ? [pl.climbOver, ...(pl.climbNearby || [])]
        : state.obstacles;
    clipBoom(_pivot, camPos, boomObstacles);
    // Keep the camera above the ground so it never sinks into a hill/mountain.
    let camGround = !excavating
      ? terrainHeight(camPos.x, camPos.z) + 45
      : state.terrain.supportHeight(camPos.x, camPos.z, pl.drillFeetY + 100) + 45;
    if (camPos.y < camGround) camPos.y = camGround;
    // Collision can compress the boom almost onto the high aiming pivot. If the
    // wizard's chest slips behind the view, push horizontally backward until it
    // is safely in front again. This preserves aiming pitch without going below
    // the terrain.
    const chestY = pth + 90;
    let toPlayerX = pl.x - camPos.x;
    let toPlayerY = chestY - camPos.y;
    let toPlayerZ = pl.y - camPos.z;
    let playerDepth = toPlayerX * forwardX + toPlayerY * sp + toPlayerZ * forwardZ;
    // Normal play guarantees that the whole wizard remains in front of the
    // camera. Full ADS intentionally relaxes that framing so the boom can rest
    // beside the weapon instead of being forced back behind the character.
    const minimumPlayerDepth = THREE.MathUtils.lerp(42, 8, adsAmount);
    if (playerDepth < minimumPlayerDepth) {
      const pushBack = (minimumPlayerDepth - playerDepth) / Math.max(0.2, cp);
      camPos.x -= fwdX * pushBack;
      camPos.z -= fwdZ * pushBack;
      camGround = !excavating
        ? terrainHeight(camPos.x, camPos.z) + 45
        : state.terrain.supportHeight(camPos.x, camPos.z, pl.drillFeetY + 100) + 45;
      if (camPos.y < camGround) camPos.y = camGround;
      toPlayerX = pl.x - camPos.x;
      toPlayerY = chestY - camPos.y;
      toPlayerZ = pl.y - camPos.z;
      playerDepth = toPlayerX * forwardX + toPlayerY * sp + toPlayerZ * forwardZ;
    }
    if (pl.drill) camPos.y += Math.sin(performance.now() * 0.075) * 1.4;
    camera.position.copy(camPos);
    const shake = Math.min(10, impactShake + collapseShake);
    // Offset only the rendered camera, keeping the spring arm and aim steady.
    camera.position.x += Math.sin(impactClock * 77) * shake;
    camera.position.z += Math.sin(impactClock * 63 + 0.7) * shake * 0.5;
    camera.position.y = Math.max(
      camGround,
      camera.position.y + Math.cos(impactClock * 91) * shake * 0.6,
    );
    sky.position.copy(camera.position);
    // Look in the true aim direction (yaw + pitch) so the center of the screen
    // matches where bolts fly — including up and down.
    _look.set(
      camera.position.x + forwardX * 600,
      camera.position.y + sp * 600,
      camera.position.z + forwardZ * 600,
    );
    camera.lookAt(_look);
    // Normally the requested FOV is untouched. At an extreme angle or beside a
    // wall, widen only enough to keep the chest inside a safe screen margin.
    const playerVertical = toPlayerX * upX + toPlayerY * upY + toPlayerZ * upZ;
    const playerHorizontal = toPlayerX * rightX + toPlayerZ * rightZ;
    const safe = 0.72;
    const depth = Math.max(1, playerDepth);
    const verticalFov = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.abs(playerVertical) / (depth * safe)),
    );
    const horizontalFov = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.abs(playerHorizontal) / (depth * safe * camera.aspect)),
    );
    // Fade the whole-body framing aid out during ADS. Otherwise it would widen
    // the requested sniper FOV and undo both the zoom and the weapon-close view.
    const framingWeight = 1 - adsAmount;
    const visibleFov = Math.min(
      115,
      Math.max(
        requestedFov,
        THREE.MathUtils.lerp(requestedFov, verticalFov, framingWeight),
        THREE.MathUtils.lerp(requestedFov, horizontalFov, framingWeight),
      ),
    );
    if (Math.abs(camera.fov - visibleFov) > 0.01) {
      camera.fov = visibleFov;
      camera.updateProjectionMatrix();
    }
  }

  // ---- Per-frame sync ------------------------------------------------------
  function updateDigPreview(state, digPlayer) {
    for (const part of [digPreview, digTargetRing, digBeam, digBeamCore, digHandGlow, digFlow])
      part.visible = false;
    glCanvas.dataset.digTargetValid = 'false';
    glCanvas.dataset.digBeamVisible = 'false';
    glCanvas.dataset.digHitboxVisible = 'false';
    glCanvas.dataset.digFlowPhase = '0';
    digBeamFlash = diggingPreviewEnabled && !!wizards.get(digPlayer?.id)?.diggingAction ? 1 : 0;
    latestDigAim = null;
    if (!diggingPreviewEnabled || !digPlayer?.alive || !digPlayer.digMode || digPlayer.drill)
      return;

    const direction = digPlayer.digDirection === 'down' ? 'down' : 'forward';
    latestDigAim = crosshairTarget(state, digPlayer.playerIndex || 0);
    const aim = {
      x: latestDigAim.x,
      z: latestDigAim.y,
      y: terrainHeight(digPlayer.x, digPlayer.y) + latestDigAim.z,
      hitKind: latestDigAim.hitKind,
    };
    const plan = precisionDigPlan(state, digPlayer, direction, aim);
    if (!plan.target) return;
    const { x, y, z } = plan.target;
    const radius = plan.brush?.radius || digPlayer.digRadius || MAGICAL_DRILL.precisionRadius;
    const length = plan.brush?.length || digPlayer.digLength || MAGICAL_DRILL.precisionLength;
    const valid = plan.accepted;

    const rig = wizards.get(digPlayer.id);
    if (rig?.digHand) {
      rig.group.updateMatrixWorld(true);
      rig.digHand.getWorldPosition(digHandWorld);
    } else {
      digHandWorld.set(
        digPlayer.x + Math.cos(digPlayer.heading) * 36,
        wizardGround(digPlayer) + 100,
        digPlayer.y + Math.sin(digPlayer.heading) * 36,
      );
    }
    digBeamEnd.set(x, y, z);
    // A sky shot has no terrain impact point. Put its projected opening on the
    // center-camera ray so it tracks the crosshair despite third-person offset.
    if (direction === 'forward' && plan.target.hitKind === 'air' && digPlayer.digAimPitch > 0.1) {
      raycaster.setFromCamera({ x: 0, y: 0 }, camera);
      raycaster.ray.at(900, digBeamEnd);
    }
    digBeamDirection.subVectors(digBeamEnd, digHandWorld);
    const distance = digBeamDirection.length();
    if (distance < 1) return;
    digBeamDirection.divideScalar(distance);
    const brushDirection =
      direction === 'down'
        ? new THREE.Vector3(0, -1, 0)
        : plan.target.hitKind === 'air' && digPlayer.digAimPitch > 0.1
          ? digBeamDirection
          : new THREE.Vector3(plan.target.fx, plan.target.fy, plan.target.fz);

    digPreview.geometry = digPreviewGeometry(radius, length);
    digPreview.material.color.set(valid ? 0xff3038 : 0xff827d);
    const targetCameraDistance = digBeamEnd.distanceTo(camera.position);
    const previewFade = THREE.MathUtils.clamp(
      (targetCameraDistance - radius * 1.5) / (radius * 2),
      0,
      1,
    );
    digPreview.material.opacity = (valid ? 0.1 : 0.06) * previewFade;
    digPreview.position.copy(digBeamEnd);
    digPreview.quaternion.setFromUnitVectors(digAxis, brushDirection);
    digPreview.visible = true;
    digTargetRing.material.color.set(valid ? 0xff4949 : 0xffaaa0);
    digTargetRing.position.copy(digBeamEnd);
    digTargetRing.quaternion.setFromUnitVectors(digRingNormal, brushDirection);
    // The translucent capsule is the exact brush; the small ring is an aim marker.
    // This ring marks the aim point. Its screen size stays readable when the
    // full-size cut volume is too close to the camera to outline cleanly.
    const markerRadius = Math.min(radius, Math.max(18, targetCameraDistance * 0.08));
    digTargetRing.scale.setScalar(markerRadius / MAGICAL_DRILL.precisionRadius);
    const markerScreen = worldToScreen(digBeamEnd.x, digBeamEnd.z, digBeamEnd.y);
    digTargetRing.visible =
      targetCameraDistance > Math.max(100, radius * 1.2) &&
      markerScreen.visible &&
      markerScreen.x > 24 &&
      markerScreen.x < HUD_W - 24 &&
      markerScreen.y > 24 &&
      markerScreen.y < HUD_H - 24;
    for (const beam of [digBeam, digBeamCore]) {
      beam.position.copy(digHandWorld).addScaledVector(digBeamDirection, distance / 2);
      beam.quaternion.setFromUnitVectors(digAxis, digBeamDirection);
      beam.scale.y = distance;
      if (beam === digBeam) beam.scale.x = beam.scale.z = radius;
      beam.material.color.set(beam === digBeam ? 0xf9202d : 0xff1724);
      beam.visible = digBeamFlash > 0;
    }
    const flowTime = performance.now() * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(flowTime * 13);
    digBeam.material.opacity = valid
      ? 0.07 + pulse * 0.04 + digBeamFlash * 0.3
      : 0.04 + pulse * 0.02 + digBeamFlash * 0.18;
    digBeamCore.material.opacity = valid
      ? 0.6 + pulse * 0.18 + digBeamFlash * 0.2
      : 0.38 + pulse * 0.12 + digBeamFlash * 0.2;
    digBeamCore.scale.x = digBeamCore.scale.z = 1 + pulse * 0.25;
    // Red energy streaks run from the wizard's hand toward the aim point.
    // A single reusable line buffer keeps the motion cheap every frame.
    digFlowSide.crossVectors(digBeamDirection, digAxis);
    if (digFlowSide.lengthSq() < 0.001) digFlowSide.set(1, 0, 0);
    else digFlowSide.normalize();
    digFlowUp.crossVectors(digBeamDirection, digFlowSide).normalize();
    const phase = (flowTime * 0.7) % 1;
    for (let index = 0; index < digFlowCount; index++) {
      const travel = (phase + index / digFlowCount) % 1;
      const tail = Math.max(0, travel - 0.055);
      for (let end = 0; end < 2; end++) {
        const t = end === 0 ? tail : travel;
        const spiral = flowTime * 9 + t * 16 + index * 2.4;
        const spread = 5 + 6 * t;
        const offset = index * 6 + end * 3;
        digFlowPositions[offset] =
          digHandWorld.x +
          digBeamDirection.x * distance * t +
          digFlowSide.x * Math.cos(spiral) * spread +
          digFlowUp.x * Math.sin(spiral) * spread;
        digFlowPositions[offset + 1] =
          digHandWorld.y +
          digBeamDirection.y * distance * t +
          digFlowSide.y * Math.cos(spiral) * spread +
          digFlowUp.y * Math.sin(spiral) * spread;
        digFlowPositions[offset + 2] =
          digHandWorld.z +
          digBeamDirection.z * distance * t +
          digFlowSide.z * Math.cos(spiral) * spread +
          digFlowUp.z * Math.sin(spiral) * spread;
      }
    }
    digFlowGeometry.attributes.position.needsUpdate = true;
    digFlow.visible = digBeamFlash > 0;
    digHandGlow.position.copy(digHandWorld);
    digHandGlow.material.color.set(0xff4b40);
    digHandGlow.material.opacity = 0.35 + pulse * 0.18 + digBeamFlash * 0.35;
    digHandGlow.visible = digBeamFlash > 0;
    glCanvas.dataset.digTargetValid = String(valid);
    glCanvas.dataset.digBeamVisible = String(digBeamFlash > 0);
    glCanvas.dataset.digFlowPhase = digBeamFlash > 0 ? phase.toFixed(3) : '0';
    glCanvas.dataset.digHitboxVisible = 'true';
    glCanvas.dataset.digPreviewDirection = direction;
    glCanvas.dataset.digPreviewRadius = String(radius);
    glCanvas.dataset.digPreviewLength = String(length);
    glCanvas.dataset.digBeamStartX = digHandWorld.x.toFixed(1);
    glCanvas.dataset.digBeamStartY = digHandWorld.y.toFixed(1);
    glCanvas.dataset.digBeamStartZ = digHandWorld.z.toFixed(1);
    glCanvas.dataset.digBeamEndX = digBeamEnd.x.toFixed(1);
    glCanvas.dataset.digBeamEndY = digBeamEnd.y.toFixed(1);
    glCanvas.dataset.digBeamEndZ = digBeamEnd.z.toFixed(1);
    glCanvas.dataset.digPreviewScreenX = markerScreen.x.toFixed(1);
    glCanvas.dataset.digPreviewScreenY = markerScreen.y.toFixed(1);
  }

  function update(state, dt, focusIndex = 0) {
    const visualEvents = queuedVisualEvents;
    queuedVisualEvents = [];
    syncTerrain(state.terrain);
    const digPlayer = state.wizards.find((w) => w.isPlayer && w.playerIndex === focusIndex);
    syncLevitation(state, digPlayer, dt);
    syncUndergroundFluids(state, digPlayer);
    updateWaterEffects(visualEvents, dt);
    glCanvas.dataset.swimming = String(!!digPlayer?.swimming);
    glCanvas.dataset.inWater = String(!!digPlayer?.inWater);
    updateImpactShake(visualEvents, dt, digPlayer);
    updateCamera(state, dt, focusIndex);
    const openingActive = state.opening?.phase && state.opening.phase !== 'complete';
    openingArena.visible = !!openingActive;
    if (openingActive) {
      for (let index = 0; index < portalVisuals.length; index++) {
        const visual = portalVisuals[index];
        const portal = state.opening.portals[index];
        const destination = PORTAL_DESTINATIONS[portal.destination];
        visual.material.uniforms.uColor.value.set(destination.color);
        visual.material.uniforms.uTime.value = state.opening.elapsed + index * 0.41;
        visual.swirl.material.color.set(destination.color);
        visual.counterSwirl.material.color.set(destination.color);
        visual.sparks.material.color.set(destination.color);
        const open = state.opening.phase === 'choose';
        const unstablePulse = portal.unstable
          ? 0.5 + Math.sin(state.opening.elapsed * 8 + index) * 0.5
          : 1;
        visual.material.uniforms.uOpen.value = open ? 0.72 + unstablePulse * 0.18 : 0.12;
        visual.swirl.material.opacity = open ? 0.68 : 0.16;
        visual.counterSwirl.material.opacity = open ? 0.5 : 0.1;
        visual.sparks.material.opacity = open ? 0.9 : 0.18;
        visual.swirl.rotation.z += dt * (portal.unstable ? 4.8 : 2.2) * (index % 2 ? -1 : 1);
        visual.counterSwirl.rotation.z -= dt * (portal.unstable ? 3.9 : 1.7) * (index % 2 ? -1 : 1);
        const sparkPositions = visual.sparks.geometry.attributes.position;
        for (let spark = 0; spark < sparkPositions.count; spark++) {
          let y = sparkPositions.getY(spark) + dt * (34 + (spark % 7) * 5);
          if (y > 292) y = 12 + (spark % 5) * 7;
          sparkPositions.setY(spark, y);
        }
        sparkPositions.needsUpdate = true;
        const breathe = 0.985 + Math.sin(state.opening.elapsed * 4.2 + index) * 0.015;
        visual.energy.scale.set(breathe, 1, 1);
      }
    }
    // Slow crossing wave patterns keep the ocean alive without moving the
    // shoreline or affecting gameplay physics.
    if (riversideWaterDetail) {
      riversideWaterDetail.offset.x += dt * 0.025;
      riversideWaterDetail.offset.y += dt * 0.008;
    }
    if (waterDetail) {
      waterDetail.offset.x = (waterDetail.offset.x + dt * 0.004) % 1;
      waterDetail.offset.y = (waterDetail.offset.y + dt * 0.0025) % 1;
    }

    const r = state.storm.radius;
    const sth = terrainHeight(state.storm.cx, state.storm.cy); // ground at storm center
    stormRing.scale.set(r, r, 1);
    stormRing.position.set(state.storm.cx, sth + 2, state.storm.cy);
    stormWall.scale.set(r, 1, r);
    stormWall.position.set(state.storm.cx, sth + 150, state.storm.cy);
    const danger = r < 260;
    stormRing.material.color.set(danger ? 0xf87171 : 0xc084fc);
    stormWall.material.color.set(danger ? 0xef4444 : 0x7c3aed);

    const seen = new Set();
    for (const w of state.wizards) {
      seen.add(w.id);
      const rig = getWizard(w);
      rig.diggingMode = !!w.digMode;
      setRigDigging(rig, rig.diggingMode);
      if (rig.drillAura) {
        const power = w.drill ? 1 : Math.min(1, (w.drillCharge || 0) / MAGICAL_DRILL.chargeSeconds);
        rig.drillAura.visible = !!w.digMode && power > 0;
        const direction = w.drill?.direction || w.drillIntent || 'forward';
        rig.drillAura.rotation.set(0, 0, 0);
        if (direction !== 'forward')
          rig.drillAura.rotation.z = direction === 'up' ? Math.PI / 2 : -Math.PI / 2;
        rig.drillAura.position.set(0, 82, 0);
        for (const ring of rig.drillAura.children) {
          const index = ring.userData.index;
          ring.rotation.y = Math.PI / 2;
          ring.rotation.z += dt * (5 + 21 * power);
          ring.position.x = (index - 3) * 22;
          ring.scale.setScalar(0.4 + power * 0.6);
          ring.material.opacity = 0.18 + power * 0.55;
        }
      }
      if (rig.shovel) {
        rig.diggingTime = (rig.diggingTime || 0) + dt;
        if (rig.diggingAction) {
          const swing = Math.sin(rig.diggingTime * 19) * 0.42;
          rig.shovel.rotation.z = (rig.shovel.userData.restRotationZ ?? -0.86) + swing;
          rig.shovel.position.x =
            (rig.shovel.userData.restPositionX ?? 0.095) + Math.max(0, -swing) * 0.08;
        } else {
          rig.shovel.rotation.z = rig.shovel.userData.restRotationZ ?? -0.86;
          rig.shovel.position.x = rig.shovel.userData.restPositionX ?? 0.095;
        }
      }
      if (w.alive) {
        rig.digPose =
          (rig.digPose || 0) +
          ((w.digMode && !w.drill ? 1 : 0) - (rig.digPose || 0)) * (1 - Math.exp(-28 * dt));
        // Render positions ease toward the fixed-step simulation positions.
        // Teleports still snap immediately, while normal walking fills the
        // otherwise visible gaps between 20 Hz physics ticks.
        const renderDx = w.x - (rig.renderX ?? w.x);
        const renderDy = w.y - (rig.renderY ?? w.y);
        if (rig.renderX === undefined || Math.hypot(renderDx, renderDy) > 420) {
          rig.renderX = w.x;
          rig.renderY = w.y;
        } else {
          const positionBlend = 1 - Math.exp(-22 * dt);
          rig.renderX += renderDx * positionBlend;
          rig.renderY += renderDy * positionBlend;
        }
        rig.group.position.set(rig.renderX, wizardGround(w) + (w.openingH || 0), rig.renderY);
        rig.group.rotation.set(0, -w.heading, 0);
        rig.group.visible = true;
        rig.group.scale.setScalar(1);
        rig.dead = false;
        const hp = Math.max(0, w.health) / WIZARD.maxHealth;
        rig.robe.material.color.copy(rig.robeColor).multiplyScalar(0.5 + 0.5 * hp);
        if (rig.advancedModel) {
          updateAdvancedWizard(rig, w, dt);
          rig.drillSpin = (rig.drillSpin || 0) + dt * 10;
          rig.advancedModel.rotation.y = w.drill ? rig.drillSpin : 0;
          for (const entry of rig.advancedTintMaterials) {
            entry.material.color.copy(entry.base).multiplyScalar(0.65 + 0.35 * hp);
          }
        } else {
          animateWalk(rig, w, dt);
          rig.drillSpin = (rig.drillSpin || 0) + dt * 10;
          if (w.drill) rig.body.rotation.y += rig.drillSpin;
        }
        rig.waterHeight ||= {};
        rig.group.position.y = waterVisualHeight(rig.waterHeight, w, rig.group.position.y, dt);
        updatePlayerWeaponPose(rig, w);
        if (rig.slowFallAura) {
          rig.slowFallAura.visible = !!w.slowFalling;
          if (w.slowFalling) {
            rig.slowFallAura.rotation.y += dt * 1.8;
            const t = state.opening?.elapsed || 0;
            for (let index = 1; index < rig.slowFallAura.children.length; index++) {
              const particle = rig.slowFallAura.children[index];
              const angle = particle.userData.angle + t * (1.5 + (index % 3) * 0.25);
              const radius = 24 + (index % 4) * 7;
              particle.position.set(
                Math.cos(angle) * radius,
                10 + ((t * 55 + particle.userData.phase * 31) % 110),
                Math.sin(angle) * radius,
              );
            }
          }
        }
        const ground = wizardGround(w);
        const lift = Math.max(0, rig.group.position.y - ground);
        rig.contact.position.y = ground - rig.group.position.y + 1.2;
        rig.contact.material.opacity = (w.isPlayer ? 0.3 : 0.24) * Math.max(0, 1 - lift / 180);
        rig.contact.visible = lift < 180;
      } else if (!rig.dead) {
        rig.dead = true;
        rig.popT = 0;
      }
      if (rig.dead) {
        if (rig.weaponPose?.weapon) rig.weaponPose.weapon.visible = false;
        rig.popT += dt;
        const k = Math.max(0, 1 - rig.popT / 0.4);
        rig.group.scale.setScalar(k);
        rig.group.position.y = terrainHeight(w.x, w.y) + rig.popT * 40; // fade upward
        if (k <= 0) rig.group.visible = false;
      }
    }
    for (const [id, rig] of wizards) {
      if (!seen.has(id)) {
        discardWeaponPose(rig);
        scene.remove(rig.group);
        wizards.delete(id);
      }
    }

    updateDigPreview(state, digPlayer, dt);

    const availablePickups = (state.attackPickups || []).filter(
      (pickup) => pickup.collectedBy == null,
    );
    const pickupVisuals = useAttackPickups(availablePickups.length);
    const pickupTime = state.time + (state.opening?.elapsed || 0);
    pickupVisualById.clear();
    availablePickups.forEach((pickup, index) => {
      const visual = pickupVisuals[index];
      pickupVisualById.set(pickup.id, visual);
      const attack = ATTACKS[pickup.attackId];
      const isUpgradeRune = pickup.lootType === 'weapon-upgrade-rune';
      const isManaAmmunition = pickup.lootType === 'mana-ammunition';
      const isTierScroll = pickup.lootType === 'tier-scroll';
      const rarityColor = LOOT_RARITIES[pickup.rarity]?.color || LOOT_RARITIES.common.color;
      const attackColor = isManaAmmunition
        ? MANA_AMMUNITION[pickup.ammoType]?.color || '#67e8f9'
        : isUpgradeRune
          ? '#fbbf24'
          : attack?.color || '#67e8f9';
      visual.position.set(
        pickup.x,
        terrainHeight(pickup.x, pickup.y) + 34 + Math.sin(pickupTime * 2.2 + index) * 7,
        pickup.y,
      );
      visual.rotation.y +=
        dt * (isUpgradeRune ? 2.4 : isTierScroll ? 1.9 : isManaAmmunition ? 2.1 : 1.2);
      visual.scale.setScalar(
        isUpgradeRune ? 1.28 : isTierScroll ? 1.18 : isManaAmmunition ? 0.82 : 1,
      );
      visual.userData.core.material.color.set(rarityColor).multiplyScalar(1.8);
      visual.userData.ring.material.color.set(rarityColor).multiplyScalar(1.3);
      visual.userData.tierRing.material.color.set(attackColor).multiplyScalar(1.3);
      const modelName = pickupModelName(pickup);
      const template = itemModels.get(modelName);
      const data = visual.userData;
      if (data.modelName !== modelName) {
        if (data.model) visual.remove(data.model);
        data.model = null;
        data.modelName = modelName;
      }
      if (!data.model && template) {
        data.model = template.clone(true);
        data.model.name = `pickup-model:${modelName}`;
        visual.add(data.model);
      }
      data.core.visible = !data.model;
      data.ring.position.y = data.model ? -23 : 0;
      data.ring.material.opacity = data.model ? 0.3 : 0.72;
      data.tierRing.visible = !data.model && (isUpgradeRune || isTierScroll);
    });
    updatePickupFlights(state, dt);

    glCanvas.dataset.spellTrails = String(
      state.spells.filter((b) => b.kind !== 'trap' && b.kind !== 'zone').length,
    );
    const bolts = useSpells(state.spells.length);
    state.spells.forEach((b, i) => {
      const m = bolts[i];
      // Anchor the whole flight to the launch terrain. Adding the terrain height
      // beneath the moving bolt made it rise and fall over every hill, as if it
      // were rolling on the ground instead of flying in a straight line.
      const launchGround = b.originGround ?? terrainHeight(b.originX ?? b.x, b.originY ?? b.y);
      m.position.set(b.x, (b.z ?? 22) + launchGround, b.y);
      if (b.kind === 'trap' || b.kind === 'zone') {
        // Traps and summoned fields lie flat instead of looking like frozen bolts.
        m.quaternion.identity();
        const fieldRadius = b.kind === 'zone' ? b.radius : b.explosionRadius * 0.45;
        m.scale.set(fieldRadius, b.kind === 'zone' ? 1.2 : 2.5, fieldRadius);
      } else {
        // Orient and stretch the streak along its travel direction (world x, up, z).
        _dir.set(b.vx, b.vz || 0, b.vy);
        const sp = _dir.length() || 1;
        _dir.multiplyScalar(1 / sp);
        m.quaternion.setFromUnitVectors(UP, _dir);
        const trail = b.trail || Math.max(18, Math.min(76, sp / 65));
        m.scale.set(b.radius * 0.55, trail, b.radius * 0.55);
      }
      const trace = m.userData.trace;
      const positions = trace.geometry.attributes.position;
      const changed = m.userData.traceId !== b;
      const jumped =
        Math.hypot(
          positions.getX(0) - m.position.x,
          positions.getY(0) - m.position.y,
          positions.getZ(0) - m.position.z,
        ) > 600;
      if (changed || jumped) {
        for (let j = 0; j < 8; j++) positions.setXYZ(j, m.position.x, m.position.y, m.position.z);
        m.userData.traceId = b;
      } else if (dt > 0) {
        for (let j = 7; j > 0; j--)
          positions.setXYZ(j, positions.getX(j - 1), positions.getY(j - 1), positions.getZ(j - 1));
        positions.setXYZ(0, m.position.x, m.position.y, m.position.z);
      }
      positions.needsUpdate = true;
      trace.material.color.set(b.color).multiplyScalar(1.8);
      trace.visible = b.kind !== 'trap' && b.kind !== 'zone';
      m.userData.core.material.color.set(b.color).multiplyScalar(2.4);
      m.userData.glow.material.color.set(b.color).multiplyScalar(1.45);
    });

    // Slash arcs: a diagonal crescent in front of the wizard that sweeps from
    // high on one side down across to the other as the (slower) swing plays out.
    const slashing = state.wizards.filter((w) => w.alive && w.slashTimer > 0);
    const slashes = useSlashes(slashing.length);
    const sdur = SPELLS.slash.duration;
    slashing.forEach((w, i) => {
      const m = slashes[i];
      const t = 1 - w.slashTimer / sdur; // 0 at start -> 1 at end of the swing
      const fx = Math.cos(w.heading);
      const fz = Math.sin(w.heading);
      m.position.set(
        w.x + fx * 22,
        46 + wizardGround(w) + (w.climbH || 0) + (w.flyH || 0) + (w.jumpH || 0),
        w.y + fz * 22,
      ); // chest height
      m.scale.setScalar(52);
      m.rotation.set(0, -w.heading, 0); // face the wizard's forward
      m.rotateX(Math.PI / 2); // stand the arc up (vertical plane)
      m.rotateZ(-2.1 + 2.6 * t); // roll diagonally, top-right -> bottom-left
      m.material.color.set(ATTACKS[w.attack]?.color || SPELLS.slash.color);
      m.material.opacity = 0.6 * (w.slashTimer / sdur);
    });
    updateImpactSparks(visualEvents, dt);
    updateFallingRoofs(visualEvents, dt, digPlayer);
    updateAttackEffects(visualEvents, dt);
  }

  // The countdown only needs a responsive camera. Avoid synchronizing every
  // wizard, prop, pickup and effect until the portals open.
  function updateOpeningCamera(state, dt, focusIndex = 0) {
    updateCamera(state, dt, focusIndex);
    const playerWizard = state.wizards.find(
      (wizard) => wizard.isPlayer && wizard.playerIndex === focusIndex,
    );
    if (playerWizard) {
      // Full scene synchronization is intentionally skipped during 3-2-1, so
      // apply the one visible character change that must remain responsive:
      // the wizard turns with the camera just as they do during normal play.
      const rig = getWizard(playerWizard);
      rig.group.rotation.set(0, -playerWizard.heading, 0);
      updatePlayerWeaponPose(rig, playerWizard);
    }
  }

  // ---- Projection helpers --------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _hit = new THREE.Vector3();
  const _probe = new THREE.Vector3();
  const obstacleGrounds = new WeakMap();
  function obstacleGround(o) {
    let h = obstacleGrounds.get(o);
    if (h === undefined) {
      h = terrainHeight(o.x, o.y);
      obstacleGrounds.set(o, h);
    }
    return h;
  }
  // Mouse NDC (-1..1) -> a point on the ground, in sim (x, y) coords.
  function screenToWorld(ndcX, ndcY) {
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, _hit)) return null;
    return { x: _hit.x, y: _hit.z };
  }

  // Distance from the camera ray to a vertical cylinder, including its end caps.
  // Used for the same compact hit volume the projectile simulation uses.
  function rayCylinderDistance(cx, cz, radius, bottom, top, maxT) {
    const ray = raycaster.ray;
    const ox = ray.origin.x - cx;
    const oz = ray.origin.z - cz;
    const dx = ray.direction.x;
    const dz = ray.direction.z;
    const a = dx * dx + dz * dz;
    let best = maxT;
    if (a > 1e-8) {
      const b = 2 * (ox * dx + oz * dz);
      const c = ox * ox + oz * oz - radius * radius;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const root = Math.sqrt(disc);
        for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
          if (t <= 1 || t >= best) continue;
          const y = ray.origin.y + ray.direction.y * t;
          if (y >= bottom && y <= top) best = t;
        }
      }
    }
    if (Math.abs(ray.direction.y) > 1e-8) {
      for (const y of [bottom, top]) {
        const t = (y - ray.origin.y) / ray.direction.y;
        if (t <= 1 || t >= best) continue;
        const x = ox + dx * t;
        const z = oz + dz * t;
        if (x * x + z * z <= radius * radius) best = t;
      }
    }
    return best;
  }

  function rayHouseDistance(o, maxT) {
    const ray = raycaster.ray;
    const c = Math.cos(o.angle);
    const s = Math.sin(o.angle);
    const ox = (ray.origin.x - o.x) * c + (ray.origin.z - o.y) * s;
    const oz = -(ray.origin.x - o.x) * s + (ray.origin.z - o.y) * c;
    const dx = ray.direction.x * c + ray.direction.z * s;
    const dz = -ray.direction.x * s + ray.direction.z * c;
    const base = obstacleGround(o);
    let enter = 1;
    let exit = maxT;
    for (const [origin, dir, lo, hi] of [
      [ox, dx, -o.hw, o.hw],
      [ray.origin.y, ray.direction.y, base, base + o.top],
      [oz, dz, -o.hd, o.hd],
    ]) {
      if (Math.abs(dir) < 1e-8) {
        if (origin < lo || origin > hi) return maxT;
        continue;
      }
      let a = (lo - origin) / dir;
      let b = (hi - origin) / dir;
      if (a > b) [a, b] = [b, a];
      enter = Math.max(enter, a);
      exit = Math.min(exit, b);
      if (enter > exit) return maxT;
    }
    return enter;
  }

  // March the center ray against the actual island height field, then refine the
  // first crossing. This replaces the old sea-level plane that caused the
  // crosshair and long-range trajectory to disagree on hills.
  function rayTerrainDistance(maxT) {
    const ray = raycaster.ray;
    const clearanceAt = (t) => {
      ray.at(t, _probe);
      return _probe.y - Math.max(0, terrainHeight(_probe.x, _probe.z));
    };
    let previousT = 1;
    let previousClearance = clearanceAt(previousT);
    for (let t = 41; t <= maxT; t += 40) {
      const clearance = clearanceAt(t);
      if (previousClearance > 0 && clearance <= 0) {
        let lo = previousT;
        let hi = t;
        for (let i = 0; i < 9; i++) {
          const mid = (lo + hi) * 0.5;
          if (clearanceAt(mid) > 0) lo = mid;
          else hi = mid;
        }
        return hi;
      }
      previousT = t;
      previousClearance = clearance;
    }
    return maxT;
  }

  // Exact center-camera trace. It finds the first visible wizard, solid prop, or
  // piece of terrain and returns that world point in the simulation's local
  // height coordinates. The wand then converges on this point from its offset
  // muzzle, which removes shoulder-camera parallax even while sniping.
  function crosshairTarget(state, focusIndex = 0) {
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    // Trace as far as both the camera and projectile can actually reach. The
    // previous 10,000-unit cap stopped short of distant targets now visible
    // across the fog-free island, which made long-range shots look offset.
    const maxT = Math.min(camera.far - camera.near, WAND.speed * WAND.life);
    let best = rayTerrainDistance(maxT);
    let hitKind = best < maxT ? 'terrain' : 'air';
    let targetId = null;
    const player = state?.wizards.find((w) => w.isPlayer && w.playerIndex === focusIndex);

    for (const w of state?.wizards || []) {
      if (!w.alive || w === player) continue;
      const base = wizardGround(w) + (w.climbH || 0) + (w.flyH || 0) + (w.jumpH || 0);
      const hit = rayCylinderDistance(
        w.x,
        w.y,
        WIZARD.radius,
        base,
        base + (w.bodyHeight || BODY_HEIGHT),
        best,
      );
      if (hit < best) {
        best = hit;
        targetId = w.id;
        hitKind = 'wizard';
      }
    }

    for (const o of state?.obstacles || []) {
      if (o.soft) continue;
      let hit;
      if (o.kind === 'house') hit = rayHouseDistance(o, best);
      else {
        const base = obstacleGround(o);
        hit = rayCylinderDistance(o.x, o.y, o.r, base, base + o.top, best);
      }
      if (hit < best) {
        best = hit;
        targetId = null;
        hitKind = 'obstacle';
      }
    }

    raycaster.ray.at(best, _hit);
    const launchGround = player ? terrainHeight(player.x, player.y) : 0;
    return { x: _hit.x, y: _hit.z, z: _hit.y - launchGround, targetId, hitKind };
  }

  const _v = new THREE.Vector3();
  // Sim (x, y) at height h -> HUD pixel space (HUD_W x HUD_H).
  function worldToScreen(simX, simY, h = 0) {
    _v.set(simX, h, simY).project(camera);
    return { x: (_v.x * 0.5 + 0.5) * HUD_W, y: (-_v.y * 0.5 + 0.5) * HUD_H, visible: _v.z < 1 };
  }

  // Project HUD elements from the same interpolated position used to draw the
  // wizard model. Using the raw 20 Hz simulation coordinates makes overhead
  // bars visibly step and trail behind an otherwise smooth character.
  function wizardToScreen(wizard, heightAboveFeet = 0) {
    const rig = wizards.get(wizard.id);
    if (rig?.group) {
      return worldToScreen(
        rig.group.position.x,
        rig.group.position.z,
        rig.group.position.y + heightAboveFeet,
      );
    }
    return worldToScreen(
      wizard.x,
      wizard.y,
      wizardGround(wizard) +
        (wizard.climbH || 0) +
        (wizard.flyH || 0) +
        (wizard.jumpH || 0) +
        (wizard.openingH || 0) +
        heightAboveFeet,
    );
  }

  function resize(w, h) {
    // Native Safari may keep its GPU process alive for days. A large new WebGL
    // drawable can then fail with an incomplete framebuffer and lose context
    // before the match starts. Bound the *backing* size, not the CSS size, so
    // the game remains full size and input coordinates do not change.
    const safariPixelRatio = safariCompatibilityAssets
      ? Math.min(1, (safeMode ? 640 : 960) / w, (safeMode ? 360 : 540) / h)
      : 1.25;
    const pixelRatio = Math.min(
      safariPixelRatio,
      safeMode ? 1 : 1.25,
      window.devicePixelRatio || 1,
    );
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  let sampleOverview = false;
  function render() {
    if (sampleOverview) {
      camera.position.set(STYLE_SAMPLE.x - 1600, 1800, STYLE_SAMPLE.z + 1200);
      camera.lookAt(STYLE_SAMPLE.x, 60, STYLE_SAMPLE.z);
    }
    renderer.render(scene, camera);
    glCanvas.dataset.drawCalls = String(renderer.info.render.calls);
    glCanvas.dataset.renderTriangles = String(renderer.info.render.triangles);
  }

  function dispose(releaseContext = true) {
    dirtGlowTexture.dispose();
    for (const material of dirtGlowMaterials) material.dispose();
    digMagicMat.dispose();
    digGoldMat.dispose();
    for (const flight of pickupFlights) {
      scene.remove(flight.visual);
      flight.core.material.dispose();
    }
    for (const geometry of digPreviewGeometries.values()) geometry.dispose();
    digFlowGeometry.dispose();
    digFlow.material.dispose();
    riversideWaterDetail?.dispose();
    impactRingGeometry.dispose();
    for (const ring of impactRings) ring.mesh.material.dispose();
    for (const spell of spellPool) {
      spell.userData.trace.geometry.dispose();
      spell.userData.trace.material.dispose();
    }
    renderer.dispose();
    if (releaseContext) renderer.forceContextLoss();
  }

  // Do not reveal a live countdown while the detailed GLB is still decoding.
  // If it resolves after the match begins, attaching its rig and compiling its
  // materials can block the first animation frames and make "3" appear stuck.
  async function prepareMatch(state, focusIndex = 0) {
    queuedVisualEvents = [];
    receivedVisualEvents = new WeakSet();
    impactShake = collapseShake = 0;
    impactClock = dirtBursts = 0;
    glCanvas.dataset.dirtBursts = '0';
    for (const spark of sparkPool) {
      spark.active = false;
      spark.mesh.visible = false;
    }
    pickupFlightEvents = new WeakSet();
    pickupVisualById.clear();
    pickupFlightsStarted = pickupFlightsCompleted = 0;
    for (const ripple of waterRipplePool) {
      ripple.life = 0;
      ripple.mesh.visible = false;
    }
    glCanvas.dataset.pickupFlightsStarted = '0';
    glCanvas.dataset.pickupFlightsCompleted = '0';
    glCanvas.dataset.pickupCompletedHandDistance = '';
    for (const flight of pickupFlights) {
      flight.active = false;
      flight.visual.visible = false;
    }
    // A damaged cache or interrupted local model request must never leave the
    // game on "Preparing the Island" forever. Fall back to the built-in wizard
    // after six seconds; a healthy local GLB normally resolves much sooner.
    // Wait briefly for the animated wizard in every graphics mode, including
    // Safari's safe mode. Starting the match before this resolves leaves the
    // player on the procedural fallback long enough to look like the imported
    // animations were ignored. The timeout still guarantees that a damaged or
    // unsupported model can never hold the game on the preparation screen.
    await Promise.race([
      advancedWizardPromise,
      new Promise((resolve) => window.setTimeout(resolve, 3500)),
    ]);
    // A renderer is reused between matches. Forget its previous spring-arm
    // position before drawing the new countdown; otherwise the hidden camera
    // spends the first playable frames easing out of the old match even when
    // the mouse is completely still.
    camReady = false;
    waterCamera.height = null;
    update(state, 0, focusIndex);
  }

  return {
    queueMatchEvent,
    animatePickup,
    prepareMatch,
    update,
    updateOpeningCamera,
    render,
    resize,
    setAim,
    setFov,
    setSampleOverview(enabled) {
      sampleOverview = !!enabled;
    },
    setAdsAmount,
    setDiggingMode(enabled) {
      diggingPreviewEnabled = !!enabled;
      if (!enabled) {
        digBeamFlash = 0;
        digPreview.visible = false;
        digTargetRing.visible = false;
        digBeam.visible = false;
        digBeamCore.visible = false;
        digHandGlow.visible = false;
        digFlow.visible = false;
        glCanvas.dataset.digBeamVisible = 'false';
        glCanvas.dataset.digHitboxVisible = 'false';
      }
      for (const rig of wizards.values()) {
        rig.diggingMode = !!enabled;
        setRigDigging(rig, !!enabled);
      }
    },
    setDiggingAction(active) {
      for (const rig of wizards.values()) {
        if (rig.isPlayer) {
          rig.diggingAction = !!active;
        }
      }
    },
    flashDigBeam() {
      digBeamFlash = 1;
    },
    screenToWorld,
    crosshairTarget,
    getDigAimTarget: () => latestDigAim,
    worldToScreen,
    wizardToScreen,
    groundHeight: terrainHeight, // world Y of the ground at sim (x, y)
    dispose,
  };
}
