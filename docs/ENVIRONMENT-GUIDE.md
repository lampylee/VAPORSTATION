# Environment guide

How to build a new Vaporstation environment. Start by copying
`js/styles/kit-demo.js`: it uses every piece of the world kit and is the
reference implementation.

## The contract

```js
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

export class AshfallTown {
  static meta = { name: 'Ashfall Town' };          // hidden: true keeps it out of the rotation
  static palette = fromKeys('ashfall-town', 'Ashfall Town', [base, secondary, accent, fog]);
  init(r) {}                       // build meshes, textures, instances. this.pal is already set.
  update(audio, intensity, dt) {}  // advance state only, no drawing
  render(r) {}                     // clear, camera, sky, fog, light, draws
  dispose(r) {}                    // free every mesh, texture, instance buffer
}
```

Register it in `js/styles/index.js` (append to `STYLES`; the index is its number key).

## Golden rules

1. **Multiply every reaction by `intensity` (k).** At k = 0 the scene is a calm, slowly drifting ambient version, never black or frozen. Use `K.drive(audio, k)` to get pre-multiplied values.
2. **Nothing pops.** No hard on/off. Use `K.stage(k, from, to)` for things that switch on, and `K.Envelope` / `K.Spring` for beat reactions. Don't spawn or remove visible objects abruptly; fade them, or keep them beyond the fog.
3. **Colours come only from the palette.** Textures are indexed (`R(ramp, shade)`); runtime colours come from `this.pal.color(R(r, s))` and `this.pal.role('fog' | 'ambient' | 'light' | 'glow' | 'flash')`. Never hard-code RGB. Check your scene with 3–4 other palettes (P key).
4. **Original work.** Evoke a mood or genre, but don't recreate a specific game's characters, logos, maps, music or assets.
5. **Budget** at 320×240: ≤ 150 draw calls and ≤ 20k triangles per frame (see the debug overlay, D). Use instancing for anything repeated more than ~5 times.

## Palette ramps

| ramp | name | typical use |
|------|------|-------------|
| 0 | Base | main surfaces: ground, walls, stone |
| 1 | Secondary | second material: foliage, metal, water |
| 2 | Accent | lights, glows, flashes, signs |
| 3 | Atmosphere | fog (shade 1 = default fog role), sky, distant things |

Shades go 0 (dark) → 3 (light). Index `255` (`CLEAR`) is transparent.

## Typical `render(r)` order

```js
const dim = lerp(0.65, 1, k);                       // idle is a little darker
scaleColor(this.fog, P.role('fog'), dim);
r.clear(this.fog);
this.cam.apply(r);                                   // camera rig
this.sky.draw(r, this.cam.eye, { horizon: this.fog, zenith: P.color(R(3, 0)), brightness: dim });
r.setFog(this.fog, near, lerp(farIdle, farActive, k));
r.setLight(dir, P.role('light') scaled, P.role('ambient') scaled);
// opaque geometry, then instanced foliage, then additive glows and particles last
```

## Kit reference (`js/kit/`)

| Piece | API | Notes |
|---|---|---|
| Noise | `fbm(x, z, {octaves, seed})`, `ridged()`, `noise2()`, `rand2(ix, iz, seed)` | deterministic; `rand2` for placement |
| Swell | `swell(k, idle, active)`, `stage(k, from, to)`, `drive(audio, k)`, `Envelope`, `Spring`, `History` | `History` makes pulses travel through space |
| Camera | `DollyRig(spline)`, `OrbitRig`, `SweepRig`, `PathRig(fn)`, `Spline(points)` | all have beat nudge, roll kick and FOV punch built in; `update(audio, k, dt)` then `apply(r)` |
| Sky | `new Sky(r, {stars, moon, banded, clouds})`, `draw(r, eye, {horizon, zenith, brightness, starLevel, moonScale, cloudDrift})` | draw first; pass the fog colour as `horizon` |
| Terrain | `new Terrain(r, {size, cells, height, uvScale})`, `follow(x, z)`, `heightAt(x, z)`, `draw(r, opts)` | infinite, world-space UVs, Gouraud shading |
| Particles | `new Particles(r, 'rain' \| 'snow' \| 'ash' \| 'embers' \| 'dust' \| 'fireflies' \| 'bubbles', overrides)`, `update(dt, center, {amount, speed, wind})`, `draw(r, {brightness})` | one draw call each; `amount` 0..1 fades particles in/out |
| Sprites | `sprites.pine/broadleaf/deadTree/bush/grass/flame/glow/cloud/dot/streak/chainLink` | indexed with transparency; draw with `billboardQuad()` + `drawInstanced` |
| Props | `props.prism/crate/wall/arch/lampPost/panel/fence/tombstone/stairs` + textures `planks/rust/tiles/sign` | pivot at base centre; `merge()` to combine |
| Models | `await loadGLB(url)` → `{geo, images}`; `imageToIndexed(image, {ramp})` | vertex colours kept; convert embedded textures to one ramp so palettes still apply |

### Renderer (`r`)

- `r.createMesh(geo, dynamic?)`, `mesh.update(geo)`; `r.texture(gen)` for generator output.
- `r.draw(mesh, matrix, { texture, tint, emissive, unlit, fog, additive, depthWrite, uvOffset, uvScale, sway })`
- `r.createInstances(max)` → `inst.set(i, x, y, z, scale, rotY, shade, swayPhase, heightScale)`, `inst.upload(count)`
- `r.drawInstanced(mesh, inst, { ...same options, billboard: 0 | 1 | 2, sway })`. `billboard: 1` stays upright (trees), `2` faces the camera fully (glows, particles). `sway` bends vertices by height (wind, bass).
- `mat4.trs(out, x, y, z, rx, ry, rz, sx, sy, sz)` for model matrices.

## Ideas for intensity "swells"

- Lights switching on in sequence (`stage`), windows lighting up, neon flickering into life.
- Weather building: drizzle → storm, light ash → heavy ash (`Particles.amount`).
- The world transforming: clean → rusted (crossfade two textures by drawing the second with `stage`-driven additive glow, or swap meshes beyond the fog).
- Camera waking up: slow pan → flying (`idleSpeed` → `activeSpeed`).
- Use `History` so a bass hit ripples away from the camera instead of everything pulsing at once.

## Checklist before committing an environment

- [ ] Looks good at idle (k = 0) and at full intensity; the swell between them is smooth.
- [ ] Works with at least 3 other palettes (P), including a dark and a light one.
- [ ] Debug overlay (D): within the draw/triangle budget; no console errors.
- [ ] `?bench` (visible tab) shows ~60 fps for it.
- [ ] `dispose()` frees everything created in `init()`.
- [ ] Original names and content only.
