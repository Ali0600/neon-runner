// Spawn scheduling and per-particle initial conditions, shared by both engines.
//
// The analytic engine stores these as instanced attributes; the GPGPU engine
// injects them into state textures. Both must agree on WHERE and HOW FAST a
// particle starts, or switching engines would change the look — so the
// computation lives here once rather than in each engine.

import { plumeEnabled } from '../afterimages/logic.js';

const INHERIT = 0.32; // fraction of runner velocity a particle keeps

// Downward kick applied to a glide spawn, as a multiple of the spread
// magnitude. Large enough that the jet reads as thrust rather than as the plume
// happening to sag.
const GLIDE_JET = 2.6;

// Floor on the glide's emission, as a fraction of the sprint rate.
const GLIDE_EMIT_FLOOR = 0.55;

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
  // The afterimages-only mode stops the plume at the source rather than hiding
  // the meshes: already-live particles then age out naturally instead of
  // vanishing mid-air, and the SCOPE readouts keep reporting what is really
  // there. One-off bursts (takeoff, landing, pickups) are event feedback rather
  // than plume, and deliberately survive the gate.
  if (!plumeEnabled(params.sprintFx)) return 0;

  const moveGate = Math.min(1, runner.speed / 1.6);
  const base =
    (params.walkRate + (params.sprintRate - params.walkRate) * Math.pow(runner.dissolve, 1.4)) *
    moveGate;

  // A hover is a sustained burn. Without this the rate follows the dissolve,
  // which decays as the glide bleeds speed off — so the jet would thin out over
  // exactly the seconds it is meant to be holding the runner up. Floored rather
  // than scaled, so a glide entered at a walk still lights up.
  if (runner.vertical && runner.vertical.mode === 'glide') {
    return Math.max(base, params.sprintRate * GLIDE_EMIT_FLOOR);
  }
  return base;
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

  // Gliding aims the plume straight DOWN, for the same reason and through the
  // same seam as the climb: rise is a world-up uniform in both engines' shaders,
  // so spawn velocity is the only place a direction can be applied per particle
  // without splitting the two engines apart.
  ctx.glide = !!runner.vertical && runner.vertical.mode === 'glide' ? 1 : 0;
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
  const glide = ctx.glide || 0;

  // The jet billows outward as it blasts down, so the horizontal spread widens
  // while gliding rather than staying the tight column a walk emits.
  const lateral = 1 + glide * 0.9;

  _out.vx = velocity.x * INHERIT + Math.cos(th) * r * mag * lateral;
  // Flip the rise bias while climbing so the light trails down the wall instead
  // of being pushed back up into the runner, and drive it hard downward while
  // gliding — that downward jet IS the hover. Both aimings share this one
  // expression: written as two, a state that somehow set both would apply only
  // whichever came last, and the disagreement would be invisible.
  // The shader keeps applying rise as an ongoing acceleration — it is a uniform,
  // so it cannot be aimed per particle — but over a ~1s lifetime that adds under
  // half a unit, and this spawn velocity comfortably outruns it.
  _out.vy =
    velocity.y * INHERIT +
    z * mag * 0.6 +
    ctx.rise * 0.35 * (1 - 2 * climb) -
    glide * GLIDE_JET * mag;
  _out.vz = velocity.z * INHERIT + Math.sin(th) * r * mag * lateral;

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
