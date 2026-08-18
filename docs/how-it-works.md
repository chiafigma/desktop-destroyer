# How it works

The short technical tour. [architecture.md](architecture.md) goes deeper on each piece.

## The whole design follows from one missing API

Figma gives plugins **no pointer events for the canvas**. There is no
`onCanvasMouseMove`. The plugin's UI is an iframe, and its own `mousemove` events stop at
the iframe's edge — they describe the 480x400 menu and say nothing about the document.

The only route to a canvas cursor that exists is `figma.activeUsers[].position`, the
multiplayer presence roster. It has no event, so the plugin polls it every 30ms, diffs
consecutive samples, and treats the movement between them as a **segment** to lay damage
along.

Three consequences shape everything else.

### 1. Distance is the trigger, not time

We can see *where* the cursor is, but never *whether the button is down*. Gating on time
alone would bore a hole clean through the canvas while the mouse sat still on it. So a
weapon spends **travel**: one mark per `minTravel` canvas pixels, with unspent distance
carried between samples so spacing stays even however coarsely the samples arrive. See
`src/shared/trail.ts`.

`fireRateMs` still exists, but it decides only *whether* a sample may fire at all — never
how many marks it produces. That division matters far more than it sounds; letting the
clock cap the count too was the worst bug this loop has had. See
[the firing loop](architecture.md#the-firing-loop).

### 2. Marks are interpolated

The multiplayer channel feeding `position` refreshes slower than a mouse moves, so a fast
drag arrives as a handful of far-apart samples. Firing once per sample gives a dotted line
whose density depends on how fast you moved your hand; interpolating along each segment
gives a continuous trail. See [segments, not points](architecture.md#segments-not-points).

### 3. Bytes are uploaded once

`figma.createImage` returns a hash that any number of fills can share, so every sprite
frame is uploaded a single time at startup. From then on a mark is one cheap rectangle
pointing at an existing hash — a hundred marks cost a hundred rectangles, not a hundred
uploads. A mark is placed once and left alone: no timers, no animation.

Two weapons opt out and pay for it: the flame-thrower's fireball animates and deletes
itself, and the termites walk. See [the mark pipeline](architecture.md#the-mark-pipeline).

## What runs where

Sprite decoding, sheet slicing, paint baking and audio all live on the **UI** side,
because the plugin sandbox has no base64 decoder, no canvas and no audio. Node creation
lives in **main**, because `figma.*` doesn't exist in the iframe. The sandbox only ever
receives raw PNG bytes.

This split is enforced by the compiler, not by discipline: `tsconfig.main.json` omits
`lib: DOM` so that reaching for `document` or `atob` from `src/main/` fails to compile
instead of compiling clean and throwing at runtime. `tsconfig.ui.json` withholds the
`figma` global in the same way. That's why `npm run typecheck` runs three passes.

Full breakdown in [two threads, hard-separated](architecture.md#two-threads-hard-separated).

## Both editors

`editorType` is `["figma", "figjam"]` and nothing branches on which one is running.
Everything this plugin creates is a rectangle with an image fill, and FigJam explicitly
permits `RectangleNode` — FigJam's restriction list is components and local styles,
neither of which appear here.

Two harmless consequences in FigJam:

- `figma.on('currentpagechange')` never fires, because FigJam files are single-page.
- Marks are appended to the page with absolute coordinates, so dragging a weapon across a
  section does not reparent them into it.

One piece of trivia worth knowing before you read the API docs and panic: Figma documents
`figma.activeUsers` — the property this entire plugin rests on — as *"only available in
FigJam"*, and its shipped typings say the same. **That note is wrong.** It works in both
editors, verified on real canvases in both, and Figma Design is where this plugin was
built and tested first.

## Why the controls are the way they are

**Everything that matters is reachable by click, on purpose.** Keyboard shortcuts only
fire while the plugin iframe holds focus, and the moment the cursor moves onto the canvas
— the entire point of this plugin — focus is elsewhere and Figma swallows the keystroke.
So shortcuts are a convenience and never the only route to anything.

The one exception is `P`. The probe is a developer diagnostic rather than a toy control,
so it gets no footer button; the footer carries only `clear`.

That is also why the footer no longer reads `right button = back / Esc = quit` as the
original's did. Neither could work: `Esc` never arrives, and a right-click on the canvas
opens Figma's own context menu without the iframe ever seeing the event. Holstering moved
onto the menu itself — click the armed weapon again.

## The menu is a measured replica

Menu geometry is not guesswork. The icon band sits at y 3–41 within each 60px cell and
labels at y 47–53, measured by scanning the original screenshot for non-background rows.
Colours were sampled from it too — `#270057` ground, `#6E862A` rule.

Labels are transcribed character-for-character, **including the original's own
inconsistencies**: `'3: Machine gun'` lowercases `gun` where every other label
title-cases, and `'9:Washing'` is missing the space after its colon. Those are not typos
in this codebase — they are typos in 1990s shareware, faithfully preserved. Don't tidy
them. See [`label` — do not tidy these](weapons.md#label--do-not-tidy-these).

The icons themselves are ours, generated from `assets/icons-src/` by `npm run assets`:
`assets/icons/` holds 256x256 uniform tiles trimmed to content and centred for the menu,
and `assets/cursors/` is tight-trimmed and currently unused. See
[the two generated icon sets](assets.md#the-two-generated-icon-sets).

## Diagnostics

Two things rest on undocumented behaviour. Both are confirmed on real canvases in both
editors now, but the panel that confirmed them is still there — hit `P` and move the
cursor:

- **Is `position` populated for the current user?** The docs describe `ActiveUser.position`
  without confirming it reports your *own* cursor. If it only reported other people's, the
  plugin would be impossible. The panel says `OK` or `FAIL` outright. It says `OK`.
- **What is the real refresh rate?** `effective rate` is distinct-position updates per
  second; `largest jump` is the widest gap between consecutive samples. Together they tell
  you how much interpolation a continuous trail needs, which is the tuning input for
  `MAX_SHOTS_PER_SAMPLE`.

It also answers a question the canvas cannot: `shots dropped` counts marks thrown away by
the per-sample cap, alongside how many samples it bit on. When `MAX_SHOTS_PER_SAMPLE` (8)
is too low for a weapon's `minTravel`, the trail is quietly thinner than it should be —
and a sparse line looks exactly like a fast flick. This panel is the only place that shows
up. See [measuring the assumption](architecture.md#measuring-the-assumption) and
[`ProbeStats`](protocol.md#probestats).
