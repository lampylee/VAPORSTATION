# Vaporstation roadmap

v1 works: PS1 pipeline, audio analysis, play/silence state machine, three styles, crossfades.
This plan turns it into a show tool with **album palettes** and a **big library of environments**.

Guiding rules (unchanged from v1):
- Static web app, offline-first, 60 fps on a mid-range laptop.
- Everything goes through the shared PS1 pipeline; nothing ever hard-cuts.
- Every reaction scales with `intensity`.

---

## Phase 0 — Housekeeping (small, do first)

- [x] First commit, `.gitignore` (decide on `demo/demo.wav`: commit or regenerate).
- [x] `CLAUDE.md` with the project rules above + how to run/test, so every agent session starts aligned.
- [x] Perf harness: a `?bench` URL flag that cycles all environments and logs fps / draw calls / triangles to the console. Needed once there are 20+ environments.

## Phase 1 — Palette system (the album colours)

**Approach: PS1-style CLUTs.** The PS1 stored textures as 4-bit/8-bit *indices* into a colour lookup table.
We do the same:

- Procedural textures become **index textures** (each pixel = slot 0–15), not RGB.
- A **palette** is a 16-colour CLUT plus a few named *roles*: `fog`, `sky`, `primary`, `secondary`, `accent`, `flash`, `light`, `ambient`.
- The world shader looks up `clut[index]`. Fog, tints, lights and flashes read the roles.
- Swapping a palette is just uploading a new 16×1 texture. **Crossfading** two palettes is a lerp between two CLUTs in the shader, so palette changes get the same no-cut treatment as styles.

Each environment ships its own default palette but can be overridden by any palette, so one album palette recolours every world consistently.

**Features**
- [x] Built-in library in `js/palette/library.js` (15 palettes) + user palettes in localStorage.
- [x] Palette picker in the UI + hotkeys (`P` / `Shift+P` / `O`), drag-and-drop import.
- [x] **Palette editor**: 16 swatches + role mapping, live preview, save to localStorage, export/import JSON.
- [x] **Extract from album art**: drop an image, k-means it down to 16 colours (canvas, no library), auto-assign roles by luminance/saturation. This is the fastest way to get his album colours in.
- [x] **Lospec import**: paste a palette name or `.hex` file. Lospec offers single-palette downloads as JSON/CSV; there's no official search API, so offline we just ship a curated handful.
- [ ] **Setlist mode**: a list of `{ song/album label, palette, environment(s) }`. Advance with a key or footswitch between songs; changes crossfade while idle.

## Phase 2 — World kit (makes "huge variety" cheap)

Writing every environment from scratch won't scale. Build shared building blocks first; then each environment is mostly composition + art direction.

- [ ] **Sky**: low-poly dome / backdrop cards, gradient-by-dither, sun/moon discs, star fields.
- [ ] **Billboards / sprites**: camera-facing and crossed-quad trees, grass, lamp glows, the classic PS1 foliage trick.
- [ ] **Particles**: rain, snow, ash, embers, dust, fireflies, bubbles (instanced, additive or 1-bit alpha).
- [ ] **Terrain**: heightmap grids with vertex colours, infinite scrolling tiles.
- [ ] **Camera rigs**: spline dolly, orbit, fly-through, "security cam" sweep, slow push-in. All with beat nudges built in.
- [ ] **Modular props**: walls, fences, poles, crates, doorways from the geometry builders.
- [ ] **Model loading**: a tiny `.glb` loader (positions/normals/uvs/vertex colours only) so low-poly models from Blockbench/Blender drop straight in.
- [ ] **Instancing** in the renderer (one draw call for 500 trees) to keep big scenes at 60 fps.
- [ ] **"Swell" helper**: standard ways to map intensity onto a scene (idle → active variants, e.g. lights coming on, weather intensifying, world transforming).
- [ ] `docs/ENVIRONMENT-GUIDE.md`: the contract, kit API, palette roles, performance budget (≤150 draws, ≤20k tris), checklist. Agents build environments from this.

## Phase 3 — Environment library

Each environment is one file, one palette default and one registry line. That makes them ideal to build **in parallel**: one agent session per environment, each in its own git worktree, all following the environment guide.

**On game inspiration:** we'll capture the *mood and genre* of late-90s games (fog-bound horror towns, dinosaur jungles, anti-gravity racing), but with **original names, layouts, props and art**, not recreations of specific games' characters, logos, maps or assets. That gives the same feeling, keeps us out of trouble even non-commercially, and means the band owns its visuals.

