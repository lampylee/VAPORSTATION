// Indexed sprite textures with 1-bit transparency (index 255), PS1 foliage-style.
// Shade comes from a fake top-left light with ordered dither between shades.
// Draw them on a billboard quad: r.drawInstanced(quadMesh, inst, { texture, billboard: 1 }).
import { R } from '../palette/palette.js';
import { CLEAR } from '../gfx/textures.js';

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
const rnd = (x, y, s = 0) => { const h = Math.sin(x * 12.9898 + y * 78.233 + s * 37.7) * 43758.5453; return h - Math.floor(h); };

function make(w, h, fn) {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { data, width: w, height: h, indexed: true };
}

/** Continuous shade 0..3 -> dithered integer shade, as an index in `ramp`. */
const dshade = (ramp, s, x, y) => {
  s = Math.max(0, Math.min(3, s));
  const f = Math.floor(s);
  return R(ramp, Math.min(3, f + (s - f > bayer(x, y) ? 1 : 0)));
};

/** Conifer: stacked tiers + trunk. 32x64. */
export function pine({ ramp = 1, trunk = R(0, 0), tiers = 4, seed = 1 } = {}) {
  const W = 32, H = 64;
  return make(W, H, (x, y) => {
    const cx = W / 2 - 0.5;
    if (y > H - 9) return Math.abs(x - cx) < 2 ? trunk : CLEAR;
    const tierH = (H - 8) / tiers;
    const tier = Math.floor(y / tierH), ty = (y % tierH) / tierH;
    const halfW = (2 + (tier + ty) / tiers * (W / 2 - 3)) * (0.9 + 0.2 * rnd(tier, 0, seed));
    const dx = x - cx;
    if (Math.abs(dx) > halfW || (Math.abs(dx) > halfW - 2 && rnd(x, y, seed) > 0.6)) return CLEAR;
    return dshade(ramp, 2.2 - dx / halfW * 1.1 - ty * 0.8, x, y);
  });
}

/** Round broadleaf tree: lumpy canopy + trunk. 48x64. */
export function broadleaf({ ramp = 1, trunk = R(0, 0), seed = 2 } = {}) {
  const W = 48, H = 64, cx = W / 2, cy = 24;
  return make(W, H, (x, y) => {
    if (y > 40) return Math.abs(x - cx + 0.5) < 2.5 - (y > 58 ? -1 : 0) ? trunk : CLEAR;
    const a = Math.atan2(y - cy, x - cx), r = 20 * (0.8 + 0.2 * Math.sin(a * 5 + seed) + 0.08 * rnd(Math.floor(a * 4), 0, seed));
    const d = Math.hypot(x - cx, (y - cy) * 1.15);
    if (d > r) return CLEAR;
    const light = 1 - Math.hypot(x - cx + 8, y - cy + 8) / 34;
    return dshade(ramp, light * 3.4 + (rnd(x >> 2, y >> 2, seed) - 0.5) * 0.8, x, y);
  });
}

/** Leafless, crooked tree: horror / winter. 48x64. */
export function deadTree({ index = R(0, 0), seed = 3 } = {}) {
  const W = 48, H = 64, segs = [];
  const branch = (x, y, ang, len, depth) => {
    const x2 = x + Math.cos(ang) * len, y2 = y - Math.sin(ang) * len;
    segs.push([x, y, x2, y2, Math.max(0.6, depth * 0.9)]);
    if (depth <= 0) return;
    branch(x2, y2, ang + 0.5 + rnd(depth, len, seed) * 0.3, len * 0.7, depth - 1);
    branch(x2, y2, ang - 0.4 - rnd(len, depth, seed) * 0.4, len * 0.65, depth - 1);
  };
  branch(W / 2, H - 1, Math.PI / 2 + 0.05, 20, 4);
  return make(W, H, (x, y) => {
    for (const [ax, ay, bx, by, w] of segs) {
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < w) return index;
    }
    return CLEAR;
  });
}

/** Bush blob. 32x24. */
export function bush({ ramp = 1, seed = 4 } = {}) {
  const W = 32, H = 24;
  return make(W, H, (x, y) => {
    const d = Math.hypot((x - W / 2) / 15, (y - H) / 20) + (rnd(x >> 1, y >> 1, seed) - 0.5) * 0.15;
    if (d > 1) return CLEAR;
    return dshade(ramp, 3 - d * 1.5 - y / H * 1.2 + (x < W / 2 ? 0.4 : 0), x, y);
  });
}

/** Grass tuft. 16x16. */
export function grass({ ramp = 1, seed = 5 } = {}) {
  return make(16, 16, (x, y) => {
    for (let b = 0; b < 5; b++) {
      const bx = 2 + b * 3 + (rnd(b, 0, seed) - 0.5) * 2, lean = (rnd(b, 1, seed) - 0.5) * 0.6, h = 8 + rnd(b, 2, seed) * 8;
      if (16 - y < h && Math.abs(x - (bx + lean * (16 - y))) < 0.8) return dshade(ramp, 1 + (16 - y) / h * 2, x, y);
    }
    return CLEAR;
  });
}

/** Flame / torch. 16x32, uses the accent ramp. */
export function flame({ ramp = 2 } = {}) {
  return make(16, 32, (x, y) => {
    const t = y / 31, w = Math.sin(t * Math.PI) * 7 * (0.4 + t * 0.6);
    const dx = Math.abs(x - 7.5);
    if (dx > w) return CLEAR;
    return dshade(ramp, 3.4 - dx / Math.max(w, 0.1) * 2 - (1 - t) * 1.2, x, y);
  });
}

/** Soft-looking (dithered) glow diamond for lamps, sparks. 16x16. */
export function glow({ ramp = 2 } = {}) {
  return make(16, 16, (x, y) => {
    const d = (Math.abs(x - 7.5) + Math.abs(y - 7.5)) / 8;
    if (d > 1 || d > 0.55 + bayer(x, y) * 0.45) return CLEAR;
    return dshade(ramp, 3.5 - d * 3, x, y);
  });
}

/** Cloud puff. 64x32, atmosphere ramp by default. */
export function cloud({ ramp = 3, seed = 6 } = {}) {
  const blobs = Array.from({ length: 6 }, (_, i) => [10 + i * 9 + rnd(i, 0, seed) * 6, 18 - rnd(i, 1, seed) * 8, 7 + rnd(i, 2, seed) * 6]);
  return make(64, 32, (x, y) => {
    let best = 0;
    for (const [bx, by, br] of blobs) best = Math.max(best, 1 - Math.hypot(x - bx, (y - by) * 1.3) / br);
    if (best <= 0 || y > 26) return CLEAR;
    return dshade(ramp, 1.6 + best * 1.6 - y / 32, x, y);
  });
}

/** Round particle dot. 8x8, single index. */
export function dot({ index = R(3, 3) } = {}) {
  return make(8, 8, (x, y) => (Math.hypot(x - 3.5, y - 3.5) < 3.6 ? index : CLEAR));
}

/** Vertical streak for rain. 2x16. */
export function streak({ index = R(3, 3) } = {}) {
  return make(2, 16, (x, y) => (x === 0 && y % 16 < 15 ? index : CLEAR));
}

/** Chain-link fence: diamond mesh with see-through holes. 32x32. */
export function chainLink({ index = R(0, 2), dark = R(0, 1) } = {}) {
  return make(32, 32, (x, y) => {
    const a = (x + y) % 8, b = (x - y + 64) % 8;
    if (a === 0 || b === 0) return (x + y) % 16 < 8 ? index : dark;
    return CLEAR;
  });
}
