import { describe, it, expect } from 'vitest';
import { stepVertical, initialVertical, wallSlideVelocity } from '../src/vertical.js';
import {
  GRAVITY,
  JUMP_VELOCITY,
  WALL_CLIMB_SPEED,
  WALL_MIN_SPEED,
  CREST_BOOST,
  GLIDE_SINK_SPEED,
  GLIDE_MIN_FALL_SPEED,
  WALL_LATERAL_SPEED,
} from '../src/constants.js';

const DT = 1 / 60;

/** Default inputs: standing still on flat ground, no wall, no key. */
function input(over = {}) {
  return {
    simDt: DT,
    jumpHeld: false,
    jumpPressed: false,
    supportY: 0,
    wallTop: null,
    groundSpeed: 0,
    ...over,
  };
}

/** Run n frames with fixed inputs, collecting every event fired. */
function run(state, over, n) {
  const events = [];
  let s = state;
  for (let k = 0; k < n; k++) {
    s = stepVertical(s, input(over));
    if (s.event) events.push(s.event);
  }
  return { state: s, events };
}

describe('stepVertical — ground', () => {
  it('stays put with no input', () => {
    const s = stepVertical(initialVertical(), input());
    expect(s).toMatchObject({ mode: 'ground', y: 0, vy: 0, event: null });
  });

  it('takes off on a fresh press', () => {
    const s = stepVertical(initialVertical(), input({ jumpPressed: true }));
    expect(s.mode).toBe('air');
    expect(s.vy).toBe(JUMP_VELOCITY);
    expect(s.event).toBe('takeoff');
  });

  it('does not take off from a held key alone', () => {
    // Otherwise resting a finger on the key makes the runner bounce every frame.
    const s = stepVertical(initialVertical(), input({ jumpHeld: true }));
    expect(s.mode).toBe('ground');
    expect(s.event).toBeNull();
  });

  it('mounts a wall instead of jumping when one is in reach', () => {
    const s = stepVertical(
      initialVertical(),
      input({ jumpPressed: true, wallTop: 20, groundSpeed: WALL_MIN_SPEED + 1 })
    );
    expect(s.mode).toBe('wall');
    expect(s.event).toBe('mount');
    expect(s.wallTop).toBe(20);
  });

  it('mounts from a key already held, without a fresh press', () => {
    // Running at a building with jump already down is the natural way to reach
    // one; requiring a re-press at the wall would make the move fiddly.
    const s = stepVertical(
      initialVertical(),
      input({ jumpHeld: true, wallTop: 20, groundSpeed: WALL_MIN_SPEED + 1 })
    );
    expect(s.mode).toBe('wall');
  });

  it('will not mount below the minimum speed', () => {
    // "when you are close to a building AND are running" — walking into a wall
    // and leaning on the key should not levitate you up it.
    const slow = stepVertical(
      initialVertical(),
      input({ jumpPressed: true, wallTop: 20, groundSpeed: WALL_MIN_SPEED - 0.01 })
    );
    expect(slow.mode).toBe('air');
    expect(slow.event).toBe('takeoff');
  });

  it('falls from rest when the surface drops away', () => {
    // Running off a roof edge is a ledge, not a step down.
    const onRoof = { mode: 'ground', y: 20, vy: 0, wallTop: 20 };
    const s = stepVertical(onRoof, input({ supportY: 0 }));
    expect(s.mode).toBe('air');
    expect(s.y).toBe(20);
    expect(s.vy).toBe(0);
    expect(s.event).toBeNull(); // stepping off is not an event worth a burst
  });

  it('rides a rising surface without going airborne', () => {
    const s = stepVertical(initialVertical(), input({ supportY: 3 }));
    expect(s.mode).toBe('ground');
    expect(s.y).toBe(3);
  });
});

