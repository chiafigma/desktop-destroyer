import { hammer } from './hammer';
import { chainsaw } from './chainsaw';
import { machinegun } from './machinegun';
import { flamethrower } from './flamethrower';
import { colorthrower } from './colorthrower';
import { phaser } from './phaser';
import { stamp } from './stamp';
import { termites } from './termites';
import { washing } from './washing';
import type { Weapon } from './types';

export type { Weapon, WeaponArt, Sheet, FireBurst, Vec } from './types';
export { cellKey } from './types';

/**
 * The nine weapons, in menu order.
 *
 * Labels are transcribed character-for-character from the original 240x200 menu,
 * including its own inconsistencies: "Machine gun" is lowercase, and slot 9 is
 * missing the space after its colon. Do not tidy these.
 *
 * One file per weapon, so that work on one cannot collide with work on another.
 */
export const WEAPONS: Weapon[] = [
  hammer,
  chainsaw,
  machinegun,
  flamethrower,
  colorthrower,
  phaser,
  stamp,
  termites,
  washing,
];

export const BY_ID: Record<string, Weapon> = Object.fromEntries(
  WEAPONS.map((w) => [w.id, w]),
);

/** A weapon is playable once it has art *and* something to draw with it. */
export function isPlayable(w: Weapon): boolean {
  return w.art !== null && w.art.hits.length > 0;
}
