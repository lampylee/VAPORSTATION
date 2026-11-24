// GRAVEYARD HILL — a crooked hillside cemetery under a big moon.
//
//   crooked hill with a flat crest               K.Terrain + K.fbm
//   ruined chapel on the crest                   K.Frame + K.pointedArch + K.lancet (one merged mesh)
//   rows of leaning tombstones, crosses, obelisks props.tombstone + instance tilt (rotX / rotZ)
//   iron fence runs with see-through bars        props.panel + indexed texture with CLEAR holes
//   dead trees that creak with the bass          sprites.deadTree + drawInstanced sway
//   big moon + drifting clouds                   K.Sky { moonTexture: sprites.moon }
//   will-o'-wisps rising between the graves      glow billboards, draw { fog: false, fade }
//   bats flocking across the moon                negative heightScale wing flaps
//   low mist banks that roll and glow            additive cloud cards
//   camera orbits and glides around the hill     K.OrbitRig (radius breathes slowly)
//
// Intensity: idle = still, misty, faint moonlight, chapel windows dark.
// Swell = wisps rise between the graves one after another (spreading down the
// hill from the chapel), the chapel windows kindle, bats flock across the moon,
// the mist thickens and starts to glow. Beat = wisps flare + a lightning-ish
// double flicker of moon and sky + camera nudge. Bass = tree sway + mist roll.
// Highs = wisp sparkle.
import { mat4, lerp, damp, clamp, smoothstep } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, box, merge } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const SILENT = { level: 0, bass: 0, mid: 0, high: 0, beat: false, beatPulse: 0, beatCount: 0 };
const ORBIT = 31;            // mean camera orbit radius (kept clear of graves and trees)
const MOON_DIR = [0.35, 0.3, -1];
const WISPS = 40;
const BATS_PER_FLOCK = 12, FLOCKS = 3;
const MIST = 26, MIST_BOX = 70;

// ---------------------------------------------------------------- world shape
function hill(x, z) {
  const r = Math.hypot(x, z), g = Math.exp(-(r * r) / (40 * 40));
  const lumps = (K.fbm(x * 0.05, z * 0.05, { octaves: 3, seed: 5 }) - 0.5) * 5 * smoothstep(clamp((r - 7) / 10));
  const far = K.fbm(x * 0.013, z * 0.013, { octaves: 2, seed: 2 }) * 9 * (1 - g);
  return 17 * g + lumps + far - 3;
}

