import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack } from '../sim/track.js';
import testCircuit from '../sim/tracks/testcircuit.js';
import { makeCar, placeCar, stepCar, updateProgress, hitCar, collideCars, hullPos, HULL, DT, CAR } from '../sim/car.js';
import { Game, scoreRound, RULES } from '../sim/game.js';
import { whompFactor, WHOMP, TRAIL, ICE, POWER } from '../sim/items.js';
import { makeWheel } from '../sim/body.js';
import { ChaseCamera, CAMERA } from '../sim/camera.js';
import { makeBrain, think, DIFFICULTY_ORDER } from '../sim/ai.js';
import { makeRng } from '../sim/rng.js';

const track = buildTrack(testCircuit);
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: 'P' + i, color: i, isBot: true }));

function runBots(game, seconds, hook) {
  const rng = makeRng(7);
  const brains = new Map(game.cars.map((c) => [c.id, makeBrain(rng, 0.85)]));
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    for (const c of game.cars) {
      if (!c.alive || !c.near) continue;
      const r = think(brains.get(c.id), c, game, dt);
      game.setInput(c.id, r.steer, r.fire);
    }
    game.update(dt);
    if (hook) hook(game);
  }
}

test('pista: fecha, curvas suaves e comprimento coerente', () => {
  assert.ok(track.length > 800);
  assert.ok(track.minRadius() > track.halfWidth + track.verge, 'raio minimo maior que a largura (sem dobrar a faixa)');
  const a = { x: track.X[0], z: track.Z[0] }, b = { x: track.X[track.N - 1], z: track.Z[track.N - 1] };
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 2, 'ultima amostra encosta na primeira');
});

test('pista: nearest devolve s e d coerentes e progresso e continuo ao dar a volta', () => {
  const near = track.newNear();
  const p = track.pointAt(100);
  track.nearest(p.x + p.nx * 4, p.z + p.nz * 4, -1, near);
  assert.ok(Math.abs(near.s - 100) < 1.5);
  assert.ok(Math.abs(near.d - 4) < 0.2);
  // percorre a linha central duas vezes
  const car = makeCar(0);
  placeCar(car, track, 0, 0);
  for (let s = 0; s < track.length * 2; s += 0.8) {
    const q = track.pointAt(s);
    track.nearest(q.x, q.z, car.near.idx, car.near);
    updateProgress(car, track);
  }
  assert.ok(Math.abs(car.progress - track.length * 2) < 3, 'progresso desenrolado: ' + car.progress);
});

test('carro: cruise control chega a velocidade de cruzeiro na reta', () => {
  const car = makeCar(0);
  placeCar(car, track, 0, 0);
  car.locked = false;
  for (let i = 0; i < 400; i++) { stepCar(car, track, DT, []); updateProgress(car, track); }
  assert.ok(car.speed > CAR.cruise * 0.9, 'velocidade ' + car.speed);
});

test('carro: parede nao e atravessada nem a 120 u/s (sem tunelamento)', () => {
  const wallTrack = buildTrack({ ...testCircuit, openLand: false, bridges: [] });
  const lim = wallTrack.halfWidth + wallTrack.verge;
  // varias posicoes iniciais: inclui o trecho de rampa/plateau onde a falesia empurrava o carro para fora do muro
  for (const [s, off] of [[290, 0], [300, 0], [301, 0], [310, 0], [300, 0.5]]) {
    const car = makeCar(0);
    placeCar(car, wallTrack, s, off);
    car.locked = false;
    car.state = 'run';
    for (let i = 0; i < 1200; i++) {
      car.steer = 1; // vira o tempo todo para fora
      car.vx = Math.cos(car.h + 0.6) * 120;
      car.vz = Math.sin(car.h + 0.6) * 120;
      stepCar(car, wallTrack, DT, []);
      assert.ok(Math.abs(car.near.d) <= lim + 0.01, `atravessou a parede (s=${s}, off=${off}): d=${car.near.d}`);
    }
  }
});

test('carro: terra tem menos aderencia (curva mais aberta) e a tracao traseira patina', () => {
  const t2 = buildTrack({ ...testCircuit, bridges: [], baseSurface: 2 });
  const t0 = buildTrack({ ...testCircuit, bridges: [], baseSurface: 0 });
  // taxa de guinada em regime com o volante todo para a direita
  const yaw = (tr) => {
    const car = makeCar(0);
    placeCar(car, tr, 0, 0);
    car.locked = false;
    let sum = 0, n = 0;
    for (let i = 0; i < 480; i++) {
      car.steer = i > 240 ? 1 : 0;
      stepCar(car, tr, DT, []);
      if (i > 300 && i < 360) { sum += Math.abs(car.w); n++; }
    }
    return sum / n;
  };
  assert.ok(yaw(t0) > yaw(t2), 'asfalto vira mais que terra');
  // aceleracao do arranque limitada pela tracao (atrito) na roda traseira
  const launch = (tr) => {
    const car = makeCar(0);
    placeCar(car, tr, 0, 0);
    car.locked = false;
    for (let i = 0; i < 120; i++) stepCar(car, tr, DT, []);
    return car.speed;
  };
  assert.ok(launch(t0) > launch(t2), 'mais atrito = arranque mais forte');
});

test('carro: direcao dianteira - volante para a direita faz o carro virar a direita', () => {
  const car = makeCar(0);
  placeCar(car, track, 200, 0);
  car.locked = false;
  for (let i = 0; i < 360; i++) stepCar(car, track, DT, []);
  const h0 = car.h;
  car.steer = 0.5;
  for (let i = 0; i < 120; i++) stepCar(car, track, DT, []);
  assert.ok(car.w > 0.05, 'guinada positiva = direita: ' + car.w);
  assert.ok(car.h > h0, 'rumo aumentou');
});

test('colisao: bater por tras empurra o carro da frente e freia quem bate', () => {
  const g = new Game(players(2), { track, cup: 'fast' });
  g.state = 'RACING';
  for (const c of g.cars) { c.locked = false; c.state = 'run'; }
  const [a, b] = g.cars;
  // a parado a frente, b chegando por tras na mesma linha
  placeCar(a, track, 60, 0); placeCar(b, track, 52, 0);
  for (const c of [a, b]) { c.locked = false; c.state = 'run'; }
  const f = { x: Math.cos(b.h), z: Math.sin(b.h) };
  b.vx = f.x * 20; b.vz = f.z * 20;
  let hit = false;
  for (let i = 0; i < 240; i++) {
    stepCar(a, track, DT, []); stepCar(b, track, DT, []);
    const ev = [];
    collideCars(a, b, ev);
    if (ev.some((e) => e.type === 'bump')) hit = true;
  }
  assert.ok(hit, 'houve batida');
  const va = a.vx * f.x + a.vz * f.z, vb = b.vx * f.x + b.vz * f.z;
  assert.ok(va > 8, 'carro da frente foi empurrado: ' + va);
  assert.ok(Math.abs(a.x - b.x) > 1 || Math.abs(a.z - b.z) > 1, 'nao ficam sobrepostos');
  void vb;
});

test('colisao: batida de lado gira o carro atingido (corpo rigido)', () => {
  const a = makeCar(0), b = makeCar(1);
  placeCar(a, track, 60, 0); placeCar(b, track, 60, 0);
  for (const c of [a, b]) { c.locked = false; c.state = 'run'; }
  const p = track.pointAt(60);
  a.x = p.x; a.z = p.z; a.vx = a.vz = 0;
  // b vem de lado (pela normal) e acerta a traseira de a
  b.h = a.h + Math.PI / 2;
  b.x = p.x - Math.cos(a.h) * 1.1 + p.nx * -2.0; b.z = p.z - Math.sin(a.h) * 1.1 + p.nz * -2.0;
  b.vx = p.nx * 14; b.vz = p.nz * 14;
  let w = 0;
  for (let i = 0; i < 60; i++) { collideCars(a, b, []); w = Math.max(w, Math.abs(a.w)); }
  assert.ok(w > 0.2, 'o carro atingido girou: ' + w);
});

test('pontuacao: sobrevivente +2, penultimo +1, primeiro morto -2, demais -1', () => {
  // 5 carros; mortes na ordem 3,1,4,0 ; sobrevivente 2
  const d = scoreRound([3, 1, 4, 0], 2, [0, 1, 2, 3, 4]);
  assert.deepEqual(d, { 0: 1, 1: -1, 2: 2, 3: -2, 4: -1 });
  // 2 jogadores
  assert.deepEqual(scoreRound([1], 0, [0, 1]), { 0: 2, 1: -2 });
  // 3 jogadores
  assert.deepEqual(scoreRound([2, 1], 0, [0, 1, 2]), { 0: 2, 1: 1, 2: -2 });
  // 0 vivos: ultimo a morrer conta como sobrevivente
  assert.deepEqual(scoreRound([1, 2, 0], 0, [0, 1, 2]), { 0: 2, 1: -2, 2: 1 });
});

