import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createPost(renderer, scene, camera, params) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    params.bloomStrength,
    params.bloomRadius,
    params.bloomThreshold
  );
  composer.addPass(bloom);

  // OutputPass must be last: it applies tone mapping and the sRGB conversion
  // that the intermediate render targets skip.
  composer.addPass(new OutputPass());

  return {
    composer,
    bloom,
    renderPass,
    // RenderPass holds its camera as a plain field read at draw time, so
    // swapping projections is an assignment — no composer rebuild.
    setCamera: (cam) => {
      renderPass.camera = cam;
    },
    render: () => composer.render(),
    setSize: (w, h) => {
      composer.setSize(w, h);
    },
    applyParams: () => {
      bloom.strength = params.bloomStrength;
      bloom.radius = params.bloomRadius;
      bloom.threshold = params.bloomThreshold;
      renderer.toneMappingExposure = params.exposure;
    },
  };
}
