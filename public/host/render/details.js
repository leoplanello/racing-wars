// Detalhes de cenario (so visuais, sem colisao): deixam a Ponte do Rio e o Passo da Montanha mais vivos. Tudo procedural.
//  Ponte do Rio: juncos, vitorias-regias, patos, peixes saltando, barco, bandeirinhas e lanternas na ponte, flores, troncos, cogumelos, folhas ao vento.
//  Montanha: placas de curva, marcos, muretas, cairns, bandeiras de oracao, arbustos, flores alpinas, cachoeiras, nevoa do desfiladeiro,
//            gaivotas, barcos e boias, lenha da praia, rochedos com espuma, bando de passaros, raios de sol e neve no cume.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '/sim/rng.js';
import * as TX from './textures.js';

const WATER_Y = -1.1;
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
const mat4 = (x, y, z, yaw, sx = 1, sy = sx, sz = sx, roll = 0) => {
  E.set(0, -yaw, roll, 'YXZ');
  Q.setFromEuler(E);
  return M4.compose(P.set(x, y, z), Q, S.set(sx, sy, sz)).clone();
};
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); };

/** Geometria com cor por vertice (sem uv, para poder fundir). */
function flat(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const c = new THREE.Color(hex), n = g.getAttribute('position').count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}
const merge = (list) => mergeGeometries(list);

