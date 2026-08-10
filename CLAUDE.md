# NEON RUNNER — agent notes

Stylized GPU particle system in Three.js. Two interchangeable particle engines, two
visual styles, and a SCOPE inspection view. Vite + plain JS, shaders as `.glsl` files
imported with `?raw`.

## Commands

```
npm run dev      # http://localhost:5173
npm test         # vitest, 222 tests
npm run build    # production build
npm run sabotage # mutation harness — proves the tests bite (~35s)
```

## The freeze invariant — a hard gate

**At `params.timeScale = 0`, two consecutively rendered frames must be bit-identical,
and must differ once resumed.** This is the project's standing correctness check and it
has caught several real defects. Re-verify it across **all 12 combinations** — 2 engines
× 2 styles × (follow / scope-ortho / scope-persp) — after touching `runner.js`,
`gui.js`, the camera, or any shader.

Run the 12 with `sprintFx = 'both'`: that activates a strict superset of the renderers
(plume + afterimages + limb streaks + trail), so a freeze leak in any of them surfaces
there, and the two single modes then need only one spot-check each to show the gates do
not leak. **Step until the systems under test are actually live before freezing** —
`__app.afterimages.alive >= 4` and `__app.limbStreaks.samples > 20`, bounded — since a
frame hashed while the new system never ran proves nothing about it. Sprinting is not the
default state either: set `holdSpeed` so the glow gate stays satisfied, or the scope
scheduler cruises below it and you hash a chain of one.

**Plus three vertical states, which the 12 do not reach**: frozen mid-climb, frozen
mid-fall, and frozen standing on a roof. Make the harness assert the runner is actually
in the mode it claims before hashing — a setup that quietly lands on the roof reports a
pass for a mid-air case it never ran.

The follow rig eases on real time and only snaps below its epsilon, so a paused frame is
not stable immediately: `rig.yaw` decays at 2.6/s and needs ~200 frames. Settle by
stepping until the camera stops changing (bounded, and fail if it never does), not by
picking a frame count — and do it before hashing, or the gate reports a regression that
is only the camera still moving.

**Settle on the full camera matrices — `matrixWorld` AND `projectionMatrix` — not on
`rig.yaw`/position.** The FOV punch (`camera.fov = 62 + dissolve * 14`, `camera.js`) eases
on real time and converges ~100 frames *after* the rig's yaw does, so a settle keyed on
the rig alone exits early and the next two frames differ by a hair of projection. That
reports as "mid-fall and on-a-roof break the freeze invariant", with the feature under
test looking guilty; it reproduces just as well with the feature off, which is the tell.
The fov ease does have an epsilon snap and does arrive — the instrument was what needed
fixing.

It holds because everything simulation-side reads the **sim clock** (`simDt`), never real
time. Only the follow camera rig reads real time, so a paused scene can still be orbited.
If you add state that advances, it must read `simDt` or the gate breaks.

Exponential easing never actually arrives, so anything that should settle needs an
epsilon snap — otherwise a "paused" frame creeps forever by sub-pixel amounts.

## Verifying in the browser

The preview tab is hidden, so `requestAnimationFrame` never fires. **Drive frames with
`__app.step(count, dt)`**, not by waiting. `window.__app` exposes `renderer`, `scene`,
`params`, `runner`, `particles`, `gpuEngine`, `trail`, `game`, `scope`, `applyParams`
and `buildSha`.

**Stop the animation loop before hashing** — `renderer.setAnimationLoop(null)`. If a rAF
frame lands between `step()` and `toDataURL()` the capture describes a different frame
than the one you set up, and the results are inconsistent run to run rather than wrong in
a way you would notice. Hashing the same frame twice with no step in between is the check
that separates an unreliable capture from a genuinely moving scene.

**Size the viewport explicitly before measuring anything** (`resize_window`), and reload
after. A pane that resizes under a live page leaves the `EffectComposer` sized to the old
viewport, and it then renders into a bottom-left sub-rectangle of the canvas — which reads
exactly like "most of the scene stopped drawing". `gl.readPixels` on the default
framebuffer is also not trustworthy here (no `preserveDrawingBuffer`); prefer `toDataURL`
immediately after a synchronous render, or a screenshot.

