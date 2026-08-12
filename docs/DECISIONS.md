# Design decisions

## Backlog — alternatives worth trying later

- **pmndrs `postprocessing`** (D2) — merged-pass rendering and finer bloom
  controls. *Revisit hook:* `src/post.js` is the only file that knows about the
  composer; its `{ render, setSize, applyParams }` shape is the seam.
- **Heat-shimmer trail for smoke style** (D13) — needs a refraction post pass.
- **Forward-carrying glide** (D39) — trade height for distance instead of the
  hover's constant sink, so a roof jump covers ground like a wingsuit.
  *Revisit hook:* the `gliding` branch in `src/vertical.js`; it would add a
  forward term rather than only pinning `vy`.
- **Skinned/rigged runner** (D8) — the current figure is a joint hierarchy of
  capsules. *Revisit hook:* `createRunner` in `src/runner.js` builds the joints
  and drives them in one block.

---

## D40 — The hand-jet glide bypasses the plume gate, and pauses the chain

**Fork:** a `GLIDING FX` mode where light pours from the palms and the arms hold a thrust
pose, so the jet reads as the thing keeping the runner up. Shipped alongside
`sprintFx` defaulting to `afterimages`.

**The collision those two asks create:** the hand-jet IS plume particles, and
`sprintFx: 'afterimages'` exists precisely to stop the plume **at its source**
(`emissionRate` returns 0 — D35, so live particles age out honestly rather than being
hidden). Shipping both asks naively means the new default silently switches off the new
feature: no error, no warning, just a glide with nothing coming out of it.

- *Render the jet through a separate emitter that the sprint gate never sees:* a second
  spawn path to keep in step with two engines — exactly what `spawnComputation.js` exists
  to prevent.
- *Make hands-glide bypass the gate.*

**Chosen:** the bypass, scoped as narrowly as it can be — `glideHands(glideFx, mode)` is
true only in hands mode and only while the vertical FSM is actually in `glide`. A test
pins that it does not leak to `ground` or `air`, because a bypass that outlived its state
would quietly re-enable the plume in the one mode built to suppress it.

**The pause is a subtraction, not a switch.** Hands mode stops NEW afterimage captures and
new limb-ribbon samples for the duration: a chain streaking off the figure competes with
the jet for the same silhouette, which is the thing the mode exists to show. Ghosts
already in the ring keep their slots and fade on their own clock — cutting a live chain
off mid-fade would pop. Both gates live in `logic.js` beside the existing ones
(`ghostsEmitNow`, `limbStreaksEmitNow`) rather than as extra conditions at the two call
sites, so the two consumers cannot drift apart.

**The emitter swap reuses what was already there.** `fillSpawnContext` sets
`ctx.emitPoints = runner.handPoints` — aliases of the first two `streakPoints`, which are
already world-space hand tips refreshed once per frame. No new geometry, no second set to
keep in step, and it falls back to the body emitters when a partial runner has no
`handPoints` rather than emptying the spawn set and silently killing emission.

**Freeze safety is unchanged:** the thrust pose is a pure `f(mode)` of three constants
with no easing, so a frozen glide holds a frozen pose.

**A tuning note worth keeping:** `rotation.x` on the shoulder is measured from an arm that
**already hangs straight down**, so the thrust pose is a ~0.3 rad tip, not a big sweep. A
first pass used 2.5 rad and put the arms over the head; the tell was the hand points
measuring *above* the runner's head in world space, which is the kind of thing the code
reads as fine and the geometry does not.

