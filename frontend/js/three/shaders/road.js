// Animated neon street grid. Roads, sidewalks, lane dashes, flowing light
// pulses and a pickup ring are all drawn procedurally on one plane.

export const roadVertexShader = /* glsl */ `
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const roadFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uFogColor;

  varying vec3 vWorldPos;

  float line(float value, float center, float width) {
    return 1.0 - smoothstep(width, width + 0.035, abs(value - center));
  }

  void main() {
    vec2 p = vWorldPos.xz;

    // City block layout: one avenue along Z plus cross streets every 44 units.
    float onAvenue = 1.0 - smoothstep(9.0, 9.6, abs(p.x));
    float crossDist = abs(mod(p.y + 22.0, 44.0) - 22.0);
    float onCross = 1.0 - smoothstep(3.4, 4.0, crossDist);
    float onRoad = clamp(onAvenue + onCross, 0.0, 1.0);

    // Base ground and asphalt.
    vec3 ground = vec3(0.012, 0.008, 0.028);
    vec3 asphalt = vec3(0.022, 0.016, 0.05);
    vec3 color = mix(ground, asphalt, onRoad);

    // Sidewalk grid outside the roads.
    vec2 block = abs(fract((p + 22.0) / 4.0) - 0.5) * 4.0;
    float gridLine = (1.0 - smoothstep(0.0, 0.06, block.x)) + (1.0 - smoothstep(0.0, 0.06, block.y));
    color += vec3(0.05, 0.035, 0.12) * gridLine * (1.0 - onRoad) * 0.35;

    // Glowing edges of the avenue.
    float avenueEdge = line(p.x, 9.2, 0.08) + line(p.x, -9.2, 0.08);
    color += mix(vec3(0.6, 0.1, 1.0), vec3(0.2, 0.9, 1.0), step(0.0, p.x)) * avenueEdge * 1.6;

    // Cross-street edges.
    float crossEdge = line(crossDist, 3.8, 0.06);
    color += vec3(0.45, 0.3, 1.0) * crossEdge * onAvenue * 0.8;

    // Dashed lane markers on the avenue.
    float laneA = line(p.x, 4.2, 0.055);
    float laneB = line(p.x, -4.2, 0.055);
    float laneC = line(p.x, 0.0, 0.045);
    float dash = step(0.55, fract(p.y * 0.16));
    color += vec3(0.35, 0.75, 1.0) * (laneA + laneB) * dash * 0.55;
    color += vec3(0.95, 0.35, 0.95) * laneC * dash * 0.5;

    // Light pulses flowing toward the camera.
    float flow = fract(p.y * 0.045 - uTime * 0.16);
    float pulse = smoothstep(0.86, 1.0, flow) * smoothstep(0.0, 0.2, flow);
    float laneMask = (line(p.x, 4.2, 0.5) + line(p.x, -4.2, 0.5)) * onAvenue;
    color += mix(vec3(1.0, 0.15, 0.82), vec3(0.2, 0.9, 1.0), step(0.0, p.x)) * laneMask * pulse * 2.4;

    // Soft cyan wash down the centre of the avenue.
    color += vec3(0.02, 0.11, 0.20) * onAvenue;

    // Pulsing pickup ring near the start of the avenue.
    float ringDist = abs(length(p - vec2(0.0, 4.0)) - 6.0);
    float ring = 1.0 - smoothstep(0.0, 0.22, ringDist);
    float ringPulse = 0.55 + 0.45 * sin(uTime * 1.8);
    color += mix(vec3(1.0, 0.25, 0.85), vec3(0.3, 0.95, 1.0), 0.5) * ring * ringPulse * 1.5;

    // Sparse reflected sparkles on the asphalt.
    float sparkle = step(0.996, fract(sin(dot(floor(p * 2.0), vec2(12.9898, 78.233))) * 43758.5453));
    color += vec3(0.5, 0.7, 1.0) * sparkle * onRoad * 0.8;

    float fogFactor = smoothstep(uFogNear, uFogFar, distance(vWorldPos, cameraPosition));
    color = mix(color, uFogColor, fogFactor);

    gl_FragColor = vec4(color, 1.0);
  }
`;
