import type { Weapon } from './types';

/**
 * Phaser
 *
 * Upstream config (desktop-destroyer-ref/DesktopDestroyer.js):
 *   cursorOffset: {-63,-63}, stopOnRelease: false, fireRate: 75, fireLoop: 2, hits: 10, cursorDownFrames: 3, sounds: {press: 1}
 *
 * `fireLoop: 2` means the firing animation runs exactly twice per trigger rather
 * than looping indefinitely, and `stopOnRelease: false` means it finishes that
 * animation even after the button is released. Neither has an equivalent here yet.
 *
 * Ten hit marks at 128x128 — the widest variety of any weapon.
 *
 * Sprite geometry below is measured from the real files in ref/w93/5-phaser/ and is
 * not guesswork. `fireRateMs`, `minTravel` and `dispersion` ARE tuning values and
 * are the ones to change if this weapon feels wrong.
 */
export const phaser: Weapon = {
  id: 'phaser',
  slot: 6,
  label: '6: Phaser',
  icon: '6-phaser',

  fireRateMs: 320,
  minTravel: 80,
  dispersion: 0,
  cursorUpRateMs: 0,
  cursorOffset: { x: -63, y: -63 },

  // Upstream's `press: 1` — a plain one-shot, not a loop, and for a phaser the trigger
  // pull *is* the shot. At 1.53s it is long, but minTravel 80 makes sustained fire
  // unlikely and a zap tail layering over the next zap is the right sci-fi texture.
  sounds: ['5-phaser/press'],

  art: {
    cursorUp: { key: '5-phaser/cursor-release', frames: 1, states: 1, cellW: 383, cellH: 319 },
    cursorDown: { key: '5-phaser/cursor-press', frames: 3, states: 1, cellW: 383, cellH: 319 },
    hits: [
      '5-phaser/hit-1',
      '5-phaser/hit-2',
      '5-phaser/hit-3',
      '5-phaser/hit-4',
      '5-phaser/hit-5',
      '5-phaser/hit-6',
      '5-phaser/hit-7',
      '5-phaser/hit-8',
      '5-phaser/hit-9',
      '5-phaser/hit-10',
    ],
    hitSize: 128,
  },
};

export default phaser;
