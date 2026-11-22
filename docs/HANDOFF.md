# Handoff — state as of 2026-11-22

Read this first when picking the project back up. Also read `CLAUDE.md` (rules), `ROADMAP.md` (plan)
and `docs/ENVIRONMENT-GUIDE.md` (how environments are built, full kit reference).
Older detail (per-wave concept tables, the original kit backlog) is in git history: `git log -p docs/HANDOFF.md`.

## Where things stand

All work is committed on `main`, **local only: no git remote yet**, nothing pushed.

| Phase | Status |
|---|---|
| v1: PS1 pipeline, audio analysis, play/silence state machine | done |
| 0: housekeeping (`.gitignore`, `CLAUDE.md`, `?bench`) | done |
| 1: CLUT palettes, editor, album-art extraction, import/export, setlist mode | done |
| 2: world kit (`js/kit/`), Kit Demo, environment guide | done; kit now at **v5** |
| 3: environment library | done: **36 environments** + 3 hidden reference scenes |
| 4: UI pass, MIDI, tap tempo, show control, Feel setting | done; real MIDI hardware untested |
| 5: gig hardening | **in progress** (2026-11-22): gig-safety layer, see below |

## Styles on main (`js/styles/index.js`)

Draws / tris measured at idle → full intensity (320×240, stepped with synthetic audio, 2026-11-22). Budget: ≤150 draws, ≤20k tris.

| # | Style | # | Style | # | Style |
|---|---|---|---|---|---|
| 0 | Pipeline test *(hidden)* 15 / 0.2k | 13 | Dream Journal 20–21 / 5.5–5.9k | 26 | Under the Hull 14 / 7k |
| 1 | Fogway 52–87 / 0.8–1.1k | 14 | Graveyard Hill 14–18 / 16.2–16.8k | 27 | Still Pool 14–16 / 13.4k |
| 2 | Monoliths 45–77 / 5–5.2k | 15 | Arcade After Hours 26–32 / 14.2–15.1k | 28 | Underriver 10 / 7.6–7.8k |
| 3 | Relic 45 / 2.3k | 16 | Aurora Field 12–17 / 8.9–11.3k | 29 | Before Dawn 17–22 / 6.3–6.8k |
| 4 | Kit demo *(hidden)* 31–37 / 11.2–11.4k | 17 | Kit calm *(hidden)* 25–29 / 11.8–12.4k | 30 | Salt Flat 9–13 / 14.6–15.6k |
| 5 | Ashfall Town 9 / 3–4.3k | 18 | Lantern River 35–36 / 15.9–16.2k | 31 | Searchlight Town 8 / 12.8k |
| 6 | Lost Valley 54–56 / 10.5–10.9k | 19 | Rain Window 42–45 / 7.2–8.1k | 32 | Back Road Lights 20–24 / 9–9.1k |
| 7 | Neon Circuit 18–19 / 17.5–17.8k | 20 | Cloud Sea 8 / 7.9–9.1k | 33 | Paper Crowd 14–15 / 1.9–2.1k |
| 8 | Night Manor 21–25 / 14–15.5k | 21 | Petal Steps 14–15 / 8.6–9.1k | 34 | Newsprint 8–9 / 5.6–6.2k |
| 9 | Drowned Ruins 13–16 / 10–12.3k | 22 | Moonlit Shallows 23–25 / 15–15.1k | 35 | Right Place 8–9 / 6.1–6.4k |
| 10 | Route 9 16–17 / 7.1–7.5k | 23 | Greenhouse at Dusk 28–30 / 7–7.3k | 36 | Colour from the Well 38–44 / 6.4–7.4k |
| 11 | Cold Base 23–24 / 11.9–14k | 24 | Quiet House 19 / 3.9k | 37 | The Backrooms 14 / 11.3–12.2k |
| 12 | Station Deck 14–16 / 6.5–6.8k | 25 | Moth Lamp 13 / 5–5.4k | 38 | Fog Harbour 46–52 / 12.4–13.1k |

Groups: 1–16 waves 1–2 (general), 17–23 wave 3 (slow songs, built from Kit calm), 24–35 wave 4 Radiohead set (album
palettes in `ALBUM_PALETTES`, `js/palette/library.js`; spec `docs/superpowers/specs/2026-11-20-radiohead-setlist-environments-design.md`),
36–38 wave 5 horror (spec `docs/superpowers/specs/2026-11-21-horror-wave-design.md`; six more concepts from that spec were dropped by the user).
Number keys reach 0–9; the rest via N / Shift+N, the dropdown, auto-switch, a setlist song or the environment browser.

