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
    assert.ok(host.includes('/host/host.css"') && host.includes('importmap') && !host.includes('src="/host'));
    const pad = await (await fetch(base + '/pad/')).text();
    assert.match(pad, /src="\.\.\/_v\/[^/]+\/pad\/pad\.js"/);
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

test('perfil: avatar validado, repassado ao host e mantido na reconexao do host', async () => {
  const app = await start(0);
  const url = `ws://127.0.0.1:${app.port}/ws`;
  const socks = [];
  const open = async () => { const w = new WebSocket(url); socks.push(w); await new Promise((r) => w.on('open', r)); return w; };
  const wait = (w, pred) => new Promise((r) => w.on('message', (d, bin) => { if (bin) return; const m = JSON.parse(d.toString()); if (pred(m)) r(m); }));
  try {
    const host = await open();
    const room = wait(host, (m) => m.t === 'room');
    host.send(JSON.stringify({ t: 'host' }));
    const { code } = await room;
    const pad = await open();
    const joined = wait(pad, (m) => m.t === 'joined');
    pad.send(JSON.stringify({ t: 'join', room: code, clientId: 'p1', name: 'Ana', avatar: '<img onerror=x>' }));
    await joined;
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(100);
    let got = wait(host, (m) => m.t === 'from' && m.data.t === 'profile');
    pad.send(JSON.stringify({ t: 'profile', name: 'Bia', avatar: photo }));
    assert.deepEqual((await got).data, { t: 'profile', name: 'Bia', avatar: photo });
    for (const bad of ['data:image/svg+xml;base64,AAAA', 'data:image/png;base64,' + 'A'.repeat(13000), '<b>', 'javascript:x']) {
      got = wait(host, (m) => m.t === 'from' && m.data.t === 'profile');
      pad.send(JSON.stringify({ t: 'profile', name: 'Bia', avatar: bad }));
      assert.equal((await got).data.avatar, '', bad.slice(0, 30));
    }
    got = wait(host, (m) => m.t === 'from' && m.data.t === 'profile');
    pad.send(JSON.stringify({ t: 'profile', name: 'Bia', avatar: '🦊' }));
    assert.equal((await got).data.avatar, '🦊');
    host.close();
    const host2 = await open();
    const conn = wait(host2, (m) => m.t === 'connect');
    host2.send(JSON.stringify({ t: 'host', code }));
    const c = await conn;
    assert.equal(c.name, 'Bia');
    assert.equal(c.avatar, '🦊');
  } finally {
    for (const w of socks) w.terminate();
    await app.close();
  }
});

test('arquivos versionados (_v/<ver>/) furam o cache a cada deploy', async () => {
  const app = await start(0);
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const html = await (await fetch(base + '/')).text();
    const ver = html.match(/\.\/_v\/([^/]+)\/host\/main\.js/)?.[1];
    assert.ok(ver, 'script versionado');
    assert.ok(html.includes(`"/sim/":"./_v/${ver}/sim/"`) && html.includes(`href="./_v/${ver}/host/host.css"`));
    const js = await fetch(`${base}/_v/${ver}/host/main.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('cache-control'), /immutable/);
    assert.equal((await fetch(`${base}/host/main.js`)).headers.get('cache-control'), 'no-cache');
    const pad = await (await fetch(base + '/pad/')).text();
    assert.ok(pad.includes(`src="../_v/${ver}/pad/pad.js"`));
    const bad = await fetch(`${base}/_v/x/%2e%2e/%2e%2e/package.json`);
    assert.notEqual(bad.status, 200);
  } finally {
    await app.close();
  }
});
