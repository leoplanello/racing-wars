// Cenario solido determinístico: arvores, pedras e casas viram colisores circulares.
// Usado pela simulacao (colisao) e pelo render (posicoes), entao os dois sempre concordam.
import { makeRng } from './rng.js';

const CELL = 24;

/**
 * Props urbanos (Downtown). Cada tipo: raio do colisor (r), altura (top), comportamento:
 *  knock (tomba/quebra ao toque, tira `soft` da velocidade), solid (obstaculo), blast (poderes derrubam),
 *  immune (nada derruba), explosive (bomba de combustivel: explode e queima ate o fim da partida).
 * `circles`: deslocamentos ao longo do rumo para colisores em fila (ponto de onibus).
 */
export const PROPS = {
  lamp: { r: 0.4, top: 9, solid: true, blast: true },
  light: { r: 0.5, top: 7, solid: true, blast: true }, // semaforo
  sign: { r: 0.35, top: 3, knock: true, soft: 0.08 }, // placa de pare
  hydrant: { r: 0.55, top: 1.1, knock: true, soft: 0.2 },
  cone: { r: 0.5, top: 1, knock: true, soft: 0.04 },
  busstop: { r: 1.3, top: 3.4, knock: true, soft: 0.14, circles: [-2.2, 0, 2.2] },
  pump: { r: 1.15, top: 3, explosive: true },
  pillar: { r: 0.8, top: 9, solid: true, immune: true },
  crate: { r: 1.3, top: 2.6, solid: true, blast: true }, // caixote/lixeira grande
  bldg: { r: 4.6, top: 40, solid: true, immune: true }, // trecho de predio (cadeia de circulos)
  fountain: { r: 2.7, top: 2.4, solid: true, immune: true }, // fonte da praca
};
/** Bomba de combustivel: raio da explosao que mata carros, alcance da reacao em cadeia, atraso e velocidade minima do toque. */
export const PUMP = { radius: 9, chain: 7, fuse: 0.16, first: 0.04, minSpeed: 4 };

