// Single shared mutable params object. The GUI writes to it; systems read it
// every frame. Colors are hex strings so lil-gui's addColor can bind directly;
// systems convert to THREE.Color on change via applyParams().

export const params = {
  // --- emission ---
  maxParticles: 30000,
  walkRate: 160, // particles/sec at walk
  sprintRate: 7000, // particles/sec at full sprint
  lifetime: 0.95, // seconds
  spread: 2.1, // random velocity magnitude added at spawn
  riseBias: 1.0, // upward drift
  drag: 2.7, // exponential deceleration; keeps the cloud hugging the path

  // --- streak look ---
  // Individually dim and thin: the neon reads as many distinct streaks, and
  // additive stacking stays under saturation so the palette survives.
  streakWidth: 0.028,
  streakLength: 0.09,
  streakStretch: 0.055, // extra length per unit of particle speed
  streakIntensity: 0.5,
  wobble: 0.7,

  // --- palette ---
  colorA: '#ff2bd6', // magenta
  colorB: '#25f5ff', // cyan
  colorC: '#8a2bff', // violet

  // --- trail ---
  trailSamples: 110,
  trailWidth: 0.34,
  trailFade: 1.1, // seconds for a sample to fade out

  // --- post ---
  // A high threshold keeps bloom off the mid-tones, so the glow stays coloured
  // instead of washing the whole frame to white.
  bloomStrength: 1.1,
  bloomRadius: 0.7,
  bloomThreshold: 0.75,
  exposure: 0.95,
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2),

  // --- sim ---
  timeScale: 1.0,

  // --- debug / verification hooks ---
  autopilot: false,
  forceSprint: false,
};
