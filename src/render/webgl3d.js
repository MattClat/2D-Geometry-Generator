/* =========================================================================
 * webgl3d.js — real-time material preview of the extruded part
 *
 * A compact WebGL renderer: orbit camera, three-light studio rig, procedural
 * materials (wood grain, brushed metal anisotropy, translucent acrylic,
 * FDM layer lines) and a contact-shadow ground plane. Consumes exactly the
 * same triangulated extrusion that the STL exporter writes, so the preview is
 * a faithful picture of the manufactured part.
 * =======================================================================*/

export const MATERIALS = [
  { id: 'walnut',  label: 'Oiled walnut',      color: [0.30, 0.17, 0.09], kind: 1, rough: 0.45, edge: [0.14, 0.07, 0.03] },
  { id: 'birch',   label: 'Raw birch ply',     color: [0.84, 0.70, 0.48], kind: 1, rough: 0.72, edge: [0.42, 0.30, 0.16] },
  { id: 'brass',   label: 'Brushed brass',     color: [0.83, 0.66, 0.28], kind: 2, rough: 0.28, edge: [0.55, 0.42, 0.15] },
  { id: 'alu',     label: 'Anodised aluminium',color: [0.62, 0.64, 0.68], kind: 2, rough: 0.42, edge: [0.35, 0.37, 0.40] },
  { id: 'steel',   label: 'Blackened steel',   color: [0.20, 0.21, 0.23], kind: 2, rough: 0.38, edge: [0.10, 0.11, 0.12] },
  { id: 'acrylic', label: 'Neon acrylic',      color: [0.15, 0.95, 0.75], kind: 3, rough: 0.08, edge: [0.60, 1.00, 0.92] },
  { id: 'magenta', label: 'Magenta acrylic',   color: [0.95, 0.18, 0.62], kind: 3, rough: 0.08, edge: [1.00, 0.55, 0.82] },
  { id: 'pla',     label: 'FDM filament',      color: [0.30, 0.55, 0.92], kind: 4, rough: 0.60, edge: [0.18, 0.34, 0.62] },
  { id: 'card',    label: 'Kraft card',        color: [0.76, 0.65, 0.50], kind: 0, rough: 0.9,  edge: [0.50, 0.41, 0.30] },
];
export const MATERIAL_BY_ID = Object.fromEntries(MATERIALS.map((m) => [m.id, m]));

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uProj, uView, uModel;
varying vec3 vN, vWorld, vLocal;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorld = wp.xyz;
  vLocal = aPos;
  vN = mat3(uModel) * aNormal;
  gl_Position = uProj * uView * wp;
}`;

const FRAG = `
precision highp float;
varying vec3 vN, vWorld, vLocal;
uniform vec3 uColor, uEdge, uCam;
uniform float uRough, uKind, uTime, uThickness;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vWorld);
  float topness = clamp(N.z, 0.0, 1.0);

  vec3 base = uColor;

  if (uKind < 0.5) {
    base *= 0.92 + 0.16 * fbm(vLocal.xy * 0.7);
  } else if (uKind < 1.5) {
    // wood: stretched growth rings + fine fibre
    float rings = fbm(vec2(vLocal.x * 0.045, vLocal.y * 0.9));
    float grain = sin(vLocal.y * 0.55 + rings * 9.0) * 0.5 + 0.5;
    float fibre = noise(vec2(vLocal.x * 3.0, vLocal.y * 60.0));
    base *= 0.74 + 0.34 * grain + 0.10 * fibre;
  } else if (uKind < 2.5) {
    // metal: anisotropic brush streaks
    float streak = noise(vec2(vLocal.x * 90.0, vLocal.y * 1.2));
    base *= 0.86 + 0.28 * streak;
  } else if (uKind < 3.5) {
    // acrylic: edge-lit, translucent core
    base *= 0.9;
  } else {
    // FDM: visible layer lines on the walls
    float layer = abs(fract(vLocal.z * 5.0) - 0.5) * 2.0;
    base *= mix(0.80, 1.06, layer) * (0.94 + 0.10 * noise(vLocal.xy * 4.0));
  }

  // three-point studio rig
  vec3 L1 = normalize(vec3(-0.45, -0.55, 0.95));
  vec3 L2 = normalize(vec3(0.85, 0.15, 0.35));
  vec3 L3 = normalize(vec3(0.1, 0.9, -0.3));
  float d1 = max(dot(N, L1), 0.0);
  float d2 = max(dot(N, L2), 0.0) * 0.42;
  float d3 = max(dot(N, L3), 0.0) * 0.22;
  float hemi = 0.30 + 0.30 * (N.z * 0.5 + 0.5);

  float shin = mix(6.0, 140.0, 1.0 - uRough);
  float spec = 0.0;
  spec += pow(max(dot(reflect(-L1, N), V), 0.0), shin);
  spec += 0.5 * pow(max(dot(reflect(-L2, N), V), 0.0), shin);
  spec *= mix(0.10, 1.25, 1.0 - uRough);

  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  vec3 col = base * (hemi + d1 * 0.95 + d2 + d3);
  vec3 specTint = (uKind > 1.5 && uKind < 2.5) ? base * 1.6 : vec3(1.0);
  col += specTint * spec * 0.55;

  // darken the cut walls so the profile reads
  col = mix(col * mix(vec3(1.0), uEdge / max(uColor, vec3(0.001)), 0.55), col, topness * 0.85 + 0.15);

  if (uKind > 2.5 && uKind < 3.5) {
    col += uEdge * fres * 0.9;                 // edge glow
    col += uColor * (1.0 - topness) * 0.35;    // lit walls
  } else {
    col += vec3(fres) * 0.10;
  }

  col = col / (col + vec3(0.85)) * 1.55;       // filmic-ish rolloff
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}`;

const GROUND_VERT = `
attribute vec2 aPos;
uniform mat4 uProj, uView;
uniform float uScale;
varying vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = uProj * uView * vec4(aPos * uScale, -0.35, 1.0);
}`;

const GROUND_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform vec3 uTop, uBottom;
void main() {
  float r = length(vUv);
  float shade = smoothstep(1.0, 0.0, r);
  vec3 c = mix(uBottom, uTop, shade);
  gl_FragColor = vec4(c, shade * 0.85);
}`;