// ---------------------------------------------------------------- textures (indexed)
/** Dressed stone blocks with dark mortar, moss creeping up from the bottom. */
function chapelStone() {
  return K.makeIndexed(64, 64, (x, y) => {
    const row = y >> 4, bx = (x + (row & 1) * 16) & 31, by = y & 15;
    if (by === 0 || bx === 0) return R(0, 0);
    const blk = K.rnd((x + (row & 1) * 16) >> 5, row, 3);
    const moss = K.blobNoise(x, y, 9, 4) + y / 140;
    if (moss > 0.86) return K.dshade(1, 0.6 + (moss - 0.86) * 6, x, y);
    return K.dshade(0, 1.3 + blk * 0.9 - by / 40 + (K.rnd(x, y, 1) - 0.5) * 0.5, x, y);
  });
}
/** Weathered headstone: speckled stone, lichen blotches, an unreadable carved inscription. */
function graveStone() {
  return K.makeIndexed(32, 32, (x, y) => {
    const carved = y > 8 && y < 22 && (y % 4 === 1) && x > 7 && x < 25 && K.rnd(x >> 1, y, 2) > 0.3;
    if (carved) return R(0, 0);
    const lichen = K.blobNoise(x, y, 6, 8);
    if (lichen > 0.74) return K.dshade(1, 1 + (lichen - 0.74) * 5, x, y);
    return K.dshade(0, 1.6 + (K.blobNoise(x, y, 4, 2) - 0.5) * 1.2 + (K.rnd(x, y, 5) - 0.5) * 0.4, x, y);
  });
}
/** Dead grass over bare earth. `ghost` adds faint accent glints (the swell dither-crossfades to it). */
function groundTex(ghost) {
  return K.makeIndexed(64, 64, (x, y) => {
    const dirt = K.blobNoise(x, y, 11, 7);
    if (ghost && K.rnd(x, y, 13) > 0.93 && dirt < 0.6) return R(2, K.rnd(x, y, 14) > 0.7 ? 1 : 0);
    if (dirt > 0.62) return K.dshade(0, 0.4 + (dirt - 0.62) * 3 + K.rnd(x, y, 2) * 0.5, x, y);
    const blade = (x + Math.floor(K.rnd(x, 0, 9) * 64) + (y >> 1)) % 5 === 0;
    return K.dshade(1, (blade ? 1.9 : 1.1) + (K.blobNoise(x, y, 5, 3) - 0.5) * 1.1, x, y);
  });
}
/** Wrought-iron fence: spear-topped bars, two rails, thick posts at the edges. 32x32, CLEAR between bars. */
function ironBars() {
  return K.makeIndexed(32, 32, (x, y) => {
    const post = x < 2 || x > 29, bar = (x % 4) === 1, rail = y === 7 || y === 8 || y === 27 || y === 28;
    if (post && y > 0) return R(0, y < 3 ? 1 : 0);
    if (bar && y > 3) return R(0, y < 6 ? 1 : 0);
    if ((x % 4 === 0 || x % 4 === 2) && y === 3) return R(0, 1); // spear tip shoulders
    if (rail && x > 1 && x < 30) return R(0, 0);
    return K.CLEAR;
  });
}
/** Lancet window glass: leaded panes (CLEAR lead lines so the glow reads as tracery). */
function windowGlass() {
  return K.makeIndexed(16, 32, (x, y) => {
    if (x === 7 || x === 8 || y % 8 === 0) return K.CLEAR;
    return K.dshade(2, 2.6 - Math.abs(x - 7.5) / 5 - y / 40, x, y);
  });
}
/** Mist card: a flat, wide ellipse whose edge dissolves in an ordered dither (no hard sprite edges). 64x16. */
function mistTex() {
  return K.makeIndexed(64, 16, (x, y) => {
    const d = Math.hypot((x - 31.5) / 32, ((y - 9) / 7.5) * (y < 9 ? 1 : 1.6)) + (K.blobNoise(x, y, 6, 31) - 0.5) * 0.35;
    if (d > 0.25 + K.bayer(x, y) * 0.75) return K.CLEAR;
    return K.dshade(3, 2.8 - d * 1.6, x, y);
  });
}

// ---------------------------------------------------------------- geometry
const B = (w, h, d) => box(w, h, d, { uvRepeat: [Math.max(w, d) / 2, h / 2] });

