// UNDER THE HULL — a small grey town seen from street level, and something
// enormous sliding over it. (For "Decks Dark"; an original, abstract shape:
// a vast ribbed slab with a few dim lights, not any real or fictional ship.)
//
//   town: houses + roofs merged (2 draws), church tower with spire, water tower
//   windows and street lamps                 instanced, lit as the hull's shadow edge passes over them
//   the hull                                 one merged mesh, drawn without fog but with a distance fade
//   a pulse along the keel                   K.Pulses over a strip of glow sprites (beats; rare slow idle pulses)
//   low mist on the street, soot motes        K.Particles mist / dust
//   slow drifting camera                     local DriftRig on K.CameraRig (near-zero kicks)
//
// Idle: overcast grey dusk, the hull far off as a long dark slab low over the
// rooftops, a couple of windows lit. Swell: the hull slides in overhead (its
// position follows a heavily smoothed, speed-limited intensity + energy drive,
// so it never jumps), the sky closes, the fog darkens under it, and windows and
// lamps come on street by street as its shadow edge passes. Beats: one faint
// pulse of light runs the length of the underside, front to back.
// Light (Kit v7): the street lamps are point lights (K.LightSet, best 4 near the view), so as the
// hull darkens the town, each lamp that comes on lights the street and house fronts round it.
import { mat4, lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, box, merge } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const TAU = Math.PI * 2;
const HULL_L = 300;          // hull length (z)
const HULL_W = 440;          // hull width (x): wider than the view, so it reads as a ceiling, not an object
const HULL_Y = 56;           // underside height
const HULL_FAR = -430;       // hull centre z at idle (low over the horizon)
const HULL_NEAR = -25;       // hull centre z when fully overhead
const N_KEEL = 40;           // glow sprites along the keel
const N_LAMPS = 16;
const STREET_HW = 4;         // street half-width

// ---------------------------------------------------------------- textures (indexed)

const clapboard = () => K.makeIndexed(64, 64, (x, y) => {
  if (y % 8 === 0) return R(0, 0);
  if (y % 8 === 1) return R(0, 1);
  const s = 1.55 + K.blobNoise(x, y, 9, 2) * 0.8 - (y > 52 ? 0.45 : 0) + (K.rnd(x, y, 3) - 0.5) * 0.3;
  return K.dshade(0, s, x, y);
});
const slate = () => K.makeIndexed(32, 32, (x, y) => {
  const row = Math.floor(y / 6), off = row % 2 ? 4 : 0;
  if (y % 6 === 0 || (x + off) % 8 === 0) return R(0, 0);
  return K.dshade(0, 0.55 + K.rnd((x + off) >> 3, row, 5) * 0.7 + (y % 6 === 5 ? -0.3 : 0), x, y);
});
const paving = () => K.makeIndexed(64, 64, (x, y) => {
  const crack = Math.abs(x - (30 + Math.sin(y * 0.18) * 7)) < 0.6 && y > 14 && y < 50;
  if (crack || (y % 32 === 0 && K.rnd(x >> 3, y, 4) > 0.3)) return R(0, 0);
  return K.dshade(0, 0.75 + K.blobNoise(x, y, 7, 6) * 0.7 + (K.rnd(x, y, 7) > 0.93 ? 0.6 : 0), x, y);
});
// near-black plates (dark atmosphere + dark base), so the hull is a silhouette in any palette
const hullPlate = () => K.makeIndexed(64, 64, (x, y) => {
  if (x % 16 === 0 || y % 21 === 0) return R(3, 0);
  if ((x % 16 === 2 || x % 16 === 14) && y % 4 === 2) return R(0, 1);      // rivet rows
  const v = K.blobNoise(x, y, 11, 8) * 0.7 + K.rnd(x >> 4, Math.floor(y / 21), 9) * 0.3;
  return K.ditherPick(R(3, 0), R(0, 0), v * 0.9, x, y);
});
const windowPane = () => K.makeIndexed(10, 12, (x, y) => {
  if (x === 0 || x === 9 || y === 0 || y === 11 || x === 4 || x === 5 || y === 5) return R(0, 0);
  return K.dshade(2, 2.7 - y * 0.12 - (x > 5 ? 0.3 : 0), x, y);
});

// ---------------------------------------------------------------- geometry helpers

