// STATION DECK — an endless ring corridor aboard an orbital station.
//
//   ribbed gunmetal corridor with floor grating, chamfered ceiling, wall pipes
//   viewport windows on the outer wall showing stars and a huge banded planet
//   bulkheads with sliding double doors, hazard trim and deck signage
//   holo panels on the inner wall with animated indexed screens (r.updateTexture)
//   the corridor gently curves left: it is a real ring (96 segments, 8 units each,
//   bent around the station hub), recycled with K.forSegments
//
// Intensity: idle = low-power mode. Only the red emergency strips glow (with a
// slow chase toward the exit), doors stay shut until you reach them, holo panels
// sit on standby, "LOW POWER" blinks over the doors, slow drift.
// Swell = sections power up one by one (ceiling lights flicker on), holo panels
// boot (scan-line reveal), doors cycle open down the deck, deck signs light up.
// Beat = a door wave travels down the corridor (open doors slam, shut ones bang
// open), alarm beacons flash, camera nudge. Bass = drift speed + hum vibration.
// Highs = holo glitches (row tearing) and sparkle.
// Light (Kit v7): each section's ceiling lamps are a point light as it powers up; in low power
// (and on the alarm) a red emergency light glows low in the corridor instead (K.LightSet, best 4).
// Colours: base = gunmetal hull, secondary = teal screens/planet, accent =
// warning red/amber (emergency strips, beacons, hazard trim), atmosphere = navy.
import { mat4, lerp, damp, clamp, hash } from '../gfx/math.js';
import { scaleColor, addColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, box, flatNormals } from '../gfx/geometry.js';
import { solid } from '../gfx/textures.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const SEG = 8, RING = 96;                    // segment length, segments per lap
const RR = (SEG * RING) / (2 * Math.PI);     // corridor centre-line radius (~122)
const HW = 3, WALL = 2.5, CX = 2, CY = 3.3;  // half width, wall top, ceiling half width / height
const DW = 1.2, DH = 2.6;                    // doorway half width, height
const WY0 = 0.6, WY1 = 2.3, WZ0 = -2.6, WZ1 = -5.4; // viewport window opening (outer wall)
const EYE = 1.65, AHEAD = 72, MAXSEG = 12;
const HT_W = 48, HT_H = 32;                  // holo texture size
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- textures
// one 128x128 atlas: A wall panel | B floor grating / C dark metal | D hazard stripes
const AT = 128;
const reg = (ix, iy) => { const e = 0.5 / AT; return [ix * 0.5 + e, iy * 0.5 + e, ix * 0.5 + 0.5 - e, iy * 0.5 + 0.5 - e]; };
const A = reg(0, 0), B = reg(1, 0), C = reg(0, 1), D = reg(1, 1);

function atlasTex() {
  return K.makeIndexed(AT, AT, (px, py) => {
    const x = px & 63, y = py & 63, q = (px >> 6) + (py >> 6) * 2;
    const n = K.blobNoise(px, py, 7, 3) - 0.5, g = K.rnd(px, py, 1);
    if (q === 0) { // wall panel: two plates, seams, rivets, a mid band
      if (x === 0 || y === 0 || x === 32 || y === 63) return R(0, 0);
      if (x === 1 || y === 1 || x === 33) return R(0, 2);
      if ((x === 4 || x === 28 || x === 37 || x === 59) && (y === 4 || y === 59)) return R(0, 3);
      if (y > 26 && y < 36) return y === 27 || y === 35 ? R(0, 0) : K.dshade(0, 1.1 + n, x, y);
      return K.dshade(0, 1.75 + n * 0.8 + (g < 0.05 ? -0.5 : 0), x, y);
    }
    if (q === 1) { // floor grating: slots in a raised frame
      if (x < 3 || x > 60 || y < 3 || y > 60) return K.dshade(0, 1.4 + n, x, y);
      const sx = (x - 3) % 6, sy = (y - 3) % 14;
      if (sx < 2 || sy < 2) return K.dshade(0, sx === 0 || sy === 0 ? 2.6 : 2.0, x, y);
      return g < 0.08 ? R(0, 1) : R(3, 0);
    }
    if (q === 2) { // dark metal (ribs, frames, pipes, floor plates): tread pattern
      const tread = ((x + (y >> 3) * 4) % 8 === 0) && (y & 7) < 5;
      return K.dshade(0, (tread ? 1.9 : 0.9) + n * 0.7, x, y);
    }
    // hazard stripes
    const s = ((x + y) >> 3) & 1;
    if (y < 2 || y > 61) return R(0, 0);
    return s ? K.dshade(2, 1.3 + n * 0.6, x, y) : K.dshade(0, 0.4 + n * 0.4, x, y);
  });
}

