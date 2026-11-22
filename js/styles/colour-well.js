// COLOUR FROM THE WELL — a withered hill farm at night (original; mood from
// Lovecraft's "The Colour Out of Space", 1927, public domain).
//
// A flat, dry field round an old fieldstone well with a little roofed frame. Behind
// it a farmhouse, a big barn, a tumbled stone wall and the orchard rows; a broken
// rail fence in front. The camera drifts on a slow arc on the open side of the well,
// always looking at it.
//
// The "colour" is drawn only from the accent ramp, so every palette gives a
// different unearthly colour.
//
// Idle:  a dark farm, the colour a faint breathing glow on the well rim.
// Swell: the blight spreads out from the well in rings. The ground is cut into
//        annuli and the grass and trees into radius bands, each dither-crossfading
//        (texture2 / blend) from dry-but-alive to grey and brittle as the front
//        passes; the front itself is a faint ring of colour on the ground. Blighted
//        trees glow along their bare branches and sway with no wind (mids), motes
//        of colour rise over the field (highs sparkle), the farmhouse windows take
//        the colour, and near the top a shaft of colour climbs from the well into
//        the sky (it sinks back as intensity falls). The front eases back too.
// Beat:  a ring of colour runs out across the ground from the well (K.Ripples) and
//        the tree glow pulses as the ring passes each band.
import { mat4, lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { GeoBuilder, merge, box, smoothNormals } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

// ground annuli and foliage radius bands (world units from the well)
const RINGS = [0, 3, 6, 10, 15, 20, 26, 33, 41, 50, 60, 84];
const BANDS = [0, 18, 30, 40, 90];
const FRONT_IDLE = 2.4, FRONT_FULL = 64;   // blight front radius at k = 0 / 1
const RIPPLE_LIFE = 3.2;
const CAM_R = 22;

/** Field height: flat round the farm (so ground rings and ripples lie on it), low hills far out. */
const height = (x, z) => {
  const d = Math.hypot(x, z), t = clamp((d - 48) / 30);
  return t * t * (3 - 2 * t) * (K.fbm(x * 0.03, z * 0.03, { octaves: 3, seed: 5 }) * 9 + 1.5) - 0.02;
};

/** One flat-ish annulus of ground, world-space UVs. */
function annulus(r0, r1, segs = 40, uv = 0.25) {
  const g = new GeoBuilder(), steps = Math.max(1, Math.ceil((r1 - r0) / 3));
  const P = (rad, a) => { const x = Math.cos(a) * rad, z = Math.sin(a) * rad; return [x, height(x, z), z]; };
  const T = (p) => [p[0] * uv, p[2] * uv];
  for (let j = 0; j < steps; j++) {
    const ra = lerp(r0, r1, j / steps), rb = lerp(r0, r1, (j + 1) / steps);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const p0 = P(ra, a0), p1 = P(ra, a1), p2 = P(rb, a1), p3 = P(rb, a0);
      g.quad(p0, p1, p2, p3, T(p0), T(p1), T(p2), T(p3));
    }
  }
  return smoothNormals(g.build());
}

/** Stone well shaft: outer wall, top lip, inner wall facing in. Pivot at ground centre. */
function wellGeo(ro = 1.35, ri = 1.0, h = 0.95, segs = 12) {
  const g = new GeoBuilder();
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const u0 = i / segs * 6, u1 = (i + 1) / segs * 6;
    const O = (c, s, y) => [c * ro, y, s * ro], I = (c, s, y) => [c * ri, y, s * ri];
    g.quad(O(c0, s0, 0), O(c0, s0, h), O(c1, s1, h), O(c1, s1, 0), [u0, 1], [u0, 0], [u1, 0], [u1, 1]);           // outside
    g.quad(I(c1, s1, -0.6), I(c1, s1, h), I(c0, s0, h), I(c0, s0, -0.6), [u1, 1.4], [u1, 0], [u0, 0], [u0, 1.4]);    // inside
    g.quad(O(c0, s0, h), I(c0, s0, h), I(c1, s1, h), O(c1, s1, h), [u0, 0], [u0, 0.3], [u1, 0.3], [u1, 0]);          // lip
  }
  return g.build();
}

