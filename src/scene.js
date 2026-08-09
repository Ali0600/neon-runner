import * as THREE from 'three';

const GROUND = 400;

export function createScene() {
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

  // Emissive pylons give the eye parallax and something for bloom to catch.
  // One InstancedMesh instead of N meshes keeps the scene at a single draw call.
  const COUNT = 90;
  const pylonColors = [
    new THREE.Color(0xff2bd6),
    new THREE.Color(0x25f5ff),
    new THREE.Color(0x8a2bff),
  ];
  const pylons = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ toneMapped: false }),
    COUNT
  );
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + Math.random() * 0.5;
    const r = 40 + Math.random() * 150;
    const h = 5 + Math.random() * 30;
    // Thin: these are distant light columns, not architecture. A wide pylon
    // near the camera reads as a flat coloured bar across the frame.
    const w = 0.18 + Math.random() * 0.3;
    m4.makeScale(w, h, w);
    m4.setPosition(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    pylons.setMatrixAt(i, m4);
    // Dim instances so only the brightest edge into the bloom threshold.
    pylons.setColorAt(i, pylonColors[i % 3].clone().multiplyScalar(0.25 + Math.random() * 0.6));
  }
  pylons.instanceMatrix.needsUpdate = true;
  pylons.instanceColor.needsUpdate = true;
  scene.add(pylons);

  scene.add(new THREE.AmbientLight(0x2a3a5c, 0.9));
  const key = new THREE.DirectionalLight(0x8fd0ff, 0.35);
  key.position.set(20, 40, 10);
  scene.add(key);

  return scene;
}
