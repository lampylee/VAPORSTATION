// Kit v3: tileable indexed surface textures (64x64 unless noted), as K.tex.*.
// Each returns a generator for r.texture(...). Ramps follow the palette roles:
// 0 base, 1 secondary, 2 accent, 3 atmosphere.
//
//   this.stone = r.texture(K.tex.mossStone({ seed: 2 }));
//   this.water = r.texture(K.tex.water());
import { R } from '../palette/palette.js';
import { CLEAR, bayer, rnd, blobNoise as blobN, tileBlob, makeIndexed as make, dshade } from './pixel.js';

const TAU = Math.PI * 2;
/** Per-pixel shade jitter of ±amt around a base index (stays in its ramp). */
const grain = (idx, x, y, amt, s) => {
  const ramp = idx >> 2, sh = idx & 3;
  return dshade(ramp, sh + (rnd(x, y, s) - 0.5) * amt * 2 + 0.5, x, y);
};

// ---------------------------------------------------------------- promoted from Lost Valley

/** Cut stone blocks with mortar, overgrown with moss (ramp 1) creeping down from the top. */
export function mossStone({ seed = 1, rows = 4, carve = false } = {}) {
  const rh = 64 / rows;
  return make(64, 64, (x, y) => {
    const row = Math.floor(y / rh), off = row % 2 ? 8 : 0, bx = Math.floor((x + off) / 16);
    const lx = (x + off) % 16, ly = y % rh;
    const moss = blobN(x, y, 10, seed) + (1 - y / 64) * 0.35;
    if (moss > 0.92) return dshade(1, 0.8 + (moss - 0.92) * 14 + rnd(x, y, seed) * 0.6, x, y);
    if (lx === 0 || ly === 0) return moss > 0.7 ? R(1, 0) : R(0, 0);
    if (carve && rnd(bx, row, seed + 3) > 0.6 && lx > 3 && lx < 13 && ly > 3 && ly < rh - 3 && ((lx === 4 || lx === 12 || ly === 4 || ly === rh - 4) || (lx === 8 && ly > 5)))
      return R(0, 0);
    return grain(R(0, rnd(bx, row, seed) > 0.55 ? 2 : 1), x, y, 0.3, seed);
  });
}

/** Raw cliff rock with mossy ledges. */
export function cliffRock({ seed = 7 } = {}) {
  return make(64, 64, (x, y) => {
    const ledge = (y + Math.floor(rnd(x >> 3, 0, seed) * 6)) % 16;
    if (ledge < 2) return dshade(1, 1.2 + rnd(x, y, seed), x, y);
    const v = blobN(x, y, 6, seed) * 0.7 + rnd(x >> 1, y >> 1, seed) * 0.3;
    return dshade(0, 0.6 + v * 2.2 - ledge / 32, x, y);
  });
}

/** Forest / jungle floor: secondary ramp with patches of stone or earth. */
export function jungleFloor({ seed = 3 } = {}) {
  return make(64, 64, (x, y) => {
    const v = blobN(x, y, 12, seed);
    if (v > 0.78) return grain(R(0, rnd(x >> 2, y >> 2, seed) > 0.5 ? 1 : 2), x, y, 0.3, seed);
    return dshade(1, 0.7 + blobN(x, y, 5, seed + 1) * 1.6 + rnd(x, y, seed) * 0.4, x, y);
  });
}

/** Falling water streaks, 16x64, tiles vertically. Scroll it with draw { uvOffset: [0, -t] }. */
export function waterfall({ ramp = 3, foam = 1 } = {}) {
  return make(16, 64, (x, y) => {
    const ph = Math.floor(rnd(x, 0, 2) * 64), len = 6 + Math.floor(rnd(x, 1, 2) * 18);
    const sy = (y + ph) % 64;
    if (sy < len) return sy < 2 ? R(ramp, 3) : R(ramp, rnd(x, 3, 2) > 0.4 ? 3 : 2);
    const r = rnd(x, y >> 3, 4);
    return r > 0.8 ? R(foam, 3) : r > 0.55 ? R(foam, 2) : R(ramp, 2);
  });
}

// ---------------------------------------------------------------- promoted from Drowned Ruins

/**
 * Caustic network flipbook: n tileable frames of interference lines, CLEAR
 * elsewhere. Use K.Caustics to cycle and draw them; this is the raw frames.
 */
