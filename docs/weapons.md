# Weapons

Nine weapons, one file each, in `src/shared/weapons/`. All nine are playable.

`index.ts` assembles them into `WEAPONS` (menu order) and `BY_ID`. `types.ts` holds the
schema. **One file per weapon** so that work on one cannot collide with work on another —
which matters, because tuning a weapon means editing it many times.

The schema is modelled on the windows93 recreation's own, because that is where the
sprites and their geometry come from and inventing a different shape would only mean
translating between the two forever. Each weapon file opens with the upstream config it
was derived from.

## The declaration

```ts
{
  id: 'hammer',
  slot: 1,                          // 1-9, menu position and keyboard shortcut
  label: '1: Hammer',               // verbatim from the original menu
  icon: '1-hammer',                 // key into the generated ICONS map

  fireRateMs: 160,                  // minimum ms between hits
  minTravel: 55,                    // canvas px of cursor travel between hits
  dispersion: 4,                    // random scatter per hit, canvas px
  cursorUpRateMs: 0,                // ms per idle frame; 0 = does not animate at rest
  cursorOffset: { x: 0, y: 0 },     // artwork position relative to the cursor

  sounds: ['0-hammer/hit-1', …],    // one-shots, one picked at random per hit
  sustain: '1-chain-saw/press',     // OR one looped sample while firing
  volume: 0.7,                      // level trim relative to other weapons; default 1
  crawl: true,                      // marks walk after they land (termites only)

  art: { … } | null                 // null = declared but cannot fire
}
```

`art` is where the sprites live:

```ts
art: {
  // The weapon at rest. Cycles its frames at `cursorUpRateMs` when frames > 1.
  cursorUp: { key: '0-hammer/cursor-release', frames: 1, states: 1, cellW: 111, cellH: 159 },

  // The weapon firing. Null for weapons that never change (flame, colour thrower).
  cursorDown: { key: '0-hammer/cursor-press', frames: 1, states: 1, cellW: 73, cellH: 159 },

  // Permanent marks. One picked at random per hit.
  hits: ['0-hammer/hit-1', '0-hammer/hit-2', …],

  // Sheets to slice beyond the two cursor sheets, so their cells can be named in `hits`.
  extraSheets: [{ key: '7-termite/termite', frames: 2, states: 8, cellW: 31, cellH: 31 }],

  // The muzzle flash: played at the impact point, then removed. Leaves nothing behind.
  fire: {
    sheet: { key: '3-flame-thrower/press', frames: 20, states: 1, cellW: 63, cellH: 63 },
    frameMs: 24,                    // ms per frame; upstream ran everything at 50
    from: 4,                        // first frame worth drawing
  },

  paints: ['ff0000', 'ff7a00', …], // colours to repaint the paint into
  cut: { width: 6 },                // continuous line along the path, not points

  hitSize: 64,                      // square edge to draw a mark at, canvas px
}
```

### `fire` is the one piece of art that is not a mark

Everything else in `art` is permanent — placed once, never touched, one node and no
timer. `fire` is upstream's `fireFrames`: a short animation centred on the hit that plays
through and deletes itself. It is deliberately a separate field rather than another entry
in `hits`, because the lifecycle is the opposite one.

Consequences worth knowing before adding it to a second weapon:

- **Flames are not damage.** They are tagged distinctly from marks, excluded from
  `damageCount`, and swept by `clear` as litter rather than tallied. A count that ticked
  up and back down while firing would be wrong.
- **They cost per frame.** Each tick is a fill swap *and* a re-append — the re-append is
  what keeps a flame above the marks landing on top of it during its life. So concurrent
  flames are capped (`MAX_FLAMES` in `main/damage.ts`), and overshoot drops the flame
  rather than queueing it.
- **They never outlive the trigger.** Arming, disarming, switching pages and closing the
  plugin all put them out. Unlike the termites — which are damage and stay — an abandoned
  flame is a frozen frame of an animation the user cannot easily identify or remove.
  Arming matters as much as disarming: the menu sends `arm` for the new weapon without a
  `disarm` first, so a weapon switch would otherwise leave the old weapon's fire burning.

