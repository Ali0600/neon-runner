import { describe, it, expect } from 'vitest';
import {
  buildCity,
  groundHeightAt,
  nearestFace,
  slideXZ,
  viewClearance,
  CITY_CONFIG,
} from '../src/city.js';
import { pickupLayout, autopilotPath } from '../src/game/logic.js';

// One box at the origin, 4 wide (hw 2), 6 deep (hd 3), 10 tall.
const BOX = [{ x: 0, z: 0, hw: 2, hd: 3, h: 10 }];

/** Distance from a point to a footprint, 0 if inside. */
function toFootprint(b, x, z) {
  const dx = Math.max(0, Math.abs(x - b.x) - b.hw);
  const dz = Math.max(0, Math.abs(z - b.z) - b.hd);
  return Math.hypot(dx, dz);
}

describe('buildCity', () => {
  const city = buildCity();

  it('is deterministic for a seed', () => {
    // The frame-hash harness compares renders across runs; a world that differs
    // per load makes every one of those comparisons meaningless. The pylons this
    // replaces used bare Math.random() and had exactly that problem.
    expect(buildCity()).toEqual(city);
  });

  it('places a different world for a different seed', () => {
    // Guards the guard: if the seed were ignored, the determinism test above
    // would pass while testing nothing.
    expect(buildCity(CITY_CONFIG, 99)).not.toEqual(city);
  });

  it('places every building both bands asked for', () => {
    // Rejection sampling can silently come up short when the keep-out zones
    // crowd a band, and a short city is not an error — it just quietly has
    // fewer towers to climb.
    const near = city.filter((b) => Math.hypot(b.x, b.z) < 100);
    const far = city.filter((b) => Math.hypot(b.x, b.z) >= 100);
    expect(near).toHaveLength(CITY_CONFIG.near.count);
    expect(far).toHaveLength(CITY_CONFIG.far.count);
  });

  it('leaves every pickup reachable', () => {
    // A ring inside a wall can never be collected, and nothing would report it.
    for (const p of pickupLayout()) {
      for (const b of city) {
        expect(toFootprint(b, p.x, p.z)).toBeGreaterThan(CITY_CONFIG.pickupClearance);
      }
    }
  });

  it('leaves the autopilot lane clear', () => {
    // The autopilot never steers, so a building on its path is not an obstacle
    // it drives around — it is a permanent collision, and the autopilot is the
    // workhorse every headless verification runs on.
    for (const p of autopilotPath(256)) {
      for (const b of city) {
        expect(toFootprint(b, p.x, p.z)).toBeGreaterThan(CITY_CONFIG.pathClearance);
      }
    }
  });

  it('never overlaps two buildings', () => {
    for (let i = 0; i < city.length; i++) {
      for (let j = i + 1; j < city.length; j++) {
        const a = city[i];
        const b = city[j];
        const gapX = Math.abs(a.x - b.x) - a.hw - b.hw;
        const gapZ = Math.abs(a.z - b.z) - a.hd - b.hd;
        expect(Math.max(gapX, gapZ)).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every building inside the ground plane', () => {
    // The ground is 400x400 and the runner is clamped to +-180. A building
    // hanging off the edge floats over nothing.
    for (const b of city) {
      expect(Math.abs(b.x) + b.hw).toBeLessThan(200);
      expect(Math.abs(b.z) + b.hd).toBeLessThan(200);
    }
  });
});

describe('groundHeightAt', () => {
  it('returns the roof inside the footprint', () => {
    expect(groundHeightAt(BOX, 0, 0)).toBe(10);
    expect(groundHeightAt(BOX, 1.9, 2.9)).toBe(10);
  });

  it('returns ground level outside it', () => {
    expect(groundHeightAt(BOX, 2.1, 0)).toBe(0);
    expect(groundHeightAt(BOX, 0, 3.1)).toBe(0);
    expect(groundHeightAt(BOX, 50, 50)).toBe(0);
  });

  it('counts the boundary as inside', () => {
    // The crest lands the runner exactly on the lip. An exclusive test there
    // drops them straight back off the building they just climbed.
    expect(groundHeightAt(BOX, 2, 3)).toBe(10);
    expect(groundHeightAt(BOX, -2, -3)).toBe(10);
  });

  it('takes the tallest of overlapping footprints', () => {
    const stacked = [...BOX, { x: 0, z: 0, hw: 5, hd: 5, h: 25 }];
    expect(groundHeightAt(stacked, 0, 0)).toBe(25);
  });

  it('is empty-safe', () => {
    expect(groundHeightAt([], 0, 0)).toBe(0);
  });
});

describe('nearestFace', () => {
  it('returns an axis-aligned outward normal on each face', () => {
    expect(nearestFace(BOX, 3, 0, 0, 2)).toMatchObject({ nx: 1, nz: 0 });
    expect(nearestFace(BOX, -3, 0, 0, 2)).toMatchObject({ nx: -1, nz: 0 });
    expect(nearestFace(BOX, 0, 4, 0, 2)).toMatchObject({ nx: 0, nz: 1 });
    expect(nearestFace(BOX, 0, -4, 0, 2)).toMatchObject({ nx: 0, nz: -1 });
  });

  it('reports the true distance to the face', () => {
    expect(nearestFace(BOX, 3, 0, 0, 2).dist).toBeCloseTo(1);
    expect(nearestFace(BOX, 0, 4.5, 0, 2).dist).toBeCloseTo(1.5);
  });

  it('returns null beyond reach', () => {
    expect(nearestFace(BOX, 5, 0, 0, 2)).toBeNull();
  });

  it('returns null at or above the roofline', () => {
    // A runner standing on a roof is inside the footprint and therefore always
    // "touching" the building. Without this gate they re-mount the wall they
    // just finished climbing, forever.
    expect(nearestFace(BOX, 3, 0, 9.99, 2)).not.toBeNull();
    expect(nearestFace(BOX, 3, 0, 10, 2)).toBeNull();
    expect(nearestFace(BOX, 0, 0, 10, 2)).toBeNull();
  });

  it('snaps a corner approach to one flat face', () => {
    // The true closest-point normal at a corner is diagonal; hugging a diagonal
    // walks the runner off the flat surface it is supposed to be climbing.
    const f = nearestFace(BOX, 3, 4, 0, 3);
    expect(Math.abs(f.nx) + Math.abs(f.nz)).toBe(1);
  });

  it('picks the nearer of two buildings', () => {
    const two = [...BOX, { x: 20, z: 0, hw: 2, hd: 2, h: 8 }];
    expect(nearestFace(two, 17, 0, 0, 3).index).toBe(1);
    expect(nearestFace(two, 3, 0, 0, 3).index).toBe(0);
  });

  it('carries the roofline so a climb knows where to stop', () => {
    expect(nearestFace(BOX, 3, 0, 0, 2).top).toBe(10);
  });
});

describe('viewClearance', () => {
  it('reports a clear line as fully clear', () => {
    expect(viewClearance(BOX, 0, 2, -10, 0, 2, -20, 0.5)).toBe(1);
  });

  it('stops the camera in front of a wall, not behind it', () => {
    // The bug this guards is the reason a push-out is the wrong primitive here:
    // resolving by nearest face sends the camera through to the far side of the
    // building, where it watches a blank wall with the runner hidden behind it.
    // A pull-in fraction must leave the camera between the runner and the box.
    const t = viewClearance(BOX, 0, 5, -10, 0, 5, 10, 0.5);
    const z = -10 + t * 20;
    expect(z).toBeLessThan(-3); // outside the near face (hd 3) plus radius
    expect(t).toBeGreaterThan(0);
  });

  it('grows the box by the radius', () => {
    // Tight against the face is still a clip: the near plane has thickness.
    const tight = viewClearance(BOX, 0, 5, -10, 0, 5, 10, 0.001);
    const padded = viewClearance(BOX, 0, 5, -10, 0, 5, 10, 2);
    expect(padded).toBeLessThan(tight);
  });

  it('ignores a building the sightline passes over', () => {
    // BOX is 10 tall; a line at y = 14 clears it and must not pull the camera in.
    expect(viewClearance(BOX, 0, 14, -10, 0, 14, 10, 0.5)).toBe(1);
  });

  it('blocks a sightline that dips below the roofline', () => {
    expect(viewClearance(BOX, 0, 14, -10, 0, 2, 10, 0.5)).toBeLessThan(1);
  });

  it('takes the nearest blocker of several', () => {
    const two = [
      { x: 0, z: 0, hw: 2, hd: 2, h: 10 },
      { x: 0, z: 20, hw: 2, hd: 2, h: 10 },
    ];
    const near = viewClearance(two, 0, 5, -10, 0, 5, 40, 0.5);
    const far = viewClearance([two[1]], 0, 5, -10, 0, 5, 40, 0.5);
    expect(near).toBeLessThan(far);
  });

  it('is empty-safe', () => {
    expect(viewClearance([], 0, 1, 0, 0, 1, 10, 0.5)).toBe(1);
  });

  it('ignores the building the anchor is pressed against', () => {
    // A runner stands, and climbs, at BODY_RADIUS from a face — closer than the
    // camera radius the box is padded by. Treating that padding as an
    // obstruction puts the ray origin inside the box, returns 0, and collapses
    // the camera onto the runner for the whole of every wall-run.
    // BOX spans z = -3..3; anchor at 3.2 is outside it but inside a 0.6 pad.
    expect(viewClearance(BOX, 0, 5, 3.2, 0, 5, 14, 0.6)).toBe(1);
  });

  it('still blocks a building the anchor is merely near', () => {
    // The other half: skipping must apply only to the box actually touched, not
    // to a second building further along the same sightline.
    const two = [
      { x: 0, z: 0, hw: 2, hd: 3, h: 10 },
      { x: 0, z: 20, hw: 2, hd: 3, h: 10 },
    ];
    expect(viewClearance(two, 0, 5, 3.2, 0, 5, 30, 0.6)).toBeLessThan(1);
  });
});

describe('slideXZ', () => {
  it('pushes a point out of a wall it entered', () => {
    const r = slideXZ(BOX, 1, 0, 0, 0.5);
    expect(r.x).toBeCloseTo(2.5); // surface + radius
    expect(r.z).toBeCloseTo(0);
  });

  it('leaves a point outside untouched', () => {
    expect(slideXZ(BOX, 6, 6, 0, 0.5)).toEqual({ x: 6, z: 6 });
  });

  it('slides along the wall instead of stopping dead', () => {
    // Only the penetrating component may move. If both did, running into a face
    // at an angle would pin the runner in place rather than skimming along it.
    const r = slideXZ(BOX, 2.2, 1, 0, 1);
    expect(r.z).toBeCloseTo(1); // free axis untouched
    expect(r.x).toBeCloseTo(3); // pushed clear of the face
  });

  it('does not block above the roofline', () => {
    // The building you are standing on must not eject you off its own roof.
    expect(slideXZ(BOX, 0, 0, 10, 0.5)).toEqual({ x: 0, z: 0 });
    expect(slideXZ(BOX, 0, 0, 12, 0.5)).toEqual({ x: 0, z: 0 });
  });

  it('blocks below the roofline', () => {
    expect(slideXZ(BOX, 0, 0, 9.9, 0.5).x).not.toBe(0);
  });

  it('ejects a point at the exact centre rather than dividing by zero', () => {
    const r = slideXZ(BOX, 0, 0, 0, 0.5);
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.z)).toBe(true);
    // hw (2) is the cheaper escape than hd (3).
    expect(Math.abs(r.x)).toBeCloseTo(2.5);
  });

  it('keeps resolving past the first building in the list', () => {
    const two = [
      { x: 0, z: 0, hw: 2, hd: 2, h: 10 },
      { x: 20, z: 0, hw: 2, hd: 2, h: 10 },
    ];
    // A loop that returned after the first hit would leave this untouched.
    expect(slideXZ(two, 21, 0, 0, 0.5).x).toBeCloseTo(22.5);
  });

  it('clears both walls of a corridor narrow enough to touch either', () => {
    // The push out of one wall can drive the point into its neighbour, so the
    // loop must re-check rather than trust its own first correction.
    const two = [
      { x: 0, z: 0, hw: 2, hd: 2, h: 10 },
      { x: 5, z: 0, hw: 2, hd: 2, h: 10 },
    ];
    // The gap runs x = 2..3; a radius of 0.4 fits with 0.1 to spare each side.
    const r = slideXZ(two, 2.1, 0, 0, 0.4);
    for (const b of two) {
      expect(toFootprint(b, r.x, r.z)).toBeGreaterThanOrEqual(0.4 - 1e-9);
    }
  });
});
