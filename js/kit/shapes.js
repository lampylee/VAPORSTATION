// Geometry helpers for building props: vector maths, transforms that rotate
// (merge() parts with rotation), local frames, oriented boxes, winding fixes,
// gothic arches, flat polygons and box chains.
//
//   const f = new K.Frame([x, 0, z], { ry: yaw });         // a local frame for one building
//   f.add(parts, K.props.crate(1), { pos: [0, 0, 2], rot: [0, 0.3, 0] });
//   f.add(parts, K.props.wall(4, 3), { pos: [0, 0, -2] });
//   const mesh = r.createMesh(merge(parts));
import { GeoBuilder, box, merge as mergeRaw } from '../gfx/geometry.js';
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
