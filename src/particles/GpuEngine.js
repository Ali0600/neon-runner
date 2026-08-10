import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { CAPACITY } from './ParticleSystem.js';
import { slotToNdc, slotToUv } from './slotUv.js';
import {
  takeSpawnCount,
  emissionRate,
  computeSpawn,
  fillSpawnContext,
} from './spawnComputation.js';
import commonChunk from '../shaders/chunks/particleCommon.glsl?raw';
import gpguVertexBody from '../shaders/particles.gpgpu.vert.glsl?raw';
import fragmentShader from '../shaders/particles.frag.glsl?raw';
import positionCompute from '../shaders/gpgpu/position.frag.glsl?raw';
import velocityCompute from '../shaders/gpgpu/velocity.frag.glsl?raw';
import spawnVert from '../shaders/gpgpu/spawn.vert.glsl?raw';
import spawnFrag from '../shaders/gpgpu/spawn.frag.glsl?raw';

// 256 x 256 = 65,536 = CAPACITY exactly, so a ring slot maps one-to-one onto a
// texel and the two engines address particles identically.
const TEX_W = 256;
const TEX_H = 256;

// Ceiling on injections per frame. At the maximum sprint rate and the clamped
// 50 ms frame this is comfortably above what can ever be produced in one frame.
const MAX_SPAWN = 4096;

const TRAIL_MAX = 24; // must match TRAIL_MAX in velocity.frag.glsl

const _prev = new THREE.Vector3();
const _ctx = {};

