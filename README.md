# Desktop Destroyer for Figma

Pick a weapon from the 3x3 menu, wield it over the Figma canvas, leave a mess of
real nodes behind.

```
npm install
npm run build
```

Then in Figma: **Plugins → Development → Import plugin from manifest…** and choose
`manifest.json`.

Works in **Figma Design and FigJam** — same code, no per-editor branching. See
[Both editors](#both-editors).

## How it works

Figma has no pointer event for the canvas, and the plugin UI's own `mousemove` stops
at the iframe edge. The only route to a canvas cursor is `figma.activeUsers[].position`,
which has to be polled — so the plugin polls it every 30ms, diffs consecutive samples,
and treats the movement between them as a segment to lay damage along.

Three consequences shape the whole design:

**Distance, not time, is the trigger.** We can see *where* the cursor is but never
*whether the button is down*. Gating on time alone would bore a hole through the canvas
while the mouse sat still, so a weapon instead spends travel: one mark per `minTravel`
canvas pixels, with unspent distance carried between samples so spacing stays even
however coarsely the samples arrive. See `src/shared/trail.ts`.

`fireRateMs` still exists, but it decides only *whether* a sample may fire at all —
never how many marks it produces. That division matters more than it sounds; see
[the firing loop](docs/architecture.md#the-firing-loop).

**Marks are interpolated.** The multiplayer channel feeding `position` refreshes slower
than a mouse moves, so a fast drag arrives as a handful of far-apart samples. Firing
once per sample would give a dotted line; interpolating along the segment gives a
continuous trail.

**Bytes are uploaded once.** `figma.createImage` returns a hash that any number of
fills can share, so every sprite frame is uploaded a single time at startup and a
hundred marks cost a hundred cheap rectangles. A mark is then one node with one fill,
placed once and left alone — no timers, no animation. That is also how the original
works: there is no impact animation, only a random choice among the weapon's marks.

Sprite decoding, sheet slicing, hue baking and audio all live on the UI side, because
the plugin sandbox has no base64 decoder, no canvas and no audio. The sandbox only ever
receives raw PNG bytes. `tsconfig.main.json` omits `lib: DOM` specifically so the
compiler enforces that split instead of letting it compile clean and fail at runtime.

## Both editors

`editorType` is `["figma", "figjam"]` and nothing branches on which one is running.
Everything this plugin creates is a rectangle with an image fill, and FigJam explicitly
permits `RectangleNode` — the FigJam restriction list is components and local styles,
neither of which appear here.

Two harmless consequences in FigJam: `figma.on('currentpagechange')` never fires,
because FigJam files are single-page; and marks are appended to the page with absolute
coordinates, so dragging a weapon across a section does not reparent them into it.

One piece of trivia worth knowing before you read the API docs and panic: Figma
documents `figma.activeUsers` — the property this entire plugin rests on — as
*"only available in FigJam"*. That note is wrong. It works in both editors, verified on
real canvases in both.

## Controls

| Input             | Effect                                              |
| ----------------- | --------------------------------------------------- |
| Click a weapon    | Arm it. Click it again to holster.                  |
| `clear` (footer)  | Remove every mark this plugin has ever left         |
| `1`–`9`           | Arm by slot — same as clicking, see caveat          |
| `C`               | Clear                                               |
| `P`               | Cursor-tracking diagnostics. Keyboard-only.         |

**Everything that matters is reachable by click, on purpose.** Keyboard shortcuts only
fire while the plugin iframe holds focus, and the moment you move the cursor onto the
canvas — the entire point of this plugin — focus is elsewhere and Figma swallows the
keystroke. So the shortcuts are a convenience and never the only route to anything.

The one exception is `P`. The probe is a developer diagnostic rather than a toy control,
so it has no footer button; the footer carries only `clear`.

That is also why the footer no longer reads `right button = back / Esc = quit` as the
original's did. Neither could work: `Esc` never arrives, and a right-click on the
canvas opens Figma's own context menu without the iframe ever seeing the event.
Holstering moved onto the menu itself — click the armed weapon again.

**`clear` is not scoped to this session.** Every node the plugin creates is stamped with
plugin data, and clearing sweeps the whole document by that tag, across every page. So
it finds marks left by a previous run — which is exactly the state someone is in when
they reopen the plugin to a covered canvas and press clear. Stale weapon nodes get swept
too. It never touches anything the plugin did not create.

## Weapons

All nine are playable. Art and sounds come from the windows93 recreation's rip,
vendored under `ref/w93/`.

| Slot | Weapon | `minTravel` | `fireRateMs` | Mark | Sound |
| --- | --- | --- | --- | --- | --- |
| 1 | Hammer | 55 | 160 | 8 cracks, 64px | 8 one-shots |
| 2 | Chain-saw | 12 | 60 | kerf line + 5 sawdust chips, 31px | sustained rev |
| 3 | Machine gun | 40 | 110 | 4 bullet holes, 16px | one-shot |
| 4 | Flame-thrower | 16 | 70 | 20-frame fireball + 4 scorches, 48px | sustained flame |
| 5 | Color-thrower | 95 | 200 | 5 splats x 8 hues, 128px | one-shot |
| 6 | Phaser | 80 | 320 | 10 blast marks, 128px | one-shot |
| 7 | Stamp | 130 | 260 | 10 stamps, 96px | one-shot |
| 8 | Termites | 55 | 120 | live termites that crawl, 31px | one-shot skitter |
| 9 | Washing | 16 | 60 | 4 smears, 128px | sustained spray |

Three of them do something other than "place a still and leave it":

- **The chain-saw draws a line, not points**, and points the way you cut. Its `cut` lays
  one rotated rectangle per cursor sample, joined end to end into a continuous black kerf,
  with sawdust chips scattered along it — the only mark in the plugin that is about the
  path rather than the points on it. Its blade also turns to face the direction of travel,
  through the eight compass headings its sprite sheet was drawn with.
- **Termites walk after they land.** A real crawl simulation, stepping every 140ms.
  This is by far the most expensive thing the plugin does — see
  [the swarm has no cap](docs/architecture.md#the-swarm-has-no-cap).
- **The colour thrower recolours its own art.** Its five splats ship with one identical
  palette, so hue-rotated copies are baked at startup to get 40 distinct marks out of 5
  sprites.

Full field-by-field reference in [docs/weapons.md](docs/weapons.md).

## Diagnostics

Two things rest on undocumented behaviour. Both are now confirmed on real canvases in
both editors, but the panel that confirmed them is still there — hit `P` and move the
cursor:

- **Is `position` populated for the current user?** The docs describe
  `ActiveUser.position` without confirming it reports your *own* cursor. The panel says
  `OK` or `FAIL` outright. It says `OK`.
- **What is the real refresh rate?** `effective rate` is distinct-position updates per
  second and `largest jump` is the widest gap between consecutive samples. Together they
  tell you how much interpolation a continuous trail needs.

It also answers a question the canvas cannot: `shots dropped` counts marks thrown away by
the per-sample cap, alongside how many samples it bit on. When `MAX_SHOTS_PER_SAMPLE` (8)
is too low for a weapon's `minTravel` the trail is quietly thinner than it should be, and a
sparse line looks exactly like a fast flick — this is the only place that shows up.

## Layout

```
src/shared/   weapon registry, trail math, UI<->main protocol  (no Figma, no DOM)
src/main/     sandbox: cursor polling, node creation, damage, the crawl
src/ui/       iframe: menu replica, sprite slicing, hue baking, audio
ref/w93/      vendored sprite sheets and sounds, one directory per weapon
ref/          older rip and upstream weapon configs, kept for reference
scripts/      esbuild bundler + asset inliner, sheet verifier, icon normalizer
docs/         the long-form version of everything above
```

## Commands

| Command | Does |
| --- | --- |
| `npm run build` | Inline assets, build `dist/main.js` and `dist/ui.html` |
| `npm run dev` | Same, watching. Figma does not hot-reload — re-run the plugin (`⌥⌘P`) to pick up a change. |
| `npm run verify` | Check every declared sheet and hit against the real PNG on disk |
| `npm test` | `node:test` over `src/shared/**/*.test.ts` |
| `npm run typecheck` | All three tsconfigs — main, UI and test are checked separately, on purpose |
| `npm run check` | Build, verify, typecheck, test. Run before calling anything done. |
| `npm run assets` | Regenerate icon sets from `assets/icons-src` (needs ImageMagick; not part of the build) |

## Assets

`assets/icons-src/` holds the original 9 weapon PNGs and is never written to.
`npm run assets` regenerates both derived sets from it:

- `assets/icons/` — 256x256 uniform tiles, trimmed to content and centred, for the menu
- `assets/cursors/` — tight-trimmed; generated but currently unused

Menu geometry is not guesswork: the icon band sits at y 3–41 within each 60px cell
and labels at y 47–53, measured by scanning the original screenshot for
non-background rows. Colours were sampled from it too — `#270057` ground, `#6E862A`
rule. Labels are transcribed character-for-character, including the original's own
inconsistencies ("Machine gun" is lowercase, and slot 9 is missing the space after
its colon). Don't tidy those.

## Docs

- [docs/architecture.md](docs/architecture.md) — the two-thread split and why the compiler enforces it, cursor polling, the trail math, the firing loop, the crawl, clearing, known loose ends
- [docs/weapons.md](docs/weapons.md) — the weapon declaration field by field, tuning `minTravel` and offsets, the special cases, adding a weapon
- [docs/assets.md](docs/assets.md) — the pipeline from source PNG to inlined data URI, the three asset maps, build output
- [docs/protocol.md](docs/protocol.md) — every message crossing the boundary, `FramePayload`, `ProbeStats`
