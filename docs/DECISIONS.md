# Design decisions

## Backlog — alternatives worth trying later

- **pmndrs `postprocessing`** (D2) — merged-pass rendering and finer bloom
  controls. *Revisit hook:* `src/post.js` is the only file that knows about the
  composer; its `{ render, setSize, applyParams }` shape is the seam.
- **Heat-shimmer trail for smoke style** (D13) — needs a refraction post pass.
- **Skinned/rigged runner** (D8) — the current figure is a joint hierarchy of
  capsules. *Revisit hook:* `createRunner` in `src/runner.js` builds the joints
  and drives them in one block.

---

## D18 — Ortho billboards use three's built-in `isOrthographic` uniform

**Fork:** the billboard basis needs the direction to the camera. A perspective
camera sits at the view-space origin so that is `normalize(-viewPos)`; an
orthographic camera's rays are parallel along −Z so it is the constant
`vec3(0,0,1)`. Select between them with a hand-rolled `uOrtho` uniform, a
`#define`, or three's built-in.

- *Hand-rolled uniform:* duplicates state three already tracks, and goes stale
  the moment someone adds a camera path and forgets to set it.
- *`#define`:* doubles the material count from 6 (3 kinds × 2 engines) to 12,
  and doubles startup shader compiles.
- *Built-in:* `uniform bool isOrthographic` is injected into every
  `ShaderMaterial`'s vertex and fragment prefix, and the renderer assigns it
  from the active camera in the same refresh block as `projectionMatrix`.
  three's own shaders use the identical ternary.

**Chosen:** the built-in. Zero new uniforms, zero new variants, and the value
cannot desync from the camera because three writes it at draw time.

**Why it mattered:** the previous formula was not merely wrong under ortho, it
was wrong *by an amount that grows toward the screen edges* and is zero at the
centre — the shape of error you tune around instead of noticing.

**Proven fail-first.** Under an orthographic projection, translating the camera
along its own view axis changes only view-space Z, uniformly, so NDC x/y and
depth order are untouched: any correct billboard basis renders a bit-identical
frame. With the fix, dollying 400 units leaves the frame hash unchanged; with
`normalize(-viewPos)` restored, both the hash and the PNG byte length change.

## D19 — Scope is a third path driver by precedence, not a `pathMode` rename

**Fork:** replace the `autopilot` / `forceSprint` booleans with a single
`pathMode: 'manual' | 'autopilot' | 'scope'` enum, or add scope as a third
option resolved by precedence.

The rename costs about eight lines in-repo. The cost that matters is outside it:
`params` is a plain object, so every existing headless check that writes
`__app.params.autopilot = true` would keep succeeding while doing nothing, and
the runner would simply stand still — no error, no warning. That is the exact
failure this project already has a learning about.

**Chosen:** precedence, in one pure `resolvePathMode`. *Revisit hook:* if a
fourth driver appears, rename then and ship a `params` deprecation shim in the
same commit.

## D20 — The event scheduler is a stateless function of sim time

**Fork:** advance the event timeline with an accumulator, or evaluate it as
`f(simTime)` over a cycling sequence.

An accumulator is freeze-safe only for as long as every future author remembers
the `simDt <= 0` guard. A pure function of sim time cannot drift while paused
because there is nothing to drift, and it can be evaluated at any `t` — which is
what will let it pair with the analytic engine's exact time scrubbing.

**Chosen:** stateless. The freeze invariant here is structural rather than
maintained.

**Sharp edge found while building it:** the usual negative-safe modulo
`((t % p) + p) % p` costs a ULP on *positive* inputs. Segment starts are
accumulated sums and mostly not exactly representable, so sampling exactly on a
boundary landed one ULP short and reported the *previous* segment — a one-frame
flicker at every event join. Fixed to `t % p`, corrected only when negative, and
pinned by a test over several interval values.

## D21 — Lane rewind with a full clear, never a treadmill

**Fork:** when the straight lane ends, wrap the runner and clear the particle
buffers, or hold the runner still and move the world past it.

A treadmill needs a synthetic wind of −v_runner. Drag is velocity-dependent in
both engines — `(1 − e^{−kt})/k` analytically, `v *= exp(-uDrag*dt)` in the
compute shader — so that wind changes every particle's decay, and therefore its
`uLength + uStretch * speed` stretch. **The plume being tuned would not be the
plume that ships.** Recorded precisely because a treadmill is the obvious idea.

**Chosen:** wrap and clear. The clear runs *before* the engines update, because
`computeSpawn` interpolates each spawn between the previous and current
position: with a stale previous position, one frame's spawns smear as a single
streak across the entire lane. Verified by asserting the plume's x-span on the
first post-wrap frame is a fraction of a unit rather than the lane width — the
buffer-reset assertions alone pass even with the smear bug present.

## D22 — Lane half-length 2000, not 20000

