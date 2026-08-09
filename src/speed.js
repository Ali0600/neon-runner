import { WALK_SPEED, SPRINT_SPEED } from './constants.js';

// How fast the runner is trying to go this frame.
//
// Three sources can set it — a held speed, the scope scheduler, and the
// walk/sprint flag — and the order between them matters. Pulling it out as a
// pure function means the precedence is pinned by tests instead of living
// implicitly in the order of branches inside runner.update.

/**
 * @param {object}  o
 * @param {boolean} o.hold          speed lock is engaged
 * @param {number}  o.holdValue     the locked speed, in world units per second
 * @param {boolean} o.sprint        sprint key or forceSprint
 * @param {number} [o.commandSpeed] speed requested by a path driver (scope)
 */
export function resolveTargetSpeed({ hold, holdValue, sprint, commandSpeed }) {
  // The lock wins over everything, including a scope `stop` segment asking for
  // zero — that is the whole point of locking it.
  if (hold) return Math.max(0, holdValue ?? 0);

  // A path driver's request beats the walk/sprint flag. `undefined` means the
  // driver had no opinion; 0 is a real request (a stop) and must not fall
  // through to walk speed.
  if (commandSpeed !== undefined && commandSpeed !== null) return commandSpeed;

  return sprint ? SPRINT_SPEED : WALK_SPEED;
}
