uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform vec3 uSmokeColor;
uniform float uIntensity;
uniform float uSmokeOpacity;

varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying float vLifeN;

void main() {
  vec2 q = vUv * 2.0 - 1.0; // -1..1, +y points along the direction of travel

#ifdef KIND_SMOKE

  // Soft round puff, normal-blended. No hot core and no whitening: smoke is
  // read by its silhouette and its occlusion of what is behind it, and any
  // additive term would turn it back into another glow.
  float r = length(q);
  float shape = 1.0 - smoothstep(0.05, 0.95, r);
  float alpha = shape * shape * vFade * uSmokeOpacity;
  if (alpha < 0.004) discard;

  // Lit by the embers it was born in, cooling to plain grey as it rises away
  // from the heat.
  vec3 col = mix(uColorA * 0.85, uSmokeColor, smoothstep(0.0, 0.5, vLifeN));
  gl_FragColor = vec4(col, alpha);

#else

  #ifdef KIND_EMBER
    // Sparks are short and roughly round, so the profile is symmetric rather
    // than the comet shape a stretched streak wants.
    float across = exp(-q.x * q.x * 5.0);
    float along = exp(-q.y * q.y * 5.0);
    float shape = across * along;
  #else
    // Tight Gaussian across the streak, comet profile along it: hot at the head
    // (+y), wispy toward the tail, soft at both caps.
    float across = exp(-q.x * q.x * 7.0);
    float along = smoothstep(-1.0, 0.55, q.y) * (1.0 - smoothstep(0.7, 1.0, q.y));
    float shape = across * along;
  #endif

  float intensity = shape * vFade;
  if (intensity < 0.004) discard;

  // Three-stop palette walk keyed on the particle's seed.
  float s = fract(vSeed * 13.37);
  vec3 col = s < 0.5 ? mix(uColorA, uColorC, s * 2.0) : mix(uColorC, uColorB, (s - 0.5) * 2.0);

  #ifdef KIND_EMBER
    // Embers burn down: hot yellow-white at birth, deep red before they die.
    col = mix(col, uColorC * 0.7, smoothstep(0.2, 1.0, vLifeN));
  #endif

  // Only the very centre of the streak whitens. A broader white mix reads as
  // fog once thousands of these stack additively, and the palette disappears.
  col = mix(col, vec3(1.0), pow(shape, 8.0) * 0.55);
  col *= uIntensity * (0.35 + shape * 1.15);

  gl_FragColor = vec4(col, intensity);

#endif
}
