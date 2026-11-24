// BACK ROAD LIGHTS — for "Subterranean Homesick Alien" (OK Computer palette).
// Light (Kit v7): the hovering lights wash the field below them, and a lowered beam lights the
// grass, fence and buildings where it lands (K.LightSet, the best 4).
//
// A gravel back road at night, a post-and-rail fence, a ploughed field beyond it
// with a few round bales, one farmhouse (a warm window or two), a barn, a windmill
// and a dark tree line on the hills. The camera stands in the verge grass and
// barely drifts.
//
// Odd lights hover in the sky. Each one is an object, not a curtain: a small dark
// lens with a glowing underside and a halo (lens fogs out with distance, the glow
// fades through the fog with draw `fade`).
//
// Idle: a quiet, still field; two faint lights hovering far off over the hills.
// Swell: more lights arrive one by one, gliding in from beyond the fog while they
//        brighten (never popping). With the swell they move with purpose: they
//        settle into formations (a grid hovering low over the field, a slow ring,
//        a sweeping line, a chevron) that change every 8 bars (tapped tempo) or
//        ~20 s. Lights glide on critically damped springs, so a change of formation
//        is a long smooth flight. More farmhouse windows light up, the barn loft too.
// Beat: one light lowers a pale beam onto the grass (a cone billboard that extends
//       down over a fraction of a second, cropped by uvScale) with a soft pool of
//       light conforming to the ground. Scaled by Feel through K.Envelope (accent,
//       attack, decay) and the extension speed by audio.motion. While a beam is
//       down the farmhouse windows waver faintly.
// Song sections (K.Moods, Conductor on): intro / breakdown / outro leave one light far off (the
// second idle light glides away into the fog) with the camera low in the grass by the fence; a
// build brings more lights in and gathers them in a slow ring over the farmhouse; the drop takes
// them low over the field and lowers held beams onto it, one after another (a steady rate, not on
// beats, in two extra beam slots the beat beams never use). Conductor off = base.
import { mat4, lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { GeoBuilder, merge, octahedron } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const TAU = Math.PI * 2;
const ROAD_Z = 24, FENCE_Z = 17, POLE_Z = 20.6;
const CAM = [4, 0, 38];
const HOUSE = [-20, -30], BARN = [16, -44], MILL = [34, -20];
const N_LIGHTS = 9, MAX_BEAMS = 2, HELD_BEAMS = 2, POOL_SEGS = 6;   // beat beams use the first MAX_BEAMS slots
const GATE = [-22, -16.5];   // gap in the fence: the farm lane
const MILL_CLEAR = 19.5;     // lowest formation height within 6 units of the mill (eases off by 11) (rotor top ≈ 13.8, beam dip ≤ 1.8, lens ≤ 1.8)

const ease = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };

/** Ground: a flat verge and road, a gently uneven field, hills rising far away. */
const height = (x, z) => {
  const near = clamp((Math.abs(z - ROAD_Z) - 4) / 10);   // dead flat around the road
  const d = Math.hypot(x * 0.8, z + 20);
  const hills = clamp((d - 66) / 60);
  return (K.fbm(x * 0.03, z * 0.03, { octaves: 2, seed: 5 }) - 0.5) * 0.7 * near
    + hills * hills * (K.fbm(x * 0.012, z * 0.012, { octaves: 3, seed: 9 }) * 26 + 4);
};

// ---- indexed textures (local generators) ----
// ploughed field: rows every 2 world units (tile = 4 units), stubble speckle
const fieldTex = () => K.makeIndexed(64, 64, (x, y) => {
  const row = (x & 31) / 31, furrow = Math.abs(row - 0.5) * 2;   // 0 in the furrow, 1 on the ridge
  const n = K.blobNoise(x, y, 10, 3), s = K.rnd(x, y, 4);
  if (furrow < 0.25) return K.dshade(0, 0.25 + s * 0.4, x, y);
  return n > 0.62 ? K.dshade(1, 0.5 + s * 0.5, x, y) : K.dshade(0, 0.55 + furrow * 0.6 + s * 0.35, x, y);
});
// gravel road with two worn tyre tracks
const roadTex = () => K.makeIndexed(64, 64, (x, y) => {
  const tr = Math.min(Math.abs(y - 18), Math.abs(y - 46));
  const s = K.rnd(x, y, 7);
  return K.dshade(0, (tr < 5 ? 0.6 : 1.2) + s * 0.7 + (K.rnd(x >> 1, y >> 1, 2) > 0.92 ? 0.6 : 0), x, y);
});
// weathered wood, vertical grain
const woodTex = () => K.makeIndexed(32, 32, (x, y) => K.dshade(0, 0.5 + K.rnd(x, y >> 3, 3) * 0.5 + K.rnd(x, y, 9) * 0.25 + ((x & 7) === 0 ? -0.3 : 0), x, y));
// horizontal clapboards, 8 px tall
const sidingTex = () => K.makeIndexed(64, 64, (x, y) => (y & 7) === 7 ? R(0, 0) : K.dshade(0, 1.4 + ((y & 7) / 7) * 0.5 + K.rnd(x >> 2, y >> 3, 2) * 0.2, x, y));
// corrugated tin roof: vertical ribs, a few rust-dark sheets
const roofTex = () => K.makeIndexed(64, 64, (x, y) => {
  const rib = (x & 3) === 0 ? -0.35 : 0, sheet = K.rnd(x >> 4, y >> 5, 6);
  return K.dshade(sheet > 0.75 ? 3 : 0, 0.45 + rib + sheet * 0.4 + K.rnd(x, y, 1) * 0.25, x, y);
});
// glass: warm light, lighter toward the bottom, a dark sash bar
const glassTex = () => K.makeIndexed(32, 32, (x, y) => K.dshade(2, 1.2 + (y / 31) * 1.7 - (x < 5 ? 0.6 : 0), x, y));
const frameTex = () => K.makeIndexed(32, 32, (x, y) => (x < 2 || x > 29 || y < 2 || y > 29 || x === 15 || x === 16 || y === 15) ? K.dshade(0, 1.6, x, y) : K.CLEAR);
// lens body: dark metal with a ring of small rim lights
const bodyTex = () => K.makeIndexed(32, 32, (x, y) => ((x & 7) === 3 && (y & 15) === 7) ? R(2, 3) : K.dshade(3, 0.3 + K.rnd(x, y, 5) * 0.5, x, y));
// beam: a cone, narrow at the top (the light), wide at the ground, dithered falloff
const beamTex = () => K.makeIndexed(32, 64, (x, y) => {
  const t = y / 63, hw = 1.6 + t * 14.2, across = 1 - Math.abs(x - 15.5) / hw;
  if (across <= 0) return K.CLEAR;
  const b = Math.pow(across, 0.8) * (0.5 + 0.5 * (1 - t) + 0.35 * t * t) * (0.92 + 0.08 * Math.sin(y * 0.9));
  if (b < 0.08 + K.bayer(x, y) * 0.32) return K.CLEAR;
  return K.dshade(0, 1.3 + b * 2.2, x, y);
});
// pool of light on the grass (additive), round, dithered edge
const poolTex = () => K.makeIndexed(32, 32, (x, y) => {
  const a = 1 - Math.hypot(x - 15.5, y - 15.5) / 15.5;
  if (a <= 0 || a < K.bayer(x, y) * 0.7) return K.CLEAR;
  return a > 0.55 ? R(0, 3) : a > 0.3 ? R(0, 2) : R(3, 2);
});

