// Style: RELIC — a deforming low-poly crystal core inside a rotating strut cage,
// circled by rings of cubes, floating in a starry void.
//   bass  -> core spikes + scale, spin speed, camera push-in
//   mid   -> light shifts toward the accent colour
//   high  -> orbit speed + cube sparkle, star twinkle
//   beat  -> flash, spin kick, camera nudge
// Colours: base = core, secondary = orbit cubes, accent = cage/flash, atmosphere = void + stars.
import { mat4, damp, lerp, hash } from '../gfx/math.js';
import { mixColor, scaleColor, addColor } from '../gfx/color.js';
import { icosphereData, polyhedron, box, octahedron, merge, flatNormals } from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import { R } from '../palette/palette.js';
import { STYLE_PALETTES } from '../palette/library.js';

const RINGS = [{ n: 14, r: 3.4, tilt: 0.35 }, { n: 18, r: 4.2, tilt: -0.5 }, { n: 10, r: 5.0, tilt: 1.1 }];

export class Relic {
  static meta = { name: 'Relic' };
  static palette = STYLE_PALETTES.relic;

  init(r) {
    this.tex = {
      core: r.texture(T.blotch({ ramp: 0, scale: 8, seed: 7, minShade: 1 })),
      cage: r.texture(T.stripes({ a: R(2, 3), b: R(2, 1), count: 8 })),
      orbit: r.texture(T.grid({ bg: R(1, 0), line: R(1, 3), glow: R(1, 2), cells: 2, thick: 2 })),
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
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], emi: [0, 0, 0], cage: [0, 0, 0], orbit: [0, 0, 0], star: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k;
    const t = (this.time += dt);
    if (a.beat) { const mo = a.motion ?? 1; this.kick += 2.5 * k * mo; this.flash = Math.max(this.flash, k * (a.accent ?? 1)); this.nudgeVel += 3 * k * mo; }
    this.kick *= Math.exp(-dt / 0.35);
    this.flash *= Math.exp(-dt / (0.2 * (a.decay ?? 1)));
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
    const Pos = this.coreGeo.positions;
    let o = 0;
    for (const f of this.ico.faces) for (const vi of f) { const q = this.cur[vi]; Pos[o++] = q[0]; Pos[o++] = q[1]; Pos[o++] = q[2]; }
    flatNormals(this.coreGeo);
    this.core.update({ positions: Pos, normals: this.coreGeo.normals });
  }

  render(r) {
    const { col, m, k, eye } = this, a = this.a, t = this.time, P = this.pal;
    scaleColor(col.fog, P.role('fog'), lerp(0.7, 1, k));
    addColor(col.fog, col.fog, P.color(R(0, 0)), this.flash * 0.25);
    r.clear(col.fog);
    const ang = t * 0.12;
    eye[0] = Math.sin(ang) * this.camDist; eye[1] = 1.5 + Math.sin(t * 0.17) * 1.5 + this.nudge * 0.3; eye[2] = Math.cos(ang) * this.camDist;
    r.setCamera(eye, [0, this.nudge * 0.1, 0], { fov: 55 + this.flash * 4, near: 0.1, far: 150 });
    mixColor(col.light, P.role('light'), P.role('glow'), a.mid * k * 0.6);
    r.setLight([Math.sin(t * 0.4), -0.6, Math.cos(t * 0.4)], col.light, scaleColor(col.amb, P.role('ambient'), 0.4));

    // stars (no fog, additive, twinkle with highs)
    scaleColor(col.star, P.color(R(3, 3)), 0.35 + a.high * k * 0.9 + Math.sin(t * 3) * 0.05);
    r.draw(this.stars, mat4.trs(m, 0, 0, 0, t * 0.01, t * 0.02, 0), { tint: [0, 0, 0], emissive: col.star, unlit: true, fog: false, additive: true });

    r.setFog(col.fog, 5, lerp(15, 22, k));
    const dim = lerp(0.55, 1, k);
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    addColor(col.tint, col.tint, P.role('flash'), this.flash * 0.6);
    scaleColor(col.emi, P.color(R(0, 2)), 0.06 + a.bass * k * 0.25 + this.flash * 0.35);
    r.draw(this.core, mat4.trs(m, 0, 0, 0, this.rotX, this.rotY, 0), { texture: this.tex.core, tint: col.tint, emissive: col.emi });

    scaleColor(col.cage, P.role('glow'), 0.05 + a.high * k * 0.4 + this.flash * 0.3);
    const cs = 2.3 * (1 + a.beatPulse * k * 0.08);
    r.draw(this.cage, mat4.trs(m, 0, 0, 0, -this.rotX * 0.4, -this.rotY * 0.5, 0, cs), { texture: this.tex.cage, tint: col.tint, emissive: col.cage });

    const orbitSpeed = 0.35 + a.high * k * 1.6;
    const orbitCol = P.color(R(1, 3));
    RINGS.forEach((ring, ri) => {
      for (let i = 0; i < ring.n; i++) {
        const th = t * orbitSpeed * (ri % 2 ? -1 : 1) + (i / ring.n) * Math.PI * 2;
        const x = Math.cos(th) * ring.r, z = Math.sin(th) * ring.r;
        const y = z * Math.sin(ring.tilt), zz = z * Math.cos(ring.tilt);
        const sparkle = hash(i + ri * 31, Math.floor(t * 8)) < a.high * k * 0.8 ? 1 : 0.08;
        scaleColor(col.orbit, orbitCol, sparkle + this.flash * 0.3);
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
