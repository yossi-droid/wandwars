import * as THREE from 'three';

// A deliberately bounded art sample. Expand this only after the area is approved.
export const STYLE_SAMPLE = Object.freeze({
  x: -2200,
  z: 3500,
  innerRadius: 1050,
  radius: 1750,
  spawn: Object.freeze({ x: -2900, z: 4000 }),
  yaw: -2.1,
});
export function styleWeight(x, z) {
  return (
    1 -
    THREE.MathUtils.smoothstep(
      Math.hypot(x - STYLE_SAMPLE.x, z - STYLE_SAMPLE.z),
      STYLE_SAMPLE.innerRadius,
      STYLE_SAMPLE.radius,
    )
  );
}
const grass = new THREE.Color(0x79ae43);
const earth = new THREE.Color(0xb89665);
const stone = new THREE.Color(0x999da2);
const bank = new THREE.Color(0xccbb87);
const local = new THREE.Color();
export function polishGround(color, x, z, height, surface, normalY = 1, riverDistance = 999) {
  const weight = styleWeight(x, z);
  if (!weight) return color;
  const variation = Math.sin(x * 0.006 + z * 0.004) * Math.cos(z * 0.008) * 0.045;
  local.copy(grass).offsetHSL(variation * 0.15, 0, variation);
  local.lerp(bank, (1 - THREE.MathUtils.smoothstep(riverDistance, 140, 360)) * 0.8);
  local.lerp(stone, (1 - THREE.MathUtils.smoothstep(normalY, 0.45, 0.84)) * 0.8);
  // The same treatment applies to remeshed caves, with exposed earth below the sod.
  local.lerp(earth, THREE.MathUtils.smoothstep(surface - height, 14, 85));
  return color.lerp(local, weight * 0.88);
}

export function buildRiversideDetails(scene, terrainHeight, waterways, obstacles, safeMode) {
  let seed = 9173;
  const rnd = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
  const group = new THREE.Group();
  group.name = 'Riverside fantasy art sample';
  const positions = [];
  for (let i = 0; i < (safeMode ? 180 : 1250); i++) {
    const angle = rnd() * Math.PI * 2,
      radius = Math.sqrt(rnd()) * STYLE_SAMPLE.radius;
    const x = STYLE_SAMPLE.x + Math.cos(angle) * radius;
    const z = STYLE_SAMPLE.z + Math.sin(angle) * radius;
    const h = terrainHeight(x, z);
    if (rnd() > styleWeight(x, z) || h < 12 || waterways.surfaceAt(x, z)) continue;
    if (
      obstacles.some(
        (o) => o.kind === 'house' && Math.hypot(x - o.x, z - o.y) < Math.hypot(o.hw, o.hd) + 90,
      )
    )
      continue;
    positions.push([x, h, z, rnd()]);
  }
  const matrix = new THREE.Matrix4(),
    dummy = new THREE.Object3D();
  const tuftGeo = new THREE.ConeGeometry(5, 20, 3);
  tuftGeo.translate(0, 9, 0);
  const grassMesh = new THREE.InstancedMesh(
    tuftGeo,
    new THREE.MeshStandardMaterial({ color: 0x79a846, roughness: 1 }),
    positions.length,
  );
  const flowers = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(3.5, 0),
    new THREE.MeshStandardMaterial({ color: 0xffe6a1, roughness: 0.9 }),
    Math.floor(positions.length / 4),
  );
  positions.forEach(([x, h, z, r], i) => {
    dummy.position.set(x, h, z);
    dummy.rotation.set(0, r * 6.28, 0.15 - r * 0.3);
    dummy.scale.setScalar(0.65 + r);
    dummy.updateMatrix();
    matrix.copy(dummy.matrix);
    grassMesh.setMatrixAt(i, matrix);
    grassMesh.setColorAt(i, new THREE.Color().setHSL(0.21 + r * 0.04, 0.48, 0.42 + r * 0.12));
    if (i < flowers.count) {
      dummy.position.y += 12 + r * 8;
      dummy.scale.setScalar(0.7 + r * 0.7);
      dummy.updateMatrix();
      flowers.setMatrixAt(i, dummy.matrix);
    }
  });
  grassMesh.receiveShadow = true;
  group.add(grassMesh, flowers);
  // Thin curved foam strokes use the same river samples as collision and swimming.
  const foamMat = new THREE.MeshBasicMaterial({
    color: 0xd6f5ed,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  let strokes = 0;
  for (let i = 1; i < waterways.riverSamples.length - 2; i += 2) {
    const a = waterways.riverSamples[i],
      b = waterways.riverSamples[i + 1];
    if (styleWeight(a.x, a.z) < 0.2) continue;
    const side = i % 4 === 1 ? -1 : 1;
    const points = [a, b].map(
      (p) =>
        new THREE.Vector3(
          p.x + p.nx * p.width * 0.72 * side,
          p.level + 1.8,
          p.z + p.nz * p.width * 0.72 * side,
        ),
    );
    const stroke = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 3, 1.8, 3, false),
      foamMat,
    );
    group.add(stroke);
    strokes++;
  }
  scene.add(group);
  return { group, grassMesh, flowers, foamMat, strokes };
}
