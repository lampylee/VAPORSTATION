// Modular low-poly props. Each returns geometry (r.createMesh(geo)), with UVs
// sized so a 64x64 texture tiles at roughly 1 repeat per world unit (or as noted).
// Pivot is at the base centre unless noted. Combine with merge() for one draw call.
import { GeoBuilder, box, merge, icosphere, flatNormals } from '../gfx/geometry.js';
import { CLEAR } from '../gfx/textures.js';
import { R } from '../palette/palette.js';
import { rotX, rotY, rotZ, transform, cloneGeo, rotPoint, xf, orientedBox, vadd, vsub, vscale, vnorm, vcross } from './shapes.js';
import { rand2 } from './noise.js';

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
/**
 * Floor tiles. Default: tiles split between shades 1 and 2 (busy). Pass `shades`
 * (repeat a shade to make it more common, e.g. [1, 1, 1, 2]) for a calmer floor;
 * `speck` is then the chance of a one-step-lighter pixel.
 */
export function tiles({ ramp = 0, grout = R(3, 0), cells = 4, cracked = 0.15, shades = null, speck = 0.1 } = {}) {
  const c = 64 / cells;
  return make(64, 64, (x, y) => {
    if (x % c === 0 || y % c === 0) return grout;
    const ti = Math.floor(x / c), tj = Math.floor(y / c);
    if (rnd(ti, tj, 9) < cracked && Math.abs((x % c) - (y % c) - 2) < 1) return grout;
    if (!shades) return R(ramp, rnd(ti, tj) > 0.5 ? 2 : 1 + (rnd(x, y) > 0.9 ? 1 : 0));
    const sh = shades[Math.min(shades.length - 1, Math.floor(rnd(ti, tj) * shades.length))];
    return R(ramp, Math.min(3, sh + (rnd(x, y) < speck ? 1 : 0)));
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

/**
 * Kit v4: gabled house shell, pivot at the base centre, ridge along X. Returns two geos so
 * walls and roof can take their own textures: { walls, roof }. UVs are world-scaled
 * (one repeat per `tile` units). eave / overhang = how far the roof sticks out.
 * Add doors, windows and chimneys as separate parts (instanced windows glow on their own).
 *   const { walls, roof } = K.props.gableHouse(6, 5, 3, 2.2);
 * Quiet House and Back Road Lights each built this by hand.
 */
export function gableHouse(width = 6, depth = 5, wallH = 3, roofH = 2, { tile = 2, eave = 0.4, overhang = 0.35 } = {}) {
  const hw = width / 2, hd = depth / 2, H = wallH, RH = roofH, s = 1 / tile;
  const walls = new GeoBuilder();
  const face = (c, u, v) => walls.face(c, u, v, [0, 0, Math.hypot(...u) * 2 * s, Math.hypot(...v) * 2 * s]);
  face([0, H / 2, hd], [hw, 0, 0], [0, H / 2, 0]);          // front (+z)
  face([0, H / 2, -hd], [-hw, 0, 0], [0, H / 2, 0]);        // back
  face([hw, H / 2, 0], [0, 0, -hd], [0, H / 2, 0]);         // right (+x)
  face([-hw, H / 2, 0], [0, 0, hd], [0, H / 2, 0]);         // left
  for (const sx of [1, -1]) {                                // gable ends, wound so the normal points outward
    const x = sx * hw;
    walls.tri([x, H, sx * hd], [x, H, -sx * hd], [x, H + RH, 0], [0, 0], [depth * s, 0], [depth * s / 2, -RH * s]);
  }
  const roof = new GeoBuilder();
  const ex = hw + overhang, ez = hd + eave, eh = H - eave * (RH / Math.max(0.01, hd));
  const slope = Math.hypot(ez, RH + H - eh) * s;
  for (const sz of [1, -1]) {
    const a = [-sz * ex, eh, sz * ez], b = [sz * ex, eh, sz * ez], c = [sz * ex, H + RH, 0], e = [-sz * ex, H + RH, 0];
    roof.quad(a, b, c, e, [0, slope], [ex * 2 * s, slope], [ex * 2 * s, 0], [0, 0]);
  }
  return { walls: walls.build(), roof: roof.build() };
}

// ---------------------------------------------------------------- Kit v5 props

/**
 * Kit v5: open ring wall with a lip (well shafts, fountains, round tower stubs, pipes).
 * Outer wall, inner wall facing in (running `depth` below the base) and a flat lip.
 * Pivot at the ground centre. From Colour from the Well.
 *   const well = r.createMesh(K.props.well(1.35, 1.0, 0.95));
 */
export function well(outer = 1.35, inner = 1.0, height = 0.95, { segs = 12, depth = 0.6, uRepeat = 6 } = {}) {
  const g = new GeoBuilder();
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const u0 = (i / segs) * uRepeat, u1 = ((i + 1) / segs) * uRepeat;
    const O = (c, s, y) => [c * outer, y, s * outer], I = (c, s, y) => [c * inner, y, s * inner];
    const vIn = (height + depth) / Math.max(0.01, height);
    g.quad(O(c0, s0, 0), O(c0, s0, height), O(c1, s1, height), O(c1, s1, 0), [u0, 1], [u0, 0], [u1, 0], [u1, 1]);
    g.quad(I(c1, s1, -depth), I(c1, s1, height), I(c0, s0, height), I(c0, s0, -depth), [u1, vIn], [u1, 0], [u0, 0], [u0, vIn]);
    g.quad(O(c0, s0, height), I(c0, s0, height), I(c1, s1, height), O(c1, s1, height), [u0, 0], [u0, 0.3], [u1, 0.3], [u1, 0]);
  }
  return g.build();
}

/**
 * Kit v5: jagged rock / reef / boulder. An icosphere pushed in and out per vertex by a hash
 * of its position, so shared corners stay shared (no cracks). spike stretches the top
 * vertices up into a crag (0 = round boulder). Pivot at the centre; flat-shaded.
 * From Fog Harbour.
 *   const rock = K.props.rock(3, { spike: 1, subdiv: 0 });
 */
export function rock(seed = 1, { spike = 1, rough = 0.8, subdiv = 0, scale = 1 } = {}) {
  const g = icosphere(subdiv, 1), P = g.positions;
  for (let i = 0; i < P.length; i += 3) {
    const n = rand2(Math.round(P[i] * 997 + P[i + 1] * 311), Math.round(P[i + 2] * 577 + P[i + 1] * 101), seed);
    const top = spike > 0 && P[i + 1] > 0.5, f = (1 - rough * 0.5625) + n * rough;   // rough 0.8 = 0.55 .. 1.35
    const side = top ? 1 - 0.5 * spike : 1, up = top ? 1 + (0.6 + n) * spike : 1;
    P[i] *= f * side * scale; P[i + 1] *= f * up * scale; P[i + 2] *= f * side * scale;
  }
  return flatNormals(g);
}

/**
 * Kit v5: a strip hung between two points that sags in the middle: fishing nets, washing,
 * bunting, banners, cables (use a thin height). Lies in the XY plane from x = -len/2 to len/2,
 * pivot at the base centre; top edge at `height` minus the sag, bottom edge sags `bottomSag`
 * as much. UVs world-scaled by `tile`. Pair with K.props.sagPosts for the poles.
 * From Fog Harbour.
 */
export function sagStrip(len = 5, height = 2, sag = 0.55, { cols = 8, bottom = 0.35, bottomSag = 0.4, tile = 1.6 } = {}) {
  const g = new GeoBuilder(), hw = len / 2, s = 1 / tile;
  const top = (u) => height - sag * Math.sin(Math.PI * u), bot = (u) => bottom + sag * bottomSag * (1 - Math.sin(Math.PI * u));
  for (let i = 0; i < cols; i++) {
    const u0 = i / cols, u1 = (i + 1) / cols, x0 = -hw + len * u0, x1 = -hw + len * u1;
    g.quad([x0, bot(u0), 0], [x1, bot(u1), 0], [x1, top(u1), 0], [x0, top(u0), 0],
      [x0 * s, bot(u0) * s], [x1 * s, bot(u1) * s], [x1 * s, top(u1) * s], [x0 * s, top(u0) * s], [0, 0, 1]);
  }
  return g.build();
}
/** Kit v5: the two poles for a sagStrip of the same len / height (one geo). */
export function sagPosts(len = 5, height = 2, { radius = 0.08, extra = 0.25 } = {}) {
  return merge([-1, 1].map((sx) => ({ geo: shift(prism(5, radius, height + extra), sx * len / 2, 0, 0) })));
}

/**
 * Kit v5: world positions for windows on a house instance that leans (instance tilt) and is
 * stretched by heightScale, so instanced window quads follow the house. Returns
 * [{ x, y, z, row, col }] for a grid on the house's front (+z) face (face: 'back' = -z).
 *   house = { x, y, z, rotX, rotY, rotZ, hs }   (what you passed to inst.set / tilt)
 *   dims  = { w, h, d }                          (the unscaled walls: width, wall height, depth)
 *   rows / cols = fractions across the face, e.g. rows [0.3, 0.72], cols [-0.27, 0.27]
 * scale = the instance's uniform scale. From Fog Harbour.
 */
export function houseWindows(house, dims, { rows = [0.5], cols = [-0.25, 0.25], face = 'front', out = 0.04, scale = 1 } = {}) {
  const res = [], sz = face === 'back' ? -1 : 1;
  rows.forEach((fy, row) => cols.forEach((fx, col) => {
    const lp = [fx * dims.w * scale, fy * dims.h * (house.hs ?? 1) * scale, sz * (dims.d / 2 * scale + out)];
    const q = rotPoint(lp, house.rotX || 0, house.rotY || 0, house.rotZ || 0);
    res.push({ x: house.x + q[0], y: house.y + q[1], z: house.z + q[2], row, col });
  }));
  return res;
}

// ---------------------------------------------------------------- Kit v6 (Ember Vigil): dark fantasy props

/**
 * Clustered gothic pier: plinth, octagonal core ringed by `shafts` slender columns, a flared
 * capital and a square abacus. Pivot at the base; UVs sized for a 64 px texture over ~2 units
 * (K.tex.ashlar). broken: 0 = whole, else the fraction of the height left standing, topped
 * with a jagged break instead of a capital.
 */
export function gothicPier(height = 9, radius = 0.55, { shafts = 4, broken = 0, seed = 1 } = {}) {
  const parts = [], r = radius, H = broken > 0 ? height * broken : height;
  const ring = (geo, y, rot = 0) => parts.push({ geo, xf: xf({ pos: [0, y, 0], rot: [0, rot, 0] }) });
  const circ = (rr) => (Math.PI * 2 * rr) / 2;
  ring(prism(8, r * 1.5, 0.4, { uvRepeat: [circ(r * 1.5), 0.2] }), 0, Math.PI / 8);
  ring(prism(8, r * 1.28, 0.22, { uvRepeat: [circ(r * 1.28), 0.11], taper: 0.88 }), 0.4, Math.PI / 8);
  ring(prism(8, r, H - 0.62, { uvRepeat: [circ(r), (H - 0.62) / 2] }), 0.62, Math.PI / 8);
  for (let i = 0; i < shafts; i++) {
    const a = (i / shafts) * Math.PI * 2 + Math.PI / 4, sh = H - 0.62 - (broken > 0 ? rand2(i, 5, seed) * 0.9 : 0);
    parts.push({ geo: prism(6, r * 0.3, sh, { uvRepeat: [circ(r * 0.3), sh / 2] }), xf: xf({ pos: [Math.cos(a) * r * 0.98, 0.62, Math.sin(a) * r * 0.98] }) });
  }
  if (broken > 0) {
    parts.push({ geo: rock(seed + 11, { spike: 0.9, rough: 1 }), xf: xf({ pos: [0, H - 0.1, 0], scale: [r * 1.15, r * 0.9, r * 1.15] }) });
  } else {
    ring(prism(8, r * 1.02, 0.55, { uvRepeat: [circ(r), 0.3], taper: 1.55 }), H, Math.PI / 8);
    ring(prism(4, r * 1.6 * Math.SQRT2 / 1.41, 0.26, { uvRepeat: [circ(r * 1.6), 0.13] }), H + 0.55, Math.PI / 4);
  }
  return merge(parts);
}

/**
 * Castle silhouette for distant vistas: a square donjon with merlons and a pyramid roof, round
 * towers with cone spires (or battlements), curtain walls between them. Pivot at ground centre,
 * facing +z. Returns { geo, windows: [{ x, y, z, floor }] } with window spots on the +z faces
 * (put additive glows there and light them floor by floor). Roughly 1k triangles.
 */
export function keep({ seed = 7, scale = 1 } = {}) {
  const parts = [], windows = [], J = (i, k, a) => (rand2(i, k, seed) - 0.5) * a;
  const add = (geo, pos, rot = [0, 0, 0], sc = 1) => parts.push({ geo, xf: xf({ pos: pos.map((v) => v * scale), rot, scale: typeof sc === 'number' ? sc * scale : sc.map((v) => v * scale) }) });
  const merlons = (cx, cz, half, y, round = 0) => {
    if (round) {
      const n = Math.max(6, Math.round(round * 3.2));
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; add(box(0.55, 0.7, 0.4), [cx + Math.cos(a) * round, y + 0.35, cz + Math.sin(a) * round], [0, -a, 0]); }
      return;
    }
    for (let s = -half + 0.5; s <= half - 0.4; s += 1.3) {
      add(box(0.6, 0.75, 0.45), [cx + s, y + 0.37, cz + half]); add(box(0.6, 0.75, 0.45), [cx + s, y + 0.37, cz - half]);
      add(box(0.45, 0.75, 0.6), [cx + half, y + 0.37, cz + s]); add(box(0.45, 0.75, 0.6), [cx - half, y + 0.37, cz + s]);
    }
  };
  // donjon
  const DH = 24, DW = 7;
  add(prism(4, DW / Math.SQRT2, DH, { uvRepeat: [4, 6] }), [0, 0, 0], [0, Math.PI / 4, 0]);
  add(prism(4, DW / Math.SQRT2 + 0.35, 1.0, { uvRepeat: [4, 0.3] }), [0, DH - 1, 0], [0, Math.PI / 4, 0]);
  merlons(0, 0, DW / 2 + 0.2, DH);
  add(prism(4, DW / Math.SQRT2 * 0.8, 7, { taper: 0, uvRepeat: [4, 2] }), [0, DH + 0.6, 0], [0, Math.PI / 4, 0]);
  for (let f = 0; f < 4; f++) for (const cx of [-1.6, 1.6]) windows.push({ x: cx * scale, y: (7 + f * 4.2) * scale, z: (DW / 2 + 0.06) * scale, floor: f });
  // towers: [x, z, radius, height, spire height (0 = battlements)]
  const T = [[-9, 2, 2.4, 30, 9], [8.5, 3, 2.2, 21, 7], [-4.5, -6, 1.8, 35, 11], [11.5, -5, 2.7, 16, 0], [-14, -3, 2.0, 19, 6.5], [4, 6.5, 1.6, 27, 8]];
  T.forEach(([x, z, rr, h, sp], i) => {
    x += J(i, 1, 1.2); z += J(i, 2, 1.2); h += J(i, 3, 3);
    add(prism(8, rr, h, { uvRepeat: [3, h / 4] }), [x, 0, z]);
    add(prism(8, rr + 0.3, 0.8, { uvRepeat: [3, 0.2] }), [x, h - 0.8, z]);
    if (sp > 0) add(prism(8, rr + 0.45, sp, { taper: 0, uvRepeat: [3, sp / 4] }), [x, h, z]);
    else merlons(x, z, 0, h, rr + 0.1);
    for (let y = 5, f = 0; y < h - 2.5; y += 4.5, f++) windows.push({ x: (x + J(i, 10 + f, rr * 0.8)) * scale, y: y * scale, z: (z + rr * 0.96) * scale, floor: f });
  });
  // curtain walls between neighbouring towers (by x order)
  const byX = T.map(([x, z], i) => [x + J(i, 1, 1.2), z + J(i, 2, 1.2)]).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < byX.length - 1; i++) {
    const [x0, z0] = byX[i], [x1, z1] = byX[i + 1], len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0);
    add(box(len, 9, 1.6, { uvRepeat: [len / 4, 2] }), [(x0 + x1) / 2, 4.5, (z0 + z1) / 2], [0, -a, 0]);
  }
  return { geo: merge(parts), windows };
}

