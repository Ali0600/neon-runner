import { reduceParticles } from './statsMath.js';

// Live numeric readouts for SCOPE view.
//
// Two very different measurement paths, and the panel says which is which:
//
//  - analytic: the CPU already holds the spawn/velocity arrays, so the ALIVE
//    COUNT is exact (two comparisons per slot). Everything else re-evaluates
//    the closed form over a STRIDE across the whole ring — never a contiguous
//    slice, which would sample one arbitrary age band. Prefixed "~".
//
//  - gpgpu: state lives in a texture, so it needs a readback. Uses the async
//    variant: the synchronous readRenderTargetPixels silently no-ops on an
//    out-of-range rect and leaves the buffer untouched, which is
//    indistinguishable from "everything is dead". Throttled, one in flight.

const STRIDE = 16;
const _samples = [];

function analyticStats(system, simTime, origin, drag, rise, wobble) {
  const geo = system.geometry;
  const spawn = geo.getAttribute('aSpawn').array;
  const vel = geo.getAttribute('aVel').array;
  const seed = geo.getAttribute('aSeed').array;
  const cap = system.activeCapacity;

  let alive = 0;
  _samples.length = 0;

  for (let i = 0; i < cap; i++) {
    const t = simTime - spawn[i * 4 + 3];
    const life = vel[i * 4 + 3];
    if (t < 0 || t >= life || life <= 0) continue;
    alive++;
    if (i % STRIDE !== 0) continue;

    // Mirrors particles.vert.glsl exactly: exponential drag, constant rise and
    // a seeded wobble. If that shader changes, this must change with it.
    const ed = Math.exp(-drag * t);
    const s = (1 - ed) / drag;
    const sd = seed[i] * 6.2831853;
    const f = [
      Math.sin(t * 3.1 + sd),
      Math.sin(t * 2.3 + sd * 1.7),
      Math.cos(t * 2.7 + sd * 2.3),
    ];
    const fd = [
      3.1 * Math.cos(t * 3.1 + sd),
      2.3 * Math.cos(t * 2.3 + sd * 1.7),
      -2.7 * Math.sin(t * 2.7 + sd * 2.3),
    ];
    _samples.push({
      x: spawn[i * 4] + vel[i * 4] * s + f[0] * wobble * t,
      y: spawn[i * 4 + 1] + vel[i * 4 + 1] * s + 0.5 * rise * t * t + f[1] * wobble * t,
      z: spawn[i * 4 + 2] + vel[i * 4 + 2] * s + f[2] * wobble * t,
      vx: vel[i * 4] * ed + (fd[0] * t + f[0]) * wobble,
      vy: vel[i * 4 + 1] * ed + rise * t + (fd[1] * t + f[1]) * wobble,
      vz: vel[i * 4 + 2] * ed + (fd[2] * t + f[2]) * wobble,
    });
  }

  const r = reduceParticles(_samples, origin);
  // Exact, because every slot was tested; only the derived stats are sampled.
  r.count = alive;
  r.sampled = _samples.length;
  r.exactCount = true;
  return r;
}

export function createReadouts(el) {
  const state = {
    stats: null,
    pending: false,
    generation: 0,
    lastRealTime: 0,
    buf: null,
    velBuf: null,
  };

  function gpguStats(engine, renderer, origin, hz) {
    const now = performance.now();
    // Throttled on the REAL clock: readback rate is presentation, not
    // simulation, and it must not add work to a frozen frame.
    if (state.pending || now - state.lastRealTime < 1000 / Math.max(0.5, hz)) return;
    state.lastRealTime = now;

    const posRT = engine.gpu.getCurrentRenderTarget(engine.posVar);
    const velRT = engine.gpu.getCurrentRenderTarget(engine.velVar);
    const w = posRT.width;
    const h = posRT.height;
    if (!state.buf) {
      state.buf = new Float32Array(w * h * 4);
      state.velBuf = new Float32Array(w * h * 4);
    }

    state.pending = true;
    const gen = ++state.generation;
    Promise.all([
      // Whole texture, never a sub-rect: the ring's write head moves, so a
      // partial read samples an arbitrary slice of history.
      renderer.readRenderTargetPixelsAsync(posRT, 0, 0, w, h, state.buf),
      renderer.readRenderTargetPixelsAsync(velRT, 0, 0, w, h, state.velBuf),
    ])
      .then(() => {
        // A result that lands after an engine or lane change describes a world
        // that no longer exists.
        if (gen !== state.generation) return;
        const p = state.buf;
        const v = state.velBuf;
        let alive = 0;
        _samples.length = 0;
        for (let i = 0; i < w * h; i++) {
          if (p[i * 4 + 3] <= 0) continue;
          alive++;
          if (i % STRIDE !== 0) continue;
          _samples.push({
            x: p[i * 4], y: p[i * 4 + 1], z: p[i * 4 + 2],
            vx: v[i * 4], vy: v[i * 4 + 1], vz: v[i * 4 + 2],
          });
        }
        const r = reduceParticles(_samples, origin);
        r.count = alive;
        r.sampled = _samples.length;
        r.exactCount = true;
        state.stats = r;
      })
      .catch(() => {
        // The async variant throws on a bad rect rather than silently
        // returning stale data, so surface it as "unavailable" not as zeros.
        state.stats = null;
      })
      .finally(() => {
        state.pending = false;
      });
  }

  const api = { get stats() { return state.stats; } };

  api.invalidate = () => {
    state.generation++;
    state.stats = null;
  };

  api.update = function update(params, simTime, runner, particles, gpuEngine, renderer) {
    if (!el) return;
    if (!params.scope || !params.scopeReadouts) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';

    const origin = { x: runner.position.x, y: runner.position.y + 1, z: runner.position.z };

    if (params.engine === 'gpgpu') {
      if (gpuEngine.available && gpuEngine.enabled) {
        gpguStats(gpuEngine, renderer, origin, params.scopeReadbackHz);
      }
    } else {
      state.stats = analyticStats(
        particles, simTime, origin, params.drag, params.riseBias, params.wobble
      );
    }

    const s = state.stats;
    const src = params.engine === 'gpgpu' ? `GPU readback @${params.scopeReadbackHz}Hz` : 'CPU exact';
    if (!s) {
      el.textContent = `ALIVE  —    (${src}, awaiting first read)`;
      return;
    }
    const f = (v, d = 1) => v.toFixed(d);
    el.textContent =
      `ALIVE ${s.count}   ~SPEED ${f(s.meanSpeed)} / ${f(s.maxSpeed)} max   ` +
      `~PLUME ${f(s.plumeLength)}u   ~SPREAD ${f(s.spreadHeight)}u\n` +
      `count exact · ~ = sampled 1/${STRIDE} (${s.sampled}) · ${src}`;
  };

  return api;
}

export { STRIDE };
