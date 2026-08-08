uniform vec3 uOrigin;

varying vec3 vLocal;
varying vec3 vNormal;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // Body-local frame: coherent across every limb (so the erosion reads as one
  // figure dissolving, not six parts) and stable as the runner moves, which a
  // world-space sample would not be — the noise would swim past the body.
  vLocal = world.xyz - uOrigin;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
