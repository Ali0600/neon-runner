// One afterimage: the ten body meshes merged into a single buffer, each vertex
// tagged with which of them it came from. The pose is ten world matrices copied
// straight off the live runner at capture time, so a ghost is exactly the figure
// that stood there — no re-derived gait to drift out of step with it.

attribute float aJoint; // 0..9, index into runner.bodyMeshes

uniform mat4 uJoints[10];
uniform vec3 uOrigin; // runner position at capture — the noise frame's origin

varying vec3 vLocal;
varying vec3 vNormal;

void main() {
  // +0.5 before truncating: the attribute round-trips through a float buffer,
  // and 6.0 arriving as 5.9999 would silently swap two limbs.
  mat4 joint = uJoints[int(aJoint + 0.5)];

  vec4 world = joint * vec4(position, 1.0);

  // Body-local, so the erosion grain is coherent across limbs and stays put on
  // the ghost instead of swimming as the live runner walks away from it.
  vLocal = world.xyz - uOrigin;

  // The joint matrices are rigid (unit scale), so the rotation part transforms
  // normals directly — no inverse-transpose needed.
  vNormal = normalize(mat3(viewMatrix) * mat3(joint) * normal);

  gl_Position = projectionMatrix * viewMatrix * world;
}
