import * as THREE from 'three';
import { mulberry32, placePickups, sweptCollect, comboStep, scoreFor } from './logic.js';

const SAVE_KEY = 'neon-runner.save.v1';
const SEED = 20260808;
const COUNT = 22;
const FIELD_RADIUS = 95;
const MIN_SEPARATION = 11;
const RESPAWN_DELAY = 6; // sim seconds
const BASE_SCORE = 100;

const COMBO_CFG = { sprintSpeed: 12, growPerSec: 0.45, decayPerSec: 1.6, max: 8 };

// The autopilot flies a Lissajous figure-8; seeding a few pickups onto it means
// the demo collects things without the autopilot ever steering. Steering toward
// mutable game state would make every headless verification depend on game
// tuning, and the autopilot is the verification workhorse.
const AUTOPILOT_TS = [0.6, 1.9, 3.3, 4.7, 6.1, 7.4];
function autopilotPoint(t) {
  return { x: Math.sin(t) * 34, z: Math.sin(t * 2) * 20 };
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _prevPos = new THREE.Vector3();
const _burst = new THREE.Vector3();

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { bestCombo: 1, totalScore: 0 };
    const v = JSON.parse(raw);
    return {
      bestCombo: Number.isFinite(v.bestCombo) ? v.bestCombo : 1,
      totalScore: Number.isFinite(v.totalScore) ? v.totalScore : 0,
    };
  } catch {
    // Corrupt or unavailable storage must never take the app down with it.
    return { bestCombo: 1, totalScore: 0 };
  }
}

export function createGame(params, particles) {
  const rng = mulberry32(SEED);
  const scattered = placePickups(rng, COUNT, FIELD_RADIUS, MIN_SEPARATION);
  const onPath = AUTOPILOT_TS.map(autopilotPoint);
  const pickups = [...onPath, ...scattered].map((p) => ({
    x: p.x,
    z: p.z,
    active: true,
    respawnAt: 0,
    phase: Math.random() * Math.PI * 2,
  }));

  const geometry = new THREE.TorusGeometry(0.85, 0.15, 8, 28);
  const material = new THREE.MeshBasicMaterial({ toneMapped: false });
  const mesh = new THREE.InstancedMesh(geometry, material, pickups.length);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const saved = loadSave();
  const hud = document.getElementById('score');

  const game = {
    mesh,
    pickups,
    score: 0,
    combo: 1,
    bestCombo: saved.bestCombo,
    totalScore: saved.totalScore,
    collected: 0,
    lastBurst: 0,
    _prevValid: false,
  };

  function persist() {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ bestCombo: game.bestCombo, totalScore: game.totalScore })
      );
    } catch {
      // Private-browsing or a full quota: scoring still works this session.
    }
  }

  function updateHud() {
    if (!hud) return;
    hud.textContent = params.game
      ? `SCORE ${game.score}  ·  x${game.combo.toFixed(2)}  ·  BEST x${game.bestCombo.toFixed(2)}  ·  ${game.collected} RINGS`
      : '';
  }

  function writeInstance(i, simTime) {
    const p = pickups[i];
    if (!p.active) {
      // Zero scale rather than a separate visibility list — one instance
      // buffer, no per-frame branching in the draw path.
      _m4.makeScale(0, 0, 0);
    } else {
      const bob = Math.sin(simTime * 1.3 + p.phase) * 0.22;
      _pos.set(p.x, 1.25 + bob, p.z);
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), simTime * 0.8 + p.phase);
      _scale.setScalar(1);
      _m4.compose(_pos, _q, _scale);
    }
    mesh.setMatrixAt(i, _m4);
  }

  game.update = function update(simDt, simTime, runner) {
    mesh.visible = params.game;
    if (!params.game) {
      updateHud();
      return;
    }

    // Gate everything on the sim clock so timeScale=0 is a true freeze: no
    // bobbing, no respawns, no collection.
    if (simDt <= 0) {
      _prevPos.copy(runner.position);
      game._prevValid = true;
      return;
    }
    if (!game._prevValid) {
      _prevPos.copy(runner.position);
      game._prevValid = true;
    }

    game.combo = comboStep(game.combo, runner.speed, simDt, COMBO_CFG);
    if (game.combo > game.bestCombo) {
      game.bestCombo = game.combo;
      persist();
    }

    const hits = sweptCollect(_prevPos, runner.position, pickups, params.collectRadius);
    for (const i of hits) {
      const p = pickups[i];
      p.active = false;
      p.respawnAt = simTime + RESPAWN_DELAY;
      game.collected++;
      const gained = scoreFor(BASE_SCORE, game.combo);
      game.score += gained;
      game.totalScore += gained;
      _burst.set(p.x, 1.25, p.z);
      game.lastBurst = particles.emitBurst(_burst, 260, {
        simTime,
        speed: 7.5,
        lifetime: params.lifetime * 1.15,
        up: 1.6,
      });
    }
    if (hits.length) persist();

    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i];
      if (!p.active && simTime >= p.respawnAt) p.active = true;
      writeInstance(i, simTime);
    }
    mesh.instanceMatrix.needsUpdate = true;

    _prevPos.copy(runner.position);
    updateHud();
  };

  game.applyParams = () => {
    // Pushed past 1.0 with tone mapping off, so the rings clear the bloom
    // threshold and read at distance instead of as thin dark outlines.
    material.color.set(params.colorB).multiplyScalar(1.7);
    mesh.visible = params.game;
    updateHud();
  };

  game.reset = () => {
    game.score = 0;
    game.combo = 1;
    game.collected = 0;
    for (const p of pickups) {
      p.active = true;
      p.respawnAt = 0;
    }
    updateHud();
  };

  return game;
}
