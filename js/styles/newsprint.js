// NEWSPRINT — towers of dithered paper stacks, loose pages drifting like birds.
// (Wave 4b, for Daily Mail.)
//
//   leaning towers of tied paper bundles      instanced boxes, K.boxAtlas (print top, sheet-edge sides)
//   folded pages gliding / flapping in flocks  K.School ('bird', two flocks: gliding idle, flapping active)
//   a page storm whirling around the camera    local PageStorm (tumbling instanced quads, gust impulses)
//   litter on the ground, soft haze             flat instanced pages, fog
//   slow orbit through the stacks               K.OrbitRig (no bass-driven speed or push-in)
//
// Intensity: idle = a few pages float and glide, the stacks stand still in a
// soft haze. The bottom ~30 % stays calm. Swell (the band explodes in) = the
// pages whip into a storm around the camera and the stacks sway, driven by
// smoothed energy and eased. Beat = a gust: a velocity burst through the
// storm and a push on the towers, scaled by audio.accent / motion.
// Page "print" is abstract dithered blocks and lines only: no text, no mastheads.
// Song sections (K.Moods, Conductor on): intro / breakdown / outro hold the storm back (a few
// pages float, the stacks stand still); a build sets the stacks swaying and gathers more pages
// into the flocks, circling tighter round the central stacks; the drop whips the page storm up around the camera,
// whose orbit eases in (slowly, never inside today's k = 1 reach). Conductor off = base.
import { mat4, lerp, clamp, damp, smoothstep } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const TAU = Math.PI * 2;
const CENTER = [0, 3.5, 0], ORBIT = 17;
const SILENT = { level: 0, bass: 0, mid: 0, high: 0, beat: false, beatPulse: 0, beatCount: 0, energy: 0 };

// ---------------------------------------------------------------- textures

/**
 * One abstract printed page into `set(x, y, index)` over a w×h area:
 * margin, a heavy dithered band, columns of grey rules (never letters),
 * one dithered "photo" block. ink = dark ramp, paperRamp = page colour.
 */
function printInto(w, h, set, { paperRamp = 2, inkRamp = 3, seed = 1 } = {}) {
  const cols = w >= 24 ? 3 : 2, m = Math.max(1, Math.round(w / 14));
  const colW = Math.floor((w - m * 2) / cols);
  const photoCol = Math.floor(K.rnd(seed, 1, 7) * cols), photoY0 = Math.floor(h * (0.3 + K.rnd(seed, 2, 7) * 0.25));
  const band = Math.max(2, Math.round(h / 12));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // paper: light shades with a little blotchy ageing
    let idx = K.dshade(paperRamp, 2.35 + K.blobNoise(x, y, 6, seed) * 0.65, x, y);
    const ix = x - m, iy = y - m;
    if (ix >= 0 && iy >= 0 && x < w - m && y < h - m) {
      const c = Math.floor(ix / colW), lx = ix - c * colW;
      if (iy < band) {
        // a heavy dithered band, broken into blocks (not a masthead: no shapes inside)
        if (lx < colW - 1 && K.rnd(c, 9, seed) > 0.25) idx = K.dshade(inkRamp, 0.6 + K.rnd(x >> 2, y, seed) * 0.6, x, y);
      } else if (c < cols && lx < colW - 1) {
        const ry = iy - band - 1;
        if (c === photoCol && iy >= photoY0 && iy < photoY0 + Math.round(h * 0.28)) {
          // dithered halftone block
          idx = K.dshade(inkRamp, 0.4 + K.blobNoise(x, y, 4, seed + 3) * 1.8, x, y);
        } else if (ry >= 0 && ry % 2 === 0) {
          // a grey rule of random length: reads as print from afar, says nothing up close
          const len = colW - 1 - Math.floor(K.rnd(c * 31 + (ry >> 1), 4, seed) * colW * 0.45);
          if (lx < len) idx = K.dshade(inkRamp, 1.2 + K.rnd(x, y, seed + 6) * 0.8, x, y);
        }
      }
    }
    set(x, y, idx);
  }
}

