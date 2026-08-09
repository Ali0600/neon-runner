import { describe, it, expect } from 'vitest';
import { resolveTargetSpeed } from '../src/speed.js';
import { WALK_SPEED, SPRINT_SPEED } from '../src/constants.js';

describe('resolveTargetSpeed', () => {
  it('falls back to walk or sprint when nothing overrides', () => {
    expect(resolveTargetSpeed({ sprint: false })).toBe(WALK_SPEED);
    expect(resolveTargetSpeed({ sprint: true })).toBe(SPRINT_SPEED);
  });

  it('lets a path driver beat the sprint flag', () => {
    expect(resolveTargetSpeed({ sprint: true, commandSpeed: 6 })).toBe(6);
    expect(resolveTargetSpeed({ sprint: false, commandSpeed: 14 })).toBe(14);
  });

  it('treats a commanded zero as a real request, not as absent', () => {
    // A scope `stop` segment asks for exactly 0. Falling through to walk speed
    // here would make stops do nothing at all.
    expect(resolveTargetSpeed({ sprint: false, commandSpeed: 0 })).toBe(0);
    expect(resolveTargetSpeed({ sprint: true, commandSpeed: 0 })).toBe(0);
  });

  it('ignores an absent command speed', () => {
    expect(resolveTargetSpeed({ sprint: true, commandSpeed: undefined })).toBe(SPRINT_SPEED);
    expect(resolveTargetSpeed({ sprint: false, commandSpeed: null })).toBe(WALK_SPEED);
  });

  it('lets the hold beat both the sprint flag and a commanded speed', () => {
    expect(resolveTargetSpeed({ hold: true, holdValue: 9, sprint: true })).toBe(9);
    expect(resolveTargetSpeed({ hold: true, holdValue: 9, commandSpeed: 3 })).toBe(9);
    expect(
      resolveTargetSpeed({ hold: true, holdValue: 26, sprint: true, commandSpeed: 0 })
    ).toBe(26);
  });

  it('holds zero rather than falling through to walk', () => {
    // Holding at 0 is a legitimate state: a stationary emitter.
    expect(resolveTargetSpeed({ hold: true, holdValue: 0, sprint: true })).toBe(0);
  });

  it('allows a held speed above sprint', () => {
    expect(resolveTargetSpeed({ hold: true, holdValue: 30 })).toBe(30);
  });

  it('clamps a negative hold to zero', () => {
    expect(resolveTargetSpeed({ hold: true, holdValue: -5 })).toBe(0);
  });

  it('treats a missing holdValue as zero rather than NaN', () => {
    expect(resolveTargetSpeed({ hold: true })).toBe(0);
  });
});
