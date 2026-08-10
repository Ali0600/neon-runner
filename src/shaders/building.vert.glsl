// Instanced building. The box geometry is a unit cube; the real dimensions ride
// on aSize so the fragment shader can lay out windows in WORLD units — a storey
// has to be the same height on a 60-unit tower as on a 10-unit block, which a
// normalized local coordinate cannot express.
//
// instanceMatrix therefore carries translation only. Keeping scale out of it
// also means the normal needs no inverse-transpose correction.

attribute vec3 aSize;
attribute vec3 aTint;
attribute float aSeed;

varying vec3 vLocal;
varying vec3 vSize;
varying vec3 vTint;
varying vec3 vNrm;
varying float vSeed;
varying float vDepth;

#include <fog_pars_vertex>

void main() {
  vLocal = position * aSize;
  vSize = aSize;
  vTint = aTint;
  vSeed = aSeed;
  // Rotation-free instances, so the object normal is already the world normal.
  vNrm = normal;

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(vLocal, 1.0);
  vDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
