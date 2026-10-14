import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 5173;

function lanAddress(): string {
  const addrs = Object.values(os.networkInterfaces()).flat();
  return addrs.find((a) => a && a.family === 'IPv4' && !a.internal)?.address ?? 'localhost';
}
// Looked up on each use: the Mac's address changes when it switches networks (e.g. to Personal Hotspot).
const controllerUrl = () => `http://${lanAddress()}:${PORT}/controller/`;

const app = express();
const server = http.createServer(app);

app.get('/api/connect', async (_req, res) => {
  const url = controllerUrl();
  res.json({ url, svg: await QRCode.toString(url, { type: 'svg', margin: 1 }) });
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
server.on('upgrade', (req, socket, head) => {
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
});

const vite = await createViteServer({
  configFile: false,
  root: path.join(import.meta.dirname, '..'),
  appType: 'mpa',
  server: { middlewareMode: true, hmr: { server } },
});
app.use(vite.middlewares);

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n  Simulator (open on this Mac):  http://localhost:${PORT}/sim/`);
  const url = controllerUrl();
  console.log(`  Controller (open on phone):    ${url}\n`);
  console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
});
