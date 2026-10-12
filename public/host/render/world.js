// Mundo 3D: ponte/estrada com texturas, rio, muros por trecho, largada e cenario (tudo procedural).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '/sim/rng.js';
import { buildScenery } from '/sim/scenery.js';
import { gridSlot } from '/sim/game.js';
import * as TX from './textures.js';
import { buildStartGantry } from './models.js';
import { buildCity } from './city.js';
import { PropsView } from './props.js';
import { buildStructures } from './structures.js';
import { buildTerrainView, GROUND_COLOR } from './terrain.js';
import { makeWaterMaterial } from './water.js';
import { buildDetails } from './details.js';
import { PROPS } from '/sim/scenery.js';

const RIVER_HALF = 34; // meia-largura do rio em volta da ponte
const WATER_Y = -1.1;
const BK_CELL = 10;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const ICE_TINT = new THREE.Color(0x9fdcff);

const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), eu = new THREE.Euler(), ps = new THREE.Vector3(), sc = new THREE.Vector3();

function matrix(x, y, z, yaw, sx, sy, sz, roll = 0) {
  eu.set(0, -yaw, roll, 'YXZ');
  qt.setFromEuler(eu);
  return m4.compose(ps.set(x, y, z), qt, sc.set(sx, sy, sz)).clone();
}

