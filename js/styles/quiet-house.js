// QUIET HOUSE — for "No Surprises" (OK Computer palette). The least reactive scene in the set.
//
// A tidy little house and garden at dusk: picket fence, mown lawn, a paved path to
// the door, hedges and a garden tree, a quiet street with one lamp post and a few
// neighbouring houses fading into the fog. The camera stands across the street and
// barely drifts.
//
// Idle: everything still, one window softly lit (with its light pooled on the lawn).
// Swell: windows light up one by one, here and in the neighbours' houses; the street
// lamp comes on; the fog slowly turns a faint, wrong green (fog and horizon mixed
// toward secondary/accent shades, the composite pass dithers it).
// Beat: one small glint per beat at most (a fence post, a window corner, a star),
// a glockenspiel twinkle that eases in and rings out. Idle: the odd star twinkles.
// Song sections (K.Moods, Conductor on): intro / breakdown / outro pull back to one lit window with
// the camera closest to the house; a build lets the green creep into the fog and wakes more windows;
// the drop lights every window and the camera eases back to show the street. Conductor off = base.
// Light (Kit v7): the street lamp and the lit ground-floor windows are point lights (K.LightSet);
// the lawn, path, pavement and road near the house are subdivided so their light pools read.
import { mat4, lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, merge } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const TAU = Math.PI * 2;
const FENCE_Z = 8.1;          // front fence line of the main garden
const GARDEN_X = 6;           // side fences at x = ±GARDEN_X
const CAM = [5.6, 1.9, 19.8];
const N_TWINKLES = 8;

const height = (x, z) => {
  const d = Math.hypot(x, z + 10);
  return (K.fbm(x * 0.02, z * 0.02, { octaves: 3, seed: 21 }) - 0.35) * 9 * clamp((d - 50) / 45);
};

