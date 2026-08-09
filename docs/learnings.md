# Learnings

## Stateless (analytic) particles

Instead of storing each particle's current position and integrating it every
frame, store only its *initial conditions* (spawn point, spawn time, velocity,
lifetime) and compute the current position in the vertex shader as a closed-form
function of `age = uTime - spawnTime`.

**Why it came up:** it is what lets 65,000 particles run with the CPU touching
only the few hundred slots spawned this frame — and what makes pause and slow-mo
exact, since nothing accumulates error over time.

**Takeaway:** if a particle's motion has a closed form, don't simulate it — the
GPU can evaluate the formula cheaper than you can store the state.

## Ring buffer + partial attribute uploads

A fixed-capacity buffer with a moving write head, sized so that
`capacity >= maxSpawnRate * maxLifetime`. Because a particle is guaranteed dead
by the time the head laps back to its slot, there is no free list and no
compaction — you just overwrite.

**Why it came up:** re-uploading a 65k-particle attribute buffer every frame is
~2.4 MB of traffic per attribute. Uploading only the spawned slice is ~7 KB.

**Takeaway:** `BufferAttribute.addUpdateRange(start, count)` takes **component**
offsets (item index × itemSize), not item indices, and you can call it twice in
one frame — which is exactly what a wrapped ring write needs. three clears the
ranges itself after upload.

## Additive blending destroys colour before it destroys brightness

Thousands of additive sprites sum toward white long before any single one looks
bright. The first build had a vivid magenta/cyan palette that rendered as a flat
white blob.

**Why it came up:** the fix was not fewer particles — it was making each one
dimmer and narrower, and restricting the white-hot core to `pow(shape, 8.0)`
instead of `pow(shape, 3.0)`, so only the true centre of a streak whitens.

**Takeaway:** with additive blending, per-particle intensity is the knob, not
particle count. If the palette is washing out, dim the sprite before you thin the
crowd.

## Exponential easing never arrives

`pos += (target - pos) * (1 - exp(-k * dt))` is the standard framerate-
independent smoothing, and it is *asymptotic* — the remaining distance shrinks
forever but never reaches zero.

**Why it came up:** the `timeScale = 0` freeze test compared two rendered frames
and they differed. The simulation was genuinely frozen; the camera was still
creeping by ~3 × 10⁻⁵ units per frame, which is invisible but flips low-order
pixel bits.

**Takeaway:** any easing that should eventually *settle* needs an epsilon snap.
Without one, "at rest" is a state your system never actually enters.

## A frame-hash harness must prove the canvas is real before reporting anything

The freeze check compares two rendered frames by hashing `canvas.toDataURL()`.
On a canvas with zero dimensions that call returns the six-character string
`"data:,"` — so every hash is equal, and the harness reports **"frozen: yes,
resumes: no"** for every configuration regardless of what the simulation does.
It looks exactly like a real regression, and it cost a diagnosis chasing a
non-existent bug in the runner.

**Why it came up:** a fresh preview tab was never sized, so the canvas was 0×0.
Two independent readings gave it away — `simTime` advanced and the runner had
moved three world units, while the hash did not change. That combination is
impossible if rendering is happening.

**Takeaway:** any check that compares rendered output needs a liveness assertion
on the surface itself — non-degenerate dimensions, and a data URL long enough to
be an actual image — and should throw rather than return a verdict when they
fail. The related trap: an `EffectComposer` sized while the viewport was
degenerate keeps clipping to the old size until a `resize` event fires, so
content appears cut off at a hard edge long after the window is correct.

## A billboard formula encodes an assumption about the projection

`normalize(-viewPos)` is "the direction to the camera" only because a
perspective camera sits at the origin in view space. Under an orthographic
projection every view ray is parallel, and the answer is the constant
`vec3(0,0,1)`. Using the perspective form under ortho rotates every billboard by
`atan(|viewPos.xy| / |viewPos.z|)` — **zero at frame centre, growing toward the
edges**.

**Why it came up:** adding an orthographic inspection view meant every streak
would have been subtly twisted, worst exactly where you'd be reading the plume's
outer envelope. three ships `isOrthographic` as a built-in uniform on every
`ShaderMaterial` precisely because its own shaders hit this.

**Takeaway:** any shader deriving a direction *to the camera* from a position
has a projection assumption baked into it. The test that catches it is a
symmetry one: under ortho, dollying the camera along its view axis must leave
the frame bit-identical, because only view-space Z changes and it changes
uniformly. That assertion is provably red against the perspective formula.

## The negative-safe modulo idiom is not free on positive inputs

`((t % p) + p) % p` is the standard way to get a non-negative remainder. On a
positive `t` it still round-trips through an addition and a second modulo, and
that can cost a ULP — enough to move a value that sits exactly on a boundary
into the previous bucket.

**Why it came up:** event-schedule segment starts are accumulated sums and
mostly not exactly representable. Sampling exactly at a boundary returned the
previous segment, which would have shown up as a one-frame flicker at every
event join — the sort of thing dismissed as a rendering glitch for weeks.
`t % p`, corrected only when negative, is exact for positive input.

**Takeaway:** when a defensive idiom exists to handle one case, check what it
costs the common case. Test exactly on boundaries, not just around them.

## Closed-form vs integrated simulation is a real trade, not an upgrade

