// Palette model — PS1-style CLUT of 16 colours.
//
//   index = ramp * 4 + shade        (shade 0 = darkest, 3 = lightest)
//   ramp 0 BASE        main surfaces
//   ramp 1 SECONDARY   second material / detail
//   ramp 2 ACCENT      glows, lights, flashes
//   ramp 3 ATMOSPHERE  fog / sky (shade 1 is the fog colour by default)
//
// Roles name the colours code reads directly (fog, light, ...) as palette indices,
// so editing a swatch updates every role that points at it.
//
// A palette is plain JSON: { id, name, colors: ['#rrggbb' x16], roles: {...} }
import { smoothstep } from '../gfx/math.js';

export const R = (ramp, shade) => ramp * 4 + shade;
export const RAMP_NAMES = ['Base', 'Secondary', 'Accent', 'Atmosphere'];
export const ROLE_NAMES = ['fog', 'ambient', 'light', 'glow', 'flash'];
export const DEFAULT_ROLES = { fog: R(3, 1), ambient: R(3, 2), light: R(3, 3), glow: R(2, 2), flash: R(2, 3) };

// ---------- colour utils ----------
export const hexToRgb = (h) => {
  let s = String(h).replace('#', '').trim();
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const rgbToHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
export const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const sat = (c) => Math.max(...c) - Math.min(...c);

/** 4-shade ramp around a key colour. anchor = which shade the key becomes. */
export function rampFrom(key, anchor = 2) {
  const c = hexToRgb(key);
  const toward = (t) => c.map((v) => v + (1 - v) * t);
  const scale = (t) => c.map((v) => v * t);
  const shades = anchor === 1
    ? [scale(0.55), c, toward(0.25), toward(0.6)]
    : [scale(0.22), scale(0.5), c, toward(0.45)];
  return shades.map(rgbToHex);
}

/** Build a palette from 4 key colours: [base, secondary, accent, atmosphere(fog)]. */
export function fromKeys(id, name, keys, roles = {}) {
  const colors = [...rampFrom(keys[0]), ...rampFrom(keys[1]), ...rampFrom(keys[2]), ...rampFrom(keys[3], 1)];
  return { id, name, colors, roles: { ...DEFAULT_ROLES, ...roles }, keys: [...keys] };
}

export function clonePalette(p) {
  return { id: p.id, name: p.name, colors: [...p.colors], roles: { ...DEFAULT_ROLES, ...p.roles }, ...(p.keys ? { keys: [...p.keys] } : {}) };
}

export function isValidPalette(p) {
  return p && typeof p.name === 'string' && Array.isArray(p.colors) && p.colors.length === 16 && p.colors.every((c) => /^#?[0-9a-f]{6}$/i.test(c));
}

// ---------- building a palette from arbitrary colours (images, Lospec, .hex) ----------
function kmeans(points, weights, k, iters = 14) {
  // deterministic farthest-point seeding, starting from the heaviest point
  let first = 0;
  for (let i = 1; i < points.length; i++) if (weights[i] > weights[first]) first = i;
  const cents = [points[first].slice()];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  while (cents.length < k) {
    let best = -1, bi = 0;
    for (let i = 0; i < points.length; i++) {
      const d = Math.min(...cents.map((c) => d2(points[i], c))) * Math.sqrt(weights[i]);
      if (d > best) { best = d; bi = i; }
    }
    cents.push(points[bi].slice());
  }
  const assign = new Int32Array(points.length);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < points.length; i++) {
      let bd = Infinity;
      for (let c = 0; c < k; c++) { const d = d2(points[i], cents[c]); if (d < bd) { bd = d; assign[i] = c; } }
    }
    const sum = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      const s = sum[assign[i]], w = weights[i];
      s[0] += points[i][0] * w; s[1] += points[i][1] * w; s[2] += points[i][2] * w; s[3] += w;
    }
    sum.forEach((s, c) => { if (s[3] > 0) cents[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const groups = cents.map((c) => ({ center: c, points: [], weights: [], weight: 0 }));
  for (let i = 0; i < points.length; i++) {
    const g = groups[assign[i]];
    g.points.push(points[i]); g.weights.push(weights[i]); g.weight += weights[i];
  }
  return groups.filter((g) => g.points.length > 0);
}

/** Merge identical colours into weighted unique points. */
function uniquePoints(colors) {
  const map = new Map();
  for (const c of colors) {
    const q = c.map((v) => Math.round(v * 31) / 31); // 15-bit, like the PS1
    const key = q.join(',');
    const e = map.get(key);
    if (e) e.w++; else map.set(key, { p: q, w: 1 });
  }
  const arr = [...map.values()];
  return { points: arr.map((e) => e.p), weights: arr.map((e) => e.w) };
}

/**
 * Turn any list of colours (album-art pixels, a Lospec palette...) into a
 * 4-ramp palette: cluster into 4 groups, darkest -> atmosphere, most vivid ->
 * accent, biggest -> base, remaining -> secondary; then 4 shades per group.
 */
export function buildFromColors(colors, name = 'Imported') {
  const { points, weights } = uniquePoints(colors);
  if (!points.length) return fromKeys(newId(), name, ['#808080', '#404040', '#ffffff', '#101010']);
  let groups = kmeans(points, weights, Math.min(4, points.length));
  // too few distinct colours: pad with variations of the existing ones
  while (groups.length < 4) {
    const src = groups[groups.length % groups.length];
    const c = src.center.map((v, i) => Math.min(1, v * (0.6 + 0.3 * i)));
    groups.push({ center: c, points: [c], weights: [1], weight: 0.001 });
  }
  const pick = (score) => { let bi = 0; groups.forEach((g, i) => { if (score(g) > score(groups[bi])) bi = i; }); return groups.splice(bi, 1)[0]; };
  const atmosphere = pick((g) => -luma(g.center) + 0.0001 * g.weight);
  const accent = pick((g) => sat(g.center) * 0.7 + luma(g.center) * 0.3);
  const base = pick((g) => g.weight);
  const secondary = groups[0];

  const shadesOf = (g, anchor) => {
    const uniq = g.points.length;
    if (uniq >= 4) {
      const sub = kmeans(g.points, g.weights, 4).map((s) => s.center).sort((a, b) => luma(a) - luma(b));
      if (sub.length === 4) return sub.map(rgbToHex);
    }
    return rampFrom(rgbToHex(g.center), anchor);
  };
  const colorsOut = [...shadesOf(base, 2), ...shadesOf(secondary, 2), ...shadesOf(accent, 2), ...shadesOf(atmosphere, 1)];
  return { id: newId(), name, colors: colorsOut, roles: { ...DEFAULT_ROLES } };
}

/** Sample an image (File/Blob/URL) and build a palette from it. */
export async function paletteFromImage(src, name) {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = url;
    });
    const size = 96;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);
    const px = ctx.getImageData(0, 0, size, size).data;
    const colors = [];
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) colors.push([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255]);
    return buildFromColors(colors, name);
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