## Verified vs. not verified

- **Verified (Claude browser pane):** every style at idle and full intensity with synthetic audio, no GL/console errors, within
  budget; crossfades; palette swaps; album-art extraction; hex/GPL import; editor save; GLB loader; demo-track state machine;
  setlist stepping and cue logic; simulated MIDI bytes.
- **Not verified yet** (all need real hardware or a visible window):
  1. **`?bench` real fps.** The pane is hidden during agent work, which pauses `requestAnimationFrame`. Run
     `http://localhost:8080/?bench` in a visible normal Chrome tab for ~1 min; results in `console.table` and `window.benchResults`.
  2. **Live input with the Scarlett 2i2** (the pane blocks the microphone): real Chrome → pick device → Start live input → check the threshold meter.
  3. **The gig laptop** (perf, fullscreen, sleep settings), plus thumbnail cost there (one extra style render every 0.4 s while the panel is open).
  4. **Real MIDI hardware** and a **USB footswitch** (check which key it sends; add it in `main.js` if needed).
  5. How the **Feel** setting feels with real songs in a visible window.

## Open items (priority)

1. **Gig-safety layer (Phase 5)**: built (governor, watchdog, offline PWA, kiosk launcher, pre-show check; see the last
   section). Left: try it on the gig laptop. Design: `docs/superpowers/specs/2026-11-22-gig-safety-design.md`.
2. **Add a GitHub remote and push** (the user has to create the repo; everything lives on one disk until then).
3. Run the "not verified" checks above on the gig laptop.
4. Song-section awareness (verse / chorus / drop from energy over several bars) so camera moves and reveals land on section
   changes. Suggested after the safety layer.
5. Optional: teach a few styles to phrase camera moves on `audio.bar` (tap tempo); no style uses `bpm/beatPhase/bar` yet.

## Systems in brief

- **Reactivity (2026-11-20):** the **Feel** setting (`s.reactivity`: 0 Gentle default, 0.5 Medium, 1 Punchy; Show card, R key,
  MIDI knob) blends the `PROFILES` rows in `js/show/control.js`: extra band smoothing toward `audio.energy`, a beat-strength gate
  + minimum gap (Gentle ≈ 1 beat/s), eased beat pulse, and `K.feel`, which scales every `K.Envelope` / `K.Spring` kick and the
  kit camera's FOV punch. Styles should scale hand-rolled beat reactions by `audio.accent / motion / decay`.
- **Show control (`js/show/`):** Hold I, Freeze Z, Blackout B, Big moment G, strobe-safe limiter (≤3 beats/s), tap tempo T +
  BPM lock L, Web MIDI with learn + Program Change → song, environment browser with live thumbnails. UI is the "Soft Vapor"
  restyle (`css/style.css`, `js/icons.js`); sections are found by `h2[data-title]`.
- **Setlists (`js/setlist/`):** songs pick a palette + environment pool; PageDown / → / ] next, PageUp / ← / [ prev, S toggles;
  while playing, Next cues the song until silence (press again to force).
- **Kit history** (full reference in the guide; each version is shown in `kit-demo.js` or `kit-calm.js`):
  v2 path frames, scatter, segments, neon text, pendulum, instance tilt, dither crossfade, draw `fade`;
  v3 `K.tex` surfaces, caustics / streaks / pulses / ripples, fish & bird schools, `Breath`, screen-door `opacity`, planar reflections;
  v4 `twoSided`, GPU `wave`, `setJitterBoost`, searchlights, `BarClock` / `Stager` / `Follow3`, gabled house, `Wobble`;
  v5 (2026-11-22) instance `stretch`, `ringBands`, `Ripples.at`, well / rock / sag strip / house windows, figure + panel sprites,
  `softMist`, `Walkers`, `OrbitFocusRig` / `DriftRig` / `GridWanderRig`; also fixed Ripples' solid mode (it had been pasted into `Streaks.draw`).
  Environments keep the local copies they were built with; only Colour from the Well and Fog Harbour were moved onto Kit v5
  (pixel-diffed: visually identical).

## Verification tips for agents

- Give every parallel session its own port (`node serve.js 81xx`) and its own gitignored `.claude/launch.json`.
- The pane is usually hidden, so `requestAnimationFrame` doesn't run. Step frames by hand (set `viz.s.autoSwitch = false` first,
  or the idle auto-switch swaps styles mid-test):
  ```js
  const { styles, renderer, s } = viz; s.autoSwitch = false;
  styles.cur = INDEX; styles.next = -1;
  const a = { level: .6, bass: .5, mid: .5, high: .6, beat: false, beatPulse: 0, beatCount: 0, rmsDb: -20, rmsDbSmooth: -20 };
  for (let i = 0; i < 120; i++) {
    a.beat = i % 30 === 0; if (a.beat) a.beatCount++; a.beatPulse = a.beat ? 1 : a.beatPulse * .9;
    renderer.params.time += 1 / 60; renderer.resetStats();
    styles.update(a, K, K > 0, 1 / 60, s); styles.render(); renderer.present();
  }
  renderer.gl.getError(); // expect 0; also read renderer.stats.draws / .tris
  ```
