import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCameraRig } from '../src/camera.js';

const DT = 1 / 60;

/**
 * A runner standing still at the origin. Held stationary on purpose: the rig
 * only re-aims its yaw above 1.0 horizontal speed, so a still runner keeps yaw
 * pinned at its initial value and the pitch/distance terms are the only things
 * left moving. That is what makes these assertions about the glide lift rather
 * than about which way the camera happened to swing.
 */
function runner(mode = 'air', over = {}) {
  return {
    position: new THREE.Vector3(0, 10, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    speed: 0,
    groundSpeed: 0,
    dissolve: 0.5,
    vertical: { mode },
    ...over,
  };
}

const input = (over = {}) => ({ orbitYaw: 0, orbitPitch: 0, ...over });

/** Step until the camera stops moving, bounded — never a fixed frame count. */
function settle(rig, r, i, max = 4000) {
  const prev = new THREE.Vector3();
  for (let k = 0; k < max; k++) {
    prev.copy(rig.camera.position);
    rig.update(DT, r, i);
    if (prev.equals(rig.camera.position)) return k;
  }
  throw new Error('camera never settled');
}

function build() {
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 500);
  return createCameraRig(camera, []); // no city: no sightline pull-in to confound
}

/** Angle above the horizontal from the look target to the camera, in radians. */
function lookDownAngle(rig, r) {
  const dy = rig.camera.position.y - (r.position.y + 1.15);
  const dh = Math.hypot(
    rig.camera.position.x - r.position.x,
    rig.camera.position.z - r.position.z
  );
  return Math.atan2(dy, dh);
}

describe('the follow rig — gliding lifts the camera', () => {
  it('sits higher above the runner while gliding', () => {
    // The reported bug: at the default pitch the camera looks edge-on THROUGH
    // the downward jet, so the effect renders as one white blob.
    const air = build();
    const ra = runner('air');
    settle(air, ra, input());
    const airLift = air.camera.position.y - ra.position.y;

    const glide = build();
    const rg = runner('glide');
    settle(glide, rg, input());
    const glideLift = glide.camera.position.y - rg.position.y;

    expect(glideLift).toBeGreaterThan(airLift);
  });

  it('looks down more steeply while gliding', () => {
    // Height alone is not the property that matters — pulling straight back
    // would raise the camera without ever looking down at the jet. The angle is
    // what makes the figure and the plume beneath it read as two things.
    const air = build();
    const ra = runner('air');
    settle(air, ra, input());

    const glide = build();
    const rg = runner('glide');
    settle(glide, rg, input());

    expect(lookDownAngle(glide, rg)).toBeGreaterThan(lookDownAngle(air, ra) + 0.2);
  });

  it('backs off far enough to keep the widened jet in frame', () => {
    const air = build();
    const ra = runner('air');
    settle(air, ra, input());
    const airDist = air.camera.position.distanceTo(ra.position);

    const glide = build();
    const rg = runner('glide');
    settle(glide, rg, input());
    expect(glide.camera.position.distanceTo(rg.position)).toBeGreaterThan(airDist);
  });

  it('settles to an exact fixed point while gliding', () => {
    // The rig's easing is exponential and never truly arrives, so it carries
    // epsilon snaps. A new stepped target must not land the camera somewhere
    // those snaps cannot reach, or a paused glide creeps forever by sub-pixel
    // amounts and the freeze invariant breaks in the follow view.
    const rig = build();
    const r = runner('glide');
    const i = input();
    settle(rig, r, i);

    rig.camera.updateMatrixWorld();
    const before = rig.camera.matrixWorld.elements.join(',');
    rig.update(DT, r, i);
    rig.update(DT, r, i);
    rig.camera.updateMatrixWorld();
    expect(rig.camera.matrixWorld.elements.join(',')).toBe(before);
  });

  it('leaves the ground view untouched', () => {
    // The lift is a glide-only correction. A grounded runner must frame exactly
    // as it did before, or this fixes one view by moving every other one.
    const rig = build();
    const r = runner('ground');
    settle(rig, r, input());
    // 0.32 rad base pitch, distance 7 + 0.5 * 2.2 = 8.1.
    const dist = 7 + 0.5 * 2.2;
    expect(rig.camera.position.y - r.position.y).toBeCloseTo(
      2.5 + Math.sin(0.32) * dist * 0.55,
      6
    );
  });

  it('still responds to orbit drag while gliding', () => {
    // The glide term is additive, so dragging has to keep working mid-glide —
    // a view that locks the user out is worse than the blob it replaced.
    const a = build();
    const r = runner('glide');
    settle(a, r, input());
    const flat = a.camera.position.y;

    const b = build();
    settle(b, runner('glide'), input({ orbitPitch: 0.3 }));
    expect(b.camera.position.y).toBeGreaterThan(flat);
  });

  it('treats a runner with no vertical state as grounded', () => {
    // The rig is handed the runner by main.js, but the tests and the SCOPE
    // driver both construct partial ones; an undefined vertical must not throw.
    const rig = build();
    const r = runner('ground');
    delete r.vertical;
    expect(() => settle(rig, r, input())).not.toThrow();
  });
});
