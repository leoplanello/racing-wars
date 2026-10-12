// Texturas procedurais em canvas (sem arquivos). Estilo cartoon 3D: cores vivas, veios e rebites.
import * as THREE from 'three';
import { makeRng } from '/sim/rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const shade = (r, g, b, k) => `rgb(${Math.max(0, Math.min(255, r * k)) | 0},${Math.max(0, Math.min(255, g * k)) | 0},${Math.max(0, Math.min(255, b * k)) | 0})`;

/** Tabuas de madeira correndo no sentido do comprimento da pista (eixo v). */
export function woodTexture() {
  const rng = makeRng(11);
  const [c, g] = canvas(256, 256);
  const planks = 4, pw = 256 / planks;
  for (let i = 0; i < planks; i++) {
    const k = 0.82 + rng() * 0.36;
    g.fillStyle = shade(150, 88, 46, k);
    g.fillRect(i * pw, 0, pw, 256);
    // veios
    for (let j = 0; j < 14; j++) {
      const x = i * pw + 4 + rng() * (pw - 8);
      g.strokeStyle = shade(96, 52, 26, 0.85 + rng() * 0.4);
      g.globalAlpha = 0.35;
      g.lineWidth = 1 + rng() * 1.6;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (rng() - 0.5) * 8, 80, x + (rng() - 0.5) * 8, 170, x + (rng() - 0.5) * 4, 256);
      g.stroke();
    }
    g.globalAlpha = 1;
    // frestas e luz nas bordas
    g.fillStyle = 'rgba(40,20,8,.85)';
    g.fillRect(i * pw, 0, 3, 256);
    g.fillStyle = 'rgba(255,200,140,.25)';
    g.fillRect(i * pw + 3, 0, 2, 256);
    // emendas e pregos
    const seam = Math.floor(rng() * 200) + 28;
    g.fillStyle = 'rgba(40,20,8,.8)';
    g.fillRect(i * pw, seam, pw, 3);
    g.fillStyle = 'rgba(30,30,34,.9)';
    for (const y of [seam + 10, seam - 10]) {
      g.beginPath(); g.arc(i * pw + 10, y, 2.2, 0, 7); g.arc(i * pw + pw - 10, y, 2.2, 0, 7); g.fill();
    }
  }
  return toTex(c);
}

/** Aco azulado com rebites (vigas da ponte). */
export function steelTexture() {
  const [c, g] = canvas(128, 128);
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#5d6f93'); gr.addColorStop(0.5, '#445272'); gr.addColorStop(1, '#2f3a55');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 0, 128, 10);
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 118, 128, 10);
  for (let i = 0; i < 4; i++) {
    const x = 16 + i * 32;
    for (const y of [24, 104]) {
      g.fillStyle = '#1d2538'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
      g.fillStyle = '#8fa0c4'; g.beginPath(); g.arc(x - 1, y - 1, 4.2, 0, 7); g.fill();
      g.fillStyle = '#d6e0f5'; g.beginPath(); g.arc(x - 2, y - 2, 1.6, 0, 7); g.fill();
    }
  }
  return toTex(c);
}

export function asphaltTexture() {
  const rng = makeRng(5);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#4b505a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 60 + rng() * 60;
    g.fillStyle = `rgba(${v},${v},${v + 6},${0.25 + rng() * 0.35})`;
    g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2, 1 + rng() * 2);
  }
  return toTex(c);
}

