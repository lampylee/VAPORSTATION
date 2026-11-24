// UNDERRIVER — sinking slowly through dark river water toward a bed of stars.
//
//   a winding riverbed with soft banks      K.Terrain + K.fbm, K.tex.sand (base ramp)
//   stars lying on and just above the bed   K.scatter: glow halo + K.sprites.twinkle core, instanced
//   caustic light over the bed              K.Caustics
//   pale drifting figures                   local figure sprite (suggested kit addition), screen-door ghosts
//   soft lights floating past               K.Particles 'skyLanterns' (re-boxed around the camera)
//   silt rising past the lens (sinking)     K.Particles 'dust' with an upward velocity
//   dark weed along the banks               K.sprites.reeds (base ramp), K.scatter
//   slow phrasing                           K.Breath (follows a tapped tempo, else 12 s)
//
// Idle: high in the murk, a slow sink and drift downstream, a handful of stars
// glowing faintly through the fog, one or two figures far off.
// Swell: the camera settles lower, stars kindle from the river's middle out to
// its banks, light ripples along the bed, caustics grow, figures drift closer.
// The song's uneven time trips beat trackers, so nothing is beat-locked: the
// swell rides intensity, smoothed energy and the breath. A beat only sends one
// faint pulse of starlight running downstream (scaled by audio.accent).
import { lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const TAU = Math.PI * 2;
const MAX_STARS = 520;
const N_FIG = 12;
const MAX_WEED = 80;
const STAR_CELL = 4, STAR_RADIUS = 12;          // scatter grid: ±48 units around the camera's ground point

/** River centre line (x) as a function of z: a lazy meander. */
const riverX = (z) => Math.sin(z * 0.018) * 6 + Math.sin(z * 0.041 + 1.3) * 2.5;
/** Riverbed: soft dunes in the channel, banks rising into the fog on both sides. */
const height = (x, z) => {
  const off = Math.abs(x - riverX(z)), bank = clamp((off - 13) / 18);
  return K.fbm(x * 0.05, z * 0.05, { octaves: 3, seed: 11 }) * 1.1 + bank * bank * 16 + K.fbm(x * 0.02, z * 0.02, { seed: 12 }) * 3 * bank;
};

// ---------- local sprite (suggested kit addition: K.sprites.figure) ----------

/** Distance from p to segment a-b. */
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, u = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - ax - dx * u, py - ay - dy * u);
};

/**
 * Pale floating figure: round head, slim body, arms drifting out and down,
 * legs trailing in the current; the feet fray into dither. 24x32, pivot at the feet.
 */
function figureSprite({ ramp = 1, seed = 3 } = {}) {
  const sway = (y) => Math.sin(y * 0.22 + seed) * 0.7 * clamp((y - 18) / 13);   // legs trail
  return K.makeIndexed(24, 32, (x, y) => {
    const hd = Math.hypot(x - 11.5, (y - 4) * 1.05);
    if (hd < 3) return K.dshade(ramp, 3.4 - hd * 0.3, x, y);                     // head
    const arm = Math.min(segDist(x, y, 9, 9, 3.5, 16.5), segDist(x, y, 14, 9, 19.5, 16.5));
    const torsoW = y >= 7 && y <= 19 ? (y < 9 ? 1.2 + (y - 7) * 1.1 : 3.3 - (y - 9) * 0.08) : -1;
    const legs = y > 18 ? Math.min(Math.abs(x - 10.2 - sway(y)), Math.abs(x - 12.8 - sway(y))) : 9;
    const legW = 1.3 - clamp((y - 19) / 13) * 0.5;
    let s = -1;
    if (Math.abs(x - 11.5) <= torsoW) s = 2.9 - Math.abs(x - 11.5) / 4 - (y - 7) / 30;
    else if (arm < 0.95) s = 2.4 - (y - 9) / 20;
    else if (legs < legW) s = 2.3 - (y - 18) / 16;
    if (s < 0) return K.CLEAR;
    if (y > 27 && (y - 27) / 5 > K.bayer(x, y)) return K.CLEAR;                  // feet dissolve into the water
    return K.dshade(ramp, s, x, y);
  });
}

export class Underriver {
  static meta = { name: 'Underriver' };
  static palette = ALBUM_PALETTES.amnesiac;

