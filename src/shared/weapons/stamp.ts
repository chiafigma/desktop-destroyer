import type { Weapon } from './types';

/**
 * Stamp
 *
 * Upstream config (desktop-destroyer-ref/DesktopDestroyer.js):
 *   cursorOffset: {-48,-209}, hits: 10, sounds: {press: 1}
 *
 * The most extreme cursorOffset in the set: {-48,-209}. The stamp is a tall
 * sprite held at its base, so the artwork sits almost entirely *above* the cursor,
 * with the rubber face at the bottom where the mark lands. Get this wrong and the
 * stamp appears to print from its handle.
 *
 * Ten marks, and they are the joke ones — the red circles, "O.K.", the rabbit.
 *
 * Sprite geometry below is measured from the real files in ref/w93/6-stamp/ and is
 * not guesswork. `fireRateMs`, `minTravel` and `dispersion` ARE tuning values and
 * are the ones to change if this weapon feels wrong.
 */
export const stamp: Weapon = {
  id: 'stamp',
  slot: 7,
  label: '7: Stamp',
  icon: '7-stamp',

  fireRateMs: 260,
  minTravel: 130,
  dispersion: 0,
  cursorUpRateMs: 0,
  cursorOffset: { x: -48, y: -209 },

  // Upstream's `press: 1`, and the stamp's press is literally the thunk of rubber on
  // desk — a one-shot impact sound in all but name. 0.71s against a 260ms fire rate
  // and the set's highest minTravel (130) means it rarely overlaps more than twice.
  sounds: ['6-stamp/press'],

  art: {
    cursorUp: { key: '6-stamp/cursor-release', frames: 1, states: 1, cellW: 255, cellH: 255 },
    cursorDown: { key: '6-stamp/cursor-press', frames: 1, states: 1, cellW: 255, cellH: 255 },
    hits: [
      '6-stamp/hit-1',
      '6-stamp/hit-2',
      '6-stamp/hit-3',
      '6-stamp/hit-4',
      '6-stamp/hit-5',
      '6-stamp/hit-6',
      '6-stamp/hit-7',
      '6-stamp/hit-8',
      '6-stamp/hit-9',
      '6-stamp/hit-10',
    ],
    hitSize: 96,
  },
};

export default stamp;
