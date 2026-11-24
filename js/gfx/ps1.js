// The shared PS1 rendering pipeline. Every style draws through this, so they
// all get the same look automatically:
//
//   style A ─┐                      ┌──────────────┐
//            ├─► low-res FBOs ────► │ composite    │ dissolve A→B, ordered dither,
//   style B ─┘   (e.g. 320x240)     │ (low-res)    │ quantise to 15-bit colour
//                                   └──────┬───────┘
//                                          ▼
//                                   present: nearest-neighbour upscale to the
//                                   screen (+ optional scanlines / vignette)
//
// World shader: vertex snapping to a coarse screen grid (fixed-point wobble),
// affine (non perspective-correct) texture mapping, per-vertex Gouraud light,
// per-vertex distance fog, nearest texture sampling, no AA.
import { mat4 } from './math.js';

const WORLD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aColor;
layout(location=4) in vec4 aInst0;   // instancing: xyz position, uniform scale
layout(location=5) in vec4 aInst1;   // instancing: rotY, shade, sway phase, height scale
layout(location=6) in vec4 aInst2;   // instancing: rotX, rotZ (tilt / swing; rotZ spins billboards), stretch X, stretch Z (0 = 1)
uniform mat4 uModel, uView, uProj;
uniform vec2 uSnapGrid;      // half internal resolution / snap size in pixels
uniform float uSnapOn;
uniform vec3 uLightDir, uLightColor, uAmbient;
uniform float uUnlit;
uniform vec2 uFog;           // near, far
uniform vec2 uUVOffset, uUVScale;
uniform float uInstanced;    // 1 = use aInst0/aInst1
uniform float uBillboard;    // 0 off, 1 upright (cylindrical), 2 face camera fully
uniform float uTime, uSway;  // sway bends vertices by their height (foliage, banners)
uniform vec2 uFade;          // distance fade: near, far (far <= near = off)
uniform vec2 uMirror;        // x: 1 = reflect the world in the plane y = uMirror.y, 2 = only clip below it
uniform vec4 uWave;          // world-space wave on y: amp, spatial freq, speed, 0 (amp 0 = off); same field for every draw that uses it
uniform float uTwoSided;     // 1 = flip the normal toward the camera (paper cards, leaves, banners lit on both faces)
uniform vec4 uPL[4];         // point lights (Kit v6): xyz position, w radius
uniform vec3 uPLc[4];        // point light colours
uniform int uPLn;            // how many are on (beginScene resets to 0)
out vec3 vUVw;               // uv * w, w  -> undoes perspective correction
out vec2 vUVp;               // perspective-correct uv (for blending amount)
out vec3 vColor;
out float vFog;
out float vFade;
out float vAbove;            // world height above the mirror plane (before reflecting)
void main() {
  vec3 p = aPos;
  vec3 nrm = aNormal;
  float shade = 1.0;
  if (uInstanced > 0.5) {
    p.x += sin(uTime * 1.7 + aInst1.z) * uSway * max(p.y, 0.0);
    p.y *= aInst1.w;
    // Kit v5: per-instance X / Z stretch (0 = unset = 1, so older styles are unchanged)
    vec2 sxz = vec2(aInst2.z == 0.0 ? 1.0 : aInst2.z, aInst2.w == 0.0 ? 1.0 : aInst2.w);
    p.x *= sxz.x; p.z *= sxz.y;
    nrm = normalize(vec3(nrm.x / sxz.x, nrm.y, nrm.z / sxz.y));
    shade = aInst1.y;
    float cx = cos(aInst2.x), sx = sin(aInst2.x), cz = cos(aInst2.y), sz = sin(aInst2.y);
    if (uBillboard > 0.5) {
      vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]);
      vec3 up = uBillboard > 1.5 ? vec3(uView[0][1], uView[1][1], uView[2][1]) : vec3(0.0, 1.0, 0.0);
      p.xy = vec2(cz * p.x - sz * p.y, sz * p.x + cz * p.y);   // rotZ spins the sprite in its plane
      p = aInst0.xyz + (right * p.x + up * p.y) * aInst0.w;
      nrm = vec3(uView[0][2], uView[1][2], uView[2][2]);
    } else {
      // tilt around the pivot: X (pitch), then Z (roll), then Y (yaw)
      p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
      nrm = vec3(nrm.x, cx * nrm.y - sx * nrm.z, sx * nrm.y + cx * nrm.z);
      p = vec3(cz * p.x - sz * p.y, sz * p.x + cz * p.y, p.z);
      nrm = vec3(cz * nrm.x - sz * nrm.y, sz * nrm.x + cz * nrm.y, nrm.z);
      float c = cos(aInst1.x), s = sin(aInst1.x);
      p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) * aInst0.w + aInst0.xyz;
      nrm = vec3(c * nrm.x + s * nrm.z, nrm.y, -s * nrm.x + c * nrm.z);
    }
  } else if (uSway != 0.0) {
    p.x += sin(uTime * 1.7) * uSway * max(p.y, 0.0);
  }
  vec4 world = uModel * vec4(p, 1.0);
  if (uWave.x != 0.0) {
    float wt = uTime * uWave.z;
    world.y += uWave.x * (sin(world.x * uWave.y + wt) * cos(world.z * uWave.y * 0.83 - wt * 0.71)
                        + 0.5 * sin((world.x + world.z) * uWave.y * 0.47 + wt * 1.3));
  }
  vAbove = world.y - uMirror.y;
  if (uMirror.x > 0.5 && uMirror.x < 1.5) { world.y = 2.0 * uMirror.y - world.y; nrm.y = -nrm.y; }
  vec4 view = uView * world;
  vec4 clip = uProj * view;
  if (uSnapOn > 0.5 && clip.w > 0.0) {
    vec2 ndc = clip.xy / clip.w;
    ndc = floor(ndc * uSnapGrid + 0.5) / uSnapGrid;
    clip.xy = ndc * clip.w;
  }
  gl_Position = clip;
  vec3 n = normalize(mat3(uModel) * nrm);
  if (uTwoSided > 0.5 && dot(mat3(uView) * n, view.xyz) > 0.0) n = -n;
  float d =max(dot(n, -uLightDir), 0.0);
  vec3 lit = uAmbient + uLightColor * d;
  // per-vertex point lights (torches, fires), Gouraud like PS1 vertex lighting; 30 % wraps round so backs still glow
  for (int i = 0; i < 4; i++) {
    if (i >= uPLn) break;
    vec3 lp = uPL[i].xyz;
    if (uMirror.x > 0.5 && uMirror.x < 1.5) lp.y = 2.0 * uMirror.y - lp.y;
    vec3 L = lp - world.xyz;
    float dl = length(L), f = clamp(1.0 - dl / uPL[i].w, 0.0, 1.0);
    lit += uPLc[i] * (f * f) * (0.3 + 0.7 * max(dot(n, L / max(dl, 1e-4)), 0.0));
  }
  vColor = aColor * shade * mix(lit, vec3(1.0), uUnlit);
  vec2 uv = aUV * uUVScale + uUVOffset;
  vUVp = uv;
  vUVw = vec3(uv * clip.w, clip.w);
  float dist = length(view.xyz);
  vFog = clamp((dist - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);
  vFade = uFade.y > uFade.x ? smoothstep(uFade.x, uFade.y, dist) : 0.0;
}`;

const WORLD_FS = `#version 300 es
precision highp float;
in vec3 vUVw;
in vec2 vUVp;
in vec3 vColor;
in float vFog;
in float vFade;
in float vAbove;
uniform vec2 uMirror;
uniform float uOpacity;      // < 1: screen-door transparency (ordered dither), PS1-style
uniform sampler2D uTex, uTex2;
uniform sampler2D uClut;     // 16x1 palette (colour lookup table)
uniform float uIndexed;      // 1 = uTex holds palette indices, like PS1 4-bit textures
uniform float uAffine;
uniform float uBlend;        // 0..1 dither-crossfade uTex -> uTex2 (same kind: both indexed or both RGBA)
uniform vec3 uTint, uEmissive, uFogColor;
uniform float uFogOn;
out vec4 outColor;
const float BAYER[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
void main() {
  if (uMirror.x > 0.5 && vAbove < 0.0) discard;   // reflect / clip: only what is above the water plane
  if (uOpacity < 1.0) {
    ivec2 f = ivec2(gl_FragCoord.xy);
    if (uOpacity <= (BAYER[(f.y & 3) * 4 + (f.x & 3)] + 0.5) / 16.0) discard;
  }
  vec2 uv = mix(vUVp, vUVw.xy / vUVw.z, uAffine);
  vec4 t = texture(uTex, uv);
  if (uBlend > 0.0) {
    // per-texel threshold, so it sticks to the surface: blotchy 4x4-texel blocks + ordered dither inside
    ivec2 q = ivec2(floor(uv * vec2(textureSize(uTex, 0))));
    float h = fract(sin(dot(vec2(q >> 2), vec2(127.1, 311.7))) * 43758.5453);
    float th = h * 0.6 + (BAYER[(q.y & 3) * 4 + (q.x & 3)] + 0.5) / 16.0 * 0.4;
    if (uBlend >= 1.0 || uBlend > th) t = texture(uTex2, uv);
  }
  if (uIndexed > 0.5) {
    int idx = int(t.r * 255.0 + 0.5);
    if (idx > 15) discard;          // index 255 = transparent
    t = vec4(texelFetch(uClut, ivec2(idx, 0), 0).rgb, 1.0);
  } else if (t.a < 0.5) discard;    // PS1-style 1-bit transparency
  vec3 c = t.rgb * vColor * uTint + uEmissive;
  // distance fade also melts into the fog colour (black for additive draws), even with fog off
  c = mix(c, uFogColor, max(vFog * uFogOn, vFade));
  outColor = vec4(c, 1.0);
}`;

const FULLSCREEN_VS = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uA, uB;
uniform float uMix;          // 0 = all A, 1 = all B
uniform float uLevels;       // 2^bits - 1
uniform float uDither;
uniform float uSeed;
uniform float uFlash;        // show control: "big moment" flash toward uFlashColor (0..1)
uniform vec3 uFlashColor;
uniform float uFade;         // show control: blackout, 0 = normal, 1 = black (dithered fade)
out vec4 outColor;
const float BAYER[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
float bayer4(ivec2 p) { return (BAYER[(p.y & 3) * 4 + (p.x & 3)] + 0.5) / 16.0; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(uA, p, 0).rgb;
  if (uMix > 0.0) {
    // blocky pixel dissolve: random 4x4 blocks, ordered pattern inside each
    float th = hash(vec2(p / 4)) * 0.6 + bayer4(p / 2) * 0.4;
    if (uMix > th) c = texelFetch(uB, p, 0).rgb;
  }
  c = mix(c, uFlashColor, uFlash) * (1.0 - uFade);
  float d = mix(0.5, bayer4(p), uDither);
  c = floor(clamp(c, 0.0, 1.0) * uLevels + d) / uLevels;
  outColor = vec4(c, 1.0);
}`;

const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uCrt;
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUV).rgb;
  if (uCrt > 0.5) {
    float row = fract(vUV.y * uRes.y);
    c *= 1.1 * (0.82 + 0.18 * cos((row - 0.5) * 6.2831853));
    vec2 q = vUV - 0.5;
    c *= clamp(1.0 - dot(q, q) * 1.3, 0.0, 1.0);
  }
  outColor = vec4(c, 1.0);
}`;

export const RESOLUTIONS = {
  '320x240': [320, 240],
  '426x240': [426, 240],
  'auto240': null,       // 240 lines, width matches the screen's aspect
  '640x480': [640, 480],
};

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

class Mesh {
  constructor(gl, geo, dynamic) {
    this.gl = gl;
    this.count = geo.count;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const usage = dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
    const mk = (loc, arr, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, usage);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return b;
    };
    this.buffers = {
      positions: mk(0, geo.positions, 3),
      normals: mk(1, geo.normals, 3),
      uvs: mk(2, geo.uvs, 2),
      colors: mk(3, geo.colors, 3),
    };
    gl.bindVertexArray(null);
  }
  /** Update any subset of {positions, normals, uvs, colors} (same vertex count). */
  update(geo) {
    const gl = this.gl;
    for (const k of Object.keys(this.buffers)) {
      if (geo[k]) { gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[k]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, geo[k]); }
    }
  }
  dispose() {
    const gl = this.gl;
    Object.values(this.buffers).forEach((b) => gl.deleteBuffer(b));
    gl.deleteVertexArray(this.vao);
  }
}

/**
 * Per-instance data for drawInstanced: 12 floats each
 * [x, y, z, scale, rotY, shade, swayPhase, heightScale, rotX, rotZ, stretchX, stretchZ].
 * A negative heightScale flips the mesh vertically (handy for wing flaps).
 */
const INST_STRIDE = 12;
class InstanceBuffer {
  constructor(gl, max) {
    this.gl = gl; this.max = max; this.count = 0;
    this.data = new Float32Array(max * INST_STRIDE);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
  }
  /** rotX / rotZ tilt the instance around its pivot (before rotY). On billboards rotZ spins the sprite. */
  set(i, x, y, z, scale = 1, rotY = 0, shade = 1, phase = 0, heightScale = 1, rotX = 0, rotZ = 0) {
    const d = this.data, o = i * INST_STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = scale;
    d[o + 4] = rotY; d[o + 5] = shade; d[o + 6] = phase; d[o + 7] = heightScale;
    d[o + 8] = rotX; d[o + 9] = rotZ;
  }
  /** Change only the tilt of instance i (after set()). */
  tilt(i, rotX = 0, rotZ = 0) { const o = i * INST_STRIDE; this.data[o + 8] = rotX; this.data[o + 9] = rotZ; }
  /**
   * Kit v5: stretch instance i along its local X and Z (after set(); Y is heightScale).
   * Applied before tilt / rotY, so a box instance becomes any w x h x d block.
   * Billboards use sx as a width multiplier. Values persist until changed: call
   * stretch(i) (= 1, 1) when you reuse a slot for an unstretched instance.
   */
  stretch(i, sx = 1, sz = 1) { const o = i * INST_STRIDE; this.data[o + 10] = sx; this.data[o + 11] = sz; }
  /** Upload the first `count` instances (call after set()). */
  upload(count = this.count) {
    this.count = Math.min(count, this.max);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * INST_STRIDE);
  }
  dispose() { this.gl.deleteBuffer(this.buffer); }
}

const IDENTITY = mat4.create();
const WHITE = [1, 1, 1];
const BLACK = [0, 0, 0];
const NO_FADE = [0, 0];
const NO_WAVE = [0, 0.15, 1];

export class PS1Renderer {
  /**
   * Renders into an OffscreenCanvas it owns. Frames leave via takeFrame() (after present())
   * and go to a Sink (js/show/output.js). The output size comes from setOutputSize().
   */
  constructor() {
    const canvas = this.canvas = new OffscreenCanvas(1, 1);
    this.out = { w: 1, h: 1, dpr: 1 };   // current sink size: CSS px + its devicePixelRatio
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this._initGL();
    this.lost = false;   // WebGL context lost (driver reset): draws are no-ops until restore()
    this.quality = 1;    // governor: 0..1 detail scale (kit particles read it)

    // Global look parameters (set from settings / audio every frame).
    this.params = {
      resolution: '320x240', aspectMode: 'fit',
      jitter: 1, affine: 1, dither: 1, colorBits: 5, crt: false,
      jitterBoost: 0,   // added by audio (beats)
      fogScale: 1,      // multiplies fog distances (audio level)
      flash: 0,         // show control: 0..1 flash toward flashColor (composite pass)
      flashColor: [1, 1, 1],
      fade: 0,          // show control: 0..1 fade to black (blackout)
      maxDpr: 0,        // governor: cap on devicePixelRatio for the backbuffer (0 = none)
    };
    this.width = 0; this.height = 0;
    this.targets = {};
    this.view = mat4.create();
    this.proj = mat4.create();
    this.fogColor = [0, 0, 0];
    this.stats = { draws: 0, tris: 0 };
    this.resize();
  }

  /** Programs + built-in textures. Run at start and again after a lost context is restored. */
  _initGL() {
    const gl = this.gl;
    this.world = program(gl, WORLD_VS, WORLD_FS);
    this.comp = program(gl, FULLSCREEN_VS, COMPOSITE_FS);
    this.present_ = program(gl, FULLSCREEN_VS, PRESENT_FS);
    this.emptyVao = gl.createVertexArray();
    this.whiteTex = this.createTexture({ data: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 });
    this.defaultClut = this.createClutTexture(); // grey ramp, used if a scene sets no palette
    this.updateClut(this.defaultClut, Float32Array.from({ length: 48 }, (_, i) => Math.floor(i / 3) / 15));
  }

  /** Rebuild what the renderer owns after webglcontextrestored (the style manager rebuilds styles). */
  restore() {
    this.targets = {}; this.width = 0; this.height = 0;
    this._initGL();
    this.lost = false;
    this.resize();
  }

  // ---------- resources ----------
  createMesh(geo, dynamic = false) { return new Mesh(this.gl, geo, dynamic); }

  createTexture({ data, width, height }, { repeat = true } = {}) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    t._w = width; t._h = height;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }

  /** Indexed texture: one byte per pixel = palette slot (0-15, 255 = transparent). */
  createIndexedTexture({ data, width, height }) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    t._w = width; t._h = height;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    t.indexed = true;
    return t;
  }

  /** Make a texture from generator output (indexed or RGBA). */
  texture(gen) { return gen.indexed ? this.createIndexedTexture(gen) : this.createTexture(gen); }

  /**
   * Re-upload a texture in place from generator output ({data, width, height, indexed}):
   * animated screens, a surface that changes with the swell. Same size = texSubImage2D.
   * rows = [y0, y1) uploads only that band of rows.
   */
  updateTexture(tex, gen, rows = null) {
    const gl = this.gl, { data, width, height } = gen, idx = !!gen.indexed, fmt = idx ? gl.RED : gl.RGBA, bpp = idx ? 1 : 4;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (idx) gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (tex._w === width && tex._h === height) {
      const y0 = rows ? rows[0] : 0, y1 = rows ? rows[1] : height;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, width, y1 - y0, fmt, gl.UNSIGNED_BYTE, data.subarray(y0 * width * bpp, y1 * width * bpp));
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, idx ? gl.R8 : gl.RGBA8, width, height, 0, fmt, gl.UNSIGNED_BYTE, data);
      tex._w = width; tex._h = height;
    }
    if (idx) gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    tex.indexed = idx;
  }

  createClutTexture() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 16, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** colors: Float32Array(48) rgb 0..1 */
  updateClut(tex, colors) {
    const gl = this.gl, px = this._clutBytes || (this._clutBytes = new Uint8Array(64));
    for (let i = 0; i < 16; i++) {
      px[i * 4] = Math.round(colors[i * 3] * 255);
      px[i * 4 + 1] = Math.round(colors[i * 3 + 1] * 255);
      px[i * 4 + 2] = Math.round(colors[i * 3 + 2] * 255);
      px[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }

  /** Bind a LivePalette for the following draws (call after beginScene). */
  setPalette(live) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, live ? live.tex : this.defaultClut);
    gl.activeTexture(gl.TEXTURE0);
  }

  deleteTexture(t) { if (t) this.gl.deleteTexture(t); }

  _makeTarget(w, h, depth) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (depth) {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, rb };
  }

  _freeTargets() {
    const gl = this.gl;
    for (const t of Object.values(this.targets)) {
      gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); if (t.rb) gl.deleteRenderbuffer(t.rb);
    }
    this.targets = {};
  }

  /** The current sink's size: CSS pixels and its devicePixelRatio. Call resize() after. */
  setOutputSize(cssW, cssH, dpr) {
    this.out.w = cssW; this.out.h = cssH; this.out.dpr = dpr || 1;
  }

  /** Call on window resize and whenever resolution settings change. */
  resize() {
    const dpr = Math.min(this.out.dpr || 1, this.params.maxDpr || Infinity);
    const cw = Math.max(1, Math.round(this.out.w * dpr));
    const ch = Math.max(1, Math.round(this.out.h * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    let res = RESOLUTIONS[this.params.resolution];
    if (res === undefined) res = RESOLUTIONS['320x240'];
    if (res === null) res = [Math.max(160, Math.round((240 * cw / ch) / 2) * 2), 240];
    if (res[0] !== this.width || res[1] !== this.height) {
      this._freeTargets();
      this.width = res[0]; this.height = res[1];
      this.targets.A = this._makeTarget(this.width, this.height, true);
      this.targets.B = this._makeTarget(this.width, this.height, true);
      this.targets.C = this._makeTarget(this.width, this.height, false);
    }
  }

  get aspect() { return this.width / this.height; }

  // ---------- scene drawing API (used by styles) ----------
  beginScene(which = 'A') {
    const gl = this.gl, u = this.world.u, P = this.params;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[which].fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.world.p);
    const snap = Math.max(0, P.jitter + P.jitterBoost);
    gl.uniform1f(u.uSnapOn, snap > 0.05 ? 1 : 0);
    gl.uniform2f(u.uSnapGrid, this.width * 0.5 / Math.max(snap, 0.05), this.height * 0.5 / Math.max(snap, 0.05));
    gl.uniform1f(u.uAffine, P.affine);
    gl.uniform1i(u.uTex, 0);
    gl.uniform1i(u.uClut, 1);
    gl.uniform1i(u.uTex2, 2);
    gl.uniform1f(u.uTime, P.time || 0);
    gl.uniform2f(u.uMirror, 0, 0);
    this.mirrorY = null;
    this.setPalette(null);
    this.setLight([0.3, -0.8, -0.5], [0.9, 0.9, 0.9], [0.25, 0.25, 0.3]);
    this.setPointLights(null);
    this.setFog([0, 0, 0], 10, 60);
  }

  clear(color) {
    const gl = this.gl;
    gl.clearColor(color[0], color[1], color[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /** eye/target as [x,y,z]; fov in degrees. */
  setCamera(eye, target, { fov = 60, near = 0.1, far = 200, roll = 0 } = {}) {
    mat4.lookAt(this.view, eye, target, roll);
    mat4.perspective(this.proj, fov * Math.PI / 180, this.aspect, near, far);
    const gl = this.gl, u = this.world.u;
    gl.uniformMatrix4fv(u.uView, false, this.view);
    gl.uniformMatrix4fv(u.uProj, false, this.proj);
  }

  setFog(color, near, far) {
    const gl = this.gl, u = this.world.u, s = this.params.fogScale;
    this.fogColor = color;
    gl.uniform3fv(u.uFogColor, color);
    gl.uniform2f(u.uFog, near * s, far * s);
  }

  /**
   * Planar reflection: until setMirror(null), everything drawn is reflected in
   * the horizontal plane y (only geometry above the plane shows). Recipe:
   *   r.setMirror(W); sky + world; r.setMirror(null); r.clearDepth();
   *   r.setClipBelow(W); sky + world; r.setClipBelow(null);
   *   water surface at W with { opacity } on top (see js/styles/kit-calm.js).
   */
  setMirror(y) {
    this.mirrorY = y ?? null;
    this.gl.uniform2f(this.world.u.uMirror, y == null ? 0 : 1, y ?? 0);
  }

  /** Until setClipBelow(null), discard everything below the plane y (the normal pass over a reflection). */
  setClipBelow(y) { this.gl.uniform2f(this.world.u.uMirror, y == null ? 0 : 2, y ?? 0); }

  /** Clear only the depth buffer (between a reflection pass and the normal pass). */
  clearDepth() { const gl = this.gl; gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); }

  /**
   * Extra vertex-snap wobble for the rest of this style's render (0 = none, 1 = about double
   * the base snap). beginScene() resets it, so a style owns it for its own frame only and
   * the show-control beat wobble (params.jitterBoost) is left alone.
   */
  setJitterBoost(extra = 0) {
    const gl = this.gl, u = this.world.u, P = this.params;
    const snap = Math.max(0, P.jitter + P.jitterBoost + extra * Math.max(1, P.jitter));
    gl.uniform1f(u.uSnapOn, snap > 0.05 ? 1 : 0);
    gl.uniform2f(u.uSnapGrid, this.width * 0.5 / Math.max(snap, 0.05), this.height * 0.5 / Math.max(snap, 0.05));
  }

  /** dir = direction the light travels. */
  setLight(dir, color, ambient) {
    const gl = this.gl, u = this.world.u;
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    gl.uniform3f(u.uLightDir, dir[0] / l, dir[1] / l, dir[2] / l);
    gl.uniform3fv(u.uLightColor, color);
    gl.uniform3fv(u.uAmbient, ambient);
  }

  /**
   * Kit v6: up to 4 point lights for the rest of this scene, lit per vertex (subdivide big floors so the
   * pool is smooth). list = [{ pos: [x, y, z], color: [r, g, b] (may exceed 1), radius }], or null / [] = off.
   * beginScene() turns them off, so they never leak into another style. Unlit draws ignore them.
   */
  setPointLights(list) {
    const gl = this.gl, u = this.world.u, n = Math.min(4, list?.length || 0);
    const P = this._plPos || (this._plPos = new Float32Array(16)), C = this._plCol || (this._plCol = new Float32Array(12));
    for (let i = 0; i < n; i++) {
      const l = list[i];
      P[i * 4] = l.pos[0]; P[i * 4 + 1] = l.pos[1]; P[i * 4 + 2] = l.pos[2]; P[i * 4 + 3] = Math.max(0.01, l.radius);
      C[i * 3] = l.color[0]; C[i * 3 + 1] = l.color[1]; C[i * 3 + 2] = l.color[2];
    }
    if (n) { gl.uniform4fv(u['uPL[0]'], P); gl.uniform3fv(u['uPLc[0]'], C); }
    gl.uniform1i(u.uPLn, n);
  }

  /**
   * Draw a mesh. Options:
   *  texture, tint [r,g,b], emissive [r,g,b], uvOffset [u,v], uvScale [u,v],
   *  unlit (bool), fog (bool, default true), additive (bool), depthWrite (bool),
   *  texture2 + blend (0..1): dither-crossfade to a second texture of the same kind and size,
   *  fade [near, far]: fade out with camera distance into the fog colour (to black when additive),
   *    even with fog: false. Use it for lights that shine through fog, so nothing pops at the edge.
   *  opacity (0..1): screen-door transparency with the ordered-dither pattern (mist cards, water
   *    over a reflection, fading things in/out without alpha blending).
   *  wave [amp, freq = 0.15, speed = 1]: world-space vertical wave applied on the GPU. It is the
   *    same field for every draw given the same values, so ground and the things standing on it
   *    move together (melting / rolling peaks). CPU height for placing things: waveAt(x, z, wave, time).
   *  twoSided (bool): light whichever face is towards the camera (flat paper cards, leaves).
   */
  draw(mesh, model = IDENTITY, o = {}) {
    this._begin(model, o, 0);
    this.gl.bindVertexArray(mesh.vao);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, mesh.count);
    this._end(o);
    this.stats.draws++; this.stats.tris += mesh.count / 3;
  }

  /**
   * Draw many copies of a mesh in one call. inst = r.createInstances(max).
   * Extra options: billboard (0 off, 1 upright, 2 face camera), sway (bend amount).
   */
  drawInstanced(mesh, inst, o = {}) {
    const n = Math.min(inst.count, inst.max);
    if (n <= 0) return;
    const gl = this.gl;
    this._begin(o.model || IDENTITY, o, 1);
    gl.bindVertexArray(mesh.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffer);
    const st = INST_STRIDE * 4;
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, st, 0); gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.FLOAT, false, st, 16); gl.vertexAttribDivisor(5, 1);
    gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 4, gl.FLOAT, false, st, 32); gl.vertexAttribDivisor(6, 1);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, n);
    gl.disableVertexAttribArray(4); gl.disableVertexAttribArray(5); gl.disableVertexAttribArray(6);
    this._end(o);
    this.stats.draws++; this.stats.tris += (mesh.count / 3) * n;
  }

  createInstances(max) { return new InstanceBuffer(this.gl, max); }

  _begin(model, o, instanced) {
    const gl = this.gl, u = this.world.u;
    gl.uniformMatrix4fv(u.uModel, false, model);
    gl.bindTexture(gl.TEXTURE_2D, o.texture || this.whiteTex);
    gl.uniform1f(u.uIndexed, o.texture?.indexed ? 1 : 0);
    gl.uniform3fv(u.uTint, o.tint || WHITE);
    gl.uniform3fv(u.uEmissive, o.emissive || BLACK);
    const off = o.uvOffset || [0, 0], sc = o.uvScale || [1, 1];
    gl.uniform2f(u.uUVOffset, off[0], off[1]);
    gl.uniform2f(u.uUVScale, sc[0], sc[1]);
    gl.uniform1f(u.uUnlit, o.unlit ? 1 : 0);
    gl.uniform1f(u.uFogOn, o.fog === false ? 0 : 1);
    gl.uniform1f(u.uInstanced, instanced);
    gl.uniform1f(u.uBillboard, o.billboard || 0);
    gl.uniform1f(u.uSway, o.sway || 0);
    const fade = o.fade || NO_FADE;
    gl.uniform2f(u.uFade, fade[0], fade[1]);
    const blend = o.texture2 ? Math.max(0, Math.min(1, o.blend ?? 0)) : 0;
    gl.uniform1f(u.uBlend, blend);
    gl.uniform1f(u.uOpacity, o.opacity ?? 1);
    const wv = o.wave || NO_WAVE;
    gl.uniform4f(u.uWave, wv[0] || 0, wv[1] ?? 0.15, wv[2] ?? 1, 0);
    gl.uniform1f(u.uTwoSided, o.twoSided ? 1 : 0);
    if (blend > 0) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, o.texture2); gl.activeTexture(gl.TEXTURE0); }
    // additive (PS1 "semi-transparency" B+F) fades to black in fog, not to the fog colour
    if (o.additive) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.uniform3fv(u.uFogColor, BLACK); }
    gl.depthMask(o.depthWrite !== false && !o.additive);
  }

  _end(o) {
    const gl = this.gl;
    if (o.additive) { gl.disable(gl.BLEND); gl.uniform3fv(this.world.u.uFogColor, this.fogColor); }
    gl.depthMask(true);
  }

  // ---------- post ----------
  /** Combine A and B (pixel dissolve by mix), dither + quantise into C. */
  composite(mix = 0) {
    const gl = this.gl, u = this.comp.u, P = this.params;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.C.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.comp.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.targets.A.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.targets.B.tex);
    gl.uniform1i(u.uA, 0); gl.uniform1i(u.uB, 1);
    gl.uniform1f(u.uMix, mix);
    gl.uniform1f(u.uLevels, Math.pow(2, P.colorBits) - 1);
    gl.uniform1f(u.uDither, P.dither);
    gl.uniform1f(u.uSeed, 0);
    gl.uniform1f(u.uFlash, P.flash);
    gl.uniform3fv(u.uFlashColor, P.flashColor);
    gl.uniform1f(u.uFade, P.fade);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Nearest-neighbour upscale of C to the canvas. */
  present() {
    const gl = this.gl, u = this.present_.u, P = this.params;
    const cw = this.canvas.width, ch = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let vw = cw, vh = ch;
    if (P.aspectMode !== 'stretch') {
      const s = Math.min(cw / this.width, ch / this.height);
      vw = Math.round(this.width * s); vh = Math.round(this.height * s);
    }
    this.shown = [Math.floor((cw - vw) / 2), Math.floor((ch - vh) / 2), vw, vh];
    gl.viewport(...this.shown);
    gl.useProgram(this.present_.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.targets.C.tex);
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uRes, this.width, this.height);
    gl.uniform1f(u.uCrt, P.crt ? 1 : 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Copy the frame just presented into a 2D canvas (thumbnails). Must be called in
   * the same task as present(), before takeFrame() and before anything else draws.
   */
  snapshot(ctx) {
    const [x, y, w, h] = this.shown || [0, 0, this.canvas.width, this.canvas.height];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.canvas, x, this.canvas.height - y - h, w, h, 0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  /**
   * The frame just presented, for a Sink. Call after present() / snapshot(); never while lost.
   * Returns null in the gap between a context loss and its (async) webglcontextlost event,
   * where transferToImageBitmap would throw.
   */
  takeFrame() { return this.gl.isContextLost() ? null : this.canvas.transferToImageBitmap(); }

  resetStats() { this.stats.draws = 0; this.stats.tris = 0; }
}

/** CPU copy of the draw option `wave` (see PS1Renderer.draw): world-space y offset at (x, z). */
export function waveAt(x, z, wave, time) {
  if (!wave || !wave[0]) return 0;
  const f = wave[1] ?? 0.15, wt = time * (wave[2] ?? 1);
  return wave[0] * (Math.sin(x * f + wt) * Math.cos(z * f * 0.83 - wt * 0.71) + 0.5 * Math.sin((x + z) * f * 0.47 + wt * 1.3));
}
