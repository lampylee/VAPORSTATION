# PS1 Visualizer

A live, audio-reactive visualizer with an authentic PlayStation 1 look: 320×240,
wobbly vertex snapping, swimming affine textures, 15-bit dithered colour and heavy fog.
It's a static web app with **zero dependencies** (plain WebGL2), so it runs fully offline at a venue.

## Run it

You need [Node.js](https://nodejs.org) (any recent version). From this folder:

```
node serve.js
```

Then open **http://localhost:8080** in Chrome. On Windows you can also double-click `start.bat`.
`npm start` does the same. Any static server works too (`python -m http.server 8080`).
It must be `localhost` (not a `file://` path), or Chrome won't allow audio input.

## Gig setup (Scarlett 2i2)

1. Plug the aux send into input 1 (or 2) of the Scarlett. Set the input to **LINE**, not INST, and use the Scarlett's gain knob so the halo stays green/amber, never red.
2. Open the app, choose the Scarlett in **Device**, and click **Start live input**. Allow the microphone permission. Chrome remembers the permission, and the app remembers the device and reopens it on the next load.
3. Set **Channel** to the input the aux is plugged into (Input 1 / left). With L+R a single-input signal is 6 dB quieter, which auto-gain hides but the threshold doesn't.
4. Watch the meter under the player while the band soundchecks. The pink mark is the **threshold**. Silence (stage noise) should sit clearly left of it and music clearly right of it. Move the threshold or the **Input gain** until that's true.
5. Press **F** for fullscreen. The UI and cursor hide automatically. **H** brings the UI back.

The input is opened with echo cancellation, noise suppression and auto gain control all **off**.

## Test without a band

- **Play demo track** plays `demo/demo.wav`, a synthetic two-song "gig" with built-in test cases:
  - 0–8 s silence (idle)
  - 8–38 s song 1, with a 1.2 s full stop at 22 s and a quiet pad-only section at 27–31 s. Neither should flip the state.
  - 38–47 s silence (eases back to idle)
  - 47–72 s louder song 2
  - 72 s+ silence
- Press **D** to watch the state, intensity and beats. Regenerate the track with `node tools/make-demo-track.js`.
- **Load audio file…** plays any mp3/wav through exactly the same analysis path (and out of your speakers).
- `test.html` is the bare PS1 pipeline on a test scene. Keys: J jitter, A affine, R resolution, D dither, C CRT. Key **0** in the main app shows the same scene.

## Keys

| Key | Action |
|-----|--------|
| F | fullscreen |
| H | hide / show UI (hidden by default in fullscreen) |
| D | debug overlay: fps, input dB + threshold, level/bass/mid/high, beat, state, intensity |
| 1 / 2 / 3 | crossfade to Fogway / Monoliths / Relic |
| N | crossfade to next style |
| 0 | pipeline test scene |
| A | toggle auto style-switching while idle |
| C | toggle CRT scanlines + vignette |

All settings are saved in localStorage and restored on load. **Reset settings** restores the defaults.

## How it behaves

- **Playing vs silent** uses hysteresis. The level must stay above the threshold for *Start hold* (0.5 s) to count as playing, and below *threshold − hysteresis* for *Stop hold* (2.5 s) to count as silent.
- **Intensity** (0→1) swells in over *Swell in* (2 s) and eases out over *Ease out* (4 s). Every visual reaction is multiplied by it. At 0 each style is a slow, dim, drifting ambient scene, never black or frozen.
- **Auto-gain** slowly tracks each band's average while music is playing, so quiet and loud songs both drive the visuals. The average maps to about 0.5 and peaks to 1.
- **Beats** fire when kick-band (40–130 Hz) energy jumps above its rolling average × *Beat threshold*, with a cooldown.
- **Style changes** are a pixel-dissolve crossfade. Automatic changes happen only after the room has been idle for *Idle before switching*, so they never land mid-song.
- The music subtly pushes the look: beats briefly increase vertex jitter, and loudness pushes the fog back.

## Code layout

```
js/main.js              loop, keys, wiring
js/settings.js          defaults + localStorage
js/ui.js                settings panel + debug overlay
js/audio/engine.js      device list, live input / file, channel pick, gain
js/audio/analyser.js    RMS, bands, beat detection, auto-gain
js/audio/playstate.js   playing/silent hysteresis + intensity ramp
js/gfx/ps1.js           shared PS1 pipeline (all the look lives here)
js/gfx/geometry.js      low-poly mesh builders
js/gfx/textures.js      procedural 64×64 textures
js/styles/*.js          styles + StyleManager (crossfades, idle auto-switch)
```

### Tweak colours

Each style file starts with a `PALETTE` object of hex colours (`fogIdle`, `fogActive`, `flash`, …). Edit and reload.

### Add a style

Create `js/styles/mystyle.js`:

```js
export class MyStyle {
  static meta = { name: 'My style' };
  init(r) { /* r.createMesh(geo), r.createTexture(T.checker({...})) */ }
  update(audio, intensity, dt) { /* audio: level, bass, mid, high, beat, beatPulse */ }
  render(r) { /* r.clear(c); r.setCamera(eye, target, {fov}); r.setFog(c, near, far); r.draw(mesh, matrix, {texture, tint, emissive}) */ }
  dispose(r) { /* free meshes/textures */ }
}
```

Then add it to `STYLES` in `js/styles/index.js`. It automatically gets the low resolution, jitter, affine textures, fog, dithering, crossfades and CRT.
Multiply every reaction by `intensity` so nothing pops when the band starts or stops.

## Performance

Everything renders at 320×240, which is about 50–130 draw calls and a few thousand triangles per frame, so mid-range laptops hold 60 fps easily.
If the laptop ever struggles, it's the fullscreen upscale, not the scene. Close other tabs and make sure Chrome uses the GPU (`chrome://gpu`).
