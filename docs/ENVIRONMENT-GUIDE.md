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

`update(audio, k, dt)` gets `level bass mid high` (0..1), `energy` (0..1, slow: how big the song is right now, a few seconds against a ~minute reference, so a chorus reads higher than the verse), `beat` (true on a beat frame), `beatPulse` (1 → 0, eased), `beatCount`, and from show control: `bpm` (0 when no tempo is tapped), `beatPhase` (0..1 through the current beat) and `bar` (0..3, beat within a 4-beat bar). Use `bpm`/`beatPhase`/`bar` to phrase slow moves (e.g. a camera turn every 4 bars), and always fall back gracefully when `bpm` is 0. Beats already respect the strobe-safe limiter, so react to `beat` freely; don't build your own fast strobes.

**Reactivity (Feel: Gentle / Medium / Punchy).** Show control reshapes the audio before your style sees it: at Gentle the bands are slowed and pulled toward `energy`, only strong beats arrive (about one a second) and `beatPulse` eases in and fades slowly. `K.Envelope` and `K.Spring` read `K.feel`, so kit beat flashes ease in, glow longer and are smaller, and kit camera kicks/FOV punches nearly vanish, with no code in your style. If you hand-roll a beat reaction, scale it yourself: flashes by `audio.accent` (decay times by `audio.decay`), camera/object motion by `audio.motion` (`K.drive` passes all three through). Drive big continuous things (speed, FOV, fog, light) from `energy` or smoothed bands, not straight from `bass`: a zoom that follows the kick drum is the jerkiest thing a scene can do. Check your style at Gentle **and** Punchy. Thumbnails for the environment browser call `update` with k = 0 and silent audio while the style is offscreen, so `update` must be safe to call before your style is ever shown.

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
| Swell | `swell(k, idle, active)`, `stage(k, from, to)`, `drive(audio, k)`, `Envelope`, `Spring`, `feel`, `Pendulum`, `History`, `fadeOut(d, near, far)`, `fadeIn` | `History` makes pulses travel through space; `Pendulum` actually swings (pump it with bass in phase with `.v`); `fadeOut` scales scattered things down at the edge |
| Camera | `DollyRig(spline)`, `OrbitRig`, `SweepRig`, `PathRig(fn, {rollFn})`, `Spline(points)` | all have beat nudge, roll kick and FOV punch built in; `update(audio, k, dt)` then `apply(r)`. `rollFn: (s) => path.rollAt(s)` banks with a track |
| Sky | `new Sky(r, {stars, moon, banded, moonTexture, clouds})`, `draw(r, eye, {horizon, zenith, brightness, starLevel, moonScale, cloudDrift})` | draw first; pass the fog colour as `horizon`. `moonTexture: K.sprites.moon({ ramp: 3 })` if the default accent glow reads wrong |
| Terrain | `new Terrain(r, {size, cells, height, uvScale})`, `follow(x, z)`, `heightAt(x, z)`, `draw(r, opts)` | infinite, world-space UVs, Gouraud shading |
| Particles | `new Particles(r, 'rain' \| 'snow' \| 'ash' \| 'embers' \| 'dust' \| 'fireflies' \| 'bubbles' \| 'petals' \| 'leaves' \| 'pollen' \| 'mist' \| 'drizzle' \| 'skyLanterns' \| 'starTwinkle', overrides)`, `update(dt, center, {amount, speed, wind})`, `draw(r, {brightness, opacity})` | one draw call each; `amount` 0..1 fades particles in/out. Presets with `spin` tumble (petals, leaves); `mist` draws big upright cards with screen-door `opacity`. Choose `center` and `area` so no particle can drift past the lens: a big sprite right at the camera fills the screen |
| Sprites | `sprites.pine/broadleaf/deadTree/bush/grass/fern/kelp/cactus/flame/glow/lightShaft/moon/cloud/dot/streak/chainLink`; Kit v3: `willow/blossomTree/reeds/lantern/petal/leaf/mistBank/twinkle` | indexed with transparency; draw with `billboardQuad()` + `drawInstanced`. `lightShaft` = searchlight / sunbeam (additive) |
| Props | `props.prism/crate/wall/arch/lampPost/panel/fence/tombstone/stairs` + textures `planks/rust/tiles/sign`; `props.shift/rotX/rotY/rotZ/transform/cloneGeo` | pivot at base centre; `merge()` to combine. Transforms modify in place |
| Pixel | `makeIndexed(w, h, (x, y) => index)`, `dshade(ramp, shade0to3, x, y)`, `bayer(x, y)`, `rnd(x, y, seed)`, `blobNoise(x, y, cell, seed)`, `ditherPick(a, b, t, x, y)`, `CLEAR` | for your own indexed texture generators; don't re-implement them per file |
| Shapes | `xf({pos, rot, scale})` (merge part transform), `Frame` (`f.add(parts, geo, {pos, rot})`, `f.child()`), `orientedBox(g, c, ax, ay, az)`, `quadFacing`, `flatPoly`, `decal`, `chain`, `atlasUV(geo, rect)`, `pointedArch`, `pointedCurve`, `lancet`, `vault`, vectors `vadd/vsub/vcross/vnorm/…`, `rotPoint` | rotations everywhere are applied X, then Z, then Y (same as instance tilt) |
| Path | `new PathFrames(spline \| points, {step, bank, closed})` → `.point(s, out, x, y)`, `.frameAt(s)`, `.rollAt(s)`, `.yawAt(s)`, `.sweep(profile, {uvTile, from, to})`, `.placeEvery(spacing, fn)`; `roadStrip({...})`; `forSegments(s, {length, ahead}, fn)`; `scatter(x, z, {cell, radius}, fn)`; `repeat(x, period)` | evenly resampled frames with banking; `sweep` builds roads, walls, barriers, tubes from a cross-section; `forSegments` = endless corridors/streets with deterministic per-segment contents; `scatter` = camera-centred jittered grid |
| Text | `new NeonText(r, 'OPEN LATE', {height, align})` → `.set(i, b)` / `.setAll((i, n) => b)` / `.draw(r, matrix, opts)`; `textTexture(text, {scale, core, mid, outline, bg})`; `FONT` | original 5x7 font (A–Z, 0–9, punctuation); one draw call, per-letter brightness for letters switching on one by one |
| Textures (v3) | `K.tex.mossStone/cliffRock/jungleFloor/waterfall/caustics` (promoted), `K.tex.water/lilyPad/sand/paper/boards/cloudLayer` | tileable 64×64 surfaces (`lilyPad`, `paper` 32×32, `waterfall` 16×64): `r.texture(K.tex.water())` |
| Effects (v3) | `new Caustics(r)` → `update(dt, speed)`, `draw(r, mesh, {model, inst, brightness, uvScale})`; `new Streaks(r, {count, color})` → `update(dt, eye, target, {amount, speed})`, `draw`; `new Pulses({loop, width})` → `trigger(s, amp, vel)`, `update(dt)`, `at(s)`; `new Ripples(r)` → `spawn(x, y, z, size)`, `update(dt)`, `draw` | caustic light over any mesh; speed / wind lines; pulses travelling along strips and rings; rings on still water |
| Creatures (v3) | `new School(r, {kind: 'fish' \| 'bird', groups, perGroup, size, spread})` → `update(dt, (g, t, out) => centre, {amount, speed, flap})`, `draw(r, {tint})`; `fishGeo/birdGeo/creatureTex` | members grow in one by one with `amount`; birds glide when `flap: 0`. Keep their loop away from the camera |
| Slow phrasing (v3) | `new Breath({beats: 8, period: 10})` → `update(audio, dt)` returns 0..1..0 | follows the tapped tempo (`audio.bpm`), else a free `period`; never jumps. Camera rise, glow, mist density for ballads |
| Box atlas (v3) | `boxAtlas(w, h, d, {top, side, front, back, left, right, bottom})` | one texture, per-face atlas rects |
| Lights (v4) | `new Searchlights(r, {max, ramp})` → `set(i, lamp, aim, {width, brightness, glow, pool})`, `off(i)`, `upload(eye)`, `boostAt(x, z)`, `draw(r, {tint, fade})`; `coneGeo(base, sides)`, `poolSprite({ramp})` | cone + ground pool + lens glow, three draws for all lights; shines through fog, dims a cone that passes the lens. `boostAt` = how lit a ground point is (add it to house shades under a sweeping pool) |
| Phrasing (v4) | `new BarClock({beatsPerBar, minGap, backup: [min, max]})` → `update(audio, dt)` true once per bar; `new Stager(n, {from, to, rise, fall})` → `update(k, dt)`, read `.v[i]`; `new Follow3(start, {freq, damping})` → `update(target, dt)` | `BarClock` steps on `audio.bar` wrapping with tap tempo, else every 4th `beatCount`; `backup` fires on a slow timer when no beats come. `Stager` = rows rising front to back that keep their order even when `k` jumps. `Follow3` = springy glide to a moving point (formations, aim points) |
| Geometry (v4) | `centredQuad(w, h)`, `worldFace(g, c, u, v, tile)`, `worldBox(w, h, d, tile)`, `terrainDecal(cx, cz, rad, height, {segs, lift})`, `skyBand(e0, e1, {radius, segs, uRepeat})`, `props.gableHouse(w, d, wallH, roofH, {tile})` → `{walls, roof}` | `billboardQuad` pivots at the bottom; `centredQuad` spins in place and lies flat as a pool. `world*` = texel size stays the same on big and small faces. `skyBand` = additive ring around the eye with faded edges (draw at the eye, scroll with `uvOffset`) |
| Textures / motion (v4) | `K.tex.cracks({ramp, cells, jitter, crack, fill, rim, patches})`; `tileBlob(x, y, cell, seed, size)`; `new Wobble(r, geo)` → `update((x, y, z, out, i) => …)`, `rest()`, `.mesh`; `Particles` `texture` override + `gust(strength, dir, decay)`; `Ripples` `{additive: false}` + `spawn(…, amp)` | `cracks` = salt crust, dried mud, hex tiles (tileable). `tileBlob` = `blobNoise` without the seam. `Wobble` = CPU heat shimmer / melt on one mesh. Gusts whip a particle field and ease off (scale by `audio.accent`). Solid ripples fade by screen-door, for bright ground where additive rings vanish |
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
- `opacity` (0..1) on any draw: **screen-door transparency** with the ordered-dither pattern (mist cards, water over a reflection, ghosts). No alpha blending, so it stays PS1-authentic and needs no sorting.
- **Planar reflections** (calm lakes, wet floors): `r.setMirror(y)` draws everything reflected in the plane y (only what's above it), `r.setClipBelow(y)` discards everything below it, `r.clearDepth()`. Recipe, as in `js/styles/kit-calm.js`:
  ```js
  r.setMirror(W); drawWorld(darker); r.setMirror(null); r.clearDepth();
  r.setClipBelow(W); drawWorld(); r.setClipBelow(null);
  r.draw(waterMesh, m, { texture: waterTex, opacity: 0.55 });   // a subdivided plane, so the affine warp stays mild
  ```
  It doubles the world's draw calls, so budget for it.
- Kit v4 draw options:
  - `twoSided: true`: lights whichever face is towards the camera (flat paper cut-outs, leaves, banners). Without it a card seen from behind is lit as if from the back.
  - `wave: [amp, freq = 0.15, speed = 1]`: world-space vertical wave applied on the GPU. Every draw given the same values shares one field, so the ground and the houses on it roll together (a melting peak). `waveAt(x, z, wave, r.params.time)` (also `K.waveAt`) is the CPU height, for placing lights or the camera on it. Ease `amp` in with `K.stage`.
- `r.setJitterBoost(extra)`: extra vertex-snap wobble for the rest of this style's frame (0 = none, 1 ≈ double). `beginScene` resets it, so it never leaks into the next style or the crossfade partner, and the show-control beat wobble is left alone. Set it in `render()` before drawing, scaled by intensity.
- `mat4.trs(out, x, y, z, rx, ry, rz, sx, sy, sz)` for model matrices.

## Ideas for intensity "swells"

- Lights switching on in sequence (`stage`), windows lighting up, neon flickering into life.
- Weather building: drizzle → storm, light ash → heavy ash (`Particles.amount`).
- The world transforming: clean → rusted, frozen → thawed (`texture2` + `blend: K.stage(k, …)` dither-crossfade), or swap meshes beyond the fog.
- Signs and screens booting letter by letter (`K.NeonText.setAll` + `K.stage`), animated screens (`r.updateTexture`).
- Hanging things that swing harder as the bass builds (`K.Pendulum` + instance tilt).
- Camera waking up: slow pan → flying (`idleSpeed` → `activeSpeed`).
- Use `History` so a bass hit ripples away from the camera instead of everything pulsing at once.
- Rows or groups that wake in order (a crowd standing up, lamps up a hill): `K.Stager`, so the order holds when the song slams in.
- Rearrange or change formation once per bar (`K.BarClock`), not every beat.
- A peak that melts the world: `wave` on the ground and props, plus `r.setJitterBoost`, both eased in near the top of the range.
- Pitfalls from wave 4b: `damp(cur, target, tau, dt)` takes a time constant in seconds, not a rate. The `mist` particle preset reads as a dotted fence at ground level at 320×240; use it above the camera's eye line or rely on fog.

### Slow songs and ballads

`js/styles/kit-calm.js` (hidden style 17, "Kit calm") is the reference: copy it for calm scenes.
- Move less, glow more: keep the camera's `idleSpeed`/`activeSpeed` tiny and `fovPunch`/`nudge`/`rollKick` near zero; let intensity raise **light**, not speed.
- Phrase with `K.Breath` (it follows a tapped tempo) instead of reacting to every beat. On a beat, prefer one soft event (a ripple, a pulse around a ring, one lantern brightening) over a flash.
- Things that drift: `petals`, `leaves`, `pollen`, `mist`, `skyLanterns`, gliding birds (`School` with `flap: 0`).
- Reflections and screen-door mist read beautifully at 320×240; keep reflected glows dimmer than the real ones.

## Checklist before committing an environment

- [ ] Looks good at idle (k = 0) and at full intensity; the swell between them is smooth.
- [ ] Works with at least 3 other palettes (P), including a dark and a light one.
- [ ] Debug overlay (D): within the draw/triangle budget; no console errors.
- [ ] `?bench` (visible tab) shows ~60 fps for it.
- [ ] `dispose()` frees everything created in `init()`.
- [ ] Original names and content only.
