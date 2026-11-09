import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/**
 * Bloom is what turns the city into a neon postcard. The composer is kept in
 * one module so pages can reuse the same look or lower the strength on weak
 * devices.
 */
export function createPostProcessing(renderer, scene, camera, { strength = 0.9 } = {}) {
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());

  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    strength,
    0.5,
    0.32
  );
  const outputPass = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  composer.setSize(window.innerWidth, window.innerHeight);

  return {
    composer,
    bloomPass,

    render() {
      composer.render();
    },

    setStrength(value) {
      bloomPass.strength = value;
    },

    dispose() {
      bloomPass.dispose();
      composer.dispose();
    },
  };
}