/** The ruined chapel: nave arcades, broken gables, a roofless bell tower, fallen rafters. Returns { stone, glass }. */
function buildChapel(baseY) {
  const S = [], G = [], f = new K.Frame([0, baseY, 0]);
  f.add(S, B(7.6, 0.7, 11.6), { pos: [0, 0, 0] });                                       // plinth
  // side arcades: piers + pointed arches, one bay collapsed on each side
  const piers = [-4.6, -2.3, 0, 2.3, 4.6];
  for (const side of [-1, 1]) {
    const wall = f.child([side * 3.3, 0.35, 0], { ry: Math.PI / 2 });
    const hs = side < 0 ? [5.2, 4.7, 3.1, 4.9, 5.4] : [5.0, 2.4, 4.4, 5.1, 4.2];
    piers.forEach((z, i) => wall.add(S, B(0.85, hs[i], 0.8), { pos: [z, hs[i] / 2, 0] }));
    for (let b = 0; b < 4; b++) {
      const z = (piers[b] + piers[b + 1]) / 2;
      wall.add(S, B(1.5, 1.0, 0.55), { pos: [z, 0.5, 0] });                               // sill
      const broken = side < 0 ? b === 1 : b === 0;
      if (broken) { wall.add(S, B(0.9, 0.5, 0.6), { pos: [z + 0.3, 1.2, 0.5], rot: [0.2, 0.5, 0.3] }); continue; }
      wall.add(S, K.pointedArch(1.35, 2.4, { thick: 0.28, depth: 0.5, sharp: 1.35, segs: 4 }), { pos: [z, 1.0, 0] });
      wall.add(G, K.lancet(1.35, 0, 2.4, 1.35).geo, { pos: [z, 1.0, 0] });
    }
  }
  // west front: pointed doorway, flanking walls, broken stepped gable
  const front = f.child([0, 0.35, 5.5]);
  front.add(S, K.pointedArch(2.0, 2.8, { thick: 0.45, depth: 0.75, sharp: 1.3, segs: 5 }), { pos: [0, 0, 0] });
  front.add(S, B(1.85, 5.0, 0.75), { pos: [-2.4, 2.5, 0] });
  front.add(S, B(1.85, 4.4, 0.75), { pos: [2.4, 2.2, 0] });
  front.add(S, B(4.2, 0.9, 0.75), { pos: [-1.1, 5.3, 0] });
  front.add(S, B(2.6, 1.0, 0.75), { pos: [-1.3, 6.2, 0] });
  front.add(S, B(1.2, 1.1, 0.75), { pos: [-1.0, 7.2, 0], rot: [0, 0, 0.06] });
  // east end: tall lancet window, intact stepped gable with a stone cross
  const east = f.child([0, 0.35, -5.5]);
  east.add(S, B(2.6, 5.6, 0.75), { pos: [-2.3, 2.8, 0] });
  east.add(S, B(2.6, 5.6, 0.75), { pos: [2.3, 2.8, 0] });
  east.add(S, B(2.0, 1.4, 0.75), { pos: [0, 0.7, 0] });
  east.add(S, K.pointedArch(1.6, 2.7, { thick: 0.35, depth: 0.75, sharp: 1.35, segs: 5 }), { pos: [0, 1.4, 0] });
  east.add(G, K.lancet(1.6, 0, 2.7, 1.35).geo, { pos: [0, 1.4, 0.05] });
  east.add(S, B(7.2, 1.0, 0.75), { pos: [0, 6.1, 0] });
  east.add(S, B(4.6, 1.2, 0.75), { pos: [0, 7.2, 0] });
  east.add(S, B(2.0, 1.3, 0.75), { pos: [0, 8.4, 0] });
  east.add(S, B(0.28, 1.6, 0.28), { pos: [0, 9.8, 0] });
  east.add(S, B(1.1, 0.28, 0.28), { pos: [0, 10.1, 0] });
  // bell tower at the north-west corner: tall shaft, open belfry, one corner snapped off, half a cap
  const tower = f.child([-4.3, 0.35, 5.9]);
  tower.add(S, B(2.2, 8.6, 2.2), { pos: [0, 4.3, 0] });
  [[-0.85, -0.85, 2.3], [0.85, -0.85, 2.3], [-0.85, 0.85, 2.3], [0.85, 0.85, 1.0]].forEach(([x, z, h]) => tower.add(S, B(0.5, h, 0.5), { pos: [x, 8.6 + h / 2, z] }));
  tower.add(S, B(2.4, 0.35, 1.3), { pos: [0, 11.05, -0.55], rot: [0.05, 0, 0] });
  // rafters: a few still spanning, one fallen against the wall
  const raft = (x, z, rz) => f.add(S, B(3.9, 0.25, 0.25), { pos: [x, 6.6, z], rot: [0, 0, rz] });
  raft(-1.65, -4.6, 0.56); raft(1.65, -4.6, -0.56); raft(-1.65, -2.3, 0.56); raft(1.65, 0, -0.56);
  f.add(S, B(0.3, 0.3, 4.8), { pos: [0, 7.6, -2.6] });                                    // ridge beam fragment
  f.add(S, B(4.0, 0.25, 0.25), { pos: [2.0, 2.0, 2.6], rot: [0.1, 0.3, 1.0] });          // fallen rafter
  // rubble
  for (let i = 0; i < 9; i++) {
    const a = K.rand2(i, 1, 40) * Math.PI * 2, rr = 2 + K.rand2(i, 2, 40) * 4.5, s = 0.4 + K.rand2(i, 3, 40) * 0.5;
    f.add(S, B(s * 1.4, s * 0.7, s), { pos: [Math.cos(a) * rr, 0.5, Math.sin(a) * rr], rot: [K.rand2(i, 4, 40), a, K.rand2(i, 5, 40) * 0.6] });
  }
  return { stone: merge(S), glass: merge(G) };
}

