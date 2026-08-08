// Feedback forces — the reason this engine exists. None of these can be
// expressed in the analytic engine, because each depends on where the particle
// currently IS, not only on when it was born.

#define TRAIL_MAX 24

uniform float uDt;
uniform float uTime;
uniform float uDrag;
uniform float uRise;

uniform vec3 uRunnerPos;
uniform float uRegather;   // 0..1, ramps up as the runner slows to a stop
uniform float uVortex;
uniform float uTurbulence;

uniform vec3 uTrailPts[TRAIL_MAX];
uniform int uTrailCount;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;

  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);

  if (pos.w <= 0.0) {
    gl_FragColor = vel; // dead: leave the slot alone
    return;
  }

  vec3 p = pos.xyz;
  vec3 v = vel.xyz;
  vec3 force = vec3(0.0, uRise, 0.0);

  // --- vortex around the runner's recent path ---------------------------
  // Find the nearest segment of the downsampled trail, then push tangentially
  // around its axis with a weak inward pull, so particles spiral along the
  // path instead of spraying away from it.
  if (uVortex > 0.0 && uTrailCount > 1) {
    float bestDistSq = 1.0e9;
    vec3 bestClosest = vec3(0.0);
    vec3 bestAxis = vec3(0.0, 1.0, 0.0);

    for (int i = 0; i < TRAIL_MAX - 1; i++) {
      if (i >= uTrailCount - 1) break;
      vec3 a = uTrailPts[i];
      vec3 b = uTrailPts[i + 1];
      vec3 ab = b - a;
      float lenSq = dot(ab, ab);
      if (lenSq < 1.0e-8) continue;
      float t = clamp(dot(p - a, ab) / lenSq, 0.0, 1.0);
      vec3 c = a + ab * t;
      vec3 d = p - c;
      float dSq = dot(d, d);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestClosest = c;
        bestAxis = ab / sqrt(lenSq);
      }
    }

    float dist = sqrt(bestDistSq);
    if (dist > 1.0e-4) {
      vec3 radial = (p - bestClosest) / dist;
      vec3 tangential = cross(bestAxis, radial);
      // Falls off smoothly so distant particles are untouched rather than
      // yanked by a discontinuity at some cutoff radius.
      float falloff = 1.0 / (1.0 + dist * dist * 0.35);
      force += (tangential * 1.0 - radial * 0.45) * uVortex * falloff;
    }
  }

  // --- regather ---------------------------------------------------------
  // When the runner stops, the light he shed is drawn back in. Scaled by
  // distance so far-flung particles come home rather than hovering.
  if (uRegather > 0.0) {
    vec3 toRunner = uRunnerPos - p;
    float d = length(toRunner);
    if (d > 0.35) {
      force += (toRunner / d) * uRegather * (2.0 + d * 0.55);
    }
  }

  // --- turbulence -------------------------------------------------------
  // Analytic divergence-ish sin field: no texture fetch, no state, and it
  // varies over both space and time so particles never fall into lockstep.
  if (uTurbulence > 0.0) {
    vec3 turb = vec3(
      sin(p.z * 0.9 + uTime * 1.1) - cos(p.y * 0.7 - uTime * 0.6),
      sin(p.x * 0.8 - uTime * 0.9) - cos(p.z * 0.6 + uTime * 0.7),
      sin(p.y * 1.1 + uTime * 0.8) - cos(p.x * 0.5 - uTime * 0.5)
    );
    force += turb * uTurbulence;
  }

  v += force * uDt;
  // Exponential drag applied as a factor rather than a force keeps it stable
  // at any timestep; as a force it can overshoot and flip the velocity.
  v *= exp(-uDrag * uDt);

  gl_FragColor = vec4(v, vel.w);
}
