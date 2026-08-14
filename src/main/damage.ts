import type { FramePayload } from '../shared/protocol';
import { cellKey, type Sheet, type Weapon, type WeaponArt } from '../shared/weapons';
import type { Point } from './tracker';

/**
 * Node-level damage: the weapon that follows the cursor, and the marks it leaves.
 *
 * Two things shape this file:
 *
 * 1. Image bytes are uploaded exactly once per sprite frame. `figma.createImage`
 *    returns a hash any number of fills can share, so a hundred impacts cost a
 *    hundred cheap rectangles rather than a hundred uploads.
 *
 * 2. A hit is a single permanent still, placed and then left alone — a random choice
 *    among the weapon's marks, and the cheapest possible thing to do to a Figma
 *    document. One node, one fill, no timers.
 *
 * Two things are deliberately exempt from (2), and both pay for it: the termites, which
 * walk after they land, and the flame, which animates and then deletes itself. Every
 * frame of either is a document mutation Figma syncs to every other user in the file, so
 * both are capped or bounded and both stop their own timer the moment they have nothing
 * left to do. Anything else added here should stay in the still-and-forget category.
 */

/**
 * Stamped onto every node this plugin creates, so `clearDamage` can recognise its own
 * work in a document it does not own.
 *
 * The in-memory list below only knows about *this* session. Reopen the plugin and it
 * starts empty while the canvas is still covered — which is exactly the state in which
 * someone reaches for "clear" and finds it does nothing. The tag is what survives the
 * plugin being closed, so the sweep can find those marks again.
 *
 * The value distinguishes a mark from the weapon node, because one of them is damage
 * and the other is scaffolding that happens to be on the page at the same time.
 */
const TAG = 'desktop-destroyer';
const TAG_DAMAGE = 'damage';
const TAG_CURSOR = 'cursor';
/**
 * A flame mid-animation. Tagged like everything else so a crash cannot leave a fireball
 * stranded on the canvas with no way to sweep it, but kept distinct from `TAG_DAMAGE`
 * because it is not a mark and must not be counted as one.
 */
const TAG_FLAME = 'flame';

/** Image hash per frame key. Populated once from the UI's sliced sheets. */
const hashes = new Map<string, string>();

/**
 * Everything this session has drawn. Kept as the cheap path for `damageCount`, not as
 * the authority on what to remove — see `clearDamage`.
 */
let damage: SceneNode[] = [];

/** The weapon node tracking the cursor. Locked, and never counted as damage. */
let cursorNode: RectangleNode | null = null;
let cursorSheetKey: string | null = null;
/** Column of the current sheet: the weapon's own animation. */
let cursorFrame = 0;
/**
 * Row of the current sheet: the direction the weapon is pointing.
 *
 * Only the chain-saw's firing sheet has rows to choose between — see `aimCursor` — so
 * for eight of the nine weapons this is 0 for the whole session. It is deliberately
 * *not* cleared when the saw swaps between its idle and firing sheets, because a
 * heading belongs to the cursor's movement rather than to whichever sheet happens to
 * be on the node; see `setCursorFiring`.
 */
let cursorState = 0;

export function registerFrames(frames: FramePayload[]): number {
  for (const f of frames) {
    if (hashes.has(f.key)) continue;
    const image = figma.createImage(f.bytes);
    hashes.set(f.key, image.hash);
  }
  return hashes.size;
}

export function hasFrames(): boolean {
  return hashes.size > 0;
}

function imageFill(hash: string): Paint {
  // FIT, not FILL. Cells are not all square — the flame thrower's are 319x255 — and
  // FILL would crop them to the node's bounds, clipping the artwork. FIT letterboxes
  // instead, and the padding is transparent anyway.
  return { type: 'IMAGE', scaleMode: 'FIT', imageHash: hash };
}

function fillFor(key: string): Paint | null {
  const hash = hashes.get(key);
  return hash ? imageFill(hash) : null;
}

function pick<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

// --- the weapon that follows the cursor ------------------------------------

export function showCursor(weapon: Weapon): void {
  hideCursor();
  if (!weapon.art) return;

  const sheet = weapon.art.cursorUp;
  const node = figma.createRectangle();
  node.name = `⟦${weapon.id}⟧`;
  node.setPluginData(TAG, TAG_CURSOR);
  node.resize(sheet.cellW, sheet.cellH);
  node.strokes = [];
  // Locked so a stray click grabs the canvas underneath instead of the weapon, and
  // so it cannot be dragged out from under the cursor it is meant to be following.
  node.locked = true;
  const fill = fillFor(cellKey(sheet, 0, 0));
  node.fills = fill ? [fill] : [];
  figma.currentPage.appendChild(node);

  cursorNode = node;
  cursorSheetKey = sheet.key;
  cursorFrame = 0;
  cursorState = 0;
}

