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

describe('a hand-jet glide moves the ribbons to the hands', () => {
  // The reported bug: during a hands-glide the only ribbon still drawing was
  // the CHEST one, so the effect read as a streak trailing out of the runner's
  // back rather than light coming off the palms.
  const gliding = (dissolve = 1) => ({ ...runnerAt(0, 20, 0, dissolve), vertical: { mode: 'glide' } });
  const grounded = (dissolve = 1) => ({ ...runnerAt(0, 0, 0, dissolve), vertical: { mode: 'ground' } });

  /** Walk a runner along +x so each ribbon clears its own minimum-step test. */
  function drive(streaks, make, frames = 6) {
    for (let k = 0; k < frames; k++) {
      const r = make();
      r.position.x = k * 2;
      for (const p of r.streakPoints) p.x += k * 2;
      streaks.update(k * 0.1, r);
    }
  }

  it('draws from the hands and not the feet while gliding', () => {
    const p = { ...PARAMS(), glideFx: 'hands' };
    const s = createLimbStreaks(p);
    drive(s, gliding);
    const counts = s.ribbons.map((r) => r.samples.length);
    expect(counts[0]).toBeGreaterThan(0); // left hand
    expect(counts[1]).toBeGreaterThan(0); // right hand
    expect(counts[2]).toBe(0); // left foot
    expect(counts[3]).toBe(0); // right foot
  });

  it('keeps the hand ribbons alive in a slow hover, where dissolve is zero', () => {
    // dissolve is a SPRINT-glow test and a hover is not a sprint. emissionRate
    // already floors the jet for this reason; without the same treatment the
    // palms would draw nothing exactly when the jet is firing hardest.
    const p = { ...PARAMS(), glideFx: 'hands' };
    const s = createLimbStreaks(p);
    drive(s, () => gliding(0));
    expect(s.ribbons[0].samples.length).toBeGreaterThan(0);
  });

  it('draws from the hands even when the sprint FX wants no ghosts', () => {
    const p = { ...PARAMS(), sprintFx: 'plume', glideFx: 'hands' };
    const s = createLimbStreaks(p);
    drive(s, gliding);
    expect(s.ribbons[0].samples.length).toBeGreaterThan(0);
  });

  it('leaves all four ribbons on the normal gate in streak mode', () => {
    const p = { ...PARAMS(), glideFx: 'streak' };
    const s = createLimbStreaks(p);
    drive(s, gliding);
    expect(s.ribbons.every((r) => r.samples.length > 0)).toBe(true);
  });

  it('does not change grounded behaviour', () => {
    const p = { ...PARAMS(), glideFx: 'hands' };
    const s = createLimbStreaks(p);
    drive(s, grounded);
    expect(s.ribbons.every((r) => r.samples.length > 0)).toBe(true);
  });
});
