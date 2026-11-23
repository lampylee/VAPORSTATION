// FOG HARBOUR — a rotting fishing town at night in thick fog (original town; mood
// after the public-domain *The Shadow over Innsmouth*, no real or story places).
//
//   town       four rows of sagging gabled houses leaning at odd angles (K.props.gableHouse,
//              three variants, instance tilt), a church whose spire has slumped sideways
//   waterfront a wharf on stilts, net racks with sagging nets, wooden dock lamps with lanterns
//              hanging from the arms (K.Pendulum + instance tilt)
//   sea        still black water with a real reflection (setMirror / setClipBelow), a jagged
//              black reef offshore, ripples (K.Ripples), the water heaving on the bass (draw wave)
//   figures    hunched silhouettes (original sprite, two gait frames) that shuffle down the
//              lanes between the houses out of the fog and gather at the water's edge
//   camera     a slow boat-like drift on an ellipse off the shore, always looking back at the town
//
// Idle:  heavy fog, one lamp and one dim lantern, still water, a dark town, no figures.
// Swell: windows light house by house (K.Stager), the other lamps wake, figures walk out of the
//        fog and gather on the shore, dark humped shapes break the surface by the reef (eyes at
//        the very top), the fog itself takes on the lamp colour.
// Beat:  the lamp at the end of the pier swings (Pendulum, scaled by audio.motion) and a ripple
//        opens at the reef; bass: water heave (smoothed); highs: glints on the lamps.
import { mat4, lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, box, plane, merge, icosphere } from '../gfx/geometry.js';
import { blotch } from '../gfx/textures.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const WATER = 0;
const TAU = Math.PI * 2;
const COL = 10;                              // lot / lane spacing along the shore
const ROWS = [-7, -17, -27, -37];            // house row z (shore at z = 0, sea towards +z)
const FIG_START = -43, N_FIG = 22;
const CHURCH = [-10, -28];
const DECK_Y = 1.15;

/** Ground: a muddy shore rising into a hill behind the town; drops away under the water. */
const height = (x, z) => {
  if (z > 0) return Math.max(-3, 0.45 - z * 0.35);
  const t = -z;
  return 0.45 + t * 0.07 + K.stage(t, 20, 48) * 5 + K.fbm(x * 0.05, z * 0.05, { octaves: 2, seed: 6 }) * 0.6 * clamp(t / 10);
};

// ---- textures ---------------------------------------------------------------

/** Rotten clapboard: horizontal boards, dark gaps, damp stains creeping up from the bottom. */
function clapboardTex() {
  return K.makeIndexed(64, 64, (x, y) => {
    const row = Math.floor(y / 6), ly = y % 6;
    if (ly === 0) return R(0, 0);
    const stain = K.tileBlob(x, y, 16, 3) * 0.9 + (y / 64) * 0.6;
    if (stain > 1.05 && K.rnd(x, y, 2) > 0.3) return R(0, 0);
    const missing = K.rnd(Math.floor((x + row * 13) / 21), row, 5) > 0.93;
    if (missing) return K.dshade(3, 0.3, x, y);
    return K.dshade(0, 1.7 - (ly === 5 ? 0.6 : 0) + K.rnd(row, Math.floor((x + row * 7) / 16), 4) * 0.7 - stain * 0.6, x, y);
  });
}

/** Slate shingles with moss and missing tiles. */
function shingleTex() {
  return K.makeIndexed(64, 64, (x, y) => {
    const row = y >> 3, off = (row & 1) * 4, lx = (x + off) % 8;
    if ((y & 7) === 7 || lx === 0) return R(1, 0);
    if (K.rnd((x + off) >> 3, row, 9) > 0.9) return R(3, 0);            // gap: a shingle has slipped
    const moss = K.tileBlob(x, y, 20, 8);
    if (moss > 0.66) return K.dshade(0, 0.8 + K.rnd(x, y, 1) * 0.6, x, y);
    return K.dshade(1, 1.3 + K.rnd((x + off) >> 3, row, 3) * 0.9 - (y & 7) * 0.08, x, y);
  });
}

/** Window pane with a cross bar. Drawn additive, brightness by instance shade (CLEAR adds nothing). */
function windowTex() {
  return K.makeIndexed(8, 8, (x, y) => {
    if (x === 0 || y === 0 || x === 7 || y === 7 || x === 3 || y === 4) return K.CLEAR;
    return K.dshade(2, 2.1 + (y < 4 ? 0.7 : 0) - x * 0.05, x, y);
  });
}

