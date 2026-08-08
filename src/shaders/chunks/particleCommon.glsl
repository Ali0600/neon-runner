// Shared by both particle engines. The analytic engine derives position and
// velocity from a closed form; the GPGPU engine reads them from state textures.
// Everything downstream of "I have a position and a velocity" is identical, and
// lives here so the two engines cannot drift apart visually.

uniform float uWidth;
uniform float uLength;
uniform float uStretch;
uniform float uSmokeRatio;
uniform float uGrow;

varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying float vLifeN;

// True when this instance belongs to the smoke half of the buffer. In smoke
// style two materials render the same instances and each discards the other's.
bool particleIsSmoke(float seed) {
  return fract(seed * 37.719) < uSmokeRatio;
}

// This instance is not drawn by this material — dead, unborn, or owned by the
// sibling kind. A degenerate off-screen vertex is clipped before rasterization.
bool particleSkipped(float seed) {
  #ifdef KIND_SMOKE
    return !particleIsSmoke(seed);
  #elif defined(KIND_EMBER)
    return particleIsSmoke(seed);
  #else
    return false;
  #endif
}

void particleDiscard() {
  vUv = vec2(0.0);
  vFade = 0.0;
  vSeed = 0.0;
  vLifeN = 0.0;
  gl_Position = vec4(2e3, 2e3, 2e3, 1.0);
}

// Velocity-aligned billboard basis in view space: T runs along the direction of
// travel, S is perpendicular to it on screen.
void particleBasis(vec3 viewPos, vec3 viewVel, out vec3 T, out vec3 S, out float speed) {
  speed = length(viewVel);
  T = speed > 1e-4 ? viewVel / speed : vec3(1.0, 0.0, 0.0);

  vec3 toCam = normalize(-viewPos);
  S = cross(T, toCam);
  float sl = length(S);
  // Streak pointing straight at the camera: any perpendicular will do.
  S = sl > 1e-4 ? S / sl : normalize(cross(T, vec3(0.0, 1.0, 0.0)) + vec3(1e-3, 0.0, 0.0));
}

// Kind-dependent size and life fade. Writes vFade as a side effect because the
// two kinds fade on different curves.
void particleSize(float lifeN, float seed, float speed, out float width, out float len) {
  float sizeJit = 0.55 + fract(seed * 91.7) * 0.95;

  #ifdef KIND_SMOKE
    // Round and expanding: a wisp of smoke spreads as it cools, and having no
    // long axis is what stops it reading as another streak.
    float puff = uWidth * sizeJit * (1.0 + uGrow * lifeN);
    width = puff;
    len = puff;
    // Slow fade in and a long fade out — smoke lingers where light does not.
    vFade = smoothstep(0.0, 0.12, lifeN) * (1.0 - smoothstep(0.25, 1.0, lifeN));
  #else
    width = uWidth * sizeJit * (0.35 + 0.65 * (1.0 - lifeN));
    len = (uLength + uStretch * speed) * sizeJit;
    vFade = smoothstep(0.0, 0.05, lifeN) * (1.0 - smoothstep(0.3, 1.0, lifeN));
  #endif
}
