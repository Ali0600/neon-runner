# Design decisions

## Backlog — alternatives worth trying later

- **GPGPU ping-pong particles** (D1) — needed the moment particles must react to
  forces (attractors, vortices, collisions) rather than fly a fixed arc.
  *Revisit hook:* `src/shaders/particles.vert.glsl` computes position from
  `aSpawn`/`aVel`; swap that block for a state-texture fetch and add a
  `GPUComputationRenderer` step. The ring-buffer emitter and the billboard math
  are reusable as-is.
- **pmndrs `postprocessing`** (D2) — merged-pass rendering and finer bloom
  controls. *Revisit hook:* `src/post.js` is the only file that knows about the
  composer; its `{ render, setSize, applyParams }` shape is the seam.
- **Skinned/rigged runner** (D8) — the current figure is a joint hierarchy of
  capsules. *Revisit hook:* `createRunner` in `src/runner.js` builds the joints
  and drives them in one block.

---

## D1 — Stateless analytic particles, not GPGPU ping-pong

**Fork:** compute each particle's position in the vertex shader as a closed-form
function of `uTime - spawnTime`, or advect positions through a ping-pong
framebuffer with `GPUComputationRenderer`.

- *Analytic:* no state textures, no float-FBO plumbing, and pause/slow-mo/scrub
  are free — position depends only on sim time. Cannot express feedback forces.
- *GPGPU:* arbitrary per-step forces and inter-particle interaction. Costs two
  render targets, a compute pass, and makes time scrubbing a re-simulation.

**Chosen:** analytic. The Second Son look is ballistic — spawn, drag, drift, die
— which has an exact closed form, so the extra machinery buys nothing yet. The
`timeScale = 0` freeze test (frame is pixel-identical while paused) only works
because of this property.

**Status of alternative:** `deferred — worth trying`.

## D2 — three.js built-in EffectComposer, not pmndrs `postprocessing`

- *Built-in addons:* zero extra dependency, version-locked to three, and
  `UnrealBloomPass`'s mip-chain bloom is exactly the soft neon halo wanted.
- *pmndrs:* better performance via merged passes, more bloom control, one more
  dependency to track against three's release cadence.

**Chosen:** built-in. Measured 411 fps at default settings, so bloom is nowhere
near the bottleneck.

**Status of alternative:** `deferred — worth trying` if bloom ever measures hot.

## D3 — Instanced stretched quads, not `gl.POINTS`

- *Points:* one vertex per particle, cheapest possible.
- *Quads:* 4 verts + 2 triangles per particle, but can be oriented and stretched.

**Chosen:** quads. `gl.POINTS` are axis-aligned screen squares and **cannot be
stretched along velocity** — the streak is the entire visual identity here, so
points were never actually viable.

**Status of alternative:** `rejected — cannot express the required look`.

## D4 — Trail is a ribbon mesh *and* particles, not particles alone

- *Particles alone:* one system to tune.
- *Ribbon + particles:* the ribbon gives a continuous light core, particles give
  texture around it.

**Chosen:** both. At sprint speed the runner covers ~0.28 world units per frame,
so particles alone leave visible gaps in the core of the trail.

**Status of alternative:** `rejected — gaps at speed`.

## D5 — Sim clock separate from the real clock

**Fork:** scale one clock and feed everything from it, or keep a real-time
delta for presentation and a scaled delta for simulation.

**Chosen:** two clocks, with a deliberate split — **everything in the runner and
particle systems reads the sim clock; only the camera rig reads real time.**
That makes `timeScale = 0` a true freeze while still letting the user orbit and
inspect frozen streaks.

This split was not free: the first implementation had the runner's autopilot,
velocity easing and dissolve ramp on real time, so a "paused" scene kept
drifting. See `docs/learnings.md`.

## D14 — Swept segment collection, not a point-radius test

**Fork:** detect pickup collection by testing the runner's position against each
pickup each frame, or by testing the whole segment travelled since last frame.

- *Point test:* one distance check per pickup. At 17 u/s the runner advances
  ~0.28 units per frame and far more on a slow frame, so a pickup can sit
  between two consecutive positions with **both** of them outside the radius —
  it is passed straight through and becomes uncollectable exactly when the
  player is going fast enough to care.
- *Swept test:* closest point on the segment instead. Same cost class (one
  clamped projection per pickup, ~28 pickups), and immune to frame rate.

**Chosen:** swept. The alternative fix — inflating the radius until tunnelling
stops — makes pickups feel magnetic at walking speed and still fails on a
long frame.

