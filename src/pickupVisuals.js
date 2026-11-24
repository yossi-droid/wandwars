import * as THREE from 'three';

const templates = new Map();
const materials = new Map();
const colors = {
  gold: 0xd7a346,
  paper: 0xead6a0,
  cork: 0x865433,
  stone: 0x354454,
  blue: 0x3c91e6,
  violet: 0x9e65df,
  green: 0x60ae4c,
  red: 0xc44b43,
  silver: 0xb9c9d4,
  orange: 0xe5a14a,
};

function material(key) {
  if (!materials.has(key))
    materials.set(
      key,
      new THREE.MeshStandardMaterial({
        color: colors[key] || colors.violet,
        roughness: 0.63,
        metalness: key === 'gold' || key === 'silver' ? 0.5 : 0.06,
      }),
    );
  return materials.get(key);
}

function build(name) {
  const group = new THREE.Group();
  function mesh(geometry, color, position, rotation) {
    const object = new THREE.Mesh(geometry, material(color));
    object.position.set(...position);
    if (rotation) object.rotation.set(...rotation);
    object.castShadow = true;
    group.add(object);
    return object;
  }
  function box(color, size, position, rotation) {
    return mesh(new THREE.BoxGeometry(...size), color, position, rotation);
  }
  function cylinder(color, radius, height, position, rotation) {
    return mesh(new THREE.CylinderGeometry(radius, radius, height, 12), color, position, rotation);
  }
  function shard(color, x, height, tilt = 0) {
    const object = mesh(new THREE.OctahedronGeometry(1, 0), color, [x, height * 0.4, 0]);
    object.scale.set(0.22, height * 0.7, 0.19);
    object.rotation.z = tilt;
  }

  if (name.includes('potion') || name === 'fairy_fizz') {
    const color = name === 'fairy_fizz' ? 'violet' : 'blue';
    // A flask with shoulders, a narrow neck, a cork and a visible front label.
    const points = [
      [0, -0.65],
      [0.32, -0.65],
      [0.43, -0.5],
      [0.43, 0.12],
      [0.2, 0.4],
      [0.16, 0.45],
      [0.16, 0.7],
      [0, 0.7],
    ];
    mesh(
      new THREE.LatheGeometry(
        points.map(([x, y]) => new THREE.Vector2(x, y)),
        16,
      ),
      color,
      [0, 0, 0],
    );
    cylinder('cork', 0.15, 0.22, [0, 0.76, 0]);
    cylinder('gold', 0.19, 0.09, [0, 0.48, 0]);
    box('paper', [0.4, 0.36, 0.035], [0, -0.12, 0.435]);
    box('gold', [0.08, 0.24, 0.045], [0, -0.12, 0.46]);
    box('gold', [0.23, 0.08, 0.045], [0, -0.12, 0.46]);
  } else if (name.includes('scroll')) {
    box('paper', [1.1, 0.98, 0.12], [0, 0, 0]);
    for (const y of [-0.52, 0.52]) cylinder('paper', 0.16, 1.35, [0, y, 0], [0, 0, Math.PI / 2]);
    box('red', [0.15, 1.05, 0.035], [0, 0, 0.09]);
    for (const y of [-0.25, 0, 0.25]) box('cork', [0.46, 0.035, 0.025], [0.22, y, 0.085]);
  } else if (name === 'golden_wizard_cake') {
    cylinder('paper', 0.69, 0.1, [0, -0.5, 0]);
    cylinder('orange', 0.6, 0.58, [0, -0.16, 0]);
    cylinder('paper', 0.62, 0.13, [0, 0.2, 0]);
    mesh(new THREE.ConeGeometry(0.22, 0.6, 12), 'blue', [0, 0.56, 0]);
  } else if (name === 'healing_leaves') {
    cylinder('cork', 0.055, 1.1, [0, -0.12, 0]);
    for (let i = 0; i < 4; i++) {
      const leaf = mesh(new THREE.OctahedronGeometry(1, 0), 'green', [
        (i % 2 ? 1 : -1) * 0.2,
        i * 0.22 - 0.2,
        0,
      ]);
      leaf.scale.set(0.25, 0.38, 0.055);
      leaf.rotation.z = i % 2 ? -0.7 : 0.7;
    }
    box('gold', [0.22, 0.13, 0.15], [0, -0.46, 0]);
  } else if (name.includes('rune') && name !== 'burst_runes') {
    const color = name.startsWith('legendary')
      ? 'gold'
      : name.startsWith('rare')
        ? 'green'
        : name.startsWith('super')
          ? 'blue'
          : name.startsWith('common')
            ? 'silver'
            : 'violet';
    box('stone', [0.82, 1.12, 0.22], [0, 0, 0]);
    for (const side of [-1, 1]) box(color, [0.055, 1.12, 0.04], [side * 0.38, 0, 0.13]);
    box(color, [0.065, 0.65, 0.05], [0, 0, 0.145]);
    box(color, [0.4, 0.065, 0.05], [0, 0.2, 0.145], [0, 0, -0.45]);
    box(color, [0.35, 0.065, 0.05], [0.12, -0.18, 0.145], [0, 0, 0.65]);
  } else {
    const color =
      name === 'calamity_cores'
        ? 'red'
        : name === 'elemental_essences'
          ? 'orange'
          : name === 'burst_runes'
            ? 'gold'
            : name === 'cosmic_orbs'
              ? 'blue'
              : 'violet';
    // Angular magic shards on a small metal binding, without planetary rings.
    shard(color, 0, 1.15);
    shard(color, -0.32, 0.8, 0.35);
    shard(color, 0.32, 0.67, -0.4);
    box('gold', [0.95, 0.15, 0.35], [0, -0.12, 0]);
  }
  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  for (const child of group.children) child.position.sub(center);
  group.scale.setScalar(32 / Math.max(size.x, size.y, size.z));
  group.name = `built-in-item:${name}`;
  return group;
}

export function pickupVisualTemplate(name, loadedModels) {
  // These old mana assets have orbital rings even after loading successfully.
  const ringedMana = ['cosmic_orbs', 'calamity_cores', 'elemental_essences', 'burst_runes'];
  if (!ringedMana.includes(name) && loadedModels?.has(name)) return loadedModels.get(name);
  if (!templates.has(name)) templates.set(name, build(name || 'common_rune'));
  return templates.get(name);
}
