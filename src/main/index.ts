import type { MainToUi, UiToMain } from '../shared/protocol';
import { plotShots } from '../shared/trail';
import { BY_ID, isPlayable, type Weapon } from '../shared/weapons';
import * as damage from './damage';
import * as tracker from './tracker';

/** 2x the original 240x200 menu. Integer scale keeps the pixel art crisp. */
const UI_SIZE = { width: 480, height: 400 };

/**
 * Ceiling on impacts from a single cursor sample. A slow poll plus a fast flick can
 * legitimately span a thousand pixels; without a cap, one sample could try to create
 * a hundred nodes and stall the tick that is supposed to be tracking a mouse.
 */
const MAX_SHOTS_PER_SAMPLE = 8;

/** How long after the last hit the weapon drops back to its idle pose. */
const IDLE_AFTER_MS = 220;

const PROBE_REPORT_MS = 250;

let armed: Weapon | null = null;
/** Unspent cursor travel, carried between samples so impact spacing stays even. */
let residual = 0;
/** When the last impact landed, for the `fireRateMs` ceiling and the idle reset. */
let lastShotAt = 0;
let firing = false;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function post(message: MainToUi): void {
  figma.ui.postMessage(message);
}

/**
 * Cycles the idle cursor animation for weapons that have one — the colour thrower
 * shifting hue at rest, the termite hand twitching. Independent of firing, because
 * upstream runs it on its own `cursorUpRate` timer.
 */
function startIdleAnimation(weapon: Weapon): void {
  stopIdleAnimation();
  if (!weapon.art) return;

  // Every weapon gets a timer, even the five that never animate at rest, because the
  // timer is also what relaxes the firing pose — see below.
  const animates = weapon.cursorUpRateMs > 0 && weapon.art.cursorUp.frames > 1;
  const interval = animates ? weapon.cursorUpRateMs : IDLE_AFTER_MS;

  const tick = (): void => {
    // The idle reset cannot live in `onCursorMove`: the tracker only calls that when
    // the position *changes*, so a weapon parked mid-swing is never told to relax.
    // Left there, a stopped hammer stays frozen on its striking frame forever, and
    // the colour thrower's cycle — gated on `!firing` — never restarts.
    if (firing && Date.now() - lastShotAt > IDLE_AFTER_MS) {
      firing = false;
      damage.setCursorFiring(weapon, false);
    }
    if (animates && !firing) damage.stepCursorFrame(weapon);
    idleTimer = setTimeout(tick, interval);
  };
  idleTimer = setTimeout(tick, interval);
}

function stopIdleAnimation(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
}

function onCursorMove(seg: tracker.Segment): void {
  const weapon = armed;
  if (!weapon || !weapon.art) return;

  damage.moveCursor(weapon, seg.to);

  // The kerf follows the cursor itself, not the impact schedule — a cut that appeared
  // only where chips landed would be a dashed line. No-op for every other weapon.
  damage.cutTo(weapon, seg.from, seg.to);

  const carried = residual + seg.distance;
  const shots = plotShots(seg.from, seg.to, residual, weapon.minTravel, MAX_SHOTS_PER_SAMPLE);
  residual = shots.residual;

  // Reported here rather than after the rate-limit bail-out below: the cap bit on this
  // sample either way, and whether the clock then discarded the sample is a separate
  // question. No-ops unless the probe is on.
  tracker.noteDropped(shots.dropped);

  const now = Date.now();

  if (shots.points.length === 0) return;

  // `fireRateMs` decides *whether* the weapon may fire this sample; `minTravel` decides
  // how many marks and where.
  //
  // Letting the clock cap the *count* as well was the single worst thing in this loop.
  // The cursor channel refreshes at about the rate the weapons fire, so the allowance
  // was almost always exactly 1, and every sample discarded all but its last shot —
  // which meant `minTravel` did nothing at all and every weapon drew 3-7x fewer marks
  // than it asked for. A 400px chain-saw drag laid down 5 chips 79px apart instead of
  // 33 forming a cut.
  if (now - lastShotAt < weapon.fireRateMs) {
    // Hand the travel back. `plotShots` has already deducted it from `residual`, so
    // returning without this spends it on shots we are about to throw away.
    residual = Math.min(carried, weapon.minTravel * MAX_SHOTS_PER_SAMPLE);
    return;
  }

  let landed = 0;
  for (const p of shots.points) if (damage.impact(weapon, p)) landed++;
  lastShotAt = now;

  if (!firing) {
    firing = true;
    damage.setCursorFiring(weapon, true);
  }

  damage.raiseCursor();
  // After `setCursorFiring`, not before: the heading lives on the firing sheet, so
  // aiming while the idle sheet is still on the node is a no-op and the first sample of
  // every burst would keep the previous cut's angle. Upstream orders it the same way.
  damage.aimCursor(weapon, seg.to.x - seg.from.x, seg.to.y - seg.from.y);
  damage.stepCursorFrame(weapon);

  if (landed > 0) {
    post({ type: 'impact', weaponId: weapon.id, count: landed });
    post({ type: 'damage-count', count: damage.damageCount() });
  }
}

