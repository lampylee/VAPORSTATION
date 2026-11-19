// Indexed sprite textures with 1-bit transparency (index 255), PS1 foliage-style.
// Shade comes from a fake top-left light with ordered dither between shades.
// Draw them on a billboard quad: r.drawInstanced(quadMesh, inst, { texture, billboard: 1 }).
import { R } from '../palette/palette.js';
import { CLEAR } from '../gfx/textures.js';
import { bayer, makeIndexed as make, dshade } from './pixel.js';
import { fbm } from './noise.js';

// same hash the sprites have always used (keeps existing sprite shapes identical)
const rnd = (x, y, s = 0) => { const h = Math.sin(x * 12.9898 + y * 78.233 + s * 37.7) * 43758.5453; return h - Math.floor(h); };

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

// ---- Kit v2 additions (promoted from wave-1 environments) ----

/** Fern: arching fronds fanned out from the base. 32x24. */
export function fern({ ramp = 1, seed = 8 } = {}) {
  const W = 32, H = 24, fronds = [];
  for (let i = 0; i < 7; i++) {
    const ang = Math.PI * (0.14 + (i / 6) * 0.72) + (rnd(i, 0, seed) - 0.5) * 0.15, len = 12 + rnd(i, 1, seed) * 9;
    fronds.push([ang, len]);
  }
  return make(W, H, (x, y) => {
    for (const [ang, len] of fronds) {
      for (let s = 0; s <= 12; s++) {
        const t = s / 12, d = t * len;
        const px = W / 2 + Math.cos(ang) * d, py = H - 1 - Math.sin(ang) * d + t * t * len * 0.55; // droop
        const w = (1 - t) * 2.2 + 0.4;
        if (Math.abs(x - px) < w && Math.abs(y - py) < w * 0.7 && ((x + y) % 2 || w > 1.5)) return dshade(ramp, 0.8 + t * 1.8 + (Math.cos(ang) < 0 ? 0.4 : 0), x, y);
      }
    }
    return CLEAR;
  });
}

/** Kelp / tall weed frond: wavy stalk with alternating blades. 16x64. Sway it with `sway`. */
export function kelp({ ramp = 1, seed = 1 } = {}) {
  const r2 = (a, b) => rnd(a, b, seed + 11);
  const stalk = (y) => 7.5 + Math.sin((y / 63) * 7 + seed) * 2 * (1 - (y / 63) * 0.6);
  const blades = [];
  for (let y0 = 6 + seed % 3, i = 0; y0 < 58; y0 += 5 + r2(i, 0) * 2, i++) {
    const side = i % 2 ? 1 : -1, len = (5 + r2(i, 1) * 3) * (1 - (y0 / 63) * 0.35);
    const ax = stalk(y0), ay = y0, bx = Math.max(0.5, Math.min(15.5, ax + side * len * 0.8)), by = y0 - len * 0.75;
    blades.push([ax, ay, bx, by, 1.4 + r2(i, 2) * 0.8]);
  }
  return make(16, 64, (x, y) => {
    const t = y / 63; // 0 = top, 1 = root
    if (Math.abs(x - stalk(y)) < 0.8) return dshade(ramp, 1.4 + (1 - t) * 0.9, x, y);
    for (const [ax, ay, bx, by, w] of blades) {
      const dx = bx - ax, dy = by - ay, u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(x - ax - dx * u, y - ay - dy * u) < w * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.08))) return dshade(ramp, 2.9 - u * 0.9 - t * 0.7, x, y);
    }
    return CLEAR;
  });
}

/** Desert cactus: trunk + two arms with vertical ribs. 32x64. */
export function cactus({ ramp = 1, seed = 1 } = {}) {
  const segs = [ // capsules: [x0, y0, x1, y1, radius]
    [15.5, 63, 15.5, 6, 4],
    [15.5, 36, 7, 36, 2.6], [7, 36, 7, 18, 2.6],
    [15.5, 42, 24, 42, 2.4], [24, 42, 24, 27, 2.4],
  ];
  return make(32, 64, (x, y) => {
    let best = -1, dxs = 0, rad = 1;
    for (const [ax, ay, bx, by, r] of segs) {
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      const px = x - ax - dx * t, py = y - ay - dy * t, d = Math.hypot(px, py);
      if (d < r && (best < 0 || d / r < best)) { best = d / r; dxs = Math.abs(dy) > Math.abs(dx) ? px : py; rad = r; }
    }
    if (best < 0) return CLEAR;
    const rib = (Math.floor(dxs + rad + 0.5) % 2) === 0 ? -0.5 : 0;
    return dshade(ramp, 2.1 - (dxs / rad) * 1.1 + rib + (rnd(x, y, seed) - 0.5) * 0.4, x, y);
  });
}

/**
 * Tall light shaft / searchlight beam: bright core, dithered falloff to transparent,
 * brighter at the top. 16x64. Draw additive (billboard: 1, or on a tilted quad).
 */
export function lightShaft({ ramp = 3 } = {}) {
  return make(16, 64, (x, y) => {
    const t = y / 63, across = 1 - Math.abs(x - 7.5) / 8;
    const b = across * across * (1 - t * 0.75);
    if (b < 0.05 + bayer(x, y) * 0.22) return CLEAR;
    return dshade(ramp, 1 + b * 2.4, x, y);
  });
}

/**
 * Moon disc with darker maria and a dithered rim. 32x32. Pass to Sky as
 * `moonTexture` when the default accent glow reads wrong (it's pink in many palettes).
 */
export function moon({ ramp = 3, seed = 12 } = {}) {
  return make(32, 32, (x, y) => {
    const dx = x - 15.5, dy = y - 15.5, d = Math.hypot(dx, dy) / 15.5;
    if (d > 1) return CLEAR;
    const maria = fbm(x * 0.14, y * 0.14, { octaves: 3, seed });
    return dshade(ramp, 3.2 - d * d * 0.9 - (maria > 0.56 ? 0.9 : 0) + (dx + dy < 0 ? 0.15 : -0.2), x, y);
  });
}
