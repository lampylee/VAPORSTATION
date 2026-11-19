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

### Audio fields

`update(audio, k, dt)` gets `level bass mid high` (0..1), `beat` (true on a beat frame), `beatPulse` (1 → 0 over ~0.25 s), `beatCount`, and from show control: `bpm` (0 when no tempo is tapped), `beatPhase` (0..1 through the current beat) and `bar` (0..3, beat within a 4-beat bar). Use `bpm`/`beatPhase`/`bar` to phrase slow moves (e.g. a camera turn every 4 bars), and always fall back gracefully when `bpm` is 0. Beats already respect the strobe-safe limiter, so react to `beat` freely; don't build your own fast strobes. Thumbnails for the environment browser call `update` with k = 0 and silent audio while the style is offscreen, so `update` must be safe to call before your style is ever shown.

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
| Swell | `swell(k, idle, active)`, `stage(k, from, to)`, `drive(audio, k)`, `Envelope`, `Spring`, `Pendulum`, `History`, `fadeOut(d, near, far)`, `fadeIn` | `History` makes pulses travel through space; `Pendulum` actually swings (pump it with bass in phase with `.v`); `fadeOut` scales scattered things down at the edge |
| Camera | `DollyRig(spline)`, `OrbitRig`, `SweepRig`, `PathRig(fn, {rollFn})`, `Spline(points)` | all have beat nudge, roll kick and FOV punch built in; `update(audio, k, dt)` then `apply(r)`. `rollFn: (s) => path.rollAt(s)` banks with a track |
| Sky | `new Sky(r, {stars, moon, banded, moonTexture, clouds})`, `draw(r, eye, {horizon, zenith, brightness, starLevel, moonScale, cloudDrift})` | draw first; pass the fog colour as `horizon`. `moonTexture: K.sprites.moon({ ramp: 3 })` if the default accent glow reads wrong |
| Terrain | `new Terrain(r, {size, cells, height, uvScale})`, `follow(x, z)`, `heightAt(x, z)`, `draw(r, opts)` | infinite, world-space UVs, Gouraud shading |
| Particles | `new Particles(r, 'rain' \| 'snow' \| 'ash' \| 'embers' \| 'dust' \| 'fireflies' \| 'bubbles', overrides)`, `update(dt, center, {amount, speed, wind})`, `draw(r, {brightness})` | one draw call each; `amount` 0..1 fades particles in/out |
| Sprites | `sprites.pine/broadleaf/deadTree/bush/grass/fern/kelp/cactus/flame/glow/lightShaft/moon/cloud/dot/streak/chainLink` | indexed with transparency; draw with `billboardQuad()` + `drawInstanced`. `lightShaft` = searchlight / sunbeam (additive) |
| Props | `props.prism/crate/wall/arch/lampPost/panel/fence/tombstone/stairs` + textures `planks/rust/tiles/sign`; `props.shift/rotX/rotY/rotZ/transform/cloneGeo` | pivot at base centre; `merge()` to combine. Transforms modify in place |
| Pixel | `makeIndexed(w, h, (x, y) => index)`, `dshade(ramp, shade0to3, x, y)`, `bayer(x, y)`, `rnd(x, y, seed)`, `blobNoise(x, y, cell, seed)`, `ditherPick(a, b, t, x, y)`, `CLEAR` | for your own indexed texture generators; don't re-implement them per file |
| Shapes | `xf({pos, rot, scale})` (merge part transform), `Frame` (`f.add(parts, geo, {pos, rot})`, `f.child()`), `orientedBox(g, c, ax, ay, az)`, `quadFacing`, `flatPoly`, `decal`, `chain`, `atlasUV(geo, rect)`, `pointedArch`, `pointedCurve`, `lancet`, `vault`, vectors `vadd/vsub/vcross/vnorm/…`, `rotPoint` | rotations everywhere are applied X, then Z, then Y (same as instance tilt) |
| Path | `new PathFrames(spline \| points, {step, bank, closed})` → `.point(s, out, x, y)`, `.frameAt(s)`, `.rollAt(s)`, `.yawAt(s)`, `.sweep(profile, {uvTile, from, to})`, `.placeEvery(spacing, fn)`; `roadStrip({...})`; `forSegments(s, {length, ahead}, fn)`; `scatter(x, z, {cell, radius}, fn)`; `repeat(x, period)` | evenly resampled frames with banking; `sweep` builds roads, walls, barriers, tubes from a cross-section; `forSegments` = endless corridors/streets with deterministic per-segment contents; `scatter` = camera-centred jittered grid |
| Text | `new NeonText(r, 'OPEN LATE', {height, align})` → `.set(i, b)` / `.setAll((i, n) => b)` / `.draw(r, matrix, opts)`; `textTexture(text, {scale, core, mid, outline, bg})`; `FONT` | original 5x7 font (A–Z, 0–9, punctuation); one draw call, per-letter brightness for letters switching on one by one |
| Models | `await loadGLB(url)` → `{geo, images}`; `imageToIndexed(image, {ramp})` | vertex colours kept; convert embedded textures to one ramp so palettes still apply |

