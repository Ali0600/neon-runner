import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { CAPACITY } from './particles/ParticleSystem.js';

export function createGui(params, apply, stats) {
  const gui = new GUI({ title: 'NEON RUNNER' });
  const on = () => apply();

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
  pal.addColor(params, 'colorA').name('magenta').onChange(on);
  pal.addColor(params, 'colorB').name('cyan').onChange(on);
  pal.addColor(params, 'colorC').name('violet').onChange(on);

  const trail = gui.addFolder('Trail');
  trail.add(params, 'trailSamples', 2, 240, 1).name('samples').onChange(on);
  trail.add(params, 'trailWidth', 0, 2, 0.01).name('width').onChange(on);
  trail.add(params, 'trailFade', 0.1, 4, 0.05).name('fade (s)').onChange(on);

  const post = gui.addFolder('Bloom');
  post.add(params, 'bloomStrength', 0, 4, 0.01).name('strength').onChange(on);
  post.add(params, 'bloomRadius', 0, 1.5, 0.01).name('radius').onChange(on);
  post.add(params, 'bloomThreshold', 0, 1, 0.01).name('threshold').onChange(on);
  post.add(params, 'exposure', 0.2, 2.5, 0.01).name('exposure').onChange(on);
  post.add(params, 'pixelRatio', 0.5, 2, 0.25).name('pixel ratio').onChange(on);

  const sim = gui.addFolder('Sim');
  sim.add(params, 'timeScale', 0, 2, 0.01).name('time scale');
  sim.add(params, 'autopilot').name('autopilot');
  sim.add(params, 'forceSprint').name('force sprint');
  sim.add({ stats: true }, 'stats').name('show fps').onChange((v) => {
    stats.dom.style.display = v ? '' : 'none';
  });

  post.close();
  return gui;
}
