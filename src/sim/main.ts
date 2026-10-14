import GUI from 'lil-gui';
import * as THREE from 'three';
import { PRESETS, SIM, type FlightParams } from '../shared/config.ts';
import { createState, DEG, G, step, windFrom } from '../shared/physics.ts';
import { NEUTRAL, sanitizeSticks, type Sticks } from '../shared/sticks.ts';
import { createAudio } from './audio.ts';
import { createTraining } from './training.ts';
import { buildDrone, buildLocation, buildShadow, buildWorld, disposeObject, LOCATIONS, poseDrone, type Location } from './scene.ts';

const DT = 1 / SIM.physicsHz;
const $ = (id: string) => document.getElementById(id)!;

// --- settings panel: preset, flight mode, wind, start orientation and every flight number.
// Saved in this browser so your tuning survives a reload; picking a preset reloads it from config.ts.
const STARTS = { 'Nose out': 0, 'Nose in': 180, 'Nose left': 270, 'Nose right': 90, Random: -1 };
const settings = {
  preset: 'agile' as keyof typeof PRESETS, start: 0, windSpeed: 0, windFrom: 0,
  location: 'field' as Location, grid: false, sound: true, volume: 0.7, autoZoom: true,
};
const params: FlightParams = { ...PRESETS.agile.params };
try {
  const saved = JSON.parse(localStorage.getItem('simSettings') ?? '{}');
  Object.assign(settings, saved.settings);
  Object.assign(params, saved.params);
} catch { /* nothing saved, or storage blocked: use defaults */ }
if (!(settings.location in LOCATIONS)) settings.location = 'field';
const save = () => {
  try { localStorage.setItem('simSettings', JSON.stringify({ settings, params })); } catch { /* not persisted */ }
};

const gui = new GUI({ title: 'Settings' });
gui.add(settings, 'preset', Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [v.label, k]))).name('Preset')
  .onChange((k: keyof typeof PRESETS) => { Object.assign(params, { ...PRESETS[k].params, mode: params.mode }); gui.controllersRecursive().forEach((c) => c.updateDisplay()); });
gui.add(params, 'mode', { Stabilised: 'stabilised', 'Attitude (no position hold)': 'attitude' }).name('Flight mode');
gui.add(settings, 'start', STARTS).name('Start orientation').onChange(() => command('reset'));
gui.add(settings, 'location', Object.fromEntries(Object.entries(LOCATIONS).map(([k, v]) => [v, k]))).name('Location').onChange(setLocation);
gui.add(settings, 'grid').name('5 m distance grid').onChange((v: boolean) => { grid.visible = v; });
gui.add(settings, 'autoZoom').name('Zoom in on distant drone');
const windGui = gui.addFolder('Wind');
windGui.add(settings, 'windSpeed', 0, 12, 0.5).name('Speed (m/s)');
windGui.add(settings, 'windFrom', 0, 359, 1).name('From (°, 0 = beyond drone)');
const soundGui = gui.addFolder('Sound');
soundGui.add(settings, 'sound').name('On');
soundGui.add(settings, 'volume', 0, 1, 0.05).name('Volume');
const tune = gui.addFolder('Tuning').close();
const RANGES: Partial<Record<keyof FlightParams, [number, number, number]>> = {
  maxSpeed: [1, 25, 0.5], maxClimb: [0.5, 10, 0.5], maxDescent: [0.5, 10, 0.5], maxTiltDeg: [5, 45, 1],
  maxTiltRateDeg: [20, 400, 10], maxYawRateDeg: [10, 250, 5], maxAccel: [0.5, 15, 0.5], maxVertAccel: [0.5, 10, 0.5],
  expo: [0, 1, 0.05], motorLag: [0.01, 0.4, 0.01], drag: [0, 0.2, 0.005], maxThrustG: [1.2, 4, 0.1],
};
for (const [key, [min, max, stepSize]] of Object.entries(RANGES)) tune.add(params, key as keyof FlightParams, min, max, stepSize);
gui.onFinishChange(save);

const spawn = (startDeg = settings.start) => {
  const yaw = startDeg < 0 ? Math.random() * 2 * Math.PI : startDeg * DEG;
  return createState({ x: 0, y: 0, z: -SIM.spawnDistance }, yaw);
};
let drone = spawn();
let sticks: Sticks = NEUTRAL;
let lastStickAt = -Infinity;
let everLinked = false;
let paused = false;

// --- three.js
// Log depth stops far-off flat surfaces (sea over sand, shadows on grass) flickering through each other.
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(devicePixelRatio);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const grid = buildWorld(scene);
grid.visible = settings.grid;
let place = buildLocation(settings.location);
scene.add(place);
function setLocation(loc: Location) {
  scene.remove(place);
  disposeObject(place);
  place = buildLocation(loc);
  scene.add(place);
}
const audio = createAudio();
const droneMesh = buildDrone();
const shadow = buildShadow();
scene.add(droneMesh, shadow);
const FOV = 50;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 1000);
camera.position.set(0, SIM.pilotEyeHeight, 0);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- training exercises
let ws: WebSocket | null = null;
const training = createTraining(scene, {
  start: (ex) => {
    drone = spawn(ex.startYaw ?? 0);
    paused = false;
    $('paused').hidden = true;
  },
  buzz: () => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'haptic' })); },
});

