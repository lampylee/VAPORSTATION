// GREENHOUSE AT DUSK — inside an old iron-and-glass greenhouse as the light goes (slow songs).
//
//   iron frame (posts, rafters, tie beams)   one merged mesh, K.orientedBox
//   glass walls + roof with condensation     screen-door { opacity } over the dusk sky, glazing bars as a cut-out texture
//   planting beds, ferns, bushes, palms      K.sprites.fern / bush / broadleaf, instanced billboards
//   hanging fronds from the beams            K.sprites.kelp flipped (negative heightScale), swaying
//   raised koi pond                          K.School({ kind: 'fish' }) warm-tinted, K.Caustics on its floor, K.Ripples
//   swags of warm bulbs under every beam     lit beam by beam (K.stage), K.Pulses runs down the hall on beats
//   light shafts through the glass           K.sprites.lightShaft, additive, leaning
//   pollen + sparkle                         K.Particles pollen / starTwinkle (highs)
//   slow phrasing                            K.Breath (follows the tapped tempo, else a 12 s cycle)
//
// Idle: blue dusk through the glass, a handful of bulbs, pollen drifting, a few koi.
// Swell: bulb swags light up beam by beam down the hall, shafts of light lean in,
// the koi gather at the near rim and the caustics brighten. Beat: one soft pulse
// travels along the bulbs + a ripple on the pond. Intensity raises light, not speed.
import { mat4, lerp, clamp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { GeoBuilder, box, merge, plane } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const TAU = Math.PI * 2;
const HW = 8.5;             // half width of the hall
const WALL = 4;             // eaves height
const RIDGE = 7;            // ridge height
const KNEE = 1;             // low stone wall under the glass
const Z0 = -26, Z1 = 30;    // gable ends
const BAY = 4;
const N_FRAMES = (Z1 - Z0) / BAY + 1;      // 15 iron frames
const BULBS_PER = 11;                      // bulbs on each swag
const PZ = 4;                              // pond centre (x = 0), in a clearing between the beds
const R_OUT = 3.6, R_IN = 3.2, RIM_H = 0.45, WATER = 0.36, POND_FLOOR = 0.04;
const BED_X0 = 2.4, BED_X1 = 7.6, BED_H = 0.7, CLEAR_Z = 5.2;   // beds stop CLEAR_Z either side of the pond
const BEDS = [[Z0 + 0.3, PZ - CLEAR_Z], [PZ + CLEAR_Z, Z1 - 0.3]];
const CAM_Z = -10, CAM_AMP = 6.5;          // camera dollies z -16.5 .. -3.5 (pond rim at z 0.4)
const inBedZ = (z) => BEDS.some(([a, b]) => z > a + 0.4 && z < b - 0.4);

/** Height of the bulb wire under a tie beam at x (sags in the middle). */
const wireY = (x) => WALL - 0.12 - 0.6 * (1 - (x / (HW - 0.2)) ** 2);

/** The four board sides of a raised bed (no top or bottom), centred like box(). */
function bedSides(sx, sy, sz, rep) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2, g = new GeoBuilder();
  g.face([hx, 0, 0], [0, 0, -hz], [0, hy, 0], [0, 0, rep, 1]);
  g.face([-hx, 0, 0], [0, 0, hz], [0, hy, 0], [0, 0, rep, 1]);
  g.face([0, 0, hz], [hx, 0, 0], [0, hy, 0], [0, 0, rep, 1]);
  g.face([0, 0, -hz], [-hx, 0, 0], [0, hy, 0], [0, 0, rep, 1]);
  return g.build();
}

/** Octagonal pond rim: outer wall, inner wall and a flat top (angles match K.flatPoly). */
function rimGeo(sides, rOut, rIn, h) {
  const g = new GeoBuilder();
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * TAU, a1 = ((i + 1) / sides) * TAU;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const o0 = [c0 * rOut, 0, s0 * rOut], o1 = [c1 * rOut, 0, s1 * rOut], i0 = [c0 * rIn, 0, s0 * rIn], i1 = [c1 * rIn, 0, s1 * rIn];
    const up = (p) => [p[0], h, p[2]];
    g.quad(o1, o0, up(o0), up(o1), [1, 1], [0, 1], [0, 0], [1, 0]);
    g.quad(i0, i1, up(i1), up(i0), [1, 1], [0, 1], [0, 0], [1, 0]);
    g.quad(up(o0), up(i0), up(i1), up(o1), [0, 0.2], [0, 0], [1, 0], [1, 0.2]);
  }
  return g.build();
}

