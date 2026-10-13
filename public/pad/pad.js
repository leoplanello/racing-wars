// Controle do celular: direcao cega (metade esquerda) + item (metade direita).
import { encodeInput, BTN_FIRE, BTN_AWAY, BTN_REV, cleanAvatar } from '/shared/protocol.js';
import { wsUrl } from '/shared/wsurl.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };

let clientId = store('rw-cid');
if (!clientId) { clientId = Math.random().toString(36).slice(2) + Date.now().toString(36); store('rw-cid', clientId); }

const S = { ws: null, room: '', joined: false, mode: 'join', master: false, retry: 0, steer: 0, fire: false, seq: 0, rtt: 0, timer: 0, rev: false };
const buf = new Uint8Array(4);

// ------------------------------------------------------------------ rede
function connect() {
  const cfg = window.RW || {};
  if (cfg.static && !cfg.relay) {
    $('err').textContent = 'Este site não tem servidor para os celulares. Rode o jogo localmente (npm start).';
    S.room = '';
    return;
  }
  const ws = new WebSocket(wsUrl(document.baseURI, cfg.relay));
  S.ws = ws;
  ws.onopen = () => {
    S.retry = 0;
    ws.send(JSON.stringify({ t: 'join', room: S.room, clientId, name: store('rw-name') || '', avatar: store('rw-avatar') || '' }));
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    switch (m.t) {
      case 'joined':
        S.joined = true; S.master = m.master;
        try { sessionStorage.setItem('rw-room', S.room); } catch {}
        $('join').hidden = true; $('pad').hidden = false;
        document.body.classList.add('landscape');
        showMode('wait', { title: 'Conectado!' });
        break;
      case 'err':
        S.joined = false;
        $('pad').hidden = true; $('join').hidden = false;
        document.body.classList.remove('landscape');
        $('err').textContent = m.reason === 'noroom' ? 'Sala não encontrada. Confira o código.' : m.reason === 'busy' ? 'Muitas tentativas. Aguarde um instante.' : 'Sala cheia (8 jogadores).';
        S.room = '';
        ws.onclose = null;
        ws.close();
        break;
      case 'role': S.master = m.master; break;
      case 'st': applyState(m); break;
      case 'vib': if (navigator.vibrate) navigator.vibrate(m.p); break;
      case 'pong': S.rtt = Math.round(performance.now() - m.ts); $('ping').style.color = S.rtt < 60 ? '#4dff88' : S.rtt < 140 ? '#ffd60a' : '#ff6b6b'; send({ t: 'rtt', ms: S.rtt }); break;
      case 'rtc': onRtc(m); break;
      case 'hostgone': showMode('wait', { title: 'Tela principal desconectada', sub: 'Aguardando reconexão…' }); break;
    }
  };
  ws.onclose = () => {
    if (!S.room) return;
    if (S.joined) showMode('wait', { title: 'Reconectando…' });
    setTimeout(connect, Math.min(3000, 300 * ++S.retry));
  };
  ws.onerror = () => ws.close();
}
const send = (o) => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); };

// ------------------------------------------------------------------ estados
function applyState(m) {
  S.master = m.master;
  document.body.style.background = m.color;
  document.documentElement.style.setProperty('--bg', m.color);
  $('who').textContent = m.name;
  $('pts').textContent = m.pts !== undefined && m.mode !== 'menu' && m.mode !== 'wait' && m.mode !== 'dead' ? `${m.pts} pts` : '';
  if (m.mode === 'drive') {
    $('drive').hidden = false; $('menu').hidden = true; $('msg').hidden = true; $('skull').hidden = true; $('editp').hidden = true; closeProfile();
    const [label, id] = (m.item || '').split('|');
    if (id === 'mine') $('ico').innerHTML = '<span class="mine-ico"></span>'; else $('ico').textContent = { nitro: '🚀', missile: '🎯', whomp: '🧲', ice: '❄️' }[id] || '';
    $('itl').textContent = label || '';
    $('firehint').textContent = m.item ? 'TOQUE PARA USAR' : 'SEM ITEM';
    $('act').style.opacity = m.item ? 1 : 0.6;
    S.mode = 'drive';
  } else if (m.mode === 'menu') {
    showMode('menu', m);
  } else if (m.mode === 'dead') {
    showMode('dead');
  } else showMode('wait', { title: m.title || 'Aguardando…', sub: m.master ? '' : 'O Master controla os menus' });
}

