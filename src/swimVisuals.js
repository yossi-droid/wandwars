const damp = (a, b, speed, dt) => a + (b - a) * (1 - Math.exp(-speed * dt));

export function advanceSwimPose(state, swimming, moving, dt) {
  state.weight = damp(state.weight || 0, swimming ? 1 : 0, 10, dt);
  state.drive = damp(state.drive || 0, swimming && moving ? 1 : 0, 6, dt);
  state.phase = ((state.phase || 0) + dt * (2.8 + state.drive * 1.6)) % (Math.PI * 2);
  return state;
}

export function swimStroke(phase, side, drive) {
  const cycle = phase + (side ? Math.PI : 0);
  return {
    arm: 1.1 + Math.cos(cycle) * (0.35 + drive * 0.75),
    spread: (side ? -1 : 1) * (0.48 - drive * 0.28),
    elbow: -0.45 - 0.25 * Math.sin(cycle),
    leg: Math.sin(cycle) * (0.12 + drive * 0.24),
    knee: 0.18 + Math.max(0, -Math.sin(cycle)) * (0.18 + drive * 0.18),
  };
}

export function usesTunnelCamera(wizard, surfaceHeight) {
  return wizard.drillFeetY != null && (!wizard.inWater || wizard.drillFeetY + 100 < surfaceHeight);
}

// Smooth only the water-height transition; mouse look and collision remain responsive.
export function waterVisualHeight(state, wizard, target, dt) {
  const teleported =
    state.id !== wizard.id ||
    Math.hypot(wizard.x - (state.x ?? wizard.x), wizard.y - (state.z ?? wizard.y)) > 1200;
  if (state.height == null || teleported) {
    state.height = target;
    state.weight = 0;
  }
  state.weight = damp(state.weight || 0, wizard.inWater ? 1 : 0, 10, dt);
  state.height =
    wizard.inWater || state.weight > 0.001 ? damp(state.height, target, 9, dt) : target;
  state.id = wizard.id;
  state.x = wizard.x;
  state.z = wizard.y;
  return state.height;
}
