import * as THREE from 'three';
import { rulerTicks, tickLabel } from './rulerTicks.js';

// World-unit ruler for SCOPE view.
//
// Ticks are drawn in-canvas as LineSegments; labels are DOM elements positioned
// by projecting a world point. DOM text stays crisp at any device pixel ratio
// and any orthographic scale, cannot be picked up by bloom, and cannot perturb
// the canvas hash the freeze invariant depends on. The cost: labels do not
// appear in a canvas-only screenshot, so an empty-looking screenshot is not
// evidence the ruler is missing.

const MAX_SEGMENTS = 256;
const BASE_Y = 0.05; // ticks stand up from the ground plane
const _v = new THREE.Vector3();

export function createRuler(container) {
  const positions = new Float32Array(MAX_SEGMENTS * 2 * 3);
  const geometry = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attr);
  geometry.setDrawRange(0, 0);

  const material = new THREE.LineBasicMaterial({
    // Luma ~0.27, comfortably under both styles' bloom thresholds (0.75 neon,
    // 0.62 smoke), so the ruler never glows and never competes with the plume.
    color: 0x2b4b66,
    toneMapped: false,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 0;
  lines.visible = false;

  const labels = [];
  let lastKey = '';

  function labelEl(i) {
    while (labels.length <= i) {
      const el = document.createElement('div');
      el.className = 'scope-tick';
      container.appendChild(el);
      labels.push(el);
    }
    return labels[i];
  }

  const ruler = { lines, labels };

  ruler.update = function update(camera, params, centerX, viewHeight, aspect) {
    lines.visible = params.scope && params.scopeRuler;
    if (!lines.visible) {
      for (const el of labels) el.style.display = 'none';
      return;
    }

    const halfW = (viewHeight / 2) * aspect;
    const { step, ticks } = rulerTicks(centerX, halfW, 12);

    // Rebuilding only when the tick set actually changes keeps a frozen frame
    // byte-stable and avoids per-frame DOM writes.
    const key = `${step}|${ticks[0]?.value}|${ticks.length}|${viewHeight}|${aspect.toFixed(4)}`;
    if (key === lastKey) return;
    lastKey = key;

    let n = 0;
    const write = (x1, y1, z1, x2, y2, z2) => {
      if (n >= MAX_SEGMENTS) return;
      const o = n * 6;
      positions[o] = x1; positions[o + 1] = y1; positions[o + 2] = z1;
      positions[o + 3] = x2; positions[o + 4] = y2; positions[o + 5] = z2;
      n++;
    };

    // Horizontal ruler along the lane.
    for (const t of ticks) {
      write(t.value, BASE_Y, 0, t.value, BASE_Y + (t.major ? 0.9 : 0.4), 0);
    }
    // Baseline, so the ticks read as one instrument rather than loose marks.
    if (ticks.length > 1) {
      write(ticks[0].value, BASE_Y, 0, ticks[ticks.length - 1].value, BASE_Y, 0);
    }

    // Vertical scale, pinned near the left edge of the view.
    const colX = centerX - halfW * 0.94;
    const vStep = step;
    for (let y = 0; y <= viewHeight; y += vStep) {
      const major = Math.round(y / vStep) % 5 === 0;
      write(colX, y, 0, colX + (major ? 0.9 : 0.4), y, 0);
    }
    write(colX, 0, 0, colX, viewHeight, 0);

    attr.addUpdateRange(0, n * 6);
    attr.needsUpdate = true;
    geometry.setDrawRange(0, n * 2);

    // Labels: project the world position of each major tick.
    let li = 0;
    for (const t of ticks) {
      _v.set(t.value, BASE_Y, 0).project(camera);
      const el = labelEl(li++);
      el.textContent = tickLabel(t.value, step);
      el.style.display = '';
      el.style.left = `${((_v.x + 1) / 2) * 100}%`;
      el.style.top = `${((1 - _v.y) / 2) * 100}%`;
    }
    for (let i = li; i < labels.length; i++) labels[i].style.display = 'none';
  };

  return ruler;
}
