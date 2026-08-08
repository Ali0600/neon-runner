uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uIntensity;

varying vec2 vUv;
varying float vFade;
varying float vSeed;

void main() {
  vec2 q = vUv * 2.0 - 1.0; // -1..1, +y points along the direction of travel

  // Tight Gaussian across the streak, comet profile along it: hot at the head
  // (+y), wispy toward the tail, soft at both caps.
  float across = exp(-q.x * q.x * 7.0);
  float along = smoothstep(-1.0, 0.55, q.y) * (1.0 - smoothstep(0.7, 1.0, q.y));
  float shape = across * along;

  float intensity = shape * vFade;
  if (intensity < 0.004) discard;

  // Three-stop palette walk keyed on the particle's seed.
  float s = fract(vSeed * 13.37);
  vec3 col = s < 0.5 ? mix(uColorA, uColorC, s * 2.0) : mix(uColorC, uColorB, (s - 0.5) * 2.0);

  // Only the very centre of the streak whitens. A broader white mix reads as
  // fog once thousands of these stack additively, and the palette disappears.
  col = mix(col, vec3(1.0), pow(shape, 8.0) * 0.55);
  col *= uIntensity * (0.35 + shape * 1.15);

  gl_FragColor = vec4(col, intensity);
}
