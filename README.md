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

**Kiosk launcher (Windows):** once the steps above work, double-click `kiosk.bat` instead. It starts the server and opens
Chrome (or Edge) fullscreen in its own profile, with audio running without a click, the input permission accepted
automatically (that profile only), no panel and no cursor. **H** shows the panel, **Alt+F4** quits. Open
`http://localhost:8080/?kiosk` in any browser for the same mode without the launcher.

**Offline / safety:** after the first visit a service worker caches the whole app (including the demo track), so a
reload still works if the server window is closed, or with no network at all. The screen is kept awake in fullscreen
and kiosk. If the GPU driver resets, the picture fades to fog and comes back by itself. If an environment crashes, it
is skipped. If the laptop can't keep up, detail is lowered quietly and heavy environments leave the rotation (press
**D** to see the `safety:` line). Live input is reopened automatically if the interface is unplugged and plugged back in.

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
- `http://localhost:8080/?bench` cycles every style idle → full intensity with synthetic music and prints fps / CPU time / draw calls per style to the console. Keep the tab visible while it runs.
- `test.html` is the bare PS1 pipeline on a test scene. Keys: J jitter, A affine, R resolution, D dither, C CRT. Key **0** in the main app shows the same scene.

## Keys

| Key | Action |
|-----|--------|
| F | fullscreen |
| H | hide / show UI (hidden by default in fullscreen) |
| D | debug overlay: fps, input dB + threshold, level/bass/mid/high, beat, state, intensity |
| 1 – 9 | crossfade to style 1–9 (see the Style dropdown) |
| N / Shift+N | crossfade to next / previous style (within the song's environments in setlist mode) |
| 0 | pipeline test scene |
| A | toggle auto style-switching while idle |
| C | toggle CRT scanlines + vignette |
| P / Shift+P | next / previous palette (crossfades) |
| O | back to each style's own palette |
| S | setlist mode on / off |
| PageDown / → / ] | next song (most USB page-turner footswitches send these) |
| PageUp / ← / [ | previous song |
| I | hold intensity at the *Hold at* level (toggle) |
| Z | freeze the picture (toggle) |
| B | blackout: fade to black and back (toggle) |
| G | big moment: one flash + beat + intensity push |
| T / Shift+T | tap tempo / clear tempo |
| L | lock beats to the tapped tempo (toggle) |
| R | reactivity: Gentle → Medium → Punchy |

## Palettes (album colours)

Every environment is drawn with **palette-indexed textures**, the way PS1 games used colour lookup tables. So any palette recolours any environment, and palette changes crossfade smoothly.

A palette is 16 colours: 4 **ramps** (Base, Secondary, Accent, Atmosphere/fog) × 4 shades, dark → light, plus **roles** (fog, ambient, light, glow, flash) that point at swatches.

- **Pick one:** click a tile in the **Palette** card (each tile is the palette's 4×4 colour table, one ramp per row), or **P** live. The striped *own* tile (or **O**) lets every environment use its default palette.
- **From album art:** under *Edit and import*, click *From album art…*, or just **drop the cover image anywhere on the window**. It's clustered into 4 ramps automatically, then opens in the editor.
- **Import:** *Import…* accepts pasted hex codes (Lospec `.hex`), GIMP `.gpl`, Lospec JSON or our own exported JSON. You can also drop those files on the window. With internet you can fetch a Lospec palette by name.
- **Edit:** open *Edit and import*, then click the swatch strip or *Edit*. Change a ramp's key colour to rebuild the whole ramp, or tweak single swatches; it previews live. Built-in palettes are saved as a copy.
- **Export** writes a `.json` you can commit, back up or share. Your palettes live in this browser's localStorage, so export them before switching laptops.

To add a built-in palette, add one line to `js/palette/library.js`:
`fromKeys('my-album', 'My Album', [base, secondary, accent, fog])`.

## Setlist mode

A setlist is a list of songs (or albums), each with a **palette** and one or more **environments**. Step through it with a key or a USB footswitch.

- **Make one:** Setlist card → *Songs and setlists* → *New*. Each row is a song: a label, a palette (or *keep current* / *each style's own*) and environments (none = keep the current one). *+ Song from current look* adds the palette and environment showing right now, so you can build a set by browsing with P and N and adding as you go.
- **Several environments per song:** the first one opens the song; **N** and idle auto-switch then rotate only through that song's list.
- **Step:** *Next ▶* / **PageDown** / **→** / **]**, and back with *◀ Prev* / **PageUp** / **←** / **[**. Click a song in the list to jump to it. **S** turns setlist mode on and off.
- **Wait for silence** (on by default): pressing Next while the band is still playing only *cues* the next song (shown in pink). It crossfades in as soon as the room goes quiet, so the change lands between songs. Press Next again to go right away (for segues); Prev cancels the cue.
- Setlists live in localStorage. *Export* writes a `.setlist.json`; *Import…* or dropping that file on the window loads it. Songs reference palettes by id, so export any of your own palettes too when moving to another laptop.

## Show control

The **Show** card at the top of the panel is for running the show by hand. Everything is also on keys and MIDI. Flash strength, blackout fade, strobe-safe and tempo nudges are under *Fine-tune*.

- **Feel** (R): how hard the environments follow the music. **Gentle** (default) follows the song's energy: slow swells, so a chorus visibly opens up from the verse, with only strong beats as soft accents (about one a second), no camera kicks and no frame wobble. **Punchy** reacts to every kick: fast flashes, camera kicks and vertex wobble, for electronic or bass-heavy sets. **Medium** sits between them. Changes ease over about a second, and a MIDI knob can set anything in between.
- **Hold** (I): intensity eases to the *Hold at* level (.2 – 1) and stays there, even when the room is quiet (a soft song you still want big, or a talk-over you want calm). Releasing it eases back to the live level.
- **Freeze** (Z): the picture holds still until you press it again.
- **Blackout** (B): a dithered fade to black over *Blackout fade*, and back on the second press. Never a hard cut.
- **Big moment** (G): one palette flash, a beat and a push to full intensity, decaying over about 1.5 s.
- **Tap tempo** (T): tap along four or more times. The dot blinks on the beat (pink on the downbeat). **Lock beats to tempo** (L) makes the environments' beats land on that grid instead of the detected beats (detected beats keep it in phase). −1 / +1 nudge it, *Clear* (Shift+T) forgets it.
- **Strobe-safe** (on by default): at most 3 beats per second reach the environments, at most one big moment per second, and the big-moment flash is capped. Leave it on unless you know the room.

Hold, freeze and blackout always start off when the page loads.

## MIDI

Works with any class-compliant USB MIDI controller or MIDI footswitch, in Chrome.

1. Plug it in, open **Settings** at the bottom of the panel, go to the **MIDI** section and click **Enable MIDI** (allow the permission once; it reopens on the next load).
2. Click **Learn** next to an action, then press the pad, footswitch or move the knob. Learning a control that's already mapped moves it.
3. Buttons fire on note-on, or when a CC goes above 64 (sustain-pedal style footswitches send CC 64). *Hold level* takes a knob, fader or expression pedal.
4. **Program change selects setlist song** (on by default): program 0 = song 1, program 1 = song 2, and so on. It goes there right away and turns setlist mode on.

Mappings are saved in this browser. The last message received is shown under the table, which helps when a pedal doesn't seem to do anything.

## Environment browser

In the **Worlds** card, every environment has a live thumbnail (its idle look, in the current palette). Click one to crossfade to it. Teal = showing, pink = fading in; with setlist mode on, the current song's environments have brighter names. Faded tiles aren't in the auto rotation. Thumbnails only refresh while the panel is visible, so they cost nothing in fullscreen.

## The panel

The panel keeps what you touch during a show in four cards: **Show**, **Setlist**, **Palette** and **Worlds**. The header shows the input status and level meter (the pink mark is the play threshold). Anything you only set up once is out of the way: each card's *Fine-tune* / *Edit* fold-out, and the **Settings** drawer at the bottom (audio source, MIDI, input gain, play/silence detection, PS1 look, keys). Inside the drawer, click a heading to fold that section; the panel remembers what's open.

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
js/gfx/textures.js      procedural 64×64 indexed textures
js/palette/             palette model, crossfading, library, editor/import UI
js/setlist/             setlists: store, player (cue / step), panel + editor UI
js/show/                show control (hold, freeze, blackout, flash, strobe limiter, tap tempo), MIDI, show/MIDI/environment-browser UI
js/kit/                 world kit for building environments (see docs/ENVIRONMENT-GUIDE.md)
js/styles/*.js          styles + StyleManager (crossfades, idle auto-switch)
```

### Add a style

Create `js/styles/mystyle.js` (full contract in `CLAUDE.md`):

```js
import { R, fromKeys } from '../palette/palette.js';
export class MyStyle {
  static meta = { name: 'My style' };
  static palette = fromKeys('mystyle', 'My style', ['#8a8a8a', '#4a6a8a', '#ffcc33', '#101820']);
  init(r) { /* r.createMesh(geo), r.texture(T.checker({ a: R(0, 3), b: R(0, 1) })) */ }
  update(audio, intensity, dt) { /* audio: level, bass, mid, high, energy, beat, beatPulse, accent, motion */ }
  render(r) { /* r.clear(this.pal.role('fog')); r.setCamera(...); r.setFog(...); r.draw(mesh, matrix, {texture, tint, emissive}) */ }
  dispose(r) { /* free meshes/textures */ }
}
```

Read colours only through `this.pal` (`color(R(ramp, shade))` or `role('fog')`), so album palettes work everywhere.

Then add it to `STYLES` in `js/styles/index.js`. It automatically gets the low resolution, jitter, affine textures, fog, dithering, crossfades and CRT.
Multiply every reaction by `intensity` so nothing pops when the band starts or stops.

## Performance

Everything renders at 320×240, which is about 50–130 draw calls and a few thousand triangles per frame, so mid-range laptops hold 60 fps easily.
If the laptop ever struggles, it's the fullscreen upscale, not the scene. Close other tabs and make sure Chrome uses the GPU (`chrome://gpu`).
