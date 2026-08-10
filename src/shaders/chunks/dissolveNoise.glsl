// Erosion noise shared by the live runner body and its afterimages.
//
// Prepended to both fragment shaders rather than duplicated: the ghosts have to
// erode with exactly the same grain as the body they peeled off, and two copies
// of a hash function drift the moment either is retuned.
//
// The weights below are load-bearing beyond the look — `valueNoise` returns
// 0..1, so a two-octave sum weighted 0.65 + 0.35 also tops out at 1.0. Together
// with the 0.5 height bias that puts a hard ceiling of 1.5 on the erosion
// threshold, which is the number FULL_EROSION in afterimages/logic.js clears.

// Cheap hash-based 3D value noise — no texture lookup, good enough for an
// erosion threshold where only the shape's raggedness matters.
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// Two octaves, slowly drifting so the erosion edge crawls instead of sitting
// still. Ghosts freeze `t` at capture, so a dead ghost's grain stops crawling.
float dissolveNoise(vec3 local, float t) {
  return valueNoise(local * 3.2 + vec3(0.0, t * 0.35, 0.0)) * 0.65
       + valueNoise(local * 8.0 - vec3(t * 0.5, 0.0, 0.0)) * 0.35;
}

// Erosion bias from the feet upward, so the figure reads as lifting off into
// light. `local.y` is measured from the ground, so the figure spans 0..~1.8.
float dissolveHeightBias(float localY) {
  return smoothstep(0.0, 1.8, localY) * 0.5;
}
