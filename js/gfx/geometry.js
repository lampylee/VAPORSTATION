// Low-poly geometry builders. Everything is non-indexed triangles so each
// face can carry its own (flat) normal. Call smoothNormals() for Gouraud.

export class GeoBuilder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; }

  /** Triangle. n = optional explicit normal, c = optional vertex colour (or 3 colours). */
  tri(p0, p1, p2, t0, t1, t2, n = null, c = null) {
    if (!n) {
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
      n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    }
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const nn = [n[0] / l, n[1] / l, n[2] / l];
    const cs = !c ? [[1, 1, 1], [1, 1, 1], [1, 1, 1]] : (Array.isArray(c[0]) ? c : [c, c, c]);
    [p0, p1, p2].forEach((p, i) => {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nn[0], nn[1], nn[2]);
      const t = [t0, t1, t2][i];
      this.uv.push(t[0], t[1]);
      this.col.push(cs[i][0], cs[i][1], cs[i][2]);
    });
    return this;
  }

  /** Quad p0..p3 counter-clockwise (seen from the front). */
  quad(p0, p1, p2, p3, t0, t1, t2, t3, n = null, c = null) {
    this.tri(p0, p1, p2, t0, t1, t2, n, c);
    this.tri(p0, p2, p3, t0, t2, t3, n, c);
    return this;
  }

  /** Subdivided rectangle: centre c, half-axes u and v (normal = u x v). */
  face(c, u, v, uvRect = [0, 0, 1, 1], segs = 1, col = null) {
    const P = (a, b) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, c[2] + u[2] * a + v[2] * b];
    const T = (a, b) => [uvRect[0] + (a + 1) / 2 * (uvRect[2] - uvRect[0]), uvRect[1] + (b + 1) / 2 * (uvRect[3] - uvRect[1])];
    for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
      const a0 = -1 + 2 * i / segs, a1 = -1 + 2 * (i + 1) / segs;
      const b0 = -1 + 2 * j / segs, b1 = -1 + 2 * (j + 1) / segs;
      this.quad(P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1), T(a0, b0), T(a1, b0), T(a1, b1), T(a0, b1), null, col);
    }
    return this;
  }

  build() {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      uvs: new Float32Array(this.uv),
      colors: new Float32Array(this.col),
      count: this.pos.length / 3,
    };
  }
}

/** Average normals of vertices that share a position (Gouraud shading). */
export function smoothNormals(geo) {
  const map = new Map();
  const p = geo.positions, n = geo.normals;
  const key = (i) => `${p[i].toFixed(3)},${p[i + 1].toFixed(3)},${p[i + 2].toFixed(3)}`;
  for (let i = 0; i < p.length; i += 3) {
    const k = key(i);
    const acc = map.get(k) || [0, 0, 0];
    acc[0] += n[i]; acc[1] += n[i + 1]; acc[2] += n[i + 2];
    map.set(k, acc);
  }
  for (let i = 0; i < p.length; i += 3) {
    const a = map.get(key(i));
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    n[i] = a[0] / l; n[i + 1] = a[1] / l; n[i + 2] = a[2] / l;
  }
  return geo;
}

export function box(sx = 1, sy = 1, sz = 1, { uvRepeat = [1, 1], segs = 1, col = null } = {}) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const r = [0, 0, uvRepeat[0], uvRepeat[1]];
  const g = new GeoBuilder();
  g.face([hx, 0, 0], [0, 0, -hz], [0, hy, 0], r, segs, col);
  g.face([-hx, 0, 0], [0, 0, hz], [0, hy, 0], r, segs, col);
  g.face([0, hy, 0], [hx, 0, 0], [0, 0, -hz], r, segs, col);
  g.face([0, -hy, 0], [hx, 0, 0], [0, 0, hz], r, segs, col);
  g.face([0, 0, hz], [hx, 0, 0], [0, hy, 0], r, segs, col);
  g.face([0, 0, -hz], [-hx, 0, 0], [0, hy, 0], r, segs, col);
  return g.build();
}

/** Horizontal ground plane centred at origin, facing +Y. */
export function plane(size = 10, segs = 4, uvRepeat = 4) {
  const h = size / 2;
  return new GeoBuilder().face([0, 0, 0], [h, 0, 0], [0, 0, -h], [0, 0, uvRepeat, uvRepeat], segs).build();
}

/**
 * One tunnel segment: N-sided tube from z=0 to z=-length, faces pointing inward.
 * Vertex colours alternate per side for a hand-made feel.
 */
