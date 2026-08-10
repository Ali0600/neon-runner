import * as THREE from 'three';
import dissolveVert from './shaders/dissolve.vert.glsl?raw';
import dissolveFrag from './shaders/dissolve.frag.glsl?raw';
import dissolveNoise from './shaders/chunks/dissolveNoise.glsl?raw';
import { wrapLane, resolvePathMode } from './scope/lane.js';
import { buildSchedule, sampleSchedule, driveCommand } from './scope/schedule.js';
import {
  WALK_SPEED,
  SPRINT_SPEED,
  WALL_REACH,
  CREST_INSET,
  SCOPE_WALL_TOP,
} from './constants.js';
import { resolveTargetSpeed } from './speed.js';
import { slideXZ, nearestFace, groundHeightAt } from './city.js';
import { stepVertical, initialVertical } from './vertical.js';

const ACCEL = 9.0; // response rate toward target velocity
const BOUND = 180; // keep the runner inside the ground plane
const STRIDE = 1.35; // world units per half stride
const BODY_RADIUS = 0.45; // collision footprint, a little wider than the torso

// Cache key for the scope schedule. Derived from every flag buildSchedule reads,
// in one place: a key that misses a flag leaves the old schedule in place, so
// the new checkbox silently does nothing.
const scheduleKey = (p) =>
  [p.scopeInterval, p.scopeTurn, p.scopeSprint, p.scopeStop, p.scopeJump, p.scopeWallrun].join('|');

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

