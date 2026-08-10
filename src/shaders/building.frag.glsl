// A dark slab with lit window rows, not a glowing block.
//
// The pylons this replaces were deliberately thin, and their comment said why:
// "a wide pylon near the camera reads as a flat coloured bar across the frame".
// That is a property of a UNIFORMLY emissive surface, not of width. Breaking the
// face into small bright cells against a dark body gives the eye something to
// read scale and distance from, which is what makes it look like architecture.

uniform vec3 uBody;
uniform float uFloorH; // storey height, world units
uniform float uWinPitch; // window spacing across the face
uniform float uGlow;

varying vec3 vLocal;
varying vec3 vSize;
varying vec3 vTint;
varying vec3 vNrm;
varying float vSeed;
varying float vDepth;

#include <fog_pars_fragment>

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  // Roof and floor carry no windows; only the four sides do.
  float side = 1.0 - step(0.5, abs(vNrm.y));

  // Run the window grid across whichever axis this face actually spans.
  float u = abs(vNrm.x) > 0.5 ? vLocal.z : vLocal.x;
  vec2 cell = vec2(u / uWinPitch, vLocal.y / uFloorH);
  vec2 f = abs(fract(cell) - 0.5);
  // Narrow panes with real wall between them. Wide ones tile into a
  // checkerboard: at this scale a building is only three or four cells across,
  // so a high window-to-wall ratio stops reading as a facade entirely.
  float pane = step(f.x, 0.20) * step(f.y, 0.26) * side;

  // Which panes are lit is fixed per building and per cell, so a frozen frame
  // stays frozen — no time term anywhere in here.
  float id = hash21(floor(cell) + vSeed * 91.7);
  // Whole columns tend to share a state in a real building (one stairwell, one
  // tenant), and that vertical streaking is most of what stops a grid of
  // independent random cells looking like TV static.
  float column = hash21(vec2(floor(cell.x), vSeed * 17.3));
  float lit = step(0.34, id * 0.55 + column * 0.45) * (0.35 + id * 0.65);

  // Far buildings must NOT resolve individual windows: at 150 units a pane is
  // sub-pixel, and a sub-pixel grid aliases into crawling moire the moment the
  // camera moves. Fade the detail into a flat glow of the same average energy.
  float detail = 1.0 - smoothstep(55.0, 150.0, vDepth);
  float win = mix(0.16, pane * lit, detail);

  // A cheap fixed lambert so the four faces separate. The scene lights do not
  // reach this material, exactly as they did not reach the pylons.
  float lam = 0.34 + 0.66 * max(0.0, dot(vNrm, normalize(vec3(0.42, 0.72, 0.55))));

  // Bright lip at the roofline — the climb needs a visible finish line, and it
  // is what gives the silhouette an edge for the bloom to catch.
  float top = vSize.y * 0.5;
  float lip = smoothstep(top - 0.55, top - 0.08, vLocal.y) * side;

  // Vertical corner seams. Without them two adjacent faces of the same box meet
  // at an invisible join and the whole thing reads as a flat billboard rather
  // than as a solid with depth.
  //
  // Measured along the SAME axis the windows run on. Testing both axes lights
  // the entire facade instead: on a face whose normal is z, every point has
  // |vLocal.z| == hd by definition, so that term is 1 everywhere.
  float halfU = abs(vNrm.x) > 0.5 ? vSize.z * 0.5 : vSize.x * 0.5;
  float edge = smoothstep(halfU - 0.18, halfU, abs(u)) * side;

  // Grime toward street level, so the base sits into the ground instead of
  // glowing as brightly as the top and appearing to float.
  float base = smoothstep(-top, -top + 6.0, vLocal.y) * 0.75 + 0.25;

  vec3 col = uBody * lam
    + vTint * win * uGlow * base
    + vTint * lip * 1.5
    + vTint * edge * 0.22;

  gl_FragColor = vec4(col, 1.0);

  #include <fog_fragment>
}
