import * as THREE from 'three';
import { viewClearance } from './city.js';

const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

// Wider than the near plane (0.1) so a wall the rig is pressed against never
// clips open and shows the building's interior.
const CAM_RADIUS = 0.6;

// --- gliding ---------------------------------------------------------------
// The glide fires a plume straight DOWN, which at the default pitch the camera
// looks edge-on through: the figure sits inside its own jet and the whole thing
// renders as one white blob. Swinging the rig up and back separates them — you
// see the runner from above with the light billowing out beneath.
//
// Applied to the DESIRED point rather than to the camera, like the sightline
// pull-in below and for the same reason: a stepped target rides the existing
// easing and its epsilon snap, so this adds no new eased state and the freeze
// invariant needs no new argument. A frozen runner holds a frozen mode, which
// holds a frozen target.
const GLIDE_CAM_PITCH = 0.55; // radians on top of the base 0.32 — ~50° look-down
const GLIDE_CAM_DIST = 2.5; // world units back, so the widened jet stays in frame

export function createCameraRig(camera, city = []) {
  const rig = {
    camera,
    yaw: Math.PI, // behind the runner at start
    lookAt: new THREE.Vector3(),
    distance: 7,
    height: 2.5,
  };

  rig.update = function update(dt, runner, input) {
    // Orbit drag adds to the base yaw; when moving, the rig eases back behind
    // the runner so the trail stays in frame.
    let baseYaw = rig.yaw;
    // HORIZONTAL speed, not `runner.speed`, which is 3D. On a wall the runner
    // is moving at 20 u/s with x and z both exactly zero, so the 3D test passes
    // and `atan2(0, 0)` hands back 0 — the rig would swing to an arbitrary
    // compass direction and end up inside the building. Holding the last
    // heading keeps the camera where it was when the runner hit the wall,
    // which is behind them, looking up the face.
    if ((runner.groundSpeed ?? runner.speed) > 1.0) {
      const behind = Math.atan2(runner.velocity.x, runner.velocity.z) + Math.PI;
      let delta = behind - rig.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      // Snap at the asymptote for the same reason as the position easing —
      // otherwise the rig's target creeps every frame and the camera chasing
      // it never lets a paused frame settle.
      if (Math.abs(delta) < 1e-5) rig.yaw = behind; // ~0.0006 degrees
      else rig.yaw += delta * (1 - Math.exp(-2.6 * dt));
      baseYaw = rig.yaw;
    }
    const gliding = runner.vertical?.mode === 'glide';

    const yaw = baseYaw + input.orbitYaw;
    // Both terms stay ADDITIVE with the orbit input, so dragging still works
    // mid-glide. A view the user cannot move is worse than the one it replaced.
    const pitch = 0.32 + input.orbitPitch + (gliding ? GLIDE_CAM_PITCH : 0);

    // Sprinting pushes the camera back and drops it — speed reads as distance.
    const dist = rig.distance + runner.dissolve * 2.2 + (gliding ? GLIDE_CAM_DIST : 0);
    const horiz = Math.cos(pitch) * dist;

    _desired.set(
      runner.position.x + Math.sin(yaw) * horiz,
      runner.position.y + rig.height + Math.sin(pitch) * dist * 0.55,
      runner.position.z + Math.cos(yaw) * horiz
    );

    // Keep the rig out of the architecture by pulling it IN along the sightline
    // from the runner, never by pushing it out of the wall it entered — the
    // nearest face is frequently the far one, which flips the camera to the
    // other side of the building and hides the thing it is following.
    //
    // Correcting the TARGET rather than the camera leaves the easing below
    // untouched, so this needs no epsilon of its own: a frozen runner gives a
    // frozen desired point either way.
    const t = viewClearance(
      city,
      runner.position.x,
      runner.position.y + 1.15,
      runner.position.z,
      _desired.x,
      _desired.y,
      _desired.z,
      CAM_RADIUS
    );
    // No floor under `t`. A minimum pull-in sounds kinder than collapsing onto
    // the runner, but when the clearance is smaller than the floor it puts the
    // camera back inside the wall — strictly worse than a tight shot, and it is
    // exactly the case that arises when the orbit is dragged to look through a
    // building the runner is standing against.
    if (t < 1) {
      _desired.set(
        runner.position.x + (_desired.x - runner.position.x) * t,
        runner.position.y + 1.15 + (_desired.y - (runner.position.y + 1.15)) * t,
        runner.position.z + (_desired.z - runner.position.z) * t
      );
    }

    // Framerate-independent damping. Exponential easing only ever approaches
    // its target, so below EPS it snaps: without that the camera drifts by
    // sub-micron amounts forever and a paused scene never renders two
    // identical frames.
    const EPS = 1e-4;
    if (camera.position.distanceToSquared(_desired) < EPS * EPS) {
      camera.position.copy(_desired);
    } else {
      camera.position.lerp(_desired, 1 - Math.exp(-7 * dt));
    }

    _look.copy(runner.position);
    _look.y += 1.15;
    if (rig.lookAt.distanceToSquared(_look) < EPS * EPS) rig.lookAt.copy(_look);
    else rig.lookAt.lerp(_look, 1 - Math.exp(-10 * dt));
    camera.lookAt(rig.lookAt);

    // Subtle FOV punch at speed.
    const wantFov = 62 + runner.dissolve * 14;
    const dFov = wantFov - camera.fov;
    if (Math.abs(dFov) > 1e-4) {
      camera.fov += dFov * (1 - Math.exp(-4 * dt));
      camera.updateProjectionMatrix();
    } else if (dFov !== 0) {
      camera.fov = wantFov;
      camera.updateProjectionMatrix();
    }
  };

  return rig;
}