### Renderer (`r`)

- `r.createMesh(geo, dynamic?)`, `mesh.update(geo)`; `r.texture(gen)` for generator output.
- `r.updateTexture(tex, gen, rows?)` re-uploads a texture in place (animated screens, holo panels, a surface that changes with the swell). Same size = cheap; `rows: [y0, y1)` uploads a band.
- `r.draw(mesh, matrix, { texture, tint, emissive, unlit, fog, additive, depthWrite, uvOffset, uvScale, sway, texture2, blend, fade })`
  - `texture2` + `blend` (0..1): **dither-crossfade** to a second texture of the same kind and size (clean → rusted, day → night, a room flipping to its alternate). The threshold is per texel, so it grows in blotchy patches stuck to the surface. Drive `blend` with `K.stage`.
  - `fade: [near, far]`: fade out with camera distance into the fog colour (to black when additive), **even with `fog: false`**. Use it for lights that shine through fog (`fog: false, additive: true, fade: [...]`) so they never pop at the scatter edge.
- `r.createInstances(max)` → `inst.set(i, x, y, z, scale, rotY, shade, swayPhase, heightScale, rotX, rotZ)`, `inst.tilt(i, rotX, rotZ)`, `inst.upload(count)`
  - `rotX`/`rotZ` **tilt** instances around their pivot (applied X, Z, then Y): toppled columns, swinging chandeliers (pivot at the hook + `K.Pendulum`), path-aligned props. On billboards `rotZ` spins the sprite in its plane (tumbling leaves, debris).
  - A **negative `heightScale`** flips the mesh vertically (cheap wing flaps for birds and bats).
- `r.drawInstanced(mesh, inst, { ...same options, billboard: 0 | 1 | 2, sway })`. `billboard: 1` stays upright (trees), `2` faces the camera fully (glows, particles). `sway` bends vertices by height (wind, bass).
- `mat4.trs(out, x, y, z, rx, ry, rz, sx, sy, sz)` for model matrices.

## Ideas for intensity "swells"

- Lights switching on in sequence (`stage`), windows lighting up, neon flickering into life.
- Weather building: drizzle → storm, light ash → heavy ash (`Particles.amount`).
- The world transforming: clean → rusted, frozen → thawed (`texture2` + `blend: K.stage(k, …)` dither-crossfade), or swap meshes beyond the fog.
- Signs and screens booting letter by letter (`K.NeonText.setAll` + `K.stage`), animated screens (`r.updateTexture`).
- Hanging things that swing harder as the bass builds (`K.Pendulum` + instance tilt).
- Camera waking up: slow pan → flying (`idleSpeed` → `activeSpeed`).
- Use `History` so a bass hit ripples away from the camera instead of everything pulsing at once.

## Checklist before committing an environment

- [ ] Looks good at idle (k = 0) and at full intensity; the swell between them is smooth.
- [ ] Works with at least 3 other palettes (P), including a dark and a light one.
- [ ] Debug overlay (D): within the draw/triangle budget; no console errors.
- [ ] `?bench` (visible tab) shows ~60 fps for it.
- [ ] `dispose()` frees everything created in `init()`.
- [ ] Original names and content only.
