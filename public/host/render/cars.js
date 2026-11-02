// Atores dinamicos: picapes, caixas de item, minas, misseis e ondas Whomp.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COLORS } from '/shared/protocol.js';
import { buildTruck, buildMine, buildWheel, buildIceCube } from './models.js';
import { TRAIL } from '/sim/items.js';

import { crateTexture, softShadowTexture, glowTexture } from './textures.js';

const WHOMP_R = 16;
const CAR_SCALE = 0.72; // o modelo e desenhado em escala maior; o carro do jogo e ~30% menor

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, ...o });

export class Actors {
  constructor(scene, { shadows = true } = {}) {
    this.scene = scene;
    this.shadows = shadows;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.cars = new Map();
    this.boxes = [];
    this.mines = [];
    this.missiles = [];
    this.shocks = [];
    this.trails = [];
    this.wheelViews = [];
    this.mortarViews = [];
    this.flameMat = new THREE.SpriteMaterial({ map: glowTexture('255,150,40'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 });
    this.blobMat = new THREE.MeshBasicMaterial({ map: softShadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.boxGeo = new RoundedBoxGeometry(2.4, 2.4, 2.4, 2, 0.12);
    this.boxMat = std(0xffffff, { map: crateTexture(), emissive: 0x2a6fb0, emissiveIntensity: 0.28, roughness: 0.7 });
    this.glowMat = new THREE.SpriteMaterial({ map: glowTexture('90,185,255'), transparent: true, depthWrite: false, opacity: 0.8 });
  }

  clear() {
    this.root.clear();
    this.cars.clear();
    this.boxes.length = this.mines.length = this.missiles.length = this.shocks.length = this.trails.length = this.wheelViews.length = this.mortarViews.length = 0;
  }

  setup(game) {
    this.clear();
    this.track = game.track;
    for (const c of game.cars) {
      const truck = buildTruck(COLORS[c.color].hex);
      truck.group.scale.setScalar(CAR_SCALE);
      this.root.add(truck.group);
      let blob = null;
      if (!this.shadows) {
        blob = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.8).rotateX(-Math.PI / 2), this.blobMat);
        this.root.add(blob);
      }
      // cubo de gelo (aparece quando o carro congela); vive dentro do grupo do carro, entao acompanha a posicao e o giro
      const cube = buildIceCube(5.3, 4.1, 3.7);
      cube.position.set(0, 1.75, 0);
      cube.visible = false;
      cube.traverse((o) => { o.renderOrder = 5; });
      truck.group.add(cube);
      this.cars.set(c.id, { truck, blob, cube, bounce: Math.random() * 6 });
    }
    for (const b of game.items.boxes) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(this.boxGeo, this.boxMat);
      m.castShadow = true;
      const glow = new THREE.Sprite(this.glowMat);
      glow.scale.setScalar(5.5);
      g.add(m, glow);
      this.root.add(g);
      this.boxes.push({ g, m, y: b.y ?? game.track.elevAt(b.s) + (b.h || 0) });
    }
  }

