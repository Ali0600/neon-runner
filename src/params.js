import { STYLE_PRESETS } from './styles.js';

// Single shared mutable params object. The GUI writes to it; systems read it
// every frame. Colors are hex strings so lil-gui's addColor can bind directly;
// systems convert to THREE.Color on change via applyParams().
//
// Style-owned look keys come from a preset (see styles.js) and are replaced
// wholesale when the style changes. The keys below the spread are engine-owned
// and survive style switches.

export const params = {
  ...STYLE_PRESETS.neon,

  style: 'neon',

  // --- engine ---
  maxParticles: 30000,
  trailSamples: 110,
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2),

  // --- sim ---
  timeScale: 1.0,

  // --- debug / verification hooks ---
  autopilot: false,
  forceSprint: false,
};
