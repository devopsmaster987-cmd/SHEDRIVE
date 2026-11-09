import * as THREE from "three";
import { buildingVertexShader, buildingFragmentShader } from "./shaders/building.js";
import { roadVertexShader, roadFragmentShader } from "./shaders/road.js";
import { particleVertexShader, particleFragmentShader } from "./shaders/particles.js";
import { disposeObject3D } from "./scene.js";

const FOG_COLOR = new THREE.Color(0x05030f);
const FOG_NEAR = 26;
const FOG_FAR = 250;

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSkyDome() {
  const geometry = new THREE.SphereGeometry(420, 32, 18);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;

      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vDir;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 top = vec3(0.004, 0.002, 0.016);
        vec3 mid = vec3(0.020, 0.008, 0.060);
        vec3 horizon = vec3(0.16, 0.035, 0.24);
        vec3 color = mix(horizon, mid, smoothstep(0.48, 0.66, h));
        color = mix(color, top, smoothstep(0.64, 0.98, h));

        // Warm city glow sitting on the horizon.
        float glow = pow(1.0 - abs(vDir.y), 8.0);
        color += vec3(0.42, 0.05, 0.34) * glow * 0.45;
        color += vec3(0.05, 0.20, 0.32) * pow(1.0 - abs(vDir.y), 20.0) * 0.35;

        // A sparse field of stars.
        vec2 starCell = floor(vDir.xz * 260.0 + vDir.y * 90.0);
        float star = step(0.9982, hash(starCell));
        float twinkle = 0.6 + 0.4 * sin(uTime * 1.5 + hash(starCell + 9.0) * 30.0);
        color += vec3(0.75, 0.9, 1.0) * star * twinkle * smoothstep(0.6, 0.9, h);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0, -70);
  mesh.frustumCulled = false;
  return mesh;
}

function createRoad() {
  const geometry = new THREE.PlaneGeometry(720, 720, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uFogColor: { value: FOG_COLOR },
    },
    vertexShader: roadVertexShader,
    fragmentShader: roadFragmentShader,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, -0.02, -90);
  mesh.frustumCulled = false;
  return mesh;
}

function buildBuildingData() {
  const random = mulberry32(20261030);
  const buildings = [];

  for (const side of [-1, 1]) {
    for (let row = 0; row < 18; row += 1) {
      const z = 34 - row * 13;
      for (let col = 0; col < 5; col += 1) {
        const width = 5 + random() * 5;
        const depth = 5 + random() * 5;
        const tallBias = col === 0 ? 1.35 : 1;
        const height = (8 + Math.pow(random(), 2.2) * 62) * (0.85 + row * 0.025) * tallBias;

        buildings.push({
          x: side * (15 + col * 11 + (random() - 0.5) * 3),
          z: z + (random() - 0.5) * 3.5,
          width,
          depth,
          height,
          seed: random(),
        });
      }
    }
  }

  // A distant back row of very tall silhouettes closes the horizon.
  for (let i = 0; i < 22; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    buildings.push({
      x: side * (82 + random() * 40),
      z: -130 - random() * 80,
      width: 8 + random() * 7,
      depth: 8 + random() * 7,
      height: 38 + random() * 54,
      seed: random(),
    });
  }

  return buildings;
}

function createBuildings() {
  const data = buildBuildingData();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  // Make the box sit on the ground: local Y spans 0..1 instead of -0.5..0.5.
  geometry.translate(0, 0.5, 0);

  const scales = new Float32Array(data.length * 3);
  const seeds = new Float32Array(data.length);

  geometry.setAttribute("aScale", new THREE.InstancedBufferAttribute(scales, 3));
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uFogColor: { value: FOG_COLOR },
    },
    vertexShader: buildingVertexShader,
    fragmentShader: buildingFragmentShader,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, data.length);
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();

  data.forEach((building, index) => {
    dummy.position.set(building.x, 0, building.z);
    dummy.scale.set(building.width, building.height, building.depth);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);

    scales[index * 3] = building.width;
    scales[index * 3 + 1] = building.height;
    scales[index * 3 + 2] = building.depth;
    seeds[index] = building.seed;
  });

  mesh.instanceMatrix.needsUpdate = true;
  geometry.getAttribute("aScale").needsUpdate = true;
  geometry.getAttribute("aSeed").needsUpdate = true;

  return { mesh, data };
}

