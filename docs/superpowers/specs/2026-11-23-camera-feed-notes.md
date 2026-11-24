# Live camera feed — idea notes (not designed yet)

Status: parked idea (2026-11-23), not an approved design. Agreed order: projector output first (done, merged), then this.
When picked up, run it through brainstorming like the projector output: ask the user first, then approaches, then a spec.

## The idea

A webcam or capture card feeds the pipeline as a texture, so the band appears *inside* the world, PS1 style:

- Cut to a tiny resolution (about 160×120) and mapped onto the current palette (CLUT) with dither, like every texture.
  Every palette then recolours the band too.
- Blocky, video-CD style compression artefacts that grow with the bass (and with `intensity`, as everything does).
- Environments show it on in-world screens, e.g. the arcade cabinets in Arcade After Hours, the TVs in Quiet House,
  the rose window in Ember Vigil.
- Optionally a full-screen layer that fades in for big moments (crossfaded, never a hard cut).

## What it touches (from the code as of the projector-output merge)

- Needs a camera at the gig (the Scarlett is audio only) and camera permission (`getUserMedia({ video })`).
  The Claude browser pane blocks camera / mic: test in real Chrome. `kiosk.bat` already auto-accepts media prompts
  for its own profile (`--use-fake-ui-for-media-stream`).
- The pipeline is in `js/gfx/ps1.js`; textures are indexed (`js/gfx/textures.js`, palette slot per pixel). A live
  video texture needs a per-frame path to an indexed texture (quantise on the GPU in the world shader, or on the CPU at
  160×120), not a new post effect (hard rule: extend the pipeline, no per-style post effects).
- A small, **opt-in** extension to the style contract so a style can say "this surface shows the camera"; styles that
  don't opt in are unchanged.
- Budget: ≤150 draws, ≤20k tris, 60 fps; one 160×120 upload per frame is cheap, but check on the gig laptop.
- Show control / MIDI: an on/off (and maybe "camera big moment") action, learnable like the others; the operator view
  could show a camera health line (no camera / camera lost).
- Safety: camera unplugged or permission denied must never stop the show (fall back to the surface's normal texture;
  the watchdog pattern for audio input reopen applies).

## Open questions for the user

- Why: band presence on screen, audience in the picture, or something else? (changes where the camera points and how
  often it shows)
- Which camera at gigs, and where it would sit.
- In-world screens only, the full-screen layer, or both.
- Anything to avoid (e.g. faces too recognisable, legibility of the band vs. the mood).
