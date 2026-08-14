import type { Weapon } from './types';

/**
 * Chain-saw
 *
 * Upstream config (desktop-destroyer-ref/DesktopDestroyer.js):
 *   cursorOffset: {-95,-95}, fireRate: 50, fireLoop: true, cursorUpFrames: 2, cursorDownFrames: 2, cursorDownStates: 8, killMargin: 25,
 *   drops: {centered: true, count: 5, gravity: 4, drop: [2,5], velocityX: [-10,10], velocityY: [0,-10]}, sounds: {press: {loop}, release: {loop}}
 *
 * THERE ARE NO hit-*.png FOR THIS WEAPON. Upstream's chain-saw marks the desktop with
 * two things at once: a scribble of 2x2 black rects along the cursor's path — the cut
 * itself — and drop-1..5 (31x31) thrown clear as short-lived sawdust falling under
 * gravity. Both are here, but neither literally.
 *
 * The cut is `art.cut`, one rotated rectangle per cursor sample joined end to end,
 * rather than a 2px rect per interpolated point — which would be hundreds of nodes per
 * drag. It adds up to the same black slot for about a thirtieth of the cost.
 *
 * The sawdust is the debris chips, used as ordinary hit marks: nothing in this plugin
 * animates a mark after it lands, so they are scattered along the cut and left where
 * they fall. Same art, same sawdust, minus the gravity.
 *
 * That makes `dispersion` do the work `velocityX/Y` did upstream: 14 is roughly half a
 * chip, wide enough that a drag reads as a ragged cut rather than a dotted line, and
 * `minTravel` stays low so the chips overlap into a continuous trail.
 *
 * cursorDown is the only 2-D sheet in the set: 2 frames x 8 states, and both axes are
 * driven. The frames are the blade, cycled on the firing tick. The states are the eight
 * compass headings, and `main/damage.ts:aimCursor` picks one from the direction the
 * cursor is travelling, so the saw points along the cut instead of always facing right.
 * Row order and the 4px per-axis deadzone that stops a resting hand shivering the blade
 * between neighbours are both upstream's, taken from `hit()` — the rows mean whatever
 * the artist drew them to mean, so they are not ours to renumber.
 *
 * Only the firing sheet has headings; cursor-release is 2 frames x 1 state, and the saw
 * keeps its last heading across the swap so resuming a cut does not snap it east.
 *
 * Sprite geometry below is measured from the real files in ref/w93/1-chain-saw/ and is
 * not guesswork. `fireRateMs`, `minTravel` and `dispersion` ARE tuning values and
 * are the ones to change if this weapon feels wrong.
 */
export const chainsaw: Weapon = {
  id: 'chainsaw',
  slot: 2,
  label: '2: Chain-saw',
  icon: '2-chainsaw',

  fireRateMs: 60,
  minTravel: 12,
  dispersion: 14,
  cursorUpRateMs: 120,
  cursorOffset: { x: -95, y: -95 },

  // Both of the saw's sounds are loops upstream, held down for as long as the button
  // is. The rev takes the loop path and simply runs while you cut — retriggering its
  // 1.51s per chip only ever played the first 250ms, sixteen times a second, which is a
  // buzz rather than a saw. `release` is the wind-down and stays unused: it wants a real
  // mouse-up, and there is none to key it to.
  sustain: '1-chain-saw/press',

  art: {
    cursorUp: { key: '1-chain-saw/cursor-release', frames: 2, states: 1, cellW: 191, cellH: 191 },
    cursorDown: { key: '1-chain-saw/cursor-press', frames: 2, states: 8, cellW: 191, cellH: 191 },
    hits: [
      '1-chain-saw/drop-1',
      '1-chain-saw/drop-2',
      '1-chain-saw/drop-3',
      '1-chain-saw/drop-4',
      '1-chain-saw/drop-5',
    ],
    // The chips really are 31x31. Drawn any larger they stop being sawdust and become
    // blobs — the same mistake the machine gun's 16x16 holes were making at 150.
    // The kerf. Upstream's saw scribbles a black slot along the path as it cuts, and
    // without it the weapon reads as "sprays chips" rather than "cuts". 6px is a little
    // under a third of the 31px chips, so the chips still read as debris thrown clear of
    // a slot rather than as beads on a wire.
    cut: { width: 6 },
    hitSize: 31,
  },
};

export default chainsaw;