function doorTex() {
  return K.makeIndexed(32, 64, (x, y) => {
    const n = K.blobNoise(x, y, 5, 8) - 0.5;
    if (x === 0 || x === 31 || y === 0 || y === 63) return R(0, 0);
    if (y > 46 && y < 54) return (((x + y) >> 2) & 1) ? R(2, 1) : R(0, 0);      // hazard band
    if (x > 9 && x < 22 && y > 12 && y < 22) return x === 10 || y === 13 ? R(0, 0) : K.dshade(3, 0.6 + (y - 13) * 0.08, x, y); // slit window
    if (x === 3 || x === 28) return R(0, 3);
    return K.dshade(0, 1.6 + n * 0.8, x, y);
  });
}

/** Emergency strip: dashes with transparent gaps (scrolled with uvOffset for a chase). */
const stripTex = () => K.makeIndexed(16, 2, (x) => (x < 10 ? (x > 2 && x < 8 ? R(2, 3) : R(2, 2)) : K.CLEAR));

function planetTex() {
  const S = 128, c = 63.5, rad = 58;
  const L = [-0.62, -0.38, 0.69];
  return K.makeIndexed(S, S, (x, y) => {
    const nx = (x - c) / rad, ny = (y - c) / rad, d = Math.hypot(nx, ny);
    if (d > 1.07) return K.CLEAR;
    if (d > 1) return K.bayer(x, y) < (1.07 - d) * 12 ? R(3, 2) : K.CLEAR;   // thin dithered atmosphere
    const nz = Math.sqrt(1 - d * d), l = nx * L[0] + ny * L[1] + nz * L[2];
    if (l < -0.08) return K.bayer(x, y) < 0.15 ? R(1, 0) : R(3, 0);         // night side
    const band = Math.sin(ny * 13 + (K.blobNoise(x, y, 14, 4) - 0.5) * 5) + (K.blobNoise(x, y, 5, 2) - 0.5) * 0.6;
    const cloud = K.blobNoise(x * 0.6, y * 1.4, 7, 9) * 0.7 + K.blobNoise(x, y, 3, 5) * 0.3;
    const sh = 0.3 + Math.max(0, l) * 2.6 + band * 0.35;
    if (d > 0.9 && l > 0) return K.dshade(3, 1.8 + l * 1.4, x, y);           // lit limb glow
    if (cloud > 0.64) return K.dshade(3, sh + 0.4, x, y);
    return K.dshade(1, sh, x, y);
  });
}

// ---------------------------------------------------------------- geometry
/** Ring-local point -> world: x = across (+ = outer wall), z = along (0 .. -SEG). */
const ringPt = (x, y, along) => { const a = along / RR, p = RR + x; return [p * Math.cos(a), y, -p * Math.sin(a)]; };

/** Bend a straight segment (built along -Z) around the ring hub, in place. */
function bend(geo) {
  const p = geo.positions;
  for (let i = 0; i < p.length; i += 3) { const q = ringPt(p[i], p[i + 1], -p[i + 2]); p[i] = q[0]; p[i + 2] = q[2]; }
  return flatNormals(geo);
}

/** nu x nv quads spanning o + du, o + dv, each mapping the full atlas rect; normal faces `want`. */
function tiles(g, o, du, dv, nu, nv, rect, want) {
  const P = (a, b) => [o[0] + du[0] * a + dv[0] * b, o[1] + du[1] * a + dv[1] * b, o[2] + du[2] * a + dv[2] * b];
  const [u0, v0, u1, v1] = rect;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a0 = i / nu, a1 = (i + 1) / nu, b0 = j / nv, b1 = (j + 1) / nv;
    K.quadFacing(g, P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1), [u0, v1], [u1, v1], [u1, v0], [u0, v0], want);
  }
}

/** Box from min/max corners into a GeoBuilder (all faces one atlas rect). */
const boxMM = (g, x0, y0, z0, x1, y1, z1, rect) =>
  K.orientedBox(g, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [(x1 - x0) / 2, 0, 0], [0, (y1 - y0) / 2, 0], [0, 0, (z1 - z0) / 2], rect);

