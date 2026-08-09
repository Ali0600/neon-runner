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

  // --- scope (inspection view) ---
  scope: false,
  scopeProjection: 'ortho',
  scopeViewHeight: 14, // world units visible vertically
  // Runner's screen position, 0 = left edge, 1 = right. It travels toward +x,
  // so it sits right-of-centre and the plume trailing behind fills the frame.
  scopeLead: 0.74,
  // Lane half-length. Not larger: f32 resolution at |x|=2000 is 1.2e-4 (0.4% of
  // the 0.028 streak width) but 2.0e-3 at 20000 (7%), and the shader's
  // viewMatrix * position subtracts same-magnitude numbers, so that error lands
  // straight on relative particle position.
  scopeLaneHalf: 2000,
  scopeInterval: 3.0, // cruise seconds between events
  scopeTurn: true,
  scopeSprint: true,
  scopeStop: true,
  // Kept within what the runner can physically track during a turn segment —
  // a larger value just saturates the steering and the number stops meaning
  // anything. See TURN_SPEED_MIX in scope/schedule.js.
  scopeTurnAmplitude: 4,
  scopeBackdrop: false, // false = decluttered; the point of the view
  scopeRuler: true,
  scopeReadouts: true,
  scopeReadbackHz: 4,
  // Negative seconds into the past. Analytic engine only — see D26.
  scopeScrub: 0,

  // --- sim ---
  timeScale: 1.0,

  // --- debug / verification hooks ---
  autopilot: false,
  forceSprint: false,
};