  init(r) {
    this.ground = new K.Terrain(r, { size: 170, cells: 40, height, uvScale: 0.22 });
    this.groundTex = r.texture(K.tex.sand({ ramp: 0, seed: 7 }));
    this.caus = new K.Caustics(r, { ramp: 3 });
    this.sky = new K.Sky(r);   // just the dome: murk fading toward a faintly lighter surface far above

    this.quad = r.createMesh(K.billboardQuad(1, 1));

    // stars on the riverbed: halo + bright core, one instance buffer each
    this.haloTex = r.texture(K.sprites.glow({ ramp: 1 }));
    this.coreTex = r.texture(K.sprites.twinkle({ index: R(1, 3) }));
    this.halos = r.createInstances(MAX_STARS); this.cores = r.createInstances(MAX_STARS);
    this.nStars = 0;
    this.pulses = new K.Pulses({ width: 10, decay: 2.2 });   // s = -z (downstream distance)

    // pale figures drifting in the current, each with a faint glow at the head
    this.figTex = r.texture(figureSprite({ ramp: 1 }));
    this.figGlowTex = r.texture(K.sprites.glow({ ramp: 1 }));
    this.figs = r.createInstances(N_FIG); this.figGlows = r.createInstances(N_FIG);
    this.fig = Array.from({ length: N_FIG }, (_, i) => ({
      side: i % 2 ? 1 : -1,
      far: i === 0 || i === 5 ? 9 : 30 + K.rand2(i, 1, 21) * 10,   // lost in the fog when idle (but two linger nearby)
      near: 5 + K.rand2(i, 2, 21) * 6,                  // close by at full swell
      idle: i === 0 || i === 5,                         // these two are faintly there even at idle
      on: 0.15 + K.rand2(i, 3, 21) * 0.55,
      z: -20 - i * 7.5 - K.rand2(i, 4, 21) * 4,
      y: 1 + K.rand2(i, 5, 21) * 3.5,
      ph: K.rand2(i, 6, 21) * TAU,
      size: 2.4 + K.rand2(i, 7, 21) * 0.8,             // sprite width; height = size * 4/3
      lat: 30,
    }));

    // dark weed along the banks
    this.weedTex = r.texture(K.sprites.reeds({ ramp: 0, head: R(0, 1), seed: 19 }));
    this.weeds = r.createInstances(MAX_WEED);
    this.nWeeds = 0;

    // floating soft lights (accent) and rising silt
    this.lights = new K.Particles(r, 'skyLanterns', { count: 34, size: 0.35, area: [46, 8, 30], yOffset: 0, vel: [0.05, 0.12, 0.35], wobble: 0.5 });
    this.silt = new K.Particles(r, 'dust', { count: 220, vel: [0.04, 0.55, 0.12], area: [26, 16, 26], glow: 0.3 });

    this.cam = new K.PathRig((s, out) => { out[0] = riverX(-s); out[1] = 0; out[2] = -s; return out; },
      { lookAhead: 16, fov: 60, far: 200, fovPunch: 0, nudge: 0.02, rollKick: 0.004, idleSpeed: 0.55, activeSpeed: 1.0, bassBoost: 0 });
    this.breath = new K.Breath({ beats: 8, period: 12 });
    this.bm = 1; this.time = 0; this.k = 0; this.kk = 0; this.e = 0; this.low = 0; this.h = 15;
    this.col = { fog: [0, 0, 0], zen: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], star: [1, 1, 1], fig: [0, 0, 0], figGlow: [0, 0, 0], weed: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.k = k; this.time += dt;
    const t = this.time, d = K.drive(a, k);
    const b = this.breath.update(a, dt);
    // slow, smoothed song size: drives everything big (no raw bass on the camera)
    this.e = damp(this.e, a.energy ?? a.level ?? 0, 2.5, dt);
    this.low = damp(this.low, a.bass ?? 0, 1.2, dt);
    this.kk = damp(this.kk, clamp(k * (0.8 + 0.3 * this.e)), 1.5, dt);
    const kk = this.kk;

    // camera: drifts downstream; sinks lower as the song grows, with a long slow sink/rise and the breath
    this.cam.update(a, k, dt);
    const hT = lerp(11, 6, kk) + Math.cos(t * TAU / 80) * 1.8 - b * 0.8 - this.low * k * 0.6;
    this.h = damp(this.h, hT, 1.5, dt);
    const eye = this.cam.eye, tg = this.cam.target;
    eye[1] = height(eye[0], eye[2]) * 0.3 + this.h;
    tg[1] = eye[1] - lerp(7.5, 4.5, kk);
    tg[0] += Math.sin(t * 0.07) * 3;
    this.cam.roll = Math.sin(t * 0.05) * 0.03;
    this.ground.follow(eye[0], eye[2] - 30);

    // a beat sends one faint pulse of starlight downstream ahead of the camera
    this.bm = d.beatMotion;
    if (d.beat) this.pulses.trigger(-eye[2] + 12, 0.45 * k * d.accent, 7);
    this.pulses.update(dt);

    // stars: centred ahead of the camera, kindling from the river's middle out to the banks
    const cx = eye[0], cz = eye[2] - 26, R0 = STAR_CELL * STAR_RADIUS;
    let n = 0;
    K.scatter(cx, cz, { cell: STAR_CELL, radius: STAR_RADIUS, seed: 31 }, (x, z, dist, gx, gz) => {
      if (n >= MAX_STARS) return;
      const r1 = K.rand2(gx, gz, 33), r2 = K.rand2(gx, gz, 34), r3 = K.rand2(gx, gz, 35);
      const off = clamp(Math.abs(x - riverX(z)) / 22);
      if (r3 > 0.62 || (off >= 1 && r1 > 0.3)) return;                  // leave dark gaps; only a few up on the banks
      const on = 0.04 + off * 0.6 + r1 * 0.3;
      const idleLit = r2 < 0.14 ? 1.5 : 0;
      const lit = Math.max(idleLit, 0.1 + 0.9 * K.stage(kk, on, on + 0.18)) * (0.5 + 0.5 * r2);   // dormant stars stay faint pinpoints
      // slow ripples of light travelling downstream across the bed (stars brighten in sequence)
      const wave = Math.pow(Math.max(0, Math.sin(t * 0.35 + z * 0.07 + x * 0.02)), 6) * lerp(0.15, 0.5, kk);
      const tw = 0.6 + 0.4 * Math.sin(t * (0.6 + r3 * 0.8) + r1 * 40);
      const y = height(x, z) + 0.1 + (r3 < 0.18 ? 0.6 + r3 * 14 : 0);      // some float just above the bed
      const nearFade = K.fadeIn(Math.hypot(x - eye[0], y - eye[1], z - eye[2]), 4, 9);   // never a big blob at the lens
      const fade = K.fadeOut(dist, R0 * 0.6, R0) * nearFade, pl = this.pulses.at(-z) * (lit + 0.2) * fade;   // pulse light stays; its halo-size swell is a beat movement
      const lvBase = (lit * tw * (0.8 + 0.25 * b) + wave * (lit + 0.15)) * fade, lv = lvBase + pl;
      if (lv < 0.01) return;
      const s = 0.4 + r2 * 0.45;
      const hs = s * (1.7 + Math.min(1, lvBase + pl * this.bm) * 1.1), cs = s * 0.6;     // quads pivot at the base: lift so the halo clears the bed
      this.halos.set(n, x, y, z, hs, 0, Math.min(0.9, lv * 0.8), 0, 1);
      this.cores.set(n, x, y + (hs - cs) * 0.5, z, cs, 0, Math.min(1, 0.1 + lv * 1.5), 0, 1);
      n++;
    });
    this.nStars = n;
    this.halos.upload(n); this.cores.upload(n);

    // figures: carried slowly downstream (the camera overtakes them); they drift closer with the swell
    this.fig.forEach((f, i) => {
      f.z -= 0.25 * dt;
      if (f.z > eye[2] + 8) f.z -= 92;                                   // behind the camera → far ahead, deep in fog
      const close = Math.max(f.idle ? 0.8 : 0, K.stage(kk, f.on, f.on + 0.3));
      f.lat = damp(f.lat, lerp(f.far, f.near, close), 3, dt);
      const x = riverX(f.z) + f.side * f.lat + Math.sin(t * 0.11 + f.ph) * 1.5;
      const y = height(x, f.z) + f.y + Math.sin(t * 0.23 + f.ph) * 0.7 + b * 0.4;
      const sh = 0.75 + 0.25 * close;
      this.figs.set(i, x, y, f.z, f.size, 0, sh, 0, 4 / 3);
      this.figs.tilt(i, 0, Math.sin(t * 0.17 + f.ph) * 0.12);
      const gs = f.size * 1.5;                                           // a faint aura centred on the chest
      this.figGlows.set(i, x, y + f.size * 0.85 - gs * 0.5, f.z, gs, 0, 0.08 + close * 0.22, 0, 1);
    });
    this.figs.upload(N_FIG); this.figGlows.upload(N_FIG);

    // weed along the banks (deterministic, around the camera)
    let nw = 0;
    K.scatter(eye[0], eye[2] - 24, { cell: 6, radius: 8, seed: 41 }, (x, z, dist, gx, gz) => {
      if (nw >= MAX_WEED) return;
      const off = Math.abs(x - riverX(z));
      if (off < 11 || off > 22 || K.rand2(gx, gz, 42) < 0.4) return;
      const sc = (1.2 + K.rand2(gx, gz, 43) * 1.2) * K.fadeOut(dist, 32, 48);
      if (sc < 0.05) return;
      this.weeds.set(nw++, x, height(x, z) - 0.2, z, sc, 0, 0.7 + K.rand2(gx, gz, 44) * 0.3, gx * 3 + gz, 1.4);
    });
    this.nWeeds = nw;
    this.weeds.upload(nw);

    this.caus.update(dt, 0.5 + kk * 0.5);
    // soft lights float past, in a box that stays 8+ units ahead of and below the lens
    this.lights.update(dt, [eye[0], eye[1] - 8.5, eye[2] - 23], { amount: K.swell(kk, 0.3, 0.95), speed: 0.6 + this.e * 0.4 });
    // silt rises past the camera: the steady sense of sinking
    this.silt.update(dt, eye, { amount: K.swell(kk, 0.6, 0.9), speed: 0.7 + kk * 0.3 });
  }

