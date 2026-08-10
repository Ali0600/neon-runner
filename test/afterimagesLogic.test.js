import { describe, it, expect } from 'vitest';
import {
  MAX_GHOSTS,
  GHOST_FRESH_EROSION,
  FULL_EROSION,
  plumeEnabled,
  emitsGhosts,
  limbStreaksActive,
  shouldSnapshot,
  ghostStrength,
  ghostErosion,
  pushSnapshot,
  trimTo,
  countAlive,
} from '../src/afterimages/logic.js';

const at = (x, y, z) => ({ x, y, z });

describe('sprint FX mode gates', () => {
  it('runs the plume in plume and both, and stops the continuous plume in afterimages', () => {
    expect(plumeEnabled('plume')).toBe(true);
    expect(plumeEnabled('both')).toBe(true);
    expect(plumeEnabled('afterimages')).toBe(false);
  });

  it('treats an absent mode as the old plume-only behaviour', () => {
    // params objects written before this feature must keep working unchanged.
    expect(plumeEnabled(undefined)).toBe(true);
    expect(emitsGhosts(undefined)).toBe(false);
  });

  it('emits ghosts in afterimages and both only', () => {
    expect(emitsGhosts('afterimages')).toBe(true);
    expect(emitsGhosts('both')).toBe(true);
    expect(emitsGhosts('plume')).toBe(false);
  });

  it('needs both the mode and the toggle for limb streaks', () => {
    expect(limbStreaksActive('both', true)).toBe(true);
    expect(limbStreaksActive('both', false)).toBe(false);
    expect(limbStreaksActive('plume', true)).toBe(false);
  });

  it('covers every mode the dropdown offers', () => {
    // Guards the guard: a mode added to the GUI but not here would fall through
    // every gate above as a silent no-op.
    for (const mode of ['plume', 'afterimages', 'both']) {
      expect(plumeEnabled(mode) || emitsGhosts(mode), `${mode} renders nothing`).toBe(true);
    }
  });
});

describe('shouldSnapshot', () => {
  const SPACING = 2;
  const MIN = 0.3;

  it('fires immediately when there is no previous snapshot', () => {
    expect(shouldSnapshot(null, at(0, 0, 0), 1, SPACING, MIN)).toBe(true);
  });

  it('does not fire while the runner has not moved far enough', () => {
    const prev = at(0, 0, 0);
    expect(shouldSnapshot(prev, at(1.9, 0, 0), 1, SPACING, MIN)).toBe(false);
    expect(shouldSnapshot(prev, at(2.01, 0, 0), 1, SPACING, MIN)).toBe(true);
  });

  it('measures distance in 3D so a wall climb still emits', () => {
    // A climb moves on y alone. A gate written on the ground plane would drop
    // the effect exactly where the runner is most spectacular.
    expect(shouldSnapshot(at(0, 0, 0), at(0, 3, 0), 1, SPACING, MIN)).toBe(true);
  });

  it('requires the sprint glow', () => {
    expect(shouldSnapshot(at(0, 0, 0), at(9, 0, 0), 0.29, SPACING, MIN)).toBe(false);
    expect(shouldSnapshot(at(0, 0, 0), at(9, 0, 0), 0.3, SPACING, MIN)).toBe(true);
  });

  it('does not fire on the first frame of a standing runner', () => {
    // The no-previous case must not outrank the glow gate.
    expect(shouldSnapshot(null, at(0, 0, 0), 0, SPACING, MIN)).toBe(false);
  });

  it('is a fixed point while the runner is frozen', () => {
    // The freeze invariant, at its source: no dt term, so a paused runner at the
    // same position can be asked any number of times and never snapshots.
    const prev = at(5, 1, 5);
    for (let i = 0; i < 10; i++) {
      expect(shouldSnapshot(prev, at(5, 1, 5), 1, SPACING, MIN)).toBe(false);
    }
  });
});

