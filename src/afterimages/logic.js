// Pure sprint-FX logic — no three.js, no DOM. Afterimages.js owns the meshes and
// calls into this; both particle engines read the mode gates from here too.
//
// Everything is a function of state that is passed in, so the freeze invariant
// holds structurally: at timeScale = 0 the runner does not move and simTime does
// not advance, so no snapshot fires and every strength keeps its value. Nothing
// here integrates, eases, or reads a clock.

/** Hard ceiling on the ghost pool. Each live ghost is one draw call. */
export const MAX_GHOSTS = 16;

// How eroded a ghost is at the instant it is captured. Low, so a fresh
// afterimage is a nearly complete figure.
//
// This deliberately does NOT match the live body's own cap (`uDissolve * 0.62`
// in dissolve.frag.glsl), which was the original anchor — see D36's revision.
// Erosion is height-biased and eats FEET FIRST, so a ghost starting at 0.62
// loses most of its legs the moment it is born. The live runner survives that
// because its plume and trail fill in the lower body; a ghost has neither and
// reads as a floating torso.
export const GHOST_FRESH_EROSION = 0.12;

// The fraction of a ghost's life spent HELD as a whole figure before dissolution
// begins. The chain lays a lifecycle out in space, so this is really a statement
// about how much of the trail nearest the runner is solid: measured live, it buys
// two complete figures at a jog and three at a sprint (captures are distance-gated,
// so running faster fits more of them inside a fixed FRACTION of the fade).
// Without it, an ease-out starts every ghost
// shedding at the instant of capture and the chain never contains a solid one —
// which is a different bug from the tail-heavy one it replaced, in the same term.
export const GHOST_HOLD = 0.18;

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
 * Two phases, and the split is the whole point. The chain lays a ghost's
 * lifecycle out along the ground behind the runner, so the moment a ghost comes
 * apart is also the PLACE it comes apart — which makes this curve a layout of
 * the trail, not just a schedule.
 *
 * - For the first `GHOST_HOLD` of its life a ghost is HELD at its capture
 *   erosion: a complete figure, the runner's own afterimage. Without this the
 *   ease-out below starts eating the freshest ghost at the instant of capture
 *   and the chain is all cloud and no body.
 * - After that it EASES OUT — fast at first, settling as it approaches full
 *   dissolution. An ease-in (this was `t * t`) delays the burst to the end of
 *   life and therefore parks it at the far end of the trail, reading as an
 *   effect that starts behind the tail and travels the wrong way.
 *
 * So: solid figures nearest the runner, the burst immediately behind them, thin
 * dispersing dust at the tail.
 */
export function ghostErosion(strength) {
  const t = 1 - strength; // 0 at capture, 1 at the end of the fade
  // Re-normalized onto the post-hold span, so the ease still lands exactly on
  // FULL_EROSION at the end of the fade rather than being cut short by the hold.
  const u = Math.max(0, (t - GHOST_HOLD) / (1 - GHOST_HOLD));
  return GHOST_FRESH_EROSION + (FULL_EROSION - GHOST_FRESH_EROSION) * u * (2 - u);
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
