import { W93 } from '../generated/assets';
import type { FramePayload } from '../shared/protocol';
import { cellKey, WEAPONS, type Sheet } from '../shared/weapons';

/**
 * Turns the inlined sprite sheets into individual PNG frames for the main thread.
 *
 * This lives on the UI side because it needs three things the plugin sandbox does
 * not have: base64 decoding, an image decoder, and a canvas. The sandbox receives
 * raw PNG bytes and nothing else.
 *
 * Not everything goes through the canvas. Sheets do, because they have to be cut up,
 * and tinted stills do, because hue rotation is a canvas filter. Whole stills are handed
 * over as their original bytes untouched.
 *
 * A previous version of this comment claimed the canvas pass existed to normalize WebP
 * sources that `figma.createImage` would reject. That was wrong: every source image in
 * `ref/` is a PNG, and there has never been a WebP among them. The PNG/JPEG/GIF
 * restriction on `createImage` is real and worth remembering if the art ever changes,
 * but it is not why this module is shaped the way it is.
 */

function decodeBase64(dataUri: string): Uint8Array {
  const comma = dataUri.indexOf(',');
  const binary = atob(dataUri.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function loadImage(dataUri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('sprite failed to decode'));
    img.src = dataUri;
  });
}

function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('canvas.toBlob returned null'));
        return;
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject);
    }, 'image/png');
  });
}

/**
 * Cuts a sheet into its cells.
 *
 * Sheets are a grid, not a strip: `frames` columns across by `states` rows down, so
 * a cell is at (frame * cellW, state * cellH). Only the chain-saw currently uses more
 * than one row (2 frames x 8 states), but treating every sheet as a grid means it is
 * not a special case.
 */
async function sliceSheet(sheet: Sheet): Promise<FramePayload[]> {
  const src = W93[sheet.key];
  if (!src) {
    console.warn(`sprite sheet missing: ${sheet.key}`);
    return [];
  }

  const img = await loadImage(src);

  // A declared cell size that disagrees with the file means every frame after the
  // first is cut from the wrong place. Loud, because the result looks like a subtle
  // art problem rather than a numbers problem.
  const expectedW = sheet.cellW * sheet.frames;
  const expectedH = sheet.cellH * sheet.states;
  if (img.naturalWidth !== expectedW || img.naturalHeight !== expectedH) {
    console.error(
      `${sheet.key}: declared ${sheet.frames}x${sheet.states} cells of ` +
        `${sheet.cellW}x${sheet.cellH} = ${expectedW}x${expectedH}, ` +
        `but the file is ${img.naturalWidth}x${img.naturalHeight}`,
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = sheet.cellW;
  canvas.height = sheet.cellH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  // Hard-edged pixel art; smoothing would sand off the crudeness that is the point.
  ctx.imageSmoothingEnabled = false;

  const out: FramePayload[] = [];
  for (let state = 0; state < sheet.states; state++) {
    for (let frame = 0; frame < sheet.frames; frame++) {
      ctx.clearRect(0, 0, sheet.cellW, sheet.cellH);
      ctx.drawImage(
        img,
        frame * sheet.cellW,
        state * sheet.cellH,
        sheet.cellW,
        sheet.cellH,
        0,
        0,
        sheet.cellW,
        sheet.cellH,
      );
      out.push({
        key: cellKey(sheet, frame, state),
        bytes: await toPng(canvas),
        w: sheet.cellW,
        h: sheet.cellH,
      });
    }
  }
  return out;
}

/** Single-image sprites pass through untouched — they are already PNG. */
function passThrough(key: string): FramePayload | null {
  const src = W93[key];
  if (!src) {
    console.warn(`sprite missing: ${key}`);
    return null;
  }
  return { key, bytes: decodeBase64(src), w: 0, h: 0 };
}

/**
 * Re-encodes one still with its hues rotated, producing the `${key}@${deg}` frame the
 * colour thrower draws.
 *
 * The rotation is done here rather than on the Figma node because an image fill has no
 * hue control — `ImagePaint.filters` offers saturation and temperature, neither of
 * which can turn magenta into green. Baking a handful of recoloured copies at startup
 * costs a few small uploads and then nothing at all per impact.
 */
async function tintStill(
  key: string,
  degrees: number,
  saturation: number,
): Promise<FramePayload | null> {
  const src = W93[key];
  if (!src) {
    console.warn(`sprite missing: ${key}`);
    return null;
  }

  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingEnabled = false;
  ctx.filter = `saturate(${saturation}) hue-rotate(${degrees}deg)`;
  ctx.drawImage(img, 0, 0);

  return {
    key: `${key}@${degrees}`,
    bytes: await toPng(canvas),
    w: img.naturalWidth,
    h: img.naturalHeight,
  };
}

export async function buildFrames(): Promise<FramePayload[]> {
  const frames: FramePayload[] = [];
  const done = new Set<string>();

  for (const weapon of WEAPONS) {
    const art = weapon.art;
    if (!art) continue;

    for (const sheet of [
      art.cursorUp,
      art.cursorDown,
      art.fire?.sheet,
      ...(art.extraSheets ?? []),
    ]) {
      if (!sheet || done.has(sheet.key)) continue;
      done.add(sheet.key);
      // One unreadable sheet costs its own weapon some art. Letting it reject the
      // whole build would cost *every* weapon the ability to fire, because the main
      // thread never receives any frames and answers "sprites are still loading"
      // forever — with nothing to see but a console line in a panel nobody has open.
      try {
        frames.push(...(await sliceSheet(sheet)));
      } catch (err) {
        console.error(`[desktop-destroyer] ${weapon.id}: sheet ${sheet.key} failed`, err);
      }
    }

    for (const key of art.hits) {
      // A hit naming a sheet cell ("…/termite#0,3") was already produced by the
      // slicing pass above; only whole stills need loading here.
      if (key.includes('#')) {
        // Unless nobody declared that sheet, in which case the frame silently never
        // exists and the weapon fires blanks — no mark, no sound, no complaint.
        // `npm run verify` cannot catch this: it checks the file, not the declaration.
        if (!done.has(key.split('#')[0] ?? '')) {
          console.error(
            `[desktop-destroyer] ${weapon.id}: hit "${key}" names a sheet that is not in extraSheets`,
          );
        }
        continue;
      }
      if (done.has(key)) continue;
      done.add(key);
      const frame = passThrough(key);
      if (frame) frames.push(frame);

      // Every angle is baked, including 0. It is tempting to skip 0 as a no-op and let
      // it fall back to the untinted frame, but with `tintSaturation` in play 0 is not a
      // no-op at all — it is the unrotated hue at full strength, and skipping it would
      // make the one angle that falls back the one angle that stays muted.
      const saturation = art.tintSaturation ?? 1;
      for (const degrees of art.tints ?? []) {
        try {
          const tinted = await tintStill(key, degrees, saturation);
          if (tinted) frames.push(tinted);
        } catch (err) {
          console.error(`[desktop-destroyer] ${weapon.id}: tint ${degrees} of ${key} failed`, err);
        }
      }
    }
  }

  return frames;
}
