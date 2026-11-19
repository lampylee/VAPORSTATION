// Kit v3 effects, promoted from wave-1/2 environments plus calm-scene additions.
//
//   K.Caustics  animated caustic light network, drawn additively over any mesh
//   K.Streaks   direction-aligned streak lines that stream past the camera (speed / wind lines)
//   K.Pulses    pulses that travel along a 1D path (light strips, ribbons, corridors)
//   K.Ripples   expanding rings on still water (beats, drips, fish rising)
import { R } from '../palette/palette.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { caustics } from './textures.js';
import { CLEAR, bayer, makeIndexed as make } from './pixel.js';
import { decal } from './shapes.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const hash = (i, s) => { const h = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return h - Math.floor(h); };

// ---------------------------------------------------------------- caustics

/**
 * this.caus = new K.Caustics(r);                       // 8 frames, atmosphere ramp
 * update:  this.caus.update(dt, 0.6 + k * 0.6);         // speed multiplier
 * render:  this.caus.draw(r, this.ground.mesh, { brightness: lerp(0.07, 0.4, k), uvScale: [0.6, 0.6] });
 *          this.caus.draw(r, colMesh, { inst: colInst, brightness });   // instanced meshes too
 */
export class Caustics {
  constructor(r, { frames = 8, ramp = 3, fps = 6 } = {}) {
    this.tex = caustics({ frames, ramp }).map((f) => r.texture(f));
    this.fps = fps; this.t = 0; this.tint = [0, 0, 0];
  }
  update(dt, speed = 1) { this.t += dt * speed; }
  get frame() { return this.tex[Math.floor(this.t * this.fps) % this.tex.length]; }
  draw(r, mesh, { model, inst, brightness = 0.3, uvScale = [1, 1], drift = 0.03 } = {}) {
    this.tint[0] = this.tint[1] = this.tint[2] = brightness;
    const d = this.t * drift;
    const o = { texture: this.frame, additive: true, unlit: true, tint: this.tint, uvScale, uvOffset: [d, d * 0.6] };
    if (inst) r.drawInstanced(mesh, inst, { ...o, model }); else r.draw(mesh, model, o);
  }
  dispose(r) { this.tex.forEach((t) => r.deleteTexture(t)); }
}

// ---------------------------------------------------------------- streak lines

let _lineGeo = null;
const lineGeo = () => {
  if (_lineGeo) return _lineGeo;
  const g = new GeoBuilder();   // two crossed thin quads along +Z, so they read from any angle
  g.quad([-0.012, 0, 0], [0.012, 0, 0], [0.012, 0, 1], [-0.012, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1], [0, 1, 0]);
  g.quad([0, -0.012, 0], [0, 0.012, 0], [0, 0.012, 1], [0, -0.012, 1], [0, 0], [1, 0], [1, 1], [0, 1], [1, 0, 0]);
  return (_lineGeo = g.build());
};

/**
 * Thin lines aligned with the view direction that stream towards the camera.
 * Fast: speed lines. Slow + sparse: wind or drifting light threads for calm scenes.
 *
 *   this.lines = new K.Streaks(r, { count: 40, color: R(1, 3) });
 *   update: this.lines.update(dt, cam.eye, cam.target, { amount: K.stage(k, .25, .75), speed: 20 });
 *   render: this.lines.draw(r, { brightness: 1 });
 */
export class Streaks {
  constructor(r, { count = 40, color = R(1, 3), lateral = [3, 12], vertical = [-1.5, 3.5], length = [2, 7], depth = 70, width = 1 } = {}) {
    this.mesh = r.createMesh(lineGeo());
    this.tex = r.texture(make(2, 2, () => color));
    this.inst = r.createInstances(count);
    this.depth = depth; this.width = width; this.tint = [1, 1, 1];
    this.lines = Array.from({ length: count }, (_, i) => ({
      lat: (i % 2 ? 1 : -1) * (lateral[0] + hash(i, 1) * (lateral[1] - lateral[0])),
      up: vertical[0] + hash(i, 2) * (vertical[1] - vertical[0]),
      z: hash(i, 3) * depth - 5,
      len: length[0] + hash(i, 4) * (length[1] - length[0]),
    }));
  }

  /** amount 0..1 (brightness of the field), speed = units/s towards the camera, lenScale stretches. */
  update(dt, eye, target, { amount = 1, speed = 10, lenScale = 1 } = {}) {
    let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;   // right = f × up
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;                       // up = right × f
    const yaw = Math.atan2(fx, fz), D = this.depth;
    this.lines.forEach((l, i) => {
      l.z -= speed * dt;
      if (l.z < -8) l.z += D + 5;
      const fade = clamp01((l.z + 8) / 8) * clamp01((D - 3 - l.z) / 20);
      const x = eye[0] + fx * l.z + rx * l.lat + ux * l.up, y = eye[1] + fy * l.z + uy * l.up, z = eye[2] + fz * l.z + rz * l.lat + uz * l.up;
      this.inst.set(i, x, y, z, l.len * lenScale, yaw, amount * fade, 0, this.width);
    });
    this.inst.upload(this.lines.length);
  }

