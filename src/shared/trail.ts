/**
 * Where along a cursor path the impacts land.
 *
 * Pure and Figma-free so it can be reasoned about (and tested) on its own.
 *
 * The problem this solves: `activeUsers[].position` refreshes slower than a mouse
 * moves, so a fast drag arrives as a few widely spaced samples. Firing once per
 * sample would give a dotted line whose density depended on how fast you moved.
 * Instead we spend *distance*: a shot every `step` canvas pixels of travel, with
 * the leftover carried into the next sample so spacing stays even across ticks.
 *
 * Distance is the right currency here because we cannot see the mouse button. Time
 * alone would bore a hole through the canvas while the cursor sat still; distance
 * only charges you for ground actually covered.
 */

export type Point = { x: number; y: number };

export type Shots = {
  points: Point[];
  /** Unspent travel to carry into the next sample. */
  residual: number;
  /** Shots suppressed by `max` this sample, for diagnostics. */
  dropped: number;
};

/**
 * @param from     previous cursor sample
 * @param to       current cursor sample
 * @param residual unspent travel returned by the previous call
 * @param step     canvas px between impacts
 * @param max      ceiling on impacts from a single sample
 */
export function plotShots(
  from: Point,
  to: Point,
  residual: number,
  step: number,
  max: number,
): Shots {
  if (step <= 0) return { points: [to], residual: 0, dropped: 0 };

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const budget = residual + distance;
  const wanted = Math.floor(budget / step);
  if (wanted < 1) return { points: [], residual: budget, dropped: 0 };

  const firing = Math.min(wanted, max);
  const points: Point[] = [];

  for (let i = 1; i <= firing; i++) {
    // Distance into *this* sample at which shot i falls. `residual` was already
    // travelled before `from`, so it shifts the whole ladder backwards.
    const along = i * step - residual;
    // Guard the degenerate case: a zero-length sample that only fires off carried
    // residual has nothing to interpolate along, so everything lands on `to`.
    const t = distance > 0 ? Math.min(1, along / distance) : 1;
    points.push({ x: from.x + dx * t, y: from.y + dy * t });
  }

  return {
    points,
    // Drop the unfired remainder along with the surplus: carrying it would let a
    // throttled burst pay itself back as a stutter on the following samples.
    residual: budget - wanted * step,
    dropped: wanted - firing,
  };
}
