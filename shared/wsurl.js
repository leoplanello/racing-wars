// URL do WebSocket derivada da pagina: funciona na raiz e atras de um proxy com prefixo (ex.: /racing-wars/).
// `base` e o document.baseURI (a pagina do host, ou /pad/ no celular). `relay` sobrescreve tudo.
export function wsUrl(base, relay) {
  if (relay) return relay;
  const u = new URL(base);
  // host: <prefixo>/ ; celular: <prefixo>/pad/ ; dist estatico: <prefixo>/host/
  u.pathname = u.pathname.replace(/(pad|host|editor)\/(index\.html)?$/, '').replace(/[^/]*$/, '') + 'ws';
  u.search = '';
  u.hash = '';
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.href;
}
