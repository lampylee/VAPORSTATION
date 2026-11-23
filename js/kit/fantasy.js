// Kit v6 (Ember Vigil): light sources for dark fantasy scenes. Each pairs with the
// pipeline's point lights (r.setPointLights), so the fire actually lights what is around it.
//
//   this.fire = new K.Fire(r, { pos: [0, 0, 2] });
//   update:  this.fire.update(dt, { level: lerp(0.5, 1.2, k), burst: beat ? audio.accent : 0 });
//   render:  r.setPointLights([this.fire.pointLight(this.pal.color(R(2, 3)))]); ... this.fire.draw(r);
//
//   this.candles = new K.Candles(r, { max: 60 });  set(i, x, y, z, height, level) then upload(), draw(r)
//   this.bolt = new K.Lightning(r);  strike(from, to) on a big bar, update(dt), draw(r), read .flash
import { R } from '../palette/palette.js';
import { mat4 } from '../gfx/math.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { billboardQuad, centredQuad } from './billboard.js';
import { flame, glow } from './sprites.js';
import { poolSprite } from './lights.js';
import { Particles } from './particles.js';
import { prism } from './props.js';
import { makeIndexed, rnd } from './pixel.js';

const _m = mat4.create();

/**
 * A fire: a cluster of animated flame cards, a two-layer core glow, rising embers and a warm
 * light pool on the floor. `.light` is its flicker (0..~1.4) for anything you light by hand;
 * `pointLight(color)` returns the entry for r.setPointLights.
 */
export class Fire {
  constructor(r, { pos = [0, 0, 0], scale = 1, ramp = 2, flames = 7, embers = 70, seed = 1 } = {}) {
    this.pos = pos; this.s = scale; this.n = flames; this.seed = seed;
    this.quad = r.createMesh(billboardQuad(1, 1));
    this.cquad = r.createMesh(centredQuad(1, 1));
    this.flameTex = r.texture(flame({ ramp }));
    this.glowTex = r.texture(glow({ ramp }));
    this.poolTex = r.texture(poolSprite({ ramp }));
    this.inst = r.createInstances(flames);
    this.glowInst = r.createInstances(2);
    this.embers = new Particles(r, 'embers', { count: embers, area: [1.4 * scale, 4.5 * scale, 1.4 * scale], size: 0.07 * scale, vel: [0, 1.5 * scale, 0], jitter: [0.35, 0.6, 0.35], wobble: 0.8, yOffset: 2.1 * scale });
    this.t = Math.random() * 10; this.level = 1; this.light = 1; this.burst = 0;
    this.update(0, {});
  }

  /** level: overall size / brightness (0.4 embers .. 1.5 roaring); burst: one-off flare (a beat), 0..1. */
  update(dt, { level = 1, burst = 0 } = {}) {
    this.t += dt; this.level = level;
    if (burst > 0) { this.burst = Math.max(this.burst, burst); this.embers.gust(burst * 1.6); }
    this.burst *= Math.exp(-dt / 0.35);
    const t = this.t, s = this.s, L = level * (1 + this.burst * 0.6), [px, py, pz] = this.pos;
    this.light = L * (0.8 + 0.1 * Math.sin(t * 9.1) + 0.07 * Math.sin(t * 15.3 + 1.7) + 0.05 * Math.sin(t * 23.9 + 4.1));
    for (let i = 0; i < this.n; i++) {
      const a = (i / this.n) * Math.PI * 2 + this.seed, rr = i === 0 ? 0 : 0.17 * s;
      const h = (0.55 + 0.25 * Math.sin(t * (6.3 + i * 1.7) + i * 2.1) + 0.12 * Math.sin(t * 13.1 + i)) * s * L * (i === 0 ? 1.45 : 1);
      const w = (i === 0 ? 0.55 : 0.36) * s * Math.min(1.3, 0.7 + L * 0.35);
      this.inst.set(i, px + Math.cos(a + t * 0.4) * rr, py + 0.05 * s, pz + Math.sin(a + t * 0.4) * rr, w, 0, 1, 0, h / Math.max(w, 1e-3), 0, Math.sin(t * 3.1 + i * 1.3) * 0.12);
    }
    this.inst.upload(this.n);
    this.glowInst.set(0, px, py + 0.5 * s, pz, 1.35 * s * this.light, 0, 1);
    this.glowInst.set(1, px, py + 0.35 * s, pz, 0.7 * s * this.light, 0, 1);
    this.glowInst.upload(2);
    this.embers.update(dt, [px, py, pz], { amount: Math.min(1, 0.25 + level * 0.6 + this.burst * 0.4), speed: 0.7 + level * 0.4 });
  }

