import type { Weapon } from './types';

/**
 * Machine gun
 *
 * Upstream config (desktop-destroyer-ref/DesktopDestroyer.js):
 *   fireRate: 65, fireLoop: true, hits: 4, dispersion: 9, cursorDownFrames: 2, fireFrames: 14, killMargin: 25, drops: {offset:{x:130,y:80}, frames:8, ...}
 *
 * hitSize is 16, not the 150 this plugin used before. The bullet holes really are
 * 16x16 — drawing them at 150 is what made them read as enormous smudges.
 *
 * Unused art: drop.png is a 504x63 sheet, 8 frames of 63x63 — spent brass, thrown
 * from offset {130,80}. drop-1..9.ogg are its clatter, and go unused with it.
 *
 * Sprite geometry below is measured from the real files in ref/w93/2-machine-gun/ and is
 * not guesswork. `fireRateMs`, `minTravel` and `dispersion` ARE tuning values and
 * are the ones to change if this weapon feels wrong.
 */
export const machinegun: Weapon = {
  id: 'machinegun',
  slot: 3,
  label: '3: Machine gun',
  icon: '3-machinegun',

  fireRateMs: 110,
  minTravel: 40,
  dispersion: 9,
  cursorUpRateMs: 0,
  cursorOffset: { x: 0, y: 0 },

  // Just the gunshot — 0.09s, which is why it survives a 110ms fire rate cleanly.
  // Deliberately NOT drop-1..9: upstream plays those when a spent-brass particle
  // lands, not when the gun fires, and this port throws no brass. Folding nine
  // clatters into a one-of-N impact pool would make a burst sound like dropped
  // cutlery. release.ogg is a 0.8s mouse-up tail and there is no release event here.
  //
  // Trimmed hardest of the one-shots: at 110ms this stacks four deep in a burst, and
  // the sample is a short hard crack with all its energy in the transient.
  volume: 0.7,
  sounds: ['2-machine-gun/hit'],

  art: {
    cursorUp: { key: '2-machine-gun/cursor-release', frames: 1, states: 1, cellW: 191, cellH: 191 },
    cursorDown: { key: '2-machine-gun/cursor-press', frames: 2, states: 1, cellW: 191, cellH: 191 },
    hits: [
      '2-machine-gun/hit-1',
      '2-machine-gun/hit-2',
      '2-machine-gun/hit-3',
      '2-machine-gun/hit-4',
    ],
    hitSize: 16,
  },
};

export default machinegun;
