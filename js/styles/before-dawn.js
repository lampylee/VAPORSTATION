// BEFORE DAWN — for a slow, held-back song whose last minute ignites.
//
// A dark, cold bedroom: a bed, a bedside lamp (the one faint light), an open
// window with two curtains. The camera drifts very slowly backwards, out
// through the window, into a black field under a night sky, and back again
// over several minutes.
//
//   idle .. k 0.7   almost nothing moves: the lamp breathes, curtains stir, dust in the moonlight,
//                   a thin pre-dawn line warms at the horizon from k 0.35
//   k 0.7 .. 1      the sky catches fire: accent-coloured bands climb the sky (scrolling, edge-faded,
//                   additive), embers rise from the field, the field and house take the firelight,
//                   the camera is pulled out into the field to watch. Bands flicker with the
//                   smoothed bass (the fuzz bass), a beat sends one soft flare through them.
//
// The design is the intensity curve: the ignition is K.stage(k, 0.7, 1), further eased by a slow
// damp, so it always fades in and never pops.
import { mat4, lerp, clamp, damp, smoothstep } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, box, merge } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const TAU = Math.PI * 2;
const ROOM = { hx: 2.5, hz: 3, h: 2.6, t: 0.16 };
const WIN = { x0: -0.8, x1: 0.8, y0: 0.9, y1: 2.1 };   // window opening in the front wall (z = +3)
const CYCLE = 300;          // seconds for one slow drift out and back in (idle)
const N_BANDS = 5;

// segs: subdivided so the bedside lamp (a per-vertex point light) lights the room as a soft pool
const B = (sx, sy, sz, cx, cy, cz, uv = [Math.max(sx, sz) / 1.5, sy / 1.5], segs = 1) => K.props.shift(box(sx, sy, sz, { uvRepeat: uv, segs }), cx, cy, cz);
const LAMP = [0.45, 0.86, -2.68];

const height = (x, z) => {
  const d = Math.hypot(x, z * 0.8);
  return -0.04 + (K.fbm(x * 0.025, z * 0.025, { octaves: 3, seed: 21 }) - 0.5) * 2.2 * clamp((d - 9) / 25) + K.ridged(x * 0.008, z * 0.008) * 7 * clamp((d - 70) / 40);
};

/** Camera path: u = 0 inside by the window looking at the bed, u = 1 far out in the field. */
function camAt(u, eye, target) {
  const z = lerp(1.7, 34, Math.pow(u, 1.5));
  eye[0] = 0.05 + 2.2 * u * u;
  eye[1] = 1.45 + 3.4 * smoothstep(clamp((z - 3.6) / 30));
  eye[2] = z;
  const s = smoothstep(u);
  target[0] = lerp(-0.35, 0, s);
  target[1] = lerp(0.75, 3.6, s);
  target[2] = lerp(-2.6, -2, s);
}

// --- local indexed textures ---
const plaster = () => K.makeIndexed(32, 32, (x, y) => K.dshade(0, 0.9 + K.blobNoise(x, y, 8, 3) * 0.7 + K.rnd(x, y, 4) * 0.25, x, y));
const cloth = (ramp, base) => K.makeIndexed(32, 32, (x, y) => K.dshade(ramp, base + Math.sin(x * 0.6) * 0.35 + K.rnd(x, y, 7) * 0.3, x, y));
const field = () => K.makeIndexed(64, 64, (x, y) => (K.rnd(x, y, 11) > 0.93 ? R(1, 0) : K.dshade(3, 0.2 + K.blobNoise(x, y, 12, 5) * 1.1 + K.rnd(x, y, 2) * 0.35, x, y)));
const floorLight = () => K.makeIndexed(32, 32, (x, y) => {
  // the window's moonlight on the floor: a pale panel with a soft dithered edge
  const ex = Math.min(x, 31 - x) / 6, ey = Math.min(y, 31 - y) / 6;
  return K.dshade(3, 3 * clamp(Math.min(ex, ey)), x, y);
});
/** Horizontal flame streaks for the sky bands; tileable in x (integer sine periods), CLEAR between licks. */
const fireBand = (seed, thr = 0.5) => K.makeIndexed(64, 32, (x, y) => {
  const a = (x / 64) * TAU;
  // long thin licks: the phase bends with height, so streaks lean and taper like flames
  const w = Math.sin(a * 5 + y * 0.28 + seed) * 0.45 + Math.sin(a * 11 - y * 0.17 + seed * 2) * 0.35 + Math.sin(a * 23 + y * 0.6 + seed * 3) * 0.2;
  const fall = 1 - Math.abs(y - 18) / 18;           // densest a little below mid-band
  const t = (0.5 + 0.5 * w) * (0.45 + 0.75 * fall) + (K.rnd(x, y, seed) - 0.5) * 0.12;
  if (t < thr) return K.CLEAR;
  return K.dshade(2, 0.6 + (t - thr) * 6, x, y);
});

