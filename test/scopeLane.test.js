import { describe, it, expect } from 'vitest';
import { wrapLane, resolvePathMode } from '../src/scope/lane.js';

describe('wrapLane', () => {
  it('leaves a position inside the lane alone', () => {
    expect(wrapLane(0, 100)).toEqual({ x: 0, wrapped: false });
    expect(wrapLane(99.9, 100)).toEqual({ x: 99.9, wrapped: false });
    expect(wrapLane(-100, 100)).toEqual({ x: -100, wrapped: false });
  });

  it('wraps at the far edge back to the near edge', () => {
    const r = wrapLane(100, 100);
    expect(r.wrapped).toBe(true);
    expect(r.x).toBeCloseTo(-100, 10);
  });

  it('wraps one ULP past the edge', () => {
    const just = 100 + Number.EPSILON * 100;
    const r = wrapLane(just, 100);
    expect(r.wrapped).toBe(true);
    expect(r.x).toBeLessThan(0);
  });

  it('handles a large overshoot rather than landing outside the lane', () => {
    // A shortened lane or a huge frame delta can jump many lane-lengths at
    // once; a single subtraction would leave the runner still out of bounds.
    for (const x of [1000, -1000, 12345.6, -98765.4]) {
      const r = wrapLane(x, 100);
      expect(r.wrapped).toBe(true);
      expect(r.x).toBeGreaterThanOrEqual(-100);
      expect(r.x).toBeLessThan(100);
    }
  });

  it('guards a degenerate lane instead of dividing by zero', () => {
    expect(wrapLane(5, 0)).toEqual({ x: 5, wrapped: false });
    expect(wrapLane(5, -3)).toEqual({ x: 5, wrapped: false });
  });
});

describe('resolvePathMode', () => {
  it('gives scope precedence over autopilot', () => {
    expect(resolvePathMode({ scope: true, autopilot: true })).toBe('scope');
    expect(resolvePathMode({ scope: true, autopilot: false })).toBe('scope');
  });

  it('falls back to autopilot, then manual', () => {
    expect(resolvePathMode({ scope: false, autopilot: true })).toBe('autopilot');
    expect(resolvePathMode({ scope: false, autopilot: false })).toBe('manual');
  });

  it('defaults to manual with nothing set', () => {
    expect(resolvePathMode()).toBe('manual');
    expect(resolvePathMode({})).toBe('manual');
  });
});
