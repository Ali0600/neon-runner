import * as THREE from 'three';
import vertexShader from '../shaders/trail.vert.glsl?raw';
import fragmentShader from '../shaders/trail.frag.glsl?raw';

const MAX_SAMPLES = 240;
const MIN_STEP = 0.09; // world units between samples

const _tangent = new THREE.Vector3();

export function createTrail(params) {
  // Samples are kept oldest-first in a plain array; the geometry is small
  // enough (<= 480 verts) that a full re-upload each frame is cheaper than
  // ring-buffer bookkeeping.
  const samples = []; // { x, y, z, t }

  const positions = new Float32Array(MAX_SAMPLES * 2 * 3);
  const info = new Float32Array(MAX_SAMPLES * 2 * 3); // age01, side, strength
  const tangents = new Float32Array(MAX_SAMPLES * 2 * 3);
  const indices = new Uint16Array((MAX_SAMPLES - 1) * 6);
  for (let i = 0; i < MAX_SAMPLES - 1; i++) {
    const a = i * 2;
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const infoAttr = new THREE.BufferAttribute(info, 3).setUsage(THREE.DynamicDrawUsage);
  const tanAttr = new THREE.BufferAttribute(tangents, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aInfo', infoAttr);
  geometry.setAttribute('aTangent', tanAttr);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uWidth: { value: params.trailWidth },
      uColorA: { value: new THREE.Color(params.colorA) },
      uColorB: { value: new THREE.Color(params.colorB) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const trail = { mesh, material, geometry, samples };

  trail.update = function update(simTime, runner) {
    const maxSamples = Math.max(2, Math.min(MAX_SAMPLES, Math.floor(params.trailSamples)));
    const p = runner.position;

    const last = samples[samples.length - 1];
    const moved =
      !last ||
      (p.x - last.x) ** 2 + (p.z - last.z) ** 2 + (p.y + 1.0 - last.y) ** 2 > MIN_STEP * MIN_STEP;

    // Emit only while the runner is glowing; below that the ribbon just ages out.
    if (moved && runner.dissolve > 0.02) {
      samples.push({ x: p.x, y: p.y + 1.0, z: p.z, t: simTime, s: runner.dissolve });
    }

    // Drop samples that have aged past the fade window, then enforce the cap.
    const cutoff = simTime - params.trailFade;
    while (samples.length && samples[0].t < cutoff) samples.shift();
    while (samples.length > maxSamples) samples.shift();

    const count = samples.length;
    if (count < 2) {
      geometry.setDrawRange(0, 0);
      return;
    }

    for (let i = 0; i < count; i++) {
      const s = samples[i];
      const prev = samples[Math.max(0, i - 1)];
      const next = samples[Math.min(count - 1, i + 1)];
      _tangent.set(next.x - prev.x, next.y - prev.y, next.z - prev.z);
      if (_tangent.lengthSq() < 1e-8) _tangent.set(0, 0, 1);
      else _tangent.normalize();

      const age = THREE.MathUtils.clamp((simTime - s.t) / params.trailFade, 0, 1);
      const o = i * 6;

      // Both verts of a pair share the centerline position; the shader offsets
      // them along a camera-facing normal built from this tangent.
      for (let side = 0; side < 2; side++) {
        const v = o + side * 3;
        positions[v] = s.x;
        positions[v + 1] = s.y;
        positions[v + 2] = s.z;
        info[v] = age;
        info[v + 1] = side === 0 ? -1 : 1;
        info[v + 2] = s.s;
      }
      // Tangent rides in a second attribute slot via the normal attribute.
      tangents[o] = _tangent.x;
      tangents[o + 1] = _tangent.y;
      tangents[o + 2] = _tangent.z;
      tangents[o + 3] = _tangent.x;
      tangents[o + 4] = _tangent.y;
      tangents[o + 5] = _tangent.z;
    }

    posAttr.addUpdateRange(0, count * 6);
    infoAttr.addUpdateRange(0, count * 6);
    tanAttr.addUpdateRange(0, count * 6);
    posAttr.needsUpdate = true;
    infoAttr.needsUpdate = true;
    tanAttr.needsUpdate = true;

    geometry.setDrawRange(0, (count - 1) * 6);
  };

  trail.clear = () => {
    samples.length = 0;
    geometry.setDrawRange(0, 0);
  };

  trail.applyParams = () => {
    mesh.visible = params.trailEnabled !== false;
    material.uniforms.uWidth.value = params.trailWidth;
    material.uniforms.uColorA.value.set(params.colorA);
    material.uniforms.uColorB.value.set(params.colorB);
  };

  return trail;
}
