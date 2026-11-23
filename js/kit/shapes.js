// Geometry helpers for building props: vector maths, transforms that rotate
// (merge() parts with rotation), local frames, oriented boxes, winding fixes,
// gothic arches, flat polygons and box chains.
//
//   const f = new K.Frame([x, 0, z], { ry: yaw });         // a local frame for one building
//   f.add(parts, K.props.crate(1), { pos: [0, 0, 2], rot: [0, 0.3, 0] });
//   f.add(parts, K.props.wall(4, 3), { pos: [0, 0, -2] });
//   const mesh = r.createMesh(merge(parts));
import { GeoBuilder, box, merge as mergeRaw, smoothNormals } from '../gfx/geometry.js';
import { clamp } from '../gfx/math.js';

// ---- vectors ([x, y, z] arrays) ----
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const vadd = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
export const vnorm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Rotate a point by Euler angles, applied X, then Z, then Y (same order as instance tilt). */
export function rotPoint(p, rx = 0, ry = 0, rz = 0) {
  let [x, y, z] = p;
  if (rx) { const c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c]; }
  if (rz) { const c = Math.cos(rz), s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c]; }
  if (ry) { const c = Math.cos(ry), s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c]; }
  return [x, y, z];
}

/**
 * Point transform for merge() parts: scale, rotate (X, Z, Y), then translate.
 *   merge([{ geo, xf: xf({ pos: [1, 0, 2], rot: [0, Math.PI / 4, 0], scale: 2 }) }])
 * merge() recomputes flat normals, so only positions need transforming.
 */
export function xf({ pos = [0, 0, 0], rot = [0, 0, 0], scale = 1 } = {}) {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  return (p) => {
    const q = rotPoint([p[0] * s[0], p[1] * s[1], p[2] * s[2]], rot[0], rot[1], rot[2]);
    return [q[0] + pos[0], q[1] + pos[1], q[2] + pos[2]];
  };
}

/** Transform a geometry in place (positions + normals). Same options as xf(). */
export function transform(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = 1 } = {}) {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale, P = geo.positions, N = geo.normals;
  for (let i = 0; i < P.length; i += 3) {
    const q = rotPoint([P[i] * s[0], P[i + 1] * s[1], P[i + 2] * s[2]], rot[0], rot[1], rot[2]);
    P[i] = q[0] + pos[0]; P[i + 1] = q[1] + pos[1]; P[i + 2] = q[2] + pos[2];
    const n = rotPoint([N[i] / s[0], N[i + 1] / s[1], N[i + 2] / s[2]], rot[0], rot[1], rot[2]), l = vlen(n) || 1;
    N[i] = n[0] / l; N[i + 1] = n[1] / l; N[i + 2] = n[2] / l;
  }
  return geo;
}
export const rotX = (geo, a) => transform(geo, { rot: [a, 0, 0] });
export const rotY = (geo, a) => transform(geo, { rot: [0, a, 0] });
export const rotZ = (geo, a) => transform(geo, { rot: [0, 0, a] });

/** Copy of a geometry (transform() and the props helpers modify in place). */
export function cloneGeo(g) {
  return { positions: g.positions.slice(), normals: g.normals.slice(), uvs: g.uvs.slice(), colors: g.colors.slice(), count: g.count };
}

/**
 * A local frame (position + Euler rotation) that collects merge() parts.
 * Frames nest: frame.child({ pos, rot }) is placed inside its parent.
 */
export class Frame {
  constructor(pos = [0, 0, 0], { rx = 0, ry = 0, rz = 0, parent = null } = {}) {
    this.pos = pos; this.rot = [rx, ry, rz]; this.parent = parent;
  }
  /** Local point -> world point. */
  apply(p) {
    const q = rotPoint(p, this.rot[0], this.rot[1], this.rot[2]);
    const w = [q[0] + this.pos[0], q[1] + this.pos[1], q[2] + this.pos[2]];
    return this.parent ? this.parent.apply(w) : w;
  }
  /** Push { geo, xf } into list; pos/rot/scale place the part inside this frame. */
  add(list, geo, { pos, rot, scale, color = null } = {}) {
    const local = xf({ pos, rot, scale });
    list.push({ geo, xf: (p) => this.apply(local(p)), color });
    return this;
  }
  child(pos = [0, 0, 0], { rx = 0, ry = 0, rz = 0 } = {}) { return new Frame(pos, { rx, ry, rz, parent: this }); }
}

