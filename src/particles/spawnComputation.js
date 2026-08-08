// Spawn scheduling and per-particle initial conditions, shared by both engines.
//
// The analytic engine stores these as instanced attributes; the GPGPU engine
// injects them into state textures. Both must agree on WHERE and HOW FAST a
// particle starts, or switching engines would change the look — so the
// computation lives here once rather than in each engine.

const INHERIT = 0.32; // fraction of runner velocity a particle keeps

/**
 * Advance the fractional spawn accumulator and return how many whole particles
 * to emit this frame. Framerate-independent: emitting `rate` per second means
 * `rate` per second at any frame rate, with the remainder carried over.
 *
 * `state.accum` is mutated.
 */
export function takeSpawnCount(state, rate, simDt, cap) {
  if (simDt <= 0 || rate <= 0) return 0;
  state.accum += rate * simDt;
  let n = Math.floor(state.accum);
  state.accum -= n;
  if (n <= 0) return 0;
  // Emitting more than the ring holds would overwrite this frame's own spawns.
  return n > cap ? cap : n;
}

/**
 * Emission rate for the runner's current state: scaled between the walk and
 * sprint rates by how far into the sprint the dissolve has gone, and gated so a
 * standing runner emits nothing.
 */
export function emissionRate(params, runner) {
  const moveGate = Math.min(1, runner.speed / 1.6);
  return (
    (params.walkRate + (params.sprintRate - params.walkRate) * Math.pow(runner.dissolve, 1.4)) *
    moveGate
  );
}

// Reused across the spawn loop — returning a fresh object per particle would
// allocate thousands of times per frame.
const _out = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, life: 0, seed: 0, u: 0 };

/**
 * Initial conditions for the k-th of n particles spawned this frame.
 *
 * @param {number} k     index within this frame's batch
 * @param {number} n     batch size
 * @param {object} ctx   { emitPoints, position, prev, velocity, jitter, spread, rise, lifetime, rng }
 * @returns the shared scratch object (consume before the next call)
 */
export function computeSpawn(k, n, ctx) {
  const rng = ctx.rng || Math.random;
  const { emitPoints, position, prev, velocity } = ctx;

  // Spread spawns along the path walked this frame so a fast sprint emits a
  // continuous ribbon rather than one clump per frame.
  const u = n === 1 ? 0.5 : k / n;

  // Emitter joints are in world space at the CURRENT frame; rewinding them
  // along the frame's displacement puts each spawn where that joint actually
  // was at its own spawn time.
  const back = 1 - u;
  const ox = (position.x - prev.x) * back;
  const oy = (position.y - prev.y) * back;
  const oz = (position.z - prev.z) * back;

  const e = emitPoints[(rng() * emitPoints.length) | 0];
  const jitter = ctx.jitter;

  _out.px = e.x - ox + (rng() - 0.5) * jitter;
  _out.py = e.y - oy + (rng() - 0.5) * jitter;
  _out.pz = e.z - oz + (rng() - 0.5) * jitter;

  // Random direction on a sphere, magnitude biased toward the surface.
  const th = rng() * Math.PI * 2;
  const z = rng() * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const mag = ctx.spread * (0.35 + rng() * 0.65);

  _out.vx = velocity.x * INHERIT + Math.cos(th) * r * mag;
  _out.vy = velocity.y * INHERIT + z * mag * 0.6 + ctx.rise * 0.35;
  _out.vz = velocity.z * INHERIT + Math.sin(th) * r * mag;

  _out.life = ctx.lifetime * (0.55 + rng() * 0.65);
  _out.seed = rng();
  _out.u = u;

  return _out;
}

export { INHERIT };