  update(game, time, dt) {
    const track = game.track;
    for (const c of game.cars) {
      const v = this.cars.get(c.id);
      if (!v) continue;
      const show = !c.hidden;
      const { truck } = v;
      truck.group.visible = show;
      if (v.blob) v.blob.visible = show && c.state !== 'falling';
      if (!show) continue;
      const g = truck.group;
      v.bounce += dt * (4 + c.speed * 0.35);
      const bump = c.state === 'run' && !c.air ? Math.sin(v.bounce) * 0.04 * Math.min(1, c.speed / 20) : 0;
      // c.y e a altitude absoluta (a fisica garante carro acima do chao). Pistas de mapa podem ter piso bem abaixo de zero (MAP56 ~ -52):
      // so as pistas de curva fixa seguram o carro em -8 (afundando no rio)
      g.position.set(c.x, game.track.map ? c.y + bump : Math.max(-8, c.y + bump), c.z);
      if (c.state === 'falling') {
        g.rotation.set(0, -c.h + c.spin, 0, 'YXZ');
        g.rotation.z = c.fall * 1.8;
        g.scale.setScalar(CAR_SCALE * Math.max(0.25, 1 - c.fall * 0.45));
      } else {
        g.scale.setScalar(CAR_SCALE);
        g.quaternion.set(c.q[0], c.q[1], c.q[2], c.q[3]); // orientacao vem da simulacao (rumo, terreno, capotamento)
        if (c.state === 'run') {
          g.rotateX(c.steerSm * Math.min(1, c.speed / 24) * 0.07); // inclina nas curvas
        }
      }
      truck.setWreck(c.state === 'wreck');
      // turbina e aerofolio ficam montados enquanto o nitro estiver ativo, mesmo depois de usado
      truck.setItem(c.alive ? (c.boost > 0 ? 'nitro' : c.item) : null, time);
      v.cube.visible = c.freeze > 0 && c.state !== 'wreck';
      if (v.cube.visible) v.cube.userData.setOpacity(c.freeze < 0.7 ? 0.55 + 0.27 * Math.abs(Math.sin(time * 28)) : 1); // pisca antes de quebrar
      truck.setSteer(c.steerSm);
      truck.spin((c.speed * dt) / (0.82 * CAR_SCALE));
      truck.flame.visible = c.boost > 0;
      if (c.boost > 0) truck.flame.scale.set(0.8 + Math.random() * 0.7, 1, 1);
      if (v.blob) {
        const gnd = this._g || (this._g = { y: 0, nx: 0, ny: 1, nz: 0 });
        const gy = track.map ? track.map.groundAt(c.x, c.z, c.y + 0.3, gnd).y : c.near ? track.groundFromNear(c.near, gnd).y : 0;
        v.blob.position.set(c.x, gy + 0.1, c.z);
        v.blob.rotation.y = -c.h;
        v.blob.scale.setScalar(Math.max(0.35, 1 - Math.max(0, c.y) * 0.06));
      }
    }
    // caixas de item
    game.items.boxes.forEach((b, i) => {
      const v = this.boxes[i];
      if (!v) return;
      v.g.visible = b.active;
      v.g.position.set(b.x, v.y + 2.4 + Math.sin(time * 2.4 + i) * 0.3, b.z);
      v.m.rotation.y = time * 1.2 + i;
    });
    // minas
    sync(this.mines, game.items.mines, () => {
      const g = buildMine();
      this.root.add(g);
      return g;
    }, (g, m) => {
      g.position.set(m.x, m.y + 0.55, m.z);
      g.getObjectByName('led').visible = Math.floor(time * 4) % 2 === 0;
    }, (g) => this.root.remove(g));
    // rastro do nitro: fogo no chao que tremula e apaga no fim
    sync(this.trails, game.items.trails, () => {
      const spr = new THREE.Sprite(this.flameMat);
      this.root.add(spr);
      return spr;
    }, (spr, t) => {
      const k = t.age / TRAIL.life;
      const fl = 1 + Math.sin(time * 30 + t.x) * 0.18 + Math.sin(time * 47 + t.z) * 0.12;
      spr.position.set(t.x, track.elevAt(track.nearest(t.x, t.z, -1, this._n || (this._n = track.newNear())).s) + 1.1, t.z);
      spr.scale.set(3.4 * fl, 3.4 * fl * (1.3 - 0.5 * k), 1);
      spr.visible = k < 0.97;
    }, (spr) => this.root.remove(spr));
    // pneus soltos (fisica da simulacao)
    sync(this.wheelViews, game.wheels, () => {
      const g = buildWheel();
      g.scale.setScalar(CAR_SCALE);
      this.root.add(g);
      return g;
    }, (g, w) => {
      g.visible = !w.dead;
      g.position.set(w.x, w.y, w.z);
      g.quaternion.set(w.q[0], w.q[1], w.q[2], w.q[3]);
    }, (g) => this.root.remove(g));
    // morteiros de gelo: bola azul em arco (sem marca no chao: a area so aparece quando o gelo cai)
    sync(this.mortarViews, game.items.mortars, () => {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x5fb8ff, emissiveIntensity: 1.2, roughness: 0.2, flatShading: true }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('120,200,255'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(5);
      g.add(ball, glow);
      this.root.add(g);
      return g;
    }, (g, m) => {
      g.position.set(m.x, m.y, m.z);
      g.rotation.y = m.age * 5;
    }, (g) => { this.root.remove(g); });
    // misseis
    sync(this.missiles, game.items.missiles, () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 3, 10).rotateZ(Math.PI / 2), std(0xf4f4f4, { roughness: 0.3 }));
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 10).rotateZ(-Math.PI / 2), std(0xd61f2c));
      nose.position.x = 2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 1.7), std(0xd61f2c));
      fin.position.x = -1.2;
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.8, 8).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
      fire.position.x = -2.5;
      g.add(body, nose, fin, fire);
      g.children.forEach((c) => (c.castShadow = true));
      this.root.add(g);
      return g;
    }, (g, m) => {
      g.position.set(m.x, (m.near ? track.elevAt(m.near.s) : 0) + 1.8, m.z);
      g.rotation.y = -m.h;
    }, (g) => this.root.remove(g));
    // ondas magneticas: domo de energia + aneis + raios eletricos
    sync(this.shocks, game.items.shocks, () => {
      const grp = new THREE.Group();
      const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide };
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3da2ff, opacity: 0.3, ...add }));
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xbfe6ff, opacity: 0.35, wireframe: true, ...add }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xdff2ff, opacity: 0.95, ...add }));
      ring.position.y = 0.15;
      const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5fb8ff, opacity: 0.45, ...add }));
      ring2.position.y = 0.12;
      const bolts = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe8f6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      bolts.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 6 * 3), 3));
      bolts.frustumCulled = false;
      grp.add(dome, shell, ring, ring2, bolts);
      grp.userData = { dome, shell, ring, ring2, bolts };
      this.root.add(grp);
      return grp;
    }, (grp, s) => {
      const u = grp.userData;
      const k = Math.min(1, s.r / WHOMP_R);
      const fade = Math.max(0, 1 - k * k);
      grp.position.set(s.x, 0.2, s.z);
      u.dome.scale.setScalar(Math.max(0.1, s.r));
      u.dome.scale.y = Math.max(0.1, s.r) * 0.55;
      u.shell.scale.copy(u.dome.scale);
      u.dome.material.opacity = 0.34 * fade;
      u.shell.material.opacity = 0.4 * fade;
      u.ring.scale.setScalar(Math.max(0.1, s.r));
      u.ring2.scale.setScalar(Math.max(0.1, s.r * 0.82));
      u.ring.material.opacity = 0.95 * fade + 0.05;
      u.ring2.material.opacity = 0.5 * fade;
      // raios: segmentos irregulares do centro para a borda, regenerados a cada frame
      const pos = u.bolts.geometry.attributes.position;
      let n = 0;
      for (let b = 0; b < 14; b++) {
        const a = Math.random() * Math.PI * 2;
        let px = 0, pz = 0, py = 0.6;
        const len = s.r * (0.55 + Math.random() * 0.45);
        for (let seg = 0; seg < 3; seg++) {
          const t2 = (seg + 1) / 3;
          const nx = Math.cos(a) * len * t2 + (Math.random() - 0.5) * 1.6;
          const nz = Math.sin(a) * len * t2 + (Math.random() - 0.5) * 1.6;
          const ny = 0.6 + Math.random() * 1.8;
          if (n < 14 * 6) { pos.setXYZ(n++, px, py, pz); pos.setXYZ(n++, nx, ny, nz); }
          px = nx; pz = nz; py = ny;
        }
      }
      for (; n < pos.count; n++) pos.setXYZ(n, 0, 0, 0);
      pos.needsUpdate = true;
      u.bolts.material.opacity = fade;
    }, (grp) => this.root.remove(grp));
  }
}

function sync(views, data, create, update, remove) {
  while (views.length < data.length) views.push(create());
  while (views.length > data.length) remove(views.pop());
  for (let i = 0; i < data.length; i++) update(views[i], data[i]);
}
