import { describe, it, expect } from 'vitest';
import { createRunner } from '../src/runner.js';
import { WALL_LATERAL_SPEED } from '../src/constants.js';

// params.js reads window.devicePixelRatio at module load, so it cannot be
// imported here — the fixture lists only what the runner actually touches.
const defaults = {
  colorA: '#ff2bd6',
  colorB: '#25f5ff',
  scope: false,
  scopeInterval: 3,
  scopeTurn: false,
  scopeSprint: false,
  scopeStop: false,
  scopeJump: false,
  scopeWallrun: false,
  scopeTurnAmplitude: 4,
  scopeLaneHalf: 2000,
  scopeScrub: 0,
  glideFx: 'hands',
  autopilot: true,
  forceSprint: true,
  holdSpeed: true,
  holdSpeedValue: 14,
};

// runner.js imports three and four .glsl?raw files, and all of it resolves under
// vitest — so the figure's POSE is unit-testable without a renderer. Only the
// joint rotations are asserted here; anything needing a draw stays in the
// browser harness.

const DT = 1 / 60;

function makeRunner(over = {}, city = []) {
  const params = { ...defaults, autopilot: true, holdSpeed: true, holdSpeedValue: 14, ...over };
  return { runner: createRunner(params, city), params };
}

// `jump` is the HELD flag the FSM reads. A glide needs it down every frame:
// releasing hands the runner straight back to `air`, so a fixture that left it
// false would drive an `air` figure while claiming to test a glide.
const input = (held = false) => ({
  moveVec: { x: 0, y: 0 },
  sprint: false,
  jump: held,
  jumpPressed: false,
  orbitYaw: 0,
  orbitPitch: 0,
});

/**
 * Drive n frames in a given vertical mode. The mode is re-seeded each frame
 * because runner.update() runs the FSM and overwrites it, and the assertions
 * check the mode actually held rather than trusting the seed.
 */
function driveIn(runner, mode, n, simTime = 0) {
  const angles = [];
  for (let k = 0; k < n; k++) {
    runner.vertical = {
      mode,
      y: mode === 'ground' ? 0 : 20,
      vy: mode === 'glide' ? -3.5 : 0,
      wallTop: 0,
    };
    runner.update(DT, simTime + k * DT, input(mode === 'glide'), 0);
    if (mode === 'glide' && runner.vertical.mode !== 'glide') {
      throw new Error('fell out of glide: ' + runner.vertical.mode);
    }
    // legL is bodyMeshes[6]'s parent chain — read the hip pivot directly.
    angles.push(runner.bodyMeshes[6].parent.rotation.x);
  }
  return angles;
}

