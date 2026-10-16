// Fisica do carro: modelo de bicicleta dinamico (tracao TRASEIRA, direcao DIANTEIRA) + corpo rigido
// de 3 circulos para colisoes (empurrar, girar, raspar no muro). Sem DOM/Three.
//
// Convencoes: x para a direita, z para baixo; rumo h: frente = (cos h, sin h); h crescente = virar a direita;
// direita do carro = (-sin h, cos h); velocidade lateral v > 0 = deslizando para a direita; w = dh/dt.
import { SURF_MU, SURF_SPEED } from './track.js';
import { PUMP } from './scenery.js';
import { orient, tumbleStep, tiltOf, qmat, BOX, BOX_WRECK } from './body.js';

export const DT = 1 / 120;

/** Casco de colisao: 6 circulos (x = ao longo do rumo, z = lateral; direita +). Cobre ~3,6 x 2,56 u: carro + rodas. */
export const HULL = [
  { x: 1.1, z: -0.58, rear: false }, { x: 1.1, z: 0.58, rear: false },
  { x: 0, z: -0.58, rear: false }, { x: 0, z: 0.58, rear: false },
  { x: -1.1, z: -0.58, rear: true }, { x: -1.1, z: 0.58, rear: true },
];

/** Posicao mundial do circulo i do casco do carro. */
export function hullPos(car, i, out = { x: 0, z: 0 }) {
  const c = Math.cos(car.h), s = Math.sin(car.h), p = HULL[i];
  out.x = car.x + c * p.x - s * p.z;
  out.z = car.z + s * p.x + c * p.z;
  return out;
}

export const CAR = {
  radius: 1.5, // raio envolvente (itens, explosoes)
  circleR: 0.7, // raio de cada circulo do casco de colisao (6 circulos cobrem o corpo E as 4 rodas)
  length: 3.3,
  wheelbase: 2.2,
  a: 1.28, // CG -> eixo dianteiro
  b: 0.92, // CG -> eixo traseiro
  inertia: 1.45, // momento de inercia (massa = 1)
  g: 62, // escala das aderencias (aceleracao lateral maxima = mu * g)
  cruise: 42,
  reverseSpeed: 16,
  boostSpeed: 62,
  engineCap: 42, // aceleracao maxima do motor
  boostCap: 88,
  brakeCap: 26,
  kp: 6, // ganho do controle de cruzeiro
  steerMax: 0.68, // rad no volante, em baixa velocidade
  steerRef: 28, // a esterco diminui com a velocidade
  steerRate: 26, // velocidade do volante (1/s): resposta rapida
  gripAssist: 1.15, // fracao da aderencia que o auxilio de direcao deixa o volante usar (evita rodar so de esterçar)
  driftLoss: 0.2, // drift leve: fracao da aderencia traseira perdida em curva forte e rapida
  driftSpeed: 22, // velocidade a partir da qual o drift comeca a valer
  slipDamp: 14, // amortece o giro quando o carro anda de lado: segura o drift sem rodar
  steerCurve: 0.8, // <1 deixa o volante mais sensivel perto do centro (|s|^curve)
  catchupBoost: 0.2, // retardatario perto de sair do quadro ganha ate +20% de velocidade
  alphaSatF: 0.16, // rad: deriva em que o pneu dianteiro satura
  alphaSatR: 0.11, // traseiro mais "duro": carro estavel (subesterca no limite)
  wallE: 0.22,
  carE: 0.45,
  carFriction: 0.05, // atrito tangencial na batida carro x carro (menor = lateral mais escorregadia)
  sideSlide: 3, // contato lateral: velocidade (u/s) com que os carros sao afastados um do outro, para nao grudarem
  gravity: 26,
  stunTime: 1.6,
  offroadMax: 28, // distancia alem da borda da estrada em que o carro explode
  crashSpeed: 20, // velocidade vertical de pouso (u/s) acima da qual o carro capota
  rampLandTol: 1.35, // quem decolou de uma rampa aguenta um pouso x vezes mais forte antes de capotar
  wreckMass: 2.5, // a carcaca e bem mais pesada que o carro
  boostMass: 1.7, // com nitro o carro pesa mais nas batidas: da para empurrar quem esta na frente para fora do quadro
  boostGrip: 1.6, // com nitro: aderencia lateral e de tracao multiplicada (carro firme, sem escorregar)
  boostSteer: 1.5, // com nitro: o esterco cai bem menos com a velocidade
  iceKeep: 0.85, // carro congelado desacelera ate esta fracao da velocidade normal (cruise) e mantem
  iceDecel: 1.2, // quao rapido (1/s) ele chega nessa velocidade
  rearSpin: 1.2, // giro extra (x) quando se bate na roda traseira de um carro
};