**A frame-hash harness must prove the canvas is real before reporting anything.** On a
0×0 canvas `toDataURL()` returns the six-character string `"data:,"`, every hash compares
equal, and the freeze check reports "frozen: yes, resumes: no" for every configuration —
indistinguishable from a real regression. Assert non-degenerate dimensions and a data URL
long enough to be an image, and throw rather than return a verdict. Related: an
`EffectComposer` sized while the viewport was degenerate keeps clipping to the old size
until a `resize` event fires.

More generally: when a check fails, confirm the instrument can report success before
believing the failure. That has been the actual cause more often than the code has.

## Conventions

**Pure logic lives in dependency-free modules** so it is unit-testable without a renderer:
`scope/schedule.js`, `scope/lane.js`, `scope/rulerTicks.js`, `scope/statsMath.js`,
`game/logic.js`, `speed.js`, `city.js`, `vertical.js`, `particles/ringRanges.js`,
`particles/slotUv.js`, `afterimages/logic.js`. A module
that imports `runner.js` transitively pulls in three and every `.glsl`, and will not load
in plain node — that is why shared constants sit in `src/constants.js`.

**Both particle engines share everything downstream of "I have a position and a
velocity"**: the fragment shader outright, the billboard maths via
`shaders/chunks/particleCommon.glsl`, and spawn scheduling via
`particles/spawnComputation.js`. Only the position source differs. Keep it that way or
they drift.

**`params` is one shared mutable object.** Style-owned keys come from a preset in
`styles.js` and are replaced wholesale on a style switch; engine-owned keys sit below the
spread and must survive it (`test/styles.test.js` pins this). Every system exposes
`applyParams()`, wired through `main.js`.

**A control that silently does nothing is worse than one that is visibly unavailable.**
Disable and relabel controls that a mode supersedes. And any control that changes global
state on the user's behalf owns restoring it — the scrub slider forced a pause and did
not un-force it, which stranded the user.

## Tests

Ship with the change, in the same PR, **proven fail-first**: make it fail against the old
behaviour before trusting it. When sabotaging a file to prove a test bites, checksum it
before and after so the restore is provably clean, and never use `git checkout` to undo a
sabotage on uncommitted work.

`npm run sabotage` (`scripts/sabotage.mjs`) does that mechanically: 37 cases, each
reintroducing one defect and asserting the specific test written to guard it goes red.
**Add a case whenever you add a guard**, and run it before opening a PR — it is not in CI
because it runs the suite once per case.

```
npm run sabotage -- --list          # names only
npm run sabotage -- --only wall     # substring filter, for iterating
```

Four verdicts are failures, not skips: `PATTERN-NOT-FOUND` (its literal source patterns
rot — a rename or a reflow breaks them, so re-run it after touching a targeted file and
after the formatter), `SABOTAGE-NO-OP`, `NOT CAUGHT`, and `WRONG DENOMINATOR` (the
signature of a sabotage that broke an import, so the file's tests never ran and the rest
passed). `CAUGHT BY THE WRONG TEST` means another test masks the one you meant to prove.

The run loop is **async on purpose**: node cannot run a signal handler until the event
loop turns, so a synchronous loop of blocking test runs ignores Ctrl-C entirely and can
leave sabotaged code on disk. Verified by killing it mid-case.

## Workflow

Branch → PR → CI green → squash-merge → verify the deploy. Run `gh pr checks --watch`
**unpiped** so the exit code survives.

After merging, watch the Deploy run, then poll the live URL and grep the hashed
`/assets/index-*.js` for the merge SHA. **GitHub Pages answers unknown paths with HTTP
200**, so a status code proves nothing about what shipped — that is why the build stamps
`__BUILD_SHA__`.

Merges to `main` deploy publicly to https://ali0600.github.io/neon-runner/.

## Docs that ship with the change

`docs/DECISIONS.md` (D1–D34) records design forks, the alternatives rejected and why, and
a backlog of ones still worth trying — the entries are newest-first below the backlog.
`docs/learnings.md` holds transferable concepts. Update both in the same PR as the work,
not as a later cleanup.