/** Latin cross on a small plinth, pivot at the base. */
function crossGeo() {
  return merge([
    { geo: K.props.shift(B(0.4, 0.2, 0.3), 0, 0.1, 0) },
    { geo: K.props.shift(B(0.14, 1.35, 0.14), 0, 0.85, 0) },
    { geo: K.props.shift(B(0.75, 0.14, 0.14), 0, 1.15, 0) },
  ]);
}
/** Little obelisk: plinth + tapered four-sided shaft. */
function obeliskGeo() {
  return merge([
    { geo: K.props.shift(B(0.7, 0.35, 0.7), 0, 0.175, 0) },
    { geo: K.props.shift(K.props.rotY(K.props.prism(4, 0.32, 1.9, { taper: 0.45, uvRepeat: [2, 2] }), Math.PI / 4), 0, 0.35, 0) },
  ]);
}
/** Bat: body + two jagged wings with tips at y > 0, so a negative heightScale flaps them. */
function batGeo() {
  const g = new GeoBuilder(), z = [0, 0], up = [0, 1, 0];
  g.tri([0, 0, 0.25], [0, 0, -0.2], [-0.95, 0.3, -0.05], z, z, z, up);
  g.tri([0, 0, 0.25], [0.95, 0.3, -0.05], [0, 0, -0.2], z, z, z, up);
  g.tri([-0.95, 0.3, -0.05], [0, 0, -0.2], [-0.5, 0.12, -0.32], z, z, z, up);
  g.tri([0.95, 0.3, -0.05], [0.5, 0.12, -0.32], [0, 0, -0.2], z, z, z, up);
  return g.build();
}

export class GraveyardHill {
  static meta = { name: 'Graveyard Hill' };
  static palette = fromKeys('graveyard-hill', 'Graveyard Hill', ['#8c8a80', '#6e6a3c', '#86ffbe', '#16203e']);

