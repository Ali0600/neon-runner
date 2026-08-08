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
  // 'analytic' derives position from a closed form (exact pause and scrub);
  // 'gpgpu' integrates state in ping-pong textures, which is what makes the
  // feedback forces below possible at all.
  engine: 'analytic',
  vortex: 10,
  turbulence: 1.0,
  regather: 3.0,

  maxParticles: 30000,
  trailSamples: 110,
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2),

  // --- game ---
  game: true,
  // Generous next to the runner's ~0.28 u per frame at sprint, but collection
  // is swept rather than point-sampled, so this is about feel, not tunnelling.
  collectRadius: 1.6,

  // --- sim ---
  timeScale: 1.0,

  // --- debug / verification hooks ---
  autopilot: false,
  forceSprint: false,
};
