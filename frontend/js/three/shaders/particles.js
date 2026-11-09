// Floating neon dust above the city. Additive soft points, no textures.

export const particleVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;

  attribute float aSize;
  attribute float aSeed;
  attribute vec3 aColor;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 pos = position;
    pos.y += sin(uTime * 0.25 + aSeed * 20.0) * 1.8;
    pos.x += cos(uTime * 0.18 + aSeed * 13.0) * 0.9;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    gl_PointSize = aSize * uPixelRatio * (140.0 / max(1.0, -mvPosition.z));
    vColor = aColor;
    vAlpha = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 1.4 + aSeed * 30.0));
  }
`;

export const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float glow = smoothstep(0.5, 0.0, d);
    glow *= glow;
    gl_FragColor = vec4(vColor * glow * 1.8, glow * vAlpha);
  }
`;