  init(r) {
    // ---- ground + sky
    this.ground = new K.Terrain(r, { size: 150, cells: 40, height: hill, uvScale: 0.3 });
    this.groundTex = r.texture(groundTex(false));
    this.groundTex2 = r.texture(groundTex(true));
    this.sky = new K.Sky(r, { stars: 110, moon: true, moonDir: MOON_DIR, moonSize: 13, clouds: 8, moonTexture: K.sprites.moon({ ramp: 3 }) });
    const ml = Math.hypot(...MOON_DIR);
    this.moonDir = MOON_DIR.map((v) => v / ml);

    // ---- chapel
    const crest = hill(0, 0) - 0.3;
    const ch = buildChapel(crest);
    this.chapel = r.createMesh(ch.stone);
    this.glass = r.createMesh(ch.glass);
    this.stoneTex = r.texture(chapelStone());
    this.glassTex = r.texture(windowGlass());

    // ---- graves in rows on the hillside (static instances, uploaded once)
    this.graveTex = r.texture(graveStone());
    this.tombMesh = r.createMesh(K.props.tombstone(0.8, 1.15, 0.18));
    this.crossMesh = r.createMesh(crossGeo());
    this.obelMesh = r.createMesh(obeliskGeo());
    this.tombs = r.createInstances(110); this.crosses = r.createInstances(90); this.obels = r.createInstances(24);
    const slots = [], counts = [0, 0, 0], insts = [this.tombs, this.crosses, this.obels];
    const rows = [[8.5, 2.3], [11, 2.4], [13.5, 2.4], [16, 2.5], [18.5, 2.6], [43, 3], [46.5, 3.2], [50, 3.4]];
    rows.forEach(([rad, spacing], ri) => {
      const n = Math.floor((Math.PI * 2 * rad) / spacing), outer = rad > 30;
      for (let i = 0; i < n; i++) {
        const h = K.rand2(i, ri, 21);
        if (h < (outer ? 0.55 : 0.28)) continue;                            // gaps in the rows
        const a = ((i + (K.rand2(i, ri, 22) - 0.5) * 0.35) / n) * Math.PI * 2;
        const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
        if (z > 0 && Math.abs(x) < 1.8) continue;                           // path to the chapel door
        if (Math.abs(x) < 6 && Math.abs(z) < 7.5) continue;                 // chapel footprint
        const kind = h > 0.9 ? 2 : h > 0.62 ? 1 : 0, inst = insts[kind];
        if (counts[kind] >= inst.max) continue;
        const lean = K.rand2(i, ri, 23) > 0.82 ? 0.42 : 0.14;
        const rx = (K.rand2(i, ri, 24) - 0.5) * lean, rz = (K.rand2(i, ri, 25) - 0.5) * lean;
        const s = 0.85 + K.rand2(i, ri, 26) * 0.4;
        inst.set(counts[kind]++, x, hill(x, z) - 0.15, z, s, a + (K.rand2(i, ri, 27) - 0.5) * 0.4, 0.75 + K.rand2(i, ri, 28) * 0.35, 0, 1, rx, rz);
        slots.push([x, z, rad, a]);
      }
    });
    insts.forEach((inst, i) => inst.upload(counts[i]));

    // ---- iron fence: a ring inside the camera orbit (gate at the path) + broken outer runs
    this.fenceMesh = r.createMesh(K.props.panel(3, 1.5, { uvRepeat: [3 / 1.5, 1] }));
    this.fenceTex = r.texture(ironBars());
    this.fence = r.createInstances(80);
    let nf = 0;
    const ring = (rad, from, to, skip, seed) => {
      const n = Math.floor((Math.PI * 2 * rad) / 3);
      for (let i = 0; i < n && nf < this.fence.max; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
        if (am < from || am > to || K.rand2(i, seed, 30) < skip) continue;
        if (Math.abs(((am + Math.PI) % (Math.PI * 2)) - Math.PI) < 0.09) continue; // the gate
        const x0 = Math.sin(a0) * rad, z0 = Math.cos(a0) * rad, x1 = Math.sin(a1) * rad, z1 = Math.cos(a1) * rad;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, rz = (K.rand2(i, seed, 31) - 0.5) * 0.12, rx = (K.rand2(i, seed, 32) - 0.5) * 0.2;
        this.fence.set(nf++, mx, hill(mx, mz) - 0.25, mz, 1, Math.atan2(-(z1 - z0), x1 - x0), 0.9, 0, 1, rx, rz);
      }
    };
    ring(21.5, 0, Math.PI * 2, 0.12, 1);
    ring(40.5, 0.4, 3.6, 0.3, 2);
    ring(40.5, 4.4, 5.6, 0.3, 3);
    this.fence.upload(nf);

    // ---- dead trees among the graves and around the hill
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.treeTexA = r.texture(K.sprites.deadTree({ index: R(0, 0), seed: 3 }));
    this.treeTexB = r.texture(K.sprites.deadTree({ index: R(0, 0), seed: 8 }));
    this.treesA = r.createInstances(24); this.treesB = r.createInstances(24);
    let na = 0, nb = 0;
    for (let i = 0; i < 60 && (na < 24 || nb < 24); i++) {
      const a = K.rand2(i, 1, 50) * Math.PI * 2, rad = K.rand2(i, 2, 50) < 0.45 ? 10 + K.rand2(i, 3, 50) * 10 : 42 + K.rand2(i, 3, 50) * 24;
      const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
      if (Math.abs(x) < 7 && Math.abs(z) < 9) continue;
      const s = (rad < 25 ? 3.6 : 4.8) + K.rand2(i, 4, 50) * 3, A = i % 2 === 0;
      if (A && na < 24) this.treesA.set(na++, x, hill(x, z) - 0.3, z, s, 0, 0.8 + K.rand2(i, 5, 50) * 0.3, i * 1.7, 64 / 48);
      else if (!A && nb < 24) this.treesB.set(nb++, x, hill(x, z) - 0.3, z, s, 0, 0.8 + K.rand2(i, 5, 50) * 0.3, i * 1.7, 64 / 48);
    }
    this.treesA.upload(na); this.treesB.upload(nb);

    // ---- dead grass tufts around the camera
    this.grassTex = r.texture(K.sprites.grass({ ramp: 1 }));
    this.grass = r.createInstances(260);

    // ---- will-o'-wisps: one per gap between graves, rising in order from the chapel outwards
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    const inner = slots.filter((s) => s[2] < 20);
    this.wisps = [];
    for (let i = 0; i < WISPS && inner.length; i++) {
      const s = inner[Math.floor(K.rand2(i, 1, 60) * inner.length)];
      const a = s[3] + (K.rand2(i, 2, 60) - 0.5) * 0.12, rad = s[2] + 1.2;          // between two rows
      const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
      this.wisps.push({ x, z, y: hill(x, z), rad, ph: K.rand2(i, 3, 60), spd: 0.12 + K.rand2(i, 4, 60) * 0.1, seed: i });
    }
    this.wisps.sort((p, q) => p.rad + p.ph * 4 - (q.rad + q.ph * 4));
    this.wispInst = r.createInstances(WISPS * 2);
    this.sparkle = new K.Particles(r, 'fireflies', { count: 90, size: 0.12, area: [36, 8, 36], yOffset: -1.5 });

    // ---- bats, mist
    this.batMesh = r.createMesh(batGeo());
    this.bats = r.createInstances(FLOCKS * BATS_PER_FLOCK);
    this.mistTex = r.texture(mistTex());
    this.mist = r.createInstances(MIST);
    this.mistOff = Array.from({ length: MIST }, (_, i) => [K.rand2(i, 1, 70) * MIST_BOX, K.rand2(i, 2, 70) * MIST_BOX, 9 + K.rand2(i, 3, 70) * 9]);
    this.mistRoll = 0;

    // ---- camera: slow orbit around the chapel, radius breathing in and out
    this.cam = new K.OrbitRig({ center: [0, crest + 2.5, 0], radius: ORBIT, height: 0, bob: 0, pushIn: 2.5, idleSpeed: 0.035, activeSpeed: 0.1, bassBoost: 0.05, fov: 62, nudge: 0.3, rollKick: 0.04, far: 200, shapeAmount: 0.5 });   // half: full close / wide framing would cross the inner and outer tree rings
    this.cam.angle = 0.4;

    this.flash = new K.Envelope(0.12);
    this.flare = new K.Envelope(0.35);
    this.strike2 = -1; this.bassS = 0; this.highS = 0; this.bassM = 0; this.highM = 0;
    this.m = mat4.create();
    this.time = 0; this.k = 0; this.a = SILENT;
    this.col = { fog: [0, 0, 0], zen: [0, 0, 0], tint: [1, 1, 1], light: [0, 0, 0], amb: [0, 0, 0], mist: [0, 0, 0], glow: [0, 0, 0], bat: [0, 0, 0], glass: [0, 0, 0], tmp: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k), t = this.time, cam = this.cam;
    cam.radius = ORBIT + Math.sin(t * 0.045) * 4.5;
    cam.update(a, k, dt);
    const eye = cam.eye;
    eye[1] = hill(eye[0], eye[2]) + 6.5 + Math.sin(t * 0.13) * 1.2;   // glide over the crooked ground
    this.ground.follow(eye[0], eye[2]);

    // beat: wisps flare + a lightning-ish double flicker (second strike sometimes follows)
    if (d.beat) {
      this.flare.trigger(k); this.flash.trigger(k);
      if (Math.random() < 0.5) this.strike2 = 0.09;
    }
    if (this.strike2 > 0 && (this.strike2 -= dt) <= 0) { this.flash.trigger(k * 0.7); this.strike2 = -1; }
    this.flash.update(dt); this.flare.update(dt);

    // bass / highs shape motion directly only at Punchy; at Gentle they are eased
    this.bassS = damp(this.bassS, d.bass, 0.5, dt); this.highS = damp(this.highS, d.high, 0.5, dt);
    this.bassM = lerp(this.bassS, d.bass, d.beatMotion); this.highM = lerp(this.highS, d.high, d.beatMotion);
    this.mistRoll += dt * (0.5 + this.bassM * 4);   // integrated phase
    this.sparkle.update(dt, [eye[0], hill(eye[0], eye[2]), eye[2]], { amount: K.stage(k, 0.35, 0.9) * (0.4 + d.high * 0.9), speed: 1 + this.highM * 2 });
    this._wisps(d);
    this._bats();
    this._mist(d);
    this._grass();
  }