/** Upward-facing octagon with world-ish UVs (pond floor, water). */
function octagon(radius, y, uvScale) {
  const g = new GeoBuilder();
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * TAU, a1 = ((i + 1) / 8) * TAU;
    const p0 = [Math.cos(a0) * radius, y, Math.sin(a0) * radius], p1 = [Math.cos(a1) * radius, y, Math.sin(a1) * radius];
    const uv = (p) => [p[0] * uvScale, p[2] * uvScale];
    g.tri([0, y, 0], p1, p0, [0, 0], uv(p1), uv(p0), [0, 1, 0]);
  }
  return g.build();
}

/** Glass walls, roof and both gables in one mesh. UVs in world units (u along the run, v up). */
function glassGeo() {
  const g = new GeoBuilder(), slope = Math.hypot(HW, RIDGE - WALL);
  for (const sx of [-1, 1]) {
    const x = sx * HW;
    g.quad([x, KNEE, Z0], [x, KNEE, Z1], [x, WALL, Z1], [x, WALL, Z0], [Z0, KNEE], [Z1, KNEE], [Z1, WALL], [Z0, WALL]);
    g.quad([x, WALL, Z0], [x, WALL, Z1], [0, RIDGE, Z1], [0, RIDGE, Z0], [Z0, 0], [Z1, 0], [Z1, slope], [Z0, slope]);
  }
  for (const z of [Z0, Z1]) {
    g.quad([-HW, KNEE, z], [HW, KNEE, z], [HW, WALL, z], [-HW, WALL, z], [-HW, KNEE], [HW, KNEE], [HW, WALL], [-HW, WALL]);
    g.tri([-HW, WALL, z], [HW, WALL, z], [0, RIDGE, z], [-HW, WALL], [HW, WALL], [0, RIDGE]);
  }
  return g.build();
}

/** The iron frame: posts, rafters, tie beams, king posts, braces, plus the long members. */
function ironGeo() {
  const g = new GeoBuilder(), T = 0.09;
  const beam = (a, b, t = T) => {   // box from point a to point b (any direction)
    const c = K.vlerp(a, b, 0.5), d = K.vsub(b, a), L = K.vlen(d), ax = K.vscale(d, 0.5 / L);
    let side = K.vcross(ax, [0, 1, 0]);
    if (K.vlen(side) < 1e-3) side = [1, 0, 0];
    const az = K.vscale(K.vnorm(side), t), ay = K.vscale(K.vnorm(K.vcross(az, ax)), t);
    K.orientedBox(g, c, K.vscale(ax, L), ay, az);
  };
  for (let i = 0; i < N_FRAMES; i++) {
    const z = Z0 + i * BAY;
    for (const sx of [-1, 1]) {
      beam([sx * HW, 0, z], [sx * HW, WALL, z], 0.11);
      beam([sx * HW, WALL, z], [0, RIDGE, z]);
      beam([sx * HW, WALL - 0.9, z], [sx * (HW - 1.3), WALL, z], 0.06);                // corner brace
      beam([sx * HW * 0.62, WALL, z], [sx * HW * 0.4, WALL + (RIDGE - WALL) * 0.6, z], 0.05);   // truss strut
    }
    beam([-HW, WALL, z], [HW, WALL, z], 0.07);                                          // tie beam
    beam([0, WALL, z], [0, RIDGE, z], 0.06);                                            // king post
  }
  const mid = (RIDGE + WALL) / 2;
  for (const [x, y] of [[0, RIDGE], [-HW, WALL], [HW, WALL], [-HW, KNEE], [HW, KNEE], [-HW / 2, mid], [HW / 2, mid]]) beam([x, y, Z0], [x, y, Z1], 0.07);
  return g.build();
}

/** Bulb wires: thin crossed strips following each swag. */
function wireGeo() {
  const g = new GeoBuilder(), w = 0.022, M = [0.5, 0.5];
  for (let i = 0; i < N_FRAMES; i++) {
    const z = Z0 + i * BAY;
    for (let s = 0; s < 14; s++) {
      const x0 = -HW + 0.2 + (s / 14) * (2 * HW - 0.4), x1 = -HW + 0.2 + ((s + 1) / 14) * (2 * HW - 0.4);
      const y0 = wireY(x0), y1 = wireY(x1);
      g.quad([x0, y0 - w, z], [x1, y1 - w, z], [x1, y1 + w, z], [x0, y0 + w, z], M, M, M, M);
      g.quad([x0, y0, z - w], [x1, y1, z - w], [x1, y1, z + w], [x0, y0, z + w], M, M, M, M);
    }
  }
  return g.build();
}

