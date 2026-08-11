// The runner's vertical state machine: ground, air, wall.
//
// Pure, and a function of scalars only — the caller resolves the city queries
// into `supportY` and `wallTop` and hands those in, the same way
// resolveTargetSpeed takes a resolved speed rather than reading params itself.
// That is what makes every transition testable without a renderer or a world.
//
// FREEZE SAFETY IS STRUCTURAL HERE. Every term multiplies by simDt and there is
// no exponential easing anywhere, so timeScale = 0 is a fixed point by
// construction rather than by each future author remembering an epsilon snap.
// If you add easing to this file, it needs one — see camera.js for why.

import {
  GRAVITY,
  JUMP_VELOCITY,
  WALL_CLIMB_SPEED,
  WALL_MIN_SPEED,
  CREST_BOOST,
  GLIDE_SINK_SPEED,
  GLIDE_MIN_FALL_SPEED,
} from './constants.js';

/** Modes in which holding the key can grab a wall — every airborne state. */
const AIRBORNE = new Set(['air', 'glide']);

/** A runner standing on the ground, before anything has happened. */
export function initialVertical() {
  return { mode: 'ground', y: 0, vy: 0, wallTop: 0 };
}

/**
 * Advance one frame.
 *
 * @param {{mode:string, y:number, vy:number, wallTop:number}} s  previous state
 * @param {object} i
 * @param {number}      i.simDt        seconds on the SIM clock, never real time
 * @param {boolean}     i.jumpHeld     jump key is down right now
 * @param {boolean}     i.jumpPressed  jump key went down this frame (edge)
 * @param {number}      i.supportY     height of the surface under the runner
 * @param {number|null} i.wallTop      roofline of a climbable face in reach
 * @param {number}      i.groundSpeed  horizontal speed, for the mount gate
 * @returns {{mode:string, y:number, vy:number, wallTop:number, event:string|null}}
 *          event is one of takeoff | mount | crest | land, or null
 */
export function stepVertical(s, i) {
  // Every precondition for grabbing a wall, in one place. Splitting the key
  // check out of this and applying it per branch is how the air branch ended up
  // mounting without the key: releasing mid-climb dropped the runner into `air`,
  // which re-grabbed the wall on the very next frame, so the climb continued
  // with vy pinned at zero and no way to let go.
  const canMount =
    (i.jumpHeld || i.jumpPressed) &&
    i.wallTop !== null &&
    i.wallTop !== undefined &&
    i.groundSpeed > WALL_MIN_SPEED;

  if (s.mode === 'wall') {
    const y = s.y + WALL_CLIMB_SPEED * i.simDt;
    // Position is advanced directly rather than integrated from vy, but vy is
    // still reported as the climb speed — everything downstream reads the
    // runner's velocity to decide how fast it is going. Reporting zero here
    // told the emitter the runner was standing still, so the dissolve decayed
    // and the plume switched off for the whole climb.

    // Crest is decided against the roofline STORED at mount time, not against
    // the caller's live query. Once y passes the roof the face stops being
    // climbable and the query goes null, so testing the live value would read
    // the summit as "lost the wall" and drop the runner down its own building.
    if (y >= s.wallTop) {
      return { mode: 'air', y: s.wallTop, vy: CREST_BOOST, wallTop: s.wallTop, event: 'crest' };
    }
    // Letting go, or running off the side of the building, drops you. No
    // downward kick: the fall should start from rest, not from a shove.
    if (!i.jumpHeld || i.wallTop === null || i.wallTop === undefined) {
      return { mode: 'air', y, vy: 0, wallTop: s.wallTop, event: null };
    }
    return { mode: 'wall', y, vy: WALL_CLIMB_SPEED, wallTop: s.wallTop, event: null };
  }

  // `air` and `glide` are one branch on purpose: they differ only in how vy is
  // chosen, and they must agree exactly on mounting and landing. Written as two
  // branches, the mount precondition would be duplicated — which is the split
  // that produced the wall-mount bug the comment above records.
  if (AIRBORNE.has(s.mode)) {
    // Deploy while descending only. Holding the key through a jump has to let
    // the arc play out, and the minimum fall speed keeps the apex — where vy
    // passes through zero — from flickering in and out of the glide.
    const gliding = i.jumpHeld && (s.mode === 'glide' || s.vy < -GLIDE_MIN_FALL_SPEED);

    // Gliding pins the sink. The frame a glide is RELEASED carries that sink
    // speed through unchanged and lets gravity take over from the next frame:
    // letting go is a handoff, not a shove, the same way the wall branch drops
    // from rest rather than kicking downward.
    let vy;
    if (gliding) vy = -GLIDE_SINK_SPEED;
    else if (s.mode === 'glide') vy = s.vy;
    else vy = s.vy - GRAVITY * i.simDt;

    const y = s.y + vy * i.simDt;

    // Mount before landing AND before gliding, deliberately. Holding jump while
    // falling past a wall grabs it rather than touching down or drifting — that
    // IS the traversal move, and it is what lets a descent flow straight back
    // into a climb. A glide that outranked it would make a wall unreachable
    // from the descent that is the main way you arrive at one.
    if (canMount && y < i.wallTop) {
      return { mode: 'wall', y, vy: WALL_CLIMB_SPEED, wallTop: i.wallTop, event: 'mount' };
    }
    if (y <= i.supportY) {
      return { mode: 'ground', y: i.supportY, vy: 0, wallTop: s.wallTop, event: 'land' };
    }

    const mode = gliding ? 'glide' : 'air';
    // Fires on the transition only, so the one-off burst is not re-triggered
    // every frame of the drift.
    const event = mode === 'glide' && s.mode !== 'glide' ? 'glide' : null;
    return { mode, y, vy, wallTop: s.wallTop, event };
  }

  // --- ground ---------------------------------------------------------------

  // Ran off an edge: the surface under us dropped away. Falls from rest rather
  // than snapping down, which is what makes a roof edge a ledge and not a step.
  if (i.supportY < s.y - 1e-6) {
    return { mode: 'air', y: s.y, vy: 0, wallTop: s.wallTop, event: null };
  }

  if (canMount) {
    return { mode: 'wall', y: i.supportY, vy: WALL_CLIMB_SPEED, wallTop: i.wallTop, event: 'mount' };
  }
  if (i.jumpPressed) {
    return {
      mode: 'air',
      y: i.supportY,
      vy: JUMP_VELOCITY,
      wallTop: s.wallTop,
      event: 'takeoff',
    };
  }

  return { mode: 'ground', y: i.supportY, vy: 0, wallTop: s.wallTop, event: null };
}
