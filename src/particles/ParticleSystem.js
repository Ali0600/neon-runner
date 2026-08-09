import * as THREE from 'three';
import { computeUpdateRanges } from './ringRanges.js';
import { takeSpawnCount, emissionRate, computeSpawn } from './spawnComputation.js';
import commonChunk from '../shaders/chunks/particleCommon.glsl?raw';
import vertexBody from '../shaders/particles.vert.glsl?raw';
import fragmentShader from '../shaders/particles.frag.glsl?raw';

// Hard allocation ceiling. params.maxParticles selects how much of it is live;
// the typed arrays are never reallocated after construction.
export const CAPACITY = 65536;

// Uniform and varying declarations plus the billboard helpers live in the
// chunk, which the GPGPU engine composes into its own vertex shader too.
export const vertexShader = `${commonChunk}\n${vertexBody}`;

const _prev = new THREE.Vector3();
const _ctx = {};

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

  // Kill every slot and rewind the ring. Used when the capacity shrinks (live
  // particles outside the new draw range would reappear when it grows again)
  // and on a scope lane rewind.
  system.clear = function clear() {
    for (let i = 0; i < CAPACITY; i++) aSpawn[i * 4 + 3] = -1e6;
    spawnAttr.addUpdateRange(0, CAPACITY * 4);
    spawnAttr.needsUpdate = true;
    system.head = 0;
    system.accum = 0;
    system.spawnedLastFrame = 0;
    // Forces _prev to re-seed from the runner's new position next frame.
    // Without it, one frame's spawns interpolate across the whole lane.
    system._prevValid = false;
  };

  function setActiveCapacity(n) {
    const next = Math.max(256, Math.min(CAPACITY, Math.floor(n)));
    if (next === system.activeCapacity) return;
    system.activeCapacity = next;
    geometry.instanceCount = next;
    system.clear();
  }
  setActiveCapacity(params.maxParticles);

  /**
   * @param {number} simDt  sim-clock delta (already scaled by timeScale)
   * @param {number} simTime sim-clock time; particle ages are measured in it
   */
  system.update = function update(simDt, simTime, runner) {
    // Spawning uses the true sim time; only the RENDER clock is offset, so a
    // scrub never rewrites spawn history — it just displays an earlier moment
    // of the particles currently in the buffer.
    uniforms.uTime.value = simTime + (params.scopeScrub || 0);

    if (params.maxParticles !== system.activeCapacity) {
      setActiveCapacity(params.maxParticles);
    }

    const cap = system.activeCapacity;

    // A paused sim (timeScale 0) must not accumulate spawns.
    if (simDt <= 0) {
      system.spawnedLastFrame = 0;
      _prev.copy(runner.position);
      system._prevValid = true;
      return;
    }

    if (!system._prevValid) {
      _prev.copy(runner.position);
      system._prevValid = true;
    }

    const n = takeSpawnCount(system, emissionRate(params, runner), simDt, cap);
    if (n <= 0) {
      system.spawnedLastFrame = 0;
      _prev.copy(runner.position);
      return;
    }

    const head = system.head;
    const prevTime = simTime - simDt;

    _ctx.emitPoints = runner.emitPoints;
    _ctx.position = runner.position;
    _ctx.prev = _prev;
    _ctx.velocity = runner.velocity;
    _ctx.jitter = 0.1 + runner.dissolve * 0.22;
    _ctx.spread = params.spread;
    _ctx.rise = params.riseBias;
    _ctx.lifetime = params.lifetime;

    for (let k = 0; k < n; k++) {
      const idx = (head + k) % cap;
      const o4 = idx * 4;
      const s = computeSpawn(k, n, _ctx);

      aSpawn[o4] = s.px;
      aSpawn[o4 + 1] = s.py;
      aSpawn[o4 + 2] = s.pz;
      // The analytic engine records WHEN the particle was born and derives its
      // position from that; the GPGPU engine integrates instead, so this is the
      // one field the two do not share.
      aSpawn[o4 + 3] = prevTime + simDt * s.u;

      aVel[o4] = s.vx;
      aVel[o4 + 1] = s.vy;
      aVel[o4 + 2] = s.vz;
      aVel[o4 + 3] = s.life;

      aSeed[idx] = s.seed;
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

  /**
   * Emit a one-off radial burst at a world position — pickups, impacts,
   * anything that is not the runner. Writes into the same ring buffer as the
   * continuous emitter, so a frame can contain both; three accumulates the
   * update ranges from each call and clears them after upload.
   *
   * @param {{x:number,y:number,z:number}} pos
   * @param {number} count
   * @param {{ simTime:number, speed?:number, lifetime?:number, up?:number }} opts
   */
  system.emitBurst = function emitBurst(pos, count, opts) {
    const cap = system.activeCapacity;
    let n = Math.min(Math.floor(count), cap);
    if (n <= 0) return 0;

    const head = system.head;
    const speed = opts.speed ?? 6;
    const life = opts.lifetime ?? params.lifetime;
    const up = opts.up ?? 1.2;
    const simTime = opts.simTime;

    for (let k = 0; k < n; k++) {
      const idx = (head + k) % cap;
      const o4 = idx * 4;

      const th = Math.random() * Math.PI * 2;
      const z = Math.random() * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      // Shell-biased magnitude gives an expanding ring rather than a blob.
      const mag = speed * (0.55 + Math.random() * 0.45);

      aSpawn[o4] = pos.x;
      aSpawn[o4 + 1] = pos.y;
      aSpawn[o4 + 2] = pos.z;
      aSpawn[o4 + 3] = simTime;

      aVel[o4] = Math.cos(th) * r * mag;
      aVel[o4 + 1] = z * mag * 0.7 + up;
      aVel[o4 + 2] = Math.sin(th) * r * mag;
      aVel[o4 + 3] = life * (0.6 + Math.random() * 0.6);

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
    return n;
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