function createRooftopLights(buildings) {
  const candidates = buildings.filter((building) => building.height > 22);
  const count = Math.min(candidates.length, 85);

  const geometry = new THREE.BoxGeometry(0.1, 1, 0.1);
  geometry.translate(0, 1, 0);

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    transparent: true,
    opacity: 0.85,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const magenta = new THREE.Color(0xff2bd6);
  const cyan = new THREE.Color(0x4ff0ff);
  const violet = new THREE.Color(0x8b5cff);

  for (let i = 0; i < count; i += 1) {
    const building = candidates[i * 3] || candidates[i];
    const height = 2 + (i % 7) * 0.9;
    dummy.position.set(building.x, building.height, building.z);
    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    const color = i % 3 === 0 ? cyan : i % 3 === 1 ? magenta : violet;
    mesh.setColorAt(i, color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return mesh;
}

function createSkyBridges() {
  const group = new THREE.Group();
  const colors = [0xff2bd6, 0x4ff0ff, 0x8b5cff];

  [-34, -74, -116].forEach((z, index) => {
    const height = 24 + index * 7;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-34, height - 5, z),
      new THREE.Vector3(-15, height + 2, z - 2),
      new THREE.Vector3(0, height + 4, z),
      new THREE.Vector3(15, height + 2, z - 2),
      new THREE.Vector3(34, height - 5, z),
    ]);

    const geometry = new THREE.TubeGeometry(curve, 36, 0.1, 5, false);
    const material = new THREE.MeshBasicMaterial({
      color: colors[index % colors.length],
      transparent: true,
      opacity: 0.55,
      toneMapped: false,
    });

    group.add(new THREE.Mesh(geometry, material));
  });

  return group;
}

function createParticles() {
  const count = 620;
  const random = mulberry32(77123);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);

  const palette = [
    new THREE.Color(0xff2bd6),
    new THREE.Color(0x4ff0ff),
    new THREE.Color(0xc9b8ff),
    new THREE.Color(0x8b5cff),
  ];

  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (random() - 0.5) * 170;
    positions[i * 3 + 1] = 2 + random() * 74;
    positions[i * 3 + 2] = 40 - random() * 220;

    const color = palette[Math.floor(random() * palette.length)];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = 0.7 + random() * 2.2;
    seeds[i] = random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

/**
 * Builds the complete procedural night city.
 * Returns update() for animation and dispose() for cleanup.
 */
export function createCity(scene) {
  const group = new THREE.Group();
  group.name = "neon-night-city";
  scene.add(group);

  const sky = createSkyDome();
  const road = createRoad();
  const { mesh: buildings, data: buildingData } = createBuildings();
  const rooftopLights = createRooftopLights(buildingData);
  const bridges = createSkyBridges();
  const particles = createParticles();

  group.add(sky, road, buildings, rooftopLights, bridges, particles);

  const buildingMaterial = buildings.material;
  const roadMaterial = road.material;
  const skyMaterial = sky.material;

  return {
    group,

    update(time) {
      buildingMaterial.uniforms.uTime.value = time;
      roadMaterial.uniforms.uTime.value = time;
      skyMaterial.uniforms.uTime.value = time;
      particles.material.uniforms.uTime.value = time;

      // Slow lighthouse-style blinking on the rooftop antennas.
      rooftopLights.material.opacity = 0.55 + 0.35 * Math.sin(time * 1.6);
    },

    setPixelRatio(pixelRatio) {
      particles.material.uniforms.uPixelRatio.value = Math.min(pixelRatio, 2);
    },

    dispose() {
      scene.remove(group);
      disposeObject3D(group);
    },
  };
}