  _wisps(d) {
    const t = this.time, n = this.wisps.length, inst = this.wispInst;
    let c = 0;
    this.wisps.forEach((w, i) => {
      const on = K.stage(this.k, 0.08 + (i / n) * 0.62, 0.2 + (i / n) * 0.62);
      if (on <= 0.001) return;
      // each wisp rises in a slow loop; size and brightness are 0 at the wrap, so it never pops
      const u = (t * w.spd + w.ph) % 1, life = Math.sin(u * Math.PI);
      const sway = Math.sin(t * 0.9 + w.seed) * 0.5;
      const x = w.x + Math.cos(t * 0.6 + w.seed) * 0.6 + sway, z = w.z + Math.sin(t * 0.7 + w.seed * 2) * 0.6;
      const y = w.y + 0.4 + u * 3.2 * on;
      const spark = 1 + d.high * 0.8 * (0.5 + 0.5 * Math.sin(t * 23 + w.seed * 5));
      const s = 1.05 * on * (0.45 + 0.55 * life) * (1 + this.flare.v * 0.7 * d.beatMotion + d.groove * (1 - d.beatMotion) * 0.2);   // size swell: flare at Punchy, groove otherwise
      const b = on * life * (0.7 + this.flare.v * 0.6) * spark;
      inst.set(c++, x, y, z, s, 0, b, 0, 1);
      inst.set(c++, x - sway * 0.3, y - 0.45 * on, z, s * 0.55, 0, b * 0.55, 0, 1);   // trailing tail
    });
    inst.upload(c);
  }

