// SEARCHLIGHT TOWN — a flat grid of tiny houses at night, seen from high above
// at an angle, with searchlights sweeping across the lawns (original).
//
//   town      18 x 18 lots: instanced gabled houses (one atlas texture), lit
//             windows, a few lots of pines; no roads, just hedged lawns
//   lights    five towers around the edge of town (one taller, the idle light); each beam is a
//             crossed additive cone with a pool of light on the ground, and the
//             houses it passes over brighten (per-instance shade)
//   camera    a slow, high orbit (K.OrbitRig) looking down at the town
//
// Idle:  dim, few lit windows, one slow searchlight sweep.
// Swell: the other searchlights wake one by one, more windows light, the sweep
//        speeds up, the pools narrow and the beams converge on a wandering spot.
// Beat:  every awake beam snaps ahead along its sweep (scaled by audio.motion)
//        and flares (K.Envelope, so audio.accent / decay apply).
// Peak:  above ~0.75 intensity the town melts: a travelling wave lifts the
//        ground, houses tilt, sag and bend; it eases in and settles back out.
import { mat4, lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { GeoBuilder, box, plane, merge } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const N = 18, SP = 5, HALF = (N * SP) / 2;           // lots per side, lot size, town half-width
const GROUND = 260, GROUND_SEGS = 40;
const LIGHTS = [[-50, -34, 1.5], [52, -48, 1.25], [49, 50, 1.25], [-48, 50, 1.25], [56, 2, 1.25]];   // x, z, tower scale; 0 = the idle light
const TOWER_H = 18;

// ---- textures -------------------------------------------------------------

/** House atlas: top half walls (base ramp, siding), bottom half roof shingles (secondary). */
function houseTex() {
  return K.makeIndexed(64, 64, (x, y) => {
    if (y < 32) {
      if (y > 28) return K.dshade(0, 0.6, x, y);                          // dark plinth
      const siding = (y & 3) === 0 ? -0.55 : 0;
      return K.dshade(0, 1.9 + siding + K.rnd(x, y, 3) * 0.35 - (y < 3 ? 0.5 : 0), x, y);
    }
    const row = (y - 32) >> 2, off = (row & 1) * 3;
    const edge = (y & 3) === 3 || ((x + off) % 6) === 0 ? -0.5 : 0;
    return K.dshade(1, 1.5 + edge + K.rnd(x >> 1, row, 5) * 0.5, x, y);
  });
}

/** Window pane with a cross mullion; drawn unlit, brightness by instance shade. */
function windowTex() {
  return K.makeIndexed(8, 8, (x, y) => {
    if (x === 0 || y === 0 || x === 7 || y === 7) return R(0, 0);
    if (x === 3 || y === 3) return R(2, 1);                              // mullion
    return K.dshade(2, 2.2 + (y < 4 ? 0.6 : 0) - x * 0.06, x, y);
  });
}

/** One lot of lawn: blotchy grass, a hedge on two sides (so the grid reads as gardens, not streets). */
function lotTex() {
  return K.makeIndexed(32, 32, (x, y) => {
    if (x < 2 || y < 2) return K.dshade(1, 0.35 + K.rnd(x, y, 9) * 0.5, x, y);
    const b = K.blobNoise(x, y, 6, 4);
    return K.dshade(3, 1.45 + b * 0.9 + K.rnd(x, y, 2) * 0.3, x, y);
  });
}

/** Soft round pool of light (additive). */
function poolTex() {
  return K.makeIndexed(32, 32, (x, y) => {
    const d = Math.hypot(x - 15.5, y - 15.5) / 15.5;
    if (d > 1 || d > 0.45 + K.bayer(x, y) * 0.55) return K.CLEAR;
    return K.dshade(3, 3.2 - d * 2.2, x, y);
  });
}

// ---- geometry -------------------------------------------------------------

/** Gabled house, pivot at the base centre: body 2.2 x 1.5 x 1.8, ridge along X. */
function houseGeo() {
  const W = 1.1, D = 0.9, H = 1.5, RH = 0.95, OV = 0.2;
  const body = K.atlasUV(K.props.shift(box(W * 2, H, D * 2), 0, H / 2, 0), [0, 0, 1, 0.5]);
  const g = new GeoBuilder(), ey = H - 0.06, ry = H + RH, ex = W + 0.12, ez = D + OV;
  // two roof slopes (roof half of the atlas)
  g.quad([-ex, ey, ez], [ex, ey, ez], [ex, ry, 0], [-ex, ry, 0], [0, 0.5], [1, 0.5], [1, 1], [0, 1]);
  g.quad([ex, ey, -ez], [-ex, ey, -ez], [-ex, ry, 0], [ex, ry, 0], [0, 0.5], [1, 0.5], [1, 1], [0, 1]);
  // gable ends (wall half)
  g.tri([W, H, D], [W, H, -D], [W, ry, 0], [0, 0.5], [1, 0.5], [0.5, 0]);
  g.tri([-W, H, -D], [-W, H, D], [-W, ry, 0], [0, 0.5], [1, 0.5], [0.5, 0]);
  return merge([{ geo: body }, { geo: g.build() }]);
}

/** The house's windows as small quads just outside the walls. */
function windowGeo() {
  const W = 1.1, D = 0.9, o = 0.03, s = 0.2, y0 = 0.78, g = new GeoBuilder();
  const q = (c, u, v) => g.face(c, u, v, [0, 0, 1, 1]);
  for (const x of [-0.55, 0.55]) {
    q([x, y0, D + o], [s, 0, 0], [0, s, 0]);
    q([-x, y0, -D - o], [-s, 0, 0], [0, s, 0]);
  }
  q([W + o, y0, 0], [0, 0, -s], [0, s, 0]);
  q([-W - o, y0, 0], [0, 0, s], [0, s, 0]);
  return g.build();
}

/** Lattice-ish mast with a lamp housing on top, pivot at the base, height TOWER_H. */
function towerGeo() {
  const mast = K.props.prism(4, 0.45, TOWER_H - 0.6, { taper: 0.45, cap: false });
  const head = K.props.shift(box(1.1, 0.7, 1.1), 0, TOWER_H - 0.25, 0);
  const deck = K.props.shift(box(1.6, 0.12, 1.6), 0, TOWER_H - 0.66, 0);
  return merge([{ geo: mast }, { geo: deck }, { geo: head }]);
}

/** Searchlight cone: three crossed trapezoids along +Y (length 1, end width 1). v = 0 at the lamp. */
function beamGeo(base = 0.08, sides = 3) {
  const g = new GeoBuilder();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI, c = Math.cos(a), s = Math.sin(a);
    const p = (w, y) => [c * w, y, s * w];
    g.quad(p(-base / 2, 0), p(base / 2, 0), p(0.5, 1), p(-0.5, 1), [0, 0], [1, 0], [1, 1], [0, 1], [0, 0, 1]);
  }
  return g.build();
}

