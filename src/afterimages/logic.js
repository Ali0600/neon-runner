// Pure sprint-FX logic — no three.js, no DOM. Afterimages.js owns the meshes and
// calls into this; both particle engines read the mode gates from here too.
//
// Everything is a function of state that is passed in, so the freeze invariant
// holds structurally: at timeScale = 0 the runner does not move and simTime does
// not advance, so no snapshot fires and every strength keeps its value. Nothing
// here integrates, eases, or reads a clock.

/** Hard ceiling on the ghost pool. Each live ghost is one draw call. */
export const MAX_GHOSTS = 16;

// How eroded a ghost is at the instant it is captured — HIGH, because that is
// what makes a fresh afterimage look like a solid figure.
//
// This reads backwards until you know what each phase renders as. The ghost mesh
// is shaded by a fresnel term (`ghost.frag.glsl`), so an un-eroded ghost is
// bright only where the surface turns away from the camera: a hollow outline,
// not a body. The state that reads as a FULL figure is a ghost whose body has
// already converted into the spark cloud — the sparks are the exact complement
// of the surviving mesh (D38), and near 0.85 they have flown only ~0.1-0.3 world
// units, so they still hold the body's shape while filling it in solid. The
// height bias keeps a mesh remnant at the head and chest on top of that.
//
// So a low value is not "more complete", it is "more outline". Being born at
// 0.85 puts the solid figure at the FRONT of the chain and leaves the whole fade
// window to disperse it into dust.
//
// The old low value dates from before the sparks existed (#15), when the matter
// erosion removed simply vanished and a high birth erosion really did mean a
// legless ghost. Conservation changed what the number means; see D38's third
// revision.
export const GHOST_FRESH_EROSION = 0.85;

// The erosion value that discards every fragment. The shader's threshold is
// `(n + heightBias) - erosion`, where the two-octave noise `n` weights to at
// most 1.0 and heightBias tops out at 0.5 — so 1.5 erodes everything and this
// clears it. The live body's cap can never reach here (0.62 at dissolve 1),
// which is exactly why ghosts need their own erosion term rather than a
// pushed-up uDissolve.
export const FULL_EROSION = 1.55;

// --- mode gates ------------------------------------------------------------
// One source of truth for what sprintFx means. `undefined` reads as 'plume' so
// a params object written before this feature still behaves the old way.

/** Does the continuous sprint plume spawn? */
export function plumeEnabled(sprintFx) {
  return sprintFx !== 'afterimages';
}

/** Are pose snapshots taken? */
export function emitsGhosts(sprintFx) {
  return sprintFx === 'afterimages' || sprintFx === 'both';
}

/** Do the hand/foot streak ribbons emit? Both the mode and the toggle must agree. */
export function limbStreaksActive(sprintFx, limbStreaks) {
  return emitsGhosts(sprintFx) && limbStreaks !== false;
}

// --- glide FX --------------------------------------------------------------
// `glideFx` picks what a glide looks like: 'hands' fires the jet out of the
// runner's palms and holds the arms in a thrust pose, 'streak' keeps whatever
// the sprint FX was already doing. `undefined` reads as 'streak' so a params
// object written before this feature behaves the way it used to.

/** Is the hand-jet glide active right now? */
export function glideHands(glideFx, verticalMode) {
  return glideFx === 'hands' && verticalMode === 'glide';
}

/**
 * Should a new afterimage be captured this frame?
 *
 * The hand-jet is the story during a glide, and a chain of ghosts streaking off
 * the figure competes with it — so captures PAUSE for the duration. Only new
 * ones: the ghosts already in the ring keep their slots and fade out on their
 * own clock, because cutting a live chain off mid-fade would pop.
 */
export function ghostsEmitNow(sprintFx, glideFx, verticalMode) {
  return emitsGhosts(sprintFx) && !glideHands(glideFx, verticalMode);
}

/** Same pause, for the FEET ribbons — and for the hands outside a hands-glide. */
export function limbStreaksEmitNow(sprintFx, limbStreaks, glideFx, verticalMode) {
  return limbStreaksActive(sprintFx, limbStreaks) && !glideHands(glideFx, verticalMode);
}

/**
 * Should the CHEST ribbon emit? It pauses for a hands-glide.
 *
 * The chest trail has no idea a glide is happening, so it kept drawing its
 * ribbon from the runner's back through the whole hover — which reads as a
 * streak trailing out behind, exactly the thing the hand-jet is supposed to
 * replace. Only new samples stop; the existing ones age out over trailFade.
 */
export function chestTrailEmitNow(glideFx, verticalMode) {
  return !glideHands(glideFx, verticalMode);
}