// ---- indexed textures (local generators) ----
const grassTex = () => K.makeIndexed(64, 64, (x, y) => K.dshade(1, 0.7 + K.blobNoise(x, y, 9, 3) * 0.8 + K.rnd(x, y, 4) * 0.35, x, y));
// mown stripes, 4 bands across the lawn decal
const lawnTex = () => K.makeIndexed(64, 64, (x, y) => K.dshade(1, ((x >> 4) & 1 ? 1.45 : 1.05) + K.rnd(x, y, 6) * 0.3, x, y));
// horizontal clapboards, 8 px tall
const sidingTex = () => K.makeIndexed(64, 64, (x, y) => (y & 7) === 7 ? R(0, 1) : K.dshade(0, 2.05 + ((y & 7) / 7) * 0.5 + K.rnd(x >> 2, y >> 3, 2) * 0.15, x, y));
// staggered roof shingles
const roofTex = () => K.makeIndexed(64, 64, (x, y) => {
  const row = y >> 3, off = (row & 1) * 4;
  if ((y & 7) === 7 || ((x + off) & 7) === 0) return R(3, 0);
  return K.dshade(1, 0.35 + ((y & 7) / 7) * 0.6 + K.rnd((x + off) >> 3, row, 9) * 0.3, x, y);
});
// picket fence: 8 pickets per tile with pointed tops and two rails
const fenceTex = () => K.makeIndexed(64, 32, (x, y) => {
  const lx = x & 7;
  if ((y >= 9 && y <= 10) || (y >= 23 && y <= 24)) return R(0, 2);
  if (lx < 1 || lx > 5) return K.CLEAR;
  if (y < 4 && Math.abs(lx - 3) > y * 0.7) return K.CLEAR;
  return K.dshade(0, 2.5 + (lx === 5 ? -0.6 : 0) + K.rnd(x >> 3, 0, 5) * 0.3, x, y);
});
const asphaltTex = () => K.makeIndexed(64, 64, (x, y) => {
  if (y >= 30 && y <= 32 && x < 32) return K.dshade(0, 1.6, x, y);   // a worn dashed centre line
  return K.dshade(3, 0.4 + K.rnd(x, y, 7) * 0.6, x, y);
});
// light pool on the lawn under a lit window (additive), fades with distance
const poolTex = () => K.makeIndexed(32, 32, (x, y) => {
  const t = y / 31, spread = 4 + t * 8;
  const a = (1 - t) * (1 - Math.abs(x - 15.5) / spread);
  if (a <= 0 || a < K.bayer(x, y) * 0.8) return K.CLEAR;
  return a > 0.55 ? R(2, 2) : R(2, 1);
});
// glass with half-drawn curtains, warmer (lighter) toward the bottom
const glassTex = () => K.makeIndexed(32, 32, (x, y) => {
  const curtain = Math.max(0, 1 - x / 7) + Math.max(0, 1 - (31 - x) / 7);
  if (curtain > 0.2) return K.dshade(2, 0.6 + (y / 31) * 0.6 - curtain * 0.4, x, y);
  return K.dshade(2, 1.4 + (y / 31) * 1.6, x, y);
});
// window frame + cross mullion (glass is CLEAR so the glass quad shows through)
const frameTex = () => K.makeIndexed(32, 32, (x, y) => (x < 2 || x > 29 || y < 2 || y > 29 || x === 15 || x === 16 || y === 13 || y === 14) ? K.dshade(0, 2.7, x, y) : K.CLEAR);
// trim atlas: [door | brick] / [stone | dark]
const trimTex = () => K.makeIndexed(64, 64, (x, y) => {
  const lx = x & 31, ly = y & 31;
  if (y < 32 && x < 32) {                       // door: two panels, a small knob
    if (lx < 2 || lx > 29 || ly < 2) return R(0, 3);
    if (lx >= 22 && lx <= 23 && ly >= 17 && ly <= 18) return R(2, 2);
    const inPanel = lx > 5 && lx < 26 && ((ly > 4 && ly < 14) || (ly > 17 && ly < 29));
    return K.dshade(1, inPanel ? 1.1 : 1.6, x, y);
  }
  if (y < 32) {                                 // brick
    const row = ly >> 2, off = (row & 1) * 4;
    return (ly & 3) === 3 || ((lx + off) & 7) === 0 ? R(0, 1) : K.dshade(0, 0.5 + K.rnd((lx + off) >> 3, row, 3) * 0.6, x, y);
  }
  if (x < 32) return K.dshade(0, 1.3 + K.rnd(x, y, 8) * 0.8, x, y);   // stone
  return R(0, 0);                               // dark (lamp post, gutters)
});
const RECT = { door: [0, 0, 0.5, 0.5], brick: [0.5, 0, 1, 0.5], stone: [0, 0.5, 0.5, 1], dark: [0.52, 0.52, 0.98, 0.98] };

/** Set every UV of geo to one point (solid-colour atlas cell). */
function solidUV(geo, [u0, v0, u1, v1]) {
  for (let i = 0; i < geo.uvs.length; i += 2) { geo.uvs[i] = (u0 + u1) / 2; geo.uvs[i + 1] = (v0 + v1) / 2; }
  return geo;
}
/** World-scaled face: texture repeats every `tile` world units. */
function face(g, c, u, v, tile = 2) {
  const lu = Math.hypot(u[0], u[1], u[2]) * 2 / tile, lv = Math.hypot(v[0], v[1], v[2]) * 2 / tile;
  g.face(c, u, v, [0, 0, lu, lv]);
}
/** Flat strip on the ground along X (road, kerb, pavement). */
function strip(g, x0, x1, z0, z1, y, tile, fine = null) {
  if (!fine) { face(g, [(x0 + x1) / 2, y, (z0 + z1) / 2], [(x1 - x0) / 2, 0, 0], [0, 0, -(z1 - z0) / 2], tile); return; }
  // fine = [fx0, fx1, cell]: coarse either side, cells of `cell` (a multiple of tile, so the texture stays seamless) between
  const [fx0, fx1, cell] = fine;
  strip(g, x0, fx0, z0, z1, y, tile); strip(g, fx1, x1, z0, z1, y, tile);
  for (let x = fx0; x < fx1 - 1e-6; x += cell) face(g, [x + cell / 2, y, (z0 + z1) / 2], [cell / 2, 0, 0], [0, 0, -(z1 - z0) / 2], tile);
}