/** World-scaled face: texture repeats every `tile` world units. */
function face(g, c, u, v, tile = 2, segs = 1) {
  const lu = Math.hypot(u[0], u[1], u[2]) * 2 / tile, lv = Math.hypot(v[0], v[1], v[2]) * 2 / tile;
  g.face(c, u, v, [0, 0, lu, lv], segs);
}
/** Box with world-scaled UVs, pivot at the centre. */
const box = (w, h, d) => K.boxAtlas(w, h, d, { top: [0, 0, w, d], side: [0, 0, d, h], front: [0, 0, w, h], back: [0, 0, w, h], bottom: [0, 0, w, d] });
/** Clone a geo (merge copies, so a single-part merge is a clone). */
const clone = (geo) => merge([{ geo }]);

export class BackRoadLights {
  static meta = { name: 'Back Road Lights' };
  static palette = ALBUM_PALETTES.okc;

  init(r) {
    this.ground = new K.Terrain(r, { size: 280, cells: 40, height, uvScale: 0.25 });
    this.ground.follow(CAM[0], CAM[2] - 40);
    this.groundTex = r.texture(fieldTex());
    this.sky = new K.Sky(r, { stars: 130, clouds: 3 });

    // ---- road strip (subdivided so the affine warp stays mild)
    const road = new GeoBuilder();
    face(road, [0, 0.07, ROAD_Z], [140, 0, 0], [0, 0, -2.3], 4.6, 12);
    this.roadMesh = r.createMesh(road.build());
    this.roadTex = r.texture(roadTex());

    // ---- farmhouse + barn: walls, roofs (merged meshes), windows (instanced)
    const walls = new GeoBuilder(), roofs = new GeoBuilder(), wood = [];
    this.win = [];
    const building = (ox, oz, W, D, H, RH) => {
      const oy = height(ox, oz) - 0.5, hw = W / 2, hd = D / 2, Ht = H + 0.5, my = oy + Ht / 2;
      face(walls, [ox, my, oz + hd], [hw, 0, 0], [0, Ht / 2, 0]);
      face(walls, [ox, my, oz - hd], [-hw, 0, 0], [0, Ht / 2, 0]);
      face(walls, [ox + hw, my, oz], [0, 0, -hd], [0, Ht / 2, 0]);
      face(walls, [ox - hw, my, oz], [0, 0, hd], [0, Ht / 2, 0]);
      const top = oy + Ht;
      for (const s of [1, -1]) {   // gable ends on the front and back (the ridge runs along z)
        const z = oz + s * hd;
        walls.tri([ox - s * hw, top, z], [ox + s * hw, top, z], [ox, top + RH, z], [0, 0], [W / 2, 0], [W / 4, -RH / 2]);
      }
      const ex = hw + 0.4, ez = hd + 0.35, eh = top - 0.2;
      for (const s of [1, -1]) {   // two slopes meeting at a ridge along z
        const a = [ox + s * ex, eh, oz + ez], b = [ox + s * ex, eh, oz - ez], c = [ox, top + RH, oz - ez], e = [ox, top + RH, oz + ez];
        const sl = Math.hypot(ex, RH + 0.2) / 2;
        if (s > 0) roofs.quad(a, b, c, e, [0, sl], [ez, sl], [ez, 0], [0, 0]);
        else roofs.quad(b, a, e, c, [ez, sl], [0, sl], [0, 0], [ez, 0]);
      }
      return { oy, top, hw, hd };
    };
    // farmhouse: gable end faces the road (front, +z)
    const [HX, HZ] = HOUSE;
    const h = building(HX, HZ, 8, 9, 5.4, 3.2);
    wood.push({ geo: box(0.8, 2.6, 0.8), xf: (p) => [p[0] + HX + 2, p[1] + h.top + 2.1, p[2] + HZ - 2] });   // chimney
    const fz = HZ + h.hd, fy = h.oy + 0.5;
    wood.push({ geo: box(1.2, 2.2, 0.12), xf: (p) => [p[0] + HX, p[1] + fy + 1.1, p[2] + fz + 0.08] });        // door
    wood.push({ geo: box(8.6, 0.16, 2.2), xf: (p) => [p[0] + HX, p[1] + fy + 2.75, p[2] + fz + 1.1] });          // porch roof
    for (const x of [-4, 4]) wood.push({ geo: box(0.16, 2.7, 0.16), xf: (p) => [p[0] + HX + x, p[1] + fy + 1.35, p[2] + fz + 2.05] });
    wood.push({ geo: box(8.6, 0.25, 2.2), xf: (p) => [p[0] + HX, p[1] + fy + 0.05, p[2] + fz + 1.1] });          // porch boards
    const slots = [   // [x, y, z, ry, idle level, switch-on point]
      [HX + 2.4, fy + 0.9, fz, 0, 0.85, 0], [HX - 2.4, fy + 0.9, fz, 0, 0, 0.3], [HX - 2, fy + 3.6, fz, 0, 0.45, 0], [HX + 2, fy + 3.6, fz, 0, 0, 0.55],
      [HX + h.hw, fy + 0.9, HZ + 1.8, Math.PI / 2, 0, 0.2], [HX + h.hw, fy + 0.9, HZ - 2, Math.PI / 2, 0, 0.45], [HX + h.hw, fy + 3.6, HZ, Math.PI / 2, 0, 0.7],
    ];
    // barn: big and dark, a loft window that lights late in the swell
    const [BX, BZ] = BARN;
    const b = building(BX, BZ, 11, 13, 6, 4.2);
    wood.push({ geo: box(4.5, 4.4, 0.14), xf: (p) => [p[0] + BX, p[1] + b.oy + 2.7, p[2] + BZ + b.hd + 0.09] });   // big door
    slots.push([BX, b.top + 0.5, BZ + b.hd, 0, 0, 0.75]);
    slots.forEach(([x, y, z, ry, idle, on], n) => this.win.push({ x, y, z, ry, idle, on, n, nx: Math.sin(ry), nz: Math.cos(ry), base: idle, level: idle }));
    this.porch = [HX, fy + 2.55, fz + 2.0];

    // ---- fence, telephone poles, mailbox, bales, windmill tower (one wood mesh)
    const post = K.props.prism(4, 0.11, 1.45, { cap: true });
    let prev = null;
    for (let x = -112; x <= 112; x += 3.2) {
      if (x > GATE[0] && x < GATE[1]) { prev = null; continue; }
      const y = height(x, FENCE_Z) - 0.15, lean = (K.rand2(x * 3, 1, 4) - 0.5) * 0.12;
      wood.push({ geo: post, xf: K.xf({ pos: [x, y, FENCE_Z], rot: [lean * 0.5, 0, lean] }) });
      if (prev) {
        const mx = (prev[0] + x) / 2, my = (prev[1] + y) / 2, len = x - prev[0], slope = Math.atan2(y - prev[1], len);
        for (const ry of [0.55, 1.12]) wood.push({ geo: box(len + 0.1, 0.1, 0.05), xf: K.xf({ pos: [mx, my + ry, FENCE_Z + 0.1], rot: [0, 0, slope] }) });
      }
      prev = [x, y];
    }
    for (let x = -104; x <= 104; x += 26) {
      const y = height(x, POLE_Z), x2 = x + (K.rand2(x, 2, 3) - 0.5) * 2;
      wood.push({ geo: K.props.prism(5, 0.14, 7.4, { taper: 0.8 }), xf: K.xf({ pos: [x2, y - 0.2, POLE_Z], rot: [0, 0, (K.rand2(x, 3, 3) - 0.5) * 0.05] }) });
      wood.push({ geo: box(2.4, 0.14, 0.14), xf: (p) => [p[0] + x2, p[1] + y + 6.6, p[2] + POLE_Z] });
      for (const o of [-1, 1]) wood.push({ geo: box(0.1, 0.2, 0.1), xf: (p) => [p[0] + x2 + o, p[1] + y + 6.8, p[2] + POLE_Z] });
    }
    const mbx = GATE[1] + 1.2, mbz = ROAD_Z - 2.9;
    wood.push({ geo: box(0.12, 1.1, 0.12), xf: (p) => [p[0] + mbx, p[1] + 0.55, p[2] + mbz] });
    wood.push({ geo: box(0.42, 0.38, 0.75), xf: (p) => [p[0] + mbx, p[1] + 1.25, p[2] + mbz] });
    const bale = K.props.prism(10, 0.75, 1.5, { cap: true });
    for (const [bx, bz, ry] of [[-6, -8, 0.3], [6, -14, 1.2], [-2, -27, 2.2], [12, -3, 0.8], [-31, -12, 1.9], [26, -31, 0.1], [3, -40, 1.5]]) {
      wood.push({ geo: bale, xf: K.xf({ pos: [bx, height(bx, bz) + 0.7, bz], rot: [0, ry, Math.PI / 2] }) });
    }
    const [MX, MZ] = MILL, my0 = height(MX, MZ);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {   // four splayed legs
      wood.push({ geo: K.props.prism(4, 0.12, 11.4), xf: K.xf({ pos: [MX + dx * 1.3, my0 - 0.2, MZ + dz * 1.3], rot: [-dz * 0.11, 0, dx * 0.11] }) });
    }
    for (const y of [3, 6.5, 9.5]) {
      const w = 2.6 - y * 0.21;
      wood.push({ geo: box(w, 0.1, 0.1), xf: (p) => [p[0] + MX, p[1] + my0 + y, p[2] + MZ + w / 2] });
      wood.push({ geo: box(0.1, 0.1, w), xf: (p) => [p[0] + MX + w / 2, p[1] + my0 + y, p[2] + MZ] });
    }
    wood.push({ geo: box(0.5, 0.5, 1.4), xf: (p) => [p[0] + MX, p[1] + my0 + 11.2, p[2] + MZ] });
    wood.push({ geo: box(0.08, 1.4, 2.4), xf: (p) => [p[0] + MX, p[1] + my0 + 11.4, p[2] + MZ - 2] });   // tail vane
    this.millHub = [MX, my0 + 11.2, MZ + 0.8];
    const blades = [];
    for (let i = 0; i < 12; i++) {
      const bl = K.props.shift(box(0.42, 2.1, 0.05), 0, 1.55, 0);
      blades.push({ geo: bl, xf: K.xf({ rot: [0, 0, (i / 12) * TAU] }) });
    }
    blades.push({ geo: box(0.6, 0.6, 0.3) });
    this.rotorMesh = r.createMesh(merge(blades));

    this.wallMesh = r.createMesh(walls.build());
    this.roofMesh = r.createMesh(roofs.build());
    this.woodMesh = r.createMesh(merge(wood));
    this.sidingTex = r.texture(sidingTex()); this.roofTex = r.texture(roofTex()); this.woodTex = r.texture(woodTex());

    // ---- windows: glass (unlit, per-window brightness) + frames share one instance buffer
    const pane = (w, hh, z) => new GeoBuilder().quad([-w / 2, 0, z], [w / 2, 0, z], [w / 2, hh, z], [-w / 2, hh, z], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build();
    this.glassMesh = r.createMesh(pane(1.1, 1.3, 0.1));
    this.frameMesh = r.createMesh(K.props.shift(pane(1.26, 1.46, 0.17), 0, -0.08, 0));
    this.glassTex = r.texture(glassTex()); this.frameTex = r.texture(frameTex());
    this.winInst = r.createInstances(this.win.length);

    // ---- glow sprites (centred quad): window halos, light halos, light cores
    this.cquad = r.createMesh(K.props.shift(K.billboardQuad(1, 1), 0, -0.5, 0));
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.coreTex = r.texture(K.sprites.glow({ ramp: 0 }));
    this.winGlows = r.createInstances(this.win.length + 1);

    // ---- foliage
    this.grassTex = r.texture(K.sprites.grass({ ramp: 1, seed: 4 }));
    this.treeTex = r.texture(K.sprites.broadleaf({ ramp: 1, seed: 11 }));
    this.pineTex = r.texture(K.sprites.pine({ ramp: 1, seed: 6 }));
    this.bushTex = r.texture(K.sprites.bush({ ramp: 1, seed: 3 }));
    this.grass = r.createInstances(300); this.trees = r.createInstances(8); this.pines = r.createInstances(24); this.bushes = r.createInstances(40);
    let ng = 0;
    for (let i = 0; ng < 220 && i < 900; i++) {
      const u = K.rand2(i, 1, 21), v = K.rand2(i, 2, 21);
      let x, z, s;
      if (i % 3 === 0) { x = -110 + u * 220; z = FENCE_Z + 0.4 + v * 1.6; s = 0.9 + K.rand2(i, 3, 21) * 0.7; }   // along the fence
      else { x = CAM[0] - 26 + u * 52; z = ROAD_Z + 2.8 + v * 7; s = 0.35 + K.rand2(i, 3, 21) * 0.4; }     // the verge we stand in
      if (Math.hypot(x - CAM[0], z - CAM[2]) < 4) continue;
      this.grass.set(ng++, x, height(x, z) - 0.05, z, s, 0, 0.55 + K.rand2(i, 4, 21) * 0.3, i * 0.7, 0.8);
    }
    this.grass.upload(ng);
    const trees = [[HX - 8, HZ + 3, 8], [HX + 8, HZ - 7, 7], [HX - 4, HZ - 9, 9], [27, FENCE_Z - 2, 6.5], [-48, -10, 7], [BX + 10, BZ + 2, 7.5]];
    trees.forEach(([x, z, s], i) => this.trees.set(i, x, height(x, z) - 0.2, z, s, 0, 0.8 + K.rand2(i, 1, 9) * 0.25, i, 1.15));
    this.trees.upload(trees.length);
    for (let i = 0; i < 24; i++) {
      const x = -130 + i * 11.3 + K.rand2(i, 2, 8) * 6, z = -84 - K.rand2(i, 3, 8) * 14;
      this.pines.set(i, x, height(x, z) - 0.3, z, 10 + K.rand2(i, 4, 8) * 5, 0, 0.65, i, 1.4);
    }
    this.pines.upload(24);
    let nb = 0;
    for (let i = 0; i < 40; i++) {
      const x = -100 + K.rand2(i, 1, 13) * 200;
      if (x > GATE[0] - 1 && x < GATE[1] + 1) continue;
      this.bushes.set(nb++, x, height(x, FENCE_Z - 0.6), FENCE_Z - 0.6, 1.3 + K.rand2(i, 2, 13) * 1.2, 0, 0.8, i, 0.7);
    }
    this.bushes.upload(nb);

    // ---- the lights: lens bodies (opaque, fogged), underside cores + halos (additive, fade)
    this.bodyMesh = r.createMesh(octahedron(1));
    this.bodyTex = r.texture(bodyTex());
    this.bodies = r.createInstances(N_LIGHTS); this.cores = r.createInstances(N_LIGHTS); this.halos = r.createInstances(N_LIGHTS);
    this.lights = [];
    const idleSpots = [[-36, 21, -74], [30, 15, -68]];
    for (let i = 0; i < N_LIGHTS; i++) {
      const B = i < 2 ? idleSpots[i] : [-60 + K.rand2(i, 1, 31) * 120, 15 + K.rand2(i, 2, 31) * 15, -78 + K.rand2(i, 3, 31) * 38];
      const A = [B[0] * 1.7 + (B[0] < 0 ? -40 : 40), B[1] + 18, -200 - K.rand2(i, 4, 31) * 40];   // where it arrives from, far past the fog
      const on = i < 2 ? -1 : 0.08 + ((i - 2) / (N_LIGHTS - 2)) * 0.62;
      const pres = on < 0 ? 1 : 0, pos = (on < 0 ? B : A).slice();
      this.lights.push({ B, A, on, pres, pos, vel: [0, 0, 0], ph: K.rand2(i, 5, 31) * TAU, dip: 0, size: 0.9 + K.rand2(i, 6, 31) * 0.35 });
    }

    // ---- beams: one cone billboard + one ground-conforming pool per slot
    this.beamTex = r.texture(beamTex());
    this.poolTex = r.texture(poolTex());
    this.beams = Array.from({ length: MAX_BEAMS + HELD_BEAMS }, (_, j) => ({
      light: -1, env: new K.Envelope(0.95), ext: 0, v: 0, held: j >= MAX_BEAMS, hold: 0, hl: 0, hv: 0, inst: r.createInstances(1),
      pool: r.createMesh(this._poolGeo(0, 0, 1, 0), true),
    }));
    this.nextBeam = 0; this.beamRR = 0; this.beamGap = 0;

    this.mist = new K.Particles(r, 'mist');

    // camera: standing in the verge, looking across the road and field, barely drifting
    this.cam = new K.SweepRig({ position: [CAM[0], height(CAM[0], CAM[2]) + 3.4, CAM[2]], yaw: -0.07, yawRange: 0.05, pitch: 0.035, distance: 30, idleSpeed: 0.035, activeSpeed: 0.06, bassBoost: 0, fovPunch: 0, nudge: 0.04, rollKick: 0, fov: 56, far: 280 });
    this.breath = new K.Breath({ beats: 8, period: 12 });
    this.bar = new K.BarClock({ minGap: 1 });   // Gentle: a beam comes down once per bar, not per beat
    this.time = 0; this.k = 0; this.energy = 0; this.mid = 0; this.purpose = 0; this.rot = 0; this.spin = 0;
    this.mode = 0; this.modeClock = 0; this.porchLevel = 0; this.beamSum = 0;
    this.m = mat4.create(); this.mI = mat4.create(); this.mRotor = mat4.create();
    this.col = { fog: [0, 0, 0], zen: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], one: [1, 1, 1], beam: [0, 0, 0], pool: [0, 0, 0], hover: [0, 0, 0], land: [0, 0, 0], focus: [0, 0, 0] };
    this.plights = new K.LightSet({ reach: 30, fade: 0.6 });

    // song sections: gates multiply the k fed into today's stage() curves (clamped 0..1) — lights
    // arriving one by one, purpose, windows; twin keeps the second idle light (0 = it glides off into
    // the fog); house / low pull the formation over the farmhouse / down over the field (mood-only;
    // they act through purpose, which is × k); held = the drop's rate of held beams (× k).
    // camZ (+ = back from the fence) and camY are camera positions: slow, eased twice.
    this.moods = new K.Moods({
      still:  { lightGate: 0.1, purposeGate: 0.5, winGate: 0.6, twin: 0, house: 0, low: 0, held: 0, camZ: -11, camY: -1.9 },
      base:   { lightGate: 1,   purposeGate: 1,   winGate: 1,   twin: 1, house: 0, low: 0, held: 0, camZ: 0,   camY: 0 },
      gather: { lightGate: 1.5, purposeGate: 1.4, winGate: 1.3, twin: 1, house: 1, low: 0, held: 0, camZ: 0,   camY: 0 },
      full:   { lightGate: 1.6, purposeGate: 1.4, winGate: 1.4, twin: 1, house: 0, low: 1, held: 1, camZ: 0,   camY: 0 },
    }, { dropEase: 4, slow: ['camZ', 'camY'] });
    this.camZ = null; this.camY = 0; this.house = 0; this.low = 0; this.heldClock = 0.5;
  }