/** Teleporta o carro e refaz a busca global na pista (a busca normal e por janela). */
function relocate(car, tr, x, z) {
  car.x = x; car.z = z;
  tr.nearest(x, z, -1, car.near);
  for (const nc of car.nearC) tr.nearest(x, z, -1, nc);
  car.prevS = car.near.s;
}

// carros sinteticos ao longo da pista, usados nos testes de camera
function fakeCars(list) {
  return list.map(([id, s]) => {
    const p = track.pointAt(s);
    return { id, x: p.x, z: p.z, progress: s, near: { s: track.wrapS(s) } };
  });
}
function settle(cam, cars, seconds = 6) {
  cam.computeTarget(cars, track);
  cam.snap();
  for (let t = 0; t < seconds; t += 1 / 60) {
    cam.computeTarget(cars, track);
    cam.update(1 / 60);
  }
}

test('camera: fica atras do pelotao (yaw segue a tangente da pista)', () => {
  const cam = new ChaseCamera(16 / 9);
  const cars = fakeCars([[0, 300], [1, 290]]);
  settle(cam, cars);
  const p = track.pointAt(295 + CAMERA.yawLook); // media do pelotao
  const want = Math.atan2(p.tz, p.tx);
  const diff = Math.atan2(Math.sin(cam.yaw - want), Math.cos(cam.yaw - want));
  assert.ok(Math.abs(diff) < 0.05, 'yaw ' + diff);
  // a camera esta atras do lider, no sentido contrario ao rumo
  const behind = (track.pointAt(300).x - cam.x) * Math.cos(cam.yaw) + (track.pointAt(300).z - cam.z) * Math.sin(cam.yaw);
  assert.ok(behind > 10, 'camera atras do lider: ' + behind);
});

test('camera: mais horizontal, segue a media do pelotao e mostra pista a frente', () => {
  assert.ok(CAMERA.pitch < 45 * Math.PI / 180, 'camera nao e quase vertical');
  const cam = new ChaseCamera(16 / 9);
  const cars = fakeCars([[0, 300], [1, 296], [2, 291]]);
  settle(cam, cars);
  const o = { nx: 0, ny: 0, d: 0 };
  const mx = (cars[0].x + cars[1].x + cars[2].x) / 3, mz = (cars[0].z + cars[1].z + cars[2].z) / 3;
  cam.project(mx, CAMERA.carY, mz, o);
  assert.ok(Math.abs(o.ny - CAMERA.leaderNy) < 0.15, 'media ny ' + o.ny);
  cam.project(cars[0].x, CAMERA.carY, cars[0].z, o);
  assert.ok(o.ny > CAMERA.leaderNy && o.ny <= CAMERA.topNy + 0.05, 'lider acima da media: ' + o.ny);
  cam.project(cars[2].x, CAMERA.carY, cars[2].z, o);
  assert.ok(o.ny < CAMERA.leaderNy && o.ny > CAMERA.rearNy, 'ultimo dentro do quadro: ' + o.ny);
});

test('camera: acompanha a curva (yaw segue o rumo da pista a frente) e sobe com a rampa', () => {
  const cam = new ChaseCamera(16 / 9);
  // ao longo de um trecho curvo a camera termina sempre alinhada com a tangente a frente do lider
  let worst = 0;
  for (let s = 1000; s < 1500; s += 25) {
    settle(cam, fakeCars([[0, s], [1, s - 8]]), 3);
    const p = track.pointAt(s - 4 + CAMERA.yawLook); // media do pelotao
    worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(cam.yaw - Math.atan2(p.tz, p.tx)), Math.cos(cam.yaw - Math.atan2(p.tz, p.tx)))));
  }
  assert.ok(worst < 0.06, 'yaw acompanha a curva: ' + worst);
  // sobe com o plateau (a camera usa a altura do chao sob o lider)
  const high = track.length * 0.8, flat = track.length * 0.3;
  settle(cam, fakeCars([[0, flat], [1, flat - 6]]));
  const yLow = cam.y;
  settle(cam, fakeCars([[0, high], [1, high - 6]]));
  assert.ok(cam.y > yLow + 6, 'camera sobe com o terreno: ' + (cam.y - yLow));
});

test('camera: sem tremor — o alvo nao pula com a velocidade ruidosa do lider', () => {
  const cam = new ChaseCamera(16 / 9);
  const cars = fakeCars([[0, 300], [1, 295]]);
  settle(cam, cars);
  let maxStep = 0, px = cam.x, pz = cam.z;
  for (let i = 0; i < 240; i++) {
    cars[0].vx = (i % 2 ? 1 : -1) * 40; cars[0].vz = (i % 3 ? 1 : -1) * 40; // velocidade ruidosa (batidas)
    cam.computeTarget(cars, track);
    cam.update(1 / 60);
    maxStep = Math.max(maxStep, Math.hypot(cam.x - px, cam.z - pz));
    px = cam.x; pz = cam.z;
  }
  assert.ok(maxStep < 0.6, 'passo maximo por quadro ' + maxStep);
});

test('camera: lider fica visivel e nunca e cortado, mesmo muito a frente', () => {
  const cam = new ChaseCamera(16 / 9);
  const cars = fakeCars([[0, 500], [1, 420]]); // lider 80 u a frente
  settle(cam, cars);
  const o = { nx: 0, ny: 0, d: 0 };
  cam.project(cars[0].x, CAMERA.carY, cars[0].z, o);
  assert.ok(o.ny <= CAMERA.topNy + 0.05, 'lider cabe na tela: ny=' + o.ny);
  assert.equal(cam.isCut(cars[0].x, cars[0].z), false);
  // mesmo que o lider dispare absurdamente para a frente, a ancora o segue
  const far = fakeCars([[0, 900], [1, 420]]);
  settle(cam, far);
  assert.equal(cam.isCut(far[0].x, far[0].z), false, 'lider nunca sai pela frente');
});

test('camera: zoom out acompanha o retardatario e respeita o limite', () => {
  const cam = new ChaseCamera(16 / 9);
  settle(cam, fakeCars([[0, 300], [1, 296]]));
  const hClose = cam.H;
  assert.equal(hClose, CAMERA.hMin);
  settle(cam, fakeCars([[0, 300], [1, 262]]));
  assert.ok(cam.H > hClose && cam.H < CAMERA.hMax, 'zoom out: ' + cam.H);
  settle(cam, fakeCars([[0, 300], [1, 150]]));
  assert.ok(cam.H <= CAMERA.hMax + 1e-9, 'limite: ' + cam.H);
  assert.ok(Math.abs(cam.H - CAMERA.hMax) < 0.5);
});

test('camera: retardatario alem do limite e cortado por tras', () => {
  const cam = new ChaseCamera(16 / 9);
  const cars = fakeCars([[0, 300], [1, 120]]);
  settle(cam, cars);
  assert.equal(cam.isCut(cars[1].x, cars[1].z), true, 'ficou para tras');
  assert.equal(cam.isCut(cars[0].x, cars[0].z), false);
  assert.ok(cam.edgeRatio(cars[1].x, cars[1].z) > 1);
});

test('partida: carencia de 1 s depois do GO sem corte', () => {
  const game = new Game(players(2), { track, cup: 'fast' });
  game.state = 'RACING';
  for (const c of game.cars) { c.locked = false; c.state = 'run'; }
  game.time = 0;
  // joga o carro 1 muito para tras
  const far = track.pointAt(game.cars[0].progress - 200);
  game.cars[1].x = far.x; game.cars[1].z = far.z;
  game.cars[1].progress -= 200;
  game.step(DT);
  assert.equal(game.cars[1].alive, true, 'dentro da carencia');
  game.time = 1.5;
  game.step(DT);
  assert.equal(game.cars[1].alive, false, 'depois da carencia e cortado');
  assert.equal(game.cars[0].alive, true, 'quem lidera nao e cortado');
});

test('partida: 8 bots — uma unica rodada termina por vez e todos renascem juntos', () => {
  const game = new Game(players(8), { track, cup: 'war', seed: 5 });
  let roundEnds = 0, countdownStarts = 0;
  const alivePerCountdown = [];
  runBots(game, 240, (g) => {
    for (const e of g.drainEvents()) {
      if (e.type === 'roundEnd') {
        roundEnds++;
        assert.equal(g.aliveCars().length <= 1, true, 'so termina com no maximo 1 vivo');
      }
      if (e.type === 'countdown' && e.n === RULES.countdown) {
        countdownStarts++;
        alivePerCountdown.push(g.aliveCars().length);
      }
    }
  });
  assert.ok(roundEnds >= 1, 'pelo menos uma rodada terminou em 4 min');
  for (const n of alivePerCountdown) assert.equal(n, 8, 'todos renascem ao mesmo tempo');
  for (const [, p] of game.points) assert.ok(p >= 0 && p <= RULES.maxPoints);
});