describe('the runner pose in a hand-jet glide', () => {
  it('holds the legs still during a hand-jet glide', () => {
    // "The legs don't need to move" — a running cycle under a hover reads as
    // pedalling in mid-air. Every frame must report the same hip angle.
    const { runner } = makeRunner({ glideFx: 'hands' });
    const angles = driveIn(runner, 'glide', 20);
    const first = angles[0];
    for (const a of angles) expect(a).toBe(first);
  });

  it('holds both legs at the SAME angle, not caught mid-stride', () => {
    const { runner } = makeRunner({ glideFx: 'hands' });
    driveIn(runner, 'glide', 10);
    const hipL = runner.bodyMeshes[6].parent.rotation.x;
    const hipR = runner.bodyMeshes[8].parent.rotation.x;
    expect(hipL).toBe(hipR);
  });

  it('still cycles the legs on the ground', () => {
    // Guards the guard: a pose that froze the legs everywhere would pass the
    // test above while breaking the run.
    const { runner } = makeRunner({ glideFx: 'hands' });
    const angles = driveIn(runner, 'ground', 30);
    expect(new Set(angles).size).toBeGreaterThan(1);
  });

  it('still cycles the legs in a streak-mode glide', () => {
    const { runner } = makeRunner({ glideFx: 'streak' });
    const angles = driveIn(runner, 'glide', 30);
    expect(new Set(angles).size).toBeGreaterThan(1);
  });

  it('puts the hands below the head, where a thrust pose belongs', () => {
    // The bug this pins: rotation.x is measured from an arm ALREADY hanging
    // straight down, so a large angle swings the arms UP over the head. A first
    // pass used 2.5 rad and did exactly that, and it read as fine in the source.
    const { runner } = makeRunner({ glideFx: 'hands' });
    driveIn(runner, 'glide', 10);
    const feetY = runner.position.y;
    for (const p of runner.handPoints) {
      expect(p.y - feetY).toBeLessThan(1.4); // head sits at ~1.6
      expect(p.y - feetY).toBeGreaterThan(0.3); // and not down at the ankles
    }
  });

  it('holds the hands symmetric and apart', () => {
    const { runner } = makeRunner({ glideFx: 'hands' });
    driveIn(runner, 'glide', 10);
    const [a, b] = runner.handPoints;
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.4);
  });

  it('clears the arm splay again once the glide ends', () => {
    // The thrust pose writes rotation.z, which the swinging gait never touches —
    // leaving it set would keep the arms splayed for every stride afterwards.
    const { runner } = makeRunner({ glideFx: 'hands' });
    driveIn(runner, 'glide', 10);
    expect(runner.bodyMeshes[2].parent.rotation.z).not.toBe(0);
    driveIn(runner, 'ground', 10, 1);
    expect(runner.bodyMeshes[2].parent.rotation.z).toBe(0);
  });
});

