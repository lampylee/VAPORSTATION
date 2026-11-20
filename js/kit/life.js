// Kit v3: schools of small creatures (promoted from Drowned Ruins' fish, plus birds).
// "Boids-lite": each member mills on its own loop around a moving group centre,
// heading follows its motion. Cheap, deterministic, one instanced draw.
//
//   this.fish = new K.School(r, { kind: 'fish', groups: 3, perGroup: 14, size: 0.9 });
//   update: this.fish.update(dt, (g, t, out) => { out[0] = ...; out[1] = ...; out[2] = ...; }, { amount: K.swell(k, .3, 1), speed: 1 + bass });
//   render: this.fish.draw(r, { tint });
//
// amount grows members in one by one (scale from 0), so nothing pops.
// Birds flap with instance height scale (negative = wings down), slowly when gliding.
import { R } from '../palette/palette.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { makeIndexed as make } from './pixel.js';

const TAU = Math.PI * 2;
const hash = (i, s) => { const h = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return h - Math.floor(h); };

/** Small diamond fish with a tail fin; nose along +X, ~1 unit long. */
export function fishGeo() {
  const g = new GeoBuilder();
  const nose = [0.5, 0, 0], tail = [-0.28, 0, 0], top = [0, 0.16, 0], bot = [0, -0.13, 0], l = [0, 0, 0.09], rr = [0, 0, -0.09];
  const T = [0.5, 0], B = [0.5, 1], M = [0.5, 0.5];
  for (const s of [l, rr]) {
    g.tri(nose, top, s, M, T, M); g.tri(nose, s, bot, M, M, B);
    g.tri(tail, s, top, M, M, T); g.tri(tail, bot, s, M, B, M);
  }
  g.tri(tail, [-0.55, 0.16, 0], [-0.55, -0.14, 0], M, T, B);
  return g.build();
}

/** Bird: a slim body and two wings whose tips sit at +y (height scale flaps them). Nose along +X. */
export function birdGeo() {
  const g = new GeoBuilder();
  const M = [0.5, 0.5], T = [0.5, 0], B = [0.5, 1];
  const nose = [0.45, 0, 0], tail = [-0.4, 0, 0];
  for (const side of [1, -1]) {
    const root0 = [0.15, 0, 0.04 * side], root1 = [-0.15, 0, 0.04 * side], tip = [-0.12, 0.28, 0.75 * side];
    g.tri(root0, root1, tip, M, B, T);
    g.tri(nose, tail, root0, T, B, M);
  }
  g.tri(tail, [-0.62, 0, 0.14], [-0.62, 0, -0.14], M, B, B);
  return g.build();
}

/** 4x8 two-tone creature texture: back / belly by row (ramps from the palette). */
export function creatureTex({ back = R(1, 1), side = R(3, 2), belly = R(0, 3) } = {}) {
  return make(4, 8, (x, y) => (y < 3 ? back : y < 5 ? side : belly));
}

export class School {
  /**
   * kind 'fish' | 'bird'; groups × perGroup members; size = body length;
   * spread = how far members wander from the centre; lift = vertical wander;
   * texture: optional generator (default two-tone from the palette).
   */
  constructor(r, { kind = 'fish', groups = 1, perGroup = 16, size = 1, spread = [1.2, 3.4], lift = 0.8, texture = null } = {}) {
    this.kind = kind;
    this.mesh = r.createMesh(kind === 'bird' ? birdGeo() : fishGeo());
    this.tex = r.texture(texture || (kind === 'bird' ? creatureTex({ back: R(0, 0), side: R(0, 1), belly: R(0, 1) }) : creatureTex()));
    this.groups = groups; this.per = perGroup; this.size = size; this.spread = spread; this.lift = lift;
    this.inst = r.createInstances(groups * perGroup);
    this.seed = Array.from({ length: groups * perGroup }, (_, j) => [hash(j, 1), hash(j, 2), hash(j, 3)]);
    this.t = 0; this.amount = 0;
    this._c = [0, 0, 0]; this._a = [0, 0, 0]; this._b = [0, 0, 0];
  }

  /**
   * centre(g, t, out): writes group g's centre at time t into out (call it
   * with any t; it's used for headings too). amount 0..1 = share of members shown.
   * flap: wingbeat speed for birds (0 = glide). Safe to change every frame: the wing
   * phase integrates, and gliding blends in below flap 1.
   */
  update(dt, centre, { amount = 1, speed = 1, flap = 1 } = {}) {
    this.t += dt * speed;
    this.fp = (this.fp || 0) + dt * speed * Math.max(0, flap);   // wing phase: integrates, so changing flap never jumps
    const glide = 1 - Math.max(0, Math.min(1, flap));
    this.amount += (amount - this.amount) * Math.min(1, dt * 1.5);   // eased, so a jump in amount still grows in
    const N = this.groups * this.per, f = this.inst, T = this.t, bird = this.kind === 'bird';
    const pos = (g, j, t, out) => {
      const [r1, r2, r3] = this.seed[g * this.per + j];
      centre(g, t, out);
      const ph = r1 * TAU + t * (0.6 + r2 * 0.5) * (g % 2 ? -1 : 1);
      const sp = this.spread[0] + r3 * (this.spread[1] - this.spread[0]);
      out[0] += Math.cos(ph) * sp;
      out[2] += Math.sin(ph) * sp * 0.7;
      out[1] += Math.sin(ph * 1.3 + r2 * 5) * this.lift + (r3 - 0.5) * this.lift * 1.6;
      return out;
    };
    let n = 0;
    for (let g = 0; g < this.groups; g++) {
      for (let j = 0; j < this.per; j++) {
        const i = g * this.per + j, [, r2, r3] = this.seed[i];
        // member i grows in as amount passes its slot (groups interleaved, so all groups fill evenly)
        const slot = (j * this.groups + g) / N;
        const grow = Math.max(0, Math.min(1, (this.amount - slot) * N * 0.5));
        if (grow <= 0.001) continue;
        const p0 = pos(g, j, T, this._a), p1 = pos(g, j, T + 0.05, this._b);
        const rot = Math.atan2(-(p1[2] - p0[2]), p1[0] - p0[0]);
        const hs = bird ? Math.sin(this.fp * (5 + r2 * 2) + r3 * TAU) * (1 - glide * 0.85) + glide * 0.6 : 1;
        f.set(n++, p0[0], p0[1], p0[2], this.size * grow * (0.8 + r2 * 0.4), rot, 0.8 + r3 * 0.4, 0, hs);
      }
    }
    f.upload(n);
  }

  draw(r, { tint } = {}) { r.drawInstanced(this.mesh, this.inst, { texture: this.tex, tint }); }
  dispose(r) { this.mesh.dispose(); r.deleteTexture(this.tex); this.inst.dispose(); }
}