/** Lantern glass: accent body with dark corner bars. */
function lanternTex() {
  return K.makeIndexed(8, 8, (x, y) => (x === 0 || x === 7 ? R(0, 0) : K.dshade(2, 2.2 + (y < 4 ? 0.6 : 0), x, y)));
}

/** Fishing net: a diamond lattice with knots. */
function netTex() {
  return K.makeIndexed(32, 32, (x, y) => {
    const a = (x + y) % 8, b = (x - y + 64) % 8;
    if (a === 0 && b === 0) return R(1, 2);
    return a === 0 || b === 0 ? R(1, 1) : K.CLEAR;
  });
}

/** Wet dark skin with faint scale rows (the shapes by the reef). */
function skinTex() {
  return K.makeIndexed(32, 32, (x, y) => {
    const row = y >> 2, lx = (x + (row & 1) * 2) % 4;
    return K.dshade(1, 0.35 + (lx === 0 || (y & 3) === 3 ? 0 : 0.55) + K.tileBlob(x, y, 16, 2, 32) * 0.4, x, y);
  });
}

// Figures (K.sprites.figure hunch), nets (K.props.sagStrip / sagPosts), reef rocks (K.props.rock)
// and the boat camera (K.OrbitFocusRig) come from the kit (Kit v5, promoted from this file).

// ---- the style ----------------------------------------------------------------

export class FogHarbour {
  static meta = { name: 'Fog Harbour' };
  static palette = fromKeys('fog-harbour', 'Fog Harbour', ['#6b5a43', '#56626a', '#c9dc6a', '#4a5a50']);

