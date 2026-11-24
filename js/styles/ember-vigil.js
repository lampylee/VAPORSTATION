// Ember Vigil: a lone knight keeps vigil at a small fire in a ruined cathedral at the end of
// the world. Through the shattered rose window: a black keep on its crag under the moon.
//   idle:   moonlit ruin, the fire breathing, one keep window lit, a slow close orbit.
//   swell:  candles light down the nave, the keep lights floor by floor, the moon slides into
//           eclipse, the camera pulls back and rises to show the whole nave and the vista.
//   beat:   ember bursts from the fire. Bar (bass): a "bell toll" shakes ash from the vault.
//   peak:   lightning behind the keep (at most once a bar); a colossus rises over the crag.
// Showcases Kit v6: point lights, gothic piers, rose window, keep, knight, Fire, Candles, Lightning.
import { R, fromKeys } from '../palette/palette.js';
import { mat4, lerp, damp, clamp, smoothstep } from '../gfx/math.js';
import { GeoBuilder, box, merge } from '../gfx/geometry.js';
import * as K from '../kit/index.js';

const F = [0.25, 0, 3.0];              // the fire
const KN = [-1.0, 0, 3.15];            // the knight
const WIN = [0, 12, -36];              // rose window centre
const WIN_R = 5.2;
const PIER_X = 4.4, PIER_Z = [8, 2, -4, -10, -16, -22, -28];
const PIER_H = 9, ARCH_Y = PIER_H + 0.81;
// the flooded strip before the apse: a sunken pool (water at POOL_W) with a planar reflection
const POOL = { x0: -8.2 + (16.4 * 7) / 24, x1: -8.2 + (16.4 * 17) / 24, z0: -4.5, z1: -12 }, POOL_W = -0.14, POOL_D = -0.5;
const inPool = (x, z, m = 0) => x > POOL.x0 - m && x < POOL.x1 + m && z < POOL.z0 + m && z > POOL.z1 - m;
const KEEP_X = -11, KEEP_Z = -176, CRAG_TOP = 26;
const MOON = [26, 80, -330], MOON_R = 14;
const COLOSSUS_Z = -262, COLOSSUS_H = 112;
const IDENT = mat4.create();
const _m = mat4.create();

// pier layout: [side, index] -> 'full' | broken height fraction | 'gone'
const BROKEN = { 'R3': 0.45, 'L5': 0.32, 'R6': 0.6 };
const TOPPLED = 'L4';

/** Cinematic orbit for the vigil: close and low round the knight at idle, wide and high with k. */
class VigilRig extends K.CameraRig {
  constructor() {
    super({ fov: 58, near: 0.1, far: 440, fovPunch: 0.7, nudge: 0.05, rollKick: 0.005, idleSpeed: 0.05, activeSpeed: 0.1, bassBoost: 0.02 });
    this.ph = 0.4; this.reveal = 0;
  }
  update(audio, k, dt) {
    super.update(audio, k, dt);
    this.ph += this.speed * dt;
    const rv = this.reveal = damp(this.reveal, k, 3.5, dt), t = this.time;
    // idle: a close ellipse round the knight and the fire. wide: a slow drift behind the fire,
    // looking down the nave, the fire low in frame and the rose window above. rv blends the two.
    const ang = 0.2 + Math.sin(this.ph) * 0.8, s = Math.sin(this.ph * 0.8);
    const bob = Math.sin(t * 0.31) * 0.1 + Math.sin(t * 0.17 + 2) * 0.06;
    const close = [-0.35 + Math.sin(ang) * 2.7, 1.15, 3.0 + Math.cos(ang) * 3.5];
    const wide = [s * 2.4, 3.4, 10.4 - Math.abs(s) * 1.2];
    const e = this.eye;
    for (let i = 0; i < 3; i++) e[i] = lerp(close[i], wide[i], smoothstep(rv));
    e[1] += bob;
    // idle glances up to the window every ~50 s, so the vista shows even in a quiet song
    const glance = smoothstep(clamp((Math.sin(t * 0.125 - 1.2) - 0.45) / 0.4));
    const look = Math.max(lerp(0.05, 0.17, rv), glance * 0.42 * (1 - rv));
    const fx = -0.35, fy = lerp(0.75, 1.0, rv), fz = 3.05;
    this.target[0] = lerp(fx, WIN[0], look);
    this.target[1] = lerp(fy, WIN[1], look);
    this.target[2] = lerp(fz, WIN[2], look);
    this.roll = Math.sin(t * 0.21) * 0.008;
  }
}

export class EmberVigil {
  static meta = { name: 'Ember Vigil' };
  static palette = fromKeys('ember-vigil', 'Ember Vigil', ['#8a8496', '#6b4a3a', '#ff8a3c', '#141428'], { glow: R(2, 3), flash: R(2, 3) });