function showMode(kind, m) {
  $('drive').hidden = kind !== 'drive';
  $('menu').hidden = kind !== 'menu';
  $('msg').hidden = kind !== 'msg' && kind !== 'wait';
  $('skull').hidden = kind !== 'dead';
  $('editp').hidden = kind === 'drive' || kind === 'dead';
  if (kind === 'drive' || kind === 'dead') closeProfile();
  S.mode = kind;
  S.steer = 0; S.fire = false; S.rev = false; S.held = { L: false, R: false }; touches.clear();
  if (kind === 'menu') {
    $('mtitle').textContent = m.title || '';
    const info = m.info;
    $('minfo').hidden = !info;
    if (info) {
      $('mname').textContent = info.name || '';
      $('msub').textContent = info.sub || '';
      $('mextra').textContent = info.extra || '';
      if (info.thumb) { if ($('mthumb').getAttribute('src') !== info.thumb) $('mthumb').src = info.thumb; $('mthumb').hidden = false; } else $('mthumb').hidden = true;
    }
    $('mok').textContent = m.ok || 'OK';
  }
  if (kind === 'msg' || kind === 'wait') $('msg').innerHTML = `${m.title || ''}${m.sub ? `<small>${m.sub}</small>` : ''}`;
}

// ------------------------------------------------------------------ toque
// Layout: faixa de cima = ACAO (item); embaixo, metade esquerda = seta ESQUERDA, direita = seta DIREITA.
// As duas setas juntas = RE em linha reta. Zonas grandes, por posicao (da para jogar sem olhar).
const touches = new Map(); // id -> 'L' | 'R' | 'A'
let lastFire = false;

function zoneAt(x, y) {
  const r = $('drive').getBoundingClientRect();
  const actBottom = $('act').getBoundingClientRect().bottom;
  if (y < actBottom + 4) return 'A';
  return x < r.left + r.width / 2 ? 'L' : 'R';
}

function readTouches() {
  let L = false, R = false, A = false;
  for (const z of touches.values()) { if (z === 'L') L = true; else if (z === 'R') R = true; else A = true; }
  S.held = { L, R };
  S.rev = L && R;
  // direcao direta: a suavizacao fica so na simulacao (CAR.steerRate); rampa aqui so atrasava
  S.steer = S.rev ? 0 : (R ? 1 : 0) - (L ? 1 : 0);
  S.fire = A;
  $('btnL').classList.toggle('pressed', L);
  $('btnR').classList.toggle('pressed', R);
  $('act').classList.toggle('pressed', A);
  if (A && !lastFire && navigator.vibrate) navigator.vibrate(8);
  lastFire = A;
}

function sendInput() {
  if (!S.ws || S.ws.readyState !== 1 || !S.joined) return;
  const buttons = (S.fire ? BTN_FIRE : 0) | (document.hidden ? BTN_AWAY : 0) | (S.rev ? BTN_REV : 0);
  const pkt = encodeInput(S.rev ? 0 : S.steer, buttons, S.seq++, buf);
  if (S.dc?.readyState === 'open') S.dc.send(pkt);
  else S.ws.send(pkt);
}


function touchStart(e) {
  if (S.mode !== 'drive') return;
  e.preventDefault();
  for (const t of e.changedTouches) touches.set(t.identifier, zoneAt(t.clientX, t.clientY));
  readTouches();
  sendInput();
}
function touchMove(e) {
  if (S.mode !== 'drive') return;
  e.preventDefault();
  for (const t of e.changedTouches) if (touches.has(t.identifier)) touches.set(t.identifier, zoneAt(t.clientX, t.clientY));
  readTouches();
  sendInput();
}
function touchEnd(e) {
  for (const t of e.changedTouches) touches.delete(t.identifier);
  readTouches();
  if (S.mode === 'drive') { e.preventDefault(); sendInput(); }
}
const opt = { passive: false };
document.addEventListener('touchstart', touchStart, opt);
document.addEventListener('touchmove', touchMove, opt);
document.addEventListener('touchend', touchEnd, opt);
document.addEventListener('touchcancel', touchEnd, opt);
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

// mouse (teste no desktop): clicar nas zonas; tecla Espaco nao e usada aqui
let mouseDown = false;
document.addEventListener('mousedown', (e) => {
  if (S.mode !== 'drive') return;
  mouseDown = true;
  touches.set('m', zoneAt(e.clientX, e.clientY));
  readTouches(); sendInput();
});
document.addEventListener('mousemove', (e) => {
  if (!mouseDown) return;
  touches.set('m', zoneAt(e.clientX, e.clientY));
  readTouches(); sendInput();
});
document.addEventListener('mouseup', () => { mouseDown = false; touches.delete('m'); readTouches(); if (S.mode === 'drive') sendInput(); });
// teclado (teste no desktop): setas e espaco
const keys = new Set();
document.addEventListener('keydown', (e) => {
  if (S.mode !== 'drive' || e.repeat) return;
  if (e.key === 'ArrowLeft') touches.set('kL', 'L');
  else if (e.key === 'ArrowRight') touches.set('kR', 'R');
  else if (e.key === ' ') touches.set('kA', 'A');
  else return;
  keys.add(e.key); readTouches(); sendInput();
});
document.addEventListener('keyup', (e) => {
  touches.delete(e.key === 'ArrowLeft' ? 'kL' : e.key === 'ArrowRight' ? 'kR' : e.key === ' ' ? 'kA' : '');
  readTouches(); if (S.mode === 'drive') sendInput();
});

