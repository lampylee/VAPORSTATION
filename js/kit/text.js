// Pixel font + neon signs. Original 5x7 glyphs (A-Z, 0-9, a little punctuation).
//
//   this.sign = new K.NeonText(r, 'OPEN LATE', { height: 1.2 });
//   update: this.sign.setAll((i, n) => K.stage(k, 0.1 + i * 0.04, 0.2 + i * 0.04) * flicker);
//   render: this.sign.draw(r, mat4.trs(m, x, y, z, 0, yaw, 0), { unlit: true, additive: true, tint: glow });
//
// One mesh, one draw call; each letter's brightness lives in its vertex colours,
// so letters can switch on one by one (re-uploaded only when they change).
import { R } from '../palette/palette.js';
import { CLEAR } from '../gfx/textures.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { makeIndexed } from './pixel.js';

export const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
  '*': ['00000', '10101', '01110', '11111', '01110', '10101', '00000'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
  '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
};

/** Cell size in texels for a given glyph scale: 5x7 glyph + 1 px gap / padding. */
export const glyphCell = (scale = 3) => [6 * scale, 9 * scale];

/**
 * Text texture, one cell per character. Neon by default: bright core (highlight
 * dots on each glyph pixel), dark outline halo, CLEAR elsewhere. Pass
 * { core: ink, mid: ink, outline: null } for plain painted lettering, bg for a sign plate.
 */
export function textTexture(text, { scale = 3, core = R(2, 3), mid = R(2, 2), outline = R(2, 0), bg = CLEAR } = {}) {
  text = String(text).toUpperCase();
  const n = text.length, [CW, CH] = glyphCell(scale);
  const on = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= n * CW || ty >= CH) return false;
    const g = FONT[text[Math.floor(tx / CW)]];
    if (!g) return false;
    const gx = Math.floor((tx % CW) / scale), gy = Math.floor(ty / scale) - 1;
    return gx < 5 && gy >= 0 && gy < 7 && g[gy][gx] === '1';
  };
  return makeIndexed(n * CW, CH, (x, y) => {
    if (on(x, y)) return (scale > 1 && x % scale === (scale >> 1) && y % scale === (scale >> 1)) ? core : mid;
    if (outline != null) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (on(x + i, y + j)) return outline;
    return bg;
  });
}

/** A line of text as one mesh (XY plane, facing +Z, pivot at the bottom; align left/center/right). */
export class NeonText {
  constructor(r, text, { height = 1, align = 'center', spacing = 1, ...texOpts } = {}) {
    this.text = String(text).toUpperCase();
    const n = this.n = this.text.length, [CW, CH] = glyphCell(texOpts.scale || 3);
    this.tex = r.texture(textTexture(this.text, texOpts));
    const lw = height * (CW / CH) * spacing, x0 = align === 'left' ? 0 : align === 'right' ? -n * lw : -n * lw / 2;
    this.width = n * lw; this.height = height; this.letterWidth = lw;
    const g = new GeoBuilder(), z = [0, 0, 1];
    for (let i = 0; i < n; i++) {
      const a = x0 + i * lw, b = a + lw * (1 / spacing), u0 = i / n, u1 = (i + 1) / n;
      g.quad([a, 0, 0], [b, 0, 0], [b, height, 0], [a, height, 0], [u0, 1], [u1, 1], [u1, 0], [u0, 0], z);
    }
    this.geo = g.build();
    this.mesh = r.createMesh(this.geo, true);
    this.levels = new Float32Array(n).fill(1);
    this.dirty = false;
  }
  /** Letter i brightness (0 = off, 1 = full; > 1 overdrives). */
  set(i, b) { if (this.levels[i] !== b) { this.levels[i] = b; this.dirty = true; } }
  /** fn(i, n) -> brightness for every letter. */
  setAll(fn) { for (let i = 0; i < this.n; i++) this.set(i, fn(i, this.n)); }
  draw(r, model, opts = {}) {
    if (this.dirty) {
      const c = this.geo.colors;
      for (let i = 0; i < this.n; i++) { const b = this.levels[i]; c.fill(b, i * 18, i * 18 + 18); }
      this.mesh.update({ colors: c });
      this.dirty = false;
    }
    r.draw(this.mesh, model, { unlit: true, ...opts, texture: this.tex });
  }
  dispose(r) { this.mesh.dispose(); r.deleteTexture(this.tex); }
}
