import * as THREE from 'three';
import { PRESETS, SIM, type FlightParams } from '../shared/config.ts';
import { createState, step } from '../shared/physics.ts';
import { NEUTRAL, sanitizeSticks, type Sticks } from '../shared/sticks.ts';
import { buildDrone, buildField, buildShadow, poseDrone } from './scene.ts';

const DT = 1 / SIM.physicsHz;
const CALM = { x: 0, y: 0, z: 0 };
const $ = (id: string) => document.getElementById(id)!;

const params: FlightParams = { ...PRESETS.agile.params };
const spawn = () => createState({ x: 0, y: 0, z: -SIM.spawnDistance }, 0);
let drone = spawn();
let sticks: Sticks = NEUTRAL;
let lastStickAt = -Infinity;
let everLinked = false;
let paused = false;

// --- three.js
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
buildField(scene);
const droneMesh = buildDrone();
const shadow = buildShadow();
scene.add(droneMesh, shadow);
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1000);
camera.position.set(0, SIM.pilotEyeHeight, 0);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- commands (phone buttons and Mac keys)
function command(cmd: string) {
  if (cmd === 'reset') drone = spawn();
  if (cmd === 'pause') { paused = !paused; $('paused').hidden = !paused; }
}
addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') command('reset');
  if (e.key === 'p' || e.key === 'P' || e.key === ' ') command('pause');
});

// --- connection to the phone (through the server relay)
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws?role=sim`);
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
function hud(linked: boolean) {
  $('alt').textContent = fmt(drone.pos.y);
  $('gs').textContent = fmt(Math.hypot(drone.vel.x, drone.vel.z));
  $('vs').textContent = fmt(drone.vel.y);
  $('hdg').textContent = String(Math.round(((drone.yaw * 180) / Math.PI + 360) % 360)).padStart(3, '0');
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
  for (; acc >= DT; acc -= DT) step(drone, sticks, params, CALM, DT);

  poseDrone(droneMesh, shadow, drone);
  camera.lookAt(droneMesh.position);
  hud(linked);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
