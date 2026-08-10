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

// Where the pickups are. These live here rather than in Game.js because the
// city layout has to avoid them, and a second copy of the seed and counts would
// drift the moment either side was retuned — the buildings would then be placed
// against a ring field that no longer exists.
export const PICKUP_SEED = 20260808;
export const PICKUP_COUNT = 22;
export const PICKUP_FIELD_RADIUS = 95;
export const PICKUP_MIN_SEPARATION = 11;

// The autopilot flies a Lissajous figure-8; seeding a few pickups onto it means
// the demo collects things without the autopilot ever steering. Steering toward
// mutable game state would make every headless verification depend on game
// tuning, and the autopilot is the verification workhorse.
export const AUTOPILOT_TS = [0.6, 1.9, 3.3, 4.7, 6.1, 7.4];

export function autopilotPoint(t) {
  return { x: Math.sin(t) * 34, z: Math.sin(t * 2) * 20 };
}

/** Every pickup position, on-path ones first. Deterministic. */
export function pickupLayout() {
  const rng = mulberry32(PICKUP_SEED);
  const scattered = placePickups(
    rng,
    PICKUP_COUNT,
    PICKUP_FIELD_RADIUS,
    PICKUP_MIN_SEPARATION
  );
  return [...AUTOPILOT_TS.map(autopilotPoint), ...scattered];
}

/**
 * The autopilot's whole closed path, sampled evenly. Anything placed in the
 * world has to stay clear of this, not merely of the pickups sitting on it —
 * the autopilot never steers, so a building in its way is a permanent collision.
 */
export function autopilotPath(samples = 64) {
  const out = [];
  for (let i = 0; i < samples; i++) {
    out.push(autopilotPoint((i / samples) * Math.PI * 2));
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
 *
 * The sweep is in XZ, so `maxHeight` bounds how far above a ring the runner may
 * be and still take it. Without that bound a runner twenty units up a wall
 * collects every ring its SHADOW crosses — the sweep cannot tell the difference,
 * because it never sees y at all. Defaults to Infinity so a caller that has no
 * vertical axis behaves exactly as before.
 */
export function sweptCollect(prev, cur, pickups, radius, maxHeight = Infinity) {
  const hits = [];
  const rSq = radius * radius;
  // Height is judged at the closer of the two endpoints: a jump that passes over
  // a ring should not collect it, but a landing that ends on one should.
  const dy = Math.min(Math.abs(prev.y ?? 0), Math.abs(cur.y ?? 0));
  if (dy > maxHeight) return hits;
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