describe('steering while climbing a wall', () => {
  // One building centred at the origin. The runner mounts its +x face, whose
  // outward normal is +x, so the tangent is the z axis.
  //
  // The face is LONG (hd 40) on purpose. On a 4-deep building the slide reaches
  // the corner in well under a second, nearestFace snaps to the adjacent face,
  // and the velocity that was tangent to the old one is entirely normal to the
  // new one — so the runner stops. That is correct behaviour (see the corner
  // test below), but measuring the slide against it reports the corner distance
  // rather than the slide speed, which is what a first pass here did.
  const CITY = [{ x: 0, z: 0, hw: 4, hd: 40, h: 40 }];
  const SHORT_CITY = [{ x: 0, z: 0, hw: 4, hd: 4, h: 40 }];

  // Camera behind the runner looking AT the +x face: forward is -x, so a strafe
  // maps to the z axis, which is this face's tangent. Getting this wrong is easy
  // and silent — at cameraYaw 0 the strafe points along the face NORMAL, the
  // projection correctly removes all of it, and the test reads as "sliding is
  // broken" while measuring a push into the wall.
  const CAM_YAW = Math.PI / 2;

  /** Drive the runner with a fixed camera-relative strafe, holding jump. */
  function climb(runner, strafe, frames) {
    const path = [];
    for (let k = 0; k < frames; k++) {
      runner.update(DT, k * DT, { ...input(true), moveVec: { x: strafe, y: 0 } }, CAM_YAW);
      path.push({
        x: runner.position.x,
        y: runner.position.y,
        z: runner.position.z,
        mode: runner.vertical.mode,
      });
    }
    return path;
  }

  /**
   * Put the runner on the +x face, running, with jump held. autopilot must be
   * OFF: it drives direction itself and would ignore the strafe entirely, which
   * would leave every assertion below measuring the autopilot's path.
   */
  function mounted(over = {}, city = CITY) {
    const { runner } = makeRunner({ glideFx: 'streak', autopilot: false, ...over }, city);
    runner.position.set(4 + 0.45, 2, 0); // BODY_RADIUS outside the face
    runner.vertical = { mode: 'wall', y: 2, vy: 20, wallTop: 40 };
    runner.wallNormal = { nx: 1, nz: 0, top: 40, dist: 0 };
    return runner;
  }

  it('slides along the face when steered', () => {
    // The reported complaint: this used to creep at a seventh of the commanded
    // speed because the velocity was zeroed every frame.
    const runner = mounted();
    const path = climb(runner, 1, 60);
    // Measured, not estimated: the old zero-pin moved 1.95 units in this second
    // (one frame of ACCEL easing, wiped and restarted every frame); the
    // projection moves ~9.5 as the slide converges on WALL_LATERAL_SPEED. A
    // threshold of 5 sits between them with room on both sides.
    const moved = Math.abs(path[path.length - 1].z - path[0].z);
    expect(moved).toBeGreaterThan(5);
  });

  it('keeps its distance from the face while sliding', () => {
    // The half the old zero-pin got right, and the half that must survive:
    // steering must not push the runner into or off the wall.
    const runner = mounted();
    const path = climb(runner, 1, 60);
    const onWall = path.filter((p) => p.mode === 'wall');
    expect(onWall.length).toBeGreaterThan(30);
    for (const p of onWall) expect(p.x).toBeCloseTo(4 + 0.45, 3);
  });

  it('still climbs while sliding', () => {
    const runner = mounted();
    const path = climb(runner, 1, 60);
    expect(path[path.length - 1].y).toBeGreaterThan(path[0].y + 5);
  });

  it('slides the other way when steered the other way', () => {
    const a = mounted();
    const b = mounted();
    const za = climb(a, 1, 45).at(-1).z;
    const zb = climb(b, -1, 45).at(-1).z;
    expect(Math.sign(za)).toBe(-Math.sign(zb));
  });

  it('stays put on the face with no steering input', () => {
    // A climb with no key held must still go straight up — the slide is opt-in.
    const runner = mounted();
    const path = climb(runner, 0, 60);
    expect(Math.abs(path.at(-1).z - path[0].z)).toBeLessThan(0.5);
    expect(path.at(-1).x).toBeCloseTo(4 + 0.45, 3);
  });

  it('cannot be pulled off the face by steering away from it', () => {
    // Peeling off is what RELEASING the key means; steering away must not do it.
    // This is what the pre-integration projection guards: without it the frame
    // integrates on a velocity carrying an outward component, the runner drifts
    // out of the face's reach, and the climb ends by itself. The post-FSM
    // projection alone does not cover this — it fixes the velocity only AFTER
    // the position has already moved.
    const runner = mounted();
    const path = [];
    for (let k = 0; k < 60; k++) {
      // moveVec.y = -1 with the camera facing the wall points straight away.
      runner.update(DT, k * DT, { ...input(true), moveVec: { x: 0, y: -1 } }, CAM_YAW);
      path.push({ x: runner.position.x, mode: runner.vertical.mode });
    }
    expect(path.at(-1).mode).toBe('wall');
    for (const p of path) expect(p.x).toBeCloseTo(4 + 0.45, 3);
  });

  it('slides to the end of a face and stops there, still attached', () => {
    // Reaching a corner snaps the face normal to the next side, and the velocity
    // that was tangent to the old face is entirely normal to the new one — so
    // the slide stops rather than carrying the runner around or off. Pinned
    // because it is a real edge a player will hit, and because it is what makes
    // the slide measurement above need a long face.
    const runner = mounted({}, SHORT_CITY);
    const path = climb(runner, 1, 90);
    const end = path.at(-1);
    expect(end.mode).toBe('wall'); // still climbing, not dropped
    // Stops at the corner plus the body radius — 4.53 measured, not past it.
    expect(Math.abs(end.z)).toBeLessThan(5);
    // And it really did stop: the last ten frames barely move.
    expect(Math.abs(end.z - path.at(-10).z)).toBeLessThan(0.05);
  });

  it('caps the slide, so a diagonal climb stays a climb', () => {
    const runner = mounted();
    const path = climb(runner, 1, 90);
    const onWall = path.filter((p) => p.mode === 'wall');
    const dz = Math.abs(onWall.at(-1).z - onWall[0].z);
    const dt = (onWall.length - 1) * DT;
    expect(dz / dt).toBeLessThanOrEqual(WALL_LATERAL_SPEED + 0.5);
  });
});