  init(r) {
    this.ground = new K.Terrain(r, { size: 170, cells: 32, height, uvScale: 0.3 });
    this.groundTex = r.texture(blotch({ ramp: 0, scale: 8, seed: 11, minShade: 1, noise: 0.1 }));
    this.sky = new K.Sky(r, { stars: 30, moon: true, moonDir: [0.5, 0.16, -1], moonSize: 3.6, clouds: 5, moonTexture: K.sprites.moon({ ramp: 3 }) });
    this.waterMesh = r.createMesh(plane(260, 26, 36));
    this.waterTex = r.texture(K.tex.water({ ramp: 1, seed: 7 }));

    // ---- houses: three variants, instanced, leaning
    const variants = [[5, 4.5, 3, 2.2], [6.2, 5, 3.4, 2.6], [4.4, 4, 4.4, 2.1]];
    this.houseMeshes = variants.map(([w, d, h, rh]) => {
      const g = K.props.gableHouse(w, d, h, rh, { tile: 2.5, eave: 0.45, overhang: 0.4 });
      return { walls: r.createMesh(g.walls), roof: r.createMesh(g.roof), w, d, h };
    });
    this.wallTex = r.texture(clapboardTex());
    this.roofTex = r.texture(shingleTex());
    this.houseInst = variants.map(() => r.createInstances(48));
    this.houses = [];
    const counts = [0, 0, 0];
    ROWS.forEach((z0, row) => {
      for (let c = -8; c <= 8; c++) {
        const x0 = c * COL + (K.rand2(c, row, 3) - 0.5) * 1.4;
        if (K.rand2(c, row, 1) < (row === 3 ? 0.4 : 0.18)) continue;                  // empty lots
        if (row === 2 && (c === -1)) continue;                                       // the church lot
        const v = Math.floor(K.rand2(c, row, 2) * 3), V = this.houseMeshes[v];
        const z = z0 + (K.rand2(c, row, 4) - 0.5) * 2;
        const rotY = (K.rand2(c, row, 5) - 0.5) * 0.35;
        const rx = (K.rand2(c, row, 6) - 0.5) * 0.12, rz = (K.rand2(c, row, 7) - 0.5) * 0.16;   // the lean
        const hs = 0.9 + K.rand2(c, row, 8) * 0.3;
        const y = height(x0, z) - 0.55;
        const shade = 0.75 + K.rand2(c, row, 9) * 0.35;
        this.houseInst[v].set(counts[v]++, x0, y, z, 1, rotY, shade, 0, hs, rx, rz);
        this.houses.push({ x: x0, y, z, v, rotY, rx, rz, hs, key: K.rand2(c, row, 10) + row * 0.15 + Math.abs(c) * 0.02, ph: K.rand2(c, row, 11) * TAU });
      }
    });
    this.houseInst.forEach((inst, i) => inst.upload(counts[i]));
    // lighting order: mostly random, the shore rows a little earlier
    this.houses.sort((a, b) => a.key - b.key);
    this.lit = new K.Stager(this.houses.length, { from: [0.04, 0.72], to: [0.16, 0.9], rise: [0.8, 2.6], fall: 1.6 });
    this.houses[0].idle = 0.4; this.houses[3].idle = 0.25;          // a lamp or two burning even when quiet

    // windows on the front (+z) wall of every house, following its lean
    this.winMesh = r.createMesh(new GeoBuilder().face([0, 0, 0], [0.32, 0, 0], [0, 0.42, 0]).build());
    this.winTex = r.texture(windowTex());
    this.windows = [];
    const COLS = [-0.27, 0.27];
    this.houses.forEach((h, hi) => {
      const V = this.houseMeshes[h.v], rows = V.h > 4 ? [0.3, 0.72] : [0.48];
      const house = { x: h.x, y: h.y, z: h.z, rotX: h.rx, rotY: h.rotY, rotZ: h.rz, hs: h.hs };
      for (const w of K.props.houseWindows(house, { w: V.w, h: V.h, d: V.d }, { rows, cols: COLS })) {
        const fy = rows[w.row], fx = COLS[w.col];
        if (K.rand2(hi, Math.round(fy * 10 + fx * 10), 12) < 0.2) continue;        // boarded up
        this.windows.push({ h: hi, x: w.x, y: w.y, z: w.z, f: K.rand2(hi, fy * 7 + fx, 13) });
      }
    });
    this.winInst = r.createInstances(this.windows.length);

    // ---- church with a slumped spire
    const nave = K.props.gableHouse(8, 5.5, 4.6, 3, { tile: 2.5 });
    const tower = K.props.shift(box(2.8, 8.5, 2.8, { uvRepeat: [1.2, 3.4] }), -5.2, 4.25, 0.6);
    const spire = K.transform(K.props.prism(4, 1.95, 6.5, { taper: 0.03, cap: false, uvRepeat: [2, 2.6] }), { rot: [0.08, Math.PI / 4, 0.26] });
    K.props.shift(spire, -5.2, 8.5, 0.6);
    this.churchWalls = r.createMesh(merge([{ geo: nave.walls }, { geo: tower }]));
    this.churchRoof = r.createMesh(merge([{ geo: nave.roof }, { geo: spire }]));
    this.churchM = mat4.trs(mat4.create(), CHURCH[0], height(CHURCH[0], CHURCH[1]) - 0.6, CHURCH[1], 0.03, 0.12, -0.05);

    // ---- wharf on stilts (one mesh): a deck along the shore and a short pier
    const parts = [
      { geo: K.props.shift(box(22, 0.25, 7, { uvRepeat: [8, 2.5] }), -14, DECK_Y, 2.5) },
      { geo: K.props.shift(box(3, 0.25, 4, { uvRepeat: [1, 1.5] }), -6, DECK_Y, 7.5) },
    ];
    for (let x = -24.5; x <= -3.5; x += 2.6) for (const z of [-0.8, 5.8]) parts.push({ geo: K.props.shift(K.props.prism(5, 0.16, 4), x, -2.8, z) });
    for (const z of [7.5, 9.3]) for (const x of [-7.3, -4.7]) parts.push({ geo: K.props.shift(K.props.prism(5, 0.16, 4.6), x, -2.8, z) });
    // a few broken piles out in the water
    for (let i = 0; i < 6; i++) parts.push({ geo: K.props.shift(K.props.prism(5, 0.15, 3 + K.rand2(i, 1, 4) * 1.5, { taper: 0.7 }), -1 + i * 2.2, -2.8, 8 + K.rand2(i, 2, 4) * 3) });
    // deck tops again, subdivided, a hair above the boxes: the lanterns light them as pools (Kit v7 point lights)
    const top = new GeoBuilder();
    top.face([-14, DECK_Y + 0.135, 2.5], [11, 0, 0], [0, 0, -3.5], [0, 0, 8, 2.5], 14);
    top.face([-6, DECK_Y + 0.135, 7.5], [1.5, 0, 0], [0, 0, -2], [0, 0, 1, 1.5], 4);
    parts.push({ geo: top.build() });
    this.wharfMesh = r.createMesh(merge(parts));
    this.boardTex = r.texture(K.tex.boards({ ramp: 0, seed: 4 }));

    // ---- nets on racks
    this.netMesh = r.createMesh(K.props.sagStrip(5, 2, 0.55, { cols: 8, bottom: 0.35, bottomSag: 0.4, tile: 1 / 0.6 }));
    this.netPosts = r.createMesh(K.props.sagPosts(5, 2));
    this.netTex = r.texture(netTex());
    this.nets = r.createInstances(5); this.netPostInst = r.createInstances(5);
    const netAt = [[9, -1.6, 0.1], [16, -2.2, -0.08], [27, -1.4, 0.15], [-20, 5.2, 0], [-38, -1.8, -0.1]];
    netAt.forEach(([x, z, ry], i) => {
      const y = x < -3 && x > -25 && z > -1 ? DECK_Y + 0.12 : height(x, z) - 0.05;
      this.nets.set(i, x, y, z, 1, ry, 0.9, 0, 1); this.netPostInst.set(i, x, y, z, 1, ry, 0.8, 0, 1);
    });
    this.nets.upload(netAt.length); this.netPostInst.upload(netAt.length);

    // ---- dock lamps: wooden posts with a lantern on the arm; lamp 0 = end of the pier (the beat lamp)
    this.lampMesh = r.createMesh(K.props.lampPost(4.2, 0.95));
    this.lampInst = r.createInstances(6);
    this.lanternMesh = r.createMesh(merge([
      { geo: K.props.shift(K.props.prism(4, 0.025, 0.4, { cap: false }), 0, -0.4, 0) },
      { geo: K.props.shift(box(0.3, 0.42, 0.3), 0, -0.64, 0) },
      { geo: K.props.shift(K.props.prism(4, 0.24, 0.16, { taper: 0.2 }), 0, -0.44, 0) },
    ]));
    this.lanternTex = r.texture(lanternTex());
    this.lanternInst = r.createInstances(6);
    const lampAt = [[-6, 8.9, DECK_Y + 0.12, Math.PI / 2], [-21, 5.3, DECK_Y + 0.12, Math.PI / 2], [6, -1.2, null, Math.PI / 2], [-33, -1.3, null, Math.PI / 2], [21, -1, null, Math.PI / 2], [40, -1.4, null, Math.PI / 2]];
    this.lamps = lampAt.map(([x, z, y0, rot], i) => {
      const y = y0 ?? height(x, z) - 0.05;
      const hook = K.rotPoint([0.95, 4.2 - 0.12, 0], 0, rot, 0);
      this.lampInst.set(i, x, y, z, 1, rot, 0.85, 0, 1);
      return { x, y, z, rot, hx: x + hook[0], hy: y + hook[1], hz: z + hook[2], on: 0, ph: i * 1.9, idle: i === 0 ? 0.85 : i === 1 ? 0.3 : 0, from: 0.12 + i * 0.1 };
    });
    this.lampInst.upload(this.lamps.length);
    this.lights = new K.LightSet({ reach: 10 });
    this.beatSwing = [new K.Pendulum(1.45, 0.32, 0.45), new K.Pendulum(1.3, 0.36, 0.4)];
    this.breeze = [new K.Pendulum(1.6, 0.4, 0.25), new K.Pendulum(1.5, 0.45, 0.25)];

    // ---- glows (lamps, house halos, eyes) + glints, one draw each
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.glowQuad = r.createMesh(K.centredQuad(1, 1));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.glintTex = r.texture(K.sprites.twinkle({ index: R(2, 3) }));
    this.glows = r.createInstances(this.houses.length + 32);
    this.glints = r.createInstances(8);

    // ---- the reef and what rises beside it
    const rocks = [];
    for (let i = 0; i < 22; i++) {
      const x = -32 + i * 2.6 + (K.rand2(i, 1, 2) - 0.5) * 2.5, z = 29 + (K.rand2(i, 2, 2) - 0.5) * 6;
      const s = 0.7 + K.rand2(i, 3, 2) * 1.1, sy = 0.6 + K.rand2(i, 4, 2) * 1.4 * (i % 3 === 1 ? 1.6 : 1);
      rocks.push({ geo: K.props.rock(i + 1, { spike: 1, rough: 0.8 }), xf: K.xf({ pos: [x, -0.6, z], rot: [0, K.rand2(i, 5, 2) * TAU, 0], scale: [s * 1.3, sy, s] }) });
    }
    this.reefMesh = r.createMesh(merge(rocks));
    this.rockTex = r.texture(K.tex.cliffRock({ seed: 9 }));
    this.shapeMesh = r.createMesh(merge([
      { geo: icosphere(1, 1), xf: K.xf({ scale: [2.5, 0.65, 0.8] }) },
      // a row of fin spines along the back, raked backwards
      ...[-1.1, -0.2, 0.7].map((x, j) => ({ geo: K.props.prism(3, 0.3, 0.9 - j * 0.2, { taper: 0.05 }), xf: K.xf({ pos: [x, 0.45, 0], rot: [0, 0, -0.5], scale: [1.3, 1, 0.35] }) })),
    ]));
    this.skinTex = r.texture(skinTex());
    this.shapes = [[-18, 23, 1.3], [-8, 21.5, 1], [3, 23.5, 1.5], [12, 22, 1.1], [-26, 36, 1.4], [-4, 37.5, 1.2], [9, 35.5, 1]]
      .map(([x, z, s], i) => ({ x, z, s, rotY: K.rand2(i, 1, 5) * TAU, ph: K.rand2(i, 2, 5) * TAU, eyes: i < 4, tRip: 1 + i }));
    this.rise = new K.Stager(this.shapes.length, { from: [0.42, 0.74], to: [0.62, 0.95], rise: [2.5, 4.5], fall: 2.2 });
    this.shapeInst = r.createInstances(this.shapes.length);
    this.ripples = new K.Ripples(r, { color: R(3, 3), life: 4.5, max: 24 });
    this.nextIdleRipple = 3;

    // ---- figures
    this.figTex = [0, 1].map((frame) => r.texture(K.sprites.figure({ pose: 'hunch', frame, ramp: 0, eyes: R(3, 2) })));
    this.figInst = [r.createInstances(N_FIG), r.createInstances(N_FIG)];
    this.figs = [];
    for (let i = 0; i < N_FIG; i++) {
      let c = Math.floor(K.rand2(i, 1, 21) * 11) - 6;                 // lanes x = c*10 + 5, spread along the shore
      const lane = c * COL + 5, gx = lane + (K.rand2(i, 2, 21) - 0.5) * 6, gz = -0.6 - K.rand2(i, 3, 21) * 1.4;
      const sx = lane + (K.rand2(i, 4, 21) - 0.5) * 1.2;
      this.figs.push({ sx, lane, gx, gz, L: Math.hypot(gx - sx, gz - FIG_START), s: 0.95 + K.rand2(i, 7, 21) * 0.25 });
    }
    // walk out of the fog as the swell rises, home again as it falls, never teleporting
    this.walk = new K.Walkers(N_FIG, { spread: 0.08, length: (i) => this.figs[i].L, gaitRate: 2.4, idleRate: 0.9 });
    this.walk.list.forEach((w, i) => { w.th = 0.18 + (i / (N_FIG - 1)) * 0.55 + (K.rand2(i, 6, 21) - 0.5) * 0.06; w.phase = K.rand2(i, 5, 21) * TAU; });

    // ---- low mist banks on the water and in the lanes
    this.mistTex = r.texture(K.sprites.mistBank({ ramp: 3, seed: 5 }));
    this.mistInst = r.createInstances(14);
    this.mists = [];
    for (let i = 0; i < 14; i++) {
      const onWater = i < 8;
      const x = -55 + (i % 8) * 15 + K.rand2(i, 1, 8) * 6, z = onWater ? 2 + K.rand2(i, 2, 8) * 6 : -12 - K.rand2(i, 2, 8) * 16;
      this.mists.push({ x, z, y: onWater ? -0.4 : height(x, z) - 0.4, s: 12 + K.rand2(i, 3, 8) * 8, ph: K.rand2(i, 4, 8) * TAU });
    }

    this.heave = 0; this.time = 0; this.k = 0;
    this.a = { level: 0, bass: 0, mid: 0, high: 0, beat: false, beatPulse: 0, beatCount: 0 };
    this.m = mat4.create();
    // a slow boat drift on an ellipse off the shore, always looking back at the town
    // (the focus slides along the shore with the boat, so the view looks across the town, not at one point)
    this.cam = new K.OrbitFocusRig({
      center: [0, 3.3, 30], rx: 58, rz: 16, start: -0.35, focus: (e) => [e[0] * 0.8, 0, -12], lookMix: 1 / 1.45,
      lookDist: 12, lookDrop: 1.1, bob: 0.34, rollSway: 0.022,
      fov: 58, near: 0.1, far: 170, fovPunch: 1.2, nudge: 0.07, rollKick: 0.01, idleSpeed: 1.0, activeSpeed: 2.3, bassBoost: 0.3,
    });
    this.col = { fog: [0, 0, 0], glowFog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], one: [1, 1, 1], water: [0, 0, 0], mist: [0, 0, 0], dark: [0, 0, 0], rock: [0, 0, 0], skin: [0, 0, 0], lamp: [0, 0, 0], focus: [0, 0, 0] };
    this._wave = [0, 0.16, 0.55];
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt; this.dt = dt;
    const d = K.drive(a, k), t = this.time;
    this.cam.update(a, k, dt);
    const eye = this.cam.eye;
    this.ground.follow(eye[0], eye[2]);
    this.heave = damp(this.heave, d.bass * 0.22 + (d.energy || 0) * 0.08, 0.45, dt);
    this._wave[0] = 0.035 + this.heave;