export function createRunner(params, city = []) {
  const group = new THREE.Group();

  const material = new THREE.ShaderMaterial({
    vertexShader: dissolveVert,
    // Shared with the afterimages, which must erode with an identical grain.
    fragmentShader: dissolveNoise + dissolveFrag,
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
    return { shoulder, elbow, upper, lower };
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
    return { hip, knee, upper, lower };
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

  // Every mesh the figure is drawn from, in a fixed order. Afterimages merge
  // these ten geometries into one buffer and index them by that order, so the
  // list IS the aJoint contract — reordering it silently re-attaches every
  // ghost's limbs to the wrong matrices.
  const bodyMeshes = [
    torso,
    head,
    armL.upper,
    armL.lower,
    armR.upper,
    armR.lower,
    legL.upper,
    legL.lower,
    legR.upper,
    legR.lower,
  ];

  const runner = {
    group,
    material,
    halo,
    position: group.position,
    velocity: new THREE.Vector3(),
    speed: 0,
    // Horizontal speed, kept separate because `speed` is 3D. Steering, the
    // wall-mount gate and the gait all mean the horizontal one; reading the 3D
    // magnitude for those makes a vertical climb look like fast lateral motion.
    groundSpeed: 0,
    vertical: initialVertical(),
    verticalEvent: null,
    wallNormal: null,
    dissolve: 0,
    yaw: 0,
    phase: 0,
    autopilotT: 0,
    emitPoints: emitters.map(() => new THREE.Vector3()),
    bodyMeshes,
    laneWrapped: false,
    scopeOverride: null,
    scopeSample: null,
  };

  /**
   * Fire one scripted event immediately, independent of the schedule, so a
   * single transient can be watched in isolation.
   */
  runner.triggerScopeEvent = (kind, simTime, duration) => {
    const start = simTime;
    runner.scopeOverride = {
      endsAt: simTime + duration,
      sample: (t) => {
        const tIn = t - start;
        return { kind, index: -1, tIn, tNorm: tIn / duration, cycle: 0, u: tIn };
      },
    };
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
    const mode = resolvePathMode(params);
    // Speed requested by the active path driver, if it has an opinion. Resolved
    // against the hold and the sprint flag once, after the branches below.
    let commandSpeed;
    // Scripted stand-ins for the jump key and for a wall being in reach. Both
    // stay false outside scope, where the real input and the real city answer.
    let scopeJumpHeld = false;
    let scopeClimb = false;

    if (mode === 'scope') {
      // Straight lane with scripted transients. The schedule is a pure function
      // of sim time, so it freezes with everything else at timeScale 0.
      if (
        !runner._schedule ||
        runner._scheduleKey !== scheduleKey(params)
      ) {
        runner._schedule = buildSchedule({
          interval: params.scopeInterval,
          turn: params.scopeTurn,
          sprint: params.scopeSprint,
          stop: params.scopeStop,
          jump: params.scopeJump,
          wallrun: params.scopeWallrun,
        });
        runner._scheduleKey = scheduleKey(params);
      }

      // A manual trigger overrides the schedule for one event's duration.
      let sample;
      if (runner.scopeOverride && simTime < runner.scopeOverride.endsAt) {
        sample = runner.scopeOverride.sample(simTime);
      } else {
        runner.scopeOverride = null;
        sample = sampleSchedule(runner._schedule, simTime);
      }
      runner.scopeSample = sample;

      const cmd = driveCommand(sample, { turnAmplitude: params.scopeTurnAmplitude }, group.position.z);
      _target.set(cmd.dirX, 0, cmd.dirZ);
      commandSpeed = cmd.speed;
      scopeClimb = !!cmd.climb;
      scopeJumpHeld = !!cmd.jump || scopeClimb;
      mx = 0;
      my = 0;
    } else if (params.autopilot) {
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

    // Direction comes from whichever driver is active; only the MAGNITUDE is
    // resolved here, so a speed lock still lets scope turns steer.
    _target.multiplyScalar(
      resolveTargetSpeed({
        hold: params.holdSpeed,
        holdValue: params.holdSpeedValue,
        sprint,
        commandSpeed,
      })
    );

    // Framerate-independent exponential approach to the target velocity. The
    // y component is overwritten below from the vertical state machine: a jump
    // is an impulse, and running it through an ACCEL = 9 ease would damp it
    // away over its own airtime.
    runner.velocity.lerp(_target, 1 - Math.exp(-ACCEL * simDt));

    // Snap the HORIZONTAL components only. Exponential easing never arrives, so
    // without a snap the runner creeps forever and a paused frame never
    // settles — but testing the 3D magnitude would read a fall as motion and
    // never snap at all while airborne.
    if (runner.velocity.x ** 2 + runner.velocity.z ** 2 < 1e-4) {
      runner.velocity.x = 0;
      runner.velocity.z = 0;
    }

    group.position.x += runner.velocity.x * simDt;
    group.position.z += runner.velocity.z * simDt;
    if (mode === 'scope') {
      // The lane is long enough that hitting its end is rare, but it must wrap
      // rather than clamp — a clamped runner would sit still while the emitter
      // kept firing into one spot.
      const w = wrapLane(group.position.x, params.scopeLaneHalf);
      group.position.x = w.x;
      if (w.wrapped) runner.laneWrapped = true;
    } else {
      group.position.x = THREE.MathUtils.clamp(group.position.x, -BOUND, BOUND);
    }
    group.position.z = THREE.MathUtils.clamp(group.position.z, -BOUND, BOUND);

    // --- vertical -------------------------------------------------------
    // The scope lane runs out to x = +-2000 over ground the city does not
    // cover, so there is nothing to stand on or climb there; a manual jump
    // still works, against the ground plane.
    const inScope = mode === 'scope';
    const groundSpeed = Math.hypot(runner.velocity.x, runner.velocity.z);

    // While climbing, probe just below the roofline the mount recorded. Above
    // a building's own height its faces stop being climbable, so probing at the
    // live y would report "no wall" one frame before the summit.
    const probeY =
      runner.vertical.mode === 'wall'
        ? Math.min(group.position.y, runner.vertical.wallTop - 0.05)
        : group.position.y;

    const face = inScope
      ? null
      : nearestFace(city, group.position.x, group.position.z, probeY, WALL_REACH);
    const supportY = inScope ? 0 : groundHeightAt(city, group.position.x, group.position.z);
    if (face) runner.wallNormal = face;

    // In scope the lane wall is scripted rather than found: it exists exactly
    // while the schedule says so, and stops existing above its roofline — the
    // same rule nearestFace applies to a real building, so the crest fires
    // identically in both.
    let wallTop;
    if (inScope) {
      wallTop = scopeClimb && group.position.y < SCOPE_WALL_TOP ? SCOPE_WALL_TOP : null;
      // The lane runs toward +x, so the wall faces back down it.
      if (wallTop !== null) runner.wallNormal = { nx: -1, nz: 0, top: SCOPE_WALL_TOP, dist: 0 };
    } else {
      wallTop = face ? face.top : null;
    }

    // The schedule publishes a HELD signal, so the press edge is derived here —
    // exactly as input.js derives one from a keydown. Without an edge the ground
    // branch never jumps, since a held key alone deliberately does not bounce.
    const jumpHeld = inScope ? scopeJumpHeld : !!input.jump;
    const jumpPressed = inScope ? scopeJumpHeld && !runner._scopeJumpPrev : !!input.jumpPressed;
    runner._scopeJumpPrev = scopeJumpHeld;

    const v = stepVertical(runner.vertical, {
      simDt,
      jumpHeld,
      jumpPressed,
      supportY,
      wallTop,
      groundSpeed,
    });
    runner.vertical = v;
    runner.verticalEvent = v.event;
    group.position.y = v.y;
    runner.velocity.y = v.vy;

    if (v.mode === 'wall') {
      // Pin to the face. Steering while attached slides the runner along the
      // wall and off its edge partway up, which reads as the climb failing.
      runner.velocity.x = 0;
      runner.velocity.z = 0;
    }

    // Skipped in scope: there is no roof to land on there, and nudging the
    // runner sideways would shift it off the lane centreline the turns steer to.
    if (v.event === 'crest' && runner.wallNormal && !inScope) {
      // Step over the lip. The climb runs at BODY_RADIUS OUTSIDE the face, so
      // without this the runner tops out still beyond the footprint, finds no
      // roof beneath it, and drops straight back down the building it climbed.
      group.position.x -= runner.wallNormal.nx * (BODY_RADIUS + CREST_INSET);
      group.position.z -= runner.wallNormal.nz * (BODY_RADIUS + CREST_INSET);
    }

    // Buildings are solid — but only below their roofline, which is what lets
    // the runner stand on one rather than being ejected off it.
    if (!inScope) {
      const hit = slideXZ(city, group.position.x, group.position.z, group.position.y, BODY_RADIUS);
      group.position.x = hit.x;
      group.position.z = hit.z;
    }

    runner.speed = runner.velocity.length();
    runner.groundSpeed = Math.hypot(runner.velocity.x, runner.velocity.z);

    if (v.mode === 'wall' && runner.wallNormal) {
      // Face the wall. Deriving heading from velocity here would run
      // atan2(x, z) on two components that are both zero during a vertical
      // climb, and the figure would spin on the spot.
      const wanted = Math.atan2(-runner.wallNormal.nx, -runner.wallNormal.nz);
      let delta = wanted - runner.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      if (Math.abs(delta) < 1e-5) runner.yaw = wanted;
      else runner.yaw += delta * (1 - Math.exp(-10 * simDt));
      group.rotation.y = runner.yaw;
    } else if (runner.groundSpeed > 0.2) {
      // Gated on HORIZONTAL speed: `runner.speed` is 3D, so a near-vertical
      // climb or a fast fall passes the old gate while carrying no heading.
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
    // Legs keep cycling on a wall — the figure IS running, just vertically. In
    // free air they tuck: a full sprint cycle mid-arc reads as running on
    // nothing, which is the one place the distance-driven gait has no ground to
    // match.
    const gait =
      Math.min(1, runner.speed / WALK_SPEED) * (runner.vertical.mode === 'air' ? 0.3 : 1);
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
    // The ground glow belongs to the SURFACE, not to the figure. As a child of
    // the group it would otherwise ride up the wall with the runner, a bright
    // disc hanging in mid-air twenty units off the ground.
    const aboveSurface = v.y - supportY;
    halo.position.y = 0.02 - aboveSurface;
    halo.material.uniforms.uOpacity.value =
      (0.07 + runner.dissolve * 0.16) * Math.max(0, 1 - aboveSurface / 6);
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