**Revised (#27): ribbon ownership is per-ribbon, and the chest trail was the leak.**
The first pass paused "the limb streaks" as a group and never touched the CHEST trail,
which has no glide awareness at all — so through the whole hover it kept drawing a ribbon
off the runner's back, which is exactly what reads as "a streak coming out the back". The
mode had removed the wrong ribbons: the two that should have been running (hands) were
paused, and the one that should have stopped (chest) was not.

Ribbon ownership during a hands-glide:

| ribbon | hands-glide | why |
| --- | --- | --- |
| chest | **off** | it is the streak-out-the-back; the jet replaces it |
| hands (0, 1) | **on** | the jet's own ribbons — this is the effect |
| feet (2, 3) | **off** | the legs are held still; a ribbon off a static foot is a smear |

Two consequences worth naming. The hand ribbons take the same **bypass** as the plume
gate (`handStreaksEmitNow`): the glide look is chosen by `glideFx`, so it must not depend
on `sprintFx` — but the explicit `limbStreaks === false` toggle still wins, because that
is the user turning ribbons off rather than a mode implying it. And they also bypass the
`dissolve > 0.02` **sprint-glow** test, for the same reason `emissionRate` floors the jet:
a hover is not a sprint, so at low glide speed dissolve sits near zero and the palms would
draw nothing at exactly the moment the jet is firing hardest.

The legs are held at fixed angles too (`GLIDE_HIP`, `GLIDE_KNEE`), symmetric rather than
frozen mid-stride — a running cycle under a hover reads as pedalling in mid-air.

**Status of alternatives:** separate emitter — `rejected — a second spawn path for two
engines to keep in step, which is the failure spawnComputation.js exists to prevent`.

## D39 — The glide is a fourth FSM mode, and a wall still outranks it

**Fork:** holding Space while falling should glide. But holding Space in the air already
means "grab a wall if one is in reach", so the new behaviour lands on an occupied key in
an occupied state.

- *A modifier flag on `air`* (`s.gliding`), keeping three modes: fewer states, but every
  consumer that switches on `mode` (`spawnComputation`, the gait, SCOPE's event kinds)
  would have to learn to read a second field to know what the runner is doing — and the
  ones that forgot would silently treat a glide as a free fall.
- *A fourth mode, `glide`.*

**Chosen:** the fourth mode. `mode` stays the single answer to "what is the runner doing",
which is what every downstream reader already assumes.

**Precedence is the real decision.** Inside the airborne branch the order is `canMount` →
land → glide. A wall in reach wins, because arriving at a wall from a descent is the main
way you reach one, and a glide that outranked it would make wall-runs unreachable from the
move that sets them up. `air` and `glide` are handled by ONE branch for the same reason
the file's earlier comment gives: splitting the mount precondition across branches is
exactly what produced the original wall-mount bug, so the two airborne states share the
check rather than each carrying a copy.

**Two properties that had to be deliberate:**

- **`vy` reports `-GLIDE_SINK_SPEED`, never 0.** Four systems read `runner.velocity` to
  decide how fast the runner is moving. The wall branch already carries a comment about
  reporting zero killing the plume for a whole climb; a glide reporting zero would do the
  same over exactly the seconds the effect exists for.
- **Deploy requires an existing fall of `GLIDE_MIN_FALL_SPEED`.** Without it the apex of a
  jump — where `vy` crosses zero — flickers in and out of the glide frame by frame, which
  reads as the jump stuttering rather than as a mode change. Releasing hands back to `air`
  carrying the sink speed rather than applying gravity that frame, matching the wall
  branch's "drops from rest, no shove".

Freeze safety stays structural: every term still multiplies by `simDt` and nothing eases,
so `timeScale = 0` remains a fixed point by construction. `glide` was added to the
parameterized fixed-point test rather than trusted to inherit it.

**The effect reuses the wall-run's seam.** `ctx.climb` already existed to aim the plume
down a wall, because rise is a world-up *uniform* in both engines' shaders and spawn
velocity is the only place a direction can be applied per particle without splitting the
engines apart. `ctx.glide` rides the same expression — folded into one line rather than
added as a second, so the two aimings cannot silently disagree.

**Status of alternatives:** modifier flag on `air` — `rejected — every consumer switches
on mode; a second field is a second thing to forget`. *Forward-carrying glide (trade
height for distance)* — `deferred — worth trying` as a variant; the user picked the hover.
*Revisit hook:* `GLIDE_SINK_SPEED` in `src/constants.js` and the `gliding` branch in
`src/vertical.js`.

## D38 — The eroded matter becomes the sparks

**Fork:** an afterimage used to die by erosion eating the silhouette *inward*. It should
scatter *outward*, as particles.

- *Emit through `particles.emitBurst`:* reuses the existing engine. But bursts are
  analytic-only, event-shaped and CPU-injected, and this has to be continuous, per-ghost,
  engine-independent and exactly frozen at `timeScale = 0`.
- *A second draw of the same body geometry as `THREE.Points`.*

**Chosen:** the second draw. The mesh discards where
`(noise + heightBias) - uErosion < 0`; the points draw the **complement** of that set —
`excess = uErosion - (noise + heightBias) > 0` — which is precisely the matter the mesh
has just given up. The two sets are exact opposites by construction, so nothing is drawn
twice, nothing falls between them, and there is no second timing system to keep in step:
one `uErosion` drives both. Flight distance is a function of `excess`, so the scatter
inherits the dissolve's feet-first order for free, and the whole thing stays a closed form
of values that are already pure `f(simTime)` — the freeze invariant needs no new argument.

The points share the merged geometry AND the same uniforms object as the mesh, so the two
cannot drift; `setSlotVisible` owns both, since debris outliving its body (or the reverse)
is the obvious failure.

**Two things the maths had to get right, both found only by rendering it:**

- **Displacing along the surface normal preserves the shape.** `excess` varies smoothly
  across the body, so neighbouring vertices move together and the cloud reads as an
  inflated copy of the limb — ghost outlines, not debris. Each vertex needs its own
  direction (full sphere, only biased outward) *and* its own speed; the per-particle speed
  spread is what actually breaks the silhouette up.
- **Sparks exist only in the back half of a ghost's life,** because nothing has eroded
  before that. An age-proportional fade therefore dims them through exactly the window
  worth watching. Age enters as a gate (`smoothstep(0.0, 0.22, uStrength)`), not a ramp.

**Revised (#17): the burst has to happen where the runner is, not where the trail ends.**
Both curves above were tuned as if a ghost's life were only a timeline. It is also a
*place*: the chain lays the lifecycle out along the ground, so the moment a ghost comes
apart is the point in space it comes apart. Erosion eased IN, so disintegration arrived
late in life and therefore at the far end of the trail, and the spark gate held full
brightness to the end, so the most-scattered ghost was also the brightest thing on screen.
Together they made the effect crescendo at its tail and read as running backwards.

Erosion now eases OUT (`t * (2 - t)`), putting the burst immediately behind the runner,
and the gate is a plain ramp (`uStrength`) so the tail thins into dust. The measured
brightness envelope along the chain went from peaking at the tail to
`0.07 … 1.00 … 0.12` with the peak just behind the runner. Nothing about the full-body
property changed — a ghost is still whole at capture; only WHEN it comes apart moved.

**Revised again (#20): "full" is a property of the SHADER, not of how much data survives.**
Two attempts read the user's word "full" as "not yet eroded" — #15 set the birth erosion
low for that reason, and #18 (reverted by #19) held it there longer. Both made the chain
*more* of what was being complained about. An annotated screenshot settled it: the arrow
labelled *"a 'Full' body image"* pointed at a ghost around **0.8–0.9** erosion, and the
one labelled *"isn't full"* at a **fresh** ghost.

The reason is in `ghost.frag.glsl`: the mesh is shaded by a fresnel term
(`pow(1 - |N·V|, 2.2)`), bright at grazing angles and near-zero face-on. An un-eroded
ghost is therefore a **hollow outline** — a low birth erosion maximizes the emptiest-
looking state. The figure that reads as solid is the one whose body has converted into
the spark cloud: at 0.85 the sparks have flown only ~0.1–0.3 world units, so they still
hold the body's shape while filling it in, and the height bias keeps a mesh remnant at
the head and chest.

`GHOST_FRESH_EROSION` is therefore **0.85**, not 0.12. Nothing else changed — the
ease-out to `FULL_EROSION` still runs, so the whole fade window is now spent dispersing a
solid figure into dust instead of first eroding an outline into one.

The old low value was correct *for its time*: before #16 the eroded matter simply
vanished, so a high birth erosion really did mean a legless ghost. Conservation changed
what the number means, and the comment defending 0.12 outlived the mechanism it was
reasoning about — which is why it survived three rounds of looking straight at it.

**Rejected:** *raise `ghostIntensity` instead* — `rejected — brightness does not fill a
hollow shell; the fresnel leaves the interior dark at any gain`. *Fade the fresnel in over
life so a fresh mesh renders solid* — `deferred — worth trying` if the mesh silhouette
ever needs to be legible at birth, but it fights the spark conversion for the same pixels.
*Revisit hook:* the `fres` term in `src/shaders/ghost.frag.glsl`.

**Status of alternatives:** `emitBurst` — `rejected — analytic-only, event-shaped, and
CPU-injected; this needs continuous per-ghost emission in both engines`.

## D37 — The limb streaks are four more trails, not one multi-source ribbon

**Fork:** the sprint needs long light streaks off the hands and feet. The existing chest
ribbon already does exactly this, once.

- *One geometry with four sources:* three fewer draw calls.
- *Four instances of `createTrail`, behind optional hooks.*

**Chosen:** four instances. Each ribbon needs its own oldest-first sample array, its own
minimum-step test **against its own last sample**, and a contiguous triangle-strip draw
range — packing four into one buffer means either per-ribbon draw-range bookkeeping or
degenerate-triangle stitching, to save three draw calls in a scene that already runs a
multi-pass composer. Reuse also inherits the ortho-correct billboarding and the ribbon's
existing freeze proof rather than restating either.

`createTrail(params, opts)` grew four hooks — `getPoint`, `getWidth`, `shouldEmit`,
`getVisible` — each defaulting to precisely what the chest ribbon did before, including
the `+1.0` chest offset that used to be inline in `update`. The chest ribbon had no tests
at all, so `test/trail.test.js` now pins those defaults; the whole risk of the refactor is
a default that quietly stopped matching.

**Why the streak sources are not `emitPoints`.** Those are the elbow and knee *pivots*,
they sit mid-limb, and the plume picks from them at random — appending four tip points
would have changed where the plume comes from as a side effect of adding streaks. The tips
are a separate `runner.streakPoints`.

**Status of alternatives:** one multi-source geometry — `rejected — bookkeeping for three
draw calls`.

## D36 — An afterimage is a copy of the pose, not a re-derivation of it

**Fork:** a ghost needs the runner's pose. The gait is 8 joint rotations plus a bob and a
lean, all pure functions of `(phase, amp, gait)` — so either could work.

- *Extract the gait into a pure module* (`gait.js`) and have both the live runner and each
  ghost derive joint angles from it. Unit-testable, and the obvious "don't repeat
  yourself" answer.
- *Copy the ten `matrixWorld`s* off the live body at capture time into a per-ghost
  `uniform mat4 uJoints[10]`.

**Chosen:** the matrix copy. `runner.update` already calls `updateWorldMatrix` before
anything else reads the runner, so the matrices are exact and free at the moment of
capture. It is also *unconditionally* right: it picks up the lean, the bob, the air tuck
and the wall-climb orientation without any of them being restated, whereas a second
consumer of the gait maths is a second thing to keep in step — the failure this repo has
hit before, where two paths answering the same question drift apart and only one has a
test. A ghost's pose never changes after capture, so there is nothing for the pure version
to buy back.

The cost is that `runner.bodyMeshes` becomes an ordered public contract (it is the
`aJoint` index), which is called out where it is defined.

**Status of alternatives:** pure gait extraction — `deferred — worth trying` if a second
consumer ever appears. *Revisit hook:* the gait block in `src/runner.js`, and
`Afterimages.capture` is the only other reader of the pose.

**Why ghosts carry their own erosion uniform.** The body's fragment shader caps erosion at
`uDissolve * 0.62`, deliberately short of full — so a ghost driven by a pushed-up
`uDissolve` could never reach nothing. `ghostErosion` supplies its own value, running up
past the shader's `noise + heightBias` ceiling of 1.5 so an expired ghost leaves nothing.

**Revised (same day, on user feedback): a fresh ghost is NOT anchored to the live cap.**
The original rule was "a fresh ghost matches the body it peeled off", i.e. it started at
`dissolve * 0.62`. That was wrong, and it shipped looking wrong: erosion is height-biased
and eats **feet first**, so at full sprint a newborn ghost had already lost most of its
legs and the chain read as a row of floating torsos. The live runner survives the same
erosion only because its plume and trail fill in the lower body — a ghost has neither.
Fresh erosion is now a flat `GHOST_FRESH_EROSION = 0.12` and the curve depends on **age
alone**, not on capture speed: how fast you were going changes how *bright* a ghost is,
not how much of it exists.

The ramp is also **squared in age** rather than linear. Alpha is the gentle half of the
fade and erosion the destructive half; letting brightness lead keeps a ghost a readable
figure for most of its life and brings it apart near the end. At half strength a linear
ramp sits at 0.84 — already past where the height bias eats the legs — where the squared
one is at 0.48.

The general lesson, recorded in `docs/learnings.md`: matching an effect to a neighbouring
one is only right if they sit in the same context. The body and its ghosts looked like the
same object to reason about and were not, because only one of them had a plume.

## D35 — Sprint FX is a mode, and turning the plume off means not spawning it

**Fork:** the inFamous-style afterimage sprint is a *second* look, not a
replacement. How should it sit beside the existing particle plume?

- *A style preset key:* free GUI wiring, but style presets are replaced wholesale
  on a switch — flipping neon↔smoke would silently reset the user's choice of
  effect. A style is a palette; this is a different effect.
- *A boolean "also draw afterimages":* half the verification surface, but the new
  look could never be seen on its own, which is the main thing you want while
  tuning it.
- *A three-way engine-owned mode* `plume | afterimages | both`.

**Chosen:** the three-way mode, engine-owned (below the spread in `params.js`),
default `plume` so nothing changes for an existing user. The three gates
(`plumeEnabled`, `emitsGhosts`, `limbStreaksActive`) live in
`src/afterimages/logic.js` as the single source of truth, rather than each system
testing the string itself — a mode added to the dropdown but missed by one system
is exactly the silent no-op this repo keeps re-learning.

**How `afterimages` mode turns the plume off:** by returning 0 from
`emissionRate`, not by hiding the meshes. Hiding would freeze a plume mid-air and
leave the SCOPE readouts reporting particles nobody can see; stopping the source
lets the live ones age out on their own. One-off **bursts** (takeoff, landing,
pickups) deliberately survive the gate — they are event feedback, not sprint
plume, and losing them would make jumps feel dead in the new mode.

**Status of alternatives:** style-preset key — `rejected — a style switch would
reset it`; boolean overlay — `rejected — the new look could never be inspected
alone`.

## D34 — The SCOPE wall is a prop; the climb itself is scripted

**Fork:** SCOPE needed a wall for the `wallrun` event. The lane is a straight
line with no city in it — declutter hides the buildings there anyway — so the
wall had to come from somewhere.

- *Real geometry the runner collides with:* consistent with follow view, but the
  runner's lane position is an **integration**, not a closed form. A wall placed
  from sim time could never line up with where the runner actually is, and a
  wall placed from the runner's position would slide along ahead of it during the
  run-up. Neither is stationary at the moment it matters.
- *Script the climb, draw a prop:* `driveCommand` publishes `climb`, `runner.js`
  supplies a synthetic `wallTop` from it, and the mesh is drawn where that climb
  is happening.

**Chosen:** the prop. Its position is a pure function of `runner.position`,
exactly like `scopeCamera`'s centreline, so it freezes and scrubs with everything
else. The synthetic wall also stops existing above its roofline — the same rule
`nearestFace` applies to a real building — so the crest fires identically in both
views rather than through a second code path.

Two things only the rendered frame could have told us:

- **A slab is edge-on in SCOPE.** The camera looks straight down −Z, so the face
  the runner climbs is a one-pixel sliver. The wall is deliberately *deep along
  the lane* instead, because its cross-section is the only thing on screen.
- **Centred on the runner's own z, half the block sits between the camera and the
  runner** and hides the entire effect behind a black rectangle. It is offset
  entirely behind them.

**Status of alternatives:** real collidable geometry in the lane — `rejected —
the runner's lane position is integrated, so nothing placed from sim time can
line up with it`.

## D33 — Space is one verb, and the wall decides what it means

**Fork:** *Second Son* has no wall-run button — holding the Light Speed dash makes
Delsin run over obstacles and up walls automatically, and jump is a separate
button pressed *during* that run. The user asked instead for "hold Space near a
building while running". Three ways to reconcile them:

- *Two keys:* Space to jump, another to climb. Honest, and one more thing to
  learn for a sandbox whose whole input surface is WASD + Shift.
- *Automatic on contact:* sprint into a wall and climb it, game-accurate. But
  every accidental brush with a building becomes a climb, and the user asked for
  a deliberate control.
- *One key, context decides:* tap = jump, hold with a wall in reach and moving
  above `WALL_MIN_SPEED` = climb.

**Chosen:** one key. The wall-in-reach test is what disambiguates, so the same
press means "jump" in the open and "climb" against a building — and holding it
while running at a tower does the thing you meant without a second press at the
wall.

Mounting requires actual speed (`WALL_MIN_SPEED = 8`), so leaning on the key
while walking into a wall does not levitate you up it; that gate is what keeps
"hold Space" from being a general anti-gravity toggle.

**Status of alternatives:** two keys — `rejected — a second binding for a mode
the first one can infer`. Fully automatic — `deferred — worth trying` as an
option; *revisit hook:* it is the `canMount` predicate in `src/vertical.js`, and
dropping the key term from it is the whole change.

## D32 — The vertical axis is a pure state machine, frozen by construction

**Fork:** the runner had no y axis at all — `group.position.y = 0` ran
unconditionally every frame. Gravity, a jump impulse and a climb could go
straight into `runner.update` beside the existing steering, or into a separate
pure module.

- *In `runner.update`:* fewer moving parts, and it is where the velocity already
  lives. But `runner.js` imports three and every `.glsl`, so none of it could be
  unit-tested, and this project's entire test suite is pure modules.
- *A pure module:* `stepVertical(state, input) -> state` over scalars, with the
  caller resolving the city queries first — the same shape as
  `resolveTargetSpeed`.

**Chosen:** the pure module. It bought the thing that matters most here: **the
freeze invariant is unit-tested.** Every term multiplies by `simDt` and nothing
eases, so `timeScale = 0` is a fixed point by construction, and `test/vertical.js`
asserts exactly that for all three modes — a regression now fails in
milliseconds instead of in a twelve-combination browser gate.

Two defects came out of the browser rather than the tests, and both are now
pinned:

- **The climb reported `vy = 0`.** Position was advanced directly, so velocity
  was not needed to move — but the emission gate, the dissolve ramp, the gait and
  the trail all read the runner's velocity to decide how fast it is going. They
  concluded the runner was standing still, and *the plume switched off for the
  entire climb*, which is most of what the feature exists to show.
- **The mount precondition was split across branches.** The ground branch tested
  the key, the air branch did not. Releasing mid-climb dropped the runner into
  `air` for one frame, which re-grabbed the same wall on the next — the climb
  continued with `vy` pinned at zero and the key did nothing. Both halves of the
  pair are tested now; only the negative one catches it.

**Status of alternatives:** inline in `runner.update` — `rejected — untestable,
and the freeze invariant is the project's hard gate`.

## D31 — A follow camera clears architecture by pulling IN, not by pushing OUT

**Fork:** the rig lerps to a computed point with nothing stopping it entering a
building. Two ways to keep it out: push the desired point out of any box it has
entered (reusing `slideXZ`, already written for the runner), or pull it in along
the sightline from the runner until the view is clear.

- *Push out:* one line, and it reuses the runner's collision. But `slideXZ`
  resolves to the **nearest** face, which is frequently the far one — measured
  in the browser, the camera popped from z=36.1 through to z=38.3 on a tower
  spanning 30.4–37.7, i.e. to the opposite side of the building from the runner
  it is supposed to be following.
- *Pull in:* a segment-vs-slab test from the runner to the desired point, taking
  the nearest blocker. Keeps the camera on the runner's side by construction.

**Chosen:** pull in (`viewClearance`). The push-out version was implemented and
rejected on measurement, not on inspection — it looked entirely correct in code
review.

A floor under the pull-in fraction was also tried and removed. It reads as
kinder than collapsing onto the runner, but when the available clearance is
smaller than the floor it puts the camera back **inside** the wall, which is
strictly worse — and that is exactly the case that arises when the orbit is
dragged to look through a building the runner is standing against.

**Status of alternatives:** push-out — `rejected — resolves to the nearest face,
which flips the camera to the wrong side of the building`. Minimum pull-in
distance — `rejected — reintroduces the collision it was meant to soften`.

## D30 — Buildings replace the pylons, and the layout becomes shared data

**Fork:** the backdrop was 90 instanced "pylons" — 0.18–0.48 units wide, on a
jittered ring at radius 40–190, placed with unseeded `Math.random()`. Their own
comment recorded why they were thin: *"these are distant light columns, not
architecture. A wide pylon near the camera reads as a flat coloured bar across
the frame."* Making them climbable means reversing that.

- *Keep the pylons, add separate climbable towers:* two systems describing the
  same kind of object, drifting independently.
- *One building field, near ones climbable, far ones backdrop:* one layout, one
  draw call, one source of truth.

**Chosen:** one field — 8 climbable towers inside the play area (r 30–92) and 62
skyline buildings beyond (r 104–195), all from `buildCity()` in `src/city.js`.

Three things fell out of it that were not obvious going in:

- **The layout had to become shared data.** The renderer, the runner's collision
  and the camera's wall avoidance all read the same array. Three descriptions of
  one city kept in step by hand is the failure this project has already seen
  between a display and a measurement.
- **Seeded, unlike the pylons.** The frame-hash harness compares renders across
  runs; a skyline that differs per load makes every one of those comparisons
  meaningless. `mulberry32(CITY_SEED)`, and a test asserts a different seed gives
  a different world so the determinism test cannot pass vacuously.
- **The pylon comment was right, and it is about uniformity rather than width.**
  A wide *uniformly emissive* face reads as a coloured bar; a dark body with
  small lit windows, corner seams and a bright roofline reads as a building. The
  first attempt at the facade shader lit the entire face by accident (see
  `docs/learnings.md`) and looked exactly like the bar the comment warned about,
  which is a fair demonstration of the point.

**Status of alternatives:** keeping the pylons as a separate far ring —
`deferred — worth trying` if the skyline ever needs to extend past the ground
plane, where real geometry stops being affordable. *Revisit hook:* `createScene`
takes the city array, so a second decorative band is an extra `createBuildings`
call with its own config.

## D28 — A control that enters a mode owns leaving it

The scrub slider forced `timeScale = 0` so a single frame could never mix two
times — correct on its own. But nothing ever gave the time scale back: returning
scrub to zero left the world paused, and the only way out was to know that a
slider in a *different folder* had been changed on your behalf. A safety measure
became a trap, and the user hit it.

**Chosen:** the scrub borrows the time scale and hands it back.

- Moving off zero stores the current `timeScale` (once) before pausing.
- Returning to zero restores exactly that value — verified restoring `0.5`, not
  a hardcoded `1`, so a deliberately slowed sim survives a scrub.
- Switching to the GPGPU engine mid-scrub releases it too, since that path
  already forces `scopeScrub = 0` (D26) and would otherwise strand the pause.
- A **`▶ resume`** button is the escape hatch, and also un-pauses a plain manual
  pause — the state a confused user is most likely to be in.

**Rule this generalises to:** any control that changes global state on the
user's behalf owns restoring it. If it can only be undone by knowing what it
secretly did, it is a one-way door.

## D29 — Speed lock overrides magnitude only, and greys what it supersedes

**Fork:** for tuning you want the motion held constant so the only variable is
the setting being dragged. Either suppress the scope events entirely, or
override just the speed.

**Chosen:** override the **magnitude** only. Direction still comes from whichever
path driver is active, so scope turns keep steering while speed stays flat —
verified holding 12 u/s across every event kind including `stop` (min 12.00)
while lateral swing still reached 3.21.

Precedence lives in one pure `resolveTargetSpeed` (hold → path-driver command →
walk/sprint flag) rather than implicitly in the order of branches inside
`runner.update`, so it is pinned by tests. A commanded `0` is a real request and
must not fall through to walk speed — that distinction is what makes scope stops
work at all.

The velocity easing (`ACCEL = 9`) is deliberately kept, so the runner converges
on the held speed in about half a second rather than teleporting; the readout
shows achieved speed, which tracked 8 / 17 / 26 to within 0.2%.

Range runs to 30, past `SPRINT_SPEED` (17), to exaggerate streak stretch beyond
what normal play reaches. Above sprint the dissolve is already saturated.

**Greying:** with the lock on, `sprint pulses`, `stops` and `force sprint` can no
longer do anything, so they are disabled and relabelled rather than left live.
Same reasoning as D17 and D24 — a control that silently does nothing is worse
than one that is visibly unavailable.

## D25 — Ruler ticks in-canvas, labels in the DOM

**Fork:** draw the scope ruler's number labels as canvas-texture sprites, or as
DOM elements positioned by projecting a world point.

- *Sprites:* appear in a screenshot, but need a texture per zoom level to stay
  crisp under an orthographic camera whose scale is a free parameter, and they
  are in the canvas — so bloom can reach them and they perturb the frame hash
  the freeze invariant depends on.
- *DOM:* crisp at any device pixel ratio and any scale, structurally unable to
  bloom, cannot affect the canvas hash, and verifiable by DOM assertion (label
  count, text, monotonic positions) rather than by reading pixels.

**Chosen:** DOM. **Stated cost:** the labels do not appear in a canvas-only
screenshot, so an apparently bare ruler in a screenshot is not evidence the
ruler is broken.

Ticks themselves stay in-canvas as `LineSegments` at colour `0x2b4b66`
(luma ≈ 0.27, under both styles' bloom thresholds of 0.75 and 0.62) and are
rebuilt only when the tick set actually changes, so a frozen frame stays stable
and there are no per-frame DOM writes.

## D26 — Readouts carry their provenance; scrub is analytic-only

Two very different measurement paths feed the same panel, so the panel says
which one produced the numbers:

- **Analytic:** the CPU already holds the spawn and velocity arrays, so the
  **alive count is exact** — the number most likely to be misread is not an
  estimate. Speed, plume length and spread re-evaluate the closed form over a
  **stride** across the whole ring, never a contiguous slice: a contiguous slice
  samples one arbitrary age band, which is how this project previously got a
  "zero live particles" reading from a perfectly healthy engine.
- **GPGPU:** needs a texture readback, so it uses
  `readRenderTargetPixelsAsync` — the synchronous variant **silently no-ops** on
  an out-of-range rect and leaves the buffer untouched, which is
  indistinguishable from "everything is dead". Throttled, one request in flight,
  with a generation counter so a result landing after an engine or lane change
  is discarded rather than shown.

Cross-validated: at a steady cruise the two independent paths reported 131 and
139 alive against a closed-form prediction of 133.

**Scrub** moves only the *render* clock (`uTime = simTime + scrub`), applied
after spawning so spawn history is never rewritten, and it forces the sim to
pause so one frame can never mix two times. It is **disabled** in the GPGPU
engine rather than approximated: Euler integration over a variable timestep
cannot reconstruct a past frame from a timestamp. Verified reversible — scrubbing
away and back returns the exact original frame hash.

## D27 — One owner for pickup visibility

`Game.update` rewrites `mesh.visible` every frame, so declutter hiding the
pickups was immediately overridden and two enormous glowing rings dominated the
inspection view. Visibility now has a single owner — `Game` itself, via
`params.game && !params.scope` — rather than two writers fighting each frame.
The same shape as the "two writers on one element's visibility" entry already in
`docs/learnings.md`, which is why it was recognised on sight.

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