describe('stepVertical — air', () => {
  it('accelerates downward under gravity', () => {
    const s = stepVertical({ mode: 'air', y: 5, vy: 0, wallTop: 0 }, input());
    expect(s.vy).toBeCloseTo(-GRAVITY * DT);
  });

  it('returns to exactly the launch height', () => {
    // A jump that lands somewhere other than where it took off is the tell for
    // an integration that drifts.
    let s = stepVertical(initialVertical(), input({ jumpPressed: true }));
    let frames = 0;
    while (s.mode === 'air' && frames < 1000) {
      s = stepVertical(s, input());
      frames++;
    }
    expect(frames).toBeLessThan(1000); // bounded: an endless jump must fail, not hang
    expect(s.mode).toBe('ground');
    expect(s.y).toBe(0);
    expect(s.event).toBe('land');
  });

  it('reaches the apex the constants predict, minus one step of Euler error', () => {
    let s = stepVertical(initialVertical(), input({ jumpPressed: true }));
    let apex = 0;
    for (let k = 0; k < 200 && s.mode === 'air'; k++) {
      s = stepVertical(s, input());
      apex = Math.max(apex, s.y);
    }
    // Continuous motion would reach v^2/2g. Semi-implicit Euler applies gravity
    // before the step, so it undershoots by about v*dt/2 — with these constants
    // that is 0.09 units, and asserting the closed form to 2dp would fail on
    // arithmetic that is entirely correct. Pin the real relationship instead:
    // just under the ideal, by no more than a frame's worth of travel.
    const ideal = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
    expect(apex).toBeLessThan(ideal);
    expect(apex).toBeGreaterThan(ideal - JUMP_VELOCITY * DT);
  });

  it('lands on a roof, not through it', () => {
    const s = stepVertical({ mode: 'air', y: 20.1, vy: -9, wallTop: 0 }, input({ supportY: 20 }));
    expect(s.mode).toBe('ground');
    expect(s.y).toBe(20);
  });

  it('grabs a wall mid-fall rather than landing', () => {
    const s = stepVertical(
      { mode: 'air', y: 2, vy: -5, wallTop: 0 },
      input({ jumpHeld: true, wallTop: 30, groundSpeed: WALL_MIN_SPEED + 1 })
    );
    expect(s.mode).toBe('wall');
    expect(s.event).toBe('mount');
  });

  it('does NOT grab a wall while falling past it with the key released', () => {
    // The other half of the pair above, and the one that matters: without it,
    // letting go mid-climb drops you into `air` for exactly one frame and the
    // next frame grabs the same wall again. The climb continues with vy pinned
    // at zero and the key does nothing — measured in the browser before this
    // test existed.
    const s = stepVertical(
      { mode: 'air', y: 2, vy: -5, wallTop: 0 },
      input({ jumpHeld: false, wallTop: 30, groundSpeed: WALL_MIN_SPEED + 1 })
    );
    expect(s.mode).not.toBe('wall');
  });

  it('keeps falling frame after frame once released beside a wall', () => {
    // The single-frame check above can pass while the state still oscillates
    // wall -> air -> wall, so assert the descent actually accumulates.
    const beside = { wallTop: 30, groundSpeed: WALL_MIN_SPEED + 1, jumpHeld: false };
    const { state } = run({ mode: 'air', y: 20, vy: 0, wallTop: 30 }, beside, 10);
    expect(state.mode).toBe('air');
    expect(state.vy).toBeLessThan(-1);
    expect(state.y).toBeLessThan(20);
  });

  it('fires land exactly once', () => {
    const { events } = run({ mode: 'air', y: 0.05, vy: -2, wallTop: 0 }, {}, 30);
    expect(events.filter((e) => e === 'land')).toHaveLength(1);
  });
});