// ---- indexed textures (local) ----

/** Fogged glass: pale atmosphere shades, droplet beads, a few clear runs where drops slid down. 32x32. */
const glassTex = () => K.makeIndexed(32, 32, (x, y) => {
  const run = K.rnd(x, 0, 21) > 0.82 && y > K.rnd(x, 1, 21) * 20;      // clear trail below a drop
  if (run && K.rnd(x, 2, 21) > 0.3) return K.CLEAR;
  if (K.rnd(x, y, 22) > 0.93) return R(3, 3);                            // droplet bead
  return K.dshade(3, 1.9 + (y / 32) * 0.9 + (K.blobNoise(x, y, 8, 23) - 0.5) * 0.6, x, y);
});

/** Glazing bars: a pane outline in iron, the rest cut out. 16x16 per pane. */
const barsTex = () => K.makeIndexed(16, 16, (x, y) => (x === 0 || y === 0 ? R(0, 1) : y === 1 ? R(0, 2) : K.CLEAR));

/** Verdigris iron: weathered green-grey with paler bloom. 8x8. */
const ironTex = () => K.makeIndexed(8, 8, (x, y) => K.dshade(0, 1.2 + K.rnd(x, y, 31) * 1.3, x, y));

/** Small round bulb with a dark cap. 4x6. */
const bulbTex = () => K.makeIndexed(4, 6, (x, y) => (y === 0 ? (x === 1 || x === 2 ? R(0, 0) : K.CLEAR) : (y === 1 || y === 5) && (x === 0 || x === 3) ? K.CLEAR : R(2, y < 3 ? 3 : 2)));

/** Koi: accent-ramp body with pale blotches. 4x8 (rows = back → belly). */
const koiTex = () => K.makeIndexed(4, 8, (x, y) => (y < 4 ? (K.rnd(x, y, 41) > 0.6 ? R(3, 3) : R(2, y < 2 ? 2 : 3)) : R(0, 3)));

export class GreenhouseDusk {
  static meta = { name: 'Greenhouse at Dusk' };
  static palette = fromKeys('greenhouse-dusk', 'Greenhouse at Dusk', ['#5e9c8a', '#4f8a3c', '#ffb45a', '#36426e']);

  init(r) {
    this.sky = new K.Sky(r, { stars: 110, moon: true, moonDir: [0.45, 0.3, 1], moonSize: 5, clouds: 4, moonTexture: K.sprites.moon({ ramp: 3 }) });

    // outside: dim ground and a ring of dark trees beyond the glass
    this.outMesh = r.createMesh(plane(260, 10, 50));
    this.outTex = r.texture(K.tex.jungleFloor({ seed: 8 }));
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.pineTex = r.texture(K.sprites.pine({ ramp: 1, tiers: 5 }));
    this.pines = r.createInstances(48);
    let n = 0;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU + K.rand2(i, 1, 2) * 0.1, d = 34 + K.rand2(i, 2, 2) * 20;
      this.pines.set(n++, Math.sin(a) * d * 0.8, -0.1, PZ + Math.cos(a) * d, 9 + K.rand2(i, 3, 2) * 6, 0, 0.6 + K.rand2(i, 4, 2) * 0.3, i, 1.6);
    }
    this.pines.upload(n);

