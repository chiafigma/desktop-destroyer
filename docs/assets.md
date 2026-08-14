# Assets

Every sprite, icon and sound is baked into the bundle at build time. The plugin makes no network requests, ever.

## Why everything is inlined

`manifest.json` declares `networkAccess.allowedDomains: ["none"]`. There is nowhere to fetch assets from at runtime, by design — and a joke plugin that phoned home for its own sprites would be a worse plugin regardless.

Inlining means one self-contained file, no loading states, no failure modes. The cost is bundle size. A current build reports:

```
assets: ICONS 9 files 330kb, W93 74 files 117kb, W93_SOUNDS 32 files 222kb
dist/main.js  12.4kb
dist/ui.html  912kb
```

~669kb of raw assets becomes ~912kb of `ui.html`, base64 costing the expected ~33%.

One line in that report is worth staring at: **the 9 menu icons are the single largest thing in the bundle** — bigger than all 74 sprite files put together, at nearly 3:1. They are half the payload. See [the icons are oversized](#the-icons-are-oversized-and-the-wrong-colour-type).

This used to be worse. Two legacy maps, `SHEETS` and `SOUNDS`, were inlined alongside these three and referenced by nothing; removing them took `dist/ui.html` from 1505kb to 912kb.

## The three asset maps

`generateAssets()` in `scripts/build.mjs` walks each directory and emits one `Record<string, string>` of data URIs.

| Export | Source | Types | Nested | For |
| --- | --- | --- | --- | --- |
| `ICONS` | `assets/icons/` | `.png` | no | menu tiles |
| `W93` | `ref/w93/` | `.png` | yes | every sprite |
| `W93_SOUNDS` | `ref/w93/` | `.ogg` | yes | every sound |

**Keys are the path minus the extension, directory included** — `0-hammer/hit-3`. The directory is not cosmetic: every weapon has its own `hit-1`, and a flat namespace would have nine of them silently overwrite each other. Nesting is one level deep, which is all the rip needs.

**Images and audio are separate maps** even though they read the same directory. Upstream names a mark and its sound identically: `0-hammer/hit-1.png` is a crack and `0-hammer/hit-1.ogg` is the thud it makes. Since the extension is stripped from the key, one map would collide. The build throws on a duplicate key rather than emitting invalid TypeScript with an arbitrary winner.

Mime is mapped per extension rather than per group, so a new asset type is one line rather than a new group. `MIME` currently knows `.png` and `.ogg`; that is everything the rip contains.

**Whole directories, not a curated list.** Drop a sheet into `ref/w93/<weapon>/` and it is available as a key with no build change, which is what makes [adding a weapon](weapons.md#adding-a-weapon) as light as it is. The tradeoff is that unreferenced files ride along — see below.

### What happened to `SHEETS` and `SOUNDS`

Two further maps used to be inlined here, from the earlier J-Puls rip: `SHEETS`
(`ref/sprites/`) and `SOUNDS` (`ref/sounds/`). Both are gone from the build.

They were unreachable rather than merely redundant. Every key in `src/shared/weapons/` is a
nested `<n>-<weapon>/<name>` path, and neither legacy map contained one — their keys are
flat (`hammer-ss`, `glass-f1`, `w93-hammer-hit-8`). The UI reached them only through a
`W93[key] ?? SHEETS[key]` fallback whose right-hand side could never be taken.

Removing them cost 593kb of bundle and nothing else. The lookups were inlined to direct
`W93[…]` / `W93_SOUNDS[…]` reads at the same time, since a one-line wrapper with nothing
left to fall back to is just indirection.

**The directories are still on disk under `ref/`, deliberately.** `ref/sprites/` is the
only place some of the older art exists, and `ref/` is reference material. They are simply
not *inlined* any more. If you need something from them, move it into
`ref/w93/<weapon>/` and it becomes a key.

One casualty worth knowing about, in case it reappears: `ref/sprites/null.png` produced a
literal `"null"` key in `SHEETS`, which is exactly the sort of thing that reads as a bug in
whatever consumes it. It died with the map.

**`.webm` came out of the `MIME` map at the same time**, because `ref/sounds/` was its only
source. Four `.webm` files are still on disk there — `hammer_1`, `hammer_2`, `machinegun`,
`stamp` — and they are now unreferenced by anything. Files of a type the build no longer
recognises reads like an oversight, so to be explicit: it is not one. If you ever want one
of those sounds back, convert it to `.ogg` and put it in `ref/w93/<weapon>/`, or add
`'.webm': 'audio/webm'` back to `MIME` — but note the build **throws** on two files
collapsing to the same key, so a `press.webm` beside a `press.ogg` in one directory would
fail the build rather than silently pick one.

## The pipeline

```
assets/icons-src/*.png              ref/w93/<weapon>/*.png + *.ogg
  (source art, 9 weapons)             (the rip: sheets, stills, sounds)
         │
         │  npm run assets  (manual, ImageMagick)
         ▼
   assets/icons/*.png
   assets/cursors/*.png + metrics.json
         │                            │
         └──────────────┬─────────────┘
                        │  npm run build  → generateAssets()
                        ▼
              src/generated/assets.ts
              ICONS / W93 / W93_SOUNDS
                        │
                        │  imported by the UI only
                        ▼
              dist/ui.html  (~912kb, self-contained)
                        │
                        │  at runtime: slice sheets, bake tints
                        ▼
              FramePayload[] → main → figma.createImage
```

Two stages run at different times:

- **`npm run assets`** is manual and occasional. It needs ImageMagick, so it is deliberately not part of the build — a fresh clone must be buildable without it. Its output is committed.
- **`npm run build`** regenerates `src/generated/assets.ts` on every run. That file is gitignored: it is derived, large, and would poison every diff.

A third stage happens at **runtime**, not build time: sheet slicing and hue baking. Both need a canvas, so both live in the UI and run once at startup. See [Crossing the boundary](#crossing-the-boundary).

## The two generated icon sets

`scripts/normalize-icons.sh` derives two sets from the same nine source PNGs, for different consumers:

| Output | Shape | For |
| --- | --- | --- |
| `assets/icons/` | 256x256 canvas, content trimmed and centred, longest edge at 224 | Drop-in tiles for the 3x3 menu grid |
| `assets/cursors/` | Tight-trimmed, longest edge at 160, no padding | Intended for the canvas-following weapon node |

The menu needs uniform tiles or the grid jitters — hence a fixed canvas with 16px of breathing room. The cursor set needs *true content bounds*, because padding would make a per-weapon offset meaningless.

`-trim` keys on alpha > 0, so soft shadows and antialiased edges survive the crop rather than being shaved off.

`assets/icons-src/` is the source of truth and is never written to. The script `rm -rf`s both derived directories and rebuilds them, so it is safely re-runnable.

### The icons are oversized and the wrong colour type

The nine menu icons are **half the bundle** — 330kb against 117kb for all 74 sprite files —
and both reasons are fixable in `normalize-icons.sh`:

- **Oversized.** They are 256x256, rendered into a 74x38 CSS box at 2x, so about 148x76
  device pixels. They carry several times the resolution they can possibly show.
- **Wrong colour type.** They are 8-bit **truecolour RGBA** (PNG colour type 6), 25–40kb
  each. This is indexed-palette pixel art with a handful of colours in it; a palette PNG
  would be a fraction of the size at identical fidelity.

Palettising and downscaling them is the single easiest remaining win in the bundle, and
`npm run assets` is where it would go. Nobody has done it, and note that shrinking them
interacts with the aspect-ratio issue below — decide the target box first, then resize once.

### Known issue: the square canvas fights the menu band

`assets/icons/` is normalized to a **256x256 square** canvas. The menu renders it into a `74x38` box with `object-fit: contain`:

```css
.cell img { width: 74px; height: 38px; object-fit: contain; }
```

`contain` on a square source in a 2:1 box is constrained by the **shorter** axis, so every icon renders 38x38 and the band's 74px of width is never used. Worse, a wide weapon loses twice: the chain-saw's content is ~2.8:1 inside its square canvas, so it lands at roughly 38x14 in a box with room for 74x38 — well under half the available width.

The CSS comment at that rule reasons about icons that "keep their own aspect", which describes `assets/cursors/` — the set that is *not* inlined. The set actually loaded is uniformly square.

Two ways out, depending on which the menu wants:

- Have `normalize-icons.sh` emit menu tiles on a **74x38-proportioned** canvas (e.g. `-extent 448x224`) so `contain` fills the band, or
- keep the square canvas and size the `img` box square (`38x38`), centred in the band — closer to the original, which had square-ish icons.

Either is a change to the menu's measured geometry, so it wants checking against the reference screenshot rather than being applied blind. Whichever box the menu settles on is also the input to [shrinking the icons](#the-icons-are-oversized-and-the-wrong-colour-type), so it is worth deciding this first.

### The cursors set is currently unused

Neither `assets/cursors/*.png` nor `metrics.json` is inlined by the build or read by any code. The weapon node takes its dimensions from sprite-sheet cell geometry in the weapon files instead, since the on-canvas weapon has to be a *frame of the animated sheet*, not a static icon — a static hammer cannot rear back and strike.

`metrics.json`'s content-centre hotspots remain a useful starting guess when tuning a new weapon's `cursorOffset` by hand. The set is kept for that, and because the script generates both in one pass.

## Formats

Everything in `ref/w93/` is PNG, and everything the UI hands across is PNG. There is no
format conversion step, and nothing to worry about — but two constraints are worth knowing
before adding art:

**`figma.createImage()` accepts PNG, JPEG and GIF only.** Not WebP. Nothing in the current
rip is WebP, so this costs nothing today; it is the reason to check before dropping a
modern export into `ref/w93/`.

**Frames come out of a canvas because they were sliced, not to convert them.** A sheet has
to be cut into cells somehow, and the only tool for that in an iframe is a canvas, so
`canvas.toBlob('image/png')` is simply how the pieces get back out. Tinted stills go the
same way for the same reason — the hue rotation happens on the canvas.

**Whole stills skip the canvas entirely.** `passThrough()` decodes the base64 and forwards
the original bytes untouched: they are already PNG, already the right size, and re-encoding
them would only cost time and risk.

Canvas smoothing is disabled wherever a canvas is involved. These are hard-edged pixel art,
and smoothing them in transit would sand off exactly the crudeness the port is preserving.

Sounds are Ogg Vorbis and are played by `<audio>` in the iframe, which handles them
natively. Only images go through `createImage`.

## Crossing the boundary

The main thread never sees a data URI. It has no base64 decoder and no canvas, so:

1. UI decodes each data URI to bytes
2. UI slices sheets into individual cells on canvas — `frames` columns x `states` rows
3. UI bakes one hue-rotated copy per `tints` angle, for weapons that declare them
4. UI re-encodes each frame to PNG
5. UI posts raw `Uint8Array` bytes across as `FramePayload[]`
6. Main calls `figma.createImage()` once per frame and keeps the hash

`Uint8Array` survives `postMessage` — Figma structured-clones the payload, so bytes do not need base64-ing a second time to make the trip.

Canvas smoothing is disabled throughout. These are hard-edged pixel art, and smoothing them in transit would sand off exactly the crudeness the port is preserving.

**Hue rotation happens here rather than on the node** because an image fill has no hue control: `ImagePaint.filters` offers saturation and temperature, neither of which can turn magenta into green. Baking a handful of recoloured copies at startup costs a few small uploads and then nothing at all per impact.

**One bad sheet does not sink the rest.** Slicing is wrapped per sheet, and a tint failure is caught per angle. A sheet that throws costs its own weapon some art; letting it reject the whole batch would leave the main thread with no frames at all, answering "sprites are still loading" forever.

## Build output

Two artifacts, built in parallel, with different constraints:

**`dist/main.js`** — a single IIFE. The plugin sandbox has no module loader, so no imports and no exports can survive; `format: 'iife'` with `bundle: true` is not optional.

**`dist/ui.html`** — one self-contained file. The manifest's `ui` field must point at a single HTML file, which Figma inlines as the `__html__` global. So the UI build writes to memory (`write: false`) and a small esbuild plugin splices the JS and CSS into `src/ui/index.html` at its `/*__JS__*/` and `/*__CSS__*/` markers.

Those splices use **function replacers**, not string replacements — `$&` and `$1` sequences occur naturally inside base64 payloads and minified output, and a string replacement would interpret them as regex backreferences and silently corrupt the bundle.

Dev builds (`npm run dev`, or `--dev`) skip minification and inline a sourcemap for `main.js`.
