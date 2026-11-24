// RAIN WINDOW — a quiet room at night, looking out of a big rain-streaked window
// at a sleeping city (original: no real skyline). For slow songs and ballads.
//
//   the room: wallpaper, wooden frame and sill, curtains, a desk lamp, a mug, plants
//   the glass: a wet film drawn with screen-door `opacity`, beads, drops that slide
//     down in stick-slip runs with growing trails, glints on the highs
//   the room reflected in the glass: room props drawn mirrored in the glass plane
//     (a model matrix with z negated) with low `opacity` — faint, like real glass at night
//   beyond: instanced rooftops, water towers, masts with blinking beacons, street
//     glows and slow car lights far below, an elevated train line, drizzle → rain
//   K.Breath for the camera breath, K.stage for block-by-block windows
//
// Idle: drizzle, most of the city dark, the lamp low, the camera barely breathing.
// Swell: rain thickens (outside and on the glass), windows across the city light
// up block by block, a train's lights glide past far off. Beat: one drop runs
// down the glass + one distant beacon blinks. Highs: glints on the drops.
// Intensity raises light, never speed; no flashes.
import { mat4, lerp, clamp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { box, plane, merge, GeoBuilder } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const TAU = Math.PI * 2;
const WX0 = -2.3, WX1 = 2.3, WY0 = 0.9, WY1 = 4.4;   // glass opening; the sill top is at WY0
const SILL = WY0;
const GLASS_Z = 0;
const GY = -14;                    // street level (the room is high up)
const TRAIN_Z = -50, TRAIN_Y = -5; // elevated line runs along a road
const LAMP = [-1.75, SILL, 0.42];
const BULB = [-1.72, SILL + 0.46, 0.42];
const N_BEADS = 240, N_RUN = 26, N_BEAT = 4, N_GLINT = 14;
const N_CARS = 5, CAR_LEN = 7, CAR_GAP = 0.5;

/** Pre-multiply a model matrix by a mirror in the glass plane z = 0 (negate row z). */
const mirrorZ = (m) => { m[2] = -m[2]; m[6] = -m[6]; m[10] = -m[10]; m[14] = -m[14]; return m; };
const baseBox = (w, h, d, uv) => K.props.shift(box(w, h, d, { uvRepeat: uv }), 0, h / 2, 0);

// ---------------------------------------------------------------- local textures

const wallpaper = () => K.makeIndexed(32, 32, (x, y) => {
  const stripe = (x & 15) < 2 ? 0.35 : 0, sprig = ((x + 8) & 15) === 0 && (y & 7) < 3 ? 0.45 : 0;
  return K.dshade(0, 1.05 + stripe + sprig + K.blobNoise(x, y, 8, 3) * 0.35, x, y);
});
/** Facade: floor bands and pilasters, no window holes (lit windows are separate quads). */
const facade = (seed) => K.makeIndexed(32, 32, (x, y) => {
  if ((y & 7) === 0) return R(1, 0);
  const pil = (x & 15) < 2 ? 0.35 : 0;
  return K.dshade(1, 0.7 + pil + K.blobNoise(x, y, 6, seed) * 0.7, x, y);
});
const asphalt = () => K.makeIndexed(32, 32, (x, y) => K.dshade(1, 0.2 + K.blobNoise(x, y, 5, 9) * 0.7, x, y));
/** Small lit window: solid core with a darker sill row. */
const CLEAR_ = K.CLEAR;
const windowSprite = (core, low) => K.makeIndexed(4, 8, (x, y) => (y < 1 ? CLEAR_ : y >= 6 ? low : core));
/** Curtain folds, secondary ramp. */
const curtain = () => K.makeIndexed(32, 32, (x, y) => {
  const fold = 0.5 + 0.5 * Math.sin((x / 32) * TAU * 3);
  return K.dshade(1, 0.8 + fold * 1.4 + (y < 2 ? -0.5 : 0), x, y);
});
/** Wet film on the glass: vertical runs, CLEAR between them (screen-door on top). */
const glassFilm = () => K.makeIndexed(32, 64, (x, y) => {
  const run = K.blobNoise(x * 3, y * 0.25, 6, 21) * 0.7 + K.blobNoise(x, y, 4, 22) * 0.3;
  if (run < 0.56) return CLEAR_;
  return K.dshade(3, 1.2 + (run - 0.56) * 4, x, y);
});

export class RainWindow {
  static meta = { name: 'Rain Window' };
  static palette = fromKeys('rain-window', 'Rain Window', ['#8a5c40', '#566878', '#ff9a78', '#24344c']);

  init(r) {
    this.m = mat4.create();
    this.quad = r.createMesh(K.billboardQuad(1, 1));            // flat in XY, facing +z: windows, drops
    this.sky = new K.Sky(r, { clouds: 7, cloudRamp: 3 });

    // ---------------------------------------------------------- the city
    this.groundMesh = r.createMesh(plane(420, 10, 40));
    this.groundTex = r.texture(asphalt());
    this.bMeshes = [r.createMesh(baseBox(1, 1, 1, [2, 2])), r.createMesh(baseBox(1, 3, 1, [2, 6])), r.createMesh(baseBox(2, 1, 1, [4, 2]))];
    this.bTex = [r.texture(facade(1)), r.texture(facade(2))];
    this.bInst = this.bMeshes.map(() => r.createInstances(120));
    const bCount = [0, 0, 0];
    this.wins = [[], [], []];                                   // lit windows by colour: warm, pink, cool
    const roofs = [];
    const street = [], traffic = [];
    for (let iz = 0; iz < 13; iz++) for (let ix = -8; ix <= 8; ix++) {
      const x0 = ix * 12, z0 = -26 - iz * 12;
      const roadX = ((ix % 3) + 3) % 3 === 0, roadZ = iz % 3 === 2;
      if (roadX || roadZ) {
        // street glows (only the far ones ever show over the sill)
        if (z0 < -70 && K.rand2(ix, iz, 31) < 0.8) (K.rand2(ix, iz, 32) < 0.3 ? traffic : street).push([x0 + (K.rand2(ix, iz, 33) - 0.5) * 6, GY + 0.6, z0, K.rand2(ix, iz, 34)]);
        continue;
      }
      const block = (Math.floor((ix + 30) / 3) * 7 + Math.floor(iz / 3) * 13) % 97;
      const blockOn = 0.08 + K.rand2(block, 1, 41) * 0.72;
      const x = x0 + (K.rand2(ix, iz, 1) - 0.5) * 4, z = z0 + (K.rand2(ix, iz, 2) - 0.5) * 4;
      const s = 7 + K.rand2(ix, iz, 3) * 3.5;
      const hmax = lerp(16, 46, clamp(iz / 8)), h = lerp(9, hmax, Math.pow(K.rand2(ix, iz, 4), 1.4));
      const kind = h > 22 && K.rand2(ix, iz, 5) < 0.6 ? 1 : K.rand2(ix, iz, 6) < 0.25 && Math.abs(ix) % 3 === 1 ? 2 : 0;
      const w = kind === 2 ? s * 2 : s, hs = kind === 1 ? h / (s * 3) : h / s;
      this.bInst[kind].set(bCount[kind]++, x, GY, z, s, 0, 0.7 + K.rand2(ix, iz, 7) * 0.3, 0, hs);
      roofs.push({ x, y: GY + h, z, s, h, iz });
      // lit windows on the front face (the camera looks along -z)
      const cols = Math.max(1, Math.floor(w / 2.6)), rows = Math.floor((h - 2) / 3);
      for (let c = 0; c < cols; c++) for (let rr = 0; rr < rows; rr++) {
        const q = K.rand2(ix * 31 + c, iz * 17 + rr, 51);
        if (q > 0.6) continue;
        const wx = x - w / 2 + (c + 0.5) * (w / cols), wy = GY + 1.5 + rr * 3;
        const kindW = K.rand2(c, rr + ix * 7 + iz * 3, 52), bucket = kindW < 0.62 ? 0 : kindW < 0.85 ? 1 : 2;
        const lag = K.rand2(c + 3, rr + iz, 53);
        this.wins[bucket].push({ x: wx, y: wy, z: z + s / 2 + 0.06, on: blockOn + lag * 0.12, idle: lag < 0.12, ph: lag * 40 });
      }
    }
    this.bInst.forEach((inst, i) => inst.upload(bCount[i]));
    this.winTex = [r.texture(windowSprite(R(2, 3), R(2, 2))), r.texture(windowSprite(R(2, 2), R(2, 1))), r.texture(windowSprite(R(3, 3), R(3, 2)))];
    this.winInst = this.wins.map((list) => r.createInstances(list.length));

    // water towers and masts on the roofs (near rows: towers; tallest: masts with beacons)
    const towerGeo = merge([
      { geo: K.props.prism(10, 1.2, 2.0), xf: K.xf({ pos: [0, 1.6, 0] }) },
      { geo: K.props.prism(10, 1.3, 0.8, { taper: 0.05, cap: false }), xf: K.xf({ pos: [0, 3.6, 0] }) },
      ...[[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]].map(([lx, lz]) => ({ geo: baseBox(0.15, 1.6, 0.15, [1, 1]), xf: K.xf({ pos: [lx, 0, lz] }) })),
    ]);
    this.towerMesh = r.createMesh(towerGeo);
    this.towers = r.createInstances(10);
    let nt = 0;
    roofs.filter((rf) => rf.iz <= 5).sort((a, b) => K.rand2(a.x, a.z, 61) - K.rand2(b.x, b.z, 61)).slice(0, 10)
      .forEach((rf, i) => this.towers.set(nt++, rf.x + (K.rand2(i, 1, 62) - 0.5) * rf.s * 0.4, rf.y, rf.z + (K.rand2(i, 2, 62) - 0.5) * rf.s * 0.4, 0.9 + K.rand2(i, 3, 62) * 0.4, K.rand2(i, 4, 62) * TAU, 0.8));
    this.towers.upload(nt);
    this.mastMesh = r.createMesh(baseBox(0.18, 5, 0.18, [1, 1]));
    this.masts = r.createInstances(7);
    this.beacons = [...roofs].sort((a, b) => b.h - a.h).slice(0, 7).map((rf, i) => {
      this.masts.set(i, rf.x, rf.y, rf.z, 1, 0, 0.8);
      return { x: rf.x, y: rf.y + 5.2, z: rf.z, ph: K.rand2(i, 1, 71) * TAU, rate: 0.9 + K.rand2(i, 2, 71) * 0.5, env: new K.Envelope(0.9) };
    });
    this.masts.upload(this.beacons.length);

    // glows: street lamps, traffic signals, beacons, car lights (one buffer per colour)
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.street = street; this.traffic = traffic;
    this.cars = Array.from({ length: 22 }, (_, i) => ({ road: -26 - (2 + 3 * (i % 4)) * 12, off: K.rand2(i, 1, 81) * 240, v: (i % 2 ? 1 : -1) * (5 + K.rand2(i, 2, 81) * 3) }));
    this.warmGlows = r.createInstances(street.length + this.cars.length);
    this.pinkGlows = r.createInstances(traffic.length + this.beacons.length);

    // elevated train line along a road, and the train itself
    const track = [{ geo: baseBox(340, 0.6, 1.8, [40, 1]), xf: K.xf({ pos: [0, TRAIN_Y - 0.6, TRAIN_Z] }) }];
    for (let x = -160; x <= 160; x += 16) track.push({ geo: baseBox(0.8, TRAIN_Y - 0.6 - GY, 0.8, [1, 3]), xf: K.xf({ pos: [x, GY, TRAIN_Z] }) });
    this.trackMesh = r.createMesh(merge(track));
    this.carMesh = r.createMesh(baseBox(CAR_LEN, 2.4, 2.2, [3, 1]));
    this.carInst = r.createInstances(N_CARS);
    this.trainWins = r.createInstances(N_CARS * 6 + 1);

    // weather outside: drizzle at idle, rain with the swell; kept well beyond the glass
    const out = { area: [44, 28, 34] };
    this.drizzle = new K.Particles(r, 'drizzle', out);
    this.rain = new K.Particles(r, 'rain', { ...out, count: 600 });
    this.rainCenter = [0, 1, -24];   // z -41 .. -7: never in front of the glass

    // ---------------------------------------------------------- the glass
    const gb = new GeoBuilder().face([0, (WY0 + WY1) / 2, GLASS_Z], [(WX1 - WX0) / 2, 0, 0], [0, (WY1 - WY0) / 2, 0], [0, 0, 2.5, 3], 4);
    this.glassMesh = r.createMesh(gb.build());
    this.glassTex = r.texture(glassFilm());
    this.dotTex = r.texture(K.sprites.dot({ index: R(3, 3) }));
    this.streakTex = r.texture(K.sprites.streak({ index: R(3, 2) }));
    this.twinkleTex = r.texture(K.sprites.twinkle({ index: R(3, 3) }));
    this.drops = r.createInstances(N_BEADS + N_RUN + N_BEAT);
    this.trails = r.createInstances(N_RUN + N_BEAT);
    this.glints = r.createInstances(N_GLINT);
    const gx = () => lerp(WX0 + 0.08, WX1 - 0.08, Math.random());
    this.beads = Array.from({ length: N_BEADS }, (_, i) => ({
      x: lerp(WX0 + 0.05, WX1 - 0.05, K.rand2(i, 1, 91)), y: lerp(WY0 + 0.05, WY1 - 0.05, K.rand2(i, 2, 91)),
      s: 0.025 + K.rand2(i, 3, 91) * 0.035, b: 0.12 + K.rand2(i, 4, 91) * 0.2, on: K.rand2(i, 5, 91) < 0.3 ? -1 : K.rand2(i, 6, 91) * 0.8,
    }));
    this.runners = Array.from({ length: N_RUN }, (_, i) => ({ x: gx(), y: lerp(WY0 + 0.4, WY1, Math.random()), len: 0.2, v: 0, seed: i * 7.3, on: i < 6 ? -1 : 0.1 + (i / N_RUN) * 0.75, maxLen: 0.3 + Math.random() * 0.6 }));
    this.beatDrops = Array.from({ length: N_BEAT }, () => ({ x: 0, y: -10, len: 0, live: false, amp: 0 }));
    this.dropClock = 1;
    this.glintList = Array.from({ length: N_GLINT }, (_, i) => ({ src: Math.floor(K.rand2(i, 1, 95) * N_BEADS), ph: K.rand2(i, 2, 95) * TAU }));
    this.gx = gx;

    // ---------------------------------------------------------- the room
    this.wallTex = r.texture(wallpaper());
    const wg = new GeoBuilder(), WZ = 0.1;
    const wallFace = (x0, x1, y0, y1) => wg.face([(x0 + x1) / 2, (y0 + y1) / 2, WZ], [(x1 - x0) / 2, 0, 0], [0, (y1 - y0) / 2, 0], [x0 / 0.8, -y1 / 0.8, x1 / 0.8, -y0 / 0.8], 4);
    wallFace(-6, WX0 - 0.12, 0, 6.5); wallFace(WX1 + 0.12, 6, 0, 6.5); wallFace(WX0 - 0.12, WX1 + 0.12, WY1 + 0.12, 6.5); wallFace(WX0 - 0.12, WX1 + 0.12, 0, SILL);
    const wall = wg.build();
    // bake the lamp's warm pool into the vertex colours (brighter near the bulb)
    for (let i = 0; i < wall.count; i++) {
      const dx = wall.positions[i * 3] - BULB[0], dy = wall.positions[i * 3 + 1] - BULB[1];
      const c = 0.5 + 0.75 * Math.exp(-Math.hypot(dx, dy) / 1.4);
      wall.colors[i * 3] = wall.colors[i * 3 + 1] = wall.colors[i * 3 + 2] = c;
    }
    this.wallMesh = r.createMesh(wall);
    this.woodTex = r.texture(K.tex.boards({ ramp: 0 }));
    const fw = WX1 - WX0, fh = WY1 - WY0;
    this.frameMesh = r.createMesh(merge([
      { geo: baseBox(0.14, fh + 0.24, 0.2, [1, 4]), xf: K.xf({ pos: [WX0 - 0.07, SILL - 0.12, 0.02] }) },
      { geo: baseBox(0.14, fh + 0.24, 0.2, [1, 4]), xf: K.xf({ pos: [WX1 + 0.07, SILL - 0.12, 0.02] }) },
      { geo: baseBox(fw + 0.28, 0.14, 0.2, [4, 1]), xf: K.xf({ pos: [0, WY1, 0.02] }) },
      { geo: baseBox(0.08, fh, 0.1, [1, 4]), xf: K.xf({ pos: [0.15, SILL, 0.0] }) },               // mullion
      { geo: baseBox(fw, 0.07, 0.1, [4, 1]), xf: K.xf({ pos: [0, 3.6, 0.0] }) },                  // transom
    ]));
    const sillGeo = baseBox(fw + 0.7, 0.09, 0.95, [5, 1]);
    this.sillMesh = r.createMesh(merge([{ geo: sillGeo, xf: K.xf({ pos: [0, SILL - 0.09, 0.36] }) }]));
    const floor = plane(14, 6, 7); K.transform(floor, { pos: [0, 0, 7] });
    this.floorMesh = r.createMesh(floor);
    // curtains: right one over the edge of the glass, left one mostly over the wall
    const cg = new GeoBuilder();
    cg.face([2.42, 2.45, 0.32], [0.48, 0, 0], [0, 2.4, 0], [0, 0, 1.2, 2.5], 3);
    cg.face([-2.75, 2.45, 0.3], [0.32, 0, 0], [0, 2.4, 0], [0, 0, 0.8, 2.5], 3);
    this.curtainMesh = r.createMesh(cg.build());
    this.curtainTex = r.texture(curtain());
    // desk lamp on a stack of books; the shade glows from inside
    this.lampBody = r.createMesh(merge([
      { geo: baseBox(0.5, 0.06, 0.34, [1, 1]), xf: K.xf({ pos: [0, 0, 0] }) },
      { geo: baseBox(0.44, 0.05, 0.3, [1, 1]), xf: K.xf({ pos: [0.03, 0.06, 0], rot: [0, 0.12, 0] }) },
      { geo: K.props.prism(8, 0.13, 0.03), xf: K.xf({ pos: [0.03, 0.11, 0] }) },
      { geo: K.props.prism(4, 0.018, 0.4), xf: K.xf({ pos: [0.03, 0.12, 0] }) },
    ]));
    this.lampShade = r.createMesh(K.props.prism(10, 0.21, 0.2, { taper: 0.45, cap: false }));
    this.poolMesh = r.createMesh(K.decal(1, 1, 0.004));
    // mug and potted plants
    this.mugMesh = r.createMesh(merge([
      { geo: K.props.prism(8, 0.065, 0.13) },
      { geo: baseBox(0.03, 0.08, 0.02, [1, 1]), xf: K.xf({ pos: [0.08, 0.025, 0] }) },
    ]));
    this.potMesh = r.createMesh(K.props.prism(8, 0.11, 0.18, { taper: 1.25 }));
    this.pots = [[-0.7, 0.5, 0.8], [1.45, 0.45, 1]];   // x, z, scale
    this.fernTex = r.texture(K.sprites.fern({ ramp: 1 }));
    this.bushTex = r.texture(K.sprites.bush({ ramp: 1 }));
    this.ferns = r.createInstances(2); this.bushes = r.createInstances(1);
    this.ferns.set(0, 1.45, SILL + 0.16, 0.45, 0.75, 0, 0.9, 0, 1.1);
    this.ferns.set(1, 1.62, SILL + 0.14, 0.5, 0.5, 0, 0.75, 2, 1.2);
    this.ferns.upload(2);
    this.bushes.set(0, -0.7, SILL + 0.13, 0.5, 0.42, 0, 0.9, 1, 0.9); this.bushes.upload(1);
    this.bulbGlow = r.createInstances(1);

    this.breath = new K.Breath({ beats: 8, period: 12 });
    this.time = 0; this.k = 0; this.d = K.drive({ level: 0, bass: 0, mid: 0, high: 0, beatPulse: 0, beat: false }, 0);
    this.lampLevel = 0.4; this.eye = [0, 1.55, 4.2]; this.target = [0, 2.4, -10];
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], g: [0, 0, 0], c: [0, 0, 0] };
    this.MZ = mirrorZ(mat4.identity(mat4.create()));
  }

  update(a, k, dt) {
    this.k = k; this.time += dt;
    const t = this.time, d = this.d = K.drive(a, k);
    const b = this.breath.update(a, dt);

    // camera: a slow breath and a tiny drift; intensity never makes it faster
    this.eye[0] = Math.sin(t * 0.05) * 0.12 + Math.sin(t * 0.031 + 1) * 0.05;
    this.eye[1] = 1.55 + b * 0.06;
    this.eye[2] = 4.2 - b * 0.06;
    this.target[0] = this.eye[0] * 0.3; this.target[1] = 2.4 + b * 0.04;

    this.lampLevel = lerp(0.45, 0.95, k) * (0.92 + 0.08 * b);

    // windows light up block by block (each window lags a little inside its block)
    const wb = 0.86 + 0.14 * b;
    this.wins.forEach((list, ci) => {
      const inst = this.winInst[ci];
      list.forEach((w, i) => {
        let lit = Math.max(w.idle ? 0.6 : 0, K.stage(k, w.on, w.on + 0.1)) * wb;
        if (ci === 2) lit *= 0.8 + 0.2 * Math.sin(t * 2.1 + w.ph);   // the blue glow of a screen
        inst.set(i, w.x, w.y, w.z, 0.9, 0, lit, 0, 1.6);
      });
      inst.upload(list.length);
    });

    // beacons blink slowly; on a beat one of them blinks brighter
    if (d.beat) this.beacons[Math.floor(K.rand2(a.beatCount || 0, 3, 7) * this.beacons.length)].env.trigger(0.6 + 0.4 * k);
    let nw = 0, np = 0;
    for (const s of this.street) this.warmGlows.set(nw++, s[0], s[1], s[2], 2.2, 0, 0.45 + 0.25 * k, 0, 1);
    for (const c of this.cars) {
      const x = K.repeat(c.off + t * c.v, 240) - 120;
      this.warmGlows.set(nw++, x, GY + 0.4, c.road + (c.v > 0 ? 2 : -2), 1.6, 0, 0.5 * K.fadeOut(Math.abs(x), 80, 115), 0, 1);
    }
    for (const s of this.traffic) this.pinkGlows.set(np++, s[0], s[1] + 2, s[2], 1.6, 0, 0.35 + 0.25 * Math.max(0, Math.sin(t * 0.4 + s[3] * TAU)), 0, 1);
    for (const bc of this.beacons) {
      bc.env.update(dt);
      const blink = Math.pow(Math.max(0, Math.sin(t * bc.rate + bc.ph)), 6);
      this.pinkGlows.set(np++, bc.x, bc.y, bc.z, 2.4 + bc.env.v * 2, 0, 0.25 + blink * 0.4 + bc.env.v, 0, 1);
    }
    this.warmGlows.upload(nw); this.pinkGlows.upload(np);

    // the train glides past far off once the song is up (fades in with a screen-door)
    this.trainVis = K.stage(k, 0.45, 0.8);
    const head = K.repeat(t * 8, 420) - 210;
    let nwin = 0;
    for (let c = 0; c < N_CARS; c++) {
      const cx = head - c * (CAR_LEN + CAR_GAP);
      this.carInst.set(c, cx, TRAIN_Y, TRAIN_Z, 1, 0, 0.8);
      for (let j = 0; j < 6; j++) this.trainWins.set(nwin++, cx - CAR_LEN / 2 + 0.7 + j * 1.12, TRAIN_Y + 1.0, TRAIN_Z + 1.16, 0.7, 0, this.trainVis * 0.9, 0, 1.1);
    }
    this.trainWins.set(nwin++, head + CAR_LEN / 2 + 0.1, TRAIN_Y + 0.6, TRAIN_Z + 1.16, 1.4, 0, this.trainVis, 0, 1);
    this.carInst.upload(N_CARS); this.trainWins.upload(nwin);

    // rain outside: drizzle at idle, real rain with the swell
    this.drizzle.update(dt, this.rainCenter, { amount: K.swell(k, 0.9, 0.5), speed: 0.8, wind: [0.4, 0] });
    this.rain.update(dt, this.rainCenter, { amount: K.stage(k, 0.2, 0.9) * 0.85, speed: 0.7, wind: [0.8, 0] });

    this._glass(a, k, d, dt, t);
  }

  /** Drops on the glass: static beads, stick-slip runners with trails, beat drops, glints. */
  _glass(a, k, d, dt, t) {
    const z = GLASS_Z - 0.025, wet = K.swell(k, 0.4, 1);
    let n = 0, nt = 0;
    for (const bd of this.beads) {
      const vis = bd.on < 0 ? 1 : K.stage(k, bd.on, bd.on + 0.2);
      this.drops.set(n++, bd.x, bd.y - bd.s / 2, z, bd.s, 0, bd.b * vis, 0, 1);
      bd.vis = vis;
    }
    for (const rn of this.runners) {
      // stick-slip: mostly clinging, then a short run; never faster with intensity
      const slip = K.noise2(t * 0.35, rn.seed) > 0.6 ? 1 : 0.04;
      rn.v += ((0.55 * slip) - rn.v) * Math.min(1, dt * 3);
      rn.y -= rn.v * dt;
      rn.len = Math.min(rn.maxLen, rn.len + rn.v * dt * 0.8);
      if (rn.y < SILL + 0.02) { rn.y = WY1 - 0.02; rn.x = this.gx(); rn.len = 0; }
      const act = rn.on < 0 ? 1 : K.stage(k, rn.on, rn.on + 0.15);
      const vis = act * K.fadeIn(WY1 - rn.y, 0, 0.35) * K.fadeIn(rn.y - SILL, 0.02, 0.4);
      this.drops.set(n++, rn.x, rn.y - 0.03, z + 0.002, 0.06, 0, 0.55 * vis, 0, 1);
      this.trails.set(nt++, rn.x, rn.y, z, 0.05, 0, 0.45 * vis, 0, Math.max(0.01, rn.len) / 0.05);
    }
    // a beat sends one fresh drop all the way down the glass at Punchy; at Gentle a drop starts on its own
    // every few seconds, a little more often as the energy rises (no beat-timed motion)
    let spawn = d.beat && d.beatMotion > 0.5;
    if (d.beatMotion <= 0.5) { this.dropClock -= dt * (0.15 + d.energy * 0.35); if (this.dropClock <= 0) { this.dropClock = 1; spawn = k > 0.05; } }
    if (spawn) {
      const bd = this.beatDrops.find((x) => !x.live) || this.beatDrops[0];
      Object.assign(bd, { x: this.gx(), y: WY1 - 0.02, len: 0, live: true, amp: 0.6 + 0.4 * k });
    }
    for (const bd of this.beatDrops) {
      if (bd.live) {
        bd.y -= 0.8 * dt; bd.len = Math.min(1.1, bd.len + 0.8 * dt * 0.9);
        if (bd.y < SILL + 0.02) bd.live = false;
      }
      const vis = bd.live ? bd.amp * K.fadeIn(WY1 - bd.y, 0, 0.25) * K.fadeIn(bd.y - SILL, 0.02, 0.35) : 0;
      this.drops.set(n++, bd.x, bd.y - 0.04, z + 0.002, 0.08, 0, 0.8 * vis, 0, 1);
      this.trails.set(nt++, bd.x, bd.y, z, 0.06, 0, 0.6 * vis, 0, Math.max(0.01, bd.len) / 0.06);
    }
    this.drops.upload(n); this.trails.upload(nt);
    // glints on the drops ride the highs
    let ng = 0;
    for (const g of this.glintList) {
      const bd = this.beads[g.src], fl = Math.max(0, Math.sin(t * 2.3 + g.ph));
      this.glints.set(ng++, bd.x, bd.y - 0.06, z + 0.004, 0.12, 0, d.high * fl * 1.2 * bd.vis, 0, 1);
    }
    this.glints.upload(ng);
    this.wet = wet;
  }

  /** Room props that also show, mirrored, in the glass. mirror: draw the reflection. */
  _props(r, col, mirror) {
    const P = this.pal, m = this.m, M = mirror ? mirrorZ : (x) => x, model = mirror ? this.MZ : undefined;
    const op = mirror ? 0.3 : 1, f = mirror ? 0.45 : 1;
    const lamp = this.lampLevel;
    // books + lamp body
    scaleColor(col.c, P.color(R(1, 1)), col.tint[0] * f);
    r.draw(this.lampBody, M(mat4.trs(m, LAMP[0], LAMP[1], LAMP[2])), { tint: col.c, opacity: op });
    scaleColor(col.c, P.color(R(2, 2)), (0.5 + lamp * 0.6) * f);
    r.draw(this.lampShade, M(mat4.trs(m, BULB[0], BULB[1] - 0.06, BULB[2])), { tint: col.c, unlit: true, opacity: op });
    // mug
    scaleColor(col.c, P.color(R(1, 2)), col.tint[0] * f);
    r.draw(this.mugMesh, M(mat4.trs(m, 0.85, SILL, 0.48, 0, 0.6, 0)), { tint: col.c, opacity: op });
    // pots and plants
    scaleColor(col.c, P.color(R(0, 2)), col.tint[0] * f);
    for (const [x, zz, s] of this.pots) r.draw(this.potMesh, M(mat4.trs(m, x, SILL, zz, 0, 0, 0, s)), { tint: col.c, opacity: op });
    col.g[0] = col.g[1] = col.g[2] = col.tint[0] * f;
    const sway = 0.01 + this.breath.v * 0.01;
    r.drawInstanced(this.quad, this.ferns, { model, texture: this.fernTex, billboard: 1, sway, tint: col.g, opacity: op });
    r.drawInstanced(this.quad, this.bushes, { model, texture: this.bushTex, billboard: 1, sway, tint: col.g, opacity: op });
    // curtains
    if (!mirror) r.draw(this.curtainMesh, mat4.identity(m), { texture: this.curtainTex, tint: col.g });   // (its reflection read as stripes)
    // the bulb's glow (dimmer in the reflection)
    const gs = 0.35 + lamp * 0.3;
    this.bulbGlow.set(0, BULB[0], BULB[1] - 0.05 - gs / 2, BULB[2], gs, 0, lamp * (mirror ? 0.35 : 0.9), 0, 1);
    this.bulbGlow.upload(1);
    r.drawInstanced(this.quad, this.bulbGlow, { model, texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false });
  }

  render(r) {
    const { col, k } = this, P = this.pal;
    const dim = lerp(0.62, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    r.setCamera(this.eye, this.target, { fov: 56, near: 0.05, far: 260 });
    r.setFog(col.fog, 22, lerp(150, 180, k));

    // ---- beyond the glass: sky, city, weather
    this.sky.draw(r, this.eye, { horizon: col.fog, zenith: P.color(R(3, 0)), brightness: dim, cloudDrift: this.time * 0.003 });
    r.setLight([0.3, -0.6, -0.7], scaleColor(col.light, P.color(R(3, 2)), lerp(0.12, 0.28, k)), scaleColor(col.amb, P.role('fog'), 0.55 * dim));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    r.draw(this.groundMesh, mat4.trs(this.m, 0, GY, -120), { texture: this.groundTex, tint: col.tint });
    this.bInst.forEach((inst, i) => r.drawInstanced(this.bMeshes[i], inst, { texture: this.bTex[i & 1], tint: col.tint }));
    scaleColor(col.c, P.color(R(1, 1)), dim);
    r.drawInstanced(this.towerMesh, this.towers, { tint: col.c });
    r.drawInstanced(this.mastMesh, this.masts, { tint: col.c });
    r.draw(this.trackMesh, mat4.identity(this.m), { tint: col.c });
    if (this.trainVis > 0.01) {
      r.drawInstanced(this.carMesh, this.carInst, { tint: col.c, opacity: this.trainVis });
      r.drawInstanced(this.quad, this.trainWins, { texture: this.winTex[0], unlit: true, additive: true });
    }
    const wl = lerp(0.8, 1.1, k);
    col.g[0] = col.g[1] = col.g[2] = wl;
    this.winInst.forEach((inst, i) => r.drawInstanced(this.quad, inst, { texture: this.winTex[i], unlit: true, additive: true, tint: col.g }));
    r.drawInstanced(this.quad, this.warmGlows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [90, 230] });
    r.drawInstanced(this.quad, this.pinkGlows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [120, 260] });
    this.drizzle.draw(r, { brightness: dim * 0.9 });
    this.rain.draw(r, { brightness: dim });

    // ---- the room, faintly reflected in the glass (lit like the room)
    const lamp = this.lampLevel;
    r.setLight([0.6, -0.6, -0.35], scaleColor(col.light, P.color(R(2, 3)), lamp * 0.7), scaleColor(col.amb, P.role('ambient'), lerp(0.42, 0.5, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = lerp(0.85, 1, k);
    this._props(r, col, true);
    scaleColor(col.c, P.color(R(0, 2)), col.tint[0] * 0.4);
    r.draw(this.sillMesh, mirrorZ(mat4.identity(this.m)), { texture: this.woodTex, tint: col.c, opacity: 0.25 });

    // ---- the glass: wet film (screen-door), beads, runners, beat drops, glints
    col.g[0] = col.g[1] = col.g[2] = dim * 0.8;
    r.draw(this.glassMesh, mat4.identity(this.m), { texture: this.glassTex, tint: col.g, unlit: true, fog: false, opacity: lerp(0.07, 0.14, k), uvOffset: [0, -this.time * 0.01] });
    col.g[0] = col.g[1] = col.g[2] = lerp(0.7, 1, k);
    r.drawInstanced(this.quad, this.trails, { texture: this.streakTex, unlit: true, additive: true, fog: false, tint: col.g });
    r.drawInstanced(this.quad, this.drops, { texture: this.dotTex, unlit: true, additive: true, fog: false, tint: col.g });
    r.drawInstanced(this.quad, this.glints, { texture: this.twinkleTex, unlit: true, additive: true, fog: false });

    // ---- the room itself
    r.draw(this.wallMesh, mat4.identity(this.m), { texture: this.wallTex, tint: col.tint });
    r.draw(this.frameMesh, mat4.identity(this.m), { texture: this.woodTex, tint: col.tint });
    r.draw(this.sillMesh, mat4.identity(this.m), { texture: this.woodTex, tint: col.tint });
    scaleColor(col.c, col.tint, 0.7);
    r.draw(this.floorMesh, mat4.identity(this.m), { texture: this.woodTex, tint: col.c, uvScale: [1, 1] });
    // warm pool of lamplight on the sill
    scaleColor(col.c, P.role('glow'), lamp * 0.45);
    r.draw(this.poolMesh, mat4.trs(this.m, BULB[0] + 0.15, SILL, BULB[2] + 0.05, 0, 0, 0, 1.5, 1, 1), { texture: this.glowTex, unlit: true, additive: true, fog: false, tint: col.c });
    this._props(r, col, false);
  }

  dispose(r) {
    this.sky.dispose(r); this.drizzle.dispose(r); this.rain.dispose(r);
    [this.quad, this.groundMesh, ...this.bMeshes, this.towerMesh, this.mastMesh, this.trackMesh, this.carMesh, this.glassMesh,
      this.wallMesh, this.frameMesh, this.sillMesh, this.floorMesh, this.curtainMesh, this.lampBody, this.lampShade, this.poolMesh, this.mugMesh, this.potMesh].forEach((m) => m.dispose());
    [this.groundTex, ...this.bTex, ...this.winTex, this.glowTex, this.glassTex, this.dotTex, this.streakTex, this.twinkleTex,
      this.wallTex, this.woodTex, this.curtainTex, this.fernTex, this.bushTex].forEach((t) => r.deleteTexture(t));
    [...this.bInst, ...this.winInst, this.towers, this.masts, this.warmGlows, this.pinkGlows, this.carInst, this.trainWins,
      this.drops, this.trails, this.glints, this.ferns, this.bushes, this.bulbGlow].forEach((i) => i.dispose());
  }
}