/** The corridor shell for one segment (straight, then bent). */
function shellGeo() {
  const g = new GeoBuilder(), L = -SEG, up = [0, 1, 0], dn = [0, -1, 0];
  // floor: grating down the middle, tread plates at the sides
  tiles(g, [-1.5, 0, 0], [3, 0, 0], [0, 0, L], 2, 4, B, up);
  tiles(g, [-HW, 0, 0], [1.5, 0, 0], [0, 0, L], 1, 4, C, up);
  tiles(g, [1.5, 0, 0], [1.5, 0, 0], [0, 0, L], 1, 4, C, up);
  // inner wall (left) + outer wall (right) around the viewport opening
  tiles(g, [-HW, 0, 0], [0, WALL, 0], [0, 0, L], 1, 4, A, [1, 0, 0]);
  const ow = [-1, 0, 0];
  tiles(g, [HW, 0, 0], [0, WY0, 0], [0, 0, L], 1, 4, A, ow);
  tiles(g, [HW, WY1, 0], [0, WALL - WY1, 0], [0, 0, L], 1, 4, A, ow);
  tiles(g, [HW, WY0, 0], [0, WY1 - WY0, 0], [0, 0, WZ0], 1, 1, A, ow);
  tiles(g, [HW, WY0, WZ1], [0, WY1 - WY0, 0], [0, 0, L - WZ1], 1, 1, A, ow);
  // window reveal (a short tunnel through the hull) + inner frame + mullion
  const RD = 0.4;
  tiles(g, [HW, WY1, WZ0], [RD, 0, 0], [0, 0, WZ1 - WZ0], 1, 2, C, dn);
  tiles(g, [HW, WY0, WZ0], [RD, 0, 0], [0, 0, WZ1 - WZ0], 1, 2, C, up);
  tiles(g, [HW, WY0, WZ0], [RD, 0, 0], [0, WY1 - WY0, 0], 1, 1, C, [0, 0, -1]);
  tiles(g, [HW, WY0, WZ1], [RD, 0, 0], [0, WY1 - WY0, 0], 1, 1, C, [0, 0, 1]);
  const F = 0.12;
  boxMM(g, HW - F, WY1, WZ1 - F, HW, WY1 + F, WZ0 + F, C);
  boxMM(g, HW - F, WY0 - F, WZ1 - F, HW, WY0, WZ0 + F, C);
  boxMM(g, HW - F, WY0, WZ0, HW, WY1, WZ0 + F, C);
  boxMM(g, HW - F, WY0, WZ1 - F, HW, WY1, WZ1, C);
  boxMM(g, HW + 0.12, WY0, -4.06, HW + 0.2, WY1, -3.94, C);
  // chamfers + ceiling
  tiles(g, [-HW, WALL, 0], [HW - CX, CY - WALL, 0], [0, 0, L], 1, 4, A, [1, -1, 0]);
  tiles(g, [HW, WALL, 0], [CX - HW, CY - WALL, 0], [0, 0, L], 1, 4, A, [-1, -1, 0]);
  tiles(g, [-CX, CY, 0], [CX * 2, 0, 0], [0, 0, L], 2, 4, A, dn);
  // ribs following the cross-section, flanking the window
  const prof = [[-HW, 0], [-HW, WALL], [-CX, CY], [CX, CY], [HW, WALL], [HW, 0]];
  for (const rz of [-1.2, -6.8]) {
    for (let e = 0; e < prof.length - 1; e++) {
      const [ax, ay] = prof[e], [bx, by] = prof[e + 1];
      let nx = -(by - ay), ny = bx - ax; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      if ((0 - mx) * nx + (1.6 - my) * ny < 0) { nx = -nx; ny = -ny; }   // point inward
      const T = 0.09, ext = 1 + 0.12 / Math.hypot(bx - ax, by - ay);
      K.orientedBox(g, [mx + nx * T, my + ny * T, rz], [(bx - ax) / 2 * ext, (by - ay) / 2 * ext, 0], [nx * T, ny * T, 0], [0, 0, 0.16], C);
    }
  }
  // pipes: two along the inner wall, one above the windows
  const pipe = (x, y, rad) => {
    const p = K.props.rotX(K.props.prism(6, rad, SEG, { cap: false }), -Math.PI / 2);
    K.atlasUV(p, C); K.props.shift(p, x, y, 0);
    for (let i = 0; i < p.count; i++) g.pos.push(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]);
    for (let i = 0; i < p.count; i++) { g.nrm.push(0, 1, 0); g.uv.push(p.uvs[i * 2], p.uvs[i * 2 + 1]); g.col.push(1, 1, 1); }
  };
  pipe(-HW + 0.14, 2.28, 0.09); pipe(-HW + 0.14, 2.04, 0.07); pipe(HW - 0.12, 2.42, 0.07);
  // console + holo frame on the inner wall
  boxMM(g, -HW, 0, -5, -HW + 0.5, 0.85, -3, C);
  boxMM(g, -HW, 1.12, -4.95, -HW + 0.05, 2.28, -3.05, C);
  return bend(g.build());
}

