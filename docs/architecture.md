# Architecture

How a mouse drag becomes a hole in your Figma file.

## The one hard constraint

Everything in this plugin is shaped by a single limitation:

> **Figma gives plugins no canvas pointer events.**

There is no `onCanvasMouseMove`. The plugin UI is an iframe, and its own `mousemove` events stop at the iframe's edge — they tell you about the 480x400 menu and nothing about the canvas. A plugin cannot know where your cursor is over the document, cannot know when you press the mouse button, and cannot know when you release it.

But `figma.activeUsers` — the multiplayer roster — carries a `position` per user, in canvas coordinates. That is the only route to a canvas cursor that exists, and it comes with three problems:

1. **It has no event.** It must be polled.
2. **It refreshes slower than a mouse moves.** It rides the multiplayer channel, which was built to show collaborator cursors, not to drive a game loop.
3. **It is undocumented whether it is populated for the *current* user at all**, or at what rate.

Point 3 is load-bearing: if `position` were only populated for *other* users, the entire plugin would be impossible. So it was measured rather than assumed — that is what the `P` diagnostic panel is for. It has since been confirmed working in both Figma Design and FigJam. See [Measuring the assumption](#measuring-the-assumption).

Worth noting because it looks alarming: Figma's docs and its shipped typings both say `figma.activeUsers` is *"only available in FigJam"*. That note is wrong — it works in Figma Design too, which is where this plugin was built and tested first.

Everything below is a consequence of those three facts.

## Two threads, hard-separated

A Figma plugin is two runtimes, and this one splits work strictly by which capability lives where.

```
┌─ main thread ────────────────┐         ┌─ UI thread (iframe) ──────────┐
│  the plugin sandbox          │         │  a real browser               │
│                              │         │                               │
│  ✓ figma.* API               │◄───────►│  ✓ DOM, canvas, Image, atob   │
│  ✓ node creation             │  post   │  ✓ Audio                      │
│  ✗ no DOM                    │ Message │  ✗ no figma.* at all          │
│  ✗ no canvas, no atob        │         │                               │
│  ✗ no audio                  │         │                               │
│                              │         │  menu, sprite slicing,        │
│  polls cursor, makes nodes   │         │  paint baking, sound          │
└──────────────────────────────┘         └───────────────────────────────┘
```

The split is not stylistic. Each side owns work the other side physically cannot do:

- **Sprite decoding lives in the UI** because the sandbox has no `atob`, no `Image`, and no `<canvas>`. Sheets arrive as base64 data URIs, and something has to decode and slice them.
- **Hue rotation lives in the UI** for the same reason, and because an image fill has no hue control — `ImagePaint.filters` offers saturation and temperature, neither of which turns magenta into green. So the colour thrower's recoloured copies are baked on canvas at startup.
- **Audio lives in the UI** because the sandbox has no audio API whatsoever. The main thread detects a hit and posts `impact` purely so the UI can make the noise.
- **Node creation lives in main** because `figma.*` does not exist in the iframe.

### The compiler enforces it

The split is not left to discipline — it is a type error to violate it. There are three tsconfigs, and each one withholds globals the others have:

| Config | `lib` | `types` | Covers | Withholds |
| --- | --- | --- | --- | --- |
| `tsconfig.main.json` | `ES2020` | `@figma/plugin-typings` | `main/`, `shared/` | **DOM** |
| `tsconfig.ui.json` | `ES2020`, `DOM`, `DOM.Iterable` | *(none)* | `ui/`, `shared/`, `generated/` | **`figma`** |
| `tsconfig.test.json` | `ES2020` | `node` | `shared/` | both |

- **No DOM in main.** Reach for `document`, `atob`, `Image` or `requestAnimationFrame` from `src/main/` and it fails to compile. Without this they would all typecheck cleanly and then throw at runtime — exactly the bug class that is hardest to catch in a plugin, because the sandbox is a plausible-looking JS environment that quietly lacks half of one.
- **No `figma` in the UI.** `types: []` keeps the plugin typings out, so reaching for the `figma` global from `src/ui/` fails to compile.
- **Tests get Node, and only see `shared/`.** Tests run under `node:test`, so they need `@types/node`, which main and UI both deliberately exclude. Hence a third project rather than widening either one.

`src/shared/` is included by all three, which means shared code must be platform-free — no `figma`, no DOM. A shared file that reaches for either side's globals fails at least one pass.

This is why `npm run typecheck` runs three passes instead of one. A single merged config would accept code that cannot run.

## Tests

`npm test` runs `node:test` via `tsx` over `src/shared/**/*.test.ts`.

Only `shared/` is tested, and that is the point of the boundary: it is the code with no Figma and no DOM in it, so it runs in bare Node with nothing stubbed. `src/shared/trail.test.ts` covers `plotShots` — even spacing, residual carry, the throttle dropping rather than banking its surplus, Euclidean distance, and two degenerate cases (zero-length sample, non-positive step).

The firing math decides how every weapon feels and is the one part of the plugin checkable without Figma in the loop, which is why it was written pure. `main/` and `ui/` have no tests — they are almost entirely calls into APIs that would have to be faked wholesale, and faking `figma.createImage` to assert that we called it proves very little.

`npm run verify` covers a different class of mistake: it reads the real PNG headers off disk and checks every declared sheet and hit against them. See [Verifying the declarations](weapons.md#verifying-the-declarations).

## Cursor tracking

### Why we poll

`src/main/tracker.ts` runs a recursive `setTimeout` at `POLL_MS` (30ms, ~33Hz), reads the current user's position out of `figma.activeUsers`, and diffs it against the previous sample.

`setTimeout` recursively rather than `setInterval`, for two reasons: ticks cannot pile up on each other if one runs long (node creation can be slow), and it avoids depending on `setInterval` existing in the sandbox.

Finding "us" in the roster matches on **`sessionId`, not user id** — one person can have the same file open in two tabs, and each tab is its own `ActiveUser` entry with its own cursor. Matching on user id could track the wrong tab's cursor.

### Segments, not points

The tracker emits `{ from, to, distance }` **segments**, not positions. This is the single most important design decision in the plugin.

Because `position` refreshes slower than a mouse moves, a fast drag arrives as a handful of widely-spaced samples:

```
what you did:        ●━━━━━━━━━━━━━━━━━━━━━━━━━━●   (one smooth drag)
what we observe:     ●         ●        ●       ●   (four samples)

fire once per sample:
                     ✳         ✳        ✳       ✳   dotted, density
                                                     depends on mouse speed

interpolate segments:
                     ✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳✳   continuous, even
```

A consumer that only saw points would lay down a dotted line whose density depended on how fast you moved your hand. Segments let the caller interpolate and produce a continuous trail. That interpolation is `src/shared/trail.ts`.

Segments are also what makes the chain-saw's cut possible at all: a line needs a `from` and a `to`, not a point.

### Two guards

**Leaving the canvas.** When `position` comes back null — cursor is over the UI, or another app — the tracker drops its `previous` sample. Otherwise re-entering the canvas somewhere else would draw one long segment across the gap, spraying damage along a path your cursor never took.

**Teleports.** A jump larger than `TELEPORT_PX` (4000 canvas px) is treated as a viewport jump or a tab-in, not a drag, and is skipped entirely rather than interpolated. Without it, one blink of the multiplayer channel could smear damage across the whole file.

## From movement to marks

`src/shared/trail.ts` holds `plotShots()`, which answers: given a segment, where do marks land? It is pure and Figma-free, so it can be reasoned about and tested on its own.

### Distance is the currency

The original Desktop Destroyer gated firing on time, because it knew when your mouse button was down. **We do not know that** — see [the one hard constraint](#the-one-hard-constraint). So a time-only gate has an obvious failure: park the cursor on the canvas, walk away, and come back to a hole bored clean through your file.

So marks cost **distance travelled**. One mark per `minTravel` canvas pixels. Hold still and you are charged nothing.

### Residual carry

Travel that does not add up to a full step is not thrown away — it is returned as `residual` and carried into the next sample:

```
step = 26px

sample 1: travelled 40px  →  1 mark at 26px, residual 14
sample 2: travelled 20px  →  1 mark (14 + 12 = 26), residual 8
sample 3: travelled 60px  →  2 marks, residual 16
```

Without the carry, spacing would reset at every sample boundary and mark density would visibly pulse with the poll rate. With it, spacing stays even across ticks regardless of how the samples happen to fall.

The residual shifts the whole ladder of positions backwards within the current sample, since that distance was already travelled *before* `from`.

### The throttle, and what it drops

`MAX_SHOTS_PER_SAMPLE` (8, in `src/main/index.ts`) caps marks from one sample. A slow poll plus a fast flick can legitimately span a thousand pixels; uncapped, a single sample could try to create a hundred nodes and stall the very tick that is supposed to be tracking your mouse.

When the cap bites, the unfired remainder is **dropped, not carried**. Carrying it would let a throttled burst pay itself back as a stutter over the following samples — you would flick once and then watch marks dribble out for half a second afterwards. `plotShots` reports how many it suppressed as `Shots.dropped`, and `trail.test.ts` asserts the surplus is discarded rather than banked.

Dropped marks are otherwise invisible: a trail thinner than the weapon's `minTravel` asked for looks exactly like a fast flick. So the count is reported to the tracker on every sample and surfaced in the `P` panel — see [`ProbeStats`](protocol.md#probestats) for why it takes two numbers rather than one.

## The firing loop

`onCursorMove` in `src/main/index.ts` runs once per distinct cursor sample. The order matters, and one line of it is the most easily re-broken thing in the codebase.

```
moveCursor      weapon follows the cursor, every sample, always
cutTo           the chain-saw's kerf — per sample, before any gating
plotShots       where would marks land?
  ↓ nothing?    return
fireRateMs gate may this sample fire at all?
  ↓ no          hand the travel back, return
impact × N      every point plotShots gave us
setCursorFiring firing pose, if not already in it
raiseCursor     weapon back on top
post impact     with the count, so the UI can stagger the sound
```

### `fireRateMs` decides *whether*, `minTravel` decides *how many*

This division is the whole game. Letting the clock cap the *count* as well was the single worst bug this loop has had.

The cursor channel refreshes at roughly the rate the weapons fire, so a per-sample allowance computed from elapsed time was almost always exactly `1`. Every sample therefore discarded all but its last plotted point — which meant `minTravel` did nothing whatsoever, and every weapon drew 3–7x fewer marks than it asked for. A 400px chain-saw drag laid down 5 chips 79px apart instead of 33 forming a cut.

So the gate is a plain "has `fireRateMs` elapsed?", and if it has, **every** point `plotShots` produced is drawn.

### Handing the travel back

When the rate gate refuses a sample, `plotShots` has *already* deducted that travel from `residual`. Returning without restoring it would spend the distance on marks that were never drawn, and the weapon would under-fire exactly as it did before.

So the refused branch restores the carried distance, clamped to `minTravel * MAX_SHOTS_PER_SAMPLE` — enough to fire a full sample once the gate opens, and no more, so a long pause cannot bank a burst.

### Arming sets the clock

`arm()` sets `lastShotAt = Date.now()`, not `0`. With `0`, the first movement after arming sees thirty billion milliseconds of elapsed time, skips the rate limiter entirely, and dumps a full sample of marks the instant you touch the canvas.

### The idle timer does two jobs

Every weapon gets an idle timer, including the five that have no idle animation, because the timer is also what relaxes the firing pose.

That reset cannot live in `onCursorMove`: the tracker only calls it when the position *changes*, so a weapon parked mid-swing is never told to relax. Left there, a stopped hammer stays frozen on its striking frame forever, and the colour thrower's idle cycle — gated on `!firing` — never restarts.

So the timer ticks at `cursorUpRateMs` for weapons that animate and at `IDLE_AFTER_MS` (220) for those that do not, and on each tick it drops the firing pose if the last hit is old enough.

## The mark pipeline

`src/main/damage.ts` owns everything on canvas. Two ideas run through it.

### Upload each frame once

`figma.createImage(bytes)` returns a hash, and any number of fills can share one hash. So every sprite frame is uploaded exactly once at startup into a `key → hash` map, and from then on a mark is just a cheap rectangle pointing at an existing hash. A hundred marks cost a hundred rectangles, not a hundred uploads.

Frame keys are `${sheetKey}#${frame},${state}` for sliced cells, a bare `${key}` for whole stills, and `${key}@${rrggbb}` for a repainted copy.

Fills use `scaleMode: 'FIT'`, not `'FILL'`. Sprite cells are not all square — the flame thrower's are 319x255 — and `FILL` would crop them to the node's square bounds, clipping the artwork. `FIT` letterboxes instead, and the padding is transparent anyway.

### A mark is one node, one fill, placed once

There is no impact animation. A hit picks a sprite at random from the weapon's `hits`, picks a colour if the weapon has `paints`, creates one rectangle, sets one fill, and walks away. No timers, no frame chains.

This matches the original — which also just leaves one of N marks — and it is the cheapest possible thing to do to a Figma document, which matters because the plugin's entire purpose is to create a great many of them.

**Variety comes from the art, not from motion.** The hammer has 8 cracks, the phaser and stamp 10 marks each, the colour thrower 5 splats across 8 hues for 40 combinations. That is what stops a hundred marks looking stamped from a mould.

**Dispersion** scatters each mark within a square around the cursor rather than a disc. Upstream does the same, and at these radii the difference is not perceptible.

### The cut

The chain-saw is the one weapon whose mark is about the *path* rather than the points on it, so it is drawn separately by `cutTo()`, once per cursor sample, before any firing gate.

Upstream draws its kerf as a scribble of 2x2 rects along the path. That does not port: at 2px a single drag is hundreds of nodes, against a cost model whose whole premise is that a mark is one cheap node. So the kerf is **one rotated rectangle per cursor sample** — about thirty a second while moving — joined end to end into a continuous line, which is what the scribble adds up to visually anyway.

Rotation uses `relativeTransform` rather than the `rotation` property. `rotation` is defined about the node's centre, so setting it swings the band off the path and then requires correcting for the swing; the matrix places the corner exactly where it is wanted in one step. The band is shifted half its width along the normal so it straddles the path instead of hanging off one side.

Samples shorter than `MIN_CUT_PX` (2) are skipped — below that the cursor has effectively not moved and the node would be jitter.

### The crawl

Termites walk after they land. This is the only weapon whose marks are not inert, and it exists because termites are animals and a termite that sat still would not be one.

The sprite grid is what makes it cheap enough to attempt: 2 columns of leg animation by 8 rows, which are 4 compass headings stopped (rows 0–3) and the same 4 walking (rows 4–7). So a step is one `x`/`y` write plus one fill swap, with no art to generate. Each termite walks a run of 4–12 steps, then picks a new heading.

`settleCrawlers()` stops the swarm and leaves every termite in the stopped posture for its heading. It runs on plugin close, so the bugs stay on the canvas as damage — but as bugs that have come to rest, not ones frozen mid-stride. It also runs before `clearDamage`, because otherwise the next tick walks corpses.

#### The swarm has no cap

This was an explicit choice, and it is the one performance cliff in the plugin.

Every step is a document mutation that Figma syncs to other users and may push onto the undo stack, and there is no ceiling on how many termites can be crawling at once. The cost scales with how many you place and **never comes back down** on its own. A few dozen is comfortable; several hundred will make the file sluggish.

`clear` is the release valve, and closing the plugin stops the timer.

### The weapon node

The armed weapon is a single rectangle on canvas, named `⟦weaponId⟧` and tagged as scaffolding rather than damage.

- **Positioned by offset, not centre.** `cursorOffset` shifts the node so its business end — hammer face, gun muzzle, flame nozzle — sits on your cursor. Marks land *at* the cursor, so this is what makes the two coincide.
- **Locked.** So a stray click grabs the canvas underneath instead of the weapon, and so it cannot be dragged out from under the cursor it is meant to follow.
- **Animated by fill swap.** Idle frames cycle at `cursorUpRateMs`; firing swaps to the `cursorDown` sheet, which can have different cell dimensions, so the node is resized as well as refilled.
- **Aimed, if its sheet has more than one row.** `aimCursor()` picks a compass heading from the direction of travel. Only the chain-saw's firing sheet qualifies; see [the chain-saw points where you drag](weapons.md#the-chain-saw-points-where-you-drag).
- **Never counted as damage**, and removed on `figma.on('close')`. It must not outlive the session.

**Z-order is maintained per sample, not per mark.** After firing, the weapon node is re-appended to the page so it reads as being held *above* the mess it is making. Ordering each mark below the weapon individually would mean an `indexOf` over the page's children for every single mark — O(n) against a list this plugin's entire purpose is to grow. One re-append per sample is visually equivalent and does not degrade as the file fills up.

## Clearing

`clearDamage()` removes every mark **this plugin has ever left in the document**, not merely the ones the current session drew.

Every node the plugin creates is stamped with `setPluginData('desktop-destroyer', …)`, valued `damage` or `cursor` so the two can be told apart. Clearing walks `figma.root.findAll()` by that tag.

The tag is the authority rather than an in-memory list, for three reasons which all look identical to the user — a clear button that leaves marks behind:

- marks from a previous run are not in any list at all;
- marks land on whichever page was current at the time, and a session list does not record which;
- a mark the user has since dragged into a frame or group is no longer a direct child of the page, so a shallow pass would miss it.

Consequences worth knowing:

- **It is `async`.** `figma.loadAllPagesAsync()` is required before touching other pages under `documentAccess: dynamic-page`.
- **`findAll` walks the whole document**, which is not cheap — but this runs on an explicit button press, never in the firing loop.
- **Stale weapon nodes are swept too.** The weapon is scaffolding meant to be removed on close, so any that outlived their session — a crash, a reload — are litter by definition. The one currently in hand is spared.

The in-memory `damage` array survives only as the cheap path for `damageCount()`.

## Measuring the assumption

The `P` panel exists because [problem 3](#the-one-hard-constraint) is not answerable from documentation. It reports, live:

| Reading | Tells you |
| --- | --- |
| `self entry found` / `ticks` | Whether our own `ActiveUser` entry is in the roster at all |
| `position non-null` | Whether `position` is populated for self, or only for others |
| `position changed` | How many ticks saw a *new* position — the real refresh rate |
| `effective rate` | Observed distinct updates per second |
| `largest jump` | Biggest gap between consecutive samples, which is what sets how much interpolation a continuous trail needs |
| `shots dropped` | Marks the per-sample cap threw away, with the number of samples it bit on |

Two of these are pass/fail for the whole design: if `self entry found` stays at 0, or `position` is always null, the plugin cannot work as built and the panel says so in as many words. Both pass, in both editors.

`largest jump` is the tuning input. It tells you the worst-case distance `plotShots` has to bridge, which is what `MAX_SHOTS_PER_SAMPLE` has to be able to cover at a given weapon's `minTravel`.

Probing deliberately starts the poll loop even when no weapon is armed, so the channel can be measured on a pristine canvas without leaving marks on it.

## Startup order

```
main: showUI
  ↓
ui:   buildGrid, send 'ui-ready'
  ↓
ui:   buildFrames()  ── decode base64 → <img> → canvas slice → PNG bytes
  ↓                    ── bake one repainted copy per paint
  ↓                    (async; the menu is already interactive here, but
  ↓                     tiles refuse to arm until it finishes)
ui:   send 'sprites' with every frame
  ↓
main: createImage per frame, store hashes, notify "N sprite frames ready"
  ↓
      armable
```

Arming is refused until frames are registered — `arm()` checks `damage.hasFrames()` and posts an `error` if not. There is a window at startup where the menu is drawn but nothing can fire, which is why the UI tracks `spritesReady` and gates clicks on it.

**One bad sheet must not sink the build.** `sliceSheet` is wrapped per sheet: a sheet that fails to decode costs its own weapon some art, but letting it reject the whole `buildFrames` promise would cost *every* weapon the ability to fire, because the main thread would never receive any frames and would answer "sprites are still loading" forever — with nothing to show for it but a console line in a panel nobody has open.

Sliced cells and tinted stills come out of a canvas as PNG, because cutting a sheet into cells and rotating hues both need one; whole stills that need neither are forwarded byte-for-byte. Everything in the rip is already PNG, so there is no conversion step — but `figma.createImage` accepts PNG, JPEG and GIF only, which is worth remembering before adding a WebP export to `ref/w93/`. Canvas smoothing is disabled during slicing: these are hard-edged pixel art, and smoothing would sand off exactly the crudeness the port is trying to preserve.

Sound pools are built on the first weapon click rather than at startup — see [the audio section](weapons.md#sound). A click is both the moment we know sounds will be wanted and the gesture that grants the iframe permission to make them.

## Known loose ends

Accurate as of the last edit to this file; the codebase is moving.

- **The termite swarm is uncapped**, deliberately. See [above](#the-swarm-has-no-cap). If files start feeling heavy, this is the first place to look, and a cap is the first thing to add.
- **The menu icons are half the bundle**, at 330kb for nine files against 117kb for all 74 sprites. They are 256x256 truecolour RGBA for pixel art that renders in an 80px cell — oversized and in the wrong colour type. Palettising and downscaling them in `npm run assets` is the easiest remaining win. See [assets.md](assets.md#the-icons-are-oversized-and-the-wrong-colour-type).
- **Undo behaviour under the crawl is untested, and this one needs a human.** The open question is narrow and factual: does Figma coalesce a plugin's mutations into one undo entry per message, or one per mutation? Nobody has checked. If it is per mutation, then every living termite pushes an undo entry every `CRAWL_TICK_MS` (140ms), and `Cmd-Z` is useless for as long as any termite is alive — not degraded, useless, because the undo stack fills with crawl steps faster than a person can press the key. If it coalesces, there is nothing here at all. No amount of reading the code settles it; it wants someone with the plugin open, a few termites placed, and a `Cmd-Z`.
- **`assets/cursors/` and its `metrics.json`** are generated by `npm run assets` but never inlined or read. The weapon node takes its dimensions from sprite-sheet cell geometry in the weapon files instead. See [assets.md](assets.md#the-cursors-set-is-currently-unused).