    // the building: floor, knee wall, beds, iron frame, glass
    // Near-square ~1.4-unit cells: long thin quads made the affine warp kink every grout line.
    const fl = new GeoBuilder(), NX = 12, NZ = 40, cw = (2 * HW) / NX, cd = (Z1 - Z0) / NZ, UX = 0.8 / 2, UZ = 0.4;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const x0 = -HW + i * cw, z0 = Z1 - j * cd;   // rows run from the far gable toward the camera, as before
      fl.face([x0 + cw / 2, 0, z0 - cd / 2], [cw / 2, 0, 0], [0, 0, -cd / 2], [(x0 + HW) * UX, j * cd * UZ, (x0 + cw + HW) * UX, (j + 1) * cd * UZ], 1);
    }
    this.floorMesh = r.createMesh(fl.build());
    // calmer tiles: mostly one shade with an occasional lighter one, so the floor reads as a floor, not a checkerboard
    this.floorTex = r.texture(K.props.tiles({ ramp: 0, grout: R(0, 0), cells: 4, cracked: 0.12, shades: [1, 1, 1, 2], speck: 0.06 }));
    const zc = (Z0 + Z1) / 2;
    const knee = [], beds = [], soil = new GeoBuilder();
    for (const sx of [-1, 1]) {
      knee.push({ geo: box(0.3, KNEE, Z1 - Z0, { uvRepeat: [28, 1] }), xf: K.xf({ pos: [sx * HW, KNEE / 2, zc] }) });
      const bx = sx * (BED_X0 + BED_X1) / 2, bw = BED_X1 - BED_X0;
      for (const [a, b] of BEDS) {
        const len = b - a, bz = (a + b) / 2;
        // Board sides only: a board top 0.01 under the soil z-fought with it (the soil vanished in patches).
        // The soil is the bed's top, in near-square cells so the affine warp stays calm.
        beds.push({ geo: bedSides(bw, BED_H, len, Math.round(len / 2)), xf: K.xf({ pos: [bx, BED_H / 2, bz] }) });
        const nx = 4, nz = Math.max(1, Math.round(len / (bw / nx))), cw = bw / nx, cd = len / nz;
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
          const x0 = bx - bw / 2 + i * cw, z0 = bz + len / 2 - j * cd;
          soil.face([x0 + cw / 2, BED_H, z0 - cd / 2], [cw / 2, 0, 0], [0, 0, -cd / 2], [i * cw * 0.3, j * cd * 0.3, (i + 1) * cw * 0.3, (j + 1) * cd * 0.3], 1);
        }
      }
    }
    for (const z of [Z0, Z1]) knee.push({ geo: box(2 * HW, KNEE, 0.3, { uvRepeat: [10, 1] }), xf: K.xf({ pos: [0, KNEE / 2, z] }) });
    this.kneeMesh = r.createMesh(merge(knee));
    this.stoneTex = r.texture(K.tex.mossStone({ seed: 3, rows: 2 }));
    this.bedMesh = r.createMesh(merge(beds));
    this.boardTex = r.texture(K.tex.boards({ ramp: 0, seed: 2 }));
    this.soilMesh = r.createMesh(soil.build());
    this.soilTex = r.texture(K.tex.jungleFloor({ seed: 4 }));
    this.ironMesh = r.createMesh(ironGeo());
    this.ironTex = r.texture(ironTex());
    this.glassMesh = r.createMesh(glassGeo());
    this.glassTex = r.texture(glassTex());
    this.barsTex = r.texture(barsTex());

    // planting: ferns and bushes on the beds, a few palms against the glass (all off the aisle)
    this.fernTex = r.texture(K.sprites.fern({ ramp: 1 }));
    this.bushTex = r.texture(K.sprites.bush({ ramp: 1 }));
    this.palmTex = r.texture(K.sprites.broadleaf({ ramp: 1 }));
    this.ferns = r.createInstances(90); this.bushes = r.createInstances(40); this.palms = r.createInstances(12);
    let nf = 0, nb = 0, np = 0;
    for (let i = 0; i < 160; i++) {
      // keep the aisle side of the beds clear, so nothing grows into the camera's path
      const sx = i % 2 ? 1 : -1, x = sx * (BED_X0 + 0.9 + K.rand2(i, 1, 6) * (BED_X1 - BED_X0 - 1.2)), z = Z0 + 1 + K.rand2(i, 2, 6) * (Z1 - Z0 - 2);
      if (!inBedZ(z)) continue;
      if (K.rand2(i, 3, 6) < 0.68 && nf < 90) this.ferns.set(nf++, x, BED_H - 0.05, z, 1.4 + K.rand2(i, 4, 6) * 0.7, 0, 0.8 + K.rand2(i, 5, 6) * 0.35, i, 0.75);
      else if (nb < 40) this.bushes.set(nb++, x, BED_H - 0.05, z, 1.3 + K.rand2(i, 4, 6) * 0.8, 0, 0.75 + K.rand2(i, 5, 6) * 0.3, i, 0.75);
    }
    for (let i = 0; i < 16 && np < 12; i++) {
      const sx = i % 2 ? 1 : -1, z = Z0 + 3 + (i >> 1) * 7 + K.rand2(i, 1, 8) * 2;
      if (!inBedZ(z)) continue;
      this.palms.set(np++, sx * (BED_X1 - 0.7), BED_H - 0.1, z, 3.4 + K.rand2(i, 2, 8) * 1.2, 0, 0.8 + K.rand2(i, 3, 8) * 0.25, i, 1.33);
    }
    // ferns and bushes around the far half of the pond (beyond the camera's turnaround)
    for (let i = 0; i < 9 && nf < 90; i++) {
      const a = Math.PI * (0.05 + 0.9 * (i / 8)), d = R_OUT + 0.5 + K.rand2(i, 1, 10) * 1.2;
      if (i % 3 === 1 && nb < 40) this.bushes.set(nb++, Math.cos(a) * d, 0, PZ + Math.sin(a) * d, 1.4, 0, 0.85, i, 0.75);
      else this.ferns.set(nf++, Math.cos(a) * d, 0, PZ + Math.sin(a) * d, 1.6, 0, 0.9, i, 0.75);
    }
    this.ferns.upload(nf); this.bushes.upload(nb); this.palms.upload(np);

    // hanging fronds from the tie beams, over the beds only
    this.frondTex = r.texture(K.sprites.kelp({ ramp: 1, seed: 3 }));
    this.fronds = r.createInstances(40);
    let nh = 0;
    for (let i = 1; i < N_FRAMES - 1; i++) for (const sx of [-1, 1]) {
      if (K.rand2(i, sx, 12) < 0.25) continue;
      const x = sx * (5 + K.rand2(i, sx + 3, 12) * 2.3);   // over the outer half of the beds, well off the aisle
      this.fronds.set(nh++, x, WALL - 0.05, Z0 + i * BAY, 0.9 + K.rand2(i, sx + 5, 12) * 0.4, 0, 0.8 + K.rand2(i, sx + 7, 12) * 0.3, i * 3 + sx, -(2.2 + K.rand2(i, sx + 9, 12) * 1.2));
    }
    this.fronds.upload(nh);

    // bulb swags: one under every tie beam
    this.wireMesh = r.createMesh(wireGeo());
    this.bulbTex = r.texture(bulbTex());
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.bulbs = r.createInstances(N_FRAMES * BULBS_PER); this.glows = r.createInstances(N_FRAMES * BULBS_PER);
    this.bulb = [];
    for (let i = 0; i < N_FRAMES; i++) {
      const on = 0.1 + 0.62 * clamp((i - 1) / (N_FRAMES - 3));   // beam by beam down the hall
      for (let j = 0; j < BULBS_PER; j++) {
        const x = -(HW - 1) + j * (2 * (HW - 1)) / (BULBS_PER - 1), z = Z0 + i * BAY;
        this.bulb.push({ x, y: wireY(x) - 0.06, z, s: z + Math.abs(x) * 0.6, on: on + K.rand2(i, j, 4) * 0.05, idle: (i * 5 + j * 3) % 11 === 0, ph: K.rand2(j, i, 5) * TAU });
      }
    }

    // light shafts leaning in through the glass (far half of the hall, beside the aisle)
    this.shaftTex = r.texture(K.sprites.lightShaft({ ramp: 3 }));
    this.shafts = r.createInstances(9);
    this.shaft = Array.from({ length: 9 }, (_, i) => ({ x: (i % 2 ? 1 : -1) * (2.6 + K.rand2(i, 1, 9) * 3.5), z: PZ - 1 + i * 2.8 + K.rand2(i, 2, 9) * 1.5, on: 0.3 + K.rand2(i, 3, 9) * 0.35 }));

    // the koi pond
    this.rimMesh = r.createMesh(rimGeo(8, R_OUT, R_IN, RIM_H));
    this.pondFloorMesh = r.createMesh(octagon(R_IN, POND_FLOOR, 0.35));
    this.pondFloorTex = r.texture(K.tex.mossStone({ seed: 9, rows: 4 }));
    this.waterMesh = r.createMesh(octagon(R_IN, WATER, 0.25));
    this.waterTex = r.texture(K.tex.water({ ramp: 3, seed: 6 }));
    this.caus = new K.Caustics(r, { ramp: 3 });
    this.padMesh = r.createMesh(K.decal(1, 1, 0.02));
    this.padTex = r.texture(K.tex.lilyPad({ ramp: 1, flower: 2, seed: 7 }));
    this.pads = r.createInstances(6);
    for (let i = 0; i < 6; i++) {
      const a = 0.4 + i * 1.05, d = 1.4 + K.rand2(i, 1, 3) * 1.1;
      this.pads.set(i, Math.cos(a) * d, WATER, PZ + Math.sin(a) * d, 0.55 + K.rand2(i, 2, 3) * 0.35, K.rand2(i, 3, 3) * TAU, 0.9, 0, 1);
    }
    this.pads.upload(6);
    this.koi = new K.School(r, { kind: 'fish', groups: 3, perGroup: 6, size: 0.7, spread: [0.4, 1.3], lift: 0.04, texture: koiTex() });
    this.ripples = new K.Ripples(r, { color: R(3, 3), life: 3.8 });
    this.pulses = new K.Pulses({ width: 3.2, decay: 1.3 });

    // air
    this.pollen = new K.Particles(r, 'pollen', { area: [14, 4.4, 18] });
    this.sparkle = new K.Particles(r, 'starTwinkle', { count: 36, area: [13, 4, 16], yOffset: 0, size: 0.14, flickerRate: 6 });

    this.cam = new K.CameraRig({ fov: 62, far: 140, idleSpeed: 0.045, activeSpeed: 0.06, bassBoost: 0, fovPunch: 0.4, nudge: 0.03, rollKick: 0.004 });
    this.cam.s = 0;
    this.breath = new K.Breath({ beats: 8, period: 12 });
    this.time = 0; this.k = 0; this.gather = 0; this.spark = 0; this.nextIdleRipple = 3; this.d = K.drive({ level: 0, bass: 0, mid: 0, high: 0, beatPulse: 0 }, 0);
    this.m = mat4.create(); this.mPond = mat4.create();
    mat4.trs(this.mPond, 0, 0, PZ, 0, 0, 0, 1, 1, 1);
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], warm: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], out: [0, 0, 0], glass: [0, 0, 0], water: [0, 0, 0], koi: [0, 0, 0], shaft: [0, 0, 0], bulb: [0, 0, 0] };
  }

  _camera(a, k, dt) {
    const c = this.cam;
    c.update(a, k, dt);
    c.s += c.speed * dt;
    const s = c.s, b = this.breath.v, u = 0.5 - 0.5 * Math.cos(s);   // u = 1 at the pond end
    // slow dolly up the aisle and back, facing the pond the whole way (no turnaround)
    c.eye[0] = Math.sin(s * 0.53) * 0.5;
    c.eye[1] = 1.7 + b * 0.25 + u * 0.35;
    c.eye[2] = CAM_Z - Math.cos(s) * CAM_AMP;
    c.target[0] = c.eye[0] * 0.3 + Math.sin(s * 0.31 + 1) * 1.6;
    c.target[1] = 1.75 - u * u * 1.1 + b * 0.35 + Math.sin(s * 0.7) * 0.2;   // dips to look into the pond
    c.target[2] = c.eye[2] + 12;
  }

  update(a, k, dt) {
    this.k = k; this.time += dt;
    const d = (this.d = K.drive(a, k)), t = this.time;
    const b = this.breath.update(a, dt);
    this._camera(a, k, dt);
    const eye = this.cam.eye;

    // beats: one pulse runs down the hall through the bulbs, one ripple opens on the pond
    if (d.beat) {
      this.pulses.trigger(eye[2] + 2, 0.5 + k * 0.5, 9);
      const ang = K.rand2(a.beatCount || 0, 1, 3) * TAU, rr = 0.6 + K.rand2(a.beatCount || 0, 2, 3) * 2;
      this.ripples.spawn(Math.cos(ang) * rr, WATER + 0.01, PZ + Math.sin(ang) * rr, 1.4 + k * 1.2);
    }
    // idle life: now and then a koi touches the surface
    if ((this.nextIdleRipple -= dt) <= 0) {
      this.nextIdleRipple = 3 + Math.random() * 5;
      const ang = Math.random() * TAU, rr = Math.random() * 2.4;
      this.ripples.spawn(Math.cos(ang) * rr, WATER + 0.01, PZ + Math.sin(ang) * rr, 1 + Math.random() * 0.6);
    }
    this.pulses.update(dt);
    this.ripples.update(dt);
    this.caus.update(dt, 0.5 + k * 0.4);

    // bulbs: a few glow at idle, the rest come on beam by beam; the pulse adds on top
    this.bulb.forEach((B, i) => {
      const lit = Math.max(B.idle ? 0.8 : 0.03, K.stage(k, B.on, B.on + 0.16));
      const lvl = lit * (0.82 + 0.18 * b + 0.04 * Math.sin(t * 1.3 + B.ph)) + this.pulses.at(B.s) * (0.25 + lit * 0.6);
      this.bulbs.set(i, B.x, B.y - 0.17, B.z, 0.15, 0, 0.3 + lvl * 0.85, 0, 1.4);
      // glows right over the lens fade out, so a passing swag never fills the screen
      const near = K.fadeIn(Math.hypot(B.x - eye[0], B.y - eye[1], B.z - eye[2]), 2.2, 5.5);
      const gs = (0.3 + lvl * 0.32) * (0.5 + 0.5 * near);
      this.glows.set(i, B.x, B.y - 0.1 - gs * 0.5, B.z, gs, 0, lvl * 0.75 * near, 0, 1);
    });
    this.bulbs.upload(this.bulb.length); this.glows.upload(this.bulb.length);

    // light shafts lean in one after another with the swell, breathing slowly
    this.shaft.forEach((S, i) => {
      const v = K.stage(k, S.on, S.on + 0.25) * (0.7 + 0.3 * b);
      this.shafts.set(i, S.x, 0, S.z, 2.8, 0, v, 0, 2.8, 0, -0.32);   // all lean the same way: low light from one side
    });
    this.shafts.upload(this.shaft.length);

    // koi: a few mill around at idle, more arrive and gather at the near rim as the song swells
    this.gather += (k - this.gather) * Math.min(1, dt * 0.4);
    const G = this.gather;
    this.koi.update(dt, (g, tt, out) => {
      const ang = tt * 0.16 * (g % 2 ? -1 : 1) + g * 2.1, rad = lerp(1.35, 0.6, G);
      out[0] = Math.cos(ang) * rad; out[1] = WATER - 0.16; out[2] = PZ + Math.sin(ang) * rad * 0.8 - G * 0.9;
    }, { amount: K.swell(k, 0.4, 1), speed: 0.55 + k * 0.2 });

    // air: pollen floats ahead of the camera (never at the lens), sparkles on the highs
    this.spark += (d.high - this.spark) * Math.min(1, dt * 3);
    const ahead = [eye[0] * 0.5, 2.6, eye[2] + 12];
    this.pollen.update(dt, ahead, { amount: K.swell(k, 0.35, 0.9), speed: 0.4 + k * 0.25, wind: [0.05, 0.03] });
    this.sparkle.update(dt, ahead, { amount: clamp(this.spark * 1.6), speed: 0.3 });
  }

  render(r) {
    const { col, k } = this, P = this.pal, b = this.breath.v;
    const dim = lerp(0.62, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 7, lerp(44, 60, k));
    // the light warms up as the bulbs come on
    const warm = K.stage(k, 0.2, 1) * 0.55, L = P.role('light'), A = P.color(R(2, 2));
    for (let i = 0; i < 3; i++) col.warm[i] = lerp(L[i], A[i], warm);
    r.setLight([0.35, -0.8, 0.45], scaleColor(col.light, col.warm, lerp(0.38, 0.72, k)), scaleColor(col.amb, P.role('ambient'), 0.52));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    // outside: dusk sky, dim ground, dark trees
    this.sky.draw(r, this.cam.eye, { horizon: col.fog, zenith: P.color(R(3, 0)), brightness: lerp(0.75, 0.95, k), starLevel: 0.35 + b * 0.15, cloudDrift: this.time * 0.003 });
    col.out[0] = col.out[1] = col.out[2] = dim * 0.45;
    r.draw(this.outMesh, mat4.trs(this.m, 0, -0.08, PZ, 0, 0, 0, 1, 1, 1), { texture: this.outTex, tint: col.out });
    r.drawInstanced(this.quad, this.pines, { texture: this.pineTex, billboard: 1, tint: col.out });

    // the building
    r.draw(this.floorMesh, mat4.identity(this.m), { texture: this.floorTex, tint: col.tint });
    r.draw(this.kneeMesh, this.m, { texture: this.stoneTex, tint: col.tint });
    r.draw(this.bedMesh, this.m, { texture: this.boardTex, tint: col.tint });
    r.draw(this.soilMesh, this.m, { texture: this.soilTex, tint: col.tint });
    r.draw(this.ironMesh, this.m, { texture: this.ironTex, tint: col.tint });

    // plants
    const sway = 0.012 + b * 0.015 + this.d.mid * 0.03;
    r.drawInstanced(this.quad, this.ferns, { texture: this.fernTex, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.bushes, { texture: this.bushTex, billboard: 1, sway: sway * 0.5, tint: col.tint });
    r.drawInstanced(this.quad, this.palms, { texture: this.palmTex, billboard: 1, sway: sway * 0.6, tint: col.tint });
    r.drawInstanced(this.quad, this.fronds, { texture: this.frondTex, billboard: 1, sway: sway * 2.2, tint: col.tint });

    // pond: floor + caustics, koi, then the water over them (screen-door), pads and rings on top
    r.draw(this.rimMesh, this.mPond, { texture: this.stoneTex, tint: col.tint });
    col.water[0] = col.water[1] = col.water[2] = dim * 0.8;
    r.draw(this.pondFloorMesh, this.mPond, { texture: this.pondFloorTex, tint: col.water });
    this.caus.draw(r, this.pondFloorMesh, { model: this.mPond, brightness: lerp(0.2, 0.62, k) * (0.85 + 0.15 * b), uvScale: [1.2, 1.2] });
    col.koi[0] = col.koi[1] = col.koi[2] = lerp(0.9, 1.25, k);
    this.koi.draw(r, { tint: col.koi });
    col.water[0] = col.water[1] = col.water[2] = dim * 0.85;
    const drift = this.time * 0.008;
    r.draw(this.waterMesh, this.mPond, { texture: this.waterTex, tint: col.water, opacity: lerp(0.42, 0.3, k), uvOffset: [drift, drift * 0.4] });
    r.drawInstanced(this.padMesh, this.pads, { texture: this.padTex, tint: col.tint });
    this.ripples.draw(r, { brightness: lerp(0.3, 0.65, k) });

    // glass last among the solids: fogged panes over the dusk, iron glazing bars
    col.glass[0] = col.glass[1] = col.glass[2] = lerp(0.65, 0.8, k) * (0.9 + 0.1 * b);
    r.draw(this.glassMesh, this.m, { texture: this.glassTex, unlit: true, tint: col.glass, opacity: 0.34, uvScale: [0.55, 0.7] });
    r.draw(this.glassMesh, this.m, { texture: this.barsTex, tint: col.tint, uvScale: [1 / 1.4, 1 / 0.9] });

    // bulbs: wires, the bulbs themselves, then additive glows that shine through the fog
    r.draw(this.wireMesh, this.m, { tint: scaleColor(col.bulb, P.color(R(0, 0)), dim) });
    col.glow[0] = col.glow[1] = col.glow[2] = lerp(0.85, 1, k);
    r.drawInstanced(this.quad, this.bulbs, { texture: this.bulbTex, billboard: 2, unlit: true, tint: col.glow });
    r.drawInstanced(this.quad, this.glows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [30, 58], tint: col.glow });

    // light shafts and the air
    col.shaft[0] = col.shaft[1] = col.shaft[2] = 0.32;
    r.drawInstanced(this.quad, this.shafts, { texture: this.shaftTex, billboard: 1, unlit: true, additive: true, tint: col.shaft });
    this.pollen.draw(r, { brightness: lerp(0.7, 1.05, k) + this.spark * 0.6 });
    this.sparkle.draw(r, { brightness: 0.5 + this.spark * 0.8 });
  }

  dispose(r) {
    this.sky.dispose(r);
    [this.koi, this.ripples, this.caus, this.pollen, this.sparkle].forEach((x) => x.dispose(r));
    [this.outMesh, this.quad, this.floorMesh, this.kneeMesh, this.bedMesh, this.soilMesh, this.ironMesh, this.glassMesh, this.wireMesh, this.rimMesh, this.pondFloorMesh, this.waterMesh, this.padMesh].forEach((m) => m.dispose());
    [this.outTex, this.pineTex, this.floorTex, this.stoneTex, this.boardTex, this.soilTex, this.ironTex, this.glassTex, this.barsTex, this.fernTex, this.bushTex, this.palmTex, this.frondTex, this.bulbTex, this.glowTex, this.shaftTex, this.pondFloorTex, this.waterTex, this.padTex].forEach((t) => r.deleteTexture(t));
    [this.pines, this.ferns, this.bushes, this.palms, this.fronds, this.bulbs, this.glows, this.shafts, this.pads].forEach((i) => i.dispose());
  }
}
