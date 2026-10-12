// Malha do terreno (sim/terrain.js): cobre todo o mapa. Cor por vertice (pasto, floresta, cascalho, rocha, falesia, neve, areia do fundo
// do mar, leito de rio), x textura de detalhe; agua (mar/rios/desfiladeiro) e um plano translucido sobre o terreno baixo;
// vegetacao decorativa (pinheiros, rochas, tufos) sem colisao. Tudo procedural.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '/sim/rng.js';
import * as TX from './textures.js';
import { makeWaterMaterial } from './water.js';

const hash = (ix, iz) => {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const vnoise = (x, z) => {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); };

const C = (hex) => new THREE.Color(hex);
const PAL = {
  moss: C(0x4f6e35), meadow: C(0x6c8a42), dry: C(0x8d8d58), gravel: C(0x7b766d), forest: C(0x2f4a2b), scree: C(0x77706a),
  rock: C(0x80858f), cliff: C(0x474a55), snow: C(0xf3f7fc), ice: C(0xc9dcee),
  sand: C(0xe3cf9a), dirt: C(0x8e6a46), wetSand: C(0xcdb98a), shallow: C(0x6fb7b0), deep: C(0x123f68), bed: C(0x5b7a62), pit: C(0x090a0f), mud: C(0x6d6a48),
};
/** Cor do terreno a partir de altura, inclinacao e ruido (reaproveitada pelo chao do mundo: h = 0). */
export const GROUND_COLOR = PAL.moss.clone().lerp(PAL.meadow, 0.45);