export function hideCursor(): void {
  if (cursorNode && !cursorNode.removed) cursorNode.remove();
  cursorNode = null;
  cursorSheetKey = null;
  cursorFrame = 0;
  cursorState = 0;
}

/**
 * Which of the weapon's two sheets is currently on the node.
 *
 * `cursorSheetKey` is the authority rather than a firing flag, because this module is
 * not told when the caller thinks the weapon is firing — it is told when to swap, and
 * the key is the record of that swap having happened.
 */
function currentSheet(art: WeaponArt): Sheet {
  return art.cursorDown && art.cursorDown.key === cursorSheetKey ? art.cursorDown : art.cursorUp;
}

/**
 * `cursorState` clamped to a sheet that may not have that many rows.
 *
 * The saw keeps its heading across a sheet swap, and its idle sheet has exactly one
 * row — so without this, an idle saw that was last pointing down-left would ask for
 * cell `#f,5` of a 1-row sheet, `fillFor` would find nothing, and the idle blade
 * animation would simply stop drawing rather than fail loudly.
 */
function stateFor(sheet: Sheet): number {
  return cursorState < sheet.states ? cursorState : 0;
}

/** Moves the weapon so its offset origin sits on `p`. */
export function moveCursor(weapon: Weapon, p: Point): void {
  if (!cursorNode || cursorNode.removed) return;
  cursorNode.x = p.x + weapon.cursorOffset.x;
  cursorNode.y = p.y + weapon.cursorOffset.y;
}

/**
 * Swaps the weapon between its idle and firing sheets.
 *
 * Sheets can differ in cell size — the hammer's idle frame is 111 wide and its
 * striking frame 73 — so the node is resized, not just refilled.
 *
 * `cursorFrame` restarts at 0 because a weapon's animation is a loop that belongs to
 * the sheet it is drawn from; `cursorState` deliberately does not, because a heading
 * belongs to the drag. Firing stops after 220ms without an impact, which is well
 * inside a single continuous cut, so a saw dragged steadily down-left crosses this
 * function repeatedly. Resetting the row there would snap the blade back to "pointing
 * right" on every one of those crossings, for the one sample it takes `aimCursor` to
 * correct it — a visible flick in the middle of an unbroken drag. Carrying the row
 * over resumes the cut at the angle it left off at, and `stateFor` keeps the row that
 * the one-row idle sheet cannot honour from turning into a missing cell.
 */
export function setCursorFiring(weapon: Weapon, firing: boolean): void {
  if (!cursorNode || cursorNode.removed || !weapon.art) return;

  const sheet = firing ? (weapon.art.cursorDown ?? weapon.art.cursorUp) : weapon.art.cursorUp;
  if (sheet.key === cursorSheetKey) return;

  cursorSheetKey = sheet.key;
  cursorFrame = 0;
  if (cursorNode.width !== sheet.cellW || cursorNode.height !== sheet.cellH) {
    cursorNode.resize(sheet.cellW, sheet.cellH);
  }
  const fill = fillFor(cellKey(sheet, 0, stateFor(sheet)));
  if (fill) cursorNode.fills = [fill];
}

/** Advances the weapon's own animation one frame. One fill swap on one node. */
export function stepCursorFrame(weapon: Weapon): void {
  if (!cursorNode || cursorNode.removed || !weapon.art || !cursorSheetKey) return;

  const sheet = currentSheet(weapon.art);
  if (sheet.frames <= 1) return;

  cursorFrame = (cursorFrame + 1) % sheet.frames;
  const fill = fillFor(cellKey(sheet, cursorFrame, stateFor(sheet)));
  if (fill) cursorNode.fills = [fill];
}

/**
 * Travel below this on an axis is not movement. Upstream's value, from `hit()`:
 *
 *     if (Math.abs(dirX) < 4) dirX = 0
 *     if (Math.abs(dirY) < 4) dirY = 0
 */
const AIM_DEADZONE_PX = 4;

