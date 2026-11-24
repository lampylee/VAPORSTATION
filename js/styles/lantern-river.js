// LANTERN RIVER — a slow night drift down a calm river between reed banks and willows.
// Built for slow songs and ballads (copy of the Kit calm structure, see docs/ENVIRONMENT-GUIDE.md).
//
//   a winding river (endless; the centre line is a function of distance s, the world is
//   laid out along -Z)                                   K.Terrain with a river-bed height fn
//   everything reflected in the water                    r.setMirror / setClipBelow / clearDepth + water { opacity }
//   paper lanterns floating with the current             K.sprites.lantern + glow, recycled along the river
//   low stone footbridges now and then                   merged box geometry, K.forSegments (recycled ahead of the camera)
//   willows, broadleaf trees and reeds on the banks      K.sprites + K.forSegments (deterministic per segment)
//   cottages on the far banks, windows that warm up      texture2 + blend dither-crossfade, staged with k
//   fireflies on the banks, pollen, mist on the water    local lap-recycled glows, K.Particles pollen, mist cards
//   beats: a ripple under the nearest lantern + a soft pulse running up the lantern line (K.Pulses)
//   mids: willow sway.   K.Breath phrases the light and the camera's height.
//
// Idle: mist on the water, a few lanterns glowing, the drift barely moving, dark windows.
// Swell: lanterns light up one by one (nearest first, the front travelling upstream),
// fireflies and pollen come out on the banks, the cottage windows warm up.
// Nothing flashes and the camera never gets faster than a gentle drift.
import { mat4, lerp, damp, clamp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { plane, box, merge } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const WATER = 0;                 // water plane height
const TAU = Math.PI * 2;
const CUR = 0.4;                 // speed of the current (lanterns and mist drift at this speed)
const FAR_IDLE = 62, FAR_ACTIVE = 72;   // fog far distance; everything recycles beyond it

// ---- river geometry: the centre line x(s) for path distance s (z = -s) ----
const centre = (s) => Math.sin(s * 0.021) * 9 + Math.sin(s * 0.0073 + 1.3) * 13;
const slope = (s) => (centre(s + 1) - centre(s - 1)) / 2;
const height = (x, z) => {
  const d = Math.abs(x - centre(-z)), t = clamp((d - 8) / 5), bank = t * t * (3 - 2 * t);
  return -1.8 + bank * 2.4
    + K.fbm(x * 0.05, z * 0.05, { octaves: 3, seed: 11 }) * 3 * clamp((d - 12) / 14)
    + K.ridged(x * 0.012, z * 0.012) * 9 * clamp((d - 24) / 40);
};

const N_LANT = 20, L_SP = 4.4, L_SPAN = N_LANT * L_SP, L_BEHIND = 12;
const N_FLY = 64, F_SPAN = 76, F_BEHIND = 10;
const N_MIST = 14, M_SP = 6, M_SPAN = N_MIST * M_SP, M_BEHIND = 10;
const BRIDGE_LEN = 75;

/** Cottage wall + roof atlas (64x32): left half walls with two windows, right half roof tiles. */
function cottageTex(lit) {
  return K.makeIndexed(64, 32, (x, y) => {
    if (x >= 32) {
      const lx = x - 32, row = y >> 2;
      return lx % 8 === 0 || y % 4 === 0 ? R(1, 0) : K.dshade(1, 1.1 + (row & 1) * 0.7 + K.rnd(lx >> 1, row, 5) * 0.5, x, y);
    }
    for (const wx of [5, 19]) {
      if (x >= wx && x < wx + 7 && y >= 11 && y < 20) {
        if (x === wx || x === wx + 6 || y === 11 || y === 19) return R(0, 0);
        return lit ? (y < 15 ? R(2, 3) : R(2, 2)) : (x === wx + 1 && y === 12 ? R(3, 2) : R(3, 0));
      }
    }
    return y % 6 === 0 ? R(0, 0) : K.dshade(0, 1.0 + K.rnd(x >> 2, y >> 2, 3) * 0.9, x, y);
  });
}

/** Low stone footbridge across the river, local X across the river, deck underside 3.4 above the water. */
function bridgeGeo() {
  const at = (x, y, z) => (p) => [p[0] + x, p[1] + y, p[2] + z];
  const parts = [
    { geo: box(30, 0.7, 3.4, { uvRepeat: [7, 0.4] }), xf: at(0, 3.75, 0) },
    { geo: box(30, 0.55, 0.45, { uvRepeat: [7, 0.3] }), xf: at(0, 4.375, 1.475) },
    { geo: box(30, 0.55, 0.45, { uvRepeat: [7, 0.3] }), xf: at(0, 4.375, -1.475) },
    { geo: box(3, 6.4, 3.4, { uvRepeat: [0.8, 1.6] }), xf: at(-11.5, 0.8, 0) },
    { geo: box(3, 6.4, 3.4, { uvRepeat: [0.8, 1.6] }), xf: at(11.5, 0.8, 0) },
  ];
  const SEG = 8, half = 10, yTop = 3.4, drop = 1.4, yc = (x) => yTop - drop * (x / half) * (x / half);
  for (let i = 0; i < SEG; i++) {
    const x0 = -half + (i / SEG) * 2 * half, x1 = -half + ((i + 1) / SEG) * 2 * half, cx = (x0 + x1) / 2;
    const len = Math.hypot(x1 - x0, yc(x1) - yc(x0)) + 0.1, ang = Math.atan2(yc(x1) - yc(x0), x1 - x0);
    parts.push({ geo: K.props.rotZ(box(len, 0.5, 3.4, { uvRepeat: [1, 0.2] }), ang), xf: at(cx, yc(cx) - 0.25, 0) });
  }
  return merge(parts);
}

export class LanternRiver {
  static meta = { name: 'Lantern River' };
  static palette = fromKeys('lantern-river', 'Lantern River', ['#6b7562', '#5b8a4a', '#ffb347', '#0f2e38']);

  init(r) {
    this.ground = new K.Terrain(r, { size: 168, cells: 48, height, uvScale: 0.3 });
    this.groundTex = r.texture(K.tex.jungleFloor({ seed: 7 }));
    this.sky = new K.Sky(r, { stars: 170, moon: true, moonDir: [-0.35, 0.24, -1], moonSize: 6, clouds: 4, moonTexture: K.sprites.moon({ ramp: 3 }) });

    // water: one big subdivided plane that follows the camera in whole texture tiles (the surface never slides)
    this.WT = 300 / 40;
    this.waterMesh = r.createMesh(plane(300, 30, 40));
    this.waterTex = r.texture(K.tex.water({ ramp: 3 }));

    // bank planting (instanced billboards, rebuilt each frame from deterministic per-segment picks)
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.willowTex = r.texture(K.sprites.willow({ ramp: 1 }));
    this.leafTex = r.texture(K.sprites.broadleaf({ ramp: 1 }));
    this.reedTex = r.texture(K.sprites.reeds({ ramp: 1 }));
    this.willows = r.createInstances(40); this.trees = r.createInstances(40); this.reeds = r.createInstances(140);
    this.nWillow = this.nTree = this.nReed = 0;

    // cottages on the banks: two groups so the windows warm up in two waves
    this.houseTex = r.texture(cottageTex(false)); this.houseLitTex = r.texture(cottageTex(true));
    const body = K.atlasUV(box(4.6, 3.2, 4.6, { uvRepeat: [1, 1] }), [0, 0, 0.5, 1]);
    const roof = K.atlasUV(K.props.rotY(K.props.prism(4, 3.7, 2.4, { cap: false, taper: 0.02 }), Math.PI / 4), [0.5, 0, 1, 1]);
    this.houseMesh = r.createMesh(merge([{ geo: body, xf: (p) => [p[0], p[1] + 1.6, p[2]] }, { geo: roof, xf: (p) => [p[0], p[1] + 3.2, p[2]] }]));
    this.housesA = r.createInstances(10); this.housesB = r.createInstances(10);
    this.nHA = this.nHB = 0;

    // bridges
    this.bridgeMesh = r.createMesh(bridgeGeo());
    this.stoneTex = r.texture(K.tex.mossStone({ seed: 3 }));
    this.bridges = [];

    // lanterns with glow sprites (extra slots for the bridge lamps), fireflies, mist cards
    this.lanternTex = r.texture(K.sprites.lantern({ ramp: 2 }));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.lanterns = r.createInstances(N_LANT + 6); this.glows = r.createInstances(N_LANT + 6);
    this.lant = Array.from({ length: N_LANT }, (_, i) => ({ ph: K.rand2(i, 2, 5) * TAU, idle: i % 4 === 0, rel: 0, s: 0, x: 0, z: 0, level: 0 }));
    this.nLamps = N_LANT;
    this.flyGlow = r.createInstances(N_FLY);
    this.mistTex = r.texture(K.sprites.mistBank({ ramp: 3 }));
    this.mist = r.createInstances(N_MIST);

    this.pulses = new K.Pulses({ width: 7, decay: 1.4 });
    this.ripples = new K.Ripples(r, { color: R(3, 3), life: 4 });
    this.pollen = new K.Particles(r, 'pollen');

    this.cam = new K.PathRig((s, out) => { out[0] = centre(s) + Math.sin(s * 0.05) * 1.1; out[1] = 1.5; out[2] = -s; return out; },
      { lookAhead: 12, idleSpeed: 0.6, activeSpeed: 0.9, bassBoost: 0, fovPunch: 0.4, nudge: 0.03, rollKick: 0.003, fov: 60, far: 220 });
    this.breath = new K.Breath({ beats: 8, period: 12 });
    this.time = 0; this.k = 0; this.a = null; this.nextIdleRipple = 3; this.midS = 0; this.midM = 0;
    this.m = mat4.create();
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], water: [0, 0, 0], refl: [0, 0, 0], fly: [0, 0, 0], mist: [0, 0, 0] };
    this._rippleBusy = 0;
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k), t = this.time;
    const b = this.breath.update(a, dt);
    // mids shape sway only at Punchy; at Gentle they are eased (0.5 s)
    this.midS = damp(this.midS, d.mid, 0.5, dt); this.midM = lerp(this.midS, d.mid, d.beatMotion);
    this.cam.update(a, k, dt);
    const camS = this.cam.s;
    this.cam.eye[1] += b * 0.35;                      // the view breathes up and down, slowly
    this.cam.target[1] = 1.2;
    this.ground.follow(this.cam.eye[0], this.cam.eye[2]);
    this.camS = camS;

    // ---- lanterns: recycled along the river, drifting with the current ----
    const sets = this.lanterns, glows = this.glows;
    let nearest = null;
    this.lant.forEach((L, i) => {
      const v = i * L_SP + CUR * t - camS + L_BEHIND, lap = Math.floor(v / L_SPAN);
      L.rel = v - lap * L_SPAN - L_BEHIND; L.s = camS + L.rel;
      const lr = K.rand2(i, lap, 41) * 2 - 1, lat = Math.sign(lr || 1) * (2.4 + Math.abs(lr) * 4.6);
      L.x = centre(L.s) + lat + Math.sin(t * 0.3 + L.ph) * 0.15; L.z = -L.s;
      if (L.rel > 3 && (!nearest || L.rel < nearest.rel)) nearest = L;
      // lit from the near end first: the lit front travels upstream as the song swells
      const th = 0.06 + 0.62 * clamp(L.rel / 64);
      const lit = Math.max(L.idle ? 0.5 : 0.08, K.stage(k, th, th + 0.16));
      L.level = lit * (0.8 + 0.2 * b) + this.pulses.at(L.s) * 0.7;
      const y = WATER + 0.3 + Math.sin(t * 0.8 + L.ph) * 0.05;
      sets.set(i, L.x, y, L.z, 0.75, 0, 0.6 + L.level * 0.6, 0, 1.5);
      glows.set(i, L.x, y + 0.5, L.z, 1.0 + L.level * 0.6, 0, L.level, 0, 1);
    });

    // ---- beats: a ripple under the nearest lantern, a soft pulse running up the lantern line ----
    if (d.beat && nearest) {
      this.pulses.trigger(camS + 3, 0.5 + k * 0.4, 12);
      // the ring under the nearest lantern: every beat at Punchy, once a bar at Gentle
      if (d.beatMotion > 0.5 || (a.beatCount || 0) % 4 === 0) this.ripples.spawn(nearest.x, WATER, nearest.z, 2.6 + k * 2);
    }
    // idle life: now and then a fish rises somewhere ahead
    if ((this.nextIdleRipple -= dt) <= 0) {
      this.nextIdleRipple = 3 + Math.random() * 4;
      const sr = camS + 8 + Math.random() * 30;
      this.ripples.spawn(centre(sr) + (Math.random() - 0.5) * 12, WATER, -sr, 1.5 + Math.random());
    }
    this.pulses.update(dt);
    this.ripples.update(dt);

    // ---- bridges (segments ahead of the camera) and their lamps ----
    this.bridges.length = 0;
    let nl = N_LANT;
    K.forSegments(camS, { length: BRIDGE_LEN, behind: 25, ahead: 84 }, (i) => {
      if (K.rand2(i, 3, 31) > 0.85) return;
      const s = i * BRIDGE_LEN + 18 + K.rand2(i, 4, 31) * 40, ry = -Math.atan(slope(s)), c = Math.cos(ry), sn = Math.sin(ry), cx = centre(s);
      this.bridges.push({ x: cx, z: -s, ry });
      const lampLevel = 0.3 + 0.6 * K.stage(k, 0.1, 0.5) + this.pulses.at(s) * 0.6;
      for (const lx of [-9, 9]) {
        const wx = cx + lx * c, wz = -s - lx * sn;
        sets.set(nl, wx, 4.65, wz, 0.55, 0, 0.6 + lampLevel * 0.5, 0, 1.5);
        glows.set(nl, wx, 5.1, wz, 1.1 + lampLevel * 0.5, 0, lampLevel, 0, 1);
        nl++;
      }
    });
    this.nLamps = nl;
    sets.upload(nl); glows.upload(nl);

    // ---- banks: willows, trees, reeds; sway is a shader parameter, so only placement is here ----
    let nw = 0, nt = 0, nr = 0;
    K.forSegments(camS, { length: 9, behind: 12, ahead: 78 }, (i, s0) => {
      for (const side of [-1, 1]) {
        const sd = side > 0 ? 1 : 2;
        const s = s0 + K.rand2(i, sd, 51) * 9;
        if (K.rand2(i, sd, 52) < 0.6 && nw < 40) {
          const dd = 12.3 + K.rand2(i, sd, 53) * 4, x = centre(s) + side * dd, z = -s;
          this.willows.set(nw++, x, height(x, z) - 0.3, z, 7 + K.rand2(i, sd, 54) * 3, 0, 0.85 + K.rand2(i, sd, 55) * 0.3, i + sd, 1.33);
        }
        if (K.rand2(i, sd, 56) < 0.5 && nt < 40) {
          const dd = 21 + K.rand2(i, sd, 57) * 14, s2 = s0 + K.rand2(i, sd, 58) * 9, x = centre(s2) + side * dd, z = -s2;
          this.trees.set(nt++, x, height(x, z) - 0.3, z, 8 + K.rand2(i, sd, 59) * 3, 0, 0.75 + K.rand2(i, sd, 60) * 0.25, i + sd, 1.2);
        }
        for (let j = 0; j < 3; j++) {
          if (K.rand2(i, sd * 7 + j, 61) < 0.3 || nr >= 140) continue;
          const sj = s0 + K.rand2(i, sd * 7 + j, 62) * 9, dd = 10.2 + K.rand2(i, sd * 7 + j, 63) * 2.6, x = centre(sj) + side * dd, z = -sj;
          this.reeds.set(nr++, x, Math.max(WATER - 0.25, height(x, z) - 0.2), z, 1.6 + K.rand2(i, sd * 7 + j, 64), 0, 0.85 + K.rand2(i, j, 65) * 0.3, i * 3 + j, 1);
        }
      }
    });
    this.willows.upload(nw); this.trees.upload(nt); this.reeds.upload(nr);
    this.nWillow = nw; this.nTree = nt; this.nReed = nr;

    // ---- cottages on the banks (two groups: windows warm up in two waves) ----
    let ha = 0, hb = 0;
    K.forSegments(camS, { length: 40, behind: 20, ahead: 84 }, (i, s0) => {
      for (const side of [-1, 1]) {
        const sd = side > 0 ? 1 : 2;
        if (K.rand2(i, sd, 71) > 0.6) continue;
        const s = s0 + K.rand2(i, sd, 72) * 40, x = centre(s) + side * (18 + K.rand2(i, sd, 73) * 11), z = -s;
        const ry = -Math.atan(slope(s)) + (K.rand2(i, sd, 74) - 0.5) * 0.6, y = height(x, z) - 0.25;
        if ((i + sd) & 1) { if (ha < 10) this.housesA.set(ha++, x, y, z, 1, ry, 0.95, 0, 1); }
        else if (hb < 10) this.housesB.set(hb++, x, y, z, 1, ry, 0.95, 0, 1);
      }
    });
    this.housesA.upload(ha); this.housesB.upload(hb);
    this.nHA = ha; this.nHB = hb;

    // ---- fireflies on the banks: lap-recycled, switched on one by one with the swell ----
    for (let i = 0; i < N_FLY; i++) {
      const sf = (i / N_FLY) * F_SPAN, v = sf - camS + F_BEHIND, lap = Math.floor(v / F_SPAN), rel = v - lap * F_SPAN - F_BEHIND;
      const s = camS + rel, sg = K.rand2(i, lap, 81) < 0.5 ? -1 : 1;
      const x = centre(s) + sg * (7.5 + K.rand2(i, lap, 82) * 10) + Math.sin(t * 0.5 + i) * 0.5;
      const y = WATER + 0.5 + K.rand2(i, lap, 83) * 2.2 + Math.sin(t * 0.7 + i * 1.7) * 0.3;
      const on = K.stage(k, 0.12 + 0.6 * (i / N_FLY), 0.3 + 0.6 * (i / N_FLY));
      const fl = 0.55 + 0.45 * Math.sin(t * 1.6 + i * 3);
      this.flyGlow.set(i, x, y, -s + Math.cos(t * 0.4 + i) * 0.5, 0.3 * on, 0, fl * on, 0, 1);
    }
    this.flyGlow.upload(N_FLY);

    // ---- mist cards over the water and banks (kept ≥ 6 units off the camera line) ----
    for (let i = 0; i < N_MIST; i++) {
      const v = i * M_SP + CUR * 0.75 * t - camS + M_BEHIND, lap = Math.floor(v / M_SPAN), rel = v - lap * M_SPAN - M_BEHIND;
      const s = camS + rel, lr = K.rand2(i, lap, 91) * 2 - 1, lat = Math.sign(lr || 1) * (6.5 + Math.abs(lr) * 5);
      // cards shrink away as they come near the camera (never a big card at the lens), and behind it
      const near = K.fadeIn(rel, 6, 24);
      this.mist.set(i, centre(s) + lat, WATER - 0.3, -s, (6 + K.rand2(i, lap, 92) * 3) * near, 0, 1, 0, 0.3);
    }
    this.mist.upload(N_MIST);

    this.pollen.update(dt, this.cam.eye, { amount: K.swell(k, 0.1, 0.8), speed: 0.5 + d.energy });
  }

  /** Everything that stands above the water (drawn twice: reflected, then normally). */
  _world(r, col, glowLevel) {
    const k = this.k, P = this.pal;
    this.sky.draw(r, this.cam.eye, { horizon: col.fog, zenith: P.color(R(3, 0)), brightness: col.tint[0], starLevel: 0.5 + this.breath.v * 0.2, cloudDrift: this.time * 0.004 });
    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    // cottages: windows warm up with the swell (dither-crossfade to the lit texture)
    const bA = Math.max(0.08, K.stage(k, 0.25, 0.65)), bB = K.stage(k, 0.45, 0.85);
    if (this.nHA) r.drawInstanced(this.houseMesh, this.housesA, { texture: this.houseTex, texture2: this.houseLitTex, blend: bA, tint: col.tint });
    if (this.nHB) r.drawInstanced(this.houseMesh, this.housesB, { texture: this.houseTex, texture2: this.houseLitTex, blend: bB, tint: col.tint });
    for (const br of this.bridges) {
      mat4.trs(this.m, br.x, 0, br.z, 0, br.ry, 0, 1, 1, 1);
      r.draw(this.bridgeMesh, this.m, { texture: this.stoneTex, tint: col.tint });
    }
    const sway = 0.015 + this.breath.v * 0.02 + this.midM * 0.06;
    r.drawInstanced(this.quad, this.trees, { texture: this.leafTex, billboard: 1, sway: sway * 0.5, tint: col.tint });
    r.drawInstanced(this.quad, this.willows, { texture: this.willowTex, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.reeds, { texture: this.reedTex, billboard: 1, sway: sway * 1.5, tint: col.tint });
    r.drawInstanced(this.quad, this.lanterns, { texture: this.lanternTex, billboard: 1, unlit: true, tint: col.glow });
    col.refl[0] = col.refl[1] = col.refl[2] = glowLevel;
    r.drawInstanced(this.quad, this.glows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [40, 75], tint: col.refl });
    col.fly[0] = col.fly[1] = col.fly[2] = glowLevel * 0.9;
    r.drawInstanced(this.quad, this.flyGlow, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [40, 72], tint: col.fly });
  }

  render(r) {
    const { col, k } = this, P = this.pal;
    const dim = lerp(0.72, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 12, lerp(FAR_IDLE, FAR_ACTIVE, k));
    r.setLight([0.4, -0.6, 0.5], scaleColor(col.light, P.role('light'), lerp(0.5, 0.8, k)), scaleColor(col.amb, P.role('ambient'), 0.85));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    col.glow[0] = col.glow[1] = col.glow[2] = lerp(0.75, 1.1, k);

    // 1) the reflection, a little darker
    r.setMirror(WATER);
    col.tint[0] = col.tint[1] = col.tint[2] = dim * 0.7;
    this._world(r, col, 0.45);
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    r.setMirror(null);
    r.clearDepth();

    // 2) the world, clipped at the waterline so the reflection shows through
    r.setClipBelow(WATER);
    this._world(r, col, 1);
    r.setClipBelow(null);

    // 3) water surface over the reflection (screen-door); it follows the camera in whole tiles
    const WT = this.WT, e = this.cam.eye;
    mat4.trs(this.m, Math.round(e[0] / WT) * WT, WATER, Math.round(e[2] / WT) * WT, 0, 0, 0, 1, 1, 1);
    col.water[0] = col.water[1] = col.water[2] = dim * 0.9;
    r.draw(this.waterMesh, this.m, { texture: this.waterTex, tint: col.water, opacity: lerp(0.62, 0.5, k), uvOffset: [this.time * 0.004, this.time * 0.01] });
    this.ripples.draw(r, { brightness: lerp(0.35, 0.7, k) });

    // 4) air: mist low on the water, pollen
    col.mist[0] = col.mist[1] = col.mist[2] = dim * 0.5;
    r.drawInstanced(this.quad, this.mist, { texture: this.mistTex, billboard: 1, unlit: true, tint: col.mist, opacity: lerp(0.34, 0.24, k) + this.breath.v * 0.06 });
    this.pollen.draw(r, { brightness: k });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r);
    [this.pollen, this.ripples].forEach((x) => x.dispose(r));
    [this.waterMesh, this.quad, this.houseMesh, this.bridgeMesh].forEach((m) => m.dispose());
    [this.groundTex, this.waterTex, this.willowTex, this.leafTex, this.reedTex, this.houseTex, this.houseLitTex, this.stoneTex, this.lanternTex, this.glowTex, this.mistTex].forEach((t) => r.deleteTexture(t));
    [this.willows, this.trees, this.reeds, this.housesA, this.housesB, this.lanterns, this.glows, this.flyGlow, this.mist].forEach((i) => i.dispose());
  }
}