  draw(r, { brightness = 1 } = {}) {
    this.tint[0] = this.tint[1] = this.tint[2] = brightness;
    r.drawInstanced(this.mesh, this.inst, { texture: this.tex, unlit: true, additive: true, tint: this.tint });
  }
  dispose(r) { this.mesh.dispose(); r.deleteTexture(this.tex); this.inst.dispose(); }
}

// ---------------------------------------------------------------- travelling pulses

/**
 * Pulses running along a 1D path coordinate s (a light strip, a ribbon, a corridor).
 * Pure maths: you read the level per segment and colour your mesh with it.
 *
 *   this.pulses = new K.Pulses({ loop: pathLength, width: 9 });
 *   on a beat:   this.pulses.trigger(cam.s + 6, 1, 25)    // start ahead of the camera, run forward
 *   update:      this.pulses.update(dt)
 *   per segment: brightness = base + this.pulses.at(segS) * k
 */
export class Pulses {
  constructor({ loop = 0, width = 9, decay = 0.7, max = 16 } = {}) {
    this.loop = loop; this.width = width; this.decay = decay; this.max = max;
    this.list = [];
  }
  trigger(s, amp = 1, vel = 0) {
    this.list.push({ s, amp, vel });
    if (this.list.length > this.max) this.list.shift();
  }
  update(dt) {
    const k = Math.exp(-dt / Math.max(0.01, this.decay));
    for (const p of this.list) { p.s += p.vel * dt; p.amp *= k; }
    this.list = this.list.filter((p) => p.amp > 0.01);
  }
  /** Summed pulse level at s (0 when none), smooth triangle falloff over `width`. */
  at(s) {
    let v = 0;
    for (const p of this.list) {
      let d = s - p.s;
      if (this.loop > 0) { d = ((d % this.loop) + this.loop) % this.loop; if (d > this.loop / 2) d -= this.loop; }
      const f = Math.max(0, 1 - Math.abs(d) / this.width);
      v += p.amp * f * f * (3 - 2 * f);
    }
    return v;
  }
}

// ---------------------------------------------------------------- water ripples

/** Thin ring with a dithered inner edge. 32x32. */
export function ringSprite({ index = R(3, 3) } = {}) {
  return make(32, 32, (x, y) => {
    const d = Math.hypot(x - 15.5, y - 15.5) / 15.5;
    if (d > 1 || d < 0.78) return CLEAR;
    return d > 0.86 || (d - 0.78) / 0.08 > bayer(x, y) ? index : CLEAR;
  });
}

/**
 * Rings that spread on still water and fade. Additive, flat on the plane.
 *
 *   this.ripples = new K.Ripples(r, { color: R(3, 3) });
 *   on a beat:  this.ripples.spawn(x, waterY, z, 2.5)
 *   update:     this.ripples.update(dt)
 *   render:     this.ripples.draw(r, { brightness: lerp(0.3, 0.8, k) })
 */
export class Ripples {
  constructor(r, { max = 32, color = R(3, 3), life = 3.5, grow = 1 } = {}) {
    this.mesh = r.createMesh(decal(1, 1, 0.03));
    this.tex = r.texture(ringSprite({ index: color }));
    this.inst = r.createInstances(max);
    this.life = life; this.grow = grow; this.max = max; this.tint = [1, 1, 1];
    this.list = [];
  }
  /** size = final diameter in world units. */
  spawn(x, y, z, size = 3) {
    this.list.push({ x, y, z, size, t: 0 });
    if (this.list.length > this.max) this.list.shift();
  }
  update(dt) {
    let n = 0;
    this.list = this.list.filter((p) => (p.t += dt) < this.life);
    for (const p of this.list) {
      const a = p.t / this.life, e = 1 - (1 - a) * (1 - a);                  // ease-out growth
      this.inst.set(n++, p.x, p.y, p.z, p.size * (0.15 + 0.85 * e) * this.grow, 0, (1 - a) * (1 - a), 0, 1);
    }
    this.inst.upload(n);
  }
  draw(r, { brightness = 1 } = {}) {
    if (!this.list.length) return;
    this.tint[0] = this.tint[1] = this.tint[2] = brightness;
    r.drawInstanced(this.mesh, this.inst, { texture: this.tex, unlit: true, additive: true, tint: this.tint });
  }
  dispose(r) { this.mesh.dispose(); r.deleteTexture(this.tex); this.inst.dispose(); }
}

