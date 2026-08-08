import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { params } from './params.js';
import { createScene } from './scene.js';
import { createInput } from './input.js';
import { createRunner } from './runner.js';
import { createCameraRig } from './camera.js';
import { createParticleSystem } from './particles/ParticleSystem.js';
import { createTrail } from './trail/Trail.js';
import { createPost } from './post.js';
import { createGui } from './gui.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(params.pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = params.exposure;
document.body.appendChild(renderer.domElement);

const scene = createScene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 4, 10);

const input = createInput(renderer.domElement);
const runner = createRunner(params);
scene.add(runner.group);

const particles = createParticleSystem(params);
scene.add(particles.mesh);

const trail = createTrail(params);
scene.add(trail.mesh);

const rig = createCameraRig(camera);
const post = createPost(renderer, scene, camera, params);

const stats = new Stats();
stats.dom.style.left = 'auto';
stats.dom.style.right = '0px';
document.body.appendChild(stats.dom);

function applyParams() {
  runner.applyParams();
  particles.applyParams();
  trail.applyParams();
  post.applyParams();
  renderer.setPixelRatio(params.pixelRatio);
  onResize();
}

createGui(params, applyParams, stats);
applyParams();

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  post.setSize(w, h);
}
window.addEventListener('resize', onResize);

// Sim clock: real time drives input/camera smoothing, sim time drives every
// particle age. Scaling only the sim clock makes pause and slow-mo exact,
// because particle motion is a closed-form function of sim time.
const timer = new THREE.Timer();
let simTime = 0;

// Composer runs several passes per frame; without this, info.render reports
// only the last one and always reads as a single draw call.
renderer.info.autoReset = false;

function frame(dt) {
  const simDt = dt * params.timeScale;
  simTime += simDt;

  input.update();
  runner.update(simDt, simTime, input, rig.yaw + input.orbitYaw);
  rig.update(dt, runner, input);
  particles.update(simDt, simTime, runner);
  trail.update(simTime, runner);

  renderer.info.reset();
  post.render();
}

function animate() {
  timer.update();
  // A backgrounded tab returns one huge delta; clamping stops the runner from
  // teleporting and the emitter from dumping a whole buffer in one frame.
  frame(Math.min(timer.getDelta(), 0.05));
  stats.update();
}
renderer.setAnimationLoop(animate);

// Verification hooks. `step` drives frames without rAF, which a hidden or
// throttled tab never delivers — headless screenshots depend on it.
window.__app = {
  renderer,
  scene,
  camera,
  runner,
  particles,
  trail,
  rig,
  input,
  params,
  applyParams,
  simTime: () => simTime,
  step: (count = 1, dt = 1 / 60) => {
    for (let i = 0; i < count; i++) frame(dt);
    return { simTime, pos: runner.position.toArray(), speed: runner.speed };
  },
};
