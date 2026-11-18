// Procedural low-res INDEXED textures (64x64 by default), like PS1 4-bit CLUT
// textures: each pixel stores a palette slot (0-15), 255 = transparent.
// Any palette can then recolour them. Use R(ramp, shade) for slots.
//
// "Grain" nudges pixels one shade up/down inside their ramp, so surfaces get
// hand-drawn texture without leaving the palette.
import { R } from '../palette/palette.js';

export const CLEAR = 255;

const rnd = (x, y, s = 0) => {
  const h = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453;
  return h - Math.floor(h);
};

function make(w, h, fn) {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { data, width: w, height: h, indexed: true };
}

/** Move an index up/down one shade within its ramp at random (amount = probability). */
export function grain(idx, x, y, amount = 0.15, seed = 0) {
  if (idx === CLEAR) return idx;
  const r = rnd(x, y, seed + 11);
  const ramp = idx >> 2, shade = idx & 3;
  if (r < amount / 2) return R(ramp, Math.max(0, shade - 1));
  if (r > 1 - amount / 2) return R(ramp, Math.min(3, shade + 1));
  return idx;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

export function bricks({ ramp = 0, mortar = R(3, 0), size = 64, rows = 8, cols = 4, noise = 0.18 } = {}) {
  const bh = size / rows, bw = size / cols;
  return make(size, size, (x, y) => {
    const row = Math.floor(y / bh), off = (row % 2) * bw / 2;
    const col = Math.floor((x + off) / bw);
    const lx = (x + off) % bw, ly = y % bh;
    if (lx < 1 || ly < 1) return mortar;
    if (lx < 2 || ly < 2) return R(ramp, 3); // lit edge
    return grain(R(ramp, rnd(col, row, 3) > 0.5 ? 2 : 1), x, y, noise);
  });
}

export function checker({ a = R(0, 3), b = R(0, 1), size = 64, cells = 8, noise = 0.12 } = {}) {
  const cs = size / cells;
  return make(size, size, (x, y) => grain(((Math.floor(x / cs) + Math.floor(y / cs)) % 2) ? a : b, x, y, noise));
}

export function grid({ bg = R(3, 0), line = R(1, 3), glow = R(1, 1), size = 64, cells = 4, thick = 2, noise = 0.1 } = {}) {
  const cs = size / cells;
  return make(size, size, (x, y) => {
    const mx = x % cs, my = y % cs;
    if (mx < thick || my < thick) return line;
    if (mx < thick + 1 || my < thick + 1) return glow;
    return grain(bg, x, y, noise);
  });
}

export function stripes({ a = R(2, 3), b = R(2, 1), size = 64, count = 8, noise = 0.1 } = {}) {
  const s = size / count;
  return make(size, size, (x, y) => grain(Math.floor(y / s) % 2 ? a : b, x, y, noise));
}

/** Blocky value noise across a ramp's shades — stone, metal, organic surfaces. */
export function blotch({ ramp = 0, size = 64, scale = 8, seed = 1, minShade = 0, noise = 0.12 } = {}) {
  return make(size, size, (x, y) => {
    const v = rnd(Math.floor(x / scale), Math.floor(y / scale), seed) * 0.6 + rnd(Math.floor(x / (scale / 2)), Math.floor(y / (scale / 2)), seed + 1) * 0.4;
    const shade = Math.max(minShade, v > 0.7 ? 3 : v > 0.5 ? 2 : v > 0.3 ? 1 : 0);
    return grain(R(ramp, shade), x, y, noise, seed);
  });
}

/** Stone with carved glyphs in another colour. */
export function glyphStone({ ramp = 0, glyph = R(2, 3), size = 64, seed = 4 } = {}) {
  return make(size, size, (x, y) => {
    const cx = Math.floor(x / 8), cy = Math.floor(y / 8), lx = x % 8, ly = y % 8;
    const r = rnd(cx, cy, seed);
    const carved = (r > 0.55 && (lx === 3 || lx === 4) && ly > 0 && ly < 7)
      || (r > 0.75 && (ly === 3 || ly === 4) && lx > 0 && lx < 7)
      || (r < 0.15 && lx > 1 && lx < 6 && ly > 1 && ly < 6 && (lx === 2 || lx === 5 || ly === 2 || ly === 5));
    if (carved) return glyph;
    const v = rnd(Math.floor(x / 4), Math.floor(y / 4), seed + 2);
    return grain(R(ramp, v > 0.6 ? 2 : 1), x, y, 0.25, seed);
  });
}

/** Disc texture: dithered gradient down a ramp, with cut-out bands in the lower half. */
export function bandedSun({ ramp = 2, size = 64 } = {}) {
  return make(size, size, (x, y) => {
    const t = y / (size - 1);
    if (y > size * 0.5 && (y % 8) < Math.floor((t - 0.5) * 10)) return CLEAR;
    const s = (1 - t) * 3; // 3 at top -> 0 at bottom
    const shade = Math.min(3, Math.floor(s) + (s - Math.floor(s) > bayer(x, y) ? 1 : 0));
    return R(ramp, shade);
  });
}

/** Tiny star / sparkle cut-out. */
export function sparkle({ index = R(2, 3), size = 16 } = {}) {
  const m = (size - 1) / 2;
  return make(size, size, (x, y) => {
    const dx = Math.abs(x - m), dy = Math.abs(y - m);
    return (dx < 1 && dy < m) || (dy < 1 && dx < m) || dx + dy < m * 0.6 ? index : CLEAR;
  });
}

export function solid(index = R(3, 3), size = 4) {
  return make(size, size, () => index);
}