/**
 * Upstream's row order for the saw's 8-row firing sheet, transcribed from the nested
 * ternary in `hit()`:
 *
 *     0 right, 1 up right, 2 up, 3 up left, 4 left, 5 down left, 6 down, 7 down right
 *
 * Which is anticlockwise from east in screen coordinates — y grows downwards, so "up"
 * is negative dy. This is a property of the artwork, not a convention we get to pick:
 * the rows were sliced in the order the sheet was drawn in, so any other mapping puts
 * the blade at the wrong angle rather than merely at a differently-numbered one.
 *
 * Callers must apply the deadzone first and must not call this with (0,0) — upstream
 * treats a fully-squashed sample as "no new heading", which is not a row.
 */
function headingRow(dx: number, dy: number): number {
  if (dx === 0) return dy < 0 ? 2 : 6;
  if (dx > 0) return dy === 0 ? 0 : dy < 0 ? 1 : 7;
  return dy === 0 ? 4 : dy < 0 ? 3 : 5;
}

/**
 * Points the weapon along the direction the cursor is travelling, for the one weapon
 * whose art can be pointed anywhere.
 *
 * The chain-saw's firing sheet is the only 2-D sheet in the set: 2 columns of blade
 * animation by 8 rows of compass heading. `stepCursorFrame` walks the columns; this
 * chooses the row. Everything else — every other weapon, and the saw's own 1-row idle
 * sheet — has a single row, so this returns immediately for them. It is gated on the
 * *current* sheet rather than on the weapon, because the saw is only pointable while
 * it is actually cutting.
 *
 * The deadzone is upstream's, verbatim: each axis is squashed to zero below 4px of
 * travel, and a sample that squashes to (0,0) leaves the heading alone entirely rather
 * than falling back to some default. Without it, a hand resting on a mouse produces a
 * pixel of noise per axis per sample and the saw shivers between neighbouring headings
 * about thirty times a second. Note that the threshold is per axis, not on the
 * distance: that is what makes a mostly-horizontal drag read as flat "right" instead
 * of flickering between right and up-right on every stray vertical pixel.
 *
 * Returning early when the row is unchanged is the point of the comparison. This runs
 * on every cursor sample, and a fill write is a document mutation Figma syncs to every
 * other user in the file — so the common case, dragging in one direction, must cost
 * nothing. Only the eight moments in a drag where the heading actually turns pay.
 */
export function aimCursor(weapon: Weapon, dx: number, dy: number): void {
  if (!cursorNode || cursorNode.removed || !weapon.art || !cursorSheetKey) return;

  const sheet = currentSheet(weapon.art);
  if (sheet.states <= 1) return;

  const x = Math.abs(dx) < AIM_DEADZONE_PX ? 0 : dx;
  const y = Math.abs(dy) < AIM_DEADZONE_PX ? 0 : dy;
  if (x === 0 && y === 0) return;

  const state = headingRow(x, y);
  if (state === cursorState) return;

  const fill = fillFor(cellKey(sheet, cursorFrame, state));
  // A row with no registered cell means a broken sheet, and swallowing the write while
  // keeping `cursorState` would leave the node showing one heading and this module
  // believing another — after which `stepCursorFrame` would ask for the same missing
  // cells and the blade would stop animating too. Leaving both alone degrades to "the
  // saw does not turn" instead.
  if (!fill) return;

  cursorNode.fills = [fill];
  cursorState = state;
}

/**
 * Lifts the weapon back to the top of the page so it reads as being held *above*
 * the mess it is making.
 *
 * Called once per cursor sample rather than per impact. Ordering each mark below the
 * weapon individually would mean an `indexOf` over the page's children for every
 * mark — O(n) against a list this plugin exists to grow.
 */
export function raiseCursor(): void {
  if (cursorNode && !cursorNode.removed) figma.currentPage.appendChild(cursorNode);
}

// --- impacts ---------------------------------------------------------------

/**
 * Places one permanent mark for `weapon`, centred on `p` plus its dispersion, and fires
 * off whatever else the impact implies — a flame, a termite.
 *
 * Returns false when the weapon has nothing to draw — the chain-saw and termites
 * genuinely ship no hit sprites, so this is an expected answer, not a failure.
 *
 * `true` means the mark is committed, not that the node exists: `hitDelayMs` can hold it
 * back a few hundred ms so the fire arrives first. Everything the caller does with the
 * answer — counting the shot, playing its sound — belongs at the moment of impact rather
 * than the moment the mark appears, so the distinction does not leak out.
 */