/** Estrada de terra avermelhada com sulcos paralelos ao sentido da pista (v). */
export function dirtTexture() {
  const rng = makeRng(8);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#9c5b3c'; g.fillRect(0, 0, 256, 256);
  // sulcos longos (faixas mais escuras e mais claras)
  const lanes = 8, lw = 256 / lanes;
  for (let i = 0; i < lanes; i++) {
    g.fillStyle = i % 2 ? 'rgba(70,32,20,.35)' : 'rgba(255,200,150,.10)';
    g.fillRect(i * lw, 0, lw, 256);
    g.fillStyle = 'rgba(50,22,14,.45)';
    g.fillRect(i * lw, 0, 2, 256);
  }
  for (let i = 0; i < 1800; i++) {
    const k = 0.7 + rng() * 0.6;
    g.fillStyle = shade(156, 91, 60, k); g.globalAlpha = 0.35;
    g.beginPath(); g.arc(rng() * 256, rng() * 256, 1 + rng() * 3, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  return toTex(c);
}

/** Paralelepipedo grande cinza-bege (praca). */
export function cobbleTexture() {
  const rng = makeRng(14);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#6a6a70'; g.fillRect(0, 0, 256, 256);
  const rows = 5, size = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 5;
    for (let i = 0; i < cols; i++) {
      const x = i * size + (r % 2 ? size / 2 : 0), y = r * size;
      const k = 0.82 + rng() * 0.3;
      g.fillStyle = shade(196, 188, 170, k);
      g.beginPath();
      g.roundRect(x + 2.5, y + 2.5, size - 5, size - 5, 6);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + 4, y + 4, size - 10, 3);
      g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x + 4, y + size - 8, size - 10, 3);
    }
  }
  return toTex(c);
}

/** Caixote de madeira escura com tampa laranja e simbolo azul brilhante. */
export function crateTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#3b2418'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#4a2e1d' : '#35200f';
    g.fillRect(0, i * 32 + 14, 128, 28);
  }
  g.fillStyle = '#e8892b'; g.fillRect(0, 0, 128, 18);
  g.fillStyle = '#b8601a'; g.fillRect(0, 14, 128, 4);
  g.strokeStyle = '#1d110a'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
  g.shadowColor = '#44b4ff'; g.shadowBlur = 14;
  g.fillStyle = '#7fd2ff';
  g.beginPath();
  g.arc(64, 54, 11, 0, 7); g.fill();
  g.fillRect(58, 66, 12, 34);
  g.fillRect(48, 76, 32, 8);
  return toTex(c, { repeat: false });
}

export function grassTexture() {
  const rng = makeRng(3);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#4fae3c'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const k = 0.75 + rng() * 0.55;
    g.strokeStyle = shade(72, 172, 52, k);
    g.lineWidth = 1 + rng() * 1.5;
    const x = rng() * 256, y = rng() * 256;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 6, y - 4 - rng() * 8); g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = 'rgba(255,255,160,.35)';
    g.beginPath(); g.arc(rng() * 256, rng() * 256, 1.5, 0, 7); g.fill();
  }
  return toTex(c);
}

/** Lamina de grama com alfa (tufos em cruz). */
export function tuftTexture() {
  const rng = makeRng(21);
  const [c, g] = canvas(128, 128);
  for (let i = 0; i < 22; i++) {
    const x = 10 + rng() * 108, h = 50 + rng() * 70, lean = (rng() - 0.5) * 34;
    const gr = g.createLinearGradient(0, 128, 0, 128 - h);
    gr.addColorStop(0, '#2f7d2a'); gr.addColorStop(1, '#8be05a');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - 4, 128);
    g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h);
    g.quadraticCurveTo(x + lean * 0.3 + 3, 128 - h * 0.6, x + 4, 128);
    g.fill();
  }
  return toTex(c, { aniso: 4 });
}

export function brickTexture() {
  const rng = makeRng(2);
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#7a4a2e'; g.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 8; r++) {
    for (let i = -1; i < 4; i++) {
      const x = i * 32 + (r % 2 ? 16 : 0);
      g.fillStyle = shade(226, 120, 62, 0.85 + rng() * 0.3);
      g.fillRect(x + 1.5, r * 16 + 1.5, 29, 13);
    }
  }
  return toTex(c);
}

export function wallTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#f4efe2'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,.05)';
  for (let i = 0; i < 128; i += 4) g.fillRect(0, i, 128, 1);
  return toTex(c);
}

export function roofTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#b5472e'; g.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 8; r++) {
    g.fillStyle = r % 2 ? '#c95a3d' : '#a93f28';
    g.fillRect(0, r * 16, 128, 14);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, r * 16 + 14, 128, 2);
  }
  return toTex(c);
}

