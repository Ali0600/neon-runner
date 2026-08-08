uniform vec3 uColorA;
uniform vec3 uColorB;

varying float vAge;
varying float vSide;
varying float vStrength;

void main() {
  // Soft edges across the ribbon, hot core down the middle.
  float across = 1.0 - abs(vSide);
  float core = pow(across, 2.5);
  float edgeFade = smoothstep(0.0, 0.35, across);

  float ageFade = (1.0 - vAge) * (1.0 - vAge);
  float alpha = edgeFade * ageFade * vStrength;
  if (alpha < 0.004) discard;

  // Cyan core near the runner, cooling toward magenta as the sample ages, so
  // the ribbon reads as a gradient rather than a uniform white worm.
  vec3 col = mix(uColorA, uColorB, core * 0.7 + (1.0 - vAge) * 0.3);
  col = mix(col, vec3(1.0), pow(core, 3.0) * 0.28);
  col *= 0.45 + core * 1.05;

  gl_FragColor = vec4(col, alpha);
}
