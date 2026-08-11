import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import ghostVert from '../shaders/ghost.vert.glsl?raw';
import ghostFrag from '../shaders/ghost.frag.glsl?raw';
import sparkVert from '../shaders/ghostSparks.vert.glsl?raw';
import sparkFrag from '../shaders/ghostSparks.frag.glsl?raw';
import dissolveNoise from '../shaders/chunks/dissolveNoise.glsl?raw';
import {
  MAX_GHOSTS,
  ghostsEmitNow,
  shouldSnapshot,
  ghostStrength,
  ghostErosion,
  pushSnapshot,
  trimTo,
  countAlive,
} from './logic.js';

// Afterimages: the runner's pose, left behind and dissolving.
//
// A snapshot is ten world matrices copied off the live body, not a re-derived
// gait. The pose is therefore exactly the figure that stood there — including
// the lean, the bob and the air tuck — and there is no second copy of the gait
// maths to drift away from the first. logic.js owns every rule about when to
// take one and how it fades; this file owns the meshes.

const JOINT_COUNT = 10;

export function createAfterimages(params, runner) {
  const group = new THREE.Group();
  group.name = 'afterimages';

  // --- geometry -------------------------------------------------------------
  // The ten body parts merged into one buffer, each vertex tagged with the part
  // it came from. One draw call per ghost instead of ten.
  const parts = runner.bodyMeshes.map((mesh, i) => {
    const geo = mesh.geometry.clone();
    const n = geo.getAttribute('position').count;
    const joint = new Float32Array(n).fill(i);
    // Tagged before the merge: mergeGeometries drops any attribute that is not
    // present on every input.
    geo.setAttribute('aJoint', new THREE.BufferAttribute(joint, 1));
    // The parts carry differing attribute sets otherwise (uv on some, not
    // others); keep only what the ghost shader reads.
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'aJoint') {
        geo.deleteAttribute(name);
      }
    }
    return geo;
  });

  const geometry = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!geometry) throw new Error('afterimages: body geometries failed to merge');

  // --- slots ----------------------------------------------------------------
  const slots = [];
  for (let i = 0; i < MAX_GHOSTS; i++) {
    const uniforms = {
      uJoints: { value: Array.from({ length: JOINT_COUNT }, () => new THREE.Matrix4()) },
      uOrigin: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uErosion: { value: 0 },
      uStrength: { value: 0 },
      uGain: { value: 1 },
      uColorA: { value: new THREE.Color(params.colorA) },
      uColorB: { value: new THREE.Color(params.colorB) },
      uColorC: { value: new THREE.Color(params.colorC) },
      // Spark-only. They live in the same object so one write drives both
      // materials; the mesh program simply never looks them up.
      uSparkReach: { value: params.ghostSparkReach ?? 1.1 },
      uSparkSize: { value: params.ghostSparkSize ?? 0.045 },
      uViewportH: { value: 1080 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: ghostVert,
      fragmentShader: dissolveNoise + ghostFrag,
      uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      // Additive shells: writing depth would make them occlude each other and
      // the plume. depthTest stays on so buildings still hide them.
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    // The vertices are posed in the shader, so the geometry's own bounds
    // describe a figure standing at the origin and would cull ghosts that are
    // plainly on screen.
    mesh.frustumCulled = false;
    mesh.renderOrder = 1; // with the trail and the streaks, over the smoke layer
    mesh.visible = false;
    group.add(mesh);

    // The debris: the same geometry and the same uniforms, drawn as points.
    // ShaderMaterial keeps the uniforms object by reference, so the mesh and its
    // sparks cannot drift out of step — there is one erosion value, not two.
    const sparkMaterial = new THREE.ShaderMaterial({
      vertexShader: dissolveNoise + sparkVert,
      fragmentShader: sparkFrag,
      uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sparks = new THREE.Points(geometry, sparkMaterial);
    sparks.frustumCulled = false;
    sparks.renderOrder = 1;
    sparks.visible = false;
    group.add(sparks);

    slots.push({ mesh, sparks, uniforms, rec: null });
  }

  // One owner for a slot's visibility: the mesh and its sparks are one object as
  // far as the rest of the system is concerned, and a second writer that set only
  // one of them would leave debris hanging with no body or vice versa.
  function setSlotVisible(slot, v) {
    slot.mesh.visible = v;
    slot.sparks.visible = v;
  }

  // Oldest-first, like the trail's samples. Each record holds the slot it owns.
  const live = [];
  let lastSnap = null; // position of the most recent capture, or null

  const afterimages = { group, geometry, slots, live, alive: 0 };

  function freeSlot() {
    for (const s of slots) if (!s.rec) return s;
    return null;
  }

  function release(rec) {
    if (!rec) return;
    setSlotVisible(rec.slot, false);
    rec.slot.rec = null;
  }

  function capture(simTime) {
    const slot = freeSlot();
    if (!slot) return; // ring is at cap; the next push frees one first

    const u = slot.uniforms;
    for (let i = 0; i < JOINT_COUNT; i++) {
      // runner.update has already called updateWorldMatrix on the group, so
      // these are this frame's exact matrices.
      u.uJoints.value[i].copy(runner.bodyMeshes[i].matrixWorld);
    }
    u.uOrigin.value.copy(runner.position);
    u.uTime.value = simTime;

    // Only the stamp and the slot: how eroded a ghost is depends on its age
    // alone, not on the speed it was captured at.
    const rec = { t: simTime, slot };
    slot.rec = rec;
    setSlotVisible(slot, true);
    release(pushSnapshot(live, rec, params.ghostCount));

    if (!lastSnap) lastSnap = new THREE.Vector3();
    lastSnap.copy(runner.position);
  }

  /**
   * No simDt parameter, deliberately — the same shape as the trail. Snapshots
   * are gated on distance travelled and strength is a pure function of simTime,
   * so a frozen scene produces an identical frame without any epsilon tuning.
   */
  afterimages.update = function update(simTime, r) {
    // Not emitsGhosts: a hand-jet glide pauses new captures, and the pause
    // lives in logic.js beside the mode gates rather than as a second
    // condition here that the limb ribbons would have to duplicate.
    if (ghostsEmitNow(params.sprintFx, params.glideFx, r.vertical?.mode)) {
      if (
        shouldSnapshot(
          lastSnap,
          r.position,
          r.dissolve,
          params.ghostSpacing,
          params.ghostMinDissolve
        )
      ) {
        capture(simTime);
      }
    }

    const fade = params.ghostFade;
    for (let i = 0; i < live.length; i++) {
      const rec = live[i];
      const strength = ghostStrength(rec.t, simTime, fade);
      rec.slot.uniforms.uStrength.value = strength;
      rec.slot.uniforms.uErosion.value = ghostErosion(strength);
      setSlotVisible(rec.slot, strength > 0);
    }
    afterimages.alive = countAlive(live, simTime, fade);
  };

  afterimages.clear = function clear() {
    for (const rec of live) release(rec);
    live.length = 0;
    lastSnap = null;
    afterimages.alive = 0;
  };

  afterimages.applyParams = function applyParams() {
    // A lowered count has to give its slots back, or they stay lit forever.
    for (const rec of trimTo(live, params.ghostCount)) release(rec);

    // Normalized against the CONFIGURED count, not the live one: dividing by
    // how many happen to be alive would brighten the survivors as the tail
    // expires, which both looks wrong and moves a frozen frame.
    const gain =
      (params.ghostIntensity ?? 0.7) * Math.sqrt(6 / Math.max(6, params.ghostCount || 1));

    for (const slot of slots) {
      slot.uniforms.uGain.value = gain;
      slot.uniforms.uSparkReach.value = params.ghostSparkReach ?? 1.1;
      slot.uniforms.uSparkSize.value = params.ghostSparkSize ?? 0.045;
      slot.uniforms.uColorA.value.set(params.colorA);
      slot.uniforms.uColorB.value.set(params.colorB);
      slot.uniforms.uColorC.value.set(params.colorC);
    }
  };

  /**
   * Drawing-buffer height, so a spark keeps a constant WORLD size instead of a
   * constant pixel size — otherwise the burst changes scale with the window and
   * looks different in each scope projection.
   */
  afterimages.setViewport = function setViewport(pixelHeight) {
    if (!(pixelHeight > 0)) return;
    for (const slot of slots) slot.uniforms.uViewportH.value = pixelHeight;
  };

  afterimages.applyParams();
  return afterimages;
}
