import { CatmullRomCurve3, Vector3 } from 'three';

export const WATER_PHYSICS = Object.freeze({
  swimSpeed: 145,
  wadeResistance: 0.42,
  floatDepth: 0.68,
  spring: 18,
  damping: 8.5,
  maxVerticalSpeed: 260,
  riverCurrent: 24,
  riverDepth: 145,
  pondDepth: 170,
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

// Shared by rendering, terrain beds, swimming and underground water sources.
// A small spatial index avoids searching the entire river during terrain builds.
export function createWaterways({ riverPath, pond, baseHeight }) {
  const curve = new CatmullRomCurve3(
    riverPath.map(([x, z]) => new Vector3(x, 0, z)),
    false,
    'centripetal',
    0.45,
  );
  const riverSamples = Array.from({ length: 151 }, (_, index) => {
    const t = index / 150;
    const p = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    return {
      x: p.x,
      z: p.z,
      level: baseHeight(p.x, p.z) + 10,
      width: 115 + 32 * Math.sin(t * Math.PI * 5.3) + 34 * t,
      nx: -tangent.z,
      nz: tangent.x,
    };
  });
  const bins = new Map();
  for (let i = 0; i < riverSamples.length - 1; i++) {
    const a = riverSamples[i],
      b = riverSamples[i + 1];
    for (
      let bx = Math.floor((Math.min(a.x, b.x) - 200) / 512);
      bx <= Math.floor((Math.max(a.x, b.x) + 200) / 512);
      bx++
    ) {
      for (
        let bz = Math.floor((Math.min(a.z, b.z) - 200) / 512);
        bz <= Math.floor((Math.max(a.z, b.z) + 200) / 512);
        bz++
      ) {
        const key = `${bx},${bz}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(i);
      }
    }
  }
  const pondLevel = baseHeight(pond.x, pond.y) + 24;
  function inlandAt(x, z) {
    const pondDistance = Math.hypot(x - pond.x, z - pond.y);
    if (pondDistance < pond.r)
      return {
        kind: 'pond',
        level: pondLevel,
        edge: pondDistance / pond.r,
        currentX: 0,
        currentZ: 0,
      };
    let nearest = null,
      best = Infinity;
    for (const i of bins.get(`${Math.floor(x / 512)},${Math.floor(z / 512)}`) || []) {
      const a = riverSamples[i],
        b = riverSamples[i + 1];
      const dx = b.x - a.x,
        dz = b.z - a.z;
      const length2 = dx * dx + dz * dz;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / length2, 0, 1);
      const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      const width = a.width + (b.width - a.width) * t;
      if (distance >= width || distance >= best) continue;
      best = distance;
      const length = Math.sqrt(length2);
      nearest = {
        kind: 'river',
        level: a.level + (b.level - a.level) * t,
        edge: distance / width,
        currentX: (dx / length) * WATER_PHYSICS.riverCurrent,
        currentZ: (dz / length) * WATER_PHYSICS.riverCurrent,
      };
    }
    return nearest;
  }
  return {
    riverSamples,
    pondLevel,
    surfaceAt(x, z) {
      return (
        inlandAt(x, z) ||
        (baseHeight(x, z) < 0 ? { kind: 'ocean', level: 0, currentX: 0, currentZ: 0 } : null)
      );
    },
    bedLowering(x, z) {
      const water = inlandAt(x, z);
      if (!water) return 0;
      const depth = water.kind === 'pond' ? WATER_PHYSICS.pondDepth : WATER_PHYSICS.riverDepth;
      return depth * smooth((1 - water.edge) / 0.65);
    },
  };
}

export function waterContact(state, wizard, waterAt, groundAt, originalAt) {
  const body = wizard.bodyHeight || 168;
  let ground = groundAt(wizard.x, wizard.y);
  const feet =
    (wizard.drillFeetY ?? ground) +
    (wizard.jumpH || 0) +
    (wizard.climbH || 0) +
    (wizard.flyH || 0) +
    (wizard.openingH || 0);
  if (wizard.drillFeetY != null && wizard.drillFeetY < ground - 20) {
    ground = state.terrain?.supportHeight(wizard.x, wizard.y, feet + 8) ?? ground;
  }
  if (wizard.flying || wizard.drill || !wizard.alive) return null;
  let water = waterAt(wizard.x, wizard.y);
  const original = originalAt(wizard.x, wizard.y);
  // Surface water cannot reach a sealed tunnel below its intact bed.
  if (
    water &&
    feet < original - 20 &&
    state.terrain?.density(wizard.x, wizard.y, original - 8) >= 0
  )
    water = null;
  const fluid = state.terrainFluids?.fluidAt(wizard.x, wizard.y, feet + body * 0.35);
  if (fluid?.kind === 'water' && fluid.amount >= 0.2)
    water = {
      kind: 'flood',
      level: fluid.level,
      currentX: 0,
      currentZ: 0,
    };
  if (!water || water.level <= ground || feet >= water.level) return null;
  const depth = water.level - ground;
  const submersion = clamp((water.level - feet) / body, 0, 1);
  return {
    ...water,
    ground,
    feet,
    depth,
    submersion,
    swimming: depth > body * 0.58 && submersion > 0.15,
  };
}

export function setWaterContact(wizard, contact) {
  wizard.inWater = !!contact;
  wizard.swimming = !!contact?.swimming;
  wizard.waterLevel = contact?.level ?? null;
  wizard.waterSubmersion = contact?.submersion || 0;
  wizard.waterMoveScale = contact?.swimming
    ? WATER_PHYSICS.swimSpeed / 220
    : 1 - (contact?.submersion || 0) * WATER_PHYSICS.wadeResistance;
}

// Critically damped buoyancy, integrated in bounded substeps so entry and rapid
// input changes stay stable at both high frame rates and slower mobile rates.
export function stepBuoyancy(wizard, contact, dt, input = {}, terrain) {
  if (!contact?.swimming) return;
  const body = wizard.bodyHeight || 168;
  const depth = input.crouch ? 1.12 : input.jumpHeld ? 0.48 : WATER_PHYSICS.floatDepth;
  const target = Math.max(contact.ground, contact.level - body * depth);
  let feet = contact.feet;
  let velocity = wizard.waterVelocity || 0;
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    velocity += ((target - feet) * WATER_PHYSICS.spring - velocity * WATER_PHYSICS.damping) * h;
    velocity = clamp(velocity, -WATER_PHYSICS.maxVerticalSpeed, WATER_PHYSICS.maxVerticalSpeed);
    const next = Math.max(contact.ground, feet + velocity * h);
    if (next > feet && terrain?.density(wizard.x, wizard.y, next + body * 0.95) >= 0) {
      velocity = 0;
      break;
    }
    feet = next;
  }
  wizard.drillFeetY = feet;
  wizard.waterVelocity = velocity;
  wizard.drillFallV = velocity;
  wizard.jumpH = wizard.jumpV = 0;
  wizard.running = wizard.runningJump = false;
}