- To screenshot the live loop at full intensity, stub `viz.analyser.update` to return fake audio and `viz.state.update` to set
  `playing = true, intensity = 1`. The first screenshot after stubbing may still show an idle frame; take a second one.
- Changed kit files are cached by the page's module graph: **reload the page** after editing `js/kit/*` before testing.
- Before/after pixel diffs: render both versions with a seeded `Math.random` and identical audio, copy each frame with
  `r.snapshot(ctx)` right after `present()`, and compare `getImageData`. A control run (same class twice) must give 0%.
- `viz.selectPalette(id)` **persists** to localStorage. Reset with `viz.selectPalette('', 0)` afterwards.

## Building a wave of environments

1. Check `git branch` for leftover `claude/env-*` branches first.
2. Write a spec with one row per environment: NAME, FILE / CLASS, PORT, CONCEPT (idle / swell / beat / bass / highs), palette
   hint, three test palettes. See the wave 4 and 5 specs.
3. One `start_session` per environment (`initiation: user_asked`, `use_worktree: true`, fresh context). **Background** (adapt):
   > Vaporstation is a live audio-reactive visualizer for a friend's band: a static WebGL2 web app (no build step, no
   > dependencies) with an authentic PS1 look (320x240, vertex jitter, affine textures, dithered colour, heavy fog), shown
   > fullscreen at gigs. A play/silent state machine drives one 0..1 `intensity`; a CLUT palette system recolours any
   > environment; a world kit (`js/kit/`) and 36 environments exist. Environments evoke the mood of late-90s games but must
   > be fully original: no names, characters, logos, maps or assets from real games.
4. **Prompt template:**
   > Build one new environment for Vaporstation: **NAME**, on your own branch in this worktree.
   > **Read first:** `CLAUDE.md`, `docs/ENVIRONMENT-GUIDE.md`, `docs/HANDOFF.md` (verification tips), `js/styles/kit-demo.js`
   > (copy `kit-calm.js` instead for slow songs) and the wave spec. Use the kit instead of re-implementing it.
   > **Concept:** CONCEPT. Palette: `static palette = fromKeys('FILE', 'NAME', [...])` with PALETTE-HINT, inline in your file.
   > **Rules:** create `js/styles/FILE.js` (class `CLASS`); the only other change allowed is appending it to `STYLES` in
   > `js/styles/index.js`. Don't edit the kit, pipeline or other styles; implement missing pieces locally and list them as
   > suggested kit additions. Everything scales with intensity, nothing pops, colours only via `this.pal`, ≤150 draws, ≤20k tris.
   > **Verify:** `node serve.js PORT` with your own `.claude/launch.json`; k=0 and k=1, a crossfade in, `dispose()`, three other
   > palettes (TEST-PALETTES), then reset the palette.
   > **Done =** the guide's checklist passes. Commit on your branch (end with the Co-Authored-By line). Don't merge or push.
   > Report: branch; draws / tris idle and active; idle and active looks; suggested kit additions.
5. **Merge:** `git merge --no-ff` per branch. Each merge after the first conflicts only in `js/styles/index.js`: rebuild it from
   the last good version plus one import + one array entry per branch, using a **repo-relative** temp path (on Windows `/tmp`
   doesn't exist for node; wave 5's merge went wrong that way). Check for conflict markers before committing, then smoke-test
   every style at k=0 and k=1.
6. Afterwards: promote reported kit suggestions (a Kit vN pass, shown in `kit-demo.js`), then delete the branches, worktrees and
   archive the sessions once the user agrees.