### If the fire feels late

Time-to-visible is not the frame rate alone. A sheet whose opening frames are nearly
empty spends that time as a node that exists, ticks, and shows nothing, which reads as the
fire trailing the cursor. The flame thrower's sheet opens on a fully blank frame and does
not peak until frame 15 of 20 — at upstream's 50ms that is 750ms after the impact.

So there are two knobs and they are not interchangeable:

| Knob | Question it answers | Kind of value |
| --- | --- | --- |
| `from` | Which frame is worth showing first? | property of the sheet — measure it |
| `frameMs` | How fast does it run? | pure feel |

Measure before setting `from`, rather than guessing at a skip:

```sh
magick ref/w93/3-flame-thrower/press.png -crop 63x63 +repage +adjoin /tmp/f_%02d.png
for i in $(seq -w 0 19); do magick /tmp/f_$i.png -alpha extract -format "%[fx:mean]\n" info:; done
```

That prints the fraction of each cell the frame actually covers. Skip the leading run that
rounds to nothing; do not skip real frames to buy speed, since that is what `frameMs` is
for.

The sheet is `press.png`, which is easy to miss: `press.ogg` is a completely different
thing (the trigger pull). The fetcher listed the sound and not the sheet for a while, and
the flame thrower shipped scorch marks with no fire as a result.

Two other weapons declare `fireFrames` upstream and could take this field: the machine
gun (`fireFrames: 14`, a 434x31 sheet of 31x31 cells) and the colour thrower
(`fireFrames: 20`). Both are one line each now that the mechanism exists.

## Current tuning

| Slot | id | `fireRateMs` | `minTravel` | `dispersion` | `cursorUpRateMs` | `cursorOffset` | `hitSize` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `hammer` | 160 | 55 | 4 | 0 | 0, 0 | 64 |
| 2 | `chainsaw` | 60 | 12 | 14 | 120 | -95, -95 | 31 |
| 3 | `machinegun` | 110 | 40 | 9 | 0 | 0, 0 | 16 |
| 4 | `flamethrower` | 70 | 16 | 6 | 75 | -107, -110 | 48 |
| 5 | `colorthrower` | 260 | 150 | 10 | 200 | -107, -110 | 128 |
| 6 | `phaser` | 320 | 80 | 0 | 0 | -63, -63 | 128 |
| 7 | `stamp` | 260 | 130 | 0 | 0 | -48, -209 | 96 |
| 8 | `termites` | 120 | 55 | 18 | 150 | -30, -55 | 31 |
| 9 | `washing` | 60 | 16 | 30 | 0 | -63, -63 | 128 |

Sprite geometry in each file is **measured from the real files** and is not guesswork —
`npm run verify` proves it. `fireRateMs`, `minTravel`, `dispersion` and `hitSize` are
tuning values, and they are the ones to change if a weapon feels wrong.

### `label` — do not tidy these

Labels are transcribed character-for-character from the original 240x200 menu,
**including its inconsistencies**:

- `'3: Machine gun'` — lowercase `gun`, where every other label title-cases
- `'9:Washing'` — missing the space after the colon

These are not typos in this codebase. They are typos in 1990s shareware, faithfully
preserved. Leave them.

### `minTravel` sets the feel; `fireRateMs` only caps it

`minTravel` is how far the cursor must travel, in canvas pixels, to earn one mark. It is
the knob that matters most:

| Value | Feel |
| --- | --- |
| Low (12–16) | Continuous spray — chain-saw, flame-thrower, washing |
| Mid (40–55) | Distinct repeated blows — machine gun, hammer, termites |
| High (80–130) | Deliberate, one-at-a-time — phaser, colour thrower, stamp |

