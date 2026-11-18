# Vaporstation — agent notes

Live audio-reactive visualizer with an authentic PS1 look, used fullscreen at gigs.
Plan and status: `ROADMAP.md`. User-facing docs: `README.md`.

## Hard rules
- Static web app: plain ES modules + WebGL2, **no build step, no runtime dependencies**. Must work fully offline.
- 60 fps on a mid-range laptop. Budget per environment: ≤150 draw calls, ≤20k triangles at 320×240.
- **Nothing ever hard-cuts.** Every reaction is multiplied by `intensity` (0 = calm idle ambient, never black/frozen). Style and palette changes crossfade.
- Everything renders through the shared pipeline in `js/gfx/ps1.js`. Don't add per-style post effects; extend the pipeline instead.
- No modern effects: no bloom, soft shadows, smooth gradients (dither only), mipmaps or AA.
- Environments may evoke the *mood* of late-90s games, but use original names, layouts and art. Never recreate a specific game's characters, logos, maps or assets.

## Run / verify
- `node serve.js` → http://localhost:8080 (creates `demo/demo.wav` on first run).
- **Play demo track** button: synthetic gig with silence, a 1.2 s mid-song stop, a quiet passage, and a gap between songs. Press **D** for the debug overlay (state, intensity, beats, fps).
- `test.html`: bare pipeline test scene.
- `http://localhost:8080/?bench`: cycles every style idle → active with synthetic audio, logs fps / CPU ms / draws / tris via `console.table` and `window.benchResults`.
- The Claude browser pane blocks microphone access; test live input in real Chrome.

## Architecture
- `js/audio/` — engine (devices, file mode), analyser (bands, beat, auto-gain), playstate (hysteresis + intensity).
- `js/gfx/ps1.js` — low-res FBOs, vertex snap, affine UVs, per-vertex fog/light, CLUT palette lookup, dissolve + dither composite, nearest upscale, CRT.
- `js/gfx/textures.js` — procedural **indexed** textures (palette slot per pixel).
- `js/palette/` — palette model (4 ramps × 4 shades + roles), live crossfading palettes, library, user store, editor UI.
- `js/styles/` — one file per environment + `index.js` registry + `manager.js` (crossfades, idle auto-switch, palettes).

## Palettes (CLUT)
A palette is 16 colours = 4 ramps × 4 shades (dark → light). Index = `ramp * 4 + shade` (`R(ramp, shade)`).
- ramp 0 **base** (main surfaces), 1 **secondary**, 2 **accent** (glows, flashes), 3 **atmosphere** (fog/sky, dark → light).
- Roles point at indices: `fog`, `ambient`, `light`, `glow`, `flash`.
- Textures store indices, so any palette recolours any environment. Index 255 = transparent.
- Styles read colours with `this.pal.color(R(r, s))` / `this.pal.role('fog')`. Never hard-code RGB in a style.

## Style contract
```js
export class MyStyle {
  static meta = { name: 'My Style' };
  static palette = fromKeys('mystyle', 'My Style', [base, secondary, accent, atmosphere]);
  init(r) {}                          // meshes + indexed textures; this.pal is already set
  update(audio, intensity, dt) {}     // audio: level bass mid high (0..1), beat, beatPulse, beatCount
  render(r) {}                        // clear, camera, fog, light, draw
  dispose(r) {}
}
```
Register it in `js/styles/index.js`. Verify idle (intensity 0) and full intensity in the browser, plus `?bench`.
