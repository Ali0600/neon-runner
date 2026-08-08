// Pure game logic — no three.js, no DOM. Everything here is deterministic and
// unit-testable; Game.js owns the scene objects and calls into this.

/**
 * Small seeded PRNG (mulberry32). Pickup layouts must be reproducible so a
 * headless run and a screenshot describe the same world.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scatter pickups on the ground plane, rejecting placements closer than
 * minDist to an existing one so they never visually merge.
 */
export function placePickups(rng, count, radius, minDist) {
  const out = [];
  let guard = 0;
  while (out.length < count && guard < count * 200) {
    guard++;
    const a = rng() * Math.PI * 2;
    // sqrt keeps the distribution even across the disc instead of clustering
    // everything at the centre.
    const r = Math.sqrt(rng()) * radius;
    const p = { x: Math.cos(a) * r, z: Math.sin(a) * r };
    if (out.every((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 >= minDist * minDist)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Squared distance from point p to the segment ab, in the XZ plane.
 */
export function segmentDistanceSq(ax, az, bx, bz, px, pz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-12) return (px - ax) ** 2 + (pz - az) ** 2;
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return (px - cx) ** 2 + (pz - cz) ** 2;
}

/**
 * Indices of pickups collected by a runner moving from `prev` to `cur`.
 * Only entries with `active !== false` are eligible.
 */
export function sweptCollect(prev, cur, pickups, radius) {
  const hits = [];
  const rSq = radius * radius;
  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i];
    if (p.active === false) continue;
    // Test the whole swept segment, not just its endpoints: at sprint speed the
    // runner advances further per frame than a pickup is wide, so an endpoint
    // test passes straight through and the pickup becomes uncollectable.
    if (segmentDistanceSq(prev.x, prev.z, cur.x, cur.z, p.x, p.z) <= rSq) hits.push(i);
  }
  return hits;
}

/**
 * Advance the combo multiplier. It climbs while sprinting and decays back
 * toward 1 otherwise, both framerate-independently.
 */
export function comboStep(combo, speed, dt, cfg) {
  const { sprintSpeed, growPerSec, decayPerSec, max } = cfg;
  let next;
  if (speed >= sprintSpeed) {
    next = combo + growPerSec * dt;
  } else {
    next = 1 + (combo - 1) * Math.exp(-decayPerSec * dt);
  }
  return Math.min(max, Math.max(1, next));
}

export function scoreFor(base, combo) {
  return Math.round(base * combo);
}
