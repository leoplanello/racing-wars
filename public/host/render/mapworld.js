// Desenho de uma pista importada do SRB2Kart: pisos e tetos dos setores (com rampas), paredes (superior/inferior/meio),
// pisos 3D (FOF: topo, base e lados) e agua. Uma malha por textura; as texturas vem dos PNG exportados por
// tools/srb2kart/build.js (public/tracks/srb2kart/tex). Sem texturas o jogo desenha cores lisas.
import * as THREE from 'three';

const SKY = 'F_SKY1';
const safe = (n) => n.replace(/[^A-Za-z0-9_-]/g, (c) => '~' + c.charCodeAt(0).toString(16));
const MISSING = 0x6a6a6a; // textura/flat que o jogo original nao tem (ou nome de som/numero): cinza neutro, nunca cor aleatoria
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };

/** Aquece o cache do navegador com as texturas de uma pista (pre-carga da proxima pista do campeonato). */
export function preloadMapAssets(d, base = 'tracks/srb2kart/') {
  for (const [kind, set] of [['t', d.tex], ['f', d.flat]]) {
    for (const name of Object.keys(set || {})) { const im = new Image(); im.src = `${base}tex/${kind}_${safe(name)}.png`; }
  }
  for (const key of Object.keys(d.spr || {})) { const im = new Image(); im.src = `${base}tex/s_${safe(key)}.png`; }
}

