# Protocol

Every message crossing the UI ↔ main boundary. Defined in `src/shared/protocol.ts`,
discriminated on `type`.

Both handlers currently switch on every variant of their union, and neither has a
`default` branch.

That exhaustiveness is a convention, not a guarantee: both handlers return `void` (main's
returns a `Promise<void>`, since `clear-damage` is async), so TypeScript will **not** flag
a variant you forget to handle. `noFallthroughCasesInSwitch` (on in `tsconfig.base.json`)
catches accidental fallthrough between cases, which is a different mistake. If you add a
message type, check the receiving switch yourself — or add a `default` that assigns the
message to `never`, which would make the compiler enforce it.

## UI → main

Sent via `parent.postMessage({ pluginMessage }, '*')`, received by `figma.ui.onmessage`.

| Message | Payload | Meaning |
| --- | --- | --- |
| `ui-ready` | — | Menu is built. Currently a no-op on main; a handshake point if startup ever needs sequencing. |
| `sprites` | `frames: FramePayload[]` | Sent **once**, after the UI has decoded, sliced and hue-baked every sheet. Main uploads each frame and stores its hash. Nothing can fire before this arrives. |
| `arm` | `weaponId: string` | Arm a weapon. Main validates and replies `armed` or `error`. |
| `disarm` | — | Put the weapon down. Stops the poll loop unless probing. |
| `clear-damage` | — | Remove every mark the plugin has ever left in the document. Handled asynchronously. |
| `probe` | `on: boolean` | Toggle diagnostics. Starts the poll loop even when unarmed, so the cursor channel can be measured on a clean canvas. |

There is no `close` message. The plugin has no quit control of its own — Figma's own
window chrome closes it, and `figma.on('close')` is where teardown happens.

## Main → UI

Sent via `figma.ui.postMessage`, received by a `window` `message` listener that reads
`event.data.pluginMessage`.

| Message | Payload | Meaning |
| --- | --- | --- |
| `armed` | `weaponId: string \| null` | Authoritative armed state. `null` means nothing armed. The UI paints from this, never from its own click. |
| `impact` | `weaponId: string`, `count: number` | Marks landed this sample — **play the sound**. Sent once per firing sample, not once per mark. |
| `damage-count` | `count: number` | Marks currently on canvas. Feeds the diagnostics panel. |
| `probe-stats` | `stats: ProbeStats` | Cursor-tracking measurements, pushed every `PROBE_REPORT_MS` (250ms) while probing. |
| `error` | `message: string` | Something was refused — unknown weapon, no sprites, sprites still loading. The UI logs it to console. |

### Why `armed` is authoritative

The UI never sets its own armed state on click. It sends `arm`/`disarm` and waits to be
told. Main can legitimately refuse — unknown id, not playable, frames not loaded yet — and
a UI that lit the tile optimistically would show a weapon armed that is not.

`armed: null` is also the UI's cue to call `stopSustain()`. Holstering has to silence a
sustained weapon immediately; its watchdog would otherwise run the loop on for another
quarter second after the gun is down.

### Why `impact` exists, and why it carries a count

The plugin sandbox has no audio API. Main detects hits but physically cannot make a sound,
so it tells the UI, which owns the `<audio>` pools.

It fires **once per firing sample**, not once per mark — but a single sample can land up to
`MAX_SHOTS_PER_SAMPLE` (8) marks, and playing one noise for eight rounds does not read as a
burst. So `count` travels with it and the UI staggers that many one-shots by the weapon's
own `fireRateMs`, capped by `MAX_QUEUE_MS` (400) so a flick cannot queue up gunfire that
keeps firing after you have stopped moving.

Sustained weapons ignore `count` entirely — one impact is enough to say "still firing",
which is all the loop's watchdog needs.

## `FramePayload`

```ts
type FramePayload = {
  key: string;
  bytes: Uint8Array;
  w: number;
  h: number;
};
```

`key` takes one of three forms, and the receiving side does not care which:

| Form | Means |
| --- | --- |
| `0-hammer/cursor-release#0,0` | One cell of a sliced sheet — `${key}#${frame},${state}` |
| `0-hammer/hit-3` | A whole still, passed through |
| `4-color-thrower/hit-1@135` | A still re-encoded with its hues rotated 135° |

