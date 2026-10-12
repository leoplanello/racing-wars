// Terreno de montanhas: grade de alturas com a estrada embutida. Puro (roda no sim e no render).
// def.terrain = {
//   box: [x0, z0, x1, z1], cell: 7, reach: 70, noise: 4,
//   rolling: { amp, scale },                                        // colinas suaves nas planicies (longe da pista)
//   peaks: [{ x, z, h, plateau?, r1, power?, spire?, spireH? }],   // massas (cones); altura = h·(1−t)^power, t = (r−plateau)/(r1−plateau)
//   zones: [{ from, to, mode: 'ridge', slope }],                   // fracoes da volta; padrao = 'cut' (estrada cortada na encosta)
//   ocean: { shore: [[x,z]...], polygon: [[x,z]...] },             // mar: poligono (shore = a margem; o resto fecha o poligono)
//   rivers: [{ points: [[x,z]...], width, bank, depth }],          // rios (leito escavado)
// }
// Estrada embutida: perto da pista (ate `reach`) a altura segue o piso (ELEV):
//  cut:   lado da montanha (solidWalls) sobe com o talude (1,1·a) ate a massa; o outro lado cai como falesia (1,2·a);
//  ridge: nos dois lados cai com `slope` (estrada no alto de uma cumeeira), sempre acima da massa.
// Agua = terreno abaixo de -1 (mar, rios, desfiladeiro sob as pontes): `waterAt`. Fossos (`chasms`) viram buracos fundos.

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); };
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