  /** Subdivided disc-ish square lying on the terrain (POOL_SEGS x POOL_SEGS). */
  _poolGeo(cx, cz, rad, lift = 0.14) {
    const g = new GeoBuilder(), n = POOL_SEGS, P = (i, j) => {
      const x = cx + (i / n * 2 - 1) * rad, z = cz + (j / n * 2 - 1) * rad;
      return [x, height(x, z) + lift, z];
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      g.quad(P(i, j + 1), P(i + 1, j + 1), P(i + 1, j), P(i, j), [i / n, (j + 1) / n], [(i + 1) / n, (j + 1) / n], [(i + 1) / n, j / n], [i / n, j / n], [0, 1, 0]);
    }
    return g.build();
  }

  /** Formation slot for light i (world position into out). */
  _formation(i, mode, out) {
    const u = i - (N_LIGHTS - 1) / 2, rot = this.rot;
    if (mode === 0) {          // a grid hovering low over the field
      const gx = i % 3, gz = Math.floor(i / 3);
      out[0] = -22 + gx * 22 + Math.sin(rot * 1.1 + i) * 2.5;
      out[1] = 11 + Math.sin(rot * 1.3 + i * 1.7) * 0.8;
      out[2] = -36 + gz * 14 + Math.cos(rot * 0.8 + i) * 2.5;
    } else if (mode === 1) {   // a slow ring
      const a = rot + (i / N_LIGHTS) * TAU;
      out[0] = -2 + Math.cos(a) * 20; out[1] = 15 + Math.sin(a * 2 + rot) * 1.4; out[2] = -16 + Math.sin(a) * 14;
    } else if (mode === 2) {   // a line sweeping back and forth across the field
      out[0] = u * 7.5 + Math.sin(rot * 0.7) * 10; out[1] = 18 + Math.cos(rot + u) * 0.8; out[2] = -20 + Math.sin(rot * 0.5 + u * 0.3) * 11;
    } else {                   // a chevron drifting side to side
      out[0] = u * 6.5 + Math.sin(rot * 0.4) * 18; out[1] = 21 - Math.abs(u) * 1.4; out[2] = -36 + Math.abs(u) * 4.5 + Math.sin(rot * 0.6) * 8;
    }
    // build: gathered in a slow ring over the farmhouse; drop: low over the field
    const hs = this.house;
    if (hs > 0.001) {
      const a = rot * 0.8 + (i / N_LIGHTS) * TAU;
      out[0] = lerp(out[0], HOUSE[0] + Math.cos(a) * 10, hs);
      out[1] = lerp(out[1], 16 + Math.sin(a * 2 + rot) * 1.2, hs);
      out[2] = lerp(out[2], HOUSE[1] + Math.sin(a) * 7, hs);
    }
    out[1] -= this.low * (out[1] - 8) * 0.45;
    // keep clear of the windmill rotor (top ≈ 13.8): near the mill, slots rise smoothly to MILL_CLEAR
    const dm = Math.hypot(out[0] - MILL[0], out[2] - MILL[1]), nearMill = 1 - ease((dm - 6) / 5);
    if (nearMill > 0 && out[1] < MILL_CLEAR) out[1] += (MILL_CLEAR - out[1]) * nearMill;
    return out;
  }