export function impact(weapon: Weapon, p: Point): boolean {
  const art = weapon.art;
  if (!art) return false;
  if (weapon.crawl) return spawnCrawler(weapon, p);

  const base = pick(art.hits);
  if (!base) return false;

  // A tinted weapon draws `${hit}@${deg}`; the slicer baked one frame per angle,
  // including 0, so there is no untinted fallback to fall through to.
  const degrees = pick(art.tints ?? []);
  const key = degrees === null ? base : `${base}@${degrees}`;

  const fill = fillFor(key);
  if (!fill) {
    // Silent otherwise: no mark, no sound, and indistinguishable from a weapon that
    // simply did not fire. Usually means a hit names a cell of an undeclared sheet.
    console.warn(`[desktop-destroyer] ${weapon.id}: no frame registered for hit "${key}"`);
    return false;
  }

  // Dispersion scatters within a square rather than a disc. Upstream does the same,
  // and at these radii the difference is not perceptible.
  const jitterX = weapon.dispersion ? (Math.random() * 2 - 1) * weapon.dispersion : 0;
  const jitterY = weapon.dispersion ? (Math.random() * 2 - 1) * weapon.dispersion : 0;

  // The dispersed point, so the fire and the mark it leaves are in the same place —
  // upstream spawns its particle from the same jittered coordinates for that reason.
  spawnFlame(weapon, { x: p.x + jitterX, y: p.y + jitterY });

  const size = art.hitSize;
  const place = (): void => {
    const node = figma.createRectangle();
    node.name = `${weapon.id} damage`;
    node.setPluginData(TAG, TAG_DAMAGE);
    node.x = p.x + jitterX - size / 2;
    node.y = p.y + jitterY - size / 2;
    node.resize(size, size);
    node.strokes = [];
    node.fills = [fill];
    figma.currentPage.appendChild(node);
    damage.push(node);
  };

  if (art.hitDelayMs) scheduleMark(art.hitDelayMs, place);
  else place();

  return true;
}

// --- marks that arrive late ------------------------------------------------

/**
 * A mark that has been committed to but not yet drawn — see `hitDelayMs`.
 *
 * The timer is kept so the mark can be forced early, which matters more than cancelling
 * it: the impact happened, the user caused it, and a scorch that evaporates because the
 * plugin closed half a second later is damage going missing.
 */
type PendingMark = { timer: ReturnType<typeof setTimeout>; place: () => void };

let pendingMarks: PendingMark[] = [];

function scheduleMark(delayMs: number, place: () => void): void {
  const entry: PendingMark = {
    place,
    timer: setTimeout(() => {
      pendingMarks = pendingMarks.filter((m) => m !== entry);
      place();
    }, delayMs),
  };
  pendingMarks.push(entry);
}

function drainMarks(place: boolean): void {
  const outstanding = pendingMarks;
  pendingMarks = [];
  for (const m of outstanding) {
    clearTimeout(m.timer);
    if (place) m.place();
  }
}

/**
 * Draws every outstanding mark right now.
 *
 * Called wherever the firing loop stops — disarm, weapon change, page change, close —
 * because a delayed mark must not be able to arrive after the thing that caused it is
 * over, and must not be silently dropped either. Flushing satisfies both: the marks land
 * on the page they were fired at, a few hundred ms early, which is invisible.
 */
export function flushMarks(): void {
  drainMarks(true);
}

/**
 * Throws outstanding marks away instead of drawing them.
 *
 * The one case where dropping is right is `clear`: the user asked for an empty canvas,
 * and a scorch that materialises a fifth of a second after the sweep has finished is the
 * button visibly not working. This is why the two drains are separate functions rather
 * than one — the same pending mark wants opposite treatment depending on what stopped it.
 */
export function discardMarks(): void {
  drainMarks(false);
}

// --- the flame -------------------------------------------------------------

/**
 * Ceiling on concurrent flames.
 *
 * Every tick of every flame is two document mutations — a fill swap and a re-append —
 * and Figma syncs each one to everyone else in the file. The flame thrower's burst lasts
 * 384ms and arrives every 70ms, so it settles at about five and a half alive; 6 is that
 * steady state rounded up, which means the cap does not normally bite and exists to stop
 * a pathological case rather than to shape the effect.
 *
 * Overshooting drops the flame instead of queueing it. A fireball that never appears
 * during the busiest part of a drag is invisible amongst the six that did, whereas a
 * queue would spend the rest of the drag rendering fire for impacts already in the past —
 * which is the exact lag this weapon was just tuned out of.
 */
