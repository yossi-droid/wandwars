// World-unit camera displacement, limited to nearby substantial impacts.
export function impactShakeStrength(event, player, playerHeight = 0) {
  if (!player || !Number.isFinite(event.x) || !Number.isFinite(event.y)) return 0;
  const radius = event.radius || event.range || 0;
  const power = event.impactPower || 0;
  const largeArea = ['explosion', 'nova'].includes(event.type) && radius >= 150;
  const heavyHit = ['hit', 'block', 'slashhit'].includes(event.type) && power >= 45;
  if (!largeArea && !heavyHit) return 0;
  const distance = Math.hypot(
    event.x - player.x,
    event.y - player.y,
    (event.worldZ ?? playerHeight) - playerHeight,
  );
  const reach = Math.min(1600, Math.max(750, radius * 4));
  const falloff = Math.max(0, 1 - distance / reach);
  return Math.min(8, 2 + radius / 90 + power / 40) * falloff * falloff;
}
