/**
 * The weapon schema, modelled on the windows93 recreation's own (see
 * desktop-destroyer-ref/DesktopDestroyer.js), because that is where the sprites and
 * their geometry come from and inventing a different shape would only mean
 * translating between the two forever.
 */

export type Vec = { x: number; y: number };

/**
 * A sprite sheet laid out as a grid: `frames` columns across, `states` rows down.
 * Upstream computes `frameWidth = width / frames` and `frameHeight = height / states`,
 * so a cell is one column by one row.
 *
 * `cellW`/`cellH` are declared rather than derived so the main thread can size nodes
 * without decoding an image — it has no decoder. `npm run verify` cross-checks every
 * declaration against the real PNG header, so a wrong number is a build failure
 * rather than a silent misdraw of every cell after the first.
 */
export type Sheet = {
  /** Asset key into the generated W93 map, e.g. `0-hammer/cursor-release`. */
  key: string;
  frames: number;
  states: number;
  cellW: number;
  cellH: number;
};

/**
 * A muzzle flash: an animation played at the impact point and then thrown away.
 *
 * The two timing fields are separate because they answer different questions, and
 * conflating them is what made the flame thrower feel late. `frameMs` is how fast the
 * animation runs — a tuning value. `from` is which frame it is worth starting at — a
 * property of the sheet, which is why it is declared per weapon rather than being a
 * constant in `main/damage.ts`. A sheet that opens on a bright frame wants `from: 0`,
 * and hardcoding a skip would silently chop the front off it.
 */
export type FireBurst = {
  sheet: Sheet;
  /**
   * ms per frame. Upstream ran one global particle timer at 50 for every weapon, which
   * for a 20-frame sheet that peaks near the end means the fireball arrives long after
   * the hit that caused it. Lower is snappier.
   */
  frameMs: number;
  /**
   * First frame to draw.
   *
   * Skips a lead-in too faint to see. Time spent on those frames is pure latency: the
   * node exists, ticks, and shows nothing, so the fire reads as lagging the cursor.
   */
  from: number;
};

export type WeaponArt = {
  /** The weapon at rest. Cycles its frames at `cursorUpRateMs` when frames > 1. */
  cursorUp: Sheet;
  /** The weapon firing. Null for weapons that never change (flame, color thrower). */
  cursorDown: Sheet | null;
  /**
   * Permanent marks. One is chosen at random per hit — the variety is what stops a
   * hundred impacts looking stamped from a mould.
   *
   * An entry is either a whole still (`0-hammer/hit-3`) or one cell of a sheet
   * declared in `extraSheets` (`7-termite/termite#0,3`). The cell form matters for
   * weapons whose marks only exist inside a grid: the termite's eight headings, the
   * debris the chain-saw throws.
   */
  hits: string[];
  /**
   * Sheets to slice beyond the two cursor sheets, so their cells can be referenced
   * from `hits`. Debris strips and the termite's heading grid live here.
   */
  extraSheets?: Sheet[];
  /**
   * Hue rotations, in degrees, to generate recoloured copies of every entry in
   * `hits`. The slicer emits one extra frame per hit per angle, keyed `${hit}@${deg}`,
   * and a hit picks an angle at random alongside its sprite.
   *
   * This exists because the colour thrower's five splats ship with one identical
   * five-colour palette, so the weapon throws five *shapes* in the same colour. Hue
   * rotation is the right tool rather than a tint overlay: it leaves greys alone,
   * because they have no saturation to rotate — so the black outline and the white
   * highlight survive untouched while only the paint moves.
   *
   * Absent or empty means the sprites are used exactly as shipped.
   */
  tints?: number[];
  /**
   * Saturation multiplier applied along with `tints`. 1 leaves the sprite as shipped.
   *
   * The upstream splats are muted — their magenta is (149,34,140), which is closer to
   * grey than to paint. Rotating a dull colour only produces eight dull colours, so the
   * boost is what makes the difference read as *colour* rather than as tinting.
   *
   * Because greys have no saturation to multiply, this leaves the outline and highlight
   * alone exactly as the hue rotation does.
   */
  tintSaturation?: number;
  /**
   * The flash at the muzzle: a short animation played at the impact point and then
   * removed, leaving nothing behind. Upstream's `fireFrames`, which loads `press.png`
   * from the weapon's directory and spawns it as a particle centred on the hit.
   *
   * This is the one mark in the set that is not a mark. Everything else in `WeaponArt`
   * is permanent by design — placed once and never touched again, which is what makes
   * a mark cost one node and no timer. A flame is the opposite: it exists for its own
   * duration and its whole point is to disappear. So it is a separate field rather
   * than another entry in `hits`, and `main/damage.ts` gives it a separate lifecycle.
   *
   * The distinction matters beyond bookkeeping: these nodes are NOT damage. They are
   * not counted by `damageCount`, and they are tagged so that any left orphaned by a
   * crash get swept as litter rather than tallied as marks the user made.
   *
   * Absent for the eight weapons that have no muzzle to flash.
   */
  fire?: FireBurst;
  /**
   * A continuous line drawn along the cursor's path, rather than a mark placed at an
   * impact point. The chain-saw's kerf: the debris chips are what the cut throws off,
   * but the cut itself is the black slot left behind wherever the blade travelled.
   *
   * Drawn per cursor sample rather than per impact, because it has to be continuous —
   * it is the one mark in this plugin that is about the path and not about the points
   * along it. `width` is the stroke thickness in canvas px.
   */
  cut?: { width: number };
  /** Square edge to draw a hit at, canvas px. */
  hitSize: number;
  /**
   * ms to wait before the permanent mark appears, so the `fire` burst gets there first.
   *
   * Only worth setting on a weapon whose fire is the point and whose mark is the
   * aftermath. The flame thrower's scorch is near-black and permanent while its fireball
   * is transient, so drawn at the same instant the scorch wins the eye completely and the
   * weapon reads as a black marker that happens to flicker. Landing the char *after* the
   * flame that caused it puts them in the order the effect implies.
   *
   * Absent or 0 draws the mark immediately, which is what every other weapon wants —
   * there is nothing for a hammer's crack to wait for.
   */
  hitDelayMs?: number;
};

