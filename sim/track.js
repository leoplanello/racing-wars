import { buildTerrain } from './terrain.js';

// Pista: spline fechada amostrada uniformemente. Coordenadas: x para a direita, z para baixo (tela).
// Rumo h: frente = (cos h, sin h); aumentar h = virar para a direita. Normal "direita" = (-tz, tx).

// OFF1..OFF3 = fora de pista do SRB2Kart (forca 1-3: velocidade x0,5 / x0,33 / x0,25); ICE = gelo (so pistas de mapa)
export const SURF = { ASPHALT: 0, WOOD: 1, DIRT: 2, STONE: 3, OFF1: 4, OFF2: 5, OFF3: 6, ICE: 7, SAND: 8 };
// coeficiente de atrito por superficie (escala a aderencia dos pneus) e fator da velocidade de cruzeiro
export const SURF_MU = [1.0, 0.85, 0.85, 0.95, 0.7, 0.55, 0.45, 0.25, 0.8];
export const SURF_SPEED = [1, 0.98, 0.97, 1, 0.5, 0.34, 0.25, 1, 0.97];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

/**
 * def: { name, points:[[x,z]..], scale, halfWidth, verge, boundary:'wall'|'void',
 *        surfaces:[{from,to,type}] (fracao 0..1 da volta), boxGroups:[fracao..], theme }
 */
