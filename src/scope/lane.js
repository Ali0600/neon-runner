// Lane arithmetic and path-mode selection for SCOPE view.

/**
 * Wrap a lane position into [-half, half). Uses modulo rather than a single
 * subtraction so a large overshoot (a huge frame delta, or a lane shortened at
 * runtime from the GUI) still lands inside the lane instead of one lane-length
 * outside it.
 *
 * @returns {{ x: number, wrapped: boolean }}
 */
export function wrapLane(x, half) {
  if (!(half > 0)) return { x, wrapped: false };
  if (x >= -half && x < half) return { x, wrapped: false };

  const span = half * 2;
  const wrappedX = ((((x + half) % span) + span) % span) - half;
  return { x: wrappedX, wrapped: true };
}

/**
 * Which driver owns the runner's path this frame.
 *
 * Scope wins over autopilot, which wins over manual input. Encoded as
 * precedence over the existing boolean flags rather than as a `pathMode` enum:
 * `params` is a plain object, so renaming `autopilot` would make every existing
 * headless check that writes `params.autopilot = true` a silent no-op — the
 * runner would just stand still with no error.
 */
export function resolvePathMode({ scope, autopilot } = {}) {
  if (scope) return 'scope';
  if (autopilot) return 'autopilot';
  return 'manual';
}
