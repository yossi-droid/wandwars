import * as THREE from 'three';

const surfaceTextures = new Map();
let reflections;

function reflectionMap() {
  if (reflections) return reflections;
  // A small shared daylight reflection map: cool sky, warm ground, and soft
  // bright windows. No downloaded HDR or extra scene-rendering pass is needed.
  const size = 64;
  const faces = [];
  for (let face = 0; face < 6; face++) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = x / (size - 1),
          v = y / (size - 1);
        const window = Math.exp(-((u - 0.32) ** 2 / 0.012 + (v - 0.38) ** 2 / 0.11));
        const fill = Math.exp(-((u - 0.82) ** 2 / 0.035 + (v - 0.3) ** 2 / 0.2));
        const sky = face === 2 ? 0.92 : face === 3 ? 0.24 : 0.63 - v * 0.32;
        const light = Math.min(1, sky + window * 0.8 + fill * 0.4);
        const i = (y * size + x) * 4;
        data[i] = Math.round(light * (face === 3 ? 214 : 237));
        data[i + 1] = Math.round(light * (face === 3 ? 204 : 244));
        data[i + 2] = Math.round(light * (face === 3 ? 177 : 255));
        data[i + 3] = 255;
      }
    const texture = new THREE.DataTexture(data, size, size);
    texture.needsUpdate = true;
    faces.push(texture);
  }
  reflections = new THREE.CubeTexture(faces);
  reflections.colorSpace = THREE.SRGBColorSpace;
  reflections.needsUpdate = true;
  return reflections;
}

function textures(kind) {
  if (surfaceTextures.has(kind)) return surfaceTextures.get(kind);
  const size = 128;
  const color = new Uint8Array(size * size * 4);
  const relief = new Uint8Array(color.length);
  const roughness = new Uint8Array(color.length);
  let seed = [...kind].reduce((value, letter) => value * 31 + letter.charCodeAt(0), 37) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const noise = random(),
        fine = random();
      const edge = Math.max(0, 1 - Math.min(x, y, size - 1 - x, size - 1 - y) / 16);
      let shade = 0.9 + noise * 0.1,
        height = noise,
        rough = 0.8 + fine * 0.2;
      let warmth = 0;
      if (kind === 'parchment') {
        shade = 0.88 + noise * 0.09 - edge * 0.13;
        height = 0.45 + (noise - 0.5) * 0.24 + Math.sin(y * 2.2) * 0.025;
        warmth = edge * 0.1;
      } else if (kind === 'cork') {
        const grain = Math.sin(x * 0.45 + Math.sin(y * 0.09) * 2.1);
        shade = 0.78 + noise * 0.12 + grain * 0.08;
        height = 0.4 + grain * 0.18 + noise * 0.15;
      } else if (kind === 'stone') {
        const fleck = noise > 0.97 ? 0.18 : noise < 0.035 ? -0.14 : 0;
        shade = 0.78 + fine * 0.18 + fleck;
        height = 0.35 + noise * 0.45;
      } else if (kind === 'leather') {
        shade = 0.8 + noise * 0.17;
        height = noise > 0.7 ? 0.65 : 0.35;
        rough = 0.7 + fine * 0.25;
      } else if (kind === 'metal') {
        const brush = Math.sin(y * 3.4) * 0.025;
        const scratch = noise > 0.99 ? -0.12 : 0;
        shade = 0.91 + brush + scratch;
        height = 0.5 + brush + scratch;
        rough = 0.58 + fine * 0.25 + Math.abs(brush);
      }
      const i = (y * size + x) * 4;
      color[i] = Math.round(Math.min(1, shade + warmth) * 255);
      color[i + 1] = Math.round(shade * 255);
      color[i + 2] = Math.round(Math.max(0, shade - warmth) * 255);
      color[i + 3] = 255;
      for (let c = 0; c < 3; c++) {
        relief[i + c] = Math.round(height * 255);
        roughness[i + c] = Math.round(rough * 255);
      }
      relief[i + 3] = roughness[i + 3] = 255;
    }
  const make = (data, srgb = false) => {
    const texture = new THREE.DataTexture(data, size, size);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  };
  const result = { map: make(color, true), bumpMap: make(relief), roughnessMap: make(roughness) };
  surfaceTextures.set(kind, result);
  return result;
}

export function makePickupMaterial(key, color) {
  const [finish] = key.includes(':') ? key.split(':') : [''];
  const metal = key === 'gold' || key === 'silver';
  const glass = finish === 'glass';
  const gem = finish === 'gem';
  const liquid = finish === 'liquid';
  const kind = metal
    ? 'metal'
    : key === 'paper' || key === 'cream'
      ? 'parchment'
      : key === 'cork'
        ? 'cork'
        : key === 'leather'
          ? 'leather'
          : key === 'stone' || key === 'dark'
            ? 'stone'
            : null;
  const options = {
    color: glass ? new THREE.Color(color).lerp(new THREE.Color(0xe8f3f4), 0.65) : color,
    roughness: glass
      ? 0.09
      : liquid
        ? 0.13
        : gem
          ? 0.18
          : metal
            ? 0.38
            : kind === 'stone'
              ? 0.91
              : 0.78,
    metalness: metal ? 0.85 : 0,
    transparent: glass,
    opacity: glass ? 0.29 : 1,
    depthWrite: !glass,
    envMap: reflectionMap(),
    envMapIntensity: metal ? 1.25 : glass || gem ? 0.85 : 0.25,
    emissive: finish === 'glow' || gem ? color : 0,
    emissiveIntensity: finish === 'glow' ? 0.17 : gem ? 0.025 : 0,
    ...(kind ? textures(kind) : {}),
    bumpScale: kind === 'stone' ? 0.022 : kind === 'metal' ? 0.002 : 0.008,
  };
  const material =
    glass || liquid || gem
      ? new THREE.MeshPhysicalMaterial({
          ...options,
          clearcoat: 1,
          clearcoatRoughness: glass ? 0.07 : 0.17,
          ior: glass ? 1.47 : 1.5,
        })
      : new THREE.MeshStandardMaterial(options);
  material.name = `pickup:${key}`;
  material.userData.surface = kind || finish || 'paint';
  return material;
}
