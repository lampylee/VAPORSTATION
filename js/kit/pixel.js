// Pixel helpers for writing indexed (palette-slot) texture generators.
// Every wave-1 environment re-implemented these; use them instead.
//
//   const tex = K.makeIndexed(32, 64, (x, y) => K.dshade(1, 2.2 - y / 32, x, y));
//   this.tex = r.texture(tex);
import { R } from '../palette/palette.js';
import { CLEAR } from '../gfx/textures.js';

export { CLEAR };

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** 4x4 ordered-dither threshold in (0, 1) for pixel (x, y). */
export const bayer = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

/** Cheap deterministic per-pixel hash in [0, 1). */
export const rnd = (x, y, s = 0) => { const h = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return h - Math.floor(h); };

/** Smooth value noise at cell size `sc` (for blotches, moss, rust patches). */
export function blobNoise(x, y, sc, s = 0) {
  const fx = x / sc, fy = y / sc, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
  const a = rnd(ix, iy, s), b = rnd(ix + 1, iy, s), c = rnd(ix, iy + 1, s), d = rnd(ix + 1, iy + 1, s);
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** Build an indexed texture generator: fn(x, y) returns a palette index (or CLEAR). */
export function makeIndexed(w, h, fn) {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { data, width: w, height: h, indexed: true };
}

/** Continuous shade 0..3 -> ordered-dithered integer shade in `ramp` (PS1 stand-in for gradients). */
export function dshade(ramp, s, x, y) {
  s = Math.max(0, Math.min(3, s));
  const f = Math.floor(s);
  return R(ramp, Math.min(3, f + (s - f > bayer(x, y) ? 1 : 0)));
}

/** Pick index a or b with an ordered dither: t = 0 all a, 1 all b. */
export const ditherPick = (a, b, t, x, y) => (t > bayer(x, y) ? b : a);

/**
 * Kit v4: blobNoise that tiles every `size` px (cell must divide size), so
 * 64 px textures have no seams when repeated (blobNoise leaves one at the wrap).
 */
export function tileBlob(x, y, cell, seed = 0, size = 64) {
  const n = Math.max(1, Math.round(size / cell)), fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
  const h = (i, j) => rnd(((i % n) + n) % n, ((j % n) + n) % n, seed);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