**Status of alternative:** `rejected — frame-rate-dependent misses`. Pinned by a
test that fails against a point-distance implementation.

## D15 — The autopilot ignores pickups; pickups are seeded onto its path

**Fork:** let the debug autopilot steer toward the nearest pickup (a livelier
demo), or leave it flying its fixed figure-8.

**Chosen:** leave it. The autopilot is the verification workhorse — every
headless screenshot and freeze check drives it — and coupling its steering to
mutable game state would make those checks depend on game tuning. Seeding six
pickups at fixed points on the Lissajous curve gives the demo its collections
for free, with no feedback loop.

**Status of alternative:** `rejected — would couple verification to game tuning`.

## D11 — Particle kinds as compile-time defines over three prebuilt materials

**Fork:** support a second visual style (smoke & embers) by branching on a
uniform inside one material, by duplicating the shader files per style, or by
compiling one shader pair into several materials via `defines`.

- *Uniform branch:* pays the branch cost on every particle in every style, and
  **cannot express smoke at all** — blending is a material property, not a
  uniform, so a normal-blended wisp and an additive spark can never share one
  material.
- *Duplicated shaders:* the motion code would exist twice and drift.
- *`defines`:* one source of truth for motion and billboarding; each kind
  compiles to exactly the code it needs.

**Chosen:** `defines`, with all three materials built at startup so switching
style never stalls on a shader compile mid-session.

**Status of alternatives:** `rejected — a uniform cannot change blending`.

## D12 — One shared ring buffer, seed-partitioned, not two particle systems

Smoke mode draws the *same* instance buffer twice: once with the ember material,
once with the smoke material. Each material discards the instances the other
owns (`fract(aSeed * 37.719) < uSmokeRatio`) through the existing
degenerate-vertex path. One emitter, one ring, no duplicated CPU work — the cost
is one extra vertex pass whose non-matching instances exit immediately.

Smoke draws at `renderOrder = 0` and every additive system at `renderOrder = 1`,
so embers and glow always composite over the wisps.

**Rejected:** per-frame depth sorting of the smoke instances. At the low
per-puff alpha the style uses, sort popping is invisible, and sorting up to 65k
instances every frame is an expensive fix for a problem nobody can see.

## D13 — The trail ribbon is disabled in smoke style

The ribbon is an additive light core. In neon it supplies continuity that
particles alone cannot at sprint speed; in smoke it would contradict the dark
value structure the style depends on, and the wisps already provide that
continuity through their own overlap.

**Status of alternative:** a dark heat-shimmer ribbon would need a refraction
post pass — `deferred — worth trying`. *Revisit hook:* `src/trail/Trail.js`
materials and `params.trailEnabled`.

## D9 — Pages base path from the build command, not an environment variable

**Fork:** GitHub Pages serves a project site from `/<repo>/` while the dev
server serves from `/`. Either key `base` off `command === 'build'`, off a
custom env var set only in the deploy workflow, or use a relative `./`.

- *Env var:* the deployable build becomes a different artifact from the one PR
  CI checked — the deploy path is exercised exactly once, at deploy time.
- *Relative `./`:* works today, but breaks silently the moment routing, workers
  or dynamic imports from nested paths appear.
- *`command === 'build'`:* every build anywhere — local, PR, deploy — produces
  identical asset paths.

**Chosen:** `command === 'build'`. What CI checked is byte-for-byte what ships.

**Status of alternatives:** `rejected — splits the verified artifact from the shipped one`.

## D10 — Deploy verification needs a marker, not a status code

GitHub Pages answers unknown paths with HTTP 200 and a fallback page, so
"the URL responded" is not evidence that anything deployed. The build stamps
`GITHUB_SHA` into the bundle via Vite `define` (`__BUILD_SHA__`, surfaced as
`__app.buildSha`), and verification fetches the hashed asset and greps for the
expected commit.

The same reasoning applies to the CI check itself: a passing check proves
nothing until a failing one has been observed on that exact surface. Proven
fail-first with a throwaway PR carrying a deliberately red assertion — the
check went red at `npm test` (9 tests, 1 failed), and the PR was closed
unmerged.

## D6 — Bundled lil-gui, `?raw` GLSL, plain JS

Minor forks, recorded for completeness: lil-gui ships inside three
(`three/addons/libs/lil-gui.module.min.js`) so no separate dependency; shaders
are real `.glsl` files imported with Vite's built-in `?raw` (syntax highlighting
without `vite-plugin-glsl`, whose only added feature is `#include`); plain JS
because the complexity lives in GLSL, where TypeScript adds nothing.