  /** Flocks cross the moon's direction one after another as the band swells (always in the moon's part of the sky). */
  _bats() {
    const e = this.cam.eye, t = this.time, md = this.moonDir;
    let sx = -md[2], sz = md[0]; const sl = Math.hypot(sx, sz); sx /= sl; sz /= sl;   // across the moon
    const heading = Math.atan2(sx, sz);
    let n = 0;
    for (let f = 0; f < FLOCKS; f++) {
      const air = K.stage(this.k, 0.3 + f * 0.14, 0.5 + f * 0.14);
      if (air <= 0.001) continue;
      const u = (t * (0.03 + f * 0.007) + f * 0.37) % 1, env = Math.sqrt(Math.sin(u * Math.PI));
      const dir = f % 2 ? -1 : 1, lat = (u * 2 - 1) * 40 * dir, D = 52 + f * 6;
      const cx = e[0] + md[0] * D + sx * lat, cy = e[1] + md[1] * D + (f - 1) * 4 + Math.sin(u * 9) * 2, cz = e[2] + md[2] * D + sz * lat;
      for (let i = 0; i < BATS_PER_FLOCK; i++) {
        const th = t * (1.1 + K.rand2(i, f, 80) * 0.6) + i * 0.52, rr = 1.5 + K.rand2(i, f, 81) * 3.5;
        const x = cx + Math.cos(th) * rr * 0.6 * sx - Math.sin(th * 0.7) * rr * 0.4 * sz, y = cy + Math.sin(th) * rr * 0.5;
        const z = cz + Math.cos(th) * rr * 0.6 * sz + Math.sin(th * 0.7) * rr * 0.4 * sx;
        const flap = Math.sin(t * (15 + K.rand2(i, f, 82) * 6) + i * 1.9);
        this.bats.set(n++, x, y, z, 1.8 * air * env, dir > 0 ? heading : heading + Math.PI, 1, 0, flap, 0, Math.sin(th) * 0.3);
      }
    }
    this.bats.upload(n);
  }

  /** Low mist cards around the camera, rolling downhill with the bass. */
  _mist(d) {
    const e = this.cam.eye, half = MIST_BOX / 2;
    this.mistOff.forEach(([ox, oz, s], i) => {
      const rx = ox + this.mistRoll * (0.6 + (i % 3) * 0.2), rz = oz + this.mistRoll * 0.25;
      const x = e[0] + K.repeat(rx - e[0], MIST_BOX) - half, z = e[2] + K.repeat(rz - e[2], MIST_BOX) - half;
      const dist = Math.hypot(x - e[0], z - e[2]);
      const vis = K.fadeIn(dist, 5, 13) * K.fadeOut(dist, half - 12, half - 2);
      const y = hill(x, z) - 0.6 + Math.sin(this.time * 0.3 + i) * 0.3 + this.bassM * 0.6;
      this.mist.set(i, x, y, z, s * (1 + this.k * 0.25), 0, vis, i, 0.28);
    });
    this.mist.upload(MIST);
  }

  _grass() {
    const e = this.cam.eye, edge = 9 * 2.6;
    let n = 0;
    K.scatter(e[0], e[2], { cell: 2.6, radius: 9, seed: 11, jitter: 1 }, (x, z, dist, gx, gz) => {
      if (n >= this.grass.max || K.rand2(gx, gz, 12) > 0.55) return;
      const fade = K.fadeOut(dist, edge - 7, edge);
      if (fade <= 0) return;
      this.grass.set(n++, x, hill(x, z) - 0.05, z, (0.8 + K.rand2(gx, gz, 13) * 0.6) * fade, 0, 0.5 + K.rand2(gx, gz, 14) * 0.3, gx * 3.1, 0.7);
    });
    this.grass.upload(n);
  }