export class QuietHouse {
  static meta = { name: 'Quiet House' };
  static palette = ALBUM_PALETTES.okc;

  init(r) {
    this.ground = new K.Terrain(r, { size: 220, cells: 36, height, uvScale: 0.25 });
    this.groundTex = r.texture(grassTex());
    this.sky = new K.Sky(r, { stars: 70, clouds: 4 });

    // ---- houses: walls, roofs, trim (door, step, chimney) in three merged meshes ----
    const walls = new GeoBuilder(), roofs = new GeoBuilder(), trim = [];
    this.win = [];   // window slots: { x, y, z, ry, on, idle }
    const house = (ox, oz, W, D, H, RH, seed, main = false) => {
      const hw = W / 2, hd = D / 2;
      face(walls, [ox, H / 2, oz + hd], [hw, 0, 0], [0, H / 2, 0]);          // front (+z)
      face(walls, [ox, H / 2, oz - hd], [-hw, 0, 0], [0, H / 2, 0]);         // back
      face(walls, [ox + hw, H / 2, oz], [0, 0, -hd], [0, H / 2, 0]);         // right (+x)
      face(walls, [ox - hw, H / 2, oz], [0, 0, hd], [0, H / 2, 0]);          // left
      for (const s of [1, -1]) {                                              // gable ends
        const x = ox + s * hw;
        const A = [x, H, oz + s * hd], B = [x, H, oz - s * hd];               // wound so the normal points outward
        walls.tri(A, B, [x, H + RH, oz], [0, 0], [D / 2, 0], [D / 4, -RH / 2]);
      }
      const ex = hw + 0.35, ez = hd + 0.45, eh = H - 0.18 * (RH / 2.2);       // eaves overhang
      const slope = Math.hypot(ez, RH + H - eh) / 2;
      for (const s of [1, -1]) {
        const a = [ox - s * ex, eh, oz + s * ez], b = [ox + s * ex, eh, oz + s * ez], c = [ox + s * ex, H + RH, oz], e = [ox - s * ex, H + RH, oz];
        roofs.quad(a, b, c, e, [0, slope], [ex, slope], [ex, 0], [0, 0]);   // normals point up and out
      }
      // door + step on the front, chimney through the roof
      const door = new GeoBuilder().face([0, 1.05, 0], [0.5, 0, 0], [0, 1.05, 0], RECT.door).build();
      trim.push({ geo: door, xf: (p) => [p[0] + ox, p[1], p[2] + oz + hd + 0.07] });
      trim.push({ geo: K.boxAtlas(1.6, 0.2, 0.7, { top: RECT.stone }), xf: (p) => [p[0] + ox, p[1] + 0.1, p[2] + oz + hd + 0.35] });
      const cx = ox + (K.rand2(seed, 1, 2) < 0.5 ? -1 : 1) * W * 0.28;
      trim.push({ geo: K.boxAtlas(0.7, RH + 1.2, 0.7, { top: RECT.dark, side: RECT.brick }), xf: (p) => [p[0] + cx, p[1] + H + (RH + 1.2) / 2 - 0.2, p[2] + oz - hd * 0.3] });
      // window slots (pivot = bottom centre of the glass, on the wall surface)
      const fz = oz + hd, sx = ox + hw;
      const slots = [[-W * 0.3, 0.9, 'f'], [W * 0.3, 0.9, 'f'], [-W * 0.3, 2.9, 'f'], [0, 2.9, 'f'], [W * 0.3, 2.9, 'f'], [0, 0.9, 's'], [0, 2.9, 's']];
      slots.forEach(([o, y, side], j) => {
        const n = this.win.length;
        const on = main ? 0.1 + ((j * 0.37 + 0.13) % 1) * 0.75 : (K.rand2(seed, j, 5) < 0.3 ? 2 : 0.2 + K.rand2(seed, j, 6) * 0.75);
        this.win.push(side === 'f'
          ? { x: ox + o, y, z: fz, ry: 0, on, idle: main && j === 1, n, ground: main && y < 2, nx: 0, nz: 1 }
          : { x: sx, y, z: oz + o + (y > 2 ? 0 : -0.4), ry: Math.PI / 2, on, idle: false, n, ground: main && y < 2, nx: 1, nz: 0 });
      });
    };
    house(0, 0, 7, 5.5, 4.6, 2.2, 1, true);
    house(-17, -2, 7.5, 6, 4.6, 2.4, 2);
    house(17, -1.5, 6.5, 5.5, 4.4, 2.1, 3);
    house(-7, -26, 7, 6, 4.6, 2.3, 4);
    house(11, -27, 7.5, 6, 4.8, 2.4, 5);
    // lamp post on the near edge of the pavement
    this.lampPos = [8.6, 4.0, 9.2];
    trim.push({ geo: solidUV(K.props.lampPost(4.2, 0.8), RECT.dark), xf: (p) => [p[0] + 7.8, p[1], p[2] + 9.2] });
    this.wallMesh = r.createMesh(walls.build());
    this.roofMesh = r.createMesh(roofs.build());
    this.trimMesh = r.createMesh(merge(trim));
    this.sidingTex = r.texture(sidingTex()); this.roofTex = r.texture(roofTex()); this.trimTex = r.texture(trimTex());

    // ---- windows: glass (unlit, per-window brightness) + frames, same instance buffer ----
    const pane = (w, h, z) => new GeoBuilder().quad([-w / 2, 0, z], [w / 2, 0, z], [w / 2, h, z], [-w / 2, h, z], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build();
    this.glassMesh = r.createMesh(pane(1, 1.25, 0.09));   // offsets are generous: the depth buffer is coarse at 320x240
    this.frameMesh = r.createMesh(K.props.shift(pane(1.14, 1.39, 0.15), 0, -0.07, 0));
    this.glassTex = r.texture(glassTex()); this.frameTex = r.texture(frameTex());
    this.winInst = r.createInstances(this.win.length);
    this.glowQuad = r.createMesh(K.billboardQuad(1, 1));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.glows = r.createInstances(this.win.length + 1);
    // light pools on the ground: main-house ground-floor windows + the lamp
    this.poolMesh = r.createMesh(K.decal(1, 1, 0.16));
    this.poolTex = r.texture(poolTex());
    this.poolWins = this.win.filter((w) => w.ground);
    this.pools = r.createInstances(this.poolWins.length + 1);

    // ---- garden and street ----
    const flat = new GeoBuilder();
    strip(flat, -110, 110, 10.2, 13.6, 0.06, 4, [-10, 22, 2]);                  // road
    this.roadMesh = r.createMesh(flat.build());
    const paved = new GeoBuilder();
    strip(paved, -110, 110, 8.5, 10.2, 0.1, 1.2, [-9.6, 21.6, 1.2]);                // near pavement
    strip(paved, -110, 110, 13.6, 15.0, 0.1, 1.2);               // far pavement (camera side)
    paved.face([0, 0.1, (2.75 + 8.5) / 2], [0.6, 0, 0], [0, 0, -(8.5 - 2.75) / 2], [0, 0, 1, (8.5 - 2.75) / 1.2], 5);   // garden path
    this.pavedMesh = r.createMesh(paved.build());
    this.roadTex = r.texture(asphaltTex());
    this.pavedTex = r.texture(K.props.tiles({ ramp: 0, cells: 2, cracked: 0.05, shades: [1, 2] }));
    this.lawnMesh = r.createMesh(new GeoBuilder().face([0, 0.06, 0], [GARDEN_X, 0, 0], [0, 0, -(FENCE_Z - 2.75) / 2], [0, 0, 1, 1], 9).build());   // subdivided for the window light
    this.lawnTex = r.texture(lawnTex());

    // picket fences (double-sided quads, CLEAR between the pickets)
    const fence = new GeoBuilder(), FH = 1.0;
    const run = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), u = len / 2;
      fence.quad([x0, 0, z0], [x1, 0, z1], [x1, FH, z1], [x0, FH, z0], [0, 1], [u, 1], [u, 0], [0, 0]);
    };
    run(-GARDEN_X, FENCE_Z, -0.75, FENCE_Z); run(0.75, FENCE_Z, GARDEN_X, FENCE_Z);
    run(-GARDEN_X, -6, -GARDEN_X, FENCE_Z); run(GARDEN_X, -6, GARDEN_X, FENCE_Z); run(-GARDEN_X, -6, GARDEN_X, -6);
    for (const [ox, w] of [[-17, 6.5], [17, 6]]) { run(ox - w, FENCE_Z, ox - 0.75, FENCE_Z); run(ox + 0.75, FENCE_Z, ox + w, FENCE_Z); }
    this.fenceMesh = r.createMesh(fence.build());
    this.fenceTex = r.texture(fenceTex());

