import { describe, it, expect } from 'vitest';
import {
  emissionRate,
  takeSpawnCount,
  fillSpawnContext,
  computeSpawn,
} from '../src/particles/spawnComputation.js';

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

describe('emissionRate — gliding', () => {
  const gliding = (over = {}) => ({ speed: 12, dissolve: 0.8, vertical: { mode: 'glide' }, ...over });

  it('holds a floor while gliding, however far the dissolve has decayed', () => {
    // The rate normally follows the dissolve, which decays as the glide bleeds
    // speed off — so without a floor the jet thins out over exactly the seconds
    // it is meant to be holding the runner up.
    const p = { ...PARAMS, sprintFx: 'plume' };
    const decayed = emissionRate(p, gliding({ dissolve: 0 }));
    expect(decayed).toBeGreaterThan(emissionRate(p, { speed: 12, dissolve: 0 }));
    expect(decayed).toBeGreaterThanOrEqual(PARAMS.sprintRate * 0.5);
  });

  it('never lowers the rate a fast glide had already earned', () => {
    // A floor, not a replacement: entering a glide at full tilt must not dim it.
    const p = { ...PARAMS, sprintFx: 'plume' };
    expect(emissionRate(p, gliding({ dissolve: 1 }))).toBeGreaterThanOrEqual(
      emissionRate(p, { speed: 12, dissolve: 1 })
    );
  });

  it('still respects the afterimages-only gate', () => {
    // The mode gate outranks the floor: a glide must not resurrect the plume in
    // the one mode that exists to stop it at the source.
    expect(emissionRate({ ...PARAMS, sprintFx: 'afterimages' }, gliding())).toBe(0);
  });
});

describe('computeSpawn — glide aims the jet down', () => {
  const RNG = () => 0.5; // dead centre: no spread, so the aiming is what is left
  const base = {
    emitPoints: [{ x: 0, y: 1, z: 0 }],
    position: { x: 0, y: 1, z: 0 },
    prev: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    jitter: 0,
    spread: 2,
    rise: 1,
    lifetime: 1,
    rng: RNG,
  };

  const spawnFor = (vertical) => {
    const ctx = fillSpawnContext({ ...base }, { ...base, vertical }, { spread: 2, riseBias: 1, lifetime: 1 }, base.prev);
    // fillSpawnContext overwrites the emitter fields from the runner; restore
    // the deterministic ones the assertions depend on.
    Object.assign(ctx, base);
    ctx.glide = vertical && vertical.mode === 'glide' ? 1 : 0;
    ctx.climb = vertical && vertical.mode === 'wall' ? 1 : 0;
    const s = computeSpawn(0, 1, ctx);
    return { vx: s.vx, vy: s.vy, vz: s.vz };
  };

  it('sends the plume downward while gliding, not upward', () => {
    const ground = spawnFor({ mode: 'air' });
    const glide = spawnFor({ mode: 'glide' });
    expect(glide.vy).toBeLessThan(0);
    expect(glide.vy).toBeLessThan(ground.vy);
  });

  it('widens the horizontal spread so the jet billows', () => {
    // Straight down with no lateral spread reads as a laser, not a hover.
    // computeSpawn returns a shared scratch object, so each result has to be
    // copied out before the next call overwrites it.
    const ctx = { ...base, glide: 1, climb: 0, rng: () => 0.9 };
    const lateralOf = (c) => {
      const s = computeSpawn(0, 1, c);
      return Math.hypot(s.vx, s.vz);
    };
    expect(lateralOf(ctx)).toBeGreaterThan(lateralOf({ ...ctx, glide: 0 }));
  });

  it('sets the glide flag from the vertical mode', () => {
    const ctx = fillSpawnContext({}, { ...base, vertical: { mode: 'glide' } }, { spread: 2, riseBias: 1, lifetime: 1 }, base.prev);
    expect(ctx.glide).toBe(1);
    expect(fillSpawnContext({}, { ...base, vertical: { mode: 'air' } }, { spread: 2, riseBias: 1, lifetime: 1 }, base.prev).glide).toBe(0);
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
