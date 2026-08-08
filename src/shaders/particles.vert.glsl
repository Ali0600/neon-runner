attribute vec4 aSpawn; // xyz = spawn position, w = spawn time (sim clock)
attribute vec4 aVel;   // xyz = initial velocity, w = lifetime
attribute float aSeed;

uniform float uTime;
uniform float uWobble;
uniform float uRise;
uniform float uDrag;

void main() {
  float life = aVel.w;
  float t = uTime - aSpawn.w;

  if (particleSkipped(aSeed) || t < 0.0 || t >= life || life <= 0.0) {
    particleDiscard();
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

  vec3 vp = (viewMatrix * vec4(p, 1.0)).xyz;
  vec3 vv = mat3(viewMatrix) * dp;

  vec3 T, S;
  float speed;
  particleBasis(vp, vv, T, S, speed);

  float lifeN = t / life;
  float width, len;
  particleSize(lifeN, aSeed, speed, width, len);

  vec2 c = position.xy; // quad corner, +-0.5
  vec3 offset = c.x * S * width + c.y * T * len;

  vUv = position.xy + 0.5;
  vSeed = aSeed;
  vLifeN = lifeN;

  gl_Position = projectionMatrix * vec4(vp + offset, 1.0);
}