describe('stepVertical — wall', () => {
  const onWall = () => ({ mode: 'wall', y: 5, vy: 0, wallTop: 30 });
  const climbing = { jumpHeld: true, wallTop: 30, groundSpeed: 0 };

  it('climbs at a constant speed', () => {
    // Second Son's Light Speed does not slow down when it turns vertical.
    const s = stepVertical(onWall(), input(climbing));
    expect(s.y).toBeCloseTo(5 + WALL_CLIMB_SPEED * DT);
    expect(s.mode).toBe('wall');
  });

  it('reports the climb speed as vy', () => {
    // Position is advanced directly here, so vy is not needed to move — but
    // everything downstream (emission gate, dissolve ramp, gait, trail) reads
    // the runner's velocity to decide how fast it is going. Reporting 0 told
    // them the runner was standing still and switched the plume off for the
    // entire climb, which is most of the effect this feature exists to show.
    expect(stepVertical(onWall(), input(climbing)).vy).toBe(WALL_CLIMB_SPEED);
  });

  it('does not re-check speed once attached', () => {
    // groundSpeed is ~0 during a climb by definition: the velocity is vertical.
    // Re-applying the mount gate here would throw the runner off instantly.
    expect(stepVertical(onWall(), input(climbing)).mode).toBe('wall');
  });

  it('crests at the roofline with an upward boost', () => {
    const s = stepVertical({ mode: 'wall', y: 29.9, vy: 0, wallTop: 30 }, input(climbing));
    expect(s.mode).toBe('air');
    expect(s.y).toBe(30);
    expect(s.vy).toBe(CREST_BOOST);
    expect(s.event).toBe('crest');
  });

  it('crests even though the live query goes null at the top', () => {
    // Above the roofline the face stops being climbable, so the caller reports
    // no wall. Reading that as "lost the wall" would drop the runner down the
    // building it just finished climbing, one frame short of the summit.
    const s = stepVertical(
      { mode: 'wall', y: 29.99, vy: 0, wallTop: 30 },
      input({ jumpHeld: true, wallTop: null, groundSpeed: 0 })
    );
    expect(s.event).toBe('crest');
    expect(s.mode).toBe('air');
  });

  it('fires crest exactly once', () => {
    const { events } = run({ mode: 'wall', y: 29.5, vy: 0, wallTop: 30 }, climbing, 40);
    expect(events.filter((e) => e === 'crest')).toHaveLength(1);
  });

  it('drops from rest when the key is released', () => {
    const s = stepVertical(onWall(), input({ ...climbing, jumpHeld: false }));
    expect(s.mode).toBe('air');
    expect(s.vy).toBe(0);
    expect(s.event).toBeNull();
  });

  it('drops when it runs off the side of the building', () => {
    const s = stepVertical(onWall(), input({ jumpHeld: true, wallTop: null, groundSpeed: 0 }));
    expect(s.mode).toBe('air');
    expect(s.vy).toBe(0);
  });

  it('releasing mid-climb does not fire land until the ground', () => {
    let s = stepVertical(onWall(), input({ ...climbing, jumpHeld: false }));
    expect(s.event).toBeNull();
    const { events, state } = run(s, {}, 120);
    expect(events).toEqual(['land']);
    expect(state.y).toBe(0);
  });
});

