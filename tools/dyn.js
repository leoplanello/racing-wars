// Inspeciona a dinamica do carro: node tools/dyn.js
import { buildTrack } from '../sim/track.js';
import tc from '../sim/tracks/testcircuit.js';
import { makeCar, placeCar, stepCar, updateProgress, DT, CAR } from '../sim/car.js';
const mk = (surfaces) => buildTrack({ ...tc, bridges: [], baseSurface: surfaces });
for (const [name, base] of [['asfalto', 0], ['terra', 2]]) {
  const tr = mk(base);
  const car = makeCar(0);
  placeCar(car, tr, 100, 0);
  car.locked = false;
  const log = [];
  for (let i = 0; i < 120 * 6; i++) {
    car.steer = i > 120 * 2 ? 1 : 0;
    stepCar(car, tr, DT, []); updateProgress(car, tr);
    if (i === 120 * 1) log.push(`t=1s speed=${car.speed.toFixed(1)}`);
    if (i === 120 * 2 - 1) log.push(`t=2s speed=${car.speed.toFixed(1)}`);
    if (i === 120 * 3) log.push(`t=3s speed=${car.speed.toFixed(1)} w=${car.w.toFixed(2)} slip=${car.slip.toFixed(1)}`);
    if (i === 120 * 5) log.push(`t=5s speed=${car.speed.toFixed(1)} w=${car.w.toFixed(2)} slip=${car.slip.toFixed(1)} R=${(car.speed / Math.abs(car.w)).toFixed(1)}`);
  }
  console.log(name, log.join(' | '));
}

// drift: volante total por 5 s (t=1..6), depois inverte (-1) ou solta (0). Terreno aberto, sem muro nem acostamento.
const open = buildTrack({ ...tc, bridges: [], baseSurface: 0 });
open.hwAt = () => 1e6; open.hardWall = () => false; open.boundary = 'none';
for (const [label, after] of [['solta', 0], ['inverte', -1]]) {
  const car = makeCar(0);
  placeCar(car, open, 100, 0);
  car.locked = false;
  let maxBeta = 0, wEnd = 0, uEnd = 0, flip = null, rec = null;
  for (let i = 0; i < 120 * 9; i++) {
    const t = i * DT;
    car.steer = t < 1 ? 0 : t < 6 ? 1 : after;
    stepCar(car, open, DT, []);
    const c = Math.cos(car.h), s = Math.sin(car.h);
    const u = car.vx * c + car.vz * s, v = -car.vx * s + car.vz * c, beta = Math.abs(Math.atan2(v, u)) * 57.3;
    if (t > 1 && t < 6) { maxBeta = Math.max(maxBeta, beta); wEnd = car.w; uEnd = u; }
    if (t >= 6) {
      if (flip === null && after < 0 && car.w < 0) flip = t - 6;
      if (rec === null && after === 0 && beta < 3 && Math.abs(car.w) < 0.15) rec = t - 6;
    }
  }
  console.log(`drift (${label}): deslize max=${maxBeta.toFixed(0)}gr w=${wEnd.toFixed(2)} u=${uEnd.toFixed(0)}`
    + (after < 0 ? ` inversao do giro=${flip === null ? 'nunca' : flip.toFixed(2) + 's'}` : ` recuperacao=${rec === null ? 'nunca' : rec.toFixed(2) + 's'}`));
}

// direcao em velocidade: raio e giro em regime com volante total (cruzeiro fixado em cada velocidade, asfalto aberto)
{
  const saved = CAR.cruise;
  for (const sp of [20, 30, 42, 55]) {
    CAR.cruise = sp;
    const car = makeCar(0);
    placeCar(car, open, 100, 0);
    car.locked = false; car.state = 'run'; car.vx = sp; car.vz = 0;
    for (let i = 0; i < 120 * 3; i++) { car.steer = i >= 60 ? 1 : 0; stepCar(car, open, DT, []); }
    const u = car.vx * Math.cos(car.h) + car.vz * Math.sin(car.h);
    console.log(`direcao u=${sp}: raio=${(u / car.w).toFixed(0)} w=${car.w.toFixed(2)} (u real ${u.toFixed(0)})`);
  }
  CAR.cruise = saved;
}