export function makeCar(id, opts = {}) {
  return {
    id,
    name: opts.name || 'Jogador',
    color: opts.color ?? id,
    isBot: !!opts.isBot,
    x: 0, z: 0, h: 0, vx: 0, vz: 0, w: 0, y: 0, vy: 0, spin: 0, spinVel: 0,
    steer: 0, steerSm: 0, fire: false, contact: false, stuck: 0, rev: 0, revIn: false,
    boost: 0, stun: 0, freeze: 0, mass: 1, throttle: 1, // throttle 0..1: so os bots mexem (Facil segura o ritmo)
    alive: false, state: 'dead', // grid | run | stun | falling | dead
    locked: true, fall: 0, item: null,
    near: null, nearC: null, progress: 0, prevS: 0, slip: 0, speed: 0, surf: 0, onVerge: false, drive: 0,
    lastBig: 0, catchup: 0, destab: 0,
    pitch: 0, roll: 0, q: [0, 0, 0, 1], ox: 0, oz: 0, air: false, upY: 1, grounded: true, asleep: false, thrust: 0, restT: 0,
  };
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Posiciona o carro sobre a pista em `progress` (nao normalizado) com offset lateral d. */
export function placeCar(car, track, progress, d, at = null) {
  const p = track.pointAt(progress);
  car.x = p.x + p.nx * d;
  car.z = p.z + p.nz * d;
  car.h = Math.atan2(p.tz, p.tx);
  car.vx = car.vz = car.w = 0;
  car.y = track.elevAt(progress);
  if (at) { car.x = at.x; car.z = at.z; car.y = at.y; car.h = at.h; } // ponto real (respawn): nivel e rumo de onde o carro estava
  car.vy = 0;
  car.spin = car.spinVel = 0;
  car.pitch = car.roll = car.ox = car.oz = 0;
  car.air = false; car.rampJump = false; car.asleep = false; car.thrust = 0; car.restT = 0; car.grounded = true; car.upY = 1;
  car.q = orient(car.h, 0, 0);
  car.catchup = car.destab = 0;
  car.throttle = 1;
  car.steer = car.steerSm = 0;
  car.boost = car.stun = car.freeze = 0;
  car.fall = 0;
  car.alive = true;
  car.state = 'grid';
  car.locked = true;
  car.item = null;
  car.near = track.newNear();
  track.nearest(car.x, car.z, -1, car.near);
  car.nearC = HULL.map(() => track.newNear());
  car.prevS = car.near.s;
  car.progress = progress;
  car.speed = 0;
  car.drive = 0;
}

/** Golpe (whomp/colisao forte): o carro e jogado para cima e vira um corpo livre (3D). O giro e REAL
 * (car.w, car.ox/oz): ao fim o carro fica virado para onde parou, sem nenhum auxilio de realinhamento. */
export function hitCar(car, power = 1, dir = 0) {
  if (!car.alive || car.state === 'falling') return;
  const sg = dir || (car.id % 2 ? 1 : -1);
  car.q = orient(car.h, car.pitch, car.roll);
  car.state = 'stun';
  car.freeze = 0;
  car.stun = CAR.stunTime * power;
  car.vy = Math.max(car.vy, 11 * Math.min(1.3, power));
  car.y += 0.01;
  car.air = true;
  car.w = sg * (8 + 3 * power);
  const pitchRate = (car.id % 3 - 1) * 5 * power, rollRate = sg * 7 * power;
  const fx = Math.cos(car.h), fz = Math.sin(car.h);
  car.ox = fx * rollRate - fz * pitchRate;
  car.oz = fz * rollRate + fx * pitchRate;
  car.vx *= 0.12;
  car.vz *= 0.12;
  car.boost = 0;
}

/** Aplica um impulso (jx,jy,jz) num ponto a (rx,ry,rz) do centro de massa: muda velocidade e giro. */
export function impulseCar(car, jx, jy, jz, rx, ry, rz, mass = 1) {
  const m = qmat(car.q);
  const tx = ry * jz - rz * jy, ty = rz * jx - rx * jz, tz = rx * jy - ry * jx;
  const I = BOX.inertia;
  const bx = (m[0] * tx + m[3] * ty + m[6] * tz) / (I[0] * mass);
  const by = (m[1] * tx + m[4] * ty + m[7] * tz) / (I[1] * mass);
  const bz = (m[2] * tx + m[5] * ty + m[8] * tz) / (I[2] * mass);
  car.vx += jx / mass; car.vy += jy / mass; car.vz += jz / mass;
  car.ox += m[0] * bx + m[1] * by + m[2] * bz;
  car.w -= m[3] * bx + m[4] * by + m[5] * bz; // w = -omega_y
  car.oz += m[6] * bx + m[7] * by + m[8] * bz;
}

const GP = { y: 0, nx: 0, ny: 1, nz: 0 };
const HP = { x: 0, z: 0 }, HQ = { x: 0, z: 0 };
const CL = { pen: 0, nx: 0, nz: 0 };
const TILT = { pitch: 0, roll: 0 };

/** Um passo de fisica. `events` recebe eventos de parede/queda/pouso. */
export function stepCar(car, track, dt, events) {
  if (car.state === 'dead') return;
  if (car.state === 'falling') {
    car.fall += dt;
    car.vy -= CAR.gravity * dt;
    car.y += car.vy * dt;
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    car.vx *= 0.99;
    car.vz *= 0.99;
    car.spin += car.spinVel * dt;
    if (car.fall > (car.fallCause === 'chasm' ? 6 : 1.1)) {
      car.state = 'dead';
      car.hidden = true;
    }
    return;
  }

  car.destab = Math.max(0, car.destab - dt);
  if (car.freeze > 0) {
    car.freeze -= dt;
    if (car.freeze <= 0) { car.freeze = 0; if (events) events.push({ type: 'unfreeze', car: car.id, x: car.x, y: car.y, z: car.z }); }
  }
  const surf = track.map ? mapSurface(car, track, events) : car.near ? track.surfaceAt(car.near.idx) : 0;
  car.surf = surf;
  car.contactPrev = car.contact;
  car.contact = false;
  const px = car.x, pz = car.z;

  if (car.locked) {
    car.vx = car.vz = car.w = 0;
    car.speed = 0;
  } else if (car.state === 'wreck') {
    wreckStep(car, track, dt);
  } else if (car.state === 'stun') {
    stunStep(car, track, dt);
  } else {
    car.state = 'run';
    if (car.air) airStep(car, dt);
    else if (car.freeze > 0) freezeStep(car, dt);
    else driveStep(car, surf, dt);
  }

  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.speed = Math.hypot(car.vx, car.vz);

  // posicao na pista (centro de massa) e contato com muros/abismo
  const near = car.near;
  track.nearest(car.x, car.z, near.idx, near);
  const hw = track.hwAt(near.idx);
  const ad = Math.abs(near.d);
  car.onVerge = track.map ? false : ad > hw; // nas pistas de mapa o fora de pista e uma superficie (SURF.OFF*)

  if (track.map) {
    mapContacts(car, track, events);
    if (car.mapDeath && car.state === 'run') startFall(car, events, 'fall');
  } else if (track.boundary === 'wall') {
    for (let i = 0; i < HULL.length; i++) wallContact(car, track, i, hw, events);
    sceneryContact(car, track.scenery, events);
  } else if (track.boundary === 'void') {
    if (ad > hw && !car.air && car.state !== 'stun') startFall(car, events, 'fall');
  }
  if (track.hasElev) {
    const cx0 = car.x, cz0 = car.z;
    for (let i = 0; i < HULL.length; i++) cliffContact(car, track, i, events);
    // o empurrao da falesia pode levar o carro para fora do muro: o muro tem a palavra final
    if ((car.x !== cx0 || car.z !== cz0) && !track.map && track.boundary === 'wall') {
      for (let i = 0; i < HULL.length; i++) wallContact(car, track, i, hw, events);
    }
  }

  if (car.state === 'run' || car.locked) {
    verticalStep(car, track, dt, events, px, pz);
    syncOrientation(car, track, dt);
  }
}

/** Carcaca: corpo livre pesado. O motor "preso" ainda empurra um instante; depois so atrito e inercia. */
function wreckStep(car, track, dt) {
  car.wreckT = (car.wreckT || 0) + dt;
  if (car.asleep) {
    if (Math.hypot(car.vx, car.vz) > 0.4 || Math.abs(car.w) > 0.4 || car.vy > 0.5) car.asleep = false;
    else { car.vx = car.vz = car.w = 0; return; }
  }
  if (car.thrust > 0.2) {
    if (car.grounded && car.upY > 0.5) {
      car.vx += Math.cos(car.h) * car.thrust * dt;
      car.vz += Math.sin(car.h) * car.thrust * dt;
    }
    car.thrust *= Math.exp(-1.3 * dt);
  } else car.thrust = 0;
  car.grounded = tumbleStep(car, track, dt, { g: CAR.gravity, heavy: true, righting: false, box: BOX_WRECK });
  const still = Math.hypot(car.vx, car.vz) < 0.15 && Math.hypot(car.ox, car.oz, car.w) < 0.25;
  if (car.grounded && still) { car.restT += dt; if (car.restT > 0.5) car.asleep = true; } else car.restT = 0;
}

/** Carro atingido: corpo livre ate pousar de rodas e o atordoamento acabar. */
function stunStep(car, track, dt) {
  car.stun -= dt;
  car.grounded = tumbleStep(car, track, dt, { g: CAR.gravity, heavy: false, righting: car.stun <= 0 });
  if ((car.stun <= 0 && car.grounded && car.upY > 0.85) || car.stun < -3) {
    tiltOf(car.q, TILT);
    car.pitch = car.stun < -3 ? 0 : TILT.pitch; // a suspensao relaxa o resto sozinha
    car.roll = car.stun < -3 ? 0 : TILT.roll;
    car.ox = car.oz = 0;
    car.state = 'run';
    car.air = car.vy > 0.5 || !car.grounded;
  }
}

/** Dentro do cubo de gelo: sem tracao nem esterço, rumo travado; desliza em linha reta quase sem atrito. */
function freezeStep(car, dt) {
  // mantem a velocidade que tinha e vai desacelerando ate iceKeep (85%) da velocidade normal (nunca abaixo dela)
  const sp = Math.hypot(car.vx, car.vz), floor = Math.min(sp, CAR.iceKeep * CAR.cruise);
  if (sp > floor + 1e-3) {
    const k = (floor + (sp - floor) * Math.exp(-CAR.iceDecel * dt)) / sp;
    car.vx *= k; car.vz *= k;
  }
  car.w *= Math.exp(-10 * dt);
  car.h += car.w * dt;
  car.steerSm = 0;
  car.drive = 0;
}

/** No ar: sem aderencia nem tracao; so inercia (o rumo pode girar). */
function airStep(car, dt) {
  car.steerSm += Math.max(-CAR.steerRate * dt, Math.min(CAR.steerRate * dt, car.steer - car.steerSm));
  car.w *= Math.exp(-0.6 * dt);
  car.h += car.w * dt;
  car.drive = 0;
}

/** Altura: segue o chao (rampa/plateau) e decola quando o chao some mais rapido que a gravidade permite. */
function verticalStep(car, track, dt, events, px, pz) {
  const near = car.near, G = CAR.gravity, step = track.stepUp ?? 0.8;
  if (track.map) track.map.groundAt(car.x, car.z, car.y, GP); else track.groundFromNear(near, GP, car.x, car.z);
  if (car.locked) { car.y = GP.y; car.vy = 0; car.air = false; return; }
  // degrau alto demais a frente (face da falesia): bate e volta
  if (GP.y - car.y > step) {
    const sp = Math.hypot(car.vx, car.vz);
    if (events && sp > 3) events.push({ type: 'wall', what: 'wall', car: car.id, x: car.x, z: car.z, nx: car.vx / sp, nz: car.vz / sp, strength: Math.min(1, sp / 18) });
    car.x = px; car.z = pz;
    car.vx *= -0.25; car.vz *= -0.25;
    car.contact = true;
    track.nearest(car.x, car.z, near.idx, near);
    if (track.map) track.map.groundAt(car.x, car.z, car.y, GP); else track.groundFromNear(near, GP, car.x, car.z);
  }
  if (!car.air) {
    const yFree = car.y + car.vy * dt - 0.5 * G * dt * dt;
    // pistas de mapa: degraus pequenos para baixo (rampas feitas de pisos 3D empilhados) nao fazem o carro decolar
    const tol = track.map ? step * 0.6 : 0.03; // folga: descidas suaves colam no chao em vez de quicar
    if (GP.y < yFree - tol && car.y - GP.y > tol) { // o chao fugiu: voo balistico com a velocidade da rampa
      car.air = true;
      car.rampJump = car.vy > 3; // saiu subindo (lábio de rampa): pouso tolerante; queda de plateau continua capotando
    }
    else {
      car.vy = car.vy * 0.2 + ((GP.y - car.y) / dt) * 0.8;
      if (track.map) car.vy = Math.max(-30, Math.min(30, car.vy));
      car.gvy = car.vy; // velocidade vertical do chao: reaproveitada no pouso para nao quicar em descidas
      car.y = GP.y;
    }
  }
  if (car.air) {
    car.vy -= G * dt;
    car.y += car.vy * dt;
    if (car.y <= GP.y) {
      // impacto relativo ao chao: velocidade vertical menos a do piso sob o carro, na normal da superficie
      // (pousar na descida da rampa nao conta a queda inteira)
      const groundVy = -(GP.nx * car.vx + GP.nz * car.vz) / Math.max(0.2, GP.ny);
      const impact = Math.min(0, (car.vy - groundVy) * GP.ny);
      car.y = GP.y;
      // com nitro o carro e estavel: so um pouso muito mais violento o faz capotar
      const boosted = car.boost > 0;
      const ramp = car.rampJump;
      car.rampJump = false;
      const limit = CAR.crashSpeed * (boosted ? 1.4 : ramp ? CAR.rampLandTol : 1);
      if (impact < -limit || (!boosted && !ramp && impact < -7 && Math.abs(car.pitch - groundPitch(car, track)) > 0.75)) crashLand(car, impact, events);
      else if (impact < -4) {
        // quique da suspensao, relativo ao piso: em face de subida o piso ja sobe `groundVy`; sem somar isso o carro
        // re-pousava a cada passo (quicando ate sair da rampa)
        car.vy = Math.max(0, groundVy) - impact * 0.18;
        if (events) events.push({ type: 'land', car: car.id, x: car.x, z: car.z, strength: Math.min(1, -impact / 14) });
      } else { car.air = false; car.vy = Math.min(0, car.gvy ?? 0) * 0.5; } // pouso suave: segue a inclinacao do chao
    }
  }
}

/** Inclinacao do chao ao longo do rumo do carro (so no tabuleiro). */
function groundPitch(car, track) {
  if (track.map) return Math.atan(-(GP.nx * Math.cos(car.h) + GP.nz * Math.sin(car.h)) / Math.max(0.2, GP.ny)); // GP = chao do passo atual
  const near = car.near;
  if (Math.abs(near.d) > track.edgeAt(near.idx)) return 0;
  return Math.atan(track.slopeAt(near.s) * (near.tx * Math.cos(car.h) + near.tz * Math.sin(car.h)));
}

/** Pouso violento: o carro vira corpo livre e capota pelo que a fisica der. */
function crashLand(car, impact, events) {
  car.q = orient(car.h, car.pitch, car.roll);
  car.state = 'stun';
  car.stun = 0.9;
  car.vy = -impact * 0.25;
  car.vx *= 0.7; car.vz *= 0.7;
  const fx = Math.cos(car.h), fz = Math.sin(car.h);
  const pr = -car.pitch * 3, rr = (car.id % 2 ? 1 : -1) * 2;
  car.ox = fx * rr - fz * pr;
  car.oz = fz * rr + fx * pr;
  if (events) events.push({ type: 'land', car: car.id, x: car.x, z: car.z, strength: 1, crash: true });
}

/** Carro rodando: inclina com o terreno (ou segue a trajetoria no ar) e atualiza o quaternion. */
function syncOrientation(car, track, dt) {
  const target = car.air ? Math.atan2(car.vy, Math.max(4, car.speed)) : groundPitch(car, track);
  car.pitch += (target - car.pitch) * (1 - Math.exp(-(car.air ? 2.5 : 14) * dt));
  car.roll *= Math.exp(-10 * dt);
  orient(car.h, car.pitch, car.roll, car.q);
  car.upY = Math.cos(car.pitch) * Math.cos(car.roll);
}

/** Contato com a lateral de uma area alta (plateau/rampa) quando o carro esta abaixo do tabuleiro. */
function cliffContact(car, track, i, events) {
  const R = CAR.circleR;
  const { x: cx, z: cz } = hullPos(car, i, HP);
  if (!track.cliffAt(cx, cz, car.y, R, car.near.idx, CL)) return;
  car.x -= CL.nx * CL.pen;
  car.z -= CL.nz * CL.pen;
  car.contact = true;
  staticImpulse(car, CL.nx, CL.nz, cx, cz, R, CAR.wallE, 0.3, events, 'wall');
}

/** Dinamica do carro rodando: motor no eixo traseiro, esterco no dianteiro. */
function driveStep(car, surf, dt) {
  const fx = Math.cos(car.h), fz = Math.sin(car.h);
  const rx = -fz, rz = fx;
  let u = car.vx * fx + car.vz * fz; // longitudinal
  let v = car.vx * rx + car.vz * rz; // lateral (direita +)
  let w = car.w;

  const mu = car.onVerge ? SURF_MU[surf] * 0.62 : SURF_MU[surf];
  const bg = car.boost > 0 ? CAR.boostGrip : 1; // nitro = alto controle
  const FRONT_LOAD = CAR.b / CAR.wheelbase, REAR_LOAD = CAR.a / CAR.wheelbase; // fracao do peso em cada eixo (lido ao vivo)
  const fmaxF = mu * CAR.g * FRONT_LOAD * bg;
  // traseira atingida: perde aderencia por um instante e o carro roda com facilidade
  const fmaxR0 = mu * CAR.g * REAR_LOAD * bg * (1 - 0.6 * Math.min(1, car.destab / 0.5));
  const driftK = Math.min(1, Math.max(0, (Math.abs(car.steerSm) - 0.55) / 0.35)) * Math.min(1, Math.max(0, (u - CAR.driftSpeed) / 12));
  // o drift entra e sai aos poucos (sem degrau de aderencia que faria o carro rodar)
  car.drift = (car.drift || 0) + (driftK - (car.drift || 0)) * (1 - Math.exp(-(driftK > (car.drift || 0) ? 2.5 : 6) * dt));
  const fmaxRd = fmaxR0 * (1 - CAR.driftLoss * car.drift * (car.boost > 0 ? 0.4 : 1));

  // volante suavizado; menos esterco em alta velocidade
  car.steerSm += Math.max(-CAR.steerRate * dt, Math.min(CAR.steerRate * dt, car.steer - car.steerSm));
  // o angulo do volante e limitado pela aderencia (auxilio de direcao): evita rodar so de esterçar
  const us = Math.max(Math.abs(u), 3);
  const gripCap = (CAR.gripAssist * mu * CAR.g * CAR.wheelbase * bg) / (us * us);
  const sRef = CAR.steerRef * (bg > 1 ? CAR.boostSteer : 1);
  const dMax = Math.min(CAR.steerMax / (1 + (u / sRef) ** 2), Math.max(gripCap, 0.02));
  const sIn = Math.sign(car.steerSm) * Math.abs(car.steerSm) ** CAR.steerCurve;
  const delta = sIn * dMax * (car.rev > 0 ? -1 : 1);

  // controle de cruzeiro -> forca de tracao na roda traseira
  // preso de frente para o muro: engata re por um instante e sai
  if (car.contactPrev || Math.abs(u) > 3) car.stuck = Math.abs(u) > 3 ? 0 : car.stuck + dt;
  else car.stuck = Math.max(0, car.stuck - 2 * dt);
  if (car.stuck > 0.45 && car.rev <= 0) { car.rev = 0.9; car.stuck = 0; }
  const catchup = 1 + CAR.catchupBoost * car.catchup;
  let target = CAR.cruise * SURF_SPEED[surf] * catchup * (car.throttle ?? 1);
  let cap = CAR.engineCap * catchup;
  if (car.rev > 0) { car.rev -= dt; target = -9; }
  if (car.revIn) target = -CAR.reverseSpeed; // jogador segurou as duas setas
  if (car.boost > 0) { car.boost -= dt; target = CAR.boostSpeed; cap = CAR.boostCap; }
  if (car.onVerge) target *= 0.8;
  let fx_drive = CAR.kp * (target - u);
  fx_drive = Math.max(-CAR.brakeCap, Math.min(cap, fx_drive));
  // limite de tracao: a roda traseira nao passa do atrito disponivel (patina)
  const tractionCap = fmaxR0 * 1.15;
  fx_drive = Math.max(-fmaxR0 * 1.2, Math.min(tractionCap, fx_drive));
  // controle de tracao: tira o pe quando o carro derrapa (evita sobreviragem incontrolavel)
  if (fx_drive > 0) fx_drive *= Math.max(0.55, 1 - 0.9 * (Math.abs(v) / (Math.abs(u) + 3)));
  car.drive = fx_drive;

  // forcas laterais dos pneus (angulo de deriva), regularizado em baixa velocidade
  const ua = Math.max(Math.abs(u), 2.0) * (u < 0 ? -1 : 1);
  const alphaF = Math.atan2(v + CAR.a * w, ua) - delta;
  const alphaR = Math.atan2(v - CAR.b * w, ua);
  const fyF = -fmaxF * Math.tanh(alphaF / CAR.alphaSatF);
  // circulo de atrito do eixo traseiro: quanto mais tracao, menos forca lateral
  const ratio = Math.min(bg > 1 ? 0.5 : 0.85, Math.abs(fx_drive) / (fmaxR0 * 1.15));
  const fmaxR = fmaxRd * Math.sqrt(1 - ratio * ratio);
  const fyR = -fmaxR * Math.tanh(alphaR / CAR.alphaSatR);

  const cd = Math.cos(delta), sd = Math.sin(delta);
  const du = fx_drive - fyF * sd - 0.35 * u + v * w;
  const dv = fyF * cd + fyR - u * w;
  const dw = (CAR.a * fyF * cd - CAR.b * fyR) / CAR.inertia - (0.9 + 0.55 * Math.abs(w)) * w
    + CAR.slipDamp * Math.max(-0.3, Math.min(0.3, v / (Math.abs(u) + 6))) * Math.min(1, Math.abs(u) / 15);
  car.slip = Math.abs(v);

  u += du * dt;
  v += dv * dt;
  w += dw * dt;
  // amortecimento lateral quando quase parado (evita deslizar parado)
  if (Math.abs(u) < 3) v *= Math.exp(-6 * dt);

  car.h += w * dt;
  car.w = w;
  const nfx = Math.cos(car.h), nfz = Math.sin(car.h);
  car.vx = nfx * u - nfz * v;
  car.vz = nfz * u + nfx * v;
}

/** Impulso de um contato estatico (muro, arvore...) com normal (nx,nz) para FORA do carro. */
function staticImpulse(car, nx, nz, cx, cz, R, e, mu, events, kind, what = 'wall') {
  const rx = cx - car.x + nx * R, rz = cz - car.z + nz * R;
  const rvx = car.vx - car.w * rz, rvz = car.vz + car.w * rx;
  const vn = rvx * nx + rvz * nz;
  if (vn <= 0) return 0;
  const rn = rx * nz - rz * nx;
  const j = ((1 + e) * vn) / (1 + (rn * rn) / CAR.inertia);
  car.vx -= j * nx;
  car.vz -= j * nz;
  car.w -= (j * rn) / CAR.inertia;
  const tx = -nz, tz = nx;
  const vt = rvx * tx + rvz * tz;
  const rt = rx * tz - rz * tx;
  const jt = Math.max(-mu * j, Math.min(mu * j, -vt / (1 + (rt * rt) / CAR.inertia)));
  car.vx += jt * tx;
  car.vz += jt * tz;
  car.w += (jt * rt) / CAR.inertia;
  if (vn > 3 && events) events.push({ type: kind, what, car: car.id, x: cx + nx * R, z: cz + nz * R, nx, nz, strength: Math.min(1, vn / 18) });
  return vn;
}

/** Contato de um circulo do carro com os muros da pista (impulso com rotacao). */
function wallContact(car, track, i, hw, events) {
  const R = CAR.circleR;
  const { x: cx, z: cz } = hullPos(car, i, HP);
  const nc = car.nearC[i];
  track.nearest(cx, cz, nc.idx >= 0 ? nc.idx : car.near.idx, nc);
  if (!track.hardWall(nc.idx, nc.d)) return; // terra aberta / zona aberta: da para sair da estrada
  const maxD = track.hwAt(nc.idx) + track.verge - R;
  const ad = Math.abs(nc.d);
  if (ad <= maxD) return;
  const pen = ad - maxD;
  car.contact = true;
  const sg = nc.d > 0 ? 1 : -1;
  const nx = nc.nx * sg, nz = nc.nz * sg; // normal para fora da pista
  car.x -= nx * pen;
  car.z -= nz * pen;
  staticImpulse(car, nx, nz, cx, cz, R, CAR.wallE, 0.35, events, 'wall');
}

const DT_CAR = 1 / 120; // passo fixo (so para temporizadores internos do carro)
const MG = { y: 0, sec: 0, fof: -1, nx: 0, ny: 1, nz: 0, si: 0 };
const MT = { y: 0, sec: 0, fof: -1, nx: 0, ny: 1, nz: 0 };
const MI = { off: 0, boost: false, finish: false, death: false };

/**
 * Pistas de mapa (SRB2Kart): piso especial sob o carro. Fora de pista vira SURF.OFF1..3 (4..6), o painel de sneaker da nitro
 * e poco/morte/vazio derruba o carro. So vale com o carro no chao e correndo.
 */
function mapSurface(car, track) {
  const w = track.map;
  w.groundAt(car.x, car.z, car.y, MG);
  w.surfaceInfo(MG.sec, MI);
  car.mapDeath = false;
  if (car.padCd > 0) car.padCd -= DT_CAR;
  if (!car.locked && car.state === 'run' && !car.air && car.y - MG.y < 0.3) {
    if (MI.boost) car.boost = Math.max(car.boost, 1.3);
    if (!(car.padCd > 0)) {
      // mola: salto; dash pad: nitro e rumo da seta; elo assistido: salto invisivel que liga dois pontos que o mapa original
      // vence com saltos de rampa, degraus altos ou vaos. O lancamento (vy e velocidade) vem da rota importada.
      let rec = null;
      if (MI.spring || MI.dash) rec = track.springs[MG.sec] || null;
      if (!rec && track.assists.length) {
        const fx = Math.cos(car.h), fz = Math.sin(car.h);
        for (const a of track.assists) {
          const dx = a.x - car.x, dz = a.z - car.z;
          if (dx * dx + dz * dz >= a.r * a.r) continue;
          // sem `f` (dados antigos) vale o alinhamento com o salto; com `f` basta estar no trecho certo e andando para a frente
          // (saltos em cotovelo em U partem de um ponto que o carro cruza em outro rumo)
          if (a.f === undefined && fx * a.dx + fz * a.dz <= 0.4) continue;
          if (a.f !== undefined && car.near && fx * car.near.tx + fz * car.near.tz <= 0.2) continue;
          if (a.f !== undefined && car.near) { // so dispara para quem esta no trecho da pista a que o salto pertence (outra perna cruza o mesmo ponto)
            let sep = Math.abs(car.near.s - a.f * track.length);
            sep = Math.min(sep, track.length - sep);
            if (sep > 40) continue;
          }
          rec = a; break;
        }
      }
      if (MI.dash) {
        car.boost = Math.max(car.boost, 1.2);
        const pad = track.pads[MG.sec];
        if (pad && !pad.noSnap) {
          const sp = Math.max(car.speed, CAR.cruise);
          car.h = Math.atan2(pad.dz, pad.dx);
          car.vx = Math.cos(car.h) * sp; car.vz = Math.sin(car.h) * sp; car.w = 0;
        }
      }
      if (rec || MI.spring) {
        if (rec) {
          const sp = Math.max(rec.v, 8);
          car.h = Math.atan2(rec.dz, rec.dx);
          car.vx = Math.cos(car.h) * sp; car.vz = Math.sin(car.h) * sp; car.w = 0;
        } else if (car.speed > 0.5 && car.speed < CAR.cruise) { car.vx *= CAR.cruise / car.speed; car.vz *= CAR.cruise / car.speed; }
        car.vy = rec ? rec.vy : 14;
        car.air = true;
        car.rampJump = true;
        car.y += 0.02;
      }
      if (rec || MI.spring || MI.dash) car.padCd = 0.5;
    }
    car.mapDeath = MI.death || (w.isVoid(MG.si) && MG.fof < 0); // a queda comeca depois do movimento (mapContacts)
  }
  return MI.off ? 3 + MI.off : 0;
}

/**
 * Paredes de um mapa: cada circulo do casco contra as linhas proximas. Bloqueia linha de um lado, IMPASSIVEL, ou degrau
 * que o carro nao alcanca (a superficie do outro lado mais alta que a altura + degrau). Normal para o lado do obstaculo.
 */
function mapContacts(car, track, events) {
  const w = track.map, R = CAR.circleR, y = car.y;
  for (let i = 0; i < HULL.length; i++) {
    const { x: cx, z: cz } = hullPos(car, i, HP);
    w.forLines(cx, cz, R + 0.01, (li, l) => {
      const ax = l[0], az = l[1], ex = l[2] - ax, ez = l[3] - az, len2 = ex * ex + ez * ez;
      let t = len2 > 0 ? ((cx - ax) * ex + (cz - az) * ez) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + ex * t, pz = az + ez * t, dx = px - cx, dz = pz - cz, d2 = dx * dx + dz * dz;
      if (d2 >= R * R) return;
      const cross = ex * (cz - az) - ez * (cx - ax); // > 0: o centro esta na frente da linha
      let block = l[6] < 0 || l[7] < 0 || (l[4] & 1) !== 0;
      if (!block) {
        // altura do carro no ponto de contato: numa rampa o piso do lado de ca ja subiu ate la (senao o topo da rampa vira "degrau")
        const near = cross > 0 ? l[6] : l[7], far = near === l[6] ? l[7] : l[6];
        w.surfaceIn(near, px, pz, y, MT);
        block = !w.surfaceIn(far, px, pz, Math.max(y, MT.y), MT);
      }
      if (!block) return;
      const d = Math.sqrt(d2);
      let nx, nz;
      if (d > 1e-6) { nx = dx / d; nz = dz / d; } else { const k = Math.sqrt(len2) || 1; nx = (cross > 0 ? ez : -ez) / k; nz = (cross > 0 ? -ex : ex) / k; }
      const pen = R - d;
      car.x -= nx * pen;
      car.z -= nz * pen;
      car.contact = true;
      staticImpulse(car, nx, nz, cx, cz, R, CAR.wallE, 0.35, events, 'wall');
    });
  }
}

/** Colisao com o cenario solido (arvores, pedras, casas). */
export function sceneryContact(car, scenery, events) {
  if (!scenery || car.state === 'falling') return;
  const R = CAR.circleR;
  const list = scenery.query(car.x, car.z, 8, car._q || (car._q = []));
  if (!list.length) return;
  for (let i = 0; i < HULL.length; i++) {
    const { x: cx, z: cz } = hullPos(car, i, HP);
    for (const o of list) {
      if (o.dead || car.y > (o.top ?? 99)) continue; // por cima do obstaculo (rampa/plateau)
      const dx = o.x - cx, dz = o.z - cz;
      const rr = R + o.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-9) continue;
      const beh = o.beh;
      if (beh && beh.knock) {
        // cone, placa, hidrante, ponto de onibus: nao seguram o carro, quebram/tombam e tiram um pouco de velocidade
        o.ref.dead = true;
        for (const cc of o.ref.cols) cc.dead = true;
        const k = 1 - beh.soft;
        car.vx *= k; car.vz *= k;
        if (events) events.push({ type: 'propHit', kind: o.kind, idx: o.idx, x: o.ref.x, z: o.ref.z, vx: car.vx, vz: car.vz, car: car.id });
        continue;
      }
      if (beh && beh.explosive && !o.ref.burnt && car.speed > PUMP.minSpeed) scenery.ignite(o.ref, PUMP.first);
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d; // do carro para o obstaculo
      const pen = rr - d;
      car.x -= nx * pen;
      car.z -= nz * pen;
      car.contact = true;
      staticImpulse(car, nx, nz, cx - nx * pen, cz - nz * pen, R, o.kind === 'rock' ? 0.3 : 0.18, 0.3, events, 'wall', o.kind);
    }
  }
}