test('partida: sobrevivente e mostrado 0,5 s antes da nova contagem', () => {
  const game = new Game(players(3), { track, cup: 'fast', seed: 3 });
  let sawStand = false, standTime = 0;
  const dt = 1 / 60;
  const rng = makeRng(1);
  const brains = new Map(game.cars.map((c) => [c.id, makeBrain(rng, 0.9)]));
  for (let t = 0; t < 400 && !sawStand; t += dt) {
    for (const c of game.cars) if (c.alive) { const r = think(brains.get(c.id), c, game, dt); game.setInput(c.id, r.steer, false); }
    game.update(dt);
    if (game.state === 'LAST_STAND') sawStand = true;
    // forca uma eliminacao se ninguem morrer sozinho
    if (t > 20 && game.state === 'RACING') game.kill(game.aliveCars()[0], 'cut');
  }
  assert.ok(sawStand);
  while (game.state === 'LAST_STAND') { game.update(dt); standTime += dt; }
  assert.ok(Math.abs(standTime - (RULES.zoomIn + RULES.hold)) < 0.1, 'duracao ' + standTime);
  assert.equal(game.state, 'COUNTDOWN');
  assert.equal(game.aliveCars().length, 3);
});

test('partida: regra de fim por 20 pontos', () => {
  const game = new Game(players(2), { track, cup: 'fast', seed: 9 });
  game.points.set(0, 19);
  game.state = 'RACING';
  for (const c of game.cars) { c.locked = false; c.state = 'run'; }
  game.time = 5;
  game.kill(game.carById(1), 'cut');
  game.step(DT); // avalia fim de rodada
  assert.equal(game.state, 'LAST_STAND');
  for (let i = 0; i < 200; i++) game.update(1 / 60);
  assert.equal(game.state, 'MATCH_END');
  assert.equal(game.winner, 0);
  assert.equal(game.endReason, 'points');
});

test('partida: fim por 3 voltas vence quem tem mais pontos', () => {
  const game = new Game(players(2), { track, cup: 'fast', seed: 9 });
  game.state = 'RACING';
  for (const c of game.cars) { c.locked = false; c.state = 'run'; }
  game.time = 5;
  game.points.set(0, 4);
  game.points.set(1, 8);
  game.carById(0).progress = track.length * RULES.laps + 1; // 0 cruza primeiro
  game.step(DT);
  assert.equal(game.state, 'MATCH_END');
  assert.equal(game.endReason, 'laps');
  assert.equal(game.winner, 1, 'mais pontos vence, mesmo sem cruzar primeiro');
});

test('nao ha falso vencedor durante a contagem (fim so avaliado em RACING)', () => {
  const game = new Game(players(4), { track, cup: 'fast' });
  assert.equal(game.state, 'COUNTDOWN');
  for (const c of game.cars.slice(1)) c.alive = false; // corrida de estados
  for (let i = 0; i < 200; i++) game.step(DT);
  assert.notEqual(game.state, 'LAST_STAND');
});

test('nitro NAO da invulnerabilidade contra minas', () => {
  const game = new Game(players(2), { track, cup: 'fast' });
  game.state = 'RACING';
  for (const c of game.cars) { c.locked = false; c.state = 'run'; }
  const [a, b] = game.cars;
  a.item = 'nitro';
  game.items.use(a, game);
  assert.ok(a.boost > 0);
  game.items.mines.push({ x: a.x + 0.5, z: a.z, owner: b.id, age: 5 });
  game.items.update(DT, game);
  assert.equal(a.alive, false, 'carro em nitro foi destruido pela mina');
  assert.equal(a.state, 'wreck');
});

test('missil anda sempre em linha reta (nao persegue ninguem)', () => {
  const game = new Game(players(3), { track, cup: 'super' });
  game.state = 'RACING';
  game.time = 5;
  const [a, b] = game.cars;
  for (const c of game.cars) { c.locked = false; c.state = 'run'; }
  a.item = 'missile';
  game.items.use(a, game);
  const m = game.items.missiles[0];
  assert.ok(m && m.target === undefined, 'sem alvo');
  const h0 = m.h;
  b.x = m.x + 30; b.z = m.z + 60; // alvo fora da linha: o missil nao vira
  for (let i = 0; i < 60; i++) game.items.update(DT, game);
  assert.equal(game.items.missiles[0]?.h ?? h0, h0);
});

test('rastro do nitro: explode quem cruza (menos o dono)', () => {
  const game = new Game(players(3), { track, cup: 'super' });
  game.state = 'RACING';
  game.time = 5;
  for (const c of game.cars) { c.locked = false; c.state = 'run'; c.vx = c.vz = 0; }
  const [a, b, c] = game.cars;
  a.x = 0; a.z = 0; a.h = 0; a.boost = 2;
  b.x = 500; b.z = 500; c.x = -500; c.z = -500;
  for (let i = 0; i < 240; i++) { a.x += 0.3; game.items.update(DT, game); }
  assert.ok(game.items.trails.length > 3, 'deixou rastro');
  assert.equal(a.alive, true, 'dono imune');
  const t = game.items.trails[0];
  b.x = t.x; b.z = t.z;
  game.items.update(DT, game);
  assert.equal(b.alive, false);
  assert.equal(c.alive, true);
  assert.ok(game.events.some((e) => e.type === 'explode' && e.kind === 'trail'));
});

test('retardatario perto da borda de tras ganha velocidade; lider nao', () => {
  const game = new Game(players(3), { track, cup: 'fast' });
  game.state = 'RACING';
  game.time = 5;
  for (const c of game.cars) { c.locked = false; c.state = 'run'; }
  const [a, b, c] = game.cars;
  a.progress = 300; b.progress = 245;
  // posiciona b bem atras de a, no limite de baixo do quadro (c junto de a)
  const pa = track.pointAt(300), pb = track.pointAt(245), pc = track.pointAt(296);
  a.x = pa.x; a.z = pa.z; b.x = pb.x; b.z = pb.z; c.x = pc.x; c.z = pc.z; c.progress = 296;
  game.frameCamera(true);
  game.updateCatchup(1);
  assert.ok(b.catchup > 0.3, 'retardatario acelera: ' + b.catchup);
  assert.equal(a.catchup, 0);
});

test('bater na roda traseira desestabiliza (destab so na traseira)', () => {
  const mk = (circleIdx) => {
    const v = makeCar(0), hit = makeCar(1);
    for (const c of [v, hit]) { c.alive = true; c.state = 'run'; c.locked = false; }
    v.x = 0; v.z = 0; v.h = 0; v.vx = 25;
    // o outro bate de lado no circulo `circleIdx` do alvo
    const off = circleIdx === 2 ? -1.1 : 1.1;
    hit.x = off; hit.z = 1.6; hit.h = -Math.PI / 2; hit.vx = 25; hit.vz = -8;
    collideCars(v, hit, []);
    return v;
  };
  const rear = mk(2), front = mk(0);
  assert.ok(rear.destab > 0.2, 'destab: ' + rear.destab);
  assert.ok(front.destab === 0);
});

test('carro atingido gira de verdade e NAO volta sozinho a direcao original', () => {
  const car = makeCar(0);
  placeCar(car, track, 100, 0);
  car.state = 'run'; car.locked = false;
  const h0 = car.h;
  hitCar(car, 1, 1);
  for (let i = 0; i < 400 && car.state === 'stun'; i++) stepCar(car, track, DT, []);
  assert.equal(car.state, 'run');
  assert.ok(Math.abs(Math.atan2(Math.sin(car.h - h0), Math.cos(car.h - h0))) > 0.5 || Math.abs(car.h - h0) > 1, 'ficou virado para outro lado');
});

test('debug: corrida infinita nao acaba por voltas e mortos renascem', () => {
  const game = new Game(players(3), { track, cup: 'fast' });
  game.debug.infinite = true;
  game.state = 'RACING';
  game.time = 5;
  for (const c of game.cars) { c.locked = false; c.state = 'run'; }
  game.cars[0].progress = track.length * 3 + 5;
  game.explodeCar(game.cars[1], 'mine');
  game.explodeCar(game.cars[2], 'mine');
  for (let i = 0; i < 600; i++) game.step(DT);
  assert.equal(game.state, 'RACING');
  assert.ok(game.cars.every((c) => c.alive), 'todos renasceram');
});

test('whomp empurra os vizinhos e poupa o dono', () => {
  const game = new Game(players(2), { track, cup: 'fast' });
  game.state = 'RACING';
  for (const c of game.cars) { c.locked = false; c.state = 'run'; c.vx = c.vz = 0; }
  const [a, b] = game.cars;
  b.x = a.x + 5; b.z = a.z;
  a.item = 'whomp';
  game.items.use(a, game);
  for (let i = 0; i < 60; i++) game.items.update(DT, game);
  assert.ok(b.vx > 10, 'empurrado para longe');
  assert.equal(a.vx, 0, 'dono nao e afetado');
});

test('mina: dono nao dispara a propria mina logo apos soltar', () => {
  const game = new Game(players(2), { track, cup: 'super' });
  game.state = 'RACING';
  for (const c of game.cars) { c.locked = false; c.state = 'run'; }
  const a = game.cars[0];
  a.item = 'mine';
  game.items.use(a, game);
  game.items.update(DT, game);
  assert.equal(game.items.mines.length, 1);
  assert.equal(a.alive, true);
  hitCar(a); // sanidade da funcao
  assert.equal(a.state, 'stun');
});