/* ---------------- minimal mat4 ---------------- */
const m4 = {
  identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const out = new Float32Array(16);
    out[0] = f / aspect; out[5] = f; out[11] = -1;
    out[10] = (far + near) / (near - far);
    out[14] = (2 * far * near) / (near - far);
    return out;
  },
  lookAt(eye, center, up) {
    const z = norm3(sub3(eye, center));
    const x = norm3(cross3(up, z));
    const y = cross3(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
    ]);
  },
  translate(x, y, z) {
    const o = m4.identity(); o[12] = x; o[13] = y; o[14] = z; return o;
  },
};
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function compile(gl, vsrc, fsrc) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vsrc));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
  return p;
}

export class Viewer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.count = 0;
    this.radius = 220;
    this.theta = -Math.PI / 2 + 0.55;
    this.phi = 0.95;
    this.dist = 520;
    this.target = [0, 0, 0];
    this._material = MATERIALS[0];
    this._thickness = 3;
    this._autoRotate = false;
    this.bg = [0.055, 0.058, 0.07];
    this._t = 0;
    this.dirty = true;
    this.lastMesh = null;

    // A browser may drop the GL context at any time (GPU reset, too many
    // contexts, a backgrounded tab). Without these handlers the viewport just
    // goes black for good.
    this._onLost = (e) => { e.preventDefault(); this.lost = true; };
    this._onRestored = () => {
      this.lost = false;
      this._init();
      if (this.lastMesh) this.setMesh(this.lastMesh);
      this.dirty = true;
    };
    canvas.addEventListener('webglcontextlost', this._onLost, false);
    canvas.addEventListener('webglcontextrestored', this._onRestored, false);
    this._init();
  }

  _init() {
    const canvas = this.canvas;
    const opts = { antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' };
    this.gl = this.gl || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!this.gl) { this.failed = 'WebGL unavailable'; return; }
    const gl = this.gl;
    try {
      this.prog = compile(gl, VERT, FRAG);
      this.ground = compile(gl, GROUND_VERT, GROUND_FRAG);
    } catch (e) { this.failed = e.message; return; }
    this.failed = null;
    this.posBuf = gl.createBuffer();
    this.nrmBuf = gl.createBuffer();
    this.groundBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.groundBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  }

  // Changing any of these needs a redraw; the render loop skips frames
  // otherwise, so an idle viewport costs nothing.
  get material() { return this._material; }
  set material(m) { if (m !== this._material) { this._material = m; this.dirty = true; } }
  get thickness() { return this._thickness; }
  set thickness(t) { if (t !== this._thickness) { this._thickness = t; this.dirty = true; } }
  get autoRotate() { return this._autoRotate; }
  set autoRotate(v) { this._autoRotate = !!v; this.dirty = true; }

  setMesh(mesh, bbox) {
    this.lastMesh = mesh;
    this.dirty = true;
    if (!this.gl || this.failed || this.lost) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    this.count = mesh.positions.length / 3;
    if (bbox) {
      const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2;
      this.target = [cx, cy, 0];
      this.radius = Math.max(20, Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]) / 2);
    }
  }

  frameCamera() { this.dist = this.radius * 2.9; this.dirty = true; }

  orbit(dx, dy) {
    this.dirty = true;
    this.theta -= dx * 0.008;
    this.phi = Math.max(0.06, Math.min(Math.PI - 0.06, this.phi - dy * 0.008));
  }
  pan(dx, dy) {
    this.dirty = true;
    const s = this.dist * 0.0016;
    const right = [Math.cos(this.theta + Math.PI / 2), Math.sin(this.theta + Math.PI / 2), 0];
    this.target[0] -= right[0] * dx * s;
    this.target[1] -= right[1] * dx * s;
    this.target[2] += dy * s;
  }
  zoom(delta) {
    this.dirty = true;
    this.dist = Math.max(this.radius * 0.4, Math.min(this.radius * 14, this.dist * Math.exp(delta * 0.0014)));
  }

  render(dtMs = 16) {
    const gl = this.gl;
    if (!gl || this.failed || this.lost) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const hgt = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== hgt) {
      this.canvas.width = w; this.canvas.height = hgt;
      this.dirty = true;
    }
    if (!this.dirty && !this.autoRotate) return;
    this.dirty = false;
    this._t += dtMs / 1000;
    if (this.autoRotate) this.theta += dtMs * 0.00018;
    gl.viewport(0, 0, w, hgt);
    gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    const eye = [
      this.target[0] + this.dist * sp * Math.cos(this.theta),
      this.target[1] + this.dist * sp * Math.sin(this.theta),
      this.target[2] + this.dist * cp,
    ];
    const proj = m4.perspective(0.72, w / hgt, this.radius * 0.05, this.dist + this.radius * 12);
    const view = m4.lookAt(eye, this.target, [0, 0, 1]);
    const model = m4.identity();

    // ground gradient disc (contact shadow)
    gl.useProgram(this.ground);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.groundBuf);
    const gp = gl.getAttribLocation(this.ground, 'aPos');
    gl.enableVertexAttribArray(gp);
    gl.vertexAttribPointer(gp, 2, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.ground, 'uProj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.ground, 'uView'), false, view);
    gl.uniform1f(gl.getUniformLocation(this.ground, 'uScale'), this.radius * 2.2);
    gl.uniform3f(gl.getUniformLocation(this.ground, 'uTop'), 0.10, 0.11, 0.13);
    gl.uniform3f(gl.getUniformLocation(this.ground, 'uBottom'), this.bg[0], this.bg[1], this.bg[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    if (!this.count) return;

    gl.useProgram(this.prog);
    const bind = (buf, name, size) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const loc = gl.getAttribLocation(this.prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    bind(this.posBuf, 'aPos', 3);
    bind(this.nrmBuf, 'aNormal', 3);
    const U = (n) => gl.getUniformLocation(this.prog, n);
    gl.uniformMatrix4fv(U('uProj'), false, proj);
    gl.uniformMatrix4fv(U('uView'), false, view);
    gl.uniformMatrix4fv(U('uModel'), false, model);
    const M = this.material;
    gl.uniform3fv(U('uColor'), M.color);
    gl.uniform3fv(U('uEdge'), M.edge);
    gl.uniform3fv(U('uCam'), eye);
    gl.uniform1f(U('uRough'), M.rough);
    gl.uniform1f(U('uKind'), M.kind);
    gl.uniform1f(U('uTime'), this._t);
    gl.uniform1f(U('uThickness'), this.thickness);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this._onLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored, false);
    const gl = this.gl;
    if (!gl) return;
    for (const b of [this.posBuf, this.nrmBuf, this.groundBuf]) if (b) gl.deleteBuffer(b);
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.ground) gl.deleteProgram(this.ground);
    // Browsers cap live WebGL contexts (~16); release ours immediately rather
    // than waiting for garbage collection, or toggling layouts a few times
    // starts evicting the oldest context.
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
    this.gl = null;
  }
}
