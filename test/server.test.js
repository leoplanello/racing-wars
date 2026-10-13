// Servidor: resolucao de arquivos (traversal), paginas relativas ao prefixo, redirects e limite de salas.
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { start, resolveFile } from '../server/app.js';
import { wsUrl } from '../shared/wsurl.js';

test('resolveFile bloqueia path traversal', () => {
  assert.equal(resolveFile('/../package.json'), null);
  assert.equal(resolveFile('/sim/../../x'), null);
  assert.ok(resolveFile('/sim/car.js').endsWith('car.js'));
});

test('wsUrl funciona na raiz e sob prefixo', () => {
  assert.equal(wsUrl('https://a.com/'), 'wss://a.com/ws');
  assert.equal(wsUrl('https://a.com/racing-wars/'), 'wss://a.com/racing-wars/ws');
  assert.equal(wsUrl('https://a.com/racing-wars/pad/?room=ABCD'), 'wss://a.com/racing-wars/ws');
  assert.equal(wsUrl('http://localhost:3000/pad/'), 'ws://localhost:3000/ws');
  assert.equal(wsUrl('http://x/', 'wss://relay/ws'), 'wss://relay/ws');
});

test('paginas saem com caminhos relativos e redirect de /pad', async () => {
  const app = await start(0);
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const host = await (await fetch(base + '/')).text();
    assert.ok(host.includes('href="./host/host.css"') && host.includes('importmap') && !host.includes('src="/host'));
    const pad = await (await fetch(base + '/pad/')).text();
    assert.ok(pad.includes('src="../pad/pad.js"'));
    const r = await fetch(base + '/pad', { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'pad/');
  } finally {
    await app.close();
  }
});

test('hosts alem do limite por IP recebem busy', async () => {
  const app = await start(0);
  const socks = [];
  try {
    const reasons = [];
    for (let i = 0; i < 12; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
      socks.push(ws);
      await new Promise((r) => ws.on('open', r));
      const msg = new Promise((r) => ws.once('message', (d) => r(JSON.parse(d.toString()))));
      ws.send(JSON.stringify({ t: 'host' }));
      reasons.push((await msg).t === 'room' ? 'room' : 'busy');
    }
    assert.equal(reasons.filter((x) => x === 'room').length, 10);
    assert.equal(reasons.filter((x) => x === 'busy').length, 2);
  } finally {
    for (const w of socks) w.terminate();
    await app.close();
  }
});
