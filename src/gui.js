import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { CAPACITY } from './particles/ParticleSystem.js';
import { STYLE_NAMES, STYLE_PRESETS, applyStylePreset } from './styles.js';

export function createGui(params, apply, stats, onTrigger, onStep) {
  const gui = new GUI({ title: 'NEON RUNNER' });
  const on = () => apply();
  // Anything that writes params behind the user's back has to tell the panel,
  // or the controls show stale values.
  const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());

  gui
    .add(params, 'style', STYLE_NAMES)
    .name('STYLE')
    .onChange((name) => {
      // Style-owned keys reset to the preset; engine keys (capacity, time
      // scale, autopilot) persist. Every controller then has to be told its
      // bound value moved underneath it.
      applyStylePreset(params, STYLE_PRESETS[name]);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      apply();
    });

  gui
    .add(params, 'engine', ['analytic', 'gpgpu'])
    .name('ENGINE')
    .onChange(() => {
      // The GPGPU engine integrates with Euler over a variable timestep, so a
      // past frame cannot be reconstructed from a timestamp. Disable rather
      // than approximate — a control that quietly lies is worse than one that
      // is visibly unavailable.
      const gpgpu = params.engine === 'gpgpu';
      // Leaving the engine that supports scrubbing must also release the pause
      // the scrub took, or switching engines mid-scrub strands the sim frozen.
      if (gpgpu && params.scopeScrub !== 0) releaseScrub();
      scrubCtrl.disable(gpgpu);
      scrubCtrl.name(gpgpu ? 'scrub (analytic only)' : 'scrub (analytic)');
      on();
    });

  const forces = gui.addFolder('Forces (gpgpu)');
  forces.add(params, 'vortex', 0, 20, 0.1).name('trail vortex');
  forces.add(params, 'turbulence', 0, 4, 0.05).name('turbulence');
  forces.add(params, 'regather', 0, 12, 0.1).name('regather on stop');
  forces.close();

  const emit = gui.addFolder('Emission');
  emit.add(params, 'maxParticles', 2000, CAPACITY, 1000).name('max particles').onChange(on);
  emit.add(params, 'walkRate', 0, 2000, 10).name('walk rate /s').onChange(on);
  emit.add(params, 'sprintRate', 0, 30000, 100).name('sprint rate /s').onChange(on);
  emit.add(params, 'lifetime', 0.2, 3.0, 0.05).name('lifetime (s)').onChange(on);
  emit.add(params, 'spread', 0, 8, 0.05).name('spread').onChange(on);
  emit.add(params, 'riseBias', -2, 6, 0.05).name('rise').onChange(on);
  emit.add(params, 'drag', 0.2, 6, 0.05).name('drag').onChange(on);

  const look = gui.addFolder('Streaks');
  look.add(params, 'streakWidth', 0.005, 0.2, 0.001).name('width').onChange(on);
  look.add(params, 'streakLength', 0.01, 1.0, 0.01).name('length').onChange(on);
  look.add(params, 'streakStretch', 0, 0.3, 0.001).name('stretch / speed').onChange(on);
  look.add(params, 'streakIntensity', 0.05, 2, 0.01).name('intensity').onChange(on);
  look.add(params, 'wobble', 0, 3, 0.01).name('wobble').onChange(on);

  const pal = gui.addFolder('Palette');
  pal.addColor(params, 'colorA').name('primary').onChange(on);
  pal.addColor(params, 'colorB').name('secondary').onChange(on);
  pal.addColor(params, 'colorC').name('tertiary').onChange(on);
  pal.addColor(params, 'smokeColor').name('smoke').onChange(on);

  const smoke = gui.addFolder('Smoke');
  smoke.add(params, 'smokeRatio', 0, 1, 0.01).name('smoke / ember mix').onChange(on);
  smoke.add(params, 'smokeGrow', 0, 6, 0.05).name('growth').onChange(on);
  smoke.add(params, 'smokeOpacity', 0, 1, 0.01).name('opacity').onChange(on);

  const trail = gui.addFolder('Trail');
  trail.add(params, 'trailEnabled').name('enabled').onChange(on);
  trail.add(params, 'trailSamples', 2, 240, 1).name('samples').onChange(on);
  trail.add(params, 'trailWidth', 0, 2, 0.01).name('width').onChange(on);
  trail.add(params, 'trailFade', 0.1, 4, 0.05).name('fade (s)').onChange(on);

  const post = gui.addFolder('Bloom');
  post.add(params, 'bloomStrength', 0, 4, 0.01).name('strength').onChange(on);
  post.add(params, 'bloomRadius', 0, 1.5, 0.01).name('radius').onChange(on);
  post.add(params, 'bloomThreshold', 0, 1, 0.01).name('threshold').onChange(on);
  post.add(params, 'exposure', 0.2, 2.5, 0.01).name('exposure').onChange(on);
  post.add(params, 'pixelRatio', 0.5, 2, 0.25).name('pixel ratio').onChange(on);

  const g = gui.addFolder('Game');
  g.add(params, 'game').name('pickups').onChange(on);
  g.add(params, 'collectRadius', 0.5, 5, 0.1).name('collect radius');

  const scope = gui.addFolder('Scope');
  scope.add(params, 'scope').name('SCOPE VIEW').onChange(on);
  scope.add(params, 'scopeProjection', ['ortho', 'persp']).name('projection').onChange(on);
  scope.add(params, 'scopeViewHeight', 6, 80, 0.5).name('view height').onChange(on);
  scope.add(params, 'scopeLead', 0.05, 0.95, 0.01).name('runner position');
  scope.add(params, 'scopeInterval', 0.5, 10, 0.1).name('event interval (s)');
  scope.add(params, 'scopeTurn').name('· turns');
  const sprintPulseCtrl = scope.add(params, 'scopeSprint').name('· sprint pulses');
  const stopCtrl = scope.add(params, 'scopeStop').name('· stops');
  scope.add(params, 'scopeTurnAmplitude', 0, 8, 0.25).name('turn amplitude');
  scope.add(params, 'scopeLaneHalf', 100, 20000, 100).name('lane half-length');
  scope.add(params, 'scopeBackdrop').name('keep backdrop').onChange(on);
  scope.add(params, 'scopeRuler').name('ruler');
  scope.add(params, 'scopeReadouts').name('readouts');
  scope.add(params, 'scopeReadbackHz', [1, 2, 4, 8]).name('readback Hz (gpgpu)');
  scope.add({ fire: () => onTrigger?.() }, 'fire').name('trigger event  [T]');

  // The time scale the scrub borrowed, so it can be handed back. A control that
  // silently pauses the world must own un-pausing it too, or it is a trap.
  let borrowedTimeScale = null;

  function releaseScrub() {
    params.scopeScrub = 0;
    if (borrowedTimeScale !== null) {
      params.timeScale = borrowedTimeScale;
      borrowedTimeScale = null;
    }
    if (params.timeScale === 0) params.timeScale = 1;
    refresh();
  }

  const scrubCtrl = scope
    .add(params, 'scopeScrub', -3, 0, 0.01)
    .name('scrub (analytic)')
    .onChange((v) => {
      if (v !== 0) {
        // Scrubbing while the sim advances would mix two different times in one
        // frame; pausing removes that whole class of confusion.
        if (params.timeScale !== 0) {
          borrowedTimeScale = params.timeScale;
          params.timeScale = 0;
          refresh();
        }
      } else {
        releaseScrub();
      }
    });
  scope.add({ step: () => onStep?.() }, 'step').name('step one frame  [.]');
  scope.add({ resume: releaseScrub }, 'resume').name('▶ resume');

  const sim = gui.addFolder('Sim');
  sim.add(params, 'timeScale', 0, 2, 0.01).name('time scale');
  sim.add(params, 'autopilot').name('autopilot');
  const forceSprintCtrl = sim.add(params, 'forceSprint').name('force sprint');

  // Speed lock. Lives here rather than in Scope because it applies everywhere
  // and this is where the other motion overrides already are.
  const holdCtrl = sim.add(params, 'holdSpeed').name('HOLD SPEED');
  sim.add(params, 'holdSpeedValue', 0, 30, 0.5).name('· speed (u/s)');

  // These three only modulate speed, so a lock makes every one of them a no-op.
  // Greying them out beats leaving controls that silently do nothing.
  function syncHoldSpeed() {
    const held = params.holdSpeed;
    sprintPulseCtrl.disable(held);
    stopCtrl.disable(held);
    forceSprintCtrl.disable(held);
    sprintPulseCtrl.name(held ? '· sprint pulses (held)' : '· sprint pulses');
    stopCtrl.name(held ? '· stops (held)' : '· stops');
  }
  holdCtrl.onChange(syncHoldSpeed);
  syncHoldSpeed();
  sim.add({ stats: true }, 'stats').name('show fps').onChange((v) => {
    stats.dom.style.display = v ? '' : 'none';
  });

  post.close();
  return gui;
}
