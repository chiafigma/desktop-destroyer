import type { Weapon } from './types';

/**
 * Washing
 *
 * Upstream config (desktop-destroyer-ref/DesktopDestroyer.js):
 *   cursorOffset: {-63,-63}, fireRate: 50, fireLoop: true, hits: 4, dispersion: 30, cursorDownFrames: 3, sounds: {press: {loop: true}}
 *
 * Dispersion 30 is by far the highest in the set — the washer sprays wide rather
 * than striking a point.
 *
 * Shares its cursor sheet geometry exactly with the phaser (383x319, 1 idle frame,
 * 3 firing frames); both are the same blue gun body.
 *
 * Worth considering: in the original this tool *cleans*. Whether "washing" should
 * add soap marks or actually remove damage nodes underneath it is a real design
 * choice, and removal would be the more delightful one.
 *
 * Sprite geometry below is measured from the real files in ref/w93/8-washing/ and is
 * not guesswork. `fireRateMs`, `minTravel` and `dispersion` ARE tuning values and
 * are the ones to change if this weapon feels wrong.
 */
export const washing: Weapon = {
  id: 'washing',
  slot: 9,
  label: '9:Washing',
  icon: '9-washing',

  fireRateMs: 60,
  minTravel: 16,
  dispersion: 30,
  cursorUpRateMs: 0,
  cursorOffset: { x: -63, y: -63 },

  // Deliberately silent, not an oversight. press.ogg is the only sound this weapon
  // has, and upstream declares it `{loop: true}` — a sustained spray held down while
  // you scrub and stopped on release, not a per-impact hit. So it takes the loop path:
  // 1.47s of spray running continuously while you scrub, stopping a quarter second
  // after you stop. As a one-shot it restarted 240ms in, ~16 times a second — the first
  // sixth of a spray loop, stuttering. The stamp's press survives that treatment and
  // this one does not, which is the difference between a one-shot and a loop.
  sustain: '8-washing/press',

  art: {
    cursorUp: { key: '8-washing/cursor-release', frames: 1, states: 1, cellW: 383, cellH: 319 },
    cursorDown: { key: '8-washing/cursor-press', frames: 3, states: 1, cellW: 383, cellH: 319 },
    hits: [
      '8-washing/hit-1',
      '8-washing/hit-2',
      '8-washing/hit-3',
      '8-washing/hit-4',
    ],
    hitSize: 128,
  },
};

export default washing;
