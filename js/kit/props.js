// Modular low-poly props. Each returns geometry (r.createMesh(geo)), with UVs
// sized so a 64x64 texture tiles at roughly 1 repeat per world unit (or as noted).
// Pivot is at the base centre unless noted. Combine with merge() for one draw call.
import { GeoBuilder, box, merge } from '../gfx/geometry.js';
import { CLEAR } from '../gfx/textures.js';
import { R } from '../palette/palette.js';
import { rotX, rotY, rotZ, transform, cloneGeo } from './shapes.js';

// rotate / transform a geometry in place (positions + normals)
export { rotX, rotY, rotZ, transform, cloneGeo };

/** N-sided prism (pillars, posts, tree trunks, barrels). Pivot at base. */
export function prism(sides = 6, radius = 0.5, height = 2, { cap = true, uvRepeat = [1, 1], taper = 1 } = {}) {
  const g = new GeoBuilder();
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const b0 = [Math.cos(a0) * radius, 0, Math.sin(a0) * radius], b1 = [Math.cos(a1) * radius, 0, Math.sin(a1) * radius];
    const t0 = [b0[0] * taper, height, b0[2] * taper], t1 = [b1[0] * taper, height, b1[2] * taper];
    const u0 = (i / sides) * uvRepeat[0], u1 = ((i + 1) / sides) * uvRepeat[0];
    g.quad(b1, b0, t0, t1, [u1, uvRepeat[1]], [u0, uvRepeat[1]], [u0, 0], [u1, 0]);
    if (cap) g.tri([0, height, 0], t1, t0, [0.5, 0.5], [0.5 + Math.cos(a1) / 2, 0.5 + Math.sin(a1) / 2], [0.5 + Math.cos(a0) / 2, 0.5 + Math.sin(a0) / 2], [0, 1, 0]);
  }
  return g.build();
}

/** Crate / block, pivot at base. */
export function crate(size = 1) {
  return shift(box(size, size, size), 0, size / 2, 0);
}

/** Wall slab: width along X, pivot at base. UVs repeat per world unit. */
export function wall(width = 4, height = 3, thick = 0.3) {
  return shift(box(width, height, thick, { uvRepeat: [width / 2, height / 2] }), 0, height / 2, 0);
}

/** Doorway / archway in the XY plane, pivot at base centre. */
export function arch(width = 3, height = 3.5, thick = 0.5, post = 0.5, segs = 6) {
  const parts = [
    { geo: shift(box(post, height, thick, { uvRepeat: [0.5, height / 2] }), -(width - post) / 2, height / 2, 0) },
    { geo: shift(box(post, height, thick, { uvRepeat: [0.5, height / 2] }), (width - post) / 2, height / 2, 0) },
  ];
  const r = (width - post) / 2;
  for (let i = 0; i < segs; i++) {
    const a = ((i + 0.5) / segs) * Math.PI, len = (Math.PI * r) / segs + 0.05;
    const x = Math.cos(a) * r, y = height + Math.sin(a) * r * 0.6;
    parts.push({ geo: rotZ(box(len, post, thick, { uvRepeat: [0.5, 0.5] }), a - Math.PI / 2), xf: (p) => [p[0] + x, p[1] + y, p[2]] });
  }
  return merge(parts);
}

/** Street lamp: pole + arm + head. Head (light position) at [armLen, height - 0.2, 0]. */
export function lampPost(height = 4.5, armLen = 0.9) {
  return merge([
    { geo: prism(6, 0.08, height, { uvRepeat: [1, height] }) },
    { geo: shift(box(armLen, 0.08, 0.08), armLen / 2, height - 0.04, 0) },
    { geo: shift(box(0.35, 0.18, 0.3), armLen, height - 0.2, 0) },
  ]);
}

/** Flat panel in the XY plane (fences, signs, banners). Use a texture with CLEAR holes for chain-link. */
export function panel(width = 4, height = 2, { uvRepeat = [width / 2, height / 2] } = {}) {
  const w = width / 2;
  return new GeoBuilder().quad([-w, 0, 0], [w, 0, 0], [w, height, 0], [-w, height, 0], [0, uvRepeat[1]], [uvRepeat[0], uvRepeat[1]], [uvRepeat[0], 0], [0, 0], [0, 0, 1]).build();
}

/** Fence run: panel + posts every `spacing` units. */
export function fence(length = 8, height = 2, spacing = 2) {
  const parts = [{ geo: panel(length, height) }];
  for (let x = -length / 2; x <= length / 2 + 1e-3; x += spacing) parts.push({ geo: prism(4, 0.06, height + 0.1), xf: (p) => [p[0] + x, p[1], p[2]] });
  return merge(parts);
}

