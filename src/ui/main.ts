import { ICONS } from '../generated/assets';
import type { MainToUi, ProbeStats, UiToMain } from '../shared/protocol';
import { isPlayable, WEAPONS, type Weapon } from '../shared/weapons';
import { playImpact, stopSustain, warmUp } from './audio';
import { buildFrames } from './sprites';
import './styles.css';

function send(message: UiToMain): void {
  // Uint8Array survives this; Figma structured-clones the payload.
  parent.postMessage({ pluginMessage: message }, '*');
}

const grid = document.getElementById('grid') as HTMLDivElement;
const probePanel = document.getElementById('probe') as HTMLDivElement;
const clearButton = document.getElementById('clear') as HTMLButtonElement;

let armedId: string | null = null;
let spritesReady = false;
let damageCount = 0;
let probing = false;
let lastStats: ProbeStats | null = null;

const cells = new Map<string, HTMLDivElement>();

// --- menu ------------------------------------------------------------------

function buildGrid(): void {
  for (const weapon of WEAPONS) {
    const cell = document.createElement('div');
    cell.className = isPlayable(weapon) ? 'cell' : 'cell unavailable';
    cell.dataset.id = weapon.id;

    const icon = document.createElement('img');
    const src = ICONS[weapon.icon];
    if (src) icon.src = src;
    icon.alt = weapon.label;

    const label = document.createElement('span');
    label.textContent = weapon.label;

    cell.append(icon, label);
    cell.addEventListener('click', () => toggle(weapon));
    grid.appendChild(cell);
    cells.set(weapon.id, cell);
  }
}

function paintArmed(): void {
  for (const [id, cell] of cells) {
    cell.classList.toggle('armed', id === armedId);
  }
}

/** Clicking the armed weapon puts it down — the menu doubles as the holster. */
function toggle(weapon: Weapon): void {
  if (!isPlayable(weapon) || !spritesReady) return;
  // A click is both the moment we know the sounds will be wanted and the gesture that
  // grants the iframe permission to make them.
  warmUp();
  if (armedId === weapon.id) {
    send({ type: 'disarm' });
  } else {
    send({ type: 'arm', weaponId: weapon.id });
  }
}

// --- input -----------------------------------------------------------------

/** Diagnostics overlay. Keyboard-only — see the note in index.html. */
function toggleProbe(): void {
  probing = !probing;
  probePanel.hidden = !probing;
  send({ type: 'probe', on: probing });
  renderProbe();
}

clearButton.addEventListener('click', () => send({ type: 'clear-damage' }));

/**
 * Keyboard shortcuts are a convenience, never the only route to anything.
 *
 * They only fire while the iframe holds focus, and the moment you move the cursor
 * onto the canvas — which is the entire point of the plugin — focus is elsewhere and
 * Figma swallows the keystroke. Every one of these has a clickable equivalent.
 */
window.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '9') {
    const slot = Number(e.key);
    const weapon = WEAPONS.find((w) => w.slot === slot);
    if (weapon) toggle(weapon);
    return;
  }

  if (e.key === 'c' || e.key === 'C') {
    send({ type: 'clear-damage' });
    return;
  }

  if (e.key === 'p' || e.key === 'P') toggleProbe();
});

// --- diagnostics -----------------------------------------------------------

/**
 * Readout for the one thing this whole design rests on: whether
 * `activeUsers[].position` reports the current user's cursor, and how fast.
 */
function renderProbe(): void {
  if (!probing) return;

  const s = lastStats;
  if (!s) {
    probePanel.textContent = 'probing — move the cursor over the canvas…';
    return;
  }

  const selfPct = s.ticks ? Math.round((s.selfFound / s.ticks) * 100) : 0;
  const verdict =
    s.selfFound === 0
      ? '<span class="bad">FAIL — own ActiveUser entry never found</span>'
      : s.positionNonNull === 0
        ? '<span class="bad">FAIL — entry found but position always null</span>'
        : `<span class="good">OK — position is readable for self</span>`;

  // Hitting the per-sample cap is not a fault, so it gets no `good` counterpart — a
  // panel that congratulates you on a zero every quarter second teaches you to stop
  // reading it. It is only worth colouring once it has happened, at which point it
  // means the trail on the canvas is genuinely thinner than the weapon asked for.
  // The sample count comes along because 40 drops in one flick and 40 spread over 40
  // samples are different complaints.
  const dropped =
    s.shotsDropped > 0
      ? `<span class="bad">${s.shotsDropped}</span>  (${s.samplesCapped} samples)`
      : '0';

  probePanel.innerHTML = [
    '<b>cursor probe</b>  (P to hide)',
    '',
    verdict,
    '',
    `poll ticks         ${s.ticks}`,
    `self entry found   ${s.selfFound}  (${selfPct}%)`,
    `position non-null  ${s.positionNonNull}`,
    `position changed   ${s.positionChanged}`,
    `effective rate     ${s.effectiveHz.toFixed(1)} Hz`,
    `largest jump       ${s.maxJumpPx.toFixed(0)} px`,
    `shots dropped      ${dropped}`,
    `last position      ${s.lastPosition ? `${s.lastPosition.x.toFixed(0)}, ${s.lastPosition.y.toFixed(0)}` : '—'}`,
    '',
    `marks on canvas    ${damageCount}`,
    `sprites            ${spritesReady ? 'ready' : 'loading'}`,
    '',
    'click a weapon to arm, click it again to holster',
  ].join('\n');
}

// --- main thread messages --------------------------------------------------

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data?.pluginMessage as MainToUi | undefined;
  if (!message) return;

  switch (message.type) {
    case 'armed':
      armedId = message.weaponId;
      // Holstering must silence a sustained weapon; its watchdog would otherwise run
      // the loop on for another quarter second after the gun is down.
      if (armedId === null) stopSustain();
      paintArmed();
      break;

    case 'impact':
      playImpact(message.weaponId, message.count);
      break;

    case 'damage-count':
      damageCount = message.count;
      renderProbe();
      break;

    case 'probe-stats':
      lastStats = message.stats;
      renderProbe();
      break;

    case 'error':
      console.warn('[desktop-destroyer]', message.message);
      break;
  }
});

// --- startup ---------------------------------------------------------------

buildGrid();
send({ type: 'ui-ready' });

buildFrames()
  .then((frames) => {
    send({ type: 'sprites', frames });
    spritesReady = true;
    renderProbe();
  })
  .catch((err) => {
    console.error('[desktop-destroyer] sprite build failed', err);
  });
