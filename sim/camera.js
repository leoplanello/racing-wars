// Camera de perseguicao: fica SEMPRE atras do pelotao, olhando ao longo da pista, mais horizontal (como na v0.3),
// e acompanha as curvas pelo rumo da pista a frente do lider. Toda a matematica (enquadramento, zoom e corte de
// carros) e pura, sem Three, para ser testada.
//
// Regras:
//  - a camera segue a MEDIA de todos os carros, com a ancora perto do centro (muita pista a frente);
//  - o zoom afasta para o carro da frente nao passar de topNy;
//  - o zoom out (altura/distancia) aumenta para encaixar o carro mais atrasado, ate um LIMITE fixo;
//  - so e cortado quem fica para TRAS (borda de baixo) ou foge muito pelos lados. Nunca pela frente;
//  - a camera sobe e desce com o chao sob o lider (rampas, plateau), suavizada; nada de tremor por colisoes.

const RAD = Math.PI / 180;

export const CAMERA = {
  pitch: 44 * RAD, // inclinacao para baixo (mais alta que a v0.3, ainda longe de vertical)
  fov: 52, // graus, vertical
  hMin: 24, // altura minima
  hMax: 44, // LIMITE do zoom-out
  leaderNy: 0.1, // posicao vertical da ancora (media do pelotao) na tela (-1 baixo .. +1 topo); baixo = mais pista a frente
  topNy: 0.8, // o carro da frente nunca passa disso (o zoom afasta)
  rearNy: -0.8, // o zoom tenta manter o ultimo carro acima disso
  cutNy: -1.05, // abaixo disso o carro e destruido (ficou para tras)
  cutNx: 2.0, // lateral: so se for muito longe (explorar o cenario e permitido)
  yawLook: 18, // antecipacao do rumo (unidades ao longo da pista)
  raceSideNx: 0.82, // corrida: limite lateral do enquadramento (|nx|; 1 = borda da tela)
  packWindow: 70, // corrida: carros a mais disso (progresso) dos obrigatorios nao puxam a camera
  carY: 0.6,
  shakeMax: 0.8, // teto do tremor (unidades de mundo)
  // suavizacao (1/s; menor = mais calma). A ancora segue o lider devagar na LATERAL para nao acompanhar o balanco do carro.
  kAlong: 6, // ancora ao longo da pista
  kLat: 1.8, // ancora lateral
  kYaw: 3.2, // rumo da camera
  kHUp: 2.5, // zoom out
  kHDown: 0.7, // zoom in
  yawDead: 0.015, // rad: diferencas menores que isso nao mexem a camera
  hDead: 0.5, // unidades: o alvo de altura so muda se passar disso
  lead: 1, // compensacao do atraso da ancora (0 = desliga)
};

// derivados lidos ao vivo (o painel de debug pode mexer em CAMERA)
const tanHalf = () => Math.tan((CAMERA.fov * RAD) / 2);
/** distancia horizontal atras do lider por unidade de altura */
const backPerH = () => 1 / Math.tan(CAMERA.pitch - Math.atan(CAMERA.leaderNy * tanHalf()));

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Colisao da camera (pura, so le a pista). `camBlocked`: o ponto (x,z,y) esta dentro de algo solido (teto, piso 3D, objeto do cenario)
// ou, com `near`, encostado numa parede / muro de borda?
const _cw = { nx: 0, nz: 0 }, _cn = { v: null }, _cq = [];
export function camBlocked(track, x, z, y, near = true, m = 1.0, yRef = y) {
  if (!track) return false;
  if (track.map && track.map.solidAt(x, z, y, m, yRef)) return true; // teto: a camera nunca fica acima dele
  if (!near) return false;
  const sc = track.scenery;
  if (sc && sc.query) {
    for (const c of sc.query(x, z, m + 6, _cq)) {
      if (Math.hypot(c.x - x, c.z - z) < c.r + m && y < (c.top ?? 99) + m) return true;
    }
  }
  if (track.map) return track.map.nearestWall(x, z, y, 0.7, _cw) < 0.7;
  if (track.nearest && track.hardWall) { // pistas de curva: muro nas bordas (baixo, a camera passa por cima)
    const n = _cn.v || (_cn.v = track.newNear());
    track.nearest(x, z, -1, n);
    const g = track.elevAt ? track.elevAt(n.s) : 0;
    if (y < g + 4 && track.hardWall(n.idx, n.d) && Math.abs(n.d) > track.edgeAt(n.idx) - m) return true;
  }
  return false;
}