function inst(geo, mat, mats, colors = null, cast = false) {
  if (!mats.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
  im.castShadow = cast;
  im.frustumCulled = false;
  return im;
}

export function buildDetails(track, { low = false } = {}) {
  const group = new THREE.Group();
  const anims = [];
  const rng = makeRng(5150);
  const T = track.terrain;
  const mountain = track.theme?.kind === 'mountain';
  const { N, X, Z, NX, NZ, TX: TXs, TZ: TZs, ELEV, BRIDGE, HW } = track;
  const verge = track.verge;
  const EDGE = (i) => HW[i % N] + verge;
  const RIVER = track.riverHalf ?? 34;
  const q = low ? 0.5 : 1;
  const count = (n) => Math.max(1, Math.round(n * q));
  const flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const flatMatDS = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
  const add = (o) => { if (o) group.add(o); return o; };

  // ---- consulta ao terreno e ao cenario solido
  const gy = (x, z) => (T ? T.heightAt(x, z) : 0);
  const slopeAt = (x, z) => (T ? Math.hypot(T.heightAt(x + 4, z) - T.heightAt(x - 4, z), T.heightAt(x, z + 4) - T.heightAt(x, z - 4)) / 8 : 0);
  const sc = track.scenery;
  const solids = [];
  for (const k of ['trees', 'rocks', 'houses']) for (const o of sc?.[k] || []) solids.push(o);
  const blocked = (x, z, r) => { for (const o of solids) if (Math.hypot(o.x - x, o.z - z) < (o.r || 3) + r) return true; return false; };
  const nr = track.newNear();
  /** Terra firme livre para vegetacao/enfeites: longe da pista (e do rio na Ponte), fora da agua e do cenario solido. */
  const okGround = (x, z, hMax = 46) => {
    if (T) {
      if (!T.contains(x, z)) return false;
      const jx = Math.round((x - T.box[0]) / T.cell), jz = Math.round((z - T.box[1]) / T.cell);
      if (T.CORR[jz * T.nx + jx]) return false;
      const h = T.heightAt(x, z);
      if (h < 0.4 || h > hMax || slopeAt(x, z) > 0.4) return false;
    } else {
      track.nearest(x, z, -1, nr);
      if (nr.dist < track.halfWidth + verge + 5) return false;
      if (BRIDGE[nr.idx] && Math.abs(nr.d) < RIVER + 4) return false;
    }
    return !blocked(x, z, 1.5);
  };
  const side = (i, lat) => ({ x: X[i % N] + NX[i % N] * lat, z: Z[i % N] + NZ[i % N] * lat });

  // ---- trechos de ponte
  const bridgeRuns = [];
  {
    let i0 = 0;
    while (i0 < N && BRIDGE[i0]) i0++;
    let cur = null;
    if (BRIDGE.some((v) => v)) for (let n = 0; n < N; n++) {
      const k = (i0 + n) % N;
      if (BRIDGE[k]) { if (!cur) { cur = []; bridgeRuns.push(cur); } cur.push(k); } else cur = null;
    }
  }

  // ---- ondulacoes (aneis) reaproveitaveis
  const ripTex = TX.ringTexture();
  const ripples = [];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ripTex, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    m.visible = false; m.renderOrder = 3;
    group.add(m);
    ripples.push({ m, age: 9, life: 1, size: 3 });
  }
  let ripI = 0;
  const ripple = (x, y, z, size = 3, life = 1.3) => {
    const r = ripples[ripI++ % ripples.length];
    r.age = 0; r.life = life; r.size = size;
    r.m.position.set(x, y + 0.04, z); r.m.visible = true;
  };
  anims.push((t, dt) => {
    for (const r of ripples) {
      if (r.age >= r.life) { r.m.visible = false; continue; }
      r.age += dt;
      const u = Math.min(1, r.age / r.life);
      r.m.scale.setScalar(r.size * (0.25 + u * 0.9));
      r.m.material.opacity = 0.55 * (1 - u);
    }
  });

  // ---- animais (aves, patos): modelos pequenos
  function makeBird(body, tip, scale) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(merge([flat(new THREE.SphereGeometry(0.28, 6, 4).scale(2.1, 0.8, 0.8), body), flat(new THREE.SphereGeometry(0.17, 6, 4).translate(0.6, 0.08, 0), body), flat(new THREE.ConeGeometry(0.06, 0.28, 4).rotateZ(-Math.PI / 2).translate(0.82, 0.05, 0), 0xf0a030)]), flatMat);
    g.add(b);
    const wingG = merge([flat(new THREE.BoxGeometry(0.55, 0.04, 1.3).translate(0, 0, 0.65), body), flat(new THREE.BoxGeometry(0.5, 0.05, 0.4).translate(0, 0, 1.4), tip)]);
    const wl = new THREE.Mesh(wingG, flatMatDS), wr = new THREE.Mesh(wingG, flatMatDS);
    wr.scale.z = -1;
    g.add(wl, wr);
    g.scale.setScalar(scale);
    g.userData = { wl, wr };
    return g;
  }
  const flap = (g, t, ph, amp = 0.55) => { const a = Math.sin(t * 7 + ph) * amp; g.userData.wl.rotation.x = -a; g.userData.wr.rotation.x = a; };

  // ======================================================================== PONTE DO RIO (sem relevo)
  if (!T && bridgeRuns.length) {
    const br = bridgeRuns.reduce((a, b) => (b.length > a.length ? b : a));

    // juncos (taboas) nas margens e vitorias-regias
    const reed = merge([
      ...[[0, 0], [0.25, 0.1], [-0.2, 0.18], [0.1, -0.22], [-0.12, -0.12]].map(([ox, oz], j) => flat(new THREE.CylinderGeometry(0.035, 0.05, 2.1 + j * 0.25, 4).translate(ox, 1.05 + j * 0.12, oz).rotateZ((j - 2) * 0.07), 0x6f9a3a)),
      ...[[0.25, 0.1], [-0.12, -0.12], [0, 0]].map(([ox, oz], j) => flat(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 6).translate(ox, 2.3 + j * 0.3, oz), 0x5a3a22)),
    ]);
    const rl = [];
    for (let n = 0; n < count(150); n++) {
      const i = br[Math.floor(rng() * br.length)], sg = rng() < 0.5 ? -1 : 1;
      const wet = rng() < 0.6;
      const lat = sg * (wet ? RIVER - 0.8 - rng() * 2.4 : RIVER + 0.3 + rng() * 1.5);
      const p = side(i, lat);
      rl.push(mat4(p.x, wet ? WATER_Y - 0.15 : -0.02, p.z, rng() * 6.28, 0.7 + rng() * 0.7, 0.8 + rng() * 0.6, 0.7 + rng() * 0.7));
    }
    add(inst(reed, flatMat, rl));

    const padG = merge([flat(new THREE.CircleGeometry(0.85, 10, 0.4, 5.6).rotateX(-Math.PI / 2), 0x3f8f3a)]);
    const pl = [], pc = [];
    const greens = [0x3f8f3a, 0x4aa043, 0x357a34].map((h) => new THREE.Color(h));
    for (let n = 0; n < count(110); n++) {
      const i = br[Math.floor(rng() * br.length)], sg = rng() < 0.5 ? -1 : 1;
      const p = side(i, sg * (EDGE(i) + 3 + rng() * (RIVER - EDGE(i) - 6)));
      pl.push(mat4(p.x, WATER_Y + 0.05, p.z, rng() * 6.28, 0.7 + rng() * 0.8));
      pc.push(greens[n % 3]);
      if (rng() < 0.3) { // flor rosa sobre a folha
        const fm = new THREE.Mesh(merge([flat(new THREE.ConeGeometry(0.28, 0.3, 6), 0xff8fc0), flat(new THREE.SphereGeometry(0.1, 5, 4).translate(0, 0.14, 0), 0xffe070)]), flatMat);
        fm.position.set(p.x, WATER_Y + 0.2, p.z);
        group.add(fm);
      }
    }
    add(inst(padG, new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, flatShading: true, vertexColors: true }), pl, pc));

    // pedras lisas na agua (perto das margens)
    const rockL = [];
    for (let n = 0; n < count(14); n++) {
      const i = br[Math.floor(rng() * br.length)], sg = rng() < 0.5 ? -1 : 1;
      const p = side(i, sg * (RIVER - 3.5 - rng() * 5));
      const s = 0.7 + rng() * 1.1;
      rockL.push(mat4(p.x, WATER_Y + 0.05, p.z, rng() * 6.28, s * 1.3, s * 0.7, s));
      ripple(p.x, WATER_Y, p.z, s * 4.5, 99); // aneis fixos de agua batendo na pedra
    }
    add(inst(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8b8e97, roughness: 1, flatShading: true }), rockL, null, true));

    // patos nadando pelo rio
    const ducks = [];
    for (let n = 0; n < 5; n++) {
      const mallard = n % 2 === 0;
      const d = new THREE.Group();
      d.add(new THREE.Mesh(merge([
        flat(new THREE.SphereGeometry(0.42, 7, 5).scale(1.25, 0.7, 0.85), mallard ? 0x8a6a45 : 0xf4f0e4),
        flat(new THREE.SphereGeometry(0.22, 7, 5).translate(0.5, 0.36, 0), mallard ? 0x2d6a4a : 0xf4f0e4),
        flat(new THREE.BoxGeometry(0.26, 0.07, 0.17).translate(0.75, 0.33, 0), 0xf0a030),
        flat(new THREE.ConeGeometry(0.18, 0.4, 4).rotateZ(Math.PI / 2).translate(-0.6, 0.12, 0), mallard ? 0x5e4630 : 0xe9e4d4),
      ]), flatMat));
      d.scale.setScalar(1.15);
      group.add(d);
      ducks.push({ g: d, u: 0.15 + rng() * 0.7, dir: rng() < 0.5 ? -1 : 1, lat: (rng() < 0.5 ? -1 : 1) * (EDGE(br[0]) + 5 + rng() * (RIVER - EDGE(br[0]) - 11)), sp: 0.04 + rng() * 0.04, ph: rng() * 6.28, rip: rng() });
    }
    anims.push((t, dt) => {
      for (const d of ducks) {
        d.u += d.dir * d.sp * dt * 0.6;
        if (d.u > 0.88) { d.u = 0.88; d.dir = -1; } else if (d.u < 0.12) { d.u = 0.12; d.dir = 1; }
        const i = br[Math.floor(d.u * (br.length - 1))];
        const p = side(i, d.lat + Math.sin(t * 0.5 + d.ph) * 1.5);
        const dx = TXs[i] * d.dir, dz = TZs[i] * d.dir;
        d.g.position.set(p.x, WATER_Y + 0.12 + Math.sin(t * 2.2 + d.ph) * 0.035, p.z);
        d.g.rotation.set(0, -Math.atan2(dz, dx), Math.sin(t * 1.7 + d.ph) * 0.05);
        d.rip -= dt;
        if (d.rip <= 0) { d.rip = 1.2 + rng() * 0.8; ripple(p.x, WATER_Y, p.z, 2.4, 1.6); }
      }
    });

    // peixes saltando
    const fishG = merge([flat(new THREE.SphereGeometry(0.3, 6, 4).scale(1.6, 0.6, 0.5), 0x9fc4d8), flat(new THREE.ConeGeometry(0.2, 0.4, 4).rotateZ(Math.PI / 2).translate(-0.55, 0, 0), 0x6f95ad), flat(new THREE.SphereGeometry(0.12, 4, 3).translate(0.1, 0.12, 0), 0xe9f4fb)]);
    const fish = [];
    for (let n = 0; n < 3; n++) {
      const f = new THREE.Mesh(fishG, flatMat);
      f.visible = false; group.add(f);
      fish.push({ f, wait: 1 + rng() * 5, u: 1, x: 0, z: 0, yaw: 0 });
    }
    anims.push((t, dt) => {
      for (const s of fish) {
        if (s.u >= 1) {
          s.wait -= dt;
          s.f.visible = false;
          if (s.wait > 0) continue;
          const i = br[Math.floor((0.2 + rng() * 0.6) * (br.length - 1))], sg = rng() < 0.5 ? -1 : 1;
          const p = side(i, sg * (EDGE(i) + 4 + rng() * (RIVER - EDGE(i) - 9)));
          s.x = p.x; s.z = p.z; s.yaw = Math.atan2(TZs[i], TXs[i]) + (rng() < 0.5 ? 0 : Math.PI);
          s.u = 0; s.wait = 2.5 + rng() * 5;
          ripple(s.x, WATER_Y, s.z, 3.2, 1.2);
        }
        s.u += dt / 0.8;
        if (s.u >= 1) { ripple(s.x, WATER_Y, s.z, 3.6, 1.4); continue; }
        const u = s.u, h = 4 * u * (1 - u);
        s.f.visible = true;
        s.f.position.set(s.x + Math.cos(s.yaw) * (u - 0.5) * 2.4, WATER_Y + h * 1.7, s.z + Math.sin(s.yaw) * (u - 0.5) * 2.4);
        s.f.rotation.set(0, -s.yaw, (0.5 - u) * 1.9);
      }
    });

    // barquinho atracado numa margem
    {
      const i = br[Math.floor(br.length * 0.3)], sg = 1;
      const p = side(i, sg * (RIVER - 3.2));
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(flat(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(2.3, 0.75, 0.95), 0x8a5a30), flatMatDS);
      boat.add(hull);
      for (const x of [-0.9, 0.2, 1.1]) boat.add(new THREE.Mesh(flat(new THREE.BoxGeometry(0.22, 0.07, 1.5).translate(x, -0.05, 0), 0xc89a62), flatMat));
      boat.add(new THREE.Mesh(merge([flat(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 4).rotateX(Math.PI / 2).translate(0.2, 0.2, 0.9), 0x6b4a2a), flat(new THREE.BoxGeometry(0.5, 0.04, 0.2).translate(0.2, 0.2, 1.9), 0x6b4a2a)]), flatMat));
      boat.position.set(p.x, WATER_Y + 0.08, p.z);
      const yaw0 = Math.atan2(TZs[i], TXs[i]) + 0.35;
      group.add(boat);
      anims.push((t) => { boat.rotation.set(Math.sin(t * 1.1) * 0.03, -yaw0, Math.sin(t * 0.9 + 1) * 0.035); boat.position.y = WATER_Y + 0.1 + Math.sin(t * 1.3) * 0.04; });
    }

    // flores, cogumelos e troncos caidos
    scatterFlowers({ patches: count(46), perPatch: 26, near: [8, 50], palette: [0xffd93a, 0xffffff, 0xff8fb8, 0xb07cff, 0xff9a3a] });
    {
      const logG = merge([flat(new THREE.CylinderGeometry(0.4, 0.46, 3.6, 7).rotateZ(Math.PI / 2), 0x6b4a2c), flat(new THREE.CylinderGeometry(0.14, 0.18, 1.2, 5).rotateZ(Math.PI / 2.6).translate(0.5, 0.45, 0.3), 0x6b4a2c), flat(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 7).rotateZ(Math.PI / 2).translate(1.82, 0, 0), 0xd2b07a)]);
      const mushG = merge([
        flat(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 5).translate(0, 0.15, 0), 0xf0e6d0), flat(new THREE.SphereGeometry(0.22, 7, 4, 0, 6.283, 0, 1.4).translate(0, 0.3, 0), 0xd23a2c),
        flat(new THREE.SphereGeometry(0.035, 4, 3).translate(0.1, 0.46, 0.06), 0xffffff), flat(new THREE.SphereGeometry(0.035, 4, 3).translate(-0.08, 0.47, -0.08), 0xffffff),
        flat(new THREE.CylinderGeometry(0.05, 0.07, 0.2, 5).translate(0.32, 0.1, 0.1), 0xf0e6d0), flat(new THREE.SphereGeometry(0.15, 7, 4, 0, 6.283, 0, 1.4).translate(0.32, 0.2, 0.1), 0xe0553a),
      ]);
      const ll = [], ml = [];
      for (let n = 0, tries = 0; n < count(10) && tries < 400; tries++) {
        const i = Math.floor(rng() * N), sg = rng() < 0.5 ? -1 : 1, p = side(i, sg * (EDGE(i) + 7 + rng() * 38));
        if (!okGround(p.x, p.z)) continue;
        ll.push(mat4(p.x, 0.3, p.z, rng() * 6.28, 0.8 + rng() * 0.5)); n++;
      }
      for (let n = 0, tries = 0; n < count(36) && tries < 800; tries++) {
        const i = Math.floor(rng() * N), sg = rng() < 0.5 ? -1 : 1, p = side(i, sg * (EDGE(i) + 6 + rng() * 40));
        if (!okGround(p.x, p.z)) continue;
        ml.push(mat4(p.x, 0, p.z, rng() * 6.28, 0.9 + rng() * 0.9)); n++;
      }
      add(inst(logG, flatMat, ll, null, true));
      add(inst(mushG, flatMat, ml));
    }

    // folhas ao vento
    windParticles({ kind: 'leaves' });
  }

  // ======================================================================== PONTES (as duas pistas): lanternas e bandeirinhas
  {
    const lanternFrame = [], lanternGlow = [];
    const flagM = [], flagC = [];
    const palette = [0xff4a4a, 0xffd23a, 0x3a9bff, 0x57d36a, 0xffffff, 0xff8a3a].map((h) => new THREE.Color(h));
    const strings = [];
    const H = 6.2, seg = Math.max(1, Math.round(6 / track.ds));
    for (const run of bridgeRuns) {
      if (run.length < seg * 3) continue;
      for (const sg of [-1, 1]) {
        let pi = 0;
        for (let a = 0; a + seg < run.length; a += seg, pi++) {
          const k0 = run[a], k1 = run[a + seg];
          const o0 = sg * (EDGE(k0) + 0.45), o1 = sg * (EDGE(k1) + 0.45);
          const x0 = X[k0] + NX[k0] * o0, z0 = Z[k0] + NZ[k0] * o0, y0 = ELEV[k0] + H;
          const x1 = X[k1] + NX[k1] * o1, z1 = Z[k1] + NZ[k1] * o1, y1 = ELEV[k1] + H;
          if (pi % 4 === 0) {
            lanternFrame.push(mat4(x0, y0 + 0.55, z0, Math.atan2(z1 - z0, x1 - x0)));
            lanternGlow.push([x0, y0 + 0.6, z0]);
          }
          // bandeirinhas: curva suave (catenaria) pendurada na viga de cima, do lado de fora
          const yaw = Math.atan2(z1 - z0, x1 - x0), ox = NX[k0] * sg * 0.55, oz = NZ[k0] * sg * 0.55;
          const pts = [];
          for (let f = 0; f <= 8; f++) {
            const u = f / 8, sag = Math.sin(u * Math.PI) * 0.75;
            pts.push([x0 + (x1 - x0) * u + ox, y0 + (y1 - y0) * u - 0.25 - sag, z0 + (z1 - z0) * u + oz]);
          }
          strings.push(pts);
          for (let f = 1; f < 8; f += 1) {
            const p = pts[f];
            flagM.push(mat4(p[0], p[1], p[2], yaw));
            flagC.push(palette[(pi * 3 + f + (sg > 0 ? 2 : 0)) % palette.length]);
          }
        }
      }
    }
    if (lanternFrame.length) {
      const frame = merge([flat(new THREE.BoxGeometry(0.5, 0.08, 0.5).translate(0, -0.36, 0), 0x22252d), flat(new THREE.BoxGeometry(0.5, 0.08, 0.5).translate(0, 0.36, 0), 0x22252d), flat(new THREE.ConeGeometry(0.4, 0.3, 4).translate(0, 0.55, 0), 0x22252d)]);
      add(inst(frame, flatMat, lanternFrame));
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
      add(inst(new THREE.BoxGeometry(0.34, 0.62, 0.34), lampMat, lanternFrame));
      const gm = new THREE.SpriteMaterial({ map: TX.glowTexture('255,205,120'), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
      for (const [x, y, z] of lanternGlow) { const s = new THREE.Sprite(gm); s.position.set(x, y, z); s.scale.setScalar(3.4); group.add(s); }
    }
    if (flagM.length) {
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.28, 0, 0, 0.28, 0, 0, 0, -0.62, 0], 3));
      tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      add(inst(tri, new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), flagM, flagC));
      const lp = [];
      for (const pts of strings) for (let f = 0; f < pts.length - 1; f++) lp.push(...pts[f], ...pts[f + 1]);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2018 })));
    }
  }

  // ======================================================================== CURVAS FECHADAS: chevrons nas duas pistas
  {
    const k = 6, curv = new Float32Array(N), turn = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const j = (i + k) % N;
      const dot = Math.max(-1, Math.min(1, TXs[i] * TXs[j] + TZs[i] * TZs[j]));
      curv[i] = Math.acos(dot) / (k * track.ds);
      turn[i] = TXs[i] * TZs[j] - TZs[i] * TXs[j]; // = T'.N
    }
    const thr = 1 / 70;
    const boards = [], posts = [];
    let i = 0;
    while (i < N) {
      if (curv[i] < thr || BRIDGE[i]) { i++; continue; }
      let j = i, gap = 0;
      while (j < N && gap < 6) { if (curv[j] >= thr && !BRIDGE[j]) gap = 0; else gap++; j++; }
      const len = j - i;
      const n = Math.max(2, Math.min(5, Math.floor((len * track.ds) / 12)));
      for (let m = 0; m < n; m++) {
        const kk = (i + Math.floor(((m + 0.5) / n) * len)) % N;
        // N = (-tz, tx) fica a direita de quem olha de frente para a placa; a curva vira para N quando T'.N = tx*tz' - tz*tx' > 0
        const toN = turn[kk] > 0 ? 1 : -1;
        const out = -toN; // lado de fora da curva
        const off = out * (EDGE(kk) + 1.5);
        const x = X[kk] + NX[kk] * off, z = Z[kk] + NZ[kk] * off;
        const gz = gy(x, z), top = ELEV[kk] + 2.3, base = Math.max(Math.min(gz, ELEV[kk] - 0.2), ELEV[kk] - 9), hgt = top - base;
        const yawFace = Math.atan2(-TXs[kk], -TZs[kk]); // normal da placa = -T
        boards.push({ x, y: ELEV[kk] + 1.5, z, yaw: yawFace, flip: toN });
        posts.push(mat4(x, base + hgt / 2, z, 0, 0.1, hgt, 0.1));
      }
      i = j;
    }
    if (boards.length) {
      const bg = new THREE.PlaneGeometry(1.55, 1.55);
      const bm = new THREE.MeshStandardMaterial({ map: TX.chevronTexture(), roughness: 0.6, side: THREE.DoubleSide });
      const im = new THREE.InstancedMesh(bg, bm, boards.length);
      boards.forEach((b, idx) => {
        E.set(0, b.yaw, 0, 'YXZ'); Q.setFromEuler(E);
        im.setMatrixAt(idx, M4.compose(P.set(b.x, b.y, b.z), Q, S.set(b.flip, 1, 1)));
      });
      im.frustumCulled = false; im.castShadow = true;
      add(im);
      add(inst(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), new THREE.MeshStandardMaterial({ color: 0x8a8d95, roughness: 0.6, metalness: 0.4 }), posts));
    }
  }

  // ======================================================================== PASSO DA MONTANHA
  if (T && mountain) {
    const sun = track.theme.sun || [0xfff4e0, 2.5, -50, 95, 35];

    // marcos quilometricos e muretas de pedra
    {
      const kmG = merge([flat(new THREE.BoxGeometry(0.5, 1.2, 0.34).translate(0, 0.6, 0), 0xb9bcc2), flat(new THREE.BoxGeometry(0.52, 0.3, 0.36).translate(0, 1.15, 0), 0xc23a2e), flat(new THREE.BoxGeometry(0.3, 0.4, 0.02).translate(0, 0.62, 0.18), 0xf4f4f0)]);
      const km = [], step = Math.max(1, Math.round(110 / track.ds));
      for (let i = 0; i < N; i += step) {
        if (BRIDGE[i] || track.CH[i]) continue;
        const sg = 1, p = side(i, sg * (EDGE(i) + 1.7)), h = gy(p.x, p.z);
        if (h < -0.3 || Math.abs(h - ELEV[i]) > 4) continue;
        km.push(mat4(p.x, h - 0.05, p.z, Math.atan2(TZs[i], TXs[i]) + Math.PI / 2));
      }
      add(inst(kmG, flatMat, km, null, true));

      const wallG = merge([flat(new THREE.BoxGeometry(3.4, 0.9, 0.7).translate(0, 0.45, 0), 0x8d8d90), flat(new THREE.BoxGeometry(1.1, 0.25, 0.8).translate(-0.8, 0.98, 0), 0x77777b), flat(new THREE.BoxGeometry(0.9, 0.2, 0.75).translate(0.9, 0.95, 0), 0xa3a3a6)]);
      const wl = [];
      const runs = count(16);
      for (let r = 0, tries = 0; r < runs && tries < 200; tries++) {
        const i0 = Math.floor(rng() * N), sg = rng() < 0.5 ? -1 : 1, pieces = 6 + Math.floor(rng() * 14), st = Math.max(1, Math.round(3.5 / track.ds));
        let ok = true; const tmp = [];
        for (let m = 0; m < pieces && ok; m++) {
          const i = (i0 + m * st) % N;
          if (BRIDGE[i] || track.CH[i] || (track.SOLID[i] & (sg > 0 ? 2 : 1)) || curv_ok(i) === false) { ok = false; break; }
          const p = side(i, sg * (EDGE(i) + 2.4)), h = gy(p.x, p.z);
          if (h < -0.2 || Math.abs(h - ELEV[i]) > 2.5) { ok = false; break; }
          tmp.push(mat4(p.x, h - 0.1, p.z, Math.atan2(TZs[i], TXs[i]) + (rng() - 0.5) * 0.08, 1, 0.85 + rng() * 0.4, 1));
        }
        if (ok && tmp.length > 4) { wl.push(...tmp); r++; }
      }
      add(inst(wallG, flatMat, wl, null, true));
    }
    function curv_ok(i) { const j = (i + 6) % N; return TXs[i] * TXs[j] + TZs[i] * TZs[j] > 0.985; }

    // cairns, bandeiras de oracao, arbustos secos e flores alpinas
    {
      const stone = (r, y, hex, dx = 0) => flat(new THREE.IcosahedronGeometry(r, 0).scale(1.25, 0.55, 1).translate(dx, y, 0), hex);
      const cairnG = merge([stone(0.55, 0.25, 0x8a8c93), stone(0.42, 0.65, 0x9a9ca2, 0.04), stone(0.32, 0.95, 0x777a82, -0.03), stone(0.22, 1.18, 0xa6a8ae)]);
      const cl = [], flagSets = [];
      const step = Math.max(1, Math.round(75 / track.ds));
      for (let i = 0; i < N; i += step) {
        if (BRIDGE[i] || ELEV[i] < 10) continue;
        const sg = rng() < 0.5 ? -1 : 1, p = side(i, sg * (EDGE(i) + 3.5 + rng() * 5)), h = gy(p.x, p.z);
        if (Math.abs(h - ELEV[i]) > 3 || h < 0.5 || slopeAt(p.x, p.z) > 0.45 || track.CH[i]) continue;
        cl.push(mat4(p.x, h - 0.1, p.z, rng() * 6.28, 1.1 + rng() * 0.8));
        if (rng() < 0.45 && h > 14) flagSets.push({ x: p.x, z: p.z, h, yaw: Math.atan2(TZs[i], TXs[i]) + 0.4 });
      }
      add(inst(cairnG, flatMat, cl, null, true));

      const poleM = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 });
      const colors = [0x2f6fe0, 0xf4f4f4, 0xe0352b, 0x3fb04a, 0xf2c230];
      const flagG = new THREE.PlaneGeometry(0.55, 0.42).translate(0, -0.21, 0);
      const flagMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }));
      const sways = [];
      for (const f of flagSets.slice(0, count(14))) {
        const g = new THREE.Group();
        g.position.set(f.x, f.h - 0.1, f.z); g.rotation.y = -f.yaw;
        for (const dx of [-2.5, 2.5]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.4, 5), poleM); p.position.set(dx, 1.7, 0); g.add(p); }
        const lg = new THREE.BufferGeometry();
        const lp = [];
        for (let u = 0; u < 12; u++) lp.push(-2.5 + (u / 12) * 5, 3.2 - Math.sin((u / 12) * Math.PI) * 0.35, 0, -2.5 + ((u + 1) / 12) * 5, 3.2 - Math.sin(((u + 1) / 12) * Math.PI) * 0.35, 0);
        lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
        g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2018 })));
        for (let u = 0; u < 7; u++) {
          const fm = new THREE.Mesh(flagG, flagMats[u % 5]);
          fm.position.set(-2.1 + u * 0.7, 3.2 - Math.sin(((u + 0.6) / 7.3) * Math.PI) * 0.35, 0);
          g.add(fm); sways.push([fm, u * 0.8 + f.x]);
        }
        group.add(g);
      }
      anims.push((t) => { for (const [fm, ph] of sways) { fm.rotation.x = Math.sin(t * 3.2 + ph) * 0.3; fm.rotation.y = Math.sin(t * 2.1 + ph) * 0.35; } });

      const bushG = merge([flat(new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.62, 1), 0xffffff), flat(new THREE.IcosahedronGeometry(0.45, 0).scale(1, 0.7, 1).translate(0.55, -0.05, 0.2), 0xe6e6e6)]);
      const bl = [], bc = [];
      const bushCols = [0x7a6a3c, 0x5e6e3a, 0x8a7a4a, 0x4f6a35].map((h) => new THREE.Color(h));
      for (let n = 0, tries = 0; n < count(520) && tries < 4000; tries++) {
        const i = Math.floor(rng() * N), sg = rng() < 0.5 ? -1 : 1, p = side(i, sg * (EDGE(i) + 14 + Math.pow(rng(), 0.7) * 120));
        if (!okGround(p.x, p.z, 44)) continue;
        bl.push(mat4(p.x, gy(p.x, p.z) - 0.1, p.z, rng() * 6.28, 0.7 + rng() * 1.1));
        bc.push(bushCols[Math.floor(rng() * bushCols.length)]); n++;
      }
      add(inst(bushG, flatMat, bl, bc, true));
      scatterFlowers({ patches: count(70), perPatch: 22, near: [14, 140], palette: [0xb07cff, 0xffffff, 0xffd93a, 0xff7ab0, 0x7aa8ff], hMax: 44 });
    }

    // cachoeiras nas encostas do desfiladeiro e nevoa sobre a agua
    {
      let ib = -1;
      for (let i = 0; i < N; i++) if (BRIDGE[i] && ELEV[i] > 6 && (ib < 0 || ELEV[i] > ELEV[ib])) ib = i;
      if (ib >= 0) {
        const streak = TX.streakTexture();
        const wfMat = new THREE.MeshBasicMaterial({ map: streak, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
        let made = 0;
        for (const sg of [1, -1]) for (const along of [0, 40, -40, 80, -80]) {
          if (made >= (low ? 1 : 3)) break;
          const ic = ((ib + Math.round(along / track.ds)) % N + N) % N;
          const dirx = NX[ic] * sg, dirz = NZ[ic] * sg, tx = TXs[ic], tz = TZs[ic];
          const hAt = (l) => gy(X[ic] + dirx * l, Z[ic] + dirz * l);
          // da margem da agua para fora ate onde a encosta fica alta
          let l0 = -1, l1 = -1;
          for (let l = 14; l < 150; l += 2) {
            const h = hAt(l);
            if (l0 < 0 && h > WATER_Y + 0.4 && hAt(l - 2) < WATER_Y + 0.4) l0 = l - 1;
            if (l0 >= 0 && h > 12) { l1 = l; break; }
          }
          if (l0 < 0 || l1 < 0 || l1 - l0 > 70) continue;
          // faixa que acompanha o terreno
          const pos = [], uv = [], idx = [];
          let acc = 0, prev = null;
          const w = 2.6;
          for (let l = l0; l <= l1; l += 2) {
            const cx = X[ic] + dirx * l, cz = Z[ic] + dirz * l, h = gy(cx, cz) + 0.3;
            if (prev) acc += Math.hypot(h - prev, 2);
            prev = h;
            const f = (l - l0) / (l1 - l0), ww = w * (0.7 + f * 0.5);
            pos.push(cx - tx * ww, h, cz - tz * ww, cx + tx * ww, h, cz + tz * ww);
            uv.push(0, -acc / 6, 1, -acc / 6);
          }
          for (let r = 0; r < pos.length / 6 - 1; r++) { const a = r * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
          g.setIndex(idx);
          const mesh = new THREE.Mesh(g, wfMat);
          mesh.renderOrder = 3;
          group.add(mesh);
          const bx = X[ic] + dirx * l0, bz = Z[ic] + dirz * l0;
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glowTexture('240,250,255'), transparent: true, opacity: 0.55, depthWrite: false }));
          sp.position.set(bx, WATER_Y + 1.2, bz); sp.scale.set(9, 6, 1); group.add(sp);
          made++;
        }
        anims.push((t) => { streak.offset.y = -t * 0.9 % 1; });

        const mistM = new THREE.SpriteMaterial({ map: TX.glowTexture('232,244,255'), transparent: true, opacity: 0.2, depthWrite: false });
        const mist = [];
        const run = bridgeRuns.find((r) => r.includes(ib)) || [ib];
        for (let n = 0; n < count(16); n++) {
          const i = run[Math.floor(rng() * run.length)], sg = rng() < 0.5 ? -1 : 1, p = side(i, sg * (EDGE(i) + rng() * 22));
          const s = new THREE.Sprite(mistM.clone());
          s.scale.set(26 + rng() * 22, 10 + rng() * 6, 1);
          const y0 = WATER_Y + 2 + rng() * 6;
          s.position.set(p.x, y0, p.z);
          group.add(s);
          mist.push({ s, x: p.x, y0, z: p.z, ph: rng() * 6.28 });
        }
        anims.push((t) => { for (const m of mist) { m.s.position.set(m.x + Math.sin(t * 0.06 + m.ph) * 8, m.y0 + Math.sin(t * 0.2 + m.ph) * 1.5, m.z + Math.cos(t * 0.05 + m.ph) * 6); m.s.material.opacity = 0.14 + 0.08 * Math.sin(t * 0.3 + m.ph); } });
      }
    }

    // ---- mar: gaivotas, barcos, boias, lenha na praia e rochedos com espuma
    const shore = T.box && track.def.terrain.ocean?.shore;
    if (shore) {
      const seaAt = (p, d) => {
        for (const [dx, dz] of [[-1, 0], [-0.7, -0.7], [-0.7, 0.7], [0, -1], [0, 1], [-1, 0.4], [-1, -0.4]]) {
          const x = p[0] + dx * d, z = p[1] + dz * d;
          if (T.contains(x, z) && T.waterAt(x, z) && T.heightAt(x, z) > -9) return [x, z];
        }
        return null;
      };
      const cs = [];
      for (let i = 4; i < shore.length; i += 12) { const s = seaAt(shore[i], 70 + rng() * 60); if (s) cs.push(s); }
      const part = Math.min(cs.length, 6);

      if (part) {
        const gulls = [];
        for (let n = 0; n < count(10); n++) {
          const g = makeBird(0xf6f7f9, 0x40444c, 1.5);
          group.add(g);
          const c = cs[n % part];
          gulls.push({ g, cx: c[0], cz: c[1], r: 20 + rng() * 45, sp: (0.25 + rng() * 0.2) * (rng() < 0.5 ? 1 : -1), a: rng() * 6.28, y: 18 + rng() * 22, ph: rng() * 6.28 });
        }
        anims.push((t) => {
          for (const b of gulls) {
            const a = b.a + t * b.sp;
            b.g.position.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(t * 0.7 + b.ph) * 1.6, b.cz + Math.sin(a) * b.r);
            b.g.rotation.set(0, -(a + (b.sp > 0 ? Math.PI / 2 : -Math.PI / 2)), Math.sin(t * 0.7 + b.ph) * 0.12 + (b.sp > 0 ? -0.2 : 0.2));
            flap(b.g, t, b.ph, 0.45 + 0.2 * Math.sin(t * 0.4 + b.ph));
          }
        });
      }

      // barcos pequenos com vela e boias vermelhas
      const boats = [];
      for (let n = 0; n < Math.min(3, cs.length); n++) {
        const [bx, bz] = cs[(n * 2 + 1) % cs.length];
        const g = new THREE.Group();
        g.add(new THREE.Mesh(merge([flat(new THREE.SphereGeometry(1, 8, 5, 0, 6.283, 1.57, 1.57).scale(2.6, 0.9, 1.0), 0xf2f2f0), flat(new THREE.BoxGeometry(4.6, 0.12, 0.12).translate(0, 0.02, 0.95), 0x2f6fe0), flat(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 4).translate(0.2, 1.8, 0), 0x6b4a2a)]), flatMatDS));
        g.add(new THREE.Mesh(merge([flat(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.3, 3.4, 0), new THREE.Vector3(0.3, 0.6, 0), new THREE.Vector3(2.2, 0.6, 0)]).setIndex([0, 1, 2]).toNonIndexed(), 0xfaf6e8)]), flatMatDS));
        g.position.set(bx, WATER_Y + 0.1, bz);
        g.scale.setScalar(1.6);
        group.add(g);
        boats.push({ g, ph: rng() * 6.28, yaw: rng() * 6.28 });
      }
      anims.push((t) => { for (const b of boats) { b.g.rotation.set(Math.sin(t * 0.8 + b.ph) * 0.04, b.yaw + Math.sin(t * 0.1 + b.ph) * 0.2, Math.sin(t * 0.6 + b.ph) * 0.05); b.g.position.y = WATER_Y + 0.12 + Math.sin(t * 1.1 + b.ph) * 0.07; } });

      const buoyG = merge([flat(new THREE.SphereGeometry(0.5, 8, 5, 0, 6.283, 1.57, 1.57), 0xe0352b), flat(new THREE.CylinderGeometry(0.34, 0.5, 0.5, 8).translate(0, 0.25, 0), 0xf4f4f4), flat(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 4).translate(0, 1.0, 0), 0x444b55), flat(new THREE.SphereGeometry(0.14, 5, 4).translate(0, 1.55, 0), 0xffd23a)]);
      const buoys = [];
      for (let i = 2; i < shore.length; i += 6) {
        const s = seaAt(shore[i], 55);
        if (!s) continue;
        const b = new THREE.Mesh(buoyG, flatMat);
        b.position.set(s[0], WATER_Y + 0.05, s[1]);
        group.add(b);
        buoys.push({ b, ph: rng() * 6.28 });
      }
      anims.push((t) => { for (const o of buoys) { o.b.position.y = WATER_Y + 0.05 + Math.sin(t * 1.4 + o.ph) * 0.12; o.b.rotation.z = Math.sin(t * 1.1 + o.ph) * 0.12; } });

      // lenha na praia
      const dw = merge([flat(new THREE.CylinderGeometry(0.22, 0.3, 3.8, 5).rotateZ(Math.PI / 2), 0xc9b79a), flat(new THREE.CylinderGeometry(0.08, 0.12, 1.1, 4).rotateZ(Math.PI / 3).translate(0.6, 0.4, 0.2), 0xb7a589)]);
      const dl = [];
      for (let i = 3; i < shore.length; i += 5) {
        const x = shore[i][0] + 5 + rng() * 9, z = shore[i][1] + (rng() - 0.5) * 8;
        if (!T.contains(x, z)) continue;
        const h = T.heightAt(x, z);
        if (h < -0.1 || h > 1.5) continue;
        dl.push(mat4(x, h + 0.15, z, rng() * 6.28, 0.8 + rng() * 0.8));
      }
      add(inst(dw, flatMat, dl, null, true));

      // rochedos na agua rasa com espuma ao redor
      const rockL = [], foamL = [];
      for (let i = 1; i < shore.length; i += 7) {
        const s = seaAt(shore[i], 8 + rng() * 14);
        if (!s) continue;
        const sz = 1.2 + rng() * 2.2;
        rockL.push(mat4(s[0], WATER_Y + 0.1, s[1], rng() * 6.28, sz * 1.3, sz * 0.9, sz));
        foamL.push([s[0], s[1], sz]);
      }
      add(inst(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x7c7f88, roughness: 1, flatShading: true }), rockL, null, true));
      const fm = new THREE.MeshBasicMaterial({ map: ripTex, transparent: true, opacity: 0.7, depthWrite: false });
      const fl = foamL.map(([x, z, s]) => mat4(x, WATER_Y + 0.06, z, 0, s * 4.2, 1, s * 4.2));
      const foamMesh = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), fm, fl);
      if (foamMesh) { foamMesh.renderOrder = 3; add(foamMesh); anims.push((t) => { fm.opacity = 0.55 + 0.25 * Math.sin(t * 1.6); }); }
    }

    // bando de passaros em V no alto e raios de sol
    {
      let cx = 0, cz = 0;
      for (let i = 0; i < N; i += 8) { cx += X[i]; cz += Z[i]; }
      cx /= Math.ceil(N / 8); cz /= Math.ceil(N / 8);
      const birds = [];
      for (let n = 0; n < 9; n++) {
        const g = makeBird(0x2b2f38, 0x15171d, 1.1);
        group.add(g);
        const row = Math.ceil(n / 2), sd = n === 0 ? 0 : n % 2 ? 1 : -1;
        birds.push({ g, ox: -row * 3.2, oz: sd * row * 3.6, ph: n * 0.7 });
      }
      anims.push((t) => {
        const a = t * 0.035, R = 330, yaw = a + Math.PI / 2;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        for (const b of birds) {
          const x = cx + Math.cos(a) * R + b.ox * c - b.oz * s, z = cz + Math.sin(a) * R + b.ox * s + b.oz * c;
          b.g.position.set(x, 115 + Math.sin(t * 0.5 + b.ph) * 1.2, z);
          b.g.rotation.set(0, -yaw, 0);
          flap(b.g, t, b.ph, 0.4);
        }
      });

      const rayT = TX.rayTexture();
      const rm = new THREE.MeshBasicMaterial({ map: rayT, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const sunDir = new THREE.Vector3(sun[2], sun[3], sun[4]).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
      const spots = [];
      let ib = -1;
      for (let i = 0; i < N; i++) if (BRIDGE[i] && ELEV[i] > 6 && (ib < 0 || ELEV[i] > ELEV[ib])) ib = i;
      if (ib >= 0) for (let n = 0; n < 4; n++) spots.push([X[ib] + (rng() - 0.5) * 120, Z[ib] + (rng() - 0.5) * 120]);
      for (let n = 0; n < 3; n++) { const i = Math.floor(rng() * N); spots.push([X[i] + (rng() - 0.5) * 200, Z[i] + (rng() - 0.5) * 200]); }
      for (const [x, z] of spots.slice(0, low ? 3 : 7)) {
        const len = 110 + rng() * 50, w = 14 + rng() * 12;
        for (const ry of [0, Math.PI / 2]) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len).translate(0, len / 2 - 10, 0), rm);
          m.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry + rng()));
          m.position.set(x, Math.max(0, gy(x, z)), z);
          m.renderOrder = 4;
          group.add(m);
        }
      }
      anims.push((t) => { rm.opacity = 0.16 + 0.05 * Math.sin(t * 0.4); });
    }

    windParticles({ kind: 'snow' });
  }

  // ======================================================================== utilidades que usam o estado acima
  /** Manchas de flores (haste + cabeca colorida, instanciadas). */
  function scatterFlowers({ patches, perPatch, near, palette, hMax = 46 }) {
    const stem = flat(new THREE.CylinderGeometry(0.025, 0.035, 0.5, 3).translate(0, 0.25, 0), 0x4f8a35);
    const head = flat(new THREE.SphereGeometry(0.15, 5, 4).scale(1, 0.7, 1).translate(0, 0.52, 0), 0xffffff);
    const sl = [], hl = [], hc = [];
    const cols = palette.map((h) => new THREE.Color(h));
    for (let n = 0, tries = 0; n < patches && tries < patches * 30; tries++) {
      const i = Math.floor(rng() * N);
      if (BRIDGE[i]) continue;
      const sg = rng() < 0.5 ? -1 : 1, c = side(i, sg * (EDGE(i) + near[0] + rng() * (near[1] - near[0])));
      if (!okGround(c.x, c.z, hMax)) continue;
      const col = cols[Math.floor(rng() * cols.length)], col2 = cols[Math.floor(rng() * cols.length)];
      for (let f = 0; f < perPatch; f++) {
        const a = rng() * 6.28, r = Math.pow(rng(), 0.6) * 3.6, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        if (T && (!okGround(x, z, hMax))) continue;
        const h = gy(x, z), s = 0.8 + rng() * 0.8;
        const m = mat4(x, h - 0.05, z, rng() * 6.28, s);
        sl.push(m); hl.push(m); hc.push(rng() < 0.8 ? col : col2);
      }
      n++;
    }
    add(inst(stem, flatMat, sl));
    add(inst(head, flatMat, hl, hc));
  }

  /** Particulas levadas pelo vento ao redor dos carros: folhas (Ponte) ou neve/poeira (Montanha, neve cresce com a altitude). */
  function windParticles({ kind }) {
    const n = count(kind === 'snow' ? 260 : 120), B = 130, HH = 24;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), ph = new Float32Array(n);
    const palette = kind === 'leaves' ? [0x86b84a, 0xd9a43a, 0xc9692e, 0xa4c95a] : [0xffffff];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rng() - 0.5) * B; pos[i * 3 + 1] = rng() * HH; pos[i * 3 + 2] = (rng() - 0.5) * B;
      c.setHex(palette[Math.floor(rng() * palette.length)]); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      ph[i] = rng() * 6.28;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: kind === 'snow' ? 0.5 : 0.8, map: TX.glowTexture('255,255,255'), vertexColors: true, transparent: true, opacity: kind === 'snow' ? 0.85 : 0.9, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    group.add(pts);
    let cx = 0, cy = 0, cz = 0, init = false;
    const dust = new THREE.Color(0xd8c9a0), white = new THREE.Color(0xffffff);
    anims.push((t, dt, cars) => {
      let sx = 0, sy = 0, sz = 0, k = 0;
      for (const car of cars || []) { if (car.dead) continue; sx += car.x; sy += car.y || 0; sz += car.z; k++; }
      if (k) { sx /= k; sy /= k; sz /= k; } else { sx = X[0]; sy = ELEV[0]; sz = Z[0]; }
      if (!init) { cx = sx; cy = sy; cz = sz; init = true; } else { cx += (sx - cx) * Math.min(1, dt * 3); cy += (sy - cy) * Math.min(1, dt * 3); cz += (sz - cz) * Math.min(1, dt * 3); }
      const base = T ? Math.max(gy(cx, cz), 0) : cy;
      if (kind === 'snow') { const f = sm(18, 38, base); m.color.copy(dust).lerp(white, f); m.opacity = 0.35 + 0.55 * f; m.size = 0.38 + 0.2 * f; }
      const wx = kind === 'snow' ? 5.5 : 2.2, wz = kind === 'snow' ? 1.8 : 0.9, fall = kind === 'snow' ? -1.3 : -0.35;
      const a = g.getAttribute('position');
      for (let i = 0; i < n; i++) {
        let x = a.getX(i), y = a.getY(i), z = a.getZ(i);
        x += (wx + Math.sin(t * 1.3 + ph[i]) * 0.9) * dt;
        z += (wz + Math.cos(t * 1.1 + ph[i] * 1.7) * 0.9) * dt;
        y += (fall + Math.sin(t * 2 + ph[i]) * 0.5) * dt;
        const rx = ((x - cx + B / 2) % B + B) % B - B / 2, rz = ((z - cz + B / 2) % B + B) % B - B / 2;
        let ry = y - (base - 1);
        ry = ((ry % HH) + HH) % HH;
        a.setXYZ(i, cx + rx, base - 1 + ry, cz + rz);
      }
      a.needsUpdate = true;
    });
  }

  const rippleT = new WeakMap();
  let last = -1;
  return {
    group,
    update(t, cars = []) {
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
      last = t;
      for (const f of anims) f(t, dt, cars);
      // ondulacao quando um carro cai na agua
      for (const c of cars) {
        if (c.y === undefined || c.y > 0.6 || (rippleT.get(c) || 0) > t) continue;
        const wet = T ? T.waterAt(c.x, c.z) : c.near && track.inWater(c.near);
        if (wet) { ripple(c.x, WATER_Y, c.z, 5, 1.6); rippleT.set(c, t + 0.3); }
      }
    },
  };
}