/**
 * Box from a centre and three half-axis vectors (need not be axis-aligned):
 * path-aligned posts, gantries, tilted beams. Adds to a GeoBuilder, outward normals.
 */
export function orientedBox(g, c, ax, ay, az, uv = [0, 0, 1, 1]) {
  for (const [n, u, v] of [[ax, ay, az], [ay, az, ax], [az, ax, ay]]) {
    for (const s of [1, -1]) {
      let uu = u, vv = v;
      if (vdot(vcross(uu, vv), n) * s < 0) { uu = v; vv = u; }
      g.face(vadd(c, n, s), uu, vv, uv);
    }
  }
  return g;
}

/** Quad whose winding is flipped if needed so its face normal points along `want`. */
export function quadFacing(g, p0, p1, p2, p3, t0, t1, t2, t3, want) {
  const n = vcross(vsub(p1, p0), vsub(p2, p0));
  if (vdot(n, want) >= 0) g.quad(p0, p1, p2, p3, t0, t1, t2, t3);
  else g.quad(p0, p3, p2, p1, t0, t3, t2, t1);
  return g;
}

/** Upward-facing flat N-gon (pools, light pools, decals), pivot at centre. uvScale = texture repeats across. */
export function flatPoly(sides = 8, radius = 1, { uvScale = 1, y = 0 } = {}) {
  const g = new GeoBuilder();
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    g.tri([0, y, 0], [Math.cos(a1) * radius, y, Math.sin(a1) * radius], [Math.cos(a0) * radius, y, Math.sin(a0) * radius],
      [0.5, 0.5], [0.5 + Math.cos(a1) * 0.5 * uvScale, 0.5 + Math.sin(a1) * 0.5 * uvScale], [0.5 + Math.cos(a0) * 0.5 * uvScale, 0.5 + Math.sin(a0) * 0.5 * uvScale], [0, 1, 0]);
  }
  return g.build();
}

/** Flat ground decal (light pool, puddle, shadow blob): w x l quad facing up, pivot at centre. */
export function decal(w = 1, l = 1, y = 0.02) {
  return new GeoBuilder().quad([-w / 2, y, l / 2], [w / 2, y, l / 2], [w / 2, y, -l / 2], [-w / 2, y, -l / 2], [0, 1], [1, 1], [1, 0], [0, 0], [0, 1, 0]).build();
}

/**
 * Chain of boxes (necks, tails, tentacles, cables) rising in the local YZ plane.
 * segs = [[width, height, length, angleUp], ...]; each continues from the previous end.
 * Pushes into list via frame (a Frame). Returns the end point [y, z].
 */
export function chain(list, frame, start, segs, overlap = 0.6) {
  let [y, z] = start;
  for (const [w, h, len, ang] of segs) {
    const dy = Math.sin(ang), dz = Math.cos(ang);
    frame.add(list, box(w, h, len), { pos: [0, y + dy * len / 2, z + dz * len / 2], rot: [-ang, 0, 0] });
    y += dy * (len - overlap); z += dz * (len - overlap);
  }
  return [y, z];
}

/** Squeeze a geometry's 0..1 UVs into an atlas rect [u0, v0, u1, v1] (in place). */
export function atlasUV(geo, [u0, v0, u1, v1]) {
  const t = geo.uvs;
  for (let i = 0; i < t.length; i += 2) {
    const u = t[i] - Math.floor(t[i] * 0.999), v = t[i + 1] - Math.floor(t[i + 1] * 0.999);
    t[i] = u0 + u * (u1 - u0); t[i + 1] = v0 + v * (v1 - v0);
  }
  return geo;
}

// ---- gothic arches ----

/**
 * Pointed (gothic) arch curve in XY, apex at x = 0: left arc centred at +cx, right at -cx.
 * Returns 2n+1 points [x, y] from the left springing (y = 0) to the right.
 * For an arch of half-width a: rad = a * 1.3 (sharper with bigger factors), cx = rad - a.
 */
export function pointedCurve(cx, rad, n = 6) {
  const tmax = Math.acos(clamp(cx / rad, -1, 1)), left = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * tmax;
    left.push([cx - rad * Math.cos(t), rad * Math.sin(t)]);
  }
  return left.concat(left.slice(0, n).reverse().map(([x, y]) => [-x, y]));
}