/**
 * Armoured knight kneeling on one knee, both hands on the pommel of a greatsword planted
 * point-down in front of him, helm bowed. Faces +z, pivot on the ground under the hips.
 * Returns { body, cape, hands: [x, y, z] }: draw the body with K.tex.plateArmor (vertex colours
 * darken leather and brighten the blade); the cape is a separate sheet (twoSided, K.tex.wornCloth)
 * that hangs from the shoulders and pools behind; sway it with K.Wobble, weighting by uv v.
 * About 700 triangles.
 */
export function knight({ seed = 3 } = {}) {
  const parts = [], LEATHER = [0.5, 0.45, 0.45], DARK = [0.12, 0.1, 0.1], BLADE = [1.35, 1.35, 1.45];
  const add = (geo, pos, rot = [0, 0, 0], scale = 1, color = null) => parts.push({ geo, xf: xf({ pos, rot, scale }), color });
  const limbs = new GeoBuilder();
  const limb = (a, b, w, d = w) => {
    const ax = vscale(vsub(b, a), 0.5), c = vadd(a, ax), up = Math.abs(ax[1]) > Math.abs(ax[2]) ? [0, 0, 1] : [0, 1, 0];
    const s1 = vscale(vnorm(vcross(ax, up)), w / 2), s2 = vscale(vnorm(vcross(ax, s1)), d / 2);
    orientedBox(limbs, c, s1, ax, s2);
  };
  // legs: left (−x) foot forward, right (+x) knee down
  limb([0.13, 0.08, 0.02], [0.13, 0.08, -0.48], 0.14, 0.13);       // right shin on the floor
  add(box(0.11, 0.08, 0.2), [0.13, 0.1, -0.58], [-1.0, 0, 0], 1, LEATHER);
  limb([0.13, 0.1, 0.02], [0.12, 0.56, 0.04], 0.17);                // right thigh, upright
  add(icosphere(0, 0.09), [0.13, 0.11, 0.06]);                       // knee cop
  limb([-0.13, 0.55, 0.03], [-0.14, 0.5, 0.46], 0.17);              // left thigh, forward
  add(icosphere(0, 0.095), [-0.14, 0.52, 0.49]);
  limb([-0.14, 0.5, 0.47], [-0.14, 0.05, 0.47], 0.14);              // left shin, upright
  add(box(0.12, 0.09, 0.27), [-0.14, 0.045, 0.53], [0, 0, 0], 1, LEATHER);
  // hips and skirt of plates
  add(prism(8, 0.28, 0.25, { taper: 0.8, uvRepeat: [2, 0.5] }), [0, 0.45, 0.02]);
  add(prism(8, 0.25, 0.06, { uvRepeat: [2, 0.1] }), [0, 0.68, 0.02], [0, 0, 0], 1, LEATHER);   // belt
  // torso frame, leaning forward
  const lean = 0.2, cl = Math.cos(lean), sl = Math.sin(lean);
  const T = (p) => [p[0], 0.7 + p[1] * cl - p[2] * sl, 0.02 + p[1] * sl + p[2] * cl];
  parts.push({ geo: prism(6, 0.26, 0.5, { taper: 1.22, uvRepeat: [2, 1] }), xf: (p) => T([p[0], p[1], p[2] * 0.72]) });
  parts.push({ geo: box(0.035, 0.4, 0.05), xf: (p) => T([p[0], p[1] + 0.26, p[2] + 0.2]) });       // breastplate ridge
  parts.push({ geo: prism(8, 0.14, 0.11), xf: (p) => T([p[0], p[1] + 0.5, p[2]]) });                // gorget
  // pauldrons: layered lames over each shoulder
  for (const s of [-1, 1]) {
    parts.push({ geo: icosphere(1, 1), xf: (p) => T([s * 0.31 + p[0] * 0.17, 0.46 + p[1] * 0.12, p[2] * 0.17]) });
    parts.push({ geo: icosphere(0, 1), xf: (p) => T([s * 0.34 + p[0] * 0.14, 0.36 + p[1] * 0.08, p[2] * 0.15]) });
  }
  // helm, bowed toward the sword
  const bow = 0.5, cb = Math.cos(bow + lean), sb = Math.sin(bow + lean), neck = T([0, 0.56, 0.02]);
  const Hd = (p) => [neck[0] + p[0], neck[1] + p[1] * cb - p[2] * sb, neck[2] + p[1] * sb + p[2] * cb];
  parts.push({ geo: prism(8, 0.142, 0.3, { uvRepeat: [2, 1] }), xf: (p) => Hd([p[0], p[1] + 0.02, p[2] + 0.02]) });   // great helm
  parts.push({ geo: prism(8, 0.142, 0.05, { taper: 0.55 }), xf: (p) => Hd([p[0], p[1] + 0.32, p[2] + 0.02]) });         // domed top
  parts.push({ geo: box(0.03, 0.06, 0.3), xf: (p) => Hd([p[0], p[1] + 0.37, p[2] + 0.02]) });     // crest ridge
  parts.push({ geo: box(0.24, 0.028, 0.03), xf: (p) => Hd([p[0], p[1] + 0.2, p[2] + 0.15]), color: DARK });   // visor slit
  parts.push({ geo: box(0.025, 0.12, 0.03), xf: (p) => Hd([p[0], p[1] + 0.12, p[2] + 0.15]), color: DARK });  // breaths
  parts.push({ geo: box(0.19, 0.09, 0.08), xf: (p) => Hd([p[0], p[1] + 0.07, p[2] + 0.15]) });     // bevor
  // arms reaching down to the pommel
  const hands = [0, 0.97, 0.45];
  for (const s of [-1, 1]) {
    const sh = T([s * 0.3, 0.45, 0]), el = [s * 0.26, 0.86, 0.24], hd = [s * 0.055, hands[1], hands[2] - 0.01];
    limb(sh, el, 0.12); limb(el, hd, 0.1);
    add(icosphere(0, 0.065), el);
    add(box(0.09, 0.1, 0.11), hd, [0, 0, 0], 1, LEATHER);   // gauntlet
  }
  // greatsword, point in the floor
  const sz = 0.5;
  const blade = new GeoBuilder();
  const bw = 0.034, bt = 0.008, b0 = 0.08, b1 = 0.84;
  const BP = (x, y, z) => [x, y, sz + z];
  for (const zf of [1, -1]) {
    blade.quad(BP(-bw, b0, bt * zf), BP(bw, b0, bt * zf), BP(bw, b1, bt * zf), BP(-bw, b1, bt * zf), [0, 1], [0.3, 1], [0.3, 0], [0, 0], [0, 0, zf]);
    blade.tri(BP(-bw, b0, bt * zf), BP(0, 0, 0), BP(bw, b0, bt * zf), [0, 1], [0.15, 1], [0.3, 1], [0, -0.2, zf]);
  }
  parts.push({ geo: blade.build(), xf: (p) => p, color: BLADE });
  add(box(0.34, 0.045, 0.05), [0, 0.86, sz], [0, 0, 0], 1, BLADE);
  add(prism(6, 0.022, 0.18), [0, 0.88, sz], [0, 0, 0], 1, LEATHER);
  add(icosphere(0, 0.045), [0, 1.08, sz], [0, 0, 0], 1, BLADE);
  parts.push({ geo: limbs.build(), xf: (p) => p });
  const body = merge(parts);
  // cape: a sheet from the shoulders, down the back, pooling on the floor behind; ragged hem
  const cape = new GeoBuilder(), COLS = 6, ROWS = 9, prof = [];
  for (let j = 0; j <= ROWS; j++) {
    const t = j / ROWS;
    let y, z;
    if (t < 0.72) { const u = t / 0.72; y = 1.16 - u * 1.12; z = -0.1 - Math.sin(u * Math.PI * 0.55) * 0.32 - u * 0.12; }
    else { const u = (t - 0.72) / 0.28; y = 0.04 - u * 0.02; z = -0.54 - u * 0.5; }
    prof.push([y, z]);
  }
  const V = (i, j) => {
    const t = j / ROWS, half = 0.3 + t * 0.2, x = -half + (i / COLS) * half * 2;
    const [y, z] = prof[j], wob = j === ROWS ? (rand2(i, j, seed) - 0.5) * 0.18 : 0;
    const curve = -Math.abs(x) * 0.25 * (1 - t);
    return T2([x, y, z + curve + wob], t);
  };
  const T2 = (p, t) => (t < 0.05 ? [p[0], p[1], p[2]] : p);
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
    if (j === ROWS - 1 && rand2(i, 77, seed) > 0.72) continue;   // torn away at the hem
    const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
    cape.quad(a, b, c, d, [i / COLS, j / ROWS], [(i + 1) / COLS, j / ROWS], [(i + 1) / COLS, (j + 1) / ROWS], [i / COLS, (j + 1) / ROWS]);
  }
  return { body, cape: cape.build(), hands };
}