export function caustics({ frames = 8, ramp = 3 } = {}) {
  const out = [];
  for (let f = 0; f < frames; f++) {
    const ph = (f / frames) * TAU;
    out.push(make(64, 64, (x, y) => {
      const u = (x / 64) * TAU, v = (y / 64) * TAU;
      const a = Math.sin(2 * u + 1.4 * Math.sin(3 * v + ph));
      const b = Math.sin(2 * v + 1.4 * Math.sin(3 * u - ph));
      const c = Math.sin(2 * (u + v) + Math.sin(u - 2 * v + ph * 2));
      const w = Math.abs(a + b + c) / 3;
      if (w < 0.07) return R(ramp, 3);
      if (w < 0.15 + bayer(x, y) * 0.06) return R(ramp, 2);
      return CLEAR;
    }));
  }
  return out;
}

// ---------------------------------------------------------------- Kit v3: calm-scene surfaces

/**
 * Still water: long horizontal ripple lines on a dark base, tileable. Draw it
 * flat over a reflection with { opacity: 0.6 } and scroll uvOffset slowly.
 */
export function water({ ramp = 3, seed = 4 } = {}) {
  return make(64, 64, (x, y) => {
    const wob = Math.sin((x / 64) * TAU * 2 + rnd(0, y >> 2, seed) * TAU) * 1.5;
    const line = (y + wob + 64) % 8;
    const glint = blobN(x, y, 16, seed) > 0.62 && line < 1;
    if (glint) return R(ramp, 3);
    if (line < 1.2 && rnd(x >> 3, y, seed) > 0.35) return R(ramp, 2);
    return dshade(ramp, 0.4 + blobN(x, y, 20, seed + 1) * 0.9, x, y);
  });
}

/** Lily pad decal (flat, top view) with a notch, CLEAR outside. 32x32. */
export function lilyPad({ ramp = 1, flower = 2, seed = 5 } = {}) {
  return make(32, 32, (x, y) => {
    const dx = x - 15.5, dy = y - 15.5, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (d > 14 + Math.sin(a * 7 + seed) * 0.8 || (a > -0.35 && a < 0.05 && d > 2)) return CLEAR;
    if (rnd(seed, 0, 1) > 0.5 && d < 3.5) return R(flower, d < 1.8 ? 3 : 2);
    const vein = Math.abs(Math.sin(a * 6)) < 0.12 && d > 3;
    return dshade(ramp, vein ? 2.6 : 1.1 + (1 - d / 14) * 1.2 + (dx + dy < 0 ? 0.3 : 0), x, y);
  });
}

/** Sand / pale ground with dithered ripples (beaches, deserts at dusk). */
export function sand({ ramp = 0, seed = 2 } = {}) {
  return make(64, 64, (x, y) => {
    const rip = Math.sin((y + blobN(x, y, 14, seed) * 10) * 0.8) * 0.5 + 0.5;
    return dshade(ramp, 1.5 + rip * 1.1 + (rnd(x, y, seed) - 0.5) * 0.5, x, y);
  });
}

/** Paper / screen panel: pale fill with a thin lattice (lanterns, sliding screens). 32x32. */
export function paper({ ramp = 2, frame = R(0, 0), cells = 2 } = {}) {
  const c = 32 / cells;
  return make(32, 32, (x, y) => {
    if (x % c === 0 || y % c === 0 || x === 31 || y === 31) return frame;
    return dshade(ramp, 2.3 + blobN(x, y, 6, 3) * 0.8, x, y);
  });
}

/** Weathered wooden boards (docks, bridges, cabins), horizontal grain. */
export function boards({ ramp = 0, seed = 6 } = {}) {
  return make(64, 64, (x, y) => {
    const row = y >> 4, ly = y & 15, off = Math.floor(rnd(row, 0, seed) * 64);
    if (ly === 0 || (x + off) % 64 === 0) return R(ramp, 0);
    const g = Math.sin((x + off) * 0.35 + Math.sin(y * 0.9 + row) * 2) * 0.5 + 0.5;
    return dshade(ramp, 1.2 + g * 0.9 + rnd(row, 1, seed) * 0.6 - ly / 40, x, y);
  });
}

/** Soft cloud layer seen from above or below (sea of clouds), tileable. */
export function cloudLayer({ ramp = 3, seed = 8 } = {}) {
  return make(64, 64, (x, y) => {
    const v = blobN(x, y, 16, seed) * 0.65 + blobN(x, y, 7, seed + 1) * 0.35;
    if (v < 0.42) return CLEAR;
    return dshade(ramp, 1.2 + (v - 0.42) * 4.5, x, y);
  });
}

