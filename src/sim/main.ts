import GUI from 'lil-gui';
import * as THREE from 'three';
import { PRESETS, SIM, type FlightParams } from '../shared/config.ts';
import { createState, DEG, G, gustAt, step, windFrom } from '../shared/physics.ts';
import { NEUTRAL, sanitizeSticks, type Sticks } from '../shared/sticks.ts';
import { createAudio } from './audio.ts';
import { createCameras } from './cameras.ts';
import { createCourse } from './course.ts';
import { createReplay } from './replay.ts';
import { animateDrone, buildDrone, buildLocation, buildShadow, buildWorld, disposeObject, LOCATIONS, poseDrone, type Location } from './scene.ts';
import { createTrail } from './trail.ts';
import { createTraining } from './training.ts';
import { createTutorial } from './tutorial.ts';

const DT = 1 / SIM.physicsHz;
const $ = (id: string) => document.getElementById(id)!;

// --- settings panel: preset, flight mode, wind, start orientation and every flight number.
// Saved in this browser so your tuning survives a reload; picking a preset reloads it from config.ts.
const STARTS = { 'Nose out': 0, 'Nose in': 180, 'Nose left': 270, 'Nose right': 90, Random: -1 };
const settings = {
  preset: 'agile' as keyof typeof PRESETS, start: 0, windSpeed: 0, windFrom: 0, gusts: 0,
  location: 'field' as Location, grid: false, sound: true, volume: 0.7, autoZoom: true, trail: true,
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

// Download the current flight numbers, ready to paste into a preset in src/shared/config.ts.
function exportTuning() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' }));
  a.download = 'lavender-tuning.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

const gui = new GUI({ title: 'Settings' });
const refreshGui = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
gui.add(settings, 'preset', Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [v.label, k]))).name('Preset')
  .onChange((k: keyof typeof PRESETS) => { Object.assign(params, { ...PRESETS[k].params, mode: params.mode }); refreshGui(); });
