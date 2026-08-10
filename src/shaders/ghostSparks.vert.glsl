// The matter an afterimage has already lost, drawn as particles flying outward.
//
// This is the SAME merged body geometry as the ghost mesh, drawn a second time as
// points. The mesh discards where the erosion threshold has passed a vertex; this
// draws exactly the complement — a point exists only where the mesh has given that
// matter up. The two sets are exact opposites by construction, so nothing is drawn
// twice and nothing falls between them, and there is no second timing system to
// keep in step: `uErosion` already drives both.
//
// How far a spark has flown is how far past the erosion front it is, so the
// scatter inherits the dissolve's feet-first order for free.

attribute float aJoint; // 0..9, index into runner.bodyMeshes

uniform mat4 uJoints[10];
uniform vec3 uOrigin; // runner position at capture — the noise frame's origin
uniform float uErosion; // computed CPU-side by ghostErosion()
uniform float uTime; // frozen at capture, so a dead ghost's grain stops crawling
uniform float uSparkReach; // world units of flight per unit of erosion excess
uniform float uSparkSize; // spark diameter in world units
uniform float uViewportH; // drawing-buffer height, for world-sized points

varying float vFade;
varying float vSeed;

// hash / valueNoise / dissolveNoise / dissolveHeightBias come from
// chunks/dissolveNoise.glsl, prepended in Afterimages.js.

void main() {
  // +0.5 before truncating: the attribute round-trips through a float buffer,
  // and 6.0 arriving as 5.9999 would silently swap two limbs.
  mat4 joint = uJoints[int(aJoint + 0.5)];

  vec4 world = joint * vec4(position, 1.0);
  vec3 local = world.xyz - uOrigin;

  // The mesh keeps this matter while `(n + bias) - uErosion >= 0`; the excess is
  // the same quantity with the sign flipped, so it is positive exactly where the
  // mesh has stopped drawing.
  float n = dissolveNoise(local, uTime);
  float excess = uErosion - (n + dissolveHeightBias(local.y));

  if (excess <= 0.0) {
    // Still solid — the mesh is drawing it. Park the point outside the clip
    // volume rather than drawing a degenerate one.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vFade = 0.0;
    vSeed = 0.0;
    return;
  }

  // Per-vertex constants, hashed from the REST position so they are fixed for
  // the life of the ghost. A frozen frame must not resample them, which is why
  // there is no rng anywhere in here.
  float r1 = hash(position * 13.1);
  float r2 = hash(position * 27.7 + 5.0);
  float r3 = hash(position * 41.3 + 11.0);
  vSeed = r1;

  // A direction of its own, on the full sphere, only biased outward by the
  // surface it left. Displacing along the normal alone preserves the shape:
  // `excess` varies smoothly across the body, so neighbouring vertices move
  // together and the cloud reads as an inflated copy of the limb rather than as
  // debris. The randomness is what makes it particles.
  float th = r1 * 6.2831853;
  float z = r2 * 2.0 - 1.0;
  float rr = sqrt(max(0.0, 1.0 - z * z));
  vec3 rnd = vec3(cos(th) * rr, z, sin(th) * rr);
  vec3 nrm = normalize(mat3(joint) * normal);
  vec3 dir = normalize(nrm * 0.55 + rnd);

  // Per-particle speed spread, for the same reason: one speed over a smooth
  // excess field keeps the silhouette legible long after it should have broken
  // up. The quadratic term makes the cloud accelerate away as it ages, while the
  // linear one keeps early sparks moving enough to be seen leaving the body.
  float speed = 0.35 + 1.35 * r3;
  world.xyz += dir * excess * (0.4 + excess) * uSparkReach * speed;

  gl_Position = projectionMatrix * viewMatrix * world;

  // Dims with flight, so a spark reads as matter tearing off and cooling — but
  // GENTLY. A sharp falloff makes the only visible sparks the ones that have
  // barely moved, which is the coherent shell all over again; the whole point is
  // to watch them travel. Exponential, so it never quite reaches zero and there
  // is no distance at which a spark pops out.
  vFade = exp(-excess * 0.85);

  // World-sized points in BOTH projections: w is 1 under ortho, and
  // projectionMatrix[1][1] carries the scale in each case.
  gl_PointSize = clamp(
    uSparkSize * projectionMatrix[1][1] * uViewportH * 0.5 / gl_Position.w,
    1.0,
    64.0
  );
}
