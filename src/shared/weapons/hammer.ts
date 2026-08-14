import type { Weapon } from './types';

/**
 * Hammer
 *
 * Upstream config (desktop-destroyer-ref/DesktopDestroyer.js):
 *   hits: 8, dispersion: 4, drops: {count: 5, gravity: 8, ...}, sounds: {hit: 8}
 *
 * Upstream declares no fireRate, because a hammer is one blow per click and it
 * can see clicks. We cannot, so `fireRateMs` is ours to choose.
 *
 * Unused art: drop-1..5 (31x31) are the falling debris that upstream throws with
 * gravity 8, velocityX [-25,25], velocityY [0,-40].
 *
 * Sprite geometry below is measured from the real files in ref/w93/0-hammer/ and is
 * not guesswork. `fireRateMs`, `minTravel` and `dispersion` ARE tuning values and
 * are the ones to change if this weapon feels wrong.
 */
export const hammer: Weapon = {
  id: 'hammer',
  slot: 1,
  label: '1: Hammer',
  icon: '1-hammer',

  fireRateMs: 160,
  minTravel: 55,
  dispersion: 4,
  cursorUpRateMs: 0,
  cursorOffset: { x: 0, y: 0 },

  // All eight, exactly as upstream (`sounds: {hit: 8}`, chosen with randomItem).
  // This is the one weapon the pick-one-at-random model was made for: eight distinct
  // 0.5-1.1s impacts, one blow each, so repeated blows never sound like a loop.
  sounds: [
    '0-hammer/hit-1',
    '0-hammer/hit-2',
    '0-hammer/hit-3',
    '0-hammer/hit-4',
    '0-hammer/hit-5',
    '0-hammer/hit-6',
    '0-hammer/hit-7',
    '0-hammer/hit-8',
  ],

  art: {
    cursorUp: { key: '0-hammer/cursor-release', frames: 1, states: 1, cellW: 111, cellH: 159 },
    cursorDown: { key: '0-hammer/cursor-press', frames: 1, states: 1, cellW: 73, cellH: 159 },
    hits: [
      '0-hammer/hit-1',
      '0-hammer/hit-2',
      '0-hammer/hit-3',
      '0-hammer/hit-4',
      '0-hammer/hit-5',
      '0-hammer/hit-6',
      '0-hammer/hit-7',
      '0-hammer/hit-8',
    ],
    hitSize: 64,
  },
};

export default hammer;
