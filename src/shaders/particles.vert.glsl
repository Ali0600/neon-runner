attribute vec4 aSpawn; // xyz = spawn position, w = spawn time (sim clock)
attribute vec4 aVel;   // xyz = initial velocity, w = lifetime
attribute float aSeed;

uniform float uTime;
uniform float uWidth;
uniform float uLength;
uniform float uStretch;
uniform float uWobble;
uniform float uRise;
uniform float uDrag;

varying vec2 vUv;
varying float vFade;
varying float vSeed;

void main() {
  float life = aVel.w;
  float t = uTime - aSpawn.w;

  // Dead or not yet born: emit a degenerate off-screen vertex. Cheaper than a
  // second draw call and the triangle is clipped before rasterization.
  if (t < 0.0 || t >= life || life <= 0.0) {
    vUv = vec2(0.0);
    vFade = 0.0;
    vSeed = 0.0;
    gl_Position = vec4(2e3, 2e3, 2e3, 1.0);
    return;
  }

  // Closed-form motion: exponential drag + constant rise + a drifting wobble.
  // Because it is analytic, position depends only on (uTime - spawnTime), so
  // pausing or scrubbing the sim clock is free and exactly reversible.
  float ed = exp(-uDrag * t);
  vec3 p = aSpawn.xyz + aVel.xyz * ((1.0 - ed) / uDrag);
  vec3 dp = aVel.xyz * ed;

  p.y += 0.5 * uRise * t * t;
  dp.y += uRise * t;

  float ph = aSeed * 6.2831853;
  vec3 f = vec3(sin(t * 3.1 + ph), sin(t * 2.3 + ph * 1.7), cos(t * 2.7 + ph * 2.3));
  vec3 fd = vec3(3.1 * cos(t * 3.1 + ph), 2.3 * cos(t * 2.3 + ph * 1.7), -2.7 * sin(t * 2.7 + ph * 2.3));
  p += f * (uWobble * t);
  dp += (fd * t + f) * uWobble;

  // Build a velocity-aligned billboard in view space: T runs along the
  // instantaneous direction of travel, S is perpendicular to it on screen.
  vec3 vp = (viewMatrix * vec4(p, 1.0)).xyz;
  vec3 vv = mat3(viewMatrix) * dp;

  float speed = length(vv);
  vec3 T = speed > 1e-4 ? vv / speed : vec3(1.0, 0.0, 0.0);

  vec3 toCam = normalize(-vp);
  vec3 S = cross(T, toCam);
  float sl = length(S);
  // Streak pointing straight at the camera: any perpendicular will do.
  S = sl > 1e-4 ? S / sl : normalize(cross(T, vec3(0.0, 1.0, 0.0)) + vec3(1e-3, 0.0, 0.0));

  float lifeN = t / life;
  float sizeJit = 0.55 + fract(aSeed * 91.7) * 0.95;

  float width = uWidth * sizeJit * (0.35 + 0.65 * (1.0 - lifeN));
  float len = (uLength + uStretch * speed) * sizeJit;

  vec2 c = position.xy; // quad corner, +-0.5
  vec3 offset = c.x * S * width + c.y * T * len;

  vFade = smoothstep(0.0, 0.05, lifeN) * (1.0 - smoothstep(0.3, 1.0, lifeN));
  vUv = position.xy + 0.5;
  vSeed = aSeed;

  gl_Position = projectionMatrix * vec4(vp + offset, 1.0);
}
