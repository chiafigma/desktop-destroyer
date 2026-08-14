import { W93_SOUNDS } from '../generated/assets';
import { BY_ID, WEAPONS } from '../shared/weapons';

/**
 * Impact sound effects.
 *
 * Audio lives on the UI side because the plugin sandbox has none at all — the main
 * thread reports that an impact happened and this makes the noise.
 *
 * Which sounds a weapon owns is declared in that weapon's own file, not in a table
 * here, so that adding a weapon never means editing this module.
 *
 * There are two playback models, because the source material has two kinds of sound
 * in it:
 *
 *   - one-shots (`sounds`), a sample per impact, chosen at random from the weapon's
 *     set. The hammer's eight blows are the archetype.
 *   - a sustain (`sustain`), one sample looped for as long as the weapon keeps
 *     firing. The chain-saw's rev, the washer's spray and the flame are 1.5-2.5s
 *     recordings that upstream starts on mouse-down and stops on mouse-up; fired as
 *     one-shots at a 60ms rate they restart two dozen times a second and buzz.
 *
 * Each one-shot key gets a pool of preloaded elements. A single element cannot overlap
 * with itself, and at these fire rates the previous shot is still ringing when the next
 * lands; without the pool every hammer blow cuts the last one short and the result
 * stutters rather than sounding like a beating.
 */

/** Sized for the longest sample against the fastest fire rate, not for the average. */
const POOL_SIZE = 12;

/**
 * Master level for one-shots.
 *
 * The source recordings are normalised close to full scale, which is right for one
 * hammer blow and wrong for the eight-deep overlap this plugin produces at speed —
 * several voices of the same sample at 1.0 sum well past it and the result is a wall.
 * Pulling the individual voice down is what lets the overlap read as a texture.
 */
const MASTER_VOLUME = 0.38;

/**
 * Sustained loops sit lower still. A sound that never stops is doing continuously what
 * a one-shot does in bursts, so matching their nominal levels makes the loop dominate.
 */
const SUSTAIN_VOLUME = 0.26;

/**
 * Never schedule a burst further ahead than this. One long flick can land eight marks
 * at once, and queueing a second of gunfire that keeps firing after you have stopped
 * moving sounds like a stuck trigger.
 */
const MAX_QUEUE_MS = 400;

/** How quiet it has to go before a sustained weapon is considered to have stopped. */
const SUSTAIN_TAIL_MS = 250;

const pools = new Map<string, HTMLAudioElement[]>();

function pool(key: string): HTMLAudioElement[] {
  const existing = pools.get(key);
  if (existing) return existing;

  const src = W93_SOUNDS[key];
  const created: HTMLAudioElement[] = [];
  if (src) {
    // `new Audio(src)` already sets preload to 'auto'.
    for (let i = 0; i < POOL_SIZE; i++) created.push(new Audio(src));
  } else {
    console.warn(`sound missing: ${key}`);
  }
  pools.set(key, created);
  return created;
}

/**
 * The idlest element in the pool, preferring one that is not playing at all.
 *
 * Strict round-robin can hand back a voice that started 30ms ago while an untouched
 * one sits beside it, and restarting that voice is what chops a long sample into a
 * stutter. Picking the furthest-progressed element instead means the sound that gets
 * cut short is always the one closest to finishing anyway.
 */
function take(elements: HTMLAudioElement[]): HTMLAudioElement | null {
  let oldest: HTMLAudioElement | null = null;
  for (const el of elements) {
    if (el.paused || el.ended) return el;
    if (!oldest || el.currentTime > oldest.currentTime) oldest = el;
  }
  return oldest;
}

function playOne(keys: readonly string[], volume: number): void {
  const key = keys[Math.floor(Math.random() * keys.length)];
  if (!key) return;

  const el = take(pool(key));
  if (!el) return;

  el.volume = volume;
  el.currentTime = 0;
  // Autoplay policy can reject this until the user has interacted with the iframe.
  // They just clicked a weapon, so in practice it is allowed — but a rejected sound
  // must never break the firing loop.
  void el.play().catch(() => {});
}

// --- sustained weapons -----------------------------------------------------

/**
 * Only one weapon is armed at a time, so one loop is all that can ever be running.
 *
 * The loop is started by the first impact and stopped by a watchdog that every
 * subsequent impact pushes further out. That is how a sustained sound is produced
 * without the press and release events this plugin cannot see: "still firing" is
 * inferred from impacts continuing to arrive.
 */
let sustainEl: HTMLAudioElement | null = null;
let sustainKey: string | null = null;
let sustainTimer: ReturnType<typeof setTimeout> | null = null;

function keepSustaining(key: string, volume: number): void {
  if (sustainKey !== key) {
    stopSustain();
    const src = W93_SOUNDS[key];
    if (!src) {
      console.warn(`sound missing: ${key}`);
      return;
    }
    const el = new Audio(src);
    el.loop = true;
    el.volume = volume;
    sustainEl = el;
    sustainKey = key;
    void el.play().catch(() => {});
  }

  if (sustainTimer !== null) clearTimeout(sustainTimer);
  sustainTimer = setTimeout(stopSustain, SUSTAIN_TAIL_MS);
}

/** Also called when the weapon is holstered, so the loop cannot outlive the arming. */
export function stopSustain(): void {
  if (sustainTimer !== null) clearTimeout(sustainTimer);
  sustainTimer = null;
  if (sustainEl) {
    sustainEl.pause();
    sustainEl.currentTime = 0;
  }
  sustainEl = null;
  sustainKey = null;
}

// --- entry points ----------------------------------------------------------

export function playImpact(weaponId: string, count = 1): void {
  const weapon = BY_ID[weaponId];
  if (!weapon) return;

  // A weapon's own `volume` trims it relative to the others — some of the source
  // recordings are simply hotter than the rest.
  const trim = weapon.volume ?? 1;

  if (weapon.sustain) {
    keepSustaining(weapon.sustain, SUSTAIN_VOLUME * trim);
    return;
  }

  const keys = weapon.sounds;
  if (!keys || keys.length === 0) return;

  // Several marks can land between two cursor samples. Firing them all on this tick
  // sounds like one loud shot; spacing them by the weapon's own fire rate is what
  // makes a burst sound like a burst.
  const gap = Math.max(weapon.fireRateMs, 50);
  const n = Math.max(1, Math.min(count, Math.floor(MAX_QUEUE_MS / gap) + 1));
  const level = MASTER_VOLUME * trim;
  for (let i = 0; i < n; i++) {
    if (i === 0) playOne(keys, level);
    // Each later shot in a burst is quieter than the one before it. A flat burst reads
    // as one loud event; a decaying one reads as a burst with a front to it.
    else setTimeout(() => playOne(keys, level * (1 - i * 0.15)), i * gap);
  }
}

/**
 * Builds every pool up front, so the first hit of a weapon is not the one that waits
 * on a decode.
 *
 * The hammer picks at random among eight keys, so lazily it pays that cost eight
 * separate times — during the exact first seconds in which someone is deciding whether
 * this plugin makes any noise at all. Call from a click handler: that is also what
 * satisfies the autoplay policy.
 */
export function warmUp(): void {
  for (const weapon of WEAPONS) {
    for (const key of weapon.sounds ?? []) pool(key);
  }
}
