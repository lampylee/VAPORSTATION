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

// ---- Kit v3 additions: calm / slow-song sprites ----

/** Weeping willow: rounded crown with long hanging fronds. 48x64. Sway it gently. */
export function willow({ ramp = 1, trunk = R(0, 0), seed = 14 } = {}) {
  const W = 48, H = 64, cx = 24;
  return make(W, H, (x, y) => {
    if (y > 50 && Math.abs(x - cx + 0.5) < 2) return trunk;
    const dx = x - cx, crown = Math.hypot(dx, (y - 16) * 1.4) < 15;
    // fronds: thin vertical strands hanging from the crown edge, longer at the sides
    const strand = (x * 7 + Math.floor(rnd(x, 0, seed) * 5)) % 3 === 0;
    const reach = 18 + Math.abs(dx) * 1.3 + rnd(x, 1, seed) * 10;
    if (!crown && !(strand && y > 10 && y < reach && Math.abs(dx) < 21)) return CLEAR;
    const light = 2.4 - (dx + 10) / 30 - y / 64;
    return dshade(ramp, light + (rnd(x >> 1, y >> 2, seed) - 0.5) * 0.7, x, y);
  });
}

/** Blossom tree: dark branches, a cloud of accent-ramp blossom. 48x64. */
export function blossomTree({ ramp = 2, trunk = R(0, 0), seed = 15 } = {}) {
  const W = 48, H = 64, cx = 24;
  const puffs = Array.from({ length: 7 }, (_, i) => [8 + rnd(i, 0, seed) * 32, 10 + rnd(i, 1, seed) * 22, 7 + rnd(i, 2, seed) * 5]);
  return make(W, H, (x, y) => {
    let best = 0;
    for (const [bx, by, br] of puffs) best = Math.max(best, 1 - Math.hypot(x - bx, (y - by) * 1.1) / br);
    if (best > 0 && !(best < 0.25 && rnd(x, y, seed) > 0.6)) return dshade(ramp, 1.4 + best * 1.6 + (x < cx ? 0.3 : -0.2), x, y);
    // trunk and two forks
    const t = (y - 36) / 28;
    if (y > 36 && Math.abs(x - cx - Math.sin(t * 2) * 2) < 2.4 - t) return trunk;
    if (y > 24 && y <= 40 && (Math.abs(x - cx + (40 - y) * 0.7) < 1.2 || Math.abs(x - cx - (40 - y) * 0.6) < 1.2)) return trunk;
    return CLEAR;
  });
}

/** Reeds and cattails at the water's edge. 32x32. */
export function reeds({ ramp = 1, head = R(0, 1), seed = 16 } = {}) {
  return make(32, 32, (x, y) => {
    for (let i = 0; i < 9; i++) {
      const bx = 2 + i * 3.4 + rnd(i, 0, seed) * 2, top = 4 + rnd(i, 1, seed) * 14, lean = (rnd(i, 2, seed) - 0.5) * 0.25;
      const sx = bx + (31 - y) * lean;
      if (y >= top && Math.abs(x - sx) < 0.6) return dshade(ramp, 1.2 + (31 - y) / 20 + (i % 2) * 0.4, x, y);
      if (i % 3 === 0 && y >= top - 5 && y < top && Math.abs(x - sx) < 1.2) return head;
    }
    return CLEAR;
  });
}

/** Paper lantern: glowing body with dark caps and ribs. 16x24. Draw unlit; add a glow sprite behind it. */
export function lantern({ ramp = 2, frame = R(0, 0) } = {}) {
  return make(16, 24, (x, y) => {
    if (y < 3 || y > 20) return Math.abs(x - 7.5) < 3 ? frame : CLEAR;
    const t = (y - 3) / 17, half = 3 + Math.sin(t * Math.PI) * 4.5;
    const dx = Math.abs(x - 7.5);
    if (dx > half) return CLEAR;
    if ((y - 3) % 4 === 0) return dshade(ramp, 1.2, x, y);        // ribs
    return dshade(ramp, 3.3 - dx / half * 1.3 - Math.abs(t - 0.45) * 0.8, x, y);
  });
}

/** Falling petal: small curled ellipse, two shades. 8x8. Use with the 'petals' particle preset. */
export function petal({ ramp = 2 } = {}) {
  return make(8, 8, (x, y) => {
    const d = Math.hypot((x - 3.5) / 3.6, (y - 3.5) / 2.2);
    if (d > 1) return CLEAR;
    return R(ramp, x + y < 7 ? 3 : 2);
  });
}

/** Falling leaf with a midrib. 8x8, secondary ramp by default. */
export function leaf({ ramp = 1 } = {}) {
  return make(8, 8, (x, y) => {
    const u = x - 3.5, v = y - 3.5, d = Math.abs(u - v) / 1.6 + Math.abs(u + v) / 5.5;
    if (d > 1) return CLEAR;
    return Math.abs(u - v) < 0.6 ? R(ramp, 1) : R(ramp, u + v < 0 ? 3 : 2);
  });
}

/**
 * Low mist bank: a wide, soft-edged band (dithered top and sides). 64x16.
 * Draw large, upright billboards near the ground with { opacity } and slow drift.
 */
export function mistBank({ ramp = 3, seed = 17 } = {}) {
  return make(64, 16, (x, y) => {
    const edge = Math.min(x, 63 - x) / 12, top = (y - 2 - Math.sin(x * 0.2 + seed) * 2 - rnd(x >> 3, 0, seed) * 3) / 8;
    const v = Math.min(1, edge) * Math.min(1, top);
    if (v <= 0 || v < bayer(x, y) * 0.9) return CLEAR;
    return dshade(ramp, 2 + v * 0.9, x, y);
  });
}

/** Four-point twinkle star (night skies, sparkles on water). 8x8. */
export function twinkle({ index = R(3, 3) } = {}) {
  return make(8, 8, (x, y) => {
    const dx = Math.abs(x - 3.5), dy = Math.abs(y - 3.5);
    return (dx < 0.6 && dy < 3.6) || (dy < 0.6 && dx < 3.6) || (dx < 1.1 && dy < 1.1) ? index : CLEAR;
  });
}