const moved = (geo, x, y, z, ry = 0) => {
  const c = Math.cos(ry), s = Math.sin(ry);
  return { geo, xf: (p) => [x + c * p[0] + s * p[2], y + p[1], z - s * p[0] + c * p[2]] };
};
const wallBox = (w, h, d) => K.props.shift(box(w, h, d, { uvRepeat: [Math.max(w, d) / 4, h / 4] }), 0, h / 2, 0);

/** Gabled roof over a w x d footprint at wall height h (ridge along x). Returns [roofGeo, gableGeo]. */
function gable(w, d, h, rise, over = 0.35) {
  const roof = new GeoBuilder(), gab = new GeoBuilder();
  const x0 = -w / 2 - over, x1 = w / 2 + over, ze = d / 2 + over, yt = h + rise, ye = h - over * rise / (d / 2);
  const len = Math.hypot(ze, yt - ye) / 3, uw = (x1 - x0) / 3;
  roof.quad([x0, ye, ze], [x1, ye, ze], [x1, yt, 0], [x0, yt, 0], [0, len], [uw, len], [uw, 0], [0, 0]);
  roof.quad([x1, ye, -ze], [x0, ye, -ze], [x0, yt, 0], [x1, yt, 0], [0, len], [uw, len], [uw, 0], [0, 0]);
  for (const sx of [-1, 1]) {
    const x = sx * w / 2;
    gab.tri([x, h, -d / 2], [x, h, d / 2], [x, yt, 0], [0, 0.5], [d / 4, 0.5], [d / 8, 0], [sx, 0, 0]);
  }
  return [roof.build(), gab.build()];
}

/** The hull, local frame: underside at y = 0, centred on x/z, long axis z. */
function hullGeo() {
  const parts = [];
  const halfW = (z) => {   // plan outline: blunt, slightly tapered ends
    const t = Math.abs(z) / (HULL_L / 2);
    return HULL_W / 2 * (t < 0.7 ? 1 : 1 - (t - 0.7) * 1.2);
  };
  // main body as stacked slices so the tapered plan reads
  const SL = 14;
  for (let i = 0; i < SL; i++) {
    const z0 = -HULL_L / 2 + (i / SL) * HULL_L, z1 = z0 + HULL_L / SL, zc = (z0 + z1) / 2;
    const w = halfW(zc) * 2;
    parts.push({ geo: K.props.shift(box(w, 16, z1 - z0 + 0.2, { uvRepeat: [w / 24, 1] }), 0, 8, zc), color: [1, 1, 1] });
  }
  // upper terraces
  parts.push({ geo: K.props.shift(box(HULL_W * 0.55, 10, HULL_L * 0.6, { uvRepeat: [10, 6] }), -30, 21, 10), color: [0.85, 0.85, 0.85] });
  parts.push({ geo: K.props.shift(box(HULL_W * 0.2, 9, HULL_L * 0.25, { uvRepeat: [4, 2] }), 60, 30, -20), color: [0.8, 0.8, 0.8] });
  // transverse ribs on the underside
  const RIBS = 22;
  for (let i = 0; i < RIBS; i++) {
    const z = -HULL_L / 2 + 8 + (i / (RIBS - 1)) * (HULL_L - 16), w = halfW(z) * 2 - 6, dep = 2.2 + (i % 3 === 0 ? 1.6 : 0);
    parts.push({ geo: K.props.shift(box(w, dep, 2.4, { uvRepeat: [w / 16, 0.3] }), 0, -dep / 2, z), color: [0.62, 0.62, 0.62] });
  }
  // two long keel channels and a few hanging pods
  for (const x of [-120, -34, 34, 120]) parts.push({ geo: K.props.shift(box(5, 5, HULL_L * 0.86, { uvRepeat: [0.5, 10] }), x, -2.5, 0), color: [0.5, 0.5, 0.5] });
  parts.push({ geo: K.props.shift(box(3, 2, HULL_L * 0.9, { uvRepeat: [0.3, 10] }), 0, -4.2, 0), color: [0.45, 0.45, 0.45] });
  [[-58, 40], [52, -70], [-20, -100], [60, 90], [-62, -40], [-160, 20], [150, -50], [180, 80]].forEach(([x, z], i) => {
    parts.push({ geo: K.props.shift(box(10 + i * 2, 4, 14), x, -2, z), color: [0.7, 0.7, 0.7] });
  });
  return merge(parts);
}