    // ---- beat: the pier lamp swings, a ripple opens at the reef
    if (d.beat) {
      for (const p of this.beatSwing) p.push((Math.sign(p.v) || 1) * 0.32 * d.motion * k);
      const rx = -30 + K.rand2(a.beatCount | 0, 3, 7) * 50, rz = 29 + (K.rand2(a.beatCount | 0, 4, 7) - 0.5) * 8;
      this.ripples.spawn(rx, WATER + 0.02, rz, 4 + 3 * k, (0.45 + 0.55 * k) * Math.min(1, d.accent));
    }
    for (const p of this.beatSwing) { p.push((Math.sign(p.v) || 1) * d.bass * 0.06 * dt); p.push(Math.sin(t * 0.6) * 0.02 * dt); p.update(dt); }
    for (const p of this.breeze) { p.push(Math.sin(t * 0.45 + p.w) * 0.03 * dt + (Math.sign(p.v) || 1) * d.bass * 0.03 * dt); p.update(dt); }
    // idle: now and then something stirs out by the reef
    if ((this.nextIdleRipple -= dt) <= 0) {
      this.nextIdleRipple = 4 + Math.random() * 6;
      this.ripples.spawn(-28 + Math.random() * 46, WATER + 0.02, 24 + Math.random() * 12, 2 + Math.random() * 1.5, 0.45);
    }

