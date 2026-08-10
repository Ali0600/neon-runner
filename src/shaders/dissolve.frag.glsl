uniform float uDissolve;
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;

varying vec3 vLocal;
varying vec3 vNormal;

// hash / valueNoise / dissolveNoise / dissolveHeightBias come from
// chunks/dissolveNoise.glsl, prepended in runner.js.

void main() {
  float n = dissolveNoise(vLocal, uTime);

  // Deliberately short of full erosion. Eroding the whole body at top speed
  // leaves a few bright fragments that bloom smears into an anonymous blob;
  // keeping the torso and head means the runner still reads as a figure.
  // Afterimages need to pass this point, which is why they carry their own
  // erosion uniform rather than a pushed-up uDissolve — see D36.
  float threshold = (n + dissolveHeightBias(vLocal.y)) - uDissolve * 0.62;

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
