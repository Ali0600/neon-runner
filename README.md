# NEON RUNNER

**[▶ Live demo](https://ali0600.github.io/neon-runner/)**

A stylized real-time particle system in Three.js, inspired by the neon run in
*inFamous: Second Son*. Sprint, and the figure erodes into tens of thousands of
magenta and cyan light streaks trailing a glowing ribbon behind it.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. The panel on the right retunes everything live.

## Controls

| | |
| --- | --- |
| **WASD** | move |
| **hold Shift** | sprint — the runner dissolves and emission spikes |
| **Space** | jump |
| **hold Space** at a wall, while running | run straight up the building, crest onto the roof |
| **drag** | orbit the camera (follow view only; SCOPE is locked side-on) |
| **T** | fire one SCOPE event immediately, to watch a single transient |
| **.** | step one frame while paused |

Two things worth knowing, because neither is obvious from the panel:

- **SCOPE view** is the `SCOPE VIEW` checkbox in the **Scope** folder, second from the
  bottom of the panel. It lays the effect out along a straight line for inspection.
- **If the sim seems stuck**, the time scrub pauses it by design. Return the scrub to 0,
  press **▶ resume** in the Scope folder, or set `time scale` back to 1 in **Sim**.

## Features

- **Jump, and the neon wall-run.** Tap Space to jump; hold it while running at a
  building and the runner goes **straight up the wall** at 20 u/s — faster than
  its own sprint — crests over the lip and lands on the roof, where it can keep
  running until it steps off an edge. Modelled on *Second Son*'s Light Speed,
  which turns vertical without slowing down. The whole vertical axis is a
  three-state machine in a dependency-free module, so every transition is unit
  tested, and it advances only on the sim clock — at `timeScale = 0` a runner
  frozen mid-climb, mid-fall or on a roof renders bit-identical frames. Takeoff
  kicks a burst downward, landing splashes one outward, and while climbing the
  rise bias inverts so the plume trails **down** the wall behind you.
- **A solid city.** 70 instanced buildings — 8 towers inside the play field and
  a 62-building skyline beyond — laid out from a seeded PRNG so the world is
  identical every load, and rendered in one draw call as dark slabs with lit
  window grids, corner seams and a bright roofline. They are real geometry, not
  backdrop: the runner collides with them and the camera pulls in along its
  sightline rather than clipping through. One layout array is shared by the
  renderer, the collision and the camera, so the city you see is the city you
  hit.
- **Two switchable particle engines.** **Analytic** derives each particle's
  position from a closed form of its age — exact pause and scrub, cost
  proportional to what is alive. **GPGPU** integrates position and velocity in
  ping-pong float textures, which buys feedback forces the closed form cannot
  express: a **vortex** spiralling around the runner's recent path, spatial
  **turbulence**, and a **regather** that pulls shed light back in when the
  runner stops. Both share the fragment shader, the billboard maths, and the
  spawn scheduling, so only the position source differs.
- **SCOPE view** — a lab mode that lays the effect out along a straight lane so
  it reads like a waveform trace: the runner travels in a line, the plume
  streams out behind it horizontally, and the camera locks side-on in either
  **orthographic** (no perspective distortion, so a streak at the edge measures
  the same as one at centre) or perspective. Because a straight line only ever
  shows steady state, a scripted scheduler injects the transients — turns,
  sprint pulses, full stops — with `T` firing one on demand in isolation.
  Comes with a stripped backdrop, a world-unit ruler, live readouts that label
  which numbers are exact and which are sampled, and a time scrub (`.` steps one
  frame) that is reversible to the exact frame in the analytic engine and
  honestly disabled in the GPGPU one.
  **Jumps and wall runs are scheduled events too** — the lane grows a wall, the
  camera follows the runner's height, and the ruler's vertical scale tracks the
  band on screen instead of staying pinned to the ground. A side-on view already
  contains the up axis, so it is the best look at either move. Pick which kind
  `T` fires from **trigger kind** to watch one in isolation.
- **Speed lock** (`HOLD SPEED` in the Sim folder) — pins the runner to a constant
  speed from 0 to 30 u/s, past the game's own sprint of 17. It overrides
  magnitude only, so scope turns still steer while the speed stays flat; the
  controls it supersedes grey out rather than silently doing nothing. Locking the
  motion means the only thing changing while you tune is the setting you drag.
- **Ambient scoring loop** — glowing rings scattered across the field, collected
  by running through them, each firing a 260-particle burst through the same
  ring buffer as the runner's emission. A combo multiplier climbs while
  sprinting and decays when you slow; best combo and lifetime score persist to
  `localStorage`. Collection is swept along the path travelled, not sampled at
  the frame position, so nothing is missed at sprint speed.
- **Two switchable styles** — **neon** (magenta/cyan light streaks) and
  **smoke** (orange embers with normal-blended grey wisps), swapped live from
  the panel. Both run on one emitter and one buffer: particle kinds are
  compile-time `defines` over a shared shader pair, and smoke mode splits the
  same instances between an additive ember pass and a normal-blended smoke pass.
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

Measured on a 2560×1600 buffer at device pixel ratio 2:

| engine | 30k particles | 65k particles |
| --- | --- | --- |
| analytic | 311 fps | 151 fps |
| gpgpu | 152 fps | 130 fps |

The GPGPU engine costs roughly double at 30k but only ~14% more at 65k, because
its compute pass always covers all 65,536 texels regardless of how many
particles are active — it pays full simulation price for a partly empty buffer,
while the analytic engine pays only for what is alive.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/main.js` | Renderer, sim clock, frame loop, `window.__app` verification hooks |
| `src/params.js` | Single shared params object read by the GUI and every system |
| `src/particles/ParticleSystem.js` | Analytic engine: ring buffer, instanced geometry, materials |
| `src/particles/GpuEngine.js` | GPGPU engine: ping-pong state, forces, points-pass spawn injection |
| `src/particles/spawnComputation.js` | Spawn scheduling and initial conditions, shared by both engines |
| `src/particles/ringRanges.js`, `slotUv.js` | Pure ring→update-range and slot→texel mappings (unit tested) |
| `src/shaders/chunks/particleCommon.glsl` | Billboard and sizing maths shared by both engines' vertex shaders |
| `src/runner.js` | Kinematics, joint hierarchy, run cycle, dissolve material |
| `src/city.js` | Pure: building layout, ground height, wall faces, collision, camera sightlines |
| `src/vertical.js` | Pure: the ground / air / wall state machine — gravity, jump, climb, crest |
| `src/speed.js`, `src/constants.js` | Pure speed-precedence resolution; shared motion constants |
| `src/trail/Trail.js` | Position sampling and ribbon rebuild |
| `src/camera.js` | Third-person follow rig with epsilon-snapped easing |
| `src/scope/scopeCamera.js`, `declutter.js`, `ruler.js`, `readouts.js` | SCOPE camera rig, backdrop suppression, ruler, live readouts |
| `src/scope/schedule.js`, `lane.js`, `rulerTicks.js`, `statsMath.js` | Pure: event scheduling, lane wrap, tick selection, stat reducers |
| `src/scope/laneWall.js` | The wall a scheduled wall-run climbs — a prop, drawn where the scripted climb is |
| `src/game/Game.js`, `src/game/logic.js` | Pickup rings and HUD; pure placement, swept collection, combo |
| `src/styles.js` | Plain-data style presets and the switch that applies them |
| `src/shaders/*.glsl` | Particle, trail and dissolve shaders |
| `src/post.js`, `src/gui.js`, `src/scene.js`, `src/input.js` | Bloom chain, panel, world, keyboard |

`docs/DECISIONS.md` records the design forks and the alternatives still worth
trying; `docs/learnings.md` covers the transferable concepts.

## Tests

```bash
npm test
```

179 tests over the pure modules:

- **the vertical state machine** — every transition between ground, air and
  wall; a jump that returns to exactly its launch height; an apex that matches
  the constants minus one step of Euler error; `crest` and `land` each firing
  exactly once; a runner that does *not* grab a wall it is falling past with the
  key released; and `simDt = 0` as a fixed point in all three modes, which pins
  the freeze invariant at the unit level rather than only in the browser.

- **collection reach** — a runner at ring height collects; the same runner
  twenty units up the wall above it does not, since the sweep is XZ-only and
  cannot see height at all.
- **city layout and queries** — a deterministic world for a seed (and a
  *different* one for a different seed, so the determinism test cannot pass
  vacuously), every pickup and the whole autopilot lane left clear, no two
  footprints overlapping, roof heights at the exact footprint boundary, wall
  normals snapped to a flat face, and a camera sightline that stops in front of
  a building rather than behind it.

- **ring buffer ranges** — wraparound, exact boundaries, oversized writes, and
  the invariant that no range ever exceeds the buffer.
- **style presets** — every preset defines every style key, and a switch never
  clobbers engine-owned settings like capacity or time scale.
- **game logic** — seeded placement, swept collection, combo growth and decay,
  scoring.
- **slot/texel mapping** — the GPGPU spawn injection lands on texel centres,
  never on an edge (ambiguous under nearest filtering) and never outside the
  clip volume.
- **speed resolution** — precedence between the speed lock, a path driver's
  request and the walk/sprint flag, including that a commanded zero is a real
  request rather than an absent one.
- **scope schedule and lane** — event sequence construction, every kind present
  by default (so the "drops disabled kinds" test cannot pass vacuously), the jump
  key released before the segment join, a climb window that closes before
  touchdown and is still long enough to clear the lane wall, sampling exactly on
  boundaries (including ones that are not exactly representable in binary),
  speed and heading continuity across every segment join, and lane wrapping
  under large overshoot.

Every suite is verified fail-first: disabling the wraparound branch turns the
range tests red, deleting one key from a preset turns the style tests red, and
the collection tests were written against a point-distance implementation and
watched to fail on the tunnelling case before the swept version was written.

## CI/CD

Pull requests run tests and a production build. Merges to `main` run the same
checks and then deploy to GitHub Pages, with the deploy job gated on the build
job via `needs:` so publishing waits for checks rather than racing them.

The deploy stamps its commit SHA into the bundle, because Pages answers unknown
paths with HTTP 200 — verifying a release means fetching the hashed asset and
confirming the expected commit is in it, not checking a status code.

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
- Built a CI/CD pipeline on GitHub Actions with least-privilege scoped
  permissions, dependency caching, and a deployment job gated on the test and
  build stages, publishing a live demo to GitHub Pages on every merge.
- Validated the pipeline adversarially — confirmed the required check fails on a
  red suite before trusting a green one, and verified each release by asserting
  the deployed commit SHA is present in the served bundle rather than relying on
  an HTTP status code.
- Isolated game rules into dependency-free pure modules (seeded PRNG placement,
  swept-segment collision, framerate-independent combo decay) to make gameplay
  behaviour unit-testable without a renderer, and identified a frame-rate-
  dependent collision defect by writing the failing case before the fix.
- Implemented a second GPGPU compute pipeline using ping-pong float render
  targets, enabling state-dependent physics (path vortex, attractor, spatial
  turbulence) impossible in the closed-form engine, with per-frame spawn
  injection that uploads only newly created particles.
- Refactored two rendering back ends onto shared GLSL modules and a shared
  spawn-scheduling module so the implementations cannot diverge, and benchmarked
  both to quantify the trade — establishing that fixed-size GPU simulation costs
  2× at half occupancy but only 14% at full.
- Diagnosed and fixed a projection-dependent shader defect in which
  velocity-aligned billboards derived the camera direction from a
  perspective-only assumption, and proved the fix with a camera-dolly
  frame-identity assertion that is demonstrably red against the prior formula.
- Designed a scripted event-injection harness as a stateless pure function of
  simulation time, making a real-time visual effect reproducible, freezable and
  unit-testable without a renderer — and caught a floating-point boundary defect
  in it that would have surfaced as an intermittent visual glitch.
- Built an instrumentation layer over two dissimilar GPU back ends — CPU
  re-evaluation of a closed form for one, throttled asynchronous GPU texture
  readback for the other — surfacing per-metric provenance in the UI rather than
  presenting sampled and exact figures as equivalent, and cross-validated the two
  independent paths against a closed-form prediction.