// ---------------------------------------------------------------- Kit v4 (wave 4b)

/**
 * Cracked cells (salt crust, dried mud, hex tiles, crazed glaze): an offset lattice of
 * jittered points, so the cells come out roughly hexagonal, with dark cracks and a
 * raised rim lit on one side. Tileable. cells = cells per side (4 → 16 px cells);
 * jitter in px; rim = rim highlight index (null = no rim); patches = flat blotch index (null = none).
 */
export function cracks({ ramp = 0, cells = 4, jitter = 5, seed = 3, crack = R(ramp, 1), fill = R(ramp, 3), rim = R(ramp, 2), patches = R(ramp, 2), patchAmount = 0.34 } = {}) {
  const N = cells, S = 64 / N, pts = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    pts.push([i * S + (j & 1) * S / 2 + (rnd(i, j, seed) - 0.5) * jitter, j * S + (rnd(i, j, seed + 2) - 0.5) * jitter]);
  }
  return make(64, 64, (x, y) => {
    let d1 = 1e9, d2 = 1e9, nx = 0, ny = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) for (const p of pts) {
      const px = p[0] + ox * 64, py = p[1] + oy * 64, d = Math.hypot(x - px, y - py);
      if (d < d1) { d2 = d1; d1 = d; nx = x - px; ny = y - py; } else if (d < d2) d2 = d;
    }
    const e = d2 - d1;                                    // ~distance to the cell edge
    if (e < 0.7) return crack;
    if (rim != null && e < 1.8) return nx + ny > 0 ? crack : rim;
    // cell interior: flat patches, no fine dither (it shimmers into noise at a distance)
    return patches != null && tileBlob(x, y, 8, seed + 1) > 1 - patchAmount ? patches : fill;
  });
}

// ---------------------------------------------------------------- Kit v6 (Ember Vigil): dark fantasy stone + glass

/**
 * Worn flagstone floor: irregular slabs in running rows, dark grout, chipped corners, a few
 * hairline cracks, centres polished lighter by footsteps. Tileable 64x64.
 */
export function flagstones({ ramp = 0, seed = 5 } = {}) {
  const ROWS = [[16, 24, 24], [32, 16, 16], [24, 24, 16], [16, 16, 32]];
  const slabAt = (x, y) => {
    const row = Math.floor(y / 16), ws = ROWS[row], off = (row * 11) % 64, xx = (x + off) % 64;
    let x0 = 0, i = 0;
    while (xx >= x0 + ws[i]) { x0 += ws[i]; i++; }
    return { row, i, lx: xx - x0, ly: y - row * 16, w: ws[i] };
  };
  return make(64, 64, (x, y) => {
    const s = slabAt(x, y), id = s.row * 4 + s.i;
    const ex = Math.min(s.lx, s.w - 1 - s.lx), ey = Math.min(s.ly, 15 - s.ly), edge = Math.min(ex, ey);
    if (edge < 1) return R(ramp, 0);                                         // grout
    if (ex < 3 && ey < 3 && ex + ey < 3 + rnd(id, 1, seed) * 2) return R(ramp, 0);   // chipped corner
    // hairline crack through some slabs
    if (rnd(id, 2, seed) > 0.6) {
      const k = (rnd(id, 3, seed) - 0.5) * 1.6, c = s.w * rnd(id, 4, seed);
      if (Math.abs(s.lx - (c + (s.ly - 8) * k) + Math.sin(s.ly * 1.3 + id) * 0.8) < 0.55) return R(ramp, 0);
    }
    const base = 1.05 + rnd(id, 5, seed) * 0.75;                             // each slab its own stone
    const worn = Math.min(1, edge / 6) * 0.45;                               // polished centre, darker rim
    const grit = (rnd(x, y, seed) - 0.5) * 0.28 + (tileBlob(x, y, 8, seed + id) - 0.5) * 0.45;
    return dshade(ramp, base + worn + grit, x, y);
  });
}

/**
 * Cut ashlar blocks (cathedral walls, piers): running bond, mortar, chisel speckle and soot
 * blackening in blotches. Tileable 64x64. soot 0..1.
 */