export function buildScenery(track, seed = 99) {
  const rng = makeRng(seed);
  const { N, X, Z } = track;
  let maxHW = 0;
  for (let i = 0; i < track.N; i++) maxHW = Math.max(maxHW, track.HW[i]);
  const edge = maxHW + track.verge;

  // hash espacial das amostras da pista
  const grid = new Map();
  const key = (cx, cz) => (cx * 73856093) ^ (cz * 19349663);
  for (let i = 0; i < N; i += 2) {
    const k = key(Math.floor(X[i] / CELL), Math.floor(Z[i] / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const dist = (x, z, onlyBridge = false) => {
    let m = Infinity;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const l = grid.get(key(cx + a, cz + b));
      if (!l) continue;
      for (const i of l) {
        if (onlyBridge && !track.BRIDGE[i]) continue;
        m = Math.min(m, Math.hypot(x - X[i], z - Z[i]));
      }
    }
    return m;
  };
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < N; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); z0 = Math.min(z0, Z[i]); z1 = Math.max(z1, Z[i]); }
  const pad = 150;
  const river = track.riverHalf ?? 34;
  const hasBridge = track.BRIDGE.some((v) => v);
  const clear = edge + 9;
  const spots = (n, minD, maxD = Infinity) => {
    const out = [];
    let guard = n * 60;
    while (out.length < n && guard-- > 0) {
      const x = x0 - pad + rng() * (x1 - x0 + pad * 2), z = z0 - pad + rng() * (z1 - z0 + pad * 2);
      const d = dist(x, z);
      if (d < clear + minD || d > maxD) continue;
      if (hasBridge && dist(x, z, true) < river + 4) continue;
      if (track.chasmContains(x, z) || track.inSolidZone?.(x, z) || (track.terrain && !track.terrain.sceneryOk(x, z))) continue; // nada no precipicio, na encosta, na agua nem em encostas ingremes
      out.push([x, z]);
    }
    return out;
  };

  const cnt = track.def.scenery || {}; // quantidades editaveis (debug)
  // sem arvores colisoras na praia (la so palmeiras, so visuais)
  const trees = spots(cnt.trees ?? 300, 2).filter(([x, z]) => !track.nearSurface(x, z, 8, 260)).map(([x, z]) => {
    const s = 0.8 + rng() * 1.1;
    return { x, z, y: track.terrain ? track.terrain.heightAt(x, z) : 0, s, yaw: rng() * 6.28, sy: s * (0.9 + rng() * 0.4), hue: rng(), light: rng(), r: 1.15 * s };
  });
  const rocks = spots(cnt.rocks ?? 90, -3).map(([x, z]) => {
    const s = 0.5 + rng() * 1.6;
    return { x, z, y: track.terrain ? track.terrain.heightAt(x, z) : 0, s, yaw: rng() * 6, tone: rng(), r: 1.5 * s };
  });
  const houses = spots(cnt.houses ?? 22, 14, edge + 110).map(([x, z]) => ({
    x, z, yaw: Math.floor(rng() * 4) * (Math.PI / 2), brick: rng() < 0.5, hue: rng(),
  }));

  // props urbanos: lista a partir de regras (`def.props`) e de objetos com posicao na pista ({type, at:[fracao, deslocamento]})
  const props = [];
  const addProp = (type, x, z, yaw, extra = {}) => {
    const spec = PROPS[type];
    if (!spec) return;
    const p = { type, x, z, yaw, idx: props.length, dead: false, burnt: false, lit: false, fuse: 0, cols: [], y: extra.y ?? 0, ...extra };
    props.push(p);
    return p;
  };
  const L = track.length;
  const edgeAt = (k) => track.HW[k] + track.verge;
  for (const rule of track.def.props || []) {
    // regra: {type, every, from, to, side: -1|1|0 (dois lados, alternando), at: deslocamento da faixa (padrao: sobre a calcada)}
    const a = (rule.from ?? 0) * L, b = ((rule.to ?? 1) <= (rule.from ?? 0) ? (rule.to ?? 1) + 1 : (rule.to ?? 1)) * L;
    let n = 0;
    for (let q = a; q < b; q += rule.every) {
      const pt = track.pointAt(q);
      const sides = rule.side === 0 || rule.side === undefined ? [n % 2 ? 1 : -1] : [rule.side];
      for (const sg of sides) {
        if (track.OPEN[pt.idx] & (sg > 0 ? 2 : 1) && !rule.inOpen) continue;
        const d = rule.d !== undefined ? rule.d * sg : (edgeAt(pt.idx) - (rule.inset ?? 0.7)) * sg;
        addProp(rule.type, pt.x + pt.nx * d, pt.z + pt.nz * d, Math.atan2(pt.tz, pt.tx) + (sg > 0 ? Math.PI : 0) + (rule.yaw ?? 0), { y: Math.abs(d) <= edgeAt(pt.idx) ? track.elevAt(q) : 0 });
      }
      n++;
    }
  }
  for (let o of track.def.objects || []) {
    if (!PROPS[o.type]) continue;
    if (o.at) {
      const pt = track.pointAt(o.at[0] * L);
      // deslocamento 'R'/'L' = sobre a calcada da direita/esquerda (borda menos `inset`), seguindo a largura do trecho
      if (o.at[1] === 'R' || o.at[1] === 'L') o = { ...o, at: [o.at[0], (o.at[1] === 'R' ? 1 : -1) * (edgeAt(pt.idx) - (o.inset ?? 0.8))] };
      addProp(o.type, pt.x + pt.nx * o.at[1], pt.z + pt.nz * o.at[1], Math.atan2(pt.tz, pt.tx) + (o.at[1] > 0 ? Math.PI : 0) + (o.yaw ?? 0), { y: o.y ?? (Math.abs(o.at[1]) <= edgeAt(pt.idx) ? track.elevAt(o.at[0] * L) : 0), text: o.text, h: o.h, render: o.render });
    } else {
      addProp(o.type, o.x * (track.def.scale || 1), o.z * (track.def.scale || 1), o.yaw ?? 0, { y: o.y ?? 0, text: o.text, h: o.h, render: o.render });
    }
  }
  // objetos colocados a mao no editor de mapa: def.objects = [{type:'tree'|'rock'|'house', x, z, yaw?, s?}]
  for (const o of track.def.objects || []) {
    if (PROPS[o.type]) continue;
    const x = o.x * (track.def.scale || 1), z = o.z * (track.def.scale || 1), yaw = o.yaw ?? 0, s = o.s ?? 1;
    if (o.type === 'tree') trees.push({ x, z, s, yaw, sy: s, hue: rng(), light: rng(), r: 1.15 * s });
    else if (o.type === 'rock') rocks.push({ x, z, s, yaw, tone: rng(), r: 1.5 * s });
    else if (o.type === 'house') houses.push({ x, z, yaw, brick: o.brick ?? rng() < 0.5, hue: rng() });
  }

  // colisores (circulos) + grade para consulta rapida
  const colliders = [];
  // dead: arvore/pedra destruida por um poder (some do cenario); idx = indice no array do render
  trees.forEach((t, idx) => { t.dead = false; colliders.push({ x: t.x, z: t.z, r: t.r, kind: 'tree', top: (t.y || 0) + 6 * t.sy, idx, ref: t, dead: false }); });
  rocks.forEach((r, idx) => { r.dead = false; colliders.push({ x: r.x, z: r.z, r: r.r, kind: 'rock', top: (r.y || 0) + 2.2 * r.s, idx, ref: r, dead: false }); });
  houses.forEach((h, idx) => {
    h.frozen = false;
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    for (const off of [-3.2, 0, 3.2]) colliders.push({ x: h.x + c * off, z: h.z + s * off, r: 4.6, kind: 'house', top: 9, idx, ref: h, dead: false });
  });
  for (const p of props) {
    const spec = PROPS[p.type];
    const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    for (const off of spec.circles || [0]) {
      const col = { x: p.x + c * off, z: p.z + sn * off, r: spec.r, kind: p.type, top: p.y + spec.top, idx: p.idx, ref: p, dead: false, beh: spec, prop: true };
      colliders.push(col);
      p.cols.push(col);
    }
  }
  const pumps = props.filter((p) => p.type === 'pump');
  /** Acende uma bomba (fuse = atraso ate explodir). */
  const ignite = (p, fuse) => {
    if (p.burnt || p.lit) return false;
    p.lit = true; p.fuse = fuse;
    return true;
  };
  const cgrid = new Map();
  const CC = 16;
  colliders.forEach((c, i) => {
    const k = key(Math.floor(c.x / CC), Math.floor(c.z / CC));
    if (!cgrid.has(k)) cgrid.set(k, []);
    cgrid.get(k).push(i);
  });

  return {
    trees, rocks, houses, props, pumps, ignite, colliders, dist,
    /** Colisores num raio em torno de (x,z). */
    query(x, z, r, out = []) {
      out.length = 0;
      const cx = Math.floor(x / CC), cz = Math.floor(z / CC);
      const n = Math.ceil((r + 6) / CC);
      for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
        const l = cgrid.get(key(cx + a, cz + b));
        if (l) for (const i of l) if (!colliders[i].dead) out.push(colliders[i]);
      }
      return out;
    },
    /** Poder que acerta (x,z) com raio r: destroi arvores e pedras (casas resistem). Retorna os destruidos [{kind, idx, x, z}]. */
    blast(x, z, r) {
      const hit = [];
      for (const c of colliders) {
        if (c.dead || c.kind === 'house' || (c.beh && c.beh.immune)) continue;
        if (Math.hypot(c.x - x, c.z - z) > r + c.r) continue;
        if (c.beh && c.beh.explosive) { ignite(c.ref, PUMP.fuse); continue; } // poderes acendem as bombas
        c.dead = c.ref.dead = true;
        hit.push({ kind: c.kind, idx: c.idx, x: c.x, z: c.z, h: c.top });
      }
      return hit;
    },
    /** Gelo: marca casas/arvores/pedras no raio como congeladas (so visual). Retorna os alvos novos. */
    freeze(x, z, r) {
      const hit = [];
      for (const c of colliders) {
        if (c.dead || c.ref.frozen) continue;
        if (Math.hypot(c.x - x, c.z - z) > r + c.r) continue;
        c.ref.frozen = true;
        hit.push({ kind: c.kind, idx: c.idx, x: c.x, z: c.z });
      }
      return hit;
    },
    /** Nova corrida: tudo volta ao lugar. */
    restore() {
      for (const c of colliders) {
        if (c.ref.lit && !c.ref.burnt) { c.ref.burnt = true; c.ref.lit = false; c.ref.dead = c.dead = true; continue; } // cadeia interrompida pelo fim da rodada: queima de vez
        if (c.ref.burnt) continue; // bomba queimada: fica assim ate o fim da partida
        c.dead = false; c.ref.dead = false; c.ref.frozen = false;
        if (c.ref.lit) { c.ref.lit = false; c.ref.fuse = 0; }
      }
    },
  };
}
