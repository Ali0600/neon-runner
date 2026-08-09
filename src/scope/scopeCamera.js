import * as THREE from 'three';

// Locked side-on camera for SCOPE view, in either projection.
//
// It SNAPS rather than easing. The follow rig eases and needs epsilon snapping
// so a paused frame can settle; here the target is a pure function of the
// runner's position, so a frozen sim gives a constant target and therefore a
// constant camera — freeze-safety is structural rather than tuned.

const SCOPE_FOV = 45;
const CENTER_Y = 3.2; // vertical centre of the view, above the ground plane

export function createScopeCamera(perspective) {
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);

  const rig = {
    ortho,
    perspective,
    aspect: 1,
    // Persistent, because update() rewrites the camera position every frame —
    // a one-shot translate would be undone before it could be rendered.
    dollyOffset: 0,
  };

  /** Size the ortho frustum from a world-unit view height, leaving zoom at 1. */
  rig.resize = function resize(width, height, params) {
    rig.aspect = width / height;
    const halfH = params.scopeViewHeight / 2;
    const halfW = halfH * rig.aspect;
    ortho.left = -halfW;
    ortho.right = halfW;
    ortho.top = halfH;
    ortho.bottom = -halfH;
    ortho.updateProjectionMatrix();
  };

  rig.active = (params) => (params.scopeProjection === 'ortho' ? ortho : perspective);

  rig.update = function update(runner, params) {
    const halfH = params.scopeViewHeight / 2;
    const halfW = halfH * rig.aspect;

    // Offset along the lane so the runner sits toward one side and the trailing
    // plume fills the rest of the frame.
    const centerX = runner.position.x - halfW * (2 * params.scopeLead - 1);
    const cam = rig.active(params);

    if (cam.isOrthographicCamera) {
      // Any distance works under ortho; far enough to clear the scene.
      cam.position.set(centerX, CENTER_Y, 600 + rig.dollyOffset);
    } else {
      // Match the same world extent so the two projections are comparable and
      // the ruler stays valid in both.
      if (cam.fov !== SCOPE_FOV) {
        cam.fov = SCOPE_FOV;
        cam.updateProjectionMatrix();
      }
      const dist = halfH / Math.tan(THREE.MathUtils.degToRad(SCOPE_FOV) / 2);
      cam.position.set(centerX, CENTER_Y, dist);
    }

    // Look straight down -Z at the lane centreline, NOT at the runner: pinning
    // z to the centreline is what makes the lateral swing visible instead of
    // being cancelled out by a tracking camera.
    cam.lookAt(centerX, CENTER_Y, 0);
    cam.updateMatrixWorld();
  };

  /**
   * Move the camera along its own view axis. Verification hook only: under an
   * orthographic projection this must not change the rendered frame at all,
   * which is what proves the billboard basis is ortho-correct.
   */
  rig.dolly = function dolly(distance) {
    rig.dollyOffset += distance;
  };

  return rig;
}

export { SCOPE_FOV, CENTER_Y };
