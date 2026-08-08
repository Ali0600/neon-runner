# NEON RUNNER

A stylized real-time particle system in Three.js, inspired by the neon run in
*inFamous: Second Son*. Sprint, and the figure erodes into tens of thousands of
magenta and cyan light streaks trailing a glowing ribbon behind it.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. **WASD** to move, **hold Shift** to sprint,
**drag** to orbit. The panel on the right retunes everything live.

## Features

- **Analytic GPU particle engine** — 65,536-particle capacity; each particle's
  position is a closed-form function of its age, evaluated in the vertex shader.
  The CPU writes only newly spawned slots.
- **Velocity-aligned stretched billboards** — streaks orient and lengthen along
  their direction of travel, which is what makes them read as light rather than
  as dots.
- **Ring-buffer emitter with partial uploads** — roughly 7 KB of buffer traffic
  per frame at full sprint instead of 2.4 MB.
- **Particles emitted from the figure's joints** — light comes off the hands,
  knees, torso and head, not from an abstract box.
- **Noise-dissolve character** — a hash-based value-noise threshold erodes the
  runner from the feet upward, synchronized with the emission rate so the body
  visibly *becomes* the light.
- **Camera-facing trail ribbon** — a continuous light core that particles alone
  cannot provide at sprint speed.
- **Distance-driven run cycle** — stride phase advances with distance travelled,
  so the gait always matches ground speed instead of sliding or mincing.
- **True pause and slow-motion** — `timeScale` scales a separate sim clock;
  at zero the frame is pixel-identical between renders while the camera stays
  live so you can orbit frozen streaks.
- **UnrealBloom post chain** and a full live-tuning panel (emission, palette,
  streak geometry, trail, bloom, pixel ratio, time scale).

Measured on a 2560×1600 buffer at device pixel ratio 2: **411 fps** at the
default 30k particles, **140 fps** at the 65k maximum with 25,000 spawns/sec.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/main.js` | Renderer, sim clock, frame loop, `window.__app` verification hooks |
| `src/params.js` | Single shared params object read by the GUI and every system |
| `src/particles/ParticleSystem.js` | Ring buffer, spawn scheduling, instanced geometry |
| `src/particles/ringRanges.js` | Pure ring→update-range mapping (unit tested) |
| `src/runner.js` | Kinematics, joint hierarchy, run cycle, dissolve material |
| `src/trail/Trail.js` | Position sampling and ribbon rebuild |
| `src/camera.js` | Third-person follow rig with epsilon-snapped easing |
| `src/shaders/*.glsl` | Particle, trail and dissolve shaders |
| `src/post.js`, `src/gui.js`, `src/scene.js`, `src/input.js` | Bloom chain, panel, world, keyboard |

`docs/DECISIONS.md` records the design forks and the alternatives still worth
trying; `docs/learnings.md` covers the transferable concepts.

## Tests

```bash
npm test
```

Covers the ring-buffer range mapping — wraparound, exact boundaries, oversized
writes, and the invariant that no range ever exceeds the buffer. Verified
fail-first: disabling the wraparound branch turns the suite red.

## Experience Gained

- Designed and implemented a GPU-accelerated particle engine rendering 65k
  instanced primitives in a single draw call, sustaining 140+ fps at a 4-megapixel
  render target by moving per-particle integration from CPU to vertex shader.
- Reduced per-frame buffer bandwidth by ~99% (2.4 MB → 7 KB) by replacing
  full-attribute uploads with a ring-buffer allocator and partial GPU buffer
  range updates.
- Authored custom GLSL shaders for velocity-aligned billboard stretching,
  noise-threshold mesh dissolve, and camera-facing ribbon generation.
- Built a deterministic headless verification harness for a browser render loop,
  driving fixed-timestep frames and asserting frame-level invariants — after
  diagnosing that background-tab rAF throttling made conventional testing
  silently report false results.
- Diagnosed and fixed a state-consistency defect where simulation components ran
  on the wall clock instead of the scaled simulation clock, proven by a
  pixel-identity assertion across frozen frames.
- Profiled and tuned a real-time render pipeline against measured frame timings
  with GPU synchronization, rather than estimated throughput.
