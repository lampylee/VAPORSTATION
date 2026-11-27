# Handoff — state as of 2026-11-27

Read this first when picking the project back up. Also read `CLAUDE.md` (rules), `ROADMAP.md` (plan)
and `docs/ENVIRONMENT-GUIDE.md` (how environments are built, full kit reference).
Older detail (per-wave concept tables, the original kit backlog) is in git history: `git log -p docs/HANDOFF.md`.

## Where things stand

All work is committed on `main` and pushed to `origin` (`github.com/lampylee/VAPORSTATION`).

| Phase | Status |
|---|---|
| v1: PS1 pipeline, audio analysis, play/silence state machine | done |
| 0: housekeeping (`.gitignore`, `CLAUDE.md`, `?bench`) | done |
| 1: CLUT palettes, editor, album-art extraction, import/export, setlist mode | done |
| 2: world kit (`js/kit/`), Kit Demo, environment guide | done; kit now at **v5** |
| 3: environment library | done: **37 environments** + 3 hidden reference scenes |
| 4: UI pass, MIDI, tap tempo, show control, Feel setting | done; real MIDI hardware untested |
| 5: gig hardening | **in progress** (2026-11-22): gig-safety layer, see below |
| Projector output + operator view | built (2026-11-23), single-screen only tested; see "Landed (2026-11-23): projector output" |

## Styles on main (`js/styles/index.js`)

Draws / tris measured at idle → full intensity (320×240, stepped with synthetic audio, 2026-11-22). Budget: ≤150 draws, ≤20k tris.

| # | Style | # | Style | # | Style |
|---|---|---|---|---|---|
| 0 | Pipeline test *(hidden)* 15 / 0.2k | 13 | Dream Journal 20–21 / 5.5–5.9k | 26 | Under the Hull 14 / 10.8k |
| 1 | Fogway 52–87 / 0.8–1.1k | 14 | Graveyard Hill 14–18 / 16.2–16.8k | 27 | Still Pool 14–16 / 13.4k |
| 2 | Monoliths 45–77 / 5–5.2k | 15 | Arcade After Hours 32 / 14.2–15.2k | 28 | Underriver 10 / 7.6–7.8k |
| 3 | Relic 45 / 2.3k | 16 | Aurora Field 12–17 / 8.9–11.3k | 29 | Before Dawn 17–22 / 9.8–10.4k |
| 4 | Kit demo *(hidden)* 31–37 / 11.2–11.4k | 17 | Kit calm *(hidden)* 25–29 / 11.8–12.4k | 30 | Salt Flat 9–13 / 14.6–15.6k |
| 5 | Ashfall Town 9 / 3–4.3k | 18 | Lantern River 35–36 / 15.9–16.2k | 31 | Searchlight Town 8 / 12.8k |
| 6 | Lost Valley 54–56 / 10.5–10.9k | 19 | Rain Window 42–45 / 7.2–8.1k | 32 | Back Road Lights 20–24 / 9–9.1k |
| 7 | Neon Circuit 18–19 / 17.5–17.8k | 20 | Cloud Sea 8 / 7.9–9.1k | 33 | Paper Crowd 14–15 / 1.9–2.1k |
| 8 | Night Manor 25–29 / 16–17.6k | 21 | Petal Steps 14–15 / 8.6–9.1k | 34 | Newsprint 8–9 / 5.6–6.2k |
| 9 | Drowned Ruins 13–16 / 10–12.3k | 22 | Moonlit Shallows 23–25 / 15–15.1k | 35 | Right Place 8–9 / 6.1–6.4k |
| 10 | Route 9 16–17 / 7.1–7.5k | 23 | Greenhouse at Dusk 28–30 / 7–7.3k | 36 | Colour from the Well 38–44 / 6.4–7.4k |
| 11 | Cold Base 23–24 / 13.5–15.6k | 24 | Quiet House 19 / 4.2k | 37 | The Backrooms 14 / 13.6–15k |
| 12 | Station Deck 14–16 / 6.5–6.8k | 25 | Moth Lamp 13 / 5–5.4k | 38 | Fog Harbour 46–52 / 13.3–14k |
|  |  |  |  | 39 | Ember Vigil 48–50 / 17.3–18.3k |
|  |  |  |  | 40 | Ossuary Lift 8 / 1.7–1.9k |

