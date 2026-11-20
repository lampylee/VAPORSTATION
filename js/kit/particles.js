// Weather & atmosphere particles: one instanced draw per field. Particles live
// in a box around the camera and wrap around it, so the field is infinite.
//
//   this.snow = new Particles(r, 'snow');
//   update: this.snow.update(dt, eye, { amount: swell(k, 0.3, 1), speed: 1 + bass * k });
//   render: this.snow.draw(r, { brightness });
//
// Kit v4: overrides.texture = your own indexed generator (pages, confetti, feathers),
// and gust(strength) = a wind burst that whips the field and eases off (beats, bass hits).
import { R } from '../palette/palette.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { dot, streak, glow, petal, leaf, twinkle, mistBank } from './sprites.js';

/** Presets. color = palette index, area = box size around the camera. */
export const PARTICLE_PRESETS = {
  rain: { count: 700, sprite: 'streak', size: 0.06, height: 9, vel: [0.6, -26, 0], jitter: [0.2, 4, 0.2], area: [32, 22, 32], color: R(3, 3), additive: true, glow: 0.5 },
  snow: { count: 500, sprite: 'dot', size: 0.12, vel: [0.2, -1.3, 0], jitter: [0.4, 0.4, 0.4], wobble: 0.8, area: [30, 18, 30], color: R(3, 3) },
  ash: { count: 400, sprite: 'dot', size: 0.1, vel: [0.3, -0.6, 0.1], jitter: [0.3, 0.3, 0.3], wobble: 1.2, area: [30, 16, 30], color: R(3, 2) },
  embers: { count: 220, sprite: 'glow', size: 0.22, vel: [0, 1.6, 0], jitter: [0.5, 0.8, 0.5], wobble: 1.5, area: [26, 14, 26], color: R(2, 3), additive: true, glow: 1, flicker: 1 },
  dust: { count: 260, sprite: 'dot', size: 0.06, vel: [0.15, 0.05, 0], jitter: [0.2, 0.2, 0.2], wobble: 0.6, area: [20, 10, 20], color: R(3, 3), additive: true, glow: 0.35 },
  fireflies: { count: 120, sprite: 'glow', size: 0.25, vel: [0, 0.1, 0], jitter: [0.6, 0.4, 0.6], wobble: 2.2, area: [30, 6, 30], yOffset: -1, color: R(2, 3), additive: true, glow: 1, flicker: 1 },
  bubbles: { count: 200, sprite: 'dot', size: 0.14, vel: [0, 1.4, 0], jitter: [0.2, 0.6, 0.2], wobble: 1, area: [24, 16, 24], color: R(1, 3), additive: true, glow: 0.6 },
  // Kit v3: calm / slow-song presets
  petals: { count: 160, sprite: 'petal', size: 0.16, vel: [0.4, -0.6, 0.2], jitter: [0.3, 0.25, 0.3], wobble: 1.4, spin: 2, area: [30, 16, 30], color: R(2, 3) },
  leaves: { count: 110, sprite: 'leaf', size: 0.22, vel: [0.6, -0.85, 0], jitter: [0.4, 0.3, 0.4], wobble: 1.8, spin: 3, area: [30, 16, 30], color: R(1, 2) },
  pollen: { count: 160, sprite: 'glow', size: 0.07, vel: [0.12, 0.06, 0.05], jitter: [0.15, 0.1, 0.15], wobble: 0.9, area: [22, 8, 22], color: R(2, 3), additive: true, glow: 0.55, flicker: 1, flickerRate: 1.6 },
  mist: { count: 18, sprite: 'mist', size: 10, height: 0.25, vel: [0.3, 0, 0.06], jitter: [0.12, 0, 0.12], area: [56, 1.5, 56], yOffset: -1.3, color: R(3, 3), opacity: 0.4 },
  drizzle: { count: 320, sprite: 'streak', size: 0.04, height: 6, vel: [0.2, -12, 0], jitter: [0.1, 2, 0.1], area: [30, 20, 30], color: R(3, 3), additive: true, glow: 0.3 },
  skyLanterns: { count: 40, sprite: 'glow', size: 0.4, vel: [0.12, 0.45, 0.05], jitter: [0.15, 0.15, 0.15], wobble: 0.35, area: [60, 30, 60], yOffset: 9, color: R(2, 3), additive: true, glow: 0.9, flicker: 1, flickerRate: 1.2 },
  starTwinkle: { count: 60, sprite: 'twinkle', size: 0.3, vel: [0, 0, 0], jitter: [0, 0, 0], area: [60, 20, 60], yOffset: 14, color: R(3, 3), additive: true, glow: 0.8, flicker: 1, flickerRate: 2.2 },
};
const SPRITES = { dot, streak, glow, petal, leaf, twinkle, mist: mistBank };
const RAMP_SPRITES = new Set(['glow', 'petal', 'leaf', 'mist']);   // these take a ramp, the rest a single index