/**
 * Maior fracao (minF..1) do caminho (x0,y0,z0) -> (x1,y1,z1) em que a camera fica livre. Parede cruzada no caminho, objeto,
 * teto e piso 3D bloqueiam. Perto do alvo (primeiros pontos) so conta teto/piso 3D: o carro encostado numa parede nao cola a camera nele.
 */
export function camFrac(track, x0, y0, z0, x1, y1, z1, minF = 0.05, N = 12) {
  if (!track) return 1;
  let px = x0, pz = z0;
  for (let i = 1; i <= N; i++) {
    const f = i / N, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f, y = y0 + (y1 - y0) * f;
    const crossed = i > 2 && track.map && track.map.segmentWalled(px, pz, x, z);
    if (crossed || camBlocked(track, x, z, y, i > 2, 1.0, y0)) return Math.max(minF, (i - 1) / N - 0.04);
    px = x; pz = z;
  }
  return 1;
}

export function projectWith(cx, cy, cz, yaw, aspect, px, py, pz, out) {
  const cp = Math.cos(CAMERA.pitch), sp = Math.sin(CAMERA.pitch);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  // base: frente f, direita r (horizontal), cima u = r x f
  const fx = cyw * cp, fy = -sp, fz = syw * cp;
  const rx = -syw, rz = cyw;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  const d = dx * fx + dy * fy + dz * fz;
  out.d = d;
  if (d <= 1e-6) { out.nx = 0; out.ny = -9; return out; }
  const T = tanHalf();
  out.nx = (dx * rx + dz * rz) / d / (T * aspect);
  out.ny = (dx * ux + dy * uy + dz * uz) / d / T;
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Camera de kart (estilo SRB2Kart), um por jogador na tela dividida. Segue o RUMO do kart, atras e acima dele,
// olhando um pouco a frente. Valores do SRB2Kart v1.6 (p_user.c: P_MoveChaseCamera) em unidades do jogo
// original (kart de raio 16); `scale` converte para o nosso mundo (carro de ~3,3 u). Os filtros do original
// sao por tic (35 Hz): k = -ln(1 - alfa) * 35 por segundo (yaw 0,4; z 0,2; pitch 0,125; pan 0,1).
// So afeta o que se ve: as regras (corte de carros) continuam na ChaseCamera compartilhada.
export const KART_CAM = {
  scale: 0.1,
  dist: 160, // atras do kart
  height: 82, // acima do chao do kart (32 + 50)
  lookAhead: 64, // o ponto de mira fica a frente do kart
  lookZ: 48, // e a esta altura
  fovH: 90, // FOV horizontal em graus
  fov2P: 1.7, // 2 jogadores (celula larga e baixa): alarga o FOV horizontal (tan x 1,7)
  fovMin: 38, fovMax: 85, // limites do FOV vertical
  kYaw: 17.9, kZ: 7.8, kPitch: 4.7, kPan: 3.7,
  panMax: 0.2, // fracao da distancia
  panSlip: 8, // u/s de derrapagem lateral que da o pan maximo
  boostPull: 11 / 16, // com nitro a camera se aproxima ate esta fracao da distancia
  boostIn: 4.4, boostOut: 1, // 1/s (o original: +1/8 por tic para entrar, -1/35 por tic para sair)
  overspeed: 0.029, // fracao da distancia somada por u/s acima da velocidade de cruzeiro (nitro = +52%)
};

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

/** FOV vertical (graus) de uma celula de proporcao `aspect` com `n` celulas na tela. */
export function kartFovV(aspect, n = 1) {
  const t = (Math.tan((KART_CAM.fovH * RAD) / 2) * (n === 2 ? KART_CAM.fov2P : 1)) / Math.max(0.2, aspect);
  return clampN((2 * Math.atan(t)) / RAD, KART_CAM.fovMin, KART_CAM.fovMax);
}

export class KartCamera {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0; // rumo da camera (rad; frente = (cos, sin) em x,z)
    this.pitch = 0.15; // para baixo (rad)
    this.pan = 0; this.boostCam = 0;
    this.vy = 0; // altura de render (y encolhida junto com a distancia)
    this.dFrac = 1; // fracao da distancia ate a camera (encolhe quando ha parede/objeto entre ela e o kart)
    this.ready = false;
  }

  /** Vetor da frente da camera (Three: x, y para cima, z). */
  forward(out = { x: 0, y: 0, z: 0 }) {
    const cp = Math.cos(this.pitch);
    out.x = Math.cos(this.yaw) * cp; out.y = -Math.sin(this.pitch); out.z = Math.sin(this.yaw) * cp;
    return out;
  }

  _place(car, dist) {
    const K = KART_CAM, s = K.scale, fx = Math.cos(this.yaw), fz = Math.sin(this.yaw), rx = -fz, rz = fx;
    this.x = car.x - fx * dist + rx * this.pan;
    this.z = car.z - fz * dist + rz * this.pan;
    return { lx: car.x + fx * K.lookAhead * s + rx * this.pan, lz: car.z + fz * K.lookAhead * s + rz * this.pan, ly: (car.y || 0) + K.lookZ * s };
  }

  /** Maior fracao (0.12..1) da distancia que mantem a camera e o caminho ate o kart livres de paredes, objetos e tetos. */
  _clearFrac(car, dist, track) {
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw), rx = -fz, rz = fx, y0 = (car.y || 0) + 1.2;
    return camFrac(track, car.x, y0, car.z, car.x - fx * dist + rx * this.pan, this.y, car.z - fz * dist + rz * this.pan);
  }

  /** Teletransporta para tras do carro (inicio, troca de alvo). */
  snap(car) {
    const K = KART_CAM, s = K.scale;
    this.yaw = car.h; this.pan = 0; this.boostCam = 0; this.dFrac = 1;
    this.y = this.vy = (car.y || 0) + K.height * s;
    const l = this._place(car, K.dist * s);
    this.pitch = Math.atan2(this.y - l.ly, Math.hypot(l.lx - this.x, l.lz - this.z));
    this.ready = true;
  }

  /**
   * Avanca dt segundos seguindo o carro. opts: top (velocidade de cruzeiro, u/s), lookBack (olhar para tras:
   * giro instantaneo de 180 graus).
   */
  update(dt, car, opts = {}) {
    if (!this.ready) this.snap(car);
    const K = KART_CAM, s = K.scale, top = opts.top ?? 42;
    const k = (r) => 1 - Math.exp(-r * dt);
    const target = car.h + (opts.lookBack ? Math.PI : 0);
    if (opts.lookBack) this.yaw = target;
    else this.yaw += wrap(target - this.yaw) * k(K.kYaw);

    const speed = car.speed ?? Math.hypot(car.vx || 0, car.vz || 0);
    const bt = car.boost > 0 ? 1 : 0;
    this.boostCam += (bt - this.boostCam) * k(bt > this.boostCam ? K.boostIn : K.boostOut);
    let dist = K.dist * s * (1 + K.overspeed * Math.max(0, speed - top));
    dist -= K.boostPull * dist * this.boostCam;

    // pan lateral para dentro da curva, a partir da derrapagem (velocidade lateral do carro)
    const lat = -(car.vx || 0) * Math.sin(car.h) + (car.vz || 0) * Math.cos(car.h);
    const panT = -clampN(lat / K.panSlip, -1, 1) * K.panMax * dist;
    this.pan += (panT - this.pan) * k(K.kPan);

    const zT = (car.y || 0) + K.height * s;
    this.y += (zT - this.y) * k(K.kZ);
    // parede/objeto entre o kart e a camera: aproxima na hora, volta devagar
    const fr = opts.track ? this._clearFrac(car, dist, opts.track) : 1;
    this.dFrac = fr < this.dFrac ? fr : this.dFrac + (fr - this.dFrac) * k(3);
    const l = this._place(car, dist * this.dFrac);
    this.vy = (car.y || 0) + 1.2 + (this.y - (car.y || 0) - 1.2) * this.dFrac; // altura de render: acompanha o encurtamento
    const aim = Math.atan2(this.vy - l.ly, Math.hypot(l.lx - this.x, l.lz - this.z));
    this.pitch += (aim - this.pitch) * k(K.kPitch);
  }
}