describe('stepVertical — glide', () => {
  // A falling runner, holding the key, well clear of the ground.
  const falling = (vy = -6) => ({ mode: 'air', y: 20, vy, wallTop: 0 });
  const held = (over = {}) => input({ jumpHeld: true, supportY: 0, ...over });

  it('engages while descending with the key held', () => {
    const s = stepVertical(falling(), held());
    expect(s.mode).toBe('glide');
    expect(s.event).toBe('glide');
  });

  it('does NOT engage on the way up', () => {
    // The whole point of the descending gate: holding the key through a jump
    // has to let the arc play out rather than cutting the rise short.
    const s = stepVertical({ mode: 'air', y: 3, vy: JUMP_VELOCITY, wallTop: 0 }, held());
    expect(s.mode).toBe('air');
    expect(s.vy).toBeLessThan(JUMP_VELOCITY); // still under gravity
  });

  it('does not engage at the apex, where vy is near zero', () => {
    // Without a minimum fall speed the apex flickers in and out of glide on
    // consecutive frames, which reads as the jump stuttering.
    const s = stepVertical({ mode: 'air', y: 5, vy: -GLIDE_MIN_FALL_SPEED * 0.5, wallTop: 0 }, held());
    expect(s.mode).toBe('air');
  });

  it('does not engage without the key', () => {
    expect(stepVertical(falling(), input()).mode).toBe('air');
  });

  it('sinks at a constant speed, frame after frame', () => {
    const { state, events } = run({ mode: 'glide', y: 20, vy: -GLIDE_SINK_SPEED, wallTop: 0 },
      { jumpHeld: true }, 30);
    expect(state.mode).toBe('glide');
    expect(state.vy).toBe(-GLIDE_SINK_SPEED);
    expect(state.y).toBeCloseTo(20 - GLIDE_SINK_SPEED * DT * 30, 6);
    expect(events).toEqual([]); // engaging fires once, not every frame
  });

  it('reports the sink as vy rather than zero', () => {
    // Four systems downstream read runner.velocity to decide how fast the
    // runner is moving. The wall branch already had this exact bug: reporting
    // zero told the emitter it was standing still and killed the plume.
    const s = stepVertical(falling(), held());
    expect(s.vy).toBe(-GLIDE_SINK_SPEED);
  });

  it('falls far slower than a free fall over the same span', () => {
    const g = run({ mode: 'glide', y: 40, vy: -GLIDE_SINK_SPEED, wallTop: 0 }, { jumpHeld: true }, 60);
    const free = run({ mode: 'air', y: 40, vy: 0, wallTop: 0 }, {}, 60);
    expect(g.state.y).toBeGreaterThan(free.state.y + 5);
  });

  it('releasing returns to air carrying the current vy, with no shove', () => {
    const s = stepVertical({ mode: 'glide', y: 20, vy: -GLIDE_SINK_SPEED, wallTop: 0 }, input());
    expect(s.mode).toBe('air');
    expect(s.vy).toBe(-GLIDE_SINK_SPEED);
    expect(s.event).toBe(null);
  });

  it('resumes accelerating once released', () => {
    let s = stepVertical({ mode: 'glide', y: 20, vy: -GLIDE_SINK_SPEED, wallTop: 0 }, input());
    const first = s.vy;
    s = stepVertical(s, input());
    expect(s.vy).toBeLessThan(first);
  });

  it('lands from a glide and fires land exactly once', () => {
    const { state, events } = run({ mode: 'glide', y: 0.5, vy: -GLIDE_SINK_SPEED, wallTop: 0 },
      { jumpHeld: true }, 40);
    expect(state.mode).toBe('ground');
    expect(events.filter((e) => e === 'land')).toHaveLength(1);
  });

  it('a wall in reach still wins over gliding', () => {
    // The precedence case. Holding the key past a wall IS the traversal move,
    // and a glide that outranked it would make wall-runs unreachable from any
    // descent — which is the main way you reach one.
    const s = stepVertical(falling(), held({ wallTop: 30, groundSpeed: WALL_MIN_SPEED + 1 }));
    expect(s.mode).toBe('wall');
    expect(s.event).toBe('mount');
  });

  it('mounts a wall from inside a glide', () => {
    const s = stepVertical(
      { mode: 'glide', y: 20, vy: -GLIDE_SINK_SPEED, wallTop: 0 },
      held({ wallTop: 30, groundSpeed: WALL_MIN_SPEED + 1 })
    );
    expect(s.mode).toBe('wall');
    expect(s.event).toBe('mount');
  });

  it('does not mount from a glide below the minimum speed', () => {
    const s = stepVertical(
      { mode: 'glide', y: 20, vy: -GLIDE_SINK_SPEED, wallTop: 0 },
      held({ wallTop: 30, groundSpeed: WALL_MIN_SPEED - 1 })
    );
    expect(s.mode).toBe('glide');
  });
});

