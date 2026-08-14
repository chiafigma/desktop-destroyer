import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plotShots } from './trail';

/**
 * The firing math decides how the weapons feel, and it is the one part of this
 * plugin that can be checked without Figma in the loop. Everything here is about
 * spacing staying even no matter how coarsely the cursor samples arrive.
 */

test('an exact multiple of the step fires evenly and lands on the end point', () => {
  const r = plotShots({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 25, 8);
  assert.equal(r.points.length, 4);
  r.points.forEach((p, i) => assert.ok(Math.abs(p.x - (i + 1) * 25) < 1e-9));
  assert.equal(r.points[3]?.x, 100);
  assert.equal(r.residual, 0);
});

test('movement shorter than the step banks travel instead of firing', () => {
  const r = plotShots({ x: 0, y: 0 }, { x: 10, y: 0 }, 0, 25, 8);
  assert.equal(r.points.length, 0);
  assert.equal(r.residual, 10);
});

test('banked travel carries into the next sample', () => {
  // 10 already banked plus 20 more crosses the 25px threshold once, 15px in.
  const r = plotShots({ x: 0, y: 0 }, { x: 20, y: 0 }, 10, 25, 8);
  assert.equal(r.points.length, 1);
  assert.ok(Math.abs((r.points[0]?.x ?? 0) - 15) < 1e-9);
  assert.ok(Math.abs(r.residual - 5) < 1e-9);
});

test('the per-sample cap drops the surplus rather than repaying it later', () => {
  // A capped burst must not bank the 32 suppressed shots — carrying that debt
  // would make the following samples stutter to catch up.
  const r = plotShots({ x: 0, y: 0 }, { x: 1000, y: 0 }, 0, 25, 8);
  assert.equal(r.points.length, 8);
  assert.equal(r.dropped, 32);
  assert.equal(r.residual, 0);
});

test('distance is euclidean, not per-axis', () => {
  // 3-4-5: a 30x40 move is 50px of travel, so two shots at step 25 — not one per
  // axis, and not 70px worth.
  const r = plotShots({ x: 0, y: 0 }, { x: 30, y: 40 }, 0, 25, 8);
  assert.equal(r.points.length, 2);
});

test('a zero-length sample firing off banked residual stays finite', () => {
  // distance === 0 would divide by zero in the interpolation if unguarded.
  const r = plotShots({ x: 5, y: 5 }, { x: 5, y: 5 }, 30, 25, 8);
  assert.equal(r.points.length, 1);
  assert.ok(Number.isFinite(r.points[0]?.x));
  assert.deepEqual(r.points[0], { x: 5, y: 5 });
});

test('a non-positive step degenerates to a single shot at the end point', () => {
  const r = plotShots({ x: 0, y: 0 }, { x: 9, y: 9 }, 0, 0, 8);
  assert.deepEqual(r.points, [{ x: 9, y: 9 }]);
});