export function windowTexture() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#f4efe2'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#2a7fd1'; g.fillRect(14, 12, 36, 38);
  g.fillStyle = '#9ad0ff'; g.fillRect(14, 12, 36, 14);
  g.fillStyle = '#f4efe2'; g.fillRect(30, 12, 4, 38); g.fillRect(14, 29, 36, 4);
  g.strokeStyle = '#8a7a66'; g.lineWidth = 3; g.strokeRect(13, 11, 38, 40);
  return toTex(c, { repeat: false });
}

export function stoneTexture() {
  const rng = makeRng(17);
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#6f7077'; g.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) {
    g.fillStyle = shade(190, 186, 172, 0.8 + rng() * 0.35);
    g.fillRect(i * 32 + 2 + (r % 2) * 10, r * 32 + 2, 26, 26);
  }
  return toTex(c);
}

export function waterTexture() {
  const rng = makeRng(31);
  const [c, g] = canvas(256, 256);
  const gr = g.createLinearGradient(0, 0, 256, 256);
  gr.addColorStop(0, '#1d7fd6'); gr.addColorStop(1, '#2aa0e8');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2;
  for (let i = 0; i < 46; i++) {
    const x = rng() * 256, y = rng() * 256, w = 14 + rng() * 26;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 4, x + w, y); g.stroke();
    // repete nas bordas para emendar
    g.beginPath(); g.moveTo(x - 256, y); g.quadraticCurveTo(x - 256 + w / 2, y - 4, x - 256 + w, y); g.stroke();
  }
  return toTex(c);
}

/** Agua: relevo suave sem direcao dominante (soma de ondas inteiras = emenda sem costura). Cinza: 0.5 = media; claro = crista/caustica. */
export function oceanTexture() {
  const rng = makeRng(83);
  const S = 256;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const waves = [];
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2, f = 2 + Math.floor(rng() * 6);
    waves.push([Math.round(Math.cos(a) * f) || 1, Math.round(Math.sin(a) * f) || 1, rng() * 6.283, 0.5 + rng() * 0.5]);
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0, w = 0;
      for (const [fx, fz, ph, am] of waves) { v += Math.sin(((fx * x + fz * y) / S) * 6.2832 + ph) * am; w += am; }
      v /= w; // -1..1
      const ridge = Math.pow(1 - Math.abs(v * 1.6), 3); // cristas finas e tortas, estilo caustica
      const k = 0.42 + v * 0.18 + ridge * 0.3;
      const o = (y * S + x) * 4;
      img.data[o] = 150 + k * 105; img.data[o + 1] = 190 + k * 65; img.data[o + 2] = 215 + k * 40; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTex(c);
}

export function checkerTexture(cols = 8, rows = 4) {
  const q = 32;
  const [c, g] = canvas(cols * q, rows * q);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * q, y * q, q, q); }
  const t = toTex(c, { repeat: false });
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function signTexture(text) {
  const [c, g] = canvas(512, 128);
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#2c6be0'); gr.addColorStop(1, '#173e91');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#0a1a44'; g.lineWidth = 8; g.strokeRect(4, 4, 504, 120);
  g.fillStyle = '#fff'; g.font = 'italic 900 78px "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#0a1a44'; g.strokeText(text, 256, 68); g.fillText(text, 256, 68);
  return toTex(c, { repeat: false });
}

export function questionTexture() {
  const [c, g] = canvas(128, 128);
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#ffcd38'); gr.addColorStop(1, '#ff9a1f');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(6, 6, 116, 116);
  g.fillStyle = '#fff'; g.font = '900 100px "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = '#b35a00'; g.strokeText('?', 64, 70); g.fillText('?', 64, 70);
  return toTex(c, { repeat: false });
}

export function skyTexture(top = '#2f7fe0', mid = '#7cc4ff', horizon = '#dff3ff') {
  const [c, g] = canvas(4, 512);
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, top); gr.addColorStop(0.5, mid); gr.addColorStop(1, horizon);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 512);
  return toTex(c, { repeat: false });
}

