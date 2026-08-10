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

/**
 * Fill the spawn context from the runner and params.
 *
 * Shared rather than written out in each engine: both were already setting the
 * identical eight fields, and every field added after that is a chance for one
 * engine to get it and the other not — which shows up as the two engines
 * quietly looking different, the one thing this module exists to prevent.
 *
 * `prev` is the runner's position at the end of the previous frame, which each
 * engine tracks itself.
 */
export function fillSpawnContext(ctx, runner, params, prev) {
  ctx.emitPoints = runner.emitPoints;
  ctx.position = runner.position;
  ctx.prev = prev;
  ctx.velocity = runner.velocity;
  ctx.jitter = 0.1 + runner.dissolve * 0.22;
  ctx.spread = params.spread;
  ctx.rise = params.riseBias;
  ctx.lifetime = params.lifetime;

  // Climbing a wall: the plume has to fall away DOWN the face. riseBias is
  // world-up and is a uniform in both engines' shaders, so it cannot be aimed
  // per particle — the spawn velocity is the only place a direction can be
  // applied without splitting the two engines apart.
  const onWall = !!runner.vertical && runner.vertical.mode === 'wall';
  ctx.climb = onWall ? 1 : 0;
  ctx.wallNx = onWall && runner.wallNormal ? runner.wallNormal.nx : 0;
  ctx.wallNz = onWall && runner.wallNormal ? runner.wallNormal.nz : 0;
  return ctx;
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

  const climb = ctx.climb || 0;

  _out.vx = velocity.x * INHERIT + Math.cos(th) * r * mag;
  // Flip the rise bias while climbing so the light trails down the wall instead
  // of being pushed back up into the runner. The shader keeps applying rise as
  // an ongoing acceleration — it is a uniform, so it cannot be aimed per
  // particle — but over a ~1s lifetime that adds under half a unit, and this
  // spawn velocity comfortably outruns it.
  _out.vy = velocity.y * INHERIT + z * mag * 0.6 + ctx.rise * 0.35 * (1 - 2 * climb);
  _out.vz = velocity.z * INHERIT + Math.sin(th) * r * mag;

  if (climb > 0) {
    // Push off the face: spawned flush against a solid wall, half the plume
    // would be born inside it and never be seen.
    const nx = ctx.wallNx || 0;
    const nz = ctx.wallNz || 0;
    _out.px += nx * climb * 0.3;
    _out.pz += nz * climb * 0.3;
    _out.vx += nx * climb * 1.4;
    _out.vz += nz * climb * 1.4;
  }

  _out.life = ctx.lifetime * (0.55 + rng() * 0.65);
  _out.seed = rng();
  _out.u = u;

  return _out;
}

export { INHERIT };
