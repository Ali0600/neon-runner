// Spawn injection. Each vertex is a 1-pixel point positioned at the exact texel
// centre of the slot it is writing, rendered straight into the current state
// target. This uploads only the slots spawned this frame — the same bandwidth
// profile as the analytic engine's partial buffer ranges — with no rectangle
// decomposition and no full-texture round trip.

attribute vec4 aPosData; // xyz = spawn position, w = lifetime
attribute vec4 aVelData; // xyz = spawn velocity, w = lifetime

varying vec4 vData;

void main() {
  #ifdef INJECT_VELOCITY
    vData = aVelData;
  #else
    vData = aPosData;
  #endif

  // `position` already carries texel-centre NDC, computed on the CPU.
  gl_Position = vec4(position.xy, 0.0, 1.0);
  gl_PointSize = 1.0;
}
