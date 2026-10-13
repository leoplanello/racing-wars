// Teste de rede: host falso + 8 celulares falsos contra o servidor real (porta efemera).
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { start } from '../server/app.js';
import { encodeInput, HOST_INPUT, decodeHostInput } from '../shared/protocol.js';

const app = await start(0);
const url = `ws://127.0.0.1:${app.port}/ws`;

function client() {
  const ws = new WebSocket(url);
  const q = [];
  const waiters = [];
  ws.on('message', (data, isBinary) => {
    const m = isBinary ? { bin: Buffer.from(data) } : JSON.parse(data.toString());
    const w = waiters.findIndex((x) => x.pred(m));
    if (w >= 0) waiters.splice(w, 1)[0].resolve(m);
    else q.push(m);
  });
  const open = new Promise((r) => ws.on('open', r));
  const next = (pred, ms = 2000) => {
    const i = q.findIndex(pred);
    if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout esperando mensagem')), ms);
      waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  };
  return { ws, open, next, send: (o) => ws.send(JSON.stringify(o)) };
}

try {
  const host = client();
  await host.open;
  host.send({ t: 'host' });
  const { code } = await host.next((m) => m.t === 'room');
  assert.match(code, /^[A-Z]{4}$/);

  const phones = [];
  for (let i = 0; i < 8; i++) {
    const p = client();
    await p.open;
    p.send({ t: 'join', room: code, clientId: 'cid' + i, name: 'P' + i });
    const j = await p.next((m) => m.t === 'joined');
    assert.equal(j.id, i, 'deviceId em ordem');
    assert.equal(j.master, i === 0, 'primeiro celular e o Master');
    const c = await host.next((m) => m.t === 'connect' && m.id === i);
    assert.equal(c.name, 'P' + i);
    phones.push(p);
  }

  // 9o celular recusado
  const extra = client();
  await extra.open;
  extra.send({ t: 'join', room: code, clientId: 'extra' });
  assert.equal((await extra.next((m) => m.t === 'err')).reason, 'full');
  const bad = client();
  await bad.open;
  bad.send({ t: 'join', room: 'ZZZZ', clientId: 'x' });
  assert.equal((await bad.next((m) => m.t === 'err')).reason, 'noroom');

  // input binario chega ao host com deviceId
  phones[3].ws.send(encodeInput(-0.5, 1, 7), { binary: true });
  const b = await host.next((m) => m.bin);
  assert.equal(b.bin[0], HOST_INPUT);
  const d = decodeHostInput(b.bin);
  assert.equal(d.id, 3);
  assert.ok(Math.abs(d.steer + 0.5) < 0.01);
  assert.equal(d.buttons, 1);
  assert.equal(d.seq, 7);

  // JSON do celular -> host, e host -> celular
  phones[2].send({ t: 'menu', k: 'ok' });
  const f = await host.next((m) => m.t === 'from');
  assert.equal(f.id, 2);
  assert.equal(f.data.k, 'ok');
  host.send({ t: 'to', id: 5, data: { t: 'st', mode: 'drive' } });
  assert.equal((await phones[5].next((m) => m.t === 'st')).mode, 'drive');

  // ping/pong
  phones[1].send({ t: 'ping', ts: 42 });
  assert.equal((await phones[1].next((m) => m.t === 'pong')).ts, 42);

  // Master cai -> proximo vira Master
  phones[0].ws.close();
  await host.next((m) => m.t === 'disconnect' && m.id === 0);
  const mm = await host.next((m) => m.t === 'master' && m.id === 1);
  assert.equal(mm.id, 1);
  assert.equal((await phones[1].next((m) => m.t === 'role')).master, true);

  // reconexao por clientId reassume o mesmo deviceId
  const back = client();
  await back.open;
  back.send({ t: 'join', room: code, clientId: 'cid0', name: 'P0' });
  const j0 = await back.next((m) => m.t === 'joined');
  assert.equal(j0.id, 0);
  assert.equal(j0.master, false, 'nao retoma o Master');

  // segunda sala em paralelo: isolada da primeira (mesmo clientId vale em salas distintas)
  const host2 = client();
  await host2.open;
  host2.send({ t: 'host' });
  const code2 = (await host2.next((m) => m.t === 'room')).code;
  assert.notEqual(code2, code);
  const q = client();
  await q.open;
  q.send({ t: 'join', room: code2, clientId: 'cid3', name: 'Q3' });
  const jq = await q.next((m) => m.t === 'joined');
  assert.equal(jq.id, 0, 'sala 2 comeca do zero');
  assert.equal(jq.master, true);
  q.ws.send(encodeInput(0.25, 0, 1), { binary: true });
  const b2 = await host2.next((m) => m.bin);
  assert.equal(decodeHostInput(b2.bin).id, 0);
  phones[3].ws.send(encodeInput(0.9, 1, 99), { binary: true });
  const b1 = await host.next((m) => m.bin);
  assert.equal(decodeHostInput(b1.bin).seq, 99, 'input da sala 1 so chega ao host 1');
  await assert.rejects(host2.next((m) => m.bin, 300), /timeout/, 'host 2 nao recebe input da sala 1');

  console.log('smoke OK: salas', code, code2, '- 8 celulares, Master, binario, reconexao, sala cheia, 2 salas isoladas');
} catch (e) {
  console.error('smoke FALHOU:', e);
  process.exitCode = 1;
} finally {
  await app.close();
}