test('copas: Fast sem caixas, War com mais caixas que Super', () => {
  const n = (cup) => new Game(players(2), { track, cup }).items.boxes.length;
  assert.equal(n('fast'), 0);
  assert.ok(n('war') > n('super') && n('super') > 0);
});

test('re: segurar as duas setas leva o carro a andar de re em linha reta', () => {
  const car = makeCar(0);
  placeCar(car, track, 60, 0);
  car.locked = false;
  for (let i = 0; i < 360; i++) stepCar(car, track, DT, []);
  assert.ok(car.speed > 20);
  const h0 = car.h;
  car.revIn = true;
  for (let i = 0; i < 600; i++) stepCar(car, track, DT, []);
  const fwd = car.vx * Math.cos(car.h) + car.vz * Math.sin(car.h);
  assert.ok(fwd < -8, 'andando de re: ' + fwd);
  assert.ok(Math.abs(car.h - h0) < 0.3, 'em linha reta');
});

test('whomp: forca cai exponencialmente com a distancia e some fora do alcance', () => {
  assert.ok(whompFactor(2) > whompFactor(5) && whompFactor(5) > whompFactor(10));
  assert.ok(Math.abs(whompFactor(2) / whompFactor(5) - Math.exp(3 / WHOMP.lambda)) < 1e-9);
  assert.equal(whompFactor(WHOMP.radius + 1), 0);
  assert.ok(WHOMP.push * whompFactor(2) > 100, 'colado e forte');
  assert.ok(WHOMP.push * whompFactor(WHOMP.radius * 0.95) < 12, 'na borda do alcance quase nao empurra');
  assert.ok(WHOMP.radius >= 28, 'alcance grande');
});

test('whomp: carro colado e jogado longe e sai do chao; o de longe quase nao sente', () => {
  const game = new Game(players(3), { track, cup: 'fast' });
  game.state = 'RACING';
  for (const c of game.cars) { c.locked = false; c.state = 'run'; c.vx = c.vz = 0; }
  const [a, near, far] = game.cars;
  const p = track.pointAt(60);
  a.x = p.x; a.z = p.z;
  near.x = p.x + p.nx * 2.2; near.z = p.z + p.nz * 2.2;
  far.x = p.x - p.nx * (WHOMP.radius + 4); far.z = p.z - p.nz * (WHOMP.radius + 4);
  a.item = 'whomp';
  game.items.use(a, game);
  let maxY = 0;
  for (let i = 0; i < 90; i++) { game.items.update(DT, game); maxY = Math.max(maxY, near.y); }
  assert.ok(Math.hypot(near.vx, near.vz) > 30, 'colado voa: ' + Math.hypot(near.vx, near.vz));
  assert.ok(near.vy > 3 || maxY > 0.05, 'sai do chao');
  assert.ok(Math.hypot(far.vx, far.vz) < 5, 'longe nao sente');
  assert.equal(a.vx, 0);
});

test('mina e missil explodem o carro, que fica na pista como carcaca ate o respawn', () => {
  const game = new Game(players(3), { track, cup: 'fast' });
  game.state = 'RACING';
  game.time = 5;
  for (const c of game.cars) { c.locked = false; c.state = 'run'; }
  const [a, b] = game.cars;
  game.items.mines.push({ x: b.x, z: b.z, owner: a.id, age: 3 });
  game.items.update(DT, game);
  assert.equal(b.alive, false);
  assert.equal(b.state, 'wreck');
  assert.equal(b.hidden, false, 'carcaca continua visivel');
  const x0 = b.x;
  for (let i = 0; i < 600; i++) { stepCar(b, track, DT, []); }
  assert.ok(Math.abs(b.speed) < 1, 'carcaca para por atrito');
  assert.ok(Math.abs(b.x - x0) < 60);
  // outro carro bate na carcaca: colide
  const c = game.cars[2];
  const f = { x: Math.cos(b.h), z: Math.sin(b.h) };
  c.x = b.x - f.x * 6; c.z = b.z - f.z * 6; c.h = b.h; c.vx = f.x * 20; c.vz = f.z * 20;
  let bumped = false;
  for (let i = 0; i < 120; i++) { const ev = []; collideCars(c, b, ev); if (ev.length) bumped = true; stepCar(c, track, DT, ev); stepCar(b, track, DT, ev); }
  assert.ok(bumped, 'colidiu com a carcaca');
  // novo spawn remove a carcaca
  game.endRound();
  for (let i = 0; i < 150; i++) game.update(1 / 60);
  assert.equal(game.state, 'COUNTDOWN');
  assert.equal(b.alive, true);
  assert.notEqual(b.state, 'wreck');
});

test('terra aberta: sair da estrada e permitido, mas longe demais explode', () => {
  const game = new Game(players(2), { track, cup: 'fast' });
  game.state = 'RACING';
  game.time = 0.2; // dentro da carencia: sem corte de camera
  for (const c of game.cars) { c.locked = false; c.state = 'run'; }
  const a = game.cars[0];
  const edge = track.halfWidth + track.verge;
  // acha um trecho de terra onde afastar 40 u da estrada nao encosta em outro pedaco da pista
  const probe = track.newNear();
  let land = -1, sg = 1;
  for (let s = 400; s < track.length - 300 && land < 0; s += 25) {
    const q = track.pointAt(s);
    if (track.BRIDGE[q.idx]) continue;
    for (const cand of [1, -1]) {
      track.nearest(q.x + q.nx * (edge + 40) * cand, q.z + q.nz * (edge + 40) * cand, -1, probe);
      if (Math.abs(probe.d) > edge + 36) { land = s; sg = cand; break; }
    }
  }
  assert.ok(land > 0, 'trecho encontrado');
  const p = track.pointAt(land);
  placeCar(a, track, land, 0);
  a.locked = false; a.state = 'run';
  relocate(a, track, p.x + p.nx * (edge + 6) * sg, p.z + p.nz * (edge + 6) * sg); a.vx = a.vz = 0;
  game.frameCamera(true);
  game.step(DT);
  assert.equal(a.alive, true, 'perto da estrada: ainda vivo');
  assert.ok(game.offroadRatio(a) > 0 && game.offroadRatio(a) < 1);
  relocate(a, track, p.x + p.nx * (edge + 40) * sg, p.z + p.nz * (edge + 40) * sg);
  game.frameCamera(true);
  game.step(DT);
  assert.equal(a.alive, false, 'longe demais da estrada: explode');
  assert.equal(a.state, 'wreck');
});

test('cenario solido: bater numa arvore para o carro e o empurra de volta', () => {
  const game = new Game(players(2), { track, cup: 'fast' });
  const sc = game.track.scenery;
  const tree = sc.trees.find((t) => sc.query(t.x, t.z, 14).filter((o) => Math.hypot(o.x - t.x, o.z - t.z) < 14).length === 1);
  assert.ok(tree, 'arvore isolada');
  const car = game.cars[0];
  placeCar(car, track, 100, 0);
  car.locked = false; car.state = 'run';
  car.h = 0; relocate(car, track, tree.x - 7, tree.z); car.vx = 25; car.vz = 0;
  let minx = Infinity, minv = Infinity;
  for (let i = 0; i < 120; i++) {
    stepCar(car, track, DT, []);
    minx = Math.min(minx, Math.hypot(car.x - tree.x, car.z - tree.z));
    minv = Math.min(minv, car.vx);
  }
  assert.ok(minx >= tree.r + CAR.circleR - 0.8, 'nao atravessou o tronco: ' + minx);
  assert.ok(minv < 10, 'perdeu velocidade: ' + minv);
});

// ---------------------------------------------------------------- relevo, corpo rigido, carcacas e pneus
const GND = { y: 0, nx: 0, ny: 1, nz: 0 };
const groundY = (c) => track.groundAt(c.x, c.z, c.near ? c.near.idx : -1, GND).y;

function runnerAt(s, d = 0, speed = 34) {
  const car = makeCar(0);
  placeCar(car, track, s, d);
  car.locked = false; car.state = 'run';
  car.vx = Math.cos(car.h) * speed; car.vz = Math.sin(car.h) * speed;
  return car;
}