  pointLight(color, { strength = 2.2, radius = 9, lift = 0.7 } = {}) {
    const k = this.light * strength;
    return { pos: [this.pos[0], this.pos[1] + lift * this.s, this.pos[2]], color: [color[0] * k, color[1] * k, color[2] * k], radius: radius * this.s * (0.85 + this.level * 0.15) };
  }

  /** brightness scales the glows (dim it for the idle look); tint = an RGB multiplier. */
  draw(r, { brightness = 1, tint = null } = {}) {
    const b = brightness, T = tint || [1, 1, 1], tb = [T[0] * b, T[1] * b, T[2] * b], [px, py, pz] = this.pos, s = this.s;
    mat4.trs(_m, px, py + 0.02, pz, -Math.PI / 2, 0, 0, 5.5 * s * Math.min(1.4, this.light), 5.5 * s * Math.min(1.4, this.light), 1);
    r.draw(this.cquad, _m, { texture: this.poolTex, additive: true, unlit: true, tint: [tb[0] * 0.45, tb[1] * 0.45, tb[2] * 0.45] });
    r.drawInstanced(this.cquad, this.glowInst, { texture: this.glowTex, billboard: 2, additive: true, unlit: true, tint: [tb[0] * 0.55, tb[1] * 0.55, tb[2] * 0.55] });
    r.drawInstanced(this.quad, this.inst, { texture: this.flameTex, billboard: 1, additive: true, unlit: true, tint: tb });
    this.embers.draw(r, { brightness: b });
  }

  dispose(r) {
    for (const m of [this.quad, this.cquad]) m.dispose?.();
    for (const t of [this.flameTex, this.glowTex, this.poolTex]) r.deleteTexture(t);
    this.inst.dispose?.(); this.glowInst.dispose?.(); this.embers.dispose?.(r);
  }
}

/**
 * Candles: instanced wax sticks, flames and soft halos, three draws for all of them. Each candle
 * has its own height and light level (0 = unlit: the flame shrinks to nothing, never pops).
 * Pair with K.Stager to light rows in order.
 */
export class Candles {
  constructor(r, { max = 64, ramp = 2, wax = R(0, 3) } = {}) {
    this.max = max; this.n = 0; this.t = 0;
    this.stick = r.createMesh(prism(6, 0.028, 1, { uvRepeat: [1, 1] }));
    this.quad = r.createMesh(billboardQuad(1, 1));
    this.cquad = r.createMesh(centredQuad(1, 1));
    this.waxTex = r.texture(makeIndexed(4, 8, (x, y) => (y < 2 && rnd(x, y, 3) > 0.4 ? wax - 1 : wax)));
    this.flameTex = r.texture(flame({ ramp }));
    this.glowTex = r.texture(glow({ ramp }));
    this.sticks = r.createInstances(max); this.flames = r.createInstances(max); this.halos = r.createInstances(max);
    this.c = [];
  }

  set(i, x, y, z, height = 0.25, level = 1) { this.c[i] = { x, y, z, h: height, level, ph: rnd(i, 1, 7) * 20 }; }

  /** Call once per frame after set(): animates the flicker and uploads n candles. */
  upload(n = this.c.length, dt = 0) {
    this.t += dt; this.n = Math.min(n, this.max);
    for (let i = 0; i < this.n; i++) {
      const c = this.c[i], top = c.y + c.h, L = c.level;
      const fl = L * (0.85 + 0.15 * Math.sin(this.t * 11 + c.ph) * Math.sin(this.t * 4.3 + c.ph * 2));
      this.sticks.set(i, c.x, c.y, c.z, 1, c.ph, 1, 0, c.h);
      this.flames.set(i, c.x, top - 0.01, c.z, 0.06 * fl, 0, 1, 0, 2.4, 0, Math.sin(this.t * 3 + c.ph) * 0.15);
      this.halos.set(i, c.x, top + 0.06, c.z, 0.55 * fl, 0, 1);
    }
    this.sticks.upload(this.n); this.flames.upload(this.n); this.halos.upload(this.n);
  }

  /** Brightest-weighted centre of the lit candles in [from, to): a point light for a group. */
  groupLight(from, to, color, { strength = 0.9, radius = 6 } = {}) {
    let sx = 0, sy = 0, sz = 0, w = 0;
    for (let i = from; i < Math.min(to, this.n); i++) { const c = this.c[i], L = c.level; sx += c.x * L; sy += (c.y + c.h) * L; sz += c.z * L; w += L; }
    if (w <= 1e-4) return null;
    const k = strength * Math.min(1, w / Math.max(1, (to - from) * 0.5));
    return { pos: [sx / w, sy / w + 0.3, sz / w], color: [color[0] * k, color[1] * k, color[2] * k], radius };
  }