/** 32×32 loose page. */
function pageTex(seed, paperRamp = 2) {
  const data = new Uint8Array(32 * 32);
  printInto(32, 32, (x, y, i) => { data[y * 32 + x] = i; }, { paperRamp, seed });
  return { data, width: 32, height: 32, indexed: true };
}

/**
 * 32×64 bundle atlas: top half = printed top sheet, bottom half = stacked
 * sheet edges with a twine band. paper = edge ramp.
 */
function bundleTex(seed, paper = 1) {
  const W = 32, H = 64, data = new Uint8Array(W * H);
  printInto(W, 32, (x, y, i) => { data[y * W + x] = i; }, { paperRamp: paper === 1 ? 2 : 1, seed });
  const fresh = paper === 1 ? 2 : 1;
  for (let y = 32; y < H; y++) {
    const ly = y - 32, rowTone = K.rnd(y, 0, seed);
    for (let x = 0; x < W; x++) {
      let idx;
      if (ly === 0 || ly === 31) idx = K.dshade(paper, 1.1, x, y);                                        // bundle seam
      else if (rowTone < 0.1) idx = K.dshade(paper, 1.6 + K.rnd(x >> 3, y, seed) * 0.5, x, y);             // an older sheet
      else if (rowTone > 0.82) idx = K.dshade(fresh, 2.6 + K.rnd(x >> 2, y, seed) * 0.4, x, y);           // a fresher sheet
      else idx = K.dshade(paper, 2.3 + rowTone * 0.8 + (K.rnd(x, y, seed + 2) - 0.5) * 0.35, x, y);
      if (x === 15 || x === 16) idx = K.dshade(0, x === 15 ? 0.8 : 1.3, x, y);                               // twine
      data[y * W + x] = idx;
    }
  }
  return { data, width: W, height: H, indexed: true };
}

/** 8×16 strip for the flocking pages (birdGeo samples a vertical strip). */
function foldTex() {
  return K.makeIndexed(8, 16, (x, y) => (y % 4 === 3 ? K.dshade(3, 1.3, x, y) : K.dshade(2, 2.2 + (y / 16) * 0.8, x, y)));
}

// ---------------------------------------------------------------- page storm