export function ashlar({ ramp = 0, seed = 9, rows = 4, soot = 0.5 } = {}) {
  const rh = 64 / rows;
  return make(64, 64, (x, y) => {
    const row = Math.floor(y / rh), off = row % 2 ? 16 : 0, bx = Math.floor(((x + off) % 64) / 32);
    const lx = (x + off) % 32, ly = y % rh;
    if (ly === 0 || lx === 0) return R(ramp, 0);
    const bevel = (ly === 1 || lx === 1) ? 0.45 : (ly === rh - 1 || lx === 31) ? -0.35 : 0;
    const sooty = tileBlob(x, y, 16, seed) * soot * 1.4;
    const v = 1.4 + rnd(bx, row, seed) * 0.6 + bevel - sooty + (rnd(x, y, seed + 1) - 0.5) * 0.55;
    return dshade(ramp, v, x, y);
  });
}

/**
 * Leaded glass: irregular panes in accent / atmosphere / secondary shades, lead cames and
 * broken holes transparent (CLEAR). Draw additive and unlit for backlit windows. 32x32.
 */
export function stainedGlass({ seed = 3, holes = 0.12, ramps = [2, 3, 1, 2] } = {}) {
  const N = 4, S = 32 / N, pts = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push([i * S + rnd(i, j, seed) * S, j * S + rnd(i, j, seed + 1) * S, i + j * N]);
  return make(32, 32, (x, y) => {
    let d1 = 1e9, d2 = 1e9, id = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) for (const p of pts) {
      const d = Math.hypot(x - p[0] - ox * 32, y - p[1] - oy * 32);
      if (d < d1) { d2 = d1; d1 = d; id = p[2]; } else if (d < d2) d2 = d;
    }
    if (d2 - d1 < 1.1) return CLEAR;                       // lead came: see-through dark line when additive
    if (rnd(id, 7, seed) < holes) return CLEAR;            // pane knocked out
    const ramp = ramps[Math.floor(rnd(id, 8, seed) * ramps.length)];
    return dshade(ramp, 1.2 + rnd(id, 9, seed) * 1.2 + Math.max(0, 0.9 - d1 / S) * 0.8, x, y);
  });
}

/**
 * Plate armour: horizontal lames with a lit upper edge and shadowed lower edge, rivets,
 * scratches and rust (secondary ramp) creeping in. 32x32; base ramp = the steel.
 */
export function plateArmor({ ramp = 0, rust = 1, seed = 11 } = {}) {
  // two broad plates per tile: a bright rolled edge, a smooth curved face (light from above, a
  // soft sheen band), a shadowed overlap. No per-pixel noise, so it reads as metal, not stone.
  return make(32, 32, (x, y) => {
    const ly = y % 16;
    if (ly === 15) return R(ramp, 0);
    if (ly === 14) return dshade(ramp, 0.9, x, y);
    if ((x % 10 === 4) && ly === 3) return R(ramp, 3);                                       // rivet
    const r = tileBlob(x * 2, y * 2, 16, seed) + rnd(x >> 1, y >> 1, seed) * 0.12;
    if (r > 0.9) return dshade(rust, 0.9 + (r - 0.9) * 10, x, y);                            // rust bloom
    if (Math.abs(x - y * 0.6 - 7) < 0.5 && ly > 4 && ly < 12) return R(ramp, 3);            // one long scratch
    const v = ly < 2 ? 3 : 2.5 - (ly / 14) * 1.6 + Math.exp(-((ly - 5) ** 2) / 4) * 0.5;
    return dshade(ramp, v, x, y);
  });
}

/**
 * Worn cloth for capes and drapes, 32x64 (u across, v down): vertical folds, a faded border,
 * moth holes and a ragged, transparent hem at the bottom.
 */
export function wornCloth({ ramp = 3, trim = R(1, 1), seed = 13 } = {}) {
  const hem = Array.from({ length: 32 }, (_, x) => 52 + Math.floor(rnd(x, 1, seed) * 11));
  return make(32, 64, (x, y) => {
    if (y > hem[x]) return CLEAR;
    if (y > 14 && rnd(x >> 1, y >> 1, seed + 4) > 0.955) return CLEAR;
    if (y < 3) return trim;
    const fold = Math.sin(x / 32 * Math.PI * 6 + Math.sin(y * 0.05) * 0.8) * 0.55;
    return dshade(ramp, 0.75 + fold + (rnd(x, y, seed) - 0.5) * 0.4 - (y > hem[x] - 5 ? 0.35 : 0), x, y);
  });
}
