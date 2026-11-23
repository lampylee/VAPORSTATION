// Kit v4: aimed lights (wave 4b). Searchlight Town, Back Road Lights and Cold Base
// all built the same thing: an additive cone from a lamp to a point on the ground,
// a pool of light where it lands and a lens glow at the lamp.
//
//   this.lights = new K.Searchlights(r, { max: 5 });
//   update: this.lights.set(i, lampXYZ, aimXYZ, { width: 6, brightness: wake * 0.8, glow: wake });
//           this.lights.upload(eye);            // after setting every light this frame
//   houses: shade += this.lights.boostAt(x, z)   // brighten things that sit under a pool
//   render: this.lights.draw(r, { tint })        // last, with the other additive things
//
// Cones, pools and glows ignore fog and fade with distance, so they shine through
// it without popping. A cone that passes right by the lens is dimmed, so it never
// fills the screen.
import { R } from '../palette/palette.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { clamp } from '../gfx/math.js';
import { makeIndexed, bayer, dshade, CLEAR } from './pixel.js';
import { lightShaft, glow } from './sprites.js';
import { centredQuad } from './billboard.js';
import { fadeIn } from './swell.js';

/**
 * Light cone: `sides` crossed trapezoids along +Y, length 1, end width 1, lamp width `base`.
 * v = 0 at the lamp. Instance it with rotX = PI/2 + dip and rotY = yaw, heightScale = len / width.
 */
export function coneGeo(base = 0.08, sides = 3) {
  const g = new GeoBuilder();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI, c = Math.cos(a), s = Math.sin(a);
    const p = (w, y) => [c * w, y, s * w];
    g.quad(p(-base / 2, 0), p(base / 2, 0), p(0.5, 1), p(-0.5, 1), [0, 0], [1, 0], [1, 1], [0, 1], [0, 0, 1]);
  }
  return g.build();
}

/** Round pool of light, bright centre, dithered edge (draw additive on a flat centred quad). */
export function poolSprite({ ramp = 3 } = {}) {
  return makeIndexed(32, 32, (x, y) => {
    const d = Math.hypot(x - 15.5, y - 15.5) / 15.5;
    if (d > 1 || d > 0.45 + bayer(x, y) * 0.55) return CLEAR;
    return dshade(ramp, 3.2 - d * 2.2, x, y);
  });
}

/**
 * Cone + ground pool + lens glow for up to `max` lights, three instanced draws.
 * ramp: palette ramp for the beam and pool (3 = atmosphere, cold; 2 = accent, warm).
 */
export class Searchlights {
  constructor(r, { max = 4, ramp = 3, glowRamp = ramp, base = 0.08, sides = 3 } = {}) {
    this.max = max;
    this.cone = r.createMesh(coneGeo(base, sides));
    this.quad = r.createMesh(centredQuad());
    this.beamTex = r.texture(lightShaft({ ramp }));
    this.poolTex = r.texture(poolSprite({ ramp }));
    this.glowTex = r.texture(glow({ ramp: glowRamp }));
    this.beams = r.createInstances(max);
    this.pools = r.createInstances(max);
    this.glows = r.createInstances(max);
    this.L = Array.from({ length: max }, () => ({ on: false, lamp: [0, 0, 0], aim: [0, 0, 0], dir: [0, -1, 0], len: 1, width: 6, b: 0, g: 0, pool: 1, yaw: 0, dip: 0 }));
    this.n = 0;
    this.tint = [1, 1, 1];
  }

  /**
   * Light i shines from lamp to aim. width = cone width (and pool size) at the aim point;
   * brightness 0..1+; glow = lens glow brightness; pool = pool brightness (relative).
   */
  set(i, lamp, aim, { width = 6, brightness = 1, glow = brightness, pool = 1 } = {}) {
    const L = this.L[i];
    L.on = true;
    L.lamp[0] = lamp[0]; L.lamp[1] = lamp[1]; L.lamp[2] = lamp[2];
    L.aim[0] = aim[0]; L.aim[1] = aim[1]; L.aim[2] = aim[2];
    const dx = aim[0] - lamp[0], dy = aim[1] - lamp[1], dz = aim[2] - lamp[2], len = Math.hypot(dx, dy, dz) || 1;
    L.dir[0] = dx / len; L.dir[1] = dy / len; L.dir[2] = dz / len;
    L.len = len; L.width = width; L.b = brightness; L.g = glow; L.pool = pool;
    L.yaw = Math.atan2(dx, dz); L.dip = Math.asin(clamp(-dy / len, -1, 1));
    this.n = Math.max(this.n, i + 1);
  }

