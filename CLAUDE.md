# NEON RUNNER — agent notes

Stylized GPU particle system in Three.js. Two interchangeable particle engines, two
visual styles, and a SCOPE inspection view. Vite + plain JS, shaders as `.glsl` files
imported with `?raw`.

## Commands

```
npm run dev      # http://localhost:5173
npm test         # vitest, 173 tests
npm run build    # production build
```

## The freeze invariant — a hard gate

**At `params.timeScale = 0`, two consecutively rendered frames must be bit-identical,
and must differ once resumed.** This is the project's standing correctness check and it
has caught several real defects. Re-verify it across **all 12 combinations** — 2 engines
× 2 styles × (follow / scope-ortho / scope-persp) — after touching `runner.js`,
`gui.js`, the camera, or any shader.

**Plus three vertical states, which the 12 do not reach**: frozen mid-climb, frozen
mid-fall, and frozen standing on a roof. Make the harness assert the runner is actually
in the mode it claims before hashing — a setup that quietly lands on the roof reports a
pass for a mid-air case it never ran.

The follow rig eases on real time and only snaps below its epsilon, so a paused frame is
not stable immediately: `rig.yaw` decays at 2.6/s and needs ~200 frames. Settle by
stepping until the rig's own state stops changing (bounded, and fail if it never does),
not by picking a frame count — and do it before hashing, or the gate reports a
regression that is only the camera still moving.

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
`particles/slotUv.js`. A module
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

## Workflow

Branch → PR → CI green → squash-merge → verify the deploy. Run `gh pr checks --watch`
**unpiped** so the exit code survives.

After merging, watch the Deploy run, then poll the live URL and grep the hashed
`/assets/index-*.js` for the merge SHA. **GitHub Pages answers unknown paths with HTTP
200**, so a status code proves nothing about what shipped — that is why the build stamps
`__BUILD_SHA__`.

Merges to `main` deploy publicly to https://ali0600.github.io/neon-runner/.

## Docs that ship with the change

`docs/DECISIONS.md` (D1–D29) records design forks, the alternatives rejected and why, and
a backlog of ones still worth trying. `docs/learnings.md` holds transferable concepts.
Update both in the same PR as the work.
