// PAPER CROWD — "You and Whose Army?" (wave 4b, Amnesiac palette).
//
// A dim maroon hall raked in tiers, filled with rows of flat paper cut-out
// figures facing one microphone on a stand at the front.
//
//   idle   the figures lie back on their tiers, faces up (paper sides lit), the hall is
//          dark, the mic head glows faintly in a small pool of light
//   swell  the rows stand up one after another, front to back (K.stage per
//          row, then damped, so even a sudden intensity jump eases in);
//          wall sconces warm up, overhead light shafts and dust appear
//   beat   one soft ripple travels from the front row to the back
//          (K.Pulses over the row index): the figures lean back and hop a
//          little as it passes, scaled by audio.accent / audio.motion
//   camera a slow, low glide behind and beside the mic, looking at the crowd
//
// Song sections (K.Moods, Conductor on): intro / breakdown / outro leave the figures slumped and
// the hall dark (only the mic lit); a build stands the rows up front to back, sooner than k alone;
// the drop has them all standing, the hall lamps up and a slow ripple rolling through the rows
// (steady, not on beats). Conductor off = base (today's look).
//
// Kit used: CameraRig (local subclass), stage, drive, Pulses, Breath,
// Envelope, makeIndexed/dshade/ditherPick, atlasUV, decal, props.prism,
// tex.boards, sprites.glow/lightShaft, Particles('dust'), instance tilt.
import { mat4, lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, merge } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const ROWS = 14, PER_ROW = 15;
const ROW_Z0 = 3, ROW_DZ = 1.6, ROW_RISE = 0.22;   // tiered floor
const HALL_W = 8.5, HALL_Z0 = -12, HALL_Z1 = 30, HALL_H = 6.5;
const VARIANTS = 4;                                  // silhouettes in the atlas
const FIG_W = 0.9, FIG_H = 1.8;
const SCONCES = 6;

const rowZ = (i) => ROW_Z0 + i * ROW_DZ;
const rowY = (i) => i * ROW_RISE;

/** Slow glide behind and beside the mic, always looking out at the crowd. */
class GlideRig extends K.CameraRig {
  constructor() {
    super({ fov: 58, near: 0.1, far: 60, fovPunch: 1.2, nudge: 0.05, rollKick: 0.008, idleSpeed: 0.045, activeSpeed: 0.09, bassBoost: 0 });
    this.p = 1.3; this.lift = 0;
  }
  update(audio, k, dt) {
    super.update(audio, k, dt);
    this.p += this.speed * dt;
    const p = this.p;
    this.lift = damp(this.lift, k, 2.5, dt);           // rises a little as the crowd stands
    this.eye[0] = Math.sin(p) * 2.3;
    this.eye[1] = 1.15 + Math.sin(p * 0.63) * 0.2 + this.lift * 0.35;
    this.eye[2] = -4.3 + Math.sin(p * 0.41 + 1) * 1.5;
    this.target[0] = this.eye[0] * 0.25;
    this.target[1] = 1.6 + this.lift * 0.4;
    this.target[2] = 13;
  }
}