export function cloudTexture() {
  const [c, g] = canvas(256, 128);
  for (const [x, y, r] of [[70, 80, 40], [110, 60, 50], [158, 70, 44], [196, 88, 32], [128, 92, 48]]) {
    const gr = g.createRadialGradient(x, y, 4, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  return toTex(c, { repeat: false });
}

export function softShadowTexture() {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return toTex(c, { repeat: false });
}

export function glowTexture(color = '255,255,255') {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, `rgba(${color},1)`); gr.addColorStop(0.4, `rgba(${color},.45)`); gr.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return toTex(c, { repeat: false });
}

/** Clarao branco com raios de luz azulados (explosao). */
export function starburstTexture() {
  const [c, g] = canvas(256, 256);
  g.translate(128, 128);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + (i % 2) * 0.1, len = 70 + ((i * 37) % 50);
    const gr = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(120,200,255,0)');
    g.strokeStyle = gr; g.lineWidth = 5 + (i % 3) * 3;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke();
  }
  const core = g.createRadialGradient(0, 0, 4, 0, 0, 64);
  core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.5, 'rgba(255,255,255,.85)'); core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core; g.beginPath(); g.arc(0, 0, 64, 0, 7); g.fill();
  return toTex(c, { repeat: false });
}

/** Gelo: azul-claro com veios brancos, rachaduras e bolhas (emenda nas bordas). */
export function iceTexture() {
  const rng = makeRng(77);
  const [c, g] = canvas(256, 256);
  const gr = g.createLinearGradient(0, 0, 256, 256);
  gr.addColorStop(0, '#bfeaff'); gr.addColorStop(0.5, '#e4f7ff'); gr.addColorStop(1, '#a8dcf7');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14; i++) {
    const x = rng() * 256, y = rng() * 256, r = 20 + rng() * 50;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) {
    let x = rng() * 256, y = rng() * 256;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (rng() - 0.5) * 60; y += (rng() - 0.3) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,.7)';
  for (let i = 0; i < 30; i++) { g.beginPath(); g.arc(rng() * 256, rng() * 256, 0.8 + rng() * 2.2, 0, 6.283); g.fill(); }
  return toTex(c);
}

// ---------------------------------------------------------------- cidade (Downtown)
/** Calcada de concreto com juntas. */
export function sidewalkTexture() {
  const rng = makeRng(21);
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#9a9ea6'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    const v = 120 + rng() * 60;
    g.fillStyle = `rgba(${v},${v},${v + 4},${0.15 + rng() * 0.2})`;
    g.fillRect(rng() * 128, rng() * 128, 1 + rng() * 2, 1 + rng() * 2);
  }
  g.strokeStyle = 'rgba(40,44,52,.55)'; g.lineWidth = 2;
  for (const p of [0, 64]) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 128); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(128, p); g.stroke(); }
  return toTex(c);
}

/** Concreto liso (barreiras, muros). */
export function concreteTexture() {
  const rng = makeRng(22);
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#b4b6b8'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = 140 + rng() * 70;
    g.fillStyle = `rgba(${v},${v},${v},${0.12 + rng() * 0.2})`;
    g.fillRect(rng() * 128, rng() * 128, 1 + rng() * 3, 1 + rng() * 2);
  }
  return toTex(c);
}

/** Chao da cidade fora das ruas: asfalto escuro de quarteirao. */
export function cityGroundTexture() {
  const rng = makeRng(23);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#5a5e66'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    const v = 70 + rng() * 50;
    g.fillStyle = `rgba(${v},${v},${v + 6},${0.2 + rng() * 0.3})`;
    g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2, 1 + rng() * 2);
  }
  return toTex(c);
}

/** Detalhe de rocha (cinza, multiplica a cor por vertice do terreno): manchas, fissuras e veios de estrato. */
export function rockDetailTexture() {
  const rng = makeRng(63);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#b8b8bc'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { // manchas largas e suaves
    const v = 150 + rng() * 105;
    g.fillStyle = `rgba(${v},${v},${v + 5},${0.12 + rng() * 0.18})`;
    g.beginPath(); g.ellipse(rng() * 256, rng() * 256, 3 + rng() * 22, 2 + rng() * 9, rng() * 3.14, 0, 7); g.fill();
  }
  for (let i = 0; i < 1800; i++) { // granulado
    const v = 120 + rng() * 135;
    g.fillStyle = `rgba(${v},${v},${v},${0.25 + rng() * 0.3})`;
    g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2, 1 + rng() * 2);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) { // fissuras escuras
    g.strokeStyle = `rgba(40,42,50,${0.12 + rng() * 0.2})`; g.lineWidth = 0.7 + rng() * 1.3;
    let x = rng() * 256, y = rng() * 256;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (rng() - 0.5) * 26; y += (rng() - 0.3) * 22; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 16; i++) { // estratos horizontais
    g.strokeStyle = `rgba(60,62,72,${0.1 + rng() * 0.12})`; g.lineWidth = 1 + rng() * 2;
    const y = rng() * 256; g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + (rng() - 0.5) * 6);
    g.stroke();
  }
  return toTex(c);
}

