// Cliente WebSocket do host (tela principal).
import { decodeHostInput, HOST_INPUT } from '/shared/protocol.js';
import { wsUrl } from '/shared/wsurl.js';

export class HostNet {
  constructor(h) {
    this.h = h; // { onRoom, onConnect, onDisconnect, onMaster, onInput, onFrom, onStatus }
    this.ws = null;
    this.code = null;
    this.rec = { id: 0, steer: 0, buttons: 0, seq: 0 };
    this.retry = 0;
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
        case 'connect': this.h.onConnect(m); break;
        case 'disconnect': this.h.onDisconnect(m); break;
        case 'master': this.h.onMaster(m.id); break;
        case 'from': this.h.onFrom(m.id, m.data); break;
        case 'err': this.h.onStatus?.(m.reason === 'busy' ? 'busy' : 'offline'); break;
      }
    };
    ws.onclose = () => {
      this.h.onStatus?.('offline');
      setTimeout(() => this.connect(), Math.min(4000, 400 * ++this.retry));
    };
    ws.onerror = () => ws.close();
  }

  sendTo(id, data) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'to', id, data }));
  }
  sendAll(data) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'all', data }));
  }
}
