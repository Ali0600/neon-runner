import { describe, it, expect } from 'vitest';
import { emissionRate, takeSpawnCount } from '../src/particles/spawnComputation.js';

const PARAMS = { walkRate: 200, sprintRate: 2000 };
const RUNNER = { speed: 12, dissolve: 0.8 };

describe('emissionRate', () => {
  it('stops the continuous plume in the afterimages mode', () => {
    expect(emissionRate({ ...PARAMS, sprintFx: 'afterimages' }, RUNNER)).toBe(0);
  });

  it('keeps emitting in every other mode', () => {
    const plume = emissionRate({ ...PARAMS, sprintFx: 'plume' }, RUNNER);
    expect(plume).toBeGreaterThan(0);
    expect(emissionRate({ ...PARAMS, sprintFx: 'both' }, RUNNER)).toBe(plume);
    // Unset reads as plume, so a params object from before the feature is
    // unaffected.
    expect(emissionRate({ ...PARAMS }, RUNNER)).toBe(plume);
  });

  it('still gates a standing runner to nothing', () => {
    expect(emissionRate({ ...PARAMS, sprintFx: 'plume' }, { speed: 0, dissolve: 0 })).toBe(0);
  });

  it('scales between the walk and sprint rates with the dissolve', () => {
    const p = { ...PARAMS, sprintFx: 'plume' };
    const slow = emissionRate(p, { speed: 12, dissolve: 0 });
    const fast = emissionRate(p, { speed: 12, dissolve: 1 });
    expect(slow).toBeCloseTo(PARAMS.walkRate, 6);
    expect(fast).toBeCloseTo(PARAMS.sprintRate, 6);
  });
});

describe('takeSpawnCount', () => {
  it('emits nothing while time is frozen', () => {
    // The plume's half of the freeze invariant: a paused frame must not spawn,
    // and must not bank progress toward the next one either.
    //
    // This pins the behaviour at the API, not a particular line: the explicit
    // `simDt <= 0` guard turns out not to be load-bearing here, because
    // `accum += rate * 0` is a no-op anyway. The mutation harness said so — the
    // sabotage that removes the clause is not caught, and there is no case for
    // it, since inventing a negative dt to make one bite would be testing an
    // input the app cannot produce.
    const state = { accum: 0 };
    expect(takeSpawnCount(state, 1000, 0, 500)).toBe(0);
    expect(state.accum).toBe(0);
  });

  it('carries the fractional remainder across frames', () => {
    const state = { accum: 0 };
    expect(takeSpawnCount(state, 30, 0.02, 500)).toBe(0); // 0.6
    expect(takeSpawnCount(state, 30, 0.02, 500)).toBe(1); // 1.2 -> 1, keeps 0.2
    expect(state.accum).toBeCloseTo(0.2, 6);
  });

  it('clamps to the cap so a frame cannot overwrite its own spawns', () => {
    const state = { accum: 0 };
    expect(takeSpawnCount(state, 100000, 1, 64)).toBe(64);
  });
});
