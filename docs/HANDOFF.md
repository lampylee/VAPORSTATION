# Handoff — state as of 2026-11-22

Read this first when picking the project back up. Also read `CLAUDE.md` (rules),
`ROADMAP.md` (plan) and `docs/ENVIRONMENT-GUIDE.md` (how environments are built).

## Where things stand

All work is committed on `main` (local only: **no git remote yet**, nothing pushed).

| Phase | Status |
|---|---|
| v1: PS1 pipeline, audio analysis, play/silence state machine, 3 styles | done |
| 0: housekeeping (`.gitignore`, `CLAUDE.md`, `?bench`) | done |
| 1: CLUT palettes, editor, album-art extraction, import/export, P/O keys, setlist mode | done |
| 2: world kit (`js/kit/`), Kit Demo, environment guide | done |
| 3: environment library | **done: 33 merged** (waves 1–3, wave 4a/4b Radiohead set, wave 5 horror) |
| 4: UI pass, MIDI, tap tempo, overrides | done (2026-11-19), real MIDI hardware untested |
| 5: gig hardening (PWA, kiosk, reconnect tests) | not started |

### Styles on main (`js/styles/index.js`)

| Index / key | Style | In auto rotation | Draws / tris (idle → active) |
|---|---|---|---|
| 0 | Pipeline test | hidden | 15 / 200 |
| 1 | Fogway | yes | 52→86 / 0.8–1k |
| 2 | Monoliths | yes | 45→77 / 5k |
| 3 | Relic | yes | 45 / 2.3k |
| 4 | Kit demo (shows Kit v2 too) | hidden | 13–14 / 10.5k |
| 5 | Ashfall Town | yes | 9–10 / 3–4.8k |
| 6 | Lost Valley | yes | 54–56 / 10.5–11k |
| 7 | Neon Circuit | yes | 18–19 / 17.5k |
| 8 | Night Manor | yes | 21–25 / 14–15.5k |
| 9 | Drowned Ruins | yes | 13–16 / 10–12.5k |
| 10 | Route 9 | yes | 16–17 / 7–8.5k (up to 55 draws at some road points) |
| 11 | Cold Base | yes | 23–24 / 12–14k |
| 12 | Station Deck | yes | 15–17 / 6.6–6.8k |
| 13 | Dream Journal | yes | 20–21 / 5.5–5.9k |
| 14 | Graveyard Hill | yes | 14–18 / 16.2–16.8k |
| 15 | Arcade After Hours | yes | 32 / 14–15k |
| 16 | Aurora Field | yes | 12–17 / 8.9–11.3k |
| 17 | Kit calm (pond): Kit v3 reference for slow songs | hidden | 25–29 / 11.8–12.4k (the reflection doubles the world) |
| 18 | Lantern River | yes | 35–36 / 15.9–16.2k |
| 19 | Rain Window | yes | 42–45 / 7.2–8.1k |
| 20 | Cloud Sea | yes | 8 / 7.9–9.1k |
| 21 | Petal Steps | yes | 14–15 / 8.6–9.1k |
| 22 | Moonlit Shallows | yes | 23–25 / 15–15.1k |
| 23 | Greenhouse at Dusk | yes | 28–30 / 5.9–6.3k |

Number keys only reach 0–9; indices 10–23 are reachable via **N / Shift+N**, the dropdown, auto-switch, a setlist song, or the environment browser (thumbnails under Styles).

### Verified vs. not verified

- **Verified (in the Claude browser pane):** every style at idle and at full intensity with synthetic audio, no GL/console errors, within budget, crossfades, palette swaps, album-art extraction, hex/GPL import, editor save, GLB loader on a hand-built model, demo-track state machine timeline.
- **Not verified yet:**
  1. **`?bench` real fps.** The Claude pane is hidden during agent work, which pauses `requestAnimationFrame`. Run `http://localhost:8080/?bench` in a **visible normal Chrome tab** and leave it ~1 min; results print via `console.table` and `window.benchResults`.
  2. **Live input with the Scarlett 2i2.** The Claude pane blocks the microphone. Test in real Chrome: pick device → Start live input → check the threshold meter during soundcheck.
  3. **The gig laptop itself** (perf, fullscreen, sleep settings).
  4. **Real MIDI hardware** (learn + footswitch + Program Change). Tested only with simulated MIDI bytes via `viz.midi.handle([...])`.
  5. **Thumbnail cost on the gig laptop**: one extra style update+render every 0.4 s while the panel is visible (none in fullscreen / hidden UI).