export function buildMapWorld(track, opts = {}) {
  const w = track.map, d = w.d, s = d.scale, inv = 1 / s;
  const base = opts.base || 'tracks/srb2kart/';
  const group = new THREE.Group();
  const loader = new THREE.TextureLoader();
  const texCache = new Map();
  const animMats = [], scrollers = [];
  const loadTex = (kind, name) => {
    const t = loader.load(`${base}tex/${kind}_${safe(name)}.png`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const getTex = (kind, name, info) => {
    const key = kind + name;
    if (texCache.has(key)) return texCache.get(key);
    const t = loader.load(`${base}tex/${kind}_${safe(name)}.png`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
    return t;
  };

  // ---- acumuladores por material (textura)
  const acc = new Map();
  // `ceil`: face voltada para baixo (teto, base de piso 3D): so se ve por baixo, entao a camera aerea enxerga os carros atraves dela
  // `alpha` < 1: translucido (agua, piso 3D translucido); `scroll` {du,dv} (texels/s): parede que rola (linedefs 500/501)
  const get = (kind, name, info, tint = null, ceil = false, alpha = 1, scroll = null) => {
    const key = kind + ':' + name + (info ? '' : ':' + tint) + (ceil ? ':ceil' : '') + (alpha < 1 ? ':a' + alpha.toFixed(2) : '') + (scroll ? `:s${scroll.du.toFixed(1)},${scroll.dv.toFixed(1)}` : '');
    let a = acc.get(key);
    if (!a) { a = { kind, name, info, tint, ceil, alpha, scroll, anim: (info && d.anim && d.anim[kind] && d.anim[kind][name]) || null, pos: [], uv: [], col: [] }; acc.set(key, a); }
    return a;
  };
  const sectors = d.sectors;
  const ctrlSet = new Set(d.fofs.map((f) => f.ctrl));
  // o jogo escurece em espaco de gama (indice da paleta); o fator de vertice e linear sobre textura sRGB, entao a curva precisa ser elevada
  const light = (si) => { const l = Math.max(0, Math.min(255, sectors[si]?.light ?? 200)); return 0.12 + 0.98 * Math.pow(l / 255, 1.6); };

  // vertice -> (x,z)
  const V = d.geo.v;
  const vx = (i) => V[i * 2], vz = (i) => V[i * 2 + 1];
  const ph = (p, x, z) => p[0] * x + p[1] * z + p[2];

  const tri = (a, x0, y0, z0, x1, y1, z1, x2, y2, z2, br, flat, size) => {
    if (a.ceil) { // garante a normal para baixo (a triangulacao nao tem sentido uniforme)
      const ny = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0);
      if (ny > 0) { [x1, y1, z1, x2, y2, z2] = [x2, y2, z2, x1, y1, z1]; }
    }
    a.pos.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
    for (const [x, z] of [[x0, z0], [x1, z1], [x2, z2]]) a.uv.push(x / (s * size), -z / (s * size)); // flats alinhados ao mapa (1 texel = 1 unidade)
    for (let k = 0; k < 3; k++) a.col.push(br, br, br);
  };

  // FOF decorativo visivel: intangivel (220-222) sem efeito de setor (223 e os com special de morte/etc. sao zonas invisiveis)
  const decorative = (f) => f.kind === 'intangible' && f.line !== 223 && f.line !== 146 && (f.sp & 15) === 0 && f.topPic !== SKY;
  // translucidos: 140-142 (opacidade = luz do setor de controle) e os intangiveis decorativos
  const fofAlpha = (f) => (decorative(f) ? 0.5 : f.line >= 140 && f.line <= 142 ? Math.max(0.2, Math.min(0.9, (sectors[f.ctrl]?.light ?? 128) / 255)) : 1);

  // ---- pisos e tetos dos setores; topo/base dos FOFs
  for (const key of Object.keys(d.geo.tri)) {
    const si = +key, S = sectors[si];
    if (ctrlSet.has(si)) continue;
    const T = d.geo.tri[key], br = light(si);
    if (S.f >= S.c - 1e-3 && !S.fs && !S.cs && !S.fofs.length) continue; // piso = teto: setor de controle/degenerado (nao e visivel)
    const flat = (name, ceil = false) => { const info = d.flat[name]; return info ? get('f', name, info, null, ceil) : get('c', 'missing', null, MISSING, ceil); };
    if (S.fp !== SKY) {
      const a = flat(S.fp), size = a.info ? a.info.w : 64;
      for (let i = 0; i < T.length; i += 3) {
        const [p, q, r] = [T[i], T[i + 1], T[i + 2]];
        const y = (k) => (S.fs ? ph(S.fs, vx(k), vz(k)) : S.f);
        tri(a, vx(p), y(p), vz(p), vx(q), y(q), vz(q), vx(r), y(r), vz(r), br, true, size);
      }
    }
    if (S.cp !== SKY) {
      const a = flat(S.cp, true), size = a.info ? a.info.w : 64;
      for (let i = 0; i < T.length; i += 3) {
        const [p, q, r] = [T[i], T[i + 1], T[i + 2]];
        const y = (k) => (S.cs ? ph(S.cs, vx(k), vz(k)) : S.c);
        tri(a, vx(p), y(p), vz(p), vx(r), y(r), vz(r), vx(q), y(q), vz(q), br * 0.9, true, size);
      }
    }
    for (const fi of S.fofs) {
      const f = d.fofs[fi];
      if (f.kind !== 'solid' && f.kind !== 'water' && f.kind !== 'reverse' && !decorative(f)) continue;
      const fa = fofAlpha(f);
      const topH = (k) => (typeof f.t === 'number' ? f.t : ph(f.t, vx(k), vz(k)));
      const botH = (k) => (typeof f.b === 'number' ? f.b : ph(f.b, vx(k), vz(k)));
      if (f.kind === 'water') {
        // agua: o flat do topo do setor de controle (FWATERn etc., animado), translucido
        const a = f.topPic !== SKY && d.flat[f.topPic] ? get('f', f.topPic, d.flat[f.topPic], null, false, 0.62) : get('w', 'water', null, 0);
        for (let i = 0; i < T.length; i += 3) tri(a, vx(T[i]), topH(T[i]), vz(T[i]), vx(T[i + 1]), topH(T[i + 1]), vz(T[i + 1]), vx(T[i + 2]), topH(T[i + 2]), vz(T[i + 2]), br, true, a.info ? a.info.w : 64);
        continue;
      }
      // topo/base de FOF com F_SKY1 (ou sem flat) nao se desenha como chao: o ceu nao tem textura
      const faceOf = (pic, ceil = false) => (pic === SKY ? null : d.flat[pic] ? get('f', pic, d.flat[pic], null, ceil, fa) : get('c', 'missing', null, MISSING, ceil, fa));
      const ta = faceOf(f.topPic), ba = faceOf(f.botPic, true);
      for (let i = 0; i < T.length; i += 3) {
        const [p, q, r] = [T[i], T[i + 1], T[i + 2]];
        if (ta) tri(ta, vx(p), topH(p), vz(p), vx(q), topH(q), vz(q), vx(r), topH(r), vz(r), br, true, ta.info ? ta.info.w : 64);
        if (ba) tri(ba, vx(p), botH(p), vz(p), vx(r), botH(r), vz(r), vx(q), botH(q), vz(q), br * 0.8, true, ba.info ? ba.info.w : 64);
      }
    }
  }

  // ---- paredes
  const quad = (a, ax, az, bx, bz, yAlo, yAhi, yBlo, yBhi, uA, uB, vAlo, vAhi, vBlo, vBhi, br) => {
    if (yAhi - yAlo < 1e-4 && yBhi - yBlo < 1e-4) return;
    a.pos.push(ax, yAlo, az, bx, yBlo, bz, bx, yBhi, bz, ax, yAlo, az, bx, yBhi, bz, ax, yAhi, az);
    a.uv.push(uA, vAlo, uB, vBlo, uB, vBhi, uA, vAlo, uB, vBhi, uA, vAhi);
    for (let k = 0; k < 6; k++) a.col.push(br, br, br);
  };
  const texOf = (name, alpha = 1, scroll = null) => { const info = d.tex[name]; return info ? get('t', name, info, null, false, alpha, scroll) : get('c', 'missing', null, MISSING, false, alpha); };

  /** Desenha os trechos visiveis de uma face do linedef: `me` = setor deste lado, `ot` = do outro (-1 = nenhum), sd = sidedef. */
  const wallSide = (l, me, ot, sdIdx, rev) => {
    const sd = d.sides[sdIdx];
    if (!sd || me < 0) return;
    let [x1, z1, x2, z2] = [l[0], l[1], l[2], l[3]];
    if (rev) [x1, z1, x2, z2] = [x2, z2, x1, z1]; // o verso corre de v2 para v1
    const len = Math.hypot(x2 - x1, z2 - z1) * inv;
    const flags = l[4], twosided = ot >= 0;
    const M = sectors[me];
    const fl = (S, x, z) => (S.fs ? ph(S.fs, x, z) : S.f), ce = (S, x, z) => (S.cs ? ph(S.cs, x, z) : S.c);
    const mfA = fl(M, x1, z1), mfB = fl(M, x2, z2), mcA = ce(M, x1, z1), mcB = ce(M, x2, z2);
    const br = light(me);
    const xoff = sd[3], yoff = sd[4];
    // `clip` (meio de linha de dois lados): a textura vale UMA vez, so na sua altura (topo = ancora + deslocamento), como no Doom
    // linedefs 500/501 (scroll de textura): velocidade vem do vetor da linha (SRB2: dx>>5 por tic = 35 tics/s)
    const sp = l[5];
    const scroll = sp === 500 || sp === 501 ? { du: (sp === 500 ? -1 : 1) * ((l[2] - l[0]) * inv * 35) / 32 * (rev ? -1 : 1), dv: ((l[3] - l[1]) * inv * 35) / 32 } : null;
    const emit = (name, yAlo, yAhi, yBlo, yBhi, anchorMapTop, clip = false) => {
      if (!name || name === '-' || name[0] === '#' || /^(\d+|DS\w*)$/.test(name)) return; // nomes de som/numero (specials) nao sao textura
      const a = texOf(name, 1, scroll), info = a.info, tw = info ? info.w : 64, th = info ? info.h : 64;
      const uA = (xoff) / tw, uB = (xoff + len) / tw;
      const v = (y) => 1 - (anchorMapTop - y * inv + yoff) / th;
      if (clip) {
        const yTop = (anchorMapTop + yoff) * s, yBot = yTop - th * s;
        yAlo = Math.max(yAlo, yBot); yBlo = Math.max(yBlo, yBot);
        yAhi = Math.min(yAhi, yTop); yBhi = Math.min(yBhi, yTop);
        if (yAhi <= yAlo && yBhi <= yBlo) return;
      }
      quad(a, x1, z1, x2, z2, yAlo, yAhi, yBlo, yBhi, uA, uB, v(yAlo), v(yAhi), v(yBlo), v(yBhi), br);
    };
    if (!twosided) {
      // meio de uma parede de um lado: do piso ao teto
      const top = ((mcA + mcB) / 2) * inv, bot = ((mfA + mfB) / 2) * inv;
      const anchor = flags & 16 ? bot + (d.tex[sd[2]]?.h ?? 64) : top;
      emit(sd[2], mfA, mcA, mfB, mcB, anchor);
      return;
    }
    const O = sectors[ot];
    const ofA = fl(O, x1, z1), ofB = fl(O, x2, z2), ocA = ce(O, x1, z1), ocB = ce(O, x2, z2);
    // inferior: o outro piso e mais alto
    if (ofA > mfA + 1e-4 || ofB > mfB + 1e-4) {
      if (!(O.fp === SKY && M.fp === SKY)) {
        const hiTop = Math.max(ofA, ofB) * inv;
        const anchor = flags & 16 ? Math.max((mcA + mcB) / 2, (ocA + ocB) / 2) * inv : hiTop;
        emit(sd[1], mfA, Math.max(mfA, ofA), mfB, Math.max(mfB, ofB), anchor);
      }
    }
    // superior: o outro teto e mais baixo (nao se os dois forem ceu)
    if ((ocA < mcA - 1e-4 || ocB < mcB - 1e-4) && !(O.cp === SKY && M.cp === SKY)) {
      const lowC = Math.min(ocA, ocB) * inv, hiC = Math.max(mcA, mcB) * inv;
      const th = d.tex[sd[0]]?.h ?? 64;
      const anchor = flags & 8 ? hiC : lowC + th;
      emit(sd[0], Math.min(mcA, ocA), mcA, Math.min(mcB, ocB), mcB, anchor);
    }
    // meio de linha de dois lados (grades, janelas): entre os dois pisos e os dois tetos
    if (sd[2] && sd[2] !== '-' && d.tex[sd[2]]) {
      const loA = Math.max(mfA, ofA), loB = Math.max(mfB, ofB), hiA = Math.min(mcA, ocA), hiB = Math.min(mcB, ocB);
      if (hiA > loA || hiB > loB) {
        const th = d.tex[sd[2]].h;
        const anchor = flags & 16 ? Math.max(loA, loB) * inv + th : Math.min(hiA, hiB) * inv;
        emit(sd[2], loA, Math.max(loA, hiA), loB, Math.max(loB, hiB), anchor, true);
      }
    }
  };
  for (const l of d.lines) {
    const front = l[6], back = l[7];
    if ((front >= 0 && ctrlSet.has(front)) || (back >= 0 && ctrlSet.has(back))) continue;
    if (front === back && front >= 0) {
      // mesmo setor dos dois lados (grades, cercas, trilhos): so a textura do meio; o verso so entra se for outra textura
      wallSide(l, front, back, l[9], false);
      if (d.sides[l[10]] && d.sides[l[10]][2] !== d.sides[l[9]]?.[2]) wallSide(l, back, front, l[10], true);
      continue;
    }
    if (front >= 0) wallSide(l, front, back, l[9], false);
    if (back >= 0) wallSide(l, back, front, l[10], true);
  }

  // ---- lados dos FOFs: a base ao topo ao longo do contorno do setor (textura = parede do linedef de controle)
  const sectorLines = new Map();
  d.lines.forEach((l) => {
    for (const si of [l[6], l[7]]) if (si >= 0) { if (!sectorLines.has(si)) sectorLines.set(si, []); sectorLines.get(si).push(l); }
  });
  sectors.forEach((S, si) => {
    if (ctrlSet.has(si)) return;
    for (const fi of S.fofs) {
      const f = d.fofs[fi];
      if (f.kind !== 'solid' && f.kind !== 'reverse' && !decorative(f)) continue;
      const a = f.tex && f.tex !== '-' ? texOf(f.tex, fofAlpha(f)) : get('c', 'fof', null, 0x707070, false, fofAlpha(f));
      const th = a.info ? a.info.h : 64, tw = a.info ? a.info.w : 64;
      for (const l of sectorLines.get(si) || []) {
        if (l[6] === l[7]) continue;
        const other = l[6] === si ? l[7] : l[6];
        if (other >= 0 && sectors[other].fofs.includes(fi)) continue; // o mesmo piso 3D continua do outro lado: parede interna (z-fighting)
        const [x1, z1, x2, z2] = l[6] === si ? [l[0], l[1], l[2], l[3]] : [l[2], l[3], l[0], l[1]];
        const len = Math.hypot(x2 - x1, z2 - z1) * inv;
        const tA = typeof f.t === 'number' ? f.t : ph(f.t, x1, z1), tB = typeof f.t === 'number' ? f.t : ph(f.t, x2, z2);
        const bA = typeof f.b === 'number' ? f.b : ph(f.b, x1, z1), bB = typeof f.b === 'number' ? f.b : ph(f.b, x2, z2);
        const anchor = tA * inv;
        const v = (y) => 1 - (anchor - y * inv) / th;
        quad(a, x1, z1, x2, z2, bA, tA, bB, tB, 0, len / tw, v(bA), v(tA), v(bB), v(tB), light(si));
      }
    }
  });

  // ---- malhas
  let tris = 0;
  for (const a of acc.values()) {
    if (!a.pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
    g.computeBoundingSphere();
    let mat;
    const side = a.ceil ? THREE.FrontSide : THREE.DoubleSide, trans = a.alpha < 1;
    const common = { vertexColors: true, side, toneMapped: false, transparent: trans, opacity: a.alpha, depthWrite: !trans };
    if (a.kind === 'w') mat = new THREE.MeshBasicMaterial({ color: 0x3a7bd5, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    else if (a.info) {
      const tex = a.scroll ? loadTex(a.kind, a.name) : getTex(a.kind, a.name, a.info); // textura propria: o deslocamento (scroll) nao pode ser compartilhado
      mat = new THREE.MeshBasicMaterial({ ...common, map: tex, alphaTest: a.info.a ? 0.5 : 0 });
      if (a.scroll) scrollers.push({ tex, du: a.scroll.du / a.info.w, dv: a.scroll.dv / a.info.h });
      if (a.anim) {
        const tbl = a.kind === 'f' ? d.flat : d.tex;
        animMats.push({ mat, frames: a.anim.frames.map((fr) => getTex(a.kind, fr, tbl[fr])), tics: a.anim.tics, i0: a.anim.i0, cur: -1 });
      }
    } else mat = new THREE.MeshBasicMaterial({ ...common, color: a.tint || 0x808080 });
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    group.add(m);
    tris += a.pos.length / 9;
  }

  const sprites = buildProps(d, loader, base, light);
  if (sprites) group.add(sprites.group);

  const noop = () => {};
  return {
    group, tris, materials: acc.size,
    gantry: { countdown: noop, go: noop, off: noop },
    breakFencesIn: () => [],
    props: null, burnPump: noop, hideScenery: noop, freezeScenery: noop, restoreScenery: noop,
    // texturas animadas (ANIMDEFS: agua, lava, cachoeiras, luzes) e paredes que rolam; 35 tics/s como no jogo
    update: (time) => {
      for (const m of animMats) {
        const k = (Math.floor((time * 35) / m.tics) + m.i0) % m.frames.length;
        if (k !== m.cur) { m.cur = k; m.mat.map = m.frames[k]; }
      }
      if (sprites) sprites.update(time);
      if (sprites) sprites.update(time);
      for (const sc of scrollers) { sc.tex.offset.x = (time * sc.du) % 1; sc.tex.offset.y = (time * sc.dv) % 1; }
      return [];
    },
  };
}

/**
 * Objetos do mapa (cenario, molas...): sprites do jogo original, sempre de frente para a camera (so em torno do eixo vertical, como o
 * SRB2). Uma InstancedMesh por quadro de cada tipo; os tipos animados alternam a visibilidade dos quadros (tics de 1/35 s).
 * O vertice faz o billboard (funciona com qualquer camera, inclusive a tela dividida) e a neblina da cena e aplicada.
 */
function buildProps(d, loader, base, light) {
  if (!d.props || !d.props.length) return null;
  const s = d.scale;
  const group = new THREE.Group();
  const types = new Map(); // doomednum -> { frames: [{ meshes }], period tics por quadro }
  const byType = new Map();
  for (const p of d.props) { if (!byType.has(p[0])) byType.set(p[0], []); byType.get(p[0]).push(p); }
  const texCache = new Map();
  const tex = (key) => {
    if (texCache.has(key)) return texCache.get(key);
    const t = loader.load(`${base}tex/s_${safe(key)}.png`);
    t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
    texCache.set(key, t);
    return t;
  };
  const vert = `
    attribute float iLight; attribute float iFlip;
    varying vec2 vUv; varying float vLight;
    #include <fog_pars_vertex>
    void main() {
      vec3 base = instanceMatrix[3].xyz;
      vec3 toCam = cameraPosition - base; toCam.y = 0.0;
      float l = max(length(toCam), 1e-4);
      vec3 right = vec3(toCam.z, 0.0, -toCam.x) / l;
      vec3 p = base + right * position.x + vec3(0.0, position.y * iFlip, 0.0);
      vUv = uv; vLight = iLight;
      vec4 mvPosition = viewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const frag = `
    uniform sampler2D map; uniform float opacity; uniform float bright;
    varying vec2 vUv; varying float vLight;
    #include <fog_pars_fragment>
    void main() {
      vec4 c = texture2D(map, vUv);
      if (c.a < 0.5) discard;
      gl_FragColor = vec4(c.rgb * mix(vLight, 1.0, bright), c.a * opacity);
      #include <fog_fragment>
    }`;
  const mat = (key, bright, trans) => new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: tex(key) }, opacity: { value: trans ? Math.max(0.1, 1 - trans / 10) : 1 }, bright: { value: bright } }]),
    vertexShader: vert, fragmentShader: frag, fog: true, transparent: !!trans, depthWrite: !trans, side: THREE.DoubleSide, toneMapped: false,
  });
  for (const [dn, list] of byType) {
    const T = d.propTypes[dn];
    if (!T) continue;
    const frames = [];
    for (const [key, tics] of T.frames) {
      const sp = d.spr[key];
      if (!sp) continue;
      // plano de 1 x 1 com a ancora em x=0: esquerda = -ox, topo = oy acima do ponto (pixels do mapa -> unidades do jogo)
      const sc = T.sc || 1, w = sp.w * s * sc, h = sp.h * s * sc, x0 = -sp.ox * s * sc, y0 = (sp.oy - sp.h) * s * sc;
      const g = new THREE.PlaneGeometry(1, 1);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, x0 + (pos.getX(i) + 0.5) * w, y0 + (pos.getY(i) + 0.5) * h, 0);
        if (sp.flip) uv.setX(i, 1 - uv.getX(i));
      }
      const mesh = new THREE.InstancedMesh(g, mat(key, T.bright, T.trans), list.length);
      const L = new Float32Array(list.length), F = new Float32Array(list.length);
      const m = new THREE.Matrix4();
      list.forEach((p, i) => {
        m.makeTranslation(p[1], p[2], p[3]);
        mesh.setMatrixAt(i, m);
        L[i] = light(p[5]);
        F[i] = p[4] ? -1 : 1;
      });
      g.setAttribute('iLight', new THREE.InstancedBufferAttribute(L, 1));
      g.setAttribute('iFlip', new THREE.InstancedBufferAttribute(F, 1));
      mesh.frustumCulled = false; // o billboard e calculado no vertice: a caixa do plano nao vale
      mesh.visible = frames.length === 0;
      group.add(mesh);
      frames.push({ mesh, tics });
    }
    if (!frames.length) continue;
    types.set(dn, { frames, total: frames.reduce((a, f) => a + Math.max(1, f.tics), 0), cur: 0 });
  }
  return {
    group,
    update(time) {
      const tic = Math.floor(time * 35);
      for (const t of types.values()) {
        if (t.frames.length < 2 || t.frames.some((f) => f.tics < 0)) continue;
        let k = tic % t.total, i = 0;
        while (k >= Math.max(1, t.frames[i].tics)) { k -= Math.max(1, t.frames[i].tics); i++; }
        if (i !== t.cur) { t.frames[t.cur].mesh.visible = false; t.frames[i].mesh.visible = true; t.cur = i; }
      }
    },
  };
}