const MAX_FLAMES = 6;

type Flame = { node: RectangleNode; sheet: Sheet; frame: number };

let flames: Flame[] = [];
let flameTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * The armed weapon's `frameMs`, held here because one timer drives every live flame.
 *
 * Safe as a single value only because flames never outlive the weapon that made them:
 * arming, disarming, changing page and closing all put them out, so the list is never a
 * mix of two weapons' bursts running at two different rates.
 */
let flameFrameMs = 0;

/**
 * Puts one fireball at `p` and lets the tick animate it to nothing.
 *
 * Centred on the point rather than offset from it — upstream passes `centered: true`
 * for this particle, and a muzzle flash that hung off one corner of its impact would
 * read as a second, differently-aimed weapon.
 *
 * Not tagged as damage and not pushed onto `damage`: this node deletes itself a few
 * hundred ms from now, so counting it would make the mark tally flicker upward and back
 * down while firing. It still carries the plugin tag, so a flame orphaned by a crash
 * mid-animation is swept by `clearDamage` as the litter it is.
 */
function spawnFlame(weapon: Weapon, p: Point): void {
  const burst = weapon.art?.fire;
  if (!burst || flames.length >= MAX_FLAMES) return;

  const { sheet, from } = burst;
  // Opens on `from` rather than 0 so the first thing drawn is already visible. See the
  // measured alpha ramp in the flame thrower for why that matters.
  const fill = fillFor(cellKey(sheet, from, 0));
  if (!fill) {
    console.warn(`[desktop-destroyer] ${weapon.id}: no frame registered for the flame sheet`);
    return;
  }

  const node = figma.createRectangle();
  node.name = `${weapon.id} flame`;
  node.setPluginData(TAG, TAG_FLAME);
  // Locked for the same reason the weapon is: this is scaffolding that happens to be
  // under the cursor, and a click landing on it instead of the canvas would be wrong.
  node.locked = true;
  node.resize(sheet.cellW, sheet.cellH);
  node.strokes = [];
  node.x = p.x - sheet.cellW / 2;
  node.y = p.y - sheet.cellH / 2;
  node.fills = [fill];

  figma.currentPage.appendChild(node);
  flames.push({ node, sheet, frame: from });

  flameFrameMs = burst.frameMs;
  if (flameTimer === null) flameTimer = setTimeout(flameTick, flameFrameMs);
}

/**
 * Advances every live flame one frame, and removes the ones that have burned out.
 *
 * The re-append is what keeps a flame above the marks that land during its life. Impacts
 * arrive every 70ms and each appends a mark to the top of the page, so a flame left where
 * it was created is buried by the next five hits — the fire would flicker on and then be
 * covered by its own scorch. Re-appending on each tick is the same trick `raiseCursor`
 * uses for the weapon, and the cap above is what keeps the cost of doing it bounded.
 *
 * The timer stops itself when the last flame dies rather than idling: there is no point
 * waking every frame for the whole session to service an empty list.
 */
function flameTick(): void {
  const alive: Flame[] = [];

  for (const f of flames) {
    // Deleted by hand, or by `clear`, mid-animation.
    if (f.node.removed) continue;

    f.frame++;
    if (f.frame >= f.sheet.frames) {
      f.node.remove();
      continue;
    }

    const fill = fillFor(cellKey(f.sheet, f.frame, 0));
    if (fill) f.node.fills = [fill];
    figma.currentPage.appendChild(f.node);
    alive.push(f);
  }

  flames = alive;
  flameTimer = flames.length > 0 ? setTimeout(flameTick, flameFrameMs) : null;
}

/**
 * Puts out every flame immediately.
 *
 * Unlike the termites, which are damage and stay on the canvas when the plugin closes,
 * a flame is mid-animation scaffolding — abandoning one leaves a fireball frozen on the
 * canvas forever, which is not a mark the user made and not something they can
 * obviously get rid of. So these are removed outright rather than settled.
 */
export function clearFlames(): void {
  if (flameTimer !== null) clearTimeout(flameTimer);
  flameTimer = null;

  for (const f of flames) if (!f.node.removed) f.node.remove();
  flames = [];
}

// --- the cut ---------------------------------------------------------------

/** Below this the cursor has effectively not moved, and a node would be jitter. */
const MIN_CUT_PX = 2;