export class ChaseCamera {
  constructor(aspect = 16 / 9) {
    this.aspect = aspect;
    this.ax = 0; this.az = 0; this.ay = 0; this.yaw = 0; this.H = CAMERA.hMin + 4;
    this.tax = 0; this.taz = 0; this.tay = 0; this.tyaw = 0; this.tH = this.H; this.tHs = this.H;
    this.lvx = 0; this.lvz = 0; this.svx = 0; this.svz = 0; // velocidade do lider (filtrada) para compensar o atraso
    this.fast = 1; // multiplicador da suavizacao (last stand)
    this.shake = 0;
    this.t = 0;
    this.x = 0; this.y = 0; this.z = 0;
    this.track = null; // opcional: a camera de render desvia de paredes, objetos e tetos (`view`)
    this.vx = 0; this.vy = 0; this.vz = 0; this.vFrac = 1;
    this.place();
  }

  /** Posicao da camera a partir de ancora (ax,az), yaw, altura H acima do chao `ay`. */
  posFor(ax, az, yaw, H, out = {}, ay = 0) {
    const back = H * backPerH();
    out.x = ax - Math.cos(yaw) * back;
    out.z = az - Math.sin(yaw) * back;
    out.y = ay + H;
    return out;
  }
  place() {
    this.posFor(this.ax, this.az, this.yaw, this.H, this, this.ay);
  }

