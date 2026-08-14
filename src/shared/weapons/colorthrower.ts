import type { Weapon } from './types';

/**
 * Color-thrower
 *
 * Upstream config (desktop-destroyer-ref/DesktopDestroyer.js):
 *   COMMENTED OUT upstream. Its declared config was: cursorUpRate: 200, cursorUpFrames: 4, cursorDownFrames: 0, fireFrames: 20 (hits was itself commented, but 5 hit sprites exist)
 *
 * Also commented out upstream, also fully spriteable. Five hit marks exist even
 * though upstream's `hits` line was commented, which is the best evidence for 5.
 *
 * The 4-frame idle cursor at 200ms is the slowest cycle of any weapon — the paint
 * gun visibly changes colour at rest, so getting the frame order right matters more
 * here than elsewhere.
 *
 * The marks it leaves get their variety from `tints`, not from the sprites: all five
 * splats ship with one identical palette. See the note on that field.
 *
 * Sprite geometry below is measured from the real files in ref/w93/4-color-thrower/ and is
 * not guesswork. `fireRateMs`, `minTravel` and `dispersion` ARE tuning values and
 * are the ones to change if this weapon feels wrong.
 */
export const colorthrower: Weapon = {
  id: 'colorthrower',
  slot: 5,
  label: '5: Color-thrower',
  icon: '5-colorthrower',

  // Slow and widely spaced, unlike the flame thrower it shares geometry with. A 128px
  // splat laid down every 16px was a solid band of paint that read as one smear; at 95px
  // the splats overlap at their edges and stay legible as individual throws.
  fireRateMs: 200,
  minTravel: 95,
  dispersion: 10,
  cursorUpRateMs: 200,
  // Same sheet geometry as the flame thrower, byte for byte, so the same nozzle tip
  // and the same reasoning — see that file. {0,0} was the unshipped default.
  cursorOffset: { x: -107, y: -110 },

  // hit.ogg (0.43s) is the paint splat, and `hit` is upstream's per-impact slot — the
  // exact thing this model triggers, and at a 200ms fire rate it comfortably finishes
  // before the next splat lands. press.ogg is the trigger pull, played once on
  // mouse-down upstream; retriggered per impact it would ratchet, so it stays out.
  sounds: ['4-color-thrower/hit'],

  art: {
    cursorUp: { key: '4-color-thrower/cursor-release', frames: 4, states: 1, cellW: 319, cellH: 255 },
    cursorDown: null,
    hits: [
      '4-color-thrower/hit-1',
      '4-color-thrower/hit-2',
      '4-color-thrower/hit-3',
      '4-color-thrower/hit-4',
      '4-color-thrower/hit-5',
    ],
    /**
     * Eight hues, giving 5 splats x 8 colours = 40 distinct marks.
     *
     * Necessary because all five hit sprites share one identical five-colour palette —
     * magenta (149,34,140), red, black and white — so without this the "colour thrower"
     * throws five *shapes* in exactly the same colour, which is the one thing its name
     * promises it will not do.
     *
     * Hue rotation rather than a recolour: black outline and white highlight have no
     * saturation, so they are left untouched while the magenta and red sweep round the
     * wheel. Evenly spaced at 45 degrees.
     *
     * 0 is listed because this array is also what a hit draws its angle from, and with
     * `tintSaturation` set it is not a no-op — it is the unrotated hue at full strength.
     * Leave it out and the original magenta is the one colour never thrown.
     */
    tints: [0, 45, 90, 135, 180, 225, 270, 315],
    // The shipped magenta is (149,34,140) — muted enough that eight rotations of it
    // produced eight muted colours. 2.2 pushes them to poster paint, which is what a
    // weapon called the colour thrower should be throwing.
    tintSaturation: 2.2,
    hitSize: 128,
  },
};

export default colorthrower;
