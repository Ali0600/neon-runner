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

## A face-local coordinate that is constant on that face

For an axis-aligned box, a point on the face whose normal is `±z` always has
`|localZ| == halfDepth` — that coordinate carries no information *on that face*.
Only the two coordinates spanning the face vary across it.

**Why it came up:** the building shader drew corner seams with
`max(smoothstep(hw-t, hw, |x|), smoothstep(hd-t, hd, |z|))`, intending "near a
vertical corner". On every `±z` face the second term is 1 everywhere, so the
whole facade lit up instead of just its edges — and the fix is to measure along
the same axis the window grid already picks (`abs(normal.x) > 0.5 ? z : x`).

**Takeaway:** when shading per-face, derive face-local coordinates from the
normal and use only the two that vary; a term built from the face's own normal
axis is a constant, and a constant inside a `smoothstep` is a flat wash.

## Read the driver's shader log, not `material.program`

three creates the program object before linking, so `material.program` is
truthy for a shader that failed to compile. The real evidence is
`gl.getShaderInfoLog(program.fragmentShader)` and
`gl.getProgramParameter(program.program, gl.LINK_STATUS)`.

**Why it came up:** a `float col` shadowing the later `vec3 col` produced
`ERROR: 0:246: 'col' : redefinition`, and the buildings silently vanished with
only `INVALID_OPERATION: useProgram: program not valid` in the console — a
message that names no file, no line and no cause. This project had already been
misled once by `material.program` in the opposite direction, reporting a working
material as uncompiled.

**Takeaway:** `material.program` answers "was a program object allocated", never
"did it compile". Call `renderer.compile()` and read the info logs; the driver
names the line.

## Verify a rendered value by differencing, not by eye

To decide whether a surface is drawing what you think, sample the framebuffer at
a projected world point twice — once with the object visible, once hidden — and
subtract. The difference is that object's contribution, isolated from bloom,
fog, tone mapping and anything drawn in front of it.

**Why it came up:** a facade looked far too bright in one style and plausible in
the other, and there were three candidate explanations (particles in front, fog,
the shader). Differencing gave (116,30,12) — decisively the building — and after
the fix (1,1,2). Guessing from the screenshot had already produced two wrong
theories.

**Takeaway:** always check the sample point is inside the frustum first and fail
loudly if not; an off-screen `readPixels` returns black, which reads exactly
like "the object contributes nothing".

## A collider padded for one actor swallows another actor's ray origin

A camera sightline test grows each obstacle by the camera's radius so the near
plane never clips a surface. But the runner stands, and climbs, at its *own*
smaller radius from a wall — which is inside the padded box. The ray origin is
then inside the obstacle, the slab test returns `tMin = 0`, and the camera
collapses onto the runner.

**Why it came up:** `BODY_RADIUS` is 0.45 and `CAM_RADIUS` is 0.6, so this was
true for the whole of every wall-run, not for some corner case. Measured as the
camera sitting 1.5 units from the runner instead of 9.2.

**Takeaway:** when a query pads geometry, check whether the query's own origin
can fall inside the padding. If it can, skip that object — an obstacle you are
already touching cannot occlude the view of you.

## Report the velocity even when you did not integrate with it

A state machine advanced the runner's height directly (`y += speed * dt`) and
reported `vy = 0`, because it did not need a velocity to move. Everything
downstream — the emission gate, the dissolve ramp, the gait, the trail — reads
`runner.velocity` to decide how fast the runner is going, and unanimously
concluded it was standing still.

**Why it came up:** the particle plume switched off for the entire wall-run,
which is the single thing that feature exists to show. Nothing errored; the
climb worked perfectly and looked empty.

**Takeaway:** if a value is part of the interface other systems read, it has to
be correct even when your own code does not consume it. "I did not need it" is
not a reason to leave it at zero — a stale or zeroed field on a shared object is
indistinguishable from a real measurement.

## Check a precondition in one place, not once per branch

Grabbing a wall required a key held, a wall in reach, and enough speed. The
ground branch tested all three; the air branch tested two. Releasing mid-climb
dropped the runner into `air` for one frame, which re-grabbed the same wall on
the next — an oscillation that looked exactly like the key doing nothing.

**Why it came up:** the two branches were written minutes apart and each read
correctly on its own. Only driving the real input path exposed it.

**Takeaway:** compute a compound precondition once, above the branches, and let
every branch use that single name. And test the negative case — the positive
("does grab a wall") passed throughout.

## A screenshot of a hidden tab can capture a partial composite

Driving frames with `__app.step()` in a tab that never runs `requestAnimationFrame`
means the browser's compositor has no natural moment to grab a finished frame.
A capture taken right after a single `step()` can come back part-rendered — here,
the left third of the scene with the rest black — which reads exactly like
geometry occluding everything.

**Why it came up:** three rounds were spent hunting a non-existent occlusion bug.
`gl.readPixels` at the runner's projected position returned a bright pixel the
whole time: the scene was fine and the screenshot was not. Stepping several
frames before capturing fixed it.

**Takeaway:** when a screenshot disagrees with a pixel you can measure, believe
the measurement. Render a few frames before capturing, and confirm a suspicious
frame with `readPixels` at a projected world point before debugging what you
think you see.