## Reactivity pass (2026-11-20)

Feedback: with real music the visuals felt bumpy, strobey and aggressive (club-style), not complementary. Causes: ~30 ms band attacks, 0.18 s beat pulses, up to 3–5 beats/s, and every kick firing a camera nudge + roll + FOV punch + colour flash + whole-frame vertex wobble (`jitterBoost`), with styles mapping `bass` straight to FOV/speed.
Fix, centrally: **Feel** setting (`s.reactivity`, 0 Gentle default / 0.5 Medium / 1 Punchy = the old behaviour; Show card, R key, MIDI knob). `ShowControl` blends three profiles (`PROFILES` in `js/show/control.js`): extra band smoothing pulled toward the new `audio.energy` (analyser: a few seconds of level against a ~minute reference), a beat-strength gate + min gap (Gentle ≈ 1 beat/s), eased beat pulse, and `K.feel` (`js/kit/swell.js`) which scales every `K.Envelope` (smaller, eased in, longer) and `K.Spring` kick; kit camera FOV punch scales by motion; the beat vertex wobble is 0 at Gentle. Hand-rolled beat reactions in Fogway, Monoliths, Relic, Lost Valley (tremor) and Neon Circuit (FOV) now use `audio.accent/motion/decay`.
Measured on the demo track (same passage): Punchy 2 beats/s, bass movement 2.12/s; Gentle 1 beat/s, 0.24/s. All 23 styles ran at Gentle and Punchy without errors. **Not verified:** how it *feels* with real songs in a visible window (the pane was hidden, so no live look), `?bench` (CPU cost is a few multiplies per frame). Tuning knobs are the `PROFILES` rows.

## Open items (rough priority)

