uniform float uStrength; // 1 at capture, 0 at the end of the fade
uniform float uGain; // emissive scale, normalized against the ghost count
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;

varying float vFade;
varying float vSeed;

void main() {
  // Round soft sprite. Points are square, so the corners have to be cut or the
  // burst reads as a cloud of little boxes.
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float falloff = 1.0 - r2 * 4.0;
  falloff *= falloff;

  // Same age tint as the mesh these sparks came off, so a ghost and its debris
  // are visibly one object.
  vec3 tint = mix(uColorA, uColorB, uStrength);
  vec3 col = mix(tint, uColorC, vSeed * 0.35);

  // Age is a RAMP, not a gate. It was a gate while erosion eased in and sparks
  // only existed in the back half of life; now that erosion eases out they exist
  // from the front, and holding full brightness to the end makes the oldest,
  // most-scattered ghost the brightest thing on screen — the trail crescendos at
  // its tail instead of behind the runner. Proportional to age, the burst peaks
  // where it starts and the tail thins into dust.
  float a = vFade * uStrength * falloff;
  if (a <= 0.0) discard;

  // Brighter than the shell it came off: this IS the disappearance now, and the
  // mesh is fading out from under it.
  gl_FragColor = vec4(col * uGain * 1.8, a);
}
