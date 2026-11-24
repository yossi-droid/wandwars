import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pickupVisualTemplate } from './pickupVisuals.js';

describe('item visuals without downloaded assets', () => {
  it('shows readable item silhouettes with no spheres or orbital rings', () => {
    for (const name of [
      'fairy_fizz',
      'small_protection_potion',
      'great_protection_potion',
      'golden_wizard_cake',
      'healing_leaves',
      'tier_i_attack_scroll',
      'tier_ii_attack_scroll',
      'common_rune',
      'rare_rune',
      'super_rare_rune',
      'epic_rune',
      'legendary_rune',
      'catalyst_shards',
      'cosmic_orbs',
      'calamity_cores',
      'elemental_essences',
      'burst_runes',
    ]) {
      const item = pickupVisualTemplate(name, new Map());
      const size = new THREE.Box3().setFromObject(item).getSize(new THREE.Vector3());
      expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(32, 4);
      expect(item.children.length).toBeGreaterThan(2);
      expect(item.children.length).toBeLessThanOrEqual(10);
      const triangles = item.children.reduce(
        (sum, part) => sum + part.geometry.attributes.position.count / 3,
        0,
      );
      expect(triangles).toBeLessThan(18000);
      item.traverse((part) => {
        expect(['SphereGeometry', 'IcosahedronGeometry', 'TorusGeometry']).not.toContain(
          part.geometry?.type,
        );
      });
    }
  });

  it('shares cached geometry while keeping pickup transforms independent', () => {
    const template = pickupVisualTemplate('fairy_fizz');
    expect(pickupVisualTemplate('fairy_fizz')).toBe(template);
    const first = template.clone(true);
    const second = template.clone(true);
    first.position.x = 10;
    expect(second.position.x).toBe(0);
    expect(first.children[0].geometry).toBe(second.children[0].geometry);
  });

  it('uses ornate built-ins for current items and allows future custom assets', () => {
    const detailed = new THREE.Group();
    const assets = new Map([
      ['fairy_fizz', detailed],
      ['cosmic_orbs', detailed],
      ['custom_item', detailed],
    ]);
    expect(pickupVisualTemplate('custom_item', assets)).toBe(detailed);
    expect(pickupVisualTemplate('fairy_fizz', assets)).not.toBe(detailed);
    expect(pickupVisualTemplate('cosmic_orbs', assets)).not.toBe(detailed);
  });
});