test('pista: tem rampas de salto, curvas fechadas e area alta sem cerca', () => {
  assert.ok(track.length > 2200, 'pista maior: ' + track.length);
  assert.ok(track.minRadius() < 26, 'curvas fechadas: raio ' + track.minRadius());
  assert.ok(track.minRadius() > 16, 'ainda dirigivel: raio ' + track.minRadius());
  const L = track.length;
  assert.ok(track.elevAt(0.37 * L - 1) > 3, 'topo da rampa de salto 1');
  assert.ok(track.elevAt(0.64 * L - 1) > 3, 'topo da rampa de salto 2');
  assert.ok(track.elevAt(0.8 * L) > 8, 'plateau alto');
  assert.equal(track.RAILS[Math.floor(0.8 * L)], 0, 'plateau sem guardrail');
  assert.equal(track.RAILS[Math.floor(0.5 * L)], 1, 'resto da pista com cerca');
  const p = track.pointAt(0.8 * L), edge = track.halfWidth + track.verge;
  assert.ok(track.groundAt(p.x, p.z, -1, { y: 0 }).y > 8, 'chao no plateau');
  assert.equal(track.groundAt(p.x + p.nx * (edge + 3), p.z + p.nz * (edge + 3), -1, { y: 0 }).y, 0, 'fora da borda o chao e o terreno');
});

test('rampa de salto: o carro decola de verdade, voa e pousa sem entrar no chao', () => {
  const car = runnerAt(0.36 * track.length);
  let maxY = 0, air = 0, under = 0;
  const events = [];
  for (let i = 0; i < 480; i++) {
    stepCar(car, track, DT, events);
    maxY = Math.max(maxY, car.y);
    if (car.air) air++;
    if (car.y < groundY(car) - 0.02) under++;
  }
  assert.ok(maxY > track.elevAt(0.37 * track.length) + 0.8, 'passou da altura do labio (salto): ' + maxY);
  assert.ok(air > 30, 'ficou no ar: ' + air);
  assert.equal(under, 0, 'nunca abaixo do chao');
  assert.equal(car.state, 'run');
  assert.ok(Math.abs(car.y - groundY(car)) < 0.05, 'pousou');
  assert.ok(events.some((e) => e.type === 'land'));
  assert.ok(!events.some((e) => e.crash), 'pouso de rampa nao capota');
});

test('rampa de salto: nao capota nem em velocidade acima da de cruzeiro', () => {
  for (const sp of [42, 50, 55]) {
    const car = runnerAt(0.36 * track.length);
    car.vx *= sp / 42; car.vz *= sp / 42;
    for (let i = 0; i < 480; i++) {
      stepCar(car, track, DT, []);
      assert.notEqual(car.state, 'stun', `capotou a ${sp} u/s no passo ${i}`);
    }
  }
});

test('area alta sem guardrail: da para cair; pouso brusco capota e o carro fica sobre o chao', () => {
  const s = 0.8 * track.length;
  const car = runnerAt(s, 0, 10);
  const p = track.pointAt(s);
  car.vx = p.nx * 30 + p.tx * 10; car.vz = p.nz * 30 + p.tz * 10; // para fora da borda
  let maxY = 0, under = 0, crashed = false;
  const events = [];
  for (let i = 0; i < 1200; i++) {
    stepCar(car, track, DT, events);
    maxY = Math.max(maxY, car.y);
    if (car.y < groundY(car) - 0.05) under++;
    if (events.some((e) => e.crash)) crashed = true;
  }
  assert.ok(maxY > 8, 'comecou la em cima');
  assert.ok(car.y < 3, 'caiu da area alta: y=' + car.y);
  assert.equal(under, 0, 'nunca atravessou o chao');
  assert.ok(crashed, 'queda grande: pouso violento');
});

test('falesia: carro no chao nao "sobe" a lateral do plateau (bate e fica de fora)', () => {
  const s = 0.8 * track.length, edge = track.halfWidth + track.verge;
  const p = track.pointAt(s);
  const car = runnerAt(s, 0, 0);
  placeCar(car, track, s, edge + 6); car.locked = false; car.state = 'run'; car.y = 0;
  car.vx = -p.nx * 25; car.vz = -p.nz * 25; car.h = Math.atan2(-p.nz, -p.nx);
  for (let i = 0; i < 360; i++) stepCar(car, track, DT, []);
  assert.ok(car.y < 0.3, 'continua no chao: ' + car.y);
  assert.ok(Math.abs(car.near.d) >= edge + CAR.circleR - 1.2, 'ficou do lado de fora: ' + car.near.d);
});

test('carros em alturas diferentes (plateau x chao) nao colidem', () => {
  const a = makeCar(0), b = makeCar(1);
  placeCar(a, track, 300, 0); placeCar(b, track, 300, 0);
  a.locked = b.locked = false; a.state = b.state = 'run';
  a.y = 9; b.y = 0;
  const ev = [];
  collideCars(a, b, ev);
  assert.equal(ev.length, 0);
  assert.equal(a.vx, 0);
});

test('invariante: nenhum carro vivo atravessa o chao numa partida de bots (rampas e plateau incluidos)', () => {
  const game = new Game(players(8), { track, cup: 'war', seed: 3 });
  game.debug.infinite = true;
  let under = 0, air = 0;
  runBots(game, 100, () => {
    for (const c of game.cars) {
      if (c.state === 'dead' || c.state === 'falling') continue;
      if (c.state === 'wreck') { if (c.y < groundY(c) - 0.8) under++; continue; } // carcaca apoia o casco (sem pneus) ~0,5 acima da origem
      if (c.air) air++;
      if (c.y < groundY(c) - 0.35) under++;
    }
  });
  assert.equal(under, 0, 'frames abaixo do chao');
  assert.ok(air > 0, 'houve voo');
});

test('bots completam uma volta na pista nova (sem ficar presos)', () => {
  const game = new Game(players(8), { track, cup: 'fast', seed: 5 });
  game.debug.infinite = true; game.debug.noCut = true;
  let best = 0;
  runBots(game, 150, () => { for (const c of game.cars) if (c.alive) best = Math.max(best, c.progress); });
  assert.ok(best > track.length * 0.98, 'volta completa: ' + (best / track.length).toFixed(2));
});

function raceStart(n = 3) {
  const game = new Game(players(n), { track, cup: 'fast', seed: 11 });
  game.state = 'RACING'; game.time = 5; game.debug.noCut = true;
  for (const c of game.cars) { c.locked = false; c.state = 'run'; }
  return game;
}

test('explosao: a carcaca mantem a velocidade (nao zera) e e mais pesada; pneus saem como corpos fisicos', () => {
  const game = raceStart(3);
  const [a, b, c] = game.cars;
  const p = track.pointAt(0.55 * track.length); // reta de terra aberta
  relocate(a, track, p.x, p.z); a.h = Math.atan2(p.tz, p.tx);
  a.vx = Math.cos(a.h) * 34; a.vz = Math.sin(a.h) * 34; a.y = groundY(a);
  relocate(b, track, p.x + p.nx * 40, p.z + p.nz * 40); relocate(c, track, p.x - p.nx * 40, p.z - p.nz * 40);
  for (let i = 0; i < 10; i++) game.step(DT);
  const v0 = a.speed;
  game.explodeCar(a, 'mine', -1, a.x - Math.cos(a.h) * 2, a.z - Math.sin(a.h) * 2); // explosao logo atras
  assert.equal(a.state, 'wreck');
  assert.ok(Math.hypot(a.vx, a.vz) > v0 * 0.9, 'continua com a velocidade: ' + Math.hypot(a.vx, a.vz));
  assert.equal(game.wheels.length, 4, 'quatro pneus soltos');
  assert.ok(Math.hypot(a.ox, a.oz, a.w) > 1, 'o giro nasceu do impulso fora do centro');
  let under = 0;
  for (let i = 0; i < 120 * 20; i++) {
    game.step(DT);
    if (a.y < groundY(a) - 0.05) under++;
    for (const w of game.wheels) if (!w.dead && w.y < track.groundAt(w.x, w.z, -1, GND).y + 0.1) under++;
  }
  assert.equal(under, 0, 'carcaca e pneus nunca abaixo do chao');
  assert.ok(a.asleep && a.speed < 0.2, 'carcaca parada');
  assert.ok(game.wheels.every((w) => w.dead || w.asleep || Math.hypot(w.v[0], w.v[2]) < 6), 'pneus rolaram e quase pararam');
  assert.ok(game.wheels.some((w) => Math.hypot(w.x - a.x, w.z - a.z) > 4), 'pneus foram para longe da carcaca');
});

test('pneu solto tem colisao: bate num carro e volta', () => {
  const game = raceStart(2);
  const [a, b] = game.cars;
  const p = track.pointAt(0.55 * track.length);
  relocate(a, track, p.x, p.z); a.h = Math.atan2(p.tz, p.tx); a.vx = a.vz = 0; a.y = groundY(a);
  relocate(b, track, p.x + p.nx * 80, p.z + p.nz * 80);
  a.locked = true; // carro parado na frente do pneu
  const fx = Math.cos(a.h), fz = Math.sin(a.h);
  game.wheels.push(makeWheel(0, a.x - fx * 8, a.y + 0.7, a.z - fz * 8, [fx * 20, 0, fz * 20], [0, 0, 0], [0, 0, 0, 1], a.near.idx));
  const w = game.wheels[0];
  let vmin = 0;
  for (let i = 0; i < 240; i++) { game.step(DT); vmin = Math.min(vmin, w.v[0] * fx + w.v[2] * fz); }
  assert.ok(vmin < -1, 'quicou de volta: ' + vmin);
});