const at = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => ({ geo, xf: K.xf({ pos: [x, y, z], rot: [rx, ry, rz] }) });
const boxAt = (sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) => at(box(sx, sy, sz, { uvRepeat: [Math.max(1, sx / 1.5), Math.max(1, sy / 1.5)] }), x, y, z, rx, ry, rz);

export class ColourWell {
  static meta = { name: 'Colour from the Well' };
  static palette = fromKeys('colour-well', 'Colour from the Well', ['#6f655a', '#8c8448', '#d870ff', '#141a2c']);

  init(r) {
    this.height = height;
    this.m = mat4.create();
    this.I = mat4.create();

    // ---- textures
    const healthy = K.makeIndexed(64, 64, (x, y) => {
      const n = K.tileBlob(x, y, 16, 3) * 0.7 + K.tileBlob(x, y, 4, 8) * 0.3;
      if (K.rnd(x, y, 2) > 0.93) return R(0, 1);
      return K.dshade(1, 0.5 + n * 1.7, x, y);
    });
    const blighted = K.makeIndexed(64, 64, (x, y) => {
      const n = K.tileBlob(x, y, 16, 11), c = K.tileBlob(x, y, 8, 4);
      if (Math.abs(c - 0.5) < 0.035) return R(0, 1);              // brittle cracks
      if (K.rnd(x, y, 7) > 0.985) return R(2, 1);                 // a fleck of the colour
      return K.dshade(0, 1.6 + n * 1.5, x, y);
    });
    this.groundTex = r.texture(healthy);
    this.groundTex2 = r.texture(blighted);
    this.treeTex = r.texture(K.sprites.broadleaf({ ramp: 1, trunk: R(0, 0), seed: 6 }));
    this.deadTex = r.texture(K.sprites.deadTree({ index: R(0, 3), seed: 6 }));
    this.treeGlowTex = r.texture(K.sprites.deadTree({ index: R(2, 2), seed: 6 }));
    this.grassTex = r.texture(K.sprites.grass({ ramp: 1, seed: 9 }));
    this.grassTex2 = r.texture(K.sprites.grass({ ramp: 0, seed: 9 }));
    this.plankTex = r.texture(K.props.planks({ ramp: 0 }));
    this.roofTex = r.texture(K.tex.cracks({ ramp: 3, cells: 4, patches: null }));
    this.stoneTex = r.texture(K.tex.cracks({ ramp: 0, cells: 5, jitter: 6, seed: 9, fill: R(0, 2), rim: R(0, 1), crack: R(0, 0), patches: null }));
    this.windowTex = r.texture(K.makeIndexed(8, 8, (x, y) => (x === 0 || y === 0 || x === 7 || y === 7 || x === 4 || y === 4 ? R(0, 0) : K.dshade(2, 1.5 + (7 - y) / 6, x, y))));
    this.darkTex = r.texture(K.makeIndexed(4, 4, () => R(3, 0)));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.ringTex = r.texture(K.ringSprite({ index: R(2, 2) }));
    this.shaftTex = r.texture(K.makeIndexed(16, 64, (x, y) => {
      const t = y / 63, across = 1 - Math.abs(x - 7.5) / 8;               // y = 63 is the bottom of the quad
      const b = across * across * (0.25 + 0.75 * t * t) * (0.8 + 0.2 * K.rnd(x, y >> 2, 3));
      if (b < 0.06 + K.bayer(x, y) * 0.2) return K.CLEAR;
      return K.dshade(2, 1 + b * 2.4, x, y);
    }));

    // ---- ground rings around the well
    this.rings = [];
    for (let i = 0; i < RINGS.length - 1; i++) this.rings.push({ mesh: r.createMesh(annulus(RINGS[i], RINGS[i + 1])), r0: RINGS[i], r1: RINGS[i + 1], blend: 0, glow: [0, 0, 0] });

    // ---- the well: stone shaft, roofed wooden frame with a windlass, darkness inside
    this.wellMesh = r.createMesh(merge([
      { geo: wellGeo() },
      // a farmhouse chimney and a tumbled fieldstone wall share the stone texture
      boxAt(0.8, 2.6, 0.8, -9.2, 5.6, -12.3, 0, 0.25, 0),
      ...this._stoneWall(),
    ]));
    this.frameMesh = r.createMesh(merge([
      boxAt(0.16, 2.5, 0.16, -1.2, 1.25, 0), boxAt(0.16, 2.5, 0.16, 1.2, 1.25, 0),
      boxAt(2.7, 0.12, 0.12, 0, 1.95, 0),                       // windlass beam
      at(K.props.prism(6, 0.13, 1.2), 0.6, 1.95, 0, 0, 0, Math.PI / 2),
      boxAt(2.9, 0.06, 1.0, 0, 2.62, -0.42, -0.6, 0, 0),        // little pitched roof
      boxAt(2.9, 0.06, 1.0, 0, 2.62, 0.42, 0.6, 0, 0),
      at(K.props.prism(6, 0.22, 0.32, { taper: 0.85 }), 0.4, 1.32, 0.05),   // the bucket, hanging
      boxAt(0.02, 0.5, 0.02, 0.4, 1.7, 0.05),
      ...this._fence(),
    ]));
    this.wellDark = r.createMesh(K.flatPoly(12, 1.0, { y: 0.15 }));

    // ---- farmhouse and barn (behind the well, the far side from the camera arc)
    this.houseM = mat4.trs(mat4.create(), -11, -0.05, -12, 0, 0.25, 0);
    const house = K.props.gableHouse(7, 5.5, 3.2, 2.4);
    this.houseWalls = r.createMesh(house.walls); this.houseRoof = r.createMesh(house.roof);
    this.barnRot = Math.atan2(-0.756, -0.655);                  // gable end (+x) faces the well
    this.barnM = mat4.trs(mat4.create(), 14, -0.05, -16, 0, this.barnRot, 0);
    const barn = K.props.gableHouse(8.5, 12, 4.4, 3.6, { tile: 2.5 });
    this.barnWalls = r.createMesh(barn.walls); this.barnRoof = r.createMesh(barn.roof);
    const win = (w, h, x, y, z, ry = 0) => at(K.centredQuad(w, h), x, y, z, 0, ry, 0);
    this.houseWin = r.createMesh(merge([win(0.9, 1.1, -2, 1.6, 2.77), win(0.9, 1.1, 2, 1.6, 2.77), win(0.7, 0.7, 3.52, 4.1, 0, Math.PI / 2), win(0.9, 1.1, -3.52, 1.6, 0.8, -Math.PI / 2)]));
    this.barnWin = r.createMesh(merge([win(1.1, 1.0, 4.27, 5.4, 0, Math.PI / 2)]));
    this.barnDoor = r.createMesh(merge([win(3.2, 3.4, 4.27, 1.7, 0, Math.PI / 2)]));
    this.houseDoor = r.createMesh(merge([win(0.9, 1.9, -0.2, 0.95, 2.77)]));

    // ---- orchard rows, lone trees and grass, split into radius bands
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.flat = r.createMesh(K.centredQuad(1, 1));
    this.treePts = [];
    const clearOf = (x, z) => {
      const d = Math.hypot(x, z);
      if (z > 0 && d > CAM_R - 6 && d < CAM_R + 7) return false;            // the camera arc
      if (Math.hypot(x + 11, z + 12) < 6.5 || Math.hypot(x - 14, z + 16) < 9) return false;   // house, barn
      return true;
    };
    for (let gx = -12; gx <= 12; gx++) for (let gz = -12; gz <= 4; gz++) {
      const x = gx * 4.6 + (K.rand2(gx, gz, 1) - 0.5) * 1.2, z = gz * 4.6 - 20 + (K.rand2(gx, gz, 2) - 0.5) * 1.2;
      const d = Math.hypot(x, z);
      if (d < 27 || d > 66 || !clearOf(x, z)) continue;
      if (z > -14 && Math.abs(x) < 34) continue;             // leave the house yard and the field open
      if (K.rand2(gx, gz, 3) < 0.12) continue;               // a few gaps where trees have died and gone
      this.treePts.push({ x, z, d, s: 3.6 + K.rand2(gx, gz, 4) * 1.4, ph: K.rand2(gx, gz, 5) * 40 });
    }
    for (const [x, z, s] of [[5.5, -7, 4.6], [-6, -4.5, 3.8], [-15, 3, 4.2], [9, -1.5, 3.4], [-3, -15, 4.4], [20, -6, 4.8]]) {
      this.treePts.push({ x, z, d: Math.hypot(x, z), s, ph: x * 7 + z });
    }
    this.grassPts = [];
    K.scatter(0, 0, { cell: 2.2, radius: 24, seed: 4, jitter: 1 }, (x, z, d, gx, gz) => {
      if (d < 1.8 || d > 52 || !clearOf(x, z) || K.rand2(gx, gz, 6) > 0.45) return;
      this.grassPts.push({ x, z, d, s: 0.5 + K.rand2(gx, gz, 7) * 0.5, ph: K.rand2(gx, gz, 8) * 30 });
    });
    this.bands = [];
    for (let b = 0; b < BANDS.length - 1; b++) {
      const lo = BANDS[b], hi = BANDS[b + 1];
      const trees = this.treePts.filter((t) => t.d >= lo && t.d < hi), grass = this.grassPts.filter((g) => g.d >= lo && g.d < hi);
      const band = { lo, hi, trees, grass, blend: 0, glow: 0, sway: 0, treeInst: r.createInstances(Math.max(1, trees.length)), glowInst: r.createInstances(Math.max(1, trees.length)), grassInst: r.createInstances(Math.max(1, grass.length)) };
      trees.forEach((t, i) => band.treeInst.set(i, t.x, height(t.x, t.z) - 0.15, t.z, t.s * 0.75, 0, 0.85 + (t.ph % 1) * 0.3, t.ph, 1 / 0.75));
      band.treeInst.upload(trees.length);
      grass.forEach((g, i) => band.grassInst.set(i, g.x, height(g.x, g.z) - 0.05, g.z, g.s, 0, 0.8 + (g.ph % 1) * 0.3, g.ph, 0.8));
      band.grassInst.upload(grass.length);
      this.bands.push(band);
    }

    // ---- glows: rim, a halo over the shaft, the rising column, the blight front
    this.glowInst = r.createInstances(2);
    this.shaftInst = r.createInstances(2);
    this.rimM = mat4.create(); this.frontM = mat4.create();
    this.ripples = new K.Ripples(r, { max: 8, color: R(2, 2), life: RIPPLE_LIFE });
    this.waves = [];                                          // the same rings, for the tree glow

    // ---- sky and particles
    this.sky = new K.Sky(r, { stars: 170, clouds: 5 });
    this.motes = new K.Particles(r, 'pollen', { count: 220, size: 0.1, vel: [0, 0.75, 0], jitter: [0.15, 0.35, 0.15], wobble: 0.45, area: [28, 14, 28], yOffset: 5 });   // box corner (19.8) stays inside the camera arc
    this.sparks = new K.Particles(r, 'embers', { count: 90, size: 0.16, vel: [0, 2.2, 0], jitter: [0.2, 0.8, 0.2], wobble: 0.5, area: [2.6, 12, 2.6], yOffset: 6.5 });
    this.center = [0, 0, 0];

    // ---- camera: a slow arc on the open (south) side, always looking at the well
    this.cam = new K.CameraRig({ fov: 58, fovPunch: 1.5, nudge: 0.1, rollKick: 0.015, idleSpeed: 0.022, activeSpeed: 0.06, bassBoost: 0.02, far: 220 });
    this.camPhase = 0.4; this.camR = CAM_R; this.camLift = 0;

    this.breath = new K.Breath({ beats: 8, period: 9 });
    this.rimPulse = new K.Envelope(0.6);
    this.front = FRONT_IDLE; this.shaft = 0;
    this.time = 0; this.k = 0; this.a = null;
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], zen: [0, 0, 0], win: [0, 0, 0], w: [1, 1, 1], tmp: [0, 0, 0], dim: [0, 0, 0], one: [1, 1, 1] };
  }

  /** Low dry-stone wall along the west side of the yard, tumbled in places. */
  _stoneWall() {
    const parts = [];
    for (let i = 0; i < 16; i++) {
      const t = i / 15, x = -21 + Math.sin(t * 2.2) * 2, z = 6 - t * 30;
      if (i === 5 || i === 11) continue;                       // gaps where it has fallen
      const tumble = K.rand2(i, 0, 3) > 0.7 ? 0.35 : 0;
      parts.push(boxAt(0.9, 0.75 - tumble * 0.6, 2.2, x, (0.75 - tumble * 0.6) / 2 - 0.05, z, 0, 0.1 * Math.sin(i), tumble));
    }
    return parts;
  }

  /** Broken post-and-rail fence in front of the yard: some rails hang, some posts lean. */
  _fence() {
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const x = -19 + i * 3.1, z = -6.5 + Math.sin(i * 0.9) * 0.6, lean = (K.rand2(i, 1, 2) - 0.5) * 0.35;
      parts.push(boxAt(0.18, 1.5, 0.18, x, 0.7, z, 0, 0, lean));
      if (i < 8 && K.rand2(i, 2, 2) > 0.25) parts.push(boxAt(3.1, 0.12, 0.09, x + 1.55, 1.15, z, 0, 0, 0));
      if (i < 8 && K.rand2(i, 3, 2) > 0.45) parts.push(boxAt(3.1, 0.12, 0.09, x + 1.55, 0.55 + (i % 3 === 1 ? -0.3 : 0), z, 0, 0, i % 3 === 1 ? 0.2 : 0));
    }
    return parts.filter((p) => Math.abs(p.xf([0, 0, 0])[0]) > 3);   // a gap for the path to the well
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k);

    // the blight front glides with intensity (never jumps), and sinks back when it falls
    const target = lerp(FRONT_IDLE, FRONT_FULL, K.stage(k, 0.05, 0.95));
    this.front = damp(this.front, target, this.front < target ? 2.2 : 3.5, dt);
    this.shaft = damp(this.shaft, K.stage(k, 0.68, 1), 1.4, dt);
    this.breath.update(a, dt);

    // camera arc
    const cam = this.cam;
    cam.update(a, k, dt);
    this.camPhase += cam.speed * dt;
    this.camR = damp(this.camR, CAM_R - d.bass * 1.2, 0.6, dt);
    this.camLift = damp(this.camLift, this.shaft, 1.2, dt);
    const ang = Math.sin(this.camPhase) * 0.95;
    cam.eye[0] = Math.sin(ang) * this.camR; cam.eye[2] = Math.cos(ang) * this.camR;
    cam.eye[1] = 2.6 + Math.sin(this.time * 0.13) * 0.35 + this.camLift * 1.2;
    cam.target[0] = 0; cam.target[1] = 1.3 + this.camLift * 6.5; cam.target[2] = -2;

    // beat: a ring of the colour runs out across the field
    if (d.beat) {
      const amp = clamp(0.5 + 0.5 * k) * Math.min(1, d.accent);
      const size = lerp(18, 70, k);
      this.ripples.spawn(0, 0.14, 0, size, amp);
      this.waves.push({ t: 0, size, amp });
      this.rimPulse.trigger(k);
    }
    this.rimPulse.update(dt);
    this.ripples.update(dt);
    this.waves = this.waves.filter((w) => (w.t += dt) < RIPPLE_LIFE);

    // per-band blight, glow and windless sway
    const F = this.front;
    for (const b of this.bands) {
      const mid = (b.lo + Math.min(b.hi, 60)) / 2;
      b.blend = K.stage(F, b.lo - 2, Math.min(b.hi, 60) + 4) * 0.92;
      const touched = K.stage(F, b.lo, mid + 3);
      b.glow = touched * (0.25 + 0.35 * k + 0.25 * this.breath.v * k) + this._waveAt(mid) * 0.9;
      b.sway = 0.004 + touched * (0.012 + d.mid * 0.07) * a.motion;
      b.trees.forEach((t, i) => {
        // trees nearest the front (and the passing beat ring) glow hardest
        const g = b.glow * (0.6 + 0.4 * K.stage(F - t.d, -3, 8)) + this._waveAt(t.d) * 0.7;
        b.glowInst.set(i, t.x, height(t.x, t.z) - 0.15, t.z, t.s * 0.75, 0, g, t.ph, 1 / 0.75);
      });
      b.glowInst.upload(b.trees.length);
    }
    for (const g of this.rings) g.blend = K.stage(F, g.r0 - 1, g.r1 + 3) * 0.95;

    // motes rise over the blighted ground; sparks pour up the shaft
    this.center[1] = 0;
    this.motes.p.flickerRate = 1.4 + d.high * 6;
    this.motes.update(dt, this.center, { amount: 0.05 + 0.9 * K.stage(k, 0.08, 0.8), speed: 0.6 + d.level * 0.8 });
    this.sparks.update(dt, this.center, { amount: 0.04 + 0.9 * this.shaft, speed: 0.5 + this.shaft * 0.8 + d.high * 0.4 });
  }

  /** Level of the beat rings at radius `rad` (matches K.Ripples' ease-out growth). */
  _waveAt(rad) {
    let v = 0;
    for (const w of this.waves) {
      const t = w.t / RIPPLE_LIFE, e = 1 - (1 - t) * (1 - t), rr = w.size * (0.15 + 0.85 * e) * 0.5;
      v += w.amp * (1 - t) * (1 - t) * Math.max(0, 1 - Math.abs(rad - rr) / 5);
    }
    return v;
  }

  render(r) {
    const { col, k } = this, a = this.a || { high: 0, mid: 0, bass: 0, level: 0, beatPulse: 0 }, P = this.pal, d = K.drive(a, k), eye = this.cam.eye;
    const dim = lerp(0.74, 1, k), sh = this.shaft;
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);

    // sky: near the peak the zenith takes a little of the colour
    const z0 = P.color(R(3, 0)), z1 = P.color(R(2, 0));
    for (let i = 0; i < 3; i++) col.zen[i] = lerp(z0[i], z1[i], sh * 0.55);
    this.sky.draw(r, eye, { horizon: col.fog, zenith: col.zen, brightness: dim, starLevel: lerp(0.5, 0.25, sh) + d.high * 0.3, cloudDrift: this.time * 0.004 });

    r.setFog(col.fog, 6, lerp(46, 64, k));
    // the moonless farm is lit faintly from above; the colour bleeds into the light as it rises
    const lc = P.role('light'), gc = P.role('glow'), lt = K.stage(k, 0.2, 1) * 0.55;
    for (let i = 0; i < 3; i++) col.light[i] = lerp(lc[i] * 0.5, gc[i] * 0.75, lt);
    // low and from behind the camera arc, so upright cards (grass, trees) catch it as well as the ground
    r.setLight([0.3, -0.6, -0.75], col.light, scaleColor(col.amb, P.role('ambient'), lerp(0.42, 0.52, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    // ground rings: healthy -> blighted as the front passes, a faint emissive at the front
    const F = this.front;
    for (const g of this.rings) {
      const mid = (g.r0 + g.r1) / 2, near = Math.max(0, 1 - Math.abs(F - mid) / (6 + (g.r1 - g.r0)));
      scaleColor(g.glow, gc, near * (0.05 + 0.12 * k));
      r.draw(g.mesh, this.I, { texture: this.groundTex, texture2: this.groundTex2, blend: g.blend, tint: col.tint, emissive: g.glow });
    }

    // buildings, well, fence
    r.draw(this.houseWalls, this.houseM, { texture: this.plankTex, tint: col.tint });
    r.draw(this.houseRoof, this.houseM, { texture: this.roofTex, tint: col.tint });
    r.draw(this.barnWalls, this.barnM, { texture: this.plankTex, tint: col.tint });
    r.draw(this.barnRoof, this.barnM, { texture: this.roofTex, tint: col.tint });
    r.draw(this.barnDoor, this.barnM, { texture: this.darkTex, tint: col.tint });
    r.draw(this.houseDoor, this.houseM, { texture: this.darkTex, tint: col.tint });
    r.draw(this.wellMesh, this.I, { texture: this.stoneTex, tint: col.tint });
    r.draw(this.frameMesh, this.I, { texture: this.plankTex, tint: col.tint });
    r.draw(this.wellDark, this.I, { texture: this.darkTex, unlit: true, tint: col.tint });
    // the windows take the colour, first the house then the barn loft
    const winHouse = 0.05 + K.stage(k, 0.3, 0.75) * (0.7 + 0.15 * this.breath.v), winBarn = 0.03 + K.stage(k, 0.5, 0.9) * 0.6;
    col.win[0] = col.win[1] = col.win[2] = winHouse;
    r.draw(this.houseWin, this.houseM, { texture: this.windowTex, unlit: true, tint: col.win });
    col.w[0] = col.w[1] = col.w[2] = winBarn;
    r.draw(this.barnWin, this.barnM, { texture: this.windowTex, unlit: true, tint: col.w });

    // grass and trees, band by band
    for (const b of this.bands) {
      if (b.grass.length) r.drawInstanced(this.quad, b.grassInst, { texture: this.grassTex, texture2: this.grassTex2, blend: b.blend, billboard: 1, sway: b.sway * 0.6, tint: col.tint });
      if (b.trees.length) r.drawInstanced(this.quad, b.treeInst, { texture: this.treeTex, texture2: this.deadTex, blend: b.blend, billboard: 1, sway: b.sway, tint: col.tint });
    }
    // glow along the bare branches (same quads, same sway, additive)
    col.dim[0] = col.dim[1] = col.dim[2] = 1;
    for (const b of this.bands) {
      if (!b.trees.length || b.glow < 0.01) continue;
      r.drawInstanced(this.quad, b.glowInst, { texture: this.treeGlowTex, billboard: 1, sway: b.sway, unlit: true, additive: true, depthWrite: false, fog: false, fade: [34, 70], tint: col.dim });
    }

    // the blight front: a faint ring of the colour lying on the field
    const frontB = (0.18 + 0.4 * k) * K.stage(F, FRONT_IDLE + 0.5, FRONT_IDLE + 4) * (1 - K.stage(F, 50, 64));
    if (frontB > 0.01) {
      mat4.trs(this.frontM, 0, 0.1, 0, -Math.PI / 2, 0, 0, F * 2.15, F * 2.15, 1);
      col.tmp[0] = col.tmp[1] = col.tmp[2] = frontB;
      r.draw(this.flat, this.frontM, { texture: this.ringTex, unlit: true, additive: true, depthWrite: false, fog: false, fade: [40, 90], tint: col.tmp });
    }
    this.ripples.draw(r, { brightness: lerp(0.22, 0.5, k) });

    // the colour in the well: rim glow, halo, then the shaft at the peak
    const rim = (0.3 + 0.25 * this.breath.v) * lerp(1, 1.6, k) + this.rimPulse.v * 0.6;
    mat4.trs(this.rimM, 0, 0.9, 0, -Math.PI / 2, 0, 0, 2.3 + rim * 0.4, 2.3 + rim * 0.4, 1);
    col.tmp[0] = col.tmp[1] = col.tmp[2] = Math.min(1.3, rim);
    r.draw(this.flat, this.rimM, { texture: this.glowTex, unlit: true, additive: true, depthWrite: false, fog: false, tint: col.tmp });
    this.glowInst.set(0, 0, 1.4, 0, 1.6 + rim * 1.4 + sh * 3, 0, 0.35 + rim * 0.35, 0, 1);
    this.glowInst.upload(1);
    r.drawInstanced(this.flat, this.glowInst, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, depthWrite: false, fog: false, tint: col.one });
    if (sh > 0.005) {
      const hgt = 4 + sh * 95, flick = 0.85 + 0.15 * Math.sin(this.time * 9.3) * d.high;
      this.shaftInst.set(0, 0, 0.4, 0, 2.6 + sh * 1.6, 0, sh * 0.8 * flick, 0, hgt / (2.6 + sh * 1.6));
      this.shaftInst.set(1, 0, 0.4, 0, 1.0 + sh * 0.6, 0, sh * 1.1 * flick, 0, (hgt * 0.92) / (1.0 + sh * 0.6));
      this.shaftInst.upload(2);
      r.drawInstanced(this.quad, this.shaftInst, { texture: this.shaftTex, billboard: 1, unlit: true, additive: true, depthWrite: false, fog: false, fade: [60, 160], tint: col.one });
    }

    this.motes.draw(r, { brightness: (0.55 + d.high * 0.9) * lerp(0.6, 1, k) });
    this.sparks.draw(r, { brightness: 0.4 + sh * 0.8 });
  }

  dispose(r) {
    this.sky.dispose(r); this.motes.dispose(r); this.sparks.dispose(r); this.ripples.dispose(r);
    for (const g of this.rings) g.mesh.dispose();
    for (const b of this.bands) { b.treeInst.dispose(); b.glowInst.dispose(); b.grassInst.dispose(); }
    [this.wellMesh, this.frameMesh, this.wellDark, this.houseWalls, this.houseRoof, this.barnWalls, this.barnRoof, this.houseWin, this.barnWin, this.barnDoor, this.houseDoor, this.quad, this.flat].forEach((m) => m.dispose());
    [this.groundTex, this.groundTex2, this.treeTex, this.deadTex, this.treeGlowTex, this.grassTex, this.grassTex2, this.plankTex, this.roofTex, this.stoneTex, this.windowTex, this.darkTex, this.glowTex, this.ringTex, this.shaftTex].forEach((t) => r.deleteTexture(t));
    [this.glowInst, this.shaftInst].forEach((i) => i.dispose());
  }
}