/** Centred quad in the XY plane (pools when tilted flat, glows as billboards). */
function centredQuad(w = 1, h = 1) {
  return new GeoBuilder().quad([-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build();
}

// ---- style ----------------------------------------------------------------

export class SearchlightTown {
  static meta = { name: 'Searchlight Town' };
  static palette = ALBUM_PALETTES.okc;

  init(r) {
    // ground: a dynamic plane so the peak "melt" can lift it in waves
    this.groundGeo = plane(GROUND, GROUND_SEGS, GROUND / SP);
    this.groundBase = this.groundGeo.positions.slice();
    this.groundMesh = r.createMesh(this.groundGeo, true);
    this.groundFlat = true;
    this.lotTex = r.texture(lotTex());

    // ---- lots: houses, windows, pines
    this.houseMesh = r.createMesh(houseGeo());
    this.houseTex = r.texture(houseTex());
    this.winMesh = r.createMesh(windowGeo());
    this.winTex = r.texture(windowTex());
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.pineTex = r.texture(K.sprites.pine({ ramp: 1 }));
    this.houses = [];
    this.trees = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const cx = (i + 0.5) * SP - HALF, cz = (j + 0.5) * SP - HALF, h = K.rand2(i, j, 1);
      if (h < 0.1) {                                   // a little copse instead of a house
        const n = 2 + Math.floor(K.rand2(i, j, 2) * 3);
        for (let t = 0; t < n; t++) this.trees.push({ x: cx + (K.rand2(i * 7 + t, j, 3) - 0.5) * 3.4, z: cz + (K.rand2(i, j * 7 + t, 4) - 0.5) * 3.4, s: 2.2 + K.rand2(i + t, j, 5) * 1.4, ph: h * 90 + t });
        continue;
      }
      this.houses.push({
        x: cx + (K.rand2(i, j, 6) - 0.5) * 0.8, z: cz + (K.rand2(i, j, 7) - 0.5) * 0.8,
        s: 0.85 + K.rand2(i, j, 8) * 0.3, hs: K.rand2(i, j, 9) < 0.25 ? 1.35 : 0.95 + K.rand2(i, j, 10) * 0.15,
        rot: Math.floor(K.rand2(i, j, 11) * 4) * Math.PI / 2 + (K.rand2(i, j, 12) - 0.5) * 0.12,
        shade: 0.78 + K.rand2(i, j, 13) * 0.22, ph: h * 40,
        win: K.rand2(i, j, 14),                      // < ~0.25 lit at idle, more as the swell grows
        flick: K.rand2(i, j, 15) < 0.08,
      });
      if (K.rand2(i, j, 16) < 0.35) {                 // garden tree in a corner of the lot
        const sx = K.rand2(i, j, 17) < 0.5 ? -1 : 1, sz = K.rand2(i, j, 18) < 0.5 ? -1 : 1;
        this.trees.push({ x: cx + sx * 1.9, z: cz + sz * 1.9, s: 1.6 + K.rand2(i, j, 19), ph: h * 70 });
      }
    }
    this.houseInst = r.createInstances(this.houses.length);
    this.winInst = r.createInstances(this.houses.length);
    this.treeInst = r.createInstances(this.trees.length);
    this.lit = new Float32Array(this.houses.length);

    // ---- searchlights
    this.towerMesh = r.createMesh(towerGeo());
    this.metalTex = r.texture(K.props.rust({ metal: 0, rust: 1, seed: 6 }));
    this.beamMesh = r.createMesh(beamGeo());
    this.beamTex = r.texture(K.sprites.lightShaft({ ramp: 3 }));
    this.poolMesh = r.createMesh(centredQuad());
    this.poolTex = r.texture(poolTex());
    this.glowTex = r.texture(K.sprites.glow({ ramp: 3 }));
    this.lights = LIGHTS.map(([x, z, sc], i) => ({
      x, z, sc, hx: x, hy: TOWER_H * sc, hz: z,
      ph: i * 1.7, phT: i * 1.7, rate: 0.85 + i * 0.09, wake: i === 0 ? 1 : 0,
      ax: 0, az: 0, ay: 0, w: 8, b: 0, yaw: 0, dip: 0.5, len: 20,
      flare: new K.Envelope(0.4),
    }));
    const nl = LIGHTS.length;
    this.towerInst = r.createInstances(nl);
    this.beams = r.createInstances(nl);
    this.pools = r.createInstances(nl);
    this.glows = r.createInstances(nl);

    // ---- camera: a high, slow orbit looking down at the middle of town
    this.cam = new K.OrbitRig({ center: [0, 0, 0], radius: 38, height: 29, bob: 1.0, pushIn: 0, fov: 50, far: 260,
      idleSpeed: 0.022, activeSpeed: 0.055, bassBoost: 0, fovPunch: 1.5, nudge: 0.12, rollKick: 0.01 });

    this.m = mat4.create();
    this.time = 0; this.k = 0; this.a = null;
    this.en = 0;            // smoothed energy
    this.melt = 0;          // eased peak distortion 0..1
    this.amp = 0;
    this.col = { fog: [0, 0, 0], tint: [1, 1, 1], light: [0, 0, 0], amb: [0, 0, 0], one: [1, 1, 1] };
  }

  /** Melt wave height at (x, z): a ripple running out from the middle plus a slow diagonal roll. */
  _wave(x, z) {
    const t = this.time;
    return (Math.sin(Math.hypot(x, z) * 0.2 - t * 1.6) * 0.6 + Math.sin(x * 0.12 + z * 0.09 + t * 1.05) * 0.4) * this.amp * 1.8;
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k), t = this.time;
    this.en = damp(this.en, d.energy, 0.8, dt);
    this.cam.update(a, k, dt);

    // peak distortion: eased in slowly, settles back a little faster
    const mt = K.stage(k, 0.74, 0.98);
    this.melt = damp(this.melt, mt, mt > this.melt ? 1.6 : 1.1, dt);
    this.amp = this.melt * (0.6 + 0.4 * this.en);
    this.cam.roll = Math.sin(t * 0.55) * 0.05 * this.melt;

    // ---- searchlights
    const tight = K.stage(k, 0.15, 1), conv = K.stage(k, 0.45, 1) * 0.35;
    const sweepR = lerp(30, 21, tight), sp = lerp(0.09, 0.3, k) + this.en * 0.12;
    const fx = Math.sin(t * 0.11) * 14, fz = Math.cos(t * 0.083) * 14;   // wandering focus the beams converge on
    this.lights.forEach((L, i) => {
      if (i > 0) L.wake = K.stage(k, 0.12 + (i - 1) * 0.17, 0.3 + (i - 1) * 0.17);
      L.phT += dt * sp * L.rate;
      if (d.beat && L.wake > 0.05) {
        L.phT += (0.35 + 0.35 * k) * d.motion;          // the beam snaps ahead along its sweep
        L.flare.trigger(k * L.wake);
      }
      L.ph = damp(L.ph, L.phT, 0.08, dt);
      L.flare.update(dt);
      let ax = Math.sin(L.ph + i * 1.3) * sweepR, az = Math.sin(L.ph * 0.71 + i * 2.1) * sweepR * 0.9;
      const ox = Math.cos(L.ph * 1.9 + i) * 5, oz = Math.sin(L.ph * 1.9 + i) * 5;
      ax = lerp(ax, fx + ox, conv); az = lerp(az, fz + oz, conv);
      L.ax = ax; L.az = az; L.ay = this._wave(ax, az);
      L.w = lerp(9, 5.2, tight) * (1 + L.flare.v * 0.3);
      L.b = L.wake * (0.55 + k * 0.3 + L.flare.v * 0.9);
    });

    // thumbnails call update before the first render: keep update self-contained
    this._layout(d);
  }

  /** Per-frame instance data: houses brighten under the pools; the melt lifts, tilts and sags everything. */
  _layout(d) {
    const t = this.time, k = this.k, amp = this.amp, dim = lerp(0.72, 1, k), lights = this.lights;
    const winOn = lerp(0.24, 0.72, K.stage(k, 0.05, 0.9));
    this.houses.forEach((h, i) => {
      const y = this._wave(h.x, h.z);
      let boost = 0;
      for (const L of lights) {
        if (L.b <= 0.01) continue;
        const dx = h.x - L.ax, dz = h.z - L.az, rr = (dx * dx + dz * dz) / (L.w * L.w * 0.7);
        if (rr < 1) boost += L.b * (1 - rr);
      }
      this.lit[i] = boost;
      const rx = amp * 0.24 * Math.sin(h.z * 0.19 + t * 1.4), rz = amp * 0.24 * Math.cos(h.x * 0.17 - t * 1.2);
      const hs = h.hs * (1 - amp * 0.32 * (0.5 + 0.5 * Math.sin(t * 1.3 + h.ph)));
      this.houseInst.set(i, h.x, y, h.z, h.s, h.rot, h.shade * dim + boost * 0.85, h.ph, hs, rx, rz);
      // windows: a few lit at idle, more with the swell; some flicker with the highs
      const on = K.stage(winOn, h.win - 0.06, h.win + 0.06);
      const fl = h.flick ? 1 - d.high * 0.5 * (Math.sin(t * 23 + h.ph) > 0.3 ? 1 : 0) : 1;
      const wb = 0.1 * dim + on * (0.55 + 0.35 * k) * fl * (0.9 + 0.1 * Math.sin(t * 0.7 + h.ph));
      this.winInst.set(i, h.x, y, h.z, h.s, h.rot, wb + boost * 0.3, h.ph, hs, rx, rz);
    });
    this.houseInst.upload(this.houses.length); this.winInst.upload(this.houses.length);
    this.trees.forEach((tr, i) => this.treeInst.set(i, tr.x, this._wave(tr.x, tr.z) - 0.1, tr.z, tr.s * 0.55, 0, 0.85 * dim, tr.ph, 1 / 0.55));
    this.treeInst.upload(this.trees.length);

    // towers ride the wave and tilt; beams start at the (tilted) lamp head
    lights.forEach((L, i) => {
      const y = this._wave(L.x, L.z);
      const rx = amp * 0.12 * Math.sin(L.z * 0.19 + t * 1.4), rz = amp * 0.12 * Math.cos(L.x * 0.17 - t * 1.2);
      const hh = TOWER_H * L.sc - 0.25 * L.sc;
      L.hx = L.x - Math.sin(rz) * hh * Math.cos(rx); L.hy = y + Math.cos(rz) * hh * Math.cos(rx); L.hz = L.z + hh * Math.sin(rx);
      this.towerInst.set(i, L.x, y, L.z, L.sc, 0, 0.7 * dim + L.b * 0.2, 0, 1, rx, rz);
      const dx = L.ax - L.hx, dy = L.ay - L.hy, dz = L.az - L.hz, len = Math.hypot(dx, dy, dz) || 1;
      L.len = len; L.yaw = Math.atan2(dx, dz); L.dip = Math.asin(clamp(-dy / len, -1, 1));
      const s = L.w;
      this.beams.set(i, L.hx, L.hy, L.hz, s, L.yaw, L.b * 0.32, 0, len / s, Math.PI / 2 + L.dip);
      this.pools.set(i, L.ax, L.ay + 0.3, L.az, s * 1.15, L.yaw, L.b * 0.85, 0, Math.min(2.4, 1 / Math.max(0.3, Math.sin(L.dip))), Math.PI / 2);
      this.glows.set(i, L.hx, L.hy, L.hz, (2.2 + L.flare.v * 3) * L.sc, 0, L.wake * (0.7 + L.flare.v * 0.8 + d.high * 0.2), 0, 1);
    });
    const nl = lights.length;
    [this.towerInst, this.beams, this.pools, this.glows].forEach((x) => x.upload(nl));
  }

  /** Lift the ground vertices on the melt wave (skipped once it's flat again). */
  _updateGround() {
    if (this.amp < 1e-4) {
      if (this.groundFlat) return;
      this.groundGeo.positions.set(this.groundBase);
      this.groundMesh.update({ positions: this.groundGeo.positions });
      this.groundFlat = true;
      return;
    }
    const p = this.groundGeo.positions, b = this.groundBase;
    for (let i = 0; i < p.length; i += 3) p[i + 1] = this._wave(b[i], b[i + 2]);
    this.groundMesh.update({ positions: p });
    this.groundFlat = false;
  }

  render(r) {
    const { col, k } = this, P = this.pal, a = this.a, d = K.drive(a, k);
    const dim = lerp(0.72, 1, k);
    scaleColor(col.fog, P.role('fog'), lerp(0.75, 1, k));
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 30, lerp(78, 98, k));
    r.setLight([-0.3, -0.8, 0.45], scaleColor(col.light, P.role('light'), lerp(0.75, 1, k)), scaleColor(col.amb, P.role('ambient'), lerp(0.85, 1, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    this._updateGround();
    r.draw(this.groundMesh, mat4.identity(this.m), { texture: this.lotTex, tint: col.tint });
    const melt = this.amp;
    r.drawInstanced(this.houseMesh, this.houseInst, { texture: this.houseTex, sway: melt * 0.2 });
    r.drawInstanced(this.winMesh, this.winInst, { texture: this.winTex, unlit: true, sway: melt * 0.2 });
    r.drawInstanced(this.quad, this.treeInst, { texture: this.pineTex, billboard: 1, sway: 0.015 + d.mid * 0.03 + melt * 0.12 });
    r.drawInstanced(this.towerMesh, this.towerInst, { texture: this.metalTex, sway: melt * 0.03 });

    // additive light last: pools and cones ignore fog but fade with distance, so they never pop
    col.one[0] = col.one[1] = col.one[2] = lerp(0.8, 1, k);
    r.drawInstanced(this.poolMesh, this.pools, { texture: this.poolTex, unlit: true, additive: true, depthWrite: false, fog: false, fade: [60, 120], tint: col.one });
    r.drawInstanced(this.beamMesh, this.beams, { texture: this.beamTex, unlit: true, additive: true, depthWrite: false, fog: false, fade: [60, 130], tint: col.one });
    r.drawInstanced(this.poolMesh, this.glows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, depthWrite: false, fog: false, fade: [70, 140], tint: col.one });
  }

  dispose(r) {
    [this.groundMesh, this.houseMesh, this.winMesh, this.quad, this.towerMesh, this.beamMesh, this.poolMesh].forEach((m) => m.dispose());
    [this.lotTex, this.houseTex, this.winTex, this.pineTex, this.metalTex, this.beamTex, this.poolTex, this.glowTex].forEach((t) => r.deleteTexture(t));
    [this.houseInst, this.winInst, this.treeInst, this.towerInst, this.beams, this.pools, this.glows].forEach((i) => i.dispose());
  }
}
