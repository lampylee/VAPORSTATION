// Weather & atmosphere particles: one instanced draw per field. Particles live
// in a box around the camera and wrap around it, so the field is infinite.
//
//   this.snow = new Particles(r, 'snow');
//   update: this.snow.update(dt, eye, { amount: swell(k, 0.3, 1), speed: 1 + bass * k });
//   render: this.snow.draw(r, { brightness });
import { R } from '../palette/palette.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { dot, streak, glow } from './sprites.js';

/** Presets. color = palette index, area = box size around the camera. */
export const PARTICLE_PRESETS = {
  rain: { count: 700, sprite: 'streak', size: 0.06, height: 9, vel: [0.6, -26, 0], jitter: [0.2, 4, 0.2], area: [32, 22, 32], color: R(3, 3), additive: true, glow: 0.5 },
  snow: { count: 500, sprite: 'dot', size: 0.12, vel: [0.2, -1.3, 0], jitter: [0.4, 0.4, 0.4], wobble: 0.8, area: [30, 18, 30], color: R(3, 3) },
  ash: { count: 400, sprite: 'dot', size: 0.1, vel: [0.3, -0.6, 0.1], jitter: [0.3, 0.3, 0.3], wobble: 1.2, area: [30, 16, 30], color: R(3, 2) },
  embers: { count: 220, sprite: 'glow', size: 0.22, vel: [0, 1.6, 0], jitter: [0.5, 0.8, 0.5], wobble: 1.5, area: [26, 14, 26], color: R(2, 3), additive: true, glow: 1, flicker: 1 },
  dust: { count: 260, sprite: 'dot', size: 0.06, vel: [0.15, 0.05, 0], jitter: [0.2, 0.2, 0.2], wobble: 0.6, area: [20, 10, 20], color: R(3, 3), additive: true, glow: 0.35 },
  fireflies: { count: 120, sprite: 'glow', size: 0.25, vel: [0, 0.1, 0], jitter: [0.6, 0.4, 0.6], wobble: 2.2, area: [30, 6, 30], yOffset: -1, color: R(2, 3), additive: true, glow: 1, flicker: 1 },
  bubbles: { count: 200, sprite: 'dot', size: 0.14, vel: [0, 1.4, 0], jitter: [0.2, 0.6, 0.2], wobble: 1, area: [24, 16, 24], color: R(1, 3), additive: true, glow: 0.6 },
};

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
    const sprite = { dot, streak, glow }[p.sprite || 'dot'];
    this.tex = r.texture(p.sprite === 'glow' ? glow({ ramp: p.color >> 2 }) : sprite({ index: p.color }));
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
  }

  /**
   * amount: 0..1 fraction of particles shown; speed: velocity multiplier;
   * wind: extra [x, z] velocity.
   */
  update(dt, center, { amount = 1, speed = 1, wind = [0, 0] } = {}) {
    const p = this.p, n = p.count, [ax, ay, az] = p.area, P = this.pos, V = this.vj;
    this.time += dt;
    const t = this.time, wob = p.wobble || 0;
    this.visible = Math.round(n * Math.max(0, Math.min(1, amount)));
    const cy = center[1] + (p.yOffset || 0);
    for (let i = 0; i < n; i++) {
      const o = i * 3, ph = this.phase[i];
      P[o] += ((p.vel[0] + V[o] + wind[0]) * speed + Math.sin(t * 0.9 + ph) * wob) * dt;
      P[o + 1] += (p.vel[1] + V[o + 1]) * speed * dt;
      P[o + 2] += ((p.vel[2] + V[o + 2] + wind[1]) * speed + Math.cos(t * 0.7 + ph) * wob) * dt;
      // wrap into the box around the camera
      const wx = ((P[o] - center[0] + ax / 2) % ax + ax) % ax - ax / 2;
      const wy = ((P[o + 1] - cy + ay / 2) % ay + ay) % ay - ay / 2;
      const wz = ((P[o + 2] - center[2] + az / 2) % az + az) % az - az / 2;
      P[o] = center[0] + wx; P[o + 1] = cy + wy; P[o + 2] = center[2] + wz;
      if (i < this.visible) {
        const fl = p.flicker ? 0.55 + 0.45 * Math.sin(t * 9 + ph * 3) : 1;
        this.inst.set(i, P[o], P[o + 1], P[o + 2], p.size, 0, fl, 0, p.height || 1);
      }
    }
    this.inst.upload(this.visible);
  }

  /** brightness scales colour (match your fog/intensity dimming). */
  draw(r, { brightness = 1 } = {}) {
    const p = this.p, b = brightness * (p.additive ? (p.glow ?? 1) : 1);
    this.tint[0] = this.tint[1] = this.tint[2] = b;
    r.drawInstanced(this.mesh, this.inst, { texture: this.tex, billboard: p.sprite === 'streak' ? 1 : 2, unlit: true, additive: !!p.additive, tint: this.tint });
  }

  dispose(r) { this.mesh.dispose(); r.deleteTexture(this.tex); this.inst.dispose(); }
}