/** Additive light geometry inside one segment (bent): ceiling lamps, floor pools, emergency strips. */
function lampGeo() {
  const g = new GeoBuilder(), dn = [0, -1, 0];
  for (const [z0, z1] of [[-1.8, -3.4], [-4.6, -6.2]]) tiles(g, [-0.45, CY - 0.03, z0], [0.9, 0, 0], [0, 0, z1 - z0], 1, 1, [0, 0, 1, 1], dn);
  return bend(g.build());
}
function poolGeo() {
  const g = new GeoBuilder(), up = [0, 1, 0];
  for (const [z0, z1] of [[-0.9, -4.1], [-3.9, -7.1]]) tiles(g, [-1.7, 0.02, z0], [3.4, 0, 0], [0, 0, z1 - z0], 1, 1, [0, 0, 1, 1], up);
  return bend(g.build());
}
function stripGeo() {
  const g = new GeoBuilder(), rep = SEG / 1.5;
  const strip = (x, y0, y1, want) => K.quadFacing(g, [x, y0, 0], [x, y0, -SEG], [x, y1, -SEG], [x, y1, 0], [0, 1], [rep, 1], [rep, 0], [0, 0], want);
  strip(-HW + 0.03, 0.1, 0.18, [1, 0, 0]); strip(HW - 0.03, 0.1, 0.18, [-1, 0, 0]);
  strip(-HW + 0.03, WALL - 0.1, WALL - 0.03, [1, 0, 0]); strip(HW - 0.03, WALL - 0.1, WALL - 0.03, [-1, 0, 0]);
  return bend(g.build());
}

/** Bulkhead frame around a doorway (not bent; placed radially at a segment boundary). */
function bulkheadGeo() {
  const g = new GeoBuilder(), Z = 0.25;
  boxMM(g, -HW - 0.2, 0, -Z, -DW, CY + 0.2, Z, C);
  boxMM(g, DW, 0, -Z, HW + 0.2, CY + 0.2, Z, C);
  boxMM(g, -DW, DH, -Z, DW, CY + 0.2, Z, C);
  // hazard trim: jambs, lintel, threshold
  boxMM(g, -DW - 0.02, 0, -Z - 0.06, -DW + 0.1, DH, Z + 0.06, D);
  boxMM(g, DW - 0.1, 0, -Z - 0.06, DW + 0.02, DH, Z + 0.06, D);
  boxMM(g, -DW - 0.02, DH - 0.1, -Z - 0.06, DW + 0.02, DH + 0.02, Z + 0.06, D);
  boxMM(g, -DW, 0, -Z - 0.12, DW, 0.04, Z + 0.12, D);
  return g.build();
}

/** Holo screen: quad facing +X (the corridor, from the inner wall), pivot at its centre. */
function holoGeo() {
  const g = new GeoBuilder();
  K.quadFacing(g, [0, -0.5, 0.88], [0, -0.5, -0.88], [0, 0.5, -0.88], [0, 0.5, 0.88], [0, 1], [1, 1], [1, 0], [0, 0], [1, 0, 0]);
  return g.build();
}

