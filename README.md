# KD Vantage

**Live:** https://kieranduffy87.github.io/kd-vantage/

The hosted version is fully featured except website capture and the Figma
link, which need the local companion server (see Run).

A device mockup studio in the browser. Every device is built procedurally in
three.js (no model files): MacBook Air 13″, iPhone 17 Pro, iPad Pro 11″, a
foldable and Studio Display. Put your own screens on them and export stills or
motion from every angle.

## Run

    python3 _dev-server.py 8590 .

Run it from Terminal. The same process is the local **companion**: it serves the
app, screenshots live websites, and receives frames from the Figma plugin.
(Opened as a static site, Vantage hides those two features.)

## Capture a website

Assets → *Capture a website*. Type an address and choose *Every device*:
headless Chrome (via Playwright, using your installed Chrome) shoots the
desktop, tablet and mobile layouts and puts each on the right screen, with the
domain in the Safari bar. *Whole page* keeps the full scroll so you can use the
Scroll slider or the *Scroll page* motion.

## Figma: KD Vantage Link

In Figma: **Plugins → Development → Import plugin from manifest…** and choose
`figma-plugin/manifest.json`. Select a device in Vantage, select frames in
Figma, press **Send to Vantage**. Switch on **Live** and every edit to a linked
frame re-exports and updates the screen within a second or two.

## Environments

Seven sets, picked from Assets → Environments or the inspector
(`js/environments.js`):

| Environment | Look |
| --- | --- |
| Studio | The seamless cyclorama, with background presets |
| Stone steps | Dark concrete terraces, warm orange key |
| Void float | Pure black, coloured rim lights; float devices with Tilt / Roll |
| White plinth | Plaster corner room, stepped plinth, daylight |
| Desk at dusk | Walnut desk, venetian-blind light falling on the wall |
| Neon ledge | Dark ledge washed by green and blue neon |
| Paper flat lay | Soft grey, shot from above |

Every set exposes its **surface and wall materials** (scanned 2K PBR:
concrete, plaster, marble, oak, walnut, linen, terrazzo, or a matte colour,
each with a tint) and its **lights** — colour, intensity, on/off — plus an
optional window pattern (blinds, panes, leaves) and shadow strength.
Environments use AgX tone mapping so saturated coloured light rolls off
naturally; the Studio keeps Neutral.

**Light control.** Every light has angle, height, softness and (for spot
lights) a shadows switch. With nothing selected, or Lights selected, each
light also shows a sun handle in the view: drag sideways to swing it round its
target, up and down to raise or lower it (lights outside the frame pin to the
edge with a dashed ring). The Studio key light has a handle and a Height
slider too.

**Atmosphere & depth** (Render section): haze, bloom, vignette, grain, contact
shadow strength, plus focus blur. Each environment loads its own defaults.

**Text colour**: Auto follows the background (light on dark sets, ink on
light ones), or pick Paper, Ink, KD Blue, Coral, Teal, Sand or any colour.

Textures and HDRIs are CC0 from Poly Haven; see `assets/env/CREDITS.md`.

Props (`js/props.js`): snake plant, mug, notebook, pen, earbuds case, book
stack. They behave like devices: drag, rotate, recolour, undo.

## Files

| file | role |
| --- | --- |
| `js/geo.js` | rounded-slab / panel geometry, materials |
| `js/devices.js` | device catalogue, builders, `Device` (rebuild vs articulate) |
| `js/screens.js` | screen library + per-device screen canvas |
| `js/stage.js` | renderer, cyclorama backdrop, lights, camera framing, export render |
| `js/environments.js` | architectural sets, scanned materials, coloured light rigs |
| `js/props.js` | set dressing |
| `js/overlay.js` | text layers |
| `js/store.js` | document model, scene/artboard presets, history, autosave |
| `js/app.js` | panels, selection, interaction, motion, export |

## Shortcuts

V select · H orbit · T text · L lighting · F re-frame · 1–5 camera presets ·
O auto-orbit · ⌘Z / ⇧⌘Z · ⌘D duplicate · ⌘E quick PNG · arrows nudge · Delete
