import { createTrail } from './Trail.js';
import { limbStreaksActive } from '../afterimages/logic.js';

// The long light streaks that trail off the hands and feet during an afterimage
// sprint.
//
// Four instances of the chest ribbon rather than one multi-source geometry: each
// ribbon needs its own oldest-first sample array, its own minimum-step test
// against its OWN last sample, and a contiguous draw range. Packing four into
// one buffer would mean per-ribbon draw-range bookkeeping or degenerate-triangle
// stitching, to save three draw calls in a scene that already runs a multi-pass
// composer. Reuse wins, and the ortho-correct billboarding and the freeze proof
// come along unchanged.

export function createLimbStreaks(params) {
  const ribbons = [0, 1, 2, 3].map((i) =>
    createTrail(params, {
      getPoint: (runner, out) => {
        const p = runner.streakPoints[i];
        out.set(p.x, p.y, p.z);
      },
      getWidth: () => params.trailWidth * params.limbStreakWidth,
      shouldEmit: (runner) =>
        limbStreaksActive(params.sprintFx, params.limbStreaks) && runner.dissolve > 0.02,
      // Always visible. When a mode switch stops emission the existing samples
      // age out over trailFade instead of vanishing in one frame.
      getVisible: () => true,
    })
  );

  for (const r of ribbons) r.mesh.renderOrder = 1; // with the trail and the plume

  return {
    ribbons,
    meshes: ribbons.map((r) => r.mesh),
    update(simTime, runner) {
      for (const r of ribbons) r.update(simTime, runner);
    },
    clear() {
      for (const r of ribbons) r.clear();
    },
    applyParams() {
      for (const r of ribbons) r.applyParams();
    },
    get samples() {
      return ribbons.reduce((n, r) => n + r.samples.length, 0);
    },
  };
}