Groups: 1–16 waves 1–2 (general), 17–23 wave 3 (slow songs, built from Kit calm), 24–35 wave 4 Radiohead set (album
palettes in `ALBUM_PALETTES`, `js/palette/library.js`; spec `docs/superpowers/specs/2026-11-20-radiohead-setlist-environments-design.md`),
36–38 wave 5 horror (spec `docs/superpowers/specs/2026-11-21-horror-wave-design.md`; six more concepts from that spec were dropped by the user).
39 Ember Vigil, a single showpiece built in one session (dark fantasy: knight at a fire in a ruined cathedral, keep + eclipse +
40 Ossuary Lift (horror): an iron cage lift sinking down an endless skull-and-bone shaft; the world stays put, the wall texture
scrolls and torches wrap past the cage (`K.LightSet`). Beat jolts the chains, a drop is a short free-fall with streaking torches.
colossus through the rose window; spec `docs/superpowers/specs/2026-11-22-ember-vigil-design.md`). It is the Kit v6 reference.
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
  6. Song shape (2026-11-24): the **feel with real band songs in a visible window**, true fps / `?bench` for the changed styles, and Gentle-vs-Punchy screenshots for most Phase 2 styles (the hidden pane couldn't take them; those were checked by reading the code).

## Open items (priority)

1. **Gig-safety layer (Phase 5)**: built (governor, watchdog, offline PWA, kiosk launcher, pre-show check; see the last
   section). Left: try it on the gig laptop. Design: `docs/superpowers/specs/2026-11-22-gig-safety-design.md`.
2. Run the "not verified" checks above on the gig laptop, plus the projector ones (see "Landed (2026-11-23): projector output").
3. **The Conductor** (2026-11-23): built. Intensity follows the song's shape, sections, auto tempo, optional world change on
   drops (off). Left: try it with real songs in a visible window (thresholds were tuned on synthetic songs and the demo track).
   Design + build notes: `docs/superpowers/specs/2026-11-23-conductor-design.md`. Test: `node tools/test-conductor.mjs`.
4. **Song shape** (2026-11-24): merged into `main`. Left: try it with real songs in a visible window. See "Landed (2026-11-24): song shape" below for status, what was and wasn't verified, and the open items for you to decide or check.
5. Moonshot, not scheduled: a crossfaded **PS2 mode** toggle (640×448, perspective-correct, filtered textures, feedback
   haze, ~100k-tri budget, kit detail scaling). Needs the user's sign-off on a scoped hard-rule exemption first.
   Design: `docs/superpowers/specs/2026-11-23-ps2-mode-design.md`.
6. Parked idea, next after the projector output: a **live camera feed** (band as palette-mapped PS1 video on in-world
   screens). Not designed yet; notes and open questions: `docs/superpowers/specs/2026-11-23-camera-feed-notes.md`.

## Systems in brief

- **Reactivity (2026-11-20):** the **Feel** setting (`s.reactivity`: 0 Gentle default, 0.5 Medium, 1 Punchy; Show card, R key,
  MIDI knob) blends the `PROFILES` rows in `js/show/control.js`: extra band smoothing toward `audio.energy`, a beat-strength gate
  + minimum gap (Gentle ≈ 1 beat/s), eased beat pulse, and `K.feel`, which scales every `K.Envelope` / `K.Spring` kick and the
  kit camera's FOV punch. Styles should scale hand-rolled beat reactions by `audio.accent / motion / decay`.
- **Show control (`js/show/`):** Hold I, Freeze Z, Blackout B, Big moment G, strobe-safe limiter (≤3 beats/s), tap tempo T +
  BPM lock L, Web MIDI with learn + Program Change → song, environment browser with live thumbnails. UI is the "Soft Vapor"
  restyle (`css/style.css`, `js/icons.js`); sections are found by `h2[data-title]`.
- **Conductor (`js/show/conductor.js`, 2026-11-23):** between PlayState and ShowControl. Per song (reset when `k_play`
  reached 0): smoothed raw level / bass / highs, a 10 Hz history, sections (intro, groove, build, drop, breakdown, outro; ≥ 4 s
  each except a drop), and a target intensity: an arc over ~75 s × an energy factor, breakdowns down to ~0.35-0.45, builds up
  to 0.85, drops to 1 (peak decays ~20 s after). `k = k_play × shaped`. Auto tempo: beat inter-onset histogram folded into
  80-170 bpm; tap tempo wins. `s.conductor` (Follow song) off = old `k` exactly; `s.dropSwitch` calls `styles.goNext()` once per song.
  The demo track's third song (82-160 s) has two builds and drops; the debug overlay shows a `song:` line.
- **Setlists (`js/setlist/`):** songs pick a palette + environment pool; PageDown / → / ] next, PageUp / ← / [ prev, S toggles;
  while playing, Next cues the song until silence (press again to force).
- **Kit history** (full reference in the guide; each version is shown in `kit-demo.js` or `kit-calm.js`):
  v2 path frames, scatter, segments, neon text, pendulum, instance tilt, dither crossfade, draw `fade`;
  v3 `K.tex` surfaces, caustics / streaks / pulses / ripples, fish & bird schools, `Breath`, screen-door `opacity`, planar reflections;
  v4 `twoSided`, GPU `wave`, `setJitterBoost`, searchlights, `BarClock` / `Stager` / `Follow3`, gabled house, `Wobble`;
  v7 (2026-11-23, relight) `K.LightSet`: many light sources, the best 4 kept in sticky slots that fade (no pops); used by
  Night Manor, Fog Harbour, The Backrooms, Cold Base, then Ashfall Town, Quiet House, Arcade After Hours, Station Deck,
  Back Road Lights, Under the Hull (Before Dawn and Moth Lamp set one light directly). 12 styles relit in all. Spec
  `docs/superpowers/specs/2026-11-23-relight-design.md`;
  v6 (2026-11-22, Ember Vigil) **pipeline point lights** (`r.setPointLights`, 4 per scene, per vertex), `gothicPier`, `keep`,
  `knight`, `wallWithHole`, `roseWindow`, `Fire` / `Candles` / `Lightning` (`js/kit/fantasy.js`), `tex.flagstones/ashlar/
  stainedGlass/plateArmor/wornCloth`, `sprites.tatteredBanner/colossus/corona/disc`;
  v5 (2026-11-22) instance `stretch`, `ringBands`, `Ripples.at`, well / rock / sag strip / house windows, figure + panel sprites,
  `softMist`, `Walkers`, `OrbitFocusRig` / `DriftRig` / `GridWanderRig`; also fixed Ripples' solid mode (it had been pasted into `Streaks.draw`).
  Environments keep the local copies they were built with; only Colour from the Well and Fog Harbour were moved onto Kit v5
  (pixel-diffed: visually identical).

## Landed (2026-11-24): song shape

Merged into `main` (`git log --oneline 1737617..8f9ec11`). Spec: `docs/superpowers/specs/2026-11-24-song-shape-design.md`. Three phases:
1. **Calm motion + shape.** `beatMotion` column in `PROFILES` (Gentle 0 / Medium 0.4 / Punchy 1; `feel.beatMotion`, `audio.beatMotion`); `K.drive` also gives `groove` and `beatMotion`. `js/show/shape.js` (`SongShape`) eases `audio.shape` (close / pace / fog / weather / phrase) from the section; `node tools/test-shape.mjs`. Kit camera rigs lost their beat kicks at Gentle, travel by energy, and gained bar sway, section framing (`close`, per-phrase `reframe`) and `camParams()`; `renderer.fogScale` and the particle amount follow the shape; the debug overlay has a `shape:` line. `K.Breath` pays downbeat corrections back through an eased rate.
2. **Bouncing pass.** Every style (and kit demo / calm) scales beat movement by `beatMotion` and light by `accent`, with Punchy kept as before. Rules for new environments: `docs/ENVIRONMENT-GUIDE.md` ("Song-shape rules").
3. **Moods** (`js/kit/moods.js`, `K.Moods`) for the 12 Radiohead-set worlds (24-35): 2-4 section-crossfaded states each; see the guide's "Moods" section. The other 24 worlds only get the shared shape (framing, fog, weather) for now.

Rulings worth knowing: `motionCheck` builds its own audio (SongShape + a real ShowControl); with `audioPushesLook` on, the combined fog scale can pass ±25 % (the shape factor alone is clamped); drop FOV punch is 0.3 s but scaled by Feel, so it's ~0 at Gentle; Ember Vigil's once-a-bar bell camera kick is off at Gentle; mood gates multiply the `k` fed into `stage()` rather than its output; reframe ticks even at k = 0 or Conductor off (calm is not still); integrating phases (monoliths, Cold Base cloudDrift, Station Deck uvOffset) changes Punchy very slightly and removes a phase-jump bug.

- **Verified (pane):** all node tests, `motionCheck` numbers (Gentle `maxAccel` ≤ 0.01 for the styles except those listed below), draw / triangle budgets, Conductor-off identity (shape neutral, moods `base`), and the demo track's sections driving moods and shape.
- **Not verified:** feel with real band songs in a visible window; true fps / `?bench`; Gentle-vs-Punchy screenshots for most Phase 2 styles (hidden pane, so checked by reading the code). Run `motionCheck` with the loop idle (it advances `P.time` and doesn't restore `styles.cur`).

Open items for you to decide or check:
- **Neon Circuit:** its camera path's own kinks give a Gentle `maxAccel` of about 0.045 at 30 u/s, not caused by beats (0.0023 at k = 0). Smoothing the track would change its look.
- **Kit demo (hidden):** a one-off 0.069 DollyRig spike. Check whether close framing (which lowers `heightOffset`) and the hard ground clamp interact.
- **Before Dawn** needs about 24 s to reach the field (its own speed limit), so a short drop gets only just outside.
- **Still Pool's** existing sub-surface dip now happens only in groove (still / gather / full stay above).
- **Dream Journal's** wallpaper still flips per beat at Gentle: it's a dither crossfade of a texture, so it was left.
- The **ripple-gate snippet** is copy-pasted in about 5 styles: a candidate for a kit helper.
- Smaller deferred notes: Medium is probabilistic in salt-flat / back-road-lights (`random() < beatMotion` per beat); Backrooms and Route Nine show small `motionCheck` blips from their own grid turns / world wrap; Moth Lamp's extra camera damp lags its flood pull-in even with the Conductor off.

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
- **Camera smoothness** (`js/dev/motion-check.js`, dev only): steps a style by hand with synthetic audio (a beat every 0.5 s,
  scripted Conductor sections) fed through a real `ShowControl`, and returns the largest eye acceleration and FOV step:
  ```js
  const { motionCheck, motionCheckRig } = await import('/js/dev/motion-check.js');
  await motionCheck(viz, { index: 6, frames: 1440, reactivity: 0,   // 0 Gentle, 1 Punchy
    sections: [['groove', 6], ['build', 6], ['drop', 6], ['breakdown', 6]], bpmToggleAt: 10 });
  // → { maxAccel, maxFovStep, frames, maxAccelAt, maxFovStepAt }
  ```
  Gentle target: `maxAccel` ≤ 0.01 units/frame², `maxFovStep` ≤ 0.3°. Extra options: `k`, `bpm`, `shape: { close: 1 }`
  (forces `audio.shape` fields, e.g. to check framing extremes for clipping; then `renderer.present()` and screenshot),
  `present`, `warmup`. `motionCheckRig(rig, opts)` measures a bare kit rig no style uses yet. Seed `Math.random` for
  repeatable numbers. `maxAccelAt` is the frame of the worst spike (after the 30 warm-up frames).

## Building a wave of environments

1. Check `git branch` for leftover `claude/env-*` branches first.
2. Write a spec with one row per environment: NAME, FILE / CLASS, PORT, CONCEPT (idle / swell / beat / bass / highs), palette
   hint, three test palettes. See the wave 4 and 5 specs.
3. One `start_session` per environment (`initiation: user_asked`, `use_worktree: true`, fresh context). **Background** (adapt):
   > Vaporstation is a live audio-reactive visualizer for a friend's band: a static WebGL2 web app (no build step, no
   > dependencies) with an authentic PS1 look (320x240, vertex jitter, affine textures, dithered colour, heavy fog), shown
   > fullscreen at gigs. A play/silent state machine drives one 0..1 `intensity`; a CLUT palette system recolours any
   > environment; a world kit (`js/kit/`) and 37 environments exist. Environments evoke the mood of late-90s games but must
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

**Landed (2026-11-23): projector output + operator view**
- Optional second window (`output.html`, W key / Show card / MIDI `output`) with only the picture; laptop shows the operator
  view. Code: `js/show/output.js` (sink / window), `output-logic.js` (frame guard, health, screen pick; `node tools/test-output.mjs`),
  `operator.js`, `output-page.js`. Spec + plan: `docs/superpowers/specs/2026-11-23-projector-output-design.md`.
- `kiosk.bat dual` → `?kiosk&dual` (operator view + "Open projector output", cursor visible; the output mode is saved with the settings, but kiosk sets it
  from the URL on every launch, so plain `kiosk.bat` stays single), `--disable-popup-blocking`,
  and `tools/grant-window-management.js` pre-grants window-management in the kiosk profile. Plain `kiosk.bat` unchanged.
  The projector opens by itself 1.5 s after load (only with `&dual`; skipped if an existing projector reattached, so a
  reload never reloads it; blocked -> the big button). The operator's one click is on the projector for fullscreen (Chrome
  refuses it from the opener; `--kiosk` does not make the popup fullscreen). Details in the spec.
