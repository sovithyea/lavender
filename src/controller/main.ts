import { mapSticks, type RawSticks, type StickMode } from '../shared/sticks.ts';

const TRAVEL = 60; // px from centre to full deflection
const SEND_MS = 16;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const raw: RawSticks = { lx: 0, ly: 0, rx: 0, ry: 0 };

let mode: StickMode = 2;
try { mode = (Number(localStorage.getItem('stickMode')) || 2) as StickMode; } catch { /* private mode: default */ }

// Haptics: Android has navigator.vibrate; iOS 18+ ticks when a switch input toggles (only reliable inside a touch handler).
const hapticLabel = $('haptic');
function haptic() {
  if (navigator.vibrate) navigator.vibrate(15);
  else hapticLabel.click();
}

// Floating sticks: the stick centre is wherever your thumb lands, so touching never causes a jump.
// Each axis is clamped on its own, like a real square gimbal (full throttle + full yaw is possible).
function stick(zone: HTMLElement, xKey: 'lx' | 'rx', yKey: 'ly' | 'ry') {
  const base = zone.querySelector<HTMLElement>('.base')!;
  const knob = zone.querySelector<HTMLElement>('.knob')!;
  let pointer: number | null = null, ox = 0, oy = 0, atLimit = false;

  const draw = () => { knob.style.transform = `translate(${raw[xKey] * TRAVEL}px, ${-raw[yKey] * TRAVEL}px)`; };
  const release = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    raw[xKey] = raw[yKey] = 0;
    zone.classList.remove('active');
    base.style.left = base.style.top = '';
    draw();
  };
  zone.addEventListener('pointerdown', (e) => {
    if (pointer !== null) return;
    pointer = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    const r = zone.getBoundingClientRect();
    ox = e.clientX; oy = e.clientY;
    base.style.left = `${ox - r.left}px`;
    base.style.top = `${oy - r.top}px`;
    zone.classList.add('active');
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer) return;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    raw[xKey] = clamp((e.clientX - ox) / TRAVEL);
    raw[yKey] = clamp((oy - e.clientY) / TRAVEL);
    const limit = Math.abs(raw[xKey]) === 1 || Math.abs(raw[yKey]) === 1;
    if (limit && !atLimit) haptic();
    atLimit = limit;
    draw();
  });
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
}
stick($('left'), 'lx', 'ly');
stick($('right'), 'rx', 'ry');

// Block iOS pinch-zoom, double-tap zoom and the long-press menu.
for (const ev of ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

// Settings: stick mode.
const modes = $('modes');
for (const m of [1, 2, 3, 4] as const) {
  modes.insertAdjacentHTML('beforeend',
    `<label><input type="radio" name="mode" value="${m}" ${m === mode ? 'checked' : ''}/> Mode ${m}</label>`);
}
modes.addEventListener('change', (e) => {
  mode = Number((e.target as HTMLInputElement).value) as StickMode;
  try { localStorage.setItem('stickMode', String(mode)); } catch { /* not persisted */ }
  showMode();
});
const showMode = () => { $('modeLabel').textContent = `Mode ${mode}`; };
showMode();
$('settingsBtn').addEventListener('click', () => { haptic(); $<HTMLDialogElement>('settings').showModal(); });

// Connection: send sticks at ~60 Hz; reconnect forever.
const status = $('status');
let ws: WebSocket | null = null;
let simConnected = false;
const setStatus = () => {
  const open = ws?.readyState === WebSocket.OPEN;
  status.textContent = !open ? 'No server' : simConnected ? 'Linked' : 'Sim not open';
  status.className = open && simConnected ? 'ok' : 'bad';
};
function connect() {
  ws = new WebSocket(`ws://${location.host}/ws?role=controller`);
  ws.onopen = setStatus;
  ws.onclose = () => { simConnected = false; setStatus(); setTimeout(connect, 1000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'peer' && msg.role === 'sim') { simConnected = msg.connected; setStatus(); }
    if (msg.type === 'haptic') haptic();
  };
}
connect();

const send = (msg: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
setInterval(() => send({ type: 'sticks', s: mapSticks(mode, raw) }), SEND_MS);

for (const cmd of ['pause', 'reset'] as const) {
  $(cmd).addEventListener('click', () => { haptic(); send({ type: 'cmd', cmd }); });
}