/**
 * Pointed archway in the XY plane (pivot at base centre, depth along Z): two posts
 * plus a pointed band. width = opening width, height = springing height, thick = band/post thickness.
 */
export function pointedArch(width = 2, height = 2.5, { thick = 0.35, depth = 0.5, sharp = 1.3, segs = 6 } = {}) {
  const a = width / 2, rad = a * sharp, cx = rad - a;
  const inner = pointedCurve(cx, rad, segs), outer = pointedCurve(cx, rad + thick, segs);
  const g = new GeoBuilder(), d = depth / 2, P = (p, z) => [p[0], p[1] + height, z];
  for (let i = 0; i < inner.length - 1; i++) {
    const A = inner[i], B = inner[i + 1], C = outer[i + 1], E = outer[i];
    const u0 = i / (inner.length - 1) * 4, u1 = (i + 1) / (inner.length - 1) * 4;
    quadFacing(g, P(A, d), P(B, d), P(C, d), P(E, d), [u0, 1], [u1, 1], [u1, 0], [u0, 0], [0, 0, 1]);
    quadFacing(g, P(A, -d), P(B, -d), P(C, -d), P(E, -d), [u0, 1], [u1, 1], [u1, 0], [u0, 0], [0, 0, -1]);
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    quadFacing(g, P(A, d), P(B, d), P(B, -d), P(A, -d), [u0, 0], [u1, 0], [u1, 0.5], [u0, 0.5], [-mx, -my * 0.3 - 0.5, 0]); // soffit
    const ox = (C[0] + E[0]) / 2, oy = (C[1] + E[1]) / 2;
    quadFacing(g, P(E, d), P(C, d), P(C, -d), P(E, -d), [u0, 0], [u1, 0], [u1, 0.5], [u0, 0.5], [ox, oy + 0.5, 0]);  // extrados
  }
  const geo = g.build();
  // posts
  const post = (sx) => { const b = box(thick, height, depth, { uvRepeat: [0.5, height / 2] }); return { geo: b, xf: (p) => [p[0] + sx, p[1] + height / 2, p[2]] }; };
  return mergeRaw([{ geo }, post(-a - thick / 2), post(a + thick / 2)]);
}

/**
 * Lancet (pointed) window pane in XY facing +Z: rectangle from y0 to y1 plus a pointed top.
 * UVs span the whole window 0..1. Returns { geo, top }.
 */
export function lancet(w = 1, y0 = 0, y1 = 2, sharp = 1.3) {
  const a = w / 2, rad = a * sharp, cx = -a + rad, top = y1 + Math.sqrt(rad * rad - cx * cx), H = top - y0;
  const uv = (x, y) => [(x + a) / w, (top - y) / H], p = (x, y) => [x, y, 0], f = [0, 0, 1];
  const g = new GeoBuilder();
  quadFacing(g, p(-a, y0), p(a, y0), p(a, y1), p(-a, y1), uv(-a, y0), uv(a, y0), uv(a, y1), uv(-a, y1), f);
  const c = pointedCurve(cx, rad, 6);
  for (let i = 0; i < c.length - 1; i++) {
    const A = [c[i][0], c[i][1] + y1], B = [c[i + 1][0], c[i + 1][1] + y1];
    const n = vcross(vsub(p(A[0], A[1]), p(0, y1)), vsub(p(B[0], B[1]), p(0, y1)));
    if (n[2] >= 0) g.tri(p(0, y1), p(A[0], A[1]), p(B[0], B[1]), uv(0, y1), uv(A[0], A[1]), uv(B[0], B[1]));
    else g.tri(p(0, y1), p(B[0], B[1]), p(A[0], A[1]), uv(0, y1), uv(B[0], B[1]), uv(A[0], A[1]));
  }
  return { geo: g.build(), top };
}

/** Pointed barrel vault from z = 0 to z = -len over a hall of half-width hw, springing at wallH. Faces point inward. */
export function vault(len = 12, hw = 4, wallH = 5, { sharp = 1.25, segs = 8, uvTile = 3 } = {}) {
  const rad = hw * sharp, c = pointedCurve(rad - hw, rad, segs), g = new GeoBuilder();
  let arc = 0;
  for (let i = 0; i < c.length - 1; i++) {
    const A = c[i], B = c[i + 1], seg = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const u0 = arc / uvTile, u1 = (arc + seg) / uvTile; arc += seg;
    quadFacing(g, [A[0], A[1] + wallH, 0], [B[0], B[1] + wallH, 0], [B[0], B[1] + wallH, -len], [A[0], A[1] + wallH, -len],
      [u0, 0], [u1, 0], [u1, len / uvTile], [u0, len / uvTile], [-(A[0] + B[0]) / 2, -1, 0]);
  }
  return g.build();
}


