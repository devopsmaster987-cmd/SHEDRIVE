import * as THREE from "three";

const BG_COLOR = 0x05030f;

export function isWebGLAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl"))
    );
  } catch {
    return false;
  }
}

// Pick a sensible quality level without asking the user anything.
export function detectQuality() {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  const smallScreen = window.innerWidth < 768;
  const lowPower = coarse || cores <= 4 || memory <= 4 || smallScreen;

  return {
    lowPower,
    // Retina looks great but 3x phones would waste fill rate.
    maxPixelRatio: lowPower ? 1.5 : 2,
    bloomStrength: lowPower ? 0.45 : 0.72,
  };
}

export function createRenderer(canvas, maxPixelRatio = 2) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(BG_COLOR, 1);

  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  // Used by the car's standard materials; the city shaders fog themselves.
  scene.fog = new THREE.FogExp2(BG_COLOR, 0.012);
  return scene;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    52,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.1,
    700
  );
  camera.position.set(0, 8, 34);
  return camera;
}

export function resizeStage(renderer, camera, composer) {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();

  renderer.setSize(width, height, false);

  if (composer) {
    if (typeof composer.setPixelRatio === "function") {
      composer.setPixelRatio(renderer.getPixelRatio());
    }
    composer.setSize(width, height);
  }
}

// Free GPU memory when leaving the page. Textures are discovered through
// material properties (map, emissiveMap, ...).
export function disposeObject3D(root) {
  root.traverse((object) => {
    if (object.geometry) object.geometry.dispose();

    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];

    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value && value.isTexture) value.dispose();
      });
      material.dispose();
    });
  });
}
