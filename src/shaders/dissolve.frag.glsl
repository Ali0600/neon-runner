uniform float uDissolve;
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;

varying vec3 vLocal;
varying vec3 vNormal;

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

void main() {
  // Two octaves, slowly drifting so the erosion edge crawls instead of sitting still.
  float n = valueNoise(vLocal * 3.2 + vec3(0.0, uTime * 0.35, 0.0)) * 0.65
          + valueNoise(vLocal * 8.0 - vec3(uTime * 0.5, 0.0, 0.0)) * 0.35;

  // Bias erosion from the feet upward so the body reads as lifting off into
  // light. vLocal.y is measured from the ground, so the figure spans 0..~1.8.
  float heightBias = smoothstep(0.0, 1.8, vLocal.y) * 0.5;
  // Deliberately short of full erosion. Eroding the whole body at top speed
  // leaves a few bright fragments that bloom smears into an anonymous blob;
  // keeping the torso and head means the runner still reads as a figure.
  float threshold = (n + heightBias) - uDissolve * 0.62;

  if (threshold < 0.0) discard;

  // Fresnel rim keeps the solid body reading as a neon silhouette, not a grey pill.
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float fres = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.2);

  // Dark core with a bright rim: the figure reads as a lit silhouette rather
  // than a shaded solid, which is what keeps it legible against the bloom.
  vec3 base = mix(vec3(0.015, 0.02, 0.045), uColorB * 0.5, fres);
  vec3 col = base + mix(uColorA, uColorB, uDissolve * 0.5) * fres * (1.1 + uDissolve * 1.4);

  // Emissive band right at the erosion front — this is what bloom catches.
  // Kept modest: bloom multiplies it, and a hotter band clips the whole
  // silhouette to a featureless white blob.
  float edge = 1.0 - smoothstep(0.0, 0.15, threshold);
  col += mix(uColorA, uColorB, n) * edge * (0.9 + uDissolve * 0.8);

  gl_FragColor = vec4(col, 1.0);
}
