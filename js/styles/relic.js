// Style: RELIC — a deforming low-poly crystal core inside a rotating strut cage,
// circled by rings of cubes, floating in a starry void.
//   bass  -> core spikes + scale, spin speed, camera push-in
//   mid   -> light colour shift
//   high  -> orbit speed + cube sparkle, star twinkle
//   beat  -> white flash, spin kick, camera nudge
import { mat4, damp, lerp, hash } from '../gfx/math.js';
import { paletteToRgb, mixColor, scaleColor, addColor } from '../gfx/color.js';
import { icosphereData, polyhedron, box, octahedron, merge, flatNormals } from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';

// ---- tweak me ----
export const PALETTE = {
  fogIdle: '#07040e',
  fogActive: '#0d0618',
  coreA: '#ff5a7a',
  coreB: '#5a1438',
  cage: '#ffd36b',
  cageDark: '#7a5418',
  orbit: '#56d6ff',
  stars: '#cfd6ff',
  flash: '#ffffff',
  lightA: '#ffd0e0',
  lightB: '#80c0ff',
  ambient: '#2a2040',
  tintIdle: '#7a6a90',
  tintActive: '#ffffff',
};

const RINGS = [{ n: 14, r: 3.4, tilt: 0.35 }, { n: 18, r: 4.2, tilt: -0.5 }, { n: 10, r: 5.0, tilt: 1.1 }];

export class Relic {
  static meta = { name: 'Relic' };

  init(r) {
    const p = PALETTE;
    this.c = paletteToRgb(p);
    this.tex = {
      core: r.createTexture(T.blotch({ a: p.coreA, b: p.coreB, scale: 8, seed: 7 })),
      cage: r.createTexture(T.stripes({ a: p.cage, b: p.cageDark, count: 8 })),
      orbit: r.createTexture(T.grid({ bg: '#10203a', line: p.orbit, cells: 2, thick: 2 })),
      white: r.createTexture(T.solid('#ffffff')),
    };

    // core: icosphere deformed on the CPU every frame
    this.ico = icosphereData(1);
    this.seeds = this.ico.verts.map((_, i) => ({ a: hash(i, 1), b: i < 12 ? 0.8 + hash(i, 2) * 0.4 : hash(i, 3) * 0.4, c: hash(i, 4) }));
    this.cur = this.ico.verts.map((v) => v.slice());
    this.coreGeo = polyhedron(this.cur, this.ico.faces);
    this.core = r.createMesh(this.coreGeo, true);

    // cage: struts along the edges of an icosahedron + knots at the vertices
    const base = icosphereData(0), edges = new Set(), parts = [];
    const strut = box(0.09, 0.09, 1), knot = octahedron(0.16);
    for (const f of base.faces) for (let i = 0; i < 3; i++) {
      const a = f[i], b = f[(i + 1) % 3], key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (edges.has(key)) continue;
      edges.add(key);
      const A = base.verts[a], B = base.verts[b];
      const w = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], len = Math.hypot(...w);
      w[0] /= len; w[1] /= len; w[2] /= len;
      let u = Math.abs(w[1]) < 0.9 ? [w[2], 0, -w[0]] : [0, -w[2], w[1]];
      const ul = Math.hypot(...u); u = u.map((x) => x / ul);
      const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
      const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
      parts.push({ geo: strut, xf: (q) => [0, 1, 2].map((j) => mid[j] + q[0] * u[j] + q[1] * v[j] + q[2] * len * w[j]) });
    }
    for (const V of base.verts) parts.push({ geo: knot, xf: (q) => [V[0] + q[0], V[1] + q[1], V[2] + q[2]] });
    this.cage = r.createMesh(merge(parts));

    this.cube = r.createMesh(box(0.35, 0.35, 0.35));
    // star field baked into one mesh
    const star = octahedron(1), sp = [];
    for (let i = 0; i < 160; i++) {
      const th = hash(i, 9) * Math.PI * 2, ph = Math.acos(hash(i, 10) * 2 - 1), rad = 45 + hash(i, 11) * 20, s = 0.08 + hash(i, 12) * 0.18;
      const P = [Math.sin(ph) * Math.cos(th) * rad, Math.cos(ph) * rad, Math.sin(ph) * Math.sin(th) * rad];
      sp.push({ geo: star, xf: (q) => [P[0] + q[0] * s * 3, P[1] + q[1] * s * 3, P[2] + q[2] * s * 3] });
    }
    this.stars = r.createMesh(merge(sp));