    // ---- windows, house by house
    this.lit.update(k, dt);
    const nh = this.houses.length;
    let ng = 0;
    this.houses.forEach((h, i) => {
      const flick = 0.85 + 0.15 * Math.sin(t * 3.1 + h.ph) * Math.sin(t * 1.7 + h.ph * 2);
      h.level = Math.max(h.idle || 0, this.lit.v[i]) * flick;
      if (h.level > 0.02) {
        const V = this.houseMeshes[h.v], f = K.rotPoint([0, V.h * 0.5 * h.hs, V.d / 2 + 0.6], h.rx, h.rotY, h.rz);
        this.glows.set(ng++, h.x + f[0], h.y + f[1], h.z + f[2], 5 + V.w * 0.3, 0, h.level * 0.22, 0, 1);
      }
    });
    let nw = 0;
    for (const w of this.windows) {
      const h = this.houses[w.h], b = h.level * (0.75 + w.f * 0.5);
      if (b > 0.01) this.winInst.set(nw++, w.x, w.y, w.z, 1, h.rotY, b, 0, 1, h.rx, h.rz);
    }
    this.winInst.upload(nw);

    // ---- lamps and lanterns
    let nt = 0;
    this.lamps.forEach((L, i) => {
      const on = Math.max(L.idle, K.stage(k, L.from, L.from + 0.15));
      const sw = i === 0 ? this.beatSwing : this.breeze, c = Math.cos(L.ph), s = Math.sin(L.ph);
      const rx = i === 0 ? sw[0].x : sw[0].x * c - sw[1].x * s, rz = i === 0 ? sw[1].x : sw[1].x * c + sw[0].x * s;
      const flick = 0.88 + 0.12 * Math.sin(t * 9 + L.ph * 3) * Math.sin(t * 5.3 + L.ph);
      L.level = on * flick;
      this.lanternInst.set(i, L.hx, L.hy, L.hz, 1, L.rot, 0.25 + L.level * 0.9, 0, 1, rx, rz);
      const g = K.rotPoint([0, -0.64, 0], rx, L.rot, rz);
      L.gx = L.hx + g[0]; L.gy = L.hy + g[1]; L.gz = L.hz + g[2];
      if (L.level > 0.01) this.glows.set(ng++, L.gx, L.gy, L.gz, 2.4 + d.pulse * 0.5, 0, L.level, 0, 1);
      const gl = L.level * d.high * (0.6 + 0.4 * Math.sin(t * 13 + i * 2));
      if (gl > 0.02) this.glints.set(nt++, L.gx, L.gy, L.gz, 0.9 + d.high * 0.8, 0, gl, 0, 1, 0, t * 0.8 + i);
    });
    this.lanternInst.upload(this.lamps.length); this.glints.upload(nt);

