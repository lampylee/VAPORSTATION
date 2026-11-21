# Wave 5 — public-domain horror set (design, 2026-11-21)

## Intent
More variety in the auto rotation: nine horror environments drawn from public-domain
classics. Not tied to a show or setlist. Same PS1 pipeline, same palette system, same budgets.

## Goals / non-goals / anti-goals
- Goals: nine distinct, readable horror scenes; each has a slow "reveal" that grows with intensity.
- Non-goals: jump scares, gore, story/sequence, new kit or pipeline work (local code only, report kit suggestions).
- Anti-goals: anything that hard-cuts or strobes; anything that copies a protected film design
  (Universal's 1931 Frankenstein make-up with flat head and neck bolts, Lugosi-style Dracula,
  Universal's Wolf Man, the Hammer/Universal mummy looks); copying the original Backrooms photo
  (it is someone's photograph: build our own yellow rooms); overlap with Night Manor (gothic hall)
  or Graveyard Hill (cemetery) or Drowned Ruins (underwater temple).

## Source rule
Design from the public-domain texts: Lovecraft's *The Call of Cthulhu* (1928), *The Colour Out of Space* (1927),
*The Shadow over Innsmouth* (1936, treat as a mood source only: original town, no named places),
Shelley's *Frankenstein* (1818), Stoker's *Dracula* (1897), folk werewolf lore, generic Egyptian-tomb mood
with **invented** glyphs (no real hieroglyph texts), *Nosferatu* (1922 film, US public domain).
Use original environment names.

## Approaches considered
1. **One session per environment in parallel worktrees (chosen).** Proven in waves 1–4: one file + one registry line per
   branch, merged with the registry-regeneration loop, smoke-tested together.
2. Build them sequentially in this session: slower, burns one context, no benefit.
3. Extend the kit first (creature rig, lightning) then fan out: speculative; earlier waves showed local code + reported
   suggestions works better, with a kit pass after.

## Shared horror guidance (for every session)
- The monster/reveal is driven by intensity through `K.Envelope`/`K.fadeIn`/`opacity` or slow rise, never a pop.
  At k=0 it is absent, submerged, hidden in fog or barely a silhouette; the scene still looks good.
- Lightning or arcs: soft palette `flash` role pulses gated by the beat limiter, no full-frame white; respect Feel (`audio.accent/motion/decay`).
- Creatures are low-poly merged meshes or silhouette sprites (chain() for tentacles/limbs, K.Wobble for writhing); keep within 150 draws / 20k tris.

## The nine

| NAME | FILE / CLASS | PORT | CONCEPT | PALETTE-HINT | TEST-PALETTES |
|---|---|---|---|---|---|
| **The Sleeper Rises** | `sleeper-rises` / `SleeperRises` | 8119 | Stormy open sea at night; a drowned city of wrong-angled, leaning green-black stone (tilted monoliths, impossible stairs, a huge sealed door) breaks the surface. A colossal winged, octopus-headed figure (squid-like face of tentacles, scaly body, small wings, per Lovecraft's description; original design) sits as a dark silhouette under / behind the city. Camera on a slow swell (boat-like bob). **Idle:** calm-ish swell, mist, only the city tops visible, the figure a faint shape in fog. **Swell:** the sea heaves (`wave`), the figure slowly rears up behind the city, wings unfold, face tentacles writhe (`K.Wobble`). **Beat:** soft lightning pulse in the clouds + a wave crest; **bass:** swell height; **highs:** rain/spray sparkle. | wet black-green stone base, sea teal secondary, sickly green accent (eyes/glow), storm-grey fog | `vapor`, `amber`, `glacier` |
| **Colour from the Well** | `colour-well` / `ColourWell` | 8120 | A withered New England-style farm at night (original): farmhouse, barn, orchard, an old stone well. An unearthly glow (accent ramp only, so every palette gives a different "colour") leaks from the well. **Idle:** dark farm, faint glow at the well rim. **Swell:** the glow spreads in rings through grass and trees (dither crossfade `texture2/blend` from healthy to grey/brittle), trees glow and sway without wind, motes rise, finally a shaft of colour rises from the well into the sky. **Beat:** a ring of colour pulses outward from the well (`Pulses`/`Ripples`); **mids:** tree sway; **highs:** mote sparkle. | grey-brown wood/earth base, dead-grass secondary, the "colour" accent, near-black blue fog | `bloodmoon`, `toxic`, `mono` |
| **Storm Laboratory** | `storm-lab` / `StormLab` | 8121 | The top room of a stone tower in a thunderstorm (original). Rain-lashed windows, a slab under a sheet, copper coils, jars, a rod up through the roof. The creature follows Shelley: very tall, long flowing black hair, yellowed skin, stitched, no bolts, no flat head. **Idle:** candle-lit, rain, the sheet still. **Swell:** coils glow and arc (local arc strips), lightning brightens the windows, the sheet lifts and the figure slowly sits up at high intensity (eases down as intensity falls). **Beat:** an arc jumps between coils + soft window flash; **bass:** coil hum/glow; **highs:** sparks. | stone grey base, brass/copper secondary, electric blue-white accent, dark slate fog | `handheld`, `sunset`, `jungle` |
| **Carpathian Approach** | `carpathian` / `Carpathian` | 8122 | A slow ride up a winding mountain road toward a castle on a crag (original castle silhouette), pine forest, cliffs, one high window lit. From Stoker: blue flames flickering beside the road, wolves' eyes in the trees. **Idle:** mist, snow flurries, the castle half lost in fog, one blue flame. **Swell:** more blue flames along the road, eyes appear in pairs (fade in), bats swarm round the towers, more windows light. **Beat:** a flame flares + bat flock turn; **bass:** wind in the pines; **highs:** snow sparkle. | dark rock base, pine green secondary, cold blue flame accent (castle window warm via light role), deep violet fog | `vapor`, `deepsea`, `amber` |
| **Hunter's Moon** | `hunters-moon` / `HuntersMoon` | 8123 | A moonlit forest clearing under a huge full moon (original). Standing stones or a fallen tree, ferns, ground mist. A hunched shape at the treeline (generic werewolf, original design: lean, digitigrade legs, long snout; not Universal's Wolf Man). **Idle:** still clearing, the shape barely visible, crouched. **Swell:** the moon swells and brightens, the shape rises and straightens, at peak it lifts its head to the moon (howl pose); other eyes glint in the trees; mist rolls. **Beat:** moon pulse + eyes blink; **bass:** branch sway; **highs:** fireflies/mist sparkle. | bark brown base, moss secondary, moon gold-or-silver accent, night blue fog | `bloodmoon`, `glacier`, `handheld` |
| **The Backrooms** | `backrooms` / `Backrooms` | 8124 | Endless, empty office-like rooms (our own version: mono-yellow wallpaper with a faint original pattern, damp beige carpet, drop-ceiling grid with fluorescent panels), irregular doorways and pillars, recycled segments so it never ends. Camera wanders aimlessly at walking height, turning corners. **Idle:** quiet, a few panels dead, slow wander. **Swell:** panels flicker on in runs, the wander quickens and turns more, walls subtly breathe/stretch, distant doorways repeat. **Beat:** a panel run buzzes brighter (soft, limiter-gated); **bass:** hum vibration (tiny jitter); **highs:** flicker sparkle. No figures needed. Must look great in a yellow-ish palette but recolour like any other. | mono-yellow wall base, beige carpet secondary, fluorescent white accent, pale yellow-grey fog | `vapor`, `toxic`, `deepsea` |
| **Sealed Tomb** | `sealed-tomb` / `SealedTomb` | 8125 | A torch-lit stone passage descending to a burial chamber (original). Walls carved with **invented** glyph bands, columns, a painted sarcophagus (original design) at the end, sand on the floor. **Idle:** torches low, dust motes, the lid shut. **Swell:** torches flare in sequence down the passage, sand pours from cracks, the lid slides open a little at a time, a wrapped hand/arm rises at peak (eases back down). **Beat:** sand burst + scarabs scatter (small instanced beetles); **bass:** torch flicker size; **highs:** dust sparkle. | sandstone base, painted turquoise secondary, gold accent, dusty brown fog | `glacier`, `bloodmoon`, `mono` |
| **Fog Harbour** | `fog-harbour` / `FogHarbour` | 8126 | A rotting fishing town at night in thick fog (original town, no names): sagging gabled houses (`props.gableHouse`), a slumped church spire, wharf on stilts, nets, a black reef offshore. Hunched figures shuffle along the docks (silhouette sprites, odd gait). **Idle:** heavy fog, a lamp or two, still water, no figures. **Swell:** windows light up house by house, figures emerge from the fog and gather at the water's edge, shapes break the surface by the reef, the fog glows. **Beat:** a lamp sways + ripple at the reef; **bass:** water heave; **highs:** lamp glints. | rotten wood base, slate secondary, sodium-green lamp accent, grey-green fog | `sunset`, `amber`, `glacier` |
| **Shadow Ship** | `shadow-ship` / `ShadowShip` | 8127 | A derelict sailing ship drifts into a sleeping old port town at night (original ship and town). Torn sails, a lantern, coffins/crates on deck, rats on the ropes. From *Nosferatu*: a long clawed shadow creeping up a stairway wall (drawn as a flat shadow decal with long fingers; original pose). **Idle:** the ship a faint shape in the fog, still water. **Swell:** the ship glides closer, rats pour along the rigging and quay, the shadow climbs the stair wall on the quay and its hand stretches out. **Beat:** lantern swing + rat ripple; **bass:** hull creak (roll); **highs:** water glints. | weathered hull wood base, sail-cloth secondary, plague-red or pale lantern accent, sepia-grey fog | `vapor`, `jungle`, `handheld` |

## Process
- Session prompt: the wave-2 template in `docs/HANDOFF.md`, plus the shared horror guidance and source rule above.
- After all report: merge with the registry loop, smoke-test every style at k=0/1, crossfade chain, update HANDOFF.

## Left to each builder
Exact geometry, camera rig choice, texture design, palette values, local helpers.
