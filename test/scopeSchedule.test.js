import { describe, it, expect } from 'vitest';
import {
  buildSchedule,
  sampleSchedule,
  stopProfile,
  driveCommand,
  DEFAULT_DURATIONS,
} from '../src/scope/schedule.js';

const CFG = { interval: 3, turn: true, sprint: true, stop: true };

describe('buildSchedule', () => {
  it('period is the sum of every segment duration', () => {
    const s = buildSchedule(CFG);
    expect(s.period).toBeCloseTo(
      s.segments.reduce((a, x) => a + x.duration, 0),
      12
    );
    expect(s.period).toBeCloseTo(
      3 * 3 + DEFAULT_DURATIONS.turn + DEFAULT_DURATIONS.sprint + DEFAULT_DURATIONS.stop,
      12
    );
  });

  it('drops disabled kinds but keeps the cruise segments', () => {
    const s = buildSchedule({ ...CFG, turn: false, stop: false });
    const kinds = s.segments.map((x) => x.kind);
    expect(kinds).not.toContain('turn');
    expect(kinds).not.toContain('stop');
    expect(kinds.filter((k) => k === 'cruise').length).toBe(3);
    expect(kinds).toContain('sprint');
  });

  it('with every event disabled it is pure cruise with a non-zero period', () => {
    // A zero period would divide by zero in sampleSchedule.
    const s = buildSchedule({ interval: 2, turn: false, sprint: false, stop: false });
    expect(s.segments.every((x) => x.kind === 'cruise')).toBe(true);
    expect(s.period).toBeGreaterThan(0);
    expect(() => sampleSchedule(s, 7.3)).not.toThrow();
  });

  it('segment starts are strictly increasing and end at the period', () => {
    const s = buildSchedule(CFG);
    for (let i = 1; i < s.segments.length; i++) {
      expect(s.segments[i].start).toBeGreaterThan(s.segments[i - 1].start);
    }
    const last = s.segments[s.segments.length - 1];
    expect(last.start + last.duration).toBeCloseTo(s.period, 12);
  });

  it('clamps a degenerate interval instead of producing a zero-length cruise', () => {
    expect(buildSchedule({ interval: 0 }).period).toBeGreaterThan(0);
    expect(buildSchedule({ interval: -5 }).period).toBeGreaterThan(0);
  });
});

describe('sampleSchedule', () => {
  const s = buildSchedule(CFG);

  it('starts in the first segment at t=0', () => {
    const r = sampleSchedule(s, 0);
    expect(r.kind).toBe('cruise');
    expect(r.tIn).toBeCloseTo(0, 12);
    expect(r.cycle).toBe(0);
  });

  it('lands in the right segment at each exact boundary', () => {
    for (const seg of s.segments) {
      expect(sampleSchedule(s, seg.start).kind).toBe(seg.kind);
      expect(sampleSchedule(s, seg.start).tIn).toBeCloseTo(0, 10);
    }
  });

  it('does not lose a ULP on boundaries that are not exactly representable', () => {
    // Segment starts are accumulated sums, so most land on values with no exact
    // binary representation. The usual negative-safe modulo idiom
    // `((t % p) + p) % p` shifts such a value back by one ULP, which drops it
    // into the PREVIOUS segment — a one-frame flicker at every boundary.
    for (const interval of [3, 0.7, 1.3, 2.9]) {
      const s = buildSchedule({ interval, turn: true, sprint: true, stop: true });
      for (const seg of s.segments) {
        expect(sampleSchedule(s, seg.start).kind, `interval ${interval}, ${seg.kind}`).toBe(
          seg.kind
        );
      }
    }
  });

  it('wraps at the period and counts cycles', () => {
    expect(sampleSchedule(s, s.period).kind).toBe(s.segments[0].kind);
    expect(sampleSchedule(s, s.period).cycle).toBe(1);
    expect(sampleSchedule(s, s.period * 5.5).u).toBeCloseTo(s.period * 0.5, 8);
  });

  it('handles negative time without escaping the schedule', () => {
    const r = sampleSchedule(s, -0.5);
    expect(r.u).toBeGreaterThanOrEqual(0);
    expect(r.u).toBeLessThan(s.period);
    expect(r.tIn).toBeGreaterThanOrEqual(0);
  });

  it('tNorm stays within [0,1) everywhere', () => {
    for (let t = -20; t < 60; t += 0.037) {
      const r = sampleSchedule(s, t);
      expect(r.tNorm).toBeGreaterThanOrEqual(0);
      expect(r.tNorm).toBeLessThan(1);
    }
  });
});