    // ---- shapes breaking the surface by the reef
    this.rise.update(k, dt);
    this.shapes.forEach((S, i) => {
      const rv = this.rise.v[i], s = S.s;
      const y = -1.7 * s + rv * 1.45 * s + Math.sin(t * 0.55 + S.ph) * 0.12 * (0.3 + rv) + this.heave * 0.6;
      const x = S.x + Math.sin(t * 0.05 + S.ph) * 1.5 * rv;
      const ry = S.rotY + Math.sin(t * 0.07 + S.ph) * 0.3;
      this.shapeInst.set(i, x, y, S.z, s, ry, 0.9, 0, 1, 0, Math.sin(t * 0.4 + S.ph) * 0.06);
      if (S.eyes) {
        const e = K.stage(rv, 0.75, 1) * (0.5 + 0.2 * Math.sin(t * 0.9 + S.ph));
        if (e > 0.01) for (const side of [-1, 1]) {
          const q = K.rotPoint([-2.2 * s, 0.3 * s, side * 0.3 * s], 0, ry, 0);
          this.glows.set(ng++, x + q[0], y + q[1], S.z + q[2], 0.45 * s, 0, e, 0, 1);
        }
      }
      if (rv > 0.15 && rv < 0.95 && (S.tRip -= dt) <= 0) { S.tRip = 2.5 + Math.random() * 2.5; this.ripples.spawn(x, WATER + 0.02, S.z, 3 * s, 0.6 * rv); }
    });
    this.shapeInst.upload(this.shapes.length);
    this.glows.upload(ng);
    this.ripples.update(dt);