/** Four generic paper cut-out silhouettes side by side (32x64 each), cream paper with a cut edge. */
function figureAtlas() {
  const W = 32, H = 64;
  // half-width of the body at row y for each variant (0 = outside)
  const shapes = [
    // plain: round head, sloped shoulders
    (y) => (y < 4 ? 0 : y < 18 ? Math.sqrt(Math.max(0, 49 - (y - 11) ** 2)) : y < 21 ? 3 : y < 28 ? 4 + (y - 21) * 1.6 : y < 60 ? 14 - (y - 28) * 0.06 : 0),
    // broad: square shoulders
    (y) => (y < 3 ? 0 : y < 17 ? Math.sqrt(Math.max(0, 42 - (y - 10) ** 2)) : y < 20 ? 3.5 : y < 24 ? 6 + (y - 20) * 2.4 : y < 61 ? 15 : 0),
    // narrow: smaller head, slim body
    (y) => (y < 6 ? 0 : y < 18 ? Math.sqrt(Math.max(0, 30 - (y - 12) ** 2)) : y < 21 ? 2.5 : y < 30 ? 3.5 + (y - 21) * 1.0 : y < 60 ? 11.5 + (y - 30) * 0.05 : 0),
    // tall head with a flat top (cap-like), coat flaring at the hem
    (y) => (y < 2 ? 0 : y < 5 ? 6.5 : y < 17 ? Math.sqrt(Math.max(0, 40 - (y - 10) ** 2)) : y < 20 ? 3 : y < 27 ? 4 + (y - 20) * 1.5 : y < 62 ? 12 + (y - 27) * 0.08 : 0),
  ];
  return K.makeIndexed(W * VARIANTS, H, (x, y) => {
    const v = Math.floor(x / W), lx = x % W, cx = 15.5;
    const hw = shapes[v](y) + (K.rnd(v, y, 5) - 0.5) * 0.9;   // scissor-rough edge
    const d = Math.abs(lx - cx);
    if (hw <= 0 || d > hw) return K.CLEAR;
    if (hw - d < 1) return R(1, 1);                              // cut edge
    // paper: fibres, a soft vertical fold, a little darker towards the feet
    let s = 2.45 + K.blobNoise(lx + v * 40, y, 5, 3) * 0.55 - y / 140;
    if (Math.abs(lx - cx) < 0.6) s -= 0.6;                       // centre crease
    if (K.rnd(lx, y, v + 11) > 0.93) s -= 0.5;                   // fibre specks
    return K.dshade(1, s, lx, y);
  });
}

/** Faded maroon wallpaper with wainscot (tileable, 32x64): vertical stripes over panelled boards. */
function wallTex() {
  return K.makeIndexed(32, 64, (x, y) => {
    if (y > 44) {                                                // wainscot
      if (y === 45 || y === 63 || x % 16 === 0) return R(0, 0);
      return K.dshade(0, 1.1 + K.blobNoise(x, y, 6, 4) * 0.5, x, y);
    }
    if (y === 44 || y === 43) return R(0, 2);                    // dado rail
    const stripe = (x % 8) < 2 ? 0.55 : 0;
    const motif = ((x + 4) % 8 === 0 && y % 8 === 3) ? 0.7 : 0;
    return K.dshade(0, 1.0 + stripe + motif + K.blobNoise(x, y, 9, 2) * 0.5 - y / 120, x, y);
  });
}

/** Round light pool for the floor: accent shades fading out with dither. 32x32. */
function poolTex() {
  return K.makeIndexed(32, 32, (x, y) => {
    const d = Math.hypot(x - 15.5, y - 15.5) / 16;
    if (d > 1) return K.CLEAR;
    return K.ditherPick(K.dshade(2, 2.6 - d * 2.4, x, y), K.CLEAR, d * d * 1.1, x, y);
  });
}

/** Dark stand metal. 16x16. */
function metalTex() {
  return K.makeIndexed(16, 16, (x, y) => K.dshade(3, 0.4 + K.blobNoise(x, y, 4, 7) * 0.8 + (x === 7 ? 0.6 : 0), x, y));
}

export class PaperCrowd {
  static meta = { name: 'Paper Crowd' };
  static palette = ALBUM_PALETTES.amnesiac;

