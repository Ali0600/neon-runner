import * as THREE from 'three';
import dissolveVert from './shaders/dissolve.vert.glsl?raw';
import dissolveFrag from './shaders/dissolve.frag.glsl?raw';

const WALK_SPEED = 4.5;
const SPRINT_SPEED = 17.0;
const ACCEL = 9.0; // response rate toward target velocity
const BOUND = 180; // keep the runner inside the ground plane
const STRIDE = 1.35; // world units per half stride

// Scratch — the animate loop must not allocate.
const _target = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

function limb(material, radius, length) {
  // Geometry is shifted so the capsule hangs from the origin, letting the
  // parent Object3D act as a joint pivot.
  const geo = new THREE.CapsuleGeometry(radius, length, 4, 10);
  geo.translate(0, -(length / 2 + radius), 0);
  return new THREE.Mesh(geo, material);
}

export function createRunner(params) {
  const group = new THREE.Group();

  const material = new THREE.ShaderMaterial({
    vertexShader: dissolveVert,
    fragmentShader: dissolveFrag,
    uniforms: {
      uDissolve: { value: 0 },
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uColorA: { value: new THREE.Color(params.colorA) },
      uColorB: { value: new THREE.Color(params.colorB) },
    },
    transparent: true,
  });

  // --- figure ---------------------------------------------------------------
  const body = new THREE.Group(); // carries lean and vertical bob
  group.add(body);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.46, 4, 12), material);
  torso.position.y = 1.15;
  body.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 12), material);
  head.position.y = 1.62;
  body.add(head);

  function makeArm(side) {
    const shoulder = new THREE.Object3D();
    shoulder.position.set(side * 0.22, 1.42, 0);
    const upper = limb(material, 0.068, 0.24);
    shoulder.add(upper);
    const elbow = new THREE.Object3D();
    elbow.position.y = -0.376;
    const lower = limb(material, 0.058, 0.22);
    elbow.add(lower);
    shoulder.add(elbow);
    body.add(shoulder);
    return { shoulder, elbow };
  }

  function makeLeg(side) {
    const hip = new THREE.Object3D();
    hip.position.set(side * 0.11, 0.92, 0);
    const upper = limb(material, 0.085, 0.3);
    hip.add(upper);
    const knee = new THREE.Object3D();
    knee.position.y = -0.47;
    const lower = limb(material, 0.07, 0.3);
    knee.add(lower);
    hip.add(knee);
    body.add(hip);
    return { hip, knee };
  }

  const armL = makeArm(-1);
  const armR = makeArm(1);
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // --- ground glow ----------------------------------------------------------
  // A plain CircleGeometry reads as a hard disc, so the falloff is in a shader.
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 48),
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(params.colorB) },
        uOpacity: { value: 0.14 },
      },
      vertexShader: `
        varying vec2 vP;
        void main() {
          vP = position.xy / 2.4;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vP;
        void main() {
          float d = length(vP);
          float a = pow(max(0.0, 1.0 - d), 2.6) * uOpacity;
          if (a < 0.002) discard;
          gl_FragColor = vec4(uColor * (0.4 + (1.0 - d) * 0.8), a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.02;
  group.add(halo);

  // Joints whose world positions particles spawn from, so the light comes off
  // the hands and feet rather than out of an abstract box around the runner.
  const emitters = [armL.elbow, armR.elbow, legL.knee, legR.knee, torso, head];

  const runner = {
    group,
    material,
    halo,
    position: group.position,
    velocity: new THREE.Vector3(),
    speed: 0,
    dissolve: 0,
    yaw: 0,
    phase: 0,
    autopilotT: 0,
    emitPoints: emitters.map(() => new THREE.Vector3()),
  };

  // Everything here advances on the SIM clock, never real time. Position alone
  // freezing at timeScale 0 is not a pause: the autopilot target, the velocity
  // easing and the dissolve ramp would keep drifting and the frame would still
  // change. Only the camera rig stays on real time, so a frozen scene can be
  // orbited and inspected.
  runner.update = function update(simDt, simTime, input, cameraYaw) {
    let mx = input.moveVec.x;
    let my = input.moveVec.y;
    const sprint = input.sprint || params.forceSprint;

    if (params.autopilot) {
      // Lissajous figure-8 — deterministic motion for headless screenshots.
      runner.autopilotT += simDt;
      const t = runner.autopilotT * 0.45;
      _target.set(Math.sin(t) * 34, 0, Math.sin(t * 2) * 20);
      _fwd.copy(_target).sub(group.position);
      _fwd.y = 0;
      const d = _fwd.length();
      if (d > 0.001) _fwd.divideScalar(d);
      mx = 0;
      my = 0;
      _target.copy(_fwd);
    } else {
      // Camera-relative movement: forward is where the camera looks.
      _fwd.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      _right.set(-_fwd.z, 0, _fwd.x);
      _target.set(0, 0, 0).addScaledVector(_fwd, my).addScaledVector(_right, mx);
      if (_target.lengthSq() > 0.0001) _target.normalize();
    }

    _target.multiplyScalar(sprint ? SPRINT_SPEED : WALK_SPEED);

    // Framerate-independent exponential approach to the target velocity.
    runner.velocity.lerp(_target, 1 - Math.exp(-ACCEL * simDt));
    if (runner.velocity.lengthSq() < 1e-4) runner.velocity.set(0, 0, 0);

    group.position.addScaledVector(runner.velocity, simDt);
    group.position.x = THREE.MathUtils.clamp(group.position.x, -BOUND, BOUND);
    group.position.z = THREE.MathUtils.clamp(group.position.z, -BOUND, BOUND);
    group.position.y = 0;

    runner.speed = runner.velocity.length();

    if (runner.speed > 0.2) {
      const wanted = Math.atan2(runner.velocity.x, runner.velocity.z);
      // Shortest-arc yaw: a naive lerp spins the long way round through +-PI.
      let delta = wanted - runner.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      runner.yaw += delta * (1 - Math.exp(-10 * simDt));
      group.rotation.y = runner.yaw;
    }

    // Dissolve tracks how far into the sprint band we are, eased over ~0.35s.
    const wantDissolve = THREE.MathUtils.clamp(
      (runner.speed - WALK_SPEED * 1.05) / (SPRINT_SPEED - WALK_SPEED * 1.05),
      0,
      1
    );
    runner.dissolve += (wantDissolve - runner.dissolve) * (1 - Math.exp(-6 * simDt));

    // --- run cycle ---
    // Phase advances with DISTANCE, not time, so the stride always matches the
    // ground speed instead of sliding at one speed and mincing at another.
    runner.phase += (runner.speed * simDt * Math.PI) / STRIDE;
    const p = runner.phase;
    const gait = Math.min(1, runner.speed / WALK_SPEED); // no flailing at a standstill
    const amp = (0.55 + runner.dissolve * 0.5) * gait;

    legL.hip.rotation.x = Math.sin(p) * amp;
    legR.hip.rotation.x = Math.sin(p + Math.PI) * amp;
    // Knees only bend one way; the negative half of the sine is clamped off.
    legL.knee.rotation.x = Math.max(0, -Math.sin(p - 0.6)) * amp * 1.5;
    legR.knee.rotation.x = Math.max(0, -Math.sin(p + Math.PI - 0.6)) * amp * 1.5;

    armL.shoulder.rotation.x = Math.sin(p + Math.PI) * amp * 0.8;
    armR.shoulder.rotation.x = Math.sin(p) * amp * 0.8;
    armL.elbow.rotation.x = -(0.5 + Math.sin(p) * 0.35) * gait;
    armR.elbow.rotation.x = -(0.5 + Math.sin(p + Math.PI) * 0.35) * gait;

    body.position.y = Math.abs(Math.sin(p)) * 0.06 * gait;
    body.rotation.x = -runner.dissolve * 0.42 * gait; // lean into the sprint

    // World-space emitter points, read by the particle system this same frame.
    group.updateWorldMatrix(true, true);
    for (let i = 0; i < emitters.length; i++) {
      runner.emitPoints[i].setFromMatrixPosition(emitters[i].matrixWorld);
    }

    material.uniforms.uDissolve.value = runner.dissolve;
    material.uniforms.uTime.value = simTime;
    material.uniforms.uOrigin.value.copy(group.position);
    halo.material.uniforms.uOpacity.value = 0.07 + runner.dissolve * 0.16;
    halo.scale.setScalar(0.7 + runner.dissolve * 0.45);
  };

  runner.applyParams = () => {
    material.uniforms.uColorA.value.set(params.colorA);
    material.uniforms.uColorB.value.set(params.colorB);
    halo.material.uniforms.uColor.value.set(params.colorB);
  };

  return runner;
}

export { WALK_SPEED, SPRINT_SPEED };
