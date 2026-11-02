import test from 'node:test';
import assert from 'node:assert/strict';
import { splitGrid, splitRects } from '../shared/layout.js';
import { KartCamera, KART_CAM, kartFovV } from '../sim/camera.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

test('grade da tela dividida: 1 cheia, 2 empilhadas, 3-4 em 2x2, 5-6 em 3x2, 7-9 em 3x3, 10-12 em 4x3, 13-16 em 4x4', () => {
  assert.deepEqual(splitGrid(1), [1, 1]);
  assert.deepEqual(splitGrid(2), [1, 2]);
  assert.deepEqual(splitGrid(3), [2, 2]);
  assert.deepEqual(splitGrid(4), [2, 2]);
  assert.deepEqual(splitGrid(5), [3, 2]);
  assert.deepEqual(splitGrid(6), [3, 2]);
  assert.deepEqual(splitGrid(7), [3, 3]);
  assert.deepEqual(splitGrid(8), [3, 3]);
  assert.deepEqual(splitGrid(9), [3, 3]);
  assert.deepEqual(splitGrid(10), [4, 3]);
  assert.deepEqual(splitGrid(12), [4, 3]);
  assert.deepEqual(splitGrid(13), [4, 4]);
  assert.deepEqual(splitGrid(15), [4, 4]);
  assert.deepEqual(splitGrid(16), [4, 4]);
});

test('retangulos: cobrem a tela sem sobrepor e a sobra fica no fim', () => {
  for (let n = 1; n <= 16; n++) {
    const L = splitRects(n, 1600, 900, 4);
    assert.equal(L.rects.length, n);
    for (const r of L.rects) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1600 + 1e-6 && r.y + r.h <= 900 + 1e-6, `n=${n} fora da tela`);
      assert.ok(r.w > 0 && r.h > 0);
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = L.rects[i], b = L.rects[j];
      assert.ok(a.x + a.w <= b.x + 1e-6 || b.x + b.w <= a.x + 1e-6 || a.y + a.h <= b.y + 1e-6 || b.y + b.h <= a.y + 1e-6, `n=${n}: celulas ${i} e ${j} se sobrepoem`);
    }
    const full = L.cols * L.rows === n;
    assert.equal(L.spare === null, full, `n=${n} sobra`);
  }
  // 2 jogadores: uma em cima da outra, largura inteira
  const two = splitRects(2, 1600, 900, 4).rects;
  near(two[0].w, 1600); near(two[1].w, 1600); assert.ok(two[1].y > two[0].y);
  // 3 jogadores: a quarta celula (embaixo, a direita) e a sobra
  const three = splitRects(3, 1600, 900, 4);
  near(three.spare.x, three.rects[2].x + three.rects[2].w + 4); near(three.spare.w, three.rects[2].w);
});

test('FOV da celula: ~59 em tela cheia 16:9; 2 jogadores alarga; sempre dentro dos limites', () => {
  assert.ok(kartFovV(16 / 9, 1) > 55 && kartFovV(16 / 9, 1) < 62);
  // 2P (celula muito larga): o ajuste do SRB2Kart (tan x 1,7) alarga o FOV
  assert.ok(kartFovV(3.5, 2) > kartFovV(3.5, 4));
  for (const a of [0.5, 1, 1.78, 3.5, 8]) for (const n of [1, 2, 4, 8, 15]) {
    const f = kartFovV(a, n);
    assert.ok(f >= KART_CAM.fovMin && f <= KART_CAM.fovMax);
  }
});

const car = (o = {}) => ({ x: 0, z: 0, y: 0, h: 0, vx: 0, vz: 0, speed: 0, boost: 0, ...o });

test('KartCamera: fica atras do kart a dist*scale e acima na altura configurada', () => {
  const cam = new KartCamera();
  const c = car({ x: 10, z: 5, h: 0 });
  for (let i = 0; i < 600; i++) cam.update(1 / 60, c);
  const d = KART_CAM.dist * KART_CAM.scale, hgt = KART_CAM.height * KART_CAM.scale;
  near(cam.x, 10 - d, 1e-6); near(cam.z, 5, 1e-6); near(cam.y, hgt, 1e-3);
  assert.ok(cam.pitch > 0 && cam.pitch < 0.4, 'olha levemente para baixo');
  near(cam.yaw, 0, 1e-6);
});