describe('wallSlideVelocity', () => {
  const MAX = WALL_LATERAL_SPEED;
  // A face whose outward normal points along -x, i.e. the runner is climbing the
  // building's +x side. Its tangent is therefore the z axis.
  const N = { nx: -1, nz: 0 };
  const slide = (vx, vz, n = N, max = MAX) => wallSlideVelocity(vx, vz, n.nx, n.nz, max);

  it('drops velocity pushed straight into the wall', () => {
    // Holding forward against a face cannot move you through it. This is the
    // half the old zero-pin got right.
    expect(slide(-8, 0)).toMatchObject({ vx: 0, vz: 0 });
  });

  it('drops velocity pulled straight away from the wall', () => {
    // Peeling off is what releasing the key means; it does not belong in the
    // slide, or a stray backward tap would rip the runner off the building.
    expect(slide(8, 0)).toMatchObject({ vx: 0, vz: 0 });
  });

  it('keeps motion along the face at full speed', () => {
    expect(slide(0, 6)).toMatchObject({ vx: 0, vz: 6 });
    expect(slide(0, -6)).toMatchObject({ vx: 0, vz: -6 });
  });

  it('keeps only the tangent of a diagonal push', () => {
    // The whole point: pressing into the wall AND sideways should still slide.
    const r = slide(-8, 5);
    expect(r.vx).toBeCloseTo(0, 12);
    expect(r.vz).toBeCloseTo(5, 12);
  });

  it('clamps the slide so a diagonal climb stays a climb', () => {
    const r = slide(0, MAX * 3);
    expect(Math.hypot(r.vx, r.vz)).toBeCloseTo(MAX, 12);
    expect(r.vz).toBeGreaterThan(0); // direction survives the clamp
  });

  it('leaves a slide under the cap untouched', () => {
    const under = MAX * 0.4;
    expect(slide(0, under).vz).toBeCloseTo(under, 12);
  });

  it('handles a snapped corner normal', () => {
    // nearestFace snaps corner approaches to an axis, so the normal is always
    // one of four unit vectors — but the maths must not assume which.
    const r = wallSlideVelocity(3, 4, 0, 1, MAX);
    expect(r.vz).toBeCloseTo(0, 12);
    expect(r.vx).toBeCloseTo(3, 12);
  });

  it('returns zero for zero input, with no division by zero', () => {
    const r = slide(0, 0);
    expect(r.vx).toBe(0);
    expect(r.vz).toBe(0);
    expect(Number.isFinite(r.vx) && Number.isFinite(r.vz)).toBe(true);
  });

  it('survives a zero cap without producing NaN', () => {
    const r = slide(0, 5, N, 0);
    expect(r.vx).toBe(0);
    expect(r.vz).toBe(0);
  });

  it('is a fixed point: projecting an already-projected velocity changes nothing', () => {
    // Called every frame on the runner's own velocity, so it has to be
    // idempotent or a held key would decay across frames.
    const once = slide(-8, 5);
    const twice = slide(once.vx, once.vz);
    expect(twice.vx).toBeCloseTo(once.vx, 12);
    expect(twice.vz).toBeCloseTo(once.vz, 12);
  });
});

describe('stepVertical — the freeze invariant', () => {
  // The project's standing gate, pinned here at the unit level: at timeScale 0
  // nothing may advance. This file upholds it structurally — every term is
  // multiplied by simDt and nothing eases — so a regression shows up here
  // before it ever reaches a rendered frame.
  const cases = [
    ['ground', { mode: 'ground', y: 0, vy: 0, wallTop: 0 }, {}],
    ['air', { mode: 'air', y: 8, vy: -3.5, wallTop: 0 }, {}],
    [
      'wall',
      { mode: 'wall', y: 12, vy: WALL_CLIMB_SPEED, wallTop: 30 },
      { jumpHeld: true, wallTop: 30 },
    ],
    ['glide', { mode: 'glide', y: 14, vy: -GLIDE_SINK_SPEED, wallTop: 0 }, { jumpHeld: true }],
  ];

  for (const [name, state, over] of cases) {
    it(`is a fixed point at simDt = 0 in ${name}`, () => {
      const once = stepVertical(state, input({ ...over, simDt: 0 }));
      expect(once.y).toBe(state.y);
      expect(once.vy).toBe(state.vy);
      expect(once.mode).toBe(state.mode);
      // And stays one over repeated frames, not merely for the first.
      let s = once;
      for (let k = 0; k < 50; k++) s = stepVertical(s, input({ ...over, simDt: 0 }));
      expect(s.y).toBe(state.y);
      expect(s.vy).toBe(state.vy);
      expect(s.mode).toBe(state.mode);
    });
  }

  it('resumes once time moves again', () => {
    // Frozen must mean paused, not dead — the mirror half of the gate.
    const paused = stepVertical({ mode: 'air', y: 8, vy: -3.5, wallTop: 0 }, input({ simDt: 0 }));
    const moved = stepVertical(paused, input({ simDt: DT }));
    expect(moved.y).not.toBe(paused.y);
  });
});