describe('ghostStrength', () => {
  it('is full at capture and zero at the end of the fade', () => {
    expect(ghostStrength(10, 10, 2)).toBe(1);
    expect(ghostStrength(10, 12, 2)).toBe(0);
    expect(ghostStrength(10, 99, 2)).toBe(0);
  });

  it('decreases monotonically across the window', () => {
    let prev = Infinity;
    for (let t = 10; t <= 12; t += 0.1) {
      const s = ghostStrength(10, t, 2);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });

  it('returns the same value for an unchanged sim time', () => {
    // Recomputed from the stamp rather than decayed into a stored value, which
    // is what makes two consecutive paused frames bit-identical.
    const a = ghostStrength(3, 3.7, 1.5);
    expect(ghostStrength(3, 3.7, 1.5)).toBe(a);
    expect(ghostStrength(3, 3.7, 1.5)).toBe(a);
  });

  it('survives a zero fade window without dividing by zero', () => {
    expect(ghostStrength(1, 1, 0)).toBe(0);
    expect(Number.isFinite(ghostStrength(1, 2, 0))).toBe(true);
  });
});

describe('ghostErosion', () => {
  it('is born as a full particle figure, not a fresnel outline', () => {
    // What "full" actually means here, decoded from an annotated screenshot: the
    // ghost MESH is shaded by a fresnel term, so an un-eroded ghost is bright
    // only at grazing angles and reads as a hollow outline. The figure that
    // looks solid is the one whose body has already converted into the spark
    // cloud — dense, body-shaped, mesh remnant at the head where the height bias
    // holds the threshold up. That state lives around erosion 0.85, so a ghost
    // has to be BORN there; being born near zero puts the outline phase at the
    // front of the chain, which is the state that was rejected.
    //
    // Literal bounds, not GHOST_FRESH_EROSION: a test that reads its own
    // expectation off the constant under test cannot see that constant move.
    expect(ghostErosion(1)).toBeGreaterThan(0.7);
    expect(ghostErosion(1)).toBeLessThan(1.1);
    expect(ghostErosion(1)).toBeCloseTo(GHOST_FRESH_EROSION, 12);
  });

  it('erodes past the noise ceiling at zero strength', () => {
    // The shader discards where (noise + heightBias) < erosion, and that sum
    // cannot exceed 1.5 — so an expired ghost must clear 1.5 or it leaves
    // sparkles hanging in the air.
    expect(ghostErosion(0)).toBeGreaterThanOrEqual(1.5);
    expect(FULL_EROSION).toBeGreaterThanOrEqual(1.5);
  });

  it('is already coming apart just behind the runner', () => {
    // The chain lays a ghost's life out along the ground, so WHEN it disintegrates
    // is WHERE. The ghost immediately behind the runner has to be shedding
    // already, or the burst lands at the far end of the trail and the effect
    // reads as starting from the tail and running backwards.
    //
    // Measured as PROGRESS past birth, not as an absolute level: ghosts are now
    // born at 0.85, so any absolute threshold down here is satisfied by the
    // birth value alone and would pass for a curve that does nothing at all.
    expect(ghostErosion(0.9) - ghostErosion(1)).toBeGreaterThan(0.05);
  });

  it('runs ahead of a linear ramp through its whole life', () => {
    // Pins the ease-OUT shape rather than only the endpoints, which an ease-in
    // and a straight line both satisfy. Concavity is the property that puts the
    // energy near the runner.
    for (let t = 0.05; t < 1; t += 0.05) {
      const linear = GHOST_FRESH_EROSION + (FULL_EROSION - GHOST_FRESH_EROSION) * t;
      expect(ghostErosion(1 - t)).toBeGreaterThanOrEqual(linear);
    }
  });

  it('rises monotonically as a ghost fades', () => {
    let prev = -Infinity;
    for (let s = 1; s >= 0; s -= 0.05) {
      const e = ghostErosion(s);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
  });

  it('depends on age alone, so every ghost vanishes as completely', () => {
    // Guards the guard: erosion used to take the capture-time dissolve, and a
    // slow-captured ghost then expired short of full dissolution.
    expect(ghostErosion.length).toBe(1);
  });
});

describe('the ghost ring', () => {
  it('drops the oldest when full', () => {
    const list = [];
    for (let i = 0; i < 3; i++) pushSnapshot(list, { id: i, t: i }, 3);
    expect(list.map((r) => r.id)).toEqual([0, 1, 2]);

    const evicted = pushSnapshot(list, { id: 3, t: 3 }, 3);
    expect(evicted.id).toBe(0);
    expect(list.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('returns null while there is room', () => {
    const list = [];
    expect(pushSnapshot(list, { id: 0, t: 0 }, 3)).toBe(null);
    expect(list).toHaveLength(1);
  });

  it('never exceeds the hard cap however high the count is set', () => {
    const list = [];
    for (let i = 0; i < MAX_GHOSTS + 20; i++) pushSnapshot(list, { id: i, t: i }, 999);
    expect(list.length).toBe(MAX_GHOSTS);
  });

  it('trims to a lowered count and hands back what it dropped', () => {
    const list = [];
    for (let i = 0; i < 6; i++) pushSnapshot(list, { id: i, t: i }, 6);
    const dropped = trimTo(list, 2);
    expect(dropped.map((r) => r.id)).toEqual([0, 1, 2, 3]);
    expect(list.map((r) => r.id)).toEqual([4, 5]);
  });

  it('counts only ghosts with strength left', () => {
    const list = [{ t: 0 }, { t: 4 }, { t: 5 }];
    expect(countAlive(list, 5, 2)).toBe(2); // t=0 has expired
    expect(countAlive(list, 100, 2)).toBe(0);
  });
});
