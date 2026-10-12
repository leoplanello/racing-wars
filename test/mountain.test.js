import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, SURF } from '../sim/track.js';
import mountain from '../sim/tracks/mountain.js';
import { Game } from '../sim/game.js';
import { makeCar, placeCar, stepCar, DT } from '../sim/car.js';
import { buildScenery } from '../sim/scenery.js';

const track = buildTrack(mountain);
const L = track.length;
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: 'P' + i, color: i, isBot: true }));
const ramps = (mountain.hills || []).filter((h) => h.fall === 0);

test('montanha: pista fecha, ~3,4 min por volta e curvas fechadas viaveis', () => {
  assert.ok(L > 7000 && L < 8800, 'comprimento ' + L);
  assert.ok(track.minRadius() > 16, 'raio minimo ' + track.minRadius());
});

test('montanha: trechos distantes so se cruzam na ponte alta (por cima, com folga)', () => {
  let worst = Infinity;
  for (let i = 0; i < track.N; i += 4) for (let j = i + 1; j < track.N; j += 4) {
    const arc = Math.min(j - i, track.N - (j - i)) * track.ds;
    if (arc < 250) continue;
    const d = Math.hypot(track.X[i] - track.X[j], track.Z[i] - track.Z[j]);
    if (d < 60) {
      // so vale o cruzamento da ponte por cima da espiral: um dos dois e ponte e a diferenca de altura >= 12 u
      const over = (track.BRIDGE[i] || track.BRIDGE[j]) && Math.abs(track.ELEV[i] - track.ELEV[j]) >= 12;
      assert.ok(over, `trechos colados em (${track.X[i].toFixed(0)},${track.Z[i].toFixed(0)}) d=${d.toFixed(0)}`);
    } else worst = Math.min(worst, d);
  }
  assert.ok(worst >= 60);
});

test('montanha: rampas de salto ficam em reta (antes e depois do labio)', () => {
  assert.ok(ramps.length >= 3, 'rampas ' + ramps.length);
  for (const h of ramps) {
    const s0 = h.from * L, p = track.pointAt(s0);
    let worst = 0;
    for (let d = -40; d <= 90; d += 5) {
      const q = track.pointAt(s0 + d);
      worst = Math.max(worst, Math.abs((q.x - p.x) * -p.tz + (q.z - p.z) * p.tx));
    }
    assert.ok(worst <= 4, `rampa em ${h.from}: desvio do eixo ${worst.toFixed(1)} u`);
  }
});

test('montanha: carro lancado em cada rampa pousa na estrada (sem explodir por sair da pista)', () => {
  for (const h of ramps) {
    const g = new Game(players(1), { track: buildTrack(mountain), cup: 'fast', seed: 3 });
    const car = g.cars[0];
    placeCar(car, g.track, h.from * L - 90, 0);
    car.locked = false; car.state = 'run';
    car.vx = Math.cos(car.h) * 38; car.vz = Math.sin(car.h) * 38;
    let maxD = 0, air = false;
    for (let i = 0; i < 120 * 5; i++) {
      stepCar(car, g.track, DT, []);
      // mantem a velocidade de cruzeiro e o volante reto (carro de teste)
      car.steer = 0;
      maxD = Math.max(maxD, Math.abs(car.near.d));
      air = air || car.air;
    }
    assert.ok(air, `rampa ${h.from} nao lanca o carro`);
    assert.ok(maxD < g.track.hwAt(car.near.idx) + 2, `rampa ${h.from}: carro saiu da estrada (d=${maxD.toFixed(1)})`);
    assert.notEqual(car.state, 'wreck');
  }
});

