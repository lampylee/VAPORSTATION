# Relight: point lights in six older styles (design)

## Intent

Kit v6 gave the pipeline up to four per-vertex point lights (`r.setPointLights`), and so far only Ember Vigil uses them.
Most older styles fake their light with additive decals and glows, which never reach the walls, props or figures nearby.
This pass gives six styles whose light *is* the subject real local light that moves with the music. The user picked "deep
pass on six" over "light touch on all twelve".

**Goals**
- In each of the six, the lamp / candle / panel / beacon visibly lights the surfaces around it, and that light follows the
  music the way the style's existing glows already do (same levels, same `Stager` order, same flicker).
- No pops: a light entering or leaving the four that the pipeline can hold fades; nothing snaps on or off.
- Stay inside the budget (≤150 draws, ≤20k tris). Point lights cost no draws or tris; finer floors and walls cost tris.

**Non-goals**
- No reflections in this pass, and no new post effects.
- Second-tier styles (Ashfall Town, Quiet House, Arcade, Station Deck, Back Road Lights, Under the Hull) wait for later.
  They will use the same helper.

**Anti-goals**
- A style that loses its character: the existing decals, halos and glows stay, and the point light adds to them.
- Lighting that flickers on the kick (continuous light follows levels / `energy`; beat flares go through `audio.accent`).
- Light popping as the camera walks down an endless hall.

## Approaches

1. **Deep pass on six** *(picked)*: a nearest-lights helper, finer meshes where the light lands, and music-driven light in
   each scene, all verified one style at a time.
2. Light touch on twelve: one light per source and no mesh work. Faster, but on coarse floors it barely shows.

## New kit piece: `K.LightSet` (`js/kit/lights.js`)

`new LightSet({ max = 4, soft = 0.4 })`
- `begin()` clears the candidates for this frame.
- `add(pos, color, radius, level = 1)` adds a candidate (values copied into a pool; no per-frame allocations).
- `apply(r, focus)` scores each candidate as `level × max(0, 1 − dist(focus, pos) / (radius + reach))`, keeps the best
  `max` and fades each kept one by how far its score is above the first one left out:
  `fade = smoothstep(0, soft · score, score − scoreLeftOut)`. The 4th and 5th are equal at the moment they swap, so both are
  dark then and nothing pops. It then calls `r.setPointLights`. `focus` is usually a few metres ahead of the eye.

## The six

| Style | Lights | Mesh work |
|---|---|---|
| **Night Manor** | candelabras, sconces and chandeliers, at their current `_candleOn` levels and `_flick` flicker; chandelier lights swing with the chandelier | finer floor, walls and carpet for the nearest pairs (fine mesh near the camera, the current one farther out) |
| **Before Dawn** | the bedside lamp (`this.lamp`), which brightens with the ignition, and a faint spill through the window onto the field | room walls, floor and bed subdivided (they're single boxes now) |
| **Moth Lamp** | the lamp head, swelling to the flood; it lights the post, the fence and the ground | none (terrain is fine enough for a wide light) |
| **Fog Harbour** | the six dock lanterns at their `level`, the swinging pier lamp included; the reflection picks them up | finer wharf deck if it is coarse |
| **The Backrooms** | the nearest panels at their `panel()` brightness (flicker, dead ones sputtering, the beat buzz) | none (floor is 1.5 m cells); check walls |
| **Cold Base** | the alarm beacons as lights that sweep round with the beam, and searchlight pools lighting what they pass over | hut, hangar and crate walls subdivided |

## Verification

For each style: idle and full intensity, the swell between, Gentle and Punchy Feel, two other palettes, `dispose()`, draws /
tris against the budget. Then the all-styles smoke test (every style renders cleanly and within budget) and a check that
untouched styles are unchanged. Screenshots before and after for the user.

## Build notes (2026-11-23)

- **LightSet changed from the design.** Fading by score gap (as designed) left only one light lit in dense sets: 39 candles
  in the manor hall have near-equal scores, so the gap to the 5th is tiny for most of the top 4. It now uses 4 sticky slots
  with time fades (`fade` s): wanted lights fade up, a light leaving the set fades out, and only then is its slot reused.
  `add` takes a stable `id` and `apply` takes `dt`.
- **Night Manor:** candelabras (radius 6), sconces (4) and chandeliers (11, swinging with the ring) at their existing
  `_candleOn` / `_flick` levels. The 3 bay pairs ahead of the camera use a finer floor / carpet / wall mesh. 25–29 draws,
  16–17.6k tris.
- **Before Dawn:** the lamp (radius 3.9, `lamp` × 3.6) lights walls, bed and curtains; room boxes subdivided. The window
  spill onto the field was dropped: the terrain's 5 m cells can't show it. 9.8–10.4k tris.
- **Moth Lamp:** one light at the head (radius grows with the pool and the flood). It warms the post and fence; the ground is
  near-black and its pool was already faked well, so the gain here is small. A finer terrain (+6k tris) did not change that
  and was reverted.
- **Fog Harbour:** the six lanterns through a LightSet; a subdivided deck top over the wharf boxes. The reflection picks
  the light up (the pipeline mirrors light y). 13.3–14k tris.
- **The Backrooms:** panels within 13 m are candidates at their `panel()` brightness (flicker, sputter, beat buzz); walls
  get 3 rows instead of 2, and the flat ambient went down from 0.86 to 0.72 so the tubes carry the light. 13.6–15k tris.
- **Cold Base:** two red lights per beacon, 2.4 m out along each beam, swing round with it; searchlight pools add a cold
  light 3 m above where they land. Huts and the radar hut subdivided, hangar arches split along their length. 13.5–15.6k tris.
- Checked: idle and full intensity, Glacier and Blood Moon palettes, dispose + re-init, all 40 styles clean and in budget.

## Left to the builder

Light colours (from palette roles / ramps), radii and strengths, exact subdivision, which secondary sources in each style get
a light.