  /** Switch light i off (it stops drawing; fade brightness down first if you want it soft). */
  off(i) { this.L[i].on = false; }

  /** Write the instances. eye = camera position (dims cones that pass by the lens). */
  upload(eye = null) {
    let n = 0;
    for (let i = 0; i < this.n; i++) {
      const L = this.L[i];
      if (!L.on || L.b <= 0.002) continue;
      let near = 1;
      if (eye) {
        const ex = eye[0] - L.lamp[0], ey = eye[1] - L.lamp[1], ez = eye[2] - L.lamp[2];
        const along = clamp(ex * L.dir[0] + ey * L.dir[1] + ez * L.dir[2], 0, L.len);
        const off = Math.hypot(ex - L.dir[0] * along, ey - L.dir[1] * along, ez - L.dir[2] * along);
        const rad = Math.max(0.6, (along / L.len) * L.width * 0.5);
        near = 0.06 + 0.94 * fadeIn(off / rad, 0.8, 3);
      }
      const s = L.width, [x, y, z] = L.lamp, [ax, ay, az] = L.aim;
      this.beams.set(n, x, y, z, s, L.yaw, L.b * 0.32 * near, 0, L.len / s, Math.PI / 2 + L.dip);
      // the pool stretches along the beam when it lands at a shallow angle
      this.pools.set(n, ax, ay + 0.06, az, s * 1.15, L.yaw, L.b * 0.85 * L.pool, 0, Math.min(2.4, 1 / Math.max(0.3, Math.sin(L.dip))), Math.PI / 2);
      this.glows.set(n, x + L.dir[0] * 0.3, y + L.dir[1] * 0.3, z + L.dir[2] * 0.3, 2.2, 0, L.g, 0, 1);
      n++;
    }
    this.beams.upload(n); this.pools.upload(n); this.glows.upload(n);
  }

  /** Summed pool light at ground point (x, z), about 0..1 per light: add it to an instance's shade. */
  boostAt(x, z) {
    let b = 0;
    for (let i = 0; i < this.n; i++) {
      const L = this.L[i];
      if (!L.on || L.b <= 0.01) continue;
      const dx = x - L.aim[0], dz = z - L.aim[2], rr = (dx * dx + dz * dz) / (L.width * L.width * 0.7);
      if (rr < 1) b += L.b * (1 - rr);
    }
    return b;
  }

  /** fade = [near, far] distance fade for the cones (pools and glows fade a little further out). */
  draw(r, { tint = null, fade = [60, 130] } = {}) {
    const t = tint || this.tint, o = { unlit: true, additive: true, depthWrite: false, fog: false, tint: t };
    r.drawInstanced(this.quad, this.pools, { ...o, texture: this.poolTex, fade: [fade[0], fade[1] * 0.92] });
    r.drawInstanced(this.cone, this.beams, { ...o, texture: this.beamTex, fade });
    r.drawInstanced(this.quad, this.glows, { ...o, texture: this.glowTex, billboard: 2, fade: [fade[0] + 10, fade[1] + 10] });
  }

  dispose(r) {
    this.cone.dispose(); this.quad.dispose();
    [this.beamTex, this.poolTex, this.glowTex].forEach((t) => r.deleteTexture(t));
    [this.beams, this.pools, this.glows].forEach((x) => x.dispose());
  }
}

