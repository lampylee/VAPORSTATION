// Style: FOGWAY — an endless twisting octagonal brick tunnel flying into fog.
//   bass  -> flight speed, FOV punch, radial pulse travelling down the tunnel
//   mid   -> twist rate
//   high  -> glowing ring bands + floating sparks
//   beat  -> colour flash, camera roll nudge
// Colours: base ramp = bricks, secondary = sparks, accent = rings/flash, atmosphere = fog.
import { mat4, damp, lerp } from '../gfx/math.js';
import { scaleColor, addColor } from '../gfx/color.js';
import { tunnelSegment, octahedron } from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import { R } from '../palette/palette.js';
import { STYLE_PALETTES } from '../palette/library.js';

const SEG_LEN = 4, SEG_COUNT = 30, SIDES = 8, RADIUS = 3.2, SPARKS = 48;

function path(s, out) {
  out[0] = Math.sin(s * 0.045) * 5 + Math.sin(s * 0.013) * 7;
  out[1] = Math.sin(s * 0.031) * 2.5;
  out[2] = -s;
  return out;
}

export class Fogway {
  static meta = { name: 'Fogway' };
  static palette = STYLE_PALETTES.fogway;

  init(r) {
    this.tex = r.texture(T.bricks({ ramp: 0, mortar: R(3, 0) }));
    this.sparkTex = r.texture(T.solid(R(1, 3)));
    this.seg = r.createMesh(tunnelSegment(SIDES, RADIUS, SEG_LEN * 1.04, 4, 1));
    this.ring = r.createMesh(tunnelSegment(SIDES, RADIUS * 0.96, 0.35, 1, 1));
    this.spark = r.createMesh(octahedron(0.13));
    this.sparks = Array.from({ length: SPARKS }, () => ({
      s: Math.random() * SEG_COUNT * SEG_LEN, a: Math.random() * Math.PI * 2,
      rr: 0.25 + Math.random() * 0.6, spin: 1 + Math.random() * 3, order: Math.random(),
    })).sort((x, y) => x.order - y.order);
    this.hist = new Float32Array(SEG_COUNT + 2);
    this.s = 0; this.time = 0; this.speed = 2; this.twist = 0;
    this.flash = 0; this.roll = 0; this.rollVel = 0;
    this.k = 0; this.a = null;
    this.m = mat4.create();
    this.v = { p0: [0, 0, 0], p1: [0, 0, 0], eye: [0, 0, 0], tgt: [0, 0, 0] };
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], emi: [0, 0, 0], ring: [0, 0, 0], spark: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k;
    this.time += dt;
    this.speed = damp(this.speed, lerp(2.2, 7, k) + a.bass * k * 9, 0.25, dt);
    this.s += this.speed * dt;
    this.twist += dt * (0.12 + a.mid * k * 0.7);
    this.hist.copyWithin(1, 0); this.hist[0] = a.bass * k;
    if (a.beat) {
      this.flash = Math.max(this.flash, k);
      this.rollVel += (Math.random() < 0.5 ? -1 : 1) * 1.4 * k;
    }
    this.flash *= Math.exp(-dt / 0.22);
    const w = 5; // critically damped spring back to 0 roll
    this.rollVel += (-this.roll * w * w - 2 * w * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
  }

  render(r) {
    const { col, v, m, k } = this, a = this.a, P = this.pal;
    scaleColor(col.fog, P.role('fog'), lerp(0.7, 1, k));
    addColor(col.fog, col.fog, P.role('flash'), this.flash * 0.15);
    r.clear(col.fog);

    path(this.s, v.eye); path(this.s + 6, v.tgt);
    r.setCamera(v.eye, v.tgt, { fov: 68 + a.bass * k * 10, near: 0.1, far: 150, roll: this.roll + Math.sin(this.time * 0.2) * 0.1 });
    r.setFog(col.fog, 2, lerp(26, 52, k));
    const fx = v.tgt[0] - v.eye[0], fy = v.tgt[1] - v.eye[1] - 2, fz = v.tgt[2] - v.eye[2];
    r.setLight([fx + Math.sin(this.time * 0.3) * 4, fy, fz], scaleColor(col.light, P.role('light'), lerp(0.55, 0.95, k)), scaleColor(col.amb, P.role('ambient'), 0.45));

    const dim = lerp(0.5, 1, k);
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    scaleColor(col.emi, P.role('flash'), this.flash * 0.3);
    scaleColor(col.ring, P.role('glow'), 0.15 + k * (0.15 + a.high * 1.0) + this.flash * 0.5);

    const base = Math.floor(this.s / SEG_LEN) * SEG_LEN - SEG_LEN;
    for (let i = 0; i < SEG_COUNT; i++) {
      const ss = base + i * SEG_LEN;
      path(ss, v.p0); path(ss + SEG_LEN, v.p1);
      const dx = v.p1[0] - v.p0[0], dy = v.p1[1] - v.p0[1], dz = v.p1[2] - v.p0[2];
      const yaw = Math.atan2(-dx, -dz), pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      const pulse = 1 + this.hist[Math.min(i, this.hist.length - 1)] * 0.35;
      mat4.trs(m, v.p0[0], v.p0[1], v.p0[2], pitch, yaw, ss * 0.04 + this.twist, pulse, pulse, 1);
      r.draw(this.seg, m, { texture: this.tex, tint: col.tint, emissive: col.emi });
      if ((Math.floor(ss / SEG_LEN) & 1) === 0) r.draw(this.ring, m, { emissive: col.ring, tint: [0, 0, 0], unlit: true });
    }

    // sparks drifting through the tunnel; more of them (and brighter) with highs
    const span = SEG_COUNT * SEG_LEN * 0.8;
    const visible = 0.12 + 0.88 * Math.min(1, a.high * k * 1.4);
    scaleColor(col.spark, P.color(R(1, 3)), 0.35 + a.high * k * 1.2 + this.flash * 0.4);
    for (const sp of this.sparks) {
      if (sp.order > visible) break;
      const rel = (((sp.s - this.s) % span) + span) % span;
      path(this.s + 1 + rel, v.p0);
      const ang = sp.a + this.twist * 0.5;
      mat4.trs(m, v.p0[0] + Math.cos(ang) * sp.rr * RADIUS, v.p0[1] + Math.sin(ang) * sp.rr * RADIUS, v.p0[2],
        this.time * sp.spin, this.time * sp.spin * 0.7, 0, 1 + a.high * k);
      r.draw(this.spark, m, { tint: [0, 0, 0], emissive: col.spark, unlit: true, additive: true });
    }
  }

  dispose(r) {
    r.deleteTexture(this.tex); r.deleteTexture(this.sparkTex);
    this.seg.dispose(); this.ring.dispose(); this.spark.dispose();
  }
}
