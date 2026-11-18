// Pipeline test scene: checker floor, a spinning brick cube, a big grid wall
// (to show affine texture swim) and pillars receding into fog. Press 0 in the
// app to view it. Also used by test.html (which passes its own palette).
import { mat4 } from '../gfx/math.js';
import { box, plane } from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import { R } from '../palette/palette.js';
import { STYLE_PALETTES } from '../palette/library.js';

export class TestScene {
  static meta = { name: 'Pipeline test' };
  static palette = STYLE_PALETTES.test;

  init(r) {
    this.tex = {
      floor: r.texture(T.checker({ a: R(3, 3), b: R(3, 1) })),
      brick: r.texture(T.bricks({ ramp: 0, mortar: R(3, 0) })),
      wall: r.texture(T.grid({ bg: R(3, 0), line: R(1, 3), glow: R(1, 1) })),
      pillar: r.texture(T.blotch({ ramp: 2 })),
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
    const t = this.t, m = this.m, P = this.pal;
    const fog = P.role('fog');
    r.clear(fog);
    const eye = [Math.sin(t * 0.3) * 9, 3 + Math.sin(t * 0.21), Math.cos(t * 0.3) * 9];
    r.setCamera(eye, [0, 1.2, 0], { fov: 60 });
    r.setFog(fog, 6, 40);
    r.setLight([0.4, -0.8, -0.3], P.role('light'), P.role('ambient'));

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