// botoes de menu (Master)
$('menu').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-k]');
  if (!b) return;
  if (navigator.vibrate) navigator.vibrate(12);
  send({ t: 'menu', k: b.dataset.k });
});

// tela cheia
$('fs').addEventListener('click', () => {
  const el = document.documentElement;
  (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.then?.(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
});

// ------------------------------------------------------------------ P2P
// A tela abre um canal direto (WebRTC) para o input; a sinalizacao passa pelo WebSocket. Sem canal, usa o WebSocket.
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
let rtcChain = Promise.resolve();
function onRtc(m) {
  rtcChain = rtcChain.then(async () => {
    if (m.sdp) {
      S.pc?.close();
      S.dc = null;
      const pc = new RTCPeerConnection({ iceServers: ICE });
      S.pc = pc;
      pc.onicecandidate = (e) => e.candidate && send({ t: 'rtc', cand: e.candidate.toJSON() });
      pc.ondatachannel = (e) => {
        const dc = e.channel;
        const mark = () => { if (S.pc === pc) { S.dc = dc.readyState === 'open' ? dc : null; $('ping').textContent = S.dc ? '● P2P' : '●'; } };
        dc.onopen = dc.onclose = mark;
      };
      await pc.setRemoteDescription(m.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      send({ t: 'rtc', sdp: pc.localDescription.toJSON() });
    } else if (m.cand && S.pc) await S.pc.addIceCandidate(m.cand);
  }).catch(() => {});
}

// ------------------------------------------------------------------ perfil (nome + foto/emoji), editavel fora da corrida
const EMOJIS = ['😎', '🤠', '👽', '🤖', '👻', '🐱', '🐶', '🦊', '🐸', '🐵', '🦄', '🐙', '🔥', '⚡', '🍕', '👑'];
const avatarHtml = (a) => (!a ? '🙂' : a.startsWith('data:') ? `<img src="${a}" alt="">` : a.replace(/[<>&"]/g, ''));
function showAvatar() {
  const a = store('rw-avatar') || '';
  $('pav').innerHTML = avatarHtml(a);
  $('me').innerHTML = a ? `<span class="pav">${avatarHtml(a)}</span>` : '';
  for (const b of $('emojis').children) b.classList.toggle('sel', b.textContent === a);
}
let profTimer = 0;
function pushProfile() {
  clearTimeout(profTimer);
  profTimer = setTimeout(() => send({ t: 'profile', name: store('rw-name') || '', avatar: store('rw-avatar') || '' }), 150);
}
function setAvatar(a) {
  store('rw-avatar', cleanAvatar(a));
  showAvatar();
  pushProfile();
}
function closeProfile() { $('prof').hidden = true; }
$('emojis').innerHTML = EMOJIS.map((e) => `<button type="button">${e}</button>`).join('');
$('emojis').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setAvatar(b.textContent); });
$('editp').addEventListener('click', () => { $('pname').value = store('rw-name') || ''; showAvatar(); $('prof').hidden = false; });
$('pdone').addEventListener('click', closeProfile);
$('pclear').addEventListener('click', () => setAvatar(''));
$('pname').addEventListener('input', () => { store('rw-name', $('pname').value.trim()); $('name').value = $('pname').value; pushProfile(); });
$('pfile').addEventListener('change', async () => {
  const f = $('pfile').files[0];
  $('pfile').value = '';
  if (!f) return;
  try {
    // foto reduzida a 64x64 (recorte central) no proprio celular: ~3 KB, cabe no limite do servidor
    const img = await createImageBitmap(f);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const k = Math.min(img.width, img.height);
    c.getContext('2d').drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, 64, 64);
    setAvatar(c.toDataURL('image/jpeg', 0.7));
  } catch {}
});
showAvatar();

// ------------------------------------------------------------------ entrada
function join() {
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) { $('err').textContent = 'O código tem 4 letras.'; return; }
  store('rw-name', $('name').value.trim());
  $('err').textContent = '';
  S.room = code;
  if (S.ws) { S.ws.onclose = null; S.ws.close(); }
  connect();
}
$('go').addEventListener('click', join);
$('code').addEventListener('keydown', (e) => e.key === 'Enter' && join());
$('name').value = store('rw-name') || '';
let saved = null;
try { saved = sessionStorage.getItem('rw-room'); } catch {}
const urlRoom = (params.get('room') || '').toUpperCase();
$('code').value = urlRoom || saved || '';
if (urlRoom.length === 4 || (saved && saved.length === 4)) join();

// heartbeat de entrada + ping
// reenvio periodico: o canal P2P nao retransmite, entao um pacote perdido se corrige no proximo
setInterval(() => { if (S.joined && S.mode === 'drive') sendInput(); }, 33);
setInterval(() => { if (S.joined && S.mode !== 'drive') sendInput(); }, 500);
setInterval(() => send({ t: 'ping', ts: performance.now() }), 2000);
document.addEventListener('visibilitychange', () => sendInput());