    // ---- figures shuffle down the lanes and gather at the water's edge
    const n = [0, 0];
    for (const w of this.walk.update(k, dt, { speed: 1.5 + k * 0.5 })) {   // phase: a slow rocking shuffle even when standing
      if (w.d < 0.05) continue;                                        // still back in the fog, out of sight
      const F = this.figs[w.i], u = w.u, z = lerp(FIG_START, F.gz, u);
      const x = lerp(F.sx, F.lane, clamp(u * 3)) + (F.gx - F.lane) * K.stage(u, 0.75, 1);
      const sn = Math.sin(w.phase), y = height(x, z) - 0.05 + Math.abs(sn) * 0.07;
      const f = sn > 0 ? 0 : 1;
      this.figInst[f].set(n[f]++, x, y, z, 1.3 * F.s, 0, 0.8, 0, 1.5, 0, sn * 0.12 + 0.04);
    }
    this.figInst[0].upload(n[0]); this.figInst[1].upload(n[1]);

    // ---- mist drifts (never wraps, just sways along the shore)
    this.mists.forEach((M, i) => this.mistInst.set(i, M.x + Math.sin(t * 0.03 + M.ph) * 6, M.y, M.z, M.s, 0, 1, 0, 0.25));
    this.mistInst.upload(this.mists.length);
  }

  /** Everything above the water (drawn twice: mirrored, then normally). */
  _world(r, col, refl) {
    const eye = this.cam.eye, glowK = refl ? 0.45 : 1;
    this.sky.draw(r, eye, { horizon: col.fog, zenith: this.pal.color(R(3, 0)), brightness: col.tint[0] * 0.9, starLevel: 0.12, cloudDrift: this.time * 0.003 });
    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    this.houseMeshes.forEach((H, i) => {
      r.drawInstanced(H.walls, this.houseInst[i], { texture: this.wallTex, tint: col.tint });
      r.drawInstanced(H.roof, this.houseInst[i], { texture: this.roofTex, tint: col.tint });
    });
    r.draw(this.churchWalls, this.churchM, { texture: this.wallTex, tint: col.tint });
    r.draw(this.churchRoof, this.churchM, { texture: this.roofTex, tint: col.tint });
    r.draw(this.wharfMesh, mat4.identity(this.m), { texture: this.boardTex, tint: col.tint });
    r.drawInstanced(this.lampMesh, this.lampInst, { texture: this.boardTex, tint: col.tint });
    r.drawInstanced(this.netPosts, this.netPostInst, { texture: this.boardTex, tint: col.tint });
    r.drawInstanced(this.netMesh, this.nets, { texture: this.netTex, tint: col.tint, twoSided: true });
    r.draw(this.reefMesh, mat4.identity(this.m), { texture: this.rockTex, tint: col.rock });
    r.drawInstanced(this.shapeMesh, this.shapeInst, { texture: this.skinTex, tint: col.skin });
    r.drawInstanced(this.quad, this.figInst[0], { texture: this.figTex[0], billboard: 1, unlit: true, tint: col.dark });
    r.drawInstanced(this.quad, this.figInst[1], { texture: this.figTex[1], billboard: 1, unlit: true, tint: col.dark });
    r.drawInstanced(this.lanternMesh, this.lanternInst, { texture: this.lanternTex, unlit: true, tint: refl ? col.water : col.one });
    // lights shine through the fog but fade with distance, so nothing pops at the far edge
    col.glowFog[0] = col.glowFog[1] = col.glowFog[2] = glowK;
    r.drawInstanced(this.winMesh, this.winInst, { texture: this.winTex, unlit: true, additive: true, fog: false, fade: [30, 80], depthWrite: false, tint: col.glowFog });
    r.drawInstanced(this.glowQuad, this.glows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [35, 85], depthWrite: false, tint: col.glowFog });
  }

  render(r) {
    const { col, k } = this, P = this.pal, d = K.drive(this.a, k);
    const dim = lerp(0.62, 1, k);
    // the fog takes on the lamp colour as the swell peaks
    scaleColor(col.fog, P.role('fog'), dim);
    mixColor(col.fog, col.fog, P.role('glow'), K.stage(k, 0.45, 1) * 0.16);
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 5, lerp(40, 58, k));
    r.setLight([0.35, -0.55, -0.75], scaleColor(col.light, P.role('light'), lerp(0.3, 0.55, k)), scaleColor(col.amb, P.role('ambient'), lerp(0.4, 0.55, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    col.rock[0] = col.rock[1] = col.rock[2] = dim * 0.42;
    col.skin[0] = col.skin[1] = col.skin[2] = dim * 0.85;
    col.dark[0] = col.dark[1] = col.dark[2] = 0.45;
    col.water[0] = col.water[1] = col.water[2] = 0.5;

    // the lanterns light the wharf, posts and house fronts (and so their reflection); the best 4 near the view
    const L = this.lights, eye = this.cam.eye, tg = this.cam.target;
    scaleColor(col.lamp, P.role('glow'), 2.4 + d.pulse * 0.4);
    L.begin();
    this.lamps.forEach((lp, i) => { if (lp.gx !== undefined) L.add(i, lp.gx, lp.gy - 0.1, lp.gz, col.lamp, 7.5, lp.level); });
    const fx = tg[0] - eye[0], fz = tg[2] - eye[2], fn = Math.hypot(fx, fz) || 1;
    col.focus[0] = eye[0] + (fx / fn) * 10; col.focus[1] = 2; col.focus[2] = eye[2] + (fz / fn) * 10;
    L.apply(r, col.focus, this.dt || 1 / 60);

    // 1) reflection
    r.setMirror(WATER);
    const tv = col.tint[0];
    col.tint[0] = col.tint[1] = col.tint[2] = tv * 0.6;
    this._world(r, col, true);
    col.tint[0] = col.tint[1] = col.tint[2] = tv;
    r.setMirror(null);
    r.clearDepth();

    // 2) the world, clipped at the waterline
    r.setClipBelow(WATER);
    this._world(r, col, false);
    r.setClipBelow(null);
    r.drawInstanced(this.glowQuad, this.glints, { texture: this.glintTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [25, 60], depthWrite: false, tint: col.one });

    // 3) black water over the reflection, heaving on the bass
    col.water[0] = col.water[1] = col.water[2] = dim * 0.5;
    const drift = this.time * 0.006;
    r.draw(this.waterMesh, mat4.trs(this.m, 0, WATER, 20), { texture: this.waterTex, tint: col.water, opacity: lerp(0.66, 0.56, k), uvOffset: [drift, drift * 0.4], wave: this._wave });
    this.ripples.draw(r, { brightness: lerp(0.3, 0.6, k) });

    // 4) low mist banks: a faint additive glow (screen-door mist reads as a dotted fence at 320x240),
    //    taking on the lamp colour at the top of the swell
    mixColor(col.mist, scaleColor(col.mist, P.role('fog'), 0.22), P.role('glow'), K.stage(k, 0.4, 1) * 0.12 + d.pulse * 0.02);
    r.drawInstanced(this.quad, this.mistInst, { texture: this.mistTex, billboard: 1, unlit: true, additive: true, fog: false, depthWrite: false, fade: [18, 70], tint: col.mist });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.ripples.dispose(r);
    this.houseMeshes.forEach((H) => { H.walls.dispose(); H.roof.dispose(); });
    [this.waterMesh, this.winMesh, this.churchWalls, this.churchRoof, this.wharfMesh, this.netMesh, this.netPosts, this.lampMesh, this.lanternMesh, this.quad, this.glowQuad, this.reefMesh, this.shapeMesh].forEach((m) => m.dispose());
    [this.groundTex, this.waterTex, this.wallTex, this.roofTex, this.winTex, this.boardTex, this.netTex, this.lanternTex, this.glowTex, this.glintTex, this.rockTex, this.skinTex, this.mistTex, ...this.figTex].forEach((t) => r.deleteTexture(t));
    [...this.houseInst, this.winInst, this.nets, this.netPostInst, this.lampInst, this.lanternInst, this.glows, this.glints, this.shapeInst, ...this.figInst, this.mistInst].forEach((i) => i.dispose());
  }
}
