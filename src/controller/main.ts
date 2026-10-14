import { mapSticks, type RawSticks, type StickMode } from '../shared/sticks.ts';

const TRAVEL = 82; // px from centre to full deflection: the knob reaches the edge of the square
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

// Fixed sticks, like a real remote: each stick's centre stays put, and the stick deflects by how far
// your thumb is from it, so touching off-centre moves the drone straight away.
// Each axis is clamped on its own, like a real square gimbal (full throttle + full yaw is possible).
function stick(zone: HTMLElement, xKey: 'lx' | 'rx', yKey: 'ly' | 'ry') {
  const base = zone.querySelector<HTMLElement>('.base')!;
  const knob = zone.querySelector<HTMLElement>('.knob')!;
  let pointer: number | null = null, atLimit = false;

  const draw = () => { knob.style.transform = `translate(${raw[xKey] * TRAVEL}px, ${-raw[yKey] * TRAVEL}px)`; };
  const move = (e: PointerEvent) => {
    const r = base.getBoundingClientRect();
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    raw[xKey] = clamp((e.clientX - (r.left + r.width / 2)) / TRAVEL);
    raw[yKey] = clamp((r.top + r.height / 2 - e.clientY) / TRAVEL);
    const limit = Math.abs(raw[xKey]) === 1 || Math.abs(raw[yKey]) === 1;
    if (limit && !atLimit) haptic();
    atLimit = limit;
    draw();
  };
  const release = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    raw[xKey] = raw[yKey] = 0;
    atLimit = false;
    zone.classList.remove('active');
    draw();
  };
  zone.addEventListener('pointerdown', (e) => {
    if (pointer !== null) return;
    pointer = e.pointerId;
    zone.classList.add('active');
    move(e);
    zone.setPointerCapture(e.pointerId);
  });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId === pointer) move(e); });
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

// Settings: start orientation (the sim owns it; the phone remembers your last pick).
const ORIENTS: [string, number][] = [['Nose out', 0], ['Nose in', 180], ['Nose left', 270], ['Nose right', 90], ['Random', -1]];
let orient = 0;
try { orient = Number(localStorage.getItem('startOrientation') ?? 0); } catch { /* default */ }
for (const [label, deg] of ORIENTS) {
  $('orients').insertAdjacentHTML('beforeend',
    `<label><input type="radio" name="orient" value="${deg}" ${deg === orient ? 'checked' : ''}/> ${label}</label>`);
}
$('orients').addEventListener('change', (e) => {
  orient = Number((e.target as HTMLInputElement).value);
  try { localStorage.setItem('startOrientation', String(orient)); } catch { /* not persisted */ }
  send({ type: 'cmd', cmd: 'start-orientation', deg: orient });
});

// Training: pick an exercise on the phone; the sim sends the list and a live status line.
const trainMode = () => (document.querySelector<HTMLInputElement>('input[name="tmode"]:checked')?.value ?? 'guided');
function showList(list: unknown) {
  if (!Array.isArray(list)) return;
  const box = $('trainList');
  box.replaceChildren(...list.filter((x) => typeof x?.id === 'string' && typeof x?.name === 'string').map((x: { id: string; name: string }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = x.name;
    b.addEventListener('click', () => {
      haptic();
      send({ type: 'cmd', cmd: 'start', id: x.id, mode: trainMode() });
      $<HTMLDialogElement>('train').close();
    });
    return b;
  }));
}
$('trainBtn').addEventListener('click', () => { haptic(); $<HTMLDialogElement>('train').showModal(); });
$('trainStop').addEventListener('click', () => { haptic(); send({ type: 'cmd', cmd: 'stop' }); $<HTMLDialogElement>('train').close(); });
$('camBtn').addEventListener('click', () => { haptic(); send({ type: 'cmd', cmd: 'camera' }); });

let resultUntil = 0;
function showStatus(msg: Record<string, unknown>) {
  const coach = $('coach'), tip = $('coachTip');
  if (msg.type === 'result') {
    resultUntil = performance.now() + 6000;
    $('coachStep').textContent = `${String(msg.name)}: ${Number(msg.score)}  ${'★'.repeat(Number(msg.stars) || 0)}`;
    tip.textContent = 'Results are on the Mac';
    coach.hidden = false;
    return;
  }
  if (performance.now() < resultUntil) return;
  coach.hidden = !msg.running;
  if (!msg.running) return;
  $('coachStep').textContent = `${Number(msg.step)}/${Number(msg.total)} · ${String(msg.text)}`;
  tip.textContent = typeof msg.tip === 'string' ? msg.tip : '';
  tip.classList.toggle('good', msg.inside === true);
}

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
    if (msg.type === 'maneuvers') showList(msg.list);
    if ((msg.type === 'maneuvers' || msg.type === 'mode') && (msg.mode === 'guided' || msg.mode === 'test')) {
      document.querySelector<HTMLInputElement>(`input[name="tmode"][value="${msg.mode}"]`)!.checked = true;
    }
    if (msg.type === 'status' || msg.type === 'result') showStatus(msg);
  };
}
connect();

const send = (msg: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
setInterval(() => send({ type: 'sticks', s: mapSticks(mode, raw) }), SEND_MS);

for (const cmd of ['pause', 'reset'] as const) {
  $(cmd).addEventListener('click', () => { haptic(); send({ type: 'cmd', cmd }); });
}
