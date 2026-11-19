// DREAM JOURNAL — a surreal dream-diary world (original). Floating fragments
// of rooms (a doorway, half a staircase, a table and lamp, a bedroom corner)
// and giant everyday objects (a chair, a teacup, an alarm clock) drift over an
// endless checkerboard void in a soft lavender haze.
//
//   floating islands, one segment each        deterministic per segment index (endless drift)
//   room fragments built from parts           K.Frame + K.atlasUV (one atlas texture, one draw each)
//   a room flips to its "other" wallpaper     draw { texture2, blend } dither-crossfade on beats
//   rooms breathe, turn and tilt              mat4.trs per island, driven by the swell + bass
//   checker floor ripples away from you       K.History indexed by distance (dynamic grid mesh)
//   extra fragments drift in from the fog     instanced + tilt (rotX/rotZ), world-anchored, fade
//   tiny floating symbols + sparkle on highs  billboard spin via rotZ, additive, fog: false + fade
//
// Intensity: idle = still, slow drift, quiet colours, only gentle bobbing.
// Playing = reality warps: objects breathe in scale, rooms rotate and tilt,
// the floor ripples with the bass, fragments drift in from beyond the fog,
// a room flips to its alternate texture on each beat.
import { mat4, lerp, damp, clamp, smoothstep } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { merge, box, disc } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const SEG = 22;            // metres of drift per island
const AHEAD = 6, BEHIND = 1;
const FLOOR = -7;          // checker void height
const TYPES = 7;           // doorway, stairs, table, corner, giant chair, teacup, clock
const GIANT = [false, false, false, false, true, true, true];

// floor grid
const CELL = 4, N = 36, PERIOD = 8; // checker period 8 m (two 4 m squares)

// atlas quadrants (128x128 atlas, four 64x64 materials)
const WALL = [0, 0, 0.5, 0.5], WOOD = [0.5, 0, 1, 0.5], TILE = [0, 0.5, 0.5, 1], GLOW = [0.5, 0.5, 1, 1];

// debris drifting in on the swell
const DEBRIS_PER = 7, DEBRIS_KINDS = 4;
const SYM_PER = 10, SYM_KINDS = 4;

const pathX = (s) => Math.sin(s * 0.013) * 9 + Math.sin(s * 0.037 + 1) * 3;

/** Box with its pivot at the base centre, UVs squeezed into an atlas rect. */
const B = (w, h, d, rect) => K.atlasUV(K.props.shift(box(w, h, d), 0, h / 2, 0), rect);
const P = (sides, rad, h, rect, o = {}) => K.atlasUV(K.props.prism(sides, rad, h, o), rect);

// ---------------------------------------------------------------- textures
function atlas(alt) {
  return K.makeIndexed(128, 128, (x, y) => {
    const q = (x >> 6) + (y >> 6) * 2, lx = x & 63, ly = y & 63;
    const g = K.rnd(x, y, 5);
    if (q === 0) { // wallpaper
      if (!alt) {
        // pastel stripes with tiny accent flowers
        const fx = lx % 16, fy = (ly + ((lx >> 4) & 1) * 8) % 16;
        if ((fx === 7 || fx === 8) && (fy === 7 || fy === 8)) return R(2, 3);
        if ((fx === 7 && (fy === 6 || fy === 9)) || (fy === 7 && (fx === 6 || fx === 9))) return R(2, 2);
        const band = (lx >> 3) & 1;
        return K.dshade(0, (band ? 2.6 : 2.0) + (g - 0.5) * 0.5, x, y);
      }
      // the other side of the dream: watching eyes on secondary
      const cx = (lx % 16) - 7.5, cy = (ly % 16) - 7.5, rr = cx * cx / 1.6 + cy * cy;
      if (rr < 3) return R(0, 0);
      if (rr < 9) return R(2, 3);
      if (rr < 16) return R(1, 3);
      return K.dshade(1, 1.2 + K.blobNoise(x, y, 12, 2) * 0.8, x, y);
    }
    if (q === 1) { // wood planks
      if (!alt) {
        const w = 16, i = Math.floor(lx / w), plx = lx % w;
        if (plx === 0) return R(1, 0);
        const grainy = Math.sin((ly + K.rnd(i, 0, 3) * 40) * 0.35 + plx * 0.2) * 0.3;
        return K.dshade(1, 1.6 + grainy + (g - 0.5) * 0.4, x, y);
      }
      // diagonal candy stripes
      return ((lx + ly) >> 3) & 1 ? K.dshade(2, 2.2 + (g - 0.5) * 0.4, x, y) : K.dshade(0, 2.8, x, y);
    }
    if (q === 2) { // floor tiles / carpet
      if (!alt) {
        const c = ((lx >> 3) + (ly >> 3)) & 1;
        return c ? K.dshade(0, 1.4 + (g - 0.5) * 0.4, x, y) : K.dshade(1, 2.4 + (g - 0.5) * 0.4, x, y);
      }
      // swirl rings
      const d = Math.hypot(lx - 31.5, ly - 31.5);
      return ((d >> 2) & 1) ? R(2, 2) : K.dshade(3, 2.5, x, y);
    }
    // glow material (lampshade, window pane, clock face, tea)
    if (!alt) return K.dshade(2, 2.4 + K.blobNoise(x, y, 10, 4) * 0.6 - 0.2, x, y);
    return K.dshade(3, 3 - K.blobNoise(x, y, 8, 7) * 0.8, x, y);
  });
}