export function tunnelSegment(sides = 8, radius = 3, length = 4, uRepeat = 4, vRepeat = 1) {
  const g = new GeoBuilder();
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
    const P = (a, z) => [Math.cos(a) * radius, Math.sin(a) * radius, z];
    const u0 = (i / sides) * uRepeat, u1 = ((i + 1) / sides) * uRepeat;
    const shade = i % 2 ? 0.82 : 1.0;
    g.quad(P(a0, 0), P(a1, 0), P(a1, -length), P(a0, -length),
      [u0, 0], [u1, 0], [u1, vRepeat], [u0, vRepeat],
      [-Math.cos(am), -Math.sin(am), 0], [shade, shade, shade]);
  }
  return smoothNormals(g.build());
}

/** Generic flat-shaded polyhedron from vertex + face lists, spherical-ish UVs. */
export function polyhedron(verts, faces, scale = 1) {
  const g = new GeoBuilder();
  const uvOf = (v) => [0.5 + Math.atan2(v[2], v[0]) / (2 * Math.PI), 0.5 - Math.asin(Math.max(-1, Math.min(1, v[1] / Math.hypot(...v)))) / Math.PI];
  for (const f of faces) {
    const p = f.map((i) => verts[i].map((x) => x * scale));
    const t = f.map((i) => uvOf(verts[i]));
    // fix UV seam wrap
    const us = t.map((q) => q[0]);
    if (Math.max(...us) - Math.min(...us) > 0.5) t.forEach((q) => { if (q[0] < 0.5) q[0] += 1; });
    g.tri(p[0], p[1], p[2], t[0], t[1], t[2]);
  }
  return g.build();
}

/** Icosphere data (unique verts on unit sphere + faces) for CPU deformation. */
export function icosphereData(subdiv = 1) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((v) => { const l = Math.hypot(...v); return v.map((x) => x / l); });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (cache.has(k)) return cache.get(k);
      const m = [(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2];
      const l = Math.hypot(...m);
      verts.push(m.map((x) => x / l));
      cache.set(k, verts.length - 1);
      return verts.length - 1;
    };
    const nf = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  return { verts, faces };
}

export function icosphere(subdiv = 0, scale = 1) {
  const d = icosphereData(subdiv);
  return polyhedron(d.verts, d.faces, scale);
}

export function octahedron(scale = 1) {
  const v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const f = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
  return polyhedron(v, f, scale);
}

export function tetrahedron(scale = 1) {
  const v = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]].map((p) => p.map((x) => x / Math.sqrt(3)));
  const f = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];
  return polyhedron(v, f, scale);
}

/** Flat N-gon disc facing +Z (for suns, moons, halos). */
export function disc(sides = 12, radius = 1) {
  const g = new GeoBuilder();
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0 = [Math.cos(a0) * radius, Math.sin(a0) * radius, 0], p1 = [Math.cos(a1) * radius, Math.sin(a1) * radius, 0];
    g.tri([0, 0, 0], p0, p1, [0.5, 0.5], [0.5 + Math.cos(a0) / 2, 0.5 - Math.sin(a0) / 2], [0.5 + Math.cos(a1) / 2, 0.5 - Math.sin(a1) / 2], [0, 0, 1]);
  }
  return g.build();
}

/** Merge several geometries, each with its own transform function p => p'. */
export function merge(parts) {
  const g = new GeoBuilder();
  for (const { geo, xf = (p) => p, color = null } of parts) {
    for (let i = 0; i < geo.count; i++) {
      const p = xf([geo.positions[i * 3], geo.positions[i * 3 + 1], geo.positions[i * 3 + 2]]);
      g.pos.push(p[0], p[1], p[2]);
      g.nrm.push(geo.normals[i * 3], geo.normals[i * 3 + 1], geo.normals[i * 3 + 2]);
      g.uv.push(geo.uvs[i * 2], geo.uvs[i * 2 + 1]);
      const c = color || [geo.colors[i * 3], geo.colors[i * 3 + 1], geo.colors[i * 3 + 2]];
      g.col.push(c[0], c[1], c[2]);
    }
  }
  return flatNormals(g.build());
}

/** Recompute per-face normals in place (positions -> normals). */
export function flatNormals(geo) {
  const p = geo.positions, n = geo.normals;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
    const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let v = 0; v < 3; v++) { n[i + v * 3] = nx; n[i + v * 3 + 1] = ny; n[i + v * 3 + 2] = nz; }
  }
  return geo;
}