`fireRateMs` decides only *whether* a given cursor sample may fire at all. It never caps
how many marks that sample produces — that division is load-bearing and easy to
re-break, so read [the firing loop](architecture.md#the-firing-loop) before touching it.

Keep `minTravel` in a sane relationship with `MAX_SHOTS_PER_SAMPLE` (8, in
`src/main/index.ts`). A weapon at `minTravel: 12` can cover at most 96px of travel per
sample before the throttle starts dropping marks; check the `P` panel's `largest jump`
reading against that.

### `hitSize` is easy to get wrong in one direction

Marks are drawn into a square of `hitSize` canvas px with `scaleMode: 'FIT'`, so the
number is a scale, not a crop. Too large is the failure mode that looks like an art
problem: the machine gun's 16x16 holes were once drawn at 150 and read as blobs, and the
chain-saw's 31x31 sawdust does the same thing the moment it stops being sawdust-sized.
When a mark looks wrong, check this before suspecting the sprite.

### `cursorOffset` is the fiddly one

The offset from the cursor to the artwork's top-left. Marks land *at* the cursor, so this
is what makes a weapon's business end — the hammer's face, the gun's muzzle, the flame
nozzle — coincide with the point of damage.

There is no way to derive it from the art. Get it wrong and the weapon appears to fire
from its handle. It is set by eye:

1. Arm the weapon, drag across the canvas.
2. Watch where marks land relative to where the sprite's business end appears.
3. Adjust and rebuild. Marks landing *below* where they should means `y` is too small.

Two cautionary notes from the existing set. The flame and colour throwers both carried
`{0, 0}` for a while, which was the schema default rather than a considered value —
upstream never shipped those weapons, so there was nothing to copy — and it put the fire
153px up-and-left of the gun, detached in empty canvas. Their current values were measured
off the alpha channel: the nozzle tip spans x[101..115] y[105..112] in a 319x255 cell.
Every weapon upstream *did* ship puts the cursor on the business end.

`assets/cursors/metrics.json` contains content-centre hotspots generated by
`npm run assets`. They are a starting guess only, and nothing reads that file.

## Sprite geometry

```ts
{ key: '1-chain-saw/cursor-press', frames: 2, states: 8, cellW: 191, cellH: 191 }
```

Every `key` is a path into `ref/w93/` — the filename without `.png`, directory included.

**Sheets are a grid, not a strip.** `frames` columns across by `states` rows down; a cell
sits at `(frame * cellW, state * cellH)`. Upstream computes `frameWidth = width / frames`
and `frameHeight = height / states`, and this follows it. `frames × cellW` must equal the
file's real pixel width and `states × cellH` its real height.

Most sheets are a single row. The chain-saw's `cursorDown` is the only 2-D cursor sheet
(2 frames x 8 states — frames animate the blade, states are the saw's compass heading),
and the termite's `extraSheets` grid is 2 x 8. Treating every sheet as a grid means
neither is a special case.

**Both 2-D sheets use all sixteen of their cells**, by different routes: the chain-saw's
row is chosen by `aimCursor()` from the direction of travel, the termite's by the crawl
(`WALKING_ROW + heading` while walking, the bare heading once settled). See
[the chain-saw points where you drag](#the-chain-saw-points-where-you-drag).

**Cells are not always square** — the flame thrower's are 319x255. This is why fills use
`scaleMode: 'FIT'` rather than `'FILL'`, which would crop them to the node's square
bounds and clip the artwork.

**A cell can be named directly in `hits`** as `'7-termite/termite#0,3'`, which is
`${key}#${frame},${state}` — the same form `cellKey()` emits. That matters for weapons
whose marks only exist inside a grid.

### Verifying the declarations

A declared cell size that disagrees with the file means every cell after the first is cut
from the wrong offset, and the result looks like a subtle art problem rather than a
numbers problem — so it can be stared at for a long time.

`npm run verify` (`scripts/verify-sheets.mjs`) removes that possibility. It regex-scans
the weapon files for sheet literals and `hits` arrays, reads real dimensions straight out
of each PNG's IHDR chunk, and fails the build with the arithmetic spelled out. It is part
of `npm run check`.

Two things it cannot catch:

- **A `hits` entry naming a sheet nobody declared in `extraSheets`.** `verify` checks
  that the *file* exists, not that the sheet was declared, so the frame is never sliced
  and the weapon fires blanks. `buildFrames` logs an error for this case at runtime.
- **Sound keys.** Nothing verifies those; a typo surfaces as a `sound missing:` console
  warning.

## Sound

Sounds are declared **per weapon**, not in a table inside the audio module, so that
adding a weapon never means editing `src/ui/audio.ts`.

There are two playback models, because the ripped material contains two kinds of sound:

| Field | Model | Weapons |
| --- | --- | --- |
| `sounds?: string[]` | One-shot, one key picked at random per hit | hammer, machine gun, colour thrower, phaser, stamp, termites |
| `sustain?: string` | One sample looped while the weapon keeps firing | chain-saw, flame-thrower, washing |

A weapon is one or the other, never both.

**Why the split exists.** The sustained samples are 1.5–2.5s long and upstream keys them
to mouse-down and mouse-up. Fired as one-shots at a 60ms rate they restart roughly
sixteen times a second, and you hear the first sixth of a chainsaw rev on a loop — a buzz
rather than a saw. So `sustain` starts on the first hit and stops on a watchdog 250ms
after hits stop arriving, which reproduces held-trigger behaviour without the press and
release events this plugin cannot see.

**One-shots are pooled and staggered.** Each key gets 12 preloaded elements, because a
single element cannot overlap with itself and at these fire rates the previous shot is
still ringing. The pool hands back the *furthest-progressed* element rather than
round-robin, so the voice that gets cut short is always the one nearest finishing. And
because a single cursor sample can land up to 8 marks, `impact` carries a `count` and the
UI spaces them by the weapon's own `fireRateMs` — otherwise a burst is one loud noise
instead of a burst.

### Levels

The rips are not balanced against each other — they were recorded for a toy that played
one sound at a time — so levels are set in `src/ui/audio.ts` and trimmed per weapon.

| Knob | Value | Applies to |
| --- | --- | --- |
| `MASTER_VOLUME` | 0.38 | every one-shot |
| `SUSTAIN_VOLUME` | 0.26 | every loop |
| `volume?: number` | per weapon, default 1 | multiplied into whichever of the two applies |

**Loops sit lower than one-shots on purpose.** A sound that never stops does continuously
what a one-shot does in bursts, so matching their nominal levels makes the loop dominate
everything else.

**Bursts decay.** When a sample lands several marks at once, each later shot in the
staggered burst plays at `level * (1 - i * 0.15)`, so the burst has a front to it instead
of reading as one flat loud event.

**`volume` is the "that one is too loud" knob**, not overall volume. Two weapons carry a
trim, and both for the same reason — they run more simultaneous voices than anything else:

- `machinegun: 0.7` — the fastest one-shot, stacking about four deep, with a hard transient.
- `termites: 0.75` — its overlap is deliberate (that is how the skitter is built), so it is
  the busiest weapon in the pool.

The other seven are at 1.

**Leaving a weapon silent is legitimate**, and so is leaving a ripped sound unused. Every
weapon file documents which of its sounds it declined and why. The recurring reasons:

- **Release tails** (`chainsaw/release`, `machinegun/release`) want a real mouse-up. There isn't one.
- **Ignition bookends** (`flame-begin`, `flame-end`) would re-fire every time you paused mid-drag.
- **Trigger pulls** used per impact (`colorthrower/press`) ratchet.
- **Particle-landing clatter** (the machine gun's `drop-1..9`) plays when spent brass hits the desk upstream. This port throws no brass, and folding nine clatters into a hit pool makes a burst sound like dropped cutlery.

## The special cases

Three weapons do something other than "place a still and leave it". Each is opt-in
through a field, so the pipeline stays uniform for the other six.

### `cut` — the chain-saw draws a line

Upstream's saw scribbles a black slot along the cursor's path as it cuts. Without it the
weapon reads as "sprays chips" rather than "cuts", so `cut: { width: 6 }` draws it: one
rotated rectangle per cursor sample, joined end to end.

It is drawn per *sample*, not per hit, because it has to be continuous — the only mark in
the plugin that is about the path rather than the points along it. The chips are ordinary
`hits` scattered along it, which is `dispersion: 14` doing the work upstream's
`velocityX/Y` did.

Implementation notes in [architecture.md](architecture.md#the-cut).

### The chain-saw points where you drag

The saw's firing sheet is the only 2-D cursor sheet in the set — 2 columns of blade
animation by 8 rows of compass heading. `stepCursorFrame` walks the columns; `aimCursor()`
in `src/main/damage.ts` chooses the row from the direction of travel.

**The row order is a property of the artwork, not a convention.** It runs anticlockwise
from east, in screen coordinates where y grows downwards:

| Row | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Heading | right | up-right | up | up-left | left | down-left | down | down-right |

The rows were sliced in the order the sheet was drawn, so any other mapping puts the blade
at the wrong angle rather than merely at a differently-numbered one.

**The deadzone is per axis, not on distance.** Each of `dx`/`dy` is squashed to zero below
`AIM_DEADZONE_PX` (4), which is upstream's rule verbatim, and a sample that squashes to
`(0, 0)` leaves the heading alone entirely rather than falling back to a default. Without
it, a hand resting on a mouse produces a pixel of noise per axis per sample and the saw
shivers between neighbouring headings.

Three details that are easy to undo by accident:

- **Aiming is gated on the current *sheet*, not the weapon.** The saw is only pointable
  while it is actually cutting; its idle sheet has one row, and so does every other
  weapon's, so `aimCursor` returns immediately for them.
- **`setCursorFiring` must not reset `cursorState`.** Heading belongs to the drag, not to
  which sheet happens to be loaded. Resetting it snapped the blade back to east every time
  a steady cut crossed the 220ms idle threshold and re-armed the firing pose.
- **`stateFor(sheet)` clamps the row to 0 when the current state exceeds a sheet's row
  count.** Otherwise an idle saw last pointing down-left asks for row 5 of a 1-row sheet,
  finds no cell, and silently stops animating its blade — a failure that looks like the
  animation being broken rather than the row being out of range.

`aimCursor` also returns early when the computed row is unchanged, which is the common case.
A fill write is a document mutation Figma syncs to everyone in the file, and this runs on
every cursor sample — so dragging in one direction must cost nothing, and only the moments
where the heading actually turns pay.

### `crawl` — termites walk

`crawl: true` makes marks autonomous. There are no `hit-*.png` for this weapon at all;
its art is a 2 x 8 grid of 31x31 cells (2 leg frames x 4 headings x stopped/walking),
declared in `extraSheets`, and a crawler picks its own starting cell from it.

The `hits` array is still populated — all sixteen cell keys plus `dead-termite` — even
though **a crawling weapon never reads it.** `impact()` hands off to `spawnCrawler()`
before it picks a hit, and the crawler takes its cell straight from `extraSheets`. So the
list is inventory, not a draw pool. It stays for two reasons: it is the honest record of
what this weapon can put on the canvas, and `isPlayable()` reads its length to decide
whether the menu greys the tile out.

One consequence: **`dead-termite` is listed but never drawn.** Upstream shows a corpse
when one weapon kills a termite inside its `killMargin`; nothing here kills anything, and
the hit list that would have drawn it is unreachable. It is listed so the art is
accounted for, not because it appears.

**This is the most expensive thing in the plugin and the swarm is uncapped by design.**
Read [the swarm has no cap](architecture.md#the-swarm-has-no-cap) before raising the
termite fire rate.

### `paints` — the colour thrower recolours itself

All five of the colour thrower's splats are the same paint in five shapes, so without help
the "colour thrower" throws one colour, which is the one thing its name promises it will
not do. The palette is exactly five colours and only one of them is chromatic:

| RGBA | Role |
| --- | --- |
| `(255, 0, 0, 255)` | the paint — **pure red** |
| `(149, 34, 140, 0)` | transparent; the magenta is only this palette's colour key |
| `(0, 0, 0, 128)` | drop shadow |
| `(0, 0, 0, 255)` | outline |
| `(255, 255, 255, 255)` | highlight |

`paints: ['ff0000', 'ff7a00', …]` bakes a repainted copy of every hit at slice time, keyed
`${hit}@${rrggbb}`, giving 5 splats x 8 colours = 40 distinct marks. A hit picks a sprite
and a colour independently. Every pixel with any chroma is written to the target colour;
the three greys are left alone, so outline, highlight and shadow survive by construction.

#### Why this is not `hue-rotate`

It was, and that is where the muddy version of this weapon came from. **CSS `hue-rotate` is
not a hue rotation.** It is a fixed luminance-preserving matrix approximation, and it
mangles saturated inputs. Applied to pure red:

| Angle | Result | Reads as |
| --- | --- | --- |
| 0 | `#ff0000` | red |
| 45 | `#9e2a00` | brown |
| 90 | `#005b00` | near-black green |
| 135 | `#007700` | dark green |
| 180 | `#006d6d` | teal |
| 225 | `#0043eb` | blue |
| 270 | `#6d12ff` | violet |
| 315 | `#eb009e` | pink |

Five of eight land dark and muddy, and no saturation boost recovers them because the
matrix has already collapsed the luminance.

Two mistakes compounded it, both worth recognising elsewhere:

- **The transparent entry was read as the paint.** `(149,34,140)` has alpha 0 — it is never
  drawn. The paint was never a muted magenta; it was pure red all along.
- **So the fix was aimed at the wrong thing.** `tintSaturation: 2.2` existed to rescue that
  imagined dull magenta, and on pure red it is a no-op — the saturate matrix clips straight
  back to `(255,0,0)`. It shipped looking like a knob that was doing something.

Naming target colours instead means what ships is what was chosen. Pick them like a
paintbox rather than as even steps around a wheel: this is a toy about throwing paint, and
the colours that read as paint are the ones a paintbox has.

## Adding a weapon

`art: null` renders a menu tile that greys out and refuses to arm, and `isPlayable()` is
`art !== null && art.hits.length > 0`. Nothing is currently inert, but that is the state
a half-finished weapon sits in.

To finish one:

1. **Get the art into `ref/w93/<n>-<name>/`** as PNGs. `scripts/fetch-w93-assets.mjs`
   is how the existing set arrived.
2. **Measure every sheet.** `magick identify ref/w93/1-chain-saw/cursor-press.png` gives
   `WxH`; divide by the frame and state counts.
3. **Write the file**, copying the nearest existing weapon. Keep the upstream-config
   comment at the top — it is what the next person tunes against.
4. **Add it to `WEAPONS` in `index.ts`.**
5. **`npm run check`.** `verify` will tell you immediately if a cell dimension is wrong.
   Assets in `ref/w93/` are inlined automatically; there is no asset list to update.
6. **Tune `cursorOffset` and `hitSize` on canvas**, per above. Everything else can be
   guessed; these two cannot.
7. **Add sound if the rip has any**, and read [Sound](#sound) first to decide whether it
   is a `sounds` set or a `sustain`. Getting that wrong is the difference between a
   chainsaw and a buzz.

## Adding a tenth weapon

Not really supported, and mostly not worth it: `slot` doubles as the `1`–`9` keyboard
shortcut, the UI keyboard handler only listens for `1`–`9`, and the menu grid is a 3x3
authored against the original's 240x200 layout. A tenth weapon means picking a new key,
widening the handler, and reworking the grid CSS. The original had nine.