1. Run `?bench` + Scarlett live test in real Chrome (5 minutes, unblocks confidence).
2. ~~Kit v2 pass~~ — done, see below.
3. ~~Wave 2 environments~~ — done: built in six parallel sessions, merged 2026-11-19 (smoke-tested at k=0/1 + crossfades; real-fps `?bench` still pending, see item 1). Their reports list suggested kit additions (Kit v3).
4. ~~Setlist mode~~ — done 2026-11-19 (`js/setlist/`): songs pick a palette + an environment pool; PageDown/→/] next, PageUp/←/[ prev, S toggles; while playing, Next cues the song until silence (press again to force). Verified in the pane: stepping/cue logic, editor, import, persistence. **Not verified:** a real USB footswitch (check which key it sends; add it in `main.js` if it isn't one of those). Also fixed a manager bug where a style queued mid-crossfade was rendered once before its first `update()` (crashed Cold Base / Arcade for one frame).
5. ~~Housekeeping~~ — done 2026-11-19: all twelve `claude/env-*` branches and worktrees deleted, the twelve environment sessions archived.
6. Add a GitHub remote and push, so work is backed up off this machine.
7. ~~Phase 4~~ — done 2026-11-19 (`js/show/`): show-control pads (Hold I, Freeze Z, Blackout B, Big moment G), strobe-safe limiter (≤3 beats/s), tap tempo T + BPM lock L (styles get `audio.bpm/beatPhase/bar`; no style uses them yet), Web MIDI with learn + Program Change → song, environment browser with live thumbnails, palette strip, collapsible sections. Pipeline gained composite `flash`/`fade` params and `r.snapshot(ctx)`. Then a UI restyle ("Soft Vapor", picked from 10 directions on a design canvas): muted plum tokens in `css/style.css`, icon cards from `js/icons.js` (`card()`, `fold()`), live essentials in four cards (Show, Setlist, Palette, Worlds), everything else in fold-outs and a Settings drawer; hold level is five steps (.2–1) instead of a slider; palette tiles are 4×4 CLUT grids. Sections are found by `h2[data-title]`, not text. Next: Phase 5 (PWA, kiosk script, reconnect tests); optionally teach a few styles to phrase camera moves on `bar`.

## Kit v2 — done (2026-11-19)

All starred items below are in the kit, documented in `docs/ENVIRONMENT-GUIDE.md` and exercised by `js/styles/kit-demo.js`:
`r.updateTexture`, `texture2`/`blend` dither-crossfade, instance tilt (`rotX`/`rotZ`, billboard spin), draw `fade` (lights through fog), `K.xf`/`K.Frame`/`props.rotX/Y/Z`, `K.PathFrames` (+ `sweep`, `placeEvery`, `PathRig` `rollFn`), `K.roadStrip`, `K.forSegments`, `K.scatter`, `K.orientedBox`, `Sky` `moonTexture` + `sprites.moon`, `K.NeonText`/`K.textTexture` (full 5x7 font).
Also promoted: `K.Pendulum` (soft limit), `K.fadeOut/fadeIn`, pixel helpers (`makeIndexed`, `dshade`, `bayer`, `rnd`, `blobNoise`, `ditherPick`), `pointedArch`/`pointedCurve`/`lancet`/`vault`, `chain`, `flatPoly`, `decal`, `quadFacing`, `atlasUV`, sprites `fern`/`kelp`/`cactus`/`lightShaft`; negative `heightScale` flip is documented.
Ashfall Town now uses `r.updateTexture`; the other wave-1 styles keep their local copies (working code, not worth the churn).
**Kit v3 (2026-11-19)** promoted the rest into `js/kit/`: `K.tex` (moss stone, cliff rock, jungle floor, waterfall, caustic frames, plus new water, lily pad, sand, paper, boards, cloud layer), `fx.js` (`Caustics`, `Streaks`, `Pulses`, `Ripples`), `life.js` (`School`: fish and birds), `boxAtlas`, `Breath`. It also adds slow-song sprites (willow, blossom tree, reeds, lantern, petal, leaf, mist bank, twinkle) and particle presets (petals, leaves, pollen, mist, drizzle, skyLanterns, starTwinkle; per-particle spin). Pipeline: draw `opacity` (screen-door transparency) and planar reflections (`setMirror`, `setClipBelow`, `clearDepth`). Reference scene: `js/styles/kit-calm.js` (hidden, index 17). The wave-1/2 environments keep their local copies (working code, not migrated).

**Kit v4 (2026-11-20, from the wave 4b reports, landed before merging wave 4b)**, all in `docs/ENVIRONMENT-GUIDE.md` and exercised by `js/styles/kit-demo.js` (gabled house, two searchlights turning round once per bar, a sky band, snow gusts):
- Pipeline (default off, existing styles unchanged): draw options `twoSided` (light the face towards the camera) and `wave: [amp, freq, speed]` (shared GPU world-space wave; `K.waveAt` is the CPU copy), and `r.setJitterBoost(extra)` (per-style snap wobble, reset by `beginScene`).
- `js/kit/lights.js`: `K.Searchlights` (cone + pool + lens glow, dims near the lens, `boostAt`), `coneGeo`, `poolSprite`.
- `swell.js`: `K.BarClock` (bar steps with the beatCount fallback and a backup timer), `K.Stager` (ordered rows that keep their order on jumps), `K.Follow3` (springy 3D follower).
- Geometry: `K.centredQuad`, `worldFace`, `worldBox`, `terrainDecal`, `skyBand`, `K.props.gableHouse`. Textures: `K.tex.cracks`, `K.tileBlob` (seamless `blobNoise`).
- `K.Wobble` (CPU vertex wobble), `Particles` `texture` override + `gust()`, `Ripples` `{additive: false}` solid mode + per-ring `amp`. Fix: `School` wings no longer jump when `flap` changes (phase integrates; Kit calm now eases its flap).
- Not promoted (scene-specific): Right Place's slot shuffler, Paper Crowd's glide-past rig and silhouette buckets, Salt Flat's horizon strip, Newsprint's bending stacks and full `PageStorm` (gust + texture cover most of it). The wave 4b environments keep their local copies (working code), as earlier waves did.

**Kit v5 (2026-11-22, from the wave 5 reports plus older unpromoted suggestions)**, all in `docs/ENVIRONMENT-GUIDE.md` and shown in `js/styles/kit-demo.js` (a well yard beside the house: ground rings blighting outward, a beam rising from the well, beat rings that flare the house windows, figures walking out and home, stretched crates, a sagging net, rocks, soft mist):
- Pipeline (opt-in, older styles unchanged): `inst.stretch(i, sx, sz)` per-instance X/Z scale in the two spare instance floats (0 = 1).
- Ground / fx: `K.ringBand` / `K.ringBands` (spread-outward ground zones), `Ripples.at(x, z, width)`. **Fix:** Ripples' Kit v4 solid mode had been pasted into `Streaks.draw` (solid rings never drew, and `Streaks.draw` would have thrown); it is now in `Ripples.draw`.
- Props: `well`, `rock`, `sagStrip` + `sagPosts`, `houseWindows`. Sprites: `figure` (stand / walk / hunch / float, merging Underriver's ghost and Fog Harbour's hunched figure), `panelLight` + `panelHalo`, `lightShaft({ fromBottom })`. Particles: `'softMist'` (additive).
- Motion: `K.Walkers`. Camera: `K.OrbitFocusRig` (Fog Harbour), `K.DriftRig` (Under the Hull), `K.GridWanderRig` + `K.GRID_DIRS` (Backrooms).
- Skipped (covered or scene-specific): Moth Lamp's pool texture (`poolSprite`), Drowned Ruins' sprites (Kit v3), the moth swarm (`School`), plus the wave 4b list above. Backlog item "repeat/loop for terrain and particles along an endless road" is covered by `K.repeat` and the camera-wrapped particle box.
- Smoke test after Kit v5: all 39 styles at k=0/1, no GL or console errors; Kit Demo 28→37 draws / ~11.4k tris. The wave 5 environments keep their local copies, as earlier waves did.

### Original backlog (for reference)

Each was implemented locally inside one environment file. Starred = asked for by 2+ sessions or clearly reusable.

**Renderer**
- ★ `r.updateTexture(tex, gen)` for in-place re-uploads (Ashfall Town calls `texSubImage2D` directly).
- ★ Dither-crossfade between two indexed textures (Ashfall's "rusts over" swell) as a reusable helper or shader path.
- ★ Instances that tilt/swing (rotation around X/Z, not just Y): toppled columns, swinging chandeliers, path-aligned props.
- ★ Distance fade for scattered things around the camera, and "lights that shine through fog" (`fog: false` + manual distance fade), so nothing pops in at the edge.

**Geometry / props**
- ★ `merge()` parts with rotation (a frame/transform helper); export `rotY`/`rotZ` from `props.js`.
- ★ Path tools: evenly resampled spline with banked frames (pos/dir/up/right/roll), `orientedBox(centre, axes)`, ribbon/track mesh, road strip with finer rows near the camera, endless segment placement along a path with per-segment deterministic contents.
- Pointed (gothic) arch, vault and lancet window panel; `chain()` of tilted boxes (necks/tails); `flatPoly` (upward-facing disc); flat ground decals (light pools); `quadFacing` winding helper; UV atlas helper; texture-atlas box faces.

**Sprites / textures**
- Fern, kelp, cactus, light shaft sprites; moss stone, cliff rock, jungle floor, scrolling waterfall textures; caustic flipbook + overlay helper.
- ★ `Sky` option for a custom moon texture (the default accent glow reads pink in many palettes).
- ★ Pixel font + neon text helper with per-letter staging (Route 9 and Neon Circuit both built one).

**Motion / particles**
- Underdamped pendulum (bass-pumped swing; `Spring` is critically damped).
- Fish/boid school helper.
- Direction-aligned streak particles (speed lines).
- Light strips along a path with per-segment brightness and beat pulses that travel along the path.
- Repeat/loop settings for terrain and particles along an endless road.
- Document that a negative instance `heightScale` flips sprites (used for bird wing flaps).

## Verification tips for agents (learned in wave 1)

- Give every parallel session its own port (`node serve.js 81xx`) and its own `.claude/launch.json` (gitignored).
- The pane is usually hidden, so `requestAnimationFrame` doesn't run. Step frames by hand from the console:
  ```js
  const { styles, renderer, s } = viz;
  styles.cur = INDEX; styles.next = -1;
  const a = { level: .6, bass: .5, mid: .5, high: .6, beat: false, beatPulse: 0, beatCount: 0, rmsDb: -20, rmsDbSmooth: -20 };
  for (let i = 0; i < 120; i++) {
    a.beat = i % 30 === 0; if (a.beat) a.beatCount++; a.beatPulse = a.beat ? 1 : a.beatPulse * .9;
    renderer.params.time += 1 / 60; renderer.resetStats();
    styles.update(a, K, K > 0, 1 / 60, s); styles.render(); renderer.present();
  }
  renderer.gl.getError(); // expect 0; also read renderer.stats.draws / .tris
  ```
  To screenshot the live loop at full intensity, stub `viz.analyser.update` to return fake audio and `viz.state.update` to set `playing = true, intensity = 1`.
- The first screenshot after stubbing may still show an idle frame (one real frame was already queued). Take a second one.
- `viz.selectPalette(id)` **persists** to localStorage. Reset with `viz.selectPalette('', 0)` afterwards.

## Merging environment branches

Every environment branch adds one file plus one line in `js/styles/index.js`, so each merge after the first conflicts only in that registry. Wave 1 was merged with a loop that runs `git merge --no-ff` per branch and, on conflict, regenerates `index.js` from the cumulative list of `file:Class` pairs (base styles first, then environments in merge order). Afterwards, smoke-test all styles with the stepping snippet above at k=0 and k=1.

## Wave 2 — session briefs (used 2026-11-19; reuse the template for future waves)

Start each with `start_session` (`initiation: user_asked`, `use_worktree: true`, fresh context), one per environment, cut from `main`. Use this **background** for all six:

> Vaporstation is a live audio-reactive visualizer for a friend's band: a static WebGL2 web app (no build step, no dependencies) with an authentic PS1 look (320x240, vertex jitter, affine textures, dithered 15-bit colour, heavy fog). It's shown fullscreen at gigs. Phases done and committed on main: the PS1 pipeline, audio analysis with a play/silent state machine that drives a single 0..1 `intensity` value, a CLUT palette system (indexed textures, 4 ramps x 4 shades, album palettes that recolour any environment), a world kit (`js/kit/`), and six wave-1 environments (`js/styles/`). Phase 3 wave 2 builds six more environments in parallel, one session per environment, each on its own branch. Environments evoke the mood of late-90s games but must be fully original: no names, characters, logos, maps or assets from real games.

**Prompt template** (fill in NAME, FILE, CLASS, PORT, CONCEPT, PALETTE-HINT, TEST-PALETTES):

> Build one new environment for Vaporstation: **NAME**, on your own branch in this worktree.
>
> **Read first:** `CLAUDE.md`, `docs/ENVIRONMENT-GUIDE.md`, `docs/HANDOFF.md` (verification tips), and `js/styles/kit-demo.js` (the reference implementation). **Use the Kit v2 helpers** (path frames, scatter, segments, NeonText, Pendulum, instance tilt, texture2/blend, draw fade, pixel helpers) instead of re-implementing them. Wave-1 environments in `js/styles/` show more techniques; feel free to borrow from them.
>
> **Concept:** CONCEPT
> Palette: `static palette = fromKeys('FILE', 'NAME', [...])` with PALETTE-HINT, inline in your file.
>
> **Rules:** create `js/styles/FILE.js` (class `CLASS`); the only other change allowed is appending it to the end of `STYLES` in `js/styles/index.js` (one import + one array entry). Don't edit the kit, pipeline or other styles. If the kit lacks something, implement it locally and list it in your report as a suggested kit addition. Golden rules: everything scales with intensity, nothing pops, colours only via `this.pal`, ≤150 draws, ≤20k tris.
>
> **Verify:** serve on `node serve.js PORT` with your own gitignored `.claude/launch.json`. Follow the stepping tips in `docs/HANDOFF.md`. Check k=0 and k=1, a crossfade into your style, `dispose()`, and 3 other palettes (TEST-PALETTES). Reset the palette afterwards.
>
> **Done =** the guide's checklist passes. Commit on your branch (end the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Don't merge or push. Report: branch name; draws/tris idle and active; idle and active looks; suggested kit additions.

| NAME | FILE / CLASS | PORT | CONCEPT | PALETTE-HINT | TEST-PALETTES |
|---|---|---|---|---|---|
| **Cold Base** | `cold-base` / `ColdBase` | 8107 | Original snowy research/military outpost at night (evokes late-90s stealth-ops levels; recreates nothing). Perimeter fences, hangars and prefab huts, stacked crates, a slowly rotating radar dish, watchtowers with sweeping searchlight cones (additive), a frozen ridge behind. Camera: slow security-camera sweeps alternating with a low glide (`SweepRig`/`DollyRig`). **Idle:** quiet, light snow, one searchlight lazily sweeping. **Swell:** snowstorm thickens (`snow` amount + wind), more searchlights wake in sequence, alarm beacons start rotating. **Beat:** searchlights snap toward the camera + beacon flash + nudge; **bass:** wind gusts; **highs:** beacon/spark flicker. | concrete grey, olive/steel secondary, alarm-orange accent, icy blue-black fog | `vapor`, `bloodmoon`, `amber` |
| **Station Deck** | `station-deck` / `StationDeck` | 8108 | Endless ring corridor of an original orbital station (evokes late-90s sci-fi shooters/adventures; recreates nothing). Ribbed walls, floor grating, pipes, sliding doors that open in sequence ahead, viewport windows showing stars and a large planet, holo panels with animated indexed patterns. Recycle corridor segments (like Fogway/Night Manor). **Idle:** low-power mode, emergency strip lights only, doors shut, slow drift. **Swell:** lights power up section by section, doors cycle open, holo panels boot. **Beat:** doors slam/open in a wave + alarm flash + nudge; **bass:** drift speed + hum vibration; **highs:** panel glitches/sparkle. | gunmetal, teal secondary, warning red/amber accent, deep navy fog | `toxic`, `sunset`, `handheld` |
| **Dream Journal** | `dream-journal` / `DreamJournal` | 8109 | Surreal dream-diary world (evokes late-90s experimental dream games; recreates nothing). Floating rooms and fragments (a doorway, half a staircase, a table and lamp) over a checkerboard void, giant everyday objects, staircases to nowhere, an endless drift between islands. **Idle:** still, slow, quiet colours. **Swell:** reality warps: objects breathe in scale, rooms rotate slowly, the checker floor ripples (`History`), extra fragments drift in from beyond the fog (fade, never pop). **Beat:** a room flips or blinks to an alternate texture via dither, camera nudge; **bass:** warp/breath amount; **highs:** sparkle and tiny floating symbols. | pastel base, contrasting secondary, vivid accent, soft lavender fog | `ashfall`, `deepsea`, `mono` |
| **Graveyard Hill** | `graveyard-hill` / `GraveyardHill` | 8110 | Spooky hillside cemetery (evokes late-90s gothic/horror platformers; recreates nothing). Crooked terrain, rows of `tombstone` props and crosses, `deadTree` sprites, iron fence runs, a ruined chapel silhouette on the crest, big moon and drifting clouds. Camera orbits/glides around the hill. **Idle:** mist, stillness, faint moonlight. **Swell:** will-o'-wisps (glow particles) rise between graves in sequence, bats flock across the moon, mist thickens and glows. **Beat:** wisps flare + lightning-ish moon pulse + nudge; **bass:** tree sway + mist roll; **highs:** wisp sparkle. | weathered stone, dead-grass/olive secondary, ghostly green-or-violet accent, midnight-blue fog | `vapor`, `sunset`, `glacier` |
| **Arcade After Hours** | `arcade-after-hours` / `ArcadeAfterHours` | 8111 | A 90s mall arcade at closing time (evokes the era, recreates nothing; **no real cabinets, games, brands or logos**). Rows of original cabinet shapes with glowing screens showing abstract animated indexed patterns, patterned carpet, neon ceiling tubes, a prize counter, a light-up dance-floor tile area. Dolly slowly through the aisles. **Idle:** mostly dark, attract-mode screens dimly cycling. **Swell:** cabinets power on row by row, ceiling neon flickers to life, floor tiles start chasing. **Beat:** floor tile pattern steps + screen flash + nudge; **bass:** tile brightness + subtle camera bob; **highs:** screen sparkle/flicker. | dark carpet purple, chrome/teal secondary, neon pink-yellow accent, near-black fog | `ashfall`, `glacier`, `jungle` |
| **Aurora Field** | `aurora-field` / `AuroraField` | 8112 | Calm, beautiful snowfield at night: the between-songs favourite (original). Gentle snowy terrain, a pine-forest edge, a frozen lake, and big aurora ribbons in the sky (additive animated ribbon meshes rippling like curtains), stars. Slow, wide camera glides. **Idle:** faint aurora, gentle snowfall, very calm (must look great at k=0, since it will often be on between songs). **Swell:** aurora brightens and spreads, more ribbons, colour shifts across the accent ramp. **Beat:** soft aurora pulse (keep it gentle) + tiny nudge; **mids:** ribbon ripple speed; **highs:** star twinkle + snow sparkle. | snow white-blue base, pine green secondary, aurora green-or-magenta accent, deep night-blue fog | `bloodmoon`, `amber`, `vapor` |

## Wave 5 — public-domain horror (spec: `docs/superpowers/specs/2026-11-21-horror-wave-design.md`)

Nine were started in parallel on 2026-11-21; the sessions hit the usage limit, and on 2026-11-22 the user dropped six (Sleeper Rises, Carpathian Approach, Storm Laboratory, Hunter's Moon, Sealed Tomb, Shadow Ship; branches, worktrees and sessions deleted / archived). **Merged 2026-11-22** (indices 36–38): Colour from the Well (38–44 draws / ≤7.7k tris), The Backrooms (14 / ~13k), Fog Harbour (46–52 / ≤13.2k, the planar reflection doubles the world). Each passed k=0/1, crossfade, `dispose()` and three palettes in its session. Real-fps `?bench` still pending. The merge loop broke on Windows (`/tmp` doesn't exist for node) and two merge commits went in with conflict markers in `js/styles/index.js`; fixed forward in the next commit. Use a repo-relative temp path next time.

## Wave 4 — Radiohead set (spec: `docs/superpowers/specs/2026-11-20-radiohead-setlist-environments-design.md`)

Album palettes are `ALBUM_PALETTES` in `js/palette/library.js` (signed off 2026-11-20). **Wave 4a merged 2026-11-20** (indices 24–29, in set order): Quiet House, Moth Lamp, Under the Hull, Still Pool, Underriver, Before Dawn. Smoke-tested all 30 styles at k=0/1 with no GL or console errors; the new six use 10–22 draws and ≤13.5k tris; a crossfade chain through them peaked at 49 draws. When stepping frames at k=0, set `viz.s.autoSwitch = false` first, or the idle auto-switch swaps styles mid-test. Real-fps `?bench` still pending. **Wave 4b merged 2026-11-20** after Kit v4 (indices 30–35, in set order): Salt Flat (High and Dry), Searchlight Town (Karma Police), Back Road Lights (Subterranean Homesick Alien), Paper Crowd (You and Whose Army?), Newsprint (Daily Mail), Right Place (Everything In Its Right Place). Smoke-tested all 36 styles at k=0/1 with no GL or console errors (single style peak 88 draws / 17.9k tris); the new six use 8–24 draws and ≤15.6k tris; a crossfade chain through them peaked at 39 draws / 28.5k tris (two styles at once). Real-fps `?bench` still pending. Housekeeping done 2026-11-20: all twelve wave 4 `claude/env-*` branches and worktrees deleted, the six 4b sessions archived. **Next:** the 12-song setlist JSON in `setlists/`.

## Wave 3 — slow-song environments (done: built in six parallel sessions, merged 2026-11-19)

Smoke-tested after the merge: all 24 styles at k=0/1 with no GL or console errors, plus a crossfade chain through all six (peak during a crossfade: 107 draws / 27k tris, two styles at once). Real-fps `?bench` is still pending (open item 1). Before starting a wave, check `git branch` for existing `claude/env-*` branches: this wave was nearly launched twice because this file was stale.

Same background and prompt template as wave 2, with two changes to the prompt: **read `js/styles/kit-calm.js` too and copy it instead of `kit-demo.js`**, and follow the guide's "Slow songs and ballads" section (light rises with intensity, not speed; phrase with `K.Breath`; one soft event per beat). Use the Kit v3 pieces (reflections, `opacity`, `K.tex`, `Ripples`, `Pulses`, `School`, the calm sprites and particle presets).

| NAME | FILE / CLASS | PORT | CONCEPT | PALETTE-HINT | TEST-PALETTES |
|---|---|---|---|---|---|
| **Lantern River** | `lantern-river` / `LanternRiver` | 8113 | A slow night drift down a calm river between reed banks and willows (original). The water reflects everything (`setMirror`); paper lanterns float with the current; low stone footbridges pass overhead now and then (recycled segments, like Fogway). **Idle:** mist on the water, a few lanterns, the drift barely moving. **Swell:** lanterns are lit upstream one by one, fireflies and pollen come out on the banks, the far bank's windows warm up. **Beat:** a ripple under the nearest lantern + a soft pulse running along the lantern line (`Pulses`); **mids:** willow sway. | mossy stone base, reed green secondary, warm lantern amber accent, deep teal night fog | `vapor`, `glacier`, `bloodmoon` |
| **Rain Window** | `rain-window` / `RainWindow` | 8114 | Inside a quiet room at night, looking out of a big rain-streaked window at a sleeping city (original, no real skyline). A desk lamp, plants, a mug; beyond the glass, rooftops, water towers and distant traffic lights as soft glows. Drops slide down the glass (streak sprites on a pane with `opacity`), the room reflects faintly in it. **Idle:** drizzle, most city lights out, slow camera breath (`Breath`). **Swell:** rain thickens, windows across the city light up block by block, a train's lights glide past far off. **Beat:** one drop runs down the glass + a distant light blinks; **highs:** glints on the drops. | warm wood/interior base, cool slate secondary, amber-and-pink city-light accent, rain-blue fog | `amber`, `deepsea`, `mono` |
| **Cloud Sea** | `cloud-sea` / `CloudSea` | 8115 | Above the clouds at dawn (original): scrolling cloud layers (`K.tex.cloudLayer` on several heights with `opacity`), mountain peaks rising through them like islands, a huge low sun, birds gliding in loose V-shapes (`School`, `flap: 0`). Very slow forward glide. **Idle:** pre-dawn, faint stars, the cloud sea almost still. **Swell:** the sun rises and the clouds take its colour, more birds, sky lanterns drift up from below. **Beat:** a soft brightening wave across the cloud tops (`History`); **bass:** cloud scroll speed. | pale peak stone base, cloud-white secondary, sunrise gold-or-pink accent, high-altitude blue fog | `sunset`, `toxic`, `ashfall` |
| **Petal Steps** | `petal-steps` / `PetalSteps` | 8116 | A long flight of old stone steps climbing a wooded hillside, lined with original paper-lantern posts and blossom trees (no real shrine, temple or landmark). Petals fall and drift, mist sits in the hollows, the camera climbs very slowly (`PathRig` on a gentle path). **Idle:** dusk, mist, a few lanterns, petals barely falling. **Swell:** lanterns light up the steps ahead, the petal fall thickens, light shafts through the canopy. **Beat:** a pulse runs up the line of lanterns (`Pulses`); **mids:** blossom sway. | weathered stone base, moss green secondary, blossom pink accent, lavender dusk fog | `deepsea`, `amber`, `jungle` |
| **Moonlit Shallows** | `moonlit-shallows` / `MoonlitShallows` | 8117 | A tidal flat at night (original): wet sand, a sheet of shallow water mirroring a huge moon (`setMirror`), driftwood, rock pools, gentle waves rolling in as long bright lines. Soft glowing drifting creatures float just above the water (glow particles bobbing, or `School`). **Idle:** low tide, still water, only the moon. **Swell:** the glowing drifters gather and brighten, waves get longer, `starTwinkle` comes out. **Beat:** a ripple ring opens where a drifter touches the water; **bass:** wave height. | sand base, kelp/driftwood secondary, bioluminescent cyan-or-violet accent, midnight-blue fog | `sunset`, `handheld`, `bloodmoon` |
| **Greenhouse at Dusk** | `greenhouse-dusk` / `GreenhouseDusk` | 8118 | Inside an old glass greenhouse at dusk (original): iron-framed glass roof, ferns and hanging plants, a small koi pond with fish (`School`) and caustic light on its floor (`Caustics`), strings of warm bulbs along the beams, condensation on the panes. **Idle:** blue dusk through the glass, a few bulbs, pollen floating. **Swell:** bulb strings light up beam by beam, light shafts through the glass, koi gather and the caustics brighten. **Beat:** a pulse runs along the bulb strings (`Pulses`) + a ripple on the pond; **highs:** pollen sparkle. | verdigris iron base, leaf green secondary, warm bulb amber accent, dusky blue fog | `vapor`, `mono`, `glacier` |
