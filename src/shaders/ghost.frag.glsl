uniform float uErosion; // computed CPU-side by ghostErosion()
uniform float uTime; // frozen at capture, so a dead ghost's grain stops crawling
uniform float uStrength; // 1 at capture, 0 at the end of the fade
uniform float uGain; // emissive scale, normalized against the ghost count
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;

varying vec3 vLocal;
varying vec3 vNormal;

// hash / valueNoise / dissolveNoise / dissolveHeightBias come from
// chunks/dissolveNoise.glsl, prepended in Afterimages.js — the same chunk the
// live body uses, so a fresh ghost erodes with an identical grain.

void main() {
  float n = dissolveNoise(vLocal, uTime);

  // The one difference from the live body: the erosion offset arrives as a
  // uniform rather than being derived from a dissolve here. It runs from well
  // ALONG at capture (0.85) up past this sum's ceiling of 1.5, which is what
  // lets a ghost reach nothing at all — the live cap tops out at 0.62 and never
  // could.
  //
  // Starting high is deliberate and is the opposite of what it sounds like: the
  // fresnel below makes an un-eroded shell read as a hollow outline, whereas the
  // matter this discards is drawn as the spark cloud (ghostSparks.vert.glsl),
  // which fills the figure in solid. A fresh ghost is therefore mostly sparks
  // plus a mesh remnant up top, where the height bias holds the threshold high.
  float threshold = (n + dissolveHeightBias(vLocal.y)) - uErosion;

  if (threshold < 0.0) discard;

  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float fres = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.2);

  // Cools along the chain: a fresh ghost carries the secondary (the runner's own
  // hot colour) and ages toward the primary, so the trail reads as a gradient
  // rather than a row of identical stamps. Additive layers pile toward white
  // fast, so the tint has to stay pure here — the whiteness comes for free from
  // the overlap and the bloom.
  vec3 tint = mix(uColorA, uColorB, uStrength);

  // No dark base: these are additive shells, and a dark core added to whatever
  // is behind it just fogs the scene instead of dimming the ghost.
  vec3 col = tint * fres * 1.25;

  // Emissive band at the erosion front, same as the body's.
  float edge = 1.0 - smoothstep(0.0, 0.15, threshold);
  col += mix(tint, uColorC, n * 0.5) * edge * 1.15;

  // Strength enters exactly once, through source alpha. Additive blending is
  // (SrcAlpha, One), so this fades the ghost out linearly; folding it into the
  // colour as well would square it and make the tail vanish early.
  gl_FragColor = vec4(col * uGain, uStrength);
}