function checkerFloor() {
  return K.makeIndexed(64, 64, (x, y) => {
    const c = ((x >> 5) + (y >> 5)) & 1;
    const n = (K.rnd(x, y, 3) - 0.5) * 0.35;
    if (c) return K.dshade(0, 2.7 + n, x, y);
    return K.dshade(1, 0.9 + n, x, y);
  });
}

function shadowTex() {
  return K.makeIndexed(32, 32, (x, y) => {
    const d = Math.hypot(x - 15.5, y - 15.5) / 16;
    if (d > 1) return K.CLEAR;
    return K.ditherPick(R(1, 0), K.CLEAR, smoothstep((d - 0.45) / 0.55), x, y);
  });
}

/** Tiny 16x16 floating symbols: note, question mark, 4-point star, crescent. */
const GLYPHS = [
  ['......##........', '......####......', '......#..##.....', '......#...#.....', '......#.........', '......#.........', '......#.........', '......#.........', '..#####.........', '.######.........', '.######.........', '..####..........'],
  ['....######......', '...##....##.....', '..........##....', '..........##....', '.........##.....', '.......##.......', '......##........', '......##........', '................', '......##........', '......##........', '................'],
  ['.......#........', '.......#........', '......###.......', '......###.......', '.....#####......', '############....', '.....#####......', '......###.......', '......###.......', '.......#........', '.......#........', '................'],
  ['.....####.......', '...###...........', '..###...........', '.###............', '.###............', '.###............', '.###............', '.###............', '..###...........', '...###..........', '.....####.......', '................'],
];
function glyphTex(rows) {
  return K.makeIndexed(16, 16, (x, y) => {
    const row = rows[y - 2];
    if (!row || row[x] !== '#') {
      // 1px halo for readability
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = rows[y - 2 + dy]; if (rr && rr[x + dx] === '#') return R(2, 1); }
      return K.CLEAR;
    }
    return R(2, 3);
  });
}

// ---------------------------------------------------------------- fragments
function slab(parts, f, w, d) {
  f.add(parts, B(w, 0.5, d, TILE), { pos: [0, -0.5, 0] });
  // a rough chunk of "earth" hangs under the floating floor
  f.add(parts, P(6, Math.min(w, d) * 0.48, 2.6, WOOD, { taper: 0.15 }), { pos: [0, -0.5, 0], rot: [Math.PI, 0.3, 0] });
}