function instanced(geo, mat, mats, { cast = true, receive = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  im.count = mats.length;
  im.castShadow = cast;
  im.receiveShadow = receive;
  im.instanceMatrix.needsUpdate = true;
  return im;
}

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

/**
 * opts.fast: reconstrucao rapida para o editor (so pista, cercas, portico): nao gera o cenario decorativo
 * (arvores, casas, montanhas...). O decor fica num grupo `userData.decor` que o editor reaproveita.
 */
export function buildWorld(track, quality = 'high', opts = {}) {
  const fast = !!opts.fast;
  const low = quality === 'low';
  const group = new THREE.Group();
  const decor = new THREE.Group();
  decor.userData.decor = true;
  if (!fast) group.add(decor);
  const rng = makeRng(99);
  if (!track.scenery && !fast) track.scenery = buildScenery(track);
  const breakables = []; // trechos de cerca que quebram quando um carro passa
  const meshes = {};
  const { N, X, Z, TX: TXs, TZ: TZs, NX, NZ, ELEV, BRIDGE, SURFACE } = track;
  const HWa = track.HW, vg = track.verge;
  const hw = track.halfWidth, edge = hw + vg; // largura-base (largada)
  const HWf = (k) => HWa[k % N], EDGEf = (k) => HWa[k % N] + vg;
  const theme = track.theme || {};
  const city = theme.kind === 'city';
  const mountain = theme.kind === 'mountain';
  const useTerrain = !!track.terrain;
  let maxHW = 0;
  for (let i = 0; i < N; i++) maxHW = Math.max(maxHW, HWa[i]);
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (let i = 0; i < N; i++) { bx0 = Math.min(bx0, X[i]); bx1 = Math.max(bx1, X[i]); bz0 = Math.min(bz0, Z[i]); bz1 = Math.max(bz1, Z[i]); }
  const GROUND_R = Math.max(1400, Math.max(bx1 - bx0, bz1 - bz0) / 2 + 800); // o chao cobre pistas grandes
  const L = track.length, ds = track.ds;

  // ------------------------------------------------------------ materiais
  const rep = (t, x, y) => { t.repeat.set(x, y); return t; };
  const M = {
    wood: new THREE.MeshStandardMaterial({ map: TX.woodTexture(), roughness: 0.85 }),
    asphalt: new THREE.MeshStandardMaterial({ map: TX.asphaltTexture(), roughness: 0.92 }),
    dirt: new THREE.MeshStandardMaterial({ map: TX.dirtTexture(), roughness: 1 }),
    cobble: new THREE.MeshStandardMaterial({ map: TX.cobbleTexture(), roughness: 0.9 }),
    sand: new THREE.MeshStandardMaterial({ map: TX.sandTexture(), roughness: 1 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x1a1d26, roughness: 0.45, metalness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ map: TX.steelTexture(), roughness: 0.5, metalness: 0.4 }),
    logs: new THREE.MeshStandardMaterial({ map: TX.woodTexture(), roughness: 0.9, color: 0xd9b48a }),
    verge: new THREE.MeshStandardMaterial({ map: city ? TX.sidewalkTexture() : TX.dirtTexture(), roughness: 1, side: THREE.DoubleSide }),
    paint: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  const skirtDirt = new THREE.MeshStandardMaterial({ map: TX.dirtTexture(), roughness: 1, side: THREE.DoubleSide });
  for (const k of ['wood', 'asphalt', 'dirt', 'cobble', 'sand', 'logs']) M[k].side = THREE.DoubleSide;

  // ------------------------------------------------------------ faixas (pista)
  const HSK = track.HSKIN;
  const classOf = (i) => (BRIDGE[i] ? 'wood' : HSK[i] === 1 ? 'steel' : SURFACE[i] === 8 ? 'sand' : SURFACE[i] === 3 ? 'cobble' : SURFACE[i] === 2 ? 'dirt' : SURFACE[i] === 1 ? 'wood' : 'asphalt');
  const runs = [];
  {
    let s = 0;
    for (let i = 1; i <= N; i++) if (i === N || classOf(i) !== classOf(s)) { runs.push({ cls: classOf(s), a: s, b: i }); s = i; }
  }

  function strip(a, b, o0, o1, yOff, uSc, vSc, step = 1, abs = false) {
    const pos = [], uv = [], idx = [];
    const list = [];
    for (let i = a; i < b; i += step) list.push(i);
    list.push(b);
    let vi = 0;
    for (const i of list) {
      const k = i % N;
      const y = (abs ? 0 : ELEV[k]) + yOff;
      const v = (i * ds) / vSc;
      const p0 = typeof o0 === 'function' ? o0(k) : o0, p1 = typeof o1 === 'function' ? o1(k) : o1;
      pos.push(X[k] + NX[k] * p0, y, Z[k] + NZ[k] * p0, X[k] + NX[k] * p1, y, Z[k] + NZ[k] * p1);
      uv.push(p0 / uSc, v, p1 / uSc, v);
      if (vi > 0) idx.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi);
      vi += 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    return g;
  }
  const add = (geo, mat, { receive = true, cast = false } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = receive;
    m.castShadow = cast;
    group.add(m);
    return m;
  };

  for (const r of runs) {
    const half = (r.cls === 'wood' && BRIDGE[r.a]) || r.cls === 'steel' ? EDGEf : HWf;
    add(strip(r.a, r.b, (k) => -half(k), half, 0.02, r.cls === 'dirt' || r.cls === 'sand' ? 12.8 : r.cls === 'cobble' ? 12.8 : 6.4, r.cls === 'cobble' ? 12.8 : 6.4), M[r.cls]);
    if ((r.cls !== 'wood' || !BRIDGE[r.a]) && r.cls !== 'steel') {
      // berma de pedra entre a pista e o muro
      add(strip(r.a, r.b, HWf, EDGEf, 0.01, 12.8, 6.4), r.cls === 'sand' ? M.sand : M.verge);
      add(strip(r.a, r.b, (k) => -EDGEf(k), (k) => -HWf(k), 0.01, 12.8, 6.4), r.cls === 'sand' ? M.sand : M.verge);
    }
    // linhas laterais brancas (a estrada de terra nao tem)
    if (r.cls === 'dirt' || r.cls === 'steel' || r.cls === 'sand') continue;
    add(strip(r.a, r.b, (k) => HWf(k) - 1.3, (k) => HWf(k) - 0.8, 0.06, 1, 1, 2), M.paint, { receive: false });
    add(strip(r.a, r.b, (k) => -HWf(k) + 0.8, (k) => -HWf(k) + 1.3, 0.06, 1, 1, 2), M.paint, { receive: false });
  }
  // tracejado central (so asfalto/terra)
  {
    const pos = [], idx = [];
    let vi = 0;
    for (let s = 0; s < L; s += 12) {
      const i0 = Math.floor(s / ds) % N;
      if (BRIDGE[i0] || SURFACE[i0] !== 0) continue;
      const i1 = (i0 + 5) % N;
      const w = 0.3;
      for (const [k, sg] of [[i0, 1], [i1, 1]]) {
        pos.push(X[k] + NX[k] * w, ELEV[k] + 0.06, Z[k] + NZ[k] * w, X[k] - NX[k] * w, ELEV[k] + 0.06, Z[k] - NZ[k] * w);
      }
      idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
      vi += 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    const mm = add(g, new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { receive: false });
    mm.name = 'dashes';
  }

  // taludes/fachada laterais onde a pista fica acima do chao (terra, ponte de aco ou carreta)
  {
    const build = (pred, bottomOf) => {
      const pos = [], idx = [];
      let open = false, lastK = -1;
      const capAt = (k) => {
        // tampa da ponta abrupta (labio do salto): fecha o corte transversal
        if (ELEV[k] < 0.5) return;
        const b = pos.length / 3;
        const o = EDGEf(k), y0 = ELEV[k] + 0.02, yb = bottomOf(k);
        for (const sg of [1, -1]) pos.push(X[k] + NX[k] * o * sg, y0, Z[k] + NZ[k] * o * sg, X[k] + NX[k] * o * sg, yb, Z[k] + NZ[k] * o * sg);
        idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
      };
      for (let i = 0; i <= N; i++) {
        const k = i % N;
        const ok = ELEV[k] >= 0.02 && pred(k);
        if (!ok) { if (open && lastK >= 0) capAt(lastK); open = false; continue; }
        for (const sg of [1, -1]) {
          const o = EDGEf(k) * sg, bottom = bottomOf(k);
          pos.push(X[k] + NX[k] * o, ELEV[k] + 0.02, Z[k] + NZ[k] * o, X[k] + NX[k] * o, bottom, Z[k] + NZ[k] * o);
        }
        const n4 = pos.length / 3;
        if (open) {
          const a = n4 - 8; // quatro vertices do passo anterior, quatro deste
          idx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4); // lado +
          idx.push(a + 2, a + 3, a + 6, a + 3, a + 7, a + 6); // lado -
        }
        open = true;
        lastK = k;
      }
      if (!pos.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const uv = [];
      for (let i = 0; i < pos.length / 3; i++) uv.push(pos[i * 3] / 6, (pos[i * 3 + 1]) / 3);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const gd = build((k) => !BRIDGE[k] && !HSK[k], (k) => 0);
    const gv = build((k) => HSK[k] === 2, (k) => Math.max(0, ELEV[k] - 1.4));
    const gb = build((k) => BRIDGE[k] === 1 && ELEV[k] < 6, () => -1.3);
    const gt = build((k) => HSK[k] === 1, () => 0.4);
    if (gd) add(gd, city ? new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: 0.9, side: THREE.DoubleSide }) : mountain ? new THREE.MeshStandardMaterial({ map: TX.rockDetailTexture(), color: 0x8b8e98, roughness: 1, side: THREE.DoubleSide }) : skirtDirt);
    if (gv) add(gv, new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: 0.9, side: THREE.DoubleSide }));
    if (gb) add(gb, new THREE.MeshStandardMaterial({ map: TX.steelTexture(), roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
    if (gt) add(gt, new THREE.MeshStandardMaterial({ map: TX.steelTexture(), color: 0xff9a3c, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide }), { cast: true });
  }

  // piso das zonas abertas (praca, beco, lote ao lado da pista): calcada no lado sem muro
  for (const z of track.def.openZones || []) {
    const w = z.floor ?? 24;
    if (!w) continue;
    const a = Math.floor(z.from * N);
    let b = Math.ceil(z.to * N);
    if (z.to < z.from) b += N;
    for (const sg of z.side === 0 || z.side === undefined ? [-1, 1] : [z.side]) {
      add(strip(a, b, (k) => sg * EDGEf(k), (k) => sg * (EDGEf(k) + w), 0.008, 12.8, 6.4), M.verge);
    }
  }
  // praia: faixa de areia entre a estrada e o mar (`gap`), faixa do lado de terra e ESPUMA das ondas que sobem na areia
  const foams = [];
  for (const c of track.def.chasms || []) {
    if (!c.water) continue;
    const a = Math.floor(c.from * N);
    let b = Math.ceil(c.to * N);
    if (c.to < c.from) b += N;
    const sg = c.side === 1 ? 1 : -1;
    // `strip` exige o menor deslocamento primeiro (senao o enrolamento inverte e a faixa fica sem luz)
    const lo = (f, g2) => (k) => Math.min(sg * f(k), sg * g2(k)), hi = (f, g2) => (k) => Math.max(sg * f(k), sg * g2(k));
    // (a areia ao redor da praia vem da cor do terreno: transicao suave para o pasto, sem faixas de borda dura)
    // ondas: faixa estreita que sobe na areia e outra mais larga e lenta no mar
    for (const [w0, w1, tex, op, name] of [[-9, 7, TX.foamTexture(), 0.9, 'near'], [8, 70, TX.foamTexture(), 0.45, 'far']]) {
      const f0 = (k) => EDGEf(k) + track.CHG[k] + w0, f1 = (k) => EDGEf(k) + track.CHG[k] + w1;
      const m = add(strip(a, b, lo(f0, f1), hi(f0, f1), name === 'near' ? 0.05 : -0.85, (w1 - w0) / (name === 'near' ? 1 : 2.5), 9, 2, true), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, fog: true }), { receive: false });
      foams.push({ tex, mat: m.material, name, op, sg });
    }
  }
  // rodas das carretas (colinas com skin 'truck'): eixos duplos sob a plataforma, nos dois lados
  {
    const wm = [];
    const Ltot = track.length;
    for (const h of track.def.hills || []) {
      if (h.skin !== 'truck') continue;
      const a = h.from * Ltot, flat = ((((h.to - h.from) % 1) + 1) % 1) * Ltot;
      const spots = flat > 6 ? [0.18, 0.5, 0.82].map((f) => a + flat * f) : [a - 3, a - 8]; // carreta sem plataforma plana: rodas sob a ponta da rampa
      for (const s0 of spots) for (const dd of [-0.9, 0.9]) {
        const p = track.pointAt(s0 + dd);
        const yaw = Math.atan2(p.tz, p.tx), k = p.idx;
        if (track.elevAt(s0 + dd) < 2.7) continue;
        for (const sg of [-1, 1]) wm.push(matrix(p.x + p.nx * sg * (EDGEf(k) - 0.7), 1.3, p.z + p.nz * sg * (EDGEf(k) - 0.7), yaw, 1, 1, 1));
      }
    }
    if (wm.length) {
      const wg = new THREE.CylinderGeometry(1.3, 1.3, 1.1, 14).rotateX(Math.PI / 2);
      group.add(instanced(wg, new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.9 }), wm));
    }
  }

  // ------------------------------------------------------------ rio e terreno
  const W = RIVER_HALF;
  const bridgeRuns = [];
  {
    let i = 0;
    while (i < N && BRIDGE[i]) i++; // avanca ate fora da ponte (se comecar dentro)
    const start = i;
    let cur = null;
    for (let n = 0; n < N; n++) {
      const k = (start + n) % N;
      if (BRIDGE[k]) { if (!cur) { cur = []; bridgeRuns.push(cur); } cur.push(k); } else cur = null;
    }
    if (!BRIDGE.some((v) => v)) bridgeRuns.length = 0;
  }
  // precipicios: faixas ao lado da pista, da borda (+gap) ate `width`; viram furos no terreno (poligonos).
  // Os de agua (`water`, o oceano) ganham a superficie da agua; os demais o fundo preto.
  const chasmPolys = [], seaPolys = [];
  if (track.hasChasm) {
    for (const water of [0, 1]) for (const sg of [-1, 1]) {
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          const pick = run.filter((_, j) => j % 3 === 0 || j === run.length - 1);
          const pts = [];
          for (const k of pick) pts.push([X[k] + NX[k] * sg * (EDGEf(k) + track.CHG[k]), Z[k] + NZ[k] * sg * (EDGEf(k) + track.CHG[k])]);
          for (const k of pick.slice().reverse()) pts.push([X[k] + NX[k] * sg * (EDGEf(k) + track.CHW[k]), Z[k] + NZ[k] * sg * (EDGEf(k) + track.CHW[k])]);
          (water ? seaPolys : chasmPolys).push(pts);
        }
        run = [];
      };
      for (let i = 0; i < N; i++) {
        const c = track.CH[i];
        if ((c === sg || c === 2) && track.CHWATER[i] === water) run.push(i); else flush();
      }
      flush();
    }
  }
  const riverMat = makeWaterMaterial({ depth: false, flat: 2.6 });
  const holes = [];
  const poly = [];
  for (const run of bridgeRuns) {
    const pts = [];
    const pick = run.filter((_, j) => j % 4 === 0 || j === run.length - 1);
    for (const k of pick) pts.push([X[k] + NX[k] * W, Z[k] + NZ[k] * W]);
    for (const k of pick.slice().reverse()) pts.push([X[k] - NX[k] * W, Z[k] - NZ[k] * W]);
    poly.push(pts);
  }
  if (useTerrain) { poly.length = 0; chasmPolys.length = 0; seaPolys.length = 0; } // o terreno ja tem rio, mar e fossos
  if (!useTerrain) {
    // centro e tamanho da area
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < N; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); z0 = Math.min(z0, Z[i]); z1 = Math.max(z1, Z[i]); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, R = GROUND_R;
    const shape = new THREE.Shape();
    shape.moveTo(cx - R, -(cz - R)); shape.lineTo(cx + R, -(cz - R)); shape.lineTo(cx + R, -(cz + R)); shape.lineTo(cx - R, -(cz + R)); shape.closePath();
    for (const pts of poly) {
      const h = new THREE.Path();
      pts.forEach(([x, z], i) => (i ? h.lineTo(x, -z) : h.moveTo(x, -z)));
      h.closePath();
      shape.holes.push(h);
      holes.push(pts);
    }
    for (const pts of [...chasmPolys, ...seaPolys]) {
      const h = new THREE.Path();
      pts.forEach(([x, z], i) => (i ? h.lineTo(x, -z) : h.moveTo(x, -z)));
      h.closePath();
      shape.holes.push(h);
    }
    const gg = new THREE.ShapeGeometry(shape);
    gg.rotateX(-Math.PI / 2);
    const grassT = city ? TX.cityGroundTexture() : mountain ? TX.rockGroundTexture() : TX.grassTexture();
    grassT.repeat.set(1 / 9, 1 / 9);
    const uv = gg.getAttribute('uv'), p = gg.getAttribute('position');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
    const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ map: grassT, roughness: 1 }));
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    group.add(ground);

    // agua + barrancos (rio da ponte e oceano)
    for (const pts of [...holes, ...seaPolys]) {
      const wg = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))));
      wg.rotateX(-Math.PI / 2);
      const wuv = wg.getAttribute('uv'), wp = wg.getAttribute('position');
      for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wp.getX(i) / 14, wp.getZ(i) / 14);
      const water = new THREE.Mesh(wg, riverMat);
      water.position.y = WATER_Y;
      water.receiveShadow = true;
      group.add(water);
      // barranco
      const bp = [], bi = [];
      pts.forEach(([x, z], i) => {
        bp.push(x, -0.02, z, x, WATER_Y - 0.6, z);
        if (i) bi.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
      });
      const n = pts.length;
      bi.push(n * 2 - 2, n * 2 - 1, 0, n * 2 - 1, 1, 0);
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
      const buv = [];
      for (let i = 0; i < n; i++) buv.push(i * 0.5, 0, i * 0.5, 1);
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
      bg.setIndex(bi);
      bg.computeVertexNormals();
      group.add(new THREE.Mesh(bg, skirtDirt));
    }
  }
  // paredes de rocha e fundo escuro dos precipicios
  {
    const DEPTH = 80;
    const wallMat = new THREE.MeshStandardMaterial({ map: TX.dirtTexture(), color: 0x8a6a48, roughness: 1, side: THREE.DoubleSide });
    for (const pts of chasmPolys) {
      const bp = [], bi = [], buv = [];
      pts.forEach(([x, z], i) => {
        bp.push(x, -0.02, z, x, -DEPTH, z);
        buv.push(i * 0.5, 0, i * 0.5, DEPTH / 6);
        if (i) bi.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
      });
      const n = pts.length;
      bi.push(n * 2 - 2, n * 2 - 1, 0, n * 2 - 1, 1, 0);
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
      bg.setIndex(bi);
      bg.computeVertexNormals();
      group.add(new THREE.Mesh(bg, wallMat));
      const fg = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))));
      fg.rotateX(-Math.PI / 2);
      const floor = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0x07080c }));
      floor.position.y = -DEPTH;
      group.add(floor);
    }
  }
  if (useTerrain) {
    // chao so FORA da caixa do terreno (o terreno cobre o mapa todo, com mar e rios): quadrado com um furo retangular
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, R = GROUND_R, [tx0, tz0, tx1, tz1] = track.terrain.box;
    const shape = new THREE.Shape();
    shape.moveTo(cx - R, -(cz - R)); shape.lineTo(cx + R, -(cz - R)); shape.lineTo(cx + R, -(cz + R)); shape.lineTo(cx - R, -(cz + R)); shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(tx0 + 1, -(tz0 + 1)); hole.lineTo(tx0 + 1, -(tz1 - 1)); hole.lineTo(tx1 - 1, -(tz1 - 1)); hole.lineTo(tx1 - 1, -(tz0 + 1)); hole.closePath();
    shape.holes.push(hole);
    const gg = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const uv = gg.getAttribute('uv'), gp = gg.getAttribute('position');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, gp.getX(i) / 11, gp.getZ(i) / 11);
    const dt = TX.rockDetailTexture();
    const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ map: dt, color: GROUND_COLOR, roughness: 1 }));
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    group.add(ground);
  } else if (!poly.length && !chasmPolys.length && !seaPolys.length) {
    const gg = new THREE.PlaneGeometry(GROUND_R * 2, GROUND_R * 2).translate((bx0 + bx1) / 2, (bz0 + bz1) / 2, 0).rotateX(-Math.PI / 2);
    const grassT = city ? TX.cityGroundTexture() : mountain ? TX.rockGroundTexture() : TX.grassTexture();
    grassT.repeat.set(GROUND_R * 2 / 9, GROUND_R * 2 / 9);
    const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ map: grassT, roughness: 1 }));
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    group.add(ground);
  }

  // montanhas: malha do terreno (sim/terrain.js) cobrindo o mapa + agua (mar, rios, desfiladeiro) + vegetacao decorativa
  let terrainView = null;
  if (useTerrain) {
    terrainView = buildTerrainView(track, { low, fast });
    group.add(terrainView.mesh, terrainView.water);
    if (terrainView.decor) decor.add(terrainView.decor);
  }
  // pilares do viaduto (colinas com skin 'viaduct')
  {
    const pil = [], beams = [];
    const stepP = Math.round(18 / ds);
    for (let k = 0; k < N; k += stepP) {
      if (HSK[k] !== 2 || ELEV[k] < 2.2) continue;
      const yaw = Math.atan2(TZs[k], TXs[k]);
      const h = ELEV[k] - 1.2;
      for (const sg of [-1, 1]) pil.push(matrix(X[k] + NX[k] * sg * (HWf(k) * 0.6), h / 2, Z[k] + NZ[k] * sg * (HWf(k) * 0.6), yaw, 2.2, h, 2.2));
      beams.push(matrix(X[k], ELEV[k] - 1.8, Z[k], yaw, 2.0, 1.0, EDGEf(k) * 2));
    }
    if (pil.length) {
      const cm = new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: 0.9 });
      group.add(instanced(new THREE.BoxGeometry(1, 1, 1), cm, pil));
      group.add(instanced(new THREE.BoxGeometry(1, 1, 1), cm, beams));
    }
  }
  // ------------------------------------------------------------ pilares da ponte
  {
    const pil = [], beams = [];
    // pistas por baixo da ponte (a ponte alta passa por cima da espiral): sem pilar em cima delas
    const lowG = new Map(), LG = 24, lkey = (cx, cz) => cx * 73856093 ^ cz * 19349663;
    for (let i = 0; i < N; i += 2) {
      if (BRIDGE[i] && ELEV[i] > 6) continue;
      const kk = lkey(Math.floor(X[i] / LG), Math.floor(Z[i] / LG));
      if (!lowG.has(kk)) lowG.set(kk, []);
      lowG.get(kk).push(i);
    }
    const underRoad = (k) => {
      if (ELEV[k] < 6) return false;
      const cx = Math.floor(X[k] / LG), cz = Math.floor(Z[k] / LG);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const i of lowG.get(lkey(cx + a, cz + b)) || []) {
          if (ELEV[i] < ELEV[k] - 3 && Math.hypot(X[i] - X[k], Z[i] - Z[k]) < EDGEf(i) + 6) return true;
        }
      }
      return false;
    };
    const high = [];
    for (const run of bridgeRuns) {
      const hi = ELEV[run[Math.floor(run.length / 2)]] > 6;
      for (let j = 0; j < run.length; j += Math.round((hi ? 30 : 18) / ds)) {
        const k = run[j];
        if (underRoad(k)) continue;
        const yaw = Math.atan2(TZs[k], TXs[k]);
        const h = ELEV[k] + 2.4, wd = ELEV[k] > 6 ? 3 : 1.8;
        for (const sg of [-1, 1]) {
          const o = sg * (HWf(k) * 0.62);
          pil.push(matrix(X[k] + NX[k] * o, ELEV[k] - h / 2 + 0.1, Z[k] + NZ[k] * o, yaw, wd, h, wd));
        }
        beams.push(matrix(X[k], ELEV[k] - 1, Z[k], yaw, 1.6, 1.4, EDGEf(k) * 2));
      }
      if (hi) high.push(run);
    }
    // ponte alta: laje inferior continua (sem a cortina de aco ate o chao)
    for (const run of high) add(strip(run[0], run[run.length - 1] + 1, (k) => -EDGEf(k), (k) => EDGEf(k), -1.4, 6.4, 6.4), M.steel);
    if (pil.length) {
      group.add(instanced(new THREE.BoxGeometry(1, 1, 1), M.steel, pil));
      group.add(instanced(new THREE.BoxGeometry(1, 1, 1), M.steel, beams));
    }
  }

  // ------------------------------------------------------------ muros por trecho
  {
    const posts = [], rails = [], diags = [];
    const lposts = [], lrails = [], pickets = [], jersey = [];
    const H = 6.2, seg = Math.round(6 / ds);
    // sem cerca na beira do precipicio: nem no trecho, nem nos ~12 u antes/depois dele
    const nearChasm = (k, sg) => {
      const m = Math.ceil(12 / ds);
      for (let q = -m; q <= m; q++) { const c = track.CH[(k + q + N) % N]; if (c === sg || c === 2) return true; }
      return false;
    };
    for (const r of runs) {
      const isBridge = !!BRIDGE[r.a];
      for (const sg of [-1, 1]) {
        let flip = 1;
        for (let i = r.a; i < r.b; i += seg) {
          const j = Math.min(i + seg, r.b);
          const k0 = i % N, k1 = j % N;
          if (track.OPEN[k0] & (sg > 0 ? 2 : 1)) continue; // zona aberta: sem muro
          const o = (EDGEf(k0) + 0.45) * sg, o1 = (EDGEf(k1) + 0.45) * sg;
          const wst = track.wallStyle(k0);
          const x0 = X[k0] + NX[k0] * o, z0 = Z[k0] + NZ[k0] * o, y0 = ELEV[k0];
          const x1 = X[k1] + NX[k1] * o1, z1 = Z[k1] + NZ[k1] * o1, y1 = ELEV[k1];
          const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1;
          const yaw = Math.atan2(dz, dx);
          if (isBridge) {
            posts.push(matrix(x0, y0 + H / 2, z0, yaw, 0.9, H, 0.9));
            rails.push(matrix((x0 + x1) / 2, y0 + H, (z0 + z1) / 2, yaw, len, 0.85, 0.85));
            rails.push(matrix((x0 + x1) / 2, y0 + 0.5, (z0 + z1) / 2, yaw, len, 0.9, 0.9));
            const dl = Math.hypot(len, H - 0.5);
            diags.push(matrix((x0 + x1) / 2, y0 + H / 2 + 0.25, (z0 + z1) / 2, yaw, dl, 0.5, 0.5, flip * Math.atan2(H - 0.5, len)));
            flip = -flip;
          } else if (wst === 'jersey') {
            jersey.push(matrix((x0 + x1) / 2, y0 + 0.55, (z0 + z1) / 2, yaw, len + 0.1, 1.1, 0.7));
          } else if (wst === 'fence' && track.RAILS[k0] && SURFACE[k0] !== 8 && !nearChasm(k0, sg)) { // sem cerca na praia
            const bk = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: y0, kind: 'iron', broken: false, parts: [['lposts', lposts.length], ['lrails', lrails.length], ['lrails', lrails.length + 1]] };
            lposts.push(matrix(x0, y0 + 1.8, z0, yaw, 0.38, 3.6, 0.38));
            lrails.push(matrix((x0 + x1) / 2, y0 + 3.0, (z0 + z1) / 2, yaw, len, 0.16, 0.16));
            lrails.push(matrix((x0 + x1) / 2, y0 + 1.1, (z0 + z1) / 2, yaw, len, 0.16, 0.16));
            for (let q = 0.0; q < 1; q += 1 / 3) {
              const px = x0 + dx * q, pz = z0 + dz * q;
              bk.parts.push(['pickets', pickets.length]);
              pickets.push(matrix(px, y0 + 1.5, pz, yaw, 0.12, 3.0, 0.12));
            }
            breakables.push(bk);
          }
        }
      }
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    if (posts.length) {
      group.add(instanced(box, M.steel, posts));
      group.add(instanced(box, M.steel, rails));
      group.add(instanced(box, M.steel, diags));
    }
    if (jersey.length) group.add(instanced(box, new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: 0.9 }), jersey));
    if (lposts.length) {
      group.add((meshes.lposts = instanced(box, M.iron, lposts)));
      group.add((meshes.lrails = instanced(box, M.iron, lrails)));
      group.add((meshes.pickets = instanced(box, M.iron, pickets)));
    }
  }

  // ------------------------------------------------------------ montanha: parede solida (`solidWalls`) + encosta rochosa com neve
  if (!fast) for (const w of track.def.solidWalls || []) {
    const sg = w.side === 1 ? 1 : -1;
    const a = Math.floor(w.from * N);
    let b = Math.ceil(w.to * N);
    if (w.to < w.from) b += N;
    const seg = Math.max(1, Math.round(7 / ds));
    const rockT = TX.rockDetailTexture();
    const blocks = [];
    for (let i = a; i < b; i += seg) {
      const k0 = i % N, k1 = Math.min(i + seg, b) % N;
      const o = (EDGEf(k0) + 1.6) * sg, o1 = (EDGEf(k1) + 1.6) * sg;
      const x0 = X[k0] + NX[k0] * o, z0 = Z[k0] + NZ[k0] * o, x1 = X[k1] + NX[k1] * o1, z1 = Z[k1] + NZ[k1] * o1;
      const len = Math.hypot(x1 - x0, z1 - z0) + 0.4, yaw = Math.atan2(z1 - z0, x1 - x0);
      const h = 5 + rng() * 3;
      blocks.push(matrix((x0 + x1) / 2, ELEV[k0] + h / 2 - 0.5, (z0 + z1) / 2, yaw, len, h, 3 + rng() * 1.5));
    }
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: rockT, color: 0xb9bcc6, roughness: 1 }), blocks));
  }

  // ------------------------------------------------------------ largada: linha, vagas e portico
  let gantry = null;
  {
    const p0 = track.pointAt(0);
    const ang = Math.atan2(p0.tz, p0.tx);
    const y0 = track.elevAt(0);
    const cols = 2, rows = Math.round((HWf(0) * 2) / 1.6);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(3.2, HWf(0) * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.checkerTexture(cols, rows) }));
    line.position.set(p0.x, y0 + 0.07, p0.z);
    line.rotation.y = -ang;
    group.add(line);

    // vagas pintadas em "U" (abertas para a frente), uma por carro
    const slots = [];
    for (let i = 0; i < 8; i++) {
      const sl = gridSlot(i);
      const pr = -4 - sl.back;
      const p = track.pointAt(pr);
      const d = sl.side * HWf(0) * 0.36;
      const cx = p.x + p.nx * d, cz = p.z + p.nz * d, y = track.elevAt(pr) + 0.09;
      const yaw = Math.atan2(p.tz, p.tx);
      const bar = (lx, lz, sx, sz) => {
        const c = Math.cos(yaw), s = Math.sin(yaw);
        // local x = frente, local z = direita
        const wx = cx + c * lx + -s * lz, wz = cz + s * lx + c * lz;
        slots.push(matrix(wx, y, wz, yaw, sx, 0.05, sz));
      };
      bar(-2.3, 0, 0.25, 3.3);
      bar(-0.1, -1.6, 4.4, 0.25);
      bar(-0.1, 1.6, 4.4, 0.25);
    }
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), M.paint, slots, { cast: false, receive: false }));

    gantry = buildStartGantry(EDGEf(0) + 2.5);
    const pg = track.pointAt(9);
    gantry.group.position.set(pg.x, track.elevAt(9), pg.z);
    gantry.group.rotation.y = -Math.atan2(pg.tz, pg.tx);
    group.add(gantry.group);
  }

  // ------------------------------------------------------------ cenario
  addScenery(group, track, { rng, low, bridgeRuns, W, edge: maxHW + vg, breakables, meshes, fast, decor, city });

  if (!fast && city) buildCity(track, { group, decor, rng, low, EDGEf });
  if (!fast) buildStructures(track, decor, { low });
  const propsView = !fast && track.scenery?.props?.length ? new PropsView(track, decor, { low }) : null;
  if (!fast && !city) {
  // montanhas rochosas laranja ao fundo
  {
    let cx = 0, cz = 0;
    for (let i = 0; i < N; i += 8) { cx += X[i]; cz += Z[i]; }
    cx /= Math.ceil(N / 8); cz /= Math.ceil(N / 8);
    let span = 0; // distancia do ponto mais longe da pista ao centro: as montanhas ficam alem disso
    for (let i = 0; i < N; i += 4) span = Math.max(span, Math.hypot(X[i] - cx, Z[i] - cz));
    const mats = [];
    const peaks = [];
    for (let i = 0; i < (low ? 8 : 16); i++) {
      const a = (i / (low ? 8 : 16)) * Math.PI * 2 + rng() * 0.3, r = Math.max(520, span + (mountain ? 200 : 300)) + rng() * 140;
      const h = mountain ? 180 + rng() * 170 : 90 + rng() * 120, w = mountain ? 130 + rng() * 90 : 110 + rng() * 80;
      peaks.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, h, w]);
    }
    const mg = mergeGeometries(peaks.map(([x, z, h, w], i) => {
      const g = new THREE.ConeGeometry(w, h, 7, 3).translate(x, h / 2 - 4, z);
      const pos = g.getAttribute('position');
      for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) + Math.sin(k * 12.9898 + i) * 7, pos.getY(k), pos.getZ(k) + Math.cos(k * 78.233 + i) * 7);
      g.computeVertexNormals();
      if (mountain) {
        // rocha cinza-azulada com capa de neve no terco de cima
        const c = colored(g, [0x6f7684, 0x5f6675, 0x7a8190][i % 3]), cp = c.getAttribute('position'), cc = c.getAttribute('color');
        for (let k = 0; k < cp.count; k++) if (cp.getY(k) > h * 0.62) cc.setXYZ(k, 0.95, 0.97, 1);
        return c;
      }
      return colored(g, [0xc98a3c, 0xb8742f, 0xd89b4a][i % 3]);
    }));
    decor.add(new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })));
    void mats;
  }

  // nuvens
  {
    const ct = TX.cloudTexture();
    for (let i = 0; i < (low ? 6 : 14); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
      const a = rng() * Math.PI * 2, r = 380 + rng() * 240;
      s.position.set(Math.cos(a) * r, 130 + rng() * 70, Math.sin(a) * r);
      s.scale.set(180 + rng() * 140, 80 + rng() * 40, 1);
      decor.add(s);
    }
  }
  }

  // detalhes de cenario (so visuais): fauna, flores, bandeirinhas, placas de curva...
  const details = fast || city ? null : buildDetails(track, { low });
  if (details) group.add(details.group);

  const bkGrid = new Map();
  for (const bk of breakables) {
    const k = Math.floor(bk.x / BK_CELL) * 100003 + Math.floor(bk.z / BK_CELL);
    if (!bkGrid.has(k)) bkGrid.set(k, []);
    bkGrid.get(k).push(bk);
  }

  return {
    group,
    gantry,
    /** Poder (explosao, whomp, missil, gelo) quebra todas as cercas no raio. Retorna os trechos quebrados. */
    breakFencesIn(x, z, r) {
      const broke = [];
      const n = Math.ceil(r / BK_CELL) + 1, cx = Math.floor(x / BK_CELL), cz = Math.floor(z / BK_CELL);
      for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
        const list = bkGrid.get((cx + a) * 100003 + (cz + b));
        if (!list) continue;
        for (const bk of list) {
          const d = Math.hypot(bk.x - x, bk.z - z);
          if (bk.broken || d > r) continue;
          bk.broken = true;
          for (const [tag, idx] of bk.parts) {
            const mesh = meshes[tag];
            if (mesh) { mesh.setMatrixAt(idx, ZERO); mesh.instanceMatrix.needsUpdate = true; }
          }
          broke.push({ x: bk.x, z: bk.z, y: bk.y, kind: bk.kind, dx: d > 0.1 ? (bk.x - x) / d : 1, dz: d > 0.1 ? (bk.z - z) / d : 0, speed: 14 });
        }
      }
      return broke;
    },
    /** Arvore/pedra destruida por um poder: some do cenario. */
    props: propsView,
    /** Bomba de combustivel explodiu: troca pelo modelo queimado. */
    burnPump(idx) { propsView?.burn(idx); },
    hideScenery(kind, idx) {
      if (PROPS[kind]) { propsView?.hide(idx); return; }
      const s = meshes.scn;
      if (!s) return;
      if (kind === 'tree') { s.crown.setMatrixAt(idx, ZERO); s.trunk.setMatrixAt(idx, ZERO); s.crown.instanceMatrix.needsUpdate = s.trunk.instanceMatrix.needsUpdate = true; }
      else if (kind === 'rock' && s.rockMesh) { s.rockMesh.setMatrixAt(idx, ZERO); s.rockMesh.instanceMatrix.needsUpdate = true; }
    },
    /** Gelo: arvore/pedra ficam azuladas. */
    freezeScenery(kind, idx) {
      const s = meshes.scn;
      const m = kind === 'tree' ? s?.crown : kind === 'rock' ? s?.rockMesh : null;
      if (!m) return;
      m.setColorAt(idx, ICE_TINT);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    },
    /** Nova rodada: tudo volta ao lugar (arvores, pedras, cores). Cercas quebradas continuam quebradas. */
    restoreScenery() {
      propsView?.restore();
      const s = meshes.scn;
      if (!s) return;
      s.tree.forEach((o, i) => { s.crown.setMatrixAt(i, o.m); s.trunk.setMatrixAt(i, o.m); s.crown.setColorAt(i, o.c); });
      s.rock.forEach((o, i) => { s.rockMesh.setMatrixAt(i, o.m); s.rockMesh.setColorAt(i, o.c); });
      for (const m of [s.crown, s.trunk, s.rockMesh]) {
        if (!m) continue;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    },
    /** Anima a agua e quebra cercas atravessadas por carros. Retorna os trechos quebrados ({x,z,y,kind,dx,dz,speed}). */
    update(t, cars = []) {
      if (terrainView) terrainView.waterMat.userData.uTime.value = t;
      riverMat.userData.uTime.value = t;
      details?.update(t, cars);
      for (const f of foams) { // ondas rolando para a areia: a espuma anda em direcao a estrada e pulsa
        const sp = f.name === 'near' ? 0.16 : 0.07;
        f.tex.offset.x = f.sg * ((t * sp) % 1);
        f.mat.opacity = f.op * (f.name === 'near' ? 0.55 + 0.45 * Math.sin(t * 1.4) : 0.8 + 0.2 * Math.sin(t * 0.8 + 1));
      }
      propsView?.update(t);
      const broke = [];
      for (const c of cars) {
        if (!(c.alive || c.state === 'wreck') || c.speed < 4) continue;
        const cx = Math.floor(c.x / BK_CELL), cz = Math.floor(c.z / BK_CELL);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const list = bkGrid.get((cx + a) * 100003 + (cz + b));
          if (!list) continue;
          for (const bk of list) {
            if (bk.broken || Math.hypot(bk.x - c.x, bk.z - c.z) > 3.3) continue;
            bk.broken = true;
            for (const [tag, idx] of bk.parts) {
              const mesh = meshes[tag];
              if (mesh) { mesh.setMatrixAt(idx, ZERO); mesh.instanceMatrix.needsUpdate = true; }
            }
            const sp = c.speed || 1;
            broke.push({ x: bk.x, z: bk.z, y: bk.y, kind: bk.kind, dx: c.vx / sp, dz: c.vz / sp, speed: c.speed });
          }
        }
      }
      return broke;
    },
  };
}