/** A sky band: a ring around the eye between two elevations, three rows so the vertex colour fades both edges. */
function bandGeo(e0, e1, radius = 85, segs = 20, uRepeat = 3) {
  const g = new GeoBuilder(), em = (e0 + e1) / 2;
  const P = (i, e) => { const a = (i / segs) * TAU; return [Math.cos(a) * Math.cos(e) * radius, Math.sin(e) * radius, Math.sin(a) * Math.cos(e) * radius]; };
  const rows = [[e0, 0, 0], [em, 0.5, 1], [e1, 1, 0]];
  for (let j = 0; j < 2; j++) for (let i = 0; i < segs; i++) {
    const [ea, va, ca] = rows[j], [eb, vb, cb] = rows[j + 1];
    const u0 = (i / segs) * uRepeat, u1 = ((i + 1) / segs) * uRepeat, n = [0, -1, 0];
    const A = [ca, ca, ca], Bc = [cb, cb, cb];
    g.tri(P(i, ea), P(i + 1, ea), P(i + 1, eb), [u0, 1 - va], [u1, 1 - va], [u1, 1 - vb], n, [A, A, Bc]);
    g.tri(P(i, ea), P(i + 1, eb), P(i, eb), [u0, 1 - va], [u1, 1 - vb], [u0, 1 - vb], n, [A, Bc, Bc]);
  }
  return g.build();
}

/** A hanging curtain grid (rod at the top), displaced every frame. */
function curtainGeo(x0, x1, y0, y1, z, cols, rows, t, wind, seed) {
  const g = new GeoBuilder();
  const P = (i, j) => {
    const u = i / cols, v = j / rows, drop = v * v;   // v = 0 at the rod
    const fold = Math.sin(u * Math.PI * 5 + seed) * 0.05;
    const stir = Math.sin(t * 0.55 + u * 3 + seed) * 0.5 + Math.sin(t * 0.9 + v * 2 + seed * 2) * 0.5;
    return [lerp(x0, x1, u) + stir * wind * 0.25 * drop, lerp(y1, y0, v), z + fold - (0.02 + stir * 0.5 + 0.5) * wind * drop];
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const t0 = [i / cols, j / rows], t1 = [(i + 1) / cols, j / rows], t2 = [(i + 1) / cols, (j + 1) / rows], t3 = [i / cols, (j + 1) / rows];
    g.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), t0, t1, t2, t3);
  }
  return g.build();
}

export class BeforeDawn {
  static meta = { name: 'Before Dawn' };
  static palette = ALBUM_PALETTES.okc;