function buildFragment(type) {
  const parts = [], f = new K.Frame();
  const glows = []; // local glow points [x, y, z, size]
  if (type === 0) { // doorway standing alone
    slab(parts, f, 6, 5);
    const wz = -1.4;
    f.add(parts, B(1.8, 4, 0.3, WALL), { pos: [-1.65, 0, wz] });
    f.add(parts, B(1.8, 4, 0.3, WALL), { pos: [1.65, 0, wz] });
    f.add(parts, B(1.5, 1.2, 0.3, WALL), { pos: [0, 2.8, wz] });
    for (const sx of [-0.78, 0.78]) f.add(parts, B(0.12, 2.9, 0.4, WOOD), { pos: [sx, 0, wz] });
    f.add(parts, B(1.7, 0.14, 0.4, WOOD), { pos: [0, 2.8, wz] });
    // door left ajar, hinged at the left jamb
    const door = f.child([-0.72, 0, wz + 0.2], { ry: -1.0 });
    door.add(parts, B(1.42, 2.75, 0.08, WOOD), { pos: [0.71, 0, 0] });
    door.add(parts, B(0.1, 0.1, 0.14, GLOW), { pos: [1.25, 1.3, 0] });
    f.add(parts, B(1.3, 0.04, 0.7, GLOW), { pos: [0, 0, wz + 0.9] }); // doormat
    glows.push([0, 1.4, wz - 0.3, 2.2]); // light spilling through the doorway
  } else if (type === 1) { // half a staircase, up to nowhere
    slab(parts, f, 4.5, 4.5);
    const st = K.atlasUV(K.props.stairs(9, 1.6, 0.5, 0.36), WOOD);
    f.add(parts, st, { pos: [0, 0, 1.8] });
    for (let i = 0; i < 9; i += 2) f.add(parts, P(4, 0.05, 0.9, WOOD), { pos: [0.85, 0.36 * (i + 1), 1.8 - i * 0.5] });
    // a second flight hangs in the air, turned sideways, also leading nowhere
    const up = f.child([0.5, 4.6, -3.4], { ry: Math.PI / 2, rz: 0.12 });
    up.add(parts, K.atlasUV(K.props.stairs(6, 1.4, 0.5, 0.34), WOOD), { pos: [0, 0, 0] });
    up.add(parts, B(1.6, 0.25, 1.6, TILE), { pos: [0, -0.25, 1.0] });
  } else if (type === 2) { // table and lamp
    slab(parts, f, 5, 5);
    f.add(parts, B(3, 0.02, 2.2, WALL), { pos: [0, 0, 0] }); // rug
    f.add(parts, B(2, 0.12, 1.2, WOOD), { pos: [0, 1.0, 0] });
    for (const [x, z] of [[-0.85, -0.5], [0.85, -0.5], [-0.85, 0.5], [0.85, 0.5]]) f.add(parts, B(0.12, 1.0, 0.12, WOOD), { pos: [x, 0, z] });
    // lamp
    f.add(parts, P(6, 0.2, 0.08, WOOD), { pos: [0.5, 1.12, -0.15] });
    f.add(parts, P(4, 0.04, 0.7, WOOD), { pos: [0.5, 1.2, -0.15] });
    f.add(parts, P(6, 0.38, 0.42, GLOW, { taper: 0.5, cap: false }), { pos: [0.5, 1.72, -0.15] });
    glows.push([0.5, 1.9, -0.15, 2.6]);
    // a book and a cup on the table
    f.add(parts, B(0.5, 0.1, 0.36, WALL), { pos: [-0.4, 1.12, 0.15], rot: [0, 0.4, 0] });
    f.add(parts, P(6, 0.1, 0.18, GLOW), { pos: [-0.1, 1.12, -0.3] });
    // chair pulled out
    const ch = f.child([-0.3, 0, 1.2], { ry: 0.5 });
    ch.add(parts, B(0.7, 0.08, 0.7, WOOD), { pos: [0, 0.55, 0] });
    for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) ch.add(parts, B(0.07, 0.55, 0.07, WOOD), { pos: [x, 0, z] });
    ch.add(parts, B(0.7, 0.8, 0.07, WOOD), { pos: [0, 0.6, 0.32] });
  } else if (type === 3) { // bedroom corner
    slab(parts, f, 6, 6);
    f.add(parts, B(6, 3.6, 0.3, WALL), { pos: [0, 0, -2.85] });
    f.add(parts, B(0.3, 3.6, 5.4, WALL), { pos: [-2.85, 0, 0.3] });
    // window on the back wall
    f.add(parts, B(1.6, 1.3, 0.06, GLOW), { pos: [0.8, 1.4, -2.68] });
    for (const [w, h, x, y] of [[1.8, 0.12, 0.8, 1.32], [1.8, 0.12, 0.8, 2.7], [0.12, 1.5, -0.04, 1.32], [0.12, 1.5, 1.64, 1.32], [0.08, 1.4, 0.8, 1.35]]) f.add(parts, B(w, h, 0.14, WOOD), { pos: [x, y, -2.64] });
    glows.push([0.8, 2.05, -2.4, 2.4]);
    // picture frame on the side wall
    f.add(parts, B(0.08, 1.0, 1.3, WOOD), { pos: [-2.66, 1.6, 0.5] });
    f.add(parts, B(0.04, 0.8, 1.1, TILE), { pos: [-2.61, 1.7, 0.5] });
    // bed with pillow and blanket
    f.add(parts, B(1.6, 0.5, 2.6, WOOD), { pos: [-1.6, 0, -1.2] });
    f.add(parts, B(1.5, 0.12, 2.0, WALL), { pos: [-1.6, 0.5, -0.9] });
    f.add(parts, B(1.0, 0.22, 0.5, TILE), { pos: [-1.6, 0.5, -2.2] });
    f.add(parts, B(1.6, 1.1, 0.12, WOOD), { pos: [-1.6, 0, -2.55] });
  } else if (type === 4) { // giant chair standing on the void
    const s = 1;
    f.add(parts, B(5, 0.6, 5, WOOD), { pos: [0, 5 * s, 0] });
    for (const [x, z] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) f.add(parts, B(0.55, 5, 0.55, WOOD), { pos: [x, 0, z] });
    f.add(parts, B(5, 6, 0.55, WOOD), { pos: [0, 5.6, -2.2] });
    for (const x of [-1.4, 0, 1.4]) f.add(parts, B(0.5, 4.6, 0.3, WALL), { pos: [x, 6.2, -2.0] }); // slats
    f.add(parts, B(4.4, 0.5, 4.4, TILE), { pos: [0, 5.6, 0.2] }); // cushion
  } else if (type === 5) { // giant teacup on its saucer
    f.add(parts, P(14, 6.2, 0.5, WALL, { taper: 1.1 }), { pos: [0, 0, 0] });
    f.add(parts, P(14, 3.2, 6.5, WALL, { taper: 1.35, cap: false }), { pos: [0, 0.5, 0] });
    f.add(parts, K.atlasUV(K.flatPoly(14, 3.2 * 1.3, { y: 0 }), GLOW), { pos: [0, 6.3, 0] }); // tea
    const h = f.child([4.0, 3.6, 0], {});
    h.add(parts, B(0.6, 0.6, 0.6, WALL), { pos: [0.3, 1.4, 0] });
    h.add(parts, B(0.6, 2.4, 0.6, WALL), { pos: [1.0, -1.0, 0] });
    h.add(parts, B(0.6, 0.6, 0.6, WALL), { pos: [0.3, -1.4, 0] });
    glows.push([0, 6.6, 0, 6]);
  } else { // giant alarm clock
    const face = f.child([0, 5.4, 0], { rx: Math.PI / 2 });
    face.add(parts, P(14, 4, 2.2, WALL, { cap: false }), { pos: [0, -1.1, 0] });
    f.add(parts, K.atlasUV(disc(14, 3.6), GLOW), { pos: [0, 5.4, 1.12] });
    f.add(parts, K.atlasUV(disc(14, 4), WALL), { pos: [0, 5.4, -1.11], rot: [0, Math.PI, 0] });
    // hands (stopped at a dream hour)
    f.add(parts, B(0.25, 2.6, 0.1, WOOD), { pos: [0, 5.4, 1.2], rot: [0, 0, 0.9] });
    f.add(parts, B(0.3, 1.8, 0.1, WOOD), { pos: [0, 5.4, 1.25], rot: [0, 0, -2.3] });
    // bells + legs
    for (const sx of [-1, 1]) {
      f.add(parts, P(8, 1.4, 1.1, GLOW, { taper: 0.4 }), { pos: [sx * 2.6, 8.7, 0], rot: [0, 0, -sx * 0.5] });
      f.add(parts, B(0.4, 1.8, 0.4, WOOD), { pos: [sx * 2.4, 0, 0], rot: [0, 0, sx * 0.45] });
    }
    f.add(parts, B(0.3, 1.2, 0.3, WOOD), { pos: [0, 9.2, 0] });
    glows.push([0, 5.4, 1.6, 5]);
  }
  return { geo: merge(parts), glows };
}