export function buildTrack(def, spacing = 1) {
  const sc = def.scale || 1;
  const pts = def.points.map(([x, z]) => [x * sc, z * sc]);
  const n = pts.length;
  // amostragem densa
  const dense = [];
  const denseAt = []; // indice denso de cada ponto de controle (para `def.profile`)
  for (let i = 0; i < n; i++) {
    denseAt.push(dense.length);
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(8, Math.ceil(chord * 4));
    for (let j = 0; j < k; j++) dense.push(catmull(p0, p1, p2, p3, j / k));
  }
  // comprimento acumulado e reamostragem uniforme
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1];
  const N = Math.round(total / spacing);
  const ds = total / N;
  const X = new Float64Array(N), Z = new Float64Array(N);
  let k = 0;
  for (let i = 0; i < N; i++) {
    const target = i * ds;
    while (cum[k + 1] < target) k++;
    const f = (target - cum[k]) / (cum[k + 1] - cum[k] || 1);
    const a = dense[k], b = dense[(k + 1) % dense.length];
    X[i] = a[0] + (b[0] - a[0]) * f;
    Z[i] = a[1] + (b[1] - a[1]) * f;
  }
  const TX = new Float64Array(N), TZ = new Float64Array(N), NX = new Float64Array(N), NZ = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    let tx = X[b] - X[a], tz = Z[b] - Z[a];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    TX[i] = tx; TZ[i] = tz; NX[i] = -tz; NZ[i] = tx;
  }
  const SURFACE = new Uint8Array(N).fill(def.baseSurface ?? 0);
  const BRIDGE = new Uint8Array(N);
  // marca um intervalo (fracao da volta); from > to significa que passa pela linha de largada
  const mark = (from, to, fn) => {
    const a = Math.floor(from * N);
    let b = Math.ceil(to * N);
    if (to < from) b += N;
    for (let i = a; i < b; i++) fn(((i % N) + N) % N);
  };
  for (const s of def.surfaces || []) mark(s.from, s.to, (i) => (SURFACE[i] = s.type));
  for (const b of def.bridges || []) mark(b.from, b.to, (i) => { BRIDGE[i] = 1; SURFACE[i] = 1; });
  // elevacao visual do tabuleiro (a fisica continua 2D): rampas suaves nas cabeceiras
  const deck = def.deckHeight ?? 1.6;
  const ramp = def.rampLength ?? 45;
  const ELEV = new Float32Array(N);
  if (def.bridges && def.bridges.length) {
    const dist = new Float64Array(N).fill(Infinity);
    for (let i = 0; i < N; i++) if (BRIDGE[i]) dist[i] = 0;
    for (let pass = 0; pass < 2 * N; pass++) {
      const i = pass % N, j = (i + 1) % N;
      dist[j] = Math.min(dist[j], dist[i] + ds);
    }
    for (let pass = 2 * N; pass > 0; pass--) {
      const i = pass % N, j = (i - 1 + N) % N;
      dist[j] = Math.min(dist[j], dist[i] + ds);
    }
    for (let i = 0; i < N; i++) {
      const t = Math.min(1, dist[i] / ramp);
      ELEV[i] = deck * (1 - t * t * (3 - 2 * t));
    }
  }
  // perfil de altura por ponto de controle (`profile: [[indice, altura], ...]`): linear ao longo da pista, suavizado (~30 u)
  if (def.profile && def.profile.length > 1) {
    const prof = def.profile.map(([ci, h]) => [cum[denseAt[ci]] * (N * ds) / total, h]); // s (comprimento reamostrado) de cada ponto
    const raw = new Float32Array(N).fill(-1);
    for (let i = 0; i < N; i++) {
      const sv = i * ds;
      if (sv < prof[0][0] || sv > prof[prof.length - 1][0]) continue;
      let q = 0;
      while (q < prof.length - 2 && sv > prof[q + 1][0]) q++;
      const [s0, h0] = prof[q], [s1, h1] = prof[q + 1];
      raw[i] = h0 + (h1 - h0) * ((sv - s0) / (s1 - s0 || 1));
    }
    const win = Math.max(1, Math.round(15 / ds));
    for (let i = 0; i < N; i++) {
      if (raw[i] < 0) continue;
      let a = 0, c = 0;
      for (let o = -win; o <= win; o++) { const v = raw[(i + o + N) % N]; if (v >= 0) { a += v; c++; } }
      ELEV[i] = Math.max(ELEV[i], a / c);
    }
  }
  // colinas/rampas: subida suave de `rise` unidades, topo plano e descida suave (`fall`) ou labio abrupto (fall = 0)
  const RAILS = new Uint8Array(N).fill(1);
  const HSKIN = new Uint8Array(N); // 1 = a colina e uma carreta (visual: chassi de aco, rodas)
  const smooth = (t) => t * t * (3 - 2 * t);
  const Ltot = N * ds;
  const BASEH = ELEV.slice(); // piso antes das colinas (`add: true` soma a altura da colina a ele: rampa sobre uma descida)
  for (const h of def.hills || []) {
    const rise = h.rise ?? 24, fall = h.fall ?? 24;
    const a = h.from * Ltot, flat = ((((h.to - h.from) % 1) + 1) % 1) * Ltot;
    const span = rise + flat + fall;
    for (let i = 0; i < N; i++) {
      const u = ((((i * ds - (a - rise)) % Ltot) + Ltot) % Ltot);
      if (u > span) continue;
      let k;
      if (u < rise) k = fall > 0 ? smooth(u / rise) : (u / rise) * (u / rise); // rampa de salto: curva que empina ate o labio
      else if (u < rise + flat) k = 1;
      else k = fall > 0 ? 1 - smooth((u - rise - flat) / fall) : 0;
      ELEV[i] = Math.max(ELEV[i], (h.add ? BASEH[i] : 0) + h.height * k);
      if (h.rails === false) RAILS[i] = 0;
      if (h.skin === 'truck' && k > 0.02) HSKIN[i] = 1;
      if (h.skin === 'viaduct' && k > 0.02) HSKIN[i] = 2;
    }
  }
  // precipicios: fosso fundo ao lado da pista (side: 1 direita, -1 esquerda, 0 os dois); sem cerca desse lado
  // `gap`: distancia entre a borda e o inicio do precipicio (praia); `water`: oceano (render com agua)
  const CH = new Int8Array(N), CHW = new Float32Array(N), CHG = new Float32Array(N).fill(0.3), CHWATER = new Uint8Array(N);
  for (const c of def.chasms || []) {
    const sv = c.side === 0 ? 2 : c.side === 1 ? 1 : -1;
    mark(c.from, c.to, (i) => { CH[i] = CH[i] && CH[i] !== sv ? 2 : sv; CHW[i] = Math.max(CHW[i], c.width ?? 60); CHG[i] = c.gap ?? 0.3; if (c.water) CHWATER[i] = 1; });
  }
  // paredes solidas por lado em terra aberta (`solidWalls`: {from,to,side}): ex.: a parede da montanha
  const SOLID = new Uint8Array(N);
  for (const z of def.solidWalls || []) {
    const bit = z.side === 0 || z.side === undefined ? 3 : z.side === 1 ? 2 : 1;
    mark(z.from, z.to, (i) => { SOLID[i] |= bit; });
  }
  const halfWidth = def.halfWidth ?? 10;
  const HW = new Float64Array(N).fill(halfWidth);
  // larguras por trecho (`widths`: {from,to,hw,blend}): transicao suave de `blend` unidades nas pontas
  for (const w of def.widths || []) {
    const blend = w.blend ?? 50;
    const a = w.from * Ltot, flat = ((((w.to - w.from) % 1) + 1) % 1) * Ltot;
    for (let i = 0; i < N; i++) {
      const u = ((((i * ds - a) % Ltot) + Ltot) % Ltot);
      const dd = u <= flat ? 0 : Math.min(u - flat, Ltot - u);
      const k = 1 - smooth(Math.min(1, dd / blend));
      if (k > 0) HW[i] += (w.hw - HW[i]) * k;
    }
  }
  // zonas abertas (`openZones`: {from,to,side}): sem muro nesse lado (praca, beco, brecha do guard-rail)
  const OPEN = new Uint8Array(N);
  for (const z of def.openZones || []) {
    const bit = z.side === 0 || z.side === undefined ? 3 : z.side === 1 ? 2 : 1;
    mark(z.from, z.to, (i) => { OPEN[i] |= bit; });
  }
  // estilo do muro por trecho (`walls`: {from,to,style}); padrao `wallStyle` da pista
  const WALLS = ['fence', 'building', 'jersey', 'none'];
  const WALL = new Uint8Array(N).fill(Math.max(0, WALLS.indexOf(def.wallStyle || 'fence')));
  for (const w of def.walls || []) mark(w.from, w.to, (i) => { WALL[i] = Math.max(0, WALLS.indexOf(w.style)); });

  const track = {
    def, name: def.name, N, ds, length: N * ds,
    X, Z, TX, TZ, NX, NZ, SURFACE, HW, BRIDGE, ELEV, RAILS, CH, CHW, CHG, CHWATER, SOLID, OPEN, WALL, HSKIN,
    halfWidth, verge: def.verge ?? 0, boundary: def.boundary || 'wall',
    theme: def.theme || {},
    newNear: () => ({ idx: -1, s: 0, d: 0, nx: 0, nz: 1, tx: 1, tz: 0, cx: 0, cz: 0, dist: 0 }),
    wrapS(s) { const L = this.length; return ((s % L) + L) % L; },
    idxAt(s) { return Math.floor(this.wrapS(s) / ds) % N; },
    hwAt(i) { return HW[i]; },
    /** Borda da faixa (largura + berma) no indice i. */
    edgeAt(i) { return HW[i] + this.verge; },
    /** Ponto da linha central em s (posicao + tangente). */
    pointAt(s, out = { x: 0, z: 0, tx: 1, tz: 0, nx: 0, nz: 1, idx: 0 }) {
      const w = this.wrapS(s);
      const i = Math.floor(w / ds) % N, j = (i + 1) % N;
      const f = w / ds - Math.floor(w / ds);
      out.x = X[i] + (X[j] - X[i]) * f;
      out.z = Z[i] + (Z[j] - Z[i]) * f;
      let tx = TX[i] + (TX[j] - TX[i]) * f, tz = TZ[i] + (TZ[j] - TZ[i]) * f;
      const l = Math.hypot(tx, tz) || 1;
      out.tx = tx / l; out.tz = tz / l; out.nx = -out.tz; out.nz = out.tx; out.idx = i;
      return out;
    },
    /** Ponto mais proximo da linha central. hint<0 = busca global. Preenche e retorna `out`. */
    nearest(x, z, hint, out) {
      let best = Infinity, bi = 0;
      if (hint < 0) {
        for (let i = 0; i < N; i++) {
          const dx = x - X[i], dz = z - Z[i], d2 = dx * dx + dz * dz;
          if (d2 < best) { best = d2; bi = i; }
        }
      } else {
        const W = 40;
        for (let o = -W; o <= W; o++) {
          const i = (hint + o + N) % N;
          const dx = x - X[i], dz = z - Z[i], d2 = dx * dx + dz * dz;
          if (d2 < best) { best = d2; bi = i; }
        }
      }
      // refina na projecao sobre os dois segmentos vizinhos
      let bd = Infinity, bs = 0, bcx = 0, bcz = 0, bnx = 0, bnz = 0, btx = 1, btz = 0;
      for (let o = -1; o <= 0; o++) {
        const a = (bi + o + N) % N, b = (a + 1) % N;
        const ex = X[b] - X[a], ez = Z[b] - Z[a];
        const t = Math.max(0, Math.min(1, ((x - X[a]) * ex + (z - Z[a]) * ez) / (ex * ex + ez * ez || 1)));
        const cx = X[a] + ex * t, cz = Z[a] + ez * t;
        const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
        if (d2 < bd) {
          bd = d2; bcx = cx; bcz = cz;
          const l = Math.hypot(ex, ez) || 1;
          btx = ex / l; btz = ez / l; bnx = -btz; bnz = btx;
          bs = (a + t) * ds;
        }
      }
      out.idx = bi;
      out.s = bs % this.length;
      out.cx = bcx; out.cz = bcz; out.tx = btx; out.tz = btz; out.nx = bnx; out.nz = bnz;
      out.d = (x - bcx) * bnx + (z - bcz) * bnz;
      out.dist = Math.sqrt(bd);
      return out;
    },
    surfaceAt(idx) { return SURFACE[idx]; },
    /** Altura visual do tabuleiro em s (interpolada). */
    elevAt(s) {
      const w = this.wrapS(s) / ds;
      const i = Math.floor(w) % N, j = (i + 1) % N, f = w - Math.floor(w);
      return ELEV[i] + (ELEV[j] - ELEV[i]) * f;
    },
    /** Declive do tabuleiro (altura por unidade de s) em s. */
    slopeAt(s) { return (this.elevAt(s + 0.75) - this.elevAt(s - 0.75)) / 1.5; },
    /**
     * Chao sob (x,z): tabuleiro (ELEV) dentro da faixa da pista, terreno (0) fora dela.
     * `out` = {y, nx, ny, nz} (normal da superficie). `hint` = indice proximo da pista (ou -1).
     */
    groundAt(x, z, hint, out = { y: 0, nx: 0, ny: 1, nz: 0 }) {
      const nr = this._gn || (this._gn = this.newNear());
      this.nearest(x, z, hint ?? -1, nr);
      return this.groundFromNear(nr, out, x, z);
    },
    /** Igual a groundAt, mas a partir de um `near` ja calculado. */
    groundFromNear(nr, out, x, z) {
      if (Math.abs(nr.d) > HW[nr.idx] + this.verge && this.terrain && x !== undefined && this.terrain.contains(x, z)) {
        // fora da estrada: relevo da montanha (so pistas com `def.terrain`)
        out.y = this.terrain.heightAt(x, z);
        this.terrain.normalAt(x, z, out);
      } else if (Math.abs(nr.d) <= HW[nr.idx] + this.verge) {
        out.y = this.elevAt(nr.s);
        const e = this.slopeAt(nr.s);
        const l = Math.hypot(e, 1);
        out.nx = (-e * nr.tx) / l; out.nz = (-e * nr.tz) / l; out.ny = 1 / l;
      } else {
        out.y = 0; out.nx = 0; out.ny = 1; out.nz = 0;
      }
      return out;
    },
    /**
     * Falesia: um ponto (x,z) com altura y abaixo do tabuleiro e a menos de `R` da borda dele bate na lateral
     * da area alta. Devolve true e preenche out = {pen, nx, nz} (normal do ponto para o obstaculo).
     */
    cliffAt(x, z, y, R, hint, out) {
      const nr = this._cn || (this._cn = this.newNear());
      this.nearest(x, z, hint ?? -1, nr);
      const lim = HW[nr.idx] + this.verge + R, ad = Math.abs(nr.d);
      if (ad >= lim || ELEV[nr.idx] - y <= 0.7) return false;
      const sg = nr.d >= 0 ? 1 : -1;
      out.pen = lim - ad; out.nx = -sg * nr.nx; out.nz = -sg * nr.nz;
      return true;
    },
    /** O ponto (dado seu `near`) esta dentro de um precipicio ao lado da pista? */
    chasmAt(near) {
      const c = CH[near.idx];
      if (!c) return false;
      const side = near.d > 0 ? 1 : -1;
      if (c !== 2 && c !== side) return false;
      const a = Math.abs(near.d), edge = HW[near.idx] + this.verge;
      return a > edge + CHG[near.idx] && a < edge + CHW[near.idx];
    },
    hasChasm: CH.some((v) => v !== 0),
    /** (x,z) cai dentro de algum precipicio? (busca global; so para cenario) */
    chasmContains(x, z) {
      if (!this.hasChasm) return false;
      return this.chasmAt(this.nearest(x, z, -1, this._cc || (this._cc = this.newNear())));
    },
    /** A pista tem trechos acima do chao (rampas, plateau, ponte)? */
    hasElev: ELEV.some((v) => v > 0.05),
    wallStyle(i) { return BRIDGE[i] ? 'truss' : WALLS[WALL[i]]; },
    /**
     * Muro solido neste ponto? Em pistas com `openLand`, so a ponte tem muro; em terra da para sair.
     * Nas `openZones` o lado aberto (d>=0 direita) nao tem muro.
     */
    hardWall(i, d = 0) {
      if (def.openLand) return BRIDGE[i] === 1 || (SOLID[i] & (d >= 0 ? 2 : 1)) !== 0;
      const o = OPEN[i];
      if (!o) return true;
      return !(o & (d >= 0 ? 2 : 1));
    },
    hasSolid: SOLID.some((v) => v !== 0),
    /** (x,z) cai na encosta da parede solida (`solidWalls`, ate `reach` alem da borda)? So para cenario. */
    inSolidZone(x, z, reach = 150) {
      if (!this.hasSolid) return false;
      const nr = this.nearest(x, z, -1, this._sz || (this._sz = this.newNear()));
      return (SOLID[nr.idx] & (nr.d >= 0 ? 2 : 1)) !== 0 && Math.abs(nr.d) < HW[nr.idx] + this.verge + reach;
    },
    /** Ha pista com superficie `type` a menos de `reach` de (x,z)? (so para cenario) */
    nearSurface(x, z, type, reach = 140) {
      const cache = this._sl || (this._sl = {});
      let list = cache[type];
      if (!list) { list = []; for (let i = 0; i < N; i += 4) if (SURFACE[i] === type) list.push(i); cache[type] = list; }
      for (const i of list) {
        const dx = x - X[i], dz = z - Z[i];
        if (dx * dx + dz * dz < reach * reach) return true;
      }
      return false;
    },
    /** A pista tem `openZones`? */
    hasOpen: OPEN.some((v) => v !== 0),
    riverHalf: def.riverHalf ?? 34,
    /** O ponto (dado seu `near`) esta dentro do rio ao lado da ponte? */
    inWater(near) {
      return def.openLand && BRIDGE[near.idx] === 1 && Math.abs(near.d) > HW[near.idx] + this.verge + 0.5 && Math.abs(near.d) < (def.riverHalf ?? 34);
    },
    /** Menor raio de curvatura (unidades) — usado nos testes. */
    minRadius() {
      let m = Infinity;
      for (let i = 0; i < N; i++) {
        const j = (i + 3) % N;
        const dot = Math.max(-1, Math.min(1, TX[i] * TX[j] + TZ[i] * TZ[j]));
        const ang = Math.acos(dot);
        if (ang > 1e-4) m = Math.min(m, (3 * ds) / ang);
      }
      return m;
    },
  };
  track.terrain = buildTerrain(track);
  return track;
}
