// Procedural low-res textures (64x64 by default), returned as RGBA byte arrays.
// Colours are hex strings so they can come straight from a style's palette.
// Each texture gets a little hashed grain so it reads as "hand-drawn VRAM art".
import { hex255 } from './color.js';

const rnd = (x, y, s = 0) => {
  const h = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453;
  return h - Math.floor(h);
};

function make(w, h, fn) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a = 255] = fn(x, y);
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }
  return { data, width: w, height: h };
}

const grain = (c, x, y, amt, seed = 0) => {
  const n = (rnd(x, y, seed) - 0.5) * amt;
  return [c[0] + n, c[1] + n, c[2] + n].map((v) => Math.max(0, Math.min(255, Math.round(v))));
};

export function bricks({ a = '#7a3b2e', b = '#5e2c22', mortar = '#1c0f0c', size = 64, rows = 8, cols = 4, noise = 30 } = {}) {
  const A = hex255(a), B = hex255(b), M = hex255(mortar);
  const bh = size / rows, bw = size / cols;
  return make(size, size, (x, y) => {
    const row = Math.floor(y / bh);
    const off = (row % 2) * bw / 2;
    const col = Math.floor((x + off) / bw);
    const lx = (x + off) % bw, ly = y % bh;
    if (lx < 1 || ly < 1) return grain(M, x, y, noise * 0.5);
    const base = rnd(col, row, 3) > 0.5 ? A : B;
    const edge = (lx < 2 || ly < 2) ? 1.15 : 1;
    return grain(base.map((v) => v * edge), x, y, noise);
  });
}

export function checker({ a = '#e0e0e0', b = '#303040', size = 64, cells = 8, noise = 18 } = {}) {
  const A = hex255(a), B = hex255(b), cs = size / cells;
  return make(size, size, (x, y) => grain(((Math.floor(x / cs) + Math.floor(y / cs)) % 2) ? A : B, x, y, noise));
}

export function grid({ bg = '#101820', line = '#40e0d0', size = 64, cells = 4, thick = 2, noise = 14 } = {}) {
  const BG = hex255(bg), L = hex255(line), cs = size / cells;
  return make(size, size, (x, y) => {
    const on = (x % cs) < thick || (y % cs) < thick;
    const glow = (x % cs) < thick + 1 || (y % cs) < thick + 1;
    if (on) return grain(L, x, y, noise);
    if (glow) return grain(BG.map((v, i) => (v + L[i]) / 3), x, y, noise);
    return grain(BG, x, y, noise);
  });
}

export function stripes({ a = '#ffffff', b = '#000000', size = 64, count = 8, noise = 12 } = {}) {
  const A = hex255(a), B = hex255(b), s = size / count;
  return make(size, size, (x, y) => grain(Math.floor(y / s) % 2 ? A : B, x, y, noise));
}

/** Blocky value noise: good for stone, metal and organic surfaces. */
export function blotch({ a = '#7a7f88', b = '#3a3d44', size = 64, scale = 8, noise = 26, seed = 1 } = {}) {
  const A = hex255(a), B = hex255(b);
  return make(size, size, (x, y) => {
    const v = rnd(Math.floor(x / scale), Math.floor(y / scale), seed) * 0.6 + rnd(Math.floor(x / (scale / 2)), Math.floor(y / (scale / 2)), seed + 1) * 0.4;
    const t = v > 0.55 ? 1 : v > 0.35 ? 0.5 : 0;
    return grain(A.map((c, i) => c * t + B[i] * (1 - t)), x, y, noise, seed);
  });
}

/** Stone with carved glyph lines (white mask channel used for emissive glyphs). */
export function glyphStone({ stone = '#6c707a', dark = '#2c2f36', glyph = '#ffd27a', size = 64, seed = 4 } = {}) {
  const S = hex255(stone), D = hex255(dark), G = hex255(glyph);
  return make(size, size, (x, y) => {
    const cx = Math.floor(x / 8), cy = Math.floor(y / 8), lx = x % 8, ly = y % 8;
    const r = rnd(cx, cy, seed);
    const carved = (r > 0.55 && (lx === 3 || lx === 4) && ly > 0 && ly < 7) || (r > 0.75 && (ly === 3 || ly === 4) && lx > 0 && lx < 7) || (r < 0.15 && lx > 1 && lx < 6 && ly > 1 && ly < 6 && (lx === 2 || lx === 5 || ly === 2 || ly === 5));
    if (carved) return grain(G, x, y, 20, seed);
    const v = rnd(Math.floor(x / 4), Math.floor(y / 4), seed + 2);
    return grain(v > 0.6 ? S : S.map((c, i) => (c + D[i]) / 2), x, y, 30, seed);
  });
}

/** Sun disc with horizontal cut-out bands (alpha), square texture. */
export function bandedSun({ top = '#ffe066', bottom = '#ff3d7f', size = 64 } = {}) {
  const T = hex255(top), B = hex255(bottom);
  return make(size, size, (x, y) => {
    const t = y / (size - 1);
    const c = T.map((v, i) => Math.round(v * (1 - t) + B[i] * t));
    // gaps get wider towards the bottom
    const band = y > size * 0.5 && (y % 8) < Math.floor((t - 0.5) * 10);
    return [...c, band ? 0 : 255];
  });
}

/** Tiny 16x16 sparkle star with alpha. */
export function sparkle({ color = '#ffffff', size = 16 } = {}) {
  const C = hex255(color), m = (size - 1) / 2;
  return make(size, size, (x, y) => {
    const dx = Math.abs(x - m), dy = Math.abs(y - m);
    const on = (dx < 1 && dy < m) || (dy < 1 && dx < m) || dx + dy < m * 0.6;
    return [...C, on ? 255 : 0];
  });
}

export function solid(color = '#ffffff', size = 8) {
  const C = hex255(color);
  return make(size, size, () => C);
}
