import { describe, it, expect } from 'vitest';
import { niceStep, rulerTicks, tickLabel } from '../src/scope/rulerTicks.js';
import { reduceParticles } from '../src/scope/statsMath.js';

describe('niceStep', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.03)).toBeCloseTo(0.05, 12);
    expect(niceStep(230)).toBe(500);
  });

  it('works across decades', () => {
    for (let e = -3; e <= 4; e++) {
      const s = niceStep(Math.pow(10, e));
      expect(s).toBeCloseTo(Math.pow(10, e), 10);
    }
  });

  it('guards a non-positive step', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
  });
});

describe('rulerTicks', () => {
  it('covers the range and stays inside it', () => {
    const { ticks } = rulerTicks(0, 50, 10);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t.value).toBeGreaterThanOrEqual(-50);
      expect(t.value).toBeLessThanOrEqual(50);
    }
  });

  it('produces roughly the requested number of ticks', () => {
    for (const half of [5, 50, 500, 5000]) {
      const { ticks } = rulerTicks(0, half, 12);
      expect(ticks.length).toBeGreaterThanOrEqual(6);
      expect(ticks.length).toBeLessThanOrEqual(24);
    }
  });

  it('is monotonically increasing', () => {
    const { ticks } = rulerTicks(137, 60, 12);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].value).toBeGreaterThan(ticks[i - 1].value);
    }
  });

  it('keeps the same step while panning', () => {
    // The step must depend on the span alone. If it drifted with the centre,
    // labels would renumber as the view scrolls and read as flicker.
    const base = rulerTicks(0, 40, 12).step;
    for (const c of [0.4, 3.9, 17, 123.45, -999]) {
      expect(rulerTicks(c, 40, 12).step).toBe(base);
    }
  });

  it('snaps values onto the grid instead of accumulating drift', () => {
    const { ticks, step } = rulerTicks(2000, 40, 12);
    for (const t of ticks) {
      expect(Math.abs(t.value / step - Math.round(t.value / step))).toBeLessThan(1e-9);
    }
  });

  it('guards a degenerate span', () => {
    expect(rulerTicks(0, 0, 12).ticks).toEqual([]);
    expect(rulerTicks(0, -5, 12).ticks).toEqual([]);
    expect(rulerTicks(0, 40, 0).ticks).toEqual([]);
  });
});

describe('tickLabel', () => {
  it('formats whole numbers without decimals', () => {
    expect(tickLabel(2000, 10)).toBe('2000');
    expect(tickLabel(-40, 10)).toBe('-40');
  });

  it('keeps decimals only when the step needs them', () => {
    expect(tickLabel(0.5, 0.5)).toBe('0.5');
    expect(tickLabel(12.25, 0.25)).toBe('12.25');
  });

  it('never renders negative zero', () => {
    expect(tickLabel(-0, 1)).toBe('0');
    expect(tickLabel(0, 1)).toBe('0');
  });
});

describe('reduceParticles', () => {
  const origin = { x: 0, y: 0, z: 0 };

  it('returns zeros for an empty sample without producing NaN', () => {
    const r = reduceParticles([], origin);
    expect(r).toEqual({
      count: 0,
      meanSpeed: 0,
      maxSpeed: 0,
      plumeLength: 0,
      spreadHeight: 0,
      spanX: 0,
    });
    for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
  });

  it('handles a single particle', () => {
    const r = reduceParticles([{ x: 3, y: 4, z: 0, vx: 1, vy: 0, vz: 0 }], origin);
    expect(r.count).toBe(1);
    expect(r.plumeLength).toBeCloseTo(5, 10);
    expect(r.meanSpeed).toBeCloseTo(1, 10);
    expect(r.spreadHeight).toBeCloseTo(0, 10);
  });

  it('measures plume length from the origin, not from the world origin', () => {
    const p = [{ x: 12, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }];
    expect(reduceParticles(p, { x: 10, y: 0, z: 0 }).plumeLength).toBeCloseTo(2, 10);
    expect(reduceParticles(p, origin).plumeLength).toBeCloseTo(12, 10);
  });

  it('computes mean and max speed independently', () => {
    const r = reduceParticles(
      [
        { x: 0, y: 0, z: 0, vx: 1, vy: 0, vz: 0 },
        { x: 0, y: 0, z: 0, vx: 9, vy: 0, vz: 0 },
      ],
      origin
    );
    expect(r.meanSpeed).toBeCloseTo(5, 10);
    expect(r.maxSpeed).toBeCloseTo(9, 10);
  });

  it('reports vertical spread as the full extent', () => {
    const r = reduceParticles(
      [
        { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0 },
        { x: 0, y: 4.5, z: 0, vx: 0, vy: 0, vz: 0 },
      ],
      origin
    );
    expect(r.spreadHeight).toBeCloseTo(3.5, 10);
  });
});
