// Reescreve um HTML de public/ para funcionar em qualquer subcaminho (ex.: /racing-wars/):
// href/src absolutos viram relativos e entra um importmap relativo (cobre os imports '/sim/', '/shared/', '/host/').
// Usado pelo build estatico (GitHub Pages) e pelo servidor Node.
export function renderPage(html, prefix, config) {
  html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
  html = html.replace(/(href|src)="\/(host|pad|editor)\//g, (_, a, d) => `${a}="${prefix}${d}/`);
  const map = {
    imports: {
      three: `${prefix}vendor/three/three.module.js`,
      'three/addons/': `${prefix}vendor/three-addons/`,
      qrcode: `${prefix}vendor/qrcode.mjs`,
      '/shared/': `${prefix}shared/`,
      '/sim/': `${prefix}sim/`,
      '/host/': `${prefix}host/`,
    },
  };
  const cfg = config ? `<script>window.RW=${JSON.stringify(config)};</script>\n` : '';
  const head = `${cfg}<script type="importmap">${JSON.stringify(map)}</script>\n`;
  if (!html.includes('</head>')) throw new Error('HTML sem </head>');
  return html.replace('</head>', head + '</head>');
}