f32 resolution is 1.2e-4 at |x| = 2000 (0.4% of the 0.028 streak width) but
2.0e-3 at 20000 (**7%**), and the vertex shader's `viewMatrix * position`
subtracts two same-magnitude numbers, so that error lands directly on relative
particle position — visible jitter on exactly the feature being tuned. ±2000
still gives roughly two minutes per traversal at sprint, against a plume whose
whole lifetime is about a second. Exposed as a slider, with this as the reason
not to push it far.

## D23 — The scope camera snaps; the follow rig eases

The follow rig eases and needs epsilon snapping so a paused frame can settle.
The scope camera's target is a pure function of the runner's position, so a
frozen sim gives a constant target and therefore a constant camera — freeze
safety is structural, not tuned. Measured: the scope camera needs ~40 frames to
reach a stable frame after pausing, the follow rig ~330.

The ortho frustum is sized from a world-unit **view height** with `zoom` left at
1 — one honest number in the GUI and one source of truth for world-units-per-
pixel, rather than two controls that mean the same thing.

## D24 — Turn amplitude is capped to what the runner can physically track

Lateral speed is bounded by `speed × sin(MAX_LATERAL)`, so tracking a sine of
amplitude A over duration T needs `2πA/T` of lateral budget. The first version
commanded amplitude 6 over a 1.6 s turn at walking pace and delivered **1.49** —
the control was reporting a number the runner could not reach.

Fixed by lengthening the turn to 3.2 s, running turns at an elevated speed
(direction changes matter most at speed anyway), defaulting the amplitude to 4,
and lowering the slider maximum from 20 to 8. Now delivers 2.77 of a commanded
4. A slider whose top half does nothing is the same class of defect as the
`maxParticles` bug in D17.

## D1 (graduated) — GPGPU ping-pong alongside the analytic engine, not replacing it

Originally deferred; **built in M8**. Both engines now ship, selectable at
runtime, because neither dominates the other:

- *Analytic* — position is a closed form of `(uTime - spawnTime)`. Exact pause
  and scrub, no state textures, and the cost scales with the particles actually
  alive. Cannot express any force that depends on where a particle currently is.
- *GPGPU* — position and velocity live in ping-pong float textures integrated
  each frame. Unlocks the feedback forces this milestone was for: a vortex
  around the runner's recent path, a regather that pulls shed light home when
  the runner stops, and spatial turbulence. Costs a fixed-size compute pass and
  gives up exact scrubbing (Euler integration over a variable timestep).

Measured (2560×1600, DPR 2): analytic **311 fps** at 30k and **151 fps** at 65k;
GPGPU **152 fps** at 30k and **130 fps** at 65k. The GPGPU engine is roughly
twice the cost at 30k but only ~14% more at 65k, because **its compute pass
always covers all 65,536 texels regardless of how many particles are active** —
it pays full simulation price for a partly empty buffer, while the analytic
engine pays only for what is alive.

`timeScale = 0` remains a true freeze in both: skipping `compute()` leaves the
ping-pong index untouched, so the current targets stay bit-identical, and
emission is already gated on the sim clock. Verified pixel-identical across all
four engine × style combinations. What does *not* carry over is exact scrubbing
— the analytic engine can jump to any time, the GPGPU engine can only step
forward.

**Anti-drift measure:** both engines share the fragment shader outright, share
the billboard and sizing maths through `src/shaders/chunks/particleCommon.glsl`,
and share spawn scheduling and initial conditions through
`src/particles/spawnComputation.js`. Only the position source differs.

## D16 — Spawn injection by points pass, not a staged texture upload

**Fork:** get newly spawned particles into the state textures each frame.

- *(a) Spawn-queue texture the compute shader consults:* re-uploads ~2 MB every
  frame while sprinting — exactly the bandwidth the ring buffer exists to avoid
  — and adds frame-stamp bookkeeping to every texel.
- *(b) Staging `DataTexture` + `copyTextureToTexture` region copies:* uploads
  only the spawned slots, but a wrapped ring range has to be decomposed into up
  to three texel rectangles, and the destinations need `initRenderTarget()`.
- *(c) Points pass:* render one 1-pixel point per spawned slot, positioned at
  that slot's texel-centre NDC, straight into the live state target with
  `autoClear` off.

**Chosen:** (c). It uploads exactly the spawned slots — the same bandwidth
profile as the analytic engine's partial buffer ranges — with no rectangle
decomposition, reusing render machinery the project already relies on. Texel
centres are computed as `(col + 0.5) / 256 * 2 - 1`, which is exact in fp32 and
pinned by `test/slotUv.test.js`.

**Status of alternatives:** (b) `deferred — viable fallback` if a driver ever
misplaces point rasterization (the readback probe would catch it);
(a) `rejected — defeats the purpose of a ring buffer`.

## D17 — `maxParticles` clamps the GPGPU draw and spawn ring too

The GPGPU geometry initially left `instanceCount` unset, so it always drew all
65,536 instances and the max-particles slider silently did nothing in that
engine — a control that lies is worse than a missing one. The draw and the spawn
ring now honour it. The **compute** pass deliberately still covers the whole
texture: its cost is fixed, and that is the honest performance story recorded
above rather than something to hide.

---

## D1 (original) — Stateless analytic particles, not GPGPU ping-pong

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