let _quad = null;
function quad() {
  // pivot at the centre so particles rotate around themselves
  return _quad || (_quad = new GeoBuilder().quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build());
}

export class Particles {
  constructor(r, preset = 'snow', overrides = {}) {
    const p = { ...(typeof preset === 'string' ? PARTICLE_PRESETS[preset] : preset), ...overrides };
    this.p = p;
    this.mesh = r.createMesh(quad());
    const name = p.sprite || 'dot', sprite = SPRITES[name];
    this.tex = r.texture(p.texture ? (typeof p.texture === 'function' ? p.texture() : p.texture) : RAMP_SPRITES.has(name) ? sprite({ ramp: p.color >> 2 }) : sprite({ index: p.color }));
    this.inst = r.createInstances(p.count);
    const n = p.count, [ax, ay, az] = p.area;
    this.pos = new Float32Array(n * 3);
    this.vj = new Float32Array(n * 3);
    this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * ax; this.pos[i * 3 + 1] = (Math.random() - 0.5) * ay; this.pos[i * 3 + 2] = (Math.random() - 0.5) * az;
      for (let k = 0; k < 3; k++) this.vj[i * 3 + k] = (Math.random() - 0.5) * 2 * p.jitter[k];
      this.phase[i] = Math.random() * 100;
    }
    this.time = 0;
    this.visible = n;
    this.tint = [1, 1, 1];
    this.g = 0; this.gDir = [1, 0];
  }

  /**
   * Wind burst: speeds the field up by about 1 + strength and pushes it along dir [x, z],
   * easing off over `decay` s. Scale strength by audio.accent so Gentle stays gentle.
   */
  gust(strength = 1, dir = null, decay = 0.9) {
    this.g = Math.min(4, this.g + strength); this.gDecay = decay;
    if (dir) { const l = Math.hypot(dir[0], dir[1]) || 1; this.gDir[0] = dir[0] / l; this.gDir[1] = dir[1] / l; }
  }

  /**
   * amount: 0..1 fraction of particles shown; speed: velocity multiplier;
   * wind: extra [x, z] velocity.
   */
  update(dt, center, { amount = 1, speed = 1, wind = [0, 0] } = {}) {
    const p = this.p, n = p.count, [ax, ay, az] = p.area, P = this.pos, V = this.vj;
    this.time += dt;
    const t = this.time, wob = p.wobble || 0;
    this.g *= Math.exp(-dt / (this.gDecay || 0.9));
    const g = this.g, gs = speed * (1 + g), gw = g * 2.5;
    wind = [wind[0] + this.gDir[0] * gw, wind[1] + this.gDir[1] * gw];
    this.visible = Math.round(n * Math.max(0, Math.min(1, amount)));
    const cy = center[1] + (p.yOffset || 0);
    for (let i = 0; i < n; i++) {
      const o = i * 3, ph = this.phase[i];
      P[o] += ((p.vel[0] + V[o] + wind[0]) * gs + Math.sin(t * 0.9 + ph) * wob) * dt;
      P[o + 1] += (p.vel[1] + V[o + 1]) * gs * dt;
      P[o + 2] += ((p.vel[2] + V[o + 2] + wind[1]) * gs + Math.cos(t * 0.7 + ph) * wob) * dt;
      // wrap into the box around the camera
      const wx = ((P[o] - center[0] + ax / 2) % ax + ax) % ax - ax / 2;
      const wy = ((P[o + 1] - cy + ay / 2) % ay + ay) % ay - ay / 2;
      const wz = ((P[o + 2] - center[2] + az / 2) % az + az) % az - az / 2;
      P[o] = center[0] + wx; P[o + 1] = cy + wy; P[o + 2] = center[2] + wz;
      if (i < this.visible) {
        const fl = p.flicker ? 0.55 + 0.45 * Math.sin(t * (p.flickerRate || 9) + ph * 3) : 1;
        this.inst.set(i, P[o], P[o + 1], P[o + 2], p.size, 0, fl, 0, p.height || 1);
        if (p.spin) this.inst.tilt(i, 0, ph + t * p.spin * (ph % 2 > 1 ? 1 : -1));   // tumbling petals / leaves
      }
    }
    this.inst.upload(this.visible);
  }

  /** brightness scales colour (match your fog/intensity dimming); opacity = screen-door transparency. */
  draw(r, { brightness = 1, opacity = this.p.opacity ?? 1 } = {}) {
    const p = this.p, b = brightness * (p.additive ? (p.glow ?? 1) : 1);
    this.tint[0] = this.tint[1] = this.tint[2] = b;
    const upright = p.sprite === 'streak' || p.sprite === 'mist';
    r.drawInstanced(this.mesh, this.inst, { texture: this.tex, billboard: upright ? 1 : 2, unlit: true, additive: !!p.additive, tint: this.tint, opacity });
  }

  dispose(r) { this.mesh.dispose(); r.deleteTexture(this.tex); this.inst.dispose(); }
}
