// Kit v3: tileable indexed surface textures (64x64 unless noted), as K.tex.*.
// Each returns a generator for r.texture(...). Ramps follow the palette roles:
// 0 base, 1 secondary, 2 accent, 3 atmosphere.
//
//   this.stone = r.texture(K.tex.mossStone({ seed: 2 }));
//   this.water = r.texture(K.tex.water());
import { R } from '../palette/palette.js';
import { CLEAR, bayer, rnd, blobNoise as blobN, makeIndexed as make, dshade } from './pixel.js';

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
