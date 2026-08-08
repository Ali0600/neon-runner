// Visual style presets.
//
// A style owns the *look* keys listed in STYLE_KEYS. Everything else in params
// (capacity, pixel ratio, time scale, autopilot flags) belongs to the engine and
// survives a style switch — you should not lose your 65k particle setting or a
// paused sim because you flipped to smoke.
//
// Presets are plain data so the GUI stays bound to one params object: switching
// mutates that object in place rather than replacing it.

export const STYLE_KEYS = [
  'colorA',
  'colorB',
  'colorC',
  'smokeColor',
  'walkRate',
  'sprintRate',
  'lifetime',
  'spread',
  'riseBias',
  'drag',
  'streakWidth',
  'streakLength',
  'streakStretch',
  'streakIntensity',
  'wobble',
  'smokeRatio',
  'smokeGrow',
  'smokeOpacity',
  'trailEnabled',
  'trailWidth',
  'trailFade',
  'bloomStrength',
  'bloomRadius',
  'bloomThreshold',
  'exposure',
];

export const STYLE_PRESETS = {
  neon: {
    colorA: '#ff2bd6', // magenta
    colorB: '#25f5ff', // cyan
    colorC: '#8a2bff', // violet
    smokeColor: '#2a2622', // unused in this style, but every preset covers every key
    walkRate: 160,
    sprintRate: 7000,
    lifetime: 0.95,
    spread: 2.1,
    riseBias: 1.0,
    drag: 2.7,
    streakWidth: 0.028,
    streakLength: 0.09,
    streakStretch: 0.055,
    streakIntensity: 0.5,
    wobble: 0.7,
    smokeRatio: 0.0,
    smokeGrow: 1.8,
    smokeOpacity: 0.5,
    trailEnabled: true,
    trailWidth: 0.34,
    trailFade: 1.1,
    bloomStrength: 1.1,
    bloomRadius: 0.7,
    bloomThreshold: 0.75,
    exposure: 0.95,
  },

  smoke: {
    colorA: '#ff6a1a', // ember orange
    colorB: '#ffc24a', // hot yellow
    colorC: '#c62d08', // deep red
    // Nothing lights the smoke, so its colour has to sit well above the near
    // black background on its own or the wisps are invisible.
    smokeColor: '#7d7267',
    walkRate: 120,
    // Larger, longer-lived particles: smoke reads as mass, not as speed.
    sprintRate: 5400,
    lifetime: 1.9,
    spread: 1.7,
    riseBias: 2.3, // buoyant
    drag: 1.7,
    streakWidth: 0.075,
    streakLength: 0.045,
    streakStretch: 0.016,
    streakIntensity: 0.8,
    wobble: 1.35, // turbulent
    smokeRatio: 0.58, // 58% smoke wisps, 42% embers
    smokeGrow: 3.2,
    // Low per-puff alpha so density comes from overlap; individually opaque
    // wisps read as discrete grey discs rather than as a plume.
    smokeOpacity: 0.2,
    // An additive light ribbon fights smoke's dark value structure — the wisps
    // themselves supply the continuity the ribbon exists to provide in neon.
    trailEnabled: false,
    trailWidth: 0.34,
    trailFade: 1.1,
    bloomStrength: 0.85,
    bloomRadius: 0.6,
    bloomThreshold: 0.62,
    exposure: 1.0,
  },
};

export const STYLE_NAMES = Object.keys(STYLE_PRESETS);

/**
 * Copy a style preset's keys into a params object, in place.
 * Only STYLE_KEYS are touched; engine keys are left alone.
 * Returns the same object for convenience.
 */
export function applyStylePreset(params, preset) {
  for (const key of STYLE_KEYS) {
    if (key in preset) params[key] = preset[key];
  }
  return params;
}
