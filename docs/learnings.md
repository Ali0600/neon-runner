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
