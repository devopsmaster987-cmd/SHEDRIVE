// Procedural tower shader. One InstancedMesh draws the whole skyline:
// the fragment shader calculates window grids, lit windows, neon roof rims
// and distance fog. No textures are downloaded.

export const buildingVertexShader = /* glsl */ `
  attribute vec3 aScale;
  attribute float aSeed;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vScale;
  varying float vSeed;
  varying float vHeight;

  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vScale = aScale;
    vSeed = aSeed;
    vHeight = position.y;

    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const buildingFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uFogColor;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vScale;
  varying float vSeed;
  varying float vHeight;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 facade = vec3(0.018, 0.012, 0.045);
    vec3 color = facade;

    float isRoof = step(0.62, abs(vNormal.y));

    if (isRoof > 0.5) {
      // Dark rooftops with a thin neon perimeter.
      color = vec3(0.014, 0.009, 0.032);
      vec2 edgeDist = abs(vUv - 0.5) * 2.0;
      float rim = smoothstep(0.9, 1.0, max(edgeDist.x, edgeDist.y));
      vec3 rimColor = mix(vec3(1.0, 0.18, 0.8), vec3(0.25, 0.95, 1.0), step(0.55, fract(vSeed * 3.7)));
      color += rimColor * rim * 1.5;
    } else {
      // Face width depends on whether the normal points along X or Z.
      float faceWidth = mix(vScale.x, vScale.z, step(0.5, abs(vNormal.x)));
      float cols = max(faceWidth * 0.95, 1.0);
      float rows = max(vScale.y * 1.05, 2.0);

      vec2 grid = vec2(vUv.x * cols, vUv.y * rows);
      vec2 cellId = floor(grid);
      vec2 cellUv = fract(grid);

      float windowShape =
        step(0.16, cellUv.x) * step(cellUv.x, 0.84) *
        step(0.26, cellUv.y) * step(cellUv.y, 0.78);

      float n = hash21(cellId + vec2(vSeed * 31.7, vSeed * 17.3) + vec2(vNormal.x * 5.0, vNormal.z * 3.0));
      float lit = step(0.52, n);
      float flicker = 0.78 + 0.22 * sin(uTime * (0.5 + n * 1.4) + n * 42.0);

      vec3 windowColor = mix(vec3(1.0, 0.22, 0.86), vec3(0.3, 0.92, 1.0), step(0.5, fract(n * 7.3)));
      windowColor = mix(windowColor, vec3(0.62, 0.42, 1.0), step(0.84, fract(n * 13.1)));

      float brightness = 0.7 + vHeight * 0.7;
      color += windowColor * windowShape * lit * flicker * brightness * 1.9;

      // Faint vertical mullions give every tower a readable silhouette.
      float mullion = smoothstep(0.49, 0.5, abs(fract(grid.x) - 0.5) + 0.49);
      color += vec3(0.06, 0.03, 0.14) * mullion * 0.4;

      // Neon crown at the top of the building.
      float crown = smoothstep(0.94, 1.0, vHeight);
      vec3 crownColor = mix(vec3(1.0, 0.2, 0.82), vec3(0.28, 0.95, 1.0), step(0.5, fract(vSeed * 5.3)));
      color += crownColor * crown * 2.2;

      // Darker base so towers feel grounded in the street.
      color *= mix(0.55, 1.0, smoothstep(0.0, 0.18, vHeight));
    }

    float fogFactor = smoothstep(uFogNear, uFogFar, distance(vWorldPos, cameraPosition));
    color = mix(color, uFogColor, fogFactor);

    gl_FragColor = vec4(color, 1.0);
  }
`;