## Gig-safety layer (Phase 5) — built, needs gig-laptop checks

Design: `docs/superpowers/specs/2026-11-22-gig-safety-design.md`.

**Landed (2026-11-22):**
- **Governor** `js/safety/governor.js` (`viz.governor`): 3 s windows under 45 fps step down once each: backbuffer dpr cap →
  particles to 60 % (`renderer.quality`, read by kit `Particles`, ramped) → the showing style is marked heavy (localStorage
  `vaporstation.heavy`, by style key) and leaves the rotation; under 30 fps it crossfades away (at most once a minute). Stops
  marking after ¼ of the styles ("machine is slow overall"). Never steps back up; `viz.governor.reset()` clears it. Off in `?bench`.
- **Style guard** in `StyleManager`: a style that throws in init / update / render / thumbnail is `broken` for the session, drawn as
  fog, leaves the rotation, and the manager crossfades to its neighbour. `frame()` also guards the audio and render sections.
- **Watchdog** `js/safety/watchdog.js` (`viz.watchdog`): WebGL context loss → dithered fog cover, `renderer.restore()` +
  `styles.rebuild()` on restore, cover fades out; no restore in 6 s or rebuild throws → reload. AudioContext not running →
  `resume()` every 2 s. Live input wanted but closed → reopen with backoff 0.5…10 s. 8 s of exact digital zero → reopen.
- Debug overlay (D) has a `safety:` line. Rotation now skips broken / heavy styles; `goNext` from a style outside the
  rotation goes to its neighbour in order.

Tested in the pane: injected throws in render and update, `WEBGL_lose_context` lose → restore (0.8 s, picture back, no GL
errors), governor tiers + the saturation cap with synthetic frame times, every style at k=0 / k=1 through the guarded path.
**Not tested:** a real driver reset (TDR), a real interface unplug / dead stream (needs real Chrome + hardware).

**Landed (2026-11-22, part 2): offline + kiosk**
- `sw.js` service worker: network first (edits show at once while developing; 2.5 s timeout), cache fallback. The page
  posts every resource it loaded (`warm`), so all modules, styles and `demo/demo.wav` are cached on first visit with no
  file list to maintain. Range requests (the audio player) bypass it unless offline. `?nosw` skips registration; bump
  `CACHE` in `sw.js` to drop old caches. `manifest.webmanifest` + `icon.svg` (installable, starts at `?kiosk`).
- `?kiosk`: panel hidden, cursor hidden while it is, live input opened (default device if none saved). Screen wake lock in
  kiosk and fullscreen. Startup counts as "live wanted", so the watchdog keeps retrying an interface plugged in later.
- `kiosk.bat`: starts `node serve.js` minimised (or relies on the cache if node is missing), finds Chrome / Edge, launches
  `--kiosk` with its own profile (`%LOCALAPPDATA%\Vaporstation\chrome`), autoplay allowed, input permission auto-accepted,
  background throttling off. Dry-run checked (the command it builds); not launched for real.
- Tested in the pane: 90 files cached; server stopped → `?kiosk` reload loads fully from cache, no GL errors; input retry
  backoff 0.5 → 1 → 2 → 4 s.

**Landed (2026-11-22, part 3): pre-show check**
- `js/safety/selftest.js`, started by `?selftest` or the **Pre-show check** button (Settings foot). Runs `Bench` with
  short phases (1 s idle + 2.5 s active per style, ~2.5 min) while sampling the live input peak, then shows a report
  dialog (OK / WARN / FAIL / INFO): GPU (fails on software rendering), display + refresh, frame rate (styles under 45 fps
  **replace** the governor's heavy list, unless more than a quarter fail = "machine slow overall", list left alone),
  audio start without a click, input peak (clipping / silence), MIDI devices, offline cache, wake lock, battery.
  Copy report / Run again / Close (Close drops `?selftest` from the URL). `window.selfTestReport` holds the result.
- Pauses auto-switch and the governor while it runs and restores both. `Bench` now takes `{ idle, active, quiet }`.
- Tested in the pane: full run on the dev laptop (GTX 1660 Ti, 120 Hz: all 39 at 120 fps, report renders, Close works);
  `finish()` with fake results marks the right style heavy and ignores the hidden test scene.

**Phase 5 remaining:** run the not-verified checks on the gig laptop (kiosk.bat for real, Scarlett unplug / replug, a
pre-show check there), and add the GitHub remote.