/**
 * Should the two HAND ribbons emit? The mirror image of the pause above.
 *
 * During a hands-glide these are the only ribbons that run, and they run
 * regardless of what `sprintFx` wants — the same bypass, and for the same
 * reason, as the plume gate in `emissionRate`: the glide look is chosen by
 * `glideFx`, so it must not silently depend on the sprint setting. The explicit
 * `limbStreaks === false` toggle still wins, because that is the user turning
 * ribbons off rather than a mode implying it.
 */
export function handStreaksEmitNow(sprintFx, limbStreaks, glideFx, verticalMode) {
  if (glideHands(glideFx, verticalMode)) return limbStreaks !== false;
  return limbStreaksEmitNow(sprintFx, limbStreaks, glideFx, verticalMode);
}

// --- cadence ---------------------------------------------------------------

/**
 * Should a snapshot be taken now?
 *
 * Distance-gated rather than timed, like the trail's MIN_STEP: a frozen or
 * standing runner emits nothing without needing to know anything about dt, and
 * the spacing between ghosts stays even whatever the frame rate. The distance is
 * 3D on purpose — a wall-run climbs on y alone, and a climb that emitted no
 * ghosts would drop the effect exactly where it looks best.
 *
 * @param {?{x,y,z}} prev  position at the last snapshot, or null if there is none
 */
export function shouldSnapshot(prev, pos, dissolve, spacing, minDissolve) {
  // Gate on the glow first, so the no-previous case cannot fire on a runner
  // standing still at the start of a run.
  if (!(dissolve >= minDissolve)) return false;
  if (!prev) return true;
  const dx = pos.x - prev.x;
  const dy = pos.y - prev.y;
  const dz = pos.z - prev.z;
  return dx * dx + dy * dy + dz * dz >= spacing * spacing;
}

// --- fade ------------------------------------------------------------------

/**
 * A ghost's remaining strength, 1 at capture down to exactly 0 at the end of the
 * fade window. Pure f(simTime): recomputed from the stamp every frame rather
 * than decayed into a stored value, so repeated calls at an unchanged simTime
 * return an unchanged answer and a paused frame is bit-identical.
 */
export function ghostStrength(snapT, simTime, fadeSeconds) {
  if (!(fadeSeconds > 0)) return 0;
  const age = simTime - snapT;
  if (age <= 0) return 1;
  if (age >= fadeSeconds) return 0;
  return 1 - age / fadeSeconds;
}

/**
 * The erosion threshold offset for a ghost, computed here rather than in the
 * shader so the value under test and the value rendered are the same number.
 *
 * Runs from a nearly whole figure at capture to past full dissolution at the end
 * of the fade, and depends only on strength — the speed a ghost was captured at
 * changes how bright it is, not how much of it exists, so every ghost vanishes
 * as completely as every other one and none leaves sparkles hanging in the air.
 *
 * The curve EASES OUT — fast at first, settling as it approaches full
 * dissolution. That is a statement about where the effect happens in space, not
 * just in time: the chain lays a ghost's lifecycle out along the ground behind
 * the runner, so the moment a ghost comes apart is also the PLACE it comes
 * apart. An ease-in (this was `t * t`) delays the burst to the end of life and
 * therefore parks it at the far end of the trail, which reads as the effect
 * starting behind the tail and travelling the wrong way. Easing out puts the
 * disintegration immediately behind the runner, where the energy belongs, and
 * leaves the tail as thin dispersing dust.
 *
 * A ghost is still whole at capture (0.12): only WHEN it comes apart moved, not
 * whether it starts complete.
 */
export function ghostErosion(strength) {
  const t = 1 - strength; // 0 at capture, 1 at the end of the fade
  return GHOST_FRESH_EROSION + (FULL_EROSION - GHOST_FRESH_EROSION) * t * (2 - t);
}

// --- ring ------------------------------------------------------------------

/**
 * Append a snapshot, evicting the oldest if the ring is full.
 *
 * Returns the evicted record so the caller can recycle its slot, or null. One
 * eviction at most: the list is never over cap on entry, because this is the
 * only thing that grows it and `trimTo` handles a lowered cap.
 */
export function pushSnapshot(list, rec, maxCount) {
  const cap = Math.max(1, Math.min(MAX_GHOSTS, Math.floor(maxCount)));
  list.push(rec);
  return list.length > cap ? list.shift() : null;
}

/**
 * Shrink the ring to a lowered cap, returning the records dropped. Called when
 * the count param changes, not per frame — this one allocates.
 */
export function trimTo(list, maxCount) {
  const cap = Math.max(1, Math.min(MAX_GHOSTS, Math.floor(maxCount)));
  const dropped = [];
  while (list.length > cap) dropped.push(list.shift());
  return dropped;
}

/** How many ghosts still have any strength left. Allocation-free. */
export function countAlive(list, simTime, fadeSeconds) {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (ghostStrength(list[i].t, simTime, fadeSeconds) > 0) n++;
  }
  return n;
}
