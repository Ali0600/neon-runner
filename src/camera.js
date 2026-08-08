import * as THREE from 'three';

const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

export function createCameraRig(camera) {
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
    if (runner.speed > 1.0) {
      const behind = Math.atan2(runner.velocity.x, runner.velocity.z) + Math.PI;
      let delta = behind - rig.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      rig.yaw += delta * (1 - Math.exp(-2.6 * dt));
      baseYaw = rig.yaw;
    }
    const yaw = baseYaw + input.orbitYaw;
    const pitch = 0.32 + input.orbitPitch;

    // Sprinting pushes the camera back and drops it — speed reads as distance.
    const dist = rig.distance + runner.dissolve * 2.2;
    const horiz = Math.cos(pitch) * dist;

    _desired.set(
      runner.position.x + Math.sin(yaw) * horiz,
      runner.position.y + rig.height + Math.sin(pitch) * dist * 0.55,
      runner.position.z + Math.cos(yaw) * horiz
    );

    // Framerate-independent damping.
    const k = 1 - Math.exp(-7 * dt);
    camera.position.lerp(_desired, k);

    _look.copy(runner.position);
    _look.y += 1.15;
    rig.lookAt.lerp(_look, 1 - Math.exp(-10 * dt));
    camera.lookAt(rig.lookAt);

    // Subtle FOV punch at speed.
    const wantFov = 62 + runner.dissolve * 14;
    if (Math.abs(camera.fov - wantFov) > 0.01) {
      camera.fov += (wantFov - camera.fov) * (1 - Math.exp(-4 * dt));
      camera.updateProjectionMatrix();
    }
  };

  return rig;
}
