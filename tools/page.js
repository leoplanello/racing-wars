// Reescreve um HTML de public/ para funcionar em qualquer subcaminho (ex.: /racing-wars/):
// href/src absolutos viram relativos e entra um importmap relativo (cobre os imports '/sim/', '/shared/', '/host/').
// Usado pelo build estatico (GitHub Pages) e pelo servidor Node.
// `ver` (servidor) poe os arquivos sob _v/<ver>/: cada deploy muda a URL e nenhum cache (Cloudflare reescreve
// o Cache-Control dos .js para 4 h) serve codigo antigo. O HTML em si nunca fica em cache.
export function renderPage(html, prefix, config, ver) {
  const base = ver ? `${prefix}_v/${ver}/` : prefix;
  html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
  html = html.replace(/(href|src)="\/(host|pad|editor)\//g, (_, a, d) => `${a}="${base}${d}/`);
  const map = {
    imports: {
      three: `${base}vendor/three/three.module.js`,
      'three/addons/': `${base}vendor/three-addons/`,
      qrcode: `${base}vendor/qrcode.mjs`,
      '/shared/': `${base}shared/`,
      '/sim/': `${base}sim/`,
      '/host/': `${base}host/`,
    },
  };
  const cfg = config ? `<script>window.RW=${JSON.stringify(config)};</script>\n` : '';
  const head = `${cfg}<script type="importmap">${JSON.stringify(map)}</script>\n`;
  if (!html.includes('</head>')) throw new Error('HTML sem </head>');
  return html.replace('</head>', head + '</head>');
}
