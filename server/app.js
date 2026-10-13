// Servidor: arquivos estaticos + relay WebSocket entre host (tela) e celulares (controles).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { renderPage } from '../tools/page.js';
import { MAX_PLAYERS, ROOM_CODE_LEN, ROOM_ALPHABET, PAD_INPUT, HOST_INPUT } from '../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const RESERVE_MS = 5 * 60 * 1000;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 200;
const WINDOW_MS = 60 * 1000;
const MAX_HOSTS_PER_WINDOW = 10; // salas novas por IP por minuto
const MAX_MISSES_PER_WINDOW = 30; // codigos inexistentes por IP por minuto (anti-chute)

// Paginas HTML sao reescritas para caminhos relativos: o jogo roda na raiz e atras de um proxy com prefixo (/racing-wars/).
const PAGES = { '/': ['host', './'], '/host/index.html': ['host', '../'], '/pad/': ['pad', '../'], '/editor/': ['editor', '../'] };
const REDIRECTS = { '/pad': 'pad/', '/editor': 'editor/' };
const pageCache = new Map();
function renderFor(p) {
  const [dir, prefix] = PAGES[p];
  if (!pageCache.has(p)) pageCache.set(p, renderPage(fs.readFileSync(path.join(ROOT, 'public', dir, 'index.html'), 'utf8'), prefix));
  return pageCache.get(p);
}

