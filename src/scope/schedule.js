// Event scheduler for SCOPE view.
//
// A straight lane only ever shows steady state, so the transients that make the
// effect interesting — turns, sprint pulses, stops — are injected on a schedule.
//
// Everything here is a STATELESS function of sim time. There is no accumulator,
// so it cannot drift while paused: `timeScale = 0` freezes it by construction
// rather than by every future author remembering a `simDt <= 0` guard. It is
// also evaluable at any t, which is what lets it pair with the analytic
// engine's exact time scrubbing.

import { WALK_SPEED, SPRINT_SPEED } from '../constants.js';

// Transient durations, in seconds. Deliberately constants rather than GUI
// sliders: four more controls nobody touches after the first minute. They are
// still cfg-overridable so tests can drive them.
// Turn is the long one: lateral speed is capped at `speed * sin(MAX_LATERAL)`,
// so tracking a sine of amplitude A needs `2*PI*A/T` of lateral budget. A short
// turn simply saturates and the commanded amplitude becomes fiction.
export const DEFAULT_DURATIONS = { turn: 3.2, sprint: 2.4, stop: 3.0 };

// Turns run faster than a cruise: a turn at walking pace has almost no lateral
// budget, and direction changes matter most at speed anyway.
const TURN_SPEED_MIX = 0.55;

// How far ahead the steering aims. Larger = lazier, more sweeping turns.
const LOOKAHEAD = 6;
const MAX_LATERAL = 0.85; // radians away from straight-ahead

/**
 * Build the cycling event sequence. Disabled kinds are dropped, but the cruise
 * segments around them stay, so turning an event off shortens the cycle rather
 * than jamming two transients together.
 *
 * @returns {{ segments: {kind: string, duration: number, start: number}[], period: number }}
 */
export function buildSchedule(cfg = {}) {
  const interval = Math.max(0.1, cfg.interval ?? 3);
  const d = { ...DEFAULT_DURATIONS, ...(cfg.durations || {}) };

  const wanted = [
    ['cruise', interval],
    cfg.turn === false ? null : ['turn', d.turn],
    ['cruise', interval],
    cfg.sprint === false ? null : ['sprint', d.sprint],
    ['cruise', interval],
    cfg.stop === false ? null : ['stop', d.stop],
  ].filter(Boolean);

  const segments = [];
  let start = 0;
  for (const [kind, duration] of wanted) {
    segments.push({ kind, duration, start });
    start += duration;
  }
  // Always non-zero even with every event disabled, so sampling can't divide by
  // zero — with nothing enabled the cycle is simply pure cruise.
  return { segments, period: start };
}

/**
 * Which segment is active at sim time t, and how far into it.
 * Handles negative and arbitrarily large t.
 */
export function sampleSchedule(schedule, t) {
  const { segments, period } = schedule;
  // Only correct for negatives. The usual `((t % period) + period) % period`
  // idiom costs a ULP on positive t — enough to shift a value that sits exactly
  // on a segment boundary back into the previous segment.
  let u = t % period;
  if (u < 0) u += period;
  const cycle = Math.floor((t - u) / period);

  let seg = segments[segments.length - 1];
  let index = segments.length - 1;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (u >= s.start && u < s.start + s.duration) {
      seg = s;
      index = i;
      break;
    }
  }

  const tIn = u - seg.start;
  return { kind: seg.kind, index, tIn, tNorm: tIn / seg.duration, cycle, u };
}

/**
 * Speed profile for a stop: decelerate, sit at exactly zero across the middle
 * third, accelerate back. Returning exactly 0 matters — a near-zero speed still
 * emits particles and never shows the settled state.
 */
export function stopProfile(tNorm) {
  if (tNorm <= 1 / 3) return 1 - tNorm * 3;
  if (tNorm >= 2 / 3) return (tNorm - 2 / 3) * 3;
  return 0;
}

/**
 * Turn a schedule sample into a drive command.
 *
 * Steers toward a TARGET LATERAL OFFSET rather than emitting a raw heading:
 * the runner's velocity easing (ACCEL = 9) lags any commanded heading, so a
 * raw heading accumulates drift and eventually walks out of the lane. Aiming at
 * an offset makes the lane self-centring.
 *
 * @param {number} laneZ current lateral offset from the lane centreline
 * @returns {{ dirX: number, dirZ: number, speed: number, targetZ: number }}
 */
export function driveCommand(sample, cfg = {}, laneZ = 0) {
  const amplitude = cfg.turnAmplitude ?? 6;
  const walk = cfg.walkSpeed ?? WALK_SPEED;
  const sprint = cfg.sprintSpeed ?? SPRINT_SPEED;

  let targetZ = 0;
  let speed = walk;

  switch (sample.kind) {
    case 'turn': {
      // A full sine period returns to 0 at both ends, so the lateral target is
      // continuous across the joins with the neighbouring cruise segments.
      targetZ = amplitude * Math.sin(sample.tNorm * Math.PI * 2);
      // Ease the speed in and out so the joins stay continuous in speed too.
      const ramp = Math.sin(sample.tNorm * Math.PI);
      speed = walk + (sprint - walk) * TURN_SPEED_MIX * ramp;
      break;
    }
    case 'sprint':
      // Half a sine ramps up and back down, so dissolve ramps smoothly and
      // emissionRate's pow(dissolve, 1.4) spikes without a discontinuity.
      speed = walk + (sprint - walk) * Math.sin(sample.tNorm * Math.PI);
      break;
    case 'stop':
      speed = walk * stopProfile(sample.tNorm);
      break;
    default:
      break;
  }

  const heading = Math.max(
    -MAX_LATERAL,
    Math.min(MAX_LATERAL, Math.atan2(targetZ - laneZ, LOOKAHEAD))
  );

  return { dirX: Math.cos(heading), dirZ: Math.sin(heading), speed, targetZ };
}

export { LOOKAHEAD, MAX_LATERAL };