/**
 * Kit v3: box with each face mapped to its own atlas rect [u0, v0, u1, v1]
 * (one texture, one draw for crates, cabinets, buildings). Pivot at the centre.
 *   K.boxAtlas(1, 2, 1, { top: [0, 0, .5, .5], side: [.5, 0, 1, .5], front: [0, .5, .5, 1] })
 * side covers left/right/back unless given; bottom defaults to top.
 */
export function boxAtlas(w = 1, h = 1, d = 1, { top = [0, 0, 1, 1], side = top, front = side, back = side, left = side, right = side, bottom = top } = {}) {
  const x = w / 2, y = h / 2, z = d / 2, g = new GeoBuilder();
  g.face([x, 0, 0], [0, 0, -z], [0, y, 0], right);
  g.face([-x, 0, 0], [0, 0, z], [0, y, 0], left);
  g.face([0, y, 0], [x, 0, 0], [0, 0, -z], top);
  g.face([0, -y, 0], [x, 0, 0], [0, 0, z], bottom);
  g.face([0, 0, z], [x, 0, 0], [0, y, 0], front);
  g.face([0, 0, -z], [-x, 0, 0], [0, y, 0], back);
  return g.build();
}

// ---- Kit v4 (wave 4b) ------------------------------------------------------

/**
 * Face whose texture repeats every `tile` world units (walls, floors, roads), so
 * big and small faces show the same texel size. Same args as GeoBuilder.face.
 */
export function worldFace(g, c, u, v, tile = 2, segs = 1) {
  const lu = Math.hypot(u[0], u[1], u[2]) * 2 / tile, lv = Math.hypot(v[0], v[1], v[2]) * 2 / tile;
  return g.face(c, u, v, [0, 0, lu, lv], segs);
}

/** Box with world-scaled UVs (one repeat per `tile` units on every face). Pivot at the centre. */
export function worldBox(w = 1, h = 1, d = 1, tile = 1) {
  const s = 1 / tile;
  return boxAtlas(w, h, d, { top: [0, 0, w * s, d * s], side: [0, 0, d * s, h * s], front: [0, 0, w * s, h * s], back: [0, 0, w * s, h * s], bottom: [0, 0, w * s, d * s] });
}

/**
 * Decal that follows the ground: a segs x segs grid over [cx ± rad, cz ± rad] lifted
 * `lift` above height(x, z). Light pools and shadows on hilly terrain (a flat decal
 * cuts into slopes). Build it once for static spots; rebuild or move it in steps for moving ones.
 */
export function terrainDecal(cx, cz, rad, height, { segs = 4, lift = 0.12 } = {}) {
  const g = new GeoBuilder(), n = segs, P = (i, j) => {
    const x = cx + (i / n * 2 - 1) * rad, z = cz + (j / n * 2 - 1) * rad;
    return [x, height(x, z) + lift, z];
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    g.quad(P(i, j + 1), P(i + 1, j + 1), P(i + 1, j), P(i, j), [i / n, (j + 1) / n], [(i + 1) / n, (j + 1) / n], [(i + 1) / n, j / n], [i / n, j / n], [0, 1, 0]);
  }
  return g.build();
}

/**
 * Sky band: a ring around the eye between elevations e0 and e1 (radians), three rows
 * whose vertex colour fades both edges to black, so an additive band has no hard rims.
 * Draw it centred on the eye, additive, fog: false; scroll with uvOffset: [t * speed, 0].
 * Used for burning skies (Before Dawn), red streaks (Right Place), aurora-ish haze.
 */