  update(a, k, dt) {
    dt = Math.min(dt, 0.1);
    this.a = a; this.k = k; this.time += dt; this.dt = dt;
    const m = this.moods.update(a, dt);
    const d = K.drive(a, k), t = this.time;
    const br = this.breath.update(a, dt);
    // camera: toward the fence and down into the grass, eased a second time so a section change starts softly
    if (this.camZ === null) { this.camZ = m.camZ; this.camY = m.camY; }
    this.camZ = damp(this.camZ, m.camZ, 2, dt); this.camY = damp(this.camY, m.camY, 2, dt);
    const cp = this.cam.position, cz = CAM[2] + this.camZ;
    cp[2] = cz; cp[1] = height(CAM[0], cz) + 3.4 + this.camY;
    this.house = m.house; this.low = m.low;
    const kL = clamp(k * m.lightGate), kWin = clamp(k * m.winGate);
    this.cam.update(a, k, dt);
    this.cam.eye[1] += br * 0.05;

    // slow, continuous things follow energy and smoothed bands, never the kick
    this.energy = damp(this.energy, (a.energy ?? a.level ?? 0) * k, 1.5, dt);
    this.mid = damp(this.mid, d.mid, 0.4, dt);
    this.purpose = damp(this.purpose, K.stage(clamp(k * m.purposeGate), 0.3, 0.85), 2.5, dt);
    this.rot += dt * (0.05 + 0.16 * this.energy + 0.04 * k);
    this.spin += dt * (0.25 + 1.6 * this.energy);
    this.porchLevel = damp(this.porchLevel, K.stage(k, 0.4, 0.6), 1.2, dt);

    // formation changes every 8 bars with a tapped tempo, else ~20 s (the springs make it a glide)
    this.modeClock += dt;
    if (this.modeClock > (a.bpm > 0 ? (32 * 60) / a.bpm : 20)) { this.modeClock = 0; this.mode = (this.mode + 1) % 4; }

    // ---- lights: arrive from beyond the fog, hover, take formation
    const H = [0, 0, 0], F = [0, 0, 0], T = [0, 0, 0];
    const w0 = 0.45 + 0.35 * k;
    this.lights.forEach((L, i) => {
      const tp = L.on < 0 ? (i === 1 ? Math.max(m.twin, K.stage(kL, 0.08, 0.2)) : 1) : K.stage(kL, L.on, L.on + 0.12);
      L.pres = damp(L.pres, tp, 2.5, dt);
      const ph = L.ph;
      H[0] = L.B[0] + Math.sin(t * 0.13 + ph) * 4; H[1] = L.B[1] + Math.sin(t * 0.21 + ph * 2) * 1.2; H[2] = L.B[2] + Math.cos(t * 0.11 + ph) * 3;
      this._formation(i, this.mode, F);
      const p = this.purpose, e = ease(L.pres);
      for (let c = 0; c < 3; c++) {
        T[c] = lerp(L.A[c], lerp(H[c], F[c], p), e);
        L.vel[c] += ((T[c] - L.pos[c]) * w0 * w0 - 2 * w0 * L.vel[c]) * dt;
        L.pos[c] += L.vel[c] * dt;
      }
    });

    // ---- beat: one light lowers a pale beam onto the grass
    this.beamGap -= dt;
    const bm = d.beatMotion, barFire = this.bar.update(a, dt);
    if (((d.beat && Math.random() < bm) || (barFire && bm < 1 && k > 0.05)) && this.beamGap <= 0) {
      const slot = this.beams.find((b) => !b.held && b.light < 0);
      if (slot) {
        const used = new Set(this.beams.map((b) => b.light));
        for (let n = 0; n < N_LIGHTS; n++) {
          const i = (this.beamRR + n) % N_LIGHTS, L = this.lights[i];
          const dz = CAM[2] - L.pos[2];
          if (used.has(i) || L.pres < 0.7 || L.pos[2] > FENCE_Z - 3 || dz > 125 || L.pos[1] > 26) continue;
          slot.light = i; slot.ext = 0; slot.env.trigger(0.55 + 0.45 * k);
          this.beamRR = i + 1; this.beamGap = 0.8;
          break;
        }
      }
    }
    // drop: held beams lowered onto the field at a steady rate (never on beats), each down for a few seconds
    const hr = m.held * k;
    if (hr > 0.02 && (this.heldClock -= dt * hr) <= 0) {
      this.heldClock = 1.6 + Math.random() * 1.4;
      const slot = this.beams.find((b) => b.held && b.light < 0);
      if (slot) {
        const used = new Set(this.beams.map((b) => b.light));
        for (let n = 0; n < N_LIGHTS; n++) {
          const i = (this.beamRR + n) % N_LIGHTS, L = this.lights[i];
          if (used.has(i) || L.pres < 0.7 || L.pos[2] > FENCE_Z - 3 || CAM[2] - L.pos[2] > 125 || L.pos[1] > 26) continue;
          slot.light = i; slot.ext = 0; slot.hold = 3 + Math.random() * 2.5; slot.hl = 0.5 + 0.4 * k; slot.hv = 0;
          this.beamRR = i + 1;
          break;
        }
      }
    }
    let sum = 0;
    for (const b of this.beams) {
      let v = b.env.update(dt);
      if (b.held) {
        b.hold -= dt;
        b.hv = damp(b.hv, b.hold > 0 ? b.hl : 0, 0.5, dt);
        v = Math.max(v, b.hv * K.stage(this.k, 0, 0.3));   // light: × k, so a stop dims a held beam at once
      }
      if (b.light < 0) { b.v = 0; continue; }
      const L = this.lights[b.light];
      b.ext = damp(b.ext, v > 0.06 ? 1 : 0, 0.22 + 0.45 * (1 - d.motion), dt);
      b.v = v * ease(b.ext * 1.4) * L.pres;
      L.dip = Math.max(L.dip, b.ext * (0.6 + 1.2 * d.motion));
      if (v < 0.02 && b.ext < 0.03 && b.hold <= 0) { b.light = -1; b.ext = 0; b.v = 0; b.hv = 0; continue; }
      sum += b.v;
    }
    this.beamSum = sum;
    for (const L of this.lights) L.dipS = damp(L.dipS ?? 0, L.dip, 0.35, dt), L.dip = 0;

    // ---- farmhouse windows: one or two warm at idle, more with the swell; waver under a beam
    for (const w of this.win) {
      const target = Math.max(w.idle, K.stage(kWin, w.on, w.on + 0.15) * 0.9);
      w.base = damp(w.base, target, 0.8, dt);
      const waver = 1 - Math.min(0.25, sum * 0.18 * d.accent) * (0.5 + 0.5 * Math.sin(t * 7 + w.n * 2.3));
      w.level = w.base * (0.94 + 0.06 * br) * waver;
      this.winInst.set(w.n, w.x, w.y, w.z, 1, w.ry, 0.12 + w.level * 0.95, 0, 1);
      this.winGlows.set(w.n, w.x + w.nx * 0.5, w.y + 0.65, w.z + w.nz * 0.5, 1.8 + w.level * 0.6, 0, w.level * 0.32, 0, 1);
    }
    const P = this.porch;
    this.winGlows.set(this.win.length, P[0], P[1], P[2], 1.4 + this.porchLevel * 0.6, 0, this.porchLevel * 0.55, 0, 1);
    this.winInst.upload(this.win.length); this.winGlows.upload(this.win.length + 1);

    this.mist.update(dt, [0, 1.6, -12], { amount: K.swell(k, 0.5, 0.75), speed: 0.6 + this.energy * 0.6 });
  }

