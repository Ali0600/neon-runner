import { describe, it, expect } from 'vitest';
import { createRunner } from '../src/runner.js';

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

function makeRunner(over = {}) {
  const params = { ...defaults, autopilot: true, holdSpeed: true, holdSpeedValue: 14, ...over };
  return { runner: createRunner(params, []), params };
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
