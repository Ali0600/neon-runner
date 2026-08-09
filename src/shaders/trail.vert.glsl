attribute vec3 aInfo;    // x = age 0..1, y = side -1/+1, z = emission strength
attribute vec3 aTangent; // path direction at this sample

uniform float uWidth;

varying float vAge;
varying float vSide;
varying float vStrength;

void main() {
  vAge = aInfo.x;
  vSide = aInfo.y;
  vStrength = aInfo.z;

  vec4 viewPos = viewMatrix * vec4(position, 1.0);
  vec3 viewTangent = normalize(mat3(viewMatrix) * aTangent);

  // Camera-facing ribbon: offset perpendicular to both the path and the view
  // ray, so the strip never edges out to a hairline as the camera swings.
  // Same projection assumption as the particle billboards: -viewPos is only the
  // direction to the camera under perspective. See particleCommon.glsl.
  vec3 toCam = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-viewPos.xyz);
  vec3 normal = cross(viewTangent, toCam);
  float len = length(normal);
  normal = len > 1e-4 ? normal / len : vec3(1.0, 0.0, 0.0);

  // Taper: widest just behind the runner, pinched at the far end.
  float taper = (1.0 - aInfo.x) * (0.35 + 0.65 * smoothstep(0.0, 0.12, aInfo.x));
  viewPos.xyz += normal * (aInfo.y * uWidth * taper * aInfo.z);

  gl_Position = projectionMatrix * viewPos;
}