// ---------------------------------------------------------------- holo screens
/** Fill an indexed holo screen in place. variant 0 = bar graph + radar, 1 = scrolling log + waveform. */
function drawHolo(gen, variant, t, boot, glitch, alarm) {
  const W = HT_W, H = HT_H, d = gen.data, frame = Math.floor(t * 12), reveal = boot * (H + 3);
  const blips = [[30, 9], [40, 21], [33, 22]];
  const px = (x, y) => {
    if (x < 0 || x >= W) return K.CLEAR;
    if (boot < 0.02) { // standby: dim corners + blinking cursor
      if ((x < 3 || x > W - 4) && (y === 0 || y === H - 1)) return R(1, 1);
      return x > 2 && x < 6 && y > H - 6 && y < H - 3 && Math.sin(t * 3.2) > 0 ? R(1, 2) : K.CLEAR;
    }
    if (y > reveal) return K.CLEAR;
    if (boot < 1 && reveal - y < 1.2) return R(1, 3);                      // boot scan line
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return (x < 4 || x > W - 5) && (y < 4 || y > H - 5) ? R(1, 3) : R(1, 1);
    const bg = (y & 1) === 0 && ((x + y) & 3) === 0 ? R(1, 0) : K.CLEAR;
    if (variant === 0) {
      if (x >= 2 && x < 22 && y >= 3 && y < H - 3) {
        const b = (x - 2) >> 2;
        if ((x - 2) % 4 === 3) return bg;
        const h = 0.5 + 0.45 * Math.sin(t * (1.1 + b * 0.37) + b * 2.1);
        const top = H - 3 - h * (H - 7);
        if (y < top) return bg;
        return y < top + 1 ? R(1, 3) : h > 0.84 ? R(2, 2) : R(1, 2);
      }
      const dx = x - 35, dy = y - 16, dd = Math.hypot(dx, dy);
      if (dd > 11.6) return bg;
      for (const [bx, by] of blips) if (Math.abs(x - bx) + Math.abs(y - by) < 1.1) {
        const ba = ((t * 2.2 - Math.atan2(by - 16, bx - 35)) % TAU + TAU) % TAU;
        if (ba < 2) return R(2, 3);
      }
      const ang = ((t * 2.2 - Math.atan2(dy, dx)) % TAU + TAU) % TAU;
      if (ang < 1.3) return K.dshade(1, 3 - ang * 2.3, x, y);
      if (Math.abs(dd - 11) < 0.7 || Math.abs(dd - 5.5) < 0.5) return R(1, 1);
      return dx === 0 || dy === 0 ? R(1, 0) : bg;
    }
    // variant 1: header, scrolling log, waveform
    if (y >= 2 && y < 6) return x > 1 && x < W - 2 ? (alarm > 0.2 ? K.dshade(2, 1 + alarm * 2, x, y) : (x % 5 < 3 && y > 2 && y < 5 ? R(1, 3) : R(1, 1))) : bg;
    if (y >= 8 && y < 21) {
      const sc = Math.floor(t * 5), yy = y - 8 + sc, line = Math.floor(yy / 3);
      const len = 6 + Math.floor(hash(line, 3) * 36);
      if (yy % 3 === 2 || x < 3 || x > len || x % 3 === 2) return bg;
      const on = hash(Math.floor(x / 3), line) > 0.22;
      return on ? (hash(line, 7) > 0.85 ? R(2, 2) : R(1, 2)) : bg;
    }
    if (y >= 22 && y < 30) {
      const wy = 26 + Math.sin(x * 0.45 + t * 5) * 2.6 * Math.sin(t * 0.7 + x * 0.05);
      if (Math.abs(y - wy) < 0.8) return R(1, 3);
      return x % 6 === 0 && y % 4 === 0 ? R(1, 0) : K.CLEAR;
    }
    return bg;
  };
  for (let y = 0; y < H; y++) {
    const tear = K.rnd(y, frame, 3 + variant) < glitch * 0.35 ? Math.floor((K.rnd(y, frame, 9) - 0.5) * 12) : 0;
    for (let x = 0; x < W; x++) {
      let v = px(x + tear, y);
      if (glitch > 0.02 && K.rnd(x, y, frame + variant * 50) < glitch * 0.04) v = R(3, 3);   // sparkle
      d[y * W + x] = v;
    }
  }
  return gen;
}

// ---------------------------------------------------------------- style
export class StationDeck {
  static meta = { name: 'Station Deck' };
  static palette = fromKeys('station-deck', 'Station Deck', ['#5d6672', '#2fb7ae', '#ff4a26', '#0a1434']);