  init(r) {
    this.cam = new GlideRig();

    // ---- hall: tiered floor + stage, side walls, back wall, ceiling
    const floor = new GeoBuilder();
    const wz0 = HALL_Z0, firstEdge = rowZ(0) - ROW_DZ / 2;
    floor.face([0, 0, (wz0 + firstEdge) / 2], [HALL_W, 0, 0], [0, 0, -(firstEdge - wz0) / 2], [0, 0, HALL_W / 2, (firstEdge - wz0) / 4], 6);
    for (let i = 0; i < ROWS; i++) {
      const z = rowZ(i), y = rowY(i), prev = i ? rowY(i - 1) : 0;
      const zEnd = i === ROWS - 1 ? HALL_Z1 : z + ROW_DZ / 2, zc = (z - ROW_DZ / 2 + zEnd) / 2, hl = (zEnd - (z - ROW_DZ / 2)) / 2;
      floor.face([0, y, zc], [HALL_W, 0, 0], [0, 0, -hl], [0, 0, HALL_W / 2, hl / 2], 4);       // tread
      if (y > prev) floor.face([0, (y + prev) / 2, z - ROW_DZ / 2], [-HALL_W, 0, 0], [0, (y - prev) / 2, 0], [0, 0, HALL_W / 2, 0.1], 2); // riser
    }
    this.floorMesh = r.createMesh(floor.build());
    this.floorTex = r.texture(K.tex.boards({ ramp: 0 }));

    const walls = new GeoBuilder(), L = (HALL_Z1 - HALL_Z0) / 2, zc = (HALL_Z0 + HALL_Z1) / 2, hh = HALL_H / 2;
    walls.face([-HALL_W, hh, zc], [0, 0, -L], [0, hh, 0], [0, 0, L / 2, 1], 10);              // left, faces +x
    walls.face([HALL_W, hh, zc], [0, 0, L], [0, hh, 0], [0, 0, L / 2, 1], 10);                // right, faces -x
    walls.face([0, hh, HALL_Z1], [-HALL_W, 0, 0], [0, hh, 0], [0, 0, HALL_W / 2, 1], 6);       // back
    this.wallMesh = r.createMesh(walls.build());
    this.wallTex = r.texture(wallTex());
    const ceil = new GeoBuilder();
    ceil.face([0, HALL_H, zc], [HALL_W, 0, 0], [0, 0, L], [0, 0, 2, 5], 6);
    this.ceilMesh = r.createMesh(ceil.build());
    this.ceilTex = r.texture(K.makeIndexed(16, 16, (x, y) => (x % 8 === 0 || y % 8 === 0 ? R(0, 0) : K.dshade(0, 0.5 + K.blobNoise(x, y, 5, 9) * 0.5, x, y))));

    // ---- figures: one quad per silhouette variant, instanced per variant
    this.figTex = r.texture(figureAtlas());
    this.figMeshes = [];
    this.figInst = [];
    for (let v = 0; v < VARIANTS; v++) {
      this.figMeshes.push(r.createMesh(K.atlasUV(K.billboardQuad(FIG_W, FIG_H), [v / VARIANTS, 0, (v + 1) / VARIANTS, 1])));
      this.figInst.push(r.createInstances(ROWS * PER_ROW));
    }
    this.figs = [];
    for (let i = 0; i < ROWS; i++) for (let j = 0; j < PER_ROW; j++) {
      const g = i * 31 + j;
      const x = (j - (PER_ROW - 1) / 2) * 1.0 + (i % 2 ? 0.5 : 0) + (K.rand2(i, j, 1) - 0.5) * 0.3;
      if (Math.abs(x) > HALL_W - 0.6) continue;
      this.figs.push({
        row: i, x, y: rowY(i) + 0.01, z: rowZ(i) + (K.rand2(i, j, 2) - 0.5) * 0.2,
        v: Math.floor(K.rand2(i, j, 3) * VARIANTS) % VARIANTS,
        yaw: Math.PI + (K.rand2(i, j, 4) - 0.5) * 0.3 - x * 0.015,  // face the mic, roughly
        hs: 0.88 + K.rand2(i, j, 5) * 0.24,
        shade: 0.78 + K.rand2(i, j, 6) * 0.3,
        slump: 0.85 + K.rand2(i, j, 7) * 0.37,                        // rad lying back when idle
        roll: (K.rand2(i, j, 8) - 0.5) * 0.3,
        lag: K.rand2(i, j, 9) * 0.05,                                 // each rises a touch after its row
        ph: g * 0.37,
      });
    }
    this.rise = new Float32Array(ROWS);
    this.ripple = new K.Pulses({ width: 2.2, decay: 0.9 });
    this.bar = new K.BarClock({ minGap: 1 });   // Gentle: a slow wave through the crowd once per bar
    this.breath = new K.Breath({ beats: 8, period: 9 });

    // ---- microphone on a stand (pivot at the floor, origin)
    this.micMesh = r.createMesh(merge([
      { geo: K.props.prism(10, 0.3, 0.05) },
      { geo: K.props.shift(K.props.prism(6, 0.03, 1.5, { cap: false }), 0, 0.05, 0) },
      { geo: K.props.shift(K.props.prism(6, 0.045, 0.12), 0, 1.5, 0) },
    ]));
    this.micHead = r.createMesh(K.props.rotX(K.props.shift(K.props.prism(8, 0.065, 0.2, { taper: 0.75 }), 0, 0, 0), -0.35));
    this.metalTex = r.texture(metalTex());
    this.headTex = r.texture(K.makeIndexed(8, 8, (x, y) => ((x + y) % 2 ? R(3, 1) : R(2, 1))));
    this.poolMesh = r.createMesh(K.decal(3.2, 3.2, 0.03));
    this.poolTex = r.texture(poolTex());

    // ---- glows: mic halo, wall sconces, overhead shafts
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.shaftTex = r.texture(K.sprites.lightShaft({ ramp: 2 }));
    this.micGlow = r.createInstances(1);
    this.sconceMesh = r.createMesh(K.props.shift(K.props.prism(4, 0.14, 0.32, { taper: 1.6 }), 0, -0.16, 0));
    this.sconceInst = r.createInstances(SCONCES * 2);
    this.sconceGlow = r.createInstances(SCONCES * 2);
    this.sconces = [];
    for (let s = 0; s < SCONCES; s++) for (const side of [-1, 1]) {
      this.sconces.push({ x: side * (HALL_W - 0.15), y: 3.3, z: 2 + s * 4.6, order: s / (SCONCES - 1) });
    }
    this.shafts = r.createInstances(3);
    this.dust = new K.Particles(r, 'dust', { area: [15, 6, 20], count: 180 });

    this.micPulse = new K.Envelope(0.35);
    this.mI = mat4.create(); this.mMic = mat4.create();
    mat4.identity(this.mI);
    this.time = 0; this.k = 0; this.energy = 0; this.br = 0;
    this.a = { level: 0, bass: 0, mid: 0, high: 0, beat: false, beatPulse: 0, beatCount: 0 };
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], warm: [0, 0, 0], pool: [0, 0, 0], shaft: [0, 0, 0], tmp: [0, 0, 0] };

    // song sections: gates multiply the k fed into today's curves (clamped 0..1) — riseGate the rows
    // standing (front to back, per row), hallGate the hall light (dim, warm, sconces, shafts, dust),
    // rippleGate the beat ripple's size (already × k). Mood-only: sconceIdle = the sconces' idle
    // glow (today 0.12), micLift = a little extra mic light (× k), wave = the drop's rolling ripple
    // through the rows (× k). No camera keys (the glide is today's).
    this.moods = new K.Moods({
      still:  { riseGate: 0.1,  hallGate: 0.45, rippleGate: 0.5, sconceIdle: 0.03, micLift: 0.15, wave: 0 },
      base:   { riseGate: 1,    hallGate: 1,    rippleGate: 1,   sconceIdle: 0.12, micLift: 0,    wave: 0 },
      gather: { riseGate: 1.35, hallGate: 1.15, rippleGate: 1,   sconceIdle: 0.12, micLift: 0,    wave: 0 },
      full:   { riseGate: 1.8,  hallGate: 1.4,  rippleGate: 1.3, sconceIdle: 0.12, micLift: 0,    wave: 1 },
    }, { dropEase: 4 });
    this.mv = this.moods.v; this.kh = 0; this.waveP = 0;
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const m = this.mv = this.moods.update(a, dt);
    const d = K.drive(a, k);
    this.kh = clamp(k * m.hallGate);
    const kr = clamp(k * m.riseGate);
    this.cam.update(a, k, dt);
    this.energy = damp(this.energy, d.energy, 0.8, dt);
    this.br = this.breath.update(a, dt);

    // rows stand up front to back; damped so nothing snaps even if k jumps
    for (let i = 0; i < ROWS; i++) {
      const f = i / (ROWS - 1);
      const tgt = K.stage(kr, 0.04 + f * 0.58, 0.26 + f * 0.6);
      this.rise[i] = damp(this.rise[i], tgt, tgt > this.rise[i] ? 0.6 + f * 1.6 : 1.2, dt);   // back rows lag even on a jump
    }

    // one soft ripple per beat, from the front row backwards
    const bm = d.beatMotion, barFire = this.bar.update(a, dt);
    if (d.beat) { if (bm > 0.01) this.ripple.trigger(-2, k * d.accent * bm * m.rippleGate, 9); this.micPulse.trigger(0.6 * k); }   // the crowd's bow follows Feel; the mic light stays
    if (barFire && bm < 1 && k > 0.05) this.ripple.trigger(-2, k * d.accent * 0.5 * (1 - bm) * m.rippleGate, 3.5);       // Gentle: slower, smaller wave once per bar
    this.ripple.update(dt);
    this.micPulse.update(dt);

    const t = this.time, motion = d.motion, en = this.energy;
    // drop: a slow ripple rolling front to back through the standing rows (steady, never on beats)
    const wv = m.wave * K.stage(k, 0.1, 0.6) * 0.7;
    this.waveP += dt * 1.1;
    const counts = [0, 0, 0, 0];
    for (const g of this.figs) {
      const rise = clamp(this.rise[g.row] * (1 + g.lag * 2) - g.lag);
      let rp = this.ripple.at(g.row) * motion;
      if (wv > 0.001) { const w = Math.max(0, Math.sin(this.waveP - g.row * 0.45 + g.x * 0.04)); rp += wv * w * w * w; }
      const idleDrift = Math.sin(t * 0.35 + g.ph) * 0.035 * (1 - rise);       // slumped ones breathe
      const sway = Math.sin(t * 0.9 + g.x * 0.35 + g.row * 0.6) * (0.015 + 0.05 * en) * rise;
      const tiltX = -g.slump * (1 - rise) + idleDrift + rp * 0.2;         // ripple = a small bow toward the mic
      const tiltZ = g.roll * (1 - rise) + sway + rp * 0.06 * Math.sin(g.ph * 3);
      const hop = rp * 0.06 * rise;
      const v = g.v;
      this.figInst[v].set(counts[v]++, g.x, g.y + hop, g.z, 1, g.yaw, g.shade * lerp(0.75, 1, rise), g.ph, g.hs, tiltX, tiltZ);
    }
    for (let v = 0; v < VARIANTS; v++) this.figInst[v].upload(counts[v]);

    this.dust.update(dt, [0, 3, 13], { amount: lerp(0.15, 0.8, K.stage(this.kh, 0.3, 0.9)), speed: 0.5 + en * 0.6 });
  }

  render(r) {
    const { col, k } = this, P = this.pal, d = K.drive(this.a, k), m = this.mv, kh = this.kh;
    const dim = lerp(0.6, 1, kh), warm = K.stage(kh, 0.1, 0.9);

    // maroon-tinted fog that brightens a little with the swell
    mixColor(col.fog, P.role('fog'), P.color(R(0, 0)), 0.35);
    mixColor(col.fog, col.fog, P.color(R(2, 0)), 0.3 * warm);         // the hall air warms with the lights
    scaleColor(col.fog, col.fog, dim * (0.9 + this.br * 0.08 * k));
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 4, lerp(24, 36, kh));

    // cold dim light at idle, warm hall light when the crowd is up
    mixColor(col.light, P.color(R(1, 2)), P.color(R(1, 3)), warm);
    mixColor(col.light, col.light, P.color(R(2, 3)), 0.3 * warm);
    scaleColor(col.light, col.light, lerp(0.42, 0.95, kh));
    mixColor(col.amb, P.color(R(0, 2)), P.color(R(1, 2)), 0.35);
    scaleColor(col.amb, col.amb, lerp(0.42, 0.7, kh));
    r.setLight([0.25, -0.65, 0.7], col.light, col.amb);
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    const I = this.mI;
    r.draw(this.floorMesh, I, { texture: this.floorTex, tint: col.tint });
    r.draw(this.wallMesh, I, { texture: this.wallTex, tint: col.tint });
    r.draw(this.ceilMesh, I, { texture: this.ceilTex, tint: col.tint });

    // mic light pool and stand (the one thing lit at idle)
    const micLvl = lerp(0.45, 0.85, k) + this.micPulse.v * 0.35 + this.br * 0.08 + m.micLift * k;
    scaleColor(col.pool, P.role('glow'), micLvl * 0.3);
    r.draw(this.poolMesh, I, { texture: this.poolTex, unlit: true, additive: true, depthWrite: false, tint: col.pool });
    r.draw(this.micMesh, I, { texture: this.metalTex, tint: col.tint });
    mat4.trs(this.mMic, 0, 1.68, 0, 0, 0, 0);
    scaleColor(col.glow, P.role('glow'), micLvl * 0.6);
    r.draw(this.micHead, this.mMic, { texture: this.headTex, tint: col.tint, emissive: col.glow });

    // the crowd
    for (let v = 0; v < VARIANTS; v++) {
      r.drawInstanced(this.figMeshes[v], this.figInst[v], { texture: this.figTex, tint: col.tint, sway: 0 });
    }

    // wall sconces warm up front to back
    const n = this.sconces.length;
    this.sconces.forEach((s, i) => {
      const on = m.sconceIdle + (1 - m.sconceIdle) * K.stage(kh, 0.08 + s.order * 0.5, 0.3 + s.order * 0.5);
      const flick = on * (0.94 + 0.06 * Math.sin(this.time * 7 + i * 2.3));
      this.sconceInst.set(i, s.x, s.y, s.z, 1, 0, 0.8, 0, 1);
      const sz = 0.8 + on * 0.9;
      this.sconceGlow.set(i, s.x - Math.sign(s.x) * 0.2, s.y - sz / 2 + 0.05, s.z, sz, 0, flick, 0, 1);
    });
    this.sconceInst.upload(n); this.sconceGlow.upload(n);
    r.drawInstanced(this.sconceMesh, this.sconceInst, { texture: this.metalTex, tint: col.tint });
    mixColor(col.warm, P.color(R(2, 3)), P.color(R(1, 3)), 0.45);      // lamp light: accent warmed toward the paper tone
    r.drawInstanced(this.quad, this.sconceGlow, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [22, 42], depthWrite: false, tint: scaleColor(col.tmp, col.warm, 0.8) });

    // mic halo
    const hs = 0.4 + micLvl * 0.3;
    this.micGlow.set(0, 0, 1.68 - hs / 2, 0, hs, 0, 1, 0, 1);
    this.micGlow.upload(1);
    scaleColor(col.tmp, P.role('glow'), micLvl * 0.8);
    r.drawInstanced(this.quad, this.micGlow, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, depthWrite: false, tint: col.tmp });

    // overhead shafts over the crowd, only near the top of the swell
    const sh = K.stage(kh, 0.55, 0.95) * (0.85 + this.br * 0.15) + this.micPulse.v * 0.1 * k;
    if (sh > 0.005) {
      for (let i = 0; i < 3; i++) this.shafts.set(i, (i - 1) * 4.2, rowY(4 + i * 3), rowZ(4 + i * 3), 2.2, 0, 1, 0, (HALL_H - rowY(4 + i * 3)) / 2.2);
      this.shafts.upload(3);
      scaleColor(col.shaft, col.warm, sh * 0.22);
      r.drawInstanced(this.quad, this.shafts, { texture: this.shaftTex, billboard: 1, unlit: true, additive: true, depthWrite: false, fog: false, fade: [20, 40], tint: col.shaft });
    }

    this.dust.draw(r, { brightness: lerp(0.25, 0.8, warm) + d.pulse * 0.1 });
  }

  dispose(r) {
    [this.floorMesh, this.wallMesh, this.ceilMesh, this.micMesh, this.micHead, this.poolMesh, this.quad, this.sconceMesh, ...this.figMeshes].forEach((m) => m.dispose());
    [this.floorTex, this.wallTex, this.ceilTex, this.figTex, this.metalTex, this.headTex, this.poolTex, this.glowTex, this.shaftTex].forEach((t) => r.deleteTexture(t));
    [this.micGlow, this.sconceInst, this.sconceGlow, this.shafts, ...this.figInst].forEach((i) => i.dispose());
    this.dust.dispose(r);
  }
}
