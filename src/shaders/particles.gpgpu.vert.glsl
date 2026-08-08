attribute vec2 aRef;   // texel-centre UV of this instance's slot
attribute float aSeed;

uniform sampler2D uPosTex; // xyz = world position, w = remaining life
uniform sampler2D uVelTex; // xyz = velocity, w = initial lifetime

void main() {
  vec4 pos = texture2D(uPosTex, aRef);
  vec4 vel = texture2D(uVelTex, aRef);

  float remaining = pos.w;
  float life = vel.w;

  if (particleSkipped(aSeed) || remaining <= 0.0 || life <= 0.0) {
    particleDiscard();
    return;
  }

  vec3 vp = (viewMatrix * vec4(pos.xyz, 1.0)).xyz;
  vec3 vv = mat3(viewMatrix) * vel.xyz;

  vec3 T, S;
  float speed;
  particleBasis(vp, vv, T, S, speed);

  // The simulation counts life down, so normalised age has to be inverted.
  float lifeN = clamp(1.0 - remaining / life, 0.0, 1.0);
  float width, len;
  particleSize(lifeN, aSeed, speed, width, len);

  vec2 c = position.xy;
  vec3 offset = c.x * S * width + c.y * T * len;

  vUv = position.xy + 0.5;
  vSeed = aSeed;
  vLifeN = lifeN;

  gl_Position = projectionMatrix * vec4(vp + offset, 1.0);
}
