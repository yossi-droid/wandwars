import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makePickupMaterial } from './pickupMaterials.js';

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
  cream: 0xffefcf,
  leather: 0x69452d,
  ink: 0x725453,
  dark: 0x202733,
};

function material(key) {
  const tint = key.includes(':') ? key.split(':')[1] : key;
  const color = colors[tint] || colors.violet;
  if (!materials.has(key)) materials.set(key, makePickupMaterial(key, color));
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
    return mesh(
      new RoundedBoxGeometry(...size, 2, Math.min(...size) * 0.18),
      color,
      position,
      rotation,
    );
  }
  function cylinder(color, radius, height, position, rotation) {
    return mesh(new THREE.CylinderGeometry(radius, radius, height, 20), color, position, rotation);
  }
  function shard(color, x, height, tilt = 0, z = 0) {
    const object = mesh(new THREE.OctahedronGeometry(1, 0), color, [x, height * 0.4, z]);
    object.scale.set(0.22, height * 0.7, 0.19);
    object.rotation.z = tilt;
  }
  function badge(color, position, scale = 1, star = false) {
    const shape = new THREE.Shape();
    if (star) {
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 + Math.PI / 2;
        const r = i % 2 ? 0.1 : 0.23;
        const p = [Math.cos(a) * r, Math.sin(a) * r];
        if (!i) shape.moveTo(...p);
        else shape.lineTo(...p);
      }
    } else {
      shape.moveTo(-0.2, 0.22);
      shape.lineTo(0.2, 0.22);
      shape.lineTo(0.17, -0.08);
      shape.lineTo(0, -0.25);
      shape.lineTo(-0.17, -0.08);
    }
    shape.closePath();
    const object = mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.035,
        bevelEnabled: true,
        bevelSize: 0.012,
        bevelThickness: 0.012,
        bevelSegments: 2,
        steps: 1,
      }),
      color,
      position,
    );
    object.scale.setScalar(scale);
    return object;
  }
  function stud(color, position, size = 0.055) {
    const object = mesh(new THREE.OctahedronGeometry(1, 0), color, position);
    object.scale.set(size, size, size * 0.6);
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
        28,
      ),
      `glass:${color}`,
      [0, 0, 0],
    );
    cylinder(`liquid:${color}`, 0.365, 0.61, [0, -0.3, 0]);
    cylinder(`liquid:${color}`, 0.365, 0.035, [0, 0.015, 0]);
    cylinder('cork', 0.15, 0.22, [0, 0.76, 0]);
    cylinder('leather', 0.153, 0.028, [0, 0.76, 0]);
    cylinder('cork', 0.135, 0.025, [0, 0.88, 0]);
    cylinder('gold', 0.19, 0.09, [0, 0.48, 0]);
    cylinder('gold', 0.425, 0.07, [0, -0.6, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      stud('gold', [Math.sin(a) * 0.425, -0.57, Math.cos(a) * 0.425], 0.035);
    }
    box('leather', [0.1, 0.75, 0.04], [-0.3, -0.13, 0.31]);
    box('leather', [0.1, 0.75, 0.04], [0.3, -0.13, 0.31]);
    box('paper', [0.4, 0.36, 0.035], [0, -0.12, 0.435]);
    badge('gold', [0, -0.1, 0.46], 0.7, name === 'fairy_fizz');
    box(`glow:${color}`, [0.035, 0.16, 0.045], [0, -0.08, 0.5]);
    if (name === 'great_protection_potion') {
      for (const x of [-0.44, 0.44]) box('gold', [0.07, 0.5, 0.35], [x, -0.1, 0]);
      badge('silver', [0, -0.1, 0.51], 0.4);
    }
  } else if (name.includes('scroll')) {
    const ribbon = name === 'tier_ii_attack_scroll' ? 'blue' : 'red';
    box('paper', [1.1, 0.98, 0.12], [0, 0, 0]);
    for (const y of [-0.52, 0.52]) cylinder('paper', 0.16, 1.35, [0, y, 0], [0, 0, Math.PI / 2]);
    for (const y of [-0.52, 0.52]) {
      for (const x of [-0.7, 0.7]) cylinder('gold', 0.18, 0.06, [x, y, 0], [0, 0, Math.PI / 2]);
      cylinder('cork', 0.075, 1.5, [0, y, 0], [0, 0, Math.PI / 2]);
      for (const x of [-0.4, -0.2, 0.2, 0.4])
        cylinder('cream', 0.165, 0.012, [x, y, 0], [0, 0, Math.PI / 2]);
    }
    box(ribbon, [0.15, 1.05, 0.035], [0, 0, 0.09]);
    for (let i = 0; i < 6; i++) {
      const y = 0.31 - i * 0.12;
      box('ink', [0.22 + (i % 3) * 0.06, 0.018, 0.012], [0.28, y, 0.075]);
      box('ink', [0.22, 0.018, 0.012], [-0.28, y, 0.075]);
    }
    const seal = cylinder(ribbon, 0.16, 0.06, [0, -0.1, 0.15], [Math.PI / 2, 0, 0]);
    seal.rotation.z = 0.15;
    badge('gold', [0, -0.1, 0.19], 0.45, true);
    for (const x of [-0.075, 0.075])
      box(ribbon, [0.08, 0.29, 0.025], [x, -0.36, 0.135], [0, 0, x * 2]);
  } else if (name === 'golden_wizard_cake') {
    cylinder('paper', 0.69, 0.1, [0, -0.5, 0]);
    cylinder('orange', 0.6, 0.58, [0, -0.16, 0]);
    cylinder('paper', 0.605, 0.065, [0, -0.2, 0]);
    cylinder('paper', 0.62, 0.13, [0, 0.2, 0]);
    mesh(new THREE.ConeGeometry(0.22, 0.6, 12), 'blue', [0, 0.56, 0]);
    cylinder('blue', 0.29, 0.035, [0, 0.28, 0]);
    cylinder('gold', 0.17, 0.06, [0, 0.4, 0]);
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      const drip = cylinder('cream', 0.055, 0.13 + (i % 3) * 0.045, [
        Math.cos(a) * 0.58,
        0.08,
        Math.sin(a) * 0.58,
      ]);
      drip.rotation.z = Math.cos(a) * 0.15;
      stud('gold', [Math.cos(a) * 0.42, 0.29, Math.sin(a) * 0.42], 0.035);
    }
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
      box(
        'cream',
        [0.013, 0.35, 0.018],
        [leaf.position.x, leaf.position.y, 0.07],
        [0, 0, leaf.rotation.z],
      );
      for (let j = 0; j < 3; j++)
        box(
          'green',
          [0.12, 0.018, 0.025],
          [leaf.position.x, leaf.position.y + (j - 1) * 0.09, 0.075],
          [0, 0, leaf.rotation.z + 0.6],
        );
    }
    box('gold', [0.22, 0.13, 0.15], [0, -0.46, 0]);
    for (const y of [-0.4, -0.48, -0.56]) cylinder('leather', 0.1, 0.035, [0, y, 0]);
    badge('paper', [0.12, -0.45, 0.11], 0.35);
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
    box('dark', [0.62, 0.89, 0.045], [0, 0, 0.13]);
    for (const side of [-1, 1]) box(color, [0.055, 1.12, 0.04], [side * 0.38, 0, 0.13]);
    for (const y of [-0.51, 0.51]) box(color, [0.75, 0.045, 0.04], [0, y, 0.13]);
    box(`glow:${color}`, [0.065, 0.65, 0.05], [0, 0, 0.165]);
    box(`glow:${color}`, [0.4, 0.065, 0.05], [0, 0.2, 0.165], [0, 0, -0.45]);
    box(`glow:${color}`, [0.35, 0.065, 0.05], [0.12, -0.18, 0.165], [0, 0, 0.65]);
    for (const x of [-0.31, 0.31]) for (const y of [-0.43, 0.43]) stud(color, [x, y, 0.17], 0.052);
    for (const x of [-0.25, 0.25]) {
      box('ink', [0.016, 0.15, 0.01], [x, -0.27, 0.16], [0, 0, x * 2]);
      box('ink', [0.08, 0.014, 0.01], [x + 0.02, -0.2, 0.16], [0, 0, -0.6]);
    }
    if (name === 'epic_rune' || name === 'legendary_rune') {
      for (const side of [-1, 1]) badge(color, [side * 0.34, 0.22, 0.14], 0.26);
      stud(`gem:${color}`, [0, -0.35, 0.18], 0.1);
    }
    if (name === 'legendary_rune') {
      for (let i = 0; i < 5; i++) {
        mesh(new THREE.ConeGeometry(0.055, 0.15, 4), 'gold', [(i - 2) * 0.13, 0.6, 0]);
      }
    }
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
    if (name === 'burst_runes') {
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 0.42;
        box('stone', [0.32, 0.7, 0.14], [x, i % 2 ? 0.15 : 0, 0], [0, 0, (i - 1) * -0.15]);
        box('glow:gold', [0.055, 0.37, 0.035], [x, i % 2 ? 0.15 : 0, 0.09]);
        badge('gold', [x, i % 2 ? 0.3 : 0.15, 0.1], 0.25, true);
        box('leather', [0.32, 0.1, 0.16], [x, -0.16, 0]);
      }
    } else if (name === 'cosmic_orbs') {
      // A small star relic rather than a sphere surrounded by an orbit.
      badge('gold', [0, 0.2, 0], 2.7, true);
      badge('gem:blue', [0, 0.2, 0.13], 1.9, true);
      stud('gem:violet', [0, 0.2, 0.23], 0.18);
      box('dark', [0.8, 0.15, 0.35], [0, -0.5, 0]);
      for (const x of [-0.3, 0.3]) box('gold', [0.09, 0.3, 0.17], [x, -0.38, 0]);
    } else if (name === 'elemental_essences') {
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 0.35;
        const tint = ['red', 'blue', 'green'][i];
        cylinder(`glass:${tint}`, 0.13, 0.75, [x, 0.2, 0]);
        cylinder(tint, 0.105, 0.5, [x, 0.12, 0]);
        cylinder('cork', 0.11, 0.14, [x, 0.65, 0]);
        box('gold', [0.29, 0.07, 0.29], [x, -0.1, 0]);
        stud(tint, [x, 0.16, 0.14], 0.06);
      }
      box('leather', [1.1, 0.2, 0.38], [0, -0.05, 0]);
      box('gold', [0.18, 0.15, 0.06], [0, -0.05, 0.22]);
    } else {
      const base = name === 'calamity_cores' ? 'dark' : 'stone';
      const rock = mesh(new THREE.DodecahedronGeometry(0.45, 0), base, [0, -0.12, 0]);
      rock.scale.set(1.2, 0.65, 0.8);
      shard(`gem:${color}`, 0, 1.15);
      shard(`gem:${color}`, -0.32, 0.8, 0.35);
      shard(`gem:${color}`, 0.32, 0.67, -0.4);
      shard(color, 0.1, 0.6, -0.2, -0.23);
      box('gold', [0.95, 0.1, 0.35], [0, 0.05, 0]);
      for (const x of [-0.35, 0, 0.35]) stud('gold', [x, 0.05, 0.2], 0.04);
      for (let i = 0; i < 4; i++)
        box(
          `glow:${color}`,
          [0.16, 0.018, 0.03],
          [-0.3 + i * 0.2, -0.15, 0.34],
          [0, 0, i % 2 ? 0.4 : -0.4],
        );
    }
  }
  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  for (const child of group.children) child.position.sub(center);
  // Merge detail pieces by material once. Pickup clones share the result, so
  // ornate geometry does not turn into dozens of draw calls per item.
  const batches = new Map();
  for (const child of [...group.children]) {
    child.updateMatrix();
    let geometry = child.geometry.clone().applyMatrix4(child.matrix);
    if (geometry.index) {
      const nonIndexed = geometry.toNonIndexed();
      geometry.dispose();
      geometry = nonIndexed;
    }
    if (!batches.has(child.material)) batches.set(child.material, []);
    batches.get(child.material).push(geometry);
    child.geometry.dispose();
    group.remove(child);
  }
  for (const [mat, geometries] of batches) {
    const merged = new THREE.Mesh(mergeGeometries(geometries), mat);
    merged.castShadow = true;
    group.add(merged);
    for (const geometry of geometries) geometry.dispose();
  }
  const finishedBounds = new THREE.Box3().setFromObject(group);
  const finishedCenter = finishedBounds.getCenter(new THREE.Vector3());
  const size = finishedBounds.getSize(new THREE.Vector3());
  for (const child of group.children)
    child.geometry.translate(-finishedCenter.x, -finishedCenter.y, -finishedCenter.z);
  group.scale.setScalar(32 / Math.max(size.x, size.y, size.z));
  group.name = `built-in-item:${name}`;
  return group;
}

export function pickupVisualTemplate(name, loadedModels) {
  if (!usesBuiltinPickupVisual(name) && loadedModels?.has(name)) return loadedModels.get(name);
  if (!templates.has(name)) templates.set(name, build(name || 'common_rune'));
  return templates.get(name);
}

export function usesBuiltinPickupVisual(name) {
  return [
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
  ].includes(name);
}