test('KartCamera: segue o rumo do kart com o filtro do SRB2Kart (0,4 por tic a 35 Hz)', () => {
  const cam = new KartCamera();
  const c = car({ h: 0 });
  cam.update(1 / 60, c);
  c.h = 1;
  // um tic de 1/35 s: o erro cai 40% (alfa = 0,4)
  cam.update(1 / 35, c);
  near(cam.yaw, 0.4, 2e-3);
  for (let i = 0; i < 200; i++) cam.update(1 / 60, c);
  near(cam.yaw, 1, 1e-4);
});

test('KartCamera: olhar para tras gira 180 graus na hora', () => {
  const cam = new KartCamera();
  const c = car({ h: 0.3 });
  cam.update(1 / 60, c);
  cam.update(1 / 60, c, { lookBack: true });
  near(cam.yaw, 0.3 + Math.PI, 1e-9);
});

test('KartCamera: nitro aproxima, velocidade acima do cruzeiro afasta', () => {
  const rest = new KartCamera(), boost = new KartCamera(), fast = new KartCamera();
  for (let i = 0; i < 300; i++) {
    rest.update(1 / 60, car());
    boost.update(1 / 60, car({ boost: 1 }));
    fast.update(1 / 60, car({ speed: 52, vx: 52 }));
  }
  assert.ok(boost.x > rest.x + 0.5, 'nitro: camera mais perto do carro');
  assert.ok(fast.x < rest.x - 0.5, 'rapido: camera mais longe');
});

test('KartCamera: derrapando para um lado desloca a camera para dentro da curva', () => {
  const a = new KartCamera(), b = new KartCamera();
  for (let i = 0; i < 300; i++) {
    a.update(1 / 60, car({ vx: 30, vz: 8 })); // desliza para a direita (z > 0 com h = 0)
    b.update(1 / 60, car({ vx: 30, vz: -8 }));
  }
  assert.ok(a.pan < -0.1 && b.pan > 0.1 && Math.abs(a.pan + b.pan) < 1e-6);
  assert.ok(Math.abs(a.pan) <= KART_CAM.panMax * KART_CAM.dist * KART_CAM.scale * 1.01);
});

test('KartCamera: acompanha a altura do chao suavizando (rampas)', () => {
  const cam = new KartCamera();
  const c = car();
  cam.update(1 / 60, c);
  c.y = 5;
  cam.update(1 / 60, c);
  assert.ok(cam.y < 5 + KART_CAM.height * KART_CAM.scale, 'ainda nao chegou');
  for (let i = 0; i < 300; i++) cam.update(1 / 60, c);
  near(cam.y, 5 + KART_CAM.height * KART_CAM.scale, 1e-3);
});

test('KartCamera: forward e unitario e aponta para baixo', () => {
  const cam = new KartCamera();
  cam.update(1 / 60, car({ h: Math.PI / 2 }));
  const f = cam.forward();
  near(Math.hypot(f.x, f.y, f.z), 1, 1e-9);
  assert.ok(f.y < 0, 'olha para baixo');
});

test('KartCamera: objeto entre o kart e a camera aproxima a camera (nao atravessa) e ela volta quando livre', () => {
  const wall = { x: -8, z: 0, r: 1, top: 30 };
  let solid = true;
  const track = { scenery: { query: () => (solid ? [wall] : []) } };
  const c = new KartCamera();
  const kart = { x: 0, y: 0, z: 0, h: 0, vx: 0, vz: 0, speed: 0 };
  for (let i = 0; i < 120; i++) c.update(1 / 60, kart, { track });
  assert.ok(c.x > wall.x + wall.r, `camera dentro do objeto: x=${c.x}`);
  assert.ok(c.dFrac < 0.6, 'deveria ter encurtado: ' + c.dFrac);
  solid = false;
  for (let i = 0; i < 600; i++) c.update(1 / 60, kart, { track });
  assert.ok(c.dFrac > 0.95, 'deveria voltar ao normal: ' + c.dFrac);
});