  init(r) {
    this.t = 0; this.k = 0; this.eclipse = 0; this.rise = 0; this.energy = 0;
    this.cam = new VigilRig();
    this.sky = new K.Sky(r, { stars: 220 });
    // ---------- textures
    this.floorTex = r.texture(K.tex.flagstones({ seed: 5 }));
    this.wallTex = r.texture(K.tex.ashlar({ seed: 9, soot: 0.6 }));
    this.pierTex = r.texture(K.tex.ashlar({ seed: 3, rows: 8, soot: 0.8 }));
    this.armorTex = r.texture(K.tex.plateArmor({ ramp: 0, rust: 1 }));
    this.capeTex = r.texture(K.tex.wornCloth({ ramp: 3, trim: R(1, 1) }));
    this.glassTex = r.texture(K.tex.stainedGlass({ seed: 3, holes: 0.14 }));
    this.lancetTex = r.texture(K.tex.stainedGlass({ seed: 8, holes: 0.2, ramps: [3, 3, 2, 3] }));
    this.rockTex = r.texture(K.tex.cliffRock({ seed: 7 }));
    this.bannerTex = r.texture(K.sprites.tatteredBanner({ ramp: 1, seed: 4 }));
    this.colossusTex = r.texture(K.sprites.colossus({ ramp: 3 }));
    this.coronaTex = r.texture(K.sprites.corona({ ramp: 2 }));
    this.moonTex = r.texture(K.sprites.moon({ ramp: 3 }));
    this.discTex = r.texture(K.sprites.disc({ index: R(3, 0) }));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.coldGlowTex = r.texture(K.sprites.glow({ ramp: 3 }));
    this.shaftTex = r.texture(K.sprites.lightShaft({ ramp: 3 }));
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.cquad = r.createMesh(K.centredQuad(1, 1));

    // ---------- floor: fine cells near the fire (smooth point light), coarser down the nave
    {
      const g = new GeoBuilder(), xs = [], zs = [];
      for (let i = 0; i <= 24; i++) xs.push(-8.2 + (16.4 * i) / 24);
      for (let z = 12; z > -6; z -= 0.5) zs.push(z);
      for (let z = -6; z >= -36.01; z -= 1.5) zs.push(z);
      const T = 2.2;
      for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
        const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
        if (inPool((x0 + x1) / 2, (z0 + z1) / 2)) continue;
        g.quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [x0 / T, z0 / T], [x1 / T, z0 / T], [x1 / T, z1 / T], [x0 / T, z1 / T], [0, 1, 0]);
      }
      this.floor = r.createMesh(g.build());
      // basin walls (inner faces, from the curb top down below the water) + a low curb round the rim
      const b = new GeoBuilder(), { x0, x1, z0, z1 } = POOL, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hw = (x1 - x0) / 2, hd = (z0 - z1) / 2, top = 0.16, h2 = (top - POOL_D) / 2, yc = (top + POOL_D) / 2;
      K.worldFace(b, [cx, yc, z0], [-hw, 0, 0], [0, h2, 0], 1.2, 2);
      K.worldFace(b, [cx, yc, z1], [hw, 0, 0], [0, h2, 0], 1.2, 2);
      K.worldFace(b, [x0, yc, cz], [0, 0, hd], [0, h2, 0], 1.2, 2);
      K.worldFace(b, [x1, yc, cz], [0, 0, -hd], [0, h2, 0], 1.2, 2);
      this.basin = r.createMesh(merge([
        { geo: b.build(), xf: (p) => p },
        { geo: K.worldBox(hw * 2 + 0.7, top, 0.35, 1), xf: K.xf({ pos: [cx, top / 2, z0 + 0.175] }) },
        { geo: K.worldBox(hw * 2 + 0.7, top, 0.35, 1), xf: K.xf({ pos: [cx, top / 2, z1 - 0.175] }) },
        { geo: K.worldBox(0.35, top, hd * 2, 1), xf: K.xf({ pos: [x0 - 0.175, top / 2, cz] }) },
        { geo: K.worldBox(0.35, top, hd * 2, 1), xf: K.xf({ pos: [x1 + 0.175, top / 2, cz] }) },
      ]));
      // the water: subdivided so the affine warp stays mild
      const wg = new GeoBuilder();
      K.worldFace(wg, [cx, POOL_W, cz], [hw, 0, 0], [0, 0, -hd], 3, 6);
      this.water = r.createMesh(wg.build());
      this.waterTex = r.texture(K.tex.water({ ramp: 3 }));
      this.ripples = new K.Ripples(r, { max: 14, color: R(3, 3), life: 3, lift: 0.01 });
      this.dripT = 1;
    }
    // ---------- dais, altar, steps at the apse
    this.dais = r.createMesh(merge([
      { geo: K.worldBox(16.4, 0.3, 6, 2), xf: K.xf({ pos: [0, 0.15, -33] }) },
      { geo: K.worldBox(12, 0.3, 1, 2), xf: K.xf({ pos: [0, 0.15, -29.5] }) },
      { geo: K.worldBox(16.4, 0.3, 4.6, 2), xf: K.xf({ pos: [0, 0.45, -33.7] }) },
      { geo: K.worldBox(2.6, 1.0, 1.2, 1), xf: K.xf({ pos: [0, 1.1, -33] }) },
      { geo: K.worldBox(3.0, 0.14, 1.5, 1), xf: K.xf({ pos: [0, 1.67, -33] }) },
    ]));

    // ---------- piers, arcades, ribs, vault
    const full = [], brokenP = [];
    this.pierFull = r.createMesh(K.props.gothicPier(PIER_H, 0.55, { shafts: 4 }));
    this.pierBroken = r.createMesh(K.props.gothicPier(PIER_H, 0.55, { shafts: 4, broken: 1, seed: 4 }));
    const standing = {};
    for (const [s, sx] of [['L', -1], ['R', 1]]) PIER_Z.forEach((z, i) => {
      const key = s + i;
      if (key === TOPPLED) return;
      if (BROKEN[key]) brokenP.push([sx * PIER_X, z, BROKEN[key], i]);
      else { full.push([sx * PIER_X, z]); standing[key] = true; }
    });
    this.pierInst = r.createInstances(full.length);
    full.forEach(([x, z], i) => this.pierInst.set(i, x, 0, z, 1, (i * 0.7) % 1.5, 1));
    this.pierInst.upload(full.length);
    // broken stumps + the toppled pier lying across the aisle
    this.stumpInst = r.createInstances(brokenP.length + 2);
    brokenP.forEach(([x, z, h, i], j) => this.stumpInst.set(j, x, 0, z, 1, i * 1.3, 0.95, 0, h));
    this.stumpInst.set(brokenP.length, -PIER_X + 0.2, 0.52, -16, 1, Math.PI / 2 + 0.18, 0.9, 0, 0.64, 0, -Math.PI / 2 + 0.06);
    this.stumpInst.set(brokenP.length + 1, -PIER_X, 0, -16, 1, 0.4, 0.9, 0, 0.12);   // its base still standing
    this.stumpInst.upload(brokenP.length + 2);
    // arcade arches between standing full piers
    const arches = [];
    for (const [s, sx] of [['L', -1], ['R', 1]]) for (let i = 0; i < PIER_Z.length - 1; i++) {
      if (standing[s + i] && standing[s + (i + 1)]) arches.push([sx * PIER_X, (PIER_Z[i] + PIER_Z[i + 1]) / 2]);
    }
    this.archMesh = r.createMesh(K.pointedArch(6 - 1.15, ARCH_Y, { thick: 0.45, depth: 0.95, sharp: 1.3, segs: 6 }));
    this.archInst = r.createInstances(arches.length);
    arches.forEach(([x, z], i) => this.archInst.set(i, x, 0, z, 1, Math.PI / 2, 1));
    this.archInst.upload(arches.length);
    // transverse ribs across the nave where both piers stand (some fell long ago)
    const ribs = PIER_Z.map((z, i) => [z, i]).filter(([, i]) => standing['L' + i] && standing['R' + i] && i !== 4);
    this.ribMesh = r.createMesh(K.pointedArch(PIER_X * 2 - 1.15, ARCH_Y, { thick: 0.4, depth: 0.55, sharp: 1.25, segs: 8 }));
    this.ribInst = r.createInstances(ribs.length);
    ribs.forEach(([z], i) => this.ribInst.set(i, 0, 0, z, 1, 0, 1));
    this.ribInst.upload(ribs.length);
    // vault over the first two bays only; the rest of the roof is gone
    const vlen = PIER_Z[0] - PIER_Z[2];
    const vgeo = K.vault(vlen, PIER_X, ARCH_Y + 2.6, { sharp: 1.22, segs: 8, uvTile: 2.5 });
    this.vault = r.createMesh(merge([
      { geo: vgeo, xf: K.xf({ pos: [0, 0, PIER_Z[0]] }) },
      // string course + spandrel walls carrying it over the arcade
      { geo: K.worldBox(0.9, 2.7, vlen, 2), xf: K.xf({ pos: [-PIER_X, ARCH_Y + 1.25, PIER_Z[0] - vlen / 2] }) },
      { geo: K.worldBox(0.9, 2.7, vlen, 2), xf: K.xf({ pos: [PIER_X, ARCH_Y + 1.25, PIER_Z[0] - vlen / 2] }) },
      { geo: K.worldBox(0.9, 0.5, 9, 2), xf: K.xf({ pos: [PIER_X, ARCH_Y + 0.15, PIER_Z[2] - 4.5] }) },
    ]));

    // ---------- outer walls (aisle walls with lancets, ragged tops), back wall, apse wall
    {
      const g = new GeoBuilder(), lan = [];
      const bays = [];
      for (let z = 12; z > -30; z -= 6) bays.push(z);
      for (const sx of [-1, 1]) bays.forEach((z0, b) => {
        const h = sx < 0 && b === 4 ? 2.6 : 6.8 + K.rand2(b, sx, 11) * 2.2, x = sx * 8.2, z1 = z0 - 6;
        K.worldFace(g, [x, h / 2, (z0 + z1) / 2], [0, 0, sx * 3], [0, h / 2, 0], 2, 3);
        if (h > 5) lan.push([x - sx * 0.05, (z0 + z1) / 2, sx]);
      });
      K.worldFace(g, [0, 8, 12], [8.2, 0, 0], [0, 8, 0], 2, 3);                   // west wall behind the camera
      this.walls = r.createMesh(g.build());
      this.lancets = lan;
      const lg = K.lancet(1.3, 2.4, 5.6, 1.3).geo;
      this.lancetMesh = r.createMesh(lg);
      this.lancetInst = r.createInstances(lan.length);
      this.shaftInst = r.createInstances(lan.length);
      lan.forEach(([x, z, sx], i) => {
        this.lancetInst.set(i, x, 0, z, 1, -sx * Math.PI / 2, 1);
        this.shaftInst.set(i, x - sx * 3.4, 0, z + 0.6, i % 2 ? 0 : 0.95, 0, 1, 0, 7.2 / 0.95, 0, sx * 0.5);
      });
      this.lancetInst.upload(lan.length); this.shaftInst.upload(lan.length);
    }
    this.apse = r.createMesh(K.wallWithHole(16.4, 17, WIN[0], WIN[1], WIN_R, { segs: 32, tile: 2, gable: 6, depth: 0.9 }));
    const rose = K.roseWindow(WIN_R, { petals: 12, depth: 0.5, broken: [1, 2, 6, 9], glassTile: 3.2 });
    this.tracery = r.createMesh(rose.tracery);
    this.glass = r.createMesh(rose.glass);

    // ---------- rubble, fallen blocks, banners
    this.rockMesh = r.createMesh(K.props.rock(4, { spike: 0.3, rough: 0.9 }));
    this.rubble = r.createInstances(30);
    let n = 0;
    for (let i = 0; i < 30; i++) {
      const side = i % 2 ? 1 : -1, z = 10 - (i / 30) * 40 + K.rand2(i, 1, 3) * 2;
      const x = side * (3 + K.rand2(i, 2, 3) * 4.6), s = 0.18 + K.rand2(i, 3, 3) * 0.55;
      if (Math.hypot(x - F[0], z - F[2]) < 2.6) continue;
      this.rubble.set(n++, x, inPool(x, z, 0.2) ? POOL_W - 0.1 + s * 0.2 : s * 0.35, z, s, K.rand2(i, 4, 3) * 6, 0.75 + K.rand2(i, 5, 3) * 0.3, 0, 0.7);
    }
    // the fire's ring of broken masonry
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.3; this.rubble.set(n++, F[0] + Math.cos(a) * 0.62, 0.08, F[2] + Math.sin(a) * 0.62, 0.2 + K.rand2(i, 9, 2) * 0.08, a * 3, 0.85, 0, 0.8); }
    this.rubbleN = n; this.rubble.upload(n);
    this.blockMesh = r.createMesh(K.worldBox(1, 1, 1, 1));
    this.blocks = r.createInstances(12);
    const BL = [[-2.4, 1.6, 1.4, 0.55, 0.9, 0.2], [2.6, -2.5, 1.9, 0.7, 1.0, -0.4], [-3.0, -7.5, 1.2, 0.5, 2.0, 0.6], [3.2, -13.5, 2.4, 0.8, 1.1, 0.1],
      [-1.6, -19, 1.0, 0.45, 1.6, 1.1], [2.8, -24.5, 1.3, 0.6, 1.2, -0.2], [-6.5, 6, 1.5, 0.8, 1.2, 0.3], [6.4, -4, 1.1, 1.2, 1.4, 0.8], [-6.2, -27, 2.0, 0.7, 1.0, 0.0]];
    BL.forEach(([x, z, w, h, d, ry], i) => {
      const sunk = inPool(x, z) ? -POOL_D : 0;   // reaches down to the basin floor, top stays put
      this.blocks.set(i, x, (h + sunk) / 2 - sunk, z, 1, ry, 0.9, 0, h + sunk); this.blocks.stretch(i, w, d);
    });
    this.blocks.upload(BL.length); this.blockN = BL.length;
    this.blockTops = BL.map(([x, z, w, h, d, ry]) => ({ x, z, h, w, d, ry }));
    this.bannerInst = r.createInstances(5);
    [[-1, 2], [1, -4], [-1, -10], [1, 8], [1, -16]].forEach(([sx, z], i) => {
      this.bannerInst.set(i, sx * (PIER_X - 0.62), 8.2, z, 1.05, sx * Math.PI / 2, 1, i * 1.7, -3.3 - K.rand2(i, 1, 5) * 0.9);
    });
    this.bannerInst.upload(5);

    // ---------- the knight and the fire
    const kn = K.props.knight({ seed: 3 });
    this.knight = r.createMesh(kn.body);
    this.cape = new K.Wobble(r, kn.cape);
    this.capeV = kn.cape.uvs;
    this.knightM = mat4.trs(mat4.create(), KN[0], KN[1], KN[2], 0, Math.PI / 2 - 0.22, 0);
    this.fire = new K.Fire(r, { pos: F, scale: 1, flames: 7, embers: 80 });

    // ---------- candles: clusters on blocks and the floor, lit front to back
    this.candles = new K.Candles(r, { max: 64 });
    const CL = [
      { x: -2.4, z: 1.6, y: 0.55, n: 6 },        // on the block beside the knight (lit at idle)
      { x: 3.4, z: -1.2, y: 0, n: 5 }, { x: -3.0, z: -7.5, y: 0.5, n: 6 }, { x: 3.2, z: -13.5, y: 0.8, n: 7 },
      { x: -1.6, z: -19, y: 0.45, n: 5 }, { x: 2.8, z: -24.5, y: 0.6, n: 6 }, { x: 0, z: -33, y: 1.74, n: 10 },
    ];
    this.clusters = []; let ci = 0;
    CL.forEach((c, g) => {
      const from = ci;
      for (let j = 0; j < c.n; j++) {
        const a = j * 2.39996 + g, rr = c.n > 7 ? 0.3 + (j % 5) * 0.24 : 0.08 + Math.sqrt(j / c.n) * 0.36;
        const x = c.n > 7 ? c.x - 1.15 + (j / (c.n - 1)) * 2.3 : c.x + Math.cos(a) * rr, z = c.n > 7 ? c.z + (j % 2 ? 0.25 : -0.25) : c.z + Math.sin(a) * rr;
        this.candles.set(ci++, x, c.y, z, 0.12 + K.rand2(ci, 2, 9) * 0.26, 0);
      }
      this.clusters.push([from, ci]);
    });
    this.candleN = ci;
    this.candleStage = new K.Stager(CL.length - 1, { from: [0.06, 0.55], to: [0.22, 0.82], rise: [1.2, 3.2], fall: 2.5 });

    // ---------- the vista: crag, keep, gorge walls, moon / eclipse, colossus, crows, lightning
    const cragGeo = K.props.rock(17, { spike: 1.7, rough: 0.7, subdiv: 1 });
    let top = -Infinity;
    for (let i = 1; i < cragGeo.positions.length; i += 3) top = Math.max(top, cragGeo.positions[i]);
    const CS = [30, 22, 22];
    this.crag = r.createMesh(merge([
      { geo: cragGeo, xf: K.xf({ pos: [KEEP_X + 4, CRAG_TOP - top * CS[1], KEEP_Z], scale: CS }) },
      // gorge walls: broad, low ridges either side (spiky ones read as black blades inside the ruin)
      { geo: K.props.rock(23, { spike: 0.35, rough: 0.6, subdiv: 1 }), xf: K.xf({ pos: [-85, -12, KEEP_Z - 50], scale: [70, 24, 34] }) },
      { geo: K.props.rock(31, { spike: 0.35, rough: 0.6, subdiv: 1 }), xf: K.xf({ pos: [88, -14, KEEP_Z - 30], scale: [72, 22, 34] }) },
    ]));
    const kp = K.props.keep({ seed: 7, scale: 1.25 });
    this.keepMesh = r.createMesh(kp.geo);
    this.keepM = mat4.trs(mat4.create(), KEEP_X, CRAG_TOP - 1.5, KEEP_Z, 0, 0.12, 0);
    const c12 = Math.cos(0.12), s12 = Math.sin(0.12);
    this.keepWin = kp.windows.map((w) => ({ x: KEEP_X + w.x * c12 + w.z * s12, y: w.y + CRAG_TOP - 1.5, z: KEEP_Z - w.x * s12 + w.z * c12 + 0.2, floor: w.floor }));
    this.floors = Math.max(...this.keepWin.map((w) => w.floor)) + 1;
    this.keepStage = new K.Stager(this.floors, { from: [0.12, 0.6], to: [0.3, 0.88], rise: [1, 3], fall: 2.5 });
    this.winInst = r.createInstances(this.keepWin.length);
    this.crows = new K.School(r, { kind: 'bird', groups: 1, perGroup: 9, size: 0.55, spread: [3, 8], lift: 1.6 });
    this.bolt = new K.Lightning(r, { width: 1.3 });
    this.boltClock = new K.BarClock({ minGap: 2.2, backup: [9, 16] });
    this.bellClock = new K.BarClock({ minGap: 1.5 });
    this.bellEnv = new K.Envelope(0.9);
    this.colossusEyes = r.createInstances(2);

    // ---------- air
    this.ash = new K.Particles(r, 'ash', { count: 380, area: [26, 16, 18] });
    this.motes = new K.Particles(r, 'dust', { count: 200, area: [18, 9, 11] });
    this.cameraUpdated = false;
  }

  update(audio, k, dt) {
    this.t += dt; this.k = k;
    const a = K.drive(audio, k);
    this.energy = damp(this.energy, (audio.energy ?? audio.level ?? 0) * k, 1.5, dt);
    this.cam.update(audio, k, dt);
    this.eclipse = damp(this.eclipse, K.stage(k, 0.32, 0.85), 4, dt);
    this.rise = damp(this.rise, K.stage(k, 0.74, 1), 5, dt);
    // fire: breathes at idle, roars with the song; beats throw ember bursts
    const burst = audio.beat && k > 0.05 ? (0.35 + 0.65 * k) * (audio.accent ?? 1) : 0;
    this.fire.update(dt, { level: lerp(0.72, 1.3, Math.max(k * 0.7, this.energy)) + lerp(a.energy, a.bass, a.beatMotion) * 0.15, burst });
    // candles: cluster 0 always lit, the rest in order down the nave
    this.candleStage.update(k, dt);
    this.clusters.forEach(([s, e], g) => {
      const L = g === 0 ? 0.9 + k * 0.1 : this.candleStage.v[g - 1];
      for (let i = s; i < e; i++) this.candles.c[i].level = L;
    });
    this.candles.upload(this.candleN, dt);
    // keep windows: one lit at idle, then floor by floor
    this.keepStage.update(k, dt);
    this.keepWin.forEach((w, i) => {
      const L = i === 6 ? Math.max(0.75, this.keepStage.v[w.floor]) : this.keepStage.v[w.floor] * (K.rand2(i, 3, 2) > 0.25 ? 1 : 0);
      const fl = 0.85 + 0.15 * Math.sin(this.t * (3 + K.rand2(i, 4, 2) * 4) + i);
      this.winInst.set(i, w.x, w.y, w.z, 3.4 * L * fl, 0, 1);
    });
    this.winInst.upload(this.keepWin.length);
    // bell toll once a bar in louder passages: ash shaken loose, a shiver through the light
    if (this.bellClock.update(audio, dt) && k > 0.35) {
      this.bellEnv.trigger(k);
      this.ash.gust(1.2 * k * (audio.accent ?? 1), [0.3, 1]);
      this.cam.nudge.kick(-0.06 * k * (audio.motion ?? 1) * a.beatMotion);
    }
    this.bellEnv.update(dt);
    // lightning behind the keep: at most once a bar, only near the top of the swell
    if (this.boltClock.update(audio, dt) && k > 0.65 && Math.random() < (0.22 + 0.4 * K.stage(k, 0.7, 1)) * Math.min(1, audio.accent ?? 1)) {
      const x0 = (Math.random() - 0.5) * 120;
      this.bolt.strike([x0, 150, KEEP_Z - 70], [x0 * 0.3 + (Math.random() - 0.5) * 30, CRAG_TOP + 4, KEEP_Z - 25]);
    }
    this.bolt.update(dt);
    // water drips from the broken vault into the pool; the beat sends a ring across it
    if ((this.dripT -= dt) <= 0) {
      this.dripT = lerp(2.6, 0.9, k) * (0.5 + Math.random());
      this.ripples.spawn(lerp(POOL.x0 + 0.6, POOL.x1 - 0.6, Math.random()), POOL_W, lerp(POOL.z1 + 0.6, POOL.z0 - 0.6, Math.random()), 1.2 + Math.random(), 0.6);
    }
    // the ring: every beat at Punchy, once a bar at Gentle
    if (audio.beat && k > 0.3 && (a.beatMotion > 0.5 || ((audio.bpm || 0) > 0 && Number.isFinite(audio.bar) ? (audio.bar | 0) === 0 : (audio.beatCount || 0) % 4 === 0))) this.ripples.spawn((POOL.x0 + POOL.x1) / 2 + (Math.random() - 0.5) * 3, POOL_W, (POOL.z0 + POOL.z1) / 2 + (Math.random() - 0.5) * 4, 3.5 * k, k * (audio.accent ?? 1));
    this.ripples.update(dt);
    // the colossus rises behind the crag, eyes kindling as it clears it
    const cy = lerp(-COLOSSUS_H * 0.25, COLOSSUS_H * 0.62, this.rise) + Math.sin(this.t * 0.2) * 0.8 * this.rise;
    this.colossusY = cy;
    const eyeY = cy + COLOSSUS_H * (1 - 0.36), eyeL = K.stage(this.rise, 0.55, 1) * (0.8 + 0.2 * Math.sin(this.t * 1.7));
    const W = COLOSSUS_H * (64 / 96);
    this.colossusEyes.set(0, -W * 0.08, eyeY, COLOSSUS_Z + 1, 7 * eyeL, 0, 1);
    this.colossusEyes.set(1, W * 0.08, eyeY, COLOSSUS_Z + 1, 7 * eyeL, 0, 1);
    this.colossusEyes.upload(2);
    // cape stirs in the fire's updraft, more as the song builds
    const gust = 0.04 + k * 0.08 + this.fire.burst * 0.05 * a.beatMotion, t = this.t, V = this.capeV;
    this.cape.update((x, y, z, out, i) => {
      const v = V[i * 2 + 1], w = v * v * gust;
      out[0] = x + Math.sin(t * 1.3 + v * 4 + x * 3) * w;
      out[1] = y + Math.max(0, Math.sin(t * 2.1 + x * 5 + v * 6)) * w * 0.5 * (v > 0.75 ? 1 : 0.3);
      out[2] = z + Math.sin(t * 0.9 + v * 3) * w * 0.6;
    });
    // crows wheel outside the window
    this.crows.update(dt, (g, tt, out) => { out[0] = Math.sin(tt * 0.15) * 4; out[1] = 17 + Math.sin(tt * 0.3) * 1.5; out[2] = -64 + Math.cos(tt * 0.15) * 3; }, { amount: lerp(0.45, 1, k), speed: lerp(0.6, 1.3, k), flap: lerp(0.3, 1, k) });
    // air
    const eye = this.cam.eye;
    this.ash.update(dt, [eye[0], eye[1] + 4, eye[2] - 10], { amount: lerp(0.22, 1, k), speed: lerp(0.6, 1.3, k), wind: [0.15, 0.25] });
    this.motes.update(dt, [eye[0], eye[1], eye[2] - 6.5], { amount: lerp(0.5, 0.9, k), speed: 0.5 });
  }

  render(r) {
    const P = this.pal, k = this.k, t = this.t, fl = this.bolt.flash;
    const col = (i, s = 1) => { const c = P.color(i); return [c[0] * s, c[1] * s, c[2] * s]; };
    const mixc = (a, b, m) => [lerp(a[0], b[0], m), lerp(a[1], b[1], m), lerp(a[2], b[2], m)];
    const add3 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
    const dim = lerp(0.62, 1, k), ecl = this.eclipse;
    const moonLevel = lerp(1, 0.35, ecl);
    // fog: deep night, a breath warmer near the fire as it grows; lightning lifts it
    const fog = add3(col(R(3, 1), dim * lerp(0.75, 1, moonLevel)), col(R(3, 3)), fl * 0.25);
    r.clear(fog);
    r.setJitterBoost(K.stage(k, 0.86, 1) * 0.35);
    this.cam.apply(r);
    const eye = this.cam.eye;
    // ---------- sky + far vista (no fog: it is outside, seen through the ruin)
    // a lighter horizon band behind the vista so the crag and keep read as silhouettes; ember-red in the eclipse
    const horizon = add3(mixc(col(R(3, 2), 0.62), col(R(2, 0), 1.25), ecl * 0.75), col(R(3, 3)), fl * 0.5);
    this.sky.draw(r, eye, { horizon, zenith: add3(col(R(3, 0), 0.8), col(R(3, 2)), fl * 0.3), brightness: 1, starLevel: lerp(0.5, 0.25, k) * moonLevel + 0.1 });
    // moon -> eclipse: dark disc slides across, corona blooms in ember light
    const moonCol = col(R(3, 3), moonLevel);
    mat4.trs(_m, MOON[0], MOON[1], MOON[2], 0, 0, 0, MOON_R * 2.2, MOON_R * 2.2, 1);
    r.draw(this.cquad, _m, { texture: this.coldGlowTex, additive: true, unlit: true, fog: false, depthWrite: false, tint: col(R(3, 2), 0.35 * moonLevel) });
    mat4.trs(_m, MOON[0], MOON[1], MOON[2], 0, 0, 0, MOON_R * 2, MOON_R * 2, 1);
    r.draw(this.cquad, _m, { texture: this.moonTex, unlit: true, fog: false, depthWrite: false });
    const off = (1 - ecl) * MOON_R * 2.3;
    mat4.trs(_m, MOON[0] - off * 0.75, MOON[1] + off * 0.62, MOON[2] + 2, 0, 0, 0, MOON_R * 2.04, MOON_R * 2.04, 1);
    if (ecl > 0.01) r.draw(this.cquad, _m, { texture: this.discTex, unlit: true, fog: false, depthWrite: false, tint: [0.9, 0.9, 0.9] });
    if (ecl > 0.3) {
      const cr = K.stage(ecl, 0.3, 1);
      mat4.trs(_m, MOON[0], MOON[1], MOON[2] + 4, 0, 0, t * 0.02, MOON_R * 5.4, MOON_R * 5.4, 1);
      r.draw(this.cquad, _m, { texture: this.coronaTex, additive: true, unlit: true, fog: false, depthWrite: false, tint: [cr, cr, cr] });
    }
    // colossus (behind the crag), its eyes, lightning
    if (this.rise > 0.005) {
      const W = COLOSSUS_H * (64 / 96), sil = add3(col(R(3, 1), 0.8), col(R(3, 3)), fl * 0.8);
      mat4.trs(_m, 0, this.colossusY, COLOSSUS_Z, 0, 0, 0, W, COLOSSUS_H, 1);
      r.draw(this.quad, _m, { texture: this.colossusTex, unlit: true, fog: false, tint: sil, opacity: Math.min(1, this.rise * 3) });
      r.drawInstanced(this.cquad, this.colossusEyes, { texture: this.glowTex, billboard: 2, additive: true, unlit: true, fog: false });
    }
    this.bolt.draw(r, { tint: add3(col(R(3, 3), 1.1), col(R(2, 3)), 0.15) });
    // crag + keep: silhouettes with a cold rim, flaring in the lightning
    const silTint = add3(col(R(3, 1), 0.55 + 0.25 * moonLevel), [1, 1, 1], fl * 0.7);
    r.setLight([0.2, -0.35, 1], col(R(3, 3), 0.25 * moonLevel + fl), col(R(3, 1), 0.8));
    r.draw(this.crag, IDENT, { texture: this.rockTex, fog: false, tint: silTint });
    r.draw(this.keepMesh, this.keepM, { texture: this.wallTex, fog: false, tint: silTint });
    r.drawInstanced(this.cquad, this.winInst, { texture: this.glowTex, billboard: 2, additive: true, unlit: true, fog: false });
    this.crows.draw(r, { tint: col(R(3, 0), 0.6) });

    // ---------- interior
    const near = lerp(5, 9, k), far = lerp(32, 74, k) * (1 + fl * 0.2);
    r.setFog(fog, near, far);
    // the eclipse's corona throws a dull ember light over everything
    const ambient = add3(add3(col(R(3, 1), lerp(0.55, 0.8, k)), col(R(2, 1)), 0.32 * K.stage(ecl, 0.3, 1)), col(R(3, 3)), fl * 0.25);
    r.setLight([0.35, -0.75, 0.55], add3(col(R(3, 3), lerp(0.28, 0.4, k) * moonLevel), col(R(3, 3)), fl * 0.9), ambient);
    const glowC = col(R(2, 3));
    const lights = [this.fire.pointLight(glowC, { strength: 2.4, radius: 10 })];
    const c1 = this.candles.groupLight(this.clusters[1][0], this.clusters[3][1], col(R(2, 2)), { strength: 1.1, radius: 7 });
    const c2 = this.candles.groupLight(this.clusters[4][0], this.clusters[6][1], col(R(2, 2)), { strength: 1.3, radius: 8 });
    if (c1) lights.push(c1);
    if (c2) lights.push(c2);
    const winL = 0.5 * moonLevel + fl * 2.2 + this.bellEnv.v * 0.3 + K.stage(ecl, 0.3, 1) * 0.5;
    lights.push({ pos: [0, 9, -33], color: mixc(col(R(3, 3), winL), col(R(2, 2), winL), K.stage(ecl, 0.3, 1) * 0.6), radius: 22 });
    r.setPointLights(lights);

    const gl = lerp(0.22, 0.34, k) * (0.6 + 0.4 * moonLevel) + fl * 0.6 + this.bellEnv.v * 0.12;
    const lg = lerp(0.3, 0.5, k) * moonLevel + fl * 0.6;
    const sb = (lerp(0.1, 0.15, k) * moonLevel + fl * 0.2) * (0.9 + 0.1 * Math.sin(t * 0.5));
    const ctx = { fog, near, far, k, gl, lg, sb };
    // reflection: only worth it when the pool can be on screen (the camera looks down the nave)
    const reflect = this.cam.target[2] < this.cam.eye[2] - 2;
    if (reflect) {
      r.setMirror(POOL_W);
      this._world(r, ctx, true);
      r.setMirror(null);
      r.clearDepth();
      r.setClipBelow(POOL_W);
    }
    this._world(r, ctx, false);
    if (reflect) r.setClipBelow(null);
    // the water over the reflection: screen-door, so the mirror image shows through in a dither
    r.draw(this.water, IDENT, { texture: this.waterTex, opacity: reflect ? 0.3 : 1, uvOffset: [t * 0.01, t * 0.006], tint: [0.8, 0.8, 0.85] });
    this.ripples.draw(r, { brightness: lerp(0.35, 0.6, k) + fl * 0.4 });
    // air last
    this.motes.draw(r, { brightness: lerp(0.35, 0.6, k) });
    this.ash.draw(r, { brightness: lerp(0.5, 0.8, k) + fl * 0.5 });
  }

  /**
   * The interior. refl = the mirrored pass into the pool. Seen from the camera's height the pool only mirrors what is
   * low at the far end (altar, candles, pier bases, the foot of the apse wall), so that is all it draws.
   */
  _world(r, c, refl) {
    const { fog, near, far, k, gl, lg, sb } = c;
    if (refl) {
      const D = [0.78, 0.78, 0.85];
      r.draw(this.dais, IDENT, { texture: this.floorTex, tint: D });
      r.drawInstanced(this.pierFull, this.pierInst, { texture: this.pierTex, tint: D });
      r.drawInstanced(this.blockMesh, this.blocks, { texture: this.wallTex, tint: D });
      r.setFog(fog, near, far * 1.5);
      mat4.trs(_m, 0, 0, WIN[2], 0, 0, 0);
      r.draw(this.apse, _m, { texture: this.wallTex, tint: D });
      r.setFog(fog, near, far);
      this.candles.draw(r, { brightness: 1 });
      return;
    }
    r.draw(this.floor, IDENT, { texture: this.floorTex });
    r.draw(this.basin, IDENT, { texture: this.pierTex });
    r.drawInstanced(this.rockMesh, this.rubble, { texture: this.pierTex });
    r.draw(this.dais, IDENT, { texture: this.floorTex });
    r.draw(this.walls, IDENT, { texture: this.wallTex });
    r.drawInstanced(this.pierFull, this.pierInst, { texture: this.pierTex });
    r.drawInstanced(this.pierBroken, this.stumpInst, { texture: this.pierTex });
    r.drawInstanced(this.archMesh, this.archInst, { texture: this.pierTex });
    r.drawInstanced(this.ribMesh, this.ribInst, { texture: this.pierTex });
    r.draw(this.vault, IDENT, { texture: this.wallTex });
    r.drawInstanced(this.blockMesh, this.blocks, { texture: this.wallTex });
    r.drawInstanced(this.quad, this.bannerInst, { texture: this.bannerTex, twoSided: true, sway: 0.03 + k * 0.05, tint: [1.7, 1.7, 1.7] });
    // the apse: fog reaches less far into the end wall so the window keeps its shape
    r.setFog(fog, near, far * 1.5);
    mat4.trs(_m, 0, 0, WIN[2], 0, 0, 0);
    r.draw(this.apse, _m, { texture: this.wallTex });
    mat4.trs(_m, WIN[0], WIN[1], WIN[2] - 0.25, 0, 0, 0);
    r.draw(this.tracery, _m, { texture: this.pierTex });
    r.draw(this.glass, _m, { texture: this.glassTex, additive: true, unlit: true, tint: [gl, gl, gl] });
    r.setFog(fog, near, far);
    r.drawInstanced(this.lancetMesh, this.lancetInst, { texture: this.lancetTex, additive: true, unlit: true, tint: [lg, lg, lg] });
    r.drawInstanced(this.quad, this.shaftInst, { texture: this.shaftTex, additive: true, unlit: true, depthWrite: false, tint: [sb, sb, sb] });
    r.draw(this.knight, this.knightM, { texture: this.armorTex });
    r.draw(this.cape.mesh, this.knightM, { texture: this.capeTex, twoSided: true });
    this.candles.draw(r, { brightness: 1 });
    this.fire.draw(r, { brightness: lerp(0.85, 1.05, k) });
  }

  dispose(r) {
    this.sky.dispose(r); this.ripples.dispose(r); this.basin.dispose(); this.water.dispose(); r.deleteTexture(this.waterTex); this.fire.dispose(r); this.candles.dispose(r); this.bolt.dispose(); this.cape.dispose();
    this.crows.dispose?.(r); this.ash.dispose(r); this.motes.dispose(r);
    [this.quad, this.cquad, this.floor, this.dais, this.pierFull, this.pierBroken, this.archMesh, this.ribMesh, this.vault, this.walls,
      this.lancetMesh, this.apse, this.tracery, this.glass, this.rockMesh, this.blockMesh, this.knight, this.crag, this.keepMesh].forEach((m) => m.dispose());
    [this.floorTex, this.wallTex, this.pierTex, this.armorTex, this.capeTex, this.glassTex, this.lancetTex, this.rockTex, this.bannerTex,
      this.colossusTex, this.coronaTex, this.moonTex, this.discTex, this.glowTex, this.coldGlowTex, this.shaftTex].forEach((tx) => r.deleteTexture(tx));
    [this.pierInst, this.stumpInst, this.archInst, this.ribInst, this.lancetInst, this.shaftInst, this.rubble, this.blocks, this.bannerInst,
      this.winInst, this.colossusEyes].forEach((i) => i.dispose());
  }
}