    // trees and hedges (instanced billboards, placed once)
    this.quad = this.glowQuad;
    this.treeTex = r.texture(K.sprites.broadleaf({ ramp: 1, seed: 7 }));
    this.pineTex = r.texture(K.sprites.pine({ ramp: 1, seed: 3 }));
    this.bushTex = r.texture(K.sprites.bush({ ramp: 1, seed: 9 }));
    this.trees = r.createInstances(10); this.pines = r.createInstances(10); this.bushes = r.createInstances(40);
    const trees = [[-4.2, 5.6, 4.6], [-2.5, -7.5, 7.5], [4.5, -8.5, 6.5], [-11.5, 4, 5.5], [24, -5, 7], [-26, -6, 7.5], [2, -20, 8], [-18, -22, 7]];
    trees.forEach(([x, z, s], i) => this.trees.set(i, x, height(x, z) - 0.1, z, s, 0, 0.85 + K.rand2(i, 1, 4) * 0.25, i, 1.2));
    this.trees.upload(trees.length);
    let np = 0;
    for (let i = 0; i < 10; i++) {   // a dark tree line far behind the houses
      const x = -60 + i * 13 + K.rand2(i, 2, 8) * 6, z = -42 - K.rand2(i, 3, 8) * 10;
      this.pines.set(np++, x, height(x, z) - 0.2, z, 9 + K.rand2(i, 4, 8) * 4, 0, 0.7, i, 1.4);
    }
    this.pines.upload(np);
    let nb = 0;
    const bush = (x, z, s) => { this.bushes.set(nb, x, 0, z, s, 0, 0.85 + K.rand2(nb, 1, 6) * 0.3, nb, 0.75); nb++; };
    for (let z = -4.5; z <= 7; z += 1.3) { bush(-GARDEN_X + 0.6, z, 1.5); bush(GARDEN_X - 0.6, z, 1.5); }
    for (const x of [-3.4, -2.4, 2.4, 3.4]) bush(x, 3.3, 1.1);          // beds under the front windows
    for (const x of [-21, -13, 13, 21]) bush(x, 3.5, 1.6);
    this.bushes.upload(nb);