export function skyBand(e0, e1, { radius = 85, segs = 24, uRepeat = 3 } = {}) {
  const TAU = Math.PI * 2, g = new GeoBuilder(), em = (e0 + e1) / 2;
  const P = (i, e) => { const a = (i / segs) * TAU; return [Math.cos(a) * Math.cos(e) * radius, Math.sin(e) * radius, Math.sin(a) * Math.cos(e) * radius]; };
  const rows = [[e0, 0, 0], [em, 0.5, 1], [e1, 1, 0]];
  for (let j = 0; j < 2; j++) for (let i = 0; i < segs; i++) {
    const [ea, va, ca] = rows[j], [eb, vb, cb] = rows[j + 1];
    const u0 = (i / segs) * uRepeat, u1 = ((i + 1) / segs) * uRepeat, n = [0, -1, 0];
    const A = [ca, ca, ca], B = [cb, cb, cb];
    g.tri(P(i, ea), P(i + 1, ea), P(i + 1, eb), [u0, 1 - va], [u1, 1 - va], [u1, 1 - vb], n, [A, A, B]);
    g.tri(P(i, ea), P(i + 1, eb), P(i, eb), [u0, 1 - va], [u1, 1 - vb], [u0, 1 - vb], n, [A, B, B]);
  }
  return g.build();
}

// ---------------------------------------------------------------- ring zones (Kit v5)

/**
 * Kit v5: one ring (annulus) of ground between radius r0 and r1 around (cx, cz), following
 * height(x, z), with world-space UVs (uv = repeats per unit) and smooth normals.
 * Split ground into rings with K.ringBands and give each its own texture2 / blend, so a
 * change (blight, frost, a spreading light) can run outward from a point. r0 = 0 = a disc.
 * From Colour from the Well.
 */
export function ringBand(r0, r1, { height = () => 0, segs = 40, uv = 0.25, cx = 0, cz = 0, step = 3 } = {}) {
  const g = new GeoBuilder(), steps = Math.max(1, Math.ceil((r1 - r0) / step));
  const P = (rad, a) => { const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad; return [x, height(x, z), z]; };
  const T = (p) => [p[0] * uv, p[2] * uv];
  for (let j = 0; j < steps; j++) {
    const ra = r0 + (r1 - r0) * (j / steps), rb = r0 + (r1 - r0) * ((j + 1) / steps);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const p0 = P(ra, a0), p1 = P(ra, a1), p2 = P(rb, a1), p3 = P(rb, a0);
      if (ra < 1e-4) g.tri(p0, p2, p3, T(p0), T(p2), T(p3));   // centre disc: skip the degenerate half
      else g.quad(p0, p1, p2, p3, T(p0), T(p1), T(p2), T(p3));
    }
  }
  return smoothNormals(g.build());
}

/**
 * Kit v5: ground split into rings at the given edges, e.g. [0, 6, 12, 20, 30, 45].
 * Returns [{ geo, r0, r1, mid }]. In update, give ring i a blend from the spread radius:
 *   const spread = K.swell(k, 4, 40);
 *   rings.forEach((g) => g.blend = Math.min(1, Math.max(0, (spread - g.mid) / 6)));
 * Same options as ringBand (segs can be an array to use fewer segments near the centre).
 */
export function ringBands(edges, opts = {}) {
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const segs = Array.isArray(opts.segs) ? opts.segs[i] : opts.segs;
    out.push({ geo: ringBand(edges[i], edges[i + 1], { ...opts, segs: segs ?? 40 }), r0: edges[i], r1: edges[i + 1], mid: (edges[i] + edges[i + 1]) / 2 });
  }
  return out;
}

// ---- Kit v6 (Ember Vigil): round openings and rose windows ----

/** Where a ray from (cx, cy) along (dx, dy) leaves a convex polygon [[x, y], ...]. */
function rayExit(poly, cx, cy, dx, dy) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length], ex = bx - ax, ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - cx) * ey - (ay - cy) * ex) / den, s = ((ax - cx) * dy - (ay - cy) * dx) / den;
    if (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.min(best, t);
  }
  return [cx + dx * best, cy + dy * best];
}

/**
 * Wall panel with a round hole (rose windows, portholes, tunnel mouths). Lies in the XY plane,
 * facing +z, x from -w/2 to w/2, y from 0 to h, plus an optional `gable` peak on top. The hole is
 * centred at (cx, cy) with radius r; `depth` adds the reveal (the inner surface of the hole) going
 * to z = -depth, and `back` the rear face. UVs world-scaled (one repeat per `tile` units).
 */
