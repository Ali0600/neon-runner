// Building layout, and the geometric queries the runner asks of it.
//
// Pure: no three, no DOM. scene.js draws what this describes and runner.js
// collides against it, so the architecture the eye sees and the architecture the
// physics sees are the same array rather than two descriptions kept in sync by
// hand. Importing runner.js here would drag in three and every .glsl, and a
// "pure" module that cannot be loaded by plain node is not pure.
//
// A building is an axis-aligned box: centre (x, z), half-extents hw/hd, height h
// standing on the ground plane. Boxes rather than arbitrary shapes because every
// query below then closes in a few lines, and a wall-run wants flat faces.

import { mulberry32, pickupLayout, autopilotPath } from './game/logic.js';

// Seeded, unlike the pylons this replaces — those used bare Math.random(), so
// the skyline differed on every load and no two headless frame hashes were
// comparable. The whole verification story here depends on a reproducible world.
export const CITY_SEED = 20260810;

export const CITY_CONFIG = {
  // Climbable towers, inside the play field. Few and well spaced: this is the
  // stage the particle effect is shown on, and the wall-run needs a target
  // rather than a maze.
  // Wide enough to be a climbing surface rather than a pole: a narrow face puts
  // the runner's shoulders past the edge and the wall-run drops off sideways.
  near: { count: 8, rMin: 30, rMax: 92, hwMin: 4, hwMax: 7.5, hMin: 18, hMax: 45 },
  // Skyline. Wider and taller, purely for parallax and bloom, though nothing
  // stops you running out and climbing one.
  far: { count: 62, rMin: 104, rMax: 195, hwMin: 4, hwMax: 11, hMin: 10, hMax: 60 },
  gap: 6, // clear space between neighbouring buildings
  pickupClearance: 9, // a ring inside a wall is uncollectable
  pathClearance: 12, // the autopilot never steers, so its lane must stay open
};

/**
 * Lay out the city. Deterministic for a given seed.
 *
 * @returns {{x:number,z:number,hw:number,hd:number,h:number}[]}
 */
export function buildCity(cfg = CITY_CONFIG, seed = CITY_SEED) {
  const rng = mulberry32(seed);
  const out = [];

  const keepOut = [
    ...pickupLayout().map((p) => ({ x: p.x, z: p.z, r: cfg.pickupClearance })),
    ...autopilotPath(64).map((p) => ({ x: p.x, z: p.z, r: cfg.pathClearance })),
  ];

  for (const band of [cfg.near, cfg.far]) {
    let placed = 0;
    let guard = 0;
    while (placed < band.count && guard < band.count * 400) {
      guard++;
      // Every iteration draws the same five values whether or not the candidate
      // survives, so the stream stays aligned and the layout is reproducible.
      const a = rng() * Math.PI * 2;
      // sqrt over the annulus keeps density even instead of crowding the inner
      // edge — the same correction placePickups makes over a disc.
      const r = Math.sqrt(band.rMin ** 2 + rng() * (band.rMax ** 2 - band.rMin ** 2));
      const hw = band.hwMin + rng() * (band.hwMax - band.hwMin);
      const hd = band.hwMin + rng() * (band.hwMax - band.hwMin);
      const h = band.hMin + rng() * (band.hMax - band.hMin);

      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Compare against the circumscribing radius rather than the footprint:
      // cheap, and it errs toward more clearance, never less.
      const reach = Math.hypot(hw, hd);

      if (keepOut.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + reach)) continue;
      if (
        out.some(
          (b) => Math.hypot(b.x - x, b.z - z) < Math.hypot(b.hw, b.hd) + reach + cfg.gap
        )
      ) {
        continue;
      }

      out.push({ x, z, hw, hd, h });
      placed++;
    }
  }

  return out;
}

/**
 * Height of the surface under (x, z) — a roof if one covers the point, else the
 * ground plane. The tallest wins, so overlapping footprints would still resolve,
 * though buildCity does not produce any.
 */
export function groundHeightAt(city, x, z) {
  let top = 0;
  for (let i = 0; i < city.length; i++) {
    const b = city[i];
    if (
      x >= b.x - b.hw &&
      x <= b.x + b.hw &&
      z >= b.z - b.hd &&
      z <= b.z + b.hd &&
      b.h > top
    ) {
      top = b.h;
    }
  }
  return top;
}

/**
 * The closest climbable wall face within `reach` of (x, z), or null.
 *
 * @returns {{index:number, nx:number, nz:number, dist:number, top:number}|null}
 *          nx/nz is the OUTWARD normal, snapped to an axis; top is the roofline.
 */
