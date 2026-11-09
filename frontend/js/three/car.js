import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  underglowVertexShader,
  underglowFragmentShader,
  trailVertexShader,
  trailFragmentShader,
} from "./shaders/glow.js";
import { disposeObject3D } from "./scene.js";

function createGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.35, "rgba(180, 240, 255, 0.7)");
  gradient.addColorStop(1, "rgba(120, 200, 255, 0)");

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createSprite(texture, color, scale) {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(scale);
  return sprite;
}

/**
 * A stylized, procedural hover car: no glTF download, everything is geometry.
 * Additive glows plus bloom do the heavy lifting visually.
 */
export function createHoverCar(scene) {
  const group = new THREE.Group();
  group.name = "neon-hover-car";
  group.position.set(2.8, 0.18, 8);
  group.scale.setScalar(1.15);
  scene.add(group);

  const glowTexture = createGlowTexture();
  const wheelMeshes = [];

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x140a2e,
    metalness: 0.92,
    roughness: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    emissive: 0x1b0433,
    emissiveIntensity: 0.6,
  });

  const body = new THREE.Mesh(new RoundedBoxGeometry(2.25, 0.52, 4.25, 4, 0.16), bodyMaterial);
  body.position.y = 0.6;
  group.add(body);

  const cabinMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x07131f,
    metalness: 0.7,
    roughness: 0.08,
    transparent: true,
    opacity: 0.82,
    emissive: 0x03202c,
    emissiveIntensity: 0.9,
  });

  const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.55, 0.5, 1.9, 4, 0.18), cabinMaterial);
  cabin.position.set(0, 1.03, 0.15);
  group.add(cabin);

  // Side accent light strips.
  const stripMaterial = new THREE.MeshBasicMaterial({
    color: 0xff2bd6,
    toneMapped: false,
  });

  for (const x of [-1.15, 1.15]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 2.6), stripMaterial);
    strip.position.set(x, 0.58, -0.1);
    group.add(strip);
  }

  // Headlights and their soft glow sprites.
  const headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xd9fbff, toneMapped: false });
  for (const x of [-0.7, 0.7]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.06), headlightMaterial);
    light.position.set(x, 0.66, -2.13);
    group.add(light);

    const glow = createSprite(glowTexture, 0x9ff4ff, 1.6);
    glow.position.set(x, 0.66, -2.25);
    group.add(glow);
  }

  // Full-width magenta tail bar (very bloom-friendly).
  const tailMaterial = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.075, 0.05), tailMaterial);
  tail.position.set(0, 0.72, 2.14);
  group.add(tail);

  const tailGlow = createSprite(glowTexture, 0xff3fdc, 2.1);
  tailGlow.position.set(0, 0.72, 2.3);
  group.add(tailGlow);

  // Wheels (dark cylinders with glowing rims).
  const wheelMaterial = new THREE.MeshStandardMaterial({
    color: 0x050508,
    metalness: 0.5,
    roughness: 0.7,
  });
  const rimMaterial = new THREE.MeshBasicMaterial({ color: 0x4ff0ff, toneMapped: false });

  for (const x of [-1.06, 1.06]) {
    for (const z of [-1.38, 1.38]) {
      const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 20);
      wheelGeometry.rotateZ(Math.PI / 2);

      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.position.set(x, 0.34, z);
      group.add(wheel);
      wheelMeshes.push(wheel);

      const rimGeometry = new THREE.TorusGeometry(0.19, 0.022, 8, 22);
      rimGeometry.rotateY(Math.PI / 2);
      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      rim.position.set(x + (x > 0 ? 0.13 : -0.13), 0.34, z);
      group.add(rim);
    }
  }

  // Underglow plane underneath the car.
  const underglowGeometry = new THREE.PlaneGeometry(3.3, 5.4);
  underglowGeometry.rotateX(-Math.PI / 2);
  const underglowMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: underglowVertexShader,
    fragmentShader: underglowFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const underglow = new THREE.Mesh(underglowGeometry, underglowMaterial);
  underglow.position.y = 0.03;
  group.add(underglow);

  // Long fading light trail behind the car.
  const trailGeometry = new THREE.PlaneGeometry(1.9, 12);
  trailGeometry.rotateX(-Math.PI / 2);
  const trailMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: trailVertexShader,
    fragmentShader: trailFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const trail = new THREE.Mesh(trailGeometry, trailMaterial);
  trail.position.set(0, 0.02, 8.3);
  group.add(trail);

  return {
    group,

    update(time) {
      // Ping-pong along the avenue so the hero always has a car in shot:
      // drive away, turn around at the far end, then come back toward us.
      const period = 40;
      const phase = (time % period) / period;
      const travel = (1 - Math.cos(phase * Math.PI * 2)) / 2;
      const movingTowardCamera = phase > 0.5;

      group.position.z = 8 - travel * 88;
      group.position.x = 2.8 + Math.sin(time * 0.6) * 0.35;
      group.position.y = 0.18 + Math.sin(time * 2.4) * 0.03;
      group.rotation.z = Math.sin(time * 0.9) * 0.018;
      group.rotation.y =
        (movingTowardCamera ? Math.PI : 0) + Math.sin(time * 0.45) * 0.02;

      underglowMaterial.uniforms.uTime.value = time;
      trailMaterial.uniforms.uTime.value = time;

      wheelMeshes.forEach((wheel) => {
        wheel.rotation.x = -time * 6.5;
      });
    },

    dispose() {
      scene.remove(group);
      glowTexture.dispose();
      disposeObject3D(group);
    },
  };
}