export function startFall(car, events, cause) {
  if (car.state === 'falling' || car.state === 'dead') return;
  car.state = 'falling';
  car.fallCause = cause;
  car.fall = 0;
  car.vy = 2;
  car.spinVel = (car.id % 2 ? 1 : -1) * 3;
  if (events) events.push({ type: 'fall', car: car.id, x: car.x, z: car.z, cause });
}

/** Atualiza o progresso desenrolado (voltas) a partir do s da pista. */
export function updateProgress(car, track) {
  const L = track.length;
  let delta = car.near.s - car.prevS;
  if (delta > L / 2) delta -= L;
  else if (delta < -L / 2) delta += L;
  car.progress += delta;
  car.prevS = car.near.s;
}

const CONTACTS = [];
/** Massa na colisao: carcaca pesada; com nitro o carro e um aríete (empurra os outros para tras do quadro). */
function collideMass(c) {
  return (c.state === 'wreck' ? CAR.wreckMass : 1) * (c.boost > 0 ? CAR.boostMass : c.freeze > 0 ? 1.25 : 1);
}
/**
 * Colisao carro x carro: casco de 6 circulos (corpo + rodas). Os contatos simultaneos (varios circulos de uma batida)
 * sao resolvidos juntos por impulsos sequenciais acumulados (8 iteracoes), entao o impulso se divide entre eles e
 * uma batida de topo nao gira o carro.
 */
