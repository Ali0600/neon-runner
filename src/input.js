import * as THREE from 'three';

// Keyboard state -> { moveVec (normalized, XZ plane), sprint }.
// Also owns mouse-drag orbit yaw so the camera rig can read a single source.

const KEYS = {
  KeyW: 'f',
  ArrowUp: 'f',
  KeyS: 'b',
  ArrowDown: 'b',
  KeyA: 'l',
  ArrowLeft: 'l',
  KeyD: 'r',
  ArrowRight: 'r',
};

export function createInput(domElement) {
  const down = new Set();
  const state = {
    moveVec: new THREE.Vector2(0, 0), // x = strafe, y = forward
    sprint: false,
    orbitYaw: 0,
    orbitPitch: 0,
  };

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  // Typing into a GUI number field must not also drive the runner. This guard
  // predates the T binding but only became obvious once a letter key was bound.
  function isTyping() {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  function onKeyDown(e) {
    if (e.repeat || isTyping()) return;
    if (KEYS[e.code]) {
      down.add(KEYS[e.code]);
      e.preventDefault();
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.sprint = true;
    if (e.code === 'KeyT') state.onTrigger?.();
    if (e.code === 'Period') state.onStep?.();
  }

  function onKeyUp(e) {
    // Deliberately NOT guarded by isTyping(): a key pressed before focus moved
    // into a field must still release, or it sticks down forever.
    if (KEYS[e.code]) down.delete(KEYS[e.code]);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.sprint = false;
  }

  // A tab-switch or a focus loss never delivers keyup — without this the runner
  // sprints forever into the fog.
  function clearAll() {
    down.clear();
    state.sprint = false;
    dragging = false;
  }

  function onPointerDown(e) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    domElement.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    state.orbitYaw -= (e.clientX - lastX) * 0.005;
    state.orbitPitch = THREE.MathUtils.clamp(
      state.orbitPitch + (e.clientY - lastY) * 0.003,
      -0.35,
      0.75
    );
    lastX = e.clientX;
    lastY = e.clientY;
  }
  function onPointerUp(e) {
    dragging = false;
    domElement.releasePointerCapture?.(e.pointerId);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearAll();
  });
  domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  state.update = () => {
    const x = (down.has('r') ? 1 : 0) - (down.has('l') ? 1 : 0);
    const y = (down.has('f') ? 1 : 0) - (down.has('b') ? 1 : 0);
    state.moveVec.set(x, y);
    if (state.moveVec.lengthSq() > 1) state.moveVec.normalize();
  };

  // Verification hook: lets the console drive movement without real key events.
  state.press = (k) => down.add(k);
  state.release = (k) => down.delete(k);

  return state;
}