export function nearestFace(city, x, z, y, reach) {
  let best = null;
  for (let i = 0; i < city.length; i++) {
    const b = city[i];
    // Above the roofline the building is a floor, not a face. Without this a
    // runner standing on a roof is permanently "against a wall" and re-mounts
    // the building it just finished climbing.
    if (y >= b.h) continue;

    const dx = x - b.x;
    const dz = z - b.z;
    const cx = dx < -b.hw ? -b.hw : dx > b.hw ? b.hw : dx;
    const cz = dz < -b.hd ? -b.hd : dz > b.hd ? b.hd : dz;
    const ox = dx - cx;
    const oz = dz - cz;
    const dist = Math.sqrt(ox * ox + oz * oz);

    if (dist > reach) continue;
    if (best && dist >= best.dist) continue;

    // Snap the normal to one face rather than using the true closest-point
    // direction. At a corner that direction is diagonal, and a runner told to
    // hug a diagonal slides off the flat surface it is meant to be climbing.
    let nx = 0;
    let nz = 0;
    if (dist > 1e-9) {
      if (Math.abs(ox) >= Math.abs(oz)) nx = ox >= 0 ? 1 : -1;
      else nz = oz >= 0 ? 1 : -1;
    } else {
      // Inside the footprint: leave by whichever face is closest.
      if (b.hw - Math.abs(dx) <= b.hd - Math.abs(dz)) nx = dx >= 0 ? 1 : -1;
      else nz = dz >= 0 ? 1 : -1;
    }

    best = { index: i, nx, nz, dist, top: b.h };
  }
  return best;
}

/**
 * How far along the segment A -> B the camera may travel before a building gets
 * in the way, as a fraction in [0, 1]. 1 means the view is clear.
 *
 * A follow camera must NOT be resolved by pushing it out of the wall it entered:
 * the nearest face is often the far one, so the camera pops through to the other
 * side of the building and watches a blank wall with the runner behind it.
 * Pulling IN along the sightline keeps it on the runner's side by construction.
 *
 * Segment-vs-slab against each box, grown by `radius` so the near plane never
 * ends up inside a surface.
 */
export function viewClearance(city, ax, ay, az, bx, by, bz, radius) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  let best = 1;

  for (let i = 0; i < city.length; i++) {
    const b = city[i];
    const lo = [b.x - b.hw - radius, -radius, b.z - b.hd - radius];
    const hi = [b.x + b.hw + radius, b.h + radius, b.z + b.hd + radius];
    const o = [ax, ay, az];
    const d = [dx, dy, dz];

    // If the anchor is already inside this box's padded volume, the box cannot
    // meaningfully occlude the view of it — and the slab test would return
    // tMin = 0 and collapse the camera onto the runner. That is not a corner
    // case: the runner stands BODY_RADIUS from a face and climbs at that
    // distance, which is inside a box grown by the larger camera radius, so it
    // happens for the whole of every wall-run.
    if (
      o[0] >= lo[0] && o[0] <= hi[0] &&
      o[1] >= lo[1] && o[1] <= hi[1] &&
      o[2] >= lo[2] && o[2] <= hi[2]
    ) {
      continue;
    }

    let tMin = 0;
    let tMax = best;
    let miss = false;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) {
        // Parallel to this slab: only a hit if the origin already lies inside it.
        if (o[k] < lo[k] || o[k] > hi[k]) {
          miss = true;
          break;
        }
        continue;
      }
      const inv = 1 / d[k];
      let t1 = (lo[k] - o[k]) * inv;
      let t2 = (hi[k] - o[k]) * inv;
      if (t1 > t2) {
        const s = t1;
        t1 = t2;
        t2 = s;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) {
        miss = true;
        break;
      }
    }
    if (!miss && tMin < best) best = tMin;
  }

  return best;
}

/**
 * Push (x, z) out of any building it has entered, treating the runner as a
 * circle of `radius`. Only the penetrating component moves, so contact slides
 * along a wall instead of stopping dead against it.
 *
 * Buildings below `y` do not block: that is what lets a runner walk around on a
 * roof, and what stops the building it is standing on from ejecting it.
 *
 * Not swept. At sprint (17 u/s) the runner advances 0.28 units per frame and the
 * narrowest building is 6 wide, so tunnelling needs a ~20x speed increase.
 */
export function slideXZ(city, x, z, y, radius) {
  let outX = x;
  let outZ = z;

  for (let i = 0; i < city.length; i++) {
    const b = city[i];
    if (y >= b.h) continue;

    const dx = outX - b.x;
    const dz = outZ - b.z;
    const cx = dx < -b.hw ? -b.hw : dx > b.hw ? b.hw : dx;
    const cz = dz < -b.hd ? -b.hd : dz > b.hd ? b.hd : dz;
    const ox = dx - cx;
    const oz = dz - cz;
    const d2 = ox * ox + oz * oz;

    if (d2 >= radius * radius) continue;

    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      outX = b.x + cx + (ox / d) * radius;
      outZ = b.z + cz + (oz / d) * radius;
    } else {
      // Centre is inside the footprint — leave by the cheapest face.
      if (b.hw - Math.abs(dx) <= b.hd - Math.abs(dz)) {
        outX = b.x + (dx >= 0 ? b.hw + radius : -b.hw - radius);
      } else {
        outZ = b.z + (dz >= 0 ? b.hd + radius : -b.hd - radius);
      }
    }
  }

  return { x: outX, z: outZ };
}