/** Detalhe de pasto (multiplica a cor por vertice): tons suaves, folhas finas e pontinhos; tileavel. */
export function grassDetailTexture() {
  const rng = makeRng(97);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#d6d6d2'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) { // manchas suaves (tons de verde mais claros/escuros)
    const v = 185 + rng() * 70;
    g.fillStyle = `rgba(${v},${v + 4},${v - 6},${0.1 + rng() * 0.14})`;
    for (const ox of [0, -256, 256]) for (const oy of [0, -256, 256]) { g.beginPath(); g.ellipse(rng() * 0 + (i * 53 % 256) + ox, ((i * 97) % 256) + oy, 4 + rng() * 14, 3 + rng() * 9, rng() * 3, 0, 7); g.fill(); }
  }
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) { // folhas de capim
    const v = 150 + rng() * 105, x = rng() * 256, y = rng() * 256;
    g.strokeStyle = `rgba(${v - 40},${v},${v - 70},${0.22 + rng() * 0.3})`; g.lineWidth = 0.7 + rng() * 0.9;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 3, y - 2 - rng() * 4); g.stroke();
  }
  return toTex(c);
}

/** Espuma de onda (alfa): frente nitida e cauda de bolhas que some; periodica no eixo u. */
export function foamTexture() {
  const rng = makeRng(71);
  const [c, g] = canvas(128, 64);
  g.clearRect(0, 0, 128, 64);
  for (let y = 0; y < 64; y++) { // cada linha com a frente da onda um pouco deslocada (recorte irregular)
    const front = 100 + Math.sin(y * 0.55) * 6 + Math.sin(y * 1.7 + 1) * 3;
    const grad = g.createLinearGradient(front - 70, 0, front + 6, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.35)');
    grad.addColorStop(0.97, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(Math.max(0, front - 70), y, 76, 1);
  }
  for (let i = 0; i < 140; i++) { // bolhas na cauda
    g.fillStyle = `rgba(255,255,255,${0.2 + rng() * 0.4})`;
    g.beginPath(); g.arc(30 + rng() * 70, rng() * 64, 0.6 + rng() * 1.4, 0, 7); g.fill();
  }
  return toTex(c);
}

/** Areia da praia: bege com graos e ondulacoes claras. */
export function sandTexture() {
  const rng = makeRng(57);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#e3cf9a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const k = 0.82 + rng() * 0.3;
    g.fillStyle = shade(227, 207, 154, k); g.globalAlpha = 0.4;
    g.beginPath(); g.arc(rng() * 256, rng() * 256, 0.8 + rng() * 2, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 14; i++) { // ondulacoes
    g.strokeStyle = 'rgba(190,160,100,.28)'; g.lineWidth = 2;
    const y = rng() * 256; g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 4);
    g.stroke();
  }
  return toTex(c);
}

/** Chao de serra: cascalho cinza-azulado com manchas de neve e capim seco. */
export function rockGroundTexture() {
  const rng = makeRng(41);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#7d8189'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) {
    const v = 90 + rng() * 80;
    g.fillStyle = `rgba(${v},${v + 2},${v + 8},${0.25 + rng() * 0.35})`;
    g.beginPath(); g.arc(rng() * 256, rng() * 256, 1 + rng() * 3, 0, 7); g.fill();
  }
  for (let i = 0; i < 26; i++) {
    g.fillStyle = 'rgba(245,250,255,.55)';
    g.beginPath(); g.ellipse(rng() * 256, rng() * 256, 6 + rng() * 14, 3 + rng() * 8, rng() * 3, 0, 7); g.fill();
  }
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `rgba(${110 + rng() * 40},${120 + rng() * 40},70,.45)`;
    const x = rng() * 256, y = rng() * 256;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 4, y - 3 - rng() * 5); g.stroke();
  }
  return toTex(c);
}

