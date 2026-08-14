import type { Weapon } from './types';

/**
 * Termites
 *
 * Upstream config (desktop-destroyer-ref/DesktopDestroyer.js):
 *   cursorOffset: {-30,-55}, cursorUpRate: 150, cursorUpFrames: 3
 *
 * THERE ARE NO hit-*.png FOR THIS WEAPON, because upstream's termites are not marks —
 * they are autonomous entities. It declares no fireRate, so it takes the default of 1
 * and spawns a termite on every fire tick, walks all of them on a 180ms timer, and lets
 * any other weapon kill the ones inside its killMargin.
 *
 * We do the same, and it is the most expensive thing this plugin does: moving a termite
 * node is a document mutation, the tick doing the moving is the same tick that has to
 * keep polling your cursor, and every step syncs to everyone else in the file. It earns
 * its cost because a termite that does not move is not a termite, it is a sticker.
 *
 * termite.png is 62x248: a 2x8 grid of 31x31 cells. The eight rows are four headings
 * (right, up, left, down) x two postures — rows 0-3 are the stopped bug and rows 4-7
 * the walking one, which is what upstream's `setState()` is choosing between. The two
 * columns are the leg animation. The crawl loop uses all sixteen: rows 4-7 while a bug
 * is walking, rows 0-3 when it settles, both columns alternating as legs. That full
 * coverage is worth stating, because the chain-saw's sheet is the same 2x8 shape and
 * only ever draws state 0 — the waste is there, not here.
 *
 * dead-termite.png (32x32) is the corpse upstream draws over a kill. It is listed in
 * `hits` but is NOT currently drawn: a crawling weapon spawns from `extraSheets` rather
 * than picking a hit, so nothing reaches it. It stays listed as the honest inventory of
 * this weapon's art, and because a corpse wants a reason to exist — something has to do
 * the killing — which this port does not have yet.
 *
 * They also WALK. `crawl: true` hands each new bug to the crawl loop in main/damage.ts,
 * which steps it 4px every 140ms, turns it every few steps, and cycles the two leg
 * frames — using the same heading/posture rows described above, which is the whole
 * reason this is affordable: no art has to be generated, only chosen.
 *
 * The swarm is deliberately uncapped, so its cost never comes back down: every live
 * termite is a node mutation every tick, synced to every other person in the file.
 * `minTravel` and `fireRateMs` are therefore doing a different job here than on any
 * other weapon — they are not just mark spacing, they are the spawn rate of a permanent
 * background load, which is why they sit well above what a static swarm would want.
 * `clear` is the release valve.
 *
 * `dispersion` does the scattering: 18 is a little over half a termite, wide enough that
 * consecutive bugs straddle the drag instead of tracing it.
 *
 * Sprite geometry below is measured from the real files in ref/w93/7-termite/ and is
 * not guesswork. `fireRateMs`, `minTravel` and `dispersion` ARE tuning values and
 * are the ones to change if this weapon feels wrong.
 */
export const termites: Weapon = {
  id: 'termites',
  slot: 8,
  label: '8: Termites',
  icon: '8-termites',

  fireRateMs: 120,
  minTravel: 55,
  dispersion: 18,
  cursorUpRateMs: 150,
  cursorOffset: { x: -30, y: -55 },

  crawl: true,

  // The scurry, not the squelch. Upstream loops termite.ogg for as long as a termite is
  // alive and fires dead-termite.ogg once per kill; we have no lifetime to loop over,
  // only impacts. The scurry is 0.64s, so retriggering it at the fire rate overlaps it
  // into a continuous skitter that stops when you do — the loop's behaviour arrived at
  // from the other direction. dead-termite is left out: nothing here is dying, and
  // `playImpact` is told only the weapon, so it could not be tied to the corpse anyway.
  //
  // Trimmed because that overlap is the point: this runs more simultaneous voices than
  // any other one-shot, so it needs to sit lower per voice to end up level with them.
  volume: 0.75,
  sounds: ['7-termite/termite'],

  art: {
    cursorUp: { key: '7-termite/cursor-release', frames: 3, states: 1, cellW: 127, cellH: 95 },
    cursorDown: { key: '7-termite/cursor-press', frames: 1, states: 1, cellW: 95, cellH: 95 },
    extraSheets: [{ key: '7-termite/termite', frames: 2, states: 8, cellW: 31, cellH: 31 }],
    hits: [
      // A crawling weapon picks its own starting cell from `extraSheets`, so these are
      // not drawn from directly any more. They stay because they are the honest
      // inventory of what this weapon can put on the canvas, and because `isPlayable`
      // reads them to decide whether the menu greys the tile out.
      //
      // Four headings x stopped/walking x two leg frames, in sheet order.
      '7-termite/termite#0,0',
      '7-termite/termite#1,0',
      '7-termite/termite#0,1',
      '7-termite/termite#1,1',
      '7-termite/termite#0,2',
      '7-termite/termite#1,2',
      '7-termite/termite#0,3',
      '7-termite/termite#1,3',
      '7-termite/termite#0,4',
      '7-termite/termite#1,4',
      '7-termite/termite#0,5',
      '7-termite/termite#1,5',
      '7-termite/termite#0,6',
      '7-termite/termite#1,6',
      '7-termite/termite#0,7',
      '7-termite/termite#1,7',
      // The rare corpse.
      '7-termite/dead-termite',
    ],
    hitSize: 31,
  },
};

export default termites;