  /**
   * Posicao de RENDER da camera (vx,vy,vz): so visual, as regras (enquadramento, corte) usam x,y,z. Puxa a camera pela linha que a liga
   * ao ponto de mira ate nao haver parede, objeto nem teto no caminho (aproxima na hora, volta devagar).
   */
  view(dt = 0) {
    const t = this.track;
    if (!t) { this.vx = this.x; this.vy = this.y; this.vz = this.z; return; }
    const y0 = this.ay + 1.2;
    const fr = camFrac(t, this.ax, y0, this.az, this.x, this.y, this.z, 0.05);
    this.vFrac = fr < this.vFrac || dt <= 0 ? fr : this.vFrac + (fr - this.vFrac) * (1 - Math.exp(-3 * dt));
    const f = this.vFrac;
    this.vx = this.ax + (this.x - this.ax) * f; this.vz = this.az + (this.z - this.az) * f; this.vy = y0 + (this.y - y0) * f;
  }

  /** Projeta um ponto do mundo. nx,ny em [-1,1] quando visivel; d = profundidade (<=0: atras da camera). */
  project(px, py, pz, out = { nx: 0, ny: 0, d: 0 }) {
    return projectWith(this.x, this.y, this.z, this.yaw, this.aspect, px, py, pz, out);
  }

  /** Tremor suave (ruido continuo, sem sorteio por frame) a somar na posicao da camera. */
  shakeOffset(out = { x: 0, y: 0, z: 0 }) {
    const s = Math.min(this.shake, CAMERA.shakeMax), t = this.t;
    out.x = Math.sin(t * 41) * Math.sin(t * 17.3) * s * 0.45;
    out.y = Math.sin(t * 37.7 + 1) * Math.sin(t * 13.1) * s * 0.3;
    out.z = Math.sin(t * 29.3 + 2) * Math.sin(t * 19.7) * s * 0.45;
    return out;
  }

