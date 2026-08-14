import type { Weapon } from './types';

/**
 * Flame-thrower
 *
 * Upstream config (desktop-destroyer-ref/DesktopDestroyer.js):
 *   COMMENTED OUT upstream. Its declared config was: hits: 4, cursorUpRate: 75, cursorUpFrames: 2, cursorDownFrames: 0, fireFrames: 20
 *
 * Upstream never finished this weapon — its entry is commented out in
 * DesktopDestroyer.js. But the sprites shipped anyway, so it is implementable here.
 * The commented config is the only statement of intent; everything else is a guess
 * that wants checking against how it feels.
 *
 * cursorDown is null: cursorDownFrames was 0, so the flame thrower never changes
 * pose. The fire is not in the pose and not in the hit marks either — the marks are
 * the scorch left behind. It is in `art.fire`, the 20-frame fireball that blooms at
 * each impact and then vanishes.
 *
 * Four .ogg files ship in ref/w93/3-flame-thrower/ (fire, flame-begin, flame,
 * flame-end) and all four go unused — see the `sounds` note below.
 *
 * Sprite geometry below is measured from the real files in ref/w93/3-flame-thrower/ and is
 * not guesswork. `fireRateMs`, `minTravel` and `dispersion` ARE tuning values and
 * are the ones to change if this weapon feels wrong.
 */
export const flamethrower: Weapon = {
  id: 'flamethrower',
  slot: 4,
  label: '4: Flame-thrower',
  icon: '4-flamethrower',

  fireRateMs: 70,
  minTravel: 16,
  dispersion: 6,
  cursorUpRateMs: 75,
  // Nozzle tip, measured from the alpha channel of cursor-release.png: the art
  // begins at (101,105) in the 319x255 cell and the tip spans x[101..115] y[105..112].
  // Upstream never shipped this weapon, so {0,0} was the schema default rather than a
  // considered value — and it put the fire 153px up-and-left of the gun, detached in
  // empty canvas. Every weapon upstream *did* ship puts the cursor on the business end.
  cursorOffset: { x: -107, y: -110 },

  // All four of this weapon's sounds are sustained rather than per-impact, so it takes
  // the loop path: `flame` (0.54s) runs continuously while the trigger is down and
  // stops a quarter second after the fire does. As a one-shot at a 70ms fire rate it
  // restarted mid-tail 14 times a second, which is why this weapon was silent until
  // audio.ts learned to loop.
  //
  // flame-begin and flame-end are the ignition and extinguish bookends. They are not
  // used: they want real press and release events, and inferring those from "impacts
  // started arriving" would fire the ignition again every time you paused mid-drag.
  sustain: '3-flame-thrower/flame',

  art: {
    cursorUp: { key: '3-flame-thrower/cursor-release', frames: 2, states: 1, cellW: 319, cellH: 255 },
    cursorDown: null,
    // Upstream's `fireFrames: 20`, and the sheet is 1260x63 — exactly 20 cells of
    // 63x63, which is the confirmation that the commented config and this file are
    // the same weapon. It grows from a spark to a full fireball over those frames.
    //
    // The sheet is `press.png`, which is why this went missing: `scripts/fetch-w93-assets.mjs`
    // fetched `press.ogg` and `cursor-press.png` but never `press.png`, so the art was
    // absent from the generated map and the weapon had nothing to draw. The hit marks
    // worked the whole time, which made it look like a tuning problem — scorch appears,
    // fire does not — rather than a missing file.
    //
    // `from` and `frameMs` are both departures from upstream, and both exist because the
    // faithful values read as lag. Fraction of the cell each frame actually covers,
    // measured off the alpha channel:
    //
    //   0: 0.000  1: 0.022  2: 0.028  3: 0.035  4: 0.044  5: 0.069  6: 0.103
    //   7: 0.098  8: 0.127  9: 0.157 10: 0.187 11: 0.233 12: 0.315 13: 0.392
    //  14: 0.494 15: 0.527 16: 0.527 17: 0.494 18: 0.392 19: 0.000
    //
    // So the sheet opens on an empty frame, spends its first quarter as a spark under 5%
    // of the cell, and does not peak until frame 15 of 20. At upstream's 50ms that put
    // the fireball on screen 750ms after the impact that caused it, by which point the
    // cursor is ten impacts further along and the fire is visibly trailing the nozzle.
    //
    // `from: 4` drops the blank frame and the three that are nearly one, so something
    // appears on the same tick as the hit rather than 50ms of nothing followed by a
    // speck. `frameMs: 24` then brings the peak in to ~264ms. Together the burst lasts
    // 384ms instead of a full second, which also means fewer are alive at once.
    //
    // These are the knobs for "the fire lags" (lower both) and "the fire is a strobe"
    // (raise frameMs). Neither is measured from anything — unlike the geometry above,
    // they are pure feel.
    fire: {
      sheet: { key: '3-flame-thrower/press', frames: 20, states: 1, cellW: 63, cellH: 63 },
      frameMs: 24,
      from: 4,
    },
    hits: [
      '3-flame-thrower/hit-1',
      '3-flame-thrower/hit-2',
      '3-flame-thrower/hit-3',
      '3-flame-thrower/hit-4',
    ],
    hitSize: 48,

    // The fire has to get there first. Drawn on the same tick as the flame, the scorch
    // wins on every count that matters to the eye — it is near-black against a bright
    // orange, it is at full size instantly while the fireball spends 264ms growing into
    // one, and it stays. The weapon read as a black marker that happened to flicker.
    //
    // 200ms lands the char just before the flame peaks, so the order you see is fire then
    // aftermath. It also means the scorch trail sits about three impacts behind the
    // nozzle during a drag, which is the fire burning ahead of what it has already
    // blackened — the right way round.
    //
    // If the black is still too dominant, this is the wrong knob to keep turning: past
    // the flame's 384ms life the char just looks disconnected from anything. Reach for
    // `hitSize` (smaller scorches) or `minTravel` (fewer of them) instead.
    hitDelayMs: 200,
  },
};

export default flamethrower;
