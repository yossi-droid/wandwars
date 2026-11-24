import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pickupVisualTemplate } from './pickupVisuals.js';
import { makePickupMaterial } from './pickupMaterials.js';

describe('item visuals without downloaded assets', () => {
  it('uses shared textured surfaces and physical glass without a costly transmission pass', () => {
    const paper = makePickupMaterial('paper', 0xead6a0);
    const second = makePickupMaterial('cream', 0xffefcf);
    const glass = makePickupMaterial('glass:blue', 0x3c91e6);
    const gold = makePickupMaterial('gold', 0xd7a346);
    expect(paper.map).toBe(second.map);
    expect(paper.bumpMap).toBeTruthy();
    expect(paper.roughnessMap).toBeTruthy();
    expect(glass.isMeshPhysicalMaterial).toBe(true);
    expect(glass.transparent).toBe(true);
    expect(glass.transmission).toBe(0);
    expect(glass.envMap).toBe(gold.envMap);
    expect(gold.metalness).toBeGreaterThan(0.8);
  });
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