/**
 * Parse pasted/loaded palette text:
 *  - our own JSON export (kept exactly)
 *  - Lospec JSON ({ name, colors: ['ff0000', ...] })
 *  - GIMP .gpl ("R G B name" lines)
 *  - .hex / any text with hex codes
 */
export function parsePaletteText(text, fallbackName = 'Imported') {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    const j = JSON.parse(t);
    const obj = Array.isArray(j) ? { colors: j } : j;
    const cols = (obj.colors || []).map((c) => (String(c).startsWith('#') ? c : '#' + c));
    if (obj.roles && cols.length === 16) {
      const p = clonePalette({ ...obj, colors: cols, id: newId(), name: obj.name || fallbackName });
      if (!isValidPalette(p)) throw new Error('Palette JSON has invalid colours.');
      return p;
    }
    if (!cols.length) throw new Error('No colours found in JSON.');
    return buildFromColors(cols.map(hexToRgb), obj.name || fallbackName);
  }
  if (/^GIMP Palette/i.test(t)) {
    const cols = [];
    for (const line of t.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
      if (m) cols.push([m[1] / 255, m[2] / 255, m[3] / 255]);
    }
    const nm = t.match(/^Name:\s*(.+)$/m);
    if (!cols.length) throw new Error('No colours found in .gpl file.');
    return buildFromColors(cols, nm ? nm[1].trim() : fallbackName);
  }
  const hexes = [...t.matchAll(/#?\b([0-9a-f]{6})\b/gi)].map((m) => hexToRgb(m[1]));
  if (!hexes.length) throw new Error('No hex colours found.');
  return buildFromColors(hexes, fallbackName);
}

export function newId() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ---------- live, crossfading palette bound to the GPU ----------
export class LivePalette {
  constructor(renderer, palette) {
    this.r = renderer;
    this.tex = renderer.createClutTexture();
    this.cur = new Float32Array(48);
    this.from = new Float32Array(48);
    this.to = new Float32Array(48);
    this.roleFrom = {}; this.roleTo = {}; this.roleCur = {};
    for (const k of ROLE_NAMES) { this.roleFrom[k] = [0, 0, 0]; this.roleTo[k] = [0, 0, 0]; this.roleCur[k] = [0, 0, 0]; }
    this.colorCache = Array.from({ length: 16 }, () => [0, 0, 0]);
    this.t = 1; this.dur = 0;
    this.palette = null;
    this.set(palette, 0);
  }

  /** Crossfade to a palette over `duration` seconds (0 = instant). */
  set(palette, duration = 0) {
    this.palette = palette;
    this.from.set(this.cur);
    palette.colors.forEach((h, i) => { const c = hexToRgb(h); this.to[i * 3] = c[0]; this.to[i * 3 + 1] = c[1]; this.to[i * 3 + 2] = c[2]; });
    for (const k of ROLE_NAMES) {
      this.roleFrom[k] = this.roleCur[k].slice();
      const idx = palette.roles?.[k] ?? DEFAULT_ROLES[k];
      this.roleTo[k] = [this.to[idx * 3], this.to[idx * 3 + 1], this.to[idx * 3 + 2]];
    }
    this.dur = duration;
    this.t = duration > 0 ? 0 : 1;
    this._apply(this.t);
  }

  update(dt) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / Math.max(0.01, this.dur));
    this._apply(smoothstep(this.t));
  }

  _apply(t) {
    for (let i = 0; i < 48; i++) this.cur[i] = this.from[i] + (this.to[i] - this.from[i]) * t;
    for (let i = 0; i < 16; i++) { const c = this.colorCache[i]; c[0] = this.cur[i * 3]; c[1] = this.cur[i * 3 + 1]; c[2] = this.cur[i * 3 + 2]; }
    for (const k of ROLE_NAMES) {
      const a = this.roleFrom[k], b = this.roleTo[k], o = this.roleCur[k];
      o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t;
    }
    this.r.updateClut(this.tex, this.cur);
  }

  /** Current (possibly mid-fade) colour of palette slot i, as [r,g,b]. Don't mutate. */
  color(i) { return this.colorCache[i]; }
  /** Current colour of a role ('fog', 'ambient', 'light', 'glow', 'flash'). Don't mutate. */
  role(name) { return this.roleCur[name]; }

  dispose() { this.r.deleteTexture(this.tex); }
}