describe('stopProfile', () => {
  it('is exactly zero across the middle third', () => {
    // Near-zero still emits particles and never shows the settled state, so
    // this has to be exactly 0, not merely small.
    expect(stopProfile(0.5)).toBe(0);
    expect(stopProfile(0.4)).toBe(0);
    expect(stopProfile(0.66)).toBe(0);
  });

  it('is 1 at both ends', () => {
    expect(stopProfile(0)).toBeCloseTo(1, 12);
    expect(stopProfile(1)).toBeCloseTo(1, 12);
  });

  it('never leaves [0,1]', () => {
    for (let u = 0; u <= 1; u += 0.01) {
      expect(stopProfile(u)).toBeGreaterThanOrEqual(0);
      expect(stopProfile(u)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
});

describe('driveCommand', () => {
  const s = buildSchedule(CFG);

  it('always drives forward along the lane', () => {
    for (let t = 0; t < s.period * 2; t += 0.01) {
      expect(driveCommand(sampleSchedule(s, t), {}, 0).dirX).toBeGreaterThan(0);
    }
  });

  it('steers back toward the centreline when off-lane', () => {
    const cruise = sampleSchedule(s, 0.5);
    expect(driveCommand(cruise, {}, 8).dirZ).toBeLessThan(0);
    expect(driveCommand(cruise, {}, -8).dirZ).toBeGreaterThan(0);
    expect(driveCommand(cruise, {}, 0).dirZ).toBeCloseTo(0, 12);
  });

  it('reaches the turn amplitude and returns to centre within the turn', () => {
    const seg = s.segments.find((x) => x.kind === 'turn');
    const peak = driveCommand(sampleSchedule(s, seg.start + seg.duration * 0.25), {
      turnAmplitude: 6,
    }).targetZ;
    const end = driveCommand(sampleSchedule(s, seg.start + seg.duration * 0.999), {
      turnAmplitude: 6,
    }).targetZ;
    expect(peak).toBeCloseTo(6, 2);
    expect(Math.abs(end)).toBeLessThan(0.2);
  });

  it('stops dead mid-stop and sprints faster than walk mid-sprint', () => {
    const stop = s.segments.find((x) => x.kind === 'stop');
    expect(driveCommand(sampleSchedule(s, stop.start + stop.duration * 0.5)).speed).toBe(0);
    const sp = s.segments.find((x) => x.kind === 'sprint');
    const mid = driveCommand(sampleSchedule(s, sp.start + sp.duration * 0.5)).speed;
    expect(mid).toBeGreaterThan(16);
  });

  it('is continuous across every segment boundary', () => {
    // THE fail-first test. A naive linear ramp (targetZ = amplitude * tNorm)
    // jumps from the amplitude back to 0 at the end of the turn, which reads as
    // a snap in the plume and would be easy to mistake for an engine bug.
    const cfg = { turnAmplitude: 6 };
    const e = 1e-6;
    for (const seg of s.segments) {
      const before = driveCommand(sampleSchedule(s, seg.start - e), cfg, 0);
      const after = driveCommand(sampleSchedule(s, seg.start + e), cfg, 0);
      expect(Math.abs(after.speed - before.speed), `speed at ${seg.kind}`).toBeLessThan(1e-3);
      expect(Math.abs(after.targetZ - before.targetZ), `targetZ at ${seg.kind}`).toBeLessThan(
        1e-3
      );
    }
  });

  it('produces a unit direction vector', () => {
    for (let t = 0; t < s.period; t += 0.05) {
      const c = driveCommand(sampleSchedule(s, t), {}, 3);
      expect(Math.hypot(c.dirX, c.dirZ)).toBeCloseTo(1, 10);
    }
  });
});