  render(r) {
    const { col, k } = this, P = this.pal, t = this.time;
    const a = this.a || { level: 0, bass: 0, mid: 0, high: 0, beatPulse: 0 };
    const d = K.drive(a, k);
    const dim = lerp(0.75, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    const eye = this.cam.eye;
    this.sky.draw(r, eye, { horizon: col.fog, zenith: P.color(R(3, 0)), brightness: dim, starLevel: 0.5 + d.high * 0.3, cloudDrift: t * 0.003 });
    r.setFog(col.fog, 12, lerp(95, 118, k));
    r.setLight([0.3, -0.6, -0.7], scaleColor(col.light, P.role('light'), lerp(0.3, 0.42, k) + this.beamSum * 0.06), scaleColor(col.amb, P.role('ambient'), 0.5));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    // point lights: every hovering light faintly, a beam that is down strongly where it lands
    const PL = this.plights, pale = P.color(R(3, 3));
    scaleColor(col.hover, pale, 2.2); scaleColor(col.land, pale, 5);
    PL.begin();
    this.lights.forEach((L, i) => PL.add(i, L.pos[0], L.pos[1] - L.dipS - 1, L.pos[2], col.hover, 22 + L.size * 6, L.pres * 0.6));
    this.beams.forEach((b, j) => {
      if (b.light < 0) return;
      const L = this.lights[b.light], x = L.pos[0], z = L.pos[2];
      PL.add(100 + j * 32 + b.light, x, height(x, z) + 3, z, col.land, 20, Math.min(1, b.v * 2) * b.ext * b.ext);
    });
    const tg = this.cam.target, fx = tg[0] - eye[0], fz = tg[2] - eye[2], fn = Math.hypot(fx, fz) || 1;
    col.focus[0] = eye[0] + (fx / fn) * 30; col.focus[1] = 2; col.focus[2] = eye[2] + (fz / fn) * 30;
    PL.apply(r, col.focus, this.dt || 1 / 60);
    const I = mat4.identity(this.mI);

    // ---- opaque world
    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    r.draw(this.roadMesh, I, { texture: this.roadTex, tint: col.tint });
    r.draw(this.wallMesh, I, { texture: this.sidingTex, tint: col.tint });
    r.draw(this.roofMesh, I, { texture: this.roofTex, tint: col.tint });
    r.draw(this.woodMesh, I, { texture: this.woodTex, tint: col.tint });
    const hb = this.millHub;
    r.draw(this.rotorMesh, mat4.trs(this.mRotor, hb[0], hb[1], hb[2], 0, 0, this.spin), { texture: this.roofTex, tint: col.tint });
    r.drawInstanced(this.glassMesh, this.winInst, { texture: this.glassTex, unlit: true, tint: col.one });
    r.drawInstanced(this.frameMesh, this.winInst, { texture: this.frameTex, tint: col.tint });

    // lens bodies: dark, lit by the scene, fogged with distance (far lights are only glow)
    this.lights.forEach((L, i) => {
      const s = L.size * 1.4 * ease(L.pres), y = L.pos[1] - L.dipS;
      this.bodies.set(i, L.pos[0], y, L.pos[2], s, t * 0.4 + L.ph, 0.8, 0, 0.32);
      const fl = 0.85 + 0.15 * Math.sin(t * 2.3 + L.ph * 3) + d.high * 0.25;
      this.cores.set(i, L.pos[0], y - s * 0.3, L.pos[2], s * 1.3 + 0.6, 0, L.pres * fl, 0, 1);
      this.halos.set(i, L.pos[0], y, L.pos[2], (3 + L.size * 1.6) * (0.5 + 0.5 * L.pres) * (1 + this.breath.v * 0.08), 0, L.pres * (0.42 + 0.25 * k) * fl, 0, 1);
    });
    this.bodies.upload(N_LIGHTS); this.cores.upload(N_LIGHTS); this.halos.upload(N_LIGHTS);
    r.drawInstanced(this.bodyMesh, this.bodies, { texture: this.bodyTex, tint: col.tint });

    // ---- foliage
    const sway = 0.01 + this.breath.v * 0.008 + this.mid * 0.03;
    r.drawInstanced(this.quad, this.pines, { texture: this.pineTex, billboard: 1, sway: sway * 0.4, tint: col.tint });
    r.drawInstanced(this.quad, this.trees, { texture: this.treeTex, billboard: 1, sway: sway * 0.6, tint: col.tint });
    r.drawInstanced(this.quad, this.bushes, { texture: this.bushTex, billboard: 1, sway: sway * 0.5, tint: col.tint });
    r.drawInstanced(this.quad, this.grass, { texture: this.grassTex, billboard: 1, sway, tint: col.tint });

    // ---- light: pools, beams, halos (additive, last)
    for (const b of this.beams) {
      if (b.light < 0 || b.v < 0.005) continue;
      const L = this.lights[b.light], x = L.pos[0], z = L.pos[2], gy = height(x, z);
      const top = L.pos[1] - L.dipS - L.size * 0.4, full = Math.max(1, top - gy), len = full * b.ext;
      const W = 2.4 + full * 0.42;   // the cone is drawn in the texture; the quad is its bounding box
      b.inst.set(0, x, top - len, z, W, 0, 1, 0, len / W);
      b.inst.upload(1);
      col.beam[0] = col.beam[1] = col.beam[2] = b.v * 0.9;
      r.drawInstanced(this.quad, b.inst, { texture: this.beamTex, billboard: 1, unlit: true, additive: true, depthWrite: false, fog: false, fade: [60, 150], uvScale: [1, Math.max(0.02, b.ext)], tint: col.beam });
      const pv = b.v * b.ext * b.ext;
      if (pv > 0.01) {
        b.pool.update(this._poolGeo(x, z, W * 0.55));
        col.pool[0] = col.pool[1] = col.pool[2] = Math.min(1, pv * 1.2);
        r.draw(b.pool, I, { texture: this.poolTex, unlit: true, additive: true, depthWrite: false, tint: col.pool });
      }
    }
    r.drawInstanced(this.cquad, this.winGlows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, depthWrite: false, fog: false, fade: [40, 110], tint: col.one });
    r.drawInstanced(this.cquad, this.halos, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, depthWrite: false, fog: false, fade: [70, 175], tint: col.one });
    r.drawInstanced(this.cquad, this.cores, { texture: this.coreTex, billboard: 2, unlit: true, additive: true, depthWrite: false, fog: false, fade: [70, 175], tint: col.one });

    this.mist.draw(r, { brightness: dim * 0.8, opacity: 0.35 });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.mist.dispose(r);
    [this.roadMesh, this.wallMesh, this.roofMesh, this.woodMesh, this.rotorMesh, this.glassMesh, this.frameMesh, this.cquad, this.quad, this.bodyMesh].forEach((m) => m.dispose());
    for (const b of this.beams) { b.pool.dispose(); b.inst.dispose(); }
    [this.groundTex, this.roadTex, this.sidingTex, this.roofTex, this.woodTex, this.glassTex, this.frameTex, this.glowTex, this.coreTex, this.grassTex, this.treeTex, this.pineTex, this.bushTex, this.bodyTex, this.beamTex, this.poolTex].forEach((tx) => r.deleteTexture(tx));
    [this.winInst, this.winGlows, this.grass, this.trees, this.pines, this.bushes, this.bodies, this.cores, this.halos].forEach((i) => i.dispose());
  }
}
