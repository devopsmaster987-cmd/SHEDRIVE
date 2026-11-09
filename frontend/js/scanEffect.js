// Lightweight WebGL scan overlay for the auth selfie stage.
// Falls back to CSS rings/grid when WebGL is unavailable or motion is reduced.

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;

float band(float value, float width) {
  return 1.0 - smoothstep(0.0, width, abs(value));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;

  float radius = length(p);
  float rings = band(sin(radius * 36.0 - u_time * 1.9), 0.075);
  rings *= 1.0 - smoothstep(0.18, 1.08, radius);

  float scanY = 0.16 + 0.68 * fract(u_time * 0.11);
  float scan = band(uv.y - scanY, 0.012);
  float scanGlow = exp(-abs(uv.y - scanY) * 26.0) * 0.35;

  float gx = band(fract(uv.x * 26.0) - 0.5, 0.012);
  float gy = band(fract(uv.y * 34.0) - 0.5, 0.012);
  float grid = max(gx, gy) * 0.5;

  float vignette = 1.0 - smoothstep(0.28, 1.3, radius);
  float flicker = 0.9 + 0.1 * sin(u_time * 8.0);
  float noise = hash(floor(gl_FragCoord.xy * 0.5) + u_time) * 0.035;

  float alpha = (rings * 0.5 + scan * 0.38 + scanGlow + grid * 0.11 + noise) * vignette * u_intensity;

  vec3 cyan = vec3(0.31, 0.94, 1.0);
  vec3 magenta = vec3(1.0, 0.17, 0.84);
  vec3 color = mix(cyan, magenta, clamp(uv.y * 0.8 + radius * 0.35, 0.0, 1.0));
  color *= flicker;

  gl_FragColor = vec4(color, alpha);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[scanEffect] shader compile failed", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[scanEffect] program link failed", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

export function createScanEffect(canvas) {
  const noop = { setActive() {}, destroy() {}, supported: false };
  if (!canvas) return noop;

  const stage = canvas.closest(".scan-stage");
  const reduced =
    document.documentElement.classList.contains("reduce-effects") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduced) {
    stage?.classList.add("no-scan-shader");
    return noop;
  }

  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    powerPreference: "low-power",
  });

  if (!gl) {
    stage?.classList.add("no-scan-shader");
    return noop;
  }

  const program = createProgram(gl);
  if (!program) {
    stage?.classList.add("no-scan-shader");
    return noop;
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  );

  const position = gl.getAttribLocation(program, "a_position");
  const resolution = gl.getUniformLocation(program, "u_resolution");
  const time = gl.getUniformLocation(program, "u_time");
  const intensity = gl.getUniformLocation(program, "u_intensity");

  gl.useProgram(program);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  let width = 0;
  let height = 0;
  let frame = 0;
  let running = true;
  let current = 0.22;
  let target = 0.22;

  const started = performance.now();

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.round(rect.width * dpr));
    height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  function render(now) {
    if (!running) return;
    resize();

    current += (target - current) * 0.075;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(resolution, width, height);
    gl.uniform1f(time, (now - started) / 1000);
    gl.uniform1f(intensity, current);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    frame = requestAnimationFrame(render);
  }

  function onVisibility() {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(frame);
    } else if (!running) {
      running = true;
      frame = requestAnimationFrame(render);
    }
  }

  const observer =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  document.addEventListener("visibilitychange", onVisibility);

  resize();
  frame = requestAnimationFrame(render);

  return {
    supported: true,
    setActive(value) {
      target = value ? 1 : 0.22;
    },
    destroy() {
      running = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