function buildDebris(kind) {
  const parts = [], f = new K.Frame();
  if (kind === 0) { // book
    f.add(parts, B(0.9, 0.25, 0.65, WOOD), { pos: [0, -0.12, 0] });
    f.add(parts, B(0.86, 0.18, 0.6, WALL), { pos: [0.03, -0.09, 0] });
  } else if (kind === 1) { // little chair
    f.add(parts, B(0.9, 0.1, 0.9, WOOD), { pos: [0, 0, 0] });
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) f.add(parts, B(0.08, 0.8, 0.08, WOOD), { pos: [x, -0.8, z] });
    f.add(parts, B(0.9, 1.0, 0.08, WOOD), { pos: [0, 0.1, -0.42] });
  } else if (kind === 2) { // a door with no wall
    f.add(parts, B(1.3, 2.6, 0.1, WOOD), { pos: [0, -1.3, 0] });
    f.add(parts, B(1.5, 0.15, 0.2, WALL), { pos: [0, 1.3, 0] });
    f.add(parts, B(0.1, 0.1, 0.18, GLOW), { pos: [0.5, -0.1, 0] });
  } else { // picture frame
    f.add(parts, B(1.4, 1.1, 0.1, WOOD), { pos: [0, -0.55, 0] });
    f.add(parts, B(1.15, 0.85, 0.06, GLOW), { pos: [0, -0.43, 0.04] });
  }
  return merge(parts);
}

