// Reducers over a sampled set of live particles. Pure.
//
// Every consumer of this samples rather than enumerating (the analytic engine
// strides the ring, the GPGPU engine reads a texture back at a throttled rate),
// so `sampled` is carried through to the display: a number derived from a
// subset must never be presented as if it were exact.

/**
 * @param {Array<{x,y,z,vx,vy,vz}>} samples live particles only
 * @param {{x,y,z}} origin the emitter, so plume length is measured from it
 */
export function reduceParticles(samples, origin) {
  const n = samples.length;
  if (n === 0) {
    return { count: 0, meanSpeed: 0, maxSpeed: 0, plumeLength: 0, spreadHeight: 0, spanX: 0 };
  }

  let sumSpeed = 0;
  let maxSpeed = 0;
  let plumeLength = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;

  for (let i = 0; i < n; i++) {
    const p = samples[i];
    const speed = Math.hypot(p.vx, p.vy, p.vz);
    sumSpeed += speed;
    if (speed > maxSpeed) maxSpeed = speed;

    const d = Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    if (d > plumeLength) plumeLength = d;

    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }

  return {
    count: n,
    meanSpeed: sumSpeed / n,
    maxSpeed,
    plumeLength,
    spreadHeight: maxY - minY,
    spanX: maxX - minX,
  };
}