/** A page: a quad centred on its pivot (tumbles around itself), in XY. */
function pageGeo(w = 0.74, h = 0.52) {
  const x = w / 2, y = h / 2;
  return new GeoBuilder().quad([-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build();
}

/**
 * Pages whirling in a box around the camera. Velocities relax toward a swirl
 * field, so a gust (velocity impulse) whips them and then settles; positions
 * only ever integrate, so nothing jumps. Pages shrink to nothing at the box
 * edge (where they wrap) and right at the lens.
 */
class PageStorm {
  constructor(r, mesh, count = 300, area = [30, 14, 30]) {
    this.mesh = mesh; this.n = count; this.area = area;
    this.inst = r.createInstances(count);
    this.p = new Float32Array(count * 3); this.v = new Float32Array(count * 3);
    this.ang = new Float32Array(count * 3); this.seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) {
        this.seed[i * 3 + k] = K.rand2(i, k, 41);
        this.p[i * 3 + k] = (K.rand2(i, k + 5, 41) - 0.5) * area[k];
        this.ang[i * 3 + k] = K.rand2(i, k + 9, 41) * TAU;
      }
    }
    this.amount = 0; this.t = 0; this.count = 0;
  }

  /** c = centre (camera eye); amount 0..1 share of pages shown; swirl u/s; gust = impulse this frame. */
  update(dt, c, { amount = 0, swirl = 0.3, fall = 0.5, flutter = 0.6, wind = [0.3, 0.1], gust = 0, ring = 7, spin = 1 }) {
    this.t += dt;
    this.amount += (amount - this.amount) * Math.min(1, dt * 1.2);
    const N = this.n, P = this.p, V = this.v, A = this.ang, S = this.seed, [ax, ay, az] = this.area, t = this.t;
    const relax = Math.min(1, dt * 1.1);
    let n = 0;
    for (let i = 0; i < N; i++) {
      const o = i * 3, s0 = S[o], s1 = S[o + 1], s2 = S[o + 2];
      const rx = P[o] - c[0], rz = P[o + 2] - c[2], rho = Math.max(0.5, Math.hypot(rx, rz));
      const ux = rx / rho, uz = rz / rho, tx = -uz, tz = ux;
      const sw = swirl * (0.55 + s0 * 0.6), pull = (ring - rho) * 0.12 * swirl / (ring + 1);
      const fl = flutter * (0.6 + s1 * 0.8);
      const gx = wind[0] + tx * sw + ux * pull * 3 + Math.sin(t * 1.1 + s2 * 20) * fl;
      const gy = -fall * (0.45 + s1 * 0.7) + Math.sin(t * 1.7 + s0 * 30) * fl * 0.8;
      const gz = wind[1] + tz * sw + uz * pull * 3 + Math.cos(t * 0.9 + s1 * 20) * fl;
      V[o] += (gx - V[o]) * relax; V[o + 1] += (gy - V[o + 1]) * relax; V[o + 2] += (gz - V[o + 2]) * relax;
      if (gust) {   // a burst along the swirl, lifting and flinging outward a little
        const g = gust * (0.6 + s2 * 0.8);
        V[o] += (tx * 1.0 + ux * 0.35) * g; V[o + 1] += (0.45 + s0 * 0.4) * g; V[o + 2] += (tz * 1.0 + uz * 0.35) * g;
      }
      P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
      // wrap into the box around the centre
      const wx = ((P[o] - c[0] + ax / 2) % ax + ax) % ax - ax / 2;
      const wy = ((P[o + 1] - c[1] + ay / 2) % ay + ay) % ay - ay / 2;
      const wz = ((P[o + 2] - c[2] + az / 2) % az + az) % az - az / 2;
      P[o] = c[0] + wx; P[o + 1] = c[1] + wy; P[o + 2] = c[2] + wz;
      if (P[o + 1] < 0.15) { P[o + 1] = 0.15; V[o + 1] = Math.abs(V[o + 1]) * 0.3; }   // skim the ground, don't sink
      // tumble faster when moving fast
      const sp = Math.hypot(V[o], V[o + 1], V[o + 2]), rate = (0.25 + sp * 0.35) * spin;
      A[o] += dt * rate * (s0 - 0.5) * 3; A[o + 1] += dt * rate * (0.5 + s1); A[o + 2] += dt * rate * (s2 - 0.5) * 4;
      const slot = i / N, grow = clamp((this.amount - slot) * N * 0.15);
      if (grow <= 0.001) continue;
      const edge = Math.max(Math.abs(wx) / (ax / 2), Math.abs(wy) / (ay / 2), Math.abs(wz) / (az / 2));
      const d = Math.hypot(wx, wy, wz);
      const size = grow * (1 - smoothstep(clamp((edge - 0.72) / 0.26))) * K.fadeIn(d, 1.1, 2.6) * (0.8 + s2 * 0.5);
      if (size <= 0.001) continue;
      this.inst.set(n++, P[o], P[o + 1], P[o + 2], size, A[o + 1], 0.75 + s0 * 0.35, 0, 1, A[o], A[o + 2]);
    }
    this.inst.upload(n); this.count = n;
  }

  dispose() { this.inst.dispose(); }
}

// ---------------------------------------------------------------- style

export class Newsprint {
  static meta = { name: 'Newsprint' };
  static palette = ALBUM_PALETTES.tkol;

