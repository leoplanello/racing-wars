// Protocolo compartilhado entre servidor, host e controle (roda no navegador e no Node).

export const MAX_PLAYERS = 8;
export const ROOM_CODE_LEN = 4;
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I e O

export const PAD_INPUT = 0x01; // celular -> servidor
export const HOST_INPUT = 0x81; // servidor -> host

export const BTN_FIRE = 1;
export const BTN_AWAY = 2;
export const BTN_REV = 4; // as duas setas juntas = re em linha reta

// Cores dos 8 carros (tons primarios/secundarios puros para leitura periferica).
export const COLORS = [
  { name: 'Vermelho', hex: '#e8202a' },
  { name: 'Azul', hex: '#1f6bff' },
  { name: 'Amarelo', hex: '#ffd60a' },
  { name: 'Verde', hex: '#1fc04a' },
  { name: 'Laranja', hex: '#ff8a00' },
  { name: 'Roxo', hex: '#9b3dff' },
  { name: 'Ciano', hex: '#12d3e6' },
  { name: 'Rosa', hex: '#ff4fa3' },
];

export const ITEMS = ['nitro', 'mine', 'missile', 'whomp', 'ice'];
export const ITEM_LABEL = { nitro: 'NITRO', mine: 'MINA', missile: 'MÍSSIL', whomp: 'WHOMP', ice: 'GELO' };
export const ITEM_ICON = { nitro: '🚀', mine: '💣', missile: '🎯', whomp: '🧲', ice: '❄️' };

/** Codifica o input do celular em 4 bytes: [tipo, steer(int8), botoes, seq]. */
export function encodeInput(steer, buttons, seq, out = new Uint8Array(4)) {
  const s = Math.max(-1, Math.min(1, steer));
  out[0] = PAD_INPUT;
  out[1] = Math.round(s * 127) & 0xff;
  out[2] = buttons & 0xff;
  out[3] = seq & 0xff;
  return out;
}

/** Decodifica o frame que o host recebe: [0x81, deviceId, steer, botoes, seq]. */
export function decodeHostInput(bytes, out = { id: 0, steer: 0, buttons: 0, seq: 0 }) {
  out.id = bytes[1];
  const s = bytes[2] > 127 ? bytes[2] - 256 : bytes[2];
  out.steer = s / 127;
  out.buttons = bytes[3];
  out.seq = bytes[4];
  return out;
}

/** Foto de perfil vinda do celular: emoji curto ou data URL de imagem pequena; qualquer outra coisa vira ''. */
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const AVATAR_MAX = 12000;
export function cleanAvatar(a) {
  if (typeof a !== 'string') return '';
  if (a.startsWith('data:')) return a.length <= AVATAR_MAX && AVATAR_RE.test(a) ? a : '';
  return [...a].length <= 8 && !/[<>&"'\s]/.test(a) ? a : '';
}
