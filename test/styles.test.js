import { describe, it, expect } from 'vitest';
import { STYLE_KEYS, STYLE_PRESETS, STYLE_NAMES, applyStylePreset } from '../src/styles.js';

// Keys the engine owns. A style switch must never clobber these — losing a
// paused sim or a 65k capacity setting because you flipped styles is the bug
// this guards.
const ENGINE_KEYS = [
  'maxParticles',
  'pixelRatio',
  'timeScale',
  'autopilot',
  'forceSprint',
  'trailSamples',
  'style',
  'holdSpeed',
  'holdSpeedValue',
];

describe('style presets', () => {
  it('every preset defines every style key', () => {
    // Guards preset drift: adding a key to one style and forgetting the other
    // would leave the second style inheriting whatever the first left behind.
    for (const name of STYLE_NAMES) {
      const missing = STYLE_KEYS.filter((k) => !(k in STYLE_PRESETS[name]));
      expect(missing, `${name} is missing keys`).toEqual([]);
    }
  });

  it('no preset defines keys outside STYLE_KEYS', () => {
    for (const name of STYLE_NAMES) {
      const extra = Object.keys(STYLE_PRESETS[name]).filter((k) => !STYLE_KEYS.includes(k));
      expect(extra, `${name} has unlisted keys`).toEqual([]);
    }
  });

  it('ships at least the neon and smoke styles', () => {
    expect(STYLE_NAMES).toContain('neon');
    expect(STYLE_NAMES).toContain('smoke');
  });
});

describe('applyStylePreset', () => {
  it('overwrites every style key with the preset value', () => {
    const params = { ...STYLE_PRESETS.neon };
    applyStylePreset(params, STYLE_PRESETS.smoke);
    for (const key of STYLE_KEYS) {
      expect(params[key], key).toEqual(STYLE_PRESETS.smoke[key]);
    }
  });

  it('leaves engine keys untouched', () => {
    const params = {
      ...STYLE_PRESETS.neon,
      maxParticles: 65536,
      pixelRatio: 1.5,
      timeScale: 0,
      autopilot: true,
      forceSprint: true,
      trailSamples: 240,
      style: 'neon',
      holdSpeed: true,
      holdSpeedValue: 26,
    };
    // One fixture, asserted against itself after the switch: adding an engine
    // key needs a single edit rather than two literals kept in sync.
    const engineValues = Object.fromEntries(ENGINE_KEYS.map((k) => [k, params[k]]));
    applyStylePreset(params, STYLE_PRESETS.smoke);
    for (const key of ENGINE_KEYS) {
      expect(params[key], key).toEqual(engineValues[key]);
    }
  });

  it('covers every engine key in the fixture', () => {
    // Guards the guard: an ENGINE_KEY absent from the fixture above would be
    // compared undefined-to-undefined and pass without testing anything.
    const params = {
      maxParticles: 65536,
      pixelRatio: 1.5,
      timeScale: 0,
      autopilot: true,
      forceSprint: true,
      trailSamples: 240,
      style: 'neon',
      holdSpeed: true,
      holdSpeedValue: 26,
    };
    for (const key of ENGINE_KEYS) {
      expect(params[key], `${key} missing from the fixture`).toBeDefined();
    }
  });

  it('round-trips back to the original look', () => {
    const original = { ...STYLE_PRESETS.neon };
    const params = { ...STYLE_PRESETS.neon };
    applyStylePreset(params, STYLE_PRESETS.smoke);
    applyStylePreset(params, STYLE_PRESETS.neon);
    expect(params).toEqual(original);
  });

  it('mutates in place and returns the same object', () => {
    // The GUI holds a reference to one params object; replacing it would
    // silently unbind every controller.
    const params = { ...STYLE_PRESETS.neon };
    const returned = applyStylePreset(params, STYLE_PRESETS.smoke);
    expect(returned).toBe(params);
  });

  it('ignores keys the preset does not define', () => {
    const params = { ...STYLE_PRESETS.neon, colorA: '#123456' };
    applyStylePreset(params, { lifetime: 3 });
    expect(params.lifetime).toBe(3);
    expect(params.colorA).toBe('#123456');
  });

  it('the two styles actually differ', () => {
    const differing = STYLE_KEYS.filter(
      (k) => STYLE_PRESETS.neon[k] !== STYLE_PRESETS.smoke[k]
    );
    expect(differing.length).toBeGreaterThan(10);
    expect(differing).toContain('trailEnabled');
    expect(differing).toContain('smokeRatio');
  });
});