`bytes` is **always PNG**, which is what `figma.createImage` wants — it accepts PNG, JPEG
and GIF only. Sliced cells and tinted stills are PNG because they came out of a canvas;
whole stills are PNG because the source art is. See [assets.md](assets.md#formats).

`Uint8Array` survives the boundary intact; Figma structured-clones the payload, so there
is no need to base64 it a second time for the trip.

`w`/`h` are the cell dimensions for sliced frames and the image's natural size for tinted
copies, and `0`/`0` for pass-through stills, which are not measured on the way past.
Nothing currently reads them — the main thread sizes nodes from the declared sheet
geometry instead, because it has no decoder to check against.

## `ProbeStats`

```ts
type ProbeStats = {
  ticks: number;             // poll ticks attempted
  selfFound: number;         // ticks where our own ActiveUser entry was found
  positionNonNull: number;   // ticks where position was populated
  positionChanged: number;   // ticks where position differed from the last — the real refresh rate
  effectiveHz: number;       // observed distinct updates per second
  maxJumpPx: number;         // largest gap between consecutive distinct samples
  shotsDropped: number;      // marks the per-sample cap threw away, cumulative
  samplesCapped: number;     // samples in which at least one was thrown away
  lastPosition: { x: number; y: number } | null;
};
```

This type is not instrumentation for its own sake. `figma.activeUsers[].position` has no
event and it was undocumented whether it is populated for the *current* user, or at what
rate. The whole plugin rests on those two facts, so they were measured rather than assumed
— see [architecture.md](architecture.md#measuring-the-assumption).

Two readings are pass/fail for the design:

- `selfFound === 0` → our entry is never in the roster. Plugin cannot work as built.
- `positionNonNull === 0` → entry found but position always null. Same.

Both pass, in Figma Design and in FigJam.

`maxJumpPx` is the tuning input: it is the worst-case distance `plotShots` has to bridge,
and therefore what `MAX_SHOTS_PER_SAMPLE` must be able to cover at a given weapon's
`minTravel`.

`maxJumpPx` ignores jumps ≥ `TELEPORT_PX` (4000), so a viewport jump does not permanently
poison the reading.

### Why dropped marks take two numbers

`MAX_SHOTS_PER_SAMPLE` is the one ceiling in the plugin with no visible symptom. When it
bites, the trail is quietly thinner than the weapon's `minTravel` asked for — and a sparse
line looks exactly like a fast flick, so the canvas gives no hint. `shotsDropped` is the
only place it is observable.

The total alone cannot tell the two interesting cases apart. Forty drops from one freak
flick is fine; forty spread over forty consecutive samples means the ceiling is too low for
ordinary use. So `samplesCapped` travels with it to give the total a scale — the same
pairing as `positionChanged` and `effectiveHz`.

**There is deliberately no percentage.** The obvious denominator, `positionChanged`, counts
while unarmed, when dropping is impossible — so a ratio would read artificially low exactly
when someone opens the probe on a pristine canvas to see whether anything is wrong.

`tracker.noteDropped(count)` is a no-op unless probing, so the firing loop can report every
sample unconditionally, and a zero count does not inflate `samplesCapped`. The panel's
`shots dropped` line only colours itself when the figure is non-zero.

`emptyProbeStats()` is the zero value, used to reset on every probe start — both new fields
included, so a fresh probe never inherits an earlier session's drops.

## Adding a message

1. Add the variant to `UiToMain` or `MainToUi` in `src/shared/protocol.ts`.
2. Handle it in the receiving switch — and check by eye, because the compiler will not
   tell you (see above).
3. Keep payloads structured-clone-safe: no functions, no class instances, no Figma node
   references. Nodes cannot cross the boundary; send ids or plain data.

Note that `protocol.ts` lives in `src/shared/` and so is compiled under **all three**
tsconfigs. It must stay free of DOM types and free of the `figma` global — an
`HTMLImageElement` in a payload type breaks the main build, and a `SceneNode` breaks the
UI build.