test('magnetico: carro vivo recebe empurrao e pulinho, mas mantem o rumo (sem rodopiar)', () => {
  const game = raceStart(3);
  const [a, near, far] = game.cars;
  const p = track.pointAt(0.55 * track.length); // reta aberta
  const h = Math.atan2(p.tz, p.tx);
  relocate(a, track, p.x, p.z); a.h = h; a.y = groundY(a);
  relocate(near, track, p.x + p.nx * 3, p.z + p.nz * 3);
  relocate(far, track, p.x - p.nx * 60, p.z - p.nz * 60);
  for (const c of [a, near, far]) { c.h = h; c.y = groundY(c); c.vx = Math.cos(h) * 34; c.vz = Math.sin(h) * 34; }
  a.item = 'whomp';
  game.items.use(a, game);
  let maxDh = 0, hop = 0, spin = 0;
  for (let i = 0; i < 110; i++) { // ~0,9 s depois da onda (depois o carro pode bater no cenario)
    game.step(DT);
    maxDh = Math.max(maxDh, Math.abs(Math.atan2(Math.sin(near.h - h), Math.cos(near.h - h))));
    hop = Math.max(hop, near.y - groundY(near));
    spin = Math.max(spin, Math.abs(near.w));
  }
  assert.equal(near.state === 'stun', false, 'nao vira estado de atordoamento');
  assert.ok(hop > 0.02, 'sai do chao: ' + hop);
  assert.ok(maxDh < 1.3, 'mantem o rumo mais ou menos: ' + maxDh);
  assert.ok(spin < 3.5, 'sem giro violento: ' + spin);
});

test('nitro: o rastro de fogo e curto e colado no carro', () => {
  assert.ok(TRAIL.life <= 0.5, 'rastro dura pouco: ' + TRAIL.life);
  const game = raceStart(2);
  const a = game.cars[0];
  const p = track.pointAt(0.55 * track.length);
  relocate(a, track, p.x, p.z); a.h = Math.atan2(p.tz, p.tx); a.y = groundY(a);
  relocate(game.cars[1], track, p.x + p.nx * 60, p.z + p.nz * 60);
  a.item = 'nitro'; game.items.use(a, game);
  let far = 0;
  for (let i = 0; i < 120; i++) {
    game.step(DT);
    for (const t of game.items.trails) far = Math.max(far, Math.hypot(t.x - a.x, t.z - a.z));
  }
  assert.ok(game.items.trails.length > 2, 'deixou rastro');
  assert.ok(far < 22, 'rastro curto (distancia maxima ao carro ' + far.toFixed(1) + ')');
});

test('hitbox das rodas: dois carros lado a lado nao se atravessam (casco cobre as 4 rodas)', () => {
  const a = makeCar(0), b = makeCar(1);
  placeCar(a, track, 300, 0); placeCar(b, track, 300, 0);
  for (const c of [a, b]) { c.locked = false; c.state = 'run'; }
  const p = track.pointAt(300);
  a.x = p.x; a.z = p.z; a.h = Math.atan2(p.tz, p.tx);
  b.h = a.h; b.x = p.x + p.nx * 2.9; b.z = p.z + p.nz * 2.9; // rodas se encostam: 2,56 de largura cada
  // empurra um contra o outro devagar; nunca podem se sobrepor no nivel das rodas (4 rodas de cada carro)
  const wheelPts = (c) => [[1.15, 0.99], [1.15, -0.99], [-1.15, 0.99], [-1.15, -0.99]].map(([lx, lz]) => [
    c.x + Math.cos(c.h) * lx - Math.sin(c.h) * lz, c.z + Math.sin(c.h) * lx + Math.cos(c.h) * lz]);
  let minGap = Infinity;
  for (let i = 0; i < 240; i++) {
    a.vx = p.nx * 3; a.vz = p.nz * 3; b.vx = -p.nx * 3; b.vz = -p.nz * 3;
    a.x += a.vx * DT; a.z += a.vz * DT; b.x += b.vx * DT; b.z += b.vz * DT;
    collideCars(a, b, []);
    for (const [ax, az] of wheelPts(a)) for (const [bx, bz] of wheelPts(b)) minGap = Math.min(minGap, Math.hypot(ax - bx, az - bz));
  }
  assert.ok(minGap > 0.55, 'rodas (largura 0,56) nao se sobrepoem: ' + minGap);
});

// ---------------------------------------------------------------- v0.6: controle, nitro, gelo, precipicio, bots, camera
const openTrack = buildTrack({
  ...testCircuit, bridges: [], hills: [], chasms: [], baseSurface: 2, openLand: true, halfWidth: 300, verge: 0, scale: 1,
  points: [[0, 0], [300, 0], [600, 0], [900, 0], [1200, 0], [1500, 0], [1500, 3000], [0, 3000]],
});

test('controle: o volante vira rapido e com folga (guinada alta logo depois do toque, sem rodar)', () => {
  const car = makeCar(0);
  placeCar(car, openTrack, 100, 0);
  car.locked = false; car.state = 'run'; car.vx = 34; car.vz = 0;
  const w = [];
  for (let i = 0; i < 120 * 3; i++) {
    car.steer = i >= 60 ? 1 : 0;
    stepCar(car, openTrack, DT, []);
    w.push(car.w);
  }
  const steady = w[w.length - 1];
  assert.ok(steady > 1.4, 'guinada estavel alta: ' + steady);
  const t90 = w.findIndex((v, i) => i >= 60 && v >= 0.9 * steady) - 60;
  assert.ok(t90 < 0.3 * 120, 'chega a 90% da guinada em < 0,3 s: ' + t90 / 120);
  // meio volante tambem responde (curva do volante mais sensivel perto do centro)
  const half = makeCar(1);
  placeCar(half, openTrack, 100, 0);
  half.locked = false; half.state = 'run'; half.vx = 34; half.vz = 0;
  for (let i = 0; i < 120 * 2; i++) { half.steer = i >= 30 ? 0.5 : 0; stepCar(half, openTrack, DT, []); }
  assert.ok(half.w > 0.4, 'meio volante: ' + half.w);
});

test('nitro: nao tomba nas rampas nem nas curvas (nunca atordoa nem vira de cabeca para baixo)', () => {
  for (const s of [0.355, 0.635]) {
    const car = runnerAt(s * track.length, 0, 52);
    car.boost = 2;
    let worstUp = 1;
    for (let i = 0; i < 600; i++) {
      car.boost = Math.max(car.boost, 0.5); // nitro ligado o tempo todo
      stepCar(car, track, DT, []);
      worstUp = Math.min(worstUp, car.upY);
      assert.notEqual(car.state, 'stun', 'rampa ' + s + ' passo ' + i);
    }
    assert.ok(worstUp > 0.7, 'ficou de pe: ' + worstUp);
  }
  // curva fechada a toda com o nitro
  const car = runnerAt(0.52 * track.length, 0, 52);
  for (let i = 0; i < 120 * 6; i++) {
    car.boost = 1;
    const p = track.pointAt(car.near.s + 14);
    const want = Math.atan2(p.z - car.z, p.x - car.x);
    car.steer = Math.max(-1, Math.min(1, Math.atan2(Math.sin(want - car.h), Math.cos(want - car.h)) * 2.5));
    stepCar(car, track, DT, []);
    assert.notEqual(car.state, 'stun');
  }
});

test('gelo: o morteiro cai ICE.range u a frente e congela os carros da area (menos o dono)', () => {
  const game = raceStart(4);
  const [a, near, edge, far] = game.cars;
  const p = track.pointAt(0.55 * track.length), h = Math.atan2(p.tz, p.tx);
  const fx = Math.cos(h), fz = Math.sin(h);
  for (const c of game.cars) { relocate(c, track, p.x, p.z); c.h = h; c.y = groundY(c); c.vx = c.vz = 0; c.locked = true; }
  const tx = p.x + fx * ICE.range, tz = p.z + fz * ICE.range;
  relocate(near, track, tx + 2, tz); relocate(edge, track, tx - 7, tz); relocate(far, track, tx + 30, tz);
  for (const c of [near, edge, far]) { c.locked = false; c.vx = Math.cos(h) * 20; c.vz = Math.sin(h) * 20; c.h = h; }
  a.locked = false; a.item = 'ice';
  game.items.use(a, game);
  assert.equal(game.items.mortars.length, 1);
  assert.ok(game.items.mortars[0].vy > 10, 'arco alto (morteiro): vy ' + game.items.mortars[0].vy);
  let apex = 0;
  for (let i = 0; i < 120 * 3 && game.items.mortars.length; i++) {
    for (const c of [near, edge, far]) { c.vx = Math.cos(h) * 0; c.vz = 0; } // alvos parados na area
    game.step(DT);
    apex = Math.max(apex, game.items.mortars[0]?.y ?? 0);
  }
  assert.ok(apex > 2.5, 'subiu bastante: ' + apex);
  assert.equal(game.items.mortars.length, 0, 'caiu');
  assert.ok(game.events.some((e) => e.type === 'iceBurst'));
  assert.ok(near.freeze > 2, 'perto: congelado ' + near.freeze);
  assert.ok(edge.freeze > 0, 'na borda da area: congelado');
  assert.equal(far.freeze, 0, 'fora da area: livre');
  assert.equal(a.freeze, 0, 'dono imune');
});