export function createGpuEngine(params, renderer) {
  const gpu = new GPUComputationRenderer(TEX_W, TEX_H, renderer);

  const pos0 = gpu.createTexture();
  const vel0 = gpu.createTexture();
  // Start every slot dead. A negative life is the render shader's discard test,
  // so nothing appears until something is actually spawned.
  const pd = pos0.image.data;
  const vd = vel0.image.data;
  for (let i = 0; i < CAPACITY; i++) {
    pd[i * 4 + 1] = -1e4;
    pd[i * 4 + 3] = -1;
    vd[i * 4 + 3] = -1;
  }

  const posVar = gpu.addVariable('texturePosition', positionCompute, pos0);
  const velVar = gpu.addVariable('textureVelocity', velocityCompute, vel0);
  gpu.setVariableDependencies(posVar, [posVar, velVar]);
  gpu.setVariableDependencies(velVar, [posVar, velVar]);

  const trailPts = [];
  for (let i = 0; i < TRAIL_MAX; i++) trailPts.push(new THREE.Vector3());

  Object.assign(posVar.material.uniforms, { uDt: { value: 0 } });
  Object.assign(velVar.material.uniforms, {
    uDt: { value: 0 },
    uTime: { value: 0 },
    uDrag: { value: params.drag },
    uRise: { value: params.riseBias },
    uRunnerPos: { value: new THREE.Vector3() },
    uRegather: { value: 0 },
    uVortex: { value: params.vortex },
    uTurbulence: { value: params.turbulence },
    uTrailPts: { value: trailPts },
    uTrailCount: { value: 0 },
  });

  const initError = gpu.init();
  if (initError !== null) {
    // Float render targets are the usual reason this fails. Surface it rather
    // than leaving a silently empty engine that looks like a broken feature.
    console.error('[NEON RUNNER] GPGPU engine unavailable:', initError);
  }

  // --- render mesh ---------------------------------------------------------
  // Same instanced quad and same fragment shader as the analytic engine; only
  // the vertex stage differs, reading state from textures instead of deriving
  // it from a closed form.
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
      3
    )
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  const refs = new Float32Array(CAPACITY * 2);
  const seeds = new Float32Array(CAPACITY);
  for (let i = 0; i < CAPACITY; i++) {
    const [u, v] = slotToUv(i, TEX_W, TEX_H);
    refs[i * 2] = u;
    refs[i * 2 + 1] = v;
    seeds[i] = Math.random();
  }
  geometry.setAttribute('aRef', new THREE.InstancedBufferAttribute(refs, 2));
  const seedAttr = new THREE.InstancedBufferAttribute(seeds, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aSeed', seedAttr);

  const uniforms = {
    uPosTex: { value: null },
    uVelTex: { value: null },
    uWidth: { value: params.streakWidth },
    uLength: { value: params.streakLength },
    uStretch: { value: params.streakStretch },
    uSmokeRatio: { value: 0 },
    uGrow: { value: params.smokeGrow },
    uIntensity: { value: params.streakIntensity },
    uSmokeOpacity: { value: params.smokeOpacity },
    uColorA: { value: new THREE.Color(params.colorA) },
    uColorB: { value: new THREE.Color(params.colorB) },
    uColorC: { value: new THREE.Color(params.colorC) },
    uSmokeColor: { value: new THREE.Color(params.smokeColor) },
  };

  const vertexShader = `${commonChunk}\n${gpguVertexBody}`;
  function makeMaterial(kind, blending) {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      defines: { [kind]: '' },
      transparent: true,
      blending,
      depthWrite: false,
      depthTest: true,
    });
  }
  const materials = {
    streak: makeMaterial('KIND_STREAK', THREE.AdditiveBlending),
    ember: makeMaterial('KIND_EMBER', THREE.AdditiveBlending),
    smoke: makeMaterial('KIND_SMOKE', THREE.NormalBlending),
  };

  const mesh = new THREE.Mesh(geometry, materials.streak);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;

  const smokeMesh = new THREE.Mesh(geometry, materials.smoke);
  smokeMesh.frustumCulled = false;
  smokeMesh.renderOrder = 0;
  smokeMesh.visible = false;

  // --- spawn injection -----------------------------------------------------
  // A one-pixel point rendered at the texel centre of each spawned slot writes
  // straight into the live state target. Only spawned slots are uploaded — the
  // same bandwidth profile as the analytic engine's partial buffer ranges.
  const spawnPositions = new Float32Array(MAX_SPAWN * 3);
  const spawnPosData = new Float32Array(MAX_SPAWN * 4);
  const spawnVelData = new Float32Array(MAX_SPAWN * 4);

  const spawnGeometry = new THREE.BufferGeometry();
  const spawnPosAttr = new THREE.BufferAttribute(spawnPositions, 3).setUsage(
    THREE.DynamicDrawUsage
  );
  const spawnPosDataAttr = new THREE.BufferAttribute(spawnPosData, 4).setUsage(
    THREE.DynamicDrawUsage
  );
  const spawnVelDataAttr = new THREE.BufferAttribute(spawnVelData, 4).setUsage(
    THREE.DynamicDrawUsage
  );
  spawnGeometry.setAttribute('position', spawnPosAttr);
  spawnGeometry.setAttribute('aPosData', spawnPosDataAttr);
  spawnGeometry.setAttribute('aVelData', spawnVelDataAttr);
  spawnGeometry.setDrawRange(0, 0);

  const spawnPosMat = new THREE.ShaderMaterial({
    vertexShader: spawnVert,
    fragmentShader: spawnFrag,
    depthTest: false,
    depthWrite: false,
  });
  const spawnVelMat = new THREE.ShaderMaterial({
    vertexShader: spawnVert,
    fragmentShader: spawnFrag,
    defines: { INJECT_VELOCITY: '' },
    depthTest: false,
    depthWrite: false,
  });

  const spawnPoints = new THREE.Points(spawnGeometry, spawnPosMat);
  spawnPoints.frustumCulled = false;
  const spawnScene = new THREE.Scene();
  spawnScene.add(spawnPoints);
  const spawnCamera = new THREE.Camera(); // identity: attributes are already NDC

  const engine = {
    mesh,
    smokeMesh,
    materials,
    uniforms,
    gpu,
    posVar,
    velVar,
    capacity: CAPACITY,
    activeCapacity: CAPACITY,
    head: 0,
    accum: 0,
    spawnedLastFrame: 0,
    available: initError === null,
    style: 'neon',
    _prevValid: false,
  };

  // The compute pass always covers the full texture — its cost is fixed — but
  // the draw and the spawn ring both honour maxParticles, so the slider means
  // the same thing in both engines instead of silently doing nothing here.
  function setActiveCapacity(n) {
    const next = Math.max(256, Math.min(CAPACITY, Math.floor(n)));
    if (next === engine.activeCapacity) return;
    engine.activeCapacity = next;
    geometry.instanceCount = next;
    engine.head = 0;
  }
  setActiveCapacity(params.maxParticles);

  engine.setStyle = function setStyle(style) {
    engine.style = style;
    const smoke = style === 'smoke';
    mesh.material = smoke ? materials.ember : materials.streak;
    smokeMesh.visible = smoke && engine.enabled;
    uniforms.uSmokeRatio.value = smoke ? params.smokeRatio : 0;
  };

  // Re-seed both ping-pong targets of both variables from the all-dead initial
  // textures. This is the same call GPUComputationRenderer.init() uses to seed
  // them, not a poke at internals.
  engine.clear = function clear() {
    if (!engine.available) return;
    gpu.renderTexture(pos0, posVar.renderTargets[0]);
    gpu.renderTexture(pos0, posVar.renderTargets[1]);
    gpu.renderTexture(vel0, velVar.renderTargets[0]);
    gpu.renderTexture(vel0, velVar.renderTargets[1]);
    engine.head = 0;
    engine.accum = 0;
    engine.spawnedLastFrame = 0;
    engine._prevValid = false;
  };

  engine.setEnabled = function setEnabled(on) {
    engine.enabled = on;
    mesh.visible = on;
    smokeMesh.visible = on && engine.style === 'smoke';
  };
  engine.enabled = false;

  function injectSpawns(count) {
    spawnGeometry.setDrawRange(0, count);
    spawnPosAttr.addUpdateRange(0, count * 3);
    spawnPosDataAttr.addUpdateRange(0, count * 4);
    spawnVelDataAttr.addUpdateRange(0, count * 4);
    spawnPosAttr.needsUpdate = true;
    spawnPosDataAttr.needsUpdate = true;
    spawnVelDataAttr.needsUpdate = true;

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    // Never clear: the injection writes a handful of texels into a target that
    // already holds the whole simulation.
    renderer.autoClear = false;

    spawnPoints.material = spawnPosMat;
    renderer.setRenderTarget(gpu.getCurrentRenderTarget(posVar));
    renderer.render(spawnScene, spawnCamera);

    spawnPoints.material = spawnVelMat;
    renderer.setRenderTarget(gpu.getCurrentRenderTarget(velVar));
    renderer.render(spawnScene, spawnCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  engine.update = function update(simDt, simTime, runner, trail) {
    if (!engine.enabled || !engine.available) return;

    uniforms.uPosTex.value = gpu.getCurrentRenderTarget(posVar).texture;
    uniforms.uVelTex.value = gpu.getCurrentRenderTarget(velVar).texture;

    // Skipping compute() leaves the ping-pong index untouched, so the current
    // targets stay bit-identical: timeScale=0 is a true freeze here too.
    if (simDt <= 0) {
      engine.spawnedLastFrame = 0;
      _prev.copy(runner.position);
      engine._prevValid = true;
      return;
    }
    if (!engine._prevValid) {
      _prev.copy(runner.position);
      engine._prevValid = true;
    }

    // --- forces ---
    const vu = velVar.material.uniforms;
    vu.uDt.value = simDt;
    vu.uTime.value = simTime;
    vu.uDrag.value = params.drag;
    vu.uRise.value = params.riseBias;
    vu.uVortex.value = params.vortex;
    vu.uTurbulence.value = params.turbulence;
    vu.uRunnerPos.value.set(runner.position.x, runner.position.y + 1.0, runner.position.z);
    // Regather ramps in as the runner slows: stop, and the light comes home.
    vu.uRegather.value = params.regather * Math.max(0, 1 - runner.speed / 3.5);

    // Downsample the trail centreline into the uniform array the vortex reads.
    const samples = trail.samples;
    let count = 0;
    if (samples.length > 1) {
      count = Math.min(TRAIL_MAX, samples.length);
      const stride = (samples.length - 1) / Math.max(1, count - 1);
      for (let i = 0; i < count; i++) {
        const s = samples[Math.round(i * stride)];
        trailPts[i].set(s.x, s.y, s.z);
      }
    }
    vu.uTrailCount.value = count;
    posVar.material.uniforms.uDt.value = simDt;

    gpu.compute();

    // --- spawn ---
    if (params.maxParticles !== engine.activeCapacity) setActiveCapacity(params.maxParticles);

    const cap = engine.activeCapacity;
    const n = takeSpawnCount(engine, emissionRate(params, runner), simDt, Math.min(MAX_SPAWN, cap));
    if (n > 0) {
      const head = engine.head;
      fillSpawnContext(_ctx, runner, params, _prev);

      for (let k = 0; k < n; k++) {
        const slot = (head + k) % cap;
        const s = computeSpawn(k, n, _ctx);
        const [ndcX, ndcY] = slotToNdc(slot, TEX_W, TEX_H);

        spawnPositions[k * 3] = ndcX;
        spawnPositions[k * 3 + 1] = ndcY;
        spawnPositions[k * 3 + 2] = 0;

        spawnPosData[k * 4] = s.px;
        spawnPosData[k * 4 + 1] = s.py;
        spawnPosData[k * 4 + 2] = s.pz;
        spawnPosData[k * 4 + 3] = s.life; // remaining life counts down from here

        spawnVelData[k * 4] = s.vx;
        spawnVelData[k * 4 + 1] = s.vy;
        spawnVelData[k * 4 + 2] = s.vz;
        spawnVelData[k * 4 + 3] = s.life; // initial lifetime, for the age fade

        seeds[slot] = s.seed;
      }

      seedAttr.needsUpdate = true;
      injectSpawns(n);
      engine.head = (head + n) % cap;
    }
    engine.spawnedLastFrame = n;

    // Injection wrote into the current targets, so re-point the render uniforms
    // at them after compute() flipped the ping-pong.
    uniforms.uPosTex.value = gpu.getCurrentRenderTarget(posVar).texture;
    uniforms.uVelTex.value = gpu.getCurrentRenderTarget(velVar).texture;

    _prev.copy(runner.position);
  };

  engine.applyParams = () => {
    const u = uniforms;
    u.uWidth.value = params.streakWidth;
    u.uLength.value = params.streakLength;
    u.uStretch.value = params.streakStretch;
    u.uGrow.value = params.smokeGrow;
    u.uIntensity.value = params.streakIntensity;
    u.uSmokeOpacity.value = params.smokeOpacity;
    u.uColorA.value.set(params.colorA);
    u.uColorB.value.set(params.colorB);
    u.uColorC.value.set(params.colorC);
    u.uSmokeColor.value.set(params.smokeColor);
    engine.setStyle(params.style);
    engine.setEnabled(params.engine === 'gpgpu');
  };

  return engine;
}

export { TEX_W, TEX_H, MAX_SPAWN };