/** Gravestone: slab with a rounded top. */
export function tombstone(width = 0.8, height = 1.1, thick = 0.18) {
  const parts = [{ geo: shift(box(width, height - width / 2, thick, { uvRepeat: [0.5, 0.6] }), 0, (height - width / 2) / 2, 0) }];
  const r = width / 2, segs = 5;
  for (let i = 0; i < segs; i++) {
    const a = ((i + 0.5) / segs) * Math.PI;
    parts.push({ geo: rotZ(box((Math.PI * r) / segs + 0.02, 0.12, thick), a - Math.PI / 2), xf: (p) => [p[0] + Math.cos(a) * (r - 0.06), p[1] + height - r + Math.sin(a) * (r - 0.06), p[2]] });
  }
  // fill the half-disc
  const fill = new GeoBuilder();
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI, a1 = ((i + 1) / segs) * Math.PI;
    for (const z of [thick / 2, -thick / 2]) fill.tri([0, height - r, z], [Math.cos(a0) * r, height - r + Math.sin(a0) * r, z], [Math.cos(a1) * r, height - r + Math.sin(a1) * r, z], [0.5, 0.5], [0.5 + Math.cos(a0) / 2, 0.5 - Math.sin(a0) / 2], [0.5 + Math.cos(a1) / 2, 0.5 - Math.sin(a1) / 2], [0, 0, z > 0 ? 1 : -1]);
  }
  parts.push({ geo: fill.build() });
  return merge(parts);
}

/** Stairs rising along -Z. */
export function stairs(steps = 6, width = 2, depth = 0.5, rise = 0.3) {
  const parts = [];
  for (let i = 0; i < steps; i++) parts.push({ geo: shift(box(width, rise * (i + 1), depth, { uvRepeat: [width / 2, 0.5] }), 0, (rise * (i + 1)) / 2, -i * depth) });
  return merge(parts);
}

// ---- prop textures (indexed) ----
function make(w, h, fn) {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { data, width: w, height: h, indexed: true };
}
const rnd = (x, y, s = 0) => { const h = Math.sin(x * 12.9898 + y * 78.233 + s * 37.7) * 43758.5453; return h - Math.floor(h); };

/** Wooden planks running vertically. */
export function planks({ ramp = 0, gap = R(3, 0), count = 4 } = {}) {
  const w = 64 / count;
  return make(64, 64, (x, y) => {
    const i = Math.floor(x / w), lx = x % w;
    if (lx === 0) return gap;
    const knot = Math.hypot(lx - w / 2, (y + i * 23) % 64 - 32) < 2 && rnd(i, 0) > 0.5;
    const grainLine = (Math.floor(lx + Math.sin((y + i * 10) * 0.2) * 1.5) % 5) === 0;
    return R(ramp, knot ? 0 : grainLine ? 1 : rnd(i, 1) > 0.5 ? 2 : 1 + (rnd(x, y) > 0.85 ? 1 : 0));
  });
}

/** Rusted / stained metal: blotches with streaks running down. */
export function rust({ metal = 0, rust: rustRamp = 2, seed = 3 } = {}) {
  return make(64, 64, (x, y) => {
    const streakV = rnd(x >> 1, 0, seed) * 64;
    const s = rnd(x >> 3, y >> 3, seed) * 0.6 + rnd(x >> 2, y >> 2, seed + 1) * 0.4;
    if (s > 0.62 || (y > streakV && y < streakV + 20 && rnd(x, 1, seed) > 0.6)) return R(rustRamp, s > 0.8 ? 0 : 1);
    return R(metal, rnd(x, y, seed) > 0.8 ? 1 : 2);
  });
}

/** Floor / wall tiles with grout. */
export function tiles({ ramp = 0, grout = R(3, 0), cells = 4, cracked = 0.15 } = {}) {
  const c = 64 / cells;
  return make(64, 64, (x, y) => {
    if (x % c === 0 || y % c === 0) return grout;
    const ti = Math.floor(x / c), tj = Math.floor(y / c);
    if (rnd(ti, tj, 9) < cracked && Math.abs((x % c) - (y % c) - 2) < 1) return grout;
    return R(ramp, rnd(ti, tj) > 0.5 ? 2 : 1 + (rnd(x, y) > 0.9 ? 1 : 0));
  });
}

/** A sign / window panel: border + glowing fill. */
export function sign({ border = R(0, 1), fill = R(2, 3), alt = R(2, 2) } = {}) {
  return make(64, 32, (x, y) => (x < 2 || y < 2 || x > 61 || y > 29 ? border : ((x >> 2) + (y >> 2)) % 2 ? fill : alt));
}

export { CLEAR };

// ---- tiny geometry transforms ----
export function shift(geo, dx, dy, dz) {
  const p = geo.positions;
  for (let i = 0; i < p.length; i += 3) { p[i] += dx; p[i + 1] += dy; p[i + 2] += dz; }
  return geo;
}
