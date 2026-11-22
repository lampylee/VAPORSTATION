# Ember Vigil: design

## Intent

A showpiece environment: the highest-fidelity dark fantasy scene Vaporstation can do inside its PS1 limits. The mood is 80s
dark fantasy and dungeon-synth album covers, with the ruined grandeur and lonely bonfire calm of the Souls games. The user's
bar is "wow me". Built by one agent (no fan-out), with whatever new kit pieces it needs, made properly and documented.

**Goals**
- A cinematic, layered composition: close-up warmth (knight + fire), mid-ground grandeur (the nave), a far album-cover vista
  (the keep under the moon) seen through a shattered rose window.
- Light that feels real at 320×240: fire that actually lights the stone and armour around it, moonbeams, candlelight.
- A long, readable build from a lonely vigil (idle) to a storm-lit apocalypse (full intensity), with a peak reveal.

**Non-goals**
- No new post effects, no bloom or smooth gradients (pipeline rules).
- No loaded models: everything procedural, indexed, recolourable.

**Anti-goals (a failure even if it works)**
- Anything recognisable from a real game: no coiled-sword bonfire, no named bosses, no copied armour sets, no logos.
- Flat lighting where the fire doesn't touch its surroundings; a scene that reads as "grey boxes in fog".
- Pops: candles, windows, lightning or the colossus snapping on.

## Approaches considered

1. **Ember Vigil:** cathedral interior, knight at a fire, eclipse in the rose window, colossus at the peak.
2. **The Black Keep:** a flight along a cliff road to a castle under the moon (album-cover exterior).
3. **The Abyss Stair:** a descent into a chasm toward a chained colossus and a rune gate.

**Picked (the user left it to me): a blend of 1 and 2.** The interior gives grandeur up close and the fire light; the keep
seen through the broken rose window gives the album-cover vista, and the swell has two layers (candles inside, keep windows
outside). 3 was dropped: claustrophobic, and it overlaps Underriver / Drowned Ruins.

## The scene

Name **Ember Vigil**, `js/styles/ember-vigil.js`, class `EmberVigil`.

Camera space: a ruined nave runs from the camera (+z) to the apse (−z, ~40 m). Near the camera, in the second bay:

- **The knight** kneels on one knee before a small **fire** in a ring of broken masonry, both hands resting on the pommel
  of a greatsword driven point-down into the flagstones beside him. Ragged cape, helm bowed. Low-poly 3D (~600 tris),
  flat-shaded, lit by the fire.
- **The nave:** flagstone floor (subdivided so vertex lighting is smooth), clustered gothic piers down both sides (some
  broken off, one toppled across the aisle), pointed arcade arches between them, ashlar side walls with lancet windows
  letting in thin moonbeams. Ribbed vault intact over the first bays only; beyond it the roof is gone and the sky shows
  through broken ribs. Tattered banners hang from a few piers. Rubble, fallen blocks with candle clusters on them.
- **The apse:** a huge **rose window**, tracery partly shattered (seeded missing petals), glass glowing faintly.
  Through it, outside:
- **The vista:** a gorge, a jagged crag, and on it **the Black Keep** (tall towers, spires, crenellations, lit windows);
  a huge pale moon that becomes an **eclipse** (dark disc, glowing corona) as intensity rises; crows circling the towers.
- **At the peak:** a **colossus** silhouette (horned, crowned, hollow-eyed) rises slowly behind the keep, eyes kindling.

## How it moves with the music

| | Idle (k = 0) | Swell | Full (k = 1) |
|---|---|---|---|
| Fire | low, breathing flicker; lights knight + nearby stone | grows taller and brighter | roaring; beat = ember burst + light flare |
| Candles | a few guttering near the fire | light front to back down the nave (`Stager`) | every cluster lit to the apse |
| Keep | dark silhouette, one window lit | windows light floor by floor (`Stager`) | fully lit, crows circling faster |
| Sky | pale moon, faint shafts through lancets / rose | moon slides into eclipse, corona brightens | eclipse; lightning behind the keep on strong bars |
| Camera | slow, close orbit round knight + fire | pulls back and rises | wide reveal of nave + window + keep |
| Air | sparse ash drifting through the roof | heavier ash, dust motes in beams | ash storm; bass bar = dust shaken from the vault |
| Peak | — | — | colossus rises behind the keep (`stage(k, .75, 1)`), eyes glow; slight jitter boost |