  init(r) {
    this.tex = {
      atlas: r.texture(atlasTex()), door: r.texture(doorTex()), strip: r.texture(stripTex()),
      lamp: r.texture(solid(R(3, 3))), pool: r.texture(K.sprites.glow({ ramp: 3 })),
      beacon: r.texture(K.sprites.glow({ ramp: 2 })), planet: r.texture(planetTex()),
    };
    this.holoGen = [0, 1].map(() => ({ data: new Uint8Array(HT_W * HT_H).fill(K.CLEAR), width: HT_W, height: HT_H, indexed: true }));
    this.tex.holo = this.holoGen.map((g) => r.texture(g));

    this.mesh = {
      shell: r.createMesh(shellGeo()), lamp: r.createMesh(lampGeo()), pool: r.createMesh(poolGeo()),
      strip: r.createMesh(stripGeo()), bulk: r.createMesh(bulkheadGeo()), holo: r.createMesh(holoGeo()),
      door: r.createMesh(K.props.shift(box(DW, DH, 0.1), 0, DH / 2, 0)),
      quad: r.createMesh(K.billboardQuad(1, 1)),
    };
    this.inst = {
      shell: r.createInstances(MAXSEG), lamp: r.createInstances(MAXSEG), strip: r.createInstances(MAXSEG),
      holo0: r.createInstances(MAXSEG), holo1: r.createInstances(MAXSEG), bulk: r.createInstances(MAXSEG),
      door: r.createInstances(MAXSEG * 2), beacon: r.createInstances(MAXSEG * 2), planet: r.createInstances(1),
    };
    this.lowSign = new K.NeonText(r, 'LOW POWER', { height: 0.3 });
    this.deckSign = new K.NeonText(r, 'DECK 07', { height: 0.34, core: R(1, 3), mid: R(1, 2), outline: R(1, 0) });
    this.signs = [];

    this.sky = new K.Sky(r, { stars: 220 });
    this.dust = new K.Particles(r, 'dust', { count: 110, area: [16, 3.2, 16], yOffset: 0, color: R(3, 3) });

    const path = (s, out) => {
      const lat = Math.sin(s * 0.045) * 0.35, q = ringPt(lat, EYE + Math.sin(s * 0.7) * 0.03, s);
      out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; return out;
    };
    this.cam = new K.PathRig(path, { lookAhead: 9, idleSpeed: 0.6, activeSpeed: 3.4, bassBoost: 1.6, fov: 66, far: 400, nudge: 0.18, rollKick: 0.02, fovPunch: 3 });
    this.alarm = new K.Envelope(0.24);
    this.slam = new K.Spring(5);
    this.wave = new K.History(90);
    this.time = 0; this.k = 0; this.d = null; this.bassS = 0; this.lvlS = 0; this.stripT = 0;
    this.m = mat4.create();
    this.col = { fog: [0, 0, 0], space: [0, 0, 0], zen: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], tmp: [0, 0, 0], lamp: [0, 0, 0], one: [1, 1, 1], strip: [0, 0, 0], holo: [0, 0, 0], pLamp: [0, 0, 0], pRed: [0, 0, 0], focus: [0, 0, 0] };
    this.lights = new K.LightSet({ reach: 6, cap: 32 });
  }

  update(a, k, dt) {
    this.k = k; this.time += dt; this.dt = dt;
    const d = this.d = K.drive(a, k);
    this.cam.update(a, k, dt);
    // hum vibration: the hull buzzes with the bass
    // (Gentle: bass is eased and the buzz is a faint tremor, so the camera stays calm; Punchy is unchanged)
    const bm = d.beatMotion;
    this.bassS = damp(this.bassS, d.bass, 0.5, dt);
    this.lvlS = damp(this.lvlS, d.level, 0.5, dt);
    const e = this.cam.eye, t = this.time, hum = lerp(this.bassS * 0.35, d.bass, bm) * 0.016;
    e[0] += Math.sin(t * 53) * hum; e[1] += Math.sin(t * 47 + 1) * hum;
    this.cam.target[1] += 0.12 + Math.sin(t * 0.13) * 0.12;
    if (d.beat) { this.alarm.trigger(k); this.slam.kick(13 * k * bm); }
    this.alarm.update(dt); this.slam.update(dt);
    // the doors' wave: Gentle sends a soft groove swing down the corridor instead of the beat slam
    this.wave.push(clamp(lerp(d.groove * 0.35, this.slam.x, bm), 0, 1));
    this.stripT += dt * (0.25 + k * 0.6);   // integrated: strip scroll rate follows k without the phase jumping
    this.dust.update(dt, e, { amount: K.swell(k, 0.35, 0.9), speed: 0.5 + lerp(this.lvlS, d.level, bm), wind: [0, 0] });
  }

  /** Section power 0..1 for ring segment j (with a flicker while it comes on). */
  _power(j, k) {
    const from = 0.04 + hash(j, 7) * 0.6, p = K.stage(k, from, from + 0.14);
    return p * (1 - p * (1 - p) * 2.4 * (0.5 + 0.5 * Math.sin(this.time * 37 + j * 11)));
  }

  render(r) {
    const { col, k, m, mesh, tex, inst } = this, P = this.pal, d = this.d, t = this.time, eye = this.cam.eye, s = this.cam.s;
    const al = this.alarm.v, power = K.stage(k, 0.05, 0.8), boot = K.stage(k, 0.12, 0.55);
    const glitch = clamp(d.high * 1.4 + al * 0.25);

    // ---- atmosphere + space outside the windows
    scaleColor(col.fog, P.role('fog'), lerp(0.6, 0.9, power));
    addColor(col.fog, col.fog, P.role('flash'), al * 0.12);
    r.clear(col.fog);
    this.cam.apply(r);
    scaleColor(col.space, P.color(R(3, 0)), 0.75);
    scaleColor(col.zen, P.color(R(3, 0)), 0.3);
    this.sky.draw(r, eye, { horizon: col.space, zenith: col.zen, brightness: 1, starLevel: 1 + d.high * 0.5 });
    const ca = s / RR, ox = Math.cos(ca), oz = -Math.sin(ca), fx = -Math.sin(ca), fz = -Math.cos(ca);
    const PS = 170, py = eye[1] - 30 + Math.sin(t * 0.013) * 8;
    inst.planet.set(0, eye[0] + ox * 105 + fx * 175, py - PS / 2, eye[2] + oz * 105 + fz * 175, PS, 0, 1, 0, 1);
    inst.planet.upload(1);
    r.drawInstanced(mesh.quad, inst.planet, { texture: tex.planet, billboard: 2, unlit: true, fog: false, depthWrite: false, tint: col.one });

    const far = lerp(26, 50, k);
    r.setFog(col.fog, 2, far);
    scaleColor(col.light, P.role('light'), lerp(0.35, 0.85, power));
    mixColor(col.light, col.light, P.role('flash'), clamp(al * 0.6));
    scaleColor(col.amb, P.role('ambient'), lerp(0.3, 0.42, power));
    addColor(col.amb, col.amb, P.color(R(2, 1)), 0.32 * (1 - power) + al * 0.25);
    r.setLight([0.45, -0.75, 0.3], col.light, col.amb);

    // ---- recycle the corridor segments around the camera
    let n = 0, nd = 0, nb = 0, nh0 = 0, nh1 = 0;
    this.signs.length = 0;
    const L = this.lights;
    scaleColor(col.pLamp, P.color(R(3, 3)), 2.6 + al * 0.4); scaleColor(col.pRed, P.color(R(2, 2)), 2.4);
    L.begin();
    K.forSegments(s, { length: SEG, ahead: AHEAD, behind: SEG, period: RING }, (j, _z, ia) => {
      if (n >= MAXSEG) return;
      const th = (j * SEG) / RR, dist = ia * SEG - s, pw = this._power(j, k);
      inst.shell.set(n, 0, 0, 0, 1, th, lerp(0.8, 1.15, pw) * (1 + al * 0.12), 0, 1);
      inst.lamp.set(n, 0, 0, 0, 1, th, pw, 0, 1);
      const lp = ringPt(0, CY - 0.45, j * SEG + 4), lr = ringPt(0, 0.7, j * SEG + 4);
      L.add(j * 2, lp[0], lp[1], lp[2], col.pLamp, 6.5, pw);
      L.add(j * 2 + 1, lr[0], lr[1], lr[2], col.pRed, 4.5, (1 - pw) * 0.55 + al * (0.7 + 0.3 * Math.sin(t * 9 + j)));
      inst.strip.set(n, 0, 0, 0, 1, th, lerp(1, 0.35, pw) + al * 0.9, 0, 1);
      // holo panel (alternating screens), dim standby until its section powers up
      const hp = ringPt(-HW + 0.07, 1.7, j * SEG + 4), hl = lerp(0.18, 1, pw) * (1 + glitch * 0.3);
      if (j & 1) inst.holo1.set(nh1++, hp[0], hp[1], hp[2], 1, (j * SEG + 4) / RR, hl, 0, 1);
      else inst.holo0.set(nh0++, hp[0], hp[1], hp[2], 1, (j * SEG + 4) / RR, hl, 0, 1);
      n++;
      if (j & 1) return;
      // bulkhead + doors at every other segment boundary
      const c = ringPt(0, 0, j * SEG);
      inst.bulk.set(nb++, c[0], 0, c[2], 1, th, lerp(0.55, 1.1, pw), 0, 1);
      const prox = dist >= 0 ? K.fadeOut(dist, 3.5, 9) : K.fadeOut(-dist, 2.5, 6);
      const cyc = K.stage(k, 0.3, 0.8) * pw * clamp(0.55 + 0.7 * Math.sin(t * 0.8 - j * 0.9));
      const wv = this.wave.at(clamp(Math.max(0, dist) / 55));
      const open = Math.max(prox, clamp(cyc + wv * (0.6 - 1.4 * cyc)));
      for (const side of [-1, 1]) {
        const dp = ringPt(side * (DW / 2 + open * DW), 0, j * SEG);
        inst.door.set(nd++, dp[0], 0, dp[2], 1, th, lerp(0.6, 1.05, pw), 0, 1);
      }
      // alarm beacons on the frame corners: slow red pulse at idle, rotating flash on beats
      for (const side of [-1, 1]) {
        const bp = ringPt(side * 1.5, 2.95, j * SEG - 0.3);
        const idle = 0.22 * (1 - power * 0.6) * (0.5 + 0.5 * Math.sin(t * 1.3 + j));
        const flash = al * (0.6 + 0.4 * Math.sin(t * 9 + side * 1.6 + j));
        inst.beacon.set(nb * 2 - (side < 0 ? 2 : 1), bp[0], bp[1] - 0.25, bp[2], 0.5 + flash * 0.35, 0, idle + flash * 1.1, 0, 1);
      }
      if (dist > -2 && dist < far) this.signs.push([...ringPt(0, 2.74, j * SEG - 0.3), th]);
    });
    col.focus[0] = eye[0] + fx * 6; col.focus[1] = EYE; col.focus[2] = eye[2] + fz * 6;
    L.apply(r, col.focus, this.dt || 1 / 60);
    inst.shell.upload(n); inst.lamp.upload(n); inst.strip.upload(n);
    inst.holo0.upload(nh0); inst.holo1.upload(nh1);
    inst.bulk.upload(nb); inst.door.upload(nd); inst.beacon.upload(nb * 2);

    // ---- opaque
    r.drawInstanced(mesh.shell, inst.shell, { texture: tex.atlas });
    r.drawInstanced(mesh.bulk, inst.bulk, { texture: tex.atlas });
    r.drawInstanced(mesh.door, inst.door, { texture: tex.door });

    // ---- additive light: lamps, pools, emergency strips, holo screens, beacons, signs, dust
    scaleColor(col.lamp, P.color(R(3, 3)), 1 + al * 0.3);
    r.drawInstanced(mesh.lamp, inst.lamp, { texture: tex.lamp, unlit: true, additive: true, tint: col.lamp });
    scaleColor(col.tmp, col.one, 0.32);
    r.drawInstanced(mesh.pool, inst.lamp, { texture: tex.pool, unlit: true, additive: true, tint: col.tmp });
    const sb = 0.55 + 0.25 * Math.sin(t * 1.1);
    col.strip[0] = col.strip[1] = col.strip[2] = sb;
    r.drawInstanced(mesh.strip, inst.strip, { texture: tex.strip, unlit: true, additive: true, tint: col.strip, uvOffset: [-this.stripT, 0] });

    for (let v = 0; v < 2; v++) r.updateTexture(tex.holo[v], drawHolo(this.holoGen[v], v, t + v * 3.7, boot, glitch, al));
    col.holo[0] = col.holo[1] = col.holo[2] = 0.9;
    r.drawInstanced(mesh.holo, inst.holo0, { texture: tex.holo[0], unlit: true, additive: true, tint: col.holo });
    r.drawInstanced(mesh.holo, inst.holo1, { texture: tex.holo[1], unlit: true, additive: true, tint: col.holo });
    r.drawInstanced(mesh.quad, inst.beacon, { texture: tex.beacon, billboard: 2, unlit: true, additive: true, tint: col.one });

    const low = 1 - K.stage(k, 0.15, 0.45), nl = this.deckSign.n;
    this.lowSign.setAll(() => low * (0.45 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.2))));
    this.deckSign.setAll((i) => K.stage(k, 0.3 + (i / nl) * 0.3, 0.38 + (i / nl) * 0.3) * (0.85 + 0.15 * Math.sin(t * 19 + i * 3) * (1 + glitch * 2)) + d.pulse * 0.3);
    for (const [x, y, z, th] of this.signs) {
      mat4.trs(m, x, y, z, 0, th, 0);
      if (low > 0.01) this.lowSign.draw(r, m, { additive: true, tint: col.one });
      if (k > 0.3) this.deckSign.draw(r, m, { additive: true, tint: col.one });
    }
    this.dust.draw(r, { brightness: lerp(0.25, 0.5, power) + glitch * 0.35 + al * 0.3 });
  }

  dispose(r) {
    this.sky.dispose(r); this.dust.dispose(r); this.lowSign.dispose(r); this.deckSign.dispose(r);
    Object.values(this.mesh).forEach((x) => x.dispose());
    Object.values(this.inst).forEach((x) => x.dispose());
    const { holo, ...rest } = this.tex;
    [...holo, ...Object.values(rest)].forEach((x) => r.deleteTexture(x));
  }
}