test('montanha A: espiral de 2 voltas a esquerda, parede a esquerda, queda a direita e caixas', () => {
  const w = mountain.solidWalls[0];
  // giro total (positivo = esquerda) ao longo da espiral
  let turn = 0;
  const i0 = Math.floor(w.from * track.N), i1 = Math.floor(w.to * track.N);
  for (let i = i0; i < i1; i++) turn += Math.atan2(track.TX[i] * track.TZ[i + 1] - track.TZ[i] * track.TX[i + 1], track.TX[i] * track.TX[i + 1] + track.TZ[i] * track.TZ[i + 1]);
  assert.ok(Math.abs(turn) > 2 * 2 * Math.PI * 0.95 && Math.abs(turn) < 2 * 2 * Math.PI * 1.05, 'giro ' + (turn / Math.PI).toFixed(2) + 'pi');
  assert.ok(turn < 0 === (track.TX[i0] * track.TZ[i0 + 5] - track.TZ[i0] * track.TX[i0 + 5] < 0), 'giro coerente');
  // altura crescente
  for (let i = i0 + 40; i < i1 - 40; i += 40) assert.ok(track.ELEV[i + 40] >= track.ELEV[i] - 0.05, 'piso nao sobe em ' + i);
  assert.ok(Math.max(...track.ELEV) >= 55, 'altura do cume');
  const mid = Math.floor((i0 + i1) / 2);
  assert.equal(track.hardWall(mid, -10), true, 'parede a esquerda');
  assert.equal(track.hardWall(mid, 10), false, 'direita aberta');
  const g = new Game(players(2), { track: buildTrack(mountain), cup: 'war', seed: 4 });
  const row = g.items.boxes.filter((b) => b.fixed);
  assert.ok(row.length >= 15, 'caixas na beirada ' + row.length);
  for (const b of row) {
    const nr = g.track.nearest(b.x, b.z, -1, g.track.newNear());
    assert.ok(nr.d > 0 && nr.d < g.track.edgeAt(nr.idx), 'caixa na beirada direita (d=' + nr.d.toFixed(1) + ')');
  }
});

test('montanha: o terreno e uma montanha com pico e a estrada fica em cima dele', () => {
  const T = track.terrain;
  assert.ok(T, 'terreno');
  let peak = 0;
  for (const v of T.H) peak = Math.max(peak, v);
  assert.ok(peak >= 95, 'pico ' + peak.toFixed(0));
  assert.ok(peak > Math.max(...track.ELEV) + 25, 'o pico passa bem acima da ultima volta');
  assert.ok(T.heightAt(5000, 5000) === 0, 'fora da caixa vale 0');
  let worst = 0;
  for (let i = 0; i < track.N; i += 7) {
    if (track.BRIDGE[i] || !T.contains(track.X[i], track.Z[i])) continue;
    if (ramps.some((h) => Math.abs(i * track.ds - h.from * L) < 14)) continue; // labio da rampa: degrau
    worst = Math.max(worst, Math.abs(T.heightAt(track.X[i], track.Z[i]) - track.ELEV[i]));
  }
  assert.ok(worst < 0.8, 'terreno x piso na linha central ' + worst.toFixed(2));
  // lado da montanha sobe, lado da queda desce
  const w = mountain.solidWalls[0];
  const i = Math.floor(((w.from + w.to) / 2) * track.N), e = track.edgeAt(i);
  const at = (d) => T.heightAt(track.X[i] + track.NX[i] * d, track.Z[i] + track.NZ[i] * d);
  assert.ok(at(-(e + 20)) > track.ELEV[i] + 3, 'montanha a esquerda');
  assert.ok(at(e + 12) < track.ELEV[i] - 8, 'queda a direita');
});

test('montanha: quem cai da volta de cima pousa no terreno (nunca abaixo dele) e e eliminado', () => {
  const g = new Game(players(1), { track: buildTrack(mountain), cup: 'fast', seed: 3 });
  const car = g.cars[0], T = g.track.terrain, L2 = g.track.length;
  const w = mountain.solidWalls[0];
  placeCar(car, g.track, (w.from + (w.to - w.from) * 0.75) * L2, 0);
  car.locked = false; car.state = 'run';
  // empurra para a direita (queda)
  const nr = car.near;
  car.vx = nr.nx * 20 + nr.tx * 10; car.vz = nr.nz * 20 + nr.tz * 10;
  let below = 0;
  for (let i = 0; i < 120 * 6; i++) {
    stepCar(car, g.track, DT, []);
    if (!(car.state === 'run')) break;
    below = Math.min(below, car.y - T.heightAt(car.x, car.z));
    car.steer = 0;
  }
  assert.ok(below > -0.5, 'carro atravessou o terreno: ' + below.toFixed(2));
  assert.ok(car.y < track.ELEV[car.near.idx] - 3 || car.state !== 'run', 'carro caiu da volta');
});

test('montanha: praia de areia com o mar (agua) a esquerda e a ponte da descida em reta', () => {
  const beach = mountain.surfaces.find((c) => c.type === SURF.SAND);
  const i = track.idxAt(((beach.from + beach.to) / 2) * L);
  assert.equal(track.SURFACE[i], SURF.SAND);
  assert.equal(track.CHWATER[i], 1);
  const near = track.newNear();
  Object.assign(near, { idx: i, d: -(track.edgeAt(i) + 40) });
  assert.equal(track.chasmAt(near), true, 'mar a esquerda');
  const far = track.edgeAt(i) + 150;
  assert.equal(track.terrain.waterAt(track.X[i] - track.NX[i] * far, track.Z[i] - track.NZ[i] * far), true, 'mar largo e fundo a esquerda');
  assert.equal(track.terrain.waterAt(track.X[i] + track.NX[i] * far, track.Z[i] + track.NZ[i] * far), false, 'terra a direita');
  near.d = -(track.edgeAt(i) + 10);
  assert.equal(track.chasmAt(near), false, 'faixa de areia antes do mar');
  near.d = track.edgeAt(i) + 100;
  assert.equal(track.chasmAt(near), false, 'direita sem mar');
  const br = mountain.bridges[1];
  assert.ok(track.BRIDGE[track.idxAt(((br.from + br.to) / 2) * L)] === 1);
});

