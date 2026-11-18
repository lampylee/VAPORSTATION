// Pipeline test scene: checker floor, a spinning brick cube, a big grid wall
// (to show affine texture swim) and pillars receding into fog. Press 0 in the
// app to view it. Also used by test.html.
import { mat4 } from '../gfx/math.js';
import { paletteToRgb } from '../gfx/color.js';
import { box, plane } from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';

export const PALETTE = {
  fog: '#20283a',
  floorA: '#c8c8d0', floorB: '#3a3a52',
  brickA: '#a04a32', brickB: '#7a3626', mortar: '#1a0e0a',
  wallBg: '#0c1828', wallLine: '#38e8c8',
  pillar: '#d0b070',
};

export class TestScene {
  static meta = { name: 'Pipeline test' };

  init(r) {
    const p = PALETTE;
    this.c = paletteToRgb(p);
    this.tex = {
      floor: r.createTexture(T.checker({ a: p.floorA, b: p.floorB })),
      brick: r.createTexture(T.bricks({ a: p.brickA, b: p.brickB, mortar: p.mortar })),
      wall: r.createTexture(T.grid({ bg: p.wallBg, line: p.wallLine })),
      pillar: r.createTexture(T.blotch({ a: p.pillar, b: '#6a5030' })),
    };
    this.floor = r.createMesh(plane(80, 4, 20));
    this.cube = r.createMesh(box(2, 2, 2));
    this.wall = r.createMesh(box(16, 8, 0.4, { uvRepeat: [4, 2] }));
    this.pillar = r.createMesh(box(1, 6, 1, { uvRepeat: [1, 3] }));
    this.m = mat4.create();
    this.t = 0;
    this.pulse = 0;
  }

  update(audio, intensity, dt) {
    this.t += dt * (0.4 + intensity * 0.8);
    this.pulse = audio.bass * intensity;
  }

  render(r) {
    const t = this.t, m = this.m, c = this.c;
    r.clear(c.fog);
    const eye = [Math.sin(t * 0.3) * 9, 3 + Math.sin(t * 0.21), Math.cos(t * 0.3) * 9];
    r.setCamera(eye, [0, 1.2, 0], { fov: 60 });
    r.setFog(c.fog, 6, 40);
    r.setLight([0.4, -0.8, -0.3], [0.85, 0.85, 0.8], [0.3, 0.3, 0.38]);

    r.draw(this.floor, mat4.trs(m, 0, 0, 0), { texture: this.tex.floor });
    const s = 1 + this.pulse * 0.4;
    r.draw(this.cube, mat4.trs(m, 0, 1.6, 0, t * 0.7, t, 0, s), { texture: this.tex.brick });
    r.draw(this.wall, mat4.trs(m, 0, 4, -8), { texture: this.tex.wall });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      r.draw(this.pillar, mat4.trs(m, Math.cos(a) * 16, 3, Math.sin(a) * 16), { texture: this.tex.pillar });
    }
  }

  dispose(r) {
    Object.values(this.tex).forEach((t) => r.deleteTexture(t));
    [this.floor, this.cube, this.wall, this.pillar].forEach((x) => x.dispose());
  }
}
