// KIT DEMO — reference environment that uses every world-kit piece.
// Copy this file as the starting point for a new environment.
//
//   sky dome + stars + moon + clouds     K.Sky
//   rolling infinite hills               K.Terrain + K.fbm
//   instanced billboard pines & bushes   r.drawInstanced(..., { billboard: 1, sway })
//   street lamps that switch on one by one as the band swells   K.stage
//   chain-link fence with see-through holes                     K.sprites.chainLink
//   snow when idle, fireflies when playing                      K.Particles
//   camera dolly along a looping spline, hugging the ground     K.DollyRig
//   Kit v2: ground dither-crossfades to a second texture         draw { texture2, blend }
//           lanterns swing under the lamp arms                   K.Pendulum + instance tilt
//           lamp glows shine through fog without popping          draw { fog: false, fade }
//           neon sign whose letters switch on one by one          K.NeonText
//           custom moon disc, scatter with distance fade          Sky { moonTexture }, K.scatter, K.fadeOut
//   Kit v4: gabled house with world-scaled UVs, cracked roof      K.props.gableHouse, K.tex.cracks
//           two searchlights sweep the ground, wake with the swell K.Searchlights, K.Follow3
//           the sweep turns round once per bar                    K.BarClock
//           a red streak band in the sky at full intensity        K.skyBand + K.tileBlob, uvOffset scroll
//           beats gust the snow                                   Particles.gust
//   Kit v5: a well yard beside the house (one corner, ~12 draws):
//           ground rings that blight outward from the well        K.ringBands + per-ring blend
//           well, jagged rocks, a net sagging between two poles   K.props.well / rock / sagStrip / sagPosts
//           a beam rising out of the well at full intensity       K.sprites.lightShaft({ fromBottom })
//           beat rings from the well; the house windows flare     K.Ripples.at, K.props.houseWindows
//             as a ring passes them                               + K.sprites.panelLight / panelHalo
//           figures walk out to the well and home again           K.Walkers + K.sprites.figure({ pose: 'walk' })
//           stretched crate instances (one box mesh, any size)    inst.stretch(i, sx, sz)
//           soft additive mist over the yard                      K.Particles 'softMist'
//           (rigs, not used here: K.OrbitFocusRig, K.DriftRig, K.GridWanderRig)
//
// Intensity: idle = dim dusk, slow drift, snow. Playing = lamps on, faster
// flight, trees sway with the song's energy, fireflies, lanterns breathe.
//
// Beat motion follows Feel (d.beatMotion: Gentle 0 ... Punchy 1): anything that
// MOVES or SCALES on a beat is multiplied by it, and a slow d.groove swing pays
// the motion back at Gentle. Raw bands that drive positions are blended
// lerp(d.energy, raw, d.beatMotion), so Punchy is exactly the raw band.
// Light and colour reactions (flares, flicker, window flashes) are left alone.
import { mat4, lerp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { merge } from '../gfx/geometry.js';
import { blotch } from '../gfx/textures.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const TREE_CELL = 5, TREE_RADIUS = 9; // cells around the camera to populate
const IDENT = mat4.create();

export class KitDemo {
  static meta = { name: 'Kit demo', hidden: true };
  static palette = fromKeys('kitdemo', 'Kit Demo', ['#6a7a4a', '#3f7a46', '#ffc36a', '#1c2438']);

  init(r) {
    // ---- world shape
    const height = (x, z) => K.fbm(x * 0.02, z * 0.02, { octaves: 3 }) * 14 + K.ridged(x * 0.008, z * 0.008) * 10 - 8;
    this.ground = new K.Terrain(r, { size: 140, cells: 44, height, uvScale: 0.35 });
    this.groundTex = r.texture(blotch({ ramp: 0, scale: 8, seed: 3 }));
    this.groundTex2 = r.texture(blotch({ ramp: 1, scale: 6, seed: 9, minShade: 1 })); // the swell grows it over
    this.sky = new K.Sky(r, { stars: 140, moon: true, moonDir: [0.4, 0.3, -1], clouds: 7, moonTexture: K.sprites.moon({ ramp: 3 }) });

    // ---- camera path: a wobbly loop, lifted above the ground
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, rad = 70 + Math.sin(i * 2.3) * 18;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      pts.push([x, height(x, z) + 3, z]);
    }
    this.path = new K.Spline(pts);
    this.cam = new K.DollyRig(this.path, { idleSpeed: 2, activeSpeed: 7, bassBoost: 4, lookAhead: 8, groundFn: height, minClearance: 2, fov: 64 });

    // ---- foliage (instanced billboards)
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.pineTex = r.texture(K.sprites.pine({ ramp: 1 }));
    this.bushTex = r.texture(K.sprites.bush({ ramp: 1 }));
    this.trees = r.createInstances(600);
    this.bushes = r.createInstances(400);

    // ---- lamps + fence placed along the path
    this.lampMesh = r.createMesh(K.props.lampPost(4.2, 0.9));
    this.poleTex = r.texture(blotch({ ramp: 3, scale: 4, minShade: 1 }));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.lampInst = r.createInstances(64);
    this.glowInst = r.createInstances(64);
    this.lamps = [];
    const p = [0, 0, 0], q = [0, 0, 0], L = this.path.length;
    for (let s = 0, i = 0; s < L && i < 64; s += 14, i++) {
      this.path.at(s / L, p); this.path.at((s + 1) / L, q);
      let tx = q[0] - p[0], tz = q[2] - p[2]; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      const nx = -tz, nz = tx, side = i % 2 ? 1 : -1; // alternate sides of the path
      const x = p[0] + nx * 4 * side, z = p[2] + nz * 4 * side, y = height(x, z);
      const rot = Math.atan2(nz * side, -nx * side); // arm points back at the path
      this.lamps.push({ x, y, z, rot, hx: x - nx * side * 0.9, hz: z - nz * side * 0.9 });
    }
    // lanterns hang from the lamp heads (pivot at the hook, so instance tilt swings them)
    this.lanternMesh = r.createMesh(merge([
      { geo: K.props.shift(K.props.prism(4, 0.03, 0.5, { cap: false }), 0, -0.5, 0) },
      { geo: K.props.shift(K.props.prism(6, 0.16, 0.34, { taper: 0.6 }), 0, -0.84, 0) },
    ]));
    this.lanternInst = r.createInstances(64);
    this.swingX = new K.Pendulum(1.6, 0.4); this.swingZ = new K.Pendulum(1.45, 0.45);
    // neon sign beside the start of the loop, facing the path
    this.path.at(0, p); this.path.at(2 / L, q);
    const tx = q[0] - p[0], tz = q[2] - p[2], tl = Math.hypot(tx, tz), sx = p[0] - (tz / tl) * 8, sz = p[2] + (tx / tl) * 8;
    this.signPos = [sx, height(sx, sz) + 3.2, sz, Math.atan2(p[0] - sx, p[2] - sz)];
    this.sign = new K.NeonText(r, 'KIT DEMO', { height: 1.1 });
    this.fenceMesh = r.createMesh(K.props.fence(4, 1.8, 2));
    this.fenceTex = r.texture(K.sprites.chainLink({ index: R(3, 3), dark: R(3, 2) }));
    this.fenceInst = r.createInstances(80);
    let n = 0;
    for (let s = 0; s < L * 0.45 && n < 80; s += 4, n++) {
      this.path.at(s / L, p); this.path.at((s + 4) / L, q);
      const mx = (p[0] + q[0]) / 2, mz = (p[2] + q[2]) / 2;
      let tx = q[0] - p[0], tz = q[2] - p[2]; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      const x = mx + tz * 6, z = mz - tx * 6;
      this.fenceInst.set(n, x, height(x, z) - 0.1, z, 1, Math.atan2(-tz, tx), 1, 0, 1);
    }
    this.fenceInst.upload(n);

    // ---- Kit v4: a gabled house behind the sign, two searchlights, a sky band
    const hx = sx - (tz / tl) * 7, hz = sz + (tx / tl) * 7, house = K.props.gableHouse(6, 5, 3, 2.2);
    this.wallMesh = r.createMesh(house.walls); this.roofMesh = r.createMesh(house.roof);
    this.houseM = mat4.trs(mat4.create(), hx, height(hx, hz) - 0.3, hz, 0, this.signPos[3], 0);
    this.wallTex = r.texture(K.props.planks({ ramp: 0 }));
    this.roofTex = r.texture(K.tex.cracks({ ramp: 3, cells: 4, patches: null }));
    this.towers = [[hx + 9, hz - 6], [hx - 10, hz + 7]].map(([x, z]) => [x, height(x, z) + 10, z]);
    this.mastMesh = r.createMesh(merge(this.towers.map(([x, y, z]) => ({ geo: K.props.shift(K.props.prism(4, 0.35, 10.2, { taper: 0.4 }), x, y - 10.1, z) }))));
    this.search = new K.Searchlights(r, { max: 2 });
    this.aims = this.towers.map((t) => new K.Follow3([t[0], t[1] - 10, t[2]], { freq: 0.5, damping: 0.9 }));
    this.bar = new K.BarClock({ backup: [8, 14] });
    this.sweep = 0; this.sweepDir = 1; this.aimT = [0, 0, 0];
    this.bandMesh = r.createMesh(K.skyBand(0.04, 0.32, { uRepeat: 4 }));
    this.bandTex = r.texture(K.makeIndexed(64, 32, (x, y) => (K.tileBlob(x, y * 2, 16, 5) * (1 - Math.abs(y - 16) / 16) > 0.32 + K.bayer(x, y) * 0.2 ? R(2, 2) : K.CLEAR)));
    this.height = height;

    // ---- Kit v5: a well yard beside the house
    const wx = hx + (tx / tl) * 9, wz = hz + (tz / tl) * 9, wy = height(wx, wz);
    this.wellPos = [wx, wy, wz];
    this.rings = K.ringBands([0, 3, 6, 10, 15], { height: (x, z) => height(x, z) + 0.06, cx: wx, cz: wz, segs: [12, 20, 24, 28], uv: 0.35 });
    this.ringMeshes = this.rings.map((g) => r.createMesh(g.geo));
    this.wellMesh = r.createMesh(K.props.well(1.2, 0.9, 0.9));
    this.stoneTex = r.texture(K.tex.cracks({ ramp: 3, cells: 6, patches: null }));
    this.rockMesh = r.createMesh(K.props.rock(4, { spike: 0.6 }));
    this.rockInst = r.createInstances(6);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.7 + 0.4, rad = 4.5 + (i % 3) * 3.2, x = wx + Math.cos(a) * rad, z = wz + Math.sin(a) * rad;
      this.rockInst.set(i, x, height(x, z) + 0.1, z, 0.5 + (i % 3) * 0.25, a * 2, 0.9, 0, 0.8);
    }
    this.rockInst.upload(6);
    const nx2 = wx + (tz / tl) * 6, nz2 = wz - (tx / tl) * 6;
    this.netM = mat4.trs(mat4.create(), nx2, height(nx2, nz2), nz2, 0, this.signPos[3] + Math.PI / 2, 0);
    this.netMesh = r.createMesh(K.props.sagStrip(5, 2, 0.5));
    this.netPosts = r.createMesh(K.props.sagPosts(5, 2));
    this.netTex = r.texture(K.sprites.chainLink({ index: R(1, 2), dark: R(1, 1) }));
    // crates: one box mesh, each instance stretched to its own size
    this.crateMesh = r.createMesh(K.props.crate(1));
    this.crateInst = r.createInstances(4);
    [[1.6, 0.8, 1], [0.7, 1.2, 0.7], [2.4, 0.5, 0.9], [1, 1, 1]].forEach(([sx, sy, sz], i) => {
      const x = hx + (i - 1.5) * 1.6 + 4, z = hz + 3.4;
      this.crateInst.set(i, x, height(x, z), z, 1, this.signPos[3] + i * 0.3, 1, 0, sy);
      this.crateInst.stretch(i, sx, sz);
    });
    this.crateInst.upload(4);
    // the beam: a tall quad standing on the well, brightest at the bottom
    this.beamMesh = r.createMesh(K.billboardQuad(2.2, 26));
    this.beamTex = r.texture(K.sprites.lightShaft({ ramp: 2, fromBottom: true }));
    this.beamInst = r.createInstances(1);
    // beat rings from the well; the house windows flare as a ring reaches them
    this.ripples = new K.Ripples(r, { max: 6, color: R(2, 2), life: 4 });
    const hm = { x: hx, y: height(hx, hz) - 0.3, z: hz, rotY: this.signPos[3] };
    this.windows = K.props.houseWindows(hm, { w: 6, h: 3, d: 5 }, { rows: [0.5], cols: [-0.3, 0.3] })
      .concat(K.props.houseWindows(hm, { w: 6, h: 3, d: 5 }, { rows: [0.5], cols: [-0.3, 0.3], face: 'back' }));
    this.winMesh = r.createMesh(K.centredQuad(0.8, 0.9));
    this.haloMesh = r.createMesh(K.centredQuad(2.4, 2));
    this.winTex = r.texture(K.sprites.panelLight({ ramp: 2 }));
    this.haloTex = r.texture(K.sprites.panelHalo({ ramp: 2 }));
    this.winInst = r.createInstances(this.windows.length);
    this.haloInst = r.createInstances(this.windows.length);
    // figures: walk out from the house door to the well as the band swells, home when it drops
    this.walkers = new K.Walkers(6, { from: [0.25, 0.8], length: Math.hypot(wx - hx, wz - hz) - 3 });
    this.figTex = [0, 1].map((f) => r.texture(K.sprites.figure({ pose: 'walk', frame: f })));
    this.figInst = [r.createInstances(6), r.createInstances(6)];
    this.door = [hx + (wx - hx) * 0.2, hz + (wz - hz) * 0.2];
    this.mist = new K.Particles(r, 'softMist', { count: 6, area: [30, 1.2, 30] });

    // ---- weather
    this.snow = new K.Particles(r, 'snow');
    this.flies = new K.Particles(r, 'fireflies');

    this.moonPulse = new K.Envelope(0.25);
    this.m = mat4.create();
    this.time = 0; this.k = 0; this.a = null;
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], band: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k);
    this.cam.update(a, k, dt);
    this.ground.follow(this.cam.eye[0], this.cam.eye[2]);
    if (d.beat) this.moonPulse.trigger(k);   // light flash on the searchlights; the moon only grows with it at Punchy (render)
    this.moonPulse.update(dt);
    // bass pumps the lantern swing in phase with its motion, so it builds up instead of jerking
    for (const pd of [this.swingX, this.swingZ]) {
      pd.push((Math.sign(pd.v) || 1) * (lerp(d.energy, d.bass, d.beatMotion) * 0.12 * dt + (d.beat ? 0.06 * d.beatMotion : 0)));
      pd.push(Math.sin(this.time * 0.7) * 0.03 * dt); // a faint idle breeze
      pd.update(dt);
    }
    const n = this.sign.n;
    this.sign.setAll((i) => K.stage(k, 0.1 + (i / n) * 0.5, 0.18 + (i / n) * 0.5) * (0.85 + 0.15 * Math.sin(this.time * 17 + i * 3) * d.high + d.pulse * 0.5));
    const eye = this.cam.eye;
    // searchlights: each bar the sweep turns round; Follow3 glides the aim, so the turn never snaps
    if (this.bar.update(a, dt)) this.sweepDir = -this.sweepDir;
    this.sweep += dt * (0.12 + 0.25 * k) * this.sweepDir;
    this.towers.forEach((t, i) => {
      const ang = this.sweep * (i ? 1.3 : 1) + i * 2.1, T = this.aimT;
      T[0] = t[0] + Math.cos(ang) * 14; T[2] = t[2] + Math.sin(ang) * 14; T[1] = this.height(T[0], T[2]);
      const wake = K.stage(k, 0.2 + i * 0.2, 0.4 + i * 0.2);
      this.search.set(i, t, this.aims[i].update(T, dt), { width: 5, brightness: wake * (0.65 + this.moonPulse.v * 0.35) });
    });
    this.search.upload(eye);
    if (d.beat && d.beatMotion > 0) this.snow.gust(0.8 * d.accent * d.beatMotion);
    this.snow.update(dt, eye, { amount: K.swell(k, 0.7, 0.15), speed: 1 + lerp(d.energy, d.level, d.beatMotion) });
    this.flies.update(dt, [eye[0], this.ground.heightAt(eye[0], eye[2]) + 2, eye[2]], { amount: k, speed: 1 + lerp(d.energy, d.high, d.beatMotion) * 2 });
    this._yard(d, k, dt, a);
    this._scatter();
  }

  /** Kit v5 well yard: spreading rings, beam, beat rings, windows, walkers. */
  _yard(d, k, dt, a) {
    const [wx, wy, wz] = this.wellPos, t = this.time;
    const spread = K.swell(k, 1, 17);                                   // blight front radius
    this.rings.forEach((g) => { g.blend = Math.min(1, Math.max(0, (spread - g.mid) / 5)) * 0.85; });
    this.beam = K.stage(k, 0.65, 1);
    this.beamInst.set(0, wx, wy + 0.5, wz, 1, 0, this.beam * (0.8 + 0.2 * Math.sin(t * 1.3)), 0, 1);
    this.beamInst.upload(1);
    // the ring: every beat at Punchy, once a bar at Gentle
    if (d.beat && k > 0.1 && (d.beatMotion > 0.5 || ((a.bpm || 0) > 0 && Number.isFinite(a.bar) ? (a.bar | 0) === 0 : (a.beatCount || 0) % 4 === 0))) this.ripples.spawn(wx, wy + 0.1, wz, 34, 0.4 + 0.6 * d.accent * k);
    this.ripples.update(dt);
    this.windows.forEach((w, i) => {
      const lit = K.stage(k, 0.1 + i * 0.08, 0.3 + i * 0.08) * 0.7 + this.ripples.at(w.x, w.z, 3) * 0.8;
      this.winInst.set(i, w.x, w.y, w.z, 1, this.signPos[3] + (i >= 2 ? Math.PI : 0), 0.25 + lit, 0, 1);
      this.haloInst.set(i, w.x, w.y, w.z, 1, 0, lit * 0.6, 0, 1);
    });
    this.winInst.upload(this.windows.length); this.haloInst.upload(this.windows.length);
    const n = [0, 0], [dx, dz] = this.door, ux = wx - dx, uz = wz - dz, ul = Math.hypot(ux, uz);
    for (const w of this.walkers.update(k, dt, { speed: 1.1 + k * 0.4 })) {
      if (w.d < 0.05) continue;
      const lane = (w.i - 2.5) * 0.7, x = dx + (ux / ul) * w.d - (uz / ul) * lane, z = dz + (uz / ul) * w.d + (ux / ul) * lane;
      const f = Math.sin(w.phase) > 0 ? 0 : 1, fade = Math.min(1, w.d / 2);
      this.figInst[f].set(n[f]++, x, this.height(x, z) - 0.05, z, 0.9, 0, 0.8 * fade, 0, 2);
    }
    this.figInst[0].upload(n[0]); this.figInst[1].upload(n[1]);
    this.mist.update(dt, [wx, wy + 0.8, wz], { amount: K.swell(k, 1, 0.5) });
  }

  /** Deterministic foliage in world cells around the camera (infinite forest), shrinking away at the edge. */
  _scatter() {
    const e = this.cam.eye, edge = TREE_RADIUS * TREE_CELL;
    let nt = 0, nb = 0;
    K.scatter(e[0], e[2], { cell: TREE_CELL, radius: TREE_RADIUS, seed: 2, jitter: 1 }, (x, z, dist, gx, gz) => {
      const h = K.rand2(gx, gz, 1), fade = K.fadeOut(dist, edge - 10, edge);
      // keep the flight path clear: skip cells near the loop radius band
      const rr = Math.hypot(x, z);
      if (fade <= 0 || Math.abs(rr - 70) < 9 + Math.sin(Math.atan2(z, x) * 2.3) * 2) return;
      const y = this.ground.heightAt(x, z);
      if (h < 0.42 && nt < this.trees.max) {
        const s = (3.5 + K.rand2(gx, gz, 4) * 3) * fade;
        this.trees.set(nt++, x, y - 0.2, z, s * 0.55, 0, 0.8 + K.rand2(gx, gz, 5) * 0.4, h * 50, 1 / 0.55);
      } else if (h > 0.8 && nb < this.bushes.max) {
        this.bushes.set(nb++, x, y - 0.1, z, 1.6 * fade, 0, 0.9, h * 30, 0.75);
      }
    });
    this.trees.upload(nt); this.bushes.upload(nb);
  }

  render(r) {
    const { col, k } = this, a = this.a, P = this.pal, d = K.drive(a, k), eye = this.cam.eye;
    const dim = lerp(0.65, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);

    this.sky.draw(r, eye, { horizon: col.fog, zenith: P.color(R(3, 0)), brightness: dim, starLevel: 0.25 + d.high * 0.8, moonScale: 1 + this.moonPulse.v * 0.15 * d.beatMotion + (1 - d.beatMotion) * d.groove * 0.04, cloudDrift: this.time * 0.01 });

    r.setFog(col.fog, 8, lerp(45, 70, k));
    r.setLight([-0.4, -0.7, 0.5], scaleColor(col.light, P.role('light'), lerp(0.45, 0.85, k)), scaleColor(col.amb, P.role('ambient'), 0.45));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    // sky band behind everything: centred on the eye, additive, scrolling, only near full intensity
    scaleColor(col.band, P.role('glow'), K.stage(k, 0.6, 1) * 0.7);
    if (col.band[0] + col.band[1] + col.band[2] > 0.01) r.draw(this.bandMesh, mat4.trs(this.m, eye[0], eye[1], eye[2]), { texture: this.bandTex, unlit: true, fog: false, additive: true, depthWrite: false, tint: col.band, uvOffset: [this.time * 0.01, 0] });

    this.ground.draw(r, { texture: this.groundTex, texture2: this.groundTex2, blend: K.stage(k, 0.15, 0.9) * 0.85, tint: col.tint });
    const sway = 0.02 + lerp(d.energy, d.bass, d.beatMotion) * 0.12;
    r.drawInstanced(this.quad, this.trees, { texture: this.pineTex, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.bushes, { texture: this.bushTex, billboard: 1, sway: sway * 0.5, tint: col.tint });
    r.drawInstanced(this.fenceMesh, this.fenceInst, { texture: this.fenceTex, tint: col.tint });
    r.draw(this.wallMesh, this.houseM, { texture: this.wallTex, tint: col.tint });
    r.draw(this.roofMesh, this.houseM, { texture: this.roofTex, tint: col.tint });
    r.draw(this.mastMesh, mat4.identity(this.m), { texture: this.poleTex, tint: col.tint });

    // Kit v5 well yard
    this.ringMeshes.forEach((m, i) => r.draw(m, IDENT, { texture: this.groundTex, texture2: this.groundTex2, blend: this.rings[i].blend, tint: col.tint }));
    const [wx, wy, wz] = this.wellPos;
    r.draw(this.wellMesh, mat4.trs(this.m, wx, wy, wz), { texture: this.stoneTex, tint: col.tint });
    r.drawInstanced(this.rockMesh, this.rockInst, { texture: this.stoneTex, tint: col.tint });
    r.drawInstanced(this.crateMesh, this.crateInst, { texture: this.wallTex, tint: col.tint });
    r.draw(this.netPosts, this.netM, { texture: this.poleTex, tint: col.tint });
    r.draw(this.netMesh, this.netM, { texture: this.netTex, twoSided: true, tint: col.tint });
    r.drawInstanced(this.winMesh, this.winInst, { texture: this.winTex, unlit: true, tint: [1, 1, 1] });
    r.drawInstanced(this.haloMesh, this.haloInst, { texture: this.haloTex, billboard: 2, unlit: true, additive: true, depthWrite: false, tint: [1, 1, 1] });
    r.drawInstanced(this.quad, this.figInst[0], { texture: this.figTex[0], billboard: 1, tint: col.tint });
    r.drawInstanced(this.quad, this.figInst[1], { texture: this.figTex[1], billboard: 1, tint: col.tint });
    this.ripples.draw(r, { brightness: 0.7 });
    if (this.beam > 0.01) r.drawInstanced(this.beamMesh, this.beamInst, { texture: this.beamTex, billboard: 1, unlit: true, additive: true, depthWrite: false, fog: false, fade: [50, 90], tint: [1, 1, 1] });
    this.mist.draw(r, { brightness: dim });

    // lamps switch on one after another as the band swells in
    const nl = this.lamps.length;
    this.lamps.forEach((l, i) => {
      const on = K.stage(k, 0.05 + (i / nl) * 0.6, 0.15 + (i / nl) * 0.6);
      const flick = on * (0.85 + 0.15 * Math.sin(this.time * 13 + i * 7)) * (1 + d.high * 0.6);
      this.lampInst.set(i, l.x, l.y, l.z, 1, l.rot, 1, 0, 1);
      this.glowInst.set(i, l.hx, l.y + 3.85, l.hz, 1.6 + d.pulse * 0.8 * d.beatMotion + (1 - d.beatMotion) * d.groove * 0.3, 0, flick, 0, 1);
      // each lantern swings with the shared pendulums, phase-shifted along the path
      const c = Math.cos(i * 1.3), sn = Math.sin(i * 1.3);
      this.lanternInst.set(i, l.hx, l.y + 4.0, l.hz, 1, l.rot, 0.9, 0, 1, this.swingX.x * c - this.swingZ.x * sn, this.swingZ.x * c + this.swingX.x * sn);
    });
    this.lampInst.upload(nl); this.glowInst.upload(nl); this.lanternInst.upload(nl);
    r.drawInstanced(this.lampMesh, this.lampInst, { texture: this.poleTex, tint: col.tint });
    r.drawInstanced(this.lanternMesh, this.lanternInst, { texture: this.poleTex, tint: col.tint });
    // glows ignore fog (so they shine through it) but fade with distance, so they never pop at the far edge
    r.drawInstanced(this.quad, this.glowInst, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [40, 75], tint: [1, 1, 1] });
    const sp = this.signPos;
    this.sign.draw(r, mat4.trs(this.m, sp[0], sp[1], sp[2], 0, sp[3], 0), { additive: true, fog: false, fade: [30, 60], tint: P.role('glow') });

    this.search.draw(r, { fade: [50, 90] });
    this.snow.draw(r, { brightness: dim * 0.9 });
    this.flies.draw(r, { brightness: k });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.snow.dispose(r); this.flies.dispose(r);
    this.sign.dispose(r); this.search.dispose(r); this.ripples.dispose(r); this.mist.dispose(r);
    [this.quad, this.lampMesh, this.fenceMesh, this.lanternMesh, this.wallMesh, this.roofMesh, this.bandMesh, this.mastMesh,
      ...this.ringMeshes, this.wellMesh, this.rockMesh, this.netMesh, this.netPosts, this.crateMesh, this.beamMesh, this.winMesh, this.haloMesh].forEach((m) => m.dispose());
    [this.groundTex, this.groundTex2, this.pineTex, this.bushTex, this.poleTex, this.glowTex, this.fenceTex, this.wallTex, this.roofTex, this.bandTex,
      this.stoneTex, this.netTex, this.beamTex, this.winTex, this.haloTex, ...this.figTex].forEach((t) => r.deleteTexture(t));
    [this.trees, this.bushes, this.lampInst, this.glowInst, this.fenceInst, this.lanternInst,
      this.rockInst, this.crateInst, this.beamInst, this.winInst, this.haloInst, ...this.figInst].forEach((i) => i.dispose());
  }
}