  init(r) {
    this.sky = new K.Sky(r, { clouds: 6, cloudRamp: 3 });
    this.ground = r.createMesh(new GeoBuilder().face([0, 0, 0], [70, 0, 0], [0, 0, -70], [0, 0, 18, 18], 10).build());
    this.groundTex = r.texture(K.makeIndexed(64, 64, (x, y) => K.blobNoise(x, y, 11, 4) > 0.64 ? K.dshade(0, 0.3 + K.blobNoise(x, y, 5, 6) * 0.6, x, y) : K.dshade(3, 0.75 + K.blobNoise(x, y, 6, 5) * 0.55, x, y)));

    // ---- paper towers: instanced bundles, two paper stocks
    this.bundleMesh = r.createMesh(K.props.shift(K.boxAtlas(2.2, 0.6, 1.6, { top: [0, 0, 1, 0.5], side: [0, 0.5, 1, 1], bottom: [0, 0.5, 1, 1] }), 0, 0.3, 0));
    this.bundleTexA = r.texture(bundleTex(3, 1));   // yellowed stock
    this.bundleTexB = r.texture(bundleTex(8, 2));   // fresh white stock
    this.towers = [];
    let nb = [0, 0];
    const cell = 6.5;
    for (let gx = -6; gx <= 6; gx++) for (let gz = -6; gz <= 6; gz++) {
      const x = (gx + (K.rand2(gx, gz, 1) - 0.5) * 0.8) * cell, z = (gz + (K.rand2(gx, gz, 2) - 0.5) * 0.8) * cell;
      const rho = Math.hypot(x, z);
      if (rho > 42 || Math.abs(rho - ORBIT) < 6.5 || K.rand2(gx, gz, 3) > (rho < 10 ? 0.85 : 0.5)) continue;
      const set = K.rand2(gx, gz, 4) < 0.55 ? 0 : 1;
      const s = 0.85 + K.rand2(gx, gz, 5) * 0.45;
      const count = 4 + Math.floor(K.rand2(gx, gz, 6) * 9) + (rho < 10 ? 5 : 0);
      if (nb[set] + count > 240) continue;
      nb[set] += count;
      const bundles = [];
      let y = 0;
      for (let j = 0; j < count; j++) {
        const bs = s * (0.9 + K.rand2(gx * 7 + j, gz, 7) * 0.2);
        bundles.push({
          y, s: bs,
          ox: (K.rand2(gx, gz * 5 + j, 8) - 0.5) * 0.35, oz: (K.rand2(gx * 3 + j, gz, 9) - 0.5) * 0.35,
          yaw: (K.rand2(j, gx * 13 + gz, 10) - 0.5) * 0.6 + (K.rand2(j, gz, 11) < 0.2 ? Math.PI / 2 : 0),
          shade: 0.78 + K.rand2(j, gx + gz, 12) * 0.3,
        });
        y += 0.6 * bs;
      }
      this.towers.push({ x, z, set, H: y, bundles, ph: K.rand2(gx, gz, 13) * TAU, w: 0.55 + K.rand2(gx, gz, 14) * 0.35, lean: (K.rand2(gx, gz, 15) - 0.5) * 0.04 });
    }
    this.bundleInst = [r.createInstances(240), r.createInstances(240)];

    // ---- loose pages
    this.pageMesh = r.createMesh(pageGeo());
    this.pageTex = r.texture(pageTex(21, 2));
    this.storm = new PageStorm(r, this.pageMesh, 360, [28, 13, 28]);
    this.litter = r.createInstances(160);
    this.litterSeed = [];
    for (let i = 0; i < 160; i++) {
      const a = K.rand2(i, 1, 31) * TAU, rr = 3 + Math.sqrt(K.rand2(i, 2, 31)) * 38;
      this.litterSeed.push([Math.cos(a) * rr, Math.sin(a) * rr, K.rand2(i, 3, 31) * TAU, 1.1 + K.rand2(i, 4, 31) * 0.8, K.rand2(i, 5, 31)]);
    }
    // folded pages flocking like birds: one gliding flock (idle), one flapping flock (swell)
    const fold = foldTex();
    this.glide = new K.School(r, { kind: 'bird', groups: 3, perGroup: 6, size: 1.1, spread: [1.5, 4], lift: 1, texture: fold });
    this.flock = new K.School(r, { kind: 'bird', groups: 4, perGroup: 10, size: 1.0, spread: [1.2, 3.6], lift: 1.2, texture: fold });

    this.cam = new K.OrbitRig({ center: CENTER.slice(), radius: ORBIT, height: 3, bob: 0.7, pushIn: 0, idleSpeed: 0.025, activeSpeed: 0.09, bassBoost: 0, fov: 62, fovPunch: 1.5, nudge: 0.1, rollKick: 0.015, shapeAmount: 0.5 });   // half: close framing would pull the orbit into the inner stacks
    this.cam.angle = 0.6;
    this.towerPush = new K.Spring(1.6);   // beat gusts lean every tower, then they settle
    this.bar = new K.BarClock({ minGap: 1 });   // Gentle: one soft gust per bar
    this.lean = 0;   // eased groove lean (Gentle payback for the beat shove)
    this.eS = 0; this.swayAmt = 0; this.windA = 0.4; this.windTo = 0.4;
    this.m = mat4.create();
    this.time = 0; this.k = 0; this.a = SILENT;
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], page: [0, 0, 0] };

    // song sections: stormGate multiplies the k fed into today's storm stage (clamped 0..1): pages,
    // swirl, gusts, flocks, tower sway. camGate does the same for the camera's share of it (orbit
    // radius / height: a camera position, so slow and eased twice; at most today's k = 1 framing).
    // Mood-only: sway = extra tower sway (× k), flockR = the flocks' circling radius, flockMore =
    // extra pages in the flapping flock (× k).
    this.moods = new K.Moods({
      still:  { stormGate: 0.35, camGate: 0.5, sway: 0,   flockR: 1,    flockMore: 0 },
      base:   { stormGate: 1,    camGate: 1,   sway: 0,   flockR: 1,    flockMore: 0 },
      gather: { stormGate: 1.2,  camGate: 1.1, sway: 1,   flockR: 0.75, flockMore: 1 },
      full:   { stormGate: 1.7,  camGate: 1.7, sway: 0.6, flockR: 1,    flockMore: 0 },
    }, { dropEase: 4, slow: ['camGate'] });
    this.camG = null; this.fr = null; this.more = 0;
  }

  /** Coming on screen (StyleManager.enter, after its moods / rig snap): the mood keys it eases a second time start at the current mood. */
  enter() { this.camG = null; this.fr = null; }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const m = this.moods.update(a, dt);
    const d = K.drive(a, k), t = this.time;
    // slow, eased energy: what the stacks and storm follow (never the raw kick)
    this.eS = damp(this.eS, clamp(a.energy ?? a.level ?? 0), 1.2, dt);
    const ksg = clamp(k * m.stormGate), storm = K.stage(ksg, 0.3, 1), big = storm * (0.45 + 0.55 * this.eS);

    // camera: its own gate, eased a second time so a section change starts softly (radius ≥ ORBIT - 3,
    // today's k = 1 framing: the ring of towers is kept clear 6.5 either side of ORBIT)
    if (this.camG === null) this.camG = m.camGate;
    this.camG = damp(this.camG, m.camGate, 2, dt);
    const bigC = K.stage(clamp(k * this.camG), 0.3, 1) * (0.45 + 0.55 * this.eS);
    this.cam.radius = lerp(ORBIT, ORBIT - 3, bigC);
    this.cam.height = lerp(3, 2.2, bigC);
    this.cam.update(a, k, dt);
    const eye = this.cam.eye;

    // gust on the beat: velocity impulse through the storm + a shove on the towers
    let gust = 0;
    const bm = d.beatMotion, barFire = this.bar.update(a, dt);
    if (d.beat && bm > 0.01) {
      gust = d.accent * (0.8 + 4.2 * storm) * k * bm;
      this.towerPush.kick(d.accent * 0.5 * storm * bm);
      this.windTo += (K.rand2(a.beatCount || 0, 1, 3) - 0.5) * 0.6 * storm * bm;   // gusts veer the wind a little
    }
    if (barFire && bm < 1 && k > 0.05) {      // Gentle: a softer gust once per bar
      gust += d.accent * (0.8 + 4.2 * storm) * k * 0.3 * (1 - bm);
      this.windTo += (K.rand2(a.beatCount || 0, 2, 3) - 0.5) * 0.4 * storm * (1 - bm);
    }
    this.lean = damp(this.lean, d.groove * (1 - bm) * 0.3 * storm, 0.6, dt);   // groove leans the towers slowly
    this.towerPush.update(dt);
    this.windA = damp(this.windA, this.windTo, 1.5, dt);   // eased, so the towers' lean turns, never jumps
    this.swayAmt = damp(this.swayAmt, big + m.sway * K.stage(k, 0.05, 0.5) * 0.45, 1.5, dt);   // build: the stacks sway (× k)

    const wind = 0.25 + big * 1.5;
    this.storm.update(dt, eye, {
      amount: 0.06 + 0.94 * storm * (0.6 + 0.4 * this.eS),
      swirl: lerp(0.25, 1.6, K.stage(ksg, 0.15, 0.6)) + 7.5 * big,
      fall: lerp(0.45, 0.8, storm), flutter: lerp(0.45, 1.3, storm),
      wind: [Math.cos(this.windA) * wind, Math.sin(this.windA) * wind],
      gust, ring: lerp(8, 6, storm), spin: lerp(0.7, 1.6, storm),
    });

    // flocks circle the central stacks, high above at idle, lower and quicker as it swells
    // build: more pages gather into the flocks, circling tighter round the central stacks (eased by
    // the mood, × k; the flocks stay at today's height, above the tallest central stack)
    // (their × k share has its own slow settle, like the mood itself: a song's start / end ramp is fast)
    const kf = K.stage(k, 0.05, 0.5), moreT = m.flockMore * kf, frT = lerp(1, m.flockR, kf);
    if (this.fr === null) { this.more = moreT; this.fr = frT; }
    this.more = damp(this.more, moreT, 2, dt); this.fr = damp(this.fr, frT, 2, dt);
    const more = this.more, fr = this.fr, flockH = lerp(13, 9, storm);
    const centre = (g, tt, out, rad) => {
      const ang = tt * 0.25 + g * (TAU / 4);
      out[0] = Math.cos(ang) * rad + Math.sin(tt * 0.13 + g) * 2;
      out[2] = Math.sin(ang) * rad * 0.85;
      out[1] = flockH + Math.sin(tt * 0.31 + g * 1.7) * 1.5 - g * 0.6;
      return out;
    };
    this.glide.update(dt, (g, tt, out) => centre(g, tt, out, 9 * fr), { amount: lerp(0.5, 0.25, storm), speed: lerp(0.35, 0.7, storm), flap: 0 });
    this.flock.update(dt, (g, tt, out) => centre(g + 0.5, tt, out, 7 * fr), { amount: clamp(storm * (0.5 + 0.5 * this.eS) + more * 0.4), speed: 0.6 + big * 0.9, flap: 0.55 });


    this._towers(t);
    this._litter(t, storm);
  }

  /** Stack every bundle on a bending curve: offset grows with height², tilt follows the slope. */
  _towers(t) {
    const n = [0, 0], A = this.swayAmt, push = this.towerPush.x + this.lean, wa = this.windA;
    const wx = Math.cos(wa), wz = Math.sin(wa);
    for (const tw of this.towers) {
      const H = Math.max(1, tw.H);
      const osc = Math.sin(t * tw.w + tw.ph) * 0.7 + Math.sin(t * tw.w * 1.7 + tw.ph * 2) * 0.3;
      const crossw = Math.sin(t * tw.w * 0.8 + tw.ph + 1.3);
      // tip offset (world units) along the wind and across it
      const along = (A * (0.25 + 0.45 * osc) + push * 0.6) * H * 0.1 + tw.lean * H;
      const across = A * 0.25 * crossw * H * 0.1;
      const sx = wx * along - wz * across, sz = wz * along + wx * across;
      const inst = this.bundleInst[tw.set];
      for (const b of tw.bundles) {
        const h = (b.y + 0.3 * b.s) / H, off = h * h, slope = (2 * h) / H;
        const lx = sx * slope, lz = sz * slope;   // lean direction in world space
        const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
        const loX = lx * c - lz * s, loZ = lx * s + lz * c;   // into the bundle's yawed frame
        inst.set(n[tw.set]++, tw.x + b.ox + sx * off, b.y, tw.z + b.oz + sz * off, b.s, b.yaw, b.shade, 0, 1, loZ, -loX);
      }
    }
    this.bundleInst[0].upload(n[0]); this.bundleInst[1].upload(n[1]);
  }

  /** Pages on the ground; their edges lift and flutter once the storm is up. */
  _litter(t, storm) {
    const L = this.litter;
    this.litterSeed.forEach(([x, z, rot, s, q], i) => {
      const lift = storm * 0.35 * (0.5 + 0.5 * Math.sin(t * (2 + q * 3) + q * 40)) * q;
      L.set(i, x, 0.04 + lift * 0.2, z, s, rot, 0.8 + q * 0.3, 0, 1, -Math.PI / 2 + lift, (q - 0.5) * 0.1);
    });
    L.upload(this.litterSeed.length);
  }

  render(r) {
    const { col, k } = this, a = this.a || SILENT, P = this.pal, d = K.drive(a, k), eye = this.cam.eye;
    const dim = lerp(0.88, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);

    this.sky.draw(r, eye, { horizon: col.fog, zenith: P.color(R(3, 0)), brightness: dim, cloudDrift: this.time * (0.006 + this.swayAmt * 0.03) });

    // a soft haze at idle; it opens up a little as the band comes in
    r.setFog(col.fog, lerp(6, 10, k), lerp(50, 66, k));
    r.setLight([-0.55, -0.55, 0.62], scaleColor(col.light, P.role('light'), lerp(0.85, 1, k)), scaleColor(col.amb, P.role('ambient'), lerp(1.05, 1.15, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    mat4.trs(this.m, 0, 0, 0);
    r.draw(this.ground, this.m, { texture: this.groundTex, tint: col.tint });
    r.drawInstanced(this.pageMesh, this.litter, { texture: this.pageTex, tint: col.tint });
    r.drawInstanced(this.bundleMesh, this.bundleInst[0], { texture: this.bundleTexA, tint: col.tint });
    r.drawInstanced(this.bundleMesh, this.bundleInst[1], { texture: this.bundleTexB, tint: col.tint });

    // airborne paper catches the light a touch on the beat (gentle, eased by the feel)
    const pb = dim * (1 + d.pulse * 0.12 * d.accent);
    col.page[0] = col.page[1] = col.page[2] = pb;
    this.glide.draw(r, { tint: col.page });
    this.flock.draw(r, { tint: col.page });
    r.drawInstanced(this.pageMesh, this.storm.inst, { texture: this.pageTex, tint: col.page });

  }

  dispose(r) {
    this.sky.dispose(r); this.glide.dispose(r); this.flock.dispose(r); this.storm.dispose();
    [this.ground, this.bundleMesh, this.pageMesh].forEach((m) => m.dispose());
    [this.groundTex, this.bundleTexA, this.bundleTexB, this.pageTex].forEach((t) => r.deleteTexture(t));
    [...this.bundleInst, this.litter].forEach((i) => i.dispose());
  }
}
