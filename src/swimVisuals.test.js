import { describe, it, expect } from 'vitest';
import { advanceSwimPose, swimStroke, usesTunnelCamera, waterVisualHeight } from './swimVisuals.js';

describe('swimming presentation', () => {
  it('keeps the normal camera boom at the surface and protects underground passages', () => {
    expect(usesTunnelCamera({ drillFeetY: 86, inWater: true }, 0)).toBe(false);
    expect(usesTunnelCamera({ drillFeetY: 86, inWater: true }, 400)).toBe(true);
    expect(usesTunnelCamera({ drillFeetY: 86, inWater: false }, 0)).toBe(true);
    expect(usesTunnelCamera({ drillFeetY: null, inWater: false }, 0)).toBe(false);
  });
  it('blends in, alternates both arms and legs, and blends out without resetting phase', () => {
    const pose = {};
    for (let i = 0; i < 60; i++) advanceSwimPose(pose, true, true, 1 / 60);
    expect(pose.weight).toBeGreaterThan(0.99);
    const left = swimStroke(0.4, 0, 1),
      right = swimStroke(0.4, 1, 1);
    expect(left.leg).toBeCloseTo(-right.leg);
    expect(left.arm - 1.1).toBeCloseTo(-(right.arm - 1.1));
    expect(swimStroke(0.4 + Math.PI * 2, 0, 1).arm).toBeCloseTo(left.arm, 10);
    const phase = pose.phase;
    advanceSwimPose(pose, false, false, 1 / 60);
    expect(pose.weight).toBeGreaterThan(0.8);
    expect(pose.phase).not.toBe(phase);
    for (let i = 0; i < 60; i++) advanceSwimPose(pose, false, false, 1 / 60);
    expect(pose.weight).toBeLessThan(0.001);
  });
  it('smooths water entry and exit independently of frame rate and resets on teleport', () => {
    const wizard = { id: 1, x: 0, y: 0, inWater: false };
    const fast = {},
      slow = {};
    waterVisualHeight(fast, wizard, 200, 0);
    waterVisualHeight(slow, wizard, 200, 0);
    wizard.inWater = true;
    const first = waterVisualHeight(fast, wizard, 100, 1 / 60);
    expect(first).toBeGreaterThan(180);
    for (let i = 1; i < 60; i++) waterVisualHeight(fast, wizard, 100, 1 / 60);
    for (let i = 0; i < 20; i++) waterVisualHeight(slow, wizard, 100, 1 / 20);
    expect(fast.height).toBeCloseTo(slow.height, 8);
    wizard.inWater = false;
    expect(waterVisualHeight(fast, wizard, 200, 1 / 60)).toBeLessThan(120);
    wizard.x = 3000;
    expect(waterVisualHeight(fast, wizard, 500, 1 / 60)).toBe(500);
  });
});
