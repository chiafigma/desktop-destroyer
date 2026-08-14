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
 * The marks it leaves get their variety from `paints`, not from the sprites: all five
 * splats ship as the same pure red. See the note on that field.
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
  // splat laid down every 16px was a solid band of paint that read as one smear.
  //
  // 95px was the first attempt at fixing that, and it undershot: splats that overlap by a
  // third still merge into a chain, and because each one is drawn over the last the colour
  // variety is mostly hidden under the next throw. At 150px — just past the 128px splat —
  // they land as separate throws that occasionally kiss, every splat shows its whole
  // shape, and all eight colours are visible at once instead of eight overlapping arcs.
  fireRateMs: 260,
  minTravel: 150,
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
     * Eight poster-paint colours, giving 5 splats x 8 colours = 40 distinct marks.
     *
     * Necessary because all five hit sprites are the same paint in five shapes, which is
     * the one thing this weapon's name promises they will not be. The palette is exactly
     * five colours and only one of them is chromatic:
     *
     *   (255,  0,  0, 255)  the paint — pure red
     *   (149, 34,140,   0)  transparent; the magenta is just this palette's colour key
     *   (  0,  0,  0, 128)  drop shadow
     *   (  0,  0,  0, 255)  outline
     *   (255,255,255, 255)  highlight
     *
     * That second entry is worth dwelling on, because reading it as the paint is what
     * produced the muddy version of this weapon. It has alpha 0 — it is never drawn. The
     * paint was never a muted magenta needing a saturation boost; it was pure red all
     * along, and `tintSaturation: 2.2` was a no-op on it (the saturate matrix clips
     * straight back to 255,0,0). The mud came entirely from `hue-rotate` — see `paints`
     * in the schema.
     *
     * Chosen as a primary/secondary wheel rather than eight even steps of anything: this
     * is a toy about throwing paint, so the reference is a paintbox, and the colours that
     * read as paint are the ones a paintbox has. Red is kept as shipped so the original
     * splat is still in the set.
     */
    paints: [
      'ff0000', // red
      'ff7a00', // orange
      'ffdd00', // yellow
      '2bd600', // green
      '00b4ff', // sky
      '1040ff', // blue
      '9b1fff', // violet
      'ff00a0', // magenta
    ],
    hitSize: 128,
  },
};

export default colorthrower;
