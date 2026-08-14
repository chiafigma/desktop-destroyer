/**
 * Checks every declared sprite sheet against the real file on disk.
 *
 * A sheet is declared as `frames` columns x `states` rows of `cellW` x `cellH`. If
 * those numbers disagree with the image, the slicer cuts every cell after the first
 * from the wrong offset — and the result looks like an art problem, not a numbers
 * problem, so it can be stared at for a long time. This turns that into a build
 * failure with the arithmetic spelled out.
 *
 * Reads PNG dimensions straight from the IHDR chunk rather than pulling in an image
 * library: width and height are big-endian uint32 at bytes 16 and 20.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => resolve(root, ...s);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function pngSize(file) {
  const buf = await readFile(file);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`not a PNG: ${file}`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Pulls every `{ key: '…', frames: n, states: n, cellW: n, cellH: n }` literal. */
const SHEET_RE =
  /\{\s*key:\s*'([^']+)',\s*frames:\s*(\d+),\s*states:\s*(\d+),\s*cellW:\s*(\d+),\s*cellH:\s*(\d+)\s*\}/g;

/** And every hit-mark key, so a typo'd filename is caught too. */
const HITS_RE = /hits:\s*\[([^\]]*)\]/g;

/**
 * Entries are pulled out as quoted literals rather than by splitting the array on
 * commas, because a cell-form key contains one: `'7-termite/termite#0,3'` is frame 0,
 * state 3 of the termite grid, and splitting it yields `'7-termite/termite#0` and
 * `3'` — the second of which is then reported as a missing file `ref/w93/3.png`.
 */
const ENTRY_RE = /'([^']*)'/g;

const dir = p('src/shared/weapons');
const files = (await readdir(dir)).filter((f) => f.endsWith('.ts') && f !== 'types.ts');

let checked = 0;
const problems = [];

for (const file of files) {
  const source = await readFile(resolve(dir, file), 'utf8');

  for (const m of source.matchAll(SHEET_RE)) {
    const [, key, frames, states, cellW, cellH] = m;
    const declared = {
      w: Number(cellW) * Number(frames),
      h: Number(cellH) * Number(states),
    };

    let actual;
    try {
      actual = await pngSize(p('ref/w93', `${key}.png`));
    } catch {
      problems.push(`${file}: sheet "${key}" has no file at ref/w93/${key}.png`);
      continue;
    }

    checked++;
    if (actual.w !== declared.w || actual.h !== declared.h) {
      problems.push(
        `${file}: sheet "${key}" declares ${frames}x${states} cells of ${cellW}x${cellH} ` +
          `= ${declared.w}x${declared.h}, but the file is ${actual.w}x${actual.h}`,
      );
    }
  }

  for (const m of source.matchAll(HITS_RE)) {
    for (const entry of m[1].matchAll(ENTRY_RE)) {
      const key = entry[1].trim();
      if (!key) continue;
      // A hit may name one cell of a sheet ("…/termite#0,3"); the file is the part
      // before the '#'. The sheet's own dimensions are checked by SHEET_RE above.
      const base = key.split('#')[0];
      try {
        await pngSize(p('ref/w93', `${base}.png`));
        checked++;
      } catch {
        problems.push(`${file}: hit "${key}" has no file at ref/w93/${base}.png`);
      }
    }
  }
}

if (problems.length) {
  console.error(`sheet verification failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

console.log(`  sheets: ${checked} sprite references verified against ref/w93`);