    this.time = 0; this.rotY = 0; this.rotX = 0; this.kick = 0; this.flash = 0;
    this.nudge = 0; this.nudgeVel = 0; this.camDist = 9; this.k = 0; this.a = null;
    this.m = mat4.create();
    this.eye = [0, 0, 0];
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], emi: [0, 0, 0], cage: [0, 0, 0], orbit: [0, 0, 0], star: [0, 0, 0], light: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k;
    const t = (this.time += dt);
    if (a.beat) { this.kick += 2.5 * k; this.flash = Math.max(this.flash, k); this.nudgeVel += 3 * k; }
    this.kick *= Math.exp(-dt / 0.35);
    this.flash *= Math.exp(-dt / 0.2);
    const spin = 0.15 + a.bass * k * 1.2 + this.kick;
    this.rotY += spin * dt; this.rotX += spin * 0.55 * dt;
    const w = 6;
    this.nudgeVel += (-this.nudge * w * w - 2 * w * this.nudgeVel) * dt;
    this.nudge += this.nudgeVel * dt;
    this.camDist = damp(this.camDist, lerp(9, 7.4, k) - a.bass * k * 0.9, 0.2, dt);

    // deform the core
    const { verts } = this.ico;
    for (let i = 0; i < verts.length; i++) {
      const s = this.seeds[i];
      const n = Math.sin(t * 1.3 + s.a * 6.283) * 0.5 + 0.5;
      const rad = 1.3 * (1 + 0.06 * Math.sin(t * 0.7 + s.a * 10)
        + k * (a.bass * 0.5 * s.b + a.high * 0.18 * n + a.beatPulse * 0.15 * s.c));
      this.cur[i][0] = verts[i][0] * rad; this.cur[i][1] = verts[i][1] * rad; this.cur[i][2] = verts[i][2] * rad;
    }
    const P = this.coreGeo.positions;
    let o = 0;
    for (const f of this.ico.faces) for (const vi of f) { const q = this.cur[vi]; P[o++] = q[0]; P[o++] = q[1]; P[o++] = q[2]; }
    flatNormals(this.coreGeo);
    this.core.update({ positions: P, normals: this.coreGeo.normals });
  }

  render(r) {
    const { c, col, m, k, eye } = this, a = this.a, t = this.time;
    mixColor(col.fog, c.fogIdle, c.fogActive, k);
    addColor(col.fog, col.fog, c.coreB, this.flash * 0.25);
    r.clear(col.fog);
    const ang = t * 0.12;
    eye[0] = Math.sin(ang) * this.camDist; eye[1] = 1.5 + Math.sin(t * 0.17) * 1.5 + this.nudge * 0.3; eye[2] = Math.cos(ang) * this.camDist;
    r.setCamera(eye, [0, this.nudge * 0.1, 0], { fov: 55 + this.flash * 4, near: 0.1, far: 150 });
    mixColor(col.light, c.lightA, c.lightB, a.mid * k);
    r.setLight([Math.sin(t * 0.4), -0.6, Math.cos(t * 0.4)], col.light, c.ambient);

    // stars (no fog, additive, twinkle with highs)
    scaleColor(col.star, c.stars, 0.35 + a.high * k * 0.9 + Math.sin(t * 3) * 0.05);
    r.draw(this.stars, mat4.trs(m, 0, 0, 0, t * 0.01, t * 0.02, 0), { texture: this.tex.white, tint: [0, 0, 0], emissive: col.star, unlit: true, fog: false, additive: true });

    r.setFog(col.fog, 5, lerp(15, 22, k));
    mixColor(col.tint, c.tintIdle, c.tintActive, k);
    addColor(col.tint, col.tint, c.flash, this.flash * 0.6);
    scaleColor(col.emi, c.coreA, 0.06 + a.bass * k * 0.25 + this.flash * 0.35);
    r.draw(this.core, mat4.trs(m, 0, 0, 0, this.rotX, this.rotY, 0), { texture: this.tex.core, tint: col.tint, emissive: col.emi });

    scaleColor(col.cage, c.cage, 0.05 + a.high * k * 0.4 + this.flash * 0.3);
    const cs = 2.3 * (1 + a.beatPulse * k * 0.08);
    r.draw(this.cage, mat4.trs(m, 0, 0, 0, -this.rotX * 0.4, -this.rotY * 0.5, 0, cs), { texture: this.tex.cage, tint: col.tint, emissive: col.cage });

    const orbitSpeed = 0.35 + a.high * k * 1.6;
    RINGS.forEach((ring, ri) => {
      for (let i = 0; i < ring.n; i++) {
        const th = t * orbitSpeed * (ri % 2 ? -1 : 1) + (i / ring.n) * Math.PI * 2;
        const x = Math.cos(th) * ring.r, z = Math.sin(th) * ring.r;
        const y = z * Math.sin(ring.tilt), zz = z * Math.cos(ring.tilt);
        const sparkle = hash(i + ri * 31, Math.floor(t * 8)) < a.high * k * 0.8 ? 1 : 0.08;
        scaleColor(col.orbit, c.orbit, sparkle + this.flash * 0.3);
        mat4.trs(m, x, y, zz, t * 1.5 + i, t + i, 0, 1 + a.bass * k * 0.4);
        r.draw(this.cube, m, { texture: this.tex.orbit, tint: col.tint, emissive: col.orbit });
      }
    });
  }

  dispose(r) {
    Object.values(this.tex).forEach((t) => r.deleteTexture(t));
    [this.core, this.cage, this.cube, this.stars].forEach((x) => x.dispose());
  }
}