Beats: ember bursts (scaled by `audio.accent`), point-light flare. Bass: once per bar at higher k (`BarClock`), a "bell toll"
shake: dust gust from the vault plus a tiny camera nudge (by `audio.motion`). Highs: candle and fire flicker, armour glints.
Lightning: at most once per bar above k ≈ 0.6, via `BarClock` + strong beat; sky flash and bolt, never a strobe.
Everything continuous follows `energy` / smoothed bands, never the kick directly.

## New pieces (kit and pipeline)

**Pipeline (the fidelity headline): per-vertex point lights.** `r.setPointLights(list)` with up to 4 lights
`{ pos, color, radius }`, evaluated per vertex in the world shader (Gouraud, like PS1 torch lighting), added to the
directional + ambient term, with a smooth falloff. `beginScene` resets the count to 0, so every other style renders exactly
as before (pixel-diff check). Unlit / additive draws ignore it.

**Kit additions** (all documented in the guide's table):
- `props.gothicPier(height, radius, {shafts, broken})`: clustered column with base and capital; `broken` = jagged top.
- `shapes.roseWindow(radius, {petals, rings, depth, missing})` → `{ tracery, glass }`: stone tracery + glass disc.
- `props.keep({seed, towers, height})` → `{ geo, windows: [{x, y, z, floor}] }`: castle silhouette builder (towers, cone
  spires, crenellations, curtain wall) with window positions for glow sprites.
- `props.knight({pose: 'kneel'})` → `{ body, cape, sword }`: low-poly armoured figure; the cape is separate so it can sway.
- `Fire(r, {scale})`: layered animated flame cards, core glow, ember particles, ground light pool; exposes `.light`
  (0..1 flicker) and `.pointLight()` to feed `setPointLights`.
- `Candles(r, {max})`: instanced sticks + flames + halos with per-candle level (pairs with `Stager`).
- `Lightning(r)`: jagged bolt strips regenerated per strike, `.strike(from, to)`, `.flash` (0..1) for sky brightening.
- Textures: `tex.flagstones()`, `tex.ashlar()`; sprites: `sprites.tatteredBanner({ramp})`, `sprites.colossus()`,
  `sprites.corona()` (eclipse ring).

## Budget plan

Target ≤ 70 draws and ≤ 14k tris at full intensity, leaving headroom.
Rough: floor 2k, piers 2k, arches 1k, walls / vault 1.5k, rose window 0.8k, keep + crag 2.5k, knight 0.6k, candles 0.5k,
sprites / particles small. Stretch goal if the budget holds: a shallow flooded strip before the apse with a planar
reflection of only the window, keep glow, fire and candles.

## Palette

`fromKeys('ember-vigil', 'Ember Vigil', [stone '#8a8496', iron / cloth '#6b4a3a', ember '#ff8a3c', night '#141428'])`, with
`glow` and `flash` on the accent ramp. Check with at least three other palettes (one light, one cold).

## Verification

Idle and full intensity, the swell between, Gentle and Punchy Feel, three other palettes, `dispose()`, a crossfade in,
`?bench` (visible tab, expect ~120 fps here), and a pixel-diff of a few existing styles before / after the point-light
pipeline change (must be 0%). Screenshots of idle, mid and peak for the user.

## Left to the builder

Exact proportions, colours within the palette, camera path tuning, texture details, how many piers / candles, whether the
stretch reflection fits.

## Build notes (2026-11-22)

Built as designed. The stretch goal (a flooded strip before the apse with a planar reflection) was not built; the budget
would allow it (39 draws / 15k tris at full). Measured: 120 fps (display cap) on the dev laptop, worst frame 8.9 ms.
