import { emptyProbeStats, type ProbeStats } from '../shared/protocol';
import type { Point } from '../shared/trail';

export type { Point };

/**
 * Polls the current user's canvas cursor position.
 *
 * `figma.activeUsers[].position` is the only route to a canvas cursor — there is no
 * pointer event for the canvas, and the plugin UI's own mousemove stops at the
 * iframe edge. So: poll, diff, and report movement as segments.
 *
 * We deliberately emit (from -> to) segments rather than points. The multiplayer
 * channel that feeds `position` refreshes slower than a mouse moves, so consecutive
 * samples can sit far apart; a caller that only saw points would lay a dotted line
 * of impacts. Segments let it interpolate and produce a continuous trail.
 */

/** Poll cadence. Faster than this buys nothing if the channel refreshes slower —
 *  the probe's `positionChanged` vs `ticks` ratio tells us the real ceiling. */
const POLL_MS = 30;

/** Beyond this, treat it as a teleport (viewport jump, tab-in) rather than a drag,
 *  and skip interpolation — otherwise one blink smears damage across the whole file. */
const TELEPORT_PX = 4000;

export type Segment = { from: Point; to: Point; distance: number };

type Handler = (seg: Segment) => void;

let timer: ReturnType<typeof setTimeout> | null = null;
let previous: Point | null = null;
let handler: Handler | null = null;

let stats: ProbeStats = emptyProbeStats();
let probing = false;
let probeStartedAt = 0;

function selfPosition(): Point | null {
  const me = figma.currentUser;
  if (!me) return null;
  // activeUsers includes the current user; match on sessionId because a user can
  // have the same file open in two tabs, each its own ActiveUser entry.
  for (const u of figma.activeUsers) {
    if (u.sessionId !== me.sessionId) continue;
    if (probing) stats.selfFound++;
    return u.position ? { x: u.position.x, y: u.position.y } : null;
  }
  return null;
}

function tick(): void {
  if (probing) stats.ticks++;

  const now = selfPosition();

  if (!now) {
    // Cursor left the canvas. Drop `previous` so that re-entering somewhere else
    // does not draw a segment across the gap.
    previous = null;
    schedule();
    return;
  }

  if (probing) {
    stats.positionNonNull++;
    stats.lastPosition = now;
  }

  if (previous && (previous.x !== now.x || previous.y !== now.y)) {
    const dx = now.x - previous.x;
    const dy = now.y - previous.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (probing) {
      stats.positionChanged++;
      if (distance > stats.maxJumpPx && distance < TELEPORT_PX) {
        stats.maxJumpPx = distance;
      }
      const elapsed = (Date.now() - probeStartedAt) / 1000;
      stats.effectiveHz = elapsed > 0 ? stats.positionChanged / elapsed : 0;
    }

    if (distance < TELEPORT_PX && handler) {
      handler({ from: previous, to: now, distance });
    }
  }

  previous = now;
  schedule();
}

/**
 * Recursive setTimeout rather than setInterval: it cannot pile up overlapping ticks
 * if a tick runs long (node creation can), and it avoids depending on setInterval
 * being present in the sandbox.
 */
function schedule(): void {
  timer = setTimeout(tick, POLL_MS);
}

export function start(onMove: Handler): void {
  if (timer !== null) stop();
  handler = onMove;
  previous = null;
  schedule();
}

export function stop(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  handler = null;
  previous = null;
}

export function isRunning(): boolean {
  return timer !== null;
}

/**
 * Records impacts that the caller's per-sample ceiling refused to fire.
 *
 * Every other figure in `ProbeStats` is measured here, because the poll loop is the
 * only thing that can see it. This one is not: the cap lives with whoever turns a
 * segment into marks, so it has to be handed back in. Keeping it in `ProbeStats`
 * anyway is deliberate — the drops are a *consequence* of how coarsely this channel
 * samples, and they belong next to `maxJumpPx`, which is the cause.
 *
 * Both counters are gated on `probing` for the same reason the rest are: a total that
 * kept climbing while the panel was closed would be indistinguishable, on the first
 * frame after `P`, from a cap that had just started biting, and the number nobody can
 * date is worse than no number.
 *
 * A zero `count` is not a capped sample, so callers may report every sample
 * unconditionally without inflating `samplesCapped`.
 */
export function noteDropped(count: number): void {
  if (!probing || count <= 0) return;
  stats.shotsDropped += count;
  stats.samplesCapped++;
}

export function setProbing(on: boolean): void {
  probing = on;
  if (on) {
    stats = emptyProbeStats();
    probeStartedAt = Date.now();
  }
}

export function probeStats(): ProbeStats {
  return stats;
}
