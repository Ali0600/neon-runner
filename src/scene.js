import * as THREE from 'three';
import buildingVert from './shaders/building.vert.glsl?raw';
import buildingFrag from './shaders/building.frag.glsl?raw';

const GROUND = 400;

const _m4 = new THREE.Matrix4();
const _c = new THREE.Color();

/**
 * Render a city layout as one instanced mesh.
 *
 * Returned as a Group named 'city' so scope declutter can find it by name. It
 * must NOT be found by an isInstancedMesh probe: that predicate does not recurse
 * into groups, so a nested mesh would silently stay visible in the inspection
 * view and be the brightest thing on screen there.
 */
function createBuildings(city, params) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);

  const size = new Float32Array(city.length * 3);
  const tint = new Float32Array(city.length * 3);
  const seed = new Float32Array(city.length);
  for (let i = 0; i < city.length; i++) {
    const b = city[i];
    size[i * 3] = b.hw * 2;
    size[i * 3 + 1] = b.h;
    size[i * 3 + 2] = b.hd * 2;
    seed[i] = (i * 37) % 101;
  }
  geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 3));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  const tintAttr = new THREE.InstancedBufferAttribute(tint, 3);
  geometry.setAttribute('aTint', tintAttr);

  const material = new THREE.ShaderMaterial({
    vertexShader: buildingVert,
    fragmentShader: buildingFrag,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uBody: { value: new THREE.Color(0x0a0d18) },
        uFloorH: { value: 3.1 },
        uWinPitch: { value: 2.3 },
        uGlow: { value: 1.0 },
      },
    ]),
    fog: true,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, city.length);
  // Translation only: aSize carries the scale, so the shader can reason in
  // world units and the normals need no correction.
  for (let i = 0; i < city.length; i++) {
    const b = city[i];
    mesh.setMatrixAt(i, _m4.makeTranslation(b.x, b.h / 2, b.z));
  }
  mesh.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'city';
  group.add(mesh);

  group.applyParams = () => {
    // Windows take the palette, so a style switch carries the skyline with it.
    // The pylons never did this and stayed neon-magenta in smoke mode.
    const palette = [params.colorA, params.colorB, params.colorC];
    for (let i = 0; i < city.length; i++) {
      // Deterministic per index — the city must hash identically every load.
      _c.set(palette[i % palette.length]).multiplyScalar(0.4 + ((i * 13) % 7) / 10);
      tint[i * 3] = _c.r;
      tint[i * 3 + 1] = _c.g;
      tint[i * 3 + 2] = _c.b;
    }
    tintAttr.needsUpdate = true;
  };
  group.applyParams();

  return group;
}

export function createScene(city, params) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  scene.fog = new THREE.FogExp2(0x05060a, 0.011);

  // Dark, slightly reflective ground so neon spills across it.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND, GROUND),
    new THREE.MeshStandardMaterial({
      color: 0x0a0c14,
      roughness: 0.55,
      metalness: 0.65,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground'; // so scope declutter can find it without a type guess
  scene.add(ground);

  const grid = new THREE.GridHelper(GROUND, 100, 0x2f5f8f, 0x18304e);
  grid.position.y = 0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.85;
  grid.material.depthWrite = false;
  scene.add(grid);

  // Buildings, replacing the decorative pylons that stood here. They are real
  // geometry now: runner.js collides against the same layout, and the wall-run
  // climbs it.
  const buildings = createBuildings(city, params);
  scene.add(buildings);

  scene.add(new THREE.AmbientLight(0x2a3a5c, 0.9));
  const key = new THREE.DirectionalLight(0x8fd0ff, 0.35);
  key.position.set(20, 40, 10);
  scene.add(key);

  scene.applyParams = () => buildings.applyParams();

  return scene;
}