// ---------------------------------------------------------------- decoracao
function addScenery(group, track, { rng, low, bridgeRuns, W, edge, breakables, meshes, fast, decor, city }) {
  const sc0 = track.scenery;
  const { N, X, Z, NX, NZ, ELEV, BRIDGE, SURFACE } = track;
  // hash espacial das amostras da pista para medir distancia
  const cell = 24, grid = new Map();
  const key = (cx, cz) => (cx * 73856093) ^ (cz * 19349663);
  for (let i = 0; i < N; i += 2) {
    const k = key(Math.floor(X[i] / cell), Math.floor(Z[i] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const dist = (x, z, onlyBridge = false) => {
    let m = Infinity;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const l = grid.get(key(cx + a, cz + b));
      if (!l) continue;
      for (const i of l) {
        if (onlyBridge && !BRIDGE[i]) continue;
        m = Math.min(m, Math.hypot(x - X[i], z - Z[i]));
      }
    }
    return m;
  };
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < N; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); z0 = Math.min(z0, Z[i]); z1 = Math.max(z1, Z[i]); }
  const pad = 150;
  const clear = edge + 9;
  const spots = (n, minD, maxD = Infinity) => {
    const out = [];
    let guard = n * 60;
    while (out.length < n && guard-- > 0) {
      const x = x0 - pad + rng() * (x1 - x0 + pad * 2), z = z0 - pad + rng() * (z1 - z0 + pad * 2);
      const d = dist(x, z);
      if (d < clear + minD || d > maxD) continue;
      if (bridgeRuns.length && dist(x, z, true) < W + 4) continue;
      if (track.chasmContains(x, z) || track.inSolidZone?.(x, z) || (track.terrain && !track.terrain.sceneryOk(x, z))) continue;
      out.push([x, z]);
    }
    return out;
  };
  const mtn = track.theme?.kind === 'mountain';
  const gy = (x, z) => (track.terrain ? track.terrain.heightAt(x, z) : 0); // altura do chao (montanhas)
  const f = low ? 0.4 : 1;
  const tint = new THREE.Color();

  if (!fast && !city) {
  // arvores redondas (copa dupla + tronco) e pinheiros
  const trunkG = colored(new THREE.CylinderGeometry(0.85, 1.25, 6, 7).translate(0, 3, 0), 0x7a4e2b);
  const crownG = mtn ? mergeGeometries([ // pinheiro: tres cones empilhados
    colored(new THREE.ConeGeometry(4.6, 6, 8).translate(0, 7, 0), 0xffffff),
    colored(new THREE.ConeGeometry(3.6, 5.5, 8).translate(0, 10.5, 0), 0xffffff),
    colored(new THREE.ConeGeometry(2.4, 5, 8).translate(0, 14, 0), 0xffffff),
  ]) : mergeGeometries([
    colored(new THREE.IcosahedronGeometry(4.6, 1).translate(0, 8.4, 0), 0xffffff),
    colored(new THREE.IcosahedronGeometry(3.4, 1).translate(3.2, 10.4, 1), 0xffffff),
    colored(new THREE.IcosahedronGeometry(3.2, 1).translate(-2.8, 10.0, -1.4), 0xffffff),
  ]);
  const treeM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  const trees = sc0.trees;
  const crown = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), trees.length);
  const trunk = new THREE.InstancedMesh(trunkG, treeM, trees.length);
  crown.castShadow = trunk.castShadow = true;
  const scn = (meshes.scn = { tree: [], rock: [], crown, trunk });
  trees.forEach((t, i) => {
    const m = matrix(t.x, t.y || 0, t.z, t.yaw, t.s, t.sy, t.s);
    crown.setMatrixAt(i, m);
    trunk.setMatrixAt(i, m);
    if (mtn) tint.setHSL(0.36 + t.hue * 0.05, 0.4, 0.17 + t.light * 0.1); else tint.setHSL(0.26 + t.hue * 0.07, 0.62, 0.34 + t.light * 0.14);
    crown.setColorAt(i, tint);
    scn.tree.push({ m: m.clone(), c: tint.clone() });
  });
  decor.add(crown, trunk);

  // palmeiras
  {
    // tronco com copa redonda pequena (sem folhas triangulares)
    const parts = [
      colored(new THREE.CylinderGeometry(0.35, 0.6, 9, 6).translate(0, 4.5, 0), 0x9a6a3a),
      colored(new THREE.IcosahedronGeometry(1.1, 0).translate(0, 9.3, 0), 0x6b8f2a),
    ];
    for (let i = 0; i < 8; i++) { // folhas: lâminas compridas que caem para fora
      const leaf = new THREE.BoxGeometry(5.4, 0.12, 1.3).translate(2.7, 0, 0);
      leaf.rotateZ(-0.42 - (i % 2) * 0.18).rotateY((i / 8) * Math.PI * 2).translate(0, 9.5, 0);
      parts.push(colored(leaf, i % 2 ? 0x2f9e3f : 0x3dae4a));
    }
    const palmG = mergeGeometries(parts);
    const palms = mtn ? [] : spots(Math.round(70 * f), 0, edge + 60);
    if (mtn) { // praia: so palmeiras (sem arvores comuns): fileiras junto da areia e um coqueiral mais para dentro
      const sand = [];
      for (let i = 0; i < N; i += 3) if (SURFACE[i] === 8) sand.push(i);
      for (let q = 0; q < sand.length; q += 3) {
        const i = sand[q];
        if (rng() < 0.2) continue;
        const o = track.HW[i] + track.verge + 5 + rng() * 9;
        palms.push([X[i] + NX[i] * o, Z[i] + NZ[i] * o]);
      }
      for (let n = Math.round(160 * f); n > 0 && sand.length; n--) { // coqueiral no lado de terra
        const i = sand[Math.floor(rng() * sand.length)], o = track.HW[i] + track.verge + 16 + rng() * 120;
        const x = X[i] + NX[i] * o, z = Z[i] + NZ[i] * o;
        if ((track.terrain && track.terrain.heightAt(x, z) < -0.3) || dist(x, z) < edge + 6) continue;
        palms.push([x, z]);
      }
    }
    const pm = new THREE.InstancedMesh(palmG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true, side: THREE.DoubleSide }), palms.length);
    pm.castShadow = true;
    palms.forEach(([x, z], i) => pm.setMatrixAt(i, matrix(x, gy(x, z) - 0.1, z, rng() * 6.28, 1 + rng() * 0.5, 1 + rng() * 0.5, 1 + rng() * 0.5)));
    decor.add(pm);
  }

  // arbustos e pedras
  {
    const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), Math.round(220 * f));
    const bs = spots(bush.count, -4, edge + 70).filter(([x, z]) => !track.nearSurface(x, z, 8, 260)); // sem arbustos na praia
    bush.count = bs.length;
    bs.forEach(([x, z], i) => {
      const s = 0.7 + rng() * 1.1;
      bush.setMatrixAt(i, matrix(x, gy(x, z) + 0.5, z, rng() * 6, s * 1.3, s, s));
      tint.setHSL(0.27 + rng() * 0.08, 0.6, 0.3 + rng() * 0.12);
      bush.setColorAt(i, tint);
    });
    bush.castShadow = true;
    decor.add(bush);
    const rocks = sc0.rocks;
    const rk = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.6, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), rocks.length);
    scn.rockMesh = rk;
    rocks.forEach((r, i) => {
      const m = matrix(r.x, (r.y || 0) + 0.2, r.z, r.yaw, r.s * 1.3, r.s * 0.8, r.s);
      rk.setMatrixAt(i, m);
      tint.setHSL(0.08, 0.05, 0.4 + r.tone * 0.2);
      rk.setColorAt(i, tint);
      scn.rock.push({ m: m.clone(), c: tint.clone() });
    });
    rk.castShadow = true;
    decor.add(rk);
  }

  // tufos de grama (planos cruzados com alfa)
  {
    const gt = new THREE.PlaneGeometry(2.6, 2.0).translate(0, 1.0, 0);
    const cross = mergeGeometries([gt.clone(), gt.clone().rotateY(Math.PI / 2), gt.clone().rotateY(Math.PI / 4)]);
    const mat = new THREE.MeshStandardMaterial({ map: TX.tuftTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
    const n = mtn ? 0 : Math.round(2600 * f); // nas montanhas os tufos vem do terreno
    const tufts = [];
    let guard = n * 30;
    while (tufts.length < n && guard-- > 0) {
      const i = Math.floor(rng() * N);
      const side = rng() < 0.5 ? -1 : 1;
      const o = (edge + 2.5 + rng() * 55) * side;
      const x = X[i] + NX[i] * o + (rng() - 0.5) * 6, z = Z[i] + NZ[i] * o + (rng() - 0.5) * 6;
      if (dist(x, z) < edge + 2.2) continue;
      if (bridgeRuns.length && dist(x, z, true) < W + 2) continue;
      if (track.chasmContains(x, z) || track.inSolidZone?.(x, z) || (track.terrain && !track.terrain.sceneryOk(x, z)) || track.nearSurface(x, z, 8, 260)) continue;
      tufts.push([x, z]);
    }
    const im = new THREE.InstancedMesh(cross, mat, tufts.length);
    tufts.forEach(([x, z], i) => {
      const s = 0.8 + rng() * 1.1;
      im.setMatrixAt(i, matrix(x, gy(x, z), z, rng() * 6.28, s, s * (0.8 + rng() * 0.6), s));
      tint.setHSL(0.27 + rng() * 0.08, 0.55, 0.62 + rng() * 0.3);
      im.setColorAt(i, tint);
    });
    decor.add(im);
  }
  }

  // cercas brancas dos dois lados (so em terra)
  if (!city && !mtn) {
    const posts = [], railsA = [], railsB = [];
    const step = Math.round(2.2 / track.ds) || 2;
    for (const sg of [-1, 1]) {
      for (let i = 0; i < N; i += step) {
        const j = (i + step) % N;
        if (BRIDGE[i] || BRIDGE[j] || ELEV[i] > 0.05 || dist(X[i] + NX[i] * sg * (edge + 6), Z[i] + NZ[i] * sg * (edge + 6), true) < W + 5) continue;
        if (track.hasChasm && [6, 14, 24].some((q) => track.chasmContains(X[i] + NX[i] * sg * (edge + q), Z[i] + NZ[i] * sg * (edge + q)))) continue;
        const o = (edge + 6) * sg;
        const x0 = X[i] + NX[i] * o, z0 = Z[i] + NZ[i] * o, x1 = X[j] + NX[j] * o, z1 = Z[j] + NZ[j] * o;
        const yaw = Math.atan2(z1 - z0, x1 - x0), len = Math.hypot(x1 - x0, z1 - z0);
        breakables.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: 0, kind: 'wood', broken: false, parts: [['wposts', posts.length], ['wposts', posts.length + 1], ['wrailsA', railsA.length], ['wrailsB', railsB.length]] });
        posts.push(matrix(x0, 0.85, z0, yaw, 0.28, 1.7, 0.16));
        posts.push(matrix((x0 + x1) / 2, 0.75, (z0 + z1) / 2, yaw, 0.22, 1.5, 0.12));
        railsA.push(matrix((x0 + x1) / 2, 0.55, (z0 + z1) / 2, yaw, len, 0.14, 0.1));
        railsB.push(matrix((x0 + x1) / 2, 1.2, (z0 + z1) / 2, yaw, len, 0.14, 0.1));
      }
    }
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.7 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    group.add((meshes.wposts = instanced(box, white, posts, { receive: false })));
    group.add((meshes.wrailsA = instanced(box, white, railsA, { receive: false })));
    group.add((meshes.wrailsB = instanced(box, white, railsB, { receive: false })));
  }

  // casinhas (tijolo ou parede branca), com janela
  if (!fast && !city) {
    const houses = sc0.houses;
    const bodyG = new THREE.BoxGeometry(11, 7, 9).translate(0, 3.5, 0);
    const roofG = new THREE.ConeGeometry(9, 5, 4).rotateY(Math.PI / 4).translate(0, 9.5, 0);
    const brick = new THREE.InstancedMesh(bodyG, new THREE.MeshStandardMaterial({ map: TX.brickTexture(), roughness: 0.85 }), houses.length);
    const white = new THREE.InstancedMesh(bodyG, new THREE.MeshStandardMaterial({ map: TX.wallTexture(), roughness: 0.85 }), houses.length);
    const roofs = new THREE.InstancedMesh(roofG, new THREE.MeshStandardMaterial({ map: TX.roofTexture(), roughness: 0.8 }), houses.length);
    const wins = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ map: TX.windowTexture(), roughness: 0.6 }), houses.length * 2);
    let bi = 0, wi = 0, wn = 0;
    houses.forEach((h) => {
      const { x, z, yaw } = h;
      const m = matrix(x, 0, z, yaw, 1, 1, 1);
      if (h.brick) brick.setMatrixAt(bi++, m); else white.setMatrixAt(wi++, m);
      roofs.setMatrixAt(wn, m);
      for (const off of [-2.6, 2.6]) {
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const lx = 5.52, lz = off; // parede "da frente" em local +x
        const wm = matrix(x + c * lx - s * lz, 3.7, z + s * lx + c * lz, yaw, 1, 1, 1);
        // plano olha para +z local: gira para +x local
        eu.set(0, -yaw + Math.PI / 2, 0, 'YXZ');
        qt.setFromEuler(eu);
        m4.compose(ps.set(x + c * lx - s * lz, 3.7, z + s * lx + c * lz), qt, sc.set(1, 1, 1));
        wins.setMatrixAt(wn * 2 + (off > 0 ? 1 : 0), m4);
        void wm;
      }
      wn++;
    });
    brick.count = bi; white.count = wi; roofs.count = wn; wins.count = wn * 2;
    for (const im of [brick, white, roofs]) im.castShadow = true;
    decor.add(brick, white, roofs, wins);
  }
}
