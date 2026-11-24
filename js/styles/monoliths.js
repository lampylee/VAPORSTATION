// Style: MONOLITHS — drifting through an endless foggy field of carved stone
// slabs and floating crystals over a glowing grid, under a banded sun.
//   bass  -> stone scale pulse rippling outward from the camera, drift speed, sun swell
//   mid   -> floating crystal bob + spin
//   high  -> rising shards (count + brightness)
//   beat  -> a different subset of stones flashes each beat, camera nudge
// Colours: base = stone, secondary = crystals/shards, accent = glyphs/sun/flash, atmosphere = fog + grid.
import { mat4, damp, lerp, hash } from '../gfx/math.js';
import { scaleColor, addColor } from '../gfx/color.js';
import { box, plane, octahedron, tetrahedron, disc } from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import { R } from '../palette/palette.js';
import { STYLE_PALETTES } from '../palette/library.js';

const CELL = 12, GROUND = 192, SHARDS = 40;

export class Monoliths {
  static meta = { name: 'Monoliths' };
  static palette = STYLE_PALETTES.monoliths;

  init(r) {
    this.tex = {
      ground: r.texture(T.grid({ bg: R(3, 0), line: R(1, 2), glow: R(1, 0), cells: 2, thick: 1 })),
      stone: r.texture(T.glyphStone({ ramp: 0, glyph: R(2, 3) })),
      crystal: r.texture(T.blotch({ ramp: 1, scale: 8, minShade: 1 })),
      sun: r.texture(T.bandedSun({ ramp: 2 })),
    };
    // 4-unit quads: big enough to swim, small enough not to collapse near the camera
    this.ground = r.createMesh(plane(GROUND, GROUND / 4, GROUND / 4));
    this.slab = r.createMesh(box(1.6, 6, 0.7, { uvRepeat: [1, 3] }));
    this.crystal = r.createMesh(octahedron(1.1));
    this.tetra = r.createMesh(tetrahedron(0.9));
    this.shard = r.createMesh(tetrahedron(0.16));
    this.sun = r.createMesh(disc(16, 1));
    this.shards = Array.from({ length: SHARDS }, (_, i) => ({
      x: (Math.random() - 0.5) * 30, z: -Math.random() * 30, ph: Math.random() * 8, sp: 0.6 + Math.random(), order: i / SHARDS,
    }));
    this.hist = new Float32Array(64);
    this.time = 0; this.z = 0; this.speed = 1; this.flash = 0; this.beatCount = 0;
    this.nudge = 0; this.nudgeVel = 0; this.bassS = 0; this.midS = 0; this.crystT = 0; this.spinT = 0; this.k = 0; this.a = null;
    this.m = mat4.create();
    this.eye = [0, 0, 0]; this.tgt = [0, 0, 0];
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], emi: [0, 0, 0], t2: [0, 0, 0], shard: [0, 0, 0], sun: [0, 0, 0], ground: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k;
    this.time += dt;
    // bass drives motion directly only at Punchy; at Gentle it is eased
    const bm = a.beatMotion ?? 1;
    this.bassS = damp(this.bassS, a.bass * k, 0.5, dt);
    this.midS = damp(this.midS, a.mid * k, 0.5, dt);
    const bassM = lerp(this.bassS, a.bass * k, bm);
    const midM = lerp(this.midS, a.mid * k, bm);
    this.midM = midM;
    this.crystT += dt * (0.5 + midM); this.spinT += dt * (0.3 + midM * 1.5); // integrated phases: no jump when mid changes
    this.speed = damp(this.speed, lerp(1.0, 4.5, k) + bassM * 4, 0.4, dt);
    this.z += this.speed * dt;
    this.hist.copyWithin(1, 0); this.hist[0] = bassM;
    if (a.beat) { this.flash = Math.max(this.flash, k * (a.accent ?? 1)); this.beatCount++; this.nudgeVel += 2.2 * k * (a.motion ?? 1) * bm; }
    this.flash *= Math.exp(-dt / (0.3 * (a.decay ?? 1)));
    const w = 6;
    this.nudgeVel += (-this.nudge * w * w - 2 * w * this.nudgeVel) * dt;
    this.nudge += this.nudgeVel * dt;
  }

  render(r) {
    const { col, m, k, eye, tgt } = this, a = this.a, t = this.time, P = this.pal;
    scaleColor(col.fog, P.role('fog'), lerp(0.75, 1, k));
    r.clear(col.fog);
    eye[0] = Math.sin(t * 0.07) * 6; eye[1] = 2.6 + Math.sin(t * 0.11) * 0.6 + this.nudge * 0.35; eye[2] = -this.z;
    tgt[0] = eye[0] + Math.sin(t * 0.05) * 3; tgt[1] = eye[1] - 0.5 + this.nudge * 0.1; tgt[2] = eye[2] - 10;
    r.setCamera(eye, tgt, { fov: 62, near: 0.1, far: 220, roll: Math.sin(t * 0.09) * 0.05 });
    r.setLight([-0.5, -0.6, -0.4], scaleColor(col.light, P.role('light'), 0.9), scaleColor(col.amb, P.role('ambient'), 0.5));

    // sun: no fog, behind everything
    r.setFog(col.fog, 1000, 2000);
    const sunS = 26 * (1 + lerp(this.bassS, a.bass * k, a.beatMotion ?? 1) * 0.12);
    const sb = 0.6 + 0.4 * k;
    col.sun[0] = col.sun[1] = col.sun[2] = sb;
    r.draw(this.sun, mat4.trs(m, eye[0], 16, eye[2] - 140, 0, 0, 0, sunS), { texture: this.tex.sun, unlit: true, fog: false, depthWrite: false, tint: col.sun });

    r.setFog(col.fog, 4, lerp(30, 58, k));
    // ground follows the camera, snapped to one texture repeat so it never slides
    const gx = Math.round(eye[0] / 4) * 4, gz = Math.round(eye[2] / 4) * 4;
    const gb = 0.6 + 0.4 * k + this.flash * 0.3;
    col.ground[0] = col.ground[1] = col.ground[2] = gb;
    r.draw(this.ground, mat4.trs(m, gx, 0, gz), { texture: this.tex.ground, tint: col.ground, unlit: true });

    // field of monoliths (deterministic per grid cell -> infinite)

    const dim = lerp(0.55, 1, k);
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    const cx = Math.floor(eye[0] / CELL), cz = Math.floor(eye[2] / CELL);
    for (let gzI = cz - 6; gzI <= cz + 1; gzI++) for (let gxI = cx - 4; gxI <= cx + 4; gxI++) {
      const h = hash(gxI, gzI);
      if (h < 0.4) continue;
      const x = (gxI + 0.15 + 0.7 * hash(gxI, gzI, 1)) * CELL, z = (gzI + 0.15 + 0.7 * hash(gxI, gzI, 2)) * CELL;
      const dist = Math.hypot(x - eye[0], z - eye[2]);
      const pulse = 1 + this.hist[Math.min(63, Math.floor(dist * 0.9))] * 0.3;
      const sel = ((Math.floor(hash(gxI, gzI, 5) * 1000) + this.beatCount) % 4) === 0;
      const fl = sel ? this.flash : 0;
      addColor(col.t2, col.tint, [1, 1, 1], fl * 0.8);
      scaleColor(col.emi, P.role('flash'), fl * 0.25);
      const type = hash(gxI, gzI, 3);
      if (type < 0.62) {
        const hs = 0.7 + hash(gxI, gzI, 4) * 0.8;
        mat4.trs(m, x, 3 * hs * pulse, z, 0, hash(gxI, gzI, 6) * 3, (hash(gxI, gzI, 7) - 0.5) * 0.15, pulse, hs * pulse, pulse);
        r.draw(this.slab, m, { texture: this.tex.stone, tint: col.t2, emissive: col.emi });
      } else {
        const ph = h * 20;
        const y = 3.4 + Math.sin(this.crystT + ph) * (0.5 + this.midM * 0.8) + this.nudge * fl * 0.5;
        const spin = this.spinT + ph;
        mat4.trs(m, x, y, z, spin * 0.5, spin, 0, pulse);
        r.draw(type < 0.85 ? this.crystal : this.tetra, m, { texture: this.tex.crystal, tint: col.t2, emissive: col.emi });
      }
    }

    // rising shards, count + brightness from highs
    const visible = 0.1 + 0.9 * Math.min(1, a.high * k * 1.4);
    scaleColor(col.shard, P.color(R(1, 3)), 0.3 + a.high * k * 1.2);
    for (const s of this.shards) {
      if (s.order > visible) break;
      const y = ((t * s.sp + s.ph) % 8) - 0.5;
      const z = eye[2] - 4 - (((s.z - eye[2]) % 30) + 30) % 30;
      mat4.trs(m, eye[0] + s.x, y, z, t * 2 + s.ph, t * 3, 0);
      r.draw(this.shard, m, { tint: [0, 0, 0], emissive: col.shard, unlit: true, additive: true });
    }
  }

  dispose(r) {
    Object.values(this.tex).forEach((t) => r.deleteTexture(t));
    [this.ground, this.slab, this.crystal, this.tetra, this.shard, this.sun].forEach((x) => x.dispose());
  }
}
