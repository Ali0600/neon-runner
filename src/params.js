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
  scope: true,
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
  // Every scheduled event starts OFF, so entering SCOPE gives a steady cruise —
  // the state where the effect under inspection is not being perturbed by
  // anything. Tick the ones you want to watch. `buildSchedule` treats an empty
  // set as pure cruise with a non-zero period, so this is a supported
  // configuration rather than a degenerate one.
  scopeTurn: false,
  scopeSprint: false,
  scopeStop: false,
  scopeJump: false,
  // Which kind the T key and the fire button inject. It was hardwired to 'turn',
  // which meant a newly added event could only be seen by waiting for the
  // schedule to come round to it — in the one view built for watching a single
  // transient in isolation.
  scopeTriggerKind: 'turn',
  // The lane grows a synthetic wall for this one, and the camera tracks height
  // to follow the climb — see SCOPE_WALL_TOP.
  scopeWallrun: false,
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

  // --- sprint FX ---
  // What a sprint looks like: the continuous particle plume, inFamous-style
  // afterimages peeling off the body, or both. Engine-owned so the choice
  // survives a style switch — it is a different effect, not a different palette.
  sprintFx: 'plume', // 'plume' | 'afterimages' | 'both'
  ghostCount: 14, // ring size, hard-capped by MAX_GHOSTS
  ghostSpacing: 1.8, // world units between snapshots
  ghostFade: 1.4, // seconds from capture to fully dissolved
  // Emissive gain, before the count normalization. Held well below 1: additive
  // shells stack, and once the chain blows out to white the figures merge into
  // one bright smear and their shape stops reading.
  ghostIntensity: 0.45,
  // Higher than the trail's 0.02 on purpose: afterimages belong to the sprint,
  // and ghosts emitted at a walk just crowd the runner.
  ghostMinDissolve: 0.35,
  // The chain is only continuous while the oldest ghost expires before the ring
  // overwrites it: ghostFade <= ghostSpacing * ghostCount / SPRINT_SPEED
  // (1.4 <= 1.48 here). Past that the tail pops out early rather than fading —
  // which is why a longer fade needed a bigger ring, not just a bigger number.

  // A ghost does not fade out where it stands — the matter it loses to erosion
  // is redrawn as particles flying outward, so the death reads as scattering
  // rather than as the silhouette being eaten inward.
  // Scales how far the debris travels as it ages. Deliberately short: the
  // sparks ARE the figure now (a ghost is born mostly converted), so how far
  // they fly is how much of the body's shape survives. Keep them close and the
  // cloud's edge is the pose's outline; let them run and it is a bright blob.
  // It scales flight at every age, so this also sets how loose the tail gets —
  // 0.3 is the value that keeps a readable figure without flattening the dust.
  ghostSparkReach: 0.3,
  ghostSparkSize: 0.04, // spark diameter, in world units at any zoom
  limbStreaks: true,
  limbStreakWidth: 0.45, // multiplier on trailWidth

  // --- sim ---
  timeScale: 1.0,

  // --- motion overrides ---
  // Lock the runner to a constant speed so the only thing changing while you
  // tune is the setting you are dragging. Overrides the sprint flag and any
  // speed the scope scheduler asks for; direction is untouched, so turns still
  // steer. Range goes past SPRINT_SPEED (17) deliberately, to exaggerate streak
  // stretch and emission beyond what normal play reaches.
  // On by default alongside SCOPE, so the view opens on a steady sprint with
  // nothing modulating it. At 12 the dissolve sits around 0.59 — above
  // ghostMinDissolve (0.35), so the afterimage chain still emits.
  holdSpeed: true,
  holdSpeedValue: 12,

  // --- debug / verification hooks ---
  autopilot: false,
  // Redundant while holdSpeed is on — the lock returns first in
  // resolveTargetSpeed, so this is a no-op and the GUI greys it out. Kept on so
  // that unticking HOLD SPEED leaves the runner sprinting rather than dropping
  // to a walk.
  forceSprint: true,
};
