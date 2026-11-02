// Limite de 15 jogadores: cores, grade de largada, partida com 15 carros e pontuacao.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PLAYERS, COLORS } from '../shared/protocol.js';
import { buildTrack } from '../sim/track.js';
import testCircuit from '../sim/tracks/testcircuit.js';
import { Game, gridSlot, scoreRound, RULES } from '../sim/game.js';
import { makeBrain, think } from '../sim/ai.js';
import { makeRng } from '../sim/rng.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: 'P' + i, color: i, isBot: true }));

test('limite: 15 jogadores e uma cor distinta para cada um', () => {
  assert.equal(MAX_PLAYERS, 15);
  assert.ok(COLORS.length >= MAX_PLAYERS);
  const hex = new Set(COLORS.slice(0, MAX_PLAYERS).map((c) => c.hex.toLowerCase()));
  assert.equal(hex.size, MAX_PLAYERS, 'cores repetidas');
  const names = new Set(COLORS.slice(0, MAX_PLAYERS).map((c) => c.name));
  assert.equal(names.size, MAX_PLAYERS, 'nomes repetidos');
});

test('grade de largada: 15 posicoes distintas, todas atras da frente', () => {
  const spots = new Set();
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const s = gridSlot(i);
    assert.ok(s.back >= 0 && (s.side === 1 || s.side === -1));
    spots.add(`${s.back}|${s.side}`);
  }
  assert.equal(spots.size, MAX_PLAYERS, 'dois carros na mesma posicao da grade');
});

test('corrida com 15 carros: todos ficam na pista, colocacao unica e pontos so para os 8 primeiros', () => {
  const track = buildTrack({ ...testCircuit, laps: 1 });
  const game = new Game(players(MAX_PLAYERS), { track, cup: 'fast', seed: 3, mode: 'race' });
  const rng = makeRng(7);
  const brains = new Map(game.cars.map((c) => [c.id, makeBrain(rng, 0.85)]));
  const events = [];
  for (let t = 0; t < 900 && game.state !== 'MATCH_END'; t += 1 / 60) {
    for (const c of game.cars) if (c.alive && c.near) { const r = think(brains.get(c.id), c, game, 1 / 60); game.setInput(c.id, r.steer, r.fire, r.rev); }
    game.update(1 / 60);
    events.push(...game.drainEvents());
  }
  assert.equal(game.state, 'MATCH_END');
  const end = events.find((e) => e.type === 'matchEnd');
  assert.ok(end, 'partida sem fim');
  assert.equal(end.results.length, MAX_PLAYERS);
  assert.deepEqual(end.results.map((r) => r.place), Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1));
  assert.equal(new Set(end.results.map((r) => r.id)).size, MAX_PLAYERS);
  assert.ok(end.results.slice(8).every((r) => r.points === 0), 'a partir da 9a posicao nao pontua');
});

test('partida com 15 bots: rodadas terminam uma por vez e todos renascem juntos', () => {
  const track = buildTrack(testCircuit);
  const game = new Game(players(MAX_PLAYERS), { track, cup: 'war', seed: 5 });
  const rng = makeRng(7);
  const brains = new Map(game.cars.map((c) => [c.id, makeBrain(rng, 0.85)]));
  const alivePerCountdown = [];
  let roundEnds = 0;
  for (let t = 0; t < 240; t += 1 / 60) {
    for (const c of game.cars) if (c.alive && c.near) { const r = think(brains.get(c.id), c, game, 1 / 60); game.setInput(c.id, r.steer, r.fire); }
    game.update(1 / 60);
    for (const e of game.drainEvents()) {
      if (e.type === 'roundEnd') { roundEnds++; assert.ok(game.aliveCars().length <= 1, 'so termina com no maximo 1 vivo'); }
      if (e.type === 'countdown' && e.n === RULES.countdown) alivePerCountdown.push(game.aliveCars().length);
    }
  }
  assert.ok(roundEnds >= 1, 'pelo menos uma rodada terminou');
  for (const n of alivePerCountdown) assert.equal(n, MAX_PLAYERS, 'todos renascem ao mesmo tempo');
  for (const [, p] of game.points) assert.ok(p >= 0 && p <= RULES.maxPoints);
});

test('pontuacao da rodada com 15 carros: um primeiro a morrer, um sobrevivente, o resto perde 1', () => {
  const ids = Array.from({ length: MAX_PLAYERS }, (_, i) => i);
  const deaths = ids.filter((i) => i !== 0); // 0 sobrevive
  const d = scoreRound(deaths, 0, ids);
  assert.equal(d[0], 2);
  assert.equal(d[deaths[0]], -2);
  assert.equal(d[deaths[deaths.length - 1]], 1);
  assert.equal(Object.keys(d).length, MAX_PLAYERS);
});