export function wallWithHole(w = 16, h = 20, cx = 0, cy = 12, r = 5, { segs = 32, tile = 2, gable = 0, depth = 0.8, back = false } = {}) {
  const a = w / 2, poly = [[-a, 0], [a, 0], [a, h]];
  if (gable > 0) poly.push([0, h + gable]);
  poly.push([-a, h]);
  const top = h + gable, uv = (x, y) => [(x + a) / tile, (top - y) / tile];
  const g = new GeoBuilder();
  const ang = (i) => (i / segs) * Math.PI * 2;
  const inner = [], outer = [];
  for (let i = 0; i <= segs; i++) {
    const t = ang(i), dx = Math.cos(t), dy = Math.sin(t);
    inner.push([cx + dx * r, cy + dy * r]);
    outer.push(rayExit(poly, cx, cy, dx, dy));
  }
  const cornerAng = poly.map(([x, y]) => (Math.atan2(y - cy, x - cx) + Math.PI * 2) % (Math.PI * 2));
  const face = (z, want) => {
    const P = (q) => [q[0], q[1], z];
    for (let i = 0; i < segs; i++) {
      quadFacing(g, P(inner[i]), P(inner[i + 1]), P(outer[i + 1]), P(outer[i]), uv(...inner[i]), uv(...inner[i + 1]), uv(...outer[i + 1]), uv(...outer[i]), want);
      // a polygon corner that falls between two rays: fill the triangle out to it
      const t0 = ang(i), t1 = ang(i + 1);
      poly.forEach((c, k) => {
        if (cornerAng[k] > t0 + 1e-6 && cornerAng[k] < t1 - 1e-6) {
          const p0 = P(outer[i]), p1 = P(outer[i + 1]), pc = P(c);
          const n = vcross(vsub(p1, p0), vsub(pc, p0));
          if (vdot(n, want) >= 0) g.tri(p0, p1, pc, uv(...outer[i]), uv(...outer[i + 1]), uv(...c));
          else g.tri(p0, pc, p1, uv(...outer[i]), uv(...c), uv(...outer[i + 1]));
        }
      });
    }
  };
  face(0, [0, 0, 1]);
  if (back) face(-depth, [0, 0, -1]);
  if (depth > 0) {
    const circ = 2 * Math.PI * r;
    for (let i = 0; i < segs; i++) {
      const p = inner[i], q = inner[i + 1], mid = ang(i + 0.5);
      const u0 = (i / segs) * circ / tile, u1 = ((i + 1) / segs) * circ / tile;
      quadFacing(g, [p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], -depth], [p[0], p[1], -depth],
        [u0, 0], [u1, 0], [u1, depth / tile], [u0, depth / tile], [-Math.cos(mid), -Math.sin(mid), 0]);
    }
  }
  return g.build();
}

/**
 * Gothic rose window, centred at the origin in the XY plane facing +z: an outer rim, a hub,
 * `petals` radial spokes, a ring of foils (small round lights) and the glass between them.
 * `broken` = petal indices whose glass, foil and part of their spokes and rim are gone.
 * Returns { tracery, glass }: draw the tracery as stone, the glass additive + unlit with
 * K.tex.stainedGlass (its UVs repeat `glassTile` times across the window).
 */
