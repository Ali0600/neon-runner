import * as THREE from 'three';
import { SCOPE_WALL_TOP } from '../constants.js';

// The wall SCOPE puts in the lane for a wallrun segment.
//
// It is a PROP, not a collider. The runner's lane position is an integration,
// not a closed form, so a wall placed from sim time could never line up with
// where the runner actually is — and a wall placed from the runner's position
// while it is still approaching would slide along ahead of it. Instead the
// climb itself is scripted (runner.js supplies wallTop from the schedule) and
// this draws where that climb is happening.
//
// Position is therefore a pure function of runner.position, exactly like
// scopeCamera's centreline, so it freezes and scrubs with everything else.

// SCOPE looks straight down -Z, so the face the runner climbs is edge-on and
// the only thing on screen is the wall's cross-section: its extent along the
// lane. A realistically thin wall is a 1-pixel sliver there, so this is
// deliberately a deep block — it reads as the building the runner is running
// up, rather than as a line it happens to be next to.
// Wide enough to read as material, narrow enough that the runner (which sits at
// ~74% of the frame) does not push it all the way under the control panel.
const THICKNESS = 3.5;
const DEPTH = 7; // across the lane; only matters under the perspective scope cam
const BODY_RADIUS = 0.45; // matches runner.js; the runner climbs this far out

export function createLaneWall() {
  const geometry = new THREE.BoxGeometry(THICKNESS, SCOPE_WALL_TOP, DEPTH);
  geometry.translate(0, SCOPE_WALL_TOP / 2, 0); // stand it on the ground plane

  const group = new THREE.Group();
  group.name = 'scope-lane-wall';
  group.visible = false;

  // Deliberately instrument-coloured rather than scenery-coloured, and under
  // both styles' bloom thresholds so the wall never competes with the plume it
  // exists to show.
  // Solid enough to occlude the plume behind it — that occlusion is most of
  // what makes it read as a surface rather than as an overlay.
  const face = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x0d1729, toneMapped: false })
  );
  group.add(face);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x4d86b4, toneMapped: false, depthWrite: false })
  );
  group.add(outline);

  // Storey lines up the near side, so height is readable off the wall itself
  // and not only off the ruler at the far edge of the frame.
  const storey = [];
  for (let y = 4; y < SCOPE_WALL_TOP; y += 4) {
    storey.push(-THICKNESS / 2, y, DEPTH / 2, THICKNESS / 2, y, DEPTH / 2);
  }
  const storeyGeo = new THREE.BufferGeometry();
  storeyGeo.setAttribute('position', new THREE.Float32BufferAttribute(storey, 3));
  group.add(
    new THREE.LineSegments(
      storeyGeo,
      new THREE.LineBasicMaterial({
        // Same blue as the ruler: this is an instrument, not scenery.
        color: 0x2b4b66,
        toneMapped: false,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      })
    )
  );

  const wall = { group };

  /**
   * Visible exactly while the runner is on it. Sole owner of its own
   * visibility — nothing else writes it, so there is no second writer to fight.
   */
  wall.update = function update(runner, params) {
    const on = !!params.scope && runner.vertical.mode === 'wall';
    group.visible = on;
    if (!on) return;
    // X: the runner climbs BODY_RADIUS out from the face, and the box is
    // centred, so this puts its near face exactly where the runner is.
    //
    // Z: entirely BEHIND the runner. SCOPE looks down -Z, so a block centred on
    // the runner's own z puts half of itself between the camera and the runner
    // and hides the entire effect behind a black rectangle.
    group.position.set(
      runner.position.x + BODY_RADIUS + THICKNESS / 2,
      0,
      runner.position.z - DEPTH / 2 - 1
    );
  };

  return wall;
}
