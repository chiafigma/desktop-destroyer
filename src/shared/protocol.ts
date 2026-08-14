/** Messages across the UI <-> main boundary. Discriminated on `type`. */

/** One decoded, sliced sprite frame, ready for figma.createImage. */
export type FramePayload = {
  /** `${sheetKey}#${frameIndex}`, or just `${key}` for single-image residue. */
  key: string;
  /** PNG bytes. Every source image is already a PNG, so sliced and tinted frames come
   *  back out of the canvas as PNG and whole stills are passed through untouched.
   *  `figma.createImage` accepts PNG, JPEG and GIF only — a constraint to respect if the
   *  art ever changes, rather than one anything currently runs up against. */
  bytes: Uint8Array;
  w: number;
  h: number;
};

export type UiToMain =
  | { type: 'ui-ready' }
  /** Sent once at startup, after the UI has sliced every sheet. */
  | { type: 'sprites'; frames: FramePayload[] }
  | { type: 'arm'; weaponId: string }
  | { type: 'disarm' }
  | { type: 'clear-damage' }
  | { type: 'probe'; on: boolean };

export type MainToUi =
  | { type: 'armed'; weaponId: string | null }
  /** Impact notification so the UI can play the sound effect; main has no audio.
   *  `count` is how many marks landed in this sample — several can land between two
   *  cursor samples, and a burst that makes a single noise does not read as a burst. */
  | { type: 'impact'; weaponId: string; count: number }
  | { type: 'damage-count'; count: number }
  | { type: 'probe-stats'; stats: ProbeStats }
  | { type: 'error'; message: string };

/**
 * Spike output. `activeUsers[].position` has no event — it must be polled — and it
 * is undocumented whether it is populated for the *current* user, or at what rate
 * it refreshes. Everything downstream rests on those two facts, so we measure them
 * rather than assume them.
 */
export type ProbeStats = {
  /** Poll ticks attempted. */
  ticks: number;
  /** Ticks where our own ActiveUser entry was found at all. */
  selfFound: number;
  /** Ticks where position was non-null (cursor was over the canvas). */
  positionNonNull: number;
  /** Ticks where position differed from the previous tick — the true refresh rate. */
  positionChanged: number;
  /** Observed distinct-position updates per second. */
  effectiveHz: number;
  /** Largest jump between consecutive distinct samples, canvas px. Drives how much
   *  interpolation a continuous trail needs. */
  maxJumpPx: number;
  /** Impacts `MAX_SHOTS_PER_SAMPLE` threw away, cumulative. The cap exists so one
   *  enormous jump cannot ask for a hundred nodes inside a single tick, but when it
   *  bites the trail is quietly thinner than the weapon's `minTravel` asked for, and
   *  the canvas gives no hint: a sparse line looks exactly like a fast flick. This is
   *  the only place that ceiling is observable. */
  shotsDropped: number;
  /** Samples in which at least one impact was thrown away. The total on its own cannot
   *  tell one freak flick apart from a cap that bites on every other sample, and only
   *  the second means the ceiling is set too low for ordinary use — so, as with
   *  `positionChanged` and `effectiveHz`, the raw count travels with the figure that
   *  gives it a scale. */
  samplesCapped: number;
  lastPosition: { x: number; y: number } | null;
};

export function emptyProbeStats(): ProbeStats {
  return {
    ticks: 0,
    selfFound: 0,
    positionNonNull: 0,
    positionChanged: 0,
    effectiveHz: 0,
    maxJumpPx: 0,
    shotsDropped: 0,
    samplesCapped: 0,
    lastPosition: null,
  };
}