gui.add(params, 'mode', { Stabilised: 'stabilised', 'Attitude (no position hold)': 'attitude' }).name('Flight mode');
gui.add(settings, 'start', STARTS).name('Start orientation').onChange(() => command('reset'));
gui.add(settings, 'location', Object.fromEntries(Object.entries(LOCATIONS).map(([k, v]) => [v, k]))).name('Location').onChange(setLocation);
gui.add(settings, 'grid').name('5 m distance grid').onChange((v: boolean) => { grid.visible = v; });
gui.add(settings, 'autoZoom').name('Zoom in on distant drone');
gui.add(settings, 'trail').name('Flight path trail');
const windGui = gui.addFolder('Wind');
windGui.add(settings, 'windSpeed', 0, 12, 0.5).name('Speed (m/s)');
windGui.add(settings, 'windFrom', 0, 359, 1).name('From (°, 0 = beyond drone)');
windGui.add(settings, 'gusts', 0, 6, 0.5).name('Gusts (m/s)');
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
tune.add({ exportTuning }, 'exportTuning').name('Export tuning (JSON)');
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
let simTime = 0; // s of flying, drives the gusts

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
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1000);
const cams = createCameras(camera, renderer.domElement);
const trail = createTrail(scene);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- training, replay and the phone link
let ws: WebSocket | null = null;
const send = (msg: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
const training = createTraining(scene, {
  start: (ex) => {
    replay.close();
    tutorial.stop();
    trail.clear();
    drone = spawn(ex.startYaw);
    paused = false;
    $('paused').hidden = true;
  },
  buzz: () => send({ type: 'haptic' }),
  send,
  replay: (file) => {
    training.stop();
    tutorial.stop();
    trail.clear();
    void replay.open(file);
  },
  lessons: () => tutorial.lessons(),
  startLesson: (id) => tutorial.startById(id),
});
const tutorial = createTutorial({
  start: () => {
    training.stop();
    replay.close();
    trail.clear();
    paused = false;
    $('paused').hidden = true;
    return (drone = spawn(0));
  },
  buzz: () => send({ type: 'haptic' }),
  send,
  menu: () => training.openMenu(),
});
const replay = createReplay(createCourse(scene), () => { drone = spawn(); });

// --- commands (phone buttons and Mac keys)
function command(cmd: string, msg: Record<string, unknown> = {}) {
  if (cmd === 'reset') {
    trail.clear();
    const lesson = tutorial.lesson();
    if (training.exercise()) training.restart();
    else if (lesson) tutorial.start(lesson);
    else drone = spawn();
  }
  if (cmd === 'pause') { paused = !paused; $('paused').hidden = !paused; }
  if (cmd === 'camera') cams.next();
  if (cmd === 'start') training.startById(msg.id, msg.mode);
  if (cmd === 'stop') training.stop();
  if (cmd === 'start-orientation' && Object.values(STARTS).includes(msg.deg as number)) {
    settings.start = msg.deg as number;
    refreshGui();
    save();
    if (!training.exercise()) drone = spawn();
  }
}
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('.lil-gui')) return; // typing in the panel
  if (replay.key(e.key) || tutorial.key(e.key) || training.key(e.key)) { e.preventDefault(); return; }
  if (e.key >= '1' && e.key <= '5') cams.select(Number(e.key) - 1);
  if (e.key === 'c' || e.key === 'C') cams.next();
  if (e.key === 'r' || e.key === 'R') command('reset');
  if (e.key === 'p' || e.key === 'P' || e.key === ' ') command('pause');
});

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws?role=sim`);
  ws.onmessage = (e) => {
    let msg: { type?: string; s?: unknown; cmd?: unknown; role?: unknown; connected?: unknown };
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'sticks') { sticks = sanitizeSticks(msg.s); lastStickAt = performance.now(); everLinked = true; }
    if (msg.type === 'cmd' && typeof msg.cmd === 'string') command(msg.cmd, msg as Record<string, unknown>);
    if (msg.type === 'peer' && msg.role === 'controller' && msg.connected) void training.load(); // sends the exercise list
  };
  ws.onclose = () => setTimeout(connect, 1000);
}
connect();
fetch('/api/connect').then((r) => r.json()).then(({ url, svg }) => { $('qr').innerHTML = svg; $('url').textContent = url; });

// --- HUD
const fmt = (v: number) => v.toFixed(1);
function hud(linked: boolean, p: FlightParams, w: { speed: number; from: number; gusts: number }, shown: Sticks, zoom: number) {
  $('alt').textContent = fmt(drone.pos.y);
  $('gs').textContent = fmt(Math.hypot(drone.vel.x, drone.vel.z));
  $('vs').textContent = fmt(drone.vel.y);
  const bearing = (deg: number) => String(Math.round((deg + 360) % 360)).padStart(3, '0');
  $('hdg').textContent = bearing(drone.yaw / DEG);
  $('mode').textContent = p.mode === 'attitude' ? 'ATTI' : 'STAB';
  $('wind').textContent = w.speed || w.gusts ? `${w.speed}${w.gusts ? `±${w.gusts}` : ''} from ${bearing(w.from)}°` : 'calm';
  $('cam').textContent = cams.name();
  const dot = (id: string, x: number, y: number) => { $(id).style.transform = `translate(${x * 20}px, ${-y * 20}px)`; };
  dot('padL', shown.yaw, shown.throttle); // shown as Mode 2 layout
  dot('padR', shown.roll, shown.pitch);
  $('zoom').textContent = zoom > 1.05 ? `${zoom.toFixed(1)}× zoom` : '';
  const out = Math.hypot(drone.pos.x, drone.pos.z) > SIM.boundary, high = drone.pos.y > SIM.heightLimit;
  const banner = $('banner');
  banner.hidden = (linked || replay.active()) && !out && !high;
  banner.textContent = out ? `Outside the ${SIM.boundary} m flying area` : high ? `Above the ${SIM.heightLimit} m height limit`
    : everLinked ? 'CONTROLLER LOST: sticks neutral, holding position' : 'Controller not connected: scan the QR code';
  $('connect').hidden = linked || replay.active();
}

// --- fixed-timestep physics, decoupled from the render rate
let last = performance.now(), acc = 0;
function frame(now: number) {
  const frameDt = Math.min(0.25, (now - last) / 1000); // cap so a stalled tab doesn't fast-forward
  acc += frameDt;
  last = now;
  const linked = now - lastStickAt <= SIM.failsafeMs;
  if (!linked) sticks = NEUTRAL;
  if (paused) acc = 0;
  // An exercise can override the flight mode and wind (e.g. attitude mode in a gusty crosswind).
  const ex = training.exercise() ?? tutorial.lesson();
  const p = ex?.params ? { ...params, ...ex.params } : params;
  const w = ex?.wind ?? { speed: settings.windSpeed, from: settings.windFrom, gusts: settings.gusts };
  const steady = windFrom(w.speed, w.from);
  let shown = sticks;

  const pose = replay.frame(frameDt, now / 1000);
  if (pose) {
    // Replay: the recording drives the drone; velocity comes from how far it moved this frame.
    if (frameDt > 0) drone.vel = { x: (pose.x - drone.pos.x) / frameDt, y: (pose.y - drone.pos.y) / frameDt, z: (pose.z - drone.pos.z) / frameDt };
    drone.pos = { x: pose.x, y: pose.y, z: pose.z };
    Object.assign(drone, { roll: pose.roll, pitch: pose.pitch, yaw: pose.yaw, thrust: G * (1 + pose.sticks.throttle * 0.3) });
    shown = pose.sticks;
    acc = 0;
  }
  for (; acc >= DT; acc -= DT) {
    simTime += DT;
    const g = gustAt(simTime, w.gusts);
    step(drone, sticks, p, { x: steady.x + g.x, y: steady.y + g.y, z: steady.z + g.z }, DT);
    training.tick(drone, sticks, DT);
    tutorial.tick(drone, sticks, DT);
  }
  trail.add(drone.pos);
  trail.update(settings.trail);

  poseDrone(droneMesh, shadow, drone);
  const motors = !paused && (drone.pos.y > 0 || shown.throttle > 0.05);
  animateDrone(droneMesh, motors ? drone.thrust / G : 0, frameDt);
  const zoom = cams.update(droneMesh, settings.autoZoom);
  training.frame(drone, now / 1000);
  tutorial.frame(drone, shown, now / 1000);
  audio.update({
    on: settings.sound, volume: settings.volume, wind: w.speed + w.gusts / 2, beach: settings.location === 'beach',
    motors, thrust: drone.thrust / G, distance: camera.position.distanceTo(droneMesh.position),
    pitch: settings.preset === 'heavy' ? 0.6 : 1,
  });
  $('soundHint').hidden = !settings.sound || audio.running();
  hud(linked, p, w, shown, zoom);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
