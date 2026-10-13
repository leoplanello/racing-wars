// Cliente WebSocket do host (tela principal).
import { decodeHostInput, HOST_INPUT, PAD_INPUT } from '/shared/protocol.js';
import { wsUrl } from '/shared/wsurl.js';

// STUN publico gratuito; sem TURN: se o P2P nao fechar, o input segue pelo WebSocket (relay).
export const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export class HostNet {
  constructor(h) {
    this.h = h; // { onRoom, onConnect, onDisconnect, onMaster, onInput, onFrom, onStatus }
    this.ws = null;
    this.code = null;
    this.rec = { id: 0, steer: 0, buttons: 0, seq: 0 };
    this.retry = 0;
    this.peers = new Map(); // deviceId -> { pc, chain }
  }

  connect() {
    const cfg = window.RW || {};
    if (cfg.static && !cfg.relay) { this.h.onStatus?.('offline'); return; } // Pages sem relay: so teclado
    const ws = new WebSocket(wsUrl(document.baseURI, cfg.relay));
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      let code = null;
      try { code = sessionStorage.getItem('rw-room'); } catch {}
      ws.send(JSON.stringify({ t: 'host', code }));
      this.h.onStatus?.('online');
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        const b = new Uint8Array(ev.data);
        if (b.length === 5 && b[0] === HOST_INPUT) this.h.onInput(decodeHostInput(b, this.rec));
        return;
      }
      const m = JSON.parse(ev.data);
      switch (m.t) {
        case 'room':
          this.code = m.code;
          try { sessionStorage.setItem('rw-room', m.code); } catch {}
          this.h.onRoom(m.code);
          break;
        case 'connect': this.rtcOpen(m.id); this.h.onConnect(m); break;
        case 'disconnect': this.rtcClose(m.id); this.h.onDisconnect(m); break;
        case 'master': this.h.onMaster(m.id); break;
        case 'from':
          if (m.data?.t === 'rtc') this.rtcSignal(m.id, m.data);
          else this.h.onFrom(m.id, m.data);
          break;
        case 'err': this.h.onStatus?.(m.reason === 'busy' ? 'busy' : 'offline'); break;
      }
    };
    ws.onclose = () => {
      for (const id of [...this.peers.keys()]) this.rtcClose(id);
      this.h.onStatus?.('offline');
      setTimeout(() => this.connect(), Math.min(4000, 400 * ++this.retry));
    };
    ws.onerror = () => ws.close();
  }

  /** Canal direto celular -> tela (sem passar pelo servidor): so input, sem ordem nem retransmissao. */
  rtcOpen(id) {
    if (typeof RTCPeerConnection === 'undefined') return;
    this.rtcClose(id);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, chain: Promise.resolve() };
    this.peers.set(id, peer);
    const dc = pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 });
    dc.binaryType = 'arraybuffer';
    const pkt = new Uint8Array(5);
    pkt[0] = HOST_INPUT;
    pkt[1] = id;
    dc.onmessage = (ev) => {
      const b = new Uint8Array(ev.data);
      if (b.length !== 4 || b[0] !== PAD_INPUT) return;
      pkt.set(b.subarray(1), 2);
      this.h.onInput(decodeHostInput(pkt, this.rec));
    };
    pc.onicecandidate = (e) => e.candidate && this.sendTo(id, { t: 'rtc', cand: e.candidate.toJSON() });
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .then(() => this.sendTo(id, { t: 'rtc', sdp: pc.localDescription.toJSON() }))
      .catch(() => {});
  }
  rtcSignal(id, m) {
    const peer = this.peers.get(id);
    if (!peer) return;
    // em fila: a resposta precisa entrar antes dos candidatos
    peer.chain = peer.chain.then(() => (m.sdp ? peer.pc.setRemoteDescription(m.sdp) : m.cand ? peer.pc.addIceCandidate(m.cand) : null)).catch(() => {});
  }
  rtcClose(id) {
    this.peers.get(id)?.pc.close();
    this.peers.delete(id);
  }

  sendTo(id, data) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'to', id, data }));
  }
  sendAll(data) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'all', data }));
  }
}
