import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { params } from './params.js';
import { buildCity } from './city.js';
import { createScene } from './scene.js';
import { createInput } from './input.js';
import { createRunner } from './runner.js';
import { createCameraRig } from './camera.js';
import { createScopeCamera } from './scope/scopeCamera.js';
import { createDeclutter } from './scope/declutter.js';
import { createRuler } from './scope/ruler.js';
import { createReadouts } from './scope/readouts.js';
import { createParticleSystem } from './particles/ParticleSystem.js';
import { createGpuEngine } from './particles/GpuEngine.js';
import { createTrail } from './trail/Trail.js';
import { createGame } from './game/Game.js';
import { createPost } from './post.js';
import { createGui } from './gui.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(params.pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = params.exposure;
document.body.appendChild(renderer.domElement);

// One layout, read by the renderer, the runner's collision and the camera's
// wall avoidance. Three consumers of one array rather than three descriptions
// of the same city kept in step by hand.
const city = buildCity();

const scene = createScene(city, params);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 4, 10);

const input = createInput(renderer.domElement);
const runner = createRunner(params, city);
scene.add(runner.group);

const particles = createParticleSystem(params);
scene.add(particles.mesh);
scene.add(particles.smokeMesh);

const gpuEngine = createGpuEngine(params, renderer);
scene.add(gpuEngine.mesh);
scene.add(gpuEngine.smokeMesh);

const trail = createTrail(params);
trail.mesh.renderOrder = 1; // additive systems composite over the smoke layer
scene.add(trail.mesh);

const game = createGame(params, particles);
scene.add(game.mesh);

const rig = createCameraRig(camera, city);
const scopeCam = createScopeCamera(camera);
const declutter = createDeclutter(scene);
const ruler = createRuler(document.getElementById('scope-ruler'));
scene.add(ruler.lines);
const readouts = createReadouts(document.getElementById('scope-readouts'));
const post = createPost(renderer, scene, camera, params);

const activeCamera = () => (params.scope ? scopeCam.active(params) : camera);

const stats = new Stats();
stats.dom.style.left = 'auto';
stats.dom.style.right = '0px';
document.body.appendChild(stats.dom);

function applyParams() {
  const gpgpu = params.engine === 'gpgpu';
  scene.applyParams();
  runner.applyParams();
  particles.applyParams();
  particles.mesh.visible = !gpgpu;
  particles.smokeMesh.visible = !gpgpu && params.style === 'smoke';
  gpuEngine.applyParams();
  trail.applyParams();
  game.applyParams();
  post.applyParams();
  renderer.setPixelRatio(params.pixelRatio);
  post.setCamera(activeCamera());
  declutter.apply(params);
  readouts.invalidate();
  // Scrub only means anything in the analytic engine, where position is a
  // closed form of time. Force it off elsewhere rather than showing a past the
  // GPGPU engine cannot reconstruct.
  if (params.engine !== 'analytic') params.scopeScrub = 0;
  onResize();
}

const fireScopeEvent = () => runner.triggerScopeEvent('turn', simTime, 3.2);

// Advance exactly one frame while paused. timeScale has to be forced, or
// stepping at timeScale 0 would advance nothing and look broken.
function stepOnce(dt = 1 / 60) {
  const saved = params.timeScale;
  params.timeScale = saved === 0 ? 1 : saved;
  frame(dt);
  params.timeScale = saved;
}

input.onTrigger = fireScopeEvent;
input.onStep = () => stepOnce();
createGui(params, applyParams, stats, fireScopeEvent, () => stepOnce());
applyParams();

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  scopeCam.resize(w, h, params);
  renderer.setSize(w, h);
  post.setSize(w, h);
}
window.addEventListener('resize', onResize);

// Sim clock: real time drives input/camera smoothing, sim time drives every
// particle age. Scaling only the sim clock makes pause and slow-mo exact,
// because particle motion is a closed-form function of sim time.
const timer = new THREE.Timer();
let simTime = 0;
const _vertBurst = new THREE.Vector3();

// Composer runs several passes per frame; without this, info.render reports
// only the last one and always reads as a single draw call.
renderer.info.autoReset = false;

function frame(dt) {
  const simDt = dt * params.timeScale;
  simTime += simDt;

  input.update();
  runner.update(simDt, simTime, input, rig.yaw + input.orbitYaw);

  // Rewind BEFORE the engines update. computeSpawn interpolates each spawn
  // between the previous and current position, so if the emitters still held
  // the pre-wrap x, one frame's spawns would smear as a single streak across
  // the entire lane — and sweptCollect would collect every ring on the line.
  if (runner.laneWrapped) {
    runner.laneWrapped = false;
    particles.clear();
    gpuEngine.clear();
    trail.clear();
    game._prevValid = false;
  }

  // Vertical transitions get their own burst, through the same ring-buffer path
  // as a pickup collection. Before the emitter below, so a burst ships in the
  // same buffer upload as this frame's continuous emission.
  // Analytic only, like every other burst: the GPGPU engine has no injection
  // path for one-off emissions.
  if (runner.verticalEvent === 'takeoff' || runner.verticalEvent === 'land') {
    const landing = runner.verticalEvent === 'land';
    _vertBurst.set(runner.position.x, runner.position.y + 0.14, runner.position.z);
    particles.emitBurst(_vertBurst, landing ? 260 : 120, {
      simTime,
      // Landing splashes outward and slightly up; takeoff kicks down, so the
      // light reads as being pushed against rather than as a second jet.
      speed: landing ? 8.5 : 5.5,
      lifetime: params.lifetime * (landing ? 1.1 : 0.8),
      up: landing ? 0.35 : -2.6,
    });
  }

  if (params.scope) scopeCam.update(runner, params);
  else rig.update(dt, runner, input);
  ruler.update(activeCamera(), params, scopeCam.centerX, params.scopeViewHeight, scopeCam.aspect);
  // Before the emitter, so a collection burst this frame ships in the same
  // buffer upload as the runner's continuous emission.
  game.update(simDt, simTime, runner);
  // Only the active engine simulates; the other's mesh is hidden and its state
  // left untouched, so switching back resumes rather than restarts.
  if (params.engine === 'gpgpu') {
    trail.update(simTime, runner);
    gpuEngine.update(simDt, simTime, runner, trail);
  } else {
    particles.update(simDt, simTime, runner);
    trail.update(simTime, runner);
  }

  readouts.update(params, simTime, runner, particles, gpuEngine, renderer);

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
  city,
  runner,
  particles,
  gpuEngine,
  trail,
  game,
  rig,
  input,
  params,
  applyParams,
  buildSha: __BUILD_SHA__,
  simTime: () => simTime,
  step: (count = 1, dt = 1 / 60) => {
    for (let i = 0; i < count; i++) frame(dt);
    return { simTime, pos: runner.position.toArray(), speed: runner.speed };
  },
  scope: {
    camera: activeCamera,
    // Verification hook: under an orthographic projection this must leave the
    // rendered frame bit-identical, which is what proves the billboard basis
    // is not using the perspective-only camera direction.
    dolly: (d) => scopeCam.dolly(d),
    resetDolly: () => {
      scopeCam.dollyOffset = 0;
    },
    sample: () => runner.scopeSample,
    trigger: (kind = 'turn', duration = 1.6) =>
      runner.triggerScopeEvent(kind, simTime, duration),
  },
};