// --- commands (phone buttons and Mac keys)
function command(cmd: string) {
  if (cmd === 'reset') { if (training.exercise()) training.restart(); else drone = spawn(); }
  if (cmd === 'pause') { paused = !paused; $('paused').hidden = !paused; }
}
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('.lil-gui')) return; // typing in the panel
  if (training.key(e.key)) return;
  if (e.key === 'r' || e.key === 'R') command('reset');
  if (e.key === 'p' || e.key === 'P' || e.key === ' ') command('pause');
});

// --- connection to the phone (through the server relay)
function connect() {
  ws = new WebSocket(`ws://${location.host}/ws?role=sim`);
  ws.onmessage = (e) => {
    let msg: { type?: string; s?: unknown; cmd?: unknown };
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'sticks') { sticks = sanitizeSticks(msg.s); lastStickAt = performance.now(); everLinked = true; }
    if (msg.type === 'cmd' && typeof msg.cmd === 'string') command(msg.cmd);
  };
  ws.onclose = () => setTimeout(connect, 1000);
}
connect();
fetch('/api/connect').then((r) => r.json()).then(({ url, svg }) => { $('qr').innerHTML = svg; $('url').textContent = url; });

// --- HUD
const fmt = (v: number) => v.toFixed(1);
function hud(linked: boolean, p: FlightParams, w: { speed: number; from: number }) {
  $('alt').textContent = fmt(drone.pos.y);
  $('gs').textContent = fmt(Math.hypot(drone.vel.x, drone.vel.z));
  $('vs').textContent = fmt(drone.vel.y);
  const bearing = (deg: number) => String(Math.round((deg + 360) % 360)).padStart(3, '0');
  $('hdg').textContent = bearing(drone.yaw / DEG);
  $('mode').textContent = p.mode === 'attitude' ? 'ATTI' : 'STAB';
  $('wind').textContent = w.speed ? `${w.speed} from ${bearing(w.from)}°` : 'calm';
  const dot = (id: string, x: number, y: number) => { $(id).style.transform = `translate(${x * 20}px, ${-y * 20}px)`; };
  dot('padL', sticks.yaw, sticks.throttle); // shown as Mode 2 layout
  dot('padR', sticks.roll, sticks.pitch);
  const banner = $('banner');
  banner.hidden = linked;
  banner.textContent = everLinked ? 'CONTROLLER LOST: sticks neutral, holding position' : 'Controller not connected: scan the QR code';
  $('connect').hidden = linked;
}

// --- fixed-timestep physics, decoupled from the render rate
let last = performance.now(), acc = 0;
function frame(now: number) {
  acc += Math.min(0.25, (now - last) / 1000); // cap so a stalled tab doesn't fast-forward
  last = now;
  const linked = now - lastStickAt <= SIM.failsafeMs;
  if (!linked) sticks = NEUTRAL;
  if (paused) acc = 0;
  // An exercise can override the flight mode and wind (e.g. attitude mode in a crosswind).
  const ex = training.exercise();
  const p = ex?.params ? { ...params, ...ex.params } : params;
  const w = ex?.wind ?? { speed: settings.windSpeed, from: settings.windFrom };
  const wind = windFrom(w.speed, w.from);
  for (; acc >= DT; acc -= DT) {
    step(drone, sticks, p, wind, DT);
    training.tick(drone, DT);
  }

  poseDrone(droneMesh, shadow, drone);
  camera.lookAt(droneMesh.position);
  // Auto-zoom keeps the drone about the size it looks at 20 m, so you can still read its attitude far away.
  const dist = camera.position.distanceTo(droneMesh.position);
  const fov = settings.autoZoom && dist > 20 ? Math.max(10, (2 * Math.atan((Math.tan((FOV / 2) * DEG) * 20) / dist)) / DEG) : FOV;
  camera.fov += (fov - camera.fov) * 0.1;
  camera.updateProjectionMatrix();
  $('zoom').textContent = camera.fov < FOV - 1 ? `${(FOV / camera.fov).toFixed(1)}× zoom` : '';
  training.frame(drone, now / 1000);
  audio.update({
    on: settings.sound, volume: settings.volume, wind: w.speed, beach: settings.location === 'beach',
    motors: !paused && (drone.pos.y > 0 || sticks.throttle > 0.05), thrust: drone.thrust / G,
    distance: dist, pitch: settings.preset === 'heavy' ? 0.6 : 1,
  });
  $('soundHint').hidden = !settings.sound || audio.running();
  hud(linked, p, w);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