  render(r) {
    const { col, kk } = this, P = this.pal, b = this.breath.v;
    const dim = lerp(0.8, 1.05, kk) + b * 0.06;
    mixColor(col.fog, P.role('fog'), P.color(R(3, 2)), lerp(0.14, 0.24, kk) + b * 0.04);   // murky water, a touch lighter than the palette's fog
    scaleColor(col.fog, col.fog, dim);
    r.clear(col.fog);
    this.cam.apply(r);
    this.sky.draw(r, this.cam.eye, { horizon: col.fog, zenith: scaleColor(col.zen, P.color(R(3, 2)), dim * 0.8), brightness: dim });
    r.setFog(col.fog, 4, lerp(46, 70, kk));
    r.setLight([0.15, -1, 0.2], scaleColor(col.light, P.role('light'), lerp(0.22, 0.55, kk)), scaleColor(col.amb, P.role('ambient'), 0.42));
    col.tint[0] = col.tint[1] = col.tint[2] = lerp(0.75, 0.95, kk);

    // the riverbed, with caustic light drifting over it
    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    this.caus.draw(r, this.ground.mesh, { brightness: lerp(0.07, 0.24, kk) * (0.8 + 0.3 * b), uvScale: [0.12, 0.12] });

    col.weed[0] = col.weed[1] = col.weed[2] = col.tint[0] * 0.6;
    const sway = 0.03 + b * 0.04 + this.low * this.k * 0.05;
    if (this.nWeeds) r.drawInstanced(this.quad, this.weeds, { texture: this.weedTex, billboard: 1, sway, tint: col.weed });

    // stars: shine through the murk (fade with distance instead of fogging out)
    if (this.nStars) {
      r.drawInstanced(this.quad, this.halos, { texture: this.haloTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [30, 85], tint: col.star });
      r.drawInstanced(this.quad, this.cores, { texture: this.coreTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [35, 90], tint: col.star });
    }

    // figures: pale, screen-door ghosts; a faint glow at each head
    col.fig[0] = col.fig[1] = col.fig[2] = lerp(0.75, 1, kk);
    r.drawInstanced(this.quad, this.figs, { texture: this.figTex, billboard: 1, unlit: true, tint: col.fig, opacity: lerp(0.72, 0.88, kk) });
    col.figGlow[0] = col.figGlow[1] = col.figGlow[2] = lerp(0.5, 0.9, kk);
    r.drawInstanced(this.quad, this.figGlows, { texture: this.figGlowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [20, 55], tint: col.figGlow });

    // drifting lights and silt last
    this.lights.draw(r, { brightness: lerp(0.6, 1, kk) });
    this.silt.draw(r, { brightness: lerp(0.5, 0.8, kk) });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.caus.dispose(r);
    [this.lights, this.silt].forEach((x) => x.dispose(r));
    this.quad.dispose();
    [this.groundTex, this.haloTex, this.coreTex, this.figTex, this.figGlowTex, this.weedTex].forEach((t) => r.deleteTexture(t));
    [this.halos, this.cores, this.figs, this.figGlows, this.weeds].forEach((i) => i.dispose());
  }
}
