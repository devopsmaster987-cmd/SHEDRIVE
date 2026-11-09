// Small additive shaders used by the hover car's underglow and light trail.

export const underglowVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const underglowFragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered * vec2(1.0, 1.5));
    float core = smoothstep(0.5, 0.02, dist);
    float pulse = 0.8 + 0.2 * sin(uTime * 3.0);
    vec3 color = mix(vec3(1.0, 0.12, 0.75), vec3(0.25, 0.9, 1.0), smoothstep(0.0, 0.5, dist));
    gl_FragColor = vec4(color * core * 1.4, core * 0.55 * pulse);
  }
`;

export const trailVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const trailFragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    // vUv.y runs from the car (1) to the tail (0).
    float fade = pow(vUv.y, 2.2);
    float edge = smoothstep(0.5, 0.0, abs(vUv.x - 0.5));
    float streaks = 0.55 + 0.45 * sin(vUv.y * 24.0 - uTime * 6.0);
    vec3 color = mix(vec3(0.55, 0.12, 1.0), vec3(1.0, 0.18, 0.8), vUv.y);
    float alpha = fade * edge * streaks * 0.5;
    gl_FragColor = vec4(color * (1.2 + fade), alpha);
  }
`;