  render(r) {
    const { col, k } = this, P = this.pal, d = K.drive(this.a, k), eye = this.cam.eye, fl = this.flash.v;
    const dim = lerp(0.7, 1, k), mistGlow = K.stage(k, 0.25, 1);

    // fog: midnight blue, tinged by the ghost glow as the mist thickens, flickering with the lightning
    scaleColor(col.fog, P.role('fog'), dim);
    mixColor(col.fog, col.fog, P.role('glow'), mistGlow * 0.1);
    mixColor(col.fog, col.fog, P.role('flash'), fl * 0.22);
    r.clear(col.fog);
    this.cam.apply(r);

    scaleColor(col.zen, P.color(R(3, 0)), 1 + fl * 0.8);
    this.sky.draw(r, eye, { horizon: col.fog, zenith: col.zen, brightness: dim * (1 + fl * 0.6), starLevel: 0.3 + d.high * 0.5, moonScale: 1 + fl * 0.1 * d.beatMotion + lerp(d.groove, d.pulse, d.beatMotion) * 0.04, cloudDrift: this.time * 0.008 + this.mistRoll * 0.002 });

    r.setFog(col.fog, 12, lerp(74, 64, k));
    r.setLight([-0.35, -0.6, 1], scaleColor(col.light, P.role('light'), lerp(0.5, 0.75, k) + fl * 0.9), scaleColor(col.amb, P.role('ambient'), 0.42 + fl * 0.25));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    this.ground.draw(r, { texture: this.groundTex, texture2: this.groundTex2, blend: mistGlow * 0.6, tint: col.tint });
    r.draw(this.chapel, mat4.identity(this.m), { texture: this.stoneTex, tint: col.tint });
    r.drawInstanced(this.tombMesh, this.tombs, { texture: this.graveTex, tint: col.tint });
    r.drawInstanced(this.crossMesh, this.crosses, { texture: this.graveTex, tint: col.tint });
    r.drawInstanced(this.obelMesh, this.obels, { texture: this.graveTex, tint: col.tint });
    r.drawInstanced(this.fenceMesh, this.fence, { texture: this.fenceTex, tint: col.tint });
    const sway = 0.008 + this.bassM * 0.05;
    r.drawInstanced(this.quad, this.treesA, { texture: this.treeTexA, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.treesB, { texture: this.treeTexB, billboard: 1, sway: sway * 1.2, tint: col.tint });
    r.drawInstanced(this.quad, this.grass, { texture: this.grassTex, billboard: 1, sway: 0.03 + this.bassM * 0.08, tint: col.tint });

    // bats: dark silhouettes against the moonlit sky
    scaleColor(col.bat, P.color(R(0, 0)), 0.55);
    r.drawInstanced(this.batMesh, this.bats, { unlit: true, fog: false, tint: col.bat });

    // additive last: chapel windows kindle, mist glows, wisps shine through the fog
    const win = K.stage(k, 0.2, 0.75) * (0.75 + 0.25 * Math.sin(this.time * 3.1) * Math.sin(this.time * 1.7)) + this.flare.v * 0.3 * k;
    scaleColor(col.glass, P.role('glow'), win * 0.8);
    if (win > 0.002) r.draw(this.glass, this.m, { texture: this.glassTex, unlit: true, additive: true, fog: false, fade: [30, 70], tint: col.glass });
    mixColor(col.mist, P.color(R(3, 3)), P.role('glow'), mistGlow * 0.55);
    scaleColor(col.mist, col.mist, K.swell(k, 0.16, 0.3) + fl * 0.12);
    r.drawInstanced(this.quad, this.mist, { texture: this.mistTex, billboard: 1, unlit: true, additive: true, tint: col.mist });
    r.drawInstanced(this.quad, this.wispInst, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [30, 62], tint: [1, 1, 1] });
    this.sparkle.draw(r, { brightness: k });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.sparkle.dispose(r);
    [this.chapel, this.glass, this.tombMesh, this.crossMesh, this.obelMesh, this.fenceMesh, this.quad, this.batMesh].forEach((m) => m.dispose());
    [this.groundTex, this.groundTex2, this.stoneTex, this.glassTex, this.graveTex, this.fenceTex, this.treeTexA, this.treeTexB, this.grassTex, this.glowTex, this.mistTex].forEach((t) => r.deleteTexture(t));
    [this.tombs, this.crosses, this.obels, this.fence, this.treesA, this.treesB, this.grass, this.wispInst, this.bats, this.mist].forEach((i) => i.dispose());
  }
}