test('gelo: carro congelado desliza em linha reta, sem esterco nem tracao, e depois descongela', () => {
  const game = raceStart(2);
  const [a] = game.cars;
  const p = track.pointAt(0.55 * track.length), h = Math.atan2(p.tz, p.tx);
  relocate(a, track, p.x, p.z); a.h = h; a.y = groundY(a); a.vx = Math.cos(h) * CAR.cruise; a.vz = Math.sin(h) * CAR.cruise;
  relocate(game.cars[1], track, p.x + p.nx * 80, p.z + p.nz * 80);
  game.freezeCar(a, 2);
  const x0 = a.x, z0 = a.z;
  let maxDev = 0, minV = 99;
  for (let i = 0; i < 120 * 1.8; i++) {
    a.steer = i % 40 < 20 ? 1 : -1; // tentar virar nao adianta
    game.step(DT);
    const d = (a.x - x0) * -Math.sin(h) + (a.z - z0) * Math.cos(h); // desvio lateral
    maxDev = Math.max(maxDev, Math.abs(d));
    minV = Math.min(minV, a.speed);
  }
  assert.ok(maxDev < 0.5, 'linha reta: ' + maxDev);
  assert.ok(Math.abs(Math.atan2(Math.sin(a.h - h), Math.cos(a.h - h))) < 0.05, 'rumo travado');
  assert.ok(minV > 15, 'mantem a velocidade, so desacelera ate 85% do normal: ' + minV);
  assert.ok(minV >= CAR.iceKeep * CAR.cruise - 0.5, 'nunca abaixo de 85% da velocidade normal: ' + minV);
  assert.ok(a.freeze > 0, 'ainda congelado');
  for (let i = 0; i < 120 * 0.5; i++) game.step(DT);
  assert.equal(a.freeze, 0, 'descongelou');
  assert.ok(game.events.some((e) => e.type === 'unfreeze'));
  // sem item usavel enquanto congelado
  game.freezeCar(a, 1); a.item = 'nitro';
  assert.equal(game.items.use(a, game), null);
});

test('precipicio: quem sai da pista para o fosso cai e e eliminado ("caiu no precipicio")', () => {
  assert.ok(track.hasChasm);
  const game = raceStart(3);
  const [a] = game.cars;
  const s = 0.23 * track.length, edge = track.halfWidth + track.verge;
  const p = track.pointAt(s);
  relocate(a, track, p.x - p.nx * (edge + 6), p.z - p.nz * (edge + 6)); // lado esquerdo (-1) = fosso
  a.y = 0; a.vx = a.vz = 0;
  relocate(game.cars[1], track, p.x + p.nx * 90, p.z + p.nz * 90); relocate(game.cars[2], track, p.x + p.nx * 100, p.z + p.nz * 100);
  assert.ok(track.chasmAt(a.near), 'dentro do fosso');
  game.step(DT);
  assert.equal(a.state, 'falling');
  // nao morre na hora: cai (visivel) e so e eliminado ao sair do enquadramento (ou no limite de seguranca)
  for (let i = 0; i < 30; i++) game.step(DT);
  assert.equal(a.state, 'falling');
  assert.equal(a.alive, true, 'queda sem morte instantanea');
  assert.ok(!a.hidden, 'continua visivel enquanto cai');
  for (let i = 0; i < 120 * (RULES.chasmFallMax + 0.5); i++) game.step(DT);
  assert.equal(a.alive, false);
  assert.ok(game.events.some((e) => e.type === 'dead' && e.cause === 'chasm'));
  // o outro lado da pista (direita) e terra comum
  const b = game.cars[1];
  relocate(b, track, p.x + p.nx * (edge + 6), p.z + p.nz * (edge + 6)); b.vx = b.vz = 0;
  assert.equal(track.chasmAt(b.near), false);
});

function playBots(level, seconds, seed = 4) {
  const game = new Game(players(8), { track, cup: 'war', seed });
  game.debug.infinite = true; game.debug.noCut = true;
  const rng = makeRng(seed);
  const brains = new Map(game.cars.map((c) => [c.id, makeBrain(rng, null, level)]));
  const out = { game, brains, bumpsStart: 0, leaderMistakeFrames: 0, best: 0 };
  const dt = 1 / 60;
  let tt = 0;
  for (; tt < seconds; tt += dt) {
    for (const c of game.cars) {
      if (!c.near) continue;
      const r = think(brains.get(c.id), c, game, dt);
      game.setInput(c.id, r.steer, r.fire);
    }
    game.update(dt);
    for (const e of game.drainEvents()) if (e.type === 'bump' && tt > 3 && tt < 7.5) out.bumpsStart++;
    const lead = game.leaderId();
    if (lead >= 0 && brains.get(lead).mistake) out.leaderMistakeFrames++;
    for (const c of game.cars) out.best = Math.max(out.best, c.progress);
  }
  return out;
}

test('bots: 3 dificuldades; no Facil o bot na frente comete erros, no Medio e Dificil nao', () => {
  assert.deepEqual(DIFFICULTY_ORDER, ['easy', 'medium', 'hard']);
  const easy = playBots('easy', 100), medium = playBots('medium', 100), hard = playBots('hard', 100);
  assert.ok(easy.leaderMistakeFrames > 60, 'facil: lider erra (' + easy.leaderMistakeFrames + ' quadros)');
  assert.equal(medium.leaderMistakeFrames, 0);
  assert.equal(hard.leaderMistakeFrames, 0);
  // o Facil e mais devagar/erra mais que o Dificil
  assert.ok(hard.best > easy.best, 'dificil anda mais: ' + hard.best + ' x ' + easy.best);
});

test('bots: largada organizada (poucas batidas nos primeiros segundos, ninguem trava) e completam voltas em qualquer dificuldade', () => {
  for (const level of ['easy', 'medium', 'hard']) {
    const r = playBots(level, 125);
    assert.ok(r.bumpsStart < (level === 'easy' ? 40 : 14), level + ': batidas na largada ' + r.bumpsStart);
    assert.ok(r.best > track.length * 0.9, level + ': volta quase completa ' + (r.best / track.length).toFixed(2));
  }
});

test('camera: nao acompanha o balanco lateral rapido do lider (menos movimento)', () => {
  const cam = new ChaseCamera(16 / 9);
  const cars = fakeCars([[0, 300], [1, 295]]);
  settle(cam, cars);
  const p = track.pointAt(300);
  const base = { x: cars[0].x, z: cars[0].z };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 180; i++) {
    const off = Math.sin(i * 0.6) * 3; // o lider balanca 3 u para os lados
    cars[0].x = base.x + p.nx * off; cars[0].z = base.z + p.nz * off;
    cam.computeTarget(cars, track);
    cam.update(1 / 60);
    if (i > 60) { const lat = (cam.x - base.x) * p.nx + (cam.z - base.z) * p.nz; lo = Math.min(lo, lat); hi = Math.max(hi, lat); }
  }
  assert.ok(hi - lo < 1.2, 'amplitude lateral da camera: ' + (hi - lo));
  assert.ok(CAMERA.pitch > 40 * Math.PI / 180 && CAMERA.hMin >= 22, 'camera mais alta');
});

function minHullGap(game) {
  const a = { x: 0, z: 0 }, b = { x: 0, z: 0 };
  let m = Infinity;
  const cs = game.cars.filter((c) => c.alive);
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    for (let p = 0; p < HULL.length; p++) for (let q = 0; q < HULL.length; q++) {
      hullPos(cs[i], p, a); hullPos(cs[j], q, b);
      m = Math.min(m, Math.hypot(a.x - b.x, a.z - b.z));
    }
  }
  return m;
}

test('largada: nenhum carro nasce dentro de outro (grade e respawn do debug)', () => {
  const game = new Game(players(8), { track, seed: 3 });
  for (let s = 0; s < track.length; s += track.length / 10) {
    game.startRound(s);
    assert.ok(minHullGap(game) > 2 * CAR.circleR, 'grade em s=' + s.toFixed(0) + ': ' + minHullGap(game).toFixed(2));
  }
  // respawn do debug: varios mortos renascem ao mesmo tempo
  game.debug.infinite = true; game.debug.noCut = true;
  game.startRound(100);
  for (let i = 0; i < 120; i++) game.step(DT);
  game.state = 'RACING';
  for (const c of game.cars.slice(2)) { c.alive = false; c.state = 'dead'; }
  game.debugRespawn();
  assert.ok(minHullGap(game) > 2 * CAR.circleR, 'respawn: ' + minHullGap(game).toFixed(2));
});