    // ---- twinkles: a small pool of glockenspiel glints ----
    this.twTex = r.texture(K.sprites.twinkle({ index: R(2, 3) }));
    this.twQuad = r.createMesh(K.props.shift(K.billboardQuad(1, 1), 0, -0.5, 0));   // centred, so rotZ spins it in place
    this.twinkles = r.createInstances(N_TWINKLES);
    this.tw = Array.from({ length: N_TWINKLES }, () => ({ env: new K.Envelope(0.9), x: 0, y: 0, z: 0, s: 0.3 }));
    this.twSpots = [];
    for (let x = -GARDEN_X; x <= GARDEN_X + 1e-3; x += 1.5) if (Math.abs(x) > 1) this.twSpots.push([x, 1.0, FENCE_Z + 0.12, 0.22, 'fence']);
    for (const w of this.win) this.twSpots.push([w.x + w.nx * 0.25 + (w.nz ? 0.45 : 0), w.y + 1.25, w.z + w.nz * 0.25 + (w.nx ? 0.45 : 0), 0.26, w]);
    this.twSpots.push([3.85, 7.0, 0, 0.3, 'roof'], [-3.85, 7.0, 0, 0.3, 'roof'], [-4.2, 5.2, 5.6, 0.28, 'tree']);
    this.skySpots = [];
    for (let i = 0; i < 16; i++) {   // star spots in the view cone, behind the house
      const ang = -0.45 + K.rand2(i, 1, 11) * 0.9 - 0.36, d = 70;
      this.skySpots.push([CAM[0] + Math.sin(ang) * d, 14 + K.rand2(i, 2, 11) * 22, CAM[2] - Math.cos(ang) * d, 0.9, 'sky']);
    }
    this.nextTw = 0; this.nextIdleTw = 2.5;