  /** Altura do chao sob o carro (tabuleiro da pista; 0 fora dele). */
  groundOf(c, track) {
    if (c.near && c.near.d !== undefined) return track.groundFromNear(c.near, this._g || (this._g = { y: 0, nx: 0, ny: 1, nz: 0 }), c.x, c.z).y;
    return track.elevAt(c.near ? c.near.s : track.wrapS(c.progress));
  }

  /**
   * Define o alvo a partir dos carros vivos. `track` fornece o rumo e o chao da pista. `must` (opcional, corrida): carros que a
   * camera nunca perde; os demais so entram no quadro enquanto couberem no zoom maximo (quem ficou longe demais e ignorado).
   */
  computeTarget(cars, track, must = null) {
    if (!cars.length) return;
    if (!(this.aspect > 0.3 && this.aspect < 10)) this.aspect = 16 / 9;
    const tmp = { x: 0, y: 0, z: 0 }, o = { nx: 0, ny: 0, d: 0 };
    // ancora = MEDIA de todos os carros (posicao, velocidade, chao e progresso), nao so o lider
    const anchor = (set) => {
      let ax = 0, az = 0, ay = 0, vx = 0, vz = 0, pr = 0;
      for (const c of set) {
        ax += c.x; az += c.z; ay += this.groundOf(c, track);
        vx += c.vx || 0; vz += c.vz || 0; pr += c.progress;
      }
      const n = set.length;
      this.tax = ax / n;
      this.taz = az / n;
      this.tay = ay / n;
      this.lvx = vx / n;
      this.lvz = vz / n;
      const p = track.pointAt(pr / n + CAMERA.yawLook);
      this.tyaw = Math.atan2(p.tz, p.tx);
    };
    // corrida: so entram na ancora os carros perto (em progresso) dos obrigatorios; assim quem se afasta sai aos poucos e a
    // ancora nunca salta do pelotao para o humano de uma vez (a suavizacao deixaria o humano fora do quadro por ~2 s)
    if (must && must.length) {
      const mp = must.reduce((a, c) => a + c.progress, 0) / must.length;
      cars = cars.filter((c) => must.includes(c) || Math.abs(c.progress - mp) <= CAMERA.packWindow);
    }
    let set = cars;
    // menor altura que mantem o ultimo carro (embaixo) e o primeiro (em cima) visiveis (busca binaria; monotonica)
    const fits = (H) => {
      this.posFor(this.tax, this.taz, this.tyaw, H, tmp, this.tay);
      for (const c of set) {
        projectWith(tmp.x, tmp.y, tmp.z, this.tyaw, this.aspect, c.x, (c.y || 0) + CAMERA.carY, c.z, o);
        const ny = o.d > 0.1 ? o.ny : -9;
        if (ny < CAMERA.rearNy || ny > CAMERA.topNy) return false;
        if (must && Math.abs(o.nx) > CAMERA.raceSideNx) return false; // corrida: ninguem e cortado, entao a lateral tambem precisa caber
      }
      return true;
    };
    anchor(set);
    if (must && must.length && !fits(CAMERA.hMax)) {
      // tira os mais distantes dos obrigatorios ate o resto caber no zoom maximo
      const mp = must.reduce((a, c) => a + c.progress, 0) / must.length;
      const rest = cars.filter((c) => !must.includes(c)).sort((a, b) => Math.abs(a.progress - mp) - Math.abs(b.progress - mp));
      while (rest.length) {
        set = [...must, ...rest]; anchor(set);
        if (fits(CAMERA.hMax)) break;
        rest.pop();
      }
      if (!rest.length) { set = must; anchor(set); }
    }
    let H;
    if (fits(CAMERA.hMin)) H = CAMERA.hMin;
    else if (!fits(CAMERA.hMax)) H = CAMERA.hMax;
    else {
      let lo = CAMERA.hMin, hi = CAMERA.hMax;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid; else lo = mid;
      }
      H = hi;
    }
    // zona morta: o alvo de altura so muda de verdade se passar de hDead (ou chegar nos limites); acaba com o "respirar"
    if (H <= CAMERA.hMin + 1e-6 || H >= CAMERA.hMax - 1e-6 || Math.abs(H - this.tHs) > CAMERA.hDead) this.tHs = H;
    this.tH = this.tHs;
  }

  /** Foco fechado em um carro (zoom do sobrevivente). */
  focus(car, track, H = 11) {
    this.tax = car.x; this.taz = car.z;
    this.tay = this.groundOf(car, track);
    this.lvx = this.lvz = 0;
    const p = track.pointAt((car.near ? car.near.s : track.wrapS(car.progress)) + CAMERA.yawLook);
    this.tyaw = Math.atan2(p.tz, p.tx);
    this.tH = this.tHs = H;
  }

  update(dt) {
    const f = this.fast;
    this.t += dt;
    const ka = 1 - Math.exp(-CAMERA.kAlong * f * dt);
    const kl = 1 - Math.exp(-CAMERA.kLat * f * dt);
    const ky = 1 - Math.exp(-CAMERA.kYaw * f * dt);
    const kg = 1 - Math.exp(-3 * f * dt); // o chao (rampas) e acompanhado devagar
    const kh = 1 - Math.exp(-(this.tH > this.H ? CAMERA.kHUp : CAMERA.kHDown) * f * dt);
    // velocidade do lider filtrada: compensa o atraso da suavizacao (so ao longo da pista) sem passar o ruido das batidas
    const kv = 1 - Math.exp(-6 * dt);
    this.svx += (this.lvx - this.svx) * kv;
    this.svz += (this.lvz - this.svz) * kv;
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);
    const ex = this.tax + (this.svx * CAMERA.lead) / CAMERA.kAlong - this.ax, ez = this.taz + (this.svz * CAMERA.lead) / CAMERA.kAlong - this.az;
    const ea = ex * fx + ez * fz, el = -ex * fz + ez * fx; // erro ao longo da pista e lateral
    const da = ea * ka, dl = el * kl;
    this.ax += fx * da - fz * dl;
    this.az += fz * da + fx * dl;
    this.ay += (this.tay - this.ay) * kg;
    let ey = wrap(this.tyaw - this.yaw);
    ey = Math.sign(ey) * Math.max(0, Math.abs(ey) - CAMERA.yawDead);
    this.yaw += ey * ky;
    this.H += (this.tH - this.H) * kh;
    this.shake = Math.min(this.shake, CAMERA.shakeMax) * Math.exp(-5 * dt);
    this.place();
    this.view(dt);
  }

  snap() {
    this.ax = this.tax + (this.lvx * CAMERA.lead) / CAMERA.kAlong; this.az = this.taz + (this.lvz * CAMERA.lead) / CAMERA.kAlong;
    this.svx = this.lvx; this.svz = this.lvz;
    this.ay = this.tay; this.yaw = this.tyaw; this.H = this.tH; this.tHs = this.tH;
    this.place();
    this.vFrac = 1; this.view(0);
  }

  /** Quao perto do corte esta o ponto (>1 = sera destruido). Pela frente nunca passa de 0. */
  edgeRatio(x, z, y = 0) {
    const o = this._o || (this._o = { nx: 0, ny: 0, d: 0 });
    this.project(x, y + CAMERA.carY, z, o);
    if (o.d <= 0.1) return 9;
    const rear = Math.max(0, o.ny / CAMERA.cutNy);
    const side = Math.abs(o.nx) / CAMERA.cutNx;
    return Math.max(rear, side);
  }

  /** O carro saiu do quadro por tras ou pelos lados? (nunca pela frente) */
  isCut(x, z, y = 0) { return this.edgeRatio(x, z, y) > 1; }
}