  draw(r, { brightness = 1 } = {}) {
    if (!this.n) return;
    const b = brightness;
    r.drawInstanced(this.stick, this.sticks, { texture: this.waxTex });
    r.drawInstanced(this.cquad, this.halos, { texture: this.glowTex, billboard: 2, additive: true, unlit: true, tint: [0.35 * b, 0.35 * b, 0.35 * b] });
    r.drawInstanced(this.quad, this.flames, { texture: this.flameTex, billboard: 1, additive: true, unlit: true, tint: [b, b, b] });
  }

  dispose(r) {
    for (const m of [this.stick, this.quad, this.cquad]) m.dispose?.();
    for (const t of [this.waxTex, this.flameTex, this.glowTex]) r.deleteTexture(t);
    for (const i of [this.sticks, this.flames, this.halos]) i.dispose?.();
  }
}

const BOLT_SEGS = 32, BRANCH_SEGS = 10, BRANCHES = 3;

/**
 * Lightning: a jagged bolt with forked branches, regenerated on every strike, in the XY plane
 * (faces +z: put it far behind the scene). `.flash` (0..1, with a re-strike flicker) is for
 * brightening the sky and the light. Gate strikes by bar (K.BarClock), never per beat.
 */
export class Lightning {
  constructor(r, { width = 0.9 } = {}) {
    this.width = width; this.life = 1; this.flash = 0; this.age = 9;
    this.geo = this._build([0, 60, 0], [0, 0, 0], 1);
    this.mesh = r.createMesh(this.geo, true);
  }

  _build(from, to, seed) {
    const pts = [from, to], rr = (i) => rnd(i, seed, 13) - 0.5;
    // midpoint displacement to BOLT_SEGS segments
    let list = [from, to], amp = Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.22, n = 0;
    while (list.length - 1 < BOLT_SEGS) {
      const next = [list[0]];
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i], b = list[i + 1];
        next.push([(a[0] + b[0]) / 2 + rr(n++) * amp, (a[1] + b[1]) / 2 + rr(n++) * amp * 0.2, (a[2] + b[2]) / 2], b);
      }
      list = next; amp *= 0.55;
    }
    const g = new GeoBuilder(), W = this.width;
    const ribbon = (path, w0, w1) => {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1], t0 = i / (path.length - 1), t1 = (i + 1) / (path.length - 1);
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, px = -dy / l, py = dx / l;
        const wa = (w0 + (w1 - w0) * t0) / 2, wb = (w0 + (w1 - w0) * t1) / 2;
        g.quad([a[0] - px * wa, a[1] - py * wa, a[2]], [a[0] + px * wa, a[1] + py * wa, a[2]], [b[0] + px * wb, b[1] + py * wb, b[2]], [b[0] - px * wb, b[1] - py * wb, b[2]], [0, 0], [1, 0], [1, 1], [0, 1], [0, 0, 1]);
      }
    };
    ribbon(list, W, W * 0.5);
    for (let k = 0; k < BRANCHES; k++) {
      const start = list[4 + Math.floor(rnd(k, seed, 5) * (BOLT_SEGS - 12))], dir = rnd(k, seed, 6) > 0.5 ? 1 : -1;
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]) * (0.18 + rnd(k, seed, 7) * 0.15), br = [start];
      for (let i = 1; i <= BRANCH_SEGS; i++) {
        const p = br[i - 1];
        br.push([p[0] + dir * len / BRANCH_SEGS * (0.6 + rr(100 + k * 20 + i) * 1.2), p[1] - len / BRANCH_SEGS * (0.8 + rr(200 + k * 20 + i)), p[2]]);
      }
      ribbon(br, W * 0.45, W * 0.1);
    }
    return g.build();
  }

  strike(from, to) {
    const geo = this._build(from, to, Math.floor(Math.random() * 1e4));
    this.mesh.update(geo);
    this.age = 0;
  }

  update(dt) {
    this.age += dt;
    const a = this.age;
    // main flash, a darker gap, then a re-strike flicker
    this.flash = a > 1.2 ? 0 : Math.exp(-a / 0.09) + (a > 0.16 ? 0.7 * Math.exp(-(a - 0.16) / 0.12) : 0) + (a > 0.42 ? 0.35 * Math.exp(-(a - 0.42) / 0.1) : 0);
    this.flash = Math.min(1, this.flash);
  }

  draw(r, { tint = [1, 1, 1] } = {}) {
    if (this.flash < 0.02) return;
    const f = this.flash;
    r.draw(this.mesh, undefined, { unlit: true, additive: true, fog: false, tint: [tint[0] * f, tint[1] * f, tint[2] * f] });
  }

  dispose() { this.mesh.dispose?.(); }
}