## A synchronous loop cannot handle Ctrl-C

Node runs signal handlers as JavaScript callbacks, which need a turn of the event
loop. A program whose main loop is entirely synchronous — a `for` over blocking
`execFileSync` calls, say — never yields, so `process.on('SIGINT', …)` does not
run until the work is already finished.

**Why it came up:** the mutation harness edits a source file, runs the suite,
then restores it. Its signal handlers existed to guarantee a Ctrl-C could not
leave sabotaged code on disk. Killing it mid-case proved they never fired: the
child ran all 23 cases and exited 0. Making the loop async (`spawn` + `await`)
fixed it — exit 130, handler message printed, file byte-identical.

**Takeaway:** if a program must clean up on a signal, its main loop has to be
async. And test that by actually killing it: this is a guard whose passing case
looks identical whether it works or is absent entirely.

## Settle on everything the measurement depends on, not a proxy for it

A "step until it stops moving" loop is only as good as the state it compares. The
follow rig eases yaw, pitch, distance *and* a speed-driven FOV punch; the first
three converge in a couple of hundred frames and the FOV takes about a hundred
more. A settle keyed on the rig's own fields therefore returns while the
projection matrix is still creeping, and the next two frames differ by a hair.

**Why it came up:** the freeze gate reported that mid-fall and standing-on-a-roof
had broken — with the afterimages feature, just added, the obvious suspect. It
had nothing to do with it: the same states failed identically with the feature
switched off, and every CPU-side value I diffed between the two frames was
byte-identical. Only dumping the camera's full `matrixWorld` and
`projectionMatrix` showed `fov` still moving by ~1.9e-4 per frame. The FOV ease
does have an epsilon snap and does arrive; the instrument stopped watching too
early.

**Takeaway:** a convergence check must observe every input to the thing being
measured — for a rendered frame that is the whole camera, matrices included, not
the rig fields you happen to have named. And when a gate goes red right after a
change, re-run it with that change disabled before debugging the change: "it
fails the same way with the feature off" costs one run and moves the search to
where the bug actually is.

## A merged geometry can carry a skeleton in one attribute

Ten separate limb meshes are ten draw calls per copy. Merging them into one
buffer with a per-vertex `aJoint` index, and passing the poses as
`uniform mat4 uJoints[10]`, makes each copy a single draw call — the vertex
shader picks its own matrix. The parts are rigid, so no skinning weights are
needed, and `mat3(joint)` transforms normals directly at unit scale.

**Why it came up:** afterimages needed up to 16 copies of the runner's body. As
`group.clone()` that is 160 draw calls; merged it is 16. Two gotchas: attributes
must be attached *before* `mergeGeometries` (it drops any not present on every
input, and the parts here disagreed about `uv`), and the merged bounds describe a
figure at the origin, so `frustumCulled` has to be off or shader-posed copies get
culled while plainly on screen.

**Takeaway:** when many copies of a rigid articulated object are needed, index
the parts in an attribute and pass the transforms as a uniform array, rather than
cloning the hierarchy.

## Additive fade belongs in the alpha, once

Additive blending is `(SrcAlpha, One)`, so source alpha already scales the whole
contribution. Multiplying a fade factor into the colour *as well* squares it, and
the tail of a fade disappears far earlier than the numbers suggest.

**Why it came up:** ghost strength runs 1 to 0 over the fade window. Feeding it
to both `col` and the alpha made the chain look short and stubby against a
strength curve that was provably linear.

**Takeaway:** pick one channel for an additive fade and let the others stay pure.

## Matching a neighbour's constant only works if it sits in the same context

A value copied from a related system carries that system's surroundings with it as
an unstated assumption. Afterimages were anchored to the live runner's own
erosion — "a fresh ghost should match the body it peeled off" — which sounds
obviously right and shipped looking wrong.

**Why it came up:** the erosion is height-biased and eats feet-first, so at full
sprint the live body is already ~60% gone below the knees. The runner reads fine
anyway because its plume and trail fill in the lower half. A ghost has no plume,
so the identical number left it a floating torso. The two looked like the same
object to reason about; only one of them had something covering its legs.

**Takeaway:** before copying a constant from a neighbouring effect, ask what else
is on screen that makes it work there. If the new context is missing any of it,
the shared number is a coincidence, not a rule — and re-derive it from what the
new thing has to look like on its own.

## Split a two-channel fade so the destructive half arrives last

When something fades by two mechanisms at once — brightness and disintegration,
opacity and blur, volume and filtering — running both linearly makes the subject
unreadable halfway through its life. Ramping the destructive channel as the
square of age keeps it whole while the gentle channel does the early work.

**Why it came up:** ghosts fade by alpha *and* by erosion. Linear erosion put a
mid-life ghost at 0.84 of full dissolution, past the point where the height bias
eats the legs, so the chain lost its shape immediately. Squaring it puts the same
ghost at 0.48 — still a figure — and the chain now reads as figures that dim and
then come apart, which is what the reference footage shows.

**Takeaway:** identify which channel destroys legibility and delay it; a fade is
usually more readable when the channels are not on the same curve.