// Kit v7: LightSet. The pipeline holds 4 point lights per scene; a style with more sources
// (a hall of candles, a field of panels) adds them all and LightSet keeps the best 4.
//
//   this.lights = new K.LightSet();
//   render: this.lights.begin();
//           this.lights.add(id, x, y, z, color, radius, level);   // every source, every frame (id: stable number)
//           this.lights.apply(r, focus, dt);                       // focus: a point a little ahead of the eye
//
// Score = level x closeness to the focus. The 4 slots are sticky: a light that drops out of
// the best 4 fades out over `fade` seconds, and only then does its slot go to the next one,
// which fades in. So nothing pops, and the set stays fully lit while the camera moves.
// Colours may exceed 1. A mirror pass reuses what apply() set.
export class LightSet {
  constructor({ max = 4, reach = 6, fade = 0.5, cap = 64 } = {}) {
    this.max = Math.min(4, max); this.reach = reach; this.fadeTime = fade;
    this.c = Array.from({ length: cap }, () => ({ id: 0, pos: [0, 0, 0], color: [0, 0, 0], radius: 1, level: 0, score: 0 }));
    this.slots = Array.from({ length: this.max }, () => ({ id: -1, fade: 0, pos: [0, 0, 0], color: [0, 0, 0], radius: 1 }));
    this.out = Array.from({ length: 4 }, () => ({ pos: [0, 0, 0], color: [0, 0, 0], radius: 1 }));
    this.list = []; this.n = 0; this.kept = 0;
  }
  begin() { this.n = 0; return this; }
  /** color: [r, g, b] (copied), multiplied by level. A level <= 0 is skipped. */
  add(id, x, y, z, color, radius, level = 1) {
    if (level <= 0 || this.n >= this.c.length) return this;
    const e = this.c[this.n++];
    e.id = id; e.pos[0] = x; e.pos[1] = y; e.pos[2] = z; e.radius = radius; e.level = level;
    e.color[0] = color[0] * level; e.color[1] = color[1] * level; e.color[2] = color[2] * level;
    return this;
  }
  /** Forget the slots (after a jump of the camera, or on init). */
  reset() { for (const s of this.slots) { s.id = -1; s.fade = 0; } return this; }
  apply(r, focus, dt = 1 / 60) {
    const n = this.n, c = this.c, m = Math.min(this.max, n), step = Math.min(dt, 0.1) / this.fadeTime;
    for (let i = 0; i < n; i++) {
      const e = c[i], d = Math.hypot(e.pos[0] - focus[0], e.pos[1] - focus[1], e.pos[2] - focus[2]);
      e.score = e.level * Math.max(0, 1 - d / (e.radius + this.reach));
    }
    for (let i = 0; i < m; i++) {   // partial selection sort: the best max first
      let b = i;
      for (let j = i + 1; j < n; j++) if (c[j].score > c[b].score) b = j;
      if (b !== i) { const t = c[i]; c[i] = c[b]; c[b] = t; }
    }
    const want = (id) => { for (let i = 0; i < m; i++) if (c[i].id === id && c[i].score > 0) return c[i]; return null; };
    const find = (id) => { for (let i = 0; i < n; i++) if (c[i].id === id) return c[i]; return null; };
    // existing slots: follow their light, fade up if still wanted, down if not
    for (const s of this.slots) {
      if (s.id < 0) continue;
      const e = find(s.id), w = e && want(s.id);
      if (e) { s.pos[0] = e.pos[0]; s.pos[1] = e.pos[1]; s.pos[2] = e.pos[2]; s.radius = e.radius; s.color[0] = e.color[0]; s.color[1] = e.color[1]; s.color[2] = e.color[2]; }
      else { s.color[0] *= 0.9; s.color[1] *= 0.9; s.color[2] *= 0.9; }   // gone this frame (level 0): fade from what it was
      s.fade = Math.max(0, Math.min(1, s.fade + (w ? step : -step)));
      if (!w && s.fade <= 0) s.id = -1;
    }
    // free slots take the best wanted lights not yet in a slot; they start dark
    for (let i = 0; i < m; i++) {
      const e = c[i]; if (e.score <= 0) break;
      if (this.slots.some((s) => s.id === e.id)) continue;
      const s = this.slots.find((q) => q.id < 0); if (!s) break;
      s.id = e.id; s.fade = 0; s.pos[0] = e.pos[0]; s.pos[1] = e.pos[1]; s.pos[2] = e.pos[2]; s.radius = e.radius;
      s.color[0] = e.color[0]; s.color[1] = e.color[1]; s.color[2] = e.color[2];
    }
    this.list.length = 0;
    for (const s of this.slots) {
      if (s.id < 0 || s.fade <= 0) continue;
      const f = s.fade * s.fade * (3 - 2 * s.fade), o = this.out[this.list.length];
      o.pos[0] = s.pos[0]; o.pos[1] = s.pos[1]; o.pos[2] = s.pos[2]; o.radius = s.radius;
      o.color[0] = s.color[0] * f; o.color[1] = s.color[1] * f; o.color[2] = s.color[2] * f;
      this.list.push(o);
    }
    this.kept = this.list.length;
    r.setPointLights(this.list);
    return this.list;
  }
}