  init(r) {
    const { hx, hz, h, t } = ROOM;
    // --- the house: walls (inside and out), ceiling, gable roof ---
    const wx = (hx + t / 2) - (-WIN.x0);          // width of a wall piece beside the window
    const walls = [
      B(2 * hx + t, h, t, 0, h / 2, -hz),
      B(t, h, 2 * hz + t, -hx, h / 2, 0), B(t, h, 2 * hz + t, hx, h / 2, 0),
      B(wx, h, t, -(hx + t / 2 - wx / 2), h / 2, hz), B(wx, h, t, hx + t / 2 - wx / 2, h / 2, hz),
      B(WIN.x1 - WIN.x0, WIN.y0, t, 0, WIN.y0 / 2, hz), B(WIN.x1 - WIN.x0, h - WIN.y1, t, 0, (h + WIN.y1) / 2, hz),
      B(2 * hx + t, t, 2 * hz + t, 0, h + t / 2, 0),
    ];
    const ridge = h + t + (hx + 0.25) * Math.tan(0.5);
    const gable = new GeoBuilder();
    for (const z of [-hz - t / 2 - 0.01, hz + t / 2 + 0.01]) gable.tri([-hx - t / 2, h + t, z], [hx + t / 2, h + t, z], [0, ridge - 0.08, z], [0, 1], [3, 1], [1.5, 0]);
    walls.push(gable.build());
    // rebuilt subdivided: the big pieces get 6 cells a side, the strips round the window 3
    const S = (sx, sy, sz, cx, cy, cz, n) => B(sx, sy, sz, cx, cy, cz, undefined, n);
    walls.splice(0, walls.length - 1,
      S(2 * hx + t, h, t, 0, h / 2, -hz, 7),
      S(t, h, 2 * hz + t, -hx, h / 2, 0, 7), S(t, h, 2 * hz + t, hx, h / 2, 0, 7),
      S(wx, h, t, -(hx + t / 2 - wx / 2), h / 2, hz, 3), S(wx, h, t, hx + t / 2 - wx / 2, h / 2, hz, 3),
      S(WIN.x1 - WIN.x0, WIN.y0, t, 0, WIN.y0 / 2, hz, 2), S(WIN.x1 - WIN.x0, h - WIN.y1, t, 0, (h + WIN.y1) / 2, hz, 2),
      S(2 * hx + t, t, 2 * hz + t, 0, h + t / 2, 0, 7));
    this.wallMesh = r.createMesh(merge(walls.map((geo) => ({ geo }))));
    this.wallTex = r.texture(plaster());

    const run = hx + 0.35, slab = run / Math.cos(0.5) + 0.1;
    const roof = [-1, 1].map((sd) => K.transform(box(slab, 0.12, 2 * hz + 0.6, { uvRepeat: [2, 4] }), { pos: [sd * run / 2, h + t + (run / 2) * Math.tan(0.5), 0], rot: [0, 0, -sd * 0.5] }));
    this.roofMesh = r.createMesh(merge(roof.map((geo) => ({ geo, color: [0.55, 0.55, 0.6] }))));
    this.floorMesh = r.createMesh(B(2 * hx, 0.1, 2 * hz, 0, -0.05, 0, [4, 5], 8));
    this.boardsTex = r.texture(K.tex.boards({ ramp: 0 }));

    // --- wood: bed frame, headboard, bedside table, window frame, one casement swung open outwards ---
    const wood = [
      B(1.6, 0.34, 2.1, -0.7, 0.2, -1.9), B(1.7, 0.95, 0.08, -0.7, 0.47, -2.94),
      B(0.5, 0.55, 0.45, 0.45, 0.275, -2.68),
      B(1.8, 0.07, 0.34, 0, WIN.y0 - 0.03, hz + 0.02), B(1.8, 0.07, 0.24, 0, WIN.y1 + 0.03, hz),
      B(0.07, 1.27, 0.24, WIN.x0 - 0.03, (WIN.y0 + WIN.y1) / 2, hz), B(0.07, 1.27, 0.24, WIN.x1 + 0.03, (WIN.y0 + WIN.y1) / 2, hz),
    ];
    const pw = 0.78, ph = 1.18, bar = 0.05, cas = [
      B(pw, bar, bar, pw / 2, 0, 0), B(pw, bar, bar, pw / 2, ph, 0), B(bar, ph, bar, bar / 2, ph / 2, 0), B(bar, ph, bar, pw - bar / 2, ph / 2, 0), B(pw, bar * 0.6, bar * 0.6, pw / 2, ph / 2, 0),
    ];
    for (const c of cas) wood.push(K.transform(c, { pos: [WIN.x1 + 0.02, WIN.y0 + 0.01, hz + 0.1], rot: [0, -1.2, 0] }));
    wood.push(K.props.prism(6, 0.07, 0.16), K.props.prism(6, 0.02, 0.12));
    K.props.shift(wood[wood.length - 2], 0.45, 0.55, -2.68); K.props.shift(wood[wood.length - 1], 0.45, 0.71, -2.68);
    this.woodMesh = r.createMesh(merge(wood.map((geo) => ({ geo }))));
    this.woodTex = r.texture(K.tex.boards({ ramp: 0, seed: 9 }));

    // --- bedding and the lampshade ---
    this.sheetMesh = r.createMesh(merge([
      { geo: B(1.5, 0.18, 2.0, -0.7, 0.46, -1.9, undefined, 3) }, { geo: B(0.9, 0.13, 0.4, -0.7, 0.61, -2.62, undefined, 2) },
      { geo: K.props.shift(K.props.prism(8, 0.16, 0.2, { taper: 0.6 }), 0.45, 0.8, -2.68) },
    ]));
    this.sheetTex = r.texture(cloth(0, 1.6));
    this.blanketMesh = r.createMesh(merge([{ geo: B(1.58, 0.08, 1.35, -0.7, 0.58, -1.45, undefined, 3) }, { geo: B(0.04, 0.3, 1.35, -1.5, 0.44, -1.45) }, { geo: B(0.04, 0.3, 1.35, 0.1, 0.44, -1.45) }]));
    this.blanketTex = r.texture(cloth(1, 0.9));
    this.curtainTex = r.texture(cloth(1, 0.6));
    this.curtains = [
      { x0: -1.3, x1: -0.42, seed: 0.3 }, { x0: 0.48, x1: 1.25, seed: 2.1 },
    ].map((c) => ({ ...c, mesh: r.createMesh(curtainGeo(c.x0, c.x1, 0.7, 2.28, hz - 0.14, 6, 5, 0, 0, c.seed), true) }));

    // moonlight patch on the floor below the window, additive
    this.patchMesh = r.createMesh(new GeoBuilder().face([0.1, 0.012, 1.95], [0.85, 0, 0], [0, 0, -0.85]).build());
    this.patchTex = r.texture(floorLight());

    // --- the field ---
    this.ground = new K.Terrain(r, { size: 220, cells: 44, height, uvScale: 0.25 });
    this.groundTex = r.texture(field());
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.grassTex = r.texture(K.sprites.grass({ ramp: 1 }));
    this.treeTex = r.texture(K.sprites.deadTree({ index: R(0, 0) }));
    this.grass = r.createInstances(110); this.trees = r.createInstances(9);
    let ng = 0;
    for (let i = 0; i < 160 && ng < 110; i++) {
      const x = (K.rand2(i, 1, 13) - 0.5) * 70, z = (K.rand2(i, 2, 13) - 0.5) * 120;
      if (Math.abs(x) < hx + 0.8 && Math.abs(z) < hz + 0.8) continue;   // not inside the house
      if (Math.abs(x - 1) < 2.5 && z > 2 && z < 48) continue;          // keep the camera's path clear
      this.grass.set(ng++, x, height(x, z) - 0.05, z, 0.6 + K.rand2(i, 3, 13) * 0.6, 0, 0.6 + K.rand2(i, 4, 13) * 0.4, i, 1);
    }
    this.grass.upload(ng);
    const treeAt = [[-14, -18], [-26, -34], [19, -26], [34, -48], [-40, -60], [8, -64], [-22, 14], [28, 6], [-48, -8]];
    treeAt.forEach(([x, z], i) => this.trees.set(i, x, height(x, z) - 0.2, z, 6 + K.rand2(i, 1, 17) * 4, 0, 0.7 + K.rand2(i, 2, 17) * 0.3, i, 1.3));
    this.trees.upload(treeAt.length);

    // --- lights: the bedside lamp, and the window seen glowing from outside ---
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.glows = r.createInstances(2);

    // --- the sky: dome + stars, and the fire bands (hidden until ignition) ---
    this.sky = new K.Sky(r, { stars: 180 });
    this.bands = Array.from({ length: N_BANDS }, (_, i) => {
      const e0 = -0.04 + i * 0.13, e1 = e0 + 0.2 + i * 0.03;
      return { mesh: r.createMesh(bandGeo(e0, e1, 85 - i * 2, 24, 7 + (i % 3))), tex: r.texture(fireBand(i * 1.7 + 0.4, 0.48 + i * 0.05)), speed: (i % 2 ? -1 : 1) * (0.006 + i * 0.003), on: 0.7 + i * 0.05, ph: i * 1.3 };
    });

    this.embers = new K.Particles(r, 'embers', { count: 200, size: 0.45, area: [60, 20, 34], vel: [0.25, 1.4, 0] });
    this.dust = new K.Particles(r, 'dust', { count: 70, area: [4, 2.2, 4.6], size: 0.035 });
    this.mist = new K.Particles(r, 'mist', { count: 14, area: [100, 1.5, 44], yOffset: 0 });

    this.cam = new K.CameraRig({ fov: 56, near: 0.08, far: 230, fovPunch: 0, nudge: 0.015, rollKick: 0, idleSpeed: 0, activeSpeed: 0, bassBoost: 0 });
    this.breath = new K.Breath({ beats: 8, period: 12 });
    this.flare = new K.Envelope(0.8);
    this.time = 0; this.k = 0; this.u = 0; this.ign = 0; this.bass = 0; this.bassM = 0; this.bassE = 0; this.energy = 0; this.out = 0;
    this.lamp = 0.25; this.wind = 0;
    this.m = mat4.create();
    this._t = [0, 0, 0];
    this.col = { fog: [0, 0, 0], zen: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], band: [0, 0, 0], tmp: [0, 0, 0], tmp2: [0, 0, 0], patch: [0, 0, 0], house: [0, 0, 0], lamp: [0, 0, 0] };
    this.lampLight = [{ pos: [LAMP[0], LAMP[1] + 0.12, LAMP[2] + 0.15], color: this.col.lamp, radius: 3.9 }];
  }

  update(a, k, dt) {
    this.k = k; this.time += dt;
    const d = K.drive(a, k), t = this.time;
    const b = this.breath.update(a, dt);

    // ignition: held back until k 0.7, then a slow ease on top so it never pops
    this.ign = damp(this.ign, K.stage(k, 0.7, 1), 2.5, dt);
    const ign = this.ign;
    // the fuzz bass: smoothed, only matters once the sky burns
    this.bass = damp(this.bass, a.bass, 0.3, dt);
    this.energy = damp(this.energy, a.energy ?? a.level, 1.2, dt);
    // bass for movement (wind, ember speed): slower unless the Feel allows beat-sized movement; flicker / brightness keep this.bass
    this.bassE = damp(this.bassE, a.bass, 0.8, dt); this.bassM = lerp(this.bassE, this.bass, d.beatMotion);

    // camera: a slow time-driven drift out and back; the ignition pulls it out into the field
    const cyc = 0.5 - 0.5 * Math.cos((t / CYCLE) * TAU);
    const uT = lerp(cyc * (0.85 + 0.15 * K.stage(k, 0.2, 0.7)), 1, K.stage(k, 0.6, 0.95));
    const du = damp(this.u, uT, 7, dt) - this.u;
    this.u += clamp(du, -0.03 * dt, 0.03 * dt);
    this.cam.update(a, k, dt);
    camAt(this.u, this.cam.eye, this.cam.target);
    this.cam.eye[1] += (b - 0.5) * 0.04;
    this.cam.target[1] += ign * 5 + (b - 0.5) * 0.03;   // look up into the burning sky
    const eye = this.cam.eye;
    this.out = K.stage(eye[2], ROOM.hz + 0.2, ROOM.hz + 4);   // 0 inside the room, 1 out in the field
    this.ground.follow(eye[0], eye[2]);

    // one soft event per beat: a flare through the burning bands (and a tiny lamp flicker before that)
    if (d.beat) this.flare.trigger(0.05 + ign * 0.45);
    this.flare.update(dt);

    // the lamp breathes; it brightens a little with the song, never a lot
    this.lamp = 0.22 + b * 0.06 + K.stage(k, 0.1, 0.7) * 0.2 + this.flare.v * 0.15;
    this.glows.set(0, 0.45, 0.82, -2.68, 0.55 + (this.lamp - this.flare.v * 0.15 * (1 - d.beatMotion)) * 0.5, 0, this.lamp, 0, 1);   // the flare's light stays; its halo-size swell is a beat movement
    const win = (0.12 + this.lamp * 0.25) * this.out * K.fadeIn(this.cam.eye[2] - ROOM.hz, 5, 14);   // only from afar: up close you see the lamp itself
    this.glows.set(1, 0, 1.5, ROOM.hz + 0.05, 1.7, 0, win, 0, 1);
    this.glows.upload(2);

    // curtains stir; when the sky burns a hot wind pushes them in
    this.wind = damp(this.wind, 0.04 + d.energy * 0.06 + ign * (0.22 + this.bassM * 0.1), 1.5, dt);
    for (const c of this.curtains) c.mesh.update(curtainGeo(c.x0, c.x1, 0.7, 2.28, ROOM.hz - 0.14, 6, 5, t, this.wind, c.seed));

    this.dust.update(dt, [0, 1.2, 0.2], { amount: K.swell(k, 0.4, 0.8) * (1 - this.out * 0.8), speed: 0.4 + this.wind * 2 });
    this.mist.update(dt, [0, 0.4, -34], { amount: lerp(0.75, 0.45, ign), speed: 0.35 + ign * 0.6 });
    // embers rise from the field behind and around the house, kept well ahead of the camera
    this.embers.update(dt, [0, 6, -6], { amount: ign * 0.95 * K.fadeIn(eye[2], 14, 22), speed: 0.5 + this.energy * 0.6 + this.bassM * ign * 0.5, wind: [0.4, 0.15] });
  }

  render(r) {
    const { col, k, ign } = this, P = this.pal;
    const dim = lerp(0.62, 0.85, K.stage(k, 0, 0.7)) + ign * 0.2;
    // fog: cold and dark; the ignition warms the horizon toward the accent ramp
    scaleColor(col.fog, P.role('fog'), dim);
    mixColor(col.fog, col.fog, scaleColor(col.tmp, P.color(R(2, 1)), 0.7), ign * 0.55);
    r.clear(col.fog);
    this.cam.apply(r);
    mixColor(col.zen, P.color(R(3, 0)), scaleColor(col.tmp, P.color(R(2, 0)), 0.6), ign * 0.45);
    this.sky.draw(r, this.cam.eye, { horizon: col.fog, zenith: col.zen, brightness: dim, starLevel: lerp(0.42 + this.breath.v * 0.08, 0.06, ign) });

    // fire bands: a thin pre-dawn line at the horizon from k 0.35, the whole sky from k 0.7
    const pre = K.stage(k, 0.35, 0.7) * 0.14;
    const eye = this.cam.eye, accent = P.color(R(2, 2));
    this.bands.forEach((bd, i) => {
      const on = ign * K.stage(ign, (bd.on - 0.7) * 2, (bd.on - 0.7) * 2 + 0.45);   // lower bands catch first
      const flick = 0.6 + 0.4 * this.bass + 0.08 * Math.sin(this.time * 2.3 + bd.ph);
      const lvl = (i === 0 ? pre : 0) + on * (1.2 - i * 0.18) * (flick + this.flare.v * 0.6);
      if (lvl < 0.005) return;
      scaleColor(col.band, accent, lvl);
      mat4.trs(this.m, eye[0], eye[1] - 4, eye[2], 0, this.time * bd.speed * 0.2, 0);
      r.draw(bd.mesh, this.m, { texture: bd.tex, unlit: true, fog: false, additive: true, depthWrite: false, tint: col.band, uvOffset: [this.time * bd.speed, -this.time * (0.01 + on * 0.03)] });
    });

    r.setFog(col.fog, 5, lerp(70, 115, ign));
    // light: cold moonlight from behind the camera; the fire swings it round from behind the house
    const L = this._t, s = ign;
    L[0] = lerp(0.3, 0.1, s); L[1] = lerp(-0.5, -0.35, s); L[2] = lerp(-0.8, 0.9, s);
    mixColor(col.light, scaleColor(col.tmp, P.role('light'), lerp(0.24, 0.38, K.stage(k, 0, 0.7))), scaleColor(col.tmp2, P.role('glow'), 0.75), s);
    mixColor(col.amb, scaleColor(col.tmp, P.role('ambient'), 0.32), scaleColor(col.tmp2, P.color(R(2, 1)), 0.3), s * 0.6);
    r.setLight(L, col.light, col.amb);
    // the bedside lamp lights the room (walls, bed, curtains); it swells with the song, flares on the beat
    scaleColor(col.lamp, P.role('glow'), this.lamp * 3.6);
    r.setPointLights(this.lampLight);
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    // the house and the room
    r.draw(this.wallMesh, mat4.identity(this.m), { texture: this.wallTex, tint: col.tint });
    r.draw(this.roofMesh, this.m, { texture: this.woodTex, tint: col.tint });
    r.draw(this.floorMesh, this.m, { texture: this.boardsTex, tint: col.tint });
    r.draw(this.woodMesh, this.m, { texture: this.woodTex, tint: col.tint });
    r.draw(this.sheetMesh, this.m, { texture: this.sheetTex, tint: col.tint });
    r.draw(this.blanketMesh, this.m, { texture: this.blanketTex, tint: col.tint });
    for (const c of this.curtains) r.draw(c.mesh, this.m, { texture: this.curtainTex, tint: col.tint });

    // the field
    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    const sway = 0.02 + this.wind * 0.12;
    r.drawInstanced(this.quad, this.grass, { texture: this.grassTex, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.trees, { texture: this.treeTex, billboard: 1, sway: sway * 0.15, tint: col.tint });

    // additive things last: moonlight on the floor, dust, mist, the lamp, embers
    const pl = 0.22 * (1 - ign * 0.6);
    col.patch[0] = col.patch[1] = col.patch[2] = pl;
    r.draw(this.patchMesh, this.m, { texture: this.patchTex, unlit: true, additive: true, depthWrite: false, tint: col.patch });
    this.dust.draw(r, { brightness: 0.6 });
    this.mist.draw(r, { brightness: dim * (1 + ign * 0.4), opacity: 0.22 });
    col.glow[0] = col.glow[1] = col.glow[2] = 1;
    r.drawInstanced(this.quad, this.glows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, depthWrite: false, fog: false, fade: [40, 80], tint: col.glow });
    this.embers.draw(r, { brightness: 0.6 + this.bass * 0.4 });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r);
    [this.embers, this.dust, this.mist].forEach((x) => x.dispose(r));
    [this.wallMesh, this.roofMesh, this.floorMesh, this.woodMesh, this.sheetMesh, this.blanketMesh, this.patchMesh, this.quad, ...this.curtains.map((c) => c.mesh), ...this.bands.map((b) => b.mesh)].forEach((m) => m.dispose());
    [this.wallTex, this.boardsTex, this.woodTex, this.sheetTex, this.blanketTex, this.curtainTex, this.patchTex, this.groundTex, this.grassTex, this.treeTex, this.glowTex, ...this.bands.map((b) => b.tex)].forEach((x) => r.deleteTexture(x));
    [this.grass, this.trees, this.glows].forEach((i) => i.dispose());
  }
}
