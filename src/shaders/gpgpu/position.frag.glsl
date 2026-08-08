uniform float uDt;

// texturePosition and textureVelocity samplers are declared automatically by
// GPUComputationRenderer from the variable dependencies.

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;

  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);

  float remaining = pos.w - uDt;

  if (remaining <= 0.0) {
    // Park dead slots far off-world with a negative life. The render shader
    // discards on life alone, but keeping them out of the frustum means a
    // stale texel can never contribute a stray pixel.
    gl_FragColor = vec4(0.0, -1.0e4, 0.0, -1.0);
    return;
  }

  gl_FragColor = vec4(pos.xyz + vel.xyz * uDt, remaining);
}