export function roseWindow(radius = 5, { petals = 12, depth = 0.45, rim = 0.09, hub = 0.2, spoke = 0.045, broken = [], glassTile = 3, seed = 2 } = {}) {
  const R0 = radius, g = new GeoBuilder(), gl = new GeoBuilder(), Fw = [0, 0, 1];
  const brk = new Set(broken), sector = (Math.PI * 2) / petals;
  const P = (cx, cy, rr, t, z = 0) => [cx + Math.cos(t) * rr, cy + Math.sin(t) * rr, z];
  const tuv = (p) => [p[0] / R0, p[1] / R0];
  const gu = (p) => [(p[0] / R0 + 1) * glassTile * 0.5, (1 - p[1] / R0) * glassTile * 0.5];
  // extruded band between radii r0..r1 over angles a0..a1 around (cx, cy)
  const band = (cx, cy, r0, r1, a0, a1, n) => {
    for (let i = 0; i < n; i++) {
      const t0 = a0 + (a1 - a0) * (i / n), t1 = a0 + (a1 - a0) * ((i + 1) / n), tm = (t0 + t1) / 2;
      const A = P(cx, cy, r0, t0), B = P(cx, cy, r0, t1), C = P(cx, cy, r1, t1), D = P(cx, cy, r1, t0);
      quadFacing(g, A, B, C, D, tuv(A), tuv(B), tuv(C), tuv(D), Fw);
      const Az = P(cx, cy, r0, t0, -depth), Bz = P(cx, cy, r0, t1, -depth), Cz = P(cx, cy, r1, t1, -depth), Dz = P(cx, cy, r1, t0, -depth);
      quadFacing(g, A, B, Bz, Az, [0, 0], [0.3, 0], [0.3, 0.1], [0, 0.1], [-Math.cos(tm), -Math.sin(tm), 0]);
      quadFacing(g, D, C, Cz, Dz, [0, 0], [0.3, 0], [0.3, 0.1], [0, 0.1], [Math.cos(tm), Math.sin(tm), 0]);
    }
  };
  // rim: one arc per sector; a broken sector loses a bite out of it
  for (let s = 0; s < petals; s++) {
    const a0 = s * sector, a1 = a0 + sector;
    if (brk.has(s)) { band(0, 0, R0 * (1 - rim), R0, a0, a0 + sector * 0.3, 2); band(0, 0, R0 * (1 - rim * 0.5), R0, a0 + sector * 0.65, a1, 2); }
    else band(0, 0, R0 * (1 - rim), R0, a0, a1, 3);
  }
  band(0, 0, R0 * hub * 0.55, R0 * hub, 0, Math.PI * 2, 12);     // hub ring
  // spokes (one between two broken sectors is gone, next to one broken sector it snaps off)
  const rIn = R0 * hub, rOut = R0 * (1 - rim), w = R0 * spoke;
  for (let s = 0; s < petals; s++) {
    const t = s * sector, prev = (s - 1 + petals) % petals;
    const both = brk.has(s) && brk.has(prev), one = brk.has(s) || brk.has(prev);
    const len = both ? 0 : one ? 0.45 + 0.3 * Math.abs(Math.sin(seed * 7.1 + s)) : 1;
    if (len <= 0) continue;
    const c = Math.cos(t), sn = Math.sin(t), px = -sn * w, py = c * w, r1 = rIn + (rOut - rIn) * len;
    const A = [c * rIn + px, sn * rIn + py, 0], B = [c * rIn - px, sn * rIn - py, 0], C = [c * r1 - px, sn * r1 - py, 0], D = [c * r1 + px, sn * r1 + py, 0];
    const z = (p) => [p[0], p[1], -depth];
    quadFacing(g, A, B, C, D, tuv(A), tuv(B), tuv(C), tuv(D), Fw);
    quadFacing(g, A, D, z(D), z(A), [0, 0], [1, 0], [1, 0.1], [0, 0.1], [px, py, 0]);
    quadFacing(g, B, C, z(C), z(B), [0, 0], [1, 0], [1, 0.1], [0, 0.1], [-px, -py, 0]);
    if (len < 1) quadFacing(g, C, D, z(D), z(C), [0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [c, sn, 0]);   // snapped end
  }
  // foils and glass per intact sector
  const rm = (rIn + rOut) * 0.56, rf = (rOut - rIn) * 0.26;
  for (let s = 0; s < petals; s++) {
    if (brk.has(s)) continue;
    const tm = (s + 0.5) * sector;
    band(Math.cos(tm) * rm, Math.sin(tm) * rm, rf * 0.72, rf, 0, Math.PI * 2, 8);
    for (let i = 0; i < 3; i++) {
      const t0 = s * sector + sector * (i / 3), t1 = s * sector + sector * ((i + 1) / 3);
      const A = P(0, 0, rIn, t0, -depth * 0.5), B = P(0, 0, rIn, t1, -depth * 0.5), C = P(0, 0, rOut, t1, -depth * 0.5), D = P(0, 0, rOut, t0, -depth * 0.5);
      quadFacing(gl, A, B, C, D, gu(A), gu(B), gu(C), gu(D), Fw);
    }
  }
  // the hub's own glass disc
  const O = [0, 0, -depth * 0.5];
  for (let i = 0; i < 10; i++) {
    const A = P(0, 0, rIn * 0.55, (i / 10) * Math.PI * 2, -depth * 0.5), B = P(0, 0, rIn * 0.55, ((i + 1) / 10) * Math.PI * 2, -depth * 0.5);
    gl.tri(O, A, B, gu(O), gu(A), gu(B));
  }
  return { tracery: g.build(), glass: gl.build() };
}
