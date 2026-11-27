// OSSUARY LIFT — an iron cage lift sinking down an endless shaft whose walls are
// stacked with ornamental skulls and bones. Torches on the walls rise past the cage
// and light the bone walls as they go (K.LightSet, best 4 near the cage).
//
// The world never moves: the wall texture scrolls (uvOffset) and the torches wrap
// round a 48-unit loop, hidden at both ends by the fog.
//
// Intensity: idle = a slow, quiet descent, dim torches, drifting dust.
// Playing = faster descent, brighter torches. Bass leans on the speed.
// Beat: the chains jolt the cage (camera spring, scaled by beatMotion; at Gentle a
// slow groove sway instead). Drop: a short free-fall; the passing torches stretch
// into streaks (taller flame / glow cards, no blur).
import { mat4, lerp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { GeoBuilder, merge } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const RAD = 5, SIDES = 16, SEG = 2, HALF = 24;   // shaft radius, wall sides, segment height, half length
const TEX_H = 8;                                  // world units per wall texture repeat (vertical)
const TORCHES = 16, SPAN = HALF * 2;
const CAGE_R = 1.4, BARS = 12, CAGE_H = 3;
const IDENT = mat4.create();

/** Inward-facing tube, world-scaled UVs (u: 4 repeats round, v: one per TEX_H, image top up). */
function shaftGeo() {
  const g = new GeoBuilder();
  for (let y = -HALF; y < HALF; y += SEG) {
    for (let i = 0; i < SIDES; i++) {
      const a0 = (i / SIDES) * Math.PI * 2, a1 = ((i + 1) / SIDES) * Math.PI * 2;
      const p = (a, h) => [Math.cos(a) * RAD, h, Math.sin(a) * RAD];
      const u0 = (i / SIDES) * 4, u1 = ((i + 1) / SIDES) * 4, vb = -y / TEX_H, vt = -(y + SEG) / TEX_H;
      g.quad(p(a0, y), p(a1, y), p(a1, y + SEG), p(a0, y + SEG), [u0, vb], [u1, vb], [u1, vt], [u0, vt]);
    }
  }
  return g.build();
}

/** One skull, centred on (cx, cy) in cell pixels; s = size, dim = shade drop. null = not on it. */
function skull(cx, cy, x, y, { s = 1, dim = 0, jaw = true, eye = 1.9 } = {}) {
  cx /= s; cy /= s;
  if (Math.hypot(Math.abs(cx) - 2.6, cy) < eye) return R(1, 0);
  if (Math.abs(cx) < 0.8 && cy > 2.5 && cy < 4.5) return R(1, 0);
  const cran = cy < 4 && (cx / 6.3) ** 2 + (cy / 7.5) ** 2 < 1;
  const jw = jaw && cy >= 4 && cy < 9 && Math.abs(cx) < 4 - (cy - 4) * 0.25;
  if (jw && cy > 6 && cy < 7.2 && (x & 1)) return R(1, 0);   // teeth gaps
  if (cran || jw) return K.dshade(0, 3.3 - dim - Math.hypot(cx + 1.5, cy + 2) / 5 - (cy > 4 ? 0.7 : 0), x, y);
  return null;
}

/**
 * 128x128 indexed, four bands: skulls, bones, skulls (half-cell stagger), bones. Each skull
 * cell rolls its own variant (jawless, wide-eyed, sunk lower, a dark niche holding a small
 * dim skull, or just soot), and each bone row its own stagger, so the wall never reads as a grid.
 */
function boneTex() {
  return K.makeIndexed(128, 128, (x, y) => {
    const soot = K.dshade(1, 0.6 + K.rnd(x >> 1, y >> 1, 3) * 1.1, x, y);
    const band = y >> 5, by = y & 31;
    if (!(band & 1)) {
      const xx = (x + (band === 2 ? 8 : 0)) & 127, cell = xx >> 4, v = K.rnd(cell, band, 11);
      const cx = (xx & 15) - 7.5, cy = by - 13 - (v > 0.55 && v < 0.65 ? 2 : 0);
      if (v < 0.13) {   // niche: dark arched hollow, a small dim skull at the back
        const arch = Math.abs(cx) < 6.5 && by > 3 && by < 27 && (by > 9 || Math.hypot(cx, by - 9.5) < 6.5);
        if (!arch) return soot;
        return skull(cx, by - 19, x, y, { s: 0.6, dim: 1.3, jaw: false }) ?? K.dshade(1, 0.2 + K.bayer(x, y) * 0.5, x, y);
      }
      if (v < 0.2) return soot;
      return skull(cx, cy, x, y, { jaw: v < 0.85, eye: v > 0.92 ? 2.3 : 1.9, dim: K.rnd(cell, band, 4) * 0.5 }) ?? soot;
    }
    const b = by >> 3, yy = by & 7, lx = (x + Math.floor(K.rnd(b, band, 7) * 32)) & 31;
    const knob = [[3, 2.6], [3, 5.4], [28, 2.6], [28, 5.4]].some(([kx, ky]) => Math.hypot(lx - kx, yy - ky) < 1.9);
    const shaft = lx > 3 && lx < 28 && Math.abs(yy - 4) < 1.3;
    if (knob || shaft) return K.dshade(0, 2.7 - Math.abs(yy - 3.5) * 0.45 - (knob ? 0 : 0.3) - K.rnd(x >> 5, b + band * 4, 2) * 0.5, x, y);
    return soot;
  });
}

const ironTex = () => K.makeIndexed(16, 16, (x, y) => K.dshade(1, 1.3 + K.rnd(x, y, 5) * 1.4 + ((x & 7) === 3 && (y & 7) === 3 ? 0.8 : 0), x, y));
const grateTex = () => K.makeIndexed(32, 32, (x, y) => ((x & 7) >= 2 && (y & 7) >= 2 ? K.CLEAR : K.dshade(1, 1.4 + K.rnd(x, y, 8) * 1.2, x, y)));
const chainTex = () => K.makeIndexed(8, 16, (x, y) => {
  const d = ((x - 3.5) / 3.5) ** 2 + ((y - 7.5) / 7.5) ** 2;
  return d < 1 && d > 0.35 ? K.dshade(1, 2.2 - d, x, y) : K.CLEAR;
});

export class OssuaryLift {
  static meta = { name: 'Ossuary Lift' };
  static palette = fromKeys('ossuarylift', 'Ossuary Lift', ['#c8b48a', '#3a302c', '#ff8a2a', '#2a0e0e']);

  init(r) {
    this.wallMesh = r.createMesh(shaftGeo());
    this.boneTex = r.texture(boneTex());
    this.ironTex = r.texture(ironTex());
    this.grateTex = r.texture(grateTex());
    this.chainTex = r.texture(chainTex());

    // cage: bars + top / bottom rims in one mesh, a grate floor, four chains up into the dark
    const parts = [];
    for (let i = 0; i < BARS; i++) {
      const a = (i / BARS) * Math.PI * 2;
      parts.push({ geo: K.props.shift(K.props.prism(4, 0.05, CAGE_H, { cap: false }), Math.cos(a) * CAGE_R, 0, Math.sin(a) * CAGE_R) });
    }
    parts.push({ geo: K.props.prism(SIDES, CAGE_R + 0.04, 0.12, { cap: false }) });
    parts.push({ geo: K.props.shift(K.props.prism(SIDES, CAGE_R + 0.04, 0.12, { cap: false }), 0, CAGE_H, 0) });
    this.cageMesh = r.createMesh(merge(parts));
    this.floorMesh = r.createMesh(K.props.prism(SIDES, CAGE_R, 0.04, { uvRepeat: [1, 1] }));
    this.chainMesh = r.createMesh(merge([[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z]) => ({
      geo: K.props.shift(K.props.prism(4, 0.06, 40, { cap: false, uvRepeat: [1, 60] }), x * 0.75, CAGE_H, z * 0.75),
    }))));

    // torches: an iron bracket + cup, a flame card and a glow card each
    this.bracketMesh = r.createMesh(merge([
      { geo: K.props.prism(4, 0.05, 0.45) },
      { geo: K.props.shift(K.props.prism(6, 0.13, 0.14, { taper: 1.4 }), 0, 0.42, 0) },
    ]));
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.flameTex = r.texture(K.sprites.flame({ ramp: 2 }));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.bracketInst = r.createInstances(TORCHES);
    this.flameInst = r.createInstances(TORCHES);
    this.glowInst = r.createInstances(TORCHES);
    this.torches = Array.from({ length: TORCHES }, (_, i) => {
      const a = i * 2.399 + 0.3;   // golden-angle spread round the shaft
      return { a, x: Math.cos(a) * (RAD - 0.35), z: Math.sin(a) * (RAD - 0.35), y0: (i / TORCHES) * SPAN, y: 0, flick: 1 };
    });

    this.lights = new K.LightSet({ reach: 8 });
    this.dust = new K.Particles(r, 'dust', { count: 180, vel: [0, 2.2, 0], area: [8, 14, 8] });

    this.jolt = new K.Spring(5);
    this.fall = 0;   // free-fall 0..1: not an Envelope, so it still reads as a fall at Gentle (it moves the world, not the camera)
    // song sections: quiet parts gutter the torches and close the fog in, the chorus opens the shaft up
    this.moods = new K.Moods({
      still: { glow: 0.6, fog: 12, pace: 0.6, lamp: 0.8 },
      base: { glow: 1, fog: 16, pace: 1, lamp: 0.6 },
      gather: { glow: 1.15, fog: 14, pace: 1.25, lamp: 0.5 },
      full: { glow: 1.4, fog: 20, pace: 1.6, lamp: 0.4 },
    }, { ease: 5 });
    this.mood = this.moods.update(null, 0);
    this.depth = 0; this.speed = 0.7; this.time = 0; this.dt = 1 / 60;
    this.yaw = 0; this.streak = 1;
    this.eye = [0, 1.5, 0]; this.target = [0, 0, 4]; this.cageY = 0;
    this.m = mat4.create(); this.k = 0; this.a = null;
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], torch: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.dt = dt; this.time += dt;
    const d = K.drive(a, k), t = this.time;

    // descent speed eases toward its target; a drop adds a short free-fall
    const m = this.mood = this.moods.update(a, dt);
    if (d.drop) this.fall = 1;
    this.fall *= Math.exp(-dt / 1.1);
    const want = lerp(0.7, 3.2, k) * m.pace + lerp(d.energy, d.bass, d.beatMotion) * 1.6 + this.fall * 32 * Math.max(k, 0.3);
    this.speed += (want - this.speed) * (1 - Math.exp(-dt / (this.fall > 0.1 ? 0.2 : 0.6)));
    this.depth += this.speed * dt;
    this.streak = 1 + Math.min(4, Math.max(0, this.speed - 4) * 0.3);

    // chains jolt the cage on the beat (Punchy); at Gentle a slow groove sway pays it back
    if (d.beat) this.jolt.kick(-1.2 * d.accent * d.beatMotion * k);
    this.jolt.update(dt);
    const sway = (1 - d.beatMotion) * d.groove * 0.05;
    this.cageY = this.jolt.x * 0.6 - sway;
    this.yaw = t * 0.05 + Math.sin(t * 0.11) * 0.7;
    const ey = 1.5 + this.jolt.x - sway;
    this.eye[0] = Math.sin(t * 0.17) * 0.15; this.eye[1] = ey; this.eye[2] = Math.cos(t * 0.13) * 0.15;
    // looking down the shaft, so torches come up from below
    this.target[0] = Math.cos(this.yaw) * 4; this.target[1] = ey - 1.7 + Math.sin(t * 0.19) * 0.6; this.target[2] = Math.sin(this.yaw) * 4;

    // torches rise past; wrap at the fogged ends
    const lvl = lerp(0.55, 1, k) * (1 + d.high * 0.4) * m.glow;
    this.torches.forEach((tc, i) => {
      tc.y = ((((tc.y0 + this.depth) % SPAN) + SPAN) % SPAN) - HALF;
      tc.flick = lvl * (0.82 + 0.1 * Math.sin(t * 9.3 + i * 4.1) + 0.08 * Math.sin(t * 17.1 + i * 2.3));
      this.bracketInst.set(i, tc.x, tc.y - 0.45, tc.z, 1, -tc.a, 1, 0, 1);
      this.flameInst.set(i, tc.x, tc.y + 0.05, tc.z, 0.32, 0, 1, 0, (1.9 + tc.flick * 0.6) * this.streak);
      this.glowInst.set(i, tc.x, tc.y + 0.3 + (this.streak - 1) * 0.4, tc.z, 1.5 * tc.flick, 0, tc.flick, 0, this.streak);
    });
    this.bracketInst.upload(TORCHES); this.flameInst.upload(TORCHES); this.glowInst.upload(TORCHES);

    this.dust.update(dt, this.eye, { amount: lerp(0.5, 1, k), speed: 0.4 + this.speed * 0.35 });
  }

  render(r) {
    const { col, k } = this, P = this.pal;
    const dim = lerp(0.7, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    r.setCamera(this.eye, this.target, { fov: 70, near: 0.1, far: 60 });
    r.setFog(col.fog, 3, Math.min(21, this.mood.fog * lerp(0.9, 1.05, k)));   // under the torch wrap distance (~24)
    r.setLight([0.2, -1, 0.1], scaleColor(col.light, P.role('light'), 0.25), scaleColor(col.amb, P.role('ambient'), lerp(0.4, 0.5, k)));

    const torch = P.color(R(2, 3));
    this.lights.begin();
    // a dim lantern hanging in the cage roof keeps the bars and grate readable between torches
    this.lights.add(100, 0, CAGE_H - 0.3 + this.cageY, 0, torch, 3.2, this.mood.lamp * (0.9 + 0.1 * Math.sin(this.time * 7.3)));
    this.torches.forEach((tc, i) => this.lights.add(i + 1, tc.x * 0.9, tc.y + 0.4, tc.z * 0.9, torch, 7.5, 2.2 * tc.flick));
    this.lights.apply(r, [this.eye[0], this.eye[1] - 1, this.eye[2]], this.dt);

    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    r.draw(this.wallMesh, IDENT, { texture: this.boneTex, uvOffset: [0, this.depth / TEX_H], tint: col.tint });
    r.drawInstanced(this.bracketMesh, this.bracketInst, { texture: this.ironTex, tint: col.tint });

    const cm = mat4.trs(this.m, 0, this.cageY, 0);
    r.draw(this.cageMesh, cm, { texture: this.ironTex, tint: col.tint });
    r.draw(this.floorMesh, cm, { texture: this.grateTex, twoSided: true, tint: col.tint });
    r.draw(this.chainMesh, cm, { texture: this.chainTex, twoSided: true, tint: col.tint });

    r.drawInstanced(this.quad, this.flameInst, { texture: this.flameTex, billboard: 1, unlit: true, tint: [1, 1, 1] });
    r.drawInstanced(this.quad, this.glowInst, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, depthWrite: false, fog: false, fade: [9, 20], tint: [1, 1, 1] });
    this.dust.draw(r, { brightness: dim * 0.8 });
  }

  dispose(r) {
    this.dust.dispose(r);
    [this.wallMesh, this.cageMesh, this.floorMesh, this.chainMesh, this.bracketMesh, this.quad].forEach((m) => m.dispose());
    [this.boneTex, this.ironTex, this.grateTex, this.chainTex, this.flameTex, this.glowTex].forEach((t) => r.deleteTexture(t));
    [this.bracketInst, this.flameInst, this.glowInst].forEach((i) => i.dispose());
  }
}