    // camera: a fixed view across the street that barely drifts (no beat kicks)
    const yaw = Math.atan2(-CAM[0], CAM[2] - 0.5);
    this.cam = new K.SweepRig({ position: CAM.slice(), yaw, yawRange: 0.035, pitch: 0.045, distance: 22, idleSpeed: 0.045, activeSpeed: 0.06, bassBoost: 0, fovPunch: 0, nudge: 0, rollKick: 0, fov: 50, far: 230 });
    this.breath = new K.Breath({ beats: 8, period: 12 });
    this.time = 0; this.k = 0; this.green = 0; this.energy = 0; this.lampLevel = 0; this.midS = 0; this.swayMid = 0; this.bm = 1;
    this.m = mat4.create(); this.mLawn = mat4.create();
    this.col = { fog: [0, 0, 0], wrong: [0, 0, 0], tmp: [0, 0, 0], zen: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glass: [1, 1, 1], halo: [0, 0, 0], pool: [0, 0, 0], tw: [1, 1, 1], lamp: [0, 0, 0], win: [0, 0, 0], focus: [0, 2, 4] };
    this.lights = new K.LightSet({ reach: 12 });
    // window order for the drop's "every window lit" (one by one as allWin rises)
    this.win.forEach((w, i) => { w.rank = K.rand2(i, 9, 23) * 0.8; });