export type Weapon = {
  id: string;
  /** 1-9, menu position and keyboard shortcut. */
  slot: number;
  /** Verbatim from the original menu. Do not tidy — see the registry's note. */
  label: string;
  /** Key into the generated ICONS map. */
  icon: string;

  /**
   * Minimum ms between hits. A hard ceiling on rate of fire, enforced alongside
   * `minTravel`: distance decides the spacing of marks, time decides how fast they
   * can possibly appear, and whichever is more restrictive wins.
   */
  fireRateMs: number;
  /**
   * Canvas px of cursor travel between hits.
   *
   * This has no upstream equivalent, and exists because we cannot see the mouse
   * button. Upstream gates on time alone because it knows when you are holding the
   * button down; we don't, so distance is what separates "dragging a weapon around"
   * from "parked the cursor and walked away".
   */
  minTravel: number;
  /** Random scatter applied to each hit, canvas px. Upstream's `dispersion`. */
  dispersion: number;
  /** ms per idle-cursor frame. Upstream's `cursorUpRate`. */
  cursorUpRateMs: number;
  /**
   * Where the artwork sits relative to the cursor. Hits land *at* the cursor, so
   * this is what makes a weapon's business end coincide with the point of damage —
   * the hammer's face, the gun's muzzle. Upstream's `cursorOffset`.
   */
  cursorOffset: Vec;

  /**
   * Sound keys into the generated W93_SOUNDS map, e.g. `0-hammer/hit-3`. One is
   * chosen at random per impact. Empty or absent means this weapon is silent.
   *
   * Declared per weapon rather than in a table inside the audio module so that each
   * weapon owns everything about itself in one file.
   */
  sounds?: string[];

  /**
   * A single sound looped for as long as the weapon keeps firing, instead of one
   * sample per impact.
   *
   * Four of the weapons own sustained samples — the chain-saw's rev, the washer's
   * spray, the flame — which upstream starts on mouse-down and stops on mouse-up.
   * They are 1.5-2.5s long, so retriggering one per impact at a 60ms fire rate
   * restarts it two dozen times a second and the result is a buzz, not a chainsaw.
   *
   * The UI starts the loop on the first impact and stops it once impacts go quiet,
   * which needs no press/release event that we do not have. Mutually exclusive with
   * `sounds` in practice: a weapon is either a series of one-shots or a sustain.
   */
  sustain?: string;

  /**
   * Per-weapon level trim, multiplied into the master. 1 (the default) leaves it alone;
   * below 1 pulls the weapon back relative to the others.
   *
   * The rips are not balanced against each other — they were recorded for a toy that
   * played one at a time — so a weapon that fires fast, or whose sample is simply hotter
   * than the rest, needs taking down before it dominates. This is the knob for "that one
   * is too loud", not for overall volume, which is `MASTER_VOLUME` in `ui/audio.ts`.
   */
  volume?: number;

  /**
   * Marks left by this weapon walk around after they land, rather than sitting where
   * they were put. Only the termites do this, and only because they are animals.
   *
   * Every step is a node mutation that Figma syncs, so this is the most expensive
   * thing in the plugin by a wide margin — see the crawl section in `main/damage.ts`.
   */
  crawl?: boolean;

  /** Null while a weapon has no art wired up; the menu greys those out. */
  art: WeaponArt | null;
};

/** Frame key for one cell of a sheet, matching what the UI slicer emits. */
export function cellKey(sheet: Sheet | string, frame = 0, state = 0): string {
  const key = typeof sheet === 'string' ? sheet : sheet.key;
  return `${key}#${frame},${state}`;
}