export function buildTerrainView(track, { low = false, fast = false } = {}) {
  const T = track.terrain;
  const { nx, nz, cell, H, ROAD, CORR } = T;
  const [x0, z0, x1, z1] = T.box;
  let pk = 1;
  for (let i = 0; i < H.length; i++) if (H[i] > pk && H[i] < 200) pk = H[i];

  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), rockA = new Float32Array(nx * nz);
  const c = new THREE.Color();
  const hAt = (jx, jz) => H[Math.max(0, Math.min(nz - 1, jz)) * nx + Math.max(0, Math.min(nx - 1, jx))];
  const { RD, SANDD, SD } = T;
  const verge = track.def.dirtVerge !== false;
  for (let jz = 0; jz < nz; jz++) {
    for (let jx = 0; jx < nx; jx++) {
      const k = jz * nx + jx;
      const x = x0 + jx * cell, z = z0 + jz * cell;
      const h = H[k];
      // a pista fica um tico acima do terreno para nao brigar com o piso
      pos[k * 3] = x; pos[k * 3 + 1] = ROAD[k] ? h - 0.35 : h; pos[k * 3 + 2] = z;
      uv[k * 2] = x / 11; uv[k * 2 + 1] = z / 11;
      const gx = (hAt(jx + 1, jz) - hAt(jx - 1, jz)) / (2 * cell), gz = (hAt(jx, jz + 1) - hAt(jx, jz - 1)) / (2 * cell);
      const slope = 1 - 1 / Math.hypot(gx, 1, gz); // 0 = plano, 1 = vertical
      const n = hash(jx, jz), patch = vnoise(x / 70, z / 70), patch2 = vnoise(x / 190 + 9, z / 190 - 4), wob = vnoise(x / 9, z / 9);
      let rock = 0;
      if (h < -20) c.copy(PAL.pit);
      else if (h < -0.25) {
        // fundo do mar / rio: areia -> verde-agua -> azul fundo (a agua e translucida e deixa ver o fundo); nunca pasto
        c.copy(PAL.wetSand).lerp(PAL.shallow, sm(0.2, 2.4, -h)).lerp(PAL.deep, sm(2.4, 12, -h));
        if (h > -3.4 && SD[k] < -900) c.lerp(PAL.bed, 0.25); // leito de rio/desfiladeiro (fora do mar)
      } else {
        const rel = h / pk;
        // chao baixo: manchas de musgo, pasto, capim seco e cascalho
        c.copy(PAL.moss).lerp(PAL.meadow, sm(0.35, 0.7, patch)).lerp(PAL.dry, sm(0.55, 0.85, patch2) * 0.7).lerp(PAL.gravel, sm(0.72, 0.95, patch) * 0.45);
        // altitude: floresta -> cascalho -> rocha -> gelo/neve
        c.lerp(PAL.forest, sm(0.02, 0.14, rel) * (1 - sm(0.22, 0.34, rel)) * 0.9);
        c.lerp(PAL.scree, sm(0.18, 0.36, rel));
        c.lerp(PAL.rock, sm(0.32, 0.52, rel));
        const steep = sm(0.1, 0.27, slope) * sm(0.3, 4.5, h); // margens baixas nao viram falesia escura
        c.lerp(PAL.cliff, steep * 0.88);
        if (steep > 0.25) c.multiplyScalar(0.86 + 0.14 * Math.sin(h * 1.9 + patch2 * 7)); // estratos horizontais nas paredes
        const snow = sm(0.58 + steep * 0.2, 0.7 + steep * 0.2, rel);
        c.lerp(PAL.ice, snow * 0.4).lerp(PAL.snow, snow);
        rock = Math.max(sm(0.2, 0.45, rel), steep);
        c.lerp(PAL.mud, (1 - sm(0.0, 1.6, h)) * 0.55); // barro umido logo acima da linha d'agua
        // praia: areia ao redor da margem do mar e das estradas de areia, com a borda irregular (transicao suave para o pasto)
        const sdl = SD[k] > -900 ? -SD[k] : 999; // distancia da margem, do lado de terra
        const sandNear = 1 - sm(14 + wob * 8, 40 + wob * 14, Math.min(sdl, SANDD[k]));
        if (sandNear > 0) { const sc = PAL.sand.clone().lerp(PAL.wetSand, sm(8, 0, sdl) * 0.6 + n * 0.1); c.lerp(sc, sandNear * (1 - steep)); rock *= 1 - sandNear; }
      }
      // acostamento: perto da pista o chao puxa para a cor do caminho (a borda da estrada some no terreno)
      if (verge && RD[k] < 14 && h > -0.25 && rock < 0.8) {
        const dv = 1 - sm(1, 11 + wob * 5, RD[k]);
        c.lerp(PAL.dirt, dv * 0.55 * (1 - Math.min(1, SANDD[k] < 60 ? 1 : 0)));
      }
      c.multiplyScalar(0.92 + n * 0.16);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      rockA[k] = rock;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let jz = 0; jz < nz - 1; jz++) {
    for (let jx = 0; jx < nx - 1; jx++) {
      const a = jz * nx + jx, b = a + 1, d = a + nx, e = d + 1;
      idx[q++] = a; idx[q++] = d; idx[q++] = b; idx[q++] = b; idx[q++] = d; idx[q++] = e;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aRock', new THREE.BufferAttribute(rockA, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // material: detalhe de pasto nas partes planas e de rocha nas encostas (misturados por vertice), mais uma escala grande para quebrar a repeticao
  const grassMap = TX.grassDetailTexture();
  const tmat = new THREE.MeshStandardMaterial({ vertexColors: true, map: TX.rockDetailTexture(), roughness: 1 });
  const NL = String.fromCharCode(10);
  tmat.onBeforeCompile = (sh) => {
    sh.uniforms.grassMap = { value: grassMap };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', ['#include <common>', 'attribute float aRock;', 'varying float vRock;'].join(NL))
      .replace('#include <begin_vertex>', ['#include <begin_vertex>', 'vRock = aRock;'].join(NL));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', ['#include <common>', 'uniform sampler2D grassMap;', 'varying float vRock;'].join(NL))
      .replace('#include <map_fragment>', [
        'vec4 rockD = texture2D( map, vMapUv );',
        'vec4 grassD = texture2D( grassMap, vMapUv * 1.7 );',
        'float macro = 0.8 + 0.4 * texture2D( map, vMapUv * 0.13 ).r;',
        'diffuseColor *= mix( grassD, rockD, vRock ) * macro;',
      ].join(NL));
  };
  const mesh = new THREE.Mesh(g, tmat);
  mesh.receiveShadow = true;
  mesh.castShadow = !low;

  // agua: malha na altura do mar sobre o terreno baixo; a profundidade (aDepth) e interpolada por fragmento e o shader
  // (water.js) cuida da cor, da borda suave e da espuma: a margem segue a isolinha, sem degraus de grade
  const WL = -1.1;
  const wpos = new Float32Array(nx * nz * 3), wuv = new Float32Array(nx * nz * 2), wdep = new Float32Array(nx * nz);
  for (let jz = 0; jz < nz; jz++) {
    for (let jx = 0; jx < nx; jx++) {
      const k = jz * nx + jx;
      wpos[k * 3] = x0 + jx * cell; wpos[k * 3 + 1] = WL; wpos[k * 3 + 2] = z0 + jz * cell;
      wuv[k * 2] = (x0 + jx * cell) / 60; wuv[k * 2 + 1] = (z0 + jz * cell) / 60;
      wdep[k] = Math.max(-3, WL - H[k]);
    }
  }
  const widx = [];
  for (let jz = 0; jz < nz - 1; jz++) for (let jx = 0; jx < nx - 1; jx++) {
    const a = jz * nx + jx, b = a + 1, d = a + nx, e = d + 1;
    if (H[a] > WL + 1 && H[b] > WL + 1 && H[d] > WL + 1 && H[e] > WL + 1) continue; // terra firme: sem agua
    widx.push(a, d, b, b, d, e);
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
  wg.setAttribute('uv', new THREE.BufferAttribute(wuv, 2));
  wg.setAttribute('aDepth', new THREE.BufferAttribute(wdep, 1));
  wg.setIndex(new THREE.BufferAttribute(new Uint32Array(widx), 1));
  wg.computeVertexNormals();
  const waterMat = makeWaterMaterial({ depth: true });
  const water = new THREE.Mesh(wg, waterMat);
  water.renderOrder = 2;
  water.receiveShadow = true;

  // vegetacao decorativa (sem colisao)
  const decor = new THREE.Group();
  if (!fast) {
    const rng = makeRng(417);
    const flat = (geo, hex) => { const gg = geo.toNonIndexed(); const cc = new THREE.Color(hex); const n = gg.getAttribute('position').count; const arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; } gg.setAttribute('color', new THREE.BufferAttribute(arr, 3)); gg.deleteAttribute('uv'); return gg; };
    const mkPine = (c1, c2, c3) => mergeGeometries([
      flat(new THREE.CylinderGeometry(0.5, 0.8, 4, 6).translate(0, 2, 0), 0x6a4528),
      flat(new THREE.ConeGeometry(4.2, 6, 7).translate(0, 6.5, 0), c1),
      flat(new THREE.ConeGeometry(3.2, 5.5, 7).translate(0, 10, 0), c2),
      flat(new THREE.ConeGeometry(2.1, 5, 7).translate(0, 13.5, 0), c3),
    ]);
    const pineA = mkPine(0x23472c, 0x2a5333, 0x2f5c38), pineB = mkPine(0x31602f, 0x3a7137, 0x468443);
    // pinheiros em manchas (bosques), nos taludes e planicies sem chegar perto da pista
    const sand = (x, z) => track.nearSurface(x, z, 8, 120);
    const want = low ? 700 : 2400, listA = [], listB = [];
    let guard = want * 30;
    while (listA.length + listB.length < want && guard-- > 0) {
      const jx = 2 + Math.floor(rng() * (nx - 5)), jz = 2 + Math.floor(rng() * (nz - 5)), k = jz * nx + jx, h = H[k];
      if (h < 0.4 || h > pk * 0.5 || CORR[k]) continue;
      const x = x0 + (jx + rng() - 0.5) * cell, z = z0 + (jz + rng() - 0.5) * cell;
      if (vnoise(x / 120, z / 120) < 0.4 + rng() * 0.12) continue; // so dentro de bosques
      const gx = (hAt(jx + 1, jz) - hAt(jx - 1, jz)) / (2 * cell), gz = (hAt(jx, jz + 1) - hAt(jx, jz - 1)) / (2 * cell);
      if (Math.hypot(gx, gz) > 0.8 || sand(x, z)) continue;
      (rng() < 0.35 ? listB : listA).push([x, h - 0.3, z, 0.7 + rng() * 0.9, rng() * 6.28]);
    }
    // floresta densa ao redor da ponte alta (vale e encostas ao longo dela)
    {
      const bs = [];
      for (let i = 0; i < track.N; i += 6) if (track.BRIDGE[i] && track.ELEV[i] > 6) bs.push(i);
      const extra = low ? 500 : 2600;
      let tried = extra * 40, got = 0;
      while (bs.length && got < extra && tried-- > 0) {
        const i = bs[Math.floor(rng() * bs.length)];
        const along = (rng() - 0.5) * 70, lat = (rng() < 0.5 ? -1 : 1) * (14 + Math.pow(rng(), 0.8) * 230);
        const x = track.X[i] + track.NX[i] * lat + track.TX[i] * along, z = track.Z[i] + track.NZ[i] * lat + track.TZ[i] * along;
        const jx = Math.round((x - x0) / cell), jz = Math.round((z - z0) / cell);
        if (jx < 2 || jz < 2 || jx > nx - 3 || jz > nz - 3) continue;
        const k = jz * nx + jx, h = H[k];
        if (h < 0.3 || h > pk * 0.55 || CORR[k]) continue;
        const gx = (hAt(jx + 1, jz) - hAt(jx - 1, jz)) / (2 * cell), gz = (hAt(jx, jz + 1) - hAt(jx, jz - 1)) / (2 * cell);
        if (Math.hypot(gx, gz) > 0.85) continue;
        (rng() < 0.4 ? listB : listA).push([x, track.terrain.heightAt(x, z) - 0.3, z, 0.8 + rng() * 1.0, rng() * 6.28]);
        got++;
      }
    }
    const inst = (geo, list, mat) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      list.forEach(([x, y, z, s, yaw], i) => { e.set(0, yaw, 0); qt.setFromEuler(e); im.setMatrixAt(i, m4.compose(p.set(x, y, z), qt, sc.set(s, s * (0.9 + rng() * 0.4), s))); });
      im.count = list.length;
      im.castShadow = !low;
      return im;
    };
    const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    decor.add(inst(pineA, listA, pineMat), inst(pineB, listB, pineMat));

    // rochas e pedregulhos nos taludes e nas margens
    const rockList = [];
    guard = (low ? 200 : 700) * 30;
    while (rockList.length < (low ? 200 : 700) && guard-- > 0) {
      const jx = 2 + Math.floor(rng() * (nx - 5)), jz = 2 + Math.floor(rng() * (nz - 5)), k = jz * nx + jx, h = H[k];
      if (h < -0.2 || h > pk * 0.75 || CORR[k]) continue;
      const x = x0 + (jx + rng() - 0.5) * cell, z = z0 + (jz + rng() - 0.5) * cell;
      const gx = (hAt(jx + 1, jz) - hAt(jx - 1, jz)) / (2 * cell), gz = (hAt(jx, jz + 1) - hAt(jx, jz - 1)) / (2 * cell);
      const slope = Math.hypot(gx, gz);
      if (slope < 0.12 && rng() < 0.8) continue; // mais rochas nas encostas
      rockList.push([x, h - 0.1, z, 0.6 + rng() * 1.8, rng() * 6.28]);
    }
    const rg = new THREE.DodecahedronGeometry(1.5, 0).scale(1.3, 0.8, 1);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b8e97, roughness: 1, flatShading: true });
    decor.add(inst(rg, rockList, rockMat));

    // tufos de capim nos pastos (planos cruzados com alfa)
    const gt = new THREE.PlaneGeometry(2.6, 2.0).translate(0, 1.0, 0);
    const cross = mergeGeometries([gt.clone(), gt.clone().rotateY(Math.PI / 2), gt.clone().rotateY(Math.PI / 4)]);
    const tm = new THREE.MeshStandardMaterial({ map: TX.tuftTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
    const tl = [];
    guard = (low ? 900 : 3200) * 30;
    while (tl.length < (low ? 900 : 3200) && guard-- > 0) {
      const jx = 2 + Math.floor(rng() * (nx - 5)), jz = 2 + Math.floor(rng() * (nz - 5)), k = jz * nx + jx, h = H[k];
      if (h < 0.2 || h > 22 || CORR[k]) continue;
      const x = x0 + (jx + rng() - 0.5) * cell, z = z0 + (jz + rng() - 0.5) * cell;
      if (sand(x, z) || vnoise(x / 60 + 3, z / 60) < 0.38) continue;
      tl.push([x, h, z, 0.7 + rng() * 0.9, rng() * 6.28]);
    }
    const tufts = inst(cross, tl, tm);
    const tint = new THREE.Color();
    tl.forEach((_, i) => { tint.setHSL(0.22 + rng() * 0.1, 0.5, 0.45 + rng() * 0.3); tufts.setColorAt(i, tint); });
    tufts.castShadow = false;
    decor.add(tufts);
  }
  return { mesh, water, waterMat, decor };
}
