import * as THREE from 'three';
import { computeUpdateRanges } from './ringRanges.js';
import vertexShader from '../shaders/particles.vert.glsl?raw';
import fragmentShader from '../shaders/particles.frag.glsl?raw';

// Hard allocation ceiling. params.maxParticles selects how much of it is live;
// the typed arrays are never reallocated after construction.
export const CAPACITY = 65536;

const INHERIT = 0.32; // fraction of runner velocity the particle keeps
const _prev = new THREE.Vector3();

export function createParticleSystem(params) {
  const aSpawn = new Float32Array(CAPACITY * 4); // xyz spawn pos, w spawn time
  const aVel = new Float32Array(CAPACITY * 4); // xyz velocity, w lifetime
  const aSeed = new Float32Array(CAPACITY);

  // Far in the past AND zero lifetime: nothing is alive at t=0 under either test.
  for (let i = 0; i < CAPACITY; i++) aSpawn[i * 4 + 3] = -1e6;

  const geometry = new THREE.InstancedBufferGeometry();
  // Base quad, corners at +-0.5, shared by every instance.
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
      3
    )
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  const spawnAttr = new THREE.InstancedBufferAttribute(aSpawn, 4).setUsage(
    THREE.DynamicDrawUsage
  );
  const velAttr = new THREE.InstancedBufferAttribute(aVel, 4).setUsage(THREE.DynamicDrawUsage);
  const seedAttr = new THREE.InstancedBufferAttribute(aSeed, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aSpawn', spawnAttr);
  geometry.setAttribute('aVel', velAttr);
  geometry.setAttribute('aSeed', seedAttr);

  // One uniforms object shared by every material: all three render the same
  // instance buffer with the same motion, so they must never disagree about it.
  const uniforms = {
    uTime: { value: 0 },
    uWidth: { value: params.streakWidth },
    uLength: { value: params.streakLength },
    uStretch: { value: params.streakStretch },
    uWobble: { value: params.wobble },
    uRise: { value: params.riseBias },
    uDrag: { value: params.drag },
    uIntensity: { value: params.streakIntensity },
    uSmokeRatio: { value: 0 },
    uGrow: { value: params.smokeGrow },
    uSmokeOpacity: { value: params.smokeOpacity },
    uColorA: { value: new THREE.Color(params.colorA) },
    uColorB: { value: new THREE.Color(params.colorB) },
    uColorC: { value: new THREE.Color(params.colorC) },
    uSmokeColor: { value: new THREE.Color(params.smokeColor) },
  };

  // Kinds differ in blending, which is a material property — a runtime uniform
  // branch could not express smoke at all. Built once at startup so switching
  // style never stalls on a shader compile.
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

  // Positions are computed in the vertex shader, so CPU-side bounds are
  // meaningless and would cull the whole system.
  const mesh = new THREE.Mesh(geometry, materials.streak);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  // Second mesh over the SAME geometry: smoke needs its own draw call for the
  // blend mode, not its own particles. renderOrder puts it under every additive
  // system so embers and glow composite on top of the wisps.
  const smokeMesh = new THREE.Mesh(geometry, materials.smoke);
  smokeMesh.frustumCulled = false;
  smokeMesh.renderOrder = 0;
  smokeMesh.visible = false;

  const system = {
    mesh,
    smokeMesh,
    materials,
    material: materials.streak,
    uniforms,
    geometry,
    capacity: CAPACITY,
    head: 0,
    accum: 0,
    activeCapacity: 0,
    spawnedLastFrame: 0,
    style: 'neon',
    _prevValid: false,
  };

  system.setStyle = function setStyle(style) {
    system.style = style;
    const smoke = style === 'smoke';
    mesh.material = smoke ? materials.ember : materials.streak;
    system.material = mesh.material;
    smokeMesh.visible = smoke;
    // Only the smoke style partitions the buffer; in neon every instance is a
    // streak, so the ratio must be zero or the streak mesh would drop instances.
    uniforms.uSmokeRatio.value = smoke ? params.smokeRatio : 0;
  };

  function setActiveCapacity(n) {
    const next = Math.max(256, Math.min(CAPACITY, Math.floor(n)));
    if (next === system.activeCapacity) return;
    system.activeCapacity = next;
    geometry.instanceCount = next;
    system.head = 0;
    // Shrinking leaves live particles outside the new draw range; killing every
    // slot avoids stale ones reappearing when the range grows again.
    for (let i = 0; i < CAPACITY; i++) aSpawn[i * 4 + 3] = -1e6;
    spawnAttr.addUpdateRange(0, CAPACITY * 4);
    spawnAttr.needsUpdate = true;
  }
  setActiveCapacity(params.maxParticles);

  /**
   * @param {number} simDt  sim-clock delta (already scaled by timeScale)
   * @param {number} simTime sim-clock time; particle ages are measured in it
   */
  system.update = function update(simDt, simTime, runner) {
    uniforms.uTime.value = simTime;

    if (params.maxParticles !== system.activeCapacity) {
      setActiveCapacity(params.maxParticles);
    }

    const cap = system.activeCapacity;
    const dissolve = runner.dissolve;
    const moveGate = Math.min(1, runner.speed / 1.6);
    const rate =
      (params.walkRate + (params.sprintRate - params.walkRate) * Math.pow(dissolve, 1.4)) *
      moveGate;

    // A paused sim (timeScale 0) must not accumulate spawns.
    if (simDt <= 0) {
      system.spawnedLastFrame = 0;
      _prev.copy(runner.position);
      system._prevValid = true;
      return;
    }

    system.accum += rate * simDt;
    let n = Math.floor(system.accum);
    system.accum -= n;

    if (!system._prevValid) {
      _prev.copy(runner.position);
      system._prevValid = true;
    }

    if (n <= 0) {
      system.spawnedLastFrame = 0;
      _prev.copy(runner.position);
      return;
    }
    // Writing more than the ring holds would overwrite this frame's own spawns.
    if (n > cap) n = cap;

    const head = system.head;
    const life = params.lifetime;
    const spread = params.spread;
    const rise = params.riseBias;
    const jitter = 0.1 + dissolve * 0.22;
    const vx = runner.velocity.x;
    const vy = runner.velocity.y;
    const vz = runner.velocity.z;
    const prevTime = simTime - simDt;

    const emitPoints = runner.emitPoints;
    const nEmit = emitPoints.length;

    for (let k = 0; k < n; k++) {
      const idx = (head + k) % cap;
      const o4 = idx * 4;
      // Spread spawns along the path walked this frame (and across the frame's
      // time span) so a fast sprint emits a continuous ribbon, not per-frame clumps.
      const u = n === 1 ? 0.5 : k / n;
      // Emitter joints are in world space at the CURRENT frame; rewinding them
      // along the frame's displacement puts each spawn where that joint
      // actually was at its own spawn time.
      const back = 1 - u;
      const ox = (runner.position.x - _prev.x) * back;
      const oy = (runner.position.y - _prev.y) * back;
      const oz = (runner.position.z - _prev.z) * back;

      const e = emitPoints[(Math.random() * nEmit) | 0];
      aSpawn[o4] = e.x - ox + (Math.random() - 0.5) * jitter;
      aSpawn[o4 + 1] = e.y - oy + (Math.random() - 0.5) * jitter;
      aSpawn[o4 + 2] = e.z - oz + (Math.random() - 0.5) * jitter;
      aSpawn[o4 + 3] = prevTime + simDt * u;

      // Random direction on a sphere, magnitude biased toward the surface.
      const th = Math.random() * Math.PI * 2;
      const z = Math.random() * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const mag = spread * (0.35 + Math.random() * 0.65);

      aVel[o4] = vx * INHERIT + Math.cos(th) * r * mag;
      aVel[o4 + 1] = vy * INHERIT + z * mag * 0.6 + rise * 0.35;
      aVel[o4 + 2] = vz * INHERIT + Math.sin(th) * r * mag;
      aVel[o4 + 3] = life * (0.55 + Math.random() * 0.65);

      aSeed[idx] = Math.random();
    }

    for (const range of computeUpdateRanges(head, n, cap, 4)) {
      spawnAttr.addUpdateRange(range.start, range.count);
      velAttr.addUpdateRange(range.start, range.count);
    }
    for (const range of computeUpdateRanges(head, n, cap, 1)) {
      seedAttr.addUpdateRange(range.start, range.count);
    }
    spawnAttr.needsUpdate = true;
    velAttr.needsUpdate = true;
    seedAttr.needsUpdate = true;

    system.head = (head + n) % cap;
    system.spawnedLastFrame = n;
    _prev.copy(runner.position);
  };

  system.applyParams = () => {
    const u = uniforms;
    u.uWidth.value = params.streakWidth;
    u.uLength.value = params.streakLength;
    u.uStretch.value = params.streakStretch;
    u.uWobble.value = params.wobble;
    u.uRise.value = params.riseBias;
    u.uDrag.value = params.drag;
    u.uIntensity.value = params.streakIntensity;
    u.uGrow.value = params.smokeGrow;
    u.uSmokeOpacity.value = params.smokeOpacity;
    u.uColorA.value.set(params.colorA);
    u.uColorB.value.set(params.colorB);
    u.uColorC.value.set(params.colorC);
    u.uSmokeColor.value.set(params.smokeColor);
    system.setStyle(params.style);
  };

  return system;
}
