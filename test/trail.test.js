import { describe, it, expect } from 'vitest';
import { createTrail } from '../src/trail/Trail.js';
import { createLimbStreaks } from '../src/trail/LimbStreaks.js';

// Trail.js grew hooks so the limb streaks could reuse it. The chest ribbon has
// no other coverage, so these pin the behaviour the defaults must reproduce —
// the refactor's whole risk is a default that quietly stopped matching.

const PARAMS = () => ({
  trailWidth: 0.34,
  trailFade: 1.2,
  trailSamples: 110,
  colorA: '#ff2bd6',
  colorB: '#25f5ff',
  trailEnabled: true,
  sprintFx: 'both',
  limbStreaks: true,
  limbStreakWidth: 0.45,
});

// Minimal stand-in for the runner: only what a ribbon reads.
const runnerAt = (x, y, z, dissolve = 1) => ({
  position: { x, y, z },
  dissolve,
  streakPoints: [
    { x: x + 0.3, y: y + 1.4, z },
    { x: x - 0.3, y: y + 1.4, z },
    { x: x + 0.1, y: y + 0.2, z },
    { x: x - 0.1, y: y + 0.2, z },
  ],
});

describe('the chest ribbon defaults', () => {
  it('samples at chest height, one unit above the runner', () => {
    // The +1.0 offset used to be inline in update(); it moved into the default
    // getPoint, and a ribbon dragging along the floor is the regression.
    const p = PARAMS();
    const t = createTrail(p);
    t.update(0, runnerAt(5, 0, 7));
    expect(t.samples).toHaveLength(1);
    expect(t.samples[0]).toMatchObject({ x: 5, y: 1, z: 7 });
  });

  it('emits only while the runner is glowing', () => {
    const t = createTrail(PARAMS());
    t.update(0, runnerAt(0, 0, 0, 0.01));
    expect(t.samples).toHaveLength(0);
    t.update(0.1, runnerAt(0, 0, 0, 0.5));
    expect(t.samples).toHaveLength(1);
  });

  it('does not add a sample until the runner has moved far enough', () => {
    const t = createTrail(PARAMS());
    t.update(0, runnerAt(0, 0, 0));
    t.update(0.1, runnerAt(0.001, 0, 0));
    expect(t.samples).toHaveLength(1);
    t.update(0.2, runnerAt(3, 0, 0));
    expect(t.samples).toHaveLength(2);
  });

  it('measures the step in 3D, so a vertical climb still lays ribbon', () => {
    const t = createTrail(PARAMS());
    t.update(0, runnerAt(0, 0, 0));
    t.update(0.1, runnerAt(0, 4, 0));
    expect(t.samples).toHaveLength(2);
  });

  it('drops samples once they age past the fade window', () => {
    const p = PARAMS();
    const t = createTrail(p);
    const N = 5;
    for (let i = 0; i < N; i++) t.update(i * 0.5, runnerAt(i * 3, 0, 0));
    const lastT = (N - 1) * 0.5;
    expect(t.samples.length).toBeGreaterThan(1);
    expect(t.samples.length).toBeLessThan(N); // something actually aged out
    expect(t.samples[0].t).toBeGreaterThanOrEqual(lastT - p.trailFade - 1e-9);
  });

  it('adds nothing while time and position are frozen', () => {
    // The ribbon's half of the freeze invariant: update() takes no dt, so a
    // repeated call at one simTime is a no-op by construction.
    const t = createTrail(PARAMS());
    const r = runnerAt(2, 0, 2);
    t.update(1, r);
    const n = t.samples.length;
    for (let i = 0; i < 5; i++) t.update(1, r);
    expect(t.samples).toHaveLength(n);
  });

  it('takes its visibility and width from params', () => {
    const p = PARAMS();
    const t = createTrail(p);
    t.applyParams();
    expect(t.mesh.visible).toBe(true);
    expect(t.material.uniforms.uWidth.value).toBe(0.34);
    p.trailEnabled = false;
    t.applyParams();
    expect(t.mesh.visible).toBe(false);
  });
});

describe('limb streaks', () => {
  it('samples the limb tips, not the runner position', () => {
    const p = PARAMS();
    const s = createLimbStreaks(p);
    const r = runnerAt(0, 0, 0);
    s.update(0, r);
    const first = s.ribbons[0].samples[0];
    expect(first).toMatchObject({ x: 0.3, y: 1.4, z: 0 });
    // Each ribbon must follow its OWN limb; one shared source would stack them.
    expect(s.ribbons[1].samples[0].x).toBe(-0.3);
    expect(s.ribbons[2].samples[0].y).toBe(0.2);
  });

  it('is scaled off the trail width', () => {
    const p = PARAMS();
    const s = createLimbStreaks(p);
    s.applyParams();
    expect(s.ribbons[0].material.uniforms.uWidth.value).toBeCloseTo(0.34 * 0.45, 10);
  });

  it('emits only when the sprint FX mode wants ghosts', () => {
    const p = PARAMS();
    const s = createLimbStreaks(p);
    p.sprintFx = 'plume';
    s.update(0, runnerAt(0, 0, 0));
    expect(s.samples).toBe(0);
    p.sprintFx = 'afterimages';
    s.update(0.1, runnerAt(0, 0, 0));
    expect(s.samples).toBeGreaterThan(0);
  });

  it('honours the toggle independently of the mode', () => {
    const p = PARAMS();
    const s = createLimbStreaks(p);
    p.limbStreaks = false;
    s.update(0, runnerAt(0, 0, 0));
    expect(s.samples).toBe(0);
  });

  it('stays visible so a mode switch ages the ribbons out instead of popping', () => {
    const p = PARAMS();
    const s = createLimbStreaks(p);
    p.sprintFx = 'plume';
    p.trailEnabled = false;
    s.applyParams();
    expect(s.meshes.every((m) => m.visible)).toBe(true);
  });

  it('clears every ribbon, not just the first', () => {
    // Lane wrap calls this; a ribbon left behind smears across the whole lane.
    const p = PARAMS();
    const s = createLimbStreaks(p);
    for (let i = 0; i < 4; i++) s.update(i * 0.1, runnerAt(i * 3, 0, 0));
    expect(s.samples).toBeGreaterThan(0);
    s.clear();
    expect(s.samples).toBe(0);
  });
});