// ---------------------------------------------------------------- style
export class DreamJournal {
  static meta = { name: 'Dream Journal' };
  static palette = fromKeys('dream-journal', 'Dream Journal', ['#f0b6c8', '#3f8f9a', '#ffcf3a', '#a597d6']);

  init(r) {
    this.atlas = r.texture(atlas(false));
    this.atlasAlt = r.texture(atlas(true));
    this.floorTex = r.texture(checkerFloor());
    this.shadowTex = r.texture(shadowTex());
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.symTex = GLYPHS.map((g) => r.texture(glyphTex(g)));

    this.frags = [];
    for (let t = 0; t < TYPES; t++) { const { geo, glows } = buildFragment(t); this.frags.push({ mesh: r.createMesh(geo), glows, tris: geo.count / 3 }); }
    this.debris = []; for (let k = 0; k < DEBRIS_KINDS; k++) this.debris.push({ mesh: r.createMesh(buildDebris(k)), inst: r.createInstances(DEBRIS_PER) });
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.symInst = this.symTex.map(() => r.createInstances(SYM_PER));
    this.glowInst = r.createInstances(64);
    this.shadowMesh = r.createMesh(K.flatPoly(10, 1));
    this.shadowInst = r.createInstances(16);

    // dynamic checker floor (rippling grid that follows the camera)
    const nv = N * N * 6;
    this.floorGeo = { positions: new Float32Array(nv * 3), normals: new Float32Array(nv * 3), uvs: new Float32Array(nv * 2), colors: new Float32Array(nv * 3).fill(1), count: nv };
    this.floorMesh = r.createMesh(this.floorGeo, true);
    this.hgrid = new Float32Array((N + 1) * (N + 1));
    this.ripple = new K.History(90);

    this.sky = new K.Sky(r, { stars: 70, clouds: 6, starIndex: R(2, 3) });
    this.sparkle = new K.Particles(r, 'dust', { color: R(2, 3), area: [26, 12, 26] });

    this.time = 0; this.k = 0; this.a = null;
    this.warp = 0; this.spin = 0; this.breath = 0; this.hs = 0;
    this.flip = new Float32Array(16); this.flipTarget = new Float32Array(16); this.flipNext = 0;
    this.beatEnv = new K.Envelope(0.35);
    this.cam = new K.PathRig((s, out) => { out[0] = pathX(s); out[1] = 3 + Math.sin(s * 0.045) * 1.2; out[2] = -s; },
      { lookAhead: 10, idleSpeed: 1.3, activeSpeed: 4.2, bassBoost: 2.5, fov: 62, nudge: 0.3, rollKick: 0.05, rollFn: () => Math.sin(this.time * 0.21) * (0.04 + this.warp * 0.14) });
    this.cam.s = 0;

    this.m = mat4.create();
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], sky: [0, 0, 0] };
  }

  /** Deterministic island for segment i. */
  island(i) {
    const t0 = Math.floor(K.rand2(i, 7, 3) * TYPES), tp = Math.floor(K.rand2(i - 1, 7, 3) * TYPES);
    const type = t0 === tp ? (t0 + 1) % TYPES : t0;
    const s = i * SEG + 14, side = (i & 1) ? 1 : -1, giant = GIANT[type];
    const x = pathX(s) + side * ((giant ? 14 : 9.5) + K.rand2(i, 2, 5) * 5);
    const y = giant ? FLOOR : -0.5 + K.rand2(i, 3, 5) * 3.5;
    return { i, type, s, x, y, z: -s, yaw: -side * (0.5 + K.rand2(i, 4, 5) * 0.7), dir: K.rand2(i, 5, 5) < 0.5 ? -1 : 1, ph: K.rand2(i, 6, 5) * 6.28, giant };
  }

  floorH(x, z, ex, ez) {
    const d = Math.hypot(x - ex, z - ez);
    const idle = Math.sin(x * 0.11 + this.time * 0.25) * Math.sin(z * 0.09 - this.time * 0.2) * 0.12;
    const wave = this.warp * Math.sin(d * 0.28 - this.time * 1.6) * (0.25 + this.breath * 0.6);
    return FLOOR + idle + wave + this.ripple.at(d / 72) * 2.2;
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k);
    this.warp = damp(this.warp, K.stage(k, 0.08, 0.85), 0.6, dt);
    this.breath = damp(this.breath, d.bass, 0.18, dt);
    this.hs = damp(this.hs, d.high, 0.2, dt);
    this.spin += dt * 0.14 * this.warp;
    if (d.beat) this.beatEnv.trigger(k);
    this.beatEnv.update(dt);
    this.ripple.push(this.breath * 0.55 + this.beatEnv.v * 0.5);
    this.cam.update(a, k, dt);

    // beat: flip the next island ahead to its alternate wallpaper (and back next time)
    const cs = this.cam.s;
    if (d.beat) {
      const first = Math.floor((cs + 8) / SEG), cands = [];
      for (let i = first; i < first + 4; i++) if (this.island(i).s - cs < 70) cands.push(i);
      if (cands.length) { const i = cands[this.flipNext++ % cands.length]; this.flipTarget[i & 15] = 1 - this.flipTarget[i & 15]; }
    }
    const on = K.stage(k, 0.05, 0.35);
    for (let j = 0; j < 16; j++) this.flip[j] = damp(this.flip[j], this.flipTarget[j] * on, 0.09, dt);

    this._floor();
    this._debris(dt);
    const eye = this.cam.eye;
    this.sparkle.update(dt, eye, { amount: 0.08 + this.hs * 0.9, speed: 0.6 + d.level });
  }

  _floor() {
    const e = this.cam.eye, g = this.floorGeo, H = this.hgrid;
    const ox = Math.floor(e[0] / PERIOD) * PERIOD - (N / 2) * CELL, oz = Math.floor(e[2] / PERIOD) * PERIOD - (N / 2) * CELL;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[j * (N + 1) + i] = this.floorH(ox + i * CELL, oz + j * CELL, e[0], e[2]);
    const pos = g.positions, nrm = g.normals, uv = g.uvs;
    let v = 0;
    const put = (i, j) => {
      const x = ox + i * CELL, z = oz + j * CELL, h = H[j * (N + 1) + i];
      const hx = H[j * (N + 1) + Math.min(N, i + 1)] - H[j * (N + 1) + Math.max(0, i - 1)];
      const hz = H[Math.min(N, j + 1) * (N + 1) + i] - H[Math.max(0, j - 1) * (N + 1) + i];
      const nx = -hx / (2 * CELL), nz = -hz / (2 * CELL), l = Math.hypot(nx, 1, nz);
      pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
      nrm[v * 3] = nx / l; nrm[v * 3 + 1] = 1 / l; nrm[v * 3 + 2] = nz / l;
      uv[v * 2] = x / PERIOD; uv[v * 2 + 1] = z / PERIOD;
      v++;
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      put(i, j); put(i, j + 1); put(i + 1, j + 1);
      put(i, j); put(i + 1, j + 1); put(i + 1, j);
    }
  }

  /** Fragments that drift in from beyond the fog as the swell builds (world-anchored, wrap behind the camera). */
  _debris() {
    const cs = this.cam.s, e = this.cam.eye, t = this.time, k = this.k;
    for (let kind = 0; kind < DEBRIS_KINDS; kind++) {
      const { inst } = this.debris[kind];
      for (let n = 0; n < DEBRIS_PER; n++) {
        const id = kind * DEBRIS_PER + n, r1 = K.rand2(id, 1, 9), r2 = K.rand2(id, 2, 9), r3 = K.rand2(id, 3, 9);
        const from = 0.12 + K.rand2(id, 4, 9) * 0.6, p = K.stage(k, from, from + 0.25);
        const ahead = K.repeat(r1 * 120 - cs * 0.85, 120) - 25; // drifts slower than the camera
        const ss = cs + ahead, side = r2 < 0.5 ? -1 : 1;
        const x = pathX(ss) + side * lerp(110, 5 + r3 * 16, p);
        const y = e[1] + (K.rand2(id, 5, 9) - 0.45) * 9 + Math.sin(t * 0.5 + id) * 0.6;
        const sc = (1.2 + r3 * 1.4) * (1 + this.breath * 0.25);
        inst.set(n, x, y, -ss, sc, t * 0.15 * (r1 - 0.5) + id, 0.85 + r2 * 0.3, 0, 1, t * 0.23 * (r2 - 0.5) * 2 + id, t * 0.19 * (r3 - 0.5) * 2);
      }
      inst.upload(DEBRIS_PER);
    }
    // floating symbols: appear with the highs, rise and fade at both ends of their loop
    const hs = this.hs;
    for (let kind = 0; kind < SYM_KINDS; kind++) {
      const inst = this.symInst[kind];
      for (let n = 0; n < SYM_PER; n++) {
        const id = kind * SYM_PER + n, r1 = K.rand2(id, 1, 13), r2 = K.rand2(id, 2, 13);
        const ahead = K.repeat(r1 * 45 - cs, 45) + 3, ss = cs + ahead;
        const ph = K.repeat(t * (0.06 + r2 * 0.05) + r1, 1);
        const life = Math.sin(ph * Math.PI);
        const want = clamp(hs * 2.2 - (n / SYM_PER) * 0.9) * life * K.fadeIn(ahead, 3, 9);
        inst.set(n, pathX(ss) + (r2 < 0.5 ? -1 : 1) * (3 + K.rand2(id, 3, 13) * 8), e[1] - 4 + ph * 9, -ss, 0.55 + r2 * 0.4, 0, want, 0, 1, 0, Math.sin(t * (0.7 + r1) + id) * 0.6);
      }
      inst.upload(SYM_PER);
    }
  }

  render(r) {
    const { col, k, m } = this, Pl = this.pal, a = this.a, d = K.drive(a, k), eye = this.cam.eye, t = this.time;
    const dim = lerp(0.72, 1, k);
    scaleColor(col.fog, Pl.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    this.sky.draw(r, eye, { horizon: col.fog, zenith: Pl.color(R(3, 0)), brightness: dim, starLevel: 0.15 + this.hs * 0.9, cloudDrift: t * 0.006 });

    const far = lerp(60, 75, k);
    r.setFog(col.fog, 10, far);
    r.setLight([-0.35, -0.8, -0.45], scaleColor(col.light, Pl.role('light'), lerp(0.5, 0.85, k)), scaleColor(col.amb, Pl.role('ambient'), lerp(0.5, 0.55, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    // checker void
    this.floorMesh.update(this.floorGeo);
    r.draw(this.floorMesh, mat4.identity(m), { texture: this.floorTex, tint: col.tint });

    // islands
    const cs = this.cam.s, first = Math.floor((cs - BEHIND * SEG) / SEG);
    let ng = 0, ns = 0;
    const warp = this.warp, br = this.breath;
    for (let i = first; i <= first + AHEAD + BEHIND; i++) {
      if (i < 0) continue;
      const isl = this.island(i), fr = this.frags[isl.type];
      const dz = isl.s - cs;
      if (dz < -SEG || dz > 115) continue;
      const g = isl.giant;
      const sc = (1 + Math.sin(t * 1.1 + isl.ph) * warp * (g ? 0.06 : 0.04) + br * (g ? 0.14 : 0.08)) * (g ? 1 : 1);
      const bob = Math.sin(t * 0.35 + isl.ph) * (g ? 0.05 : 0.3 + warp * 0.7);
      const ry = isl.yaw + this.spin * isl.dir + Math.sin(t * 0.07 + isl.ph) * 0.05;
      const rx = warp * 0.1 * Math.sin(t * 0.31 + isl.ph), rz = warp * 0.1 * Math.sin(t * 0.27 + isl.ph * 1.3);
      // giants breathe vertically (squash and stretch) and stay planted
      mat4.trs(m, isl.x, isl.y + (g ? 0 : bob), isl.z, g ? rx * 0.3 : rx, ry, g ? rz * 0.3 : rz, sc, g ? sc * (1 + Math.sin(t * 0.9 + isl.ph) * warp * 0.05) : sc, sc);
      r.draw(fr.mesh, m, { texture: this.atlas, texture2: this.atlasAlt, blend: this.flip[i & 15], tint: col.tint, fade: [far - 12, far + 25] });
      for (const gp of fr.glows) {
        if (ng >= this.glowInst.max) break;
        const x = gp[0], y = gp[1], z = gp[2];
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        const b = (0.18 + 0.55 * K.stage(k, 0.1, 0.6)) * (1 + d.pulse * 0.5 + this.hs * 0.3) * (0.92 + 0.08 * Math.sin(t * 3 + i));
        this.glowInst.set(ng++, wx, wy - gp[3] * 0.5, wz, gp[3] * sc, 0, b, 0, 1);
      }
      // a soft shadow on the checker floor below each floating fragment
      if (!g && ns < this.shadowInst.max) {
        const fh = this.floorH(isl.x, isl.z, eye[0], eye[2]);
        const lift = isl.y + bob - FLOOR;
        this.shadowInst.set(ns++, isl.x, fh + 0.08, isl.z, clamp(3.6 - lift * 0.12, 1.5, 4) * sc, 0, 0.9, 0, 1);
      }
    }
    this.shadowInst.upload(ns); this.glowInst.upload(ng);
    r.drawInstanced(this.shadowMesh, this.shadowInst, { texture: this.shadowTex, tint: col.tint, depthWrite: false, fade: [far - 12, far + 20] });

    // fragments drifting in from beyond the fog
    for (const db of this.debris) r.drawInstanced(db.mesh, db.inst, { texture: this.atlas, texture2: this.atlasAlt, blend: this.flip[0] * 0.5, tint: col.tint, fade: [far - 15, far + 15] });

    // glows + symbols + sparkle (additive, shine through the haze, fade with distance)
    r.drawInstanced(this.quad, this.glowInst, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [far - 20, far + 15], tint: [1, 1, 1] });
    this.symInst.forEach((inst, j) => r.drawInstanced(this.quad, inst, { texture: this.symTex[j], billboard: 2, unlit: true, additive: true, fog: false, fade: [20, 45], tint: [1, 1, 1] }));
    this.sparkle.draw(r, { brightness: 0.5 + this.hs * 0.8 });
  }

  dispose(r) {
    this.sky.dispose(r); this.sparkle.dispose(r);
    this.frags.forEach((f) => f.mesh.dispose());
    this.debris.forEach((db) => { db.mesh.dispose(); db.inst.dispose(); });
    [this.quad, this.shadowMesh, this.floorMesh].forEach((mm) => mm.dispose());
    [this.glowInst, this.shadowInst, ...this.symInst].forEach((i) => i.dispose());
    [this.atlas, this.atlasAlt, this.floorTex, this.shadowTex, this.glowTex, ...this.symTex].forEach((tx) => r.deleteTexture(tx));
  }
}