Starting slate (working titles):

| # | Environment | Mood it evokes | Intensity "swell" idea |
|---|-------------|----------------|------------------------|
| 1 | **Ashfall Town** | foggy survival-horror town | idle: grey empty streets, falling ash → playing: the town rusts over, sirens pulse red on beats |
| 2 | **Lost Valley** | dino-jungle shooter | canopy, temple ruins, waterfall; distant silhouettes stomp on kicks |
| 3 | **Neon Circuit** | anti-gravity racer | flying a floating track; speed and chevron flashes on bass |
| 4 | **Night Manor** | gothic castle / vampire halls | candle-lit corridor; chandeliers sway; lightning on beats |
| 5 | **Cold Base** | snowy stealth-ops facility | searchlights sweep; snowstorm thickens with level |
| 6 | **Drowned Ruins** | underwater temple | caustics, bubbles; currents speed up with bass |
| 7 | **Station Deck** | sci-fi station corridor | doors open in sequence on beats; alarm lights |
| 8 | **Route 9** | night desert highway + motel | endless road, neon motel sign flickers on highs |
| 9 | **Dream Journal** | surreal dream-diary game | floating rooms, checker voids; reality warps with intensity |
| 10 | **Graveyard Hill** | spooky platformer | crooked tombstones, moon, wisps on highs |
| 11 | **Arcade After Hours** | 90s mall arcade | cabinets glow; floor tiles light on beats |
| 12 | **Aurora Field** | calm snowfield | between-songs favourite; aurora ripples with mids |

Plus v1's Fogway, Monoliths and Relic. More can be added any time from the same guide.

## Phase 4 — Show control & UI pass

- [ ] **UI pass** (keep the current look, refine it): environment browser with live thumbnails, palette strip, setlist view.
- [ ] **MIDI controller support** (Web MIDI, built into Chrome): map knobs/pads/footswitch to next environment, palette, intensity override, "blackout"/"freeze" panic buttons.
- [ ] **Tap tempo / BPM lock** so camera moves can phrase to the song. Optional Essentia.js beat tracker if our onset detector isn't enough.
- [ ] Manual overrides: hold intensity at a level, force "big moment" flash, strobe-safe limiter.

## Phase 5 — Gig hardening

- [ ] Service worker (PWA) so the app loads with no network at all, even without `serve.js`.
- [ ] Chrome kiosk launch script (`--kiosk --autoplay-policy=no-user-gesture-required`) so audio starts without a click.
- [ ] Auto-reconnect test with the Scarlett unplug/replug; low-battery / sleep prevention checklist.
- [ ] Profile on the actual gig laptop.

---

## Tools that will help

**Claude Code / agent tooling**
- `frontend-design` plugin (official, Anthropic): for the Phase 4 UI pass.
- [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) (Google, Apache-2.0): lets an agent record performance traces and diagnose frame drops. Install: `claude mcp add chrome-devtools --scope user -- npx chrome-devtools-mcp@latest`.
- Parallel sessions in git worktrees for Phase 3 environments; a review pass that screenshots each one idle vs. full intensity.

**Libraries (only if needed; we stay dependency-light)**
- [Essentia.js](https://mtg.github.io/essentia.js/): real beat tracking / BPM if our onset detector isn't enough.
- [Meyda](https://meyda.js.org/): spectral features (centroid, flatness) for "brightness"/"noisiness" reactions.
- Tweakpane: compact dev panel for tuning environment parameters live.

**Content creation (free)**
- **Blockbench**: easiest low-poly modeller, exports glTF.
- **Blender**: heavier modelling; bake vertex colours, export `.glb`.
- **Aseprite / LibreSprite / Pixelorama**: draw 64×64 indexed textures directly in a palette.
- [Lospec palette list](https://lospec.com/palette-list): thousands of curated limited palettes.
- itch.io PSX asset packs: many are free, some CC0 (e.g. [Retro PSX Shipyard Kit](https://jedrula.itch.io/retro-psx-style-shipyard-kit)). **Check each licence**; prefer CC0, and credit CC-BY packs in the README.

## Suggested order

0 → 1 → 2 in this session (they touch the core and depend on each other),
then fan out Phase 3 environments in parallel sessions,
with Phase 4 UI work running alongside once the palette and environment browsers exist.