test('montanha: largada livre de cenario', () => {
  const g = new Game(players(8), { track: buildTrack(mountain), cup: 'war', seed: 4 });
  g.track.scenery = buildScenery(g.track);
  for (const car of g.cars) {
    for (const o of g.track.scenery.query(car.x, car.z, 6)) assert.ok(Math.hypot(o.x - car.x, o.z - car.z) > o.r + 2, 'carro nasce em ' + o.kind);
  }
});

test('montanha: o mar cobre todo o lado oeste, ha um rio na planicie noroeste e a agua mata', () => {
  const T = track.terrain;
  for (const [x, z] of [[-700, 0], [-600, -300], [-900, -700], [-1000, -1200], [-560, 200]]) assert.equal(T.waterAt(x, z), true, `mar em (${x},${z})`);
  for (const [x, z] of [[-200, 100], [0, -300], [300, 300]]) assert.equal(T.waterAt(x, z), false, `terra em (${x},${z})`);
  for (const [x, z] of [[-690, -1010], [-830, -1020]]) assert.equal(T.waterAt(x, z), true, `rio em (${x},${z})`);
  assert.equal(T.waterAt(-640, -1130), false, 'margem do rio e terra');
  // carro empurrado para o mar na praia e eliminado
  const g = new Game(players(1), { track: buildTrack(mountain), cup: 'fast', seed: 3 });
  const car = g.cars[0];
  const beach = mountain.surfaces.find((c) => c.type === SURF.SAND);
  placeCar(car, g.track, ((beach.from + beach.to) / 2) * L, 0);
  g.state = 'RACING'; car.locked = false; car.state = 'run';
  const nr = car.near;
  car.x -= nr.nx * (g.track.edgeAt(nr.idx) + 40); car.z -= nr.nz * (g.track.edgeAt(nr.idx) + 40); // dentro do mar, a esquerda
  car.y = 0; car.vx = car.vz = 0;
  g.debug.noCut = true;
  let fell = false;
  for (let i = 0; i < 120 * 8 && !fell; i++) { g.update(DT); fell = car.state === 'falling' || !car.alive; }
  assert.ok(fell, 'o carro deveria cair no mar');
});

test('montanha: o terreno nunca passa por cima da ponte nem da pista', () => {
  const T = track.terrain;
  for (let i = 0; i < track.N; i += 3) {
    if (!T.contains(track.X[i], track.Z[i])) continue;
    const h = T.heightAt(track.X[i], track.Z[i]);
    const inner = track.BRIDGE[(i + 24) % track.N] && track.BRIDGE[(i - 24 + track.N) % track.N]; // longe das cabeceiras (la a pista toca o chao)
    if (track.BRIDGE[i] && inner) assert.ok(h <= track.ELEV[i] - 1.5, `terreno ${h.toFixed(1)} sobe ate a ponte (piso ${track.ELEV[i].toFixed(1)}) em s=${(i * track.ds).toFixed(0)}`);
  }
  // sem vegetacao/terreno colado na pista: o corredor da pista e marcado
  const i = Math.floor(track.N * 0.5), k = Math.round((track.X[i] - T.box[0]) / T.cell) + Math.round((track.Z[i] - T.box[1]) / T.cell) * T.nx;
  assert.equal(T.CORR[k], 1);
});

test('montanha: pousar na face de subida da rampa nao quica sem parar (quique relativo ao piso)', () => {
  const p0 = (ramps[0].from - 0.0011) * L;
  for (const [dy, vy] of [[1.2, 0], [0.5, -3]]) {
    const car = makeCar(0);
    placeCar(car, track, p0, 0);
    car.locked = false; car.y += dy; car.vy = vy; car.air = true;
    car.vx = Math.cos(car.h) * 40; car.vz = Math.sin(car.h) * 40;
    const ev = [];
    for (let i = 0; i < 3 * 120; i++) stepCar(car, track, DT, ev);
    const lands = ev.filter((e) => e.type === 'land').length;
    assert.ok(lands <= 4, 'quicou ' + lands + ' vezes na rampa');
  }
});
