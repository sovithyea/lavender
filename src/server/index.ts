import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { parseManeuvers } from '../shared/exercises.ts';

const PORT = Number(process.env.PORT) || 5173;
const ROOT = path.join(import.meta.dirname, '..', '..');
const MANEUVERS = path.join(ROOT, 'config', 'maneuvers.json');
const ATTEMPTS = path.join(ROOT, 'data', 'attempts');

function lanAddress(): string {
  const addrs = Object.values(os.networkInterfaces()).flat();
  return addrs.find((a) => a && a.family === 'IPv4' && !a.internal)?.address ?? 'localhost';
}
// Looked up on each use: the Mac's address changes when it switches networks (e.g. to Personal Hotspot).
const controllerUrl = () => `http://${lanAddress()}:${PORT}/controller/`;

// VR headsets only allow WebXR over HTTPS, so the sim is also served on PORT + 1 with a self-signed certificate.
async function tls() {
  const dir = path.join(ROOT, 'data', 'cert'), key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  try {
    return { key: await fs.readFile(key), cert: await fs.readFile(cert) };
  } catch {
    await fs.mkdir(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-subj', '/CN=lavender', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    return { key: await fs.readFile(key), cert: await fs.readFile(cert) };
  }
}

const app = express();
const server = http.createServer(app);
const secure = https.createServer(await tls(), app);

app.get('/api/connect', async (_req, res) => {
  const url = controllerUrl();
  res.json({ url, svg: await QRCode.toString(url, { type: 'svg', margin: 1 }) });
});
// Re-read on every request, so edits to the file apply when you reload the sim.
app.get('/api/maneuvers', async (_req, res) => {
  try {
    res.json(parseManeuvers(JSON.parse(await fs.readFile(MANEUVERS, 'utf8'))));
  } catch (e) {
    res.json({ exercises: [], errors: [`config/maneuvers.json: ${(e as Error).message}`] });
  }
});

// Attempts: one JSON file each (with the replay samples), plus a small summary file for the history list.
const SUMMARY_KEYS = ['exerciseId', 'name', 'mode', 'score', 'accuracy', 'speed', 'smoothness', 'breaches', 'stars', 'time', 'date'] as const;
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
function validAttempt(a: unknown): a is Record<string, unknown> {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return typeof o.exerciseId === 'string' && /^[\w-]{1,64}$/.test(o.exerciseId) && typeof o.name === 'string' && o.name.length <= 200
    && (o.mode === 'guided' || o.mode === 'test') && typeof o.date === 'string'
    && ['score', 'accuracy', 'speed', 'smoothness', 'breaches', 'stars', 'time'].every((k) => isNum(o[k]))
    && Array.isArray(o.steps) && o.steps.every(isNum) && typeof o.exercise === 'object' && o.exercise !== null
    && Array.isArray(o.samples) && o.samples.length <= 200_000 && o.samples.every((r) => Array.isArray(r) && r.every(isNum));
}
app.post('/api/attempts', express.json({ limit: '20mb' }), async (req, res) => {
  if (!validAttempt(req.body)) return void res.status(400).json({ error: 'Not a valid attempt' });
  const base = `${Date.now()}-${req.body.exerciseId}`;
  const summary = { file: base, ...Object.fromEntries(SUMMARY_KEYS.map((k) => [k, req.body[k]])) };
  await fs.mkdir(ATTEMPTS, { recursive: true });
  await fs.writeFile(path.join(ATTEMPTS, `${base}.json`), JSON.stringify(req.body));
  await fs.writeFile(path.join(ATTEMPTS, `${base}.summary.json`), JSON.stringify(summary));
  res.json(summary);
});
app.get('/api/attempts', async (_req, res) => {
  const files = (await fs.readdir(ATTEMPTS).catch(() => [])).filter((f) => f.endsWith('.summary.json')).sort();
  const rows = await Promise.all(files.map((f) => fs.readFile(path.join(ATTEMPTS, f), 'utf8').then(JSON.parse).catch(() => null)));
  res.json(rows.filter(Boolean));
});
app.get('/api/attempts/:file', async (req, res) => {
  if (!/^\d+-[\w-]+$/.test(req.params.file)) return void res.status(400).json({ error: 'Bad attempt name' });
  try {
    res.type('json').send(await fs.readFile(path.join(ATTEMPTS, `${req.params.file}.json`), 'utf8'));
  } catch {
    res.status(404).json({ error: 'No such attempt' });
  }
});
app.get('/', (_req, res) => res.redirect('/sim/'));
app.use((req, res, next) => (req.path === '/sim' || req.path === '/controller' ? res.redirect(req.path + '/') : next()));

// Dumb relay: controller messages go to sims, sim messages go to controllers.
// shortcut: no auth, so anyone on your Wi-Fi who opens the URL can fly; add a token to the QR URL if that matters.
type Role = 'sim' | 'controller';
const peers = new Map<WebSocket, Role>();
const sendTo = (role: Role, data: string) => {
  for (const [ws, r] of peers) if (r === role && ws.readyState === WebSocket.OPEN) ws.send(data);
};
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
function upgrade(req: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') return; // Vite's HMR socket handles its own upgrades
  wss.handleUpgrade(req, socket, head, (ws) => {
    const role: Role = url.searchParams.get('role') === 'sim' ? 'sim' : 'controller';
    const other: Role = role === 'sim' ? 'controller' : 'sim';
    peers.set(ws, role);
    sendTo(other, JSON.stringify({ type: 'peer', role, connected: true }));
    if ([...peers.values()].includes(other)) ws.send(JSON.stringify({ type: 'peer', role: other, connected: true }));
    ws.on('message', (data) => sendTo(other, data.toString()));
    ws.on('close', () => {
      peers.delete(ws);
      sendTo(other, JSON.stringify({ type: 'peer', role, connected: false }));
    });
  });
}
server.on('upgrade', upgrade);
// No HMR over HTTPS (it's attached to the HTTP server), so drop anything but the relay rather than leave it hanging.
secure.on('upgrade', (req, socket, head) => (req.url?.startsWith('/ws') ? upgrade(req, socket, head) : socket.destroy()));

const vite = await createViteServer({
  configFile: false,
  root: path.join(import.meta.dirname, '..'),
  appType: 'mpa',
  server: { middlewareMode: true, hmr: { server } },
});
app.use(vite.middlewares);

secure.listen(PORT + 1, '0.0.0.0');
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n  Simulator (open on this Mac):  http://localhost:${PORT}/sim/`);
  console.log(`  VR headset (Quest browser):    https://${lanAddress()}:${PORT + 1}/sim/`);
  const url = controllerUrl();
  console.log(`  Controller (open on phone):    ${url}\n`);
  console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
});