    // song sections: gates multiply the k fed into today's stage() curves (clamped 0..1);
    // camDolly (+ = toward the house along the view line) and camLift are camera positions (slow, eased twice)
    this.moods = new K.Moods({
      still:  { winGate: 0.2,  greenGate: 0.4, lampGate: 0.5, allWin: 0, camDolly: 3,  camLift: -0.15 },
      base:   { winGate: 1,    greenGate: 1,   lampGate: 1,   allWin: 0, camDolly: 0,  camLift: 0 },
      gather: { winGate: 1.35, greenGate: 1.6, lampGate: 1.2, allWin: 0, camDolly: -1, camLift: 0.15 },
      full:   { winGate: 1.6,  greenGate: 1.4, lampGate: 1.6, allWin: 1, camDolly: -5, camLift: 0.7 },
    }, { dropEase: 4, slow: ['camDolly', 'camLift'] });
    this.camD = null; this.camL = 0;
    const dx = 0 - CAM[0], dz = 0.5 - CAM[2], dl = Math.hypot(dx, dz);
    this.camDir = [dx / dl, dz / dl];   // toward the house along the view line (the yaw stays the same)
  }

  _twinkle(spot, amp) {
    const t = this.tw.reduce((a, b) => (b.env.v < a.env.v ? b : a));   // the quietest one
    [t.x, t.y, t.z, t.s] = spot;
    t.env.trigger(amp);
  }

  /** Coming on screen (StyleManager.enter, after its moods / rig snap): the mood keys it eases a second time start at the current mood. */
  enter() { this.camD = null; }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt; this.dt = dt;
    const m = this.moods.update(a, dt);
    const d = K.drive(a, k);
    const b = this.breath.update(a, dt);
    // camera: along the view line, eased a second time so a section change starts softly
    if (this.camD === null) { this.camD = m.camDolly; this.camL = m.camLift; }
    this.camD = damp(this.camD, m.camDolly, 2, dt); this.camL = damp(this.camL, m.camLift, 2, dt);
    const cp = this.cam.position;
    cp[0] = CAM[0] + this.camDir[0] * this.camD; cp[1] = CAM[1] + this.camL; cp[2] = CAM[2] + this.camDir[1] * this.camD;
    this.cam.update(a, k, dt);
    this.cam.eye[1] += b * 0.06;                         // the faintest breathing

    // big, slow things follow the song's energy, never the kick drum
    this.energy = damp(this.energy, a.energy ?? a.level ?? 0, 2.5, dt);
    this.green = damp(this.green, K.stage(clamp(k * m.greenGate), 0.15, 0.95) * (0.6 + 0.4 * this.energy), 3, dt);
    this.lampLevel = damp(this.lampLevel, K.stage(clamp(k * m.lampGate), 0.35, 0.65), 1.5, dt);
    // foliage sway: the mid band eased (0.5 s) unless the Feel allows beat-sized movement
    this.midS = damp(this.midS, d.mid, 0.5, dt);
    this.swayMid = lerp(this.midS, d.mid, d.beatMotion);
    this.bm = d.beatMotion;

    // windows: one is always on; the rest come on one by one with the swell (in the drop, all of them)
    const kw = clamp(k * m.winGate), kAll = K.stage(k, 0.05, 0.4);
    for (const w of this.win) {
      const target = Math.max(w.idle ? 0.8 : 0, K.stage(kw, w.on, w.on + 0.18), K.stage(m.allWin, w.rank, w.rank + 0.2) * kAll);
      w.base = damp(w.base ?? target, target, 0.8, dt);
      w.level = w.base * (0.93 + 0.07 * b);
      this.winInst.set(w.n, w.x, w.y, w.z, 1, w.ry, 0.1 + w.level * 0.95, 0, 1);
      const gs = 1.7 + w.level * 0.5;   // glow sprites grow up from their pivot, so centre them on the glass
      this.glows.set(w.n, w.x + w.nx * 0.45, w.y + 0.62 - gs / 2, w.z + w.nz * 0.45, gs, 0, w.level * 0.3, 0, 1);
    }
    const L = this.lampPos;
    const ls = 1.2 + this.lampLevel * 0.7;
    this.glows.set(this.win.length, L[0], L[1] - 0.2 - ls / 2, L[2], ls, 0, this.lampLevel * 0.6, 0, 1);
    this.winInst.upload(this.win.length); this.glows.upload(this.win.length + 1);
    this.poolWins.forEach((w, i) => this.pools.set(i, w.x + w.nx * 1.3, 0, w.z + w.nz * 1.3, 2.4, w.ry, w.level * 0.5, 0, 1));
    this.pools.set(this.poolWins.length, L[0], 0, L[2] + 0.4, 4.2, Math.PI, this.lampLevel * 0.45, 0, 1);
    this.pools.upload(this.poolWins.length + 1);

    // beat: at most one small glint, eased in and ringing out (Envelope reads Feel)
    this.nextTw -= dt;
    if (d.beat && this.nextTw <= 0) {
      this.nextTw = 0.3;
      const lit = this.twSpots.filter((s) => typeof s[4] !== 'object' || s[4].level > 0.3);
      const pool = K.rand2(a.beatCount || 0, 3, 1) < 0.3 ? this.skySpots : lit;
      this._twinkle(pool[Math.floor(K.rand2(a.beatCount || 0, 7, 2) * pool.length)], 0.45 + 0.55 * k);
    }
    // idle life: a star twinkles now and then
    if ((this.nextIdleTw -= dt) <= 0) {
      this.nextIdleTw = 3 + Math.random() * 4;
      this._twinkle(this.skySpots[Math.floor(Math.random() * this.skySpots.length)], 0.4);
    }
    this.tw.forEach((t, i) => {
      const v = t.env.update(dt);
      this.twinkles.set(i, t.x, t.y, t.z, t.s * (0.5 + v * 0.7 * this.bm), v * 1.6, v, 0, 1);   // the glint's size swell is a beat movement; its light stays
    });
    this.twinkles.upload(N_TWINKLES);
  }

  render(r) {
    const { col, k } = this, P = this.pal;
    const dim = lerp(0.8, 1, k);
    // fog: dusk atmosphere drifting toward a faint, wrong green
    mixColor(col.wrong, P.color(R(1, 1)), P.color(R(2, 0)), 0.5);
    mixColor(col.tmp, P.role('fog'), col.wrong, this.green * 0.55);
    scaleColor(col.fog, col.tmp, dim);
    r.clear(col.fog);
    this.cam.apply(r);
    mixColor(col.zen, P.color(R(3, 0)), P.color(R(1, 0)), this.green * 0.25);
    this.sky.draw(r, this.cam.eye, { horizon: col.fog, zenith: col.zen, brightness: dim, starLevel: 0.55, cloudDrift: this.time * 0.002 });
    r.setFog(col.fog, 10, lerp(72, 62, this.green));
    r.setLight([0.45, -0.4, -0.65], scaleColor(col.light, P.role('light'), lerp(0.32, 0.4, k)), scaleColor(col.amb, P.role('ambient'), 0.55));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    // the lamp and the lit ground-floor windows light the lawn, path, fence and street (gently: the quietest scene)
    const L = this.lights, lp = this.lampPos;
    scaleColor(col.lamp, P.role('glow'), 2.2); scaleColor(col.win, P.role('glow'), 1.3);
    L.begin();
    L.add(999, lp[0] - 0.6, lp[1] - 0.4, lp[2], col.lamp, 8, this.lampLevel);
    this.poolWins.forEach((w, i) => L.add(i, w.x + w.nx * 0.9, w.y + 0.7, w.z + w.nz * 0.9, col.win, 4.2, w.level));
    L.apply(r, col.focus, this.dt || 1 / 60);
    const I = mat4.identity(this.m);

    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    r.draw(this.lawnMesh, mat4.trs(this.mLawn, 0, 0, (2.75 + FENCE_Z) / 2, 0, 0, 0, 1, 1, 1), { texture: this.lawnTex, tint: col.tint });
    r.draw(this.roadMesh, I, { texture: this.roadTex, tint: col.tint });
    r.draw(this.pavedMesh, I, { texture: this.pavedTex, tint: col.tint });
    r.draw(this.wallMesh, I, { texture: this.sidingTex, tint: col.tint });
    r.draw(this.roofMesh, I, { texture: this.roofTex, tint: col.tint });
    r.draw(this.trimMesh, I, { texture: this.trimTex, tint: col.tint });
    r.draw(this.fenceMesh, I, { texture: this.fenceTex, tint: col.tint });
    r.drawInstanced(this.glassMesh, this.winInst, { texture: this.glassTex, unlit: true, tint: col.glass });
    r.drawInstanced(this.frameMesh, this.winInst, { texture: this.frameTex, tint: col.tint });

    const sway = 0.006 + this.breath.v * 0.006 + this.swayMid * 0.012;
    r.drawInstanced(this.quad, this.pines, { texture: this.pineTex, billboard: 1, sway: sway * 0.5, tint: col.tint });
    r.drawInstanced(this.quad, this.trees, { texture: this.treeTex, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.bushes, { texture: this.bushTex, billboard: 1, sway: sway * 0.5, tint: col.tint });

    // light last: pools on the ground, halos, glints
    col.pool[0] = col.pool[1] = col.pool[2] = 1;
    r.drawInstanced(this.poolMesh, this.pools, { texture: this.poolTex, unlit: true, additive: true, depthWrite: false, tint: col.pool });
    col.halo[0] = col.halo[1] = col.halo[2] = 1;
    r.drawInstanced(this.glowQuad, this.glows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, depthWrite: false, fog: false, fade: [35, 85], tint: col.halo });
    r.drawInstanced(this.twQuad, this.twinkles, { texture: this.twTex, billboard: 2, unlit: true, additive: true, depthWrite: false, fog: false, fade: [60, 140], tint: col.tw });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r);
    [this.wallMesh, this.roofMesh, this.trimMesh, this.glassMesh, this.frameMesh, this.glowQuad, this.twQuad, this.poolMesh, this.roadMesh, this.pavedMesh, this.lawnMesh, this.fenceMesh].forEach((m) => m.dispose());
    [this.groundTex, this.sidingTex, this.roofTex, this.trimTex, this.glassTex, this.frameTex, this.glowTex, this.poolTex, this.roadTex, this.pavedTex, this.lawnTex, this.fenceTex, this.treeTex, this.pineTex, this.bushTex, this.twTex].forEach((t) => r.deleteTexture(t));
    [this.winInst, this.glows, this.pools, this.trees, this.pines, this.bushes, this.twinkles].forEach((i) => i.dispose());
  }
}
