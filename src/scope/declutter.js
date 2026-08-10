// Reversible backdrop suppression for SCOPE view.
//
// Snapshots what it changes and restores from the snapshot, rather than
// restoring to hardcoded defaults — otherwise anything the GUI had adjusted
// before entering scope would be silently reset on the way out.

export function createDeclutter(scene) {
  let snapshot = null;

  const find = (pred) => scene.children.filter(pred);

  function enter() {
    if (snapshot) return;
    const grids = find((o) => o.type === 'GridHelper');
    // By NAME, not by `isInstancedMesh`. That probe was over-broad in both
    // directions: it does not recurse, so the city — a Group of instanced
    // meshes — would sail past it and be the brightest thing in an inspection
    // view meant to be empty; and it does reach game.mesh, whose visibility
    // Game.update rewrites every frame, so declutter was a second writer on an
    // object it does not own.
    const city = find((o) => o.name === 'city');
    const ground = find((o) => o.name === 'ground');

    snapshot = {
      fog: scene.fog,
      grids: grids.map((g) => ({ o: g, opacity: g.material.opacity, visible: g.visible })),
      city: city.map((p) => ({ o: p, visible: p.visible })),
      ground: ground.map((g) => ({ o: g, visible: g.visible })),
    };

    // Fog is depth-dependent, so it also perturbs the ortho dolly-invariance
    // check; removing it here is both a visual and a diagnostic win.
    scene.fog = null;
    for (const g of grids) g.material.opacity = 0.16;
    for (const p of city) p.visible = false;
    for (const g of ground) g.visible = false;
    // Pickup visibility is owned by Game.update, which rewrites it every frame.
  }

  function exit() {
    if (!snapshot) return;
    scene.fog = snapshot.fog;
    for (const { o, opacity, visible } of snapshot.grids) {
      o.material.opacity = opacity;
      o.visible = visible;
    }
    for (const { o, visible } of snapshot.city) o.visible = visible;
    for (const { o, visible } of snapshot.ground) o.visible = visible;
    snapshot = null;
  }

  return {
    apply: (params) => (params.scope && params.scopeBackdrop === false ? enter() : exit()),
    get active() {
      return snapshot !== null;
    },
  };
}