/**
 * Lays one segment of the chain-saw's kerf, from `from` to `to`.
 *
 * Upstream draws its cut as a scribble of 2x2 rects along the path. That does not port:
 * at 2px a single drag is hundreds of nodes, and this plugin's whole cost model is that
 * a mark is one cheap node placed once. So the kerf is one rotated rectangle per cursor
 * sample instead — about thirty a second while moving, joined end to end into a
 * continuous line, which is what the scribble adds up to visually anyway.
 *
 * `relativeTransform` rather than the `rotation` property: rotation is defined about the
 * node's centre, so setting it would swing the band off the path and require correcting
 * for the swing. The matrix places the corner exactly where it is wanted in one step.
 */
export function cutTo(weapon: Weapon, from: Point, to: Point): void {
  const cut = weapon.art?.cut;
  if (!cut) return;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < MIN_CUT_PX) return;

  const cos = dx / length;
  const sin = dy / length;
  const w = cut.width;

  const node = figma.createRectangle();
  node.name = `${weapon.id} cut`;
  node.setPluginData(TAG, TAG_DAMAGE);
  node.resize(length, w);
  node.strokes = [];
  node.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  // Shifted half a width along the normal so the band straddles the path rather than
  // hanging off one side of it.
  node.relativeTransform = [
    [cos, -sin, from.x + (sin * w) / 2],
    [sin, cos, from.y - (cos * w) / 2],
  ];

  figma.currentPage.appendChild(node);
  damage.push(node);

  // The saw has to stay above the slot it is cutting.
  raiseCursor();
}

// --- crawling marks --------------------------------------------------------

/**
 * Termites walk after they land.
 *
 * The sprite grid is what makes this cheap enough to attempt: 2 columns of leg
 * animation by 8 rows, which are 4 compass headings in a stopped posture (rows 0-3)
 * and the same 4 walking (rows 4-7). So a step is one `x`/`y` write plus one fill
 * swap, with no art to generate.
 *
 * It is still the most expensive thing in this plugin. Every step is a document
 * mutation that Figma syncs to other users and may push onto the undo stack, and
 * there is deliberately NO cap on the swarm — that was an explicit choice, so the
 * cost scales with how many bugs you place and never comes back down. A few dozen is
 * comfortable; several hundred will make the file sluggish. `clear` is the release
 * valve, and closing the plugin stops the timer.
 */
const CRAWL_TICK_MS = 140;
const CRAWL_STEP_PX = 4;
/** Steps taken before a termite reconsiders its heading. */
const CRAWL_RUN_MIN = 4;
const CRAWL_RUN_SPREAD = 9;
/** Row offset from a heading's stopped posture to its walking one. */
const WALKING_ROW = 4;
const HEADINGS = [
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
] as const;

type Crawler = {
  node: RectangleNode;
  sheet: Sheet;
  x: number;
  y: number;
  heading: number;
  frame: number;
  stepsLeft: number;
};

let crawlers: Crawler[] = [];
let crawlTimer: ReturnType<typeof setTimeout> | null = null;

function crawlRun(): number {
  return CRAWL_RUN_MIN + Math.floor(Math.random() * CRAWL_RUN_SPREAD);
}

function spawnCrawler(weapon: Weapon, p: Point): boolean {
  const art = weapon.art;
  const sheet = art?.extraSheets?.[0];
  if (!art || !sheet) return false;

  const heading = Math.floor(Math.random() * HEADINGS.length);
  const frame = Math.floor(Math.random() * sheet.frames);
  const fill = fillFor(cellKey(sheet, frame, WALKING_ROW + heading));
  if (!fill) {
    console.warn(`[desktop-destroyer] ${weapon.id}: no frame for the walking termite grid`);
    return false;
  }

  const jitterX = weapon.dispersion ? (Math.random() * 2 - 1) * weapon.dispersion : 0;
  const jitterY = weapon.dispersion ? (Math.random() * 2 - 1) * weapon.dispersion : 0;
  const size = art.hitSize;
  const x = p.x + jitterX - size / 2;
  const y = p.y + jitterY - size / 2;

  const node = figma.createRectangle();
  node.name = `${weapon.id} damage`;
  node.setPluginData(TAG, TAG_DAMAGE);
  node.x = x;
  node.y = y;
  node.resize(size, size);
  node.strokes = [];
  node.fills = [fill];

  figma.currentPage.appendChild(node);
  damage.push(node);
  crawlers.push({ node, sheet, x, y, heading, frame, stepsLeft: crawlRun() });

  if (crawlTimer === null) crawlTimer = setTimeout(crawlTick, CRAWL_TICK_MS);
  return true;
}