export function collideCars(a, b, events) {
  if (a.state === 'falling' || b.state === 'falling' || a.state === 'dead' || b.state === 'dead') return;
  if (Math.abs(a.y - b.y) > 2.2) return; // alturas diferentes (um em cima do plateau): nao se tocam
  if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 > 20) return; // longe demais para qualquer circulo se tocar
  const R2 = CAR.circleR * 2;
  const ma = collideMass(a), mb = collideMass(b);
  const Ia = CAR.inertia * ma, Ib = CAR.inertia * mb;
  let n = 0, deep = 0, sx = 0, sz = 0;
  for (let i = 0; i < HULL.length; i++) {
    hullPos(a, i, HP);
    const ax = HP.x, az = HP.z;
    for (let k = 0; k < HULL.length; k++) {
      hullPos(b, k, HQ);
      const dx = HQ.x - ax, dz = HQ.z - az;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R2 * R2 || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d; // de a para b
      const pen = R2 - d;
      if (pen > deep) deep = pen;
      sx += nx * pen; sz += nz * pen; // normal media ponderada: nenhum circulo isolado prende o carro
      const px = ax + nx * CAR.circleR, pz = az + nz * CAR.circleR;
      const rax = px - a.x, raz = pz - a.z, rbx = px - b.x, rbz = pz - b.z;
      const vn0 = (b.vx - b.w * rbz - (a.vx - a.w * raz)) * nx + (b.vz + b.w * rbx - (a.vz + a.w * rax)) * nz;
      if (vn0 >= 0) continue;
      const rna = rax * nz - raz * nx, rnb = rbx * nz - rbz * nx;
      const c = CONTACTS[n] || (CONTACTS[n] = {});
      n++;
      c.nx = nx; c.nz = nz; c.px = px; c.pz = pz; c.rax = rax; c.raz = raz; c.rbx = rbx; c.rbz = rbz; c.rna = rna; c.rnb = rnb;
      c.K = 1 / ma + 1 / mb + (rna * rna) / Ia + (rnb * rnb) / Ib;
      c.vt = vn0 < -1 ? -CAR.carE * vn0 : 0; // velocidade normal desejada depois (restituicao)
      c.vn0 = vn0; c.acc = 0; c.ri = HULL[i].rear; c.rk = HULL[k].rear;
    }
  }
  if (deep > 0) {
    // separa pela normal media de todos os pares sobrepostos (proporcional ao inverso da massa)
    const sl = Math.hypot(sx, sz) || 1, dnx = sx / sl, dnz = sz / sl;
    const wa = mb / (ma + mb), wb = ma / (ma + mb), s = Math.min(deep, 0.5) * 0.8 + deep * 0.2;
    a.x -= dnx * s * wa; a.z -= dnz * s * wa;
    b.x += dnx * s * wb; b.z += dnz * s * wb;
    // encostados: ativa o desengate (re) de quem ficou parado empurrando; acorda carcaca empurrada
    // so conta como "preso" (re) quem esta empurrando de frente: encostar de lado nao prende nem dispara a re
    if (dnx * Math.cos(a.h) + dnz * Math.sin(a.h) > 0.6) a.contact = true;
    if (-(dnx * Math.cos(b.h) + dnz * Math.sin(b.h)) > 0.6) b.contact = true;
    if (a.state === 'wreck' && deep > 0.05) a.asleep = false;
    if (b.state === 'wreck' && deep > 0.05) b.asleep = false;
  }
  if (!n) return;
  const latCos = deep > 0 ? Math.abs((sx * Math.cos(a.h) + sz * Math.sin(a.h)) / (Math.hypot(sx, sz) || 1)) : 1;
  for (let it = 0; it < 8; it++) {
    for (let q = 0; q < n; q++) {
      const c = CONTACTS[q];
      const vn = (b.vx - b.w * c.rbz - (a.vx - a.w * c.raz)) * c.nx + (b.vz + b.w * c.rbx - (a.vz + a.w * c.rax)) * c.nz;
      let j = (c.vt - vn) / c.K;
      const acc = Math.max(0, c.acc + j);
      j = acc - c.acc; c.acc = acc;
      if (!j) continue;
      a.vx -= (j * c.nx) / ma; a.vz -= (j * c.nz) / ma; a.w -= (j * c.rna) / Ia;
      b.vx += (j * c.nx) / mb; b.vz += (j * c.nz) / mb; b.w += (j * c.rnb) / Ib;
    }
  }
  // contato lateral (normal quase perpendicular ao rumo): afasta os dois ao longo da normal para nao grudarem
  const lat = Math.max(0, 1 - latCos / 0.35);
  if (lat > 0 && a.state !== 'wreck' && b.state !== 'wreck') {
    const sl = Math.hypot(sx, sz) || 1, dnx = sx / sl, dnz = sz / sl;
    const rel = (b.vx - a.vx) * dnx + (b.vz - a.vz) * dnz;
    const add = Math.max(0, CAR.sideSlide * lat - rel);
    a.vx -= dnx * add * mb / (ma + mb); a.vz -= dnz * add * mb / (ma + mb);
    b.vx += dnx * add * ma / (ma + mb); b.vz += dnz * add * ma / (ma + mb);
  }
  let worst = 0, hx = 0, hz = 0;
  for (let q = 0; q < n; q++) {
    const c = CONTACTS[q];
    if (!c.acc) continue;
    // roda traseira: bater ali desestabiliza muito mais (rodopia e perde a traseira)
    // (qualquer encosto forte ja gira o alvo: empurrar a roda de tras e a mecanica central do jogo)
    if (-c.vn0 > 0.8) {
      if (c.ri) { a.destab = Math.max(a.destab, Math.min(1.1, -c.vn0 / 7)); a.w -= (CAR.rearSpin * c.acc * c.rna) / Ia; }
      if (c.rk) { b.destab = Math.max(b.destab, Math.min(1.1, -c.vn0 / 7)); b.w += (CAR.rearSpin * c.acc * c.rnb) / Ib; }
    }
    // atrito tangencial leve
    const tx = -c.nz, tz = c.nx;
    const vt = (b.vx - b.w * c.rbz - (a.vx - a.w * c.raz)) * tx + (b.vz + b.w * c.rbx - (a.vz + a.w * c.rax)) * tz;
    const jt = Math.max(-CAR.carFriction * c.acc, Math.min(CAR.carFriction * c.acc, -vt * 0.3)); // pouco atrito: os carros escorregam um pelo outro
    a.vx -= (jt * tx) / ma; a.vz -= (jt * tz) / ma;
    b.vx += (jt * tx) / mb; b.vz += (jt * tz) / mb;
    if (-c.vn0 > worst) { worst = -c.vn0; hx = c.px; hz = c.pz; }
  }
  if (worst > 2.5 && events) events.push({ type: 'bump', a: a.id, b: b.id, x: hx, z: hz, strength: Math.min(1, worst / 16) });
}