test('bots (Facil): quem fica mais de 5 s na frente alivia o ritmo; Medio nao', () => {
  const run = (level) => {
    const game = new Game(players(4), { track, cup: 'fast', seed: 9 });
    game.debug.infinite = true; game.debug.noCut = true;
    const rng = makeRng(5);
    const brains = new Map(game.cars.map((c) => [c.id, makeBrain(rng, 0.9, level)]));
    let slowSeen = false;
    const dt = 1 / 60;
    for (let t = 0; t < 40; t += dt) {
      for (const c of game.cars) {
        if (!c.near) continue;
        const r = think(brains.get(c.id), c, game, dt);
        game.setInput(c.id, r.steer, r.fire);
      }
      game.update(dt);
      if (game.cars[0].throttle < 1) slowSeen = true;
    }
    return slowSeen;
  };
  assert.equal(run('medium'), false, 'medio nunca segura o ritmo');
  assert.equal(run('easy'), true, 'facil segura o ritmo depois de passar do tempo na frente');
});

test('colisao: carro encostado na lateral/traseira de outro nao fica preso (escorrega e se solta)', () => {
  for (const wreck of [false, true]) {
    const a = makeCar(0), b = makeCar(1);
    placeCar(a, track, 20, 2.3); placeCar(b, track, 20, 0);
    for (const c of [a, b]) { c.locked = false; c.state = 'run'; }
    if (wreck) { b.state = 'wreck'; b.asleep = true; }
    a.vx = Math.cos(a.h) * 20; a.vz = Math.sin(a.h) * 20;
    const fx = Math.cos(a.h), fz = Math.sin(a.h);
    for (let i = 0; i < 120 * 4; i++) {
      a.steer = i < 120 ? -0.5 : 0.3; // encosta no outro e depois alivia
      stepCar(a, track, DT, []); stepCar(b, track, DT, []); collideCars(a, b, []);
    }
    const lon = (a.x - b.x) * fx + (a.z - b.z) * fz;
    assert.ok(a.speed > 5 || Math.abs(lon) > 8, (wreck ? 'carcaca' : 'carro') + ': nao ficou preso, v=' + a.speed + ' lon=' + lon);
  }
});

test('nitro: alto controle - mesma curva com nitro derrapa menos do que sem', () => {
  const run = (boost) => {
    const car = makeCar(0);
    placeCar(car, openTrack, 100, 0);
    car.locked = false; car.state = 'run'; car.vx = 40; car.vz = 0;
    let slip = 0;
    for (let i = 0; i < 120 * 2; i++) {
      if (boost) car.boost = 1;
      car.steer = i > 20 ? 0.5 : 0;
      stepCar(car, openTrack, DT, []);
      slip = Math.max(slip, car.slip / Math.max(car.speed, 1));
    }
    return slip;
  };
  const withBoost = run(true), without = run(false);
  assert.ok(withBoost <= without * 1.1, 'derrapagem com nitro ' + withBoost + ' vs ' + without);
});

test('mina: so explode quem encosta na TRASEIRA do carro com a bomba (lado a lado nao conta)', () => {
  const game = raceStart(3);
  const [a, b, c] = game.cars;
  const p = track.pointAt(0.55 * track.length), h = Math.atan2(p.tz, p.tx);
  const fx = Math.cos(h), fz = Math.sin(h);
  // lado a lado, encostado: nao explode, a mina e largada
  relocate(a, track, p.x, p.z); relocate(b, track, p.x + p.nx * 2.7, p.z + p.nz * 2.7);
  relocate(c, track, p.x + p.nx * 40, p.z + p.nz * 40);
  for (const k of [a, b, c]) { k.h = h; k.y = groundY(k); k.vx = k.vz = 0; }
  a.item = 'mine';
  game.items.use(a, game);
  assert.equal(b.alive, true, 'lateral nao explode');
  assert.equal(game.items.mines.length, 1, 'a mina foi largada');
  // colado atras (para-choque com traseira): explode na hora
  const g3 = raceStart(3);
  const [a3, b3, c3] = g3.cars;
  relocate(a3, track, p.x, p.z); relocate(b3, track, p.x - fx * 3.6, p.z - fz * 3.6);
  relocate(c3, track, p.x + p.nx * 40, p.z + p.nz * 40);
  for (const k of [a3, b3, c3]) { k.h = h; k.y = groundY(k); k.vx = k.vz = 0; }
  a3.item = 'mine';
  g3.items.use(a3, g3);
  assert.equal(b3.alive, false, 'o encostado atras explodiu');
  assert.equal(c3.alive, true);
  assert.equal(g3.items.mines.length, 0, 'a mina nao foi largada');
  // longe: a mina e largada normalmente
  const g2 = raceStart(2);
  relocate(g2.cars[1], track, p.x + p.nx * 60, p.z + p.nz * 60);
  g2.cars[0].item = 'mine';
  g2.items.use(g2.cars[0], g2);
  assert.equal(g2.items.mines.length, 1);
});

test('bots: o bot que abre vantagem sobre o jogador real alivia o ritmo (Facil e Medio); Dificil nao', () => {
  for (const [level, expectSlow] of [['easy', true], ['medium', true], ['hard', false]]) {
    const game = new Game([{ id: 0, name: 'H', color: 0, isBot: false }, { id: 1, name: 'B', color: 1, isBot: true }], { track, cup: 'fast', seed: 3 });
    game.state = 'RACING'; game.time = 5; game.debug.noCut = true;
    for (const c of game.cars) { c.locked = false; c.state = 'run'; }
    const [h, bot] = game.cars;
    bot.progress = h.progress + 120; // bot muito a frente do humano
    const brain = makeBrain(makeRng(1), 0.9, level);
    think(brain, bot, game, 1 / 60);
    assert.equal(bot.throttle < 1, expectSlow, level + ' throttle ' + bot.throttle);
  }
});

test('colisao: bater na roda de tras gira o carro atingido e quem bate nao fica preso na lateral', () => {
  const a = makeCar(0), b = makeCar(1);
  placeCar(a, track, 20, 0); placeCar(b, track, 30, 0);
  for (const c of [a, b]) { c.locked = false; c.state = 'run'; }
  // a vem por tras e um pouco de lado: acerta a roda traseira de b
  const p = track.pointAt(20), h = a.h;
  a.x = b.x - Math.cos(h) * 3.2 + p.nx * 0.9 - p.nx * 0; a.z = b.z - Math.sin(h) * 3.2 + p.nz * 0.9;
  a.vx = Math.cos(h) * 30; a.vz = Math.sin(h) * 30;
  b.vx = Math.cos(h) * 20; b.vz = Math.sin(h) * 20;
  let maxW = 0;
  for (let i = 0; i < 120 * 2; i++) {
    stepCar(a, track, DT, []); stepCar(b, track, DT, []); collideCars(a, b, []);
    maxW = Math.max(maxW, Math.abs(b.w));
  }
  assert.ok(maxW > 0.8, 'o carro atingido girou: ' + maxW);
  assert.ok(a.speed > 5, 'quem bateu continua andando: ' + a.speed);
});

test('cenario: explosao destroi arvores e pedras no raio (casas resistem) e a corrida nova restaura', () => {
  const game = raceStart(2);
  const sc = game.track.scenery;
  const tree = sc.trees[0];
  const house = sc.houses[0];
  const before = sc.query(tree.x, tree.z, 3).length;
  game.items.explode(game, tree.x, tree.z, 'mine', 2.6, 0, null);
  assert.ok(game.events.some((e) => e.type === 'sceneryHit' && e.kind === 'tree'), 'evento de arvore destruida');
  assert.ok(game.events.some((e) => e.type === 'blast'), 'evento blast para quebrar cercas');
  assert.ok(sc.query(tree.x, tree.z, 3).length < before, 'colisor da arvore sumiu');
  if (house) {
    const n = sc.query(house.x, house.z, 8).filter((o) => o.kind === 'house').length;
    game.items.explode(game, house.x, house.z, 'missile', 3.2, 0, null);
    assert.equal(sc.query(house.x, house.z, 8).filter((o) => o.kind === 'house').length, n, 'casa resiste');
  }
  sc.restore();
  assert.equal(sc.query(tree.x, tree.z, 3).length, before, 'restaurado');
});

test('gelo: o morteiro sobe alto (apogeu ~ICE.lob) e o gelo marca o cenario', () => {
  const game = raceStart(2);
  const [a] = game.cars;
  const p = track.pointAt(0.55 * track.length), h = Math.atan2(p.tz, p.tx);
  relocate(a, track, p.x, p.z); a.h = h; a.y = groundY(a); a.locked = false; a.item = 'ice';
  relocate(game.cars[1], track, p.x + p.nx * 80, p.z + p.nz * 80);
  game.items.use(a, game);
  let apex = 0;
  for (let i = 0; i < 120 * 6 && game.items.mortars.length; i++) { game.step(DT); apex = Math.max(apex, game.items.mortars[0]?.y ?? 0); }
  assert.ok(apex > ICE.lob * 0.8, 'apogeu alto: ' + apex);
  assert.ok(game.events.some((e) => e.type === 'iceBurst'));
});