/** Fachada de predio: andares com janelas (acesas ao acaso). `tone` = cor-base. */
export function facadeTexture(tone = '#6b7280', seed = 31) {
  const rng = makeRng(seed);
  const [c, g] = canvas(128, 256);
  g.fillStyle = tone; g.fillRect(0, 0, 128, 256);
  for (let r = 0; r < 16; r++) {
    for (let col = 0; col < 6; col++) {
      const lit = rng() < 0.42;
      g.fillStyle = lit ? (rng() < 0.5 ? '#ffe08a' : '#fff3c4') : '#1f2a3a';
      g.fillRect(col * 21 + 4, r * 16 + 3, 13, 10);
    }
  }
  g.fillStyle = 'rgba(0,0,0,.18)';
  for (let r = 0; r < 16; r++) g.fillRect(0, r * 16 + 14, 128, 2);
  return toTex(c);
}

/** Placa de neon: texto brilhante sobre fundo escuro (para material emissivo). */
export function neonTexture(text, color = '#ff3df2') {
  const [c, g] = canvas(256, 96);
  g.fillStyle = '#0b0b14'; g.fillRect(0, 0, 256, 96);
  g.font = 'bold 54px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 22; g.fillStyle = color;
  g.fillText(text, 128, 50);
  g.shadowBlur = 8; g.fillStyle = '#ffffff';
  g.fillText(text, 128, 50);
  g.strokeStyle = color; g.lineWidth = 5; g.shadowBlur = 14; g.strokeRect(6, 6, 244, 84);
  return toTex(c, { repeat: false });
}

/** Placa de PARE: octogono vermelho com texto. */
export function stopSignTexture() {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#d3221f';
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); }
  g.closePath(); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#fff'; g.font = 'bold 36px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('PARE', 64, 66);
  return toTex(c, { repeat: false });
}

// ---------------------------------------------------------------- detalhes de cenario
/** Placa de curva (chevron): fundo amarelo, borda preta e duas setas apontando para a direita. */
export function chevronTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#111'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#ffd23a'; g.fillRect(6, 6, 116, 116);
  g.strokeStyle = '#111'; g.lineWidth = 15; g.lineJoin = 'miter'; g.lineCap = 'butt';
  for (const x of [28, 62]) { g.beginPath(); g.moveTo(x, 24); g.lineTo(x + 34, 64); g.lineTo(x, 104); g.stroke(); }
  return toTex(c, { repeat: false });
}

/** Filetes de agua caindo (tileavel na vertical): listras claras e finas sobre azul transparente. */
export function streakTexture() {
  const rng = makeRng(5);
  const [c, g] = canvas(64, 128);
  g.clearRect(0, 0, 64, 128);
  for (let i = 0; i < 26; i++) {
    const x = rng() * 64, w = 1 + rng() * 3, y = rng() * 128, h = 30 + rng() * 70;
    for (const oy of [0, -128, 128]) {
      const gr = g.createLinearGradient(0, y + oy, 0, y + oy + h);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, `rgba(240,250,255,${0.5 + rng() * 0.4})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, y + oy, w, h);
    }
  }
  g.fillStyle = 'rgba(190,225,245,.22)'; g.fillRect(0, 0, 64, 128);
  const t = toTex(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

/** Raio de luz: faixa vertical que some nas bordas e no fim. */
export function rayTexture() {
  const [c, g] = canvas(64, 256);
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(255,244,214,0)'); h.addColorStop(0.5, 'rgba(255,244,214,1)'); h.addColorStop(1, 'rgba(255,244,214,0)');
  g.fillStyle = h; g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const v = g.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(0,0,0,0.1)'); v.addColorStop(0.35, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = v; g.fillRect(0, 0, 64, 256);
  return toTex(c, { repeat: false });
}

/** Anel suave (ondulacao na agua). */
export function ringTexture() {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 20, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,.9)'); gr.addColorStop(0.85, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return toTex(c, { repeat: false });
}