The analytic engine computes a particle's position as a function of its age;
the GPGPU engine integrates position and velocity in ping-pong float textures.
The integrated one is not simply "better": it unlocks forces that depend on
where a particle currently is (a vortex around a path, an attractor that pulls
particles home), and it gives up the ability to jump to an arbitrary time,
because Euler steps over a variable timestep are not reproducible from a
timestamp.

**Why it came up:** running both side by side made the cost visible — the GPGPU
compute pass covers every texel whether or not a particle occupies it, so at 30k
active particles it costs about twice the analytic engine, and at 65k only ~14%
more. A fixed-size simulation is cheap only when the buffer is full.

**Takeaway:** if motion has a closed form, keeping it closed-form buys exact
pause, scrub, and cost proportional to what is alive. Reach for integrated state
when behaviour genuinely depends on current state — and expect to pay a
constant, not a proportional, price.

## A UI control that silently does nothing is worse than a missing one

The GPGPU render geometry never had `instanceCount` set, so it always drew all
65,536 instances. The max-particles slider kept working perfectly in the
analytic engine and did **nothing** in the GPGPU one — no error, no warning, and
the frame rate barely moved, which is exactly what you would expect from a
slider that works.

**Why it came up:** it surfaced only from a benchmark that reported almost
identical GPGPU cost at 30k and 65k. The number looked odd before the control
did.

**Takeaway:** when a shared control reaches two implementations, assert it takes
effect in both — read back the value the system actually holds
(`geometry.instanceCount`, triangles drawn), not the parameter you set. A
performance measurement that refuses to change is a good place to go looking.

## Scope a GPU readback probe to where the data actually is

Verifying the GPGPU simulation, I read back the bottom-left 64×64 of a 256×256
state texture and got zero live particles — an alarming result that looked like
the whole engine was dead. The engine was fine: the ring buffer's write head was
around row 116, and the corner I sampled had last been written a full lap
earlier, so everything in it was correctly expired.

**Why it came up:** reading the whole texture instead showed 3,794 live
particles, and zero after emission stopped and time passed — which is the real
proof that spawning and expiry both work.

**Takeaway:** a partial readback of a circular buffer samples an arbitrary point
in its history. Either read the whole thing or aim at the head — and treat a
zero result from a narrow probe as a question about the probe first.

## Discrete-time collision needs the path, not the position

A per-frame "is the player within radius of the target" check silently assumes
the player cannot cross the target between two frames. That assumption breaks
exactly when things get fast: at 17 units/second the runner moves ~0.28 units
per frame, and a slow frame multiplies that. Both endpoints land outside a
1.6-unit radius while the segment between them passes right through the middle.

**Why it came up:** the fix is to test the swept segment (closest point on the
line from last position to current) rather than the endpoint. Same cost, no
frame-rate dependence. The tempting alternative — enlarging the radius until
misses stop — trades a correctness bug for a feel bug and still fails on a
long frame.

**Takeaway:** anything sampled once per frame and compared against a threshold
should ask "what if it crossed between samples?" — and the answer belongs in the
test suite, because the bug only appears at speeds you may not hit while
developing.

## Additive and normal-blended particles in one scene need an explicit order

Additive blending is order-independent (addition commutes), which is why the
neon style never needed to think about draw order. The moment a normal-blended
system joins it, order decides the image: smoke drawn *after* the embers would
wash them out, drawn *before* them it correctly sits behind.

**Why it came up:** smoke mode renders the same instance buffer twice — ember
material additive, smoke material normal-blended — so the two passes had to be
explicitly ordered with `renderOrder` (smoke 0, everything additive 1) rather
than left to three's distance sort.

**Takeaway:** as soon as one transparent system in a scene is not additive, draw
order is part of the design and belongs in code, not left to the default sort.

## Check what a debug property actually means before trusting it

Diagnosing invisible smoke, I read `material.program` on the smoke material, got
`false`, and had a ready explanation: the shader never compiled. It was wrong —
the property simply is not the live per-render handle. Toggling `mesh.visible`
and diffing `renderer.info.render` showed +1 draw call and +60,000 triangles:
the smoke was drawing perfectly and was just too dark to see against black.

**Why it came up:** the false negative was *plausible* and pointed at a
completely different fix (shader compilation) than the real one (colour values).

**Takeaway:** a debug property that reports a failure is a claim like any other.
Confirm the instrument can report success before you act on its negative —
measuring the observable effect (draw calls, triangles, pixels) beats reading an
internal that may not mean what its name suggests.

## A hidden browser tab does not run requestAnimationFrame

`renderer.setAnimationLoop` is rAF-backed, and browsers throttle rAF to zero in a
backgrounded or hidden tab. Every headless verification of this project initially
reported `speed: 0` and an unmoving runner, which looked exactly like a broken
movement system.

**Why it came up:** the tell was `document.hidden === true` plus a frame counter
that never advanced. The fix was to factor the loop body into `frame(dt)` and
expose `__app.step(count, dt)`, so verification drives frames directly.

**Takeaway:** anything you intend to verify headlessly needs an entry point that
does not depend on the browser deciding to paint. That hook also makes the
verification *deterministic* — fixed `dt`, exact frame counts — which is better
than screenshotting real time anyway.