- Self-test has an INFO "Projector" line (screens, window-management permission; never prompts).
- Either window's rAF drives the frame (guard), reload reconnects automatically, "no input" turns red only after 3 s gone.
  Single-mode CPU +0.025-0.065 ms/frame vs before, fps unchanged; the operator view with the projector open about +0.085 ms.
- Final review fixes: attach always syncs the watchdog cover (a reload under it left the projector fogged), the frame guard
  hands the lead back to the projector after a hitch the laptop covered (also when the laptop runs faster: one
  skipped projector frame per hitch), operator view above the laptop fog cover,
  projector cursor hidden only in fullscreen, grant script never overwrites an unreadable Preferences file.
- Verified (pane + real Chrome, one 1080p display): single mode, ?kiosk&dual operator view, popup opens / is guarded,
  pre-grant makes the permission state "granted", kiosk.bat command lines (dry run), auto-open on fresh start, reload reattach without a second window, reload while the cover is on (context lost, no
  restore, watchdog reload: projector reattaches and the fog clears; also cover(false) missed while marked lost),
  operator view + red "graphics reset" above the laptop fog. Projector hitch, then hand-back: node test only (7 rate pairs x 5 phase offsets) (both windows
  share one thread, so a projector-only hitch can't be made in Chrome). **Not verified:** true fullscreen
  and placement on a real second screen, pulling the HDMI cable, real MIDI opening the projector, the input-gone red
  with a real interface, operator view readability from 2 m, `?selftest` and `?bench` on the gig laptop with dual on.

**Phase 5 remaining:** run the not-verified checks on the gig laptop (kiosk.bat for real, Scarlett unplug / replug, a
pre-show check there).
