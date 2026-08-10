import { describe, it, expect } from 'vitest';
import {
  mulberry32,
  placePickups,
  segmentDistanceSq,
  sweptCollect,
  comboStep,
  scoreFor,
} from '../src/game/logic.js';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('differs across seeds and stays in [0,1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toEqual(b());
    const rng = mulberry32(99);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('placePickups', () => {
  it('is reproducible for a fixed seed', () => {
    expect(placePickups(mulberry32(7), 12, 60, 8)).toEqual(
      placePickups(mulberry32(7), 12, 60, 8)
    );
  });

  it('respects the radius and the minimum separation', () => {
    const pts = placePickups(mulberry32(3), 16, 50, 9);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(50 + 1e-9);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)).toBeGreaterThanOrEqual(
          9 - 1e-9
        );
      }
    }
  });

  it('terminates instead of spinning when the request is unsatisfiable', () => {
    // Far more pickups than can fit at that separation — must give up, not hang.
    const pts = placePickups(mulberry32(5), 400, 10, 20);
    expect(pts.length).toBeLessThan(400);
  });
});

describe('segmentDistanceSq', () => {
  it('measures perpendicular distance to the segment interior', () => {
    expect(segmentDistanceSq(0, 0, 10, 0, 5, 3)).toBeCloseTo(9, 10);
  });

  it('clamps to the endpoints beyond the segment', () => {
    expect(segmentDistanceSq(0, 0, 10, 0, -4, 0)).toBeCloseTo(16, 10);
    expect(segmentDistanceSq(0, 0, 10, 0, 14, 0)).toBeCloseTo(16, 10);
  });

  it('handles a degenerate zero-length segment', () => {
    expect(segmentDistanceSq(2, 2, 2, 2, 5, 6)).toBeCloseTo(25, 10);
  });
});

describe('sweptCollect — vertical reach', () => {
  // A pair: the sweep is XZ-only and cannot see height at all, so without a
  // bound a runner partway up a wall collects every ring its shadow crosses.
  // Both halves matter — a bound that also blocked the ground case would make
  // the whole scoring loop unreachable.
  const pickups = () => [{ x: 5, z: 0 }];

  it('collects when the runner is at ring height', () => {
    const hits = sweptCollect({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, pickups(), 1, 2.6);
    expect(hits).toEqual([0]);
  });

  it('does NOT collect from twenty units up the wall above it', () => {
    const hits = sweptCollect({ x: 0, y: 20, z: 0 }, { x: 10, y: 20, z: 0 }, pickups(), 1, 2.6);
    expect(hits).toEqual([]);
  });

  it('still collects mid-jump, within reach', () => {
    const hits = sweptCollect({ x: 0, y: 1.4, z: 0 }, { x: 10, y: 2.2, z: 0 }, pickups(), 1, 2.6);
    expect(hits).toEqual([0]);
  });

  it('judges height at the closer endpoint, so a landing still counts', () => {
    // Descending onto a ring: one endpoint is far above it, the other is on it.
    const hits = sweptCollect({ x: 0, y: 9, z: 0 }, { x: 10, y: 0.1, z: 0 }, pickups(), 1, 2.6);
    expect(hits).toEqual([0]);
  });

  it('defaults to unbounded, so a caller with no vertical axis is unchanged', () => {
    const hits = sweptCollect({ x: 0, y: 50, z: 0 }, { x: 10, y: 50, z: 0 }, pickups(), 1);
    expect(hits).toEqual([0]);
  });
});

describe('sweptCollect', () => {
  it('collects a pickup sitting at the destination', () => {
    const pickups = [{ x: 5, z: 0 }];
    expect(sweptCollect({ x: 0, z: 0 }, { x: 5, z: 0 }, pickups, 1)).toEqual([0]);
  });

  it('collects a pickup the runner passes THROUGH between frames', () => {
    // The bug this guards: at 17 u/s the runner advances ~0.28 u per frame, and
    // far more on a slow frame. A pickup can sit between the two endpoints with
    // BOTH of them outside the radius — an endpoint-only test misses it, and
    // the pickup silently becomes uncollectable at speed.
    const pickups = [{ x: 5, z: 0 }];
    const prev = { x: 0, z: 0 };
    const cur = { x: 10, z: 0 };
    expect(Math.hypot(pickups[0].x - prev.x, pickups[0].z - prev.z)).toBeGreaterThan(1);
    expect(Math.hypot(pickups[0].x - cur.x, pickups[0].z - cur.z)).toBeGreaterThan(1);
    expect(sweptCollect(prev, cur, pickups, 1)).toEqual([0]);
  });

  it('ignores pickups the path misses', () => {
    const pickups = [{ x: 5, z: 9 }];
    expect(sweptCollect({ x: 0, z: 0 }, { x: 10, z: 0 }, pickups, 1)).toEqual([]);
  });

  it('skips inactive pickups', () => {
    const pickups = [{ x: 5, z: 0, active: false }];
    expect(sweptCollect({ x: 0, z: 0 }, { x: 10, z: 0 }, pickups, 1)).toEqual([]);
  });

  it('returns every pickup along the swept path', () => {
    const pickups = [
      { x: 2, z: 0 },
      { x: 6, z: 0 },
      { x: 4, z: 20 },
    ];
    expect(sweptCollect({ x: 0, z: 0 }, { x: 10, z: 0 }, pickups, 1)).toEqual([0, 1]);
  });
});

describe('comboStep', () => {
  const cfg = { sprintSpeed: 12, growPerSec: 1, decayPerSec: 2, max: 8 };

  it('grows while at or above sprint speed', () => {
    expect(comboStep(1, 17, 1, cfg)).toBeCloseTo(2, 10);
  });

  it('does not grow below sprint speed', () => {
    expect(comboStep(1, 4, 1, cfg)).toBeCloseTo(1, 10);
  });

  it('treats exactly sprintSpeed as sprinting', () => {
    expect(comboStep(1, 12, 1, cfg)).toBeGreaterThan(1);
  });

  it('decays toward 1 but never below it', () => {
    const decayed = comboStep(5, 0, 1, cfg);
    expect(decayed).toBeLessThan(5);
    expect(decayed).toBeGreaterThan(1);
    expect(comboStep(1, 0, 10, cfg)).toBeCloseTo(1, 10);
  });

  it('clamps at the maximum', () => {
    expect(comboStep(7.5, 17, 5, cfg)).toBe(8);
  });

  it('is framerate-independent while decaying', () => {
    // One 1s step must match sixty 1/60s steps, or the combo would depend on
    // the frame rate rather than on how the player is moving.
    let stepped = 5;
    for (let i = 0; i < 60; i++) stepped = comboStep(stepped, 0, 1 / 60, cfg);
    expect(stepped).toBeCloseTo(comboStep(5, 0, 1, cfg), 8);
  });

  it('freezes when dt is zero', () => {
    expect(comboStep(3, 17, 0, cfg)).toBeCloseTo(3, 10);
    expect(comboStep(3, 0, 0, cfg)).toBeCloseTo(3, 10);
  });
});

describe('scoreFor', () => {
  it('scales the base by the combo and rounds', () => {
    expect(scoreFor(100, 1)).toBe(100);
    expect(scoreFor(100, 2.5)).toBe(250);
    expect(scoreFor(100, 1.234)).toBe(123);
  });
});