/** Slow drift down the street and back (cosine ping-pong, so it never reverses abruptly). */
class DriftRig extends K.CameraRig {
  constructor(o) { super(o); this.phase = 0; this.lookUp = 3.5; }
  update(audio, k, dt) {
    super.update(audio, k, dt);
    this.phase += this.speed * dt;
    const p = this.phase, e = this.eye, t = this.target;
    e[0] = Math.sin(p * 1.7) * 1.1;
    e[1] = 1.65;
    e[2] = 4 - 22 * (1 - Math.cos(p));
    const yaw = Math.sin(this.time * 0.031) * 0.16 + Math.sin(p * 0.9) * 0.08;
    t[0] = e[0] + Math.sin(yaw) * 20;
    t[1] = e[1] + this.lookUp;
    t[2] = e[2] - Math.cos(yaw) * 20;
  }
}

export class UnderTheHull {
  static meta = { name: 'Under the Hull' };
  static palette = ALBUM_PALETTES.amsp;

  init(r) {
    this.ground = new K.Terrain(r, { size: 230, cells: 60, height: (x, z) => (Math.abs(x) < STREET_HW + 2 ? 0 : K.fbm(x * 0.04, z * 0.04, { octaves: 2, seed: 3 }) * 0.25), uvScale: 0.22 });
    this.groundTex = r.texture(paving());
    this.sky = new K.Sky(r, { stars: 60, clouds: 5 });

    // ---- the town: two merged meshes (walls + gables, roofs), windows as instances
    const walls = [], roofs = [], wins = [];
    const addHouse = (x, z, ry, w, d, h, rise, seed) => {
      walls.push(moved(wallBox(w, h, d), x, -0.15, z, ry));
      const [rf, gb] = gable(w, d, h, rise);
      roofs.push(moved(rf, x, -0.15, z, ry));
      walls.push(moved(gb, x, -0.15, z, ry));
      // windows on the long (+z local) face, plus the back on some
      const c = Math.cos(ry), s = Math.sin(ry), n = Math.max(1, Math.floor(w / 2.6));
      for (let f = 0; f < (K.rand2(seed, 9, 3) > 0.5 ? 2 : 1); f++) {
        const side = f === 0 ? 1 : -1;
        for (let i = 0; i < n; i++) {
          const lx = -w / 2 + (i + 0.5) * (w / n), lz = side * (d / 2 + 0.04);
          for (let fl = 0; fl < (h > 4.5 ? 2 : 1); fl++) {
            if (K.rand2(seed * 7 + i, fl + f * 3, 11) < 0.18) continue;
            wins.push({ x: x + c * lx + s * lz, y: 1.1 + fl * 2.2, z: z - s * lx + c * lz, ry: ry + (side < 0 ? Math.PI : 0), seed: seed * 13 + i * 3 + fl + f * 7 });
          }
        }
      }
    };
    let seed = 0;
    for (const side of [-1, 1]) {
      for (let z = 26; z > -170; seed++) {
        const w = 6 + K.rand2(seed, 1, 5) * 4, d = 5 + K.rand2(seed, 2, 5) * 2.5, h = 3.4 + K.rand2(seed, 3, 5) * 2.2;
        const x = side * (STREET_HW + 3 + d / 2 + K.rand2(seed, 4, 5) * 1.2);
        addHouse(x, z - w / 2, side < 0 ? -Math.PI / 2 : Math.PI / 2, w, d, h, 1.6 + K.rand2(seed, 5, 5) * 1.2, seed);
        z -= w + 1.5 + K.rand2(seed, 6, 5) * 4;
        // back row, seen over the gaps and roofs
        if (K.rand2(seed, 7, 5) > 0.35) {
          const bw = 7 + K.rand2(seed, 8, 5) * 4;
          addHouse(side * (STREET_HW + 17 + K.rand2(seed, 9, 5) * 6), z + 3, side < 0 ? -Math.PI / 2 : Math.PI / 2, bw, 6, 3.6 + K.rand2(seed, 10, 5) * 2.5, 2, seed + 500);
        }
      }
    }
    // church: nave, square tower, tall spire
    walls.push(moved(wallBox(7, 7, 16), -22, -0.2, -78));
    const [nr, ng] = gable(16, 7, 7, 4.5); roofs.push(moved(nr, -22, -0.2, -78, Math.PI / 2)); walls.push(moved(ng, -22, -0.2, -78, Math.PI / 2));
    walls.push(moved(wallBox(4.5, 15, 4.5), -22, -0.2, -66));
    roofs.push(moved(K.props.prism(4, 3.2, 13, { taper: 0, uvRepeat: [2, 4] }), -22, 14.8, -66, Math.PI / 4));
    // water tower on legs
    for (const [lx, lz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) walls.push(moved(K.props.shift(box(0.35, 12, 0.35, { uvRepeat: [0.1, 3] }), 0, 6, 0), 24 + lx, -0.2, -48 + lz));
    walls.push(moved(K.props.prism(10, 3.4, 4.5, { uvRepeat: [4, 1] }), 24, 11.8, -48));
    roofs.push(moved(K.props.prism(10, 3.7, 2, { taper: 0, uvRepeat: [3, 1] }), 24, 16.3, -48));

    this.wallMesh = r.createMesh(merge(walls));
    this.roofMesh = r.createMesh(merge(roofs));
    this.wallTex = r.texture(clapboard());
    this.roofTex = r.texture(slate());

    this.winMesh = r.createMesh(new GeoBuilder().quad([-0.45, -0.6, 0], [0.45, -0.6, 0], [0.45, 0.6, 0], [-0.45, 0.6, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build());
    this.winTex = r.texture(windowPane());
    this.wins = wins.map((w) => ({ ...w, off: K.rand2(w.seed, 1, 13) * 70, idle: K.rand2(w.seed, 2, 13) < 0.06, ph: K.rand2(w.seed, 3, 13) * TAU, level: 0 }));
    this.winInst = r.createInstances(this.wins.length);

    // street lamps, both sides, staggered; arm over the street
    this.lampMesh = r.createMesh(K.props.lampPost(4.4, 0.9));
    this.lampInst = r.createInstances(N_LAMPS);
    this.lamps = Array.from({ length: N_LAMPS }, (_, i) => {
      const side = i % 2 ? 1 : -1, z = 22 - i * 11.5, x = side * (STREET_HW + 0.6);
      return { x, z, ry: side < 0 ? 0 : Math.PI, hx: x - side * 0.9, hy: 4.2, ph: K.rand2(i, 1, 17) * TAU, idle: i === 5, level: 0 };
    });
    this.lamps.forEach((L, i) => this.lampInst.set(i, L.x, 0, L.z, 1, L.ry, 0.85));
    this.lampInst.upload(N_LAMPS);
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.lampGlowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.lampGlows = r.createInstances(N_LAMPS);
    this.poolMesh = r.createMesh(K.decal(1, 1, 0.03));
    this.pools = r.createInstances(N_LAMPS);

    // ---- the hull and its lights
    this.hullMesh = r.createMesh(hullGeo());
    this.hullTex = r.texture(hullPlate());
    this.keelTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.navTex = r.texture(K.sprites.glow({ ramp: 1 }));
    this.keel = r.createInstances(N_KEEL);
    this.navLights = [[-60, -2, 60], [58, -2, -30], [-40, -3, -118], [44, -3, 112], [0, -5.5, -128], [-150, -1, -10], [140, -1, 20], [-190, -1, 90], [200, -1, -100]];
    this.nav = r.createInstances(this.navLights.length);
    this.pulses = new K.Pulses({ width: 4, decay: 2.6 });
    this.nextIdlePulse = 6;

    this.mist = new K.Particles(r, 'mist', { area: [34, 1.4, 30], count: 14 });
    this.dust = new K.Particles(r, 'dust', { area: [18, 8, 18], count: 140 });

    this.cam = new DriftRig({ fov: 62, far: 720, idleSpeed: 0.011, activeSpeed: 0.016, bassBoost: 0, fovPunch: 0.6, nudge: 0.03, rollKick: 0.004 });
    this.breath = new K.Breath({ beats: 16, period: 14 });
    this.time = 0; this.k = 0; this.hp = 0; this.hv = 0; this.cover = 0; this.edge = HULL_FAR + HULL_L / 2;
    this.hullM = mat4.create(); this.m = mat4.create();
    this.col = { fog: [0, 0, 0], a: [0, 0, 0], b: [0, 0, 0], zen: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], tint: [1, 1, 1], hull: [0, 0, 0], glow: [1, 1, 1], pool: [0, 0, 0], lamp: [0, 0, 0], focus: [0, 0, 0] };
    this.lights = new K.LightSet({ reach: 12 });
    this._updateHull(0);
    this._updateLights(0, 0);
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt; this.dt = dt;
    const d = K.drive(a, k), t = this.time;
    const b = this.breath.update(a, dt);

    // the hull's approach: a smoothed, speed-limited follow of intensity + song energy
    const target = clamp(k * 0.8 + d.energy * 0.35);
    const want = clamp((target - this.hp) / 5, -0.035, 0.035);
    this.hv = damp(this.hv, want, 2.5, dt);
    this.hp = clamp(this.hp + this.hv * dt);
    this._updateHull(t);

    this.cam.lookUp = lerp(3.4, 7.5, K.stage(this.cover, 0.2, 1));
    this.cam.update(a, k, dt);
    this.ground.follow(this.cam.eye[0], this.cam.eye[2]);

    // beats: one faint pulse runs the keel from the far end to the near end
    this.pulses.decay = 2.6 * d.decay;
    if (d.beat) this.pulses.trigger(-3, (0.45 + 0.55 * k) * d.accent, 9);
    if ((this.nextIdlePulse -= dt) <= 0) { this.nextIdlePulse = 10 + Math.random() * 6; this.pulses.trigger(-3, 0.3, 6); }
    this.pulses.update(dt);

    this._updateLights(t, b);

    const eye = this.cam.eye;
    this.mist.update(dt, [eye[0], 0.4, eye[2] - 30], { amount: K.swell(this.cover, 0.8, 1), speed: 0.35 });
    this.dust.update(dt, eye, { amount: K.stage(this.cover, 0.3, 0.9) * 0.7, speed: 0.4 + d.high * 0.4, wind: [0.15, 0.05] });
  }

  _updateHull(t) {
    const hp = K.stage(this.hp, 0, 1);
    const hz = lerp(HULL_FAR, HULL_NEAR, hp) + Math.sin(t * 0.021) * 6;
    const hx = Math.sin(t * 0.011) * 14 * (1 - hp * 0.6);
    const yaw = Math.sin(t * 0.0071) * 0.05 + 0.04;
    this.hullPos = [hx, HULL_Y + Math.sin(t * 0.05) * 0.6, hz];
    mat4.trs(this.hullM, hx, this.hullPos[1], hz, 0, yaw, 0);
    this.edge = hz + HULL_L / 2;                      // the near edge of its shadow
    const ez = this.cam ? this.cam.eye[2] : 0;
    this.cover = K.stage(this.edge - ez, -130, 50);   // how much of the sky is gone above the camera
  }

  _updateLights(t, b) {
    const k = this.k, edge = this.edge, eye = this.cam.eye;
    // windows: switch on as the shadow edge passes them (plus a per-house delay), never above k's reach
    this.wins.forEach((W, i) => {
      const on = K.stage(edge - W.z - W.off, 0, 16) * K.stage(k, 0.05, 0.3);
      W.level = Math.max(W.idle ? 0.55 : 0.07, on * (0.85 + 0.15 * Math.sin(t * 0.3 + W.ph)));
      this.winInst.set(i, W.x, W.y, W.z, 1, W.ry, W.level);
    });
    this.winInst.upload(this.wins.length);
    // lamps: same, with a short sodium flicker while warming up
    this.lamps.forEach((L, i) => {
      const s = K.stage(edge - L.z, -10, 14) * K.stage(k, 0.05, 0.25);
      const flick = s > 0.02 && s < 0.9 ? 0.75 + 0.25 * Math.sin(t * 23 + L.ph * 5) * Math.sin(t * 7.3 + L.ph) : 1;
      L.level = Math.max(L.idle ? 0.4 : 0, s * flick) * (0.92 + 0.08 * b);
      const near = K.fadeIn(Math.hypot(L.hx - eye[0], L.z - eye[2]), 4, 14);   // no giant glow right over the lens
      this.lampGlows.set(i, L.hx, L.hy, L.z, (0.9 + L.level * 0.9) * near, 0, L.level);
      this.pools.set(i, L.hx, 0.02, L.z, 6.5, 0, L.level * 0.45);
    });
    this.lampGlows.upload(N_LAMPS); this.pools.upload(N_LAMPS);
    // keel strip in hull-local space, far end (-z) is s = 0
    for (let i = 0; i < N_KEEL; i++) {
      const z = -HULL_L * 0.44 + (i / (N_KEEL - 1)) * HULL_L * 0.88;
      const lv = 0.3 + 0.1 * b + Math.min(1.3, this.pulses.at(i) * 2.2);
      this.keel.set(i, 0, -9, z, 4 + lv * 3, 0, lv);
    }
    this.keel.upload(N_KEEL);
    this.navLights.forEach(([x, y, z], i) => {
      const blink = 0.25 + 0.2 * Math.max(0, Math.sin(t * 0.45 + i * 1.9));
      this.nav.set(i, x, y, z, 4, 0, blink);
    });
    this.nav.upload(this.navLights.length);
  }

  render(r) {
    const { col, k } = this, P = this.pal, c = this.cover;
    // overcast grey dusk at idle; under the hull the air goes dark (never black)
    mixColor(col.a, P.role('fog'), P.color(R(3, 2)), 0.8);
    mixColor(col.b, P.color(R(3, 0)), P.role('fog'), 0.45);
    mixColor(col.fog, col.a, col.b, c);
    r.clear(col.fog);
    this.cam.apply(r);
    mixColor(col.zen, P.color(R(3, 2)), P.color(R(1, 1)), 0.2);
    mixColor(col.zen, col.zen, P.color(R(3, 0)), c);
    this.sky.draw(r, this.cam.eye, { horizon: col.fog, zenith: col.zen, brightness: lerp(0.8, 0.6, c), starLevel: 0.12 * (1 - c), cloudDrift: this.time * 0.003 });

    // the hull: no fog (it is far beyond the town fog), but it melts into the haze with distance
    r.setFog(col.fog, 12, lerp(105, 85, c));
    col.hull[0] = col.hull[1] = col.hull[2] = lerp(1, 0.75, c);   // nothing lights its underside
    r.draw(this.hullMesh, this.hullM, { texture: this.hullTex, unlit: true, fog: false, fade: [260, 900], tint: col.hull });
    const kb = lerp(0.6, 1, Math.max(k, c));
    col.glow[0] = col.glow[1] = col.glow[2] = kb;
    r.drawInstanced(this.quad, this.keel, { model: this.hullM, texture: this.keelTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [160, 560], tint: col.glow });
    r.drawInstanced(this.quad, this.nav, { model: this.hullM, texture: this.navTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [160, 560], tint: col.glow });

    // the town
    r.setLight([0.35, -0.8, 0.45], scaleColor(col.light, P.role('light'), lerp(0.7, 0.18, c)), scaleColor(col.amb, P.role('ambient'), lerp(0.55, 0.32, c)));
    const L = this.lights, eye = this.cam.eye, tg = this.cam.target;
    scaleColor(col.lamp, P.role('glow'), 2.6);
    L.begin();
    this.lamps.forEach((lp, i) => L.add(i, lp.hx, lp.hy - 0.3, lp.z, col.lamp, 9, lp.level));
    const fx = tg[0] - eye[0], fz = tg[2] - eye[2], fn = Math.hypot(fx, fz) || 1;
    col.focus[0] = eye[0] + (fx / fn) * 12; col.focus[1] = 2; col.focus[2] = eye[2] + (fz / fn) * 12;
    L.apply(r, col.focus, this.dt || 1 / 60);
    this.ground.draw(r, { texture: this.groundTex });
    r.draw(this.wallMesh, mat4.identity(this.m), { texture: this.wallTex });
    r.draw(this.roofMesh, this.m, { texture: this.roofTex });
    r.drawInstanced(this.lampMesh, this.lampInst, { tint: col.tint });
    r.drawInstanced(this.winMesh, this.winInst, { texture: this.winTex, unlit: true });
    scaleColor(col.pool, [1, 1, 1], 0.9);
    r.drawInstanced(this.poolMesh, this.pools, { texture: this.lampGlowTex, unlit: true, additive: true, fade: [40, 90], tint: col.pool });
    r.drawInstanced(this.quad, this.lampGlows, { texture: this.lampGlowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [45, 95] });

    // air
    this.mist.draw(r, { brightness: lerp(0.9, 0.5, c), opacity: 0.22 + this.breath.v * 0.08 });
    this.dust.draw(r, { brightness: 0.6 });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r);
    [this.mist, this.dust].forEach((x) => x.dispose(r));
    [this.wallMesh, this.roofMesh, this.winMesh, this.lampMesh, this.quad, this.poolMesh, this.hullMesh].forEach((m) => m.dispose());
    [this.groundTex, this.wallTex, this.roofTex, this.winTex, this.lampGlowTex, this.hullTex, this.keelTex, this.navTex].forEach((t) => r.deleteTexture(t));
    [this.winInst, this.lampInst, this.lampGlows, this.pools, this.keel, this.nav].forEach((i) => i.dispose());
  }
}