/** Distancia de (x,z) ao segmento a-b. */
const segDist = (x, z, ax, az, bx, bz) => {
  const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(x - (ax + ex * t), z - (az + ez * t));
};
const polyDist = (x, z, pts) => {
  let m = Infinity;
  for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return m;
};
const inPoly = (x, z, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

export const WATER_LEVEL = -1;

export function buildTerrain(track) {
  const def = track.def.terrain;
  if (!def) return null;
  const [x0, z0, x1, z1] = def.box;
  const cell = def.cell ?? 7, reach = def.reach ?? 70, noiseAmp = def.noise ?? 4;
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const H = new Float32Array(nx * nz);
  const ROAD = new Uint8Array(nx * nz); // celula sobre a pista (deck)
  const CORR = new Uint8Array(nx * nz); // celula a menos de edge+12 de qualquer pista (inclui pontes): sem vegetacao
  const RD = new Float32Array(nx * nz).fill(255); // distancia ate a borda da pista mais proxima (so ate `reach`)
  const SANDD = new Float32Array(nx * nz).fill(255); // distancia ate a borda de uma pista de areia (praia)
  const SD = new Float32Array(nx * nz).fill(-999); // distancia com sinal ate a margem do mar (+ dentro do mar)
  const { N, X, Z, NX, NZ, ELEV, BRIDGE, HW, SOLID, CH, CHG, CHW, CHWATER } = track;

  // modo por amostra (0 = cut, 1 = ridge) e inclinacao da cumeeira
  const MODE = new Uint8Array(N), SLOPE = new Float32Array(N).fill(1.2);
  for (const z of def.zones || []) {
    const a = Math.floor(z.from * N);
    let b = Math.ceil(z.to * N);
    if (z.to < z.from) b += N;
    for (let i = a; i < b; i++) { MODE[i % N] = z.mode === 'ridge' ? 1 : 0; SLOPE[i % N] = z.slope ?? 0.7; }
  }

  const roll = def.rolling;
  const baseAt = (x, z) => {
    let b = 0;
    if (roll) { // colinas suaves e largas (so positivas)
      const n = vnoise(x / roll.scale, z / roll.scale) * 0.65 + vnoise(x / (roll.scale * 0.37), z / (roll.scale * 0.37)) * 0.3 + vnoise(x / 23, z / 23) * 0.05;
      b = Math.max(0, (n - 0.32) * 1.5) * roll.amp;
    }
    for (const p of def.peaks || []) {
      const r = Math.hypot(x - p.x, z - p.z), pl = p.plateau || 0;
      const t = Math.max(0, Math.min(1, (r - pl) / (p.r1 - pl || 1)));
      let h = p.h * Math.pow(1 - t, p.power || 1);
      if (p.spire && r < p.spire) h += p.spireH * (1 - r / p.spire) ** 2; // pico
      if (h > b) b = h;
    }
    if (b > 1) { // relevo: rugosidade que cresce com a altura
      const n = (vnoise(x / 42, z / 42) * 0.6 + vnoise(x / 15, z / 15) * 0.3 + vnoise(x / 5.5, z / 5.5) * 0.1 - 0.5) * 2;
      b += n * noiseAmp * Math.min(1, b / 25);
    }
    return Math.max(0, b);
  };

  // hash espacial das amostras de pista (sem pontes: o terreno nao sobe ate o tabuleiro delas)
  const G = 24, grid = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  const TUBE = new Uint8Array(nx * nz); // celulas ao alcance de alguma pista
  const stamp = (arr, i, rad) => {
    const jx0 = Math.max(0, Math.floor((X[i] - rad - x0) / cell)), jx1 = Math.min(nx - 1, Math.ceil((X[i] + rad - x0) / cell));
    const jz0 = Math.max(0, Math.floor((Z[i] - rad - z0) / cell)), jz1 = Math.min(nz - 1, Math.ceil((Z[i] + rad - z0) / cell));
    for (let jz = jz0; jz <= jz1; jz++) for (let jx = jx0; jx <= jx1; jx++) {
      const dx = x0 + jx * cell - X[i], dz = z0 + jz * cell - Z[i];
      if (dx * dx + dz * dz <= rad * rad) arr[jz * nx + jx] = 1;
    }
  };
  // carimba a menor distancia ate a borda da pista (`edge`) nas celulas num raio `rad`
  const stampDist = (arr, i, rad, edge) => {
    const jx0 = Math.max(0, Math.floor((X[i] - rad - x0) / cell)), jx1 = Math.min(nx - 1, Math.ceil((X[i] + rad - x0) / cell));
    const jz0 = Math.max(0, Math.floor((Z[i] - rad - z0) / cell)), jz1 = Math.min(nz - 1, Math.ceil((Z[i] + rad - z0) / cell));
    for (let jz = jz0; jz <= jz1; jz++) for (let jx = jx0; jx <= jx1; jx++) {
      const d = Math.hypot(x0 + jx * cell - X[i], z0 + jz * cell - Z[i]) - edge;
      const k = jz * nx + jx;
      if (d < arr[k]) arr[k] = Math.max(0, d);
    }
  };
  for (let i = 0; i < N; i += 2) {
    if (X[i] < x0 - reach || X[i] > x1 + reach || Z[i] < z0 - reach || Z[i] > z1 + reach) continue;
    stamp(CORR, i, HW[i] + track.verge + 12);
    if (track.SURFACE[i] === 8) stampDist(SANDD, i, 70, HW[i] + track.verge);
    if (BRIDGE[i]) continue;
    const k = key(Math.floor(X[i] / G), Math.floor(Z[i] / G));
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(i);
    if (i % 4 === 0) stamp(TUBE, i, reach);
  }
  const span = Math.ceil(reach / G);
  for (let jz = 0; jz < nz; jz++) {
    for (let jx = 0; jx < nx; jx++) {
      const kk = jz * nx + jx;
      const x = x0 + jx * cell, z = z0 + jz * cell;
      const base = baseAt(x, z);
      let h = base;
      if (TUBE[kk]) {
        let bi = -1, bd = Infinity;
        const cx = Math.floor(x / G), cz = Math.floor(z / G);
        for (let a = -span; a <= span; a++) for (let b = -span; b <= span; b++) {
          const l = grid.get(key(cx + a, cz + b));
          if (!l) continue;
          for (const i of l) {
            const d2 = (x - X[i]) * (x - X[i]) + (z - Z[i]) * (z - Z[i]);
            if (d2 < bd) { bd = d2; bi = i; }
          }
        }
        if (bi >= 0) {
          const d = Math.sqrt(bd);
          if (d < reach) {
            const sg = (x - X[bi]) * NX[bi] + (z - Z[bi]) * NZ[bi] >= 0 ? 1 : -1;
            const a = Math.max(0, d - (HW[bi] + track.verge)), deck = ELEV[bi];
            RD[kk] = a;
            let hr;
            if (a <= 0) { hr = deck; ROAD[kk] = 1; }
            else if (MODE[bi] === 1) hr = Math.max(base, Math.max(0, deck - SLOPE[bi] * a));
            else if (SOLID[bi] & (sg > 0 ? 2 : 1)) hr = Math.max(deck, Math.min(base, deck + 1.1 * a)); // lado da montanha
            else hr = Math.max(0, Math.min(base, deck - 1.2 * a)); // falesia
            h = hr + (base - hr) * smooth(reach * 0.75, reach, d);
            // fosso (precipicio sem agua) ao lado da pista: buraco fundo
            const c = CH[bi];
            if (!ROAD[kk] && c && !CHWATER[bi] && (c === 2 || c === sg) && a > CHG[bi] && a < CHW[bi]) h = Math.min(h, -45);
          }
        }
      }
      H[kk] = h;
    }
  }

  // sob as pontes o terreno fica abaixo do tabuleiro (nunca atravessa a pista) e, onde o vale e baixo, vira desfiladeiro com agua
  const RIVER = track.riverHalf ?? 34;
  const BD = new Float32Array(nx * nz).fill(999); // distancia ate a ponte mais proxima
  for (let i = 0; i < N; i += 2) {
    if (!BRIDGE[i]) continue;
    const rad = RIVER + 24;
    const jx0 = Math.max(0, Math.floor((X[i] - rad - x0) / cell)), jx1 = Math.min(nx - 1, Math.ceil((X[i] + rad - x0) / cell));
    const jz0 = Math.max(0, Math.floor((Z[i] - rad - z0) / cell)), jz1 = Math.min(nz - 1, Math.ceil((Z[i] + rad - z0) / cell));
    for (let jz = jz0; jz <= jz1; jz++) for (let jx = jx0; jx <= jx1; jx++) {
      const k = jz * nx + jx;
      if (ROAD[k]) continue;
      const d = Math.hypot(x0 + jx * cell - X[i], z0 + jz * cell - Z[i]);
      if (d < HW[i] + track.verge + 4) H[k] = Math.min(H[k], ELEV[i] - 2.5); // fora do tabuleiro, abaixo dele
      if (d < BD[k]) BD[k] = d;
    }
  }
  for (let k = 0; k < H.length; k++) {
    if (BD[k] >= 999 || ROAD[k]) continue;
    // desfiladeiro: margens largas e suaves (so onde o vale e baixo; sobre colinas altas nao escava)
    const c = (1 - smooth(RIVER * 0.45, RIVER + 22, BD[k])) * (1 - smooth(3, 9, H[k]));
    if (c > 0) H[k] = H[k] + (-2.6 - H[k]) * c;
  }

  // mar: distancia com sinal ate a margem (+ dentro do mar). Dentro: plataforma rasa e depois mais fundo; fora: praia plana ao redor
  const oc = def.ocean;
  if (oc) {
    let px0 = Infinity, px1 = -Infinity, pz0 = Infinity, pz1 = -Infinity;
    for (const [x, z] of oc.polygon) { px0 = Math.min(px0, x); px1 = Math.max(px1, x); pz0 = Math.min(pz0, z); pz1 = Math.max(pz1, z); }
    let sx0 = Infinity, sx1 = -Infinity, sz0 = Infinity, sz1 = -Infinity;
    for (const [x, z] of oc.shore) { sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x); sz0 = Math.min(sz0, z); sz1 = Math.max(sz1, z); }
    const shore = oc.shore;
    for (let jz = 0; jz < nz; jz++) for (let jx = 0; jx < nx; jx++) {
      const x = x0 + jx * cell, z = z0 + jz * cell, k = jz * nx + jx;
      const inside = x >= px0 && x <= px1 && z >= pz0 && z <= pz1 && inPoly(x, z, oc.polygon);
      // longe da margem (alem de ~190 u) so interessa estar dentro: fundo constante
      const far = x < sx0 - 190 || x > sx1 + 190 || z < sz0 - 190 || z > sz1 + 190;
      if (far && !inside) continue;
      const d = far ? 190 : polyDist(x, z, shore);
      const sd = inside ? d : -d;
      SD[k] = sd;
      if (ROAD[k]) continue;
      if (sd >= 0) {
        const sea = sd < 9 ? -1.9 * smooth(0, 9, sd) : -1.9 - Math.min(12, (sd - 9) * 0.07);
        H[k] = Math.min(H[k], sea);
      } else if (H[k] < 4) {
        // praia: terra baixa ate ~24 u da margem vira plano (nivel 0), com transicao suave para o relevo
        const w = (1 - smooth(22, 36, -sd)) * (1 - smooth(1.5, 4, H[k]));
        H[k] = H[k] * (1 - w) + Math.min(H[k], 0) * w;
      }
    }
  }
  // rios: leito escavado com margens suaves (nao corta a pista)
  for (const rv of def.rivers || []) {
    const half = rv.width / 2, bank = rv.bank ?? 14, depth = rv.depth ?? 2.6;
    const xs = rv.points.map((p) => p[0]), zs = rv.points.map((p) => p[1]);
    const jx0 = Math.max(0, Math.floor((Math.min(...xs) - half - bank - x0) / cell)), jx1 = Math.min(nx - 1, Math.ceil((Math.max(...xs) + half + bank - x0) / cell));
    const jz0 = Math.max(0, Math.floor((Math.min(...zs) - half - bank - z0) / cell)), jz1 = Math.min(nz - 1, Math.ceil((Math.max(...zs) + half + bank - z0) / cell));
    for (let jz = jz0; jz <= jz1; jz++) for (let jx = jx0; jx <= jx1; jx++) {
      const k = jz * nx + jx;
      if (ROAD[k] || CORR[k]) continue;
      const d = polyDist(x0 + jx * cell, z0 + jz * cell, rv.points);
      if (d >= half + bank) continue;
      const t = smooth(half * 0.35, half + bank, d);
      H[k] = Math.min(H[k], -depth + (Math.max(H[k], 0.3) + depth) * t);
    }
  }

  // suaviza as margens (agua, rio, desfiladeiro, praia): um passe de media 3x3 so nas celulas baixas e fora do tabuleiro
  {
    const src = H.slice();
    for (let jz = 1; jz < nz - 1; jz++) for (let jx = 1; jx < nx - 1; jx++) {
      const k = jz * nx + jx, h0 = src[k];
      if (ROAD[k] || h0 < -8 || h0 > 4) continue;
      let sum = 0, wsum = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const kk = k + b * nx + a, hv = src[kk];
        if (hv < -8 || hv > 6 || ROAD[kk]) continue;
        const w = a === 0 && b === 0 ? 4 : a === 0 || b === 0 ? 2 : 1;
        sum += hv * w; wsum += w;
      }
      H[k] = wsum ? sum / wsum : h0;
    }
  }

  const terrain = {
    box: def.box, cell, nx, nz, H, ROAD, CORR, RD, SANDD, SD, baseAt,
    contains(x, z) { return x >= x0 && x <= x1 && z >= z0 && z <= z1; },
    /** Altura bilinear; fora da caixa vale 0. */
    heightAt(x, z) {
      if (x < x0 || x > x1 || z < z0 || z > z1) return 0;
      const fx = (x - x0) / cell, fz = (z - z0) / cell;
      const jx = Math.min(nx - 2, Math.floor(fx)), jz = Math.min(nz - 2, Math.floor(fz));
      const u = fx - jx, v = fz - jz;
      const a = H[jz * nx + jx], b = H[jz * nx + jx + 1], c = H[(jz + 1) * nx + jx], d = H[(jz + 1) * nx + jx + 1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    },
    /** Normal (nx,ny,nz) por diferencas finitas. */
    normalAt(x, z, out = { nx: 0, ny: 1, nz: 0 }) {
      const e = cell;
      const gx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e), gz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
      const l = Math.hypot(gx, 1, gz);
      out.nx = -gx / l; out.ny = 1 / l; out.nz = -gz / l;
      return out;
    },
    /** (x,z) esta sobre agua (mar, rio, desfiladeiro)? */
    waterAt(x, z) { return this.contains(x, z) && this.heightAt(x, z) < WATER_LEVEL; },
    /** Ponto bom para cenario (arvore/pedra): terra firme, pouco inclinada, fora da faixa da pista. */
    sceneryOk(x, z) {
      if (!this.contains(x, z)) return true;
      const jx = Math.round((x - x0) / cell), jz = Math.round((z - z0) / cell), k = jz * nx + jx;
      if (CORR[k]) return false;
      const h = this.heightAt(x, z);
      if (h < -0.3 || h > 6) return false;
      return Math.hypot(this.heightAt(x + 4, z) - this.heightAt(x - 4, z), this.heightAt(x, z + 4) - this.heightAt(x, z - 4)) / 8 < 0.35;
    },
  };
  return terrain;
}