function arm(weaponId: string): void {
  const weapon = BY_ID[weaponId];
  if (!weapon) {
    post({ type: 'error', message: `unknown weapon: ${weaponId}` });
    return;
  }
  if (!isPlayable(weapon)) {
    post({ type: 'error', message: `${weapon.label} has no damage sprites yet` });
    return;
  }
  if (!damage.hasFrames()) {
    post({ type: 'error', message: 'sprites are still loading' });
    return;
  }

  // Switching weapons comes straight here without passing through `disarm` — the menu
  // sends `arm` for the new one — so this is the only place that puts out fire left
  // burning by the old one. It also keeps `damage.ts` able to drive every live flame from
  // a single timer, which is only sound while they all belong to one weapon.
  damage.clearFlames();

  armed = weapon;
  residual = 0;
  // Not 0: `now - 0` is thirty billion ms of allowance, so the first movement after
  // arming would skip the rate limiter entirely and dump a full sample of marks.
  lastShotAt = Date.now();
  firing = false;
  damage.showCursor(weapon);
  startIdleAnimation(weapon);
  tracker.start(onCursorMove);
  post({ type: 'armed', weaponId: weapon.id });
}

function disarm(): void {
  armed = null;
  residual = 0;
  firing = false;
  stopIdleAnimation();
  // Putting the weapon away puts the fire out. Anything still burning belongs to a
  // trigger that is no longer held.
  damage.clearFlames();
  // The probe needs the poll loop even with nothing armed, so only stop it if the
  // probe is not the one keeping it alive.
  if (probeTimer === null) tracker.stop();
  damage.hideCursor();
  post({ type: 'armed', weaponId: null });
}

function reportProbe(): void {
  post({ type: 'probe-stats', stats: tracker.probeStats() });
  probeTimer = setTimeout(reportProbe, PROBE_REPORT_MS);
}

function setProbing(on: boolean): void {
  tracker.setProbing(on);
  if (probeTimer !== null) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  if (on) {
    // The probe needs samples, and samples only arrive while the poll loop runs.
    // Armed or not, start it so it can be measured on a pristine canvas.
    if (!tracker.isRunning()) tracker.start(onCursorMove);
    reportProbe();
  } else if (!armed) {
    tracker.stop();
  }
}

figma.ui.onmessage = async (message: UiToMain) => {
  switch (message.type) {
    case 'ui-ready':
      break;

    case 'sprites': {
      const count = damage.registerFrames(message.frames);
      post({ type: 'damage-count', count: damage.damageCount() });
      figma.notify(`Desktop Destroyer: ${count} sprite frames ready`, { timeout: 1500 });
      break;
    }

    case 'arm':
      arm(message.weaponId);
      break;

    case 'disarm':
      disarm();
      break;

    case 'clear-damage': {
      const removed = await damage.clearDamage();
      post({ type: 'damage-count', count: 0 });
      figma.notify(removed === 0 ? 'Nothing to clear' : `Cleared ${removed} marks`, {
        timeout: 1200,
      });
      break;
    }

    case 'probe':
      setProbing(message.on);
      break;
  }
};

/**
 * The weapon node lives on one page. Switching pages while armed would leave it
 * stranded behind while impacts landed on the new page, so rebuild it where the user
 * actually is.
 */
figma.on('currentpagechange', () => {
  if (!armed) return;
  // Flames mid-animation are on the page being left, where nothing will ever tick them
  // again once `flames` is rebuilt from impacts on the new one. Put them out here rather
  // than leaving a frozen fireball behind on a page the user has walked away from.
  damage.clearFlames();
  damage.showCursor(armed);
  residual = 0;
  firing = false;
});

// The weapon node is scaffolding, not artwork — it must never outlive the session.
figma.on('close', () => {
  tracker.stop();
  stopIdleAnimation();
  // Termites stay on the canvas — they are damage — but they stop walking and come
  // to rest, rather than being abandoned mid-stride.
  damage.settleCrawlers();
  // Flames do not stay. A fireball is a frame of an animation, not a mark, so one left
  // behind is litter the user never asked for and would have to hunt down by hand.
  damage.clearFlames();
  damage.hideCursor();
});

figma.showUI(__html__, { ...UI_SIZE, title: 'Desktop Destroyer' });
