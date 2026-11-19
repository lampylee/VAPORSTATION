# Handoff — state as of 2026-11-19

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
| 3: environment library | **done: 12/12 merged** (wave 1 + wave 2) |
| 4: UI pass, MIDI, tap tempo, overrides | not started |
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

Number keys only reach 0–9; indices 10–16 are reachable via **N / Shift+N**, the dropdown, auto-switch, or a setlist song (setlist mode reaches every environment). An environment browser is still a Phase 4 item.

### Verified vs. not verified

- **Verified (in the Claude browser pane):** every style at idle and at full intensity with synthetic audio, no GL/console errors, within budget, crossfades, palette swaps, album-art extraction, hex/GPL import, editor save, GLB loader on a hand-built model, demo-track state machine timeline.
- **Not verified yet:**
  1. **`?bench` real fps.** The Claude pane is hidden during agent work, which pauses `requestAnimationFrame`. Run `http://localhost:8080/?bench` in a **visible normal Chrome tab** and leave it ~1 min; results print via `console.table` and `window.benchResults`.
  2. **Live input with the Scarlett 2i2.** The Claude pane blocks the microphone. Test in real Chrome: pick device → Start live input → check the threshold meter during soundcheck.
  3. **The gig laptop itself** (perf, fullscreen, sleep settings).

## Open items (rough priority)

1. Run `?bench` + Scarlett live test in real Chrome (5 minutes, unblocks confidence).
2. ~~Kit v2 pass~~ — done, see below.
3. ~~Wave 2 environments~~ — done: built in six parallel sessions, merged 2026-11-19 (smoke-tested at k=0/1 + crossfades; real-fps `?bench` still pending, see item 1). Their reports list suggested kit additions (Kit v3).
4. ~~Setlist mode~~ — done 2026-11-19 (`js/setlist/`): songs pick a palette + an environment pool; PageDown/→/] next, PageUp/←/[ prev, S toggles; while playing, Next cues the song until silence (press again to force). Verified in the pane: stepping/cue logic, editor, import, persistence. **Not verified:** a real USB footswitch (check which key it sends; add it in `main.js` if it isn't one of those). Also fixed a manager bug where a style queued mid-crossfade was rendered once before its first `update()` (crashed Cold Base / Arcade for one frame).
5. ~~Housekeeping~~ — done 2026-11-19: all twelve `claude/env-*` branches and worktrees deleted, the twelve environment sessions archived.
6. Add a GitHub remote and push, so work is backed up off this machine.
7. Phase 4 (UI pass with the `frontend-design` plugin, MIDI, tap tempo, manual overrides), then Phase 5.

## Kit v2 — done (2026-11-19)

All starred items below are in the kit, documented in `docs/ENVIRONMENT-GUIDE.md` and exercised by `js/styles/kit-demo.js`:
`r.updateTexture`, `texture2`/`blend` dither-crossfade, instance tilt (`rotX`/`rotZ`, billboard spin), draw `fade` (lights through fog), `K.xf`/`K.Frame`/`props.rotX/Y/Z`, `K.PathFrames` (+ `sweep`, `placeEvery`, `PathRig` `rollFn`), `K.roadStrip`, `K.forSegments`, `K.scatter`, `K.orientedBox`, `Sky` `moonTexture` + `sprites.moon`, `K.NeonText`/`K.textTexture` (full 5x7 font).
Also promoted: `K.Pendulum` (soft limit), `K.fadeOut/fadeIn`, pixel helpers (`makeIndexed`, `dshade`, `bayer`, `rnd`, `blobNoise`, `ditherPick`), `pointedArch`/`pointedCurve`/`lancet`/`vault`, `chain`, `flatPoly`, `decal`, `quadFacing`, `atlasUV`, sprites `fern`/`kelp`/`cactus`/`lightShaft`; negative `heightScale` flip is documented.
Ashfall Town now uses `r.updateTexture`; the other wave-1 styles keep their local copies (working code, not worth the churn).
**Not promoted** (still local, candidates for Kit v3): caustic flipbook overlay, fish/boid schools, direction-aligned streak particles, light strips with travelling pulses, scrolling waterfall texture, moss stone / cliff rock / jungle floor textures, texture-atlas box faces.

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