function crawlTick(): void {
  for (const c of crawlers) {
    if (c.node.removed) continue;

    if (--c.stepsLeft <= 0) {
      c.heading = Math.floor(Math.random() * HEADINGS.length);
      c.stepsLeft = crawlRun();
    }

    const step = HEADINGS[c.heading] ?? HEADINGS[0];
    c.x += step.x * CRAWL_STEP_PX;
    c.y += step.y * CRAWL_STEP_PX;
    c.node.x = c.x;
    c.node.y = c.y;

    c.frame = (c.frame + 1) % c.sheet.frames;
    const fill = fillFor(cellKey(c.sheet, c.frame, WALKING_ROW + c.heading));
    if (fill) c.node.fills = [fill];
  }

  // A termite the user deleted by hand, or `clear` removed, stops being our problem.
  crawlers = crawlers.filter((c) => !c.node.removed);

  crawlTimer = crawlers.length > 0 ? setTimeout(crawlTick, CRAWL_TICK_MS) : null;
}

/**
 * Stops the swarm and leaves every termite in the stopped posture for its heading.
 *
 * Called when the plugin closes: the bugs stay on the canvas as damage, but they stay
 * as bugs that have come to rest rather than ones frozen mid-stride.
 */
export function settleCrawlers(): void {
  if (crawlTimer !== null) clearTimeout(crawlTimer);
  crawlTimer = null;

  for (const c of crawlers) {
    if (c.node.removed) continue;
    const fill = fillFor(cellKey(c.sheet, 0, c.heading));
    if (fill) c.node.fills = [fill];
  }
  crawlers = [];
}

export function crawlerCount(): number {
  return crawlers.length;
}

// --- housekeeping ----------------------------------------------------------

/**
 * Marks drawn, plus marks committed to but still waiting on `hitDelayMs`.
 *
 * Counting the pending ones is what keeps the readout honest without any notification
 * plumbing back to `main/index.ts`. The count is posted immediately after a burst, at
 * which point a delayed mark's node does not exist yet — so counting nodes alone would
 * report low and then never correct itself for the last burst before you stopped firing.
 * A pending mark is not a maybe: the impact happened and the mark is going to appear.
 * When it does, `damage` grows as `pendingMarks` shrinks and this total does not move.
 */
export function damageCount(): number {
  return damage.length + pendingMarks.length;
}

/**
 * Removes every mark this plugin has ever left in the document, not merely the ones
 * this session drew.
 *
 * The tag is the authority rather than the `damage` list, for three reasons, all of
 * which look identical to the user — a clear button that leaves marks behind:
 *
 *   - marks from a previous run are not in the list at all;
 *   - marks land on whichever page was current at the time, and the list does not
 *     record which;
 *   - a mark the user has since dragged into a frame or group is no longer a direct
 *     child of the page, so a shallow pass would miss it.
 *
 * `findAll` walks the whole document, which is not cheap, but this runs on an explicit
 * button press rather than in the firing loop.
 *
 * Stale weapon nodes are swept too. The weapon is scaffolding that is meant to be
 * removed on close, so any that outlived their session — a crash, a reload — are
 * litter by definition. The one currently in hand is spared.
 */
export async function clearDamage(): Promise<number> {
  // The swarm must stop before its nodes go, or the next tick walks corpses. Same for
  // the flames: `flameTick` tolerates a removed node, but stopping first means the sweep
  // is not racing a timer that is still appending fireballs back onto the page.
  settleCrawlers();
  clearFlames();
  // Dropped rather than flushed — see `discardMarks`. Placing them here would draw marks
  // and then immediately sweep them; leaving them scheduled would draw them *after* the
  // sweep, onto the canvas the user just asked to have emptied.
  discardMarks();

  // Required before touching other pages under `documentAccess: dynamic-page`.
  await figma.loadAllPagesAsync();

  const mine = figma.root.findAll((node) => node.getPluginData(TAG) !== '');

  let removed = 0;
  for (const node of mine) {
    if (node === cursorNode || node.removed) continue;
    const kind = node.getPluginData(TAG);
    node.remove();
    if (kind === TAG_DAMAGE) removed++;
  }

  damage = [];
  return removed;
}