/** Contador por IP em janela fixa (limpo pelo timer do servidor). */
class Limiter {
  constructor() { this.m = new Map(); }
  hit(ip, max) {
    const now = Date.now();
    let e = this.m.get(ip);
    if (!e || now - e.t > WINDOW_MS) { e = { t: now, n: 0 }; this.m.set(ip, e); }
    return ++e.n <= max;
  }
  sweep() { const now = Date.now(); for (const [k, e] of this.m) if (now - e.t > WINDOW_MS) this.m.delete(k); }
}
/** IP do cliente (atras do Traefik/Cloudflare). So serve para limitar abuso. */
function clientIp(req) {
  const h = req.headers;
  return String(h['cf-connecting-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '');
}

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

export function resolveFile(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  let base;
  let rel;
  if (p.startsWith('/sim/') || p.startsWith('/shared/')) {
    base = ROOT;
    rel = p;
  } else if (p.startsWith('/vendor/three/')) {
    base = path.join(ROOT, 'node_modules', 'three', 'build');
    rel = p.slice('/vendor/three'.length);
  } else if (p.startsWith('/vendor/three-addons/')) {
    base = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm');
    rel = p.slice('/vendor/three-addons'.length);
  } else if (p === '/vendor/qrcode.mjs') {
    base = path.join(ROOT, 'node_modules', 'qrcode-generator', 'dist');
    rel = '/qrcode.mjs';
  } else {
    base = path.join(ROOT, 'public');
    rel = p;
  }
  const full = path.resolve(base, '.' + rel);
  if (full !== base && !full.startsWith(base + path.sep)) return null; // path traversal
  return full;
}

export function start(port = 3000) {
  const rooms = new Map();
  const hostLimit = new Limiter();
  const missLimit = new Limiter();

  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    if (REDIRECTS[urlPath]) {
      res.writeHead(302, { location: REDIRECTS[urlPath] + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '') }).end();
      return;
    }
    const pageKey = PAGES[urlPath] ? urlPath : urlPath === '/pad/index.html' ? '/pad/' : urlPath === '/editor/index.html' ? '/editor/' : null;
    if (pageKey) {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
      res.end(renderFor(pageKey));
      return;
    }
    if (urlPath === '/api/lan') {
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ips: lanAddresses(), port: server.address().port }));
      return;
    }
    let file;
    try {
      file = resolveFile(req.url);
    } catch {
      file = null;
    }
    if (!file) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Nao encontrado');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  function newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < ROOM_CODE_LEN; i++) c += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
      if (!rooms.has(c)) return c;
    }
  }
  const send = (ws, obj) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  };

  function pickMaster(room) {
    const cur = room.devices.get(room.masterId);
    if (cur && cur.ws) return;
    let next = null;
    for (const d of room.devices.values()) if (d.ws && (!next || d.joinedAt < next.joinedAt)) next = d;
    const prev = room.masterId;
    room.masterId = next ? next.id : -1;
    if (room.masterId !== prev) {
      send(room.host, { t: 'master', id: room.masterId });
      for (const d of room.devices.values()) if (d.ws) send(d.ws, { t: 'role', master: d.id === room.masterId });
    }
  }

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    let room = null;
    let dev = null; // dispositivo (se for celular)
    let isHost = false;

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (dev && room && data.length === 4 && data[0] === PAD_INPUT && room.host && room.host.readyState === 1) {
          room.host.send(Buffer.from([HOST_INPUT, dev.id, data[1], data[2], data[3]]), { binary: true });
        }
        return;
      }
      let m;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!m || typeof m.t !== 'string') return;

      if (m.t === 'host' && !room) {
        let r = typeof m.code === 'string' ? rooms.get(m.code) : null;
        if (r && r.host && r.host.readyState === 1) r = null; // sala ja tem host vivo
        if (!r) {
          if (rooms.size >= MAX_ROOMS || !hostLimit.hit(ip, MAX_HOSTS_PER_WINDOW)) {
            send(ws, { t: 'err', reason: 'busy' });
            ws.close();
            return;
          }
          r = { code: m.code && !rooms.has(m.code) && /^[A-Z]{4}$/.test(m.code) ? m.code : newCode(), host: null, devices: new Map(), masterId: -1 };
          rooms.set(r.code, r);
        }
        r.host = ws;
        r.hostGone = 0;
        room = r;
        isHost = true;
        send(ws, { t: 'room', code: r.code });
        for (const d of r.devices.values()) {
          if (d.ws) send(ws, { t: 'connect', id: d.id, name: d.name, clientId: d.clientId });
        }
        pickMaster(r);
        send(ws, { t: 'master', id: r.masterId });
        return;
      }

      if (m.t === 'join' && !room) {
        const r = rooms.get(String(m.room || '').toUpperCase());
        if (!r) return send(ws, { t: 'err', reason: missLimit.hit(ip, MAX_MISSES_PER_WINDOW) ? 'noroom' : 'busy' });
        const clientId = String(m.clientId || '').slice(0, 40) || Math.random().toString(36).slice(2);
        const name = String(m.name || '').slice(0, 14);
        let d = null;
        for (const x of r.devices.values()) if (x.clientId === clientId) d = x;
        if (d) {
          if (d.ws && d.ws !== ws) d.ws.close(4000, 'replaced');
        } else {
          const used = new Set([...r.devices.keys()]);
          let id = -1;
          for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) { id = i; break; }
          if (id < 0) {
            // sala "cheia" so por reservas de quem caiu: expulsa a mais antiga
            let old = null;
            for (const x of r.devices.values()) if (!x.ws && (!old || x.leftAt < old.leftAt)) old = x;
            if (!old) return send(ws, { t: 'err', reason: 'full' });
            id = old.id;
            r.devices.delete(id);
            send(r.host, { t: 'disconnect', id, gone: true });
          }
          d = { id, clientId, name, ws: null, joinedAt: Date.now(), leftAt: 0 };
          r.devices.set(id, d);
        }
        if (name) d.name = name;
        d.ws = ws;
        room = r;
        dev = d;
        if (r.masterId < 0 || !r.devices.get(r.masterId)?.ws) r.masterId = -1;
        pickMaster(r);
        send(ws, { t: 'joined', id: d.id, master: d.id === r.masterId, room: r.code });
        send(r.host, { t: 'connect', id: d.id, name: d.name, clientId: d.clientId });
        send(r.host, { t: 'master', id: r.masterId });
        return;
      }

      if (!room) return;
      if (isHost) {
        if (m.t === 'to') {
          const d = room.devices.get(m.id);
          if (d) send(d.ws, m.data);
        } else if (m.t === 'all') {
          for (const d of room.devices.values()) if (d.ws) send(d.ws, m.data);
        }
      } else if (dev) {
        if (m.t === 'ping') return send(ws, { t: 'pong', ts: m.ts });
        send(room.host, { t: 'from', id: dev.id, data: m });
      }
    });

    ws.on('close', () => {
      if (!room) return;
      if (isHost) {
        if (room.host === ws) {
          room.host = null;
          room.hostGone = Date.now();
          for (const d of room.devices.values()) send(d.ws, { t: 'hostgone' });
        }
      } else if (dev && dev.ws === ws) {
        dev.ws = null;
        dev.leftAt = Date.now();
        send(room.host, { t: 'disconnect', id: dev.id });
        pickMaster(room);
      }
    });
    ws.on('error', () => {});
  });

  const timer = setInterval(() => {
    const now = Date.now();
    hostLimit.sweep();
    missLimit.sweep();
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
    for (const [code, r] of rooms) {
      for (const [id, d] of r.devices) {
        if (!d.ws && now - d.leftAt > RESERVE_MS) {
          r.devices.delete(id);
          send(r.host, { t: 'disconnect', id, gone: true });
        }
      }
      if (!r.host && r.hostGone && now - r.hostGone > 10 * 60 * 1000) rooms.delete(code);
    }
  }, 15000);
  timer.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      resolve({
        server,
        rooms,
        port: server.address().port,
        close: () => {
          clearInterval(timer);
          for (const ws of wss.clients) ws.terminate();
          return new Promise((r) => server.close(() => r()));
        },
      });
    });
  });
}
