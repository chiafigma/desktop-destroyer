/**
 * Fetches the original Desktop Destroyer sprites and sounds into `ref/w93/`.
 *
 * Provenance: the windows93.net recreation of the 1990s freeware. Original design
 * Miroslav Nemecek (gemtree.com), sprites ripped by Jankenpopp & Zombectro, code by
 * Zombectro. See desktop-destroyer-ref/about.md.
 *
 * Why fetch rather than vendor a download: windows93's folder export serializes
 * directory metadata only, so downloading `0-hammer/` yields a 1024-byte tar of
 * zeros. Individual files serve fine, so this walks the naming scheme instead.
 *
 * Filenames come from DesktopDestroyer.js:
 *   cursor-release.png   cursor sheet, idle           (frames x states grid)
 *   cursor-press.png     cursor sheet, firing
 *   hit-{i}.png          permanent impact marks
 *   drop.png/drop-{i}.png  falling debris particles
 *   {key}.ogg/{key}-{i}.ogg  sounds, key in hit|press|release|drop
 *
 * Run: node scripts/fetch-w93-assets.mjs
 * Idempotent — existing files are skipped unless --force.
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const BASE = 'https://windows93.net/c/programs/misc/DesktopDestroyer/assets';

/** Weapon directories, exactly as DesktopDestroyer.js names them. */
const DIRS = [
  '0-hammer',
  '1-chain-saw',
  '2-machine-gun',
  '3-flame-thrower',
  '4-color-thrower',
  '5-phaser',
  '6-stamp',
  '7-termite',
  '8-washing',
];

/** Files that exist at most once per weapon. */
const SINGLES = [
  'cursor-release.png',
  'cursor-press.png',
  // The muzzle-flame sheet, upstream's `fireFrames`. Named `press.png` against a
  // `press.ogg` that is a different thing entirely — the trigger pull — which is why
  // it sat unlisted here long enough for the flame thrower to ship without any fire.
  'press.png',
  'drop.png',
  'press.ogg',
  'release.ogg',
  'hit.ogg',
  'drop.ogg',
  // Termite-only, harmless 404s elsewhere.
  'termite.png',
  'dead-termite.png',
  'termite.ogg',
  'dead-termite.ogg',
];

/** Numbered series. Probed upward until a miss, so no count needs hardcoding. */
const SERIES = ['hit-{i}.png', 'drop-{i}.png', 'hit-{i}.ogg', 'press-{i}.ogg', 'drop-{i}.ogg'];

/** Stop a series after this many consecutive misses. */
const SERIES_LIMIT = 40;

let fetched = 0;
let skipped = 0;
let bytes = 0;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Returns true if the file was found and written (or already present). */
async function grab(dir, name) {
  const out = resolve(root, 'ref/w93', dir, name);

  if (!force && (await exists(out))) {
    skipped++;
    return true;
  }

  const res = await fetch(`${BASE}/${dir}/${name}`);
  if (!res.ok) return false;

  const buf = Buffer.from(await res.arrayBuffer());
  // windows93 serves an HTML shell for some misses rather than a 404, and an empty
  // body is never a real sprite — treat both as absent.
  if (buf.length === 0 || buf.subarray(0, 14).toString('latin1').toLowerCase().includes('<!doctype')) {
    return false;
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, buf);
  fetched++;
  bytes += buf.length;
  return true;
}

for (const dir of DIRS) {
  const found = [];

  for (const name of SINGLES) {
    if (await grab(dir, name)) found.push(name);
  }

  for (const pattern of SERIES) {
    for (let i = 1; i <= SERIES_LIMIT; i++) {
      const name = pattern.replace('{i}', String(i));
      if (!(await grab(dir, name))) break;
      found.push(name);
    }
  }

  console.log(`${dir}  ${found.length} files`);
  if (found.length) console.log(`  ${found.join(' ')}`);
}

console.log(
  `\n${fetched} fetched, ${skipped} already present, ${(bytes / 1024).toFixed(0)}kb new`,
);
