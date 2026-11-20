# Radiohead setlist environments — design

Date: 2026-11-20 · Status: approved; album palettes added and signed off 2026-11-20, waves not started

## Intent

The band's coworker sent a 12-song Radiohead set. Each song gets its own new Vaporstation environment, built from the song's lyrical or album themes, and coloured by a palette for the album the song comes from. At the gig the setlist steps song to song, and each one shows its own world in its album's colours.

## Goals

- 7 shared **album palettes** in the palette library, one per album source.
- 12 **new environments**, one per song, each using its album's palette as its own palette.
- A **setlist** for the 12 songs in set order, each song pointing at its environment, with palette set to "style palettes" (`''`).

## Non-goals

- Reskinning existing environments. The user chose all-new builds, even where an existing one is close (Aurora Field, Drowned Ruins, Moonlit Shallows, Route Nine).
- Changes to the pipeline or the kit. Anything missing gets implemented locally in the environment and listed as a suggested kit addition, as in past waves.

## Anti-goals (fails even if it technically works)

- Recreating album covers, music-video imagery (for example, Karma Police's car on a night road), band logos or any other copyrighted art. Only the *colour mood* of each album is borrowed.
- Lyrics shown on screen in any form.
- Anything that breaks the hard rules in `CLAUDE.md`: hard cuts, black or frozen idle, hard-coded RGB, per-style post effects, or blowing the budget (≤150 draws, ≤20k tris).

## Constraints

- All the usual `CLAUDE.md` and `docs/ENVIRONMENT-GUIDE.md` rules apply.
- **Prerequisite:** no uncommitted changes on `main` before any build session starts, because worktrees are cut from the last commit and the new environments build on the kit as committed. The Feel (reactivity) work landed as `4afc198` and was reviewed on 2026-11-20. The remaining `js/kit/props.js` `tiles()` change and the Greenhouse Dusk floor fix are reviewed and go in (or get dropped) on the user's say before wave 4a.
- **Feel (Gentle / Medium / Punchy):** Gentle is the default. Every environment is checked at Gentle **and** Punchy, drives big continuous things from `audio.energy` or smoothed bands (not raw `bass`), and scales hand-rolled beat reactions by `audio.accent` / `audio.motion` / `audio.decay`, per the environment guide.
- Before starting a wave, check `git branch` for leftover `claude/env-*` branches (see HANDOFF, wave 3 note).

## Approaches considered

1. **Shared album palettes first, then two waves of six environment sessions** — *chosen.* One small commit adds the palettes to `js/palette/library.js`. Each environment imports its album palette, so the four OK Computer songs (and both Amnesiac and both In Rainbows songs) share one source of truth, the setlist can use "style palettes", and an album's colours can be tuned in one place.
2. **Each environment carries an inline copy of its palette** (the wave 1–3 pattern). Simpler sessions, but duplicate palettes drift apart and the setlist can only use one copy. Rejected.
3. Album palettes pulled from the real covers with the in-app album-art extractor. Truer colours, but needs the cover images. Not chosen for now; the hand-picked keys below can be swapped later without touching any environment.

## Step 1 — album palettes

Add `export const ALBUM_PALETTES = { … }` to `js/palette/library.js`, and spread it into `BUILTIN_PALETTES` so the palettes show up in the palette strip, P/O cycling and the setlist editor. Environments import it the way Fogway does with `STYLE_PALETTES`: `static palette = ALBUM_PALETTES.okc;`.

Keys are `[base, secondary, accent, atmosphere/fog]` for `fromKeys`. These are first-pass picks (my call) and get tuned by eye in the browser.

| id | Name | Keys | Mood |
|---|---|---|---|
| `bends` | The Bends | `#c8b49a`, `#6aa8c8`, `#f0f4f8`, `#1c3448` | bleached skin tones, clinical pale blue, white, washed blue haze |
| `okc` | OK Computer | `#b8bcc0`, `#58a8c0`, `#d8e070`, `#1a2430` | cold off-white and grey, motorway cyan, sickly pale yellow-green glow (ties to No Surprises' green fog), cold fog |
| `kida` | Kid A | `#dce8f0`, `#4a6a8a`, `#f05a1e`, `#141a22` | glacier white, ice blue, scorched red-orange, black |
| `amnesiac` | Amnesiac | `#7a2a2a`, `#d8c8a0`, `#e04040`, `#24140e` | maroon and oxblood, aged cream paper, red, sepia-black |
| `inrainbows` | In Rainbows | `#a83a2a`, `#3a8a4a`, `#f0b020`, `#08080a` | paint-drip red, green and ochre on near-black |
| `amsp` | A Moon Shaped Pool | `#9a9a98`, `#d8a0a8`, `#e8eef4`, `#16181c` | smeared greys, muted pink, blue-white, black |
| `tkol` | The King of Limbs era | `#8aa86a`, `#e8d88a`, `#f4f4ea`, `#2a3640` | pale greens, soft yellow, washed white, blue-grey fog (for Daily Mail, a 2011 single from that era; user's choice) |

Done when each palette is checked against two existing environments (one dark, one light) and reads as its album. **Gate: the user signs off on all 7 palettes before wave 4a starts.** Show each on a couple of existing environments (screenshots), apply their tweaks, commit, then start the waves.

## Step 2 — environments

Built with the wave-2 session template in `docs/HANDOFF.md`: one fresh session per environment, `use_worktree: true`, cut from `main` after step 1 is committed, own port and gitignored `.claude/launch.json`, same rules (new file + one registry line only), same verify and report. The template's palette line becomes "use `ALBUM_PALETTES.<id>`" instead of an inline palette. Merge with the HANDOFF registry-regeneration loop, then smoke-test everything at k=0/1.

**Wave 4a (slow songs, copy `kit-calm.js`):** No Surprises, Exit Music, Pyramid Song, Nude, Decks Dark, All I Need.
**Wave 4b (copy `kit-demo.js`):** Karma Police, Subterranean Homesick Alien, High and Dry, You and Whose Army?, Daily Mail, Everything In Its Right Place.

| Song | NAME | FILE / CLASS | Palette | Concept |
|---|---|---|---|---|
| No Surprises | Quiet House | `quiet-house` / `QuietHouse` | `okc` | A tidy small house and garden at dusk, slow fixed framing. **Idle:** still, soft light in one window. **Swell:** the fog slowly shifts toward a faint, wrong green (dither-blend toward secondary/atmosphere), more windows glow. **Beat:** small light twinkles (glockenspiel feel), one soft event per beat at most. Deliberately the least reactive scene in the set. |
| Karma Police | Searchlight Town | `searchlight-town` / `SearchlightTown` | `okc` | A flat grid of tiny houses at night seen from above at an angle; one searchlight sweeps across it. **Swell:** more searchlights wake, the sweep tightens. **Beat:** the beam snaps and flares. **Peak (outro distortion):** geometry wobbles and melts (extra vertex jitter / wave displacement scaled by intensity), then settles back. No car or road imagery. |
| Exit Music (For a Film) | Before Dawn | `before-dawn` / `BeforeDawn` | `okc` | A dark, cold bedroom; the camera drifts back out through the window into a black field. **Idle and most of the song:** almost nothing moves, one faint light. **Swell:** held back until intensity is high, then the whole sky catches fire (accent sky, embers) when the fuzz bass arrives. The design is the intensity curve: keep the bottom 70 % of intensity restrained. |
| Subterranean Homesick Alien | Back Road Lights | `back-road-lights` / `BackRoadLights` | `okc` | A rural field at night with a fence line and one farmhouse; odd lights drift in the sky. **Swell:** more lights, they move with purpose. **Beat:** one light lowers a pale beam onto the grass. Must read as different from Aurora Field (lights are objects, not sky curtains). |
| Everything In Its Right Place | Right Place | `right-place` / `RightPlace` | `kida` | Rows of identical floating blocks that shuffle and snap into new slots, over icy peaks under a red-streaked sky. **Idle:** blocks drift, barely rearranging. **Swell:** more blocks join and rearrange more often. **Beat/bar:** a rearrangement step once per bar. `audio.bar` is the beat within a 4-beat bar (0–3) and only means anything once tap tempo is set, so rearrange when it wraps to 0; without tap tempo, every 4th `beatCount`. |
| Pyramid Song | Underriver | `underriver` / `Underriver` | `amnesiac` | The camera sinks slowly through dark water toward a riverbed full of stars, with drifting pale figures (sprites) and lights. Uneven time signature: motion is continuous swells (`K.Breath`, bass level), **not** beat-locked. Must read as different from Drowned Ruins (no ruins; it's stars and figures). |
| You and Whose Army? | Paper Crowd | `paper-crowd` / `PaperCrowd` | `amnesiac` | A dim maroon hall full of rows of flat paper cut-out figures, one lit microphone on a stand. **Idle:** the figures lie flat or slump, mic glows faintly. **Swell:** figures rise row by row (staged from front to back) as the band and piano build. **Beat:** a ripple through the rows. |
| All I Need | Moth Lamp | `moth-lamp` / `MothLamp` | `inrainbows` | A single streetlamp in a black field with a swarm of moth particles circling it. **Idle:** few moths, dim lamp. **Swell:** the swarm thickens and tightens. **Peak (final crescendo):** light floods the scene (lamp glow and ground light near max, fog lifts toward a light shade). |
| Nude | Still Pool | `still-pool` / `StillPool` | `inrainbows` | A dark water surface seen from just above it, a few reeds or stones at the edge. **Bass:** rings ripple out (`K.Ripples`). **Swell:** the camera sinks very slowly toward and below the surface. Must read as different from Moonlit Shallows (closer, darker, no moon-on-lake vista). |
| High and Dry | Salt Flat | `salt-flat` / `SaltFlat` | `bends` | A bleached salt flat with heat shimmer, a lone dead roadside sign, cracked hexagonal ground, slow drift toward the horizon. **Swell:** shimmer and wind-blown salt grow, the drift speeds up a little. **Beat:** a soft dust pulse. Must read as different from Route Nine (no road, no traffic). |
| Decks Dark | Under the Hull | `under-the-hull` / `UnderTheHull` | `amsp` | A small grey town; an enormous dark shape slides slowly overhead, blotting out the sky. **Idle:** the shape is far off, sky open. **Swell:** the shape is overhead, fog darkens, town lights come on. **Beat:** a faint pulse of light along the hull's underside. Original shape, not a recognisable ship design. |
| Daily Mail | Newsprint | `newsprint` / `Newsprint` | `tkol` | Towers of dithered paper stacks with loose pages drifting down like birds. **Idle / quiet piano opening:** a few pages float. **Swell (the band explodes in):** pages whip into a storm around the camera, the stacks sway. **Beat:** gusts. No readable text, headlines or mastheads. |

## Step 3 — setlist

After the merge, add the 12 songs in set order (No Surprises → Everything In Its Right Place, as listed above starting with No Surprises, Karma Police, High and Dry, All I Need, Decks Dark, Nude, Pyramid Song, Exit Music, Subterranean Homesick Alien, You and Whose Army?, Daily Mail, Everything In Its Right Place), each with palette `''` and a one-environment pool. Delivered as a setlist JSON in a new `setlists/` folder, in the format `downloadSetlist()` in `js/setlist/setlist.js` writes (`{format:'vaporstation-setlist', name, songs:[{label, palette, styles:[styleKey]}]}`, where `styleKey` is `meta.key` or the class name), so it can be imported at the venue.

## Left to the builder

- Exact meshes, textures, camera rigs and kit helpers per environment.
- Ports for parallel sessions (pick unused ones).
- Final palette shade tuning in the browser, within the moods above.
- Suggested kit additions, reported as in past waves.
