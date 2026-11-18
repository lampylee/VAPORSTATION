// Minimal column-major mat4 helpers (gl-matrix conventions) + scalar utils.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
/** Frame-rate independent exponential approach. tau in seconds. */
export const damp = (cur, target, tau, dt) => tau <= 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau));
/** Deterministic hash -> [0,1). */
export const hash = (x, y = 0, z = 0) => {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return h - Math.floor(h);
};

export const mat4 = {
  create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },

  identity(out) { out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; return out; },

  multiply(out, a, b) {
    const r = _tmp;
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      for (let i = 0; i < 4; i++) r[c * 4 + i] = a[i] * b0 + a[4 + i] * b1 + a[8 + i] * b2 + a[12 + i] * b3;
    }
    out.set(r);
    return out;
  },

  translate(out, a, x, y, z) {
    if (out !== a) out.set(a);
    out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
    out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
    out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
    out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    return out;
  },

  scale(out, a, x, y, z) {
    if (out !== a) out.set(a);
    for (let i = 0; i < 4; i++) { out[i] *= x; out[4 + i] *= y; out[8 + i] *= z; }
    return out;
  },

  rotateX(out, a, rad) {
    const s = Math.sin(rad), c = Math.cos(rad);
    if (out !== a) out.set(a);
    for (let i = 0; i < 4; i++) {
      const a1 = a[4 + i], a2 = a[8 + i];
      out[4 + i] = a1 * c + a2 * s;
      out[8 + i] = a2 * c - a1 * s;
    }
    return out;
  },

  rotateY(out, a, rad) {
    const s = Math.sin(rad), c = Math.cos(rad);
    if (out !== a) out.set(a);
    for (let i = 0; i < 4; i++) {
      const a0 = a[i], a2 = a[8 + i];
      out[i] = a0 * c - a2 * s;
      out[8 + i] = a0 * s + a2 * c;
    }
    return out;
  },

  rotateZ(out, a, rad) {
    const s = Math.sin(rad), c = Math.cos(rad);
    if (out !== a) out.set(a);
    for (let i = 0; i < 4; i++) {
      const a0 = a[i], a1 = a[4 + i];
      out[i] = a0 * c + a1 * s;
      out[4 + i] = a1 * c - a0 * s;
    }
    return out;
  },

  /** out = T * Ry * Rx * Rz * S */
  trs(out, tx, ty, tz, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    mat4.identity(out);
    mat4.translate(out, out, tx, ty, tz);
    if (ry) mat4.rotateY(out, out, ry);
    if (rx) mat4.rotateX(out, out, rx);
    if (rz) mat4.rotateZ(out, out, rz);
    if (sx !== 1 || sy !== 1 || sz !== 1) mat4.scale(out, out, sx, sy, sz);
    return out;
  },

  perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect; out[5] = f;
    out[10] = (far + near) * nf; out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  },

  /** View matrix looking from eye to target, with optional roll (radians). */
  lookAt(out, eye, target, roll = 0, up = [0, 1, 0]) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    if (roll) {
      mat4.identity(_roll); mat4.rotateZ(_roll, _roll, roll);
      mat4.multiply(out, _roll, out);
    }
    return out;
  },
};

const _tmp = new Float32Array(16);
const _roll = new Float32Array(16);
